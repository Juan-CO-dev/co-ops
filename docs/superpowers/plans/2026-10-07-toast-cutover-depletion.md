# Toast cutover and complete depletion — implementation plan

Status: PLAN ONLY, awaiting CC's cross-family review and build re-dispatch. Launch target: Tuesday 2026-10-13. Base inspected: `0f48836e15e0e2b799ea46f9318c7e50af7dd42e`, branch `feat/toast-cutover-depletion`, dedicated clone `C:/Users/conta/co-ops-reports-h1`. No application changes, migrations, production access, commits, fetches, pushes, or merges in this dispatch.

## 20-line summary

1. Make order capture the sole Orders API ingestion path before launch.
2. Replace every operational events-ledger reader with published capture readers.
3. Preserve immutable snapshots and publish only complete, validated runs.
4. Extend selection capture with prices, menu-group identity, and schema version.
5. Resolve dining labels through cached config and reviewed sales_channel_map rows.
6. Preserve catering intake fields through a separate restricted projection.
7. Replace intraday full-day events pulls with bounded modified-time capture.
8. Commit incremental cursors only with successful atomic publication.
9. Re-capture T-1, T-2, and T-3 nightly and queue older changed days.
10. Persist explicit day coverage so successful empty days are not missing data.
11. Retain sales-to-prep-item-to-SKU attribution before aggregating SKU ounces.
12. Use logged production inputs for each logged prep item/day; otherwise use sales.
13. Share that decision across counts, inferred on-hand, receiving usage, and pars.
14. Exclude deleted, voided, and excess-food sales; refunds alone do not reverse food.
15. Fix pulse revenue by counting extended parent prices once.
16. Gate on shared-key parity plus explained legacy-only and capture-only differences.
17. Rebuild the completed backfill window into a versioned derived generation.
18. Keep mapping changes separate and provide a scoped unmapped-demand loader.
19. Remove legacy pulls and writers; retain their ledger read-only for evidence.
20. Validate fixtures, sim SQL, preview, budgets, and CC's read-only production gate.

## Confirm-before-authoring findings

| Evidence inspected | Finding and plan consequence |
| --- | --- |
| `docs/runbooks/toast-order-capture.md`, migration `0221_toast_order_capture.sql` | Both still say not applied; dispatch says 0221 is on prod. Dispatch is current operator evidence, not independently verified here. CC must check schema_migrations and stamp the header, never reapply 0221. Two-week shadow requirement cannot fit Tuesday: replace it with the explicit gate below. |
| Audit `depl-audit.ts` and adjacent `out.json` at the supplied scratchpad path | Read, not executed (script loads an env file). Output establishes unmapped/portion/poisoned-recipe gaps at both shops. The ~61% flattened-oz figure and EM 2026-08-03 observation are supplied audit-summary evidence, not numbers present in that JSON and not re-measured here. |
| `lib/catering/toast-sales.ts:127,166,466,681,934` | Legacy per-selection versions never retract an absent selection; materialization deletes then inserts in separate requests; item provenance is lost when flattened SKU totals are formed. |
| `lib/toast/capture.ts`, `capture-shared.ts`, `capture-runner.ts`, 0221 | Run membership FKs, RPC parameters, and normalizer bind one date. Incremental capture must support multiple dates explicitly. Existing published-pointer ordering is valuable and must survive. Existing snapshots cannot supply omitted price/catering fields. |
| `lib/toast/orders-shared.ts`, `capture-reconciliation-shared.ts` | Old walk stops at a note with no item; capture descends into its modifiers. Reconciliation must explain those differences, not silently discard descendants to force parity. |
| `lib/catering/toast-catering-scan.ts:91`, `lib/toast/catering-orders-shared.ts` | There is a THIRD order pull, independent of toast-sales. It also silently caps at 50 pages. It uses contact/delivery/special requests/headcount/void date absent from accounting capture. Full cutover must preserve these contracts. |
| `lib/counts.ts:899,2083,2159,2203`, `lib/receiving.ts:333`, `lib/dynamic-pars.ts:351` | Several independent direct-plus-production sums need one shared replacement. Row-existence watermarks cannot prove empty-day completion or contiguous coverage. |
| 0101/0102 production migrations, `lib/production.ts`, `lib/prep-consumption-graph.ts` | Production headers identify output_item_id; inputs are leaf SKU ounces. Do not depend on un-applied batch migrations or count prep_batch_sessions again alongside productions. |
| `lib/midshift-sales-shared.ts:62`, `midshift-sales.ts` | Modifiers currently add price a second time; zero-row dates return null and freshness comes from event rows. Both contracts change. |
| `lib/toast-sales-pull-run.ts`, `daily-catchup.ts`, cron routes, jobs registry/watch, `vercel.json` | Capture currently runs AFTER depletion/pars, and daily success depends only on legacy pull. Those semantics must invert; a maximum date is insufficient evidence that a requested date is ready. |

