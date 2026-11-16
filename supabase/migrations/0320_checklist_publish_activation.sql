-- Migration 0320_checklist_publish_activation
-- AUTHORED 2026-11-15. NOT YET APPLIED — FILE ONLY. Apply via MCP after review (sim first, prod on Juan's word).
-- Provenance: the 2026-11-14 bug audit (found at commit 7494f738), fix wave W15 "Checklist template publishing
--   and admin editors". One file for the wave's SQL; each section names its bug id. Owner decision W15-2 (a):
--   a line switched to opening verification starts with TOMORROW's opening.
--
-- WHAT:
--   A. checklist_lineage_lock_key(template) — ONE advisory key per template lineage
--      (location, type, name, prep_subtype). The activation RPC (B) and the instance guard (C) take the SAME
--      key, so the two serialize on it. Owner-only (no grant): it is called only from the two definer bodies.
--   B. checklist_template_activate_version(actor, source, new, apply_now, today, item_map) — B022 / B083 / B084.
--      The publish used to activate a new version with four separate PostgREST calls (retire colliding rows,
--      activate, retire the rest) and never moved the fridge pointers. Now ONE transaction, under the lineage
--      key, then the lineage rows FOR NO KEY UPDATE (sorted by id; FK key-share checks keep flowing):
--        · B083 stale source — the source must still be the lineage HEAD (newest ACTIVE row by
--          effective_from DESC NULLS LAST, created_at DESC = versionOutranks). Otherwise `stale_source`:
--          a publish from an old screen no longer silently retires another manager's pending version.
--        · B084 apply-now — re-counts today's instances on ANY lineage version UNDER THE KEY; non-zero is
--          `apply_now_blocked_open_instance`, before anything is retired. (The app's earlier count stays as
--          the friendly early refusal; this is the authoritative one.)
--        · retirement — EXACTLY the app's rules (lib/admin/template-builder.ts 4a / 4b): first every active
--          row colliding on the new effective_from (the partial unique index), then the activation, then every
--          other active row except the currently-effective one (which apply-now retires too). Each retired
--          row is returned with publish_op pending_replaced | superseded for the app's audit rows.
--        · B022 fridge pointers — item_map is {source item id: new item id} for every COPIED row (the app
--          now gives each copy an explicit id). It is validated (keys on the source version, values on the
--          new one) and every maintenance_equipment pointer AT THIS SHOP naming a source item moves to its
--          copy, in the same transaction as the activation. (The app's fridge registry also claims every
--          fridge-linked line on every version — that half needs no SQL and repairs past publishes.)
--      Named refusals (P0001): template_not_found · type_not_publishable · version_not_activatable ·
--      stale_source · apply_now_blocked_open_instance · activate_no_row · item_map_invalid.
--      SECURITY DEFINER, pinned search_path, EXECUTE for service_role only.
--   C. checklist_instance_lineage_guard — B084. BEFORE INSERT on checklist_instances: for an OPENING or
--      CLOSING instance that is one-per-day (allows_multiple_per_day = false) it takes the lineage key and
--      refuses `checklist_instance_lineage_taken` when an instance of ANOTHER version of the same lineage
--      already exists for (shop, date). The 0059 partial unique index is per TEMPLATE, so an apply-now publish
--      landing between a closer's first open and their refresh made a second closing on the new version and
--      stranded the first one's ticks. When THIS version already has the day's instance the guard returns at
--      once (fix round 1): the insert is a re-open, and the 0059 index answers it (create_opening_instance_
--      atomic's ON CONFLICT returns the existing row; the app's 23505 re-read finds it) — even when a legacy
--      pair also has the day on another version, so a reload never fails on a strand made before 0320. Prep,
--      mid-day and other types return at once without a lock. Existing duplicate pairs are not touched.
--   D. submit_phase2_atomic ← 0315 (W14, applied to sim + prod), B085, exactly two changes: the completeness
--      count and the per-item loop
--      both keep only openingPhase2 items that have a LIVE Phase 1 row on THIS instance. An item mirrored onto
--      today's opening after its Phase 1 snapshot (mid-shift "opening verification" on, or a new AM-prep line)
--      had no Phase 1 row, could never be saved (`phase1_not_resolved`) and made finalize impossible for the
--      day (`phase2_incomplete`). Owner decision W15-2 (a): it starts with tomorrow's opening, which snapshots
--      it at creation. The loop's phase1_not_resolved raise stays as a belt-and-braces check. Every other line,
--      including 0315's instance lock (FOR NO KEY UPDATE, B080), the signature, SECURITY DEFINER, the
--      search_path and the grants are 0315's (tests/checklist-publish-activation-migration.test.ts pins the 0315
--      body as a line-subsequence).
--
-- LOCK ORDER (AGENTS.md: AM instance → closing instance → completion rows; parent locks FOR NO KEY UPDATE;
--   never a parent after a completion). The lineage key is taken FIRST by both B and C and by nothing else:
--     B: lineage key → lineage template rows FOR NO KEY UPDATE (id order) → reads of instances → template and
--        maintenance_equipment UPDATEs. It never locks an instance or a completion.
--     C: lineage key, as the first lock of its statement (the instance writers — the app's single-statement
--        insert and create_opening_instance_atomic 0052/0063/0215 — insert the instance before touching any
--        other row; no SQL writer inserts an instance after locking a completion: grep of
--        `insert into checklist_instances` across supabase/migrations = 0052, 0063, 0215 only).
--   So the key adds no edge into the checklist order and B / C cannot deadlock (both take the key first).
--   D adds no lock: 0315's instance lock (opening instance FOR NO KEY UPDATE, first) is kept as it is.
--
-- APP: lib/admin/template-builder.ts calls B after the copy. Until 0320 is applied the RPC is missing
--   (PGRST202 / 42883) and the publish falls back to the pre-0320 four-step activation (+ the pointer move as
--   separate updates), so the app keeps working before the apply; B083's stale check and B084's count also run
--   in the app as early refusals. Without C and D the old races / the stuck mid-shift mirror remain until apply.
--
-- REBASE (fix round 1): W14's 0315 is applied to sim and prod; it re-emitted submit_phase2_atomic from 0255 with
--   one change (the instance row FOR NO KEY UPDATE, B080). Section D is now 0315's body plus the two EXISTS
--   clauses, and the pre-flight refuses by name unless the LIVE body is 0315's (or already this one), so 0320
--   can never silently drop 0315's lock or anything later. supabase/migrations/0315_opening_counts_batch_prep.sql
--   is carried byte-identical from fix/audit-w14 (3d4814bb) so the pins and the harness read the real source.
--
-- DEPENDS ON: 0059 (allows_multiple_per_day + checklist_instances_single_per_day_key), 0070 (maintenance_
--   equipment pointers), 0162 (effective_from / supersedes_template_id), 0315 (submit_phase2_atomic).
--
-- PRE-FLIGHT (MCP, read-only, before apply; paste into the PR):
--   select to_regprocedure('public.checklist_template_activate_version(uuid,uuid,uuid,boolean,date,jsonb)');  -- NULL
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc
--    where oid = 'public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)'::regprocedure;
--     -- 13a3433b03ac9732dd33a061dba41a7f = the 0315 body (0315's own fingerprint); anything else refuses
--   -- stale fridge pointers (pointer item on an inactive version; the registry already serves their readings):
--   select me.id, me.location_id, 'AM' side, t.id tpl from maintenance_equipment me
--     join checklist_template_items cti on cti.id = me.opening_temp_item_id join checklist_templates t on t.id = cti.template_id where not t.active
--   union all
--   select me.id, me.location_id, 'PM', t.id from maintenance_equipment me
--     join checklist_template_items cti on cti.id = me.closing_temp_item_id join checklist_templates t on t.id = cti.template_id where not t.active;
--   -- existing same-lineage duplicate instances (B084 strands already made; left as they are, the pages pick one):
--   select ci.location_id, ci.date, t.type, t.name, count(*) from checklist_instances ci join checklist_templates t on t.id = ci.template_id
--    where t.type in ('opening','closing') and not ci.allows_multiple_per_day group by 1,2,3,4 having count(*) > 1;
--   -- cross-shop equipment links (B082; the registry ignores them; repair only if non-zero, CC decides):
--   select cti.id, t.location_id, me.location_id from checklist_template_items cti join checklist_templates t on t.id = cti.template_id
--     join maintenance_equipment me on me.id = cti.equipment_id where t.location_id <> me.location_id;
--   -- count lines linked to a fridge vs the pointers (B022 part 1 claims the linked ones):
--   select count(*) from checklist_template_items cti join maintenance_equipment me on me.id = cti.equipment_id
--    where cti.expects_count and me.kind = 'fridge';
--
-- EXISTING ROWS: none are changed. Stale pointers are left as they are (the app registry serves their readings
--   and the next publish of that list moves any pointer that names its source version).
--
-- VERIFY AFTER APPLY:
--   select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace
--    and proname in ('checklist_lineage_lock_key','checklist_template_activate_version','checklist_instance_lineage_guard','submit_phase2_atomic');
--     -- four rows, all t, {search_path=pg_catalog, public}
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name in ('checklist_lineage_lock_key','checklist_template_activate_version','checklist_instance_lineage_guard','submit_phase2_atomic')
--    and grantee in ('PUBLIC','anon','authenticated');                                                      -- NO ROWS
--   select tgname, tgenabled from pg_trigger where tgrelid = 'public.checklist_instances'::regclass and tgname = 'checklist_instances_lineage_guard'; -- O
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc
--    where oid = 'public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)'::regprocedure;  -- b0473d28679e82a7bbfd70b73e0b8f33
--
-- SIM PROOF (two sessions; CC runs it on sim, never CI): scripts/sim/checklist-0320-lineage-lock-check-management.mjs.
-- OFFLINE PROOF: scripts/sql-harness-0320.mjs (PGlite), run by tests/checklist-publish-activation-migration.test.ts.

begin;

-- ── PRE-FLIGHT: refuse by name ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_body text;
begin
  if to_regclass('public.checklist_templates') is null or to_regclass('public.checklist_instances') is null
     or to_regclass('public.checklist_template_items') is null or to_regclass('public.maintenance_equipment') is null then
    raise exception '0320: the checklist / maintenance tables are missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'checklist_templates' and column_name = 'supersedes_template_id') then
    raise exception '0320: needs 0162 (supersedes_template_id / effective_from)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'checklist_instances' and column_name = 'allows_multiple_per_day') then
    raise exception '0320: needs 0059 (allows_multiple_per_day)';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'checklist_instances_single_per_day_key') then
    raise exception '0320: needs the 0059 partial unique index checklist_instances_single_per_day_key';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.checklist_instances'::regclass
              and tgname = 'checklist_instances_lineage_guard' and not tgisinternal)
     and to_regprocedure('public.checklist_instance_lineage_guard()') is null then
    raise exception '0320: a checklist_instances_lineage_guard trigger exists with another function: refusing';
  end if;
  -- D: the live submit_phase2_atomic must be 0315's body or already this one (0315's fingerprint: the md5 of
  -- prosrc with every non-printing / space character removed). 0255's body (0315 not applied) and anything
  -- else refuse: re-emitting from the wrong body would drop a lock or a later change.
  select prosrc into v_body from pg_proc
   where oid = to_regprocedure('public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)');
  if v_body is null then
    raise exception '0320: submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text) is missing';
  end if;
  if md5(regexp_replace(v_body, '[^\x21-\x7E]+', '', 'g'))
       not in ('13a3433b03ac9732dd33a061dba41a7f', 'b0473d28679e82a7bbfd70b73e0b8f33') then
    raise exception '0320: submit_phase2_atomic is not the 0315 body (md5 %): re-base section D onto the live body',
      md5(regexp_replace(v_body, '[^\x21-\x7E]+', '', 'g'));
  end if;
