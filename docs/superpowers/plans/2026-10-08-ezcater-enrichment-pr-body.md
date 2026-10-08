# PR: Persist structured ezCater orders and correct Eastern event dates (pass 1)

Evening ezCater events were assigned their UTC date: an October 8 event at 8:01 PM ET became October 9. Intake and refresh now publish through migration 0223's atomic apply RPC, which derives the Eastern date and stores structured items, amounts and permitted contacts. The proven base query remains independent of optional introspection-gated enrichment, so schema errors do not break intake.

Known orders refresh before nightly elapsed-event completion, within a bounded, fail-soft phase with its own heartbeat. ezCater remains in the existing completion loop. Pipeline detail displays structured order facts; `loadEzcaterOrderDetail` is available to the separately owned digest work. No digest files, Toast item links, depletion logic, or production data were changed.

## Build pass 2 review fixes

| Finding | Review anchors |
| --- | --- |
| P1-1: actual event columns | `supabase/migrations/0223_ezcater_enrichment.sql:160` and `:259`: both inserts omit location_id. Every INSERT/UPDATE column checked against the lineage below. |
| P1-2: lifecycle without fetch + rollover backstop | SQL `:129` shares the transition guard; `:143` applies failed-fetch lifecycle moves. `lib/catering/system-intake.ts:126` skips pending cancellations; lookup failure defers ezCater only. `scripts/test-ezcater-enrichment.sql:60` and `:88`; `tests/catering-elapsed-completion.test.ts:54`. |
| P1-3: deploy ordering | `lib/catering/ezcater-detail.ts:25` returns null and logs a finite code; `lib/ezcater/sync.ts:16` recognizes missing RPC; `app/api/webhooks/ezcater/route.ts:38` returns 503 + Retry-After: 60, preserving provider retries. `tests/ezcater-webhook-route.test.ts:1`. |
| P2-1: reviewed backfill count + lead-less review | `scripts/ezcater-backfill.ts:12` parses --expect/--uuid; `:57` resolves existing leads; `:66` lists lead-less identities; `:86` gates execution. `tests/ezcater-backfill.test.ts:129` pins 68 UUIDs / 66 leads. |
| P2-2: retain date + diagnostic | SQL `:177` parses timestamps, `:185` returns timestamp_unparsed, `:198` retains the lead date. Harness `:65`. One-UUID smoke commands below. |
| P2-3: stale acceptance | SQL `:137` refreshes out/completed leads without illegal_transition; lost-to-confirmed and completed-to-lost remain conflicts. Harness `:154`. |
| P2-4: board/digest customer name | SQL `:190` and `:196` project the real contact name on creation and refresh; phone/email/address remain in the restricted contact table. Harness `:46` and `:153`. |
| P2-5: cross-shop reads | `lib/catering/ezcater-detail-shared.ts:16` records CC's ruling; `tests/ezcater-detail-policy.test.ts:21` pins catering_mgr and level 8 without memberships; board regression remains in `tests/ezcater-detail-loader.test.ts:79`. |
| P3: one receipt | `lib/catering/ezcater-intake.ts:74` updates the receipt and checks that a row returned; `tests/ezcater-intake-persistence.test.ts:32`. |
| P3: audits + transport codes | `lib/ezcater/sync.ts:20` restores create/stage_move audits from the RPC result; `:34` and SQL `:145` preserve timeout/network_error. `tests/ezcater-sync.test.ts:95`. |
| P3: snapshot ownership | SQL `:42` adds immutable snapshot ownership and composite FKs for items, contacts and the current pointer. Historical items retain their owner. Harness `:170` rejects cross-order items. |
| P3: healthy deferred nightly | `lib/ezcater/refresh.ts:35` distinguishes budget exhaustion from genuine failures; `:47` emits success after actual progress. `tests/ezcater-refresh.test.ts:128` covers the cap and subsequent tests cover deadline exhaustion. Backfill also counts sync_error even when a lifecycle move succeeded (`scripts/ezcater-backfill.ts:95`). |
| SIM-only recovery | `scripts/sim-revert-0223.sql:1` checks maya@sim.co-ops, exact migration version and original schema; drops only the original function/three tables and migration row. No CASCADE. |

Column audit: pipeline INSERT/UPDATE targets match 0108 (contact_name/stage/source/location/creator/date/headcount/updated_at), 0109 (estimated_revenue_cents), 0129 (time_window), 0148 (assigned_to), and 0149 (external_ref). Both pipeline-event INSERTs match 0110 after 0113 removed location_id; 0191 permits out. All order/item/contact/snapshot INSERTs, UPDATEs, and ON CONFLICT assignments match their CREATE TABLE declarations in revised 0223. No other mutation targets exist in the RPC. This is source-lineage verification; executing all branches on sim remains mandatory.

The approved three-pass plan is `docs/superpowers/plans/2026-10-08-ezcater-enrichment.md`.