These are design inputs, not reasons to stop this authorized plan. Review decisions and external evidence needed before implementation/activation are identified below. Production schema, real provider payload shape, retention coverage, and deployed Vercel settings remain unverified in this session.

## 1. Target read contract and consumer inventory

Add server-only `lib/toast/capture-read.ts` and pure `capture-read-shared.ts`. Read `toast_orders_latest` using stable paginated location/date queries; expand selections from exactly the pointed snapshot, join checks by snapshot_id, and batch-resolve dining/config. No union with old events and no per-selection latest-version reduction across different order snapshots. Preserve `(location, order, check, selection)` keys. A missing selection in the newer full order disappears naturally. Never infer an entire absent order's deletion merely from a day response; retain its latest pointer until an explicit deletion or independently established source tombstone.

Return typed coverage (`complete`, `partial`, `missing`, `stale`), source generation/revision, completed-through instant, and rows; zero is a value only under complete coverage. All DB errors remain errors. Read one pinned published generation/revision across pagination, or detect revision changes and retry boundedly; do not assemble mixed snapshots while capture publishes. Keep existing role floors, location binding inside authorized loaders, and service-only data boundaries.

| Consumer / files | Today | Capture equivalent and required parity proof |
| --- | --- | --- |
| `lib/catering/toast-sales.ts` deriveSalesConsumption / salesConsumption; prep-demand/report callers | latest toast_sales_events, crosswalk, exclusions, recipe graph | Published selection DTO including item, quantity, ancestry, group, dining and flags. Preserve packages, assortment, modifier portions/removals and rounding on unchanged fixtures; separately pin intended deletion/channel changes. Inventory all salesConsumption callers during build. |
| materializeDailyDepletion / toast_daily_depletion and toast_daily_sales_signals | non-void legacy rows; aggregate direct/flattened SKU totals | Versioned derivation from pinned capture revision; item-attributed fallback rows and explicit coverage. Test empty/all-excluded/all-unmapped, interrupted replacement, late edits, and replays. |
| `lib/counts.ts` count drift, inferred/par-estimated on-hand, product allocation, counts tile, gaps/watermark | production_inputs plus direct_oz; events existence as coverage | Shared selected consumption plus manifest coverage, all since/between windows and product rollups. Pin count boundaries, null taint, two items sharing a SKU, and revoked production. |
| `lib/receiving.ts` loadSkuUsageRank | 30-day production plus direct_oz | Same selected consumption; identical fixture totals to counts for the same window; rank changes caused by newly counted fallback are intentional. |
| `lib/dynamic-pars.ts`, `dynamic-pars-shared.ts`, probes/walker and ordering consumers | direct/prod demand; flattened only detects unlit prep; events oracle | Selected daily demand and complete-day coverage. Revise production-dark suppression when sales fallback is valid; preserve product grain, lane-start protection, p90 floor and shadow-only mode. No auto-apply activation. |
| `lib/vendor-rhythm.ts`, ordering rhythm | vendor calendar/cutoffs, indirectly demand via pars | No direct events read found in rhythm. Keep cadence/cutoff math; test downstream demand on a complete zero, missing day, fallback-only history, and a product primary switch. |
| `lib/midshift-sales.ts`, `midshift-sales-shared.ts`; mid-shift loaders/UI | seven paginated date reads from events; max pulled_at; parent plus modifier price | Captured parents/checks and complete interval/day freshness. Unchanged units/checks parity; parent-price correction expected. Empty completed date = zero; missing = null. Add en/es copy if metric/coverage wording changes. |
| `lib/catering/toast-catering-scan.ts`, `lib/toast/catering-orders-shared.ts`, scan route | separate ordersBulk + dining fetch; classification by strings/exclusions | Read published capture plus restricted catering projection. Preserve idempotent external_ref, stranded lead retry, machine notes, money, promised date and void-after-out handling. Test deleted-before-seen and deleted-after-out; no reopening or erasing completed history. |
| `lib/toast-sales-pull-run.ts`, daily cron/catch-up | old pull then materialize/pars then shadow capture | Capture/coverage first, derive only eligible revisions, pars after successful publication. Per-location/date failure isolation; success cannot conceal capture/depletion failure. Empty completed day succeeds. |
| toast-sales-today pinger, refreshTodaySalesIfStale, closing confirm, on-visit, admin pull | old pull; manual additionally captures | One capture service: incremental for pinger/on-visit/closing, explicit date for admin repair. Preserve debounce, existing cron secrets and admin authorization. Test concurrent triggers issue one window. |
| jobs-registry/job-watch, admin ops-health and ops-health-shared | legacy row counts and independent optional capture heartbeat | Retain route/job names where needed for external scheduler compatibility, change meaning explicitly; incremental freshness, nightly date coverage and backlog monitored separately. Manual single-shop success cannot mask all-shop failure. |
| scripts/backfill-toast-orders.ts channel-seed; backfill-toast-depletion.ts; seed/33-drink-crosswalk-rows.ts | ledger labels / old derivation / old sales evidence | Seed labels from cached dining options; rebuild from capture; migrate seed evidence query or mark historical seed non-runnable. No operational events query remains. |
| capture-reconciliation.ts and history/sim tooling | old ledger shadow comparator | Only intentional read-only legacy consumers after retirement: gate/reconciliation and historical audit tools. Update simulation manifests and source guards; do not rewrite historical migrations. |