end $$;

-- ── A. The lineage key ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.checklist_lineage_lock_key(p_template uuid)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select hashtextextended(
           'checklist_lineage:' || t.location_id::text || ':' || t.type || ':' || t.name || ':' || coalesce(t.prep_subtype, ''),
           0)
    from public.checklist_templates t
   where t.id = p_template
$$;

revoke all on function public.checklist_lineage_lock_key(uuid) from public, anon, authenticated, service_role;

-- ── B. The activation RPC ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.checklist_template_activate_version(
  p_actor uuid,
  p_source uuid,
  p_new uuid,
  p_apply_now boolean,
  p_today date,
  p_item_map jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  s public.checklist_templates%rowtype;
  n public.checklist_templates%rowtype;
  v_head uuid;
  v_cur uuid;
  v_count integer;
  v_moved integer := 0;
  v_retired jsonb := '[]'::jsonb;
  v_map jsonb := coalesce(p_item_map, '{}'::jsonb);
  r record;
begin
  if p_actor is null or p_source is null or p_new is null or p_today is null or p_apply_now is null
     or jsonb_typeof(v_map) <> 'object' then
    raise exception 'item_map_invalid';
  end if;

  select * into s from public.checklist_templates where id = p_source;
  if not found then raise exception 'template_not_found'; end if;
  if s.type not in ('opening', 'closing') then raise exception 'type_not_publishable'; end if;

  -- The lineage key first (shared with the instance guard), then the lineage rows (sorted, NO KEY UPDATE).
  perform pg_advisory_xact_lock(public.checklist_lineage_lock_key(p_source));
  perform 1 from public.checklist_templates t
   where t.location_id = s.location_id and t.type = s.type and t.name = s.name
     and t.prep_subtype is not distinct from s.prep_subtype
   order by t.id
   for no key update;

  select * into n from public.checklist_templates where id = p_new;
  if not found or n.active or n.supersedes_template_id is distinct from p_source
     or n.location_id <> s.location_id or n.type <> s.type or n.name <> s.name
     or n.prep_subtype is distinct from s.prep_subtype or n.effective_from is null then
    raise exception 'version_not_activatable';
  end if;

  -- B083: the source must still be the lineage head (versionOutranks order).
  select t.id into v_head from public.checklist_templates t
   where t.location_id = s.location_id and t.type = s.type and t.name = s.name
     and t.prep_subtype is not distinct from s.prep_subtype and t.active
   order by t.effective_from desc nulls last, t.created_at desc
   limit 1;
  if v_head is distinct from p_source then raise exception 'stale_source'; end if;

  -- B084: the apply-now gate, re-counted under the key (any lineage version, this shop, today).
  if p_apply_now then
    select count(*) into v_count
      from public.checklist_instances ci
      join public.checklist_templates t on t.id = ci.template_id
     where t.location_id = s.location_id and t.type = s.type and t.name = s.name
       and t.prep_subtype is not distinct from s.prep_subtype
       and ci.location_id = s.location_id and ci.date = p_today;
    if v_count > 0 then raise exception 'apply_now_blocked_open_instance'; end if;
  end if;

  -- The currently-effective version on p_today (resolveEffectiveVersionId), before anything moves.
  select t.id into v_cur from public.checklist_templates t
   where t.location_id = s.location_id and t.type = s.type and t.name = s.name
     and t.prep_subtype is not distinct from s.prep_subtype and t.active and t.id <> p_new
     and (t.effective_from is null or t.effective_from <= p_today)
   order by t.effective_from desc nulls last, t.created_at desc
   limit 1;

  -- 4a: retire every active row colliding on the new effective_from (the partial unique index).
  for r in
    update public.checklist_templates t set active = false
     where t.location_id = s.location_id and t.type = s.type and t.name = s.name
       and t.prep_subtype is not distinct from s.prep_subtype and t.active and t.id <> p_new
       and t.effective_from = n.effective_from
    returning t.id, t.effective_from
  loop
    v_retired := v_retired || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'effective_from', r.effective_from,
      'publish_op', case when r.effective_from > p_today then 'pending_replaced' else 'superseded' end,
      'collided', true));
  end loop;

  -- ACTIVATE (the commit point).
  update public.checklist_templates set active = true where id = p_new and not active;
  if not found then raise exception 'activate_no_row'; end if;

  -- 4b: retire every other active row except the currently-effective one (apply-now retires it too).
  for r in
    update public.checklist_templates t set active = false
     where t.location_id = s.location_id and t.type = s.type and t.name = s.name
       and t.prep_subtype is not distinct from s.prep_subtype and t.active and t.id <> p_new
       and (p_apply_now or t.id is distinct from v_cur)
    returning t.id, t.effective_from
  loop
    v_retired := v_retired || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'effective_from', r.effective_from,
      'publish_op', case when r.effective_from is not null and r.effective_from > p_today then 'pending_replaced' else 'superseded' end,
      'collided', false));
  end loop;

  -- B022: move this shop's fridge pointers from each source item to its copy.
  if exists (
    select 1 from jsonb_each_text(v_map) m
     where m.key !~ '^[0-9a-fA-F-]{36}$' or m.value !~ '^[0-9a-fA-F-]{36}$'
        or not exists (select 1 from public.checklist_template_items i where i.id = m.key::uuid and i.template_id = p_source)
        or not exists (select 1 from public.checklist_template_items i where i.id = m.value::uuid and i.template_id = p_new)
  ) then
    raise exception 'item_map_invalid';
  end if;
  update public.maintenance_equipment me
     set opening_temp_item_id = (v_map ->> me.opening_temp_item_id::text)::uuid
   where me.location_id = s.location_id and me.opening_temp_item_id is not null
     and v_map ? me.opening_temp_item_id::text;
  get diagnostics v_count = row_count;
  v_moved := v_moved + v_count;
  update public.maintenance_equipment me
     set closing_temp_item_id = (v_map ->> me.closing_temp_item_id::text)::uuid
   where me.location_id = s.location_id and me.closing_temp_item_id is not null
     and v_map ? me.closing_temp_item_id::text;
  get diagnostics v_count = row_count;
  v_moved := v_moved + v_count;

  return jsonb_build_object('retired', v_retired, 'pointers_moved', v_moved, 'currently_effective', v_cur);
