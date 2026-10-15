-- Migration 0253_cash_reports_toast_projected
-- AUTHORED 2026-10-14. NOT YET APPLIED — apply via MCP after review (sim first, then prod; BEFORE the B10 code deploys).
--
-- B10 (owner decision, final): the Cash Deposit page's "Projected (from Toast)" box PREFILLS from
-- Toast — that shop's Toast CASH payments for the business day — and stays editable. The saved
-- deposit records BOTH the Toast figure (and its as-of instant) and the typed figure, so a change is
-- visible later ("Changed from Toast ($X)" on the form and on the submitted view).
--
-- ── WHAT THIS FILE DOES ───────────────────────────────────────────────────────────────
--   1. cash_reports + toast_projected_cents bigint, toast_projected_as_of timestamptz. Nullable,
--      EXPAND ONLY: old rows stay null (= "no Toast figure was recorded"), no backfill, no default,
--      no policy change. RLS on cash_reports (0067) is untouched; every write path is service-role.
--   2. cash_toast_projected_facts(location, business_date) → jsonb: ONE round trip returning the
--      latest completed capture run's finished_at for that shop+day ("as_of") and the candidate CASH
--      payment/refund rows with their void/deleted flags. The SQL only BOUNDS the rows; the rule
--      that decides what counts is pure TypeScript in lib/cash-toast-shared.ts, pinned by
--      tests/cash-toast-projected.test.ts. Returning a single jsonb value means PostgREST's
--      1000-row cap never applies.
--   3. A partial index on toast_payments(paid_business_date) WHERE type = 'CASH', so the paid-day
--      read is bounded by the day instead of scanning every payment snapshot ever captured. The
--      refund-day read uses the existing toast_payments_refund_date partial index (0221).
--   4. submit_cash_report_atomic RE-EMITTED with two trailing params (default null) that land in the
--      two new columns. Byte-faithful to 0188 otherwise. The 0188 signature is DROPPED first: a
--      `create or replace` with a different argument list makes a second overload, and a 14-arg call
--      would then be ambiguous. Nothing calls the function today (0188 left it unwired on purpose,
--      tests/audit-flags-cleanup.test.ts pins that lib/cash.ts does not call it), so the drop has no
--      caller to break; lib/cash.ts's direct insert carries the two columns itself.
--
-- ── THE CANDIDATE ROWS (what the SQL bounds) ──────────────────────────────────────────
--   · this shop only, and only the LATEST snapshot of each order: toast_payments → toast_orders
--     (o.id = snapshot, o.location_id = shop) → toast_order_latest_pointers on (location_id,
--     order_guid) PK with p.snapshot_id = o.id (the 0242 dated-refund join shape).
--   · type = 'CASH'.
--   · payments: paid_business_date = the day. refunds: refund_business_date = the day (the refunded
--     order may be from an earlier day — the cash leaves THIS day's drawer).
--   · tip_cents / refund_tip_cents are NEVER selected: the form has its own Cash tips field.
--   · flags returned per row: payment_status, void_business_date, order deleted/voided, check
--     deleted/voided. The TS rule drops VOIDED/DENIED statuses (the 0232/0239/0247 set), any void
--     date, and deleted/voided orders or checks; a NULL status or amount is unknown, never voided
--     and never zero.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────────────────
-- Both functions are SECURITY DEFINER with a pinned search_path, executable by service_role ONLY
-- (revoked from public, anon AND authenticated: the staff JWT is a valid PostgREST bearer, 0189).
-- The cash page and /api/cash bind the location (lockLocationContext + the cash_report task gate)
-- BEFORE any call; this file widens nothing.
--
-- ── VERIFIED BEFORE AUTHORING (source, 2026-10-14) ────────────────────────────────────
--   · toast_payments / toast_orders / toast_order_checks / toast_order_latest_pointers /
--     toast_capture_runs columns: 0221 (+ 0239 added toast_payments.sales_refund_cents, unused here).
--   · cash_reports insert list: 0188 + lib/cash.ts, field for field, plus the two new columns.
--   · No checksum asserted; this session had no MCP access.

begin;

alter table public.cash_reports add column toast_projected_cents bigint;
alter table public.cash_reports add column toast_projected_as_of timestamptz;

comment on column public.cash_reports.toast_projected_cents is
  'B10: the Toast CASH figure for the shop+day, computed by the SERVER at save time (never client-sent). '
  'Null = no Toast figure was recorded (pre-0253 rows, or no completed capture run). projected_cents is what '
  'the key holder signed; a difference between the two is the "Changed from Toast" record.';
comment on column public.cash_reports.toast_projected_as_of is
  'B10: finished_at of the latest completed toast_capture_runs row for the shop+day when toast_projected_cents was read.';

create index toast_payments_cash_paid_date
  on public.toast_payments(paid_business_date)
  where type = 'CASH';

create function public.cash_toast_projected_facts(p_location_id uuid, p_business_date date)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'as_of', (
      select max(r.finished_at) from public.toast_capture_runs r
       where r.location_id = p_location_id and r.business_date = p_business_date and r.status = 'completed'),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'payment_guid', pm.payment_guid, 'amount_cents', pm.amount_cents,
               'payment_status', pm.payment_status, 'void_business_date', pm.void_business_date,
               'order_deleted', o.deleted, 'order_voided', o.voided,
               'check_deleted', c.deleted, 'check_voided', c.voided)
             order by pm.payment_guid)
        from public.toast_payments pm
        join public.toast_orders o on o.id = pm.snapshot_id and o.location_id = p_location_id
        join public.toast_order_latest_pointers p on p.location_id = o.location_id and p.order_guid = o.order_guid
         and p.snapshot_id = o.id
        join public.toast_order_checks c on c.snapshot_id = o.id and c.check_guid = pm.check_guid
       where pm.type = 'CASH' and pm.paid_business_date = p_business_date), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'payment_guid', pm.payment_guid, 'refund_amount_cents', pm.refund_amount_cents,
               'payment_status', pm.payment_status, 'void_business_date', pm.void_business_date,
               'order_deleted', o.deleted, 'order_voided', o.voided,
               'check_deleted', c.deleted, 'check_voided', c.voided)
             order by pm.payment_guid)
        from public.toast_payments pm
        join public.toast_orders o on o.id = pm.snapshot_id and o.location_id = p_location_id
        join public.toast_order_latest_pointers p on p.location_id = o.location_id and p.order_guid = o.order_guid
         and p.snapshot_id = o.id
        join public.toast_order_checks c on c.snapshot_id = o.id and c.check_guid = pm.check_guid
       where pm.type = 'CASH' and pm.refund_business_date = p_business_date), '[]'::jsonb)
  );
