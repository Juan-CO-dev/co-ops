-- Migration 0329_catering_prep_demand_lifecycle
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word).
-- Provenance: audit wave W22 (catering pipeline, kitchen prep demand and surplus) — B122 (two stage changes at
--   once could leave a cancelled order still reserved: reserve's release-then-insert was four separate calls with
--   no lock), B120 (rescheduling a lead left the quote's event date and the reserved prep on the old day), B205
--   (an LTO event committed before its items, so an item failure left a live offer with no items) and B201 (house
--   leads completed by the nightly rollover never left 'reserved'; the data repair below).
--
-- WHAT: five SECURITY DEFINER functions. No table, column, index, policy or grant on a table changes, and applying
--   this file changes NO existing row (the B201 repair is a function CC calls separately, with a manifest).
--
--   reserve_catering_prep_demand(p_pipeline_id, p_quote_id, p_rows, p_actor_id) → jsonb      [service_role]
--     THE reserve writer. Locks the catering_pipeline row FOR UPDATE, then — under that lock — refuses by RESULT
--     (never an exception; each is an expected loser of a race the caller reports):
--       not_confirmed     the lead's stage is no longer 'confirmed' (a concurrent lost/inquiry/quote_sent won)
--       quote_changed     p_quote_id is no longer the lead's live revision (a concurrent revise won)
--       no_event_date     the live revision has no event date (nothing to plan against)
--       already_consumed  the lead already holds CONSUMED demand (never stack a reserved copy on it; the
--                         second half of F5, lib/catering/pipeline-shared.ts)
--     else retires the lead's reserved rows (status 'released', released_at) and inserts p_rows as reserved
--     against the live revision's event date, ALL IN ONE TRANSACTION → {result:'reserved', released, inserted}.
--     Why the lock closes B122: a stage flip (moveStage / systemMoveStage) is an UPDATE of the same row, so it
--     either commits before this lock (then this sees the new stage and writes nothing) or waits for this
--     transaction (then its own release/consume, which runs after its flip, catches the rows inserted here).
--     The rows are resolved in the app (lib/catering/prep-demand.ts resolveQuoteDemand, pure rules); the table's
--     own CHECKs (one ref, qty > 0, portion) judge each one, and one bad row aborts the whole call.
--
--   settle_catering_prep_demand(p_pipeline_id, p_to) → jsonb                                   [service_role]
--     THE release / consume writer (fix round 1: the reverse order of B122). Locks the catering_pipeline row FOR
--     UPDATE, then settles the lead's reserved rows to p_to ('consumed' / 'released', with consumed_at /
--     released_at) ONLY while the lead's CURRENT stage settles that way — consumed: out, completed; released:
--     lost, inquiry, quote_sent. Any other stage → {result:'stage_changed', stage}, nothing written. The race it
--     closes: manager A moves confirmed → quote_sent and stalls before the release; manager B re-confirms and
--     reserve_catering_prep_demand inserts a fresh set; A's release resumes. The old UPDATE checked only
--     pipeline_id + status and released B's fresh rows (the confirmed order left kitchen demand); now A's settle
--     sees 'confirmed' under the lock and writes nothing. With a stage flip committed first, the settle sees it;
--     with the settle holding the lock, the flip (an UPDATE of the same row) waits, and its own settle / reserve
--     runs after it. → {result: p_to, rows}. Refusals (raise exception): settle_invalid_target ·
--     settle_lead_not_found.
--
--   reschedule_catering_lead(p_lead_id, p_event_date, p_actor_id) → jsonb                     [service_role]
--     Locks the lead FOR UPDATE, then: the lead's event_date → p_event_date; the LIVE quote revision's event_date
--     → p_event_date (superseded revisions are history and stay as they were); every reserved prep row on another
--     day is retired and re-appended on the new day with the same refs and quantities (the transfer_catering_lead
--     copy, 0225 — package picks are kept, nothing is re-resolved, the ledger stays append-only); and, when the
--     lead's date moved, one catering_pipeline_events row (from = to = the stage, "Rescheduled: <old> -> <new>").
--     Idempotent and self-healing: each step touches only what differs, so re-saving a date repairs a lead whose
--     quote or prep had drifted. → {result:'moved'|'unchanged', from_date, to_date, quote_updated, prep_rows_moved,
--     event_id}. event_id = the reschedule's catering_pipeline_events row (null when the date did not move): the
--     persisted occurrence the customer's order-update email is keyed by (fix round 1), so two reschedules with the
--     same date pair (Fri → Tue → Fri → Tue) never share an email idempotency key.
--     Refusals (raise exception): reschedule_invalid_date (null date) · reschedule_lead_not_found.
--
--   create_lto_event(p_actor_id, p_event, p_items) → uuid                                       [service_role]
--     The event and its items in ONE transaction: an FK / type / CHECK failure on any item rolls the event back
--     too. Re-checks in SQL: the actor is an active user at level >= 6 (public.user_admin_role_level, 0279 — the
--     twin of lib/roles.ts) and the shop is active. The lib keeps every validation and the location bind before
--     any I/O. Refusals: lto_forbidden · lto_location_not_found · lto_invalid_event · lto_no_items.
--
--   catering_prep_demand_backfill_stale(p_expect_consume, p_expect_release) → jsonb    [NO API role: owner only]
--     B201's one-off DATA REPAIR, deliberately NOT run by this migration. Reserved rows whose lead already sits in
--     'out'/'completed' become 'consumed' (consumed_at = the time the lead's events ledger says it went out or
--     completed, else now); reserved rows whose lead sits in 'lost'/'inquiry'/'quote_sent' become 'released'
--     (released_at likewise from the ledger). Both counts must equal the manifest (else 'backfill_manifest_drift',
--     nothing written). One audit row per kind (catering.prep_demand.consume / .release, actor_context
--     'migration_apply', destructive false). Run it LAST, after the W22 code (which keeps new rows from going
--     stale) is live, as the database owner:
--       pre-flight (record both numbers in the PR / apply log):
--         select count(*) filter (where p.stage in ('out','completed')) as consume,
--                count(*) filter (where p.stage in ('lost','inquiry','quote_sent')) as release
--           from public.catering_prep_demand d join public.catering_pipeline p on p.id = d.pipeline_id
--          where d.status = 'reserved';
--       then: select public.catering_prep_demand_backfill_stale(<consume>, <release>);
--     A second call with the same numbers refuses (the rows are no longer reserved); (0, 0) is a no-op.
--     Expect the digest's and W4b SKU-demand's reserved totals to drop by exactly the repaired rows.
--
-- LOCK ORDER: the catering_pipeline row only, then rows under it (quotes, prep demand — the 0225 insert trigger
--   bind_catering_insert_location takes the same lead row FOR UPDATE in the same transaction, which is safe). No
--   advisory lock, so these never invert against apply_ezcater_order / transfer_catering_lead (advisory → lead).
--
-- PRIVILEGES: the four writers execute for service_role ONLY (revoked from public, anon, authenticated; asserted).
--   The backfill executes for no API role at all (revoked from service_role too; asserted). No table grant changes.
--
-- APP COMPATIBILITY: lib/catering/prep-demand.ts, lib/catering/pipeline.ts and lib/catering/lto.ts call these
--   functions first and, when the function does not exist yet (PGRST202 / 42883), run their previous path (for
--   the LTO create, the previous path plus the same steps done one call at a time). The RESCHEDULE has no
--   fallback (fix round 2): without this file a lead's date change is refused 503 reschedule_unavailable with
--   nothing written, because a half-done multi-step move could not be repaired by retrying. APPLY THIS FILE
--   BEFORE THE W22 DEPLOY; until it is applied B122 (both orders) and B205 remain open and dates cannot move.
--
-- DEPENDS ON: 0108 (catering_pipeline), 0110 + 0191 (catering_pipeline_events, the 'out' stage), 0120
--   (catering_quotes), 0137 + 0140 (catering_prep_demand, released_at), 0141 (lto_events, lto_event_items), 0225
--   (bind_catering_insert_location), 0279 (user_admin_role_level), audit_log.
--
-- PROOF: scripts/sql-harness-0329.mjs (PGlite, the real parent DDL + this file, synthetic rows), CI-pinned by
--   tests/catering-prep-demand-lifecycle-migration.test.ts. The two-session races (a stage flip or a reschedule while
--   reserve or settle holds the lead lock, and the reverse) are the Management-API proof sim-0329-lock-check-management.mjs in
--   CC's audit folder — sim only (its guard refuses the production ref by name), run by CC, never by the builder.
--
-- ROLLBACK: drop the five functions; the app falls back to its previous paths by itself.
begin;