Provider fees are aggregated only from schema-proven DELIVERY_FEE and MISC_FEE categories; discounts are separate. Missing category amounts remain unknown. Adjustments and POS fees are not folded into those totals. Once structured detail is present, the UI hides the obsolete marked machine-note summary and retains human notes verbatim.

## Validation

- Build pass 2: `npm.cmd test`: PASS, exit 0; 315 files, 5,173 passed / 1 skipped / 0 failed (5,174 total).
- Build pass 2: `npm.cmd run typecheck`: PASS, exit 0.

- Both CI Phase 2 discipline checks passed in the prior build pass (0056 and 0215).
- `git diff --check`: passed.
- Prior build pass: `npm.cmd run build` FAILED at the Google Fonts DM Sans fetch. Not rerun in this pass; production build remains unverified.
- Migration/SQL harness: authored and inspected, NOT executed. No local `psql`; CC runs on the sim. Backfill was tested with synthetic mocks only, not executed against an environment.

```text
next/font: error:
Failed to fetch `DM Sans` from Google Fonts.
```

## Deploy gate

**Apply fixed migration 0223 before merge.** Detail reads fail soft while the schema is absent; signed webhooks retain their receipt and return 503 with Retry-After for a missing apply RPC so ezCater retries.

## Sim handoff (CC)

Use the approved sim connection privately, with `ON_ERROR_STOP`; do not paste credentials into the command packet. The original 0223 was applied to sim as version 20261008063625; the sim harness failed on the nonexistent pipeline-event location_id column. CC must run the guarded SIM-ONLY revert, reapply fixed 0223, then rerun the harness. No migration was applied by this build pass. The harness requires two active sim locations and rolls all fixture changes back.

```sh
# SIM ONLY: guards maya@sim.co-ops and removes the original sim-applied 0223.
psql -v ON_ERROR_STOP=1 -f scripts/sim-revert-0223.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0223_ezcater_enrichment.sql
psql -v ON_ERROR_STOP=1 -f scripts/test-ezcater-enrichment.sql
```

The harness exercises denied authenticated contact/RPC access, effective grants, service-role RPC-only writes, identical-digest no-op, retained item history, failed-item transaction rollback, location binding, terminal stages, ET projection and contact preservation across a base-query fallback. CC's independent review and sim execution remain required; this implementation's checks are not cross-family approval.

After schema and provider-read validation in an approved environment:

```sh
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-backfill.ts
# Use N from the reviewed dry run (current evidence: 68); smoke one existing-lead UUID first.
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-backfill.ts --execute --expect 68 --uuid <reviewed-existing-lead-uuid>
# Verify the smoke result, event date, stage and contact name before full execution.
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-backfill.ts --execute --expect 68
```

Dry-run performs DB reads only, prints operational identities/counts, and lists pre-September-4 Toast rings as unresolved. Current evidence is 68 distinct signed Order UUIDs in the fixed September 4 through October 8 receipt interval: 66 leads plus two accepted, lead-less UUIDs from September 4 graphql_error deliveries. Both lead-less identities are listed as `leadless_review_required` and skipped, preventing past-dated lead creation. Execution requires `--expect N` from the reviewed dry run; differing counts refuse execution. Run `--uuid` for one reviewed existing lead and inspect its date, stage and contact name before the full backfill. A count check is not independent verification of those identities.

## Remaining verification and risks

- Live introspection was not run. Only fields supported by the actual runtime probe are requested; unavailable enriched facts remain null or preserve the prior enriched observation. The base query and subtotal/tip stay available. Validate real provider shapes before rollout (BC-030).
- The advisory lock serializes transactional apply, not provider fetches. Without an upstream revision, slower older fetches can arrive later; terminal stages remain protected. No lease/fencing/job system was introduced.
- Bounded refresh can defer work. Attempts rotate oldest-first; progressing deferral reports cron.success with deferred metadata, while genuine failures and zero-progress hangs alert. Completion skips signed pending cancellations; an unavailable marker lookup defers ezCater completion while other sources continue.
- Review covered BC-001/004/025 (shop and role gates), BC-007/037 (atomic apply/idempotency), BC-008 (ET dates), BC-022/023 (snapshot ownership/RLS/ACL), BC-030 (sim execution still required), BC-032/033 (read failures/transactional trail), BC-036 (terminal stages), BC-038/040 (deploy ordering/cold error paths), and BC-043 (independent verification remains CC's).
- Passes 2 and 3 are deferred exactly as approved: normalized-code Toast evidence, mappings, shadow depletion, duplicate-lead checks, then gated depletion and D-1 production tests.

Branch: `feat/ezcater-enrichment`. Worktree: `C:\Users\conta\co-ops-reports-h1`. All changes remain UNCOMMITTED. No git writes, push, merge, deployment, live provider call, backfill execution, or production data access performed.
