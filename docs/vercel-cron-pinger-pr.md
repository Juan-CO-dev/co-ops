# Move intraday Toast scheduling to Vercel Pro

The desktop scheduler outage stopped intraday sales capture, labor, who's-here reconciliation, late-refund discovery, and catering scanning. Vercel now schedules both intraday routes every ten minutes using `*/10 0-3,10-23 * * *` UTC. This covers 06:00 through 22:00 ET in EST and EDT. Digest reconciliation runs hourly all day (`0 * * * *`), including the 03:00 ET fallback.

All three routes use one timing-safe auth helper: Vercel `Bearer CRON_SECRET`, desktop `x-cron-secret: CATERING_SCAN_SECRET`, and legacy `Bearer CATERING_SCAN_SECRET`. The desktop header retains precedence; absent credentials fail with 401, and neither configured secret yields 503 before work.

The two intraday routes acquire an atomic database lease before any work. A lease lasts 330 seconds, spanning the 120s/300s function limits and UTC slot boundaries; a duplicate returns `skipped` without a success heartbeat. Claim errors fail closed. Failed/killed attempts recover after expiry. Digest retains its existing unique send claims, retry CAS and provider idempotency. Registry entries for sales, catering, labor and digest now point alerts at Vercel; intraday monitoring retains 06-22 ET, and digest monitoring covers all hours.

## Changes and evidence

| File | Change |
| --- | --- |
| `vercel.json:7` | Two intraday crons; hourly digest |
| `lib/cron-auth.ts:10` | Shared credential contract |
| `app/api/cron/toast-sales-today/route.ts:23` | Shared auth; route lease at line 29 |
| `app/api/cron/toast-catering-scan/route.ts:20` | Shared auth; route lease at line 32, after date validation |
| `app/api/cron/digest-tick/route.ts:26` | Shared auth, existing send claims retained |
| `lib/cron-route-lease.ts:9` | Bounded service-role claim call |
| `supabase/migrations/0243_cron_route_leases.sql:14` | Atomic conditional upsert, database clock, denied user grants |
| `lib/jobs-registry.ts:37` | Vercel source/cadences; all-day digest at line 47 |
| `lib/report-digests-shared.ts:29` | All-day digest monitoring window |
| `lib/job-watch-run.ts:21` | Preserve typed source-based alert instructions with all entries now Vercel |
| `tests/vercel-cron-routes.test.ts:1` | Auth matrix per route, duplicate/error behavior, extra UTC padding |
| `tests/cron-route-lease.test.ts:1` | Claim result, RPC errors and malformed replies |
| `tests/vercel-cron-schedule.test.ts:1` | EST/EDT and both DST transition days; watcher coverage; runtime limits |
| `scripts/test-cron-route-leases.mjs:1` | Isolated SQL expiry, grants, duplicate refusal and independent routes |

Existing digest, watcher and sales-budget tests were updated for the new scheduling/lease contract. Bilingual alert routing is exercised in `tests/job-watch-run.test.ts`.

## Concurrency, time windows and budgets

- Sales: route-wide lease covers capture, labor, modified discovery and who's-here. Existing capture claims/pointer writes, keyed labor upserts (`lib/toast/labor.ts:112`), modified cursor CAS and station RPC locks remain in place. Capture gets at most 45s, modified discovery at most 20s, labor at most 30s and who's-here at most 15s, all constrained by remaining route time. The 5s lease request is included in sales elapsed time. `maxDuration=120` remains aligned with `modifiedRouteBudget`'s 120s envelope.
- Catering: capture mode reads persisted sink health; the legacy scanner can append duplicate event rows under concurrent calls, which is why it also needs the route lease. Catch-up retains its existing atomic daily claims. `maxDuration=300` is unchanged.
- Digest: `lib/report-digests.ts:409` claims sends through the unique index; line 429 implements retry CAS. Existing concurrent-send tests remain in the suite. `maxDuration=300` is unchanged.
- Daily ET schedule coverage is 05:00-22:50 EST and 06:00-23:50 EDT. Neither intraday route rejects outside-window calls: they refresh dated snapshots, perform existing reconciliation, and claim only due catch-up work. No new nightly depletion work is introduced. The business date remains Eastern. Digest due decisions are also Eastern and safe throughout the day.
- All three limits fit [Vercel Pro function limits](https://vercel.com/docs/functions/limitations); [cron jobs share function duration limits and can overlap](https://vercel.com/docs/cron-jobs/manage-cron-jobs). Existing legacy scanner/catch-up and digest loops do not have aggregate application deadlines; their hard cap is Vercel's maxDuration. This change does not prove arbitrary load completes within that cap.

## Validation

- `npm.cmd test`: 434 files passed; 6,789 tests passed, one skipped; final exit 0. An earlier run passed 6,788 tests before the final alert-routing test was added, but PowerShell reported exit 1 after a git global-ignore permission warning. The final run used `cmd /d /c` to capture stderr directly and confirmed exit 0.
- `node scripts/test-cron-route-leases.mjs`: PASS. PGlite executes the actual migration locally; its queries serialize, so this is not a multi-session PostgreSQL stress test.
- `node node_modules/next/dist/bin/next typegen`: PASS. This fresh clone lacked generated `next-env.d.ts`; the first typecheck reported six pre-existing PNG-import TS2307 errors. Type generation restores the standard Next image declarations without a source change.
- `npm.cmd run typecheck`: PASS, exit 0 after Next type generation.
- `git diff --check`: PASS.
- No production requests, database changes, git writes, commits, pushes, merges or deployment. Production build/preview and CC review remain deployment gates.
- Local test/typecheck logs and failed review-seat receipts are archived in `.claude/astra-dispatches/vercel-cron-pinger/`.

## Cutover

1. CC/Juan review and apply **0243 before deploying the app**. It is authored and unapplied; without it both intraday routes fail closed. Validate role grants and simultaneous calls in the sim database first.
2. Confirm production `CRON_SECRET` is configured in Vercel; retain `CATERING_SCAN_SECRET` during cutover. Confirm Vercel Pro and deploy the reviewed branch through the normal CI/approval flow.
3. Verify **two scheduled Vercel runs of each intraday route** (allow 20-30 minutes during overlap). Confirm actual winning runs, `healthy` responses and sales/catering heartbeats, not just 200 skipped responses; verify labor heartbeat and who's-here/modified results when enabled. During overlap either caller may win the lease.
4. Verify the hourly digest heartbeat and its configured delivery mode. Then disable the CO desktop Task Scheduler task that invokes `C:\co\bin\catering-scan.cmd`. Leave compatibility auth in place for rollback.

Cross-family plan review was attempted through the [multi-seat-review skill](C:/Users/conta/.codex/skills/multi-seat-review/SKILL.md); GLM and DeepSeek both failed with sandbox socket error WinError 10013. No reviewer approval is claimed. CC must review the final diff. Self-checks covered BC-004 (both auth directions), BC-007/037 (atomic concurrency), BC-008 (timezone boundaries), BC-019 (read-before-authoring), BC-023 (RLS/grants) and BC-040 (claim failure paths).
