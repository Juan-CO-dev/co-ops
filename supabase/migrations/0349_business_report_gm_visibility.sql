-- Migration 0349_business_report_gm_visibility
-- AUTHORED 2026-11-19 (business report access, CO Claude unit lead, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- NUMBER: 0347 is the highest on main; 0348 is claimed by the portal45 unit (.mig-claims), so this file takes 0349.
-- Apply AFTER 0341 (the business report's reads). Order against 0348 does not matter (no shared object).
-- Plan: CHIEF 03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-09-BUSINESS-REPORT-ACCESS-PLAN-r6.md
--   (r5 = Astra APPROVE; r6 = r5 amended by Juan's ruling below).
-- Juan 2026-11-19: "the business report should be GM+, with MoO+ seeing the full all shops business report and GMs
--   get their per shop business report. MoO+ should be able to switch on or off the things the GMs can see."
-- Juan 2026-11-19, RULING (amends this file before prod ever saw it): "the GMs at each shop are doing the hiring and
--   onboarding. So they inherently know and see the pay of everyone at the shop." So each person's HOURLY cost and
--   labor dollars per 15 minutes are switches (ON by default); a SALARY per person is its own switch (OFF by
--   default: a shop's payroll can carry an owner's or a director's salary).
--
-- AMENDED 2026-11-19 (nine switches -> twelve). PROD never had the nine-switch file: apply this one as written.
-- SIM had it (schema_migrations version 20261119230203, table empty). SIM RE-APPLY, in ONE transaction, only while
--   the table holds no row (a row would be a record of who changed what; then write a follow-up migration instead):
--     begin;
--     do $$ begin if (select count(*) from public.business_report_gm_visibility) <> 0 then raise exception 'rows exist'; end if; end $$;
--     drop function public.save_business_report_gm_visibility(uuid, jsonb, uuid);
--     drop table public.business_report_gm_visibility;
--     drop function public.business_report_gm_visibility_defaults();
--     drop function public.valid_business_report_gm_visibility(jsonb);
--     delete from supabase_migrations.schema_migrations where version = '20261119230203' and name = '0349_business_report_gm_visibility';
--     commit;
--   then apply this file and record it under a new version (scripted: SCRATCH/br-access-0349/reapply-0349-sim.mjs --drop,
--   which also refuses on an audit row or on any other recorded file, then apply-0349-sim.mjs --dry-run / --apply / --behaviour).
--
-- WHAT THIS IS. One company-wide, append-only setting: what a GM may see in the business report.
--   business_report_gm_visibility                the rows. The NEWEST (greatest seq) is in force from the moment it is
--                                                saved; no row = the defaults. Nothing is ever updated or deleted.
--   valid_business_report_gm_visibility(jsonb)   the row's shape: EXACTLY twelve keys, each a JSON boolean, and no switch
--                                                ON under a switch it needs that is OFF. Total: any input answers
--                                                true or false, never raises. TS twin: parseGmVisibility
--                                                (lib/business-access-shared.ts), pinned equal case by case.
--   business_report_gm_visibility_defaults()     the settings in force with no row (TS twin GM_VISIBILITY_DEFAULTS).
--   save_business_report_gm_visibility(p_actor, p_settings, p_expected_id)   THE one writer.
--     - Owner / CGS / MoO, active, re-checked on the locked users row: else business_visibility_forbidden.
--     - the validator: else business_visibility_invalid.
--     - one advisory lock, then p_expected_id = the newest row the person saw (NULL = none yet): another save in
--       between is business_visibility_moved, never a silent overwrite.
--     - the same settings as are in force (the newest row's, or the defaults with no row): business_visibility_unchanged.
--     - ONE destructive business_report_visibility.save audit row in the same transaction: the settings in force
--       before, the new ones, and which switches went on / off. No free text exists to enter it.
--
-- THE TWELVE SWITCHES (needs):
--   report (-), hourly_cost (report), loaded (hourly_cost), quarters (report), quarter_cost (quarters, hourly_cost),
--   channels (report), people (report), person_cost (people, hourly_cost), person_salary (people, loaded),
--   servers (report), compare (report), export (report).
--   Defaults: everything ON except the salaried side: `loaded` (salaries, burden, fully loaded labor) and
--   `person_salary` (a salaried amount per person; the report lists none today, the switch is held for the day it does).
--   person_cost = each HOURLY person's labor cost; quarter_cost = labor dollars and % per 15 minutes.
--
-- WHO READS IT. Only the business report's loader, and only for a GM (MoO / Owner / CGS get everything and never read
--   it). A database without this migration answers a GM "not available" (never the defaults over a store that could
--   not be read). The table is SELECT-only for service_role; nothing else holds any privilege.
--
-- ROLLOUT: apply (sim, then prod) BEFORE or WITH turning BUSINESS_REPORT=1 on. Safe before the deploy: nothing reads
--   or writes these objects until the business report access code is serving. It writes no row.
-- PRE-FLIGHT (MCP, before apply):
--   select to_regprocedure('public.business_report_check_cuts(uuid,date,date)');   -- present (0341)
--   select to_regclass('public.business_report_gm_visibility');                    -- null
-- VERIFY AFTER APPLY:
--   select count(*) from public.business_report_gm_visibility;                                                -- 0
--   select public.valid_business_report_gm_visibility(public.business_report_gm_visibility_defaults());       -- true
--   select has_table_privilege('service_role', 'public.business_report_gm_visibility', 'INSERT');             -- false
--   select relrowsecurity from pg_class where oid = 'public.business_report_gm_visibility'::regclass;         -- true
-- ROLLBACK: revert the application first (a GM then reads "not available" only if the table is dropped; leave the
--   table and its rows in place: they are the record of who changed what GMs could see).
begin;

do $$ begin
  if to_regprocedure('public.business_report_check_cuts(uuid,date,date)') is null then raise exception '0349: apply 0341 first'; end if;
  if to_regclass('public.business_report_gm_visibility') is not null
     or to_regprocedure('public.save_business_report_gm_visibility(uuid,jsonb,uuid)') is not null then raise exception '0349: already applied'; end if;
  if to_regclass('public.users') is null or to_regclass('public.audit_log') is null then raise exception '0349: users and audit_log are required'; end if;
end $$;

-- ── The shape of a row ───────────────────────────────────────────────────────────────────────────
create function public.valid_business_report_gm_visibility(p jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
declare k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  -- jsonb keys are unique: twelve keys, and each of the twelve present as a boolean, is EXACTLY the twelve.
  if (select count(*) from jsonb_object_keys(p)) <> 12 then return false; end if;
  foreach k in array array['report', 'hourly_cost', 'loaded', 'quarters', 'quarter_cost', 'channels', 'people', 'person_cost', 'person_salary', 'servers', 'compare', 'export'] loop
    if jsonb_typeof(p -> k) is distinct from 'boolean' then return false; end if;
  end loop;
  -- No switch ON under a switch it needs that is OFF (TS twin GM_VISIBILITY_NEEDS, pinned edge for edge).
  if exists (
    select 1 from (values ('hourly_cost', 'report'), ('loaded', 'hourly_cost'), ('quarters', 'report'), ('quarter_cost', 'quarters'),
      ('quarter_cost', 'hourly_cost'), ('channels', 'report'), ('people', 'report'), ('person_cost', 'people'), ('person_cost', 'hourly_cost'),
      ('person_salary', 'people'), ('person_salary', 'loaded'), ('servers', 'report'), ('compare', 'report'), ('export', 'report')) as n(child, parent)
    where (p ->> n.child)::boolean and not (p ->> n.parent)::boolean) then return false; end if;
  return true;
end $$;

create function public.business_report_gm_visibility_defaults() returns jsonb
language sql immutable set search_path = pg_catalog, public as $$
  select jsonb_build_object('report', true, 'hourly_cost', true, 'loaded', false, 'quarters', true, 'quarter_cost', true, 'channels', true,
    'people', true, 'person_cost', true, 'person_salary', false, 'servers', true, 'compare', true, 'export', true)
$$;

-- ── The rows (append-only; the greatest seq is in force) ─────────────────────────────────────────
create table public.business_report_gm_visibility (
  id          uuid        primary key default gen_random_uuid(),
  seq         bigserial   not null unique,
  settings    jsonb       not null check (public.valid_business_report_gm_visibility(settings)),
  created_by  uuid        not null references public.users(id),
  created_at  timestamptz not null default clock_timestamp()
);

-- ── THE one writer ───────────────────────────────────────────────────────────────────────────────
create function public.save_business_report_gm_visibility(p_actor uuid, p_settings jsonb, p_expected_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text; v_head uuid; v_before jsonb; v_first boolean; v_id uuid; v_on jsonb; v_off jsonb;
begin
  if p_actor is not null then
    select u.role into v_role from public.users u where u.id = p_actor and u.active and u.role in ('owner', 'cgs', 'moo') for share;
  end if;
  if v_role is null then raise exception 'business_visibility_forbidden'; end if;
  if not coalesce(public.valid_business_report_gm_visibility(p_settings), false) then raise exception 'business_visibility_invalid'; end if;
  -- Saves queue, so each audit row's "before" is what the previous save left, and the expected head is judged
  -- against what is really there.
  perform pg_advisory_xact_lock(hashtextextended('business_report_gm_visibility', 0));
  select s.id, s.settings into v_head, v_before from public.business_report_gm_visibility s order by s.seq desc limit 1;
  if v_head is distinct from p_expected_id then raise exception 'business_visibility_moved'; end if;
  v_first := v_head is null;
  if v_first then v_before := public.business_report_gm_visibility_defaults(); end if;
  if v_before = p_settings then raise exception 'business_visibility_unchanged'; end if;
  insert into public.business_report_gm_visibility (settings, created_by) values (p_settings, p_actor) returning id into v_id;
  select coalesce(jsonb_agg(k.key order by k.ord) filter (where (p_settings ->> k.key)::boolean and not (v_before ->> k.key)::boolean), '[]'::jsonb),
         coalesce(jsonb_agg(k.key order by k.ord) filter (where not (p_settings ->> k.key)::boolean and (v_before ->> k.key)::boolean), '[]'::jsonb)
    into v_on, v_off
    from unnest(array['report', 'hourly_cost', 'loaded', 'quarters', 'quarter_cost', 'channels', 'people', 'person_cost', 'person_salary', 'servers', 'compare', 'export']) with ordinality as k(key, ord);
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, before_state, after_state, metadata, destructive)
  values (p_actor, v_role, 'business_report_visibility.save', 'business_report_gm_visibility', v_id, v_before, p_settings,
    jsonb_build_object('turned_on', v_on, 'turned_off', v_off, 'first_save', v_first), true);
  return v_id;
end $$;

-- ── CEILINGS: deny-all RLS, service_role SELECT only; the writer service_role only ───────────────
alter table public.business_report_gm_visibility enable row level security;
create policy business_report_gm_visibility_no_user_select on public.business_report_gm_visibility for select using (false);
create policy business_report_gm_visibility_no_user_insert on public.business_report_gm_visibility for insert with check (false);
create policy business_report_gm_visibility_no_user_update on public.business_report_gm_visibility for update using (false);
create policy business_report_gm_visibility_no_user_delete on public.business_report_gm_visibility for delete using (false);
revoke all on public.business_report_gm_visibility from public, anon, authenticated, service_role;
grant select on public.business_report_gm_visibility to service_role;
revoke all on sequence public.business_report_gm_visibility_seq_seq from public, anon, authenticated, service_role;
revoke all on function public.valid_business_report_gm_visibility(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.business_report_gm_visibility_defaults() from public, anon, authenticated, service_role;
revoke all on function public.save_business_report_gm_visibility(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.save_business_report_gm_visibility(uuid, jsonb, uuid) to service_role;

do $$ declare p text; f regprocedure; begin
  if not has_table_privilege('service_role', 'public.business_report_gm_visibility', 'SELECT') then raise exception '0349: service_role lacks SELECT'; end if;
  foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('service_role', 'public.business_report_gm_visibility', p) then raise exception '0349: service_role holds %', p; end if;
  end loop;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.business_report_gm_visibility', p) or has_table_privilege('authenticated', 'public.business_report_gm_visibility', p) then
      raise exception '0349: a PostgREST role holds %', p; end if;
  end loop;
  foreach f in array array['public.valid_business_report_gm_visibility(jsonb)'::regprocedure, 'public.business_report_gm_visibility_defaults()'::regprocedure] loop
    if has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists (select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0349: internal function escape %', f; end if;
  end loop;
  f := 'public.save_business_report_gm_visibility(uuid,jsonb,uuid)'::regprocedure;
  if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
    or exists (select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
    raise exception '0349: RPC escape %', f; end if;
  if has_sequence_privilege('service_role', 'public.business_report_gm_visibility_seq_seq', 'USAGE')
    or has_sequence_privilege('anon', 'public.business_report_gm_visibility_seq_seq', 'USAGE')
    or has_sequence_privilege('authenticated', 'public.business_report_gm_visibility_seq_seq', 'USAGE') then raise exception '0349: sequence escape'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.business_report_gm_visibility'::regclass) then raise exception '0349: RLS is off'; end if;
end $$;

notify pgrst, 'reload schema';
commit;
