# Sales report — accuracy + availability fixes (Juan 2026-10-11 audit)

Juan: "the hour x weekday doesn't even count the last hour… make sure all data we are providing is accurate and available."
CC + three Opus auditors checked every Sales tab against prod raw tables. Dollar totals reconcile; the defects are
presentation, missing names, availability and timeouts. Keep every existing number byte-identical unless listed.

## 1. Hour × weekday heatmap reads as "missing the last hour" (P2)

Data is complete (Capitol Hill closes 6 PM: last order opened 17:58 → column "17"; P Street closes 8 PM → "19").
Headers are 24h START-of-hour integers, so "17" reads as 5 PM and the 5–6 PM hour looks missing.
- `components/reports-hub/SalesHeatmap.tsx`: header label = 12-hour short label of the hour start, locale aware via
  the i18n formatter (en "10a", "11a", "12p", "1p" … "5p"; es use the same `formatHour`-style helper — add one in
  `lib/i18n/format.ts` if none exists, e.g. `formatHourShort(h, language)`), with a visually hidden / title full range
  "5–6 PM" (`reports.sales.heatmap.hour_range`). Cell aria-labels use the range too ("Sat, 5–6 PM: …").
- Trim columns to the span that has data: from (min hour with any check − 1, floor 0) to (max hour with any check
  + 1, cap 23) over the whole grid; if the grid is empty keep the existing empty state. Unknown-hour line unchanged.
- Definition copy (en + es): "Columns: the hour the check was opened (Eastern time), e.g. 5p = 5:00–5:59 PM."
- The Pulse heatmap ("Hour × weekday, last 4 weeks") — if it renders this component, it inherits the fix; if it has
  its own header code, apply the same labels there.
- Tests: label helper (0→12a, 12→12p, 17→5p, es variant), trimming (span + padding, empty grid), aria range label.

## 2. "Last 30 days" → "Sales numbers took too long" (P1)

Cause: prod is on a 1 GB instance; a cold 30-day `sales_report_daily` is 9.8 s (> 8 s statement timeout); the same
call warm is 0.43 s. The infra fix (bigger compute) is Juan's call. Code mitigation:
- `lib/sales-reports.ts` `call()`: when the failure is a statement timeout (Postgres `57014`, or the message contains
  "statement timeout") retry the identical RPC ONCE after ~250 ms, then fall through to the existing
  `SalesReportError(503, "sales_reads_timeout")`. No retry for other errors (keep current mapping). Tests: one
  timeout then success → data; two timeouts → 503; non-timeout error → no retry.
- `mapBounded`: after the first rejection, stop scheduling new items (pre-existing edge; avoids burning DB time
  after the page is already failing). Test it.

## 3. Servers tab: 70–78% of sale dollars show "Server not matched to a name" (P2)

Names come only from `toast_time_entries` (±1 day). Two unresolved groups:
(a) linked managers with no time entries (P Street gm 253 checks/$4,809; Cristian; Pete; Capitol Hill Keith…);
(b) Toast's online/third-party "system server" GUID (P Street 66% of the week's dollars; Capitol Hill 57%).
New migration `0248_sales_server_names.sql` (header: AUTHORED, NOT YET APPLIED — GATE CC: sim first, then prod;
`create or replace` of `sales_report_breakdown`, `sales_report_check_page`, `sales_report_check_detail` only, every
other byte unchanged, restate revoke/grant exactly as 0232):
- Resolution order for a server GUID's display first name: time-entry first name (existing) → else
  `toast_employee_links` (this shop) → `users` first name (FIRST NAME ONLY, never last name/email) → else null.
- A check whose server is still unresolved AND whose channel is not in-store (online / app / third_party / delivery
  per the facts' `channel`) gets the server bucket label key `online` → UI "Online / no server" (en) /
  "En línea / sin mesero" (es). In-store unresolved stays "Server not matched to a name (…xxxx)".
  Implement as a distinct breakdown key (e.g. `server:online`) so it groups as one row; drill to checks filters by
  "server unresolved and channel not in-store" — or, if simpler and exact, keep per-GUID rows but label the GUID row
  "Online / no server" when 100% of its window checks are non-in-store. Pick one, document it, test it.
- Exports: `server_first_name` filled with the same resolution; add `server_ref` (last 4 of GUID) to the checks export.
- `app/(authed)/reports/sales/checks/page.tsx:~113`: drill chip shows the resolved name (carry `serverName` in the
  URL from the Servers row, validated/escaped, or look it up) instead of passing null.
- Equivalence: breakdown totals (checks, cents) per row must be unchanged — only labels change. Add a SQL harness
  `docs/seed/check-0248-equivalence.sql` (repeatable read, old vs new for both shops × {yesterday, last 7, last 31}
  comparing sum(checks), sum(cents) per dimension and per check page row count; always raise PASS/first mismatch).

## 4. Today range says "Today so far: nothing captured yet" on tabs/checks/catering (P2)

`RangeCaption` receives `todaySoFar` but no `capturedAt` at `sales/page.tsx:~365`, `checks/page.tsx:~94`,
`catering/page.tsx:~119`. Load `latestCapture(...)` (export a safe wrapper from `lib/sales-reports.ts` that returns
null on error rather than throwing — a caption must never fail the page) and pass it. Test.

## 5. Checks export refuses at P Street beyond ~40 days (P2)

`SALES_EXPORT_MAX_ROWS` 10,000; P Street has ~21k checks / 90 days; export walks 100-row pages serially.
- Raise the checks export page size to 1,000 (the RPC's own max — check it and raise the cap in SQL in 0248 if it is
  lower, bounded ≤ 1,000), raise `SALES_EXPORT_MAX_ROWS` to 25,000, and set `export const maxDuration = 120` on
  `app/api/reports/export/route.ts`. Keep refusing (413) above the cap.
- Rename the checks CSV/PDF column `check_total` → `check_amount_pre_tax` (header label "Check amount (pre-tax)"),
  since it is pre-tax next to `sales_tax`. Update tests/snapshots.

## 6. Small label fixes (P3)

- Channels "not counted" table: gift-card row reads "Not mapped yet · gift_card". Add `gift_card` → "Gift card
  sales" (en) / "Venta de tarjetas de regalo" (es) to the channel labels in `SalesParts.tsx` / shared list.
- Item label: `0232:180` picks the alphabetically largest name; in 0248 make it the name from the most recent
  business date (ties → max). Fix the comment at `sales-reports-shared.ts:~398`.

## Out of scope (CC/Juan)
Supabase compute upgrade; 12-month accounting re-capture; P Street "Delivery" channel-map row; coverage badge on tabs.

## Gates
`npm test`, `npx tsc --noEmit` (the local `three` missing-module error is environmental), lint. Do not apply SQL anywhere.
