# PR: Persist structured ezCater orders and correct Eastern event dates (pass 1)

Evening ezCater events were assigned their UTC date: an October 8 event at 8:01 PM ET became October 9. Intake and refresh now publish through migration 0223's atomic apply RPC, which derives the Eastern date and stores structured items, amounts and permitted contacts. The proven base query remains independent of optional introspection-gated enrichment, so schema errors do not break intake.

Known orders refresh before nightly elapsed-event completion, within a bounded, fail-soft phase with its own heartbeat. ezCater remains in the existing completion loop. Pipeline detail displays structured order facts; `loadEzcaterOrderDetail` is available to the separately owned digest work. No digest files, Toast item links, depletion logic, or production data were changed.

## Implementation map

| Approved step | Review anchors |
| --- | --- |
| 1. Normalizer and API | `lib/ezcater/orders-shared.ts:55` (ET dates), `:96` (normalizer); `lib/ezcater/orders.ts:81` (probe-gated query), `:160` (base fallback); `lib/ezcater/client.ts:50` (bounded transport) |
| 2. Migration and ACL harness | `supabase/migrations/0223_ezcater_enrichment.sql:6` (current orders), `:39` (item snapshots), `:57` (contacts), `:78` (atomic apply); `scripts/test-ezcater-enrichment.sql:1` |
| 3. Apply library and audit vocabulary | `lib/ezcater/sync.ts:19`; `lib/audit-actions.ts:46` |
| 4. Webhook persistence | `lib/catering/ezcater-intake.ts:47` |
| 5. ET fix for both insert and refresh | `lib/ezcater/orders-shared.ts:55`; `supabase/migrations/0223_ezcater_enrichment.sql:131` derives the common insert/update date |
| 6. Nightly refresh before completion | `lib/ezcater/refresh.ts:10`; `lib/toast-sales-pull-run.ts:30`; `lib/jobs-registry.ts:23` |
| 7. Scoped detail reader and UI | `lib/catering/ezcater-detail.ts:25`; `components/catering/pipeline/EzcaterDetail.tsx:7`; `app/api/catering/pipeline/[id]/route.ts:28`; en/es labels in `lib/i18n/` |
| 8. Historical backfill | `scripts/ezcater-backfill.ts:10`; `tests/ezcater-backfill.test.ts:1` |

The approved three-pass plan is `docs/superpowers/plans/2026-10-08-ezcater-enrichment.md`.

Provider fees are aggregated only from schema-proven DELIVERY_FEE and MISC_FEE categories; discounts are separate. Missing category amounts remain unknown. Adjustments and POS fees are not folded into those totals. Once structured detail is present, the UI hides the obsolete marked machine-note summary and retains human notes verbatim.

## Validation

- `npm.cmd test -- --reporter=json --outputFile=.ezcater-test-results.json`: PASS, 313 files, 5,145 passed / 1 skipped / 0 failed (5,146 total). Temporary JSON report removed after recording totals.
- `npm.cmd run typecheck`: PASS, exit 0. The final fee-query nullable-type correction was followed by another passing typecheck and 16 passing enrichment query/fallback tests.

- Both CI Phase 2 discipline checks passed (0056 and 0215).
- `git diff --check`: passed.
- `npm.cmd run build`: FAILED at the existing Google Fonts DM Sans fetch, before build completion. The environment could not establish a connection to `fonts.googleapis.com`; production build is not verified.
- Migration/SQL harness: authored and inspected, NOT executed. No local `psql`; CC runs on the sim. Backfill was tested with synthetic mocks only, not executed against an environment.

```text
next/font: error:
Failed to fetch `DM Sans` from Google Fonts.
```

## Sim handoff (CC)

Use the approved sim connection privately, with `ON_ERROR_STOP`; do not paste credentials into the command packet. Migration 0223 is NOT applied by this work. The harness requires two active sim locations and rolls all fixture changes back.

```sh
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0223_ezcater_enrichment.sql
psql -v ON_ERROR_STOP=1 -f scripts/test-ezcater-enrichment.sql
```

The harness exercises denied authenticated contact/RPC access, effective grants, service-role RPC-only writes, identical-digest no-op, retained item history, failed-item transaction rollback, location binding, terminal stages, ET projection and contact preservation across a base-query fallback. CC's independent review and sim execution remain required; this implementation's checks are not cross-family approval.

After schema and provider-read validation in an approved environment:

```sh
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-backfill.ts
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-backfill.ts --execute
```

Dry-run performs DB reads only, prints operational identities/counts, and lists pre-September-4 Toast rings as unresolved. Execution requires exactly 66 distinct signed Order UUIDs in the fixed September 4 through October 8 receipt interval; differing counts require manifest review. A count check is not independent verification of those identities.

## Remaining verification and risks

- Live introspection was not run. Only fields supported by the actual runtime probe are requested; unavailable enriched facts remain null or preserve the prior enriched observation. The base query and subtotal/tip stay available. Validate real provider shapes before rollout (BC-030).
- The advisory lock serializes transactional apply, not provider fetches. Without an upstream revision, slower older fetches can arrive later; terminal stages remain protected. No lease/fencing/job system was introduced.
- Bounded refresh can defer work. Attempts rotate oldest-first, failures persist codes for retry, and the separate heartbeat reports failures/deferred work. Completion still runs, as explicitly approved.
- Review covered BC-001/004 (shop and role gates), BC-007/037 (atomic apply/idempotency), BC-008 (ET dates), BC-023 (RLS/ACL), BC-030 (provider evidence), BC-032/033 (read failures/transactional trail), BC-036 (terminal stages), and BC-043 (independent verification remains CC's).
- Passes 2 and 3 are deferred exactly as approved: normalized-code Toast evidence, mappings, shadow depletion, duplicate-lead checks, then gated depletion and D-1 production tests.

Branch: `feat/ezcater-enrichment`. Worktree: `C:\Users\conta\co-ops-reports-h1`. All changes remain UNCOMMITTED. No git writes, push, merge, deployment, live provider call, backfill execution, or production data access performed.
