-- Migration 0361_toast_time_entries_newer
-- AUTHORED 2026-11-28 (Toast labor "only if newer", CC ruling D-R2, CO CC Fable lead, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- NUMBER: 0360 is the highest on main; 0361 is claimed for this build in co-ops-wt/.mig-claims (the digest reserve was
--   released); 0362 and 0363 are claimed by other builds. It touches no object of theirs.
-- Plan: PLAN-toast-labor-newer.md revision 3, on CC's rulings R1 to R7 (RULINGS-toast-labor-newer-r3.md) and U1 to U7
--   (RULINGS-toast-labor-newer-build.md). Runbook: docs/runbooks/toast-labor-guard.md.
--
-- WHAT THIS IS. ONE new function and nothing else:
--     public.toast_time_entries_apply_newer(p_rows jsonb) returns jsonb
--   the GUARDED writer of the Toast labor mirror (0224). lib/toast/labor.ts calls it ONLY when the server switch
--   TOAST_LABOR_GUARD is exactly "1". Unset (the default) the pull keeps main's unconditional upsert, byte for byte,
--   and nothing calls this function. Turning the switch on is Juan's call, bundled with the DIGEST_LABOR_MONEY ask.
--   ADDITIVE: no table, column, row, policy, trigger, index or other function is created, altered or dropped. No row is
--   written by applying this file. `create function` locks no table.
--
-- WHY (D-R2). Two labor pulls for one shop can overlap (the 10-minute cron, the nightly, the digest pre-load). Pull A
--   reads Toast while a shift is open; the person clocks out; pull B reads the closed shift and stores it; pull A's
--   write lands last and puts the open shift back. The same for an archive followed by a stale live row.
--
-- THE VERSION (R1). Toast's TimeEntry `modifiedDate`, stored since 0224 as source_modified_at. Toast's published spec,
--   https://doc.toasttab.com/toast-api-specifications/toast-labor-api.yaml (info.version 1.9.0, read 2026-11-28, sha256
--   45c2ce1a797297e1a0772270667ab9803e28592e05e18c7a3046f02feca46a92), definitions.TimeEntry: "Date modified, in UTC
--   format (read-only)." UNVERIFIED (the spec does not say): which events move it, that it only grows, its precision.
-- THE THREAT MODEL (R1, binding), in four lines:
--   IN:  a row is stored iff no row is stored for its key or the incoming stamp is LATER than the stored stamp.
--   IN:  an equal stamp is the same version: nothing is stored. The same key twice in one payload is reduced to one
--        element first (the greatest stamp; no stamp ranks lowest; a tie keeps the LATER element).
--   OUT: an incoming row with no stamp when a row is stored, a stamp that goes backwards, a precision artifact, content
--        that changed under an unchanged stamp: ONE disposition, SKIP the row and COUNT it. A skip never fails the call.
--   OUT: sparse archives. The normalizer drops them before this function, as on main (R4).
--
-- THE DECISION, per key, made on the STORED row while this call holds its row lock:
--   1 no stored row                                                    -> inserted
--   2 incoming stamp present, stored stamp absent or EARLIER           -> updated (every pull column; never user_id)
--   3 both stamps present and equal, every Toast-derived column equal  -> unchanged (nothing stored)
--   4 both stamps present and equal, a Toast-derived column differs    -> skipped_same_stamp (nothing stored)
--   5 both stamps present, the incoming one EARLIER                    -> skipped_older (nothing stored)
--   6 incoming stamp absent and a row is stored (stamped or not)       -> skipped_no_stamp (nothing stored)
--   Toast-derived columns (cases 3 / 4): business_date, employee_guid, job_guid, in_at, out_at, hours, overtime_hours,
--   auto_clocked_out, deleted. The two names (employee_first_name, job_name) are OUR join with Toast's employee and job
--   lists and are not part of the version: they are stored with a version (cases 1, 2) and left alone by a replay.
--   U5: a stamped row over a stored row with no stamp is case 2; an unstamped row over an unstamped stored row is case 6.
--   A stored stamp is never replaced by an earlier one. No timed rule, no repair path (R2). No conflict state (R3).
--
-- HOW ONE CALL RUNS.
--   a. p_rows NULL, not a JSON array, an element that is not an object, or an element without location_id or
--      time_entry_guid: `toast_labor_invalid_payload`. Nothing is stored.
--   b. 0233's link lock, SHARED, before any row lock: pg_advisory_xact_lock_shared(hashtextextended('toast-link',0)).
--      It is the order 0233's statement trigger gives every writer of this table, so there is no cycle with
--      link_toast_employee / unlink_toast_employee (exclusive first, then their user_id changes).
--   c. The elements are read with an explicit typed column list (the fourteen columns of the pull's row; never user_id,
--      which 0233's row trigger owns; never pulled_at), reduced to one per key, and walked ONCE in ascending
--      (location_id, time_entry_guid collate "C") order. Every guarded call therefore takes its row locks in the same
--      order: two guarded calls cannot deadlock on each other. There is one list and one pass, live rows and archives
--      together.
--   d. Per key (U2): the stored row is locked and classified FIRST. A row is proposed to the table ONLY for a key that
--      is absent, so a row that is skipped never reaches a table constraint (a stale version with hours above 0224's
--      48, or a replay with a name longer than its column allows, is counted and the call goes on). If another writer
--      stores the key between the look and the proposal, the proposal does nothing and the stored row is locked and
--      classified like any other. A row that IS chosen for writing (case 1 or 2) and breaks a table constraint fails
--      the whole call and keeps nothing, as a bad row fails main's statement.
--      RESIDUAL, said out loud: a row for a key that is ABSENT when the call looks is chosen for writing. If it breaks
--      a constraint the call fails, also in the instant when another writer is storing that key at the same time.
--      The next pull finds the key stored and classifies before any constraint.
--   e. pulled_at is clock_timestamp() on a row this call stores (cases 1, 2) and is not touched otherwise (U6: no code
--      reads this table's pulled_at; a skip or a replay stores nothing at all).
--   f. Answer: {received, inserted, updated, unchanged, skipped_same_stamp, skipped_older, skipped_no_stamp,
--      duplicates}, eight whole numbers; received = the payload's length = the sum of the other seven.
--   READ COMMITTED (PostgREST's default): a proposal waits for a concurrent writer of the same key, and the row lock
--   waits for a concurrent change and then reads the committed row, so two writers of one entry are serialized and the
--   second decides against the first's result. Under a stricter isolation a concurrent change is a serialization
--   error: the call fails and keeps nothing (fail closed).
--   IT GUARDS ONLY ITS CALLERS. 0233's two user_id changes, the sim seed's direct upsert and main's upsert (the switch
--   OFF, or a deployment still draining) keep writing as they do today.
--   U1 RESIDUAL: an entry archived in Toast more than 48 h ago that our copy still shows as live is not corrected by
--   the one-time re-pull (a business-date read never returns an archive; the modification window reaches 48 h).
--
-- SECURITY. SECURITY INVOKER: the caller (service_role) already holds SELECT / INSERT / UPDATE on the table from 0224
--   and bypasses RLS; the function adds no power. Pinned search_path. EXECUTE: revoked from PUBLIC, anon and
--   authenticated, granted to service_role; the whole ACL is asserted below.
-- PRE-FLIGHT (in this file; refuses by name and changes nothing): the table, its sixteen columns with their types and
--   its primary key (location_id, time_entry_guid); 0233's two triggers, enabled; no function of this name yet
--   ("0361: already applied").
-- ASSERTIONS (after the create; any failure raises and the transaction keeps nothing): one overload; plpgsql, volatile,
--   SECURITY INVOKER, returns jsonb, its only setting the pinned search_path; owned by postgres; the WHOLE ACL is
--   postgres and service_role, both granted by postgres, no grant option, nobody else.
-- ROLLBACK: unset TOAST_LABOR_GUARD, redeploy, wait out the drain (the runbook). The function may stay installed,
--   unused. For completeness: drop function public.toast_time_entries_apply_newer(jsonb);
-- PROOF: scripts/sql-harness-0361.mjs (PGlite, the REAL 0224 + 0233 section A + this file; run in CI by
--   tests/toast-labor-0361-migration.test.ts); scripts/sim/toast-labor-0361-two-sessions.mjs (sim only).
begin;

do $$
declare entry text; tab text; col text; typ text;
begin
  if to_regclass('public.toast_time_entries') is null then
    raise exception '0361: missing public.toast_time_entries (0224). Refusing.';
  end if;
  foreach entry in array array[
    'location_id:uuid', 'time_entry_guid:text', 'business_date:date', 'employee_guid:text', 'employee_first_name:text',
    'user_id:uuid', 'job_guid:text', 'job_name:text', 'in_at:timestamp with time zone', 'out_at:timestamp with time zone',
    'hours:numeric', 'overtime_hours:numeric', 'auto_clocked_out:boolean', 'deleted:boolean',
    'source_modified_at:timestamp with time zone', 'pulled_at:timestamp with time zone'
  ] loop
    col := split_part(entry, ':', 1); typ := split_part(entry, ':', 2);
    if not exists (select 1 from pg_attribute a
                    where a.attrelid = 'public.toast_time_entries'::regclass and a.attname = col and a.attnum > 0
                      and not a.attisdropped and format_type(a.atttypid, a.atttypmod) = typ) then
      raise exception '0361: missing expected column toast_time_entries.% (%). Refusing.', col, typ;
    end if;
  end loop;
  if (select array_agg(a.attname::text order by k.ord)
        from pg_index i
        cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
       where i.indrelid = 'public.toast_time_entries'::regclass and i.indisprimary)
     is distinct from array['location_id', 'time_entry_guid'] then
    raise exception '0361: the primary key of toast_time_entries is not (location_id, time_entry_guid). Refusing.';
  end if;
  foreach entry in array array['toast_time_entries_link_user', 'toast_time_entries_link_lock'] loop
    if not exists (select 1 from pg_trigger g
                    where g.tgrelid = 'public.toast_time_entries'::regclass and g.tgname = entry
                      and not g.tgisinternal and g.tgenabled = 'O') then
      raise exception '0361: missing or disabled 0233 trigger %. Refusing.', entry;
    end if;
  end loop;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname = 'toast_time_entries_apply_newer') then
    raise exception '0361: already applied';
  end if;
end $$;

create function public.toast_time_entries_apply_newer(p_rows jsonb)
returns jsonb
language plpgsql volatile security invoker
set search_path = pg_catalog, public
as $fn$
declare
  r record;
  s record;
  v_received integer;
  v_walked integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_same_stamp integer := 0;
  v_older integer := 0;
  v_no_stamp integer := 0;
  v_n integer;
begin
  -- a. The payload's shape.
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'toast_labor_invalid_payload';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) as e(el)
              where jsonb_typeof(e.el) is distinct from 'object'
                 or nullif(e.el ->> 'location_id', '') is null
                 or nullif(e.el ->> 'time_entry_guid', '') is null) then
    raise exception 'toast_labor_invalid_payload';
  end if;
  v_received := jsonb_array_length(p_rows);

  -- b. 0233's link lock, shared, before any row lock.
  perform pg_advisory_xact_lock_shared(hashtextextended('toast-link', 0));

  -- c. One element per key (the greatest stamp, no stamp lowest, a tie keeps the later element), ONE ordered walk.
  for r in
    select k.*
      from (
        select x.*,
               row_number() over (partition by x.location_id, x.time_entry_guid
                                  order by x.source_modified_at desc nulls last, t.ord desc) as rn
          from jsonb_array_elements(p_rows) with ordinality as t(el, ord)
         cross join lateral jsonb_to_record(t.el) as x(
           location_id uuid, time_entry_guid text, business_date date, employee_guid text, employee_first_name text,
           job_guid text, job_name text, in_at timestamptz, out_at timestamptz, hours numeric, overtime_hours numeric,
           auto_clocked_out boolean, deleted boolean, source_modified_at timestamptz)
      ) k
     where k.rn = 1
     order by k.location_id, k.time_entry_guid collate "C"
  loop
    v_walked := v_walked + 1;

    -- d. Lock and classify the stored row FIRST (U2).
    select t.business_date, t.employee_guid, t.job_guid, t.in_at, t.out_at, t.hours, t.overtime_hours,
           t.auto_clocked_out, t.deleted, t.source_modified_at
      into s
      from public.toast_time_entries t
     where t.location_id = r.location_id and t.time_entry_guid = r.time_entry_guid
       for update;

    if not found then
      -- Case 1: only an ABSENT key proposes a row.
      insert into public.toast_time_entries (
        location_id, time_entry_guid, business_date, employee_guid, employee_first_name, job_guid, job_name,
        in_at, out_at, hours, overtime_hours, auto_clocked_out, deleted, source_modified_at, pulled_at)
      values (
        r.location_id, r.time_entry_guid, r.business_date, r.employee_guid, r.employee_first_name, r.job_guid, r.job_name,
        r.in_at, r.out_at, r.hours, r.overtime_hours, r.auto_clocked_out, r.deleted, r.source_modified_at, clock_timestamp())
      on conflict (location_id, time_entry_guid) do nothing;
      get diagnostics v_n = row_count;
      if v_n = 1 then
        v_inserted := v_inserted + 1;
        continue;
      end if;
      -- Another writer stored the key between the look and the proposal: lock what it stored and classify it.
      select t.business_date, t.employee_guid, t.job_guid, t.in_at, t.out_at, t.hours, t.overtime_hours,
             t.auto_clocked_out, t.deleted, t.source_modified_at
        into s
        from public.toast_time_entries t
       where t.location_id = r.location_id and t.time_entry_guid = r.time_entry_guid
         for update;
      if not found then
        raise exception 'toast_labor_row_vanished';
      end if;
    end if;

    if r.source_modified_at is null then
      v_no_stamp := v_no_stamp + 1;                                                   -- case 6
    elsif s.source_modified_at is null or r.source_modified_at > s.source_modified_at then
      update public.toast_time_entries t                                              -- case 2
         set business_date = r.business_date, employee_guid = r.employee_guid,
             employee_first_name = r.employee_first_name, job_guid = r.job_guid, job_name = r.job_name,
             in_at = r.in_at, out_at = r.out_at, hours = r.hours, overtime_hours = r.overtime_hours,
             auto_clocked_out = r.auto_clocked_out, deleted = r.deleted,
             source_modified_at = r.source_modified_at, pulled_at = clock_timestamp()
       where t.location_id = r.location_id and t.time_entry_guid = r.time_entry_guid;
      v_updated := v_updated + 1;
    elsif r.source_modified_at < s.source_modified_at then
      v_older := v_older + 1;                                                         -- case 5
    elsif r.business_date is not distinct from s.business_date
      and r.employee_guid is not distinct from s.employee_guid
      and r.job_guid is not distinct from s.job_guid
      and r.in_at is not distinct from s.in_at
      and r.out_at is not distinct from s.out_at
      and r.hours is not distinct from s.hours
      and r.overtime_hours is not distinct from s.overtime_hours
      and r.auto_clocked_out is not distinct from s.auto_clocked_out
      and r.deleted is not distinct from s.deleted then
      v_unchanged := v_unchanged + 1;                                                 -- case 3
    else
      v_same_stamp := v_same_stamp + 1;                                               -- case 4
    end if;
  end loop;

  return jsonb_build_object(
    'received', v_received, 'inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged,
    'skipped_same_stamp', v_same_stamp, 'skipped_older', v_older, 'skipped_no_stamp', v_no_stamp,
    'duplicates', v_received - v_walked);
