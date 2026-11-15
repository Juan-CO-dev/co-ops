-- Migration 0312_customer_consent_retention_fixes
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0234, 0249 and 0300).
-- Provenance: bug-audit wave W12 "Customer profiles, consent and the marketing file" (found at 7494f738).
--   Bugs B070, B071, B173, B174 (owner decision W12-4 b), B176 (owner decision W12-5 b), B177.
--   B069 and B175 are TypeScript only (same PR) and need nothing here.
--
-- WHAT (every re-emit starts from the LATEST body: 0234, 0249 for customer_list_rows, 0300 for
-- customer_consent_record_explicit; each change is marked "W12/Bnnn" inline):
--   1. B071 — the consent tie rule. customer_consent_current (view) and customer_consent_latest (private
--      helper) order ties on effective_at as: a NON-IMPORT opt-out first (delete request, retention, a
--      Toast order / portal opt-out still wins every tie), then the NEWER IMPORT (by the import's
--      created_at), then — inside one import — an opt-out, then recorded_at, id. Before, any opt-out won
--      a tie, so a corrected Toast list re-imported with the SAME export date as a partial one could not
--      undo the partial file's absence opt-outs, while its summary reported those people as new opt-ins.
--      Same columns, same order: every reader keeps working. lib/customers/consent-shared.ts latestConsent
--      is the TS twin. No stored row changes; people already in that state read opted_in after apply
--      (count them first with pre-apply query (a) in the PR).
--   2. B173 — one person with two listed addresses. customer_consent_import_members gains
--      listed_subjects (the opted-in addresses this import listed for the person) and subject_deferred.
--      The chunk no longer writes a new opt-in event when the person is ALREADY opted in at another of
--      their own addresses (or this import already opted them in): it counts the row unchanged and
--      defers. Finish then keeps the address in use while it is still listed, and moves the subject to a
--      still-listed address (deterministic: the smallest hash) only when the one in use left the list —
--      never mailing an address that left. customer_newly_opted_in no longer reports a person whose
--      previous status was already opted_in (an address change is not a sign-up).
--   3. B174 (owner decision W12-4 b) — retention never suppresses. customer_erase writes suppression rows
--      only for a delete request; every reader (customer_resolve, customer_marketing_export,
--      customer_consent_record_explicit) honours only reason = 'delete_request' rows, so a person erased
--      for 36 months of inactivity can come back and start over as a NEW customer (their old history
--      stays erased; 0249's "an erased order cannot recreate a profile" still holds). The unique key
--      becomes (kind, value_sha256, reason) so a later delete request for a hash with an old retention
--      row is still recorded. No row is updated or deleted. Existing retention rows stop blocking: the
--      pre-flight REPORTS their count and REFUSES unless the applier acknowledges that exact count (see
--      the pre-flight) — the unblock is never applied silently.
--   4. B070 — customer_retention_sweep takes customer_identity_lock() BEFORE reading candidates, and
--      re-checks each candidate on a fresh snapshot right before erasing it (an import finish completes
--      consent without that lock). Returns { erased, skipped }; the app loops on erased + skipped.
--   5. B176 (owner decision W12-5 b) — voided / deleted Toast orders. customer_orders.voided_at (null =
--      live) is set and cleared by customer_orders_sync_voided(location, business date), which reads the
--      latest pointer's snapshot; capture calls it after every customer ingest of a shop-day. Backfilled
--      here. customer_list_rows counts visits, spend, average order and catering orders over live orders
--      only (dates fall back to all orders when none is live). Voided orders stay in the profile's
--      history, labelled "voided" by the app, and never count toward spend.
--   6. B177 — customer_merge_suggestions_open(shops, limit): the GM's shop filter (assertInScope's rule:
--      both sides have an order at one of the shops, themselves or anyone merged into them) runs BEFORE
--      the 50-row limit.
--
-- Grants follow 0234/0249 ("CREATE OR REPLACE never implies a safe ACL"); the closing block asserts no
-- escape. Proof: scripts/sql-harness-0312.mjs (PGlite, offline, single session; pinned by
-- tests/customer-w12-migration.test.ts). The B070 lock race needs two sessions:
-- scripts/sim/customers-0312-retention-lock-check-management.mjs, sim only, run by CC.
begin;

