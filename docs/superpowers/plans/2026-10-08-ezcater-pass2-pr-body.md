# ezCater PASS 2 and catering shop transfers

## Plan summary

Implement atomic shop transfers first, then selection-level Toast links, item identity mapping, review diagnostics and comparison-only depletion. Preserve production history, enforce fresh transfer authorization and step-up, supply guarded operator scripts and rollback SQL harnesses. The detailed pre-build plan is `docs/superpowers/plans/2026-10-08-ezcater-pass2-build.md`.

## Behavior

Catering managers and level 8+ can move any pipeline lead to another active shop with a reason and fresh password confirmation. Lead, quote, order and outstanding prep-demand attribution move together. Existing production and consumed/released demand remain at their recorded shop. New demand/quote/order inserts bind to the current parent shop under a lock, including an insert that started from a stale pre-transfer read. W4b and digests read the moved attribution; digest code is unchanged.

ezCater sync now accepts the fetched caterer identity and resolves its active shop in SQL. Provider moves share the transfer event/audit transaction. A more recent manual move wins and raises a visible conflict. Refreshing the same provider identity does not advance reassignment evidence. Completed leads can be corrected without reopening their lifecycle.

PASS 2 links unique normalized codes only within the same shop and ±1 business day, at selection grain so one Toast ring can represent multiple ezCater orders. Item maps retain provider item/size identity and raw POS IDs; only an exact existing confirmed Toast identity establishes a mapping. Name candidates, missing mappings, ambiguous links and duplicate house leads become source-tagged review diagnostics. The new ledger compares recipe consumption with actual production, including D-1; nothing reads it into operational depletion.

## Change map

| Files / anchors | Change |
| --- | --- |
| `lib/destructive-actions.ts:39`, `lib/audit-actions.ts:46` | Register human `catering.pipeline.transfer_location` and observed `ezcater.location_reassigned`. |
| `supabase/migrations/0225_ezcater_pass2.sql:10` | Parent-lock insert binding; atomic transfer at line 31; provider arbitration at line 92; links/map/reviews/shadow tables at line 304; atomic shadow publisher at line 356; effective grant self-check. 0224 untouched. |
| `lib/catering/transfers-shared.ts:3`, `lib/catering/transfers.ts:15` | Closed reasons, role policy, fresh active-user authorization, Tier B step-up and transfer RPC. |
| `app/api/catering/pipeline/[id]/transfer/route.ts:8`, `lib/session.ts:262` | Validated POST and exact step-up-preserving endpoint. |
| `components/catering/pipeline/TransferLead.tsx:10`, `components/catering/pipeline/PipelineClient.tsx:453`, `app/(authed)/catering/pipeline/page.tsx:47` | Triggered 44px transfer UI, provider wrapper and authorized destinations; create options retain their existing scope. |
| `lib/ezcater/sync.ts:40` | Fetched caterer identity and observation timestamp outside semantic digest. |
| `lib/ezcater/pass2-shared.ts:4`, `lib/ezcater/pass2.ts:17` | Normalization, ambiguity handling, item probing, D-1 math and bounded/paginated reconciliation. |
| `lib/toast/capture-shared.ts:49`, `lib/toast/capture-reconciliation-shared.ts:11` | Retain per-selection code tokens without copying special-request free text. |
| `lib/toast-sales-pull-run.ts:92` | Nightly shadow phase and failure disclosure after existing capture/depletion. |
| `lib/catering/ezcater-reconciliation-shared.ts:1`, `lib/catering/ezcater-reconciliation.ts:9`, `app/api/catering/pipeline/[id]/reconciliation/route.ts:7` | Freshly authorized safe diagnostics, snapshot/shop filters, current link/shadow counts and explicit unavailable state. |
| `components/catering/pipeline/EzcaterReconciliationPanel.tsx:8` | Source-tagged review panel; conflicts/issues stay visible outside collapsed detail. |
| `lib/i18n/en.json:2`, `lib/i18n/es.json:2`, `components/catering/pipeline/shared.ts:47` | Transfer labels/errors and comparison diagnostics in both languages. |
| `scripts/ezcater-reassign-shops.ts:6`, `scripts/ezcater-shadow-backfill.ts:8` | Dry-run-first correction and historical comparison runners. |
| `scripts/test-catering-transfers.sql:1`, `scripts/test-ezcater-pass2.sql:1` | SIM-only, rollback harnesses for auth/grants, atomicity, attribution, manual precedence, completed moves and per-selection links. |
| `scripts/ezcater-pass2-schema.sql:1` | Reviewed schema source fragment, incorporated verbatim in 0225; do not apply separately. |
| `tests/catering-transfer-route.test.ts:1`, `tests/catering-transfer-step-up-path.test.ts:1`, `tests/catering-transfers.test.ts:1`, `tests/catering-transfers-lib.test.ts:1`, `tests/ezcater-reassign-shops.test.ts:1` | Transfer/correction validation, demotion, step-up, dry-run and manifest guards. |
| `tests/ezcater-pass2.test.ts:1`, `tests/ezcater-shadow.test.ts:1`, `tests/ezcater-reconciliation-loader.test.ts:1` | Matching, map evidence, D-1/nested recipes, publication, lost orders, diagnostics and read authorization. |
| `tests/ezcater-sync.test.ts:1`, `tests/ezcater-refresh.test.ts:1`, `tests/daily-catchup.test.ts:1`, `tests/toast-capture-pull-integration.test.ts:1`, `tests/step-up-tier-map.test.ts:1` | Existing integration fixtures/contracts updated for reassignment, nightly shadow and Tier B. |

