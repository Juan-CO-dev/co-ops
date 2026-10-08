# ezCater enrichment - approved three-pass build

2026-10-08 - Astra - branch `feat/ezcater-enrichment` - migration **0223**.
This replaces the original review draft with CC's APPROVED WITH CHANGES scope. PASS 1 only is authorized. Changes remain uncommitted; no git writes, provider mutations, production reads/writes, or migration applications.

## Binding corrections

- Nightly auto-completion works (75 completions since September 6, per reviewer evidence). No completion repair. ezCater stays in `completeElapsedCateringEvents`, with a backstop that skips pending cancelled/rejected/failed lifecycle events. Refresh known UUIDs best-effort BEFORE it; cancellations become lost even when the provider fetch fails. API failure/deadline does not globally gate completion.
- The real date bug is UTC slicing in intake and refresh. Derive `event_date` in America/New_York from the timestamp, including DST. Both writes now go through the same apply RPC, which independently derives the date.
- Historical scope is 68 distinct signed webhook UUIDs since September 4 (66 existing leads plus two accepted UUIDs from September 4 graphql_error deliveries). No verified list/search API exists. Dry-run lists all identities and both lead-less orders for review; execution refreshes existing leads only and never creates historical leads. Supply the reviewed count with --expect N; a mismatch refuses execution. Earlier Toast rings stay unresolved.
- Keep the proven `orderByID -> order(id:)` base query. Probe actual schema before a SEPARATE enriched request; unknown fields/errors fall back to base. Store subtotal/tip already present. Error diagnostics contain fixed codes only.
- `posItemId` is raw provider identity, NOT a verified Toast GUID.
- One SECURITY DEFINER apply RPC, advisory transaction lock by provider UUID, digest skip, atomic snapshot/items/contact/lead/stage-event publication. Failed syncs leave `last_sync_error` and pending lifecycle key for nightly retry. No job, lease, fencing, or cursor tables.
- Contacts use the existing catering rule: active shift lead+ at that shop, catering manager and level 8+ across shops. Fresh identity/membership check inside the service loader. No contacts in audit/log/diagnostics. Digest code owned by CO CC is untouched.

## PASS 1 - this PR

1. **Pure normalization + tests.** `lib/ezcater/orders-shared.ts`, `orders.ts`, `client.ts`; tests cover 7:59 PM/8:01 PM ET, summer/winter and DST boundaries, amounts, raw IDs, invalid dates, separate-query fallback, runtime schema gates and sanitized errors. Unsupported fields remain null. Enrichment field availability distinguishes absence/fallback from an explicit null.
2. **Migration 0223 + sim harness.** `supabase/migrations/0223_ezcater_enrichment.sql`, `scripts/test-ezcater-enrichment.sql`: one current `ezcater_orders` row/provider, historical items keyed by snapshot + ordinal with `is_current`, restricted contacts pinned to snapshot. Service reads tables but writes only through RPC; deny-all user RLS, effective ACL self-check. Harness rolls back, verifies authenticated denial, service grants, atomic rollback, idempotency, shop binding, terminal stages, ET dates and contact preservation. CC runs on sim after migration. No local SQL engine available.
3. **Apply library.** `lib/ezcater/sync.ts`: prevents live fixture writes, validates fetched caterer, stable semantic hash, one apply call; error marker uses same RPC. Audit action `ezcater.order_synced` registered first; metadata only identities/outcome.
4. **Webhook.** `lib/catering/ezcater-intake.ts`: durable sanitized receipt before provider I/O; every recognized lifecycle notification fetches and applies structured snapshot. Cannot return success if neither snapshot nor retry marker persisted. Existing lead human notes/assignee preserved.
5. **ET date fix.** No duplicated create/refresh UTC-slice path remains: normalizer ET helper and transaction ET derivation own both.
6. **Nightly refresh.** `lib/ezcater/refresh.ts`, `lib/toast-sales-pull-run.ts`, `lib/jobs-registry.ts`: T-2 through T+14 plus errored rows outside the horizon; oldest attempt first, maximum 100 candidates and 20 seconds, bounded requests + abort signal. Own `ezcater-refresh` heartbeat. Generic completion always follows the attempt.
7. **Detail + digest loader.** `lib/catering/ezcater-detail.ts` exports `loadEzcaterOrderDetail(actor, leadId)` for recipient-scoped digest callers. Snapshot-consistent item/contact reads with bounded retry. Pipeline detail API/UI renders ordered items/options/instructions, headcount, ET times, monetary totals and permitted contact overlay; en/es labels. No digest files edited.
8. **Backfill.** `scripts/ezcater-backfill.ts`: dry-run default, explicit `--execute`; no provider fetch/write in dry-run; UUIDs from verified webhook ledger only, deduped and parent-checked, fixed historical interval and expected count guard. Lists pre-September-4 Toast ezCater rings as `unresolved_pre_webhook_history`; no inferred identity mapping.

## PASS 2 - later, separate PR

- Normalized-code Toast links: uppercase, remove dashes, same location, business date +/-1 day. Unique match links with `evidence=normalized_code`; ambiguity goes to review. Per-selection links support multiple ezCater orders on one Toast ring.
- Item map and unmapped diagnostics; raw POS IDs remain unverified until that work.
- Shadow depletion ledger, comparison only.
- Duplicate-lead detection for ezCater and house `toast_catering` representing the same order.

## PASS 3 - later, separate enablement

- `EZCATER_DEPLETION_ENABLED` and recomputation from September 4.
- Production-aware D-1 tests: sales count unless prep is logged, including prep the day before event date.
- No depletion switch, historical inference before webhook coverage, or production enablement in PASS 1.

## Verification and handoff

**PR gate: apply fixed migration 0223 before merge.**

Required commands: `npm.cmd test`, `npm.cmd run typecheck`; targeted tests during implementation. Review `git diff --check` and Next build as a separate gate when locally available. Full outcomes and file:line map belong in `docs/superpowers/plans/2026-10-08-ezcater-enrichment-pr-body.md`.

CC sim commands (connection supplied privately by operator; never paste credentials):

```sh
# SIM ONLY: guards maya@sim.co-ops and removes the original sim-applied 0223.
psql -v ON_ERROR_STOP=1 -f scripts/sim-revert-0223.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0223_ezcater_enrichment.sql
psql -v ON_ERROR_STOP=1 -f scripts/test-ezcater-enrichment.sql
```

Backfill commands after reviewed schema application, in an approved environment:

```sh
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-backfill.ts
# Use N from the reviewed dry run (current evidence: 68); smoke one existing-lead UUID first.
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-backfill.ts --execute --expect 68 --uuid <reviewed-existing-lead-uuid>
# Verify the smoke result, event date, stage and contact name before full execution.
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-backfill.ts --execute --expect 68
```

Risks/gates: runtime probe has not been executed against the live provider in this dispatch; unsupported enrichment stays unavailable and base intake continues. Sim execution and real-schema grant evidence are CC's remaining verification. Transaction locking serializes apply, not provider fetches; absent an upstream revision field, a slower earlier fetch can arrive after a newer one (terminal stages cannot reopen). Bounded nightly work can defer orders; heartbeat reports that outcome and oldest-attempt ordering rotates the next run. The 68 count is reviewer-provided; dry-run must verify it before execution and supply it via --expect N. The two lead-less accepted UUIDs remain review-only. No customer data, credentials or raw GraphQL errors belong in the review packet.
