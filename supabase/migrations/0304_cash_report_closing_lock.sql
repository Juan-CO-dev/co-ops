-- Migration 0304_cash_report_closing_lock
-- AUTHORED 2026-11-14. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0188 and 0253).
-- Provenance: bug-audit wave W03 "Nightly cash report" (found at 7494f738): B041 (a cash edit in flight
--   when the closing is finalized still commits), B040 (the lock ignored `auto_finalized`) and B147
--   (the app's supersede had no compare-and-set, so a double submit broke the chain stamps).
--
-- WHAT:
--   submit_cash_report_atomic is RE-EMITTED with a new signature. 0188's 14-argument version never had a
--   caller (lib/cash.ts wrote cash_reports directly, pinned by tests/audit-flags-cleanup.test.ts and
--   0253's header), so it is DROPPED rather than left as a second, gate-less writer. The new function:
--     (0) THE EDIT-WINDOW GATE, IN THE WRITE TRANSACTION (B041). It locks EVERY closing instance the shop
--         has for the day FOR SHARE — joined to checklist_templates on type = 'closing', any version,
--         active or retired — then re-reads their statuses and refuses `closing_finalized` when any is
--         confirmed, incomplete_confirmed OR auto_finalized (B040). It deliberately takes NO template id:
--         review r1 showed that keying the lock on the caller's current-template resolution let a
--         night finalized on a since-retired V1 (V2 published, V1 deactivated) fall out of the lock —
--         the resolution returns V2 or nothing, and the gate went quiet. The finalized instances ARE the
--         lock; which version is current today does not matter. FOR SHARE conflicts with the
--         FOR NO KEY UPDATE an UPDATE of the status takes, so a confirm / release_overdue_closings that
--         commits first is SEEN (the lock waits, the re-read takes a fresh snapshot), and one that comes
--         second WAITS for the cash write to commit — the closing then finalizes over the edited
--         deposit, which is the order the people saw. FOR KEY SHARE would not conflict with a status
--         UPDATE and would close nothing. The status list is lib/cash-shared.ts
--         CASH_LOCKING_CLOSING_STATUSES (pinned equal by tests/cash-atomic-0304.test.ts).
--     (1) supersede with a compare-and-set on `superseded_at IS NULL` (B147): a concurrent submit that
--         superseded the same row first leaves this one updating 0 rows, and its INSERT then loses to
--         cash_reports_one_live_per_day (23505) — the whole loser transaction rolls back, so the prior
--         row's superseded_at / superseded_by always name ONE successor.
--     (2) the insert — 0188's column list plus 0253's toast_projected_cents / toast_projected_as_of, which
--         0253 deliberately left for "whoever wires the RPC";
--     (3) the back-pointer, unconditional (same transaction as the insert it records).
--   Totals stay computeCashTotals (lib/cash-shared.ts) and the audit row stays audit() in lib/cash.ts,
--   exactly as 0188 argued. Named refusals: `closing_finalized`, `invalid_payload`; 23505 propagates.
--
-- LOCK ORDER: the day's closing instances (FOR SHARE) → cash_reports rows. No SQL closing writer touches
--   cash_reports (only 0067 / 0069 / 0188 / 0217 / 0253 / 0272 name the table), so this adds no cycle to the
--   AGENTS.md checklist order (AM instance → closing instance → completion rows).
--
-- APP COMPATIBILITY: lib/cash.ts calls the NEW signature and, while it is missing (PGRST202 / 42883, i.e.
--   before this file is applied), falls back to its direct three-write path — which now carries the
--   auto_finalized gate and the compare-and-set too, so pre-apply behaviour is strictly better than today
--   but keeps B041's narrow race. Applying this file switches the writer to the transactional path with no
--   deploy. Rolling the app back is safe: the old app never called either signature.
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regprocedure('public.submit_cash_report_atomic(uuid,date,integer,integer,integer,text,jsonb,integer,jsonb,integer,integer,text,uuid,timestamptz)');  -- present (0188)
--   select column_name from information_schema.columns where table_schema = 'public' and table_name = 'cash_reports'
--     and column_name in ('toast_projected_cents', 'toast_projected_as_of');  -- both (0253)
--
-- VERIFY AFTER APPLY:
--   select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'submit_cash_report_atomic';  -- exactly ONE row, the 16-argument signature
--   select prosecdef, proconfig from pg_proc where proname = 'submit_cash_report_atomic';  -- t, {search_path=pg_catalog, public}
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name = 'submit_cash_report_atomic';  -- service_role (+ postgres) only
--
-- ROLLBACK: none needed for the app (it falls back on a missing function). Re-emit through a new reviewed
--   migration; never delete cash_reports history or undo supersession links.

begin;

-- ── PRE-FLIGHT: 0188's signature present, this file not yet applied, 0253's columns and 0067's index ──
do $$
begin
  if to_regprocedure('public.submit_cash_report_atomic(uuid,date,integer,integer,integer,text,jsonb,integer,jsonb,integer,integer,text,bigint,timestamptz,uuid,timestamptz)') is not null then
    raise exception '0304: already applied (the 16-argument submit_cash_report_atomic exists)';
  end if;
  if to_regprocedure('public.submit_cash_report_atomic(uuid,date,integer,integer,integer,text,jsonb,integer,jsonb,integer,integer,text,uuid,timestamptz)') is null then
    raise exception '0304: expected 0188 submit_cash_report_atomic signature';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'cash_reports'
         and column_name in ('toast_projected_cents', 'toast_projected_as_of')) <> 2 then
    raise exception '0304: 0253 (cash_reports toast_projected columns) must be applied first';
  end if;
  if to_regclass('public.cash_reports_one_live_per_day') is null then
    raise exception '0304: expected 0067 cash_reports_one_live_per_day';
  end if;
end $$;

drop function public.submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz
);

