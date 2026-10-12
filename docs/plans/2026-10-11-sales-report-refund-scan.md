# Sales report — stop the refund scan from timing out the page

Juan 2026-10-11: Mid-shift Pulse → Sales → "Full Sales report" lands on the error screen.

## Evidence (prod, 2026-10-11)

- Vercel runtime error on `/reports/sales`: `sales_report_daily: canceling statement due to statement timeout`.
  PostgREST requests run under `authenticator` with `statement_timeout=8s` (service_role has no override).
- `sales_report_daily(P Street, 2026-10-11, 2026-10-11)` measured 15.4 s, 11.0 s, 1.1 s, 1.6 s on repeat calls;
  `sales_report_facts` alone for the same window: 58–64 ms. The whole cost is the `refund_facts` CTE (0239).
- `refund_facts` joins ALL of the shop's `toast_order_latest_pointers` (90k rows for P Street) to ALL
  `toast_payments` (133,741 rows pass the payment-level filter) and `toast_order_checks` (153,814 rows),
  311k buffer hits + an external-merge sort spilling to disk, to return 0 rows.
- Why: payments-level filter `refund_business_date is null and sales_refund_cents is distinct from 0 and
  (... or sales_refund_cents is null)` matches every LEGACY payment (pre-0239 captures: `sales_refund_cents`
  null AND the check's `accounting` null). Counts: total 152,790 · dated refunds 59 · undated+null 133,742
  (all 133,742 have `accounting` null on their check, i.e. all legacy) · undated with refund evidence 0 ·
  `sales_refund_cents = 0` 18,989. The `c.accounting is not null` test that rejects them runs only after the join.
- The page has no catch for a generic RPC failure, so one timeout crashes the whole page (app/error.tsx).

## Rules

1. **Results must be identical.** Same JSON from `sales_report_daily` for every (location, window) — this is a
   performance change only. The three refund candidate conditions stay exactly as 0239 defines them:
   (A) `refund_business_date between p_from and p_to`;
   (B) `refund_business_date is null and sales_refund_cents is distinct from 0 and (refund_amount_cents is not null or refund_status in ('PARTIAL','FULL'))`;
   (C) `refund_business_date is null and sales_refund_cents is null and c.accounting is not null`
   — each still subject to: the location's latest pointer, `p.business_date <= p_to` for B/C, not deleted,
   and the same `sales_report_class(...) = 'sale'` test.
2. **Bounded cost.** Each candidate set must be reached through an index whose size does not include the
   133k legacy payments. Target: `sales_report_daily` for one shop × one day or 7 days under ~300 ms on prod.
3. **Graceful failure.** A statement timeout (Postgres 57014) or other RPC failure in the Sales loaders must
   render the existing `SalesUnavailable` panel for that shop (new code e.g. `sales_reads_timeout`, en + es
   string, plain-language: "Sales numbers took too long to load. Refresh to try again."), never the app error page.
   Keep 403/400 scope errors as they are.

## Data — migration `0247_sales_refund_candidates.sql`

Repo header style (AUTHORED, NOT YET APPLIED — GATE CC: sim first, then prod). In one transaction:

- Partial index on `toast_payments (snapshot_id, check_guid)` WHERE condition (B) at payment level
  (`refund_business_date is null and sales_refund_cents is distinct from 0 and (refund_amount_cents is not null or refund_status in ('PARTIAL','FULL'))`).
- For (C): the legacy rows are exactly the ones whose check has `accounting is null`. Choose the cheapest
  correct driver and justify it in a comment, e.g. a partial index on `toast_order_checks (snapshot_id, check_guid)
  WHERE accounting is not null` joined to payments with `sales_refund_cents is null and refund_business_date is null`
  (payments pkey prefix is `snapshot_id`). Do NOT update or backfill any existing row; NULL keeps meaning unknown.
- `create or replace function public.sales_report_daily(...)`: rewrite ONLY `refund_facts` as a UNION ALL of three
  disjoint, index-driven branches A / B / C (make them disjoint explicitly so no payment appears twice — e.g. C
  excludes rows that satisfy B's evidence clause; A requires a non-null date so it is disjoint from B and C),
  each then joined to pointers/orders/checks/dining options/channel map and filtered with the identical
  classification. Everything else in the function is byte-for-byte unchanged. Keep `security definer`,
  `search_path`, `stable`, and re-state the exact revoke/grant lines from 0239 (service_role only).
- `create index` inside a transaction is fine at this table size (no CONCURRENTLY).

## Code

- `lib/sales-reports.ts` `call()`: map Postgres `57014` (and a generic RPC failure) to `SalesReportError(503, "sales_reads_timeout")`
  (log a fixed code server-side, no payload). Make sure every Sales page that renders `SalesUnavailable` on 503
  (summary page, checks, catering) handles it; check `app/(authed)/reports/sales/**` and the export route's behaviour
  (an export may keep returning an error status — just not a crash).
- `components/reports-hub/SalesParts.tsx` `SalesUnavailable`: the new code's string, en + es.

## Tests

- Unit: `call()` maps 57014 → 503 `sales_reads_timeout`; page renders the unavailable panel (follow existing test patterns).
- Equivalence (SQL, for CC's prod dry run — write it as `docs/seed/check-0247-equivalence.sql`): inside a
  transaction, capture the OLD function's output for both shops over windows {today, yesterday, last 7, last 31,
  each of the last 3 months}, apply 0247, compare with the NEW output (`jsonb` equality), `raise exception` with
  'PASS' or the first mismatching (location, window). CC runs it on prod as a dry run.
- Keep the suite green (`npm test`), `npx tsc --noEmit`, lint.