end;
$$;

revoke all on function public.checklist_template_activate_version(uuid, uuid, uuid, boolean, date, jsonb) from public, anon, authenticated;
grant execute on function public.checklist_template_activate_version(uuid, uuid, uuid, boolean, date, jsonb) to service_role;

-- ── C. One instance per lineage per shop per day (opening / closing) ───────────────────────────────────────
create or replace function public.checklist_instance_lineage_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  t public.checklist_templates%rowtype;
begin
  if new.allows_multiple_per_day then return new; end if;
  select * into t from public.checklist_templates where id = new.template_id;
  if not found or t.type not in ('opening', 'closing') then return new; end if;
  perform pg_advisory_xact_lock(public.checklist_lineage_lock_key(new.template_id));
  -- Round 1: this version already has the day's instance, so the insert is a re-open, not a second
  -- instance. Let the 0059 index decide (create_opening_instance_atomic's ON CONFLICT returns the
  -- existing row; the app's 23505 re-read finds it) — even when a legacy pair (a B084 strand made
  -- before 0320) also has the day on another version.
  if exists (
    select 1 from public.checklist_instances ci
     where ci.template_id = new.template_id and ci.location_id = new.location_id
       and ci.date = new.date and not ci.allows_multiple_per_day
  ) then
    return new;
  end if;
  if exists (
    select 1
      from public.checklist_instances ci
      join public.checklist_templates t2 on t2.id = ci.template_id
     where ci.location_id = new.location_id and ci.date = new.date
       and ci.template_id <> new.template_id and not ci.allows_multiple_per_day
       and t2.location_id = t.location_id and t2.type = t.type and t2.name = t.name
       and t2.prep_subtype is not distinct from t.prep_subtype
  ) then
    raise exception 'checklist_instance_lineage_taken' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.checklist_instance_lineage_guard() from public, anon, authenticated;