do $$
declare v_col text; v_missing text[] := '{}';
begin
  if to_regprocedure('public.reserve_catering_prep_demand(uuid,uuid,jsonb,uuid)') is not null
     or to_regprocedure('public.settle_catering_prep_demand(uuid,text)') is not null
     or to_regprocedure('public.reschedule_catering_lead(uuid,date,uuid)') is not null
     or to_regprocedure('public.create_lto_event(uuid,jsonb,jsonb)') is not null
     or to_regprocedure('public.catering_prep_demand_backfill_stale(integer,integer)') is not null then
    raise exception '0329: already applied';
  end if;
  foreach v_col in array array['id','pipeline_id','quote_id','location_id','need_date','item_id','menu_item_id',
      'choice_package_item_id','portion','qty','status','created_at','created_by','consumed_at','released_at'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_prep_demand' and column_name = v_col) then
      v_missing := v_missing || ('catering_prep_demand.' || v_col);
    end if;
  end loop;
  foreach v_col in array array['id','stage','event_date','location_id','updated_at'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_pipeline' and column_name = v_col) then
      v_missing := v_missing || ('catering_pipeline.' || v_col);
    end if;
  end loop;
  foreach v_col in array array['id','pipeline_id','event_date','superseded_at','created_at'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_quotes' and column_name = v_col) then
      v_missing := v_missing || ('catering_quotes.' || v_col);
    end if;
  end loop;
  foreach v_col in array array['pipeline_id','from_stage','to_stage','note','actor_id','created_at'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_pipeline_events' and column_name = v_col) then
      v_missing := v_missing || ('catering_pipeline_events.' || v_col);
    end if;
  end loop;
  foreach v_col in array array['id','location_id','kind','name','discount_bps','promo_price_cents','starts_on','ends_on',
      'status','note','created_by'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lto_events' and column_name = v_col) then
      v_missing := v_missing || ('lto_events.' || v_col);
    end if;
  end loop;
  foreach v_col in array array['event_id','item_id','menu_item_id','name_snapshot','qty','source_pipeline_id'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lto_event_items' and column_name = v_col) then
      v_missing := v_missing || ('lto_event_items.' || v_col);
    end if;
  end loop;
  foreach v_col in array array['actor_id','actor_role','action','resource_table','resource_id','destructive','metadata'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_log' and column_name = v_col) then
      v_missing := v_missing || ('audit_log.' || v_col);
    end if;
  end loop;
  if cardinality(v_missing) > 0 then raise exception '0329: missing columns %', v_missing; end if;
  if to_regprocedure('public.user_admin_role_level(text)') is null then
    raise exception '0329: missing public.user_admin_role_level(text) (0279)';
  end if;
  if to_regprocedure('public.bind_catering_insert_location()') is null then
    raise exception '0329: missing public.bind_catering_insert_location() (0225)';
  end if;
end $$;

-- ── B122: THE reserve writer ─────────────────────────────────────────────────────────────────────────────
create function public.reserve_catering_prep_demand(p_pipeline_id uuid, p_quote_id uuid, p_rows jsonb, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_lead public.catering_pipeline%rowtype; v_quote record; v_released integer := 0; v_inserted integer := 0;
begin
  if p_pipeline_id is null or p_quote_id is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'reserve_invalid_rows';
  end if;
  select * into v_lead from public.catering_pipeline where id = p_pipeline_id for update;   -- THE lock
  if not found then raise exception 'reserve_lead_not_found'; end if;
  if v_lead.stage is distinct from 'confirmed' then
    return jsonb_build_object('result', 'not_confirmed', 'stage', v_lead.stage);
  end if;
  select id, event_date into v_quote from public.catering_quotes
   where pipeline_id = p_pipeline_id and superseded_at is null order by created_at desc limit 1;
  if v_quote.id is distinct from p_quote_id then return jsonb_build_object('result', 'quote_changed'); end if;
  if v_quote.event_date is null then return jsonb_build_object('result', 'no_event_date'); end if;
  if exists (select 1 from public.catering_prep_demand where pipeline_id = p_pipeline_id and status = 'consumed') then
    return jsonb_build_object('result', 'already_consumed');
  end if;
  update public.catering_prep_demand set status = 'released', released_at = clock_timestamp()
   where pipeline_id = p_pipeline_id and status = 'reserved';
  get diagnostics v_released = row_count;
  insert into public.catering_prep_demand (pipeline_id, quote_id, location_id, need_date, item_id, menu_item_id,
      choice_package_item_id, portion, qty, status, created_by)
  select p_pipeline_id, v_quote.id, v_lead.location_id, v_quote.event_date, r.item_id, r.menu_item_id,
         r.choice_package_item_id, r.portion, r.qty, 'reserved', p_actor_id
    from jsonb_to_recordset(p_rows) as r(item_id uuid, menu_item_id uuid, choice_package_item_id uuid, portion text, qty numeric);
  get diagnostics v_inserted = row_count;
  return jsonb_build_object('result', 'reserved', 'released', v_released, 'inserted', v_inserted, 'quote_id', v_quote.id);
end $$;

-- ── B122, the reverse order: THE release / consume writer ───────────────────────────────────────────────
create function public.settle_catering_prep_demand(p_pipeline_id uuid, p_to text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_lead public.catering_pipeline%rowtype; v_rows integer := 0;
begin
  if p_pipeline_id is null or p_to is null or p_to not in ('consumed', 'released') then
    raise exception 'settle_invalid_target';
  end if;
  select * into v_lead from public.catering_pipeline where id = p_pipeline_id for update;   -- THE lock
  if not found then raise exception 'settle_lead_not_found'; end if;
  -- The stage that won owns the ledger: settle only while the CURRENT stage settles this way.
  if not ((p_to = 'consumed' and coalesce(v_lead.stage, '') in ('out', 'completed'))
       or (p_to = 'released' and coalesce(v_lead.stage, '') in ('lost', 'inquiry', 'quote_sent'))) then
    return jsonb_build_object('result', 'stage_changed', 'stage', v_lead.stage);
  end if;
  if p_to = 'consumed' then
    update public.catering_prep_demand set status = 'consumed', consumed_at = clock_timestamp()
     where pipeline_id = p_pipeline_id and status = 'reserved';
  else
    update public.catering_prep_demand set status = 'released', released_at = clock_timestamp()
     where pipeline_id = p_pipeline_id and status = 'reserved';
  end if;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('result', p_to, 'rows', v_rows);
end $$;

-- ── B120: the reschedule ─────────────────────────────────────────────────────────────────────────────────
create function public.reschedule_catering_lead(p_lead_id uuid, p_event_date date, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_lead public.catering_pipeline%rowtype; v_quotes integer := 0; v_moved integer := 0; v_event_id uuid;
begin
  if p_event_date is null then raise exception 'reschedule_invalid_date'; end if;
  select * into v_lead from public.catering_pipeline where id = p_lead_id for update;          -- the lead first
  if not found then raise exception 'reschedule_lead_not_found'; end if;

  if v_lead.event_date is distinct from p_event_date then
    update public.catering_pipeline set event_date = p_event_date, updated_at = clock_timestamp() where id = p_lead_id;
  end if;
  -- The LIVE revision only: superseded revisions are history.
  update public.catering_quotes set event_date = p_event_date
   where pipeline_id = p_lead_id and superseded_at is null and event_date is distinct from p_event_date;
  get diagnostics v_quotes = row_count;
  -- Retire and re-append reserved obligations on the new day (0225's transfer copy): refs, picks and
  -- quantities are carried, never re-resolved; consumed and released rows stay historical.
  with retired as (
    update public.catering_prep_demand set status = 'released', released_at = clock_timestamp()
     where pipeline_id = p_lead_id and status = 'reserved' and need_date is distinct from p_event_date
     returning *
  ) insert into public.catering_prep_demand (pipeline_id, quote_id, location_id, need_date, item_id, menu_item_id,
      choice_package_item_id, portion, qty, status, created_by)
    select pipeline_id, quote_id, location_id, p_event_date, item_id, menu_item_id, choice_package_item_id, portion, qty,
           'reserved', p_actor_id
      from retired;
  get diagnostics v_moved = row_count;

  if v_lead.event_date is distinct from p_event_date then
    insert into public.catering_pipeline_events (pipeline_id, from_stage, to_stage, note, actor_id)
    values (p_lead_id, v_lead.stage, v_lead.stage,
            'Rescheduled: ' || coalesce(v_lead.event_date::text, 'no date') || ' -> ' || p_event_date::text, p_actor_id)
    returning id into v_event_id;
  end if;

  return jsonb_build_object(
    'result', case when v_lead.event_date is distinct from p_event_date or v_quotes > 0 or v_moved > 0 then 'moved' else 'unchanged' end,
    'from_date', v_lead.event_date, 'to_date', p_event_date, 'quote_updated', v_quotes > 0, 'prep_rows_moved', v_moved,
    'event_id', v_event_id);
end $$;

-- ── B205: an LTO event and its items, together ───────────────────────────────────────────────────────────
create function public.create_lto_event(p_actor_id uuid, p_event jsonb, p_items jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text; v_location uuid; v_id uuid; v_n integer := 0;
begin
  select role into v_role from public.users where id = p_actor_id and active;
  if v_role is null or coalesce(public.user_admin_role_level(v_role), 0) < 6 then raise exception 'lto_forbidden'; end if;
  if p_event is null or jsonb_typeof(p_event) <> 'object' then raise exception 'lto_invalid_event'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'lto_no_items'; end if;
  select id into v_location from public.locations where id = (p_event->>'location_id')::uuid and active;
  if v_location is null then raise exception 'lto_location_not_found'; end if;

  insert into public.lto_events (location_id, kind, name, discount_bps, promo_price_cents, starts_on, ends_on, status, note, created_by)
  values (v_location, p_event->>'kind', p_event->>'name', (p_event->>'discount_bps')::integer,
          (p_event->>'promo_price_cents')::integer, (p_event->>'starts_on')::date, (p_event->>'ends_on')::date,
          'active', nullif(btrim(p_event->>'note'), ''), p_actor_id)
  returning id into v_id;

  insert into public.lto_event_items (event_id, item_id, menu_item_id, name_snapshot, qty, source_pipeline_id)
  select v_id, r.item_id, r.menu_item_id, r.name_snapshot, r.qty, r.source_pipeline_id
    from jsonb_to_recordset(p_items) as r(item_id uuid, menu_item_id uuid, name_snapshot text, qty numeric, source_pipeline_id uuid);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'lto_no_items'; end if;
  return v_id;
end $$;

-- ── B201: the one-off stale-reserved repair (owner only; CC calls it with the pre-flight manifest) ─────────
create function public.catering_prep_demand_backfill_stale(p_expect_consume integer, p_expect_release integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_consume integer; v_release integer;
begin
  if p_expect_consume is null or p_expect_release is null then raise exception 'backfill_manifest_required'; end if;
  -- The leads first, in id order (the lock order every writer of these rows takes), so a concurrent stage
  -- move waits for this repair or is seen by it.
  perform 1 from public.catering_pipeline p
   where exists (select 1 from public.catering_prep_demand d where d.pipeline_id = p.id and d.status = 'reserved')
     and p.stage in ('out','completed','lost','inquiry','quote_sent')
   order by p.id for update;
  select count(*) filter (where p.stage in ('out','completed')), count(*) filter (where p.stage in ('lost','inquiry','quote_sent'))
    into v_consume, v_release
    from public.catering_prep_demand d join public.catering_pipeline p on p.id = d.pipeline_id
   where d.status = 'reserved';
  if v_consume <> p_expect_consume or v_release <> p_expect_release then
    raise exception 'backfill_manifest_drift: consume % (expected %), release % (expected %)', v_consume, p_expect_consume, v_release, p_expect_release;
  end if;

  update public.catering_prep_demand d set status = 'consumed',
         consumed_at = coalesce((select max(e.created_at) from public.catering_pipeline_events e
                                  where e.pipeline_id = d.pipeline_id and e.to_stage in ('out','completed')), clock_timestamp())
    from public.catering_pipeline p
   where p.id = d.pipeline_id and d.status = 'reserved' and p.stage in ('out','completed');
  update public.catering_prep_demand d set status = 'released',
         released_at = coalesce((select max(e.created_at) from public.catering_pipeline_events e
                                  where e.pipeline_id = d.pipeline_id and e.to_stage = p.stage), clock_timestamp())
    from public.catering_pipeline p
   where p.id = d.pipeline_id and d.status = 'reserved' and p.stage in ('lost','inquiry','quote_sent');

  if v_consume > 0 then
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
    values (null, null, 'catering.prep_demand.consume', 'catering_prep_demand', null, false,
            jsonb_build_object('actor_context', 'migration_apply', 'migration', '0329', 'backfill', 'stale_reserved_after_stage_move', 'rows', v_consume));
  end if;
  if v_release > 0 then
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
    values (null, null, 'catering.prep_demand.release', 'catering_prep_demand', null, false,
            jsonb_build_object('actor_context', 'migration_apply', 'migration', '0329', 'backfill', 'stale_reserved_after_stage_move', 'rows', v_release));
  end if;
  return jsonb_build_object('consumed', v_consume, 'released', v_release);
end $$;

-- Privileges: service_role executes the four writers; NO API role executes the backfill.
do $$ declare f regprocedure; begin
  foreach f in array array[
    'public.reserve_catering_prep_demand(uuid,uuid,jsonb,uuid)'::regprocedure,
    'public.settle_catering_prep_demand(uuid,text)'::regprocedure,
    'public.reschedule_catering_lead(uuid,date,uuid)'::regprocedure,
    'public.create_lto_event(uuid,jsonb,jsonb)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
    assert not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE')
       and has_function_privilege('service_role', f, 'EXECUTE'), '0329: writer privilege escape';
    assert not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = f and a.grantee = 0), '0329: PUBLIC writer escape';
  end loop;
  f := 'public.catering_prep_demand_backfill_stale(integer,integer)'::regprocedure;
  execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  assert not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE')
     and not has_function_privilege('service_role', f, 'EXECUTE'), '0329: backfill privilege escape';
  assert not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = f and a.grantee = 0), '0329: PUBLIC backfill escape';
end $$;

commit;
