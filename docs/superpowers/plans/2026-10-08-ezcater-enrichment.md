# ezCater structured order enrichment — review draft

2026-10-08 · Astra · branch `feat/ezcater-enrichment` · migration **0223** reserved.

Scope of this dispatch: reconnaissance, this plan, existing regression tests, then STOP for CC's cross-family plan review. No application code, migration application, git writes, production reads, or provider mutations performed. Production token availability, ~157 notifications, July history, and ~12.6% MEP revenue are dispatch facts, not independently measured here. No credentials or customer records were read. Migration 0224 belongs to digest v2.

## Fifteen-line summary

1. Keep the existing ezCater GraphQL transport and expand its validated order projection.
2. Resolve provider UUIDs first; order codes are lookup evidence, never interchangeable UUIDs.
3. Store versioned structured orders and items under migration 0223.
4. Isolate contacts, addresses, and potentially identifying free text behind a restricted reader.
5. Allow customer PII only to active level 8+ users or an authorized catering manager.
6. Keep operational customer data internal; imported orders never imply marketing consent.
7. Drive one durable sync worker from signed webhooks, finished Toast capture, and nightly refresh.
8. Serialize fetch/apply per order; publish complete revisions atomically and make retries harmless.
9. Reconcile lifecycle to pipeline stages while preserving terminal history and manual ownership.
10. Repair the existing nightly completion path rather than add a competing completion job.
11. Feed catering details and recipient-scoped digests from structured items, not notes parsing.
12. Resolve item IDs through the actual `toast_menu_map`; name matches require review.
13. Add event-date ezCater depletion with source ownership that excludes duplicate Toast rings.
14. Backfill known UUIDs from July onward with durable checkpoints and explicit unresolved codes.
15. Gate enablement on schema evidence, PII-free real-shape fixtures, sim security tests, and review.

## Confirm-before-authoring findings

| Read reference | Finding / contract | Resolution |
|---|---|---|
| `lib/ezcater/client.ts`, `orders.ts`, `orders-shared.ts` | Named GraphQL `orderByID`; raw token authorization; default `.com` host; no deadline/retry policy. Subtotal/tip/line totals are fetched then dropped. Missing token silently selects fixtures. | Extend existing client; explicit production-disabled result, never persist fixture orders as live. |
| `lib/ezcater/webhook-shared.ts`, `app/api/webhooks/ezcater/route.ts`, `lib/catering/ezcater-intake.ts` | Signed notifications carry parent caterer UUID and entity order UUID. Intake stores item summaries in machine notes, placeholder contact name, and date via ISO slicing. | Durable ledger + jobs; provider/location validation; structured snapshots; operational timezone date. |
| `lib/ezcater/lifecycle-shared.ts` | `succeeded*` is advisory, not completed; accepted confirms, cancelled/rejected/failed lose. | Do not reinterpret event names without provider semantics. |
| `lib/catering/system-intake.ts`, `lib/toast-sales-pull-run.ts` | `completeElapsedCateringEvents` already completes prior-ET-day confirmed/out leads; wired before sales pull. Stage and event writes are separate. | Investigate cron/lead dates/errors; atomically reconcile ezCater stage+event; paginate rollover; retain Juan's elapsed-day rule with explicit provenance. |
| `lib/catering/toast-catering-scan.ts`, `lib/toast/capture-catering.ts`, `captured-day.ts` | Capture calls catering only after finish. ezCater rings are ledgered and refreshed, without a lead; old scan plan's stale-item limitation is no longer current. | Enqueue reconciliation from persisted finished capture, including recovery after post-finish failure. |
| `lib/catering/toast-sales.ts`, `lib/admin/toast-map.ts` | Actual crosswalk is `toast_menu_map`, not `toast_item_map`; supports menu item, prep item, package, SKU modifiers and portions. Captured sales already exclude catering/gift-card channels. | Preserve exclusions and existing recipe/production math; add ezCater ownership, not synthetic retail rings. |
| `lib/toast/effective-depletion.ts`, migration 0222 | Full-day manifests tied to capture run; production-aware item-path attribution; 0222 replacement RPC updates derived caches transactionally. | Source-specific ezCater coverage; one combined production-fallback decision; revision consistency checks. |
| `lib/report-digests.ts`, `report-digests-compose.ts`, `report-digests-engine.ts`, `report-digests-shared.ts` | Prep comes from quote demand, absent for these leads. Catering facts cached once across recipients; recipients include GMs and overrides below level 8. | Operational cache only; restricted overlay per actual recipient, including preview. |
| `lib/catering/pipeline.ts`, `pipeline-shared.ts`, `lib/roles.ts` | Pipeline has broadly readable contact columns; terminal completed/lost stages cannot be reopened. Catering manager is role `catering_mgr`, level 6. | Never copy new PII to generic pipeline fields. Role-code gate, not `level >= 6`. |
| migrations 0149/0222, audit registries, existing ezCater fixture | Notification ledger is not an order archive; 0222 has effective-grant self-check; current fixture cites documentation, not a verified live payload. | Separate normalized history, enforce grants, require sanitized live-shape evidence. |