$$;

comment on function public.cash_toast_projected_facts(uuid, date) is
  'B10: candidate Toast CASH payment rows (paid that day) and refund rows (refunded that day) for one shop, '
  'latest order snapshots only, with void/deleted flags, plus the latest completed capture run finished_at '
  '(as_of). The counting rule lives in lib/cash-toast-shared.ts. Tips are never selected. service_role only.';

revoke all on function public.cash_toast_projected_facts(uuid, date) from public, anon, authenticated;
grant execute on function public.cash_toast_projected_facts(uuid, date) to service_role;

-- ── submit_cash_report_atomic, re-emitted (0188 + two trailing params) ────────────────
drop function public.submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz
);

create or replace function public.submit_cash_report_atomic(
  p_location_id        uuid,
  p_report_date        date,
  p_projected_cents    integer,
  p_drawer_total_cents integer,
  p_float_cents        integer,
  p_count_method       text,
  p_denominations      jsonb,
  p_cash_tips_cents    integer,
  p_on_shift           jsonb,
  p_over_short_cents   integer,
  p_deposit_cents      integer,
  p_over_short_note    text,
  p_actor_id           uuid,
  p_now                timestamptz,
  p_toast_projected_cents bigint default null,
  p_toast_projected_as_of timestamptz default null
) returns table (new_id uuid, superseded_id uuid)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_prior_id uuid; v_new_id uuid;
begin
  -- (1) Find and supersede the live row for this (location, date), if there is one.
  --     The compare-and-set on `superseded_at IS NULL` means a concurrent transaction
  --     that already claimed this row updates zero rows here and its INSERT then loses
  --     to cash_reports_one_live_per_day — one winner, and the loser's whole transaction
  --     rolls back rather than leaving a half-applied edit.
  update cash_reports
     set superseded_at = p_now
   where location_id = p_location_id
     and report_date = p_report_date
     and superseded_at is null
  returning id into v_prior_id;

  -- (2) Insert the new live row. A 23505 here (a genuinely concurrent submit that
  --     committed first) aborts the transaction, which un-supersedes (1) for free.
  insert into cash_reports (
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

  -- (3) The back-pointer. Unconditional now, not best-effort: it shares the
  --     transaction with the insert whose id it records, so it cannot be the one
  --     write that silently did not happen.
  if v_prior_id is not null then
    update cash_reports set superseded_by = v_new_id where id = v_prior_id;
  end if;

  new_id := v_new_id;
  superseded_id := v_prior_id;
  return next;
end $$;

comment on function public.submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz, bigint, timestamptz
) is
  'Supersede the live cash_reports row for (location, date), insert the new one, and write '
  'the back-pointer — in ONE transaction, so a failed insert cannot strand the day with no '
  'live report. The edit-window gate (closing_finalized), the totals (computeCashTotals) '
  'and the audit row stay in lib/cash.ts on purpose. Returns (new_id, superseded_id); '
  'superseded_id is null on a first submit. 23505 propagates for the caller to map to 409. '
  '0253: + p_toast_projected_cents / p_toast_projected_as_of (the server-read Toast figure, default null).';

-- REVOKE-FROM-PUBLIC (AGENTS.md): Supabase's default ACLs grant EXECUTE to anon
-- EXPLICITLY, so revoking from public alone is not enough. Verify after apply via
-- information_schema.routine_privileges.
revoke execute on function public.submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz, bigint, timestamptz
) from public;

revoke execute on function public.submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz, bigint, timestamptz
) from anon;

revoke execute on function public.submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz, bigint, timestamptz
) from authenticated;

grant execute on function public.submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz, bigint, timestamptz
) to service_role;

-- Post-apply posture check: nothing here may be executable by the PostgREST user roles.
do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('cash_toast_projected_facts', 'submit_cash_report_atomic')
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0253 unexpected function grant';
  end if;
  if (select count(*) from pg_proc where proname = 'submit_cash_report_atomic'
        and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0253 expected exactly one submit_cash_report_atomic';
  end if;
end $$;

commit;