Repository closure search: `rg -n 'toast_sales_events|fetchToastOrders|ordersBulk|loadLatestVersions|sumSalesDirectOz|production_inputs|toast_daily_depletion' lib app scripts tests`. Review every result, including indirect reports, not just the known files above. Tests must assert that only capture/probe code invokes ordersBulk after retirement. Confirmed entrypoints include app/api/admin/toast-sales/consumption/route.ts and components/admin/catering/prep-demand/SalesTab.tsx for the consumption report, and app/(authed)/mid-shift/page.tsx for pulse and on-visit refresh; preserve their authorization/error contracts.

### Selection and catering field additions

Capture schema v2 selection allowlist: existing identifiers/flags plus `price_cents` (extended line), optional `receipt_line_price_cents`, `menu_group_guid`, `menu_group_name`, and selection dining-option GUID where present with order fallback. Use itemGroup from payload and existing menu resolver/cache for names; store resolved label provenance, not guessed names. Load caches once per shop with durable freshness across serverless instances; missing exclusion-critical config means degraded coverage, never silently bypass exclusions.

Add order capture schema_version, void timestamp and headcount. Keep accounting snapshots free of customer/contact/free-text notes. To retain existing catering behavior without a second fetch, propose a separately protected snapshot-linked catering projection containing only the fields already consumed by intake (contact, delivery, special requests). Publish it in the same run transaction; service-role only, no raw payload, no logs/fixture exports containing customer data. Preserve existing values when an older v1 snapshot lacks a projection; never clear contacts with fabricated nulls. CC must review this retention boundary before build. An in-memory side effect before capture publication is not an acceptable substitute (failed runs would create leads and retries would lose fields).

Old snapshots are immutable. Re-capture required reader windows with schema v2, including pulse baselines and all catering dates scanned, before flipping readers. Full historical enrichment can run via the bounded operator backfill. No price reconstruction from today's menu or silent zero for unavailable prices.

## 2. Incremental capture, budgets, and scheduling

Toast's API uses `startDate` inclusive and `endDate` exclusive for modification windows, not a query parameter named modifiedDate. Freeze the upper bound at request start (proposed 30-second lag); lower bound is the last committed successful upper bound minus a two-minute overlap. Advance the cursor to the frozen upper bound on a successfully published empty window too. Never advance on timeout, schema skip, rate limit, partial pages, or write failure. [Orders API contract](https://doc.toasttab.com/openapi/orders/operation/ordersBulkGet/).