-- ───────────────────────────── pre-flight: refuse drift before any DDL ─────────────────────────────
do $$
declare v_sig text; v_retention bigint; v_ack text;
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='customer_orders' and column_name='voided_at')
     or exists(select 1 from information_schema.columns where table_schema='public' and table_name='customer_consent_import_members' and column_name='listed_subjects')
     or to_regprocedure('public.customer_merge_suggestions_open(uuid[],integer)') is not null
     or to_regprocedure('public.customer_orders_sync_voided(uuid,date)') is not null then
    raise exception '0312: already applied';
  end if;
  foreach v_sig in array array[
    'customer_identity_lock()', 'customer_sha256(text)', 'customer_root(uuid)',
    'customer_resolve(text,text,text,text,text,uuid,timestamptz,text,text)',
    'customer_consent_latest(uuid,text)',
    'customer_consent_import_chunk(uuid,uuid,integer,jsonb)', 'customer_consent_import_finish(uuid,uuid,boolean)',
    'customer_erase(uuid,uuid,text)', 'customer_retention_sweep(uuid,timestamptz,integer)',
    'customer_marketing_export(text)', 'customer_newly_opted_in(timestamptz,integer)',
    'customer_list_rows(uuid[])', 'customer_consent_record_explicit(text,text,text,timestamptz,text,text)'] loop
    if to_regprocedure('public.' || v_sig) is null then raise exception '0312: missing %', v_sig; end if;
  end loop;
  if to_regclass('public.customer_consent_current') is null then raise exception '0312: missing customer_consent_current'; end if;
  -- 0300 must be in: its explicit-consent columns are re-read below.
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='customer_consent_events' and column_name='evidence_ref') then
    raise exception '0312: missing 0300 customer_consent_events.evidence_ref';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.customer_suppressions'::regclass
      and conname='customer_suppressions_kind_value_sha256_key' and contype='u') then
    raise exception '0312: customer_suppressions_kind_value_sha256_key drift';
  end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='toast_orders' and column_name in ('voided','deleted')) <> 2
     or to_regclass('public.toast_order_latest_pointers') is null then
    raise exception '0312: missing toast_orders.voided/deleted or toast_order_latest_pointers';
  end if;
  -- W12/B174, owner decision W12-4 b: people already erased for inactivity are unblocked (they can start
  -- over as new customers). That changes who can be profiled and opted in again, so it is NEVER silent:
  -- report the count to Juan, then apply in a session where
  --   select set_config('co_ops.w12_retention_unblock', '<that exact count>', false);
  -- was run first. A count of 0 needs nothing.
  select count(*) into v_retention from public.customer_suppressions where reason = 'retention';
  v_ack := current_setting('co_ops.w12_retention_unblock', true);
  if v_retention > 0 and v_ack is distinct from v_retention::text then
    raise exception '0312: % retention suppression row(s) would stop blocking (owner decision W12-4 b); report the count and acknowledge it with set_config(''co_ops.w12_retention_unblock'', ''%'', false) before applying', v_retention, v_retention;
  end if;
  raise notice '0312 preflight: % retention suppression row(s) stop blocking (W12-4 b)', v_retention;
end $$;

-- ───────────────────────────── B071: the tie rule ─────────────────────────────
-- The current consent per (person, channel): the latest event over the person and everyone merged into
-- them. On a tie on effective_at: a non-import opt-out wins; then the newer import; then, inside one
-- import, an opt-out; recorded_at then id break what is left.
create or replace view public.customer_consent_current with (security_invoker=true) as
select distinct on (r.root_id, e.channel)
  r.root_id as customer_id, e.channel, e.status, e.source, e.subject_sha256, e.effective_at, e.import_run_id, e.id as event_id
from public.customer_consent_events e
join (select id, coalesce(merged_into, id) as root_id from public.customers) r on r.id = e.customer_id
left join public.customer_consent_imports i on i.id = e.import_run_id
-- An import's events count only once the import COMPLETED (pending while running; never if cancelled).
where e.import_run_id is null or i.status = 'completed'
order by r.root_id, e.channel, e.effective_at desc,
  (e.status = 'opted_out' and e.import_run_id is null) desc, i.created_at desc nulls last,
  (e.status = 'opted_out') desc, e.recorded_at desc, e.id desc;