end
$fn$;

comment on function public.toast_time_entries_apply_newer(jsonb) is
  '0361: the guarded writer of the Toast labor mirror. Stores a row only when no row is stored or Toast''s modifiedDate is later than the stored one; everything else is skipped and counted. Called by lib/toast/labor.ts only when TOAST_LABOR_GUARD=1. Service role only.';

revoke all on function public.toast_time_entries_apply_newer(jsonb) from public, anon, authenticated;
grant execute on function public.toast_time_entries_apply_newer(jsonb) to service_role;

do $$
declare v_fn oid; v_acl text; r text;
begin
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'toast_time_entries_apply_newer') <> 1 then
    raise exception '0361: expected exactly one toast_time_entries_apply_newer';
  end if;
  v_fn := 'public.toast_time_entries_apply_newer(jsonb)'::regprocedure;
  if not exists (
    select 1 from pg_proc p join pg_language l on l.oid = p.prolang
     where p.oid = v_fn and l.lanname = 'plpgsql' and p.provolatile = 'v' and not p.prosecdef
       and p.prokind = 'f' and not p.proretset and not p.proisstrict and not p.proleakproof and p.proparallel = 'u'
       and p.prorettype = 'jsonb'::regtype and p.pronargs = 1
       and p.proconfig = array['search_path=pg_catalog, public']) then
    raise exception '0361: the function is not what this file creates (plpgsql, volatile, SECURITY INVOKER, jsonb, the pinned search_path only)';
  end if;
  if (select p.proowner::regrole::text from pg_proc p where p.oid = v_fn) is distinct from 'postgres' then
    raise exception '0361: the function is not owned by postgres. Refusing.';
  end if;
  foreach r in array array['public', 'anon', 'authenticated'] loop
    if has_function_privilege(r, v_fn, 'EXECUTE') then
      raise exception '0361: % may execute the guarded writer (RPC escape). Refusing.', r;
    end if;
  end loop;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception '0361: service_role cannot execute the guarded writer. Refusing.';
  end if;
  select coalesce(string_agg(x.e, ',' order by x.e), '') into v_acl from (
    select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
           || case when a.is_grantable then '*' else '' end || '/' || a.grantor::regrole::text as e
      from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = v_fn) x;
  if v_acl is distinct from 'postgres=EXECUTE/postgres,service_role=EXECUTE/postgres' then
    raise exception '0361: the ACL of the guarded writer is not postgres + service_role (it is: %). Refusing.', v_acl;
  end if;
end $$;

commit;
