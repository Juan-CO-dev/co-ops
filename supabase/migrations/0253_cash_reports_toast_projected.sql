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
--   4. submit_cash_report_atomic (0188) is deliberately NOT touched. Nothing calls it (lib/cash.ts
--      writes cash_reports directly and tests/audit-flags-cleanup.test.ts pins that), so re-emitting a
--      live prod function nobody uses is risk with no benefit. lib/cash.ts's direct insert carries the
--      two new columns; whoever wires the RPC later adds them to it in that PR.
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
--   · cash_reports writers: lib/cash.ts's direct insert is the only live one (0188's RPC is unwired).
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

-- Post-apply posture check: nothing here may be executable by the PostgREST user roles.
do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name = 'cash_toast_projected_facts'
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0253 unexpected function grant';
  end if;
end $$;

commit;