create or replace function public.customer_consent_latest(p_root uuid, p_channel text,
  out status text, out subject_sha256 text, out effective_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public as $$
  select e.status, e.subject_sha256, e.effective_at from public.customer_consent_events e
  left join public.customer_consent_imports i on i.id = e.import_run_id
  where e.customer_id in (select c.id from public.customers c where c.id = p_root or c.merged_into = p_root) and e.channel = p_channel
    and (e.import_run_id is null or i.status = 'completed')
  -- W12/B071: the same tie rule as customer_consent_current.
  order by e.effective_at desc, (e.status = 'opted_out' and e.import_run_id is null) desc, i.created_at desc nulls last,
    (e.status = 'opted_out') desc, e.recorded_at desc, e.id desc limit 1
$$;

-- ───────────────────────────── B173: one person, two listed addresses ─────────────────────────────
alter table public.customer_consent_import_members
  add column listed_subjects text[] not null default '{}',
  add column subject_deferred boolean not null default false;

create or replace function public.customer_consent_import_chunk(p_actor_id uuid, p_import_id uuid, p_chunk_index integer, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_imp public.customer_consent_imports%rowtype; v_done public.customer_consent_import_chunks%rowtype;
  v_row jsonb; v_res record; v_email text; v_status text; v_cur record; v_effective timestamptz; v_sha text;
  v_new_in int := 0; v_out int := 0; v_same int := 0; v_stale int := 0; v_supp int := 0; v_created int := 0; v_total int := 0;
  v_masked int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('customer-consent-import',0));
  select * into v_imp from public.customer_consent_imports where id = p_import_id for update;
  if not found then raise exception 'consent_import_not_found'; end if;
  if v_imp.status <> 'running' then raise exception 'consent_import_not_running'; end if;
  if p_chunk_index is null or p_chunk_index < 0 or p_chunk_index >= v_imp.chunk_count or p_rows is null
     or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'consent_import_invalid';
  end if;
  select * into v_done from public.customer_consent_import_chunks where import_id = p_import_id and chunk_index = p_chunk_index;
  if found then return to_jsonb(v_done) || jsonb_build_object('replay', true); end if;
  -- Evidence is dated by the export, at the start of that day (ET).
  v_effective := (v_imp.export_date::timestamp at time zone 'America/New_York');
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_total := v_total + 1;
    v_email := nullif(lower(btrim(coalesce(v_row->>'email',''))),'');
    if v_email is null then raise exception 'consent_import_invalid'; end if;
    v_status := case when v_imp.explicit_status then v_row->>'status' else 'opted_in' end;
    if v_status is null or v_status not in ('opted_in','opted_out') then raise exception 'consent_import_invalid'; end if;
    -- A relay/placeholder address is never stored nor opted in (r1 BC-031 P2).
    if public.customer_email_is_relay(v_email) then v_masked := v_masked + 1; continue; end if;
    select * into v_res from public.customer_resolve(v_email, v_row->>'phone',
      nullif(btrim(concat_ws(' ', v_row->>'first_name', v_row->>'last_name')),''), v_row->>'first_name', v_row->>'last_name',
      null, v_effective, v_imp.source, null);
    if v_res.customer_id is null then v_supp := v_supp + 1; continue; end if;
    if v_res.created then v_created := v_created + 1; end if;
    v_sha := public.customer_sha256(v_email);
    -- W12/B173: remember every opted-in address this import listed for the person (finish reads it).
    insert into public.customer_consent_import_members(import_id, customer_id, status, listed_subjects)
    values (p_import_id, v_res.customer_id, v_status, case when v_status = 'opted_in' then array[v_sha] else '{}'::text[] end)
    on conflict (import_id, customer_id) do update set
      status = case when excluded.status = 'opted_out' then 'opted_out' else customer_consent_import_members.status end,
      listed_subjects = array(select distinct s from unnest(customer_consent_import_members.listed_subjects || excluded.listed_subjects) s order by s);
    select * into v_cur from public.customer_consent_latest(v_res.customer_id, 'email');
    if v_cur.status = v_status and (v_status = 'opted_out' or v_cur.subject_sha256 = v_sha) then
      v_same := v_same + 1; continue;
    end if;
    -- W12/B173: the person is already opted in at another of THEIR OWN addresses (or this import already
    -- opted them in through an earlier row): not a new opt-in, and no event that would flip the address in
    -- use. Finish keeps that address while it is still listed and moves it only if it left the list.
    if v_status = 'opted_in' and (
         exists(select 1 from public.customer_consent_events e where e.import_run_id = p_import_id
                  and e.customer_id = v_res.customer_id and e.channel = 'email' and e.status = 'opted_in')
         or (v_cur.status = 'opted_in' and exists(select 1 from public.customer_identifiers i
                  where i.kind = 'email' and i.value_sha256 = v_cur.subject_sha256
                    and public.customer_root(i.customer_id) = v_res.customer_id))) then
      update public.customer_consent_import_members set subject_deferred = true
      where import_id = p_import_id and customer_id = v_res.customer_id;
      v_same := v_same + 1; continue;
    end if;
    -- Newer evidence already exists (e.g. an unsubscribe recorded after this export was taken).
    if v_cur.effective_at > v_effective then v_stale := v_stale + 1; continue; end if;
    insert into public.customer_consent_events(customer_id, channel, status, source, subject_sha256, effective_at, import_run_id, recorded_by)
    values (v_res.customer_id, 'email', v_status, v_imp.source, v_sha, v_effective, p_import_id, p_actor_id);
    if v_status = 'opted_in' then v_new_in := v_new_in + 1; else v_out := v_out + 1; end if;
  end loop;
  insert into public.customer_consent_import_chunks(import_id, chunk_index, rows_total, new_opt_ins, opt_outs, unchanged, stale, suppressed, new_customers, masked)
  values (p_import_id, p_chunk_index, v_total, v_new_in, v_out, v_same, v_stale, v_supp, v_created, v_masked) returning * into v_done;
  return to_jsonb(v_done) || jsonb_build_object('replay', false);
end $$;

create or replace function public.customer_consent_import_finish(p_actor_id uuid, p_import_id uuid, p_allow_large_opt_out boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_imp public.customer_consent_imports%rowtype; v_last public.customer_consent_imports%rowtype; v_member record; v_cur record;
  v_effective timestamptz; v_absent int := 0; v_absent_stale int := 0; v_prev int := 0; v_sum record; v_moved int := 0; v_root uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('customer-consent-import',0));
  select * into v_imp from public.customer_consent_imports where id = p_import_id for update;
  if not found then raise exception 'consent_import_not_found'; end if;
  if v_imp.status = 'completed' then
    return jsonb_build_object('import_id', v_imp.id, 'replay', true, 'rows_total', v_imp.rows_total, 'new_opt_ins', v_imp.new_opt_ins,
      'opt_outs', v_imp.opt_outs, 'unchanged', v_imp.unchanged, 'stale', v_imp.stale, 'suppressed', v_imp.suppressed,
      'new_customers', v_imp.new_customers, 'masked', v_imp.masked, 'baseline', v_imp.is_baseline);
  end if;
  if v_imp.status <> 'running' then raise exception 'consent_import_not_running'; end if;
  if (select count(*) from public.customer_consent_import_chunks where import_id = p_import_id) <> v_imp.chunk_count then
    raise exception 'consent_import_incomplete';
  end if;
  v_effective := (v_imp.export_date::timestamp at time zone 'America/New_York');
  select * into v_last from public.customer_consent_imports where source = v_imp.source and status = 'completed' and id <> v_imp.id
  order by export_date desc, created_at desc limit 1;
  if not v_imp.explicit_status and v_last.id is not null then
    select count(*) into v_prev from public.customer_consent_import_members where import_id = v_last.id and status = 'opted_in';
    for v_member in
      select public.customer_root(m.customer_id) as customer_id from public.customer_consent_import_members m
      where m.import_id = v_last.id and m.status = 'opted_in'
      except
      select public.customer_root(n.customer_id) from public.customer_consent_import_members n where n.import_id = v_imp.id
    loop
      select * into v_cur from public.customer_consent_latest(v_member.customer_id, 'email');
      if v_cur.status is distinct from 'opted_in' then continue; end if;
      if v_cur.effective_at > v_effective then v_absent_stale := v_absent_stale + 1; continue; end if;
      insert into public.customer_consent_import_members(import_id, customer_id, status) values (v_imp.id, v_member.customer_id, 'opted_out')
      on conflict (import_id, customer_id) do nothing;
      insert into public.customer_consent_events(customer_id, channel, status, source, subject_sha256, effective_at, import_run_id, recorded_by)
      values (v_member.customer_id, 'email', 'opted_out', v_imp.source, v_cur.subject_sha256, v_effective, v_imp.id, p_actor_id);
      v_absent := v_absent + 1;
    end loop;
    -- A file that silently lost a big part of the list (one shop's export, a filtered view) must not
    -- unsubscribe those people without a human saying so. Raising rolls back this step only.
    if v_absent > 25 and v_absent * 10 > v_prev and not coalesce(p_allow_large_opt_out, false) then
      raise exception 'consent_import_large_opt_out';
    end if;
  end if;
  -- W12/B173: a deferred person (already opted in at one of their own addresses) keeps the address in
  -- use while this import still lists it. Only when it left the list does the subject move, to a
  -- still-listed address (the smallest hash, so a replay picks the same one). Never a new opt-in.
  for v_member in
    select m.customer_id, m.listed_subjects from public.customer_consent_import_members m
    where m.import_id = v_imp.id and m.status = 'opted_in' and m.subject_deferred and cardinality(m.listed_subjects) > 0
    order by m.customer_id
  loop
    v_root := public.customer_root(v_member.customer_id);
    if exists(select 1 from public.customer_consent_events e join public.customers x on x.id = e.customer_id
              where e.import_run_id = v_imp.id and e.channel = 'email' and coalesce(x.merged_into, x.id) = v_root) then continue; end if;
    select * into v_cur from public.customer_consent_latest(v_root, 'email');
    if v_cur.status is distinct from 'opted_in' or v_cur.subject_sha256 = any(v_member.listed_subjects)
       or v_cur.effective_at > v_effective then continue; end if;
    insert into public.customer_consent_events(customer_id, channel, status, source, subject_sha256, effective_at, import_run_id, recorded_by)
    values (v_root, 'email', 'opted_in', v_imp.source, (select min(s) from unnest(v_member.listed_subjects) s), v_effective, v_imp.id, p_actor_id);
    v_moved := v_moved + 1;
  end loop;
  select coalesce(sum(c.rows_total),0) as r, coalesce(sum(c.new_opt_ins),0) as i, coalesce(sum(c.opt_outs),0) as o,
    coalesce(sum(c.unchanged),0) as u, coalesce(sum(c.stale),0) as s, coalesce(sum(c.suppressed),0) as p, coalesce(sum(c.new_customers),0) as n,
    coalesce(sum(c.masked),0) as m
  into v_sum from public.customer_consent_import_chunks c where c.import_id = v_imp.id;
  update public.customer_consent_imports set status = 'completed', finished_at = clock_timestamp(), rows_total = v_sum.r,
    new_opt_ins = v_sum.i, opt_outs = v_sum.o + v_absent, unchanged = v_sum.u, stale = v_sum.s + v_absent_stale,
    suppressed = v_sum.p, new_customers = v_sum.n, masked = v_sum.m where id = v_imp.id;
  return jsonb_build_object('import_id', v_imp.id, 'replay', false, 'rows_total', v_sum.r, 'new_opt_ins', v_sum.i,
    'opt_outs', v_sum.o + v_absent, 'absent_opt_outs', v_absent, 'unchanged', v_sum.u, 'stale', v_sum.s + v_absent_stale,
    'suppressed', v_sum.p, 'new_customers', v_sum.n, 'masked', v_sum.m, 'baseline', v_imp.is_baseline, 'subject_moves', v_moved);
end $$;

-- "Newly opted in": the current status is an opt-in made after p_since, and it is a CHANGE (not the
-- baseline import that first loaded the list, and — W12/B173 — not an address change of someone who was
-- already opted in).
create or replace function public.customer_newly_opted_in(p_since timestamptz, p_limit integer)
returns table(customer_id uuid, full_name text, opted_in_at timestamptz, source text, previous_status text, had_orders boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  select n.customer_id, n.full_name, n.opted_in_at, n.source, n.previous_status, n.had_orders from (
    select k.customer_id, c.full_name, k.effective_at as opted_in_at, k.source,
      coalesce((select e.status from public.customer_consent_events e join public.customers x on x.id = e.customer_id
                where coalesce(x.merged_into, x.id) = k.customer_id and e.channel = 'email' and e.id <> k.event_id
                  and (e.import_run_id is null or exists(select 1 from public.customer_consent_imports ci where ci.id = e.import_run_id and ci.status = 'completed'))
                  and (e.effective_at, e.recorded_at) < (k.effective_at, (select recorded_at from public.customer_consent_events where id = k.event_id))
                order by e.effective_at desc, e.recorded_at desc limit 1), 'none') as previous_status,
      exists(select 1 from public.customer_orders o where o.customer_id = k.customer_id) as had_orders
    from public.customer_consent_current k
    join public.customers c on c.id = k.customer_id and c.merged_into is null and c.erased_at is null
    left join public.customer_consent_imports im on im.id = k.import_run_id
    where k.channel = 'email' and k.status = 'opted_in' and k.effective_at >= p_since and coalesce(im.is_baseline, false) = false
  ) n
  where n.previous_status <> 'opted_in'
  order by n.opted_in_at desc, n.customer_id
  limit least(greatest(coalesce(p_limit, 200), 1), 1000)
$$;

-- ───────────────────────────── B174: retention never suppresses ─────────────────────────────
-- One row per (identifier, reason): a delete request for a hash an old retention erasure already wrote
-- is still recorded (it would otherwise be swallowed by ON CONFLICT DO NOTHING).
alter table public.customer_suppressions drop constraint customer_suppressions_kind_value_sha256_key,
  add constraint customer_suppressions_kind_value_reason_key unique (kind, value_sha256, reason);

-- Resolve (or create) the person behind one contact record (0234 body). W12/B174: only a DELETE
-- REQUEST suppresses; an identifier erased by retention may come back as a new person.
create or replace function public.customer_resolve(
  p_email text, p_phone text, p_full_name text, p_first_name text, p_last_name text,
  p_location_id uuid, p_seen_at timestamptz, p_source text, p_masked_channel text,
  out customer_id uuid, out created boolean, out suppressed boolean)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email,''))),'');
  v_phone text := nullif(btrim(coalesce(p_phone,'')),'');
  v_by_email uuid; v_by_phone uuid; v_a uuid; v_b uuid; v_name text; v_owner uuid;