create function public.submit_cash_report_atomic(
  p_location_id           uuid,
  p_report_date           date,
  p_projected_cents       integer,
  p_drawer_total_cents    integer,
  p_float_cents           integer,
  p_count_method          text,
  p_denominations         jsonb,
  p_cash_tips_cents       integer,
  p_on_shift              jsonb,
  p_over_short_cents      integer,
  p_deposit_cents         integer,
  p_over_short_note       text,
  p_toast_projected_cents bigint,
  p_toast_projected_as_of timestamptz,
  p_actor_id              uuid,
  p_now                   timestamptz
) returns table (new_id uuid, superseded_id uuid)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_prior_id uuid; v_new_id uuid;
begin
  if p_location_id is null or p_report_date is null or p_actor_id is null or p_now is null
     or p_count_method is null or p_count_method not in ('hand', 'denomination') then
    raise exception 'invalid_payload';
  end if;

  -- (0) The edit-window gate, inside the write transaction (B041 / B040). EVERY closing instance this
  --     shop has for the day — whatever template version it hangs off, active or retired — not the
  --     version that happens to resolve as current (review r1: a night closed on V1 stays locked after
  --     an admin publishes V2 and deactivates V1, and no resolution can switch the gate off).
  perform 1 from public.checklist_instances ci
    join public.checklist_templates ct on ct.id = ci.template_id and ct.type = 'closing'
   where ci.location_id = p_location_id and ci.date = p_report_date
     for share of ci;
  if exists (select 1 from public.checklist_instances ci
               join public.checklist_templates ct on ct.id = ci.template_id and ct.type = 'closing'
              where ci.location_id = p_location_id and ci.date = p_report_date
                and ci.status in ('confirmed', 'incomplete_confirmed', 'auto_finalized')) then
    raise exception 'closing_finalized';
  end if;

  -- (1) Supersede the live row, compare-and-set on superseded_at IS NULL (B147).
  update public.cash_reports
     set superseded_at = p_now
   where location_id = p_location_id
     and report_date = p_report_date
     and superseded_at is null
  returning id into v_prior_id;

  -- (2) The new live row. A 23505 (a concurrent submit committed first) aborts the whole transaction.
  insert into public.cash_reports (
    location_id, report_date,
    projected_cents, drawer_total_cents, float_cents,
    count_method, denominations, cash_tips_cents, on_shift,
    over_short_cents, deposit_cents, over_short_note,
    signed_by, signed_at, entered_by,
    toast_projected_cents, toast_projected_as_of
  ) values (
    p_location_id, p_report_date,
    p_projected_cents, p_drawer_total_cents, p_float_cents,
    p_count_method,
    case when p_count_method = 'denomination' then p_denominations else null end,
    p_cash_tips_cents, coalesce(p_on_shift, '[]'::jsonb),
    p_over_short_cents, p_deposit_cents, p_over_short_note,
    p_actor_id, p_now, p_actor_id,
    p_toast_projected_cents, p_toast_projected_as_of
  ) returning id into v_new_id;

  -- (3) The back-pointer, in the same transaction as the insert it records.
  if v_prior_id is not null then
    update public.cash_reports set superseded_by = v_new_id where id = v_prior_id;
  end if;

  new_id := v_new_id;
  superseded_id := v_prior_id;
  return next;
end $$;

comment on function public.submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, bigint, timestamptz, uuid, timestamptz
) is
  '0304: the one cash_reports writer. Locks every closing instance the shop has for the day (any template version) '
  'FOR SHARE and refuses closing_finalized when one is confirmed / incomplete_confirmed / auto_finalized, then supersedes the live row (compare-and-set), '
  'inserts the new one (with the 0253 Toast columns) and writes the back-pointer, all in ONE transaction. '
  'Totals and the audit row stay in lib/cash.ts. Returns (new_id, superseded_id). 23505 = a concurrent submit won.';

revoke all on function public.submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, bigint, timestamptz, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, bigint, timestamptz, uuid, timestamptz
) to service_role;

-- ── POST-APPLY: one signature, definer + pinned search_path, service_role only, the gate in the body ──
do $$
declare
  f regprocedure := 'public.submit_cash_report_atomic(uuid,date,integer,integer,integer,text,jsonb,integer,jsonb,integer,integer,text,bigint,timestamptz,uuid,timestamptz)'::regprocedure;
  v_src text;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'submit_cash_report_atomic') <> 1 then
    raise exception '0304: submit_cash_report_atomic must have exactly one signature';
  end if;
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
     or not has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception '0304: RPC grant escaped on %', f;
  end if;
  if not (select prosecdef from pg_proc where oid = f)
     or not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
    raise exception '0304: % must be SECURITY DEFINER with a pinned search_path', f;
  end if;
  select prosrc into v_src from pg_proc where oid = f;
  if strpos(v_src, 'for share') = 0
     or strpos(v_src, 'status in (''confirmed'', ''incomplete_confirmed'', ''auto_finalized'')') = 0
     or strpos(v_src, 'and superseded_at is null') = 0 then
    raise exception '0304: submit_cash_report_atomic lost its closing lock, its status list or its compare-and-set';
  end if;
end $$;

commit;