## Verification

Final integrated commands (2026-10-08), both exited 0:

```text
npm.cmd test
Test Files  323 passed (323)
Tests       5224 passed | 1 skipped (5225)

npm.cmd run typecheck
tsc --noEmit — passed

git diff --check — passed (line-ending warnings only)
```

Earlier baseline: 315 files, 5,173 passed, one skipped. Tests emitted a non-failing sandbox warning that the global git ignore file could not be read.

`npm.cmd run build` was attempted and failed at the existing `app/layout.tsx` Google Fonts import:

```text
next/font: error:
Failed to fetch `DM Sans` from Google Fonts.
```

No local PostgreSQL engine/psql is available; SQL execution is not claimed. No browser or preview smoke was run. Cross-family code review follows this build, as dispatched. Integration checks covered BC-001/002/003/004/005 (authorization/redaction/step-up), BC-006/010 (paging), BC-007/037 (atomicity and races), BC-008 (ET dates), BC-009/036 (retired/lost rows), BC-014/018 (audit/i18n), BC-016/031 (attribution and multi-selection composition), BC-023/024 (grants/roles), BC-027/032 (failure disclosure) and BC-038 (migration-before-code).

## CC SQL and operator handoff

Apply 0225 before deploying this code; coordinate migration order with the owner of reserved 0224. On SIM only, using the operator's existing private connection configuration:

```sh
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0225_ezcater_pass2.sql
psql -v ON_ERROR_STOP=1 -f scripts/test-catering-transfers.sql
psql -v ON_ERROR_STOP=1 -f scripts/test-ezcater-pass2.sql
```

Both harnesses require the sim sentinel and roll back. After review and separately authorized schema application, inspect the correction manifest. Dry-run reads stored evidence only; it does not fetch provider orders or mutate anything:

```sh
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-reassign-shops.ts
# Requires exactly one candidate, reviewed identity 19f4e7a6, then refreshes its snapshot:
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-reassign-shops.ts --execute --expect 1

npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-shadow-backfill.ts --from 2026-09-04 --to 2026-10-08
# Replace N with the reviewed dry-run count (not assumed from the dispatch):
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-shadow-backfill.ts --from 2026-09-04 --to 2026-10-08 --execute --expect N
```

## Limits and remaining gates

- Historical Toast captures omitted special-request code tokens; those links remain unresolved unless a later capture supplies evidence. Names never auto-confirm a map.
- Unmapped options are explicitly queued; a mapped base item's shadow does not claim option consumption is complete.
- `current_day_sales_oz` is a whole-shop/SKU/day comparator repeated on item rows; never sum it across ezCater rows.
- Production has no catering-lead FK. Suppression follows recorded item/shop/event-day or D-1 evidence; transferred old-shop prep remains there, without guessing destination suppression.
- The sync contract has no upstream revision cursor. Provider location arbitration uses stored observations/signed receipts, not a fabricated provider revision.
- Some existing recipe/capture readers cannot abort mid-read. The bounded wrapper stops waiting, and aborted materialization cannot publish late.
- Migration/harness execution, real provider GUID evidence, cross-family review and a network-enabled production build/preview remain CC verification gates. No production reads, writes, provider calls, pushes, merges or commits were performed here.

Branch/worktree: `feat/ezcater-pass2`, `C:\Users\conta\co-ops-reports-h1`. All changes uncommitted.