begin
  created := false; suppressed := false; customer_id := null;
  perform public.customer_identity_lock();
  -- A relay or placeholder address is not the person's: never stored, never consent (r1 BC-031 P2).
  if v_email is not null and public.customer_email_is_relay(v_email) then v_email := null; end if;
  if v_email is not null and exists(select 1 from public.customer_suppressions s where s.kind='email' and s.value_sha256=public.customer_sha256(v_email)
      and s.reason = 'delete_request') then
    v_email := null; suppressed := true;
  end if;
  if v_phone is not null and exists(select 1 from public.customer_suppressions s where s.kind='phone' and s.value_sha256=public.customer_sha256(v_phone)
      and s.reason = 'delete_request') then
    v_phone := null; suppressed := true;
  end if;
  if v_email is null and v_phone is null then return; end if;
  -- A suppressed email on the same record means the PERSON asked to be deleted: never attach them by phone.
  if suppressed then return; end if;

  if v_email is not null then
    select public.customer_root(i.customer_id) into v_by_email from public.customer_identifiers i where i.kind='email' and i.value=v_email;
  end if;
  if v_phone is not null then
    select public.customer_root(i.customer_id) into v_by_phone from public.customer_identifiers i where i.kind='phone' and i.value=v_phone;
  end if;
  customer_id := coalesce(v_by_email, v_by_phone);
  v_name := nullif(regexp_replace(btrim(coalesce(p_full_name,'')),'\s+',' ','g'),'');

  if customer_id is null then
    insert into public.customers(full_name, first_name, last_name, name_key, primary_location_id, first_seen_at, last_seen_at, sources, masked_channels)
    values (v_name, nullif(btrim(coalesce(p_first_name,'')),''), nullif(btrim(coalesce(p_last_name,'')),''), lower(v_name), p_location_id,
      coalesce(p_seen_at, now()), coalesce(p_seen_at, now()), array[p_source],
      case when p_masked_channel is null then '{}'::text[] else array[p_masked_channel] end)
    returning id into customer_id;
    created := true;
  else
    update public.customers c set
      full_name = coalesce(c.full_name, v_name),
      first_name = coalesce(c.first_name, nullif(btrim(coalesce(p_first_name,'')),'')),
      last_name = coalesce(c.last_name, nullif(btrim(coalesce(p_last_name,'')),'')),
      name_key = coalesce(c.name_key, lower(v_name)),
      primary_location_id = coalesce(c.primary_location_id, p_location_id),
      first_seen_at = least(c.first_seen_at, coalesce(p_seen_at, c.first_seen_at)),
      last_seen_at = greatest(c.last_seen_at, coalesce(p_seen_at, c.last_seen_at)),
      sources = case when p_source = any(c.sources) then c.sources else c.sources || p_source end,
      masked_channels = case when p_masked_channel is null or p_masked_channel = any(c.masked_channels) then c.masked_channels
                             else c.masked_channels || p_masked_channel end
    where c.id = customer_id;
  end if;

  -- The email and the phone belong to two different people already: file it, never merge it.
  if v_by_email is not null and v_by_phone is not null and v_by_email <> v_by_phone then
    v_a := least(v_by_email, v_by_phone); v_b := greatest(v_by_email, v_by_phone);
    insert into public.customer_merge_suggestions(customer_a, customer_b, confidence, reasons)
    values (v_a, v_b, 0.90, array['email_phone_split']) on conflict (customer_a, customer_b) do nothing;
  end if;

  if v_email is not null then
    insert into public.customer_identifiers(customer_id, kind, value, value_sha256, source, first_seen_at, last_seen_at)
    values (customer_id, 'email', v_email, public.customer_sha256(v_email), p_source, coalesce(p_seen_at, now()), coalesce(p_seen_at, now()))
    on conflict (kind, value) do update set last_seen_at = greatest(customer_identifiers.last_seen_at, excluded.last_seen_at);
    -- Reconcile (r1 BC-037): the email must now belong to THIS person, or nothing attaches to anyone.
    select public.customer_root(i.customer_id) into v_owner from public.customer_identifiers i where i.kind='email' and i.value=v_email;
    if v_owner is distinct from customer_id then raise exception 'customer_identity_conflict'; end if;
  end if;
  if v_phone is not null then
    insert into public.customer_identifiers(customer_id, kind, value, value_sha256, source, first_seen_at, last_seen_at)
    values (customer_id, 'phone', v_phone, public.customer_sha256(v_phone), p_source, coalesce(p_seen_at, now()), coalesce(p_seen_at, now()))
    on conflict (kind, value) do update set last_seen_at = greatest(customer_identifiers.last_seen_at, excluded.last_seen_at);
    -- A phone already owned by someone else stays theirs (the split is a suggestion above); a phone that
    -- resolved this person must be theirs.
    if v_by_email is null then
      select public.customer_root(i.customer_id) into v_owner from public.customer_identifiers i where i.kind='phone' and i.value=v_phone;
      if v_owner is distinct from customer_id then raise exception 'customer_identity_conflict'; end if;
    end if;
  end if;