1. Add per-location capture state: committed modified-through timestamp, attempt/cooldown, leased run with expiry and fencing token, and durable per-day dirty revisions. Bootstrap from a reviewed initial full capture plus an overlapping modification window beginning before that capture started. Do not initialize a cursor to now with no coverage proof.
2. Extend manifests with mode `business_date|modified_window`, window bounds, and mode-specific constraints. Keep existing day APIs compatible while introducing window page/finish RPCs. Run membership carries each order's actual validated business_date; replace date-equality run FKs with run/location constraints while retaining snapshot/location/date consistency. Never pass today's date into normalizeToastOrder for an old modified order.
3. Finish under lease fencing: validate every contiguous page and terminal short page, publish snapshots under existing source-modified ordering, advance cursor, and dirty affected original AND previous business dates atomically. Preserve source-version ties and content hash dedup. Failed/stale workers cannot publish or advance another worker's cursor. Repeat page mismatch fails; retry starts at page one of the same frozen window.
4. Use one shared limiter across pinger, nightly, manual and backfill, not one in-process queue per request. Respect Retry-After and account/restaurant cooldown. Proposed conservative historical spacing: 10 seconds, windows at most one month, with stricter actual response limits taking precedence. Toast documents historical ordersBulk spacing of 5–10 seconds; existing 250 ms spacing is not sufficient evidence of compliance. [Toast rate limits](https://doc.toasttab.com/doc/devguide/apiRateLimiting.html).
5. Pinger remains ~97 ticks/day/shop, not 97 full-day pulls. Capture current modifications once; catering scan consumes them without another API pull. Default inline capture cap: 30 seconds total per invocation with fair per-shop slices, request abort propagation and one short retry only if it fits. At deadline retain the last publication, expose stale age and leave durable work for the next invocation. Split large modification intervals into smaller COMPLETE subwindows rather than checkpointing unstable offset pages. Single overfull subwindows go to the bounded operator worker, visibly pending.
6. Nightly T-1 is mandatory; T-2 and T-3 re-capture are queued every night, not silently abandoned when T-1 consumes the budget. Prioritize T-1 before late-edit work, persist overdue jobs, drain with bounded pinger/catch-up slices or the approved operator script. Proposed nightly total ceiling 110 seconds with an explicit 120-second route setting to add (the pinger declares 120; nightly currently has no maxDuration): at most 40 seconds Toast capture, reserve 60 seconds derivation/pars and 10 seconds teardown/heartbeat. Stop scheduling new work early. Benchmark before enabling; lower budgets if actual deployment limits are smaller.
7. Capture timeout cannot hold depletion indefinitely: process already complete dirty days from the durable queue within the reserved budget. Do not materialize partial/newly stale revisions as current. Existing complete last-good days stay available with stale disclosure; pars for a requested dirty/incomplete day are skipped, not certified by `max(date) >= requestedDate`.
8. Incremental old-order changes dirty historical days beyond T-3. Nightly derives them too; future promised orders update catering but never closed-day depletion. Refund-only changes update accounting without negative food consumption. Full business-date captures do not advance the global modification cursor.

Vercel's documented Hobby ceiling with Fluid Compute is 300 seconds, but deployment mode/plan settings are not inspected here; retain tighter explicit budgets and verify actual settings with CC. No new frequent Vercel cron; use the existing external pinger and daily schedule. At two shops there are about 194 incremental shop windows/day (5,820 per 30 days), plus six nightly shop/day refreshes, paging, retries and config calls. If one invocation handles both shops, invocation count differs from window count. Gate on measured request/page counts, CPU/memory/duration and monthly extrapolation against the actual Hobby allowance; do not spend 30 seconds idle on each empty tick. [Vercel limits](https://vercel.com/docs/functions/limitations).

## 3. Complete depletion: one item/day decision

Preserve direct sales and raw flattened sales as separate diagnostic facts. Add item-attributed sales rows keyed by `(generation, location, business_date, prep_item_id, sku_id)` before SKU aggregation. Reuse graph loading once per pass, package mix and modifier semantics; no per-item database loops.

For shop L, day D, prep item I:

```
logged(L,D,I) = at least one LIVE production header with output_item_id I
               (superseded_at IS NULL and revoked_at IS NULL)
chosen(L,D,I,SKU) = logged ? SUM(that item's production_inputs.input_oz)
                         : sales_item_units * recipe_leaf_oz_per_item
effective(L,D,SKU) = direct_sales_oz + SUM_I chosen(L,D,I,SKU)
```

This is replacement for the WHOLE item/day, not max(production,sales), not a residual, and not a SKU-wide switch. Production-only items count even without sales. A partial batch still suppresses all sales fallback for that item/day, per Juan's ruling. A live malformed header with missing/null inputs is an explicit unknown/taint, not permission to fabricate zero or add sales on top. Revoking/superseding the last live production restores fallback. Never add the same inputs again in existing count/receiving/par callers.

Implement pure selection in proposed `lib/depletion-shared.ts` and a server batch loader `lib/depletion.ts`. Read live production evidence at query time against immutable sales attribution so late production saves/revokes immediately change the chosen lane; do not bake a forever-stale production boolean into sales rows. Return production_oz, sales_fallback_oz, direct_oz, unknown reasons, and source/coverage metadata. For multi-query coherence pin a DB read snapshot/RPC or validate revisions; a header and its inputs must be observed together. Batch-session records are evidence only through their canonical live productions, never a second depletion source.

Production headers already identify the output item even when their input recipe recursively flattens to leaves. Preserve that output-item boundary when matching sales attribution; do not globally suppress a shared leaf because another prep item was made. Add nested-recipe fixtures (A uses B), production for A only/B only/both, and document that recorded leaf inputs remain authoritative at their recorded output-item boundary; any duplicate operational recording is surfaced, not guessed away by an unrelated SKU switch.

Dates: Toast sales keep source business_date; logged prep uses the existing ET operational date derived from produced_at, with no UTC string slicing. CC verifies restaurant closeout-hour compatibility before activation. For count windows, preserve existing sales-day inclusion (`day > anchor business date`, through the end day) and production instant boundaries. Determine logged status from the whole relevant item/day, not only productions surviving the count-window filter; then include only production inputs in the requested instant window. This prevents a pre-anchor batch from causing post-anchor sales to be counted again. Inferred/daily demand windows use aligned ET day boundaries. Test DST with independently calculated successive midnights; current operationalDayUtcRange adds a fixed 24 hours and must not be reused blindly for DST windows.

Eligibility rules:

- Deleted/voided orders, checks, selections and their descendants contribute zero sales. `excess_food` orders contribute zero sales; keep captured accounting evidence. Deleted orders stop depleting: an intentional semantic correction from the old ledger.
- Refunds do not imply food returned; refund amounts never subtract physical units. Explicit void/deletion remains the specified exclusion.
- Resolve ALL catering dining aliases through reviewed sales_channel_map values after toast_dining_options lookup. `EZ Cater` and `Ezcater` resolve to the same channel/provider. Never classify providers with substring matching. Keep Unknown visible and avoid inventing a provider from the unverified thirdPartyProviderInfo shape.
- Use the mapped catering classification for the existing catering double-count exclusion; retain per-shop item/group/name exclusions and legacy global read semantics. Do not accidentally exclude ordinary third-party delivery. Record excluded units/channel reasons so mappings do not hide lost demand. Catering produced in CO-OPS still enters through production; unmapped external catering is a disclosed data gap, not a claim of total business coverage.
- Parent exclusion propagation must traverse the actual tree to completion, including note ancestors, not the current fixed three passes. Do not retain free-text note names in accounting selections.

Pulse: sum non-void/non-deleted/non-excess-food TOP-LEVEL extended selection price once, never multiply by quantity and never add nested modifier prices. Preserve all sales channels for the sales display; catering exclusions affect depletion, not store revenue visibility. Pin tax/discount treatment against a sanitized receipt before naming the metric; current `netCents` is documented as gross/pre-discount despite its name. Prefer explicit `salesCents`/translated wording if correction is necessary. Null/unavailable prices yield incomplete money coverage, not zero. Test $12 parent including $2 modifier => $12, quantity two extended $24 => $24, split checks, discounts, voids and refunds.

## 4. Derived history, coverage and migrations

Reserve 0222 for this reviewed contract; 0220 belongs to digests, 0221 must not be rewritten. Recheck live lineage with CC before authoring; split further numbered migrations only if CC reserves them.

Proposed 0222 scope:

- Add capture v2 fields/JSON validation, restricted catering projection, window manifests/state/leases, atomic page/finish publication and dirty-day work records as above. Index location/date and state due/lease lookups.
- Add immutable depletion generations, item/SKU attribution, and a per-location/date published generation pointer. Retain toast_daily_depletion aggregate shape via a reader/view or compatible derived projection, preserving direct_oz and flattened_oz meanings. Never relabel raw flattened_oz as already-selected consumption.
- Generation metadata includes capture revision, mapping/recipe fingerprint, algorithm version, computed_at, coverage/diagnostic counts, and success even with zero rows. Publication atomically swaps aggregate, attribution, signals and coverage; a failed write leaves the old generation visible. Refuse publication when source revision changed while deriving. Old generations remain evidence and support rollback.
- Only guarded service-role RPCs mutate pointers/leases/cache projections. SECURITY DEFINER with fixed search_path, explicit revokes from PUBLIC/anon/authenticated, least-privilege grants, deny-all RLS and explicit delete denies. Verify routine/column grants in sim. Do not give direct table UPDATE/DELETE for immutable evidence.
- Retire toast_sales_events service-role INSERT/UPDATE/DELETE permissions at final activation (separate final migration if needed). Retain SELECT only for scoped forensic scripts; no raw user-context access newly granted. New audit names go through the closed vocabulary registries; reuse existing observations where accurate.

Rebuild recommendation: YES, rebuild the entire successfully captured backfill window per shop (up to 12 months), including explicit empty days, into the new generation before it feeds demand. It fixes phantoms, missing fallback and catering-label errors; merely switching today's pull leaves poisoned baselines. Rebuild is safe as a replacement of DERIVED caches, conditional on CC reconfirming ZERO sku_count_events, shadow-only pars, and no applied par history requiring preservation. Do not delete production, audit, catering, receipt or count evidence. Retain applied par moves if any; recompute only re-derivable shadow outputs.

Historical recipe/mapping versions are not guaranteed: label the rebuild as a current-recipe estimate, store the fingerprint, and quantify coverage; do not claim reconstructed historical actuals. Invalid/unmapped recipes remain unknown. New mapping data later dirties/rebuilds affected history deliberately. CC inventories retention coverage per shop; absent Toast-retention periods stay explicit gaps, not successful zeros. Existing order v1 snapshots may support quantity math but cannot satisfy v2 money/catering gates without re-capture.

Build a staging generation and read-only comparison report first. Pause derived writers briefly for final pointer activation or use compare-and-swap on the captured revision; never rebuild in place while readers see half a day. No production writes are performed by the read-only gate script. Applying migrations, recapturing and publishing the rebuild are separate CC/Juan-controlled operator actions after review.

## 5. Phantom-aware cutover gate

Add `scripts/reconcile-toast-cutover.ts` (read-only by default and in prod) and pure reconciliation tests. Emit sanitized per-shop/day JSON with run/revision IDs, completeness, schema versions, counts and reason totals; no payload/contact data. Compare the latest legacy row PER `(location, check, selection)` with the pinned latest captured order selections, scoped to the same shop/date and comparable observation cutoff. Build a key intersection BEFORE item aggregation.

Pass requirements (all, not percentage-of-days):

1. Every required backfill shop/date has a complete terminal-page capture or an explicitly documented unavailable-retention gap excluded from demand. Every operating date in the recent demand/pulse window must be covered; any unexplained gap blocks. Include the EM 2026-08-03 empty-day audit case explicitly.
2. Shared eligible keys match item identity, quantity (absolute tolerance 1e-9), parent identity and normalized status. Price is exact cents where both schemas retain comparable prices. No unexplained shared-key differences; source edits after the old ledger froze require reasoned evidence, not a wider tolerance.
3. Report legacy_only and capture_only keys/units separately, never silently discard them. A removed selection phantom is supported by a completed latest order snapshot lacking that selection; known deletion/void/status changes and note-descendant walk differences get explicit buckets. Capture-only older history may be legitimate backfill; capped legacy pages need page evidence. A whole missing order without deletion evidence is unresolved. Every unmatched key must have a reviewed reason; raw aggregate equality is neither necessary nor sufficient.
4. Empty capture days are successful ingestion. Both sides empty with complete capture passes; old-only lines against empty capture need explanation. Empty response alone does not prove retention or that the store traded; only evidenced covered dates enter zero-demand denominators. Unobserved dates never pass by zero-equals-zero.
5. Independent fixture/replay and sanitized source checks prove deletions, excess food, price semantics, note descendants, channel aliases and provider shape. Old-ledger agreement cannot prove these corrected behaviors. CC verifies thirdPartyProviderInfo on a real payload locally; only a redacted shape/fixture enters the repo.
6. Derived arithmetic invariants pass: no item/day uses both lanes, totals roll up exactly within final rounding tolerance, two shared-SKU items stay independent, all unknowns remain disclosed, no open-day depletion. Compare old/new totals with reasoned deltas rather than requiring the known-understated total to match.
7. Sim SQL, full unit/build gates and preview pass; one successful all-shop nightly T-1/T-2/T-3 cycle plus repeated incremental cycles demonstrate cursor/no-change/late-edit recovery and budget headroom before the launch flip. This replaces the obsolete two-week requirement, not the correctness gate.

FAIL on any unknown discrepancy, incomplete required schema/window, cursor gap, unprocessed mandatory backlog, grant failure or missing evidence. A report includes full difference counts even when displayed samples are capped. CC owns evidence triage and final approval; no automatic flip on a numeric match. Target evidence/decision by Monday 2026-10-12; if red, report the exact failure and escalate launch readiness rather than bypassing the gate.

## 6. Green implementation sequence and verification

Each unit below is a reviewable branch step with relevant tests green. CC arranges the cross-family plan/code reviews; build agent never merges/deploys. Read local Next.js guides under node_modules/next/dist/docs before route/UI edits. No implementation begins in this dispatch.

1. Contract fixtures and pure functions: add synthetic v2 order/selection/channel/depletion fixtures and shared selectors. Add read-only gate script and scoped diagnostics DTO. Keep runtime callers on current source. Unit tests green.
2. Additive 0222 capture contracts/RPCs and v2 writer: preserve day-mode compatibility, add mixed-date incremental mode, publication/lease/cursor tests, and restricted catering projection. Run sim harness before production schema rollout; existing disabled/fixture behavior stays explicit.
3. New capture readers, coverage and atomic derived generations: dual-read ONLY in tests/operator shadow comparisons, not dual counting. Rebuild staging generation on sim fixtures. Do not flip live readers yet.
4. Switch consumers behind one reviewed source activation boundary: wire counts/receiving/pars/pulse/catering and all triggers together with the shared selector. Keep old implementation only during the unactivated transition. Run parity/correction, authorization and error tests; no independently flipped shop surfaces.
5. CC operator preparation: verify deployed schema/settings/provider shape, run v2 re-capture/backfill with limiter, rebuild staged history, execute read-only gate, record decision. Pending backfill workers using v1 must be drained/upgraded before v2 publication; a later-started v1 snapshot must not replace v2 required fields on equal modified time (enforce schema compatibility/version ordering).
6. Activate capture consumers and scheduler ownership coherently; verify full cycle/freshness, then delete doPull, loadLatestVersions, fetchToastOrders and catering fetchOrders, legacy change detection imports and writers. Retain shared date helpers only where used (move out of deleted module). Update tests instead of retaining legacy-only expectations.
7. Final retirement migration/grants, docs/spec amendments, job registry/health, scheduler runbook and source-closure checks. Deployment artifact for launch has one Orders API capture path; legacy is history-only. CC/Juan apply and verify final operator steps.

Tests to add/extend:

- `tests/toast-capture-{shared,runner,persistence,pull-integration,system-trigger,client-abort}.test.ts`: mixed dates, retry, overlapping runs, obsolete lease, 100/101/5,001+ orders, hard page cap failure, 429 Retry-After, auth/body/DB abort, no cursor advance before finish, equal modified time/schema upgrade and empty successful windows.
- `tests/toast-capture-reconciliation*.test.ts`: legacy phantoms, missing entire order, opposing item deltas, per-line versions, true empties vs no coverage, truncated diff samples, note descendants and status corrections.
- `tests/toast-sales-guards.test.ts`, toast modifiers/platter tests and new depletion selection tests: role/location bind, per-shop exclusions, channel aliases/Unknown, nested ancestor exclusions, shared SKU, zero/partial/full production, production-only, revoke/supersede, null input, rounding, count anchors, recipe changes and nested prep attribution.
- `tests/counts-sales-{window,taint}.test.ts`, dynamic-pars base/coverage/scenarios/run/walker, receiving usage tests: same consumption source everywhere, empty complete days, missing days, ET/DST boundaries, current-day guard, product primary flips and no automatic par activation.
- `tests/midshift-sales.test.ts`, toast-catering-orders, daily-catchup, job-watch/run, ops-health: corrected parent-only money, null-price disclosure, all-zero day freshness, catering field parity and deleted/void-after-out transitions, independent success semantics and deadline/backlog outcomes.

Sim has no Toast history: seed synthetic restaurant-bound orders through the real page/finish RPCs, not directly into latest pointers; replay full-day then incremental edit/remove/void/refund/empty windows. Seed minimal recipe/item/SKU/crosswalk and live/superseded/revoked productions. Mock HTTP transport ONLY at the boundary for automated unit/replay; current TOAST_FIXTURES mode deliberately skips persistence, so it is not evidence of SQL publication. Extend `scripts/test-toast-capture.sql` and add a depletion SQL harness; BEGIN/ROLLBACK, two shop identities, real role/grant checks, forced failure before finish, atomic empty replacement and generation race. Replay catering uses synthetic contacts and forbids email/external side effects. CC runs sim DB harnesses; builder does not connect to prod.

Build verification: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`, both discipline checks in `.github/workflows/build.yml`, and training trace check. Targeted tests first; full suite once the composed change is complete. CC preview smoke covers pulse, counts, ordering/pars, prep-demand and catering using the PR preview, never production-as-preview.

## 7. Retirement, rollback and mapping handoff

Keep toast_sales_events immutable/read-only for historical evidence. Delete operational writers and both legacy ordersBulk pulls. Update runbook activation/header truth, AGENTS/spec amendments that say flattened never counts, job-watch/registry/health comments and fixtures, pinger instructions, depletion backfill script and mapping seed tools. Preserve existing route URLs/secrets to avoid a hidden scheduler outage. Remove nightly legacy reconciliation dependency after gate approval so a frozen old ledger cannot make every later capture fail health checks.

Rollback recommendation: do NOT ship an automatic N-day old-pull fallback. It would reintroduce phantoms, duplicate Orders API work and incomplete depletion, contradicting the sole-source ruling. For seven calendar days retain the previous deployment artifact and old/new derived generations. Default kill switch stops capture publication/derived advancement, serves last-good capture with stale disclosure and suppresses unsafe pars; it does not silently return legacy data. CC may roll back the whole deployment only as an explicit incident decision, stopping new workers first and accounting for read-only legacy grants. Restoring old writer grants requires a reviewed forward migration, not an env toggle. Preserve capture cursors/snapshots throughout; after repair replay overlap windows and rerun the gate. Never delete new history to make a rollback look clean.

Mapping sprint remains separate data work with Juan: no automatic item/modifier confirmations, new recipes for snacks, guessed portions, pickle weights or tenant literals. Add proposed authorized `loadUnmappedToastDemand(actor, locationId, {from, through})` (in capture diagnostics or toast-sales) at existing sales-read floor with location binding. Return paginated/grouped item GUID + modifier flag + configured display name, quantity, last seen, reason (`unmapped`, `portion_needed`, `recipe_unresolved`, `package_issue`, `unknown_channel`), excluded status, coverage dates and captured revision. Keep identically named GUIDs distinct and shops separate. Include poisoned recipes even when mappings exist. CC can turn this loader into Juan's page later; no page or mapping writes in this scope. Expose total affected units and known calculable oz separately; never call unmappable oz zero or claim the mapping sprint is complete.

## Risks and open decisions (five maximum)

1. **Catering preservation/retention:** approve the restricted capture projection for existing contact/delivery/special-request needs. Default is preserve current functionality with scoped storage, no PII in accounting or diagnostics; cutting these fields is not an acceptable silent shortcut.
2. **Provider and money contracts:** CC supplies locally verified redacted provider shape and parent-price/receipt examples. Default remains Unknown when provider shape is unproven; activation of affected classification/money readers waits for evidence.
3. **Coverage and historical truth:** CC confirms completed 12-month retention coverage, required operating-day calendar, ZERO sku_count_events and no applied par moves. Default rebuild all supported closed days as current-recipe estimates, preserve gaps and unknown mappings. Backfill runtime is a launch risk, not justification for false zeros.
4. **Day boundaries and production attribution:** confirm Toast closeout hour aligns with ET prep dates and accept whole-item/day replacement even for partial prep. Default follows Juan's literal rule and stored output-item attribution; nested prep duplicate recording needs explicit evidence/diagnostics rather than a SKU-level heuristic.
5. **Operational budget and rollback:** CC confirms deployed Hobby/Fluid settings and shared account rate-limit headroom, and approves freeze/last-good rollback rather than legacy fallback. Default is bounded queued work with overdue alerts; deadline pressure never advances an incomplete cursor or bypasses the cutover gate.

## Plan-dispatch verification

- Inspected branch/HEAD and source/evidence above; no production/env reads or external writes.
- `npm test` initially could not launch because PowerShell blocked npm.ps1; `npm.cmd test` ran successfully: **276 test files passed; 4,786 tests passed, 1 skipped (4,787 total)**.
- No build/typecheck executed for this documentation-only dispatch; implementation commands above are future gates, not claimed results.
- Read back the persisted plan and inspect `git diff --check` / worktree status before handoff. Only this plan is intended to change. CC obtains the cross-family review and re-dispatches implementation.