drop trigger if exists checklist_instances_lineage_guard on public.checklist_instances;
create trigger checklist_instances_lineage_guard
  before insert on public.checklist_instances
  for each row execute function public.checklist_instance_lineage_guard();

-- ── D. submit_phase2_atomic ← 0315 (B085: the Phase 2 universe is frozen at this instance's Phase 1) ───────
CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(p_opening_instance_id uuid, p_actor_id uuid, p_is_update boolean DEFAULT false, p_original_submission_id uuid DEFAULT NULL::uuid, p_ip_address text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_location_id uuid;
  v_location_code text;
  v_opening_date date;
  v_actor_name text;
  v_template_id uuid;
  v_submitted_at timestamptz := now();

  v_universe_item_id uuid;
  v_missing_count int := 0;

  v_completion_id uuid;
  v_completion_ids uuid[] := ARRAY[]::uuid[];
  v_submission_id uuid;
  v_opening_instance_row jsonb;

  -- per-item recompute locals
  v_phase2 jsonb;
  v_phase1 jsonb;          -- [D4] frozen Phase 1 contract — authoritative source
  v_item_label text;
  v_opener_prepped numeric;
  v_prep_need numeric;
  v_closer_count numeric;
  v_ground_truth_count numeric;
  v_over_under_reason_category text;
  v_over_under_reason_text text;
  v_delta numeric;
  v_over_under_status text;

  -- counters
  v_at_par_count int := 0;
  v_over_prep_count int := 0;
  v_under_prep_count int := 0;

  -- notifications
  v_notif_title text;
  v_notif_id uuid;
  v_notif_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  -- [D3] chain-edit deferred pending Juan ruling.
  IF p_is_update THEN
    RAISE EXCEPTION 'submit_phase2_atomic: phase2_chain_edit_not_implemented — re-finalize (C.46) deferred pending scope ruling'
      USING ERRCODE = 'P0001';
  END IF;

  -- 0315 (audit W14 / B080): the opening instance lock FIRST, before the completeness count.
  -- Finalize used to count live Phase 2 rows with no lock, so an Undo (or a save) committing
  -- after the count left a finalized report naming a revoked or superseded row. Under READ
  -- COMMITTED every statement below starts after this wait: a finalize that queued behind an
  -- Undo counts the row as missing (phase2_incomplete), and an Undo that queued behind this
  -- finalize is refused phase2_not_eligible. FOR NO KEY UPDATE = the 0287 parent-lock mode.
  PERFORM 1 FROM checklist_instances WHERE id = p_opening_instance_id FOR NO KEY UPDATE;

  -- ──── Pre-load instance + location ────
  SELECT ci.location_id, ci.date, ci.template_id, l.code
  INTO v_location_id, v_opening_date, v_template_id, v_location_code
  FROM checklist_instances ci
  JOIN locations l ON l.id = ci.location_id
  WHERE ci.id = p_opening_instance_id;
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'submit_phase2_atomic: opening instance % not found', p_opening_instance_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT name INTO v_actor_name FROM users WHERE id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_phase2_atomic: actor % not found', p_actor_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ──── Completeness over the Model Y universe ────
  -- Universe = every ACTIVE openingPhase2 template item on this instance's template.
  -- 0197 (LRA-202): `cti.active` mirrors the screen and the per-item save; a deactivated
  -- item is template history, not an obligation, or finalize can never succeed.
  -- Each MUST have a live phase2 completion (written by save_phase2_item_atomic).
  -- 0320 (W15/B085): only items with a LIVE Phase 1 row on THIS instance are in its universe — a mirror
  -- added after this instance's Phase 1 snapshot starts with tomorrow's opening (owner decision W15-2 a).
  SELECT count(*) INTO v_missing_count
  FROM checklist_template_items cti
  WHERE cti.template_id = v_template_id
    AND cti.active = TRUE
    AND cti.prep_meta->>'openingPhase2' = 'true'
    AND EXISTS (
      SELECT 1 FROM checklist_completions p1
      WHERE p1.instance_id = p_opening_instance_id
        AND p1.template_item_id = cti.id
        AND p1.prep_data ? 'phase1'
        AND p1.superseded_at IS NULL
        AND p1.revoked_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM checklist_completions cc
      WHERE cc.instance_id = p_opening_instance_id
        AND cc.template_item_id = cti.id
        AND cc.prep_data ? 'phase2'
        AND cc.superseded_at IS NULL
        AND cc.revoked_at IS NULL
    );
  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'submit_phase2_atomic: phase2_incomplete — % Phase 2 universe item(s) have no live completion', v_missing_count
      USING ERRCODE = 'P0001';
  END IF;

  -- ──── Per-item read-back, authoritative recompute, notification dispatch ────
  FOR v_universe_item_id, v_completion_id, v_phase2, v_item_label IN
    SELECT cti.id, cc.id, cc.prep_data->'phase2', cti.label
    FROM checklist_template_items cti
    JOIN checklist_completions cc
      ON cc.template_item_id = cti.id
     AND cc.instance_id = p_opening_instance_id
     AND cc.prep_data ? 'phase2'
     AND cc.superseded_at IS NULL
     AND cc.revoked_at IS NULL
    WHERE cti.template_id = v_template_id
      AND cti.active = TRUE
      AND cti.prep_meta->>'openingPhase2' = 'true'
      -- 0320 (W15/B085): the same Phase 1 universe as the completeness count above.
      AND EXISTS (
        SELECT 1 FROM checklist_completions p1
        WHERE p1.instance_id = p_opening_instance_id
          AND p1.template_item_id = cti.id
          AND p1.prep_data ? 'phase1'
          AND p1.superseded_at IS NULL
          AND p1.revoked_at IS NULL
      )
  LOOP
    -- opener_prepped + reasons come from the phase2 row (only place they exist).
    v_opener_prepped             := NULLIF(v_phase2->>'opener_prepped', '')::numeric;
    v_over_under_reason_category := v_phase2->>'over_under_reason_category';
    v_over_under_reason_text     := v_phase2->>'over_under_reason_text';

    -- [D4] AUTHORITATIVE re-source: prep_need + ground_truth_count + closer_count
    -- are re-read from this item's FROZEN prep_data->phase1 contract — NOT trusted
    -- from the phase2 row (where they were mirrored at save time as UX convenience).
    -- Finalize is the authoritative compute; save-time values are advisory. They
    -- agree by design (same frozen contract, same helper), but finalize never
    -- trusts the written-onto-phase2 copy.
    SELECT cc1.prep_data->'phase1' INTO v_phase1
    FROM checklist_completions cc1
    WHERE cc1.instance_id = p_opening_instance_id
      AND cc1.template_item_id = v_universe_item_id
      AND cc1.prep_data ? 'phase1'
      AND cc1.superseded_at IS NULL
      AND cc1.revoked_at IS NULL
    ORDER BY cc1.completed_at DESC
    LIMIT 1;

    IF v_phase1 IS NULL THEN
      RAISE EXCEPTION 'submit_phase2_atomic: phase1_not_resolved for item % (%) — no live prep_data->phase1 at finalize',
        v_universe_item_id, v_item_label
        USING ERRCODE = 'P0001';
    END IF;

    -- 0215 batch-vs-bottle: a batch row's delta is measured against its LINE need (plan S §2.4).
    v_prep_need          := COALESCE(NULLIF(v_phase2->'batch'->>'need_for_line', '')::numeric, NULLIF(v_phase1->>'prep_need', '')::numeric);
    v_ground_truth_count := NULLIF(v_phase1->>'ground_truth_count', '')::numeric;
    v_closer_count       := NULLIF(v_phase1->>'closer_count', '')::numeric;

    -- Authoritative recompute via the SAME shared helper (guards against drift)
    SELECT delta, over_under_status INTO v_delta, v_over_under_status
    FROM public.opening_phase2_compute_delta(v_opener_prepped, v_prep_need);

    IF v_over_under_status = 'at_par' THEN
      v_at_par_count := v_at_par_count + 1;
    ELSIF v_over_under_status = 'over_prep' THEN
      v_over_prep_count := v_over_prep_count + 1;
    ELSE
      v_under_prep_count := v_under_prep_count + 1;
    END IF;

    v_completion_ids := array_append(v_completion_ids, v_completion_id);

    -- ──── Under-prep notification dispatch (0053:414-485 pattern) ────
    IF v_delta IS NOT NULL AND v_delta < 0 THEN
      v_notif_title := 'Under-par: ' || v_item_label || ' at ' || v_location_code;

      INSERT INTO notifications (
        type, category, priority, title, body, data,
        related_table, related_id, location_id, created_by
      )
      VALUES (
        'under_par_alert', NULL, 'urgent', v_notif_title, NULL,
        jsonb_build_object(
          'titleKey', 'notifications.under_par_alert.title',
          'titleParams', jsonb_build_object('itemName', v_item_label, 'locationCode', v_location_code),
          'bodyKey', 'notifications.under_par_alert.body',
          'bodyParams', jsonb_build_object(
            'openerName', v_actor_name, 'itemName', v_item_label,
            'prepped', v_opener_prepped, 'closer', v_closer_count,
            'reasonCategory', v_over_under_reason_category,
            'freeText', COALESCE(v_over_under_reason_text, ''),
            -- 0255: the par the opener saw (frozen Phase 1 contract); the card's "(par {par}, …)" was blank.
            'par', NULLIF(v_phase1->>'par_value', '')::numeric
          ),
          'itemName', v_item_label,
          'templateItemId', v_universe_item_id::text,
          'completionId', v_completion_id::text,
          'instanceId', p_opening_instance_id::text,
          'openingDate', v_opening_date::text,
          'closerCount', v_closer_count,
          'groundTruthCount', v_ground_truth_count,
          'prepNeed', v_prep_need,
          'openerPrepped', v_opener_prepped,
          'deltaVsPrepNeed', v_delta,
          'overUnderStatus', v_over_under_status,
          'reasonCategory', v_over_under_reason_category,
          'freeText', v_over_under_reason_text
        ),
        'checklist_completions', v_completion_id, v_location_id, p_actor_id
      )
      RETURNING id INTO v_notif_id;

      -- Recipients: KH+ at this location + MoO + Owner DISTINCT (0053:460-482 / 0055:564-575)
      -- 0255 (Juan, 2026-10-15): key holders and up only — trainer and employee dropped;
      -- prep_mgr added (prep alerts are that role's job); social_media_mgr stays off.
      INSERT INTO notification_recipients (notification_id, user_id, delivery_method, delivery_status)
      SELECT v_notif_id, recipients.user_id, 'in_app', 'pending'
      FROM (
        SELECT DISTINCT u.id AS user_id
        FROM users u
        WHERE u.active = TRUE
          AND (
            (u.role IN (
              'cgs', 'owner', 'moo', 'gm', 'agm', 'catering_mgr',
              'prep_mgr', 'shift_lead', 'key_holder'
            )
             AND EXISTS (
               SELECT 1 FROM user_locations ul
               WHERE ul.user_id = u.id AND ul.location_id = v_location_id
             ))
            OR u.role = 'moo'
            OR u.role = 'owner'
          )
      ) recipients;

      v_notif_ids := array_append(v_notif_ids, v_notif_id);
    END IF;
  END LOOP;

  -- ──── Submission row (is_final_confirmation FALSE — Phase 3 is final) ────
  INSERT INTO checklist_submissions (
    instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation
  )
  VALUES (
    p_opening_instance_id, p_actor_id, v_submitted_at, v_completion_ids, FALSE
  )
  RETURNING id INTO v_submission_id;

  -- ──── Status transition (race-safe): phase1_complete → phase2_complete ────
  -- 0066: also stamp finalize provenance (confirmed_at/confirmed_by) so the
  -- dashboard Opening tile + any consumer can show "Finalized at {time} by
  -- {name}", consistent with am-prep + mid-day. Phase 3 (if ever wired) may
  -- re-stamp on final confirmation; phase2_complete is the current terminal.
  UPDATE checklist_instances
  SET status = 'phase2_complete',
      confirmed_at = v_submitted_at,
      confirmed_by = p_actor_id
  WHERE id = p_opening_instance_id
    AND status = 'phase1_complete';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_phase2_atomic: phase2_not_eligible — instance % is not in status=phase1_complete (concurrent submit OR status already past Phase 2)',
      p_opening_instance_id
      USING ERRCODE = 'P0001';
  END IF;

  -- NO opening→closing auto-complete (C.54 §2.A — Phase 3 owns it).

  -- ──── Build result jsonb (mirrors Phase1RpcResult + C.50 counters) ────
  SELECT to_jsonb(ci) INTO v_opening_instance_row
  FROM checklist_instances ci WHERE ci.id = p_opening_instance_id;

  RETURN jsonb_build_object(
    'instance', v_opening_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids),
    'autoCompleteId', NULL,                 -- Phase 2 has no auto-complete target
    'editCount', 0,
    'originalSubmissionId', NULL,
    'underParNotificationIds', to_jsonb(v_notif_ids),
    'atParCount', v_at_par_count,
    'overPrepCount', v_over_prep_count,
    'underPrepCount', v_under_prep_count
  );
END;
$function$;

revoke execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) to service_role;

-- ── VERIFY (in the same transaction) ───────────────────────────────────────────────────────────────────────
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.checklist_lineage_lock_key(uuid)',
    'public.checklist_template_activate_version(uuid,uuid,uuid,boolean,date,jsonb)',
    'public.checklist_instance_lineage_guard()',
    'public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)'
  ] loop
    if not exists (select 1 from pg_proc where oid = to_regprocedure(f) and prosecdef
                    and proconfig @> array['search_path=pg_catalog, public']) then
      raise exception '0320: % must be SECURITY DEFINER with a pinned search_path', f;
    end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0320: EXECUTE escaped on %', f;
    end if;
  end loop;
  if has_function_privilege('service_role', 'public.checklist_lineage_lock_key(uuid)', 'execute') then
    raise exception '0320: checklist_lineage_lock_key must stay owner-only';
  end if;
  if not has_function_privilege('service_role', 'public.checklist_template_activate_version(uuid,uuid,uuid,boolean,date,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)', 'execute') then
    raise exception '0320: service_role lost EXECUTE on the activation RPC or submit_phase2_atomic';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.checklist_instances'::regclass
                  and tgname = 'checklist_instances_lineage_guard' and tgenabled = 'O'
                  and tgfoid = 'public.checklist_instance_lineage_guard()'::regprocedure) then
    raise exception '0320: the lineage guard trigger is not installed and enabled';
  end if;
  if (select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc
       where oid = 'public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)'::regprocedure)
       is distinct from 'b0473d28679e82a7bbfd70b73e0b8f33' then
    raise exception '0320: submit_phase2_atomic is not the 0320 body';
  end if;
  if (select prosrc from pg_proc where oid = 'public.checklist_template_activate_version(uuid,uuid,uuid,boolean,date,jsonb)'::regprocedure)
       !~ 'stale_source' then
    raise exception '0320: the activation RPC lost its stale_source check';
  end if;
end $$;

commit;