end $$;

-- Delete on request (and the retention sweep's per-person step): the person and everyone merged into
-- them lose identifiers, cards and names; an opt-out is appended per channel. W12/B174: only a delete
-- request suppresses the hashes; retention erases without blocking a future return.
create or replace function public.customer_erase(p_actor_id uuid, p_customer_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_root uuid; v_ids uuid[]; v_idents int; v_channel text;
begin
  perform public.customer_identity_lock();
  v_root := public.customer_root(p_customer_id);
  if v_root is null then raise exception 'customer_not_found'; end if;
  if p_reason not in ('delete_request','retention') then raise exception 'erase_invalid'; end if;
  if exists(select 1 from public.customers where id = v_root and erased_at is not null) then
    return jsonb_build_object('customer_id', v_root, 'changed', false);
  end if;
  select array_agg(id) into v_ids from public.customers where id = v_root or merged_into = v_root;
  perform 1 from public.customers where id = any(v_ids) for update;
  if p_reason = 'delete_request' then
    insert into public.customer_suppressions(kind, value_sha256, reason, created_by)
    select kind, value_sha256, p_reason, p_actor_id from public.customer_identifiers where customer_id = any(v_ids)
    on conflict (kind, value_sha256, reason) do nothing;
  end if;
  foreach v_channel in array array['email','sms'] loop
    insert into public.customer_consent_events(customer_id, channel, status, source, subject_sha256, effective_at, recorded_by)
    values (v_root, v_channel, 'opted_out', p_reason, null, clock_timestamp(), p_actor_id);
  end loop;
  delete from public.customer_identifiers where customer_id = any(v_ids);
  get diagnostics v_idents = row_count;
  delete from public.customer_cards where customer_id = any(v_ids);
  update public.customer_merge_suggestions set status = 'dismissed', decided_at = now(), decided_by = p_actor_id
  where status = 'open' and (customer_a = any(v_ids) or customer_b = any(v_ids));
  update public.customers set full_name = null, first_name = null, last_name = null, name_key = null,
    erased_at = now(), erased_by = p_actor_id, erase_reason = p_reason where id = any(v_ids);
  return jsonb_build_object('customer_id', v_root, 'changed', true, 'identifiers_deleted', v_idents);
end $$;

-- The ONLY marketing read (0234 body). Latest event opted_in, the subject address only, live people
-- only, never a hash a person asked us to delete (W12/B174: delete requests only).
create or replace function public.customer_marketing_export(p_channel text)
returns table(customer_id uuid, value text, first_name text, last_name text, opted_in_at timestamptz, source text, status text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select k.customer_id, i.value, c.first_name, c.last_name, k.effective_at, k.source, k.status
  from public.customer_consent_current k
  join public.customers c on c.id = k.customer_id and c.merged_into is null and c.erased_at is null
  join public.customer_identifiers i on i.value_sha256 = k.subject_sha256
    and i.kind = case p_channel when 'email' then 'email' when 'sms' then 'phone' end
    and public.customer_root(i.customer_id) = k.customer_id
  where k.channel = p_channel and k.status = 'opted_in'
    and not exists(select 1 from public.customer_suppressions s where s.kind = i.kind and s.value_sha256 = i.value_sha256
      and s.reason = 'delete_request')
  order by k.effective_at, k.customer_id
$$;

-- The explicit (Meta lead form) consent writer (0300 body). W12/B174: delete requests only.
create or replace function public.customer_consent_record_explicit(p_email text,p_channel text,p_source text,p_effective_at timestamptz,p_evidence_ref text,p_text_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_email text:=lower(btrim(p_email)); v_resolved record; v_event public.customer_consent_events%rowtype; v_id uuid;
begin
  perform public.customer_identity_lock();
  if p_channel is distinct from 'email' or p_source is distinct from 'meta_lead_form'
    or p_effective_at is null or p_effective_at>clock_timestamp()+interval '5 minutes'
    or p_evidence_ref is null or p_evidence_ref !~ '^[0-9]{1,100}:[A-Za-z0-9_ -]{1,200}$'
    or p_text_version is distinct from 'meta-email-marketing-v3'
    or v_email is null or length(v_email)>254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'consent_invalid'; end if;
  if public.customer_email_is_relay(v_email) then raise exception 'consent_relay'; end if;
  if exists(select 1 from public.customer_suppressions where kind='email' and value_sha256=public.customer_sha256(v_email)
      and reason='delete_request') then raise exception 'consent_suppressed'; end if;
  select * into v_event from public.customer_consent_events where source=p_source and evidence_ref=p_evidence_ref;
  if found then
    if v_event.subject_sha256<>public.customer_sha256(v_email) or v_event.channel<>p_channel or v_event.effective_at<>p_effective_at or v_event.text_version<>p_text_version then raise exception 'consent_evidence_conflict'; end if;
    return jsonb_build_object('event_id',v_event.id,'recorded',false);
  end if;
  select * into v_resolved from public.customer_resolve(v_email,null,null,null,null,null,p_effective_at,p_source,null);
  if v_resolved.customer_id is null or v_resolved.suppressed then raise exception 'consent_suppressed'; end if;
  insert into public.customer_consent_events(customer_id,channel,status,source,subject_sha256,effective_at,evidence_ref,text_version)
  values(v_resolved.customer_id,p_channel,'opted_in',p_source,public.customer_sha256(v_email),p_effective_at,p_evidence_ref,p_text_version) returning id into v_id;
  return jsonb_build_object('event_id',v_id,'recorded',true);
end $$;

-- ───────────────────────────── B070: retention takes the identity lock first ─────────────────────────────
-- Retention: a person not seen since p_cutoff whose CURRENT status is not opted in on any channel is
-- erased (bounded batch; the caller loops on erased + skipped). Opted-in people keep their profile while
-- consent stands.
create or replace function public.customer_retention_sweep(p_actor_id uuid, p_cutoff timestamptz, p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_n int := 0; v_skipped int := 0;
begin
  if p_cutoff is null or p_cutoff > now() - interval '365 days' or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'retention_invalid';
  end if;
  -- W12/B070: serialise with every identity writer (Toast capture, the consent import chunk, the Meta
  -- consent writer, merges) BEFORE the candidate snapshot is taken; a person they just made active is
  -- then either visible as active or waits behind this sweep.
  perform public.customer_identity_lock();
  for v_id in
    select c.id from public.customers c
    where c.merged_into is null and c.erased_at is null and c.last_seen_at < p_cutoff
      and not exists(select 1 from public.customer_consent_current k where k.customer_id = c.id and k.status = 'opted_in')
      and not exists(select 1 from public.customers m where m.merged_into = c.id and m.last_seen_at >= p_cutoff)
    order by c.last_seen_at limit p_limit
  loop
    -- W12/B070: re-check on a fresh snapshot right before erasing (an import finish completes consent
    -- without the identity lock).
    if not exists(select 1 from public.customers c
        where c.id = v_id and c.merged_into is null and c.erased_at is null and c.last_seen_at < p_cutoff
          and not exists(select 1 from public.customer_consent_current k where k.customer_id = c.id and k.status = 'opted_in')
          and not exists(select 1 from public.customers m where m.merged_into = c.id and m.last_seen_at >= p_cutoff)) then
      v_skipped := v_skipped + 1; continue;
    end if;
    perform public.customer_erase(p_actor_id, v_id, 'retention');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('erased', v_n, 'skipped', v_skipped);
end $$;

-- ───────────────────────────── B176: voided / deleted Toast orders ─────────────────────────────
-- null = a live order. Set and cleared ONLY by customer_orders_sync_voided (and the backfill below);
-- customer_ingest_orders' ON CONFLICT never touches it, so a re-capture cannot un-void a row.
alter table public.customer_orders add column voided_at timestamptz;

-- One shop-day: mark the Toast-linked rows whose latest snapshot is voided or deleted, and clear the
-- mark on rows whose snapshot is live again (an un-void). Touches no identifier, so no identity lock.
create function public.customer_orders_sync_voided(p_location_id uuid, p_business_date date)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_voided int; v_restored int;
begin
  if p_location_id is null or p_business_date is null then raise exception 'customer_ingest_invalid'; end if;
  update public.customer_orders o set voided_at = clock_timestamp()
  from public.toast_order_latest_pointers p join public.toast_orders t on t.id = p.snapshot_id
  where o.source_kind = 'toast' and o.location_id = p_location_id and o.voided_at is null
    and p.location_id = o.location_id and p.order_guid = o.toast_order_guid and p.business_date = p_business_date
    and (t.voided or t.deleted);
  get diagnostics v_voided = row_count;
  update public.customer_orders o set voided_at = null
  from public.toast_order_latest_pointers p join public.toast_orders t on t.id = p.snapshot_id
  where o.source_kind = 'toast' and o.location_id = p_location_id and o.voided_at is not null
    and p.location_id = o.location_id and p.order_guid = o.toast_order_guid and p.business_date = p_business_date
    and not (t.voided or t.deleted);
  get diagnostics v_restored = row_count;
  return jsonb_build_object('voided', v_voided, 'restored', v_restored);
end $$;

-- Backfill: every linked Toast order whose latest snapshot is already voided or deleted.
do $$
declare v_n int;
begin
  update public.customer_orders o set voided_at = clock_timestamp()
  from public.toast_order_latest_pointers p join public.toast_orders t on t.id = p.snapshot_id
  where o.source_kind = 'toast' and o.voided_at is null
    and p.location_id = o.location_id and p.order_guid = o.toast_order_guid and (t.voided or t.deleted);
  get diagnostics v_n = row_count;
  raise notice '0312 backfill: % customer_orders row(s) marked voided (W12/B176)', v_n;
end $$;

-- Private common projection (0249 body). W12/B176: visits, spend, average order and catering orders
-- count LIVE orders only; dates fall back to every order when none is live (the person did order).
create or replace function public.customer_list_rows(p_location_ids uuid[])
returns table(customer_id uuid, full_name text, visits bigint, spend_cents numeric, avg_order_cents numeric,
  first_order date, last_order date, shops uuid[], catering_orders bigint, cards bigint,
  channels text[], is_guest boolean, has_email boolean, has_phone boolean, opted_in boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  with orders as (
    select o.customer_id, count(*) filter (where o.voided_at is null) visits,
      case when count(o.total_cents) filter (where o.voided_at is null) = count(*) filter (where o.voided_at is null)
        then coalesce(sum(o.total_cents) filter (where o.voided_at is null), 0) end spend_cents,
      case when count(o.total_cents) filter (where o.voided_at is null) = count(*) filter (where o.voided_at is null)
        then round(avg(o.total_cents) filter (where o.voided_at is null)) end avg_order_cents,
      coalesce(min(o.business_date) filter (where o.voided_at is null), min(o.business_date)) first_order,
      coalesce(max(o.business_date) filter (where o.voided_at is null), max(o.business_date)) last_order,
      array_agg(distinct o.location_id order by o.location_id) shops,
      count(*) filter (where o.voided_at is null and (o.source_kind <> 'toast' or o.channel = 'catering')) catering_orders,
      array_agg(distinct o.channel order by o.channel) channels, bool_and(o.contact_masked) all_masked
    from public.customer_orders o
    where p_location_ids is null or o.location_id = any(p_location_ids)
    group by o.customer_id
  ), identifiers as (
    -- A relay address stored before 0249 (cleanup seed 53) is not contact and does not make a person.
    select i.customer_id, bool_or(i.kind = 'email' and not public.customer_email_is_relay(i.value)) has_email,
      bool_or(i.kind = 'phone') has_phone
    from public.customer_identifiers i group by i.customer_id
  ), cards as (
    select k.customer_id, count(*) cards from public.customer_cards k group by k.customer_id
  ), consent as (
    select k.customer_id, bool_or(k.status = 'opted_in') opted_in
    from public.customer_consent_current k group by k.customer_id
  )
  select c.id, c.full_name, o.visits, o.spend_cents, o.avg_order_cents, o.first_order, o.last_order,
    o.shops, o.catering_orders, coalesce(k.cards,0), o.channels,
    not coalesce(i.has_email or i.has_phone, false) and o.all_masked, coalesce(i.has_email,false), coalesce(i.has_phone,false), coalesce(s.opted_in,false)
  from orders o join public.customers c on c.id = o.customer_id and c.merged_into is null and c.erased_at is null
  left join identifiers i on i.customer_id = c.id
  left join cards k on k.customer_id = c.id
  left join consent s on s.customer_id = c.id
$$;

-- ───────────────────────────── B177: merge suggestions scoped before the limit ─────────────────────────────
-- Open suggestions a viewer may see (null shops = every shop), highest confidence first. The scope is
-- assertInScope's rule in lib/customers/customers.ts: BOTH sides (themselves or anyone merged into them)
-- have an order at one of the shops. Applied BEFORE the limit, so other shops cannot crowd a GM out.
create function public.customer_merge_suggestions_open(p_location_ids uuid[], p_limit integer)
returns table(id uuid, customer_a uuid, customer_b uuid, confidence numeric, reasons text[])
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.id, s.customer_a, s.customer_b, s.confidence, s.reasons
  from public.customer_merge_suggestions s
  where s.status = 'open'
    and (p_location_ids is null or (
      exists(select 1 from public.customer_orders o join public.customers m on m.id = o.customer_id
             where (m.id = s.customer_a or m.merged_into = s.customer_a) and o.location_id = any(p_location_ids))
      and exists(select 1 from public.customer_orders o join public.customers m on m.id = o.customer_id
             where (m.id = s.customer_b or m.merged_into = s.customer_b) and o.location_id = any(p_location_ids))))
  order by s.confidence desc, s.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- ───────────────────────────── grants (0234/0249 boundary) ─────────────────────────────
revoke all on public.customer_consent_current from public, anon, authenticated, service_role;
grant select on public.customer_consent_current to service_role;
-- Private helpers: no PostgREST role, service_role included.
revoke all on function public.customer_consent_latest(uuid,text),
  public.customer_resolve(text,text,text,text,text,uuid,timestamptz,text,text),
  public.customer_list_rows(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.customer_consent_import_chunk(uuid,uuid,integer,jsonb), public.customer_consent_import_finish(uuid,uuid,boolean),
  public.customer_newly_opted_in(timestamptz,integer), public.customer_erase(uuid,uuid,text),
  public.customer_marketing_export(text), public.customer_consent_record_explicit(text,text,text,timestamptz,text,text),
  public.customer_retention_sweep(uuid,timestamptz,integer), public.customer_orders_sync_voided(uuid,date),
  public.customer_merge_suggestions_open(uuid[],integer)
  from public, anon, authenticated, service_role;
grant execute on function public.customer_consent_import_chunk(uuid,uuid,integer,jsonb), public.customer_consent_import_finish(uuid,uuid,boolean),
  public.customer_newly_opted_in(timestamptz,integer), public.customer_erase(uuid,uuid,text),
  public.customer_marketing_export(text), public.customer_consent_record_explicit(text,text,text,timestamptz,text,text),
  public.customer_retention_sweep(uuid,timestamptz,integer), public.customer_orders_sync_voided(uuid,date),
  public.customer_merge_suggestions_open(uuid[],integer)
  to service_role;

do $$ begin
  if exists(select 1 from information_schema.role_table_grants where table_schema='public'
    and table_name in ('customers','customer_identifiers','customer_cards','customer_orders','customer_consent_imports',
      'customer_consent_import_members','customer_consent_import_chunks','customer_consent_events','customer_merge_suggestions',
      'customer_suppressions','customer_consent_current')
    and (grantee in ('PUBLIC','anon','authenticated') or (grantee='service_role' and privilege_type <> 'SELECT'))) then
    raise exception '0312: table grant escaped';
  end if;
  if exists(select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name like 'customer\_%'
    and grantee in ('PUBLIC','anon','authenticated')) then
    raise exception '0312: RPC grant escaped';
  end if;
  if exists(select 1 from information_schema.routine_privileges where routine_schema='public'
    and routine_name in ('customer_resolve','customer_root','customer_sha256','customer_consent_latest','customer_email_is_relay',
      'customer_identity_lock','customer_list_rows','customer_marketplace_candidate_rows','customer_marketplace_guest') and grantee = 'service_role') then
    raise exception '0312: private helper granted';
  end if;
  if not has_function_privilege('service_role', 'public.customer_orders_sync_voided(uuid,date)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.customer_merge_suggestions_open(uuid[],integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.customer_merge_suggestions_open(uuid[],integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.customer_orders_sync_voided(uuid,date)', 'EXECUTE') then
    raise exception '0312: new RPC not executable by service_role';
  end if;
end $$;
commit;