Mismatches are surfaced in this plan for the requested review, not silently treated as build assumptions. The customer-profile plan named by the dispatch was not found by filename/content searches in this clone's docs. The consent and PII requirements below are binding defaults from the dispatch; CC must supply that plan before shared profile integration is authored. No live schema has been inspected: before SQL authoring/application, CC provides sanitized schema/grant/enum evidence from the relevant environment.

## API evidence and exact read calls

Verified against repository source and official documentation on 2026-10-08:

- [GraphQL transport](https://api.ezcater.io/using-graphql): named POST operations, `Content-Type: application/json`, raw `Authorization: <EZCATER_API_TOKEN>`, Apollo client name/version. Existing endpoint is `https://api.ezcater.com/graphql`; retain the configured hostname override.
- [Order details](https://catering.ezcater.io/en/articles/16948925-order-details): UUID lookup exposes contact/address, lifecycle, taxes, item prices/options, and fee filtering. The example does not establish customer email, payment status, source modification time, or completed-state semantics.
- [Orders API](https://catering.ezcater.io/en/articles/16948909-orders-api) and [notifications](https://catering.ezcater.io/en/articles/16948914-subscribing-to-order-notifications) establish the notification UUID → order query flow. No verified list-by-date or lookup-by-code operation was found. No documented numeric rate limit was found in the consulted sources/search; do not invent one.

**Call A, already implemented:** `POST /graphql`, JSON `{operationName:"orderByID", query:ORDER_BY_ID_QUERY, variables:{id:<provider-order-uuid>}}`. Exact existing query is `lib/ezcater/orders.ts:13`; retain all fields and persist currently discarded amounts. This is a GraphQL field `order(id: ...)`, not a REST `/orders/:code` endpoint.

**Call B, schema-only discovery, before extending selection:** same endpoint and headers, `operationName:"EzcaterSchemaProbe"`; no customer data:

```graphql
query EzcaterSchemaProbe {
  __schema { queryType { name } }
}
```

Then `operationName:"EzcaterTypeProbe"`, variables `{name:<returned-query-type-or-discovered-child-type>}`:

```graphql
query EzcaterTypeProbe($name: String!) {
  __type(name: $name) {
    name kind enumValues { name }
    fields {
      name
      args { name type { kind name ofType { kind name ofType { kind name } } } }
      type { kind name ofType { kind name ofType { kind name } } }
    }
  }
}
```

Follow returned field types for order, lifecycle, event, customer, totals, money, and fee arguments. Verify nullable fields, enum semantics, any order-number lookup, pagination, email, payment state, and timestamps against the token's actual schema. If introspection is disabled, obtain provider schema documentation; do not guess query fields.

**Call C, enriched detail:** after the schema check, extend Call A's named query to retain its current fields and select documented `uuid`, `lifecycle.orderIsCurrently`, event timezone/contact/address, `orderCustomer.fullName`, `totals.salesTax`, fee amounts, and customization identifiers. Request cart fee categories through separate GraphQL aliases, e.g. `discounts: feesAndDiscounts(types:[DISCOUNT]) { name cost {currency subunits} }`, with analogous aliases for DELIVERY_FEE, MISC_FEE and ADJUSTMENT. This uses documented fields while preserving category without inferring it from English fee names. Retain POS integration fee separately until inclusion in customer totals is reconciled. The exact additional email/payment/timestamp selection is intentionally **not specified until schema evidence exists**. No accept/reject/delivery mutation is part of enrichment.

Transport policy: configurable shared rate limiter, initially one request/second and one concurrent request across all jobs for this credential (conservative application policy, not a claimed provider quota). Bound each request to 15 seconds and the caller deadline; honor Retry-After; retry 429/5xx/transient transport errors with jitter and persisted next-attempt, at most five attempts before a surfaced retry state. 401/403 pause the credential lane; schema errors stop that query version. GraphQL errors poison the entire result, including HTTP 200 partial data. Log allowlisted codes only: current client embeds raw GraphQL error text and item names in errors and must be corrected before richer payloads arrive.

## Identity and data model — migration 0223

Use `0223_ezcater_enrichment.sql`, with authored/not-applied gate header. Propose these contracts for cross-family review:

- `ezcater_orders`: stable internal UUID, unique provider order UUID, provider caterer UUID, location FK, exact order code and conservative normalized lookup key, pipeline FK, current revision pointer, first/last successful sync times. Uniqueness on provider UUID; code is indexed with location, not assumed globally unique.
- `ezcater_order_revisions`: append-only normalized order observations keyed by order + semantic digest; event timestamp, handoff timestamp, timezone, derived event date, raw lifecycle value, normalized operational status (unknown/submitted/accepted/completed/cancelled/rejected/failed), completion basis, headcount, pickup/delivery/unknown, currency, nullable subtotal/tax/tip/fees/discounts/adjustments/total, payment status unknown unless verified, source-updated time if supported, fetched time and schema version. Current order projection exposes these fields through its revision. Keep source lifecycle distinct from locally inferred elapsed completion.
- `ezcater_order_items`: revision FK + stable source line UUID when present; deterministic revision-local ordinal otherwise. Name, quantity, line total, nullable unit price, POS item ID, size ID/name, structured option IDs/names/quantities. Never collapse identical-looking lines. Unit price derived from total/quantity is labeled an effective average, with decimal precision and no invented integer-cent rounding; actual unit price stays null unless supplied. Disappearance in a complete new revision supersedes an item; it never deletes history.
- `ezcater_order_contacts`: revision/location bound, restricted customer and event-contact names, phone, nullable email, structured delivery address. Potential PII in item special instructions, noteToCaterer, labels and delivery instructions goes in a restricted per-item/order text payload here, not common operational JSON. Keep operational DTOs free of that text. No raw full order JSON in logs/events/common tables.
- `ezcater_toast_links`: location + Toast order GUID + exact placeholder selection IDs → provider order UUID, evidence method, confirmation actor/time, active/superseded state; composite ownership constraints prevent cross-shop attachment and conflicting active order ownership. Permit multiple proven rings per provider order without counting the order twice.
- `ezcater_item_map`: location + provider POS/size/option identity (or reviewed name signature) → Toast GUID or explicit internal target, match state, quantity/portion conversion, review metadata. Config corrections deactivate/supersede; preserve history. Name matches only propose candidates.
- `ezcater_sync_jobs` and append-only attempts: order/caterer or unresolved code identity, trigger, requested generation, lease/fencing token, attempts, next run, sanitized result code. Coalesce pending requests; job completion must not erase a newer request generation. Backfill cursor/job tables use these same primitives.
- `ezcater_depletion_revisions` with per-line source provenance, SKU aggregates/item-path attribution, event date, mapping/recipe fingerprints and coverage revision; a current-day pointer publishes a complete generation atomically. Dirty-day jobs cover both old and new event dates after corrections. Keep these separate from Toast's capture-run completeness contract.

All new tables: deny-all user RLS, explicit insert/update/delete denials, revoke PUBLIC/anon/authenticated privileges. Service role SELECT plus narrowly scoped SECURITY DEFINER RPC execution, no general mutation grants for order history. RPCs use `SET search_path = pg_catalog, public`, qualified names, effective grants self-check matching 0222 (including inherited/column/default ACL and PUBLIC), revoke execute from PUBLIC/anon/authenticated, grant service_role only. Composite FKs/location checks bind every child, link and publication. Mutable pointers/jobs/config state are narrow RPC operations; historical rows remain append-only. No production SQL in this dispatch.

## Sync, lifecycle and cross-reference

1. Signed webhook: record receipt before processing, validate Order type, enqueue durably. Invalid signatures never enqueue/fetch. Return success only once notification and work are durable; DB failure remains retryable. Notification ID dedupes work while retaining receipt evidence. Unknown events trigger safe refresh, not guessed transitions.
2. Finished capture/scan: persist ezCater ring and enqueue identity reconciliation after capture finish. Use reviewed catering/ezCater classification, not any third-party order. Reconstruct work from persisted capture when the process dies after finish; debounce must not strand a failed catering sink.
3. UUID known from valid webhook or `catering_pipeline.external_ref`: fetch it. Code only: match exact code within shop against structured known orders after UUID hydration. Compare verified API code, caterer and event evidence. Do not strip punctuation/case unless provider evidence establishes equivalence. Multiple candidates or unknown code stays `unresolved_order_code`; never send `4WC-ypt` as a UUID or match on amount/customer name alone. A provider-confirmed code query can later replace this unresolved branch without changing ownership rules.
4. Worker claims per-order lease *before* fetching. Fencing token prevents expired workers publishing after a successor. Fetch latest full snapshot, verify provider UUID/caterer against known parent and `locations.ezcater_caterer_uuid`, normalize, apply one transaction: revision/items/contact/pointer/lead projection/stage event/dirty dates. Same semantic revision is a no-op. If source version exists, reject regression; without it, serialize fetch/apply and treat contradictory lifecycle evidence as review-required, never assume fetch timestamp is a source version.
5. Nightly enqueue known orders with event dates T-7 through T+90, unresolved/open jobs regardless of event date, and overdue nonterminal orders outside the window. This is a refresh horizon, not a completeness assertion. Drain bounded batches on an authenticated cron worker; remaining jobs survive deadline exhaustion. Register health/watch behavior and distinguish disabled, deferred, failed, successful. Incoming webhooks still refresh orders outside the window.
6. Provider accepted → confirmed; verified provider completed → completed; cancelled/rejected/failed → lost where transition law permits. Cancellation after out/completed is flagged for reconciliation, not silent erasure of served demand. Uncancelled terminal orders require review. Payment is independent: unpaid/refunded does not establish food consumption.
7. Preserve Juan's existing ET elapsed-day completion for confirmed/out. For ezCater, refresh first; on fresh accepted/noncancelled evidence, mark completed at next-day rollover with `completion_basis=elapsed_event_date`, never provider-completed. If refresh fails, show stale/needs-review rather than falsely claiming provider verification. Route ezCater candidates through this reconciler and exclude them from the generic completion loop in the same release. Other sources retain their rule. Paginate candidates and make stage/event changes atomic.
8. Diagnose observed stuck leads from PII-free cron outcomes, stage/date/source and null/invalid date counts. Existing ISO `.slice(0,10)` must become operational ET conversion. Reproduce a failed/missed cron, malformed date, stale event and partial stage-event write in sim before attributing the incident to one cause.

## Privacy, pipeline and digest

New contact reader verifies active identity fresh, then `(level >= 8) OR (role === catering_mgr AND permitted location)` inside the service-role library. Use actual membership/location authorization; manager auto-assignment's cross-shop fallback is not itself permission. Deny by default pending the customer-profile plan's resolution of cross-shop manager access. No credential/PII in audit, error, unmapped diagnostics or job metadata.

Keep generic pipeline contact fields as an order label for these new imports. Authorized pipeline loaders overlay real contact into returned DTOs; unauthorized callers receive operational order label/items/headcount/fulfillment only. Do not populate `catering_customers` with unrestricted duplicates to make UI convenient. When the shared profile plan lands, attach by provider identity with provenance and consent unknown/false; never fuzzy-merge by name or overwrite existing consent. Internal operational use only until explicit opted-in evidence exists; no marketing exports or sends from this work.

Digest loader batch-loads current order/items by pipeline FK (bounded 100-ID chunks and pagination), and includes unmapped items too. Keep ordered items distinct from derived prep load. Do not fabricate quotes, payments, or prep-demand reservations merely to render items. Existing quote valuation precedence remains; external order totals are separately labeled and not added again to Toast revenue. Payment unknown displays unknown, not paid/zero due.

`report-digests-engine.ts` currently shares facts across recipients. Cache only PII-free operational facts; add contacts separately per authorized actual recipient. GMs and low-level overrides get no contact, address or unrestricted notes. Preview destination must independently qualify; a pretend recipient's authority must not leak PII to the preview address. No contact bodies in digest-send logs. Detail and digest strings/ARIA labels ship in `lib/i18n/en.json` and `es.json`; date/time via existing helpers, source keys untranslated for matching.

## Depletion and exclusive ownership

Preserve `deriveCapturedSalesConsumption` catering exclusion. Retain sales money unchanged: exclusion is depletion-only. Store exact linked Toast order/selection provenance so future mapping corrections cannot reactivate a placeholder. Legacy depletion must also consult the identity exclusion before aggregation when enrichment is enabled; channel exclusion alone must not be the only guard across mode flips. Unlinked ezCater rings remain excluded and disclosed as unresolved coverage.

Map provider `posItemId` only after proving it is a Toast item GUID present at that shop; then use confirmed active `toast_menu_map`. Non-GUID IDs require a reviewed bridge, not a cast. Name+size candidates go to the existing mapping review experience with provider source, candidate status and an explicit approval action. Modifiers use posCustomizationId/option identity and reviewed quantity semantics; do not multiply an already-total option quantity by parent quantity again. Box lunches/platters require package composition and portions, not headcount as quantity. Ambiguous/free-text changes stay unresolved; no natural-language recipe guessing.

Refactor the mapping-independent consumption calculation out of `deriveSalesConsumptionFrom` so both sources feed typed mapped lines into the same menu/prep/package/SKU resolver. Load one recipe graph per shop/pass. Keep production-input subtraction and item-path attribution intact. Do not fabricate Toast GUIDs or insert external lines into Toast snapshots. Extend `unmappedToastItems` consumers to a source-discriminated unmapped collection: provider order/item references, non-PII catalog label, quantity, reason, suggested mapping. Preserve existing Toast compatibility while showing ezCater gaps in the same consumption diagnostics/UI.

Eligible external consumption: verified served/completed state or the reviewed elapsed-event completion, on the **event ET date**, once per provider order current revision. Future accepted orders are planning only. Cancelled-before-service orders contribute zero. Late refund/cancel after service retains served consumption pending reviewed correction. Mapping or event-date edits enqueue recalculation of old and new days, including historical days outside T-3.

Publish ezCater aggregates/attributions and coverage atomically with expected order-revision set, mapping fingerprint and fencing token. Read Toast source plus ezCater source under consistent revision identities; recheck before returning and disclose changed/missing generations. Merge direct amounts and item-path attribution **before** `selectSalesDepletion` so one production record suppresses fallback across both sources consistently. Do not add already production-adjusted totals twice. History can be enriched on a day with no Toast capture: keep ezCater coverage independent and disclose the missing retail source instead of treating absence as zero. Downstream pars retain their existing coverage eligibility; enrichment must not turn a partial day into a healthy full day.

Introduce `EZCATER_ENRICHMENT_ENABLED` and `EZCATER_DEPLETION_ENABLED`, initially off. Safe rollback stops external depletion and discloses disabled coverage while retaining snapshots and existing ring exclusions. Enable current-source composition for both capture and legacy readers together; explicitly test switching `DEPLETION_SOURCE` with the enrichment flag on. Historical estimates use current recipes/maps unless historical versions exist; label that limitation.

## Backfill and release sequence

1. Schema/semantics probe and approved customer-profile contract first. Create sanitized real-shape fixtures through a secure operator-side allowlist/redaction process; no raw payload in prompts or repo. Current doc-derived fixture is not proof of live fields.
2. After cross-family plan approval, implement pure normalization/identity/privacy contracts, migration 0223 and sim RPCs; then durable sync, pipeline/digest, mapping/depletion and backfill. CC coordinates digest-v2 shared-file ownership; this plan does not allocate 0224.
3. `scripts/backfill-ezcater-orders.ts` (new) defaults to dry-run, explicit `--from 2026-07-01 --to ...`, scoped locations, bounded batch size, and resumable run ID. Enumerate union of valid notification entity IDs, ezCater lead external refs and known structured order IDs; separately inventory code-only Toast rings. Include unknown-date UUIDs for discovery because filtering only lead event dates misses malformed/undated leads.
4. Keyset-page source rows; persist each candidate job before advancing cursor. Global rate limit covers webhook/nightly/backfill together; prioritize near-term operations. No duplicate lead when external_ref already exists. Refetch then resolve order date; latest provider state is not a reconstructable July revision history. Permission-denied/not-found/code-only candidates are retained as explicit unresolved outcomes, not silently skipped successes.
5. With no verified list/code API, July completeness cannot be promised beyond known UUIDs. Request provider UUID/code export or support-assisted discovery for gaps; do not parse human notes as authoritative identities. Read-only dry-run counts compare discovered, fetched, matched, ambiguous, inaccessible, completed/cancelled, mapped/unmapped and date coverage, with no PII.
6. Apply sim migration and ACL tests; run backfill twice, interrupt mid-page, crash after publication, replay cancellation/date change. Shadow depletion compares expected event item quantities and excludes ring quantities. CC/Juan own any production migration, credential checks, live fixture acquisition, backfill and enablement; this agent leaves reviewed code on a branch in a later dispatch.

## Implementation file map and tests

| Work | Existing files to extend; proposed new modules | Verification |
|---|---|---|
| API/normalization | `lib/ezcater/client.ts`, `orders.ts`, `orders-shared.ts`; new `enrichment-shared.ts` | Money/currency/nulls, invalid and partial payloads, line identity, option quantities, safe errors, strict fixture/live separation, retry/deadline tests. |
| Persistence/sync | 0223; new `lib/ezcater/enrichment.ts`, `sync.ts`; intake, webhook route, scan, capture-catering and nightly runner named above; new `app/api/cron/ezcater-sync/route.ts` | Duplicate and out-of-order deliveries; invalid signature; per-location binding; stale lease; lost wakeup; failed capture finish; crash between enqueue/apply; idempotent pipeline event. |
| UI/privacy/digest | `lib/catering/pipeline.ts`, report-digests loader/compose/engine/shared; `app/(authed)/catering/pipeline/page.tsx` and its detail components (read before edit); i18n | Active/deactivated level 8+, GM denied PII, scoped catering manager, unrelated level 6 denied, cross-shop, preview, shared cache contamination and serialized response assertions. |
| Mapping/depletion | toast-sales/admin toast-map/effective-depletion; new `lib/ezcater/depletion-shared.ts`, `depletion.ts`; `app/admin/catering/prep-demand/page.tsx` consumers | UUID bridge, duplicate names/sizes, unmapped options, package multipliers, no ring double count, cancellation/date shift, DST, production fallback and mode switches. |
| Backfill | new script above and `tests/ezcater-backfill.test.ts` | >1,000 rows, resumability, rate limiting, inaccessible/code-only orders, no raw console data, direct-invocation guard. |
| Audit/security | `lib/audit-actions.ts`, `lib/destructive-actions.ts`, migration ACL self-check | Register system `ezcater.order.sync`/`ezcater.sync.failed` as non-destructive; mapping approval/link correction actions destructive. Preserve registered pipeline action names; payload contains IDs/counts/codes only. |

Before code edits, read relevant installed Next 16 guides (`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `05-server-and-client-components.md`) and each component/reference actually touched. Pure `*-shared.ts` modules have no server imports; all provider/PII/DB modules are server-only.

Sim integration: deny SELECT/INSERT/UPDATE/DELETE/TRUNCATE and RPC execution for anon/authenticated, including real simulated session-bearing staff JWTs; verify service role cannot directly mutate immutable history, can execute intended RPCs, and cannot cross-bind locations through malformed args. Intentionally inject default grants to prove self-check fails. Verify row-count conflicts and transaction rollback (order/items/contact/stage event all-or-none), no history deletion, no PII in error/audit/log channels. Synthetic simulation only; never production test records.

Implementation validation commands: targeted new/affected tests, `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint -- <changed code paths>`, `npm.cmd run build`, then local/sim harness and authorized preview smoke. Cross-family code/security review via CC before any production step; include grant, data ownership, PII and dual-source depletion review.

### Verification performed in this plan dispatch

```text
npm test -- <targeted files>
FAILED before tests: PowerShell blocked npm.ps1 (execution policy).

npm.cmd test -- tests/ezcater-orders.test.ts tests/ezcater-location-bind.test.ts tests/ezcater-lifecycle.test.ts tests/ezcater-webhook.test.ts tests/report-digests-catering.test.ts tests/toast-effective-depletion.test.ts tests/toast-capture-persistence.test.ts
PASS: 7 files, 82 tests; 13.72 seconds.
```

No build/typecheck/sim/live API test claimed for this documentation-only dispatch. Git status confirmed the requested branch at origin/main with no initial changes; read-only git emitted a global ignore-file permission warning. This plan is the only intended change.

## Risks and questions for Juan / CC (maximum four)

Risks: API permissions/schema may withhold requested data; code-only historical orders cannot yet be fetched; completion source semantics may differ from webhook names; free text can contain PII; shared digest facts can leak contacts; backfill can correct historical depletion/pars; competing digest-v2 work needs file ownership coordination. Nullable unavailable fields and disclosed partial coverage are required, not invented completeness.

1. Can CC supply the customer-profile plan and confirm catering-manager cross-shop PII access? Default: level 8+ all authorized shops; catering manager only explicit memberships.
2. Can the ezCater account owner obtain provider UUIDs for July/code-only orders and confirm token access to both shops, email/payment fields and the actual rate quota? No credentials should be pasted.
3. Retain Juan's existing next-day completion rule after a successful refresh, and hold stale/unreachable orders for review? Proposed yes; never infer completion from `succeeded` alone.
4. Is July 1 the intended historical start, and should approved historical depletion corrections immediately affect historical reports/pars? Proposed: July 1 discovery, shadow comparison first, then explicit CC/Juan cutover.

Stop point: plan ready for cross-family review. No implementation authorized by this dispatch beyond this document.
