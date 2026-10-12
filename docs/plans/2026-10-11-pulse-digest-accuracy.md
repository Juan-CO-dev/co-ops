# Mid-shift Pulse + report digest — number accuracy (Juan 2026-10-11 audit)

An Opus auditor rebuilt Pulse, digest and Sales numbers from prod raw tables for 10-08..10-11. Pulse and the Sales
report agree on the basic register totals; these are the defects. Digest emails stay OFF (do not change
`digest_delivery_mode` or anything that sends); fix the composed numbers only.

## 1. Pulse "Pace vs a normal day" is biased low (P1)

`lib/pulse/baseline-shared.ts:~41-46`, `lib/pulse/sections.ts:~489-505`. Today's total covers only through the last
completed Toast capture, but the baseline (average of the last 4 same weekdays) includes the WHOLE current clock hour.
Evidence: P Street Sat 10-10 12:05 — last capture 11:37; Pulse ≈ $1,117 vs baseline $3,448 → "−68%"; comparing to
the same minute: $1,741 vs $1,784 → −2%.
- Compare like with like: the baseline must sum prior same-weekday sales for checks OPENED before the same
  time-of-day as the capture cutoff (the `captured_at`/finished_at of the latest completed capture used for today's
  total), NOT the clock. Use check opened time at minute precision (not whole hours). If the baseline data is only
  hourly today, prorate the cutoff hour linearly by minutes and say so in a code comment; minute-precision from
  check opened_at is preferred — check what the 0242 pulse read returns and extend it if needed (new migration
  `0249_pulse_pace_minutes.sql`, header AUTHORED NOT YET APPLIED — GATE CC; create or replace only the pulse read
  function(s) involved, restate grants exactly).
- If the latest completed capture is older than 20 minutes, show the pace as unavailable with "Toast sync is
  {n} min old — pace hidden" (en + es) instead of a number.
- Tests: cutoff mid-hour (baseline uses minutes up to cutoff), stale capture → hidden, no capture → hidden.

## 2. Digest "Net sales (pre-tax)" counts ezCater-linked Toast checks (P1)

`lib/toast/capture-pulse-shared.ts:~22`, `lib/report-digests-v2-shared.ts:~64-67` don't exclude
`ezcater_current_toast_links`; Sales report + Pulse do (Capitol Hill 10-08: digest $5,077.50 / 99 checks vs
Pulse/Sales $4,083.55 / 98). Apply the SAME classification as `sales_report_class` (ezCater-linked → not 'sale').
Prefer reusing the existing pulse/sales SQL read over re-implementing the rule in TS. Sales-per-labor-hour and
"vs last week" follow automatically. Rename the digest label to "Register sales (pre-tax, excl. ezCater)" (en+es).
Test with a linked check fixture.

## 3. Digest sales per labor hour while people are still clocked in (P2)

`lib/toast/labor-shared.ts:~223,231`: open shifts are excluded from hours but sales are full-day → inflated SPLH.
Withhold SPLH (same "unavailable" treatment as partial hours) when `openEntries > 0`. Test.

## 4. Pulse never warns on a missing check amount (P2)

`components/**/SalesSection.tsx:~27` keys the "totals are partial" banner on `coverage === "partial"`, impossible on a
one-day window. Pass `amountMissing` from `sections.ts:~502` into `SalesData` and show the banner when > 0. Test.

## 5. "Here now" drops someone clocked in across midnight (P3)

`sections.ts:~647-648` uses today's business date only. Also include open entries (no clock-out) from the previous
business date. Raise the unlinked list cap from 20 to 50 or show "+n more". Test.

## 6. Labels (P3)

- Pulse "Sales so far" sublabel: "Register checks, before tax · ezCater not included" (en + es) so the Full Sales
  report's "Sales (before refunds)" (which adds ezCater) is not read as a contradiction.
- Digest "Catering (pipeline)": label the basis ("ezCater total incl. fees/tax" vs the Sales report's subtotal) — one
  line of copy, no math change.

## Gates
`npm test`, `npx tsc --noEmit` (local `three` missing-module error is environmental), lint. Do not apply SQL.
Do not touch `lib/sales-reports*.ts`, `components/reports-hub/**`, `app/(authed)/reports/**` (parallel builds own them).
