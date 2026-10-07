# Reports hub v2 piece 4 — granular Sales

Status: RECON + PLAN ONLY, 2026-10-07. Pending CC-arranged cross-family review and a separate build dispatch. No application code or migration authored in this dispatch. Branch `feat/reports-sales`, dedicated clone `C:/Users/conta/co-ops-reports-h1`, base `origin/main` / `d86618c85aaac01b5534eb2de9dc68a42f231145`. Never push, merge, deploy, or mutate production.

## Recommendation — 15-line summary

1. Build a historical Sales family at `/reports/sales`, with finished business days as the default.
2. Enforce level 6+ inside every loader; levels 6–7 see assigned shops, levels 8+ compare all shops side by side.
3. Keep shared URL range/compare, shop tabs, contextual page navigation, and keyset list paging.
4. Existing Toast storage supports recorded item/modifier quantities, check identities, raw dining labels, and menu-group breakdowns.
5. Existing selection prices are not sufficient to certify gross, net, refunds, tax, tips, or average check.
6. Do not reuse the pulse's `netCents` contract as financial truth; its comments and aggregation need reconciliation with Toast.
7. Add durable order/check/payment capture before claiming full financial or hourly reporting.
8. Capture order times, source/provider, discount details, refunds, service charges, categories, and employee references.
9. Preserve Toast business dates; bucket opened-time hours in America/New_York with DST tests.
10. Show discounts and comps without double subtraction; record refunds on their refund business dates.
11. Keep 0195 completed catering value separate from confirmed/out commitments and from POS net sales until linked.
12. Make every available number drill into the same filtered evidence, using check details now and order details after capture.
13. Share authorized read loaders and pure row projections with piece 3 CSV/PDF exports.
14. Use SQL aggregation and bounded paging; provisionally use migration 0221, authored only after CC confirms its reservation.
15. Ship neither fake zeros nor partial financial totals: expose missing capture, partial coverage, failures, and last successful capture.

## Evidence boundary and confirm-before-authoring

This is repository recon at the pinned base, plus official Toast API documentation checked on 2026-10-07. No production database, credentials, customer records, or live Toast payloads were accessed. Migration headers and source comments are evidence of intended/deployed history, **not a measurement of current production freshness**. CC must confirm writer operation, schema/grants, per-shop coverage, API scopes, closeout hours, and sanitized reconciliation fixtures before implementation is called production-ready.

The requested plan explicitly calls for surfacing missing capture. The mismatches below are recorded for the plan review; they do not block writing this document. They do block claiming the affected reports are buildable from current storage.

| Reference checked | Result | Resolution proposed for review |
|---|---|---|
| `app/(authed)/reports/page.tsx:88` | Matched: Sales is a level-6 coming-next card. | Replace only after a useful, correctly labelled Sales surface is ready. |
| `lib/report-scope.ts:3`, `lib/locations.ts:14`, `lib/locations.ts:47` | Matched: report cross-shop threshold is 8. Shared scope helper alone has only level-2 floor. | Add Sales level-6 floor before the shared shop guard; employee metrics additionally require 7. |
| `lib/report-range.ts:22`, `components/reports-hub/ReportRangeControls.tsx:6` | Shared ranges include today by default. | Sales wrapper resolves actual today, then excludes today from historical aggregation; do not pass yesterday as a fake today. |
| `lib/midshift-sales-shared.ts:10`, `lib/midshift-sales-shared.ts:32`, `lib/midshift-sales-shared.ts:57` | Mismatch: price comments disagree, null prices become zero, modifiers are added to parents. | No financial reuse until reconciled; legacy item/check reporting remains explicitly limited. |
| `supabase/migrations/0192_toast_catering_orders.sql:13` | Partial order table exists, only for classified orders. | Not a substitute for a complete order/check ledger. |
| `supabase/migrations/0195_catering_insights_money_split.sql:25` | Matched split, but values are quote totals/estimated revenue, not POS net. | Dedicated event-value section, never subtract from or add to POS net blindly. |
| Export piece 3 | Not present on this base; dispatch says in flight. | Agree the loader/row contract below with CO CC at build redispatch; do not invent a parallel export framework. |
| Migration numbering | 0219/0220 reserved by dispatch; no 0221 file found in this clone. | 0221 is provisional, confirm with CC before authoring; no apply in this task. |

## Recon: what is fetched, what survives, and what is fresh

### Regular Toast sales

| Data | Stored evidence / writer | Meaning and limits |
|---|---|---|
| Selection ledger | `supabase/migrations/0147_toast_sales_ingest.sql:10`; insert `lib/catering/toast-sales.ts:188` | `toast_sales_events`: location, requested business date, check/selection/parent IDs, item GUID/name, quantity, nullable price cents, inherited void flag, dining label, menu-group label, version, pulled time. Append-only selection versions. |
| Full source payload | `lib/toast/orders.ts:21`, `lib/toast/orders-shared.ts:37` | Fetches entire `/orders/v2/ordersBulk?businessDate=...` responses in 100-order pages, immediately flattens. No persisted general raw order/check/payment payload. General order IDs are dropped. |
| Pagination | `lib/toast/orders.ts:24` | Hard 50-page ceiling; full page 50 currently returns without an explicit incomplete flag. A financial capture must fail/mark incomplete at this ceiling, never publish a truncated day. |
| Versions | `lib/catering/toast-sales.ts:126`, `lib/toast/orders-shared.ts:107` | Latest version per check/selection within shop/day. Change detection covers quantity, void, price, name only; parent/item identity and dining/group changes alone do not append. No tombstone for a selection simply absent from a later response. |
| Item/modifier detail | `lib/toast/orders-shared.ts:48`, `lib/toast/orders-shared.ts:75` | Recursive modifier selections with immediate parent GUID. Itemless lines/subtrees are skipped (`:55`), so notes and possibly non-item adjustments are not an exhaustive check. Quantity is captured; retain source semantics, do not multiply modifier quantity by parent quantity without proof. |
| Money | `lib/toast/orders-shared.ts:63`, `lib/catering/toast-sales.ts:197` | Only selection `price` converted to cents. No gross/pre-discount amount, explicit discounts/comps, refund amounts, tax, tips, service charges, tender, deleted/deferred/excess-food flags. Boolean voids support recorded voided-line counts, not verified void dollars. |
| Dining/channel | `lib/toast/config.ts:15`, `lib/catering/toast-sales.ts:199` | Config `/config/v2/diningOptions` supplies names, GUID fallback on lookup failure. Behavior is discarded; no separate dining GUID column, provider, or order-source in the regular ledger. An arbitrary dining label cannot reliably prove DoorDash/UberEats/Grubhub/online. |
| Category | `lib/catering/toast-sales.ts:176`, `lib/toast/menus-shared.ts:24` | `menu_group` is a name joined from the current menu by item GUID (first duplicate GUID wins). It is not the order's item-group GUID or Toast sales category. Modifiers may have no group. |
| Menu cache | `supabase/migrations/0153_toast_menu_cache.sql:10`, `lib/toast/menus.ts:33`, `lib/toast/menus.ts:56` | Current raw menus payload cached by restaurant; 120s memo, metadata comparison, stale cache allowed. Useful for present labels, not historical category/availability truth. |
| Timestamps / employees | `lib/toast/orders-shared.ts:25`, `supabase/migrations/0147_toast_sales_ingest.sql:25` | No opened/closed/paid/fulfilled timestamps or POS server IDs. `pulled_at` is ingestion time, `created_by` is the CO-OPS pull actor, neither is an order time or selling employee. |
| Depletion | `supabase/migrations/0166_toast_daily_depletion.sql:22` | Per shop/date/SKU direct and flattened ounces, computed timestamp; **no sales money or order detail**. |
| Suspect-day signals | `supabase/migrations/0182_par_rhythm_and_ledger.sql:223` | Suspect check/quantity and counted quantity; heuristic inventory context, not a catering financial classification. |
| Exclusions | `lib/catering/toast-sales.ts:170`, `lib/catering/toast-sales.ts:681` | All flattened lines are ingested; exclusions apply later to consumption. Sales must not silently reuse depletion exclusions to remove legitimate POS revenue. |

Repository migration search found no general `toast_orders`, `toast_checks`, `toast_payments`, or independent financial item table. Other Toast tables are menu mapping/cache, exclusions, depletion, daily signals, and the limited catering table.

### Freshness and completeness

- Nightly: `vercel.json:3` schedules `/api/cron/toast-sales-pull` at **09:00 UTC** (05:00 EDT / 04:00 EST). `app/api/cron/toast-sales-pull/route.ts:35` computes yesterday from the Eastern calendar; a date override supports backfill. `lib/toast-sales-pull-run.ts:43` pulls each shop, then materializes depletion only for successful pulls (`:52`). Later depletion failure does not mean the sales pull failed. `lib/daily-catchup.ts:62` can catch up yesterday's job through the catering pinger path.
- Same day: `app/api/cron/toast-sales-today/route.ts:1` documents an external desktop scheduler every ten minutes during business hours; it is **not** a Vercel cron entry. `lib/catering/toast-sales.ts:327` applies an eight-minute debounce. Actual scheduler uptime is unverified here.
- Other triggers: `lib/catering/toast-sales.ts:280` names closing-confirm and mid-shift visits; `:319` gives visits a 45-minute debounce. All same-day paths write events only, not depletion (`:268`). Sales report reads must never invoke these triggers or Toast itself.
- `pulled_at` changes only when a new selection version is inserted. An unchanged successful pull writes an audit marker instead (`lib/catering/toast-sales.ts:184`, `:217`); `MAX(pulled_at)` means latest changed row, not latest successful sync.
- Debounce reads success **or failure** (`lib/catering/toast-sales.ts:365`); `fresh` means recently attempted. `pullSalesSystemTrigger` catches errors internally (`:296`), so the wrapper's `pulled` outcome is not itself success proof. Audit is fail-open. A cron success can also contain per-location failures. None is a transactional completeness manifest.
- Today/yesterday polling does not guarantee later refunds/edits on older orders are revisited. Rich capture needs a durable modified-time cursor and payment refund-date reads, not only T-1 polling.
- Unknown last success stays unknown. Existing days with rows are **recorded, completeness unverified**; no rows say **No sales recorded**, not $0. A successful empty-day marker in the proposed manifest can certify a real zero later.
- `lib/toast/client.ts:9`, `:37` allows fixture fallback when credentials are missing. New financial capture must record source mode and refuse fixture-origin promotion into real reporting. Do not run ingestion against this clone's fixtures and a real DB.

### Catering and ezCater

- `toast_catering_orders` stores order GUID, business date, source, dining label, classification, voided, promised/modified times, total cents, top-level item JSON, lead link and first/last-seen (`0192:13`). It also contains customer PII; Sales projections must not select it.
- `lib/catering/toast-catering-scan.ts:91` separately fetches ordersBulk; `:124` skips `not_catering`. `:131` writes only the limited summary. `lib/toast/catering-orders-shared.ts:94` extracts opened time and `:106` extracts provider but the writer drops both. Closed/paid times, payments, modifiers and financial breakdown are absent.
- `app/api/cron/toast-catering-scan/route.ts:1` documents the ten-minute external pinger; `:39` defaults to today and yesterday. Crucially, already-seen ezCater/third-party rows update only last-seen, voided, modified time (`lib/catering/toast-catering-scan.ts:137`), so their `total_cents/items` may remain stale despite a recent last-seen time.
- `lib/toast/catering-orders-shared.ts:75` builds total cents from non-void checks' `totalAmount`. That is not net sales. Do not use this limited ledger to certify provider revenue.
- `supabase/migrations/0149_ezcater_intake.sql:14` stores raw webhook **notifications**, validity, processing disposition and lead ID. It does not promise persisted GraphQL order responses. `lib/catering/ezcater-intake.ts:62` writes this notification ledger; `:253` fetches order detail; `:267` stores customer-total-due as pipeline estimated revenue. Items/customizations survive largely as machine notes (`:85`), not a sales fact table.
- `lib/ezcater/orders.ts:13` already requests `customerTotalDue`, `subTotal`, `tip`, and line `totalInSubunits`. `lib/ezcater/orders-shared.ts:24`, `:85` retains only total-due and item identity/quantity/customization fields; subtotal, tip and line money are dropped. “Already fetched” does not mean available to SQL reports.
- Migration **0195** (`supabase/migrations/0195_catering_insights_money_split.sql:25`) values a lead by live accepted quote, else estimated revenue, else zero; uses **event date**, with completed separate from confirmed/out (`:41`). Display these as **completed event value** and **confirmed commitments**, retaining valuation provenance/missing-value count. Do not relabel quote/customer totals as net sales.
- `lib/catering/insights.ts:160` uses its own level-5/operational scope and fixed windows. Sales needs its own level-6/report-scope wrapper around the window SQL, not reuse that loader's permissions or fixed dates. Exact POS check-to-order links and external channel reconciliation do not exist for the general selection ledger; no reliable subtraction yields “non-catering net” today.

## Needs capture — exact source and report dependency

These are proposed capture prerequisites, not fabricated derived fields. Official references below were checked during recon; API entitlement and real response shapes still need CC's verification.

| Missing or incomplete capture | API source | Enables / handling |
|---|---|---|
| General order GUID, check membership, business date, opened/closed/paid/promised/modified dates, deleted/voided/excess-food state | [Orders schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Order/) and [Check schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Check/), from existing ordersBulk fetch | True order counts, check-vs-order distinction, hourly sales, complete detail and late edits. Preserve null dates; promised is not actual fulfilled. |
| `check.amount`, `taxAmount`, `totalAmount`, service-charge details, payment status | [Check schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Check/) | Financial baseline; amount already includes discounts and service charges, excludes gratuity/tax. TotalAmount includes tax/tip and is not refund-adjusted. |
| Pre-discount price, discounts/reasons/IDs, tax-inclusion, deferred/selectionType, salesCategory/itemGroup GUIDs, full modifier tree | [Selection schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Selection/); config `/discounts`, `/salesCategories`, `/voidReasons` | Gross/discount/comp/void breakdown and category/item reconciliation. Comp is an approved configuration mapping, not every zero-price item. |
| Payment identity, amount, tipAmount, paid date/business date, status, refund object and transaction links; selection/service-charge refund details | [Payment schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Payment/) | Tax/tip/refund separation, adjustments and tender evidence. Never store card digits/tokens/customer objects in reporting capture. |
| Cross-day payment discovery | [Get payment identifiers](https://doc.toasttab.com/openapi/orders/operation/paymentsGet/) (`/orders/v2/payments` with one of paid/refund/voidBusinessDate, followed by payment detail) | Old orders refunded today must affect today even when absent from today's ordersBulk results. Preserve order/check references for drill-through. |
| Stable dining GUID + behavior, source, thirdPartyProviderInfo | Order/selection schemas above; `/config/v2/diningOptions` per [sales integration guide](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistAccounting.html) | Dine-in/takeout/delivery as a dimension separate from DoorDash/UberEats/Grubhub/ezCater/online. Preserve unknown/raw values; no brand-name substring guesses. |
| Restaurant timezone and closeoutHour | Restaurants API General, documented in the same sales integration guide | Reliable finished-business-day boundary; existing ET calendar helper is not Toast closeout configuration. |
| POS order/payment server and check openedBy references; employee display mapping | Order/Payment/Check schemas above; Toast Labor employees API subject to entitlement | Level-7+ server attribution only, no labour metrics. CO-OPS pull actor is never a substitute. Unknown/unmapped employees stay explicit. |
| Actual fulfillment transition/time | [Guest order fulfillment status webhook](https://doc.toasttab.com/doc/devguide/apiGuestOrderFulfillmentStatusWebhook.html) | Candidate source only: delivery is limited to the channel that placed the order, requires enablement/KDS setup. No universal `fulfilledDate` promise; keep actual fulfillment unavailable if access is absent. |
| ezCater subtotal/tip/line amounts already fetched but dropped | Existing GraphQL `orderByID`, `lib/ezcater/orders.ts:28`; normalizer `lib/ezcater/orders-shared.ts:42` | Extend validated typed capture; webhook raw alone cannot reconstruct it. Taxes/fees/refunds require verified ezCater schema fields; do not invent them. |
| Complete per-shop/day run manifest and revision provenance | Our ingestion writer, after source pagination and DB publication succeed | Last success, empty vs missing, incomplete/failed, live vs fixture, usable historical coverage. |
| Explicit POS ↔ external catering identity reconciliation | Toast order/check IDs + channel external reference + `catering_pipeline.external_ref` | True catering/non-catering and omnichannel totals. Ambiguous matches remain unlinked; never match solely on date/amount/customer name. |

## View priorities and honest availability

**Recommended build sequence includes capture before financial release.** Phase A alone is a useful limited history, not completion of Juan's granular Sales request. CC should choose whether to expose Phase A early or release only after Phase B. Labour, forecasts, live pulse, sales edits and shift actions are outside this family.

| Priority/view | Buildable from current rows? | Planned behavior |
|---|---|---|
| A: Overview + daily/weekly/monthly activity | Yes for recorded quantities/check counts; no certified gross/net | Recorded coverage and last-change evidence, check counts explicitly not order counts, top-level units. Optional diagnostic selection amounts only in detail, not a sales KPI. |
| A: Item mix, top/bottom, modifiers, menu group | Yes, with limitations | Group by `(location,item GUID)` not name. Separate parent items from modifiers; bottom means lowest **among observed sold items**, not never-sold inventory. Show captured menu group, not historical sales category. |
| A: Dining-label and day-of-week activity | Yes | Quantities/check activity by captured labels/business date. Unknown bucket visible. Distinct checks spanning groups are non-additive; label that or use item quantities. No hourly heatmap without timestamps. |
| A: Check list/detail | Yes | `/reports/sales/checks` and `/reports/sales/checks/[checkGuid]`; label incomplete financial detail. Latest selection tree, void state and capture provenance. No fabricated order number/time/payment. |
| A: Catering completed/confirmed values | Yes separately | 0195 split by event date and lead source, including ezCater; status/value-source explanation. A paged contributing-event list makes values inspectable. No combined POS+catering total. |
| B: Net/gross/discounts/comps/voids/refunds/tax/tips | Needs capture and reconciliation | Daily/weekly/monthly summaries, previous comparison, separate adjustments. Invalid/missing money blocks metric completeness rather than becoming zero. |
| B: Channels/providers, category revenue | Needs capture | Orthogonal dining/source/provider dimensions; config-owned labels/mapping, explicit unknown and unallocated adjustments. All provider names shown only when captured. |
| B: Hour × weekday heatmap | Needs capture | Opened-time attribution by ET hour, business-date weekday; show definition. Paid/refund-time analysis separately labelled. Accessible table plus intensity visualization. |
| B: Orders, average check/order, drill-through | Needs capture | `/reports/sales/orders` and `/reports/sales/orders/[orderGuid]`; orders and checks counted separately. Average check = eligible check sales / eligible checks, not mean of daily averages. |
| B: Catering vs non-catering | Needs identity reconciliation | POS catering classification and separately captured external events; only reconciled union can become an omnichannel total. Report unlinked coverage. |
| C: Employee sales | Not stored | Only after capture, level 7+ inside loader and projection. Server attribution is not productivity; exclude labour/cost/timeclock. No employee IDs in level-6 detail/export responses. |
| C: Actual fulfilled-time analysis | Not universally available | Capability-dependent; unavailable stays unavailable. Order closed time must not masquerade as kitchen completion. |

## Metric, date and coverage contracts

1. **Money:** integer cents at ingestion with explicit currency, nullable when source is absent/invalid; aggregate in SQL bigint/numeric and check JS safe bounds at projection. Preserve source precision/quantity separately. Selection `price` is already extended and discounted; never multiply it by quantity or subtract discounts a second time. Parent/modifier summation must be proven with source fixtures; check-level reconciliation is authoritative. [Toast Selection](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Selection/)
2. **Net algorithm:** start from eligible check `amount`; exclude void/deleted checks/orders and excess-food orders; remove deferred/house-account balance selections and fundraising charges; reconcile refunds separately. Tax and gratuity/tips do not enter net. Past-day open/unpaid checks are disclosed, not silently removed solely because paymentStatus is not CLOSED. [Toast net-sales calculation](https://doc.toasttab.com/doc/devguide/apiOrdersNetSalesCalculation.html)
3. **Gross bridge:** establish fixtures for `net = gross - discountsOther - comps - salesRefunds` over eligible sales and included non-gratuity charges. Comps partition total discounts; they are not an extra subtraction from an already-inclusive discounts value. Voids excluded from eligible gross/net appear in a separate void-value metric. Deferred/fundraising adjustments are separate reconciliation rows. Do not force the bridge if Toast source amounts fail it; publish a reconciliation error until fixed.
4. **Refund attribution:** date refunds by refund business date, not original order date. Keep sales, tax and tip refund components distinct; dedupe refund transaction/payment/selection representations so a refund is counted once. Custom refunds without item attribution go to an explicit unallocated adjustment bucket; do not force them onto a menu item/hour/channel. Retain original-order link. [Toast refund reporting](https://doc.toasttab.com/doc/platformguide/adminViewingRefundsInToastReports.html)
5. **Reconciliation gate:** use sanitized, CC-provided Toast report/order examples with quantity>1, nested paid/included modifiers, check+item discounts, tax-inclusive items, comps, void/deleted/deferred lines, service charges, split checks/payments and later refunds. Compare same shop/business date and closeout basis. Document any difference between the Orders API calculation and the Toast Web report definition before labelling a metric as matching Toast. Official net guidance explicitly distinguishes integration calculations from platform reporting.
6. **Business dates:** rich capture retains source businessDate, not an inferred UTC date. Legacy rows carry the requested date. Finished day means after the shop's verified Toast closeout and successful complete capture; a date merely before ET today is insufficient for certification. Historical pages are read-only. No on-load refresh or recurring client poll.
7. **Range wrapper:** call `parseReportRange(params, realTodayEt, grain)` once, retain canonical requested URL context, intersect the current historical window with time-closed business dates, and recalculate previous on that effective window through shared range logic. Default seven completed days explicitly uses a custom seven-day interval ending on the latest time-closed date, independent of whether capture succeeded. Preserve actual-calendar meanings of yesterday/this_month/last_month; no fake-today trick. Empty intersections remain empty. Both shops use the same requested dates, showing independent capture gaps rather than silently moving one shop backward; if closeout hours differ, use their common time-closed endpoint for side-by-side comparison. Capture success determines certification, never silently shifts the requested range.
8. **Optional today:** only on explicit today selection, only already captured rows, labelled “Today so far — captured through …”; never mix into completed-period comparison. No capture means “No sales recorded”. At base, completeness/last-success may be unknown; no optimistic timestamp. Historical default remains the proposed choice.
9. **Hour/DST:** bucket valid opened instants with `America/New_York`; keep businessDate as the date axis. Combine both fall-back 01:00 occurrences in the 24-column heatmap, preserving UTC offsets in order detail; spring-forward nonexistent hour is structurally absent, not a fabricated zero. Missing timestamps get an unknown bucket. Do not use `pulled_at`, modified time, or promised time as opened time. `lib/report-range.ts:55` resolves midnight boundaries independently; do not reuse `operationalDayUtcRange().endExclusiveIso` from `lib/operational-day.ts:59`, which adds a fixed 24 hours.
10. **Coverage/compare:** return `complete`, `partial`, `missing`, `failed`, `needs_capture` and explicit covered/expected-day counts per metric/shop/window. A sum over observed days is a labelled partial sum, never a complete-period number. No percentage delta on incomparable coverage or zero prior denominator; display absolute change only where meaningful. Monday weeks/calendar months, clipped partial buckets, caps inherited (92 day / 26 week / 12 month). Do not average averages.

## Implementation contracts and file plan (for the build redispatch)

### 1. Authorized read boundary and export seam

New `lib/sales-reports.ts` carries `import "server-only"`; `lib/sales-reports-shared.ts` holds pure types, range adapter, bucket/metric definitions, reconciliation and row projections. Public loaders accept a server-authenticated viewer and normalized request, not client-supplied authority. Every loader checks level >=6 and each concrete shop with `requireReportScope` **before I/O**, including detail, filter options, comparison and export calls. Employee dimension/fields require >=7 before querying. `all` expands through authorized active shops for >=8; never pass a null/all wildcard into the RPC as implied authority. URL/cursor never grants a shop. Derive role level from session, not request parameters.

Proposed shared request: `{ location, range, grain, dimension, filters, cursor?, pageSize? }`; filters are a closed allowlist (item GUID, menu group, dining identity, provider/source, hour/weekday, status, metric contribution, optional server). Reject invalid values and repeat-array abuse at the page boundary. Fixed allowed sorts; no arbitrary SQL names from URLs.

Read functions: `loadSalesSummary`, `loadSalesBreakdownPage`, `loadSalesCheckPage`, `loadSalesCheckDetail`, then `loadSalesOrderPage`, `loadSalesOrderDetail`, `loadSalesCateringPage`. Return plain DTOs with integer/string cents, source basis, coverage, capture cutoff, current/previous window and drill filter descriptor. Every aggregate and evidence-list query uses the same eligible-facts predicate, revision cutoff and filters. Refund drilldowns may lead to original orders outside the range; authorize the shop independently and show the contributing refund date.

For CO CC piece 3: **loader -> DTO -> pure export rows**. SQL/DB I/O is read-only, not literally a pure function. Pure `salesSummaryRows`/`salesItemRows`/`salesOrderRows` projections have no request, auth, React or database dependency. Export routes still authenticate and invoke the same guarded loaders; never export browser state or only the first UI page. Reuse piece 3's streaming, CSV formula protection, PDF formatting and audit vocabulary. Include scope, business-date basis, filters, timezone, currency, comparison, source/coverage, generation time and capture cutoff. Missing amounts are blank+status, zero is explicit zero. Exports cannot widen employee access or leak customer/payment PII. Coordinate exact adapter naming at redispatch.

### 2. SQL aggregation, paging, migration

Recommend `supabase/migrations/0221_reports_sales.sql`, **authored only**, once CC reserves it and approves capture scope. Even a legacy-only release benefits from server-side latest-version reduction/aggregation; rich capture definitely needs schema. Preflight actual schema/indexes/grants through CC before authoring SQL. Do not edit previously applied migrations.

- Legacy SQL: filter shop/date, choose latest version per `(location_id, check_guid, selection_guid)` **before** void/item/dimension filters; then aggregate. For cross-day moves, acknowledge legacy limitations; rich latest-order revision supersedes the entire prior order. Counts use the same reduced relation as details. Keep current depletion/exclusion semantics untouched.
- Add service-only STABLE read RPCs for bounded summary, breakdown and contribution pages. SECURITY DEFINER with `SET search_path = pg_catalog, public`, revoke EXECUTE from PUBLIC/anon/authenticated, grant service_role only. Validate date span/grain/page size/dimension in SQL too. Existing deny-all Toast RLS stays closed; no user-access view bypass. Test actual grants in sim, not just migration text.
- Candidate legacy index `(location_id,business_date,check_guid,selection_guid,snapshot_version DESC)`; benchmark against existing `(location_id,business_date)` and unique key before retaining another large index. Detail index must include shop/check identity. SQL aggregation prevents transferring every historical version into Next.js for each card.
- Proposed rich storage is an **append-only complete order snapshot** relation (order identity, location, source modified time, capture ID/version, typed date/dimension fields and allowlisted check/selection/payment components), plus immutable capture manifests and payment adjustment facts. A single order snapshot is the atomic unit so removed checks/modifiers do not survive as stale children. Do not store arbitrary raw payloads or customer/card data. Exact physical child-table vs typed JSON representation is a CC review decision; choose normalized child facts if EXPLAIN shows JSON expansion too costly.
- Capture publication: fetch/validate all pages into bounded staging, mark the run complete atomically only when every required write succeeds. Readers use only published run/snapshot identities. Manifest records shop/date/source mode/schema version/start/completion, page/entity counts, errors and complete/partial state; empty runs are real records. Failed or cap-exhausted runs cannot certify a date. Serialize competing shop/order versions; unique source revision/hash makes retries idempotent. A stale response never supersedes a newer source modification.
- Proposed fact indexes: `(location_id,business_date,order_guid,revision DESC)`, `(location_id,order_guid,revision DESC)` for detail/latest state, `(location_id,refund_business_date,payment_guid)` for refund reads, and `(location_id,business_date,completed_at DESC)` for manifests. Uniqueness includes shop+source identity+revision. Typed opened time/server/channel indexes only if query plans justify them; no index for every UI chip.
- Read page limit 50 plus 1 lookahead (hard server maximum 100). Legacy check cursor tuple `(business_date DESC, check_guid ASC, location_id ASC)`; rich orders add defined nullable-opened-time rank/time and stable order GUID tie-breaker. Breakdown pages use `(metric DESC, stable dimension key ASC)` with immutable cutoff. Cursor binds viewer/scope, effective range, compare, filters, dimension, sort and source cutoff; stale/mismatched context resets/refuses consistently. Parameterized RPC arguments, never concatenate cursor text into SQL/PostgREST expressions.
- Per-shop panels get independent cursors. SQL summary is a bounded result; lists never accumulate all rows client-side. Detail children also page if they exceed bounded payload limits. Any enrichment ID reads chunk <=100 and fail on errors; never build an unbounded `.in()` GET. Shop fan-out bounded (e.g. concurrency 2), not a day×shop×dimension N+1 matrix. Exports page through the same cutoff, with piece 3 limits; an exceeded limit is explicit, never silent truncation.
- Use EXPLAIN ANALYZE on sim fixtures above 1,000 and 5,000 rows, many revisions and a full annual monthly range. Define acceptable query/runtime budgets with CC's hosting envelope before rollout. Derived daily aggregates are optional only after measured need; raw history remains authoritative.

### 3. Capture prerequisites for Phase B

Extend `lib/toast/orders.ts` with an explicit raw/typed order snapshot fetch path and new `lib/toast/sales-reporting-shared.ts` normalization, preserving the legacy depletion output contract. Add `lib/toast/payments.ts` and `lib/toast/sales-reporting.ts` for bounded payment discovery/detail and transactional capture publication. Extend `lib/toast/config.ts` for actual dimension/reference fields; snapshot identifiers and labels at ingest. New `lib/toast-sales-reporting-run.ts` orchestrates reporting capture within the existing nightly job; keep its success/failure independent from depletion. Touch `lib/toast-sales-pull-run.ts` only after contract review. Reads never invoke these writers.

Store order checks/selections, full modifier ancestry, payments and adjustment identities; no field missing from the normalizer silently defaults to a financial zero. Explicitly capture deleted/deferred/excessFood, source and timestamps. Finish all source pages or fail completeness. Add modified-time incremental ingestion with a persisted successful watermark, overlap and dedupe for late changes; `startDate/endDate` select **modification time**, not hour-of-sale. Payment paid/refund/void business-date discovery is separate. Existing business-date pulls remain the baseline, with bounded authorized backfill. Test all source endpoints/scopes before enabling a metric. [Toast sales integration guide](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistAccounting.html)

No historical reconstruction from pull timestamps. Backfill real order data with rate limits, resumable manifests and a reviewed date horizon; no backfill runs in this dispatch. Rich history supersedes legacy **per complete shop/day**; never add both datasets or combine a partial new day with an old full day. Do not change current pulse output as an incidental fix; file the money-contract discrepancy for its separate redesign unless CC explicitly adds that work.

If enabled, extend `lib/ezcater/orders-shared.ts` and `lib/catering/ezcater-intake.ts` to retain typed financial fields already fetched, tied to source order identity and event revision. Capture unknown financial fields only after source verification. Reconciliation between ezCater and Toast rings is a separate typed link with provenance, not name/amount heuristics. A unified sales total stays unavailable until linkage coverage proves no double counts.

### 4. Pages, navigation and strings

Create `app/(authed)/reports/sales/page.tsx`, `checks/page.tsx`, `checks/[checkGuid]/page.tsx`, `catering/page.tsx`, then `orders/page.tsx` and `orders/[orderGuid]/page.tsx` when rich capture is available. Keep item/channel/hour views as URL-selected sections within the Sales root unless a separately paged list earns a route. New `components/reports-hub/SalesSummary.tsx`, `SalesBreakdown.tsx`, `SalesHeatmap.tsx` use shared DTOs; no service imports in client components.

Touch `app/(authed)/reports/page.tsx` for the family link; `lib/nav-parents.ts` for specific sales/list/detail parents (override `/reports/[type]/[id]` so Sales does not return to Operations); `lib/i18n/en.json` and `es.json` for every label, availability message, date description and ARIA string. Reuse `ReportShopTabs`, `ReportPageNav`, `ReportRangeControls` and `reportNavigationHref`; preserve `hubLocation`, range/compare and shop through drills/back. Filter/range/shop changes clear all relevant cursors. New pages follow installed Next page guidance (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md:15`): await params/searchParams and fetch in authorized server boundaries.

Overview cards and coverage alerts stay visible; secondary breakdown/details use existing disclosure primitives and i18n counts. All-shops renders independent comparable panels (stacked on phone); shared scale on charts, independent gaps/status per shop. Each numerical card/cell carries a drill descriptor for the current or comparison period. Item/channel contributions show matching selections plus whole-check/order context without claiming whole-order money equals the filtered item's subtotal. Catering values drill to contributing event rows; unavailable numbers render a reason, not a fake drill link. Use `lib/i18n/format.ts` for dates/times and tenant DB labels; no location/brand vocabulary literals. Minimum 44px controls, accessible heatmap table, no color-only meaning.

## Tests and acceptance gates

Build tests alongside the implementation after plan review; no new tests or app code in this dispatch.

| Test area / proposed files | Required evidence |
|---|---|
| `tests/sales-reports-scope.test.ts` | Levels 0–5 refused before client creation/RPC with no rows; 6/7 assigned shops only; forged other-shop/all/cursor/detail refused; 8+ unassigned shops and all panels; employee dimension/IDs absent at 6 across summary, detail and exports. Re-authorize every page. |
| `tests/sales-reports-money.test.ts` | Exact cents bridge, inclusive comp partition, quantity>1, included/paid nested modifiers, check-vs-item discount allocation, null/invalid price, void/deleted/excess-food/deferred/fundraising, service charges, tax-inclusive prices, split payments/checks, refund/tax/tip components and duplicate refund representations. No pulse-helper assumptions. |
| `tests/sales-reports-time.test.ts` | ET opened-hour buckets at midnight, spring 2026-03-08 gap and fall 2026-11-01 duplicate 01:00 with offsets; business date vs ET date/closeout; missing times; promised future orders; late edits and old orders refunded today. Independent midnight endpoints, never fixed 24h. |
| `tests/sales-reports-range.test.ts` | Seven finished-day default, real today/yesterday/month semantics at month/year/DST boundaries, no finished day before closeout/capture, shared caps, compare after clipping, leap month/partial buckets, dissimilar shop coverage, unknown baseline and zero denominator. |
| `tests/sales-reports-loader.test.ts` | >1,000 rows and revisions; latest-before-filter; renamed/item GUID collisions across shops; stable 50+1 keysets with ties; null timestamp order; no skipped/duplicated rows; tampered/context-mismatched cursor; cutoff survives concurrent append; filtered aggregate equals all paged contributions. Errors distinct from empty. |
| `tests/toast-sales-reporting.test.ts` | Source malformed pages, full page-50 cap, partial DB failure, zero-order run, retry/concurrency/stale revision, deleted/missing children, moved business date, late refund discovery, fixture refusal, transactional publication and source watermark only after success. |
| `tests/sales-reports-catering.test.ts` | Confirmed/out vs completed event date, accepted quote precedence, missing valuation, ezCater/Toast duplicate ring, unlinked external order, stale limited ledger; never sum pipeline value and POS net implicitly. |
| Navigation/export tests | Shared range/shop/compare retained through drills/back; specific Sales parents; per-shop cursors reset correctly; CSV rows cover all pages and match summary at fixed cutoff; compare labels, nulls, cents, locale, employee gate and formula escaping through piece 3. English/Spanish key parity. |
| Sim SQL harness | RLS anon/authenticated cannot read/write facts or execute RPC; grants only service_role; scope wrapper refusal; append-only grants; RPC bounds; query plans/indexes; source-vs-aggregate reconciliation. No production test writes. |

Acceptance order: focused fixtures/guards -> all `npm.cmd test` -> `npm.cmd run typecheck` -> CI discipline scripts from `.github/workflows/build.yml` -> `npm.cmd run build` (and training trace check if required by build workflow) -> cross-family correctness/completeness review arranged by CC -> CC preview smoke, en+es, phone+desktop, levels 5/6/7/8, both shops, missing/partial/failed/complete data. Production rollout/backfill/application of 0221 belongs to CC/Juan, not this clone. No claims of verified live freshness without per-shop evidence.

## Open questions for Juan (maximum five; proposed defaults)

1. Expose the limited item/check history first, or wait for verified financial capture? **Recommend waiting for financial capture for the main Sales launch**, with Phase A available for internal review.
2. Offer an explicit already-captured “Today so far” option, or keep this family strictly completed days? **Default completed days only**, leaving live pulse separate.
3. Which Toast discount IDs/reasons count as comps? **Default all as discounts until a reviewed mapping exists; no guessed comps.**
4. How much verified financial history should the first backfill cover? **Propose 12 months if API access/retention and runtime allow**, with coverage shown and bounded resumable runs.
5. For level-7+ employee sales, attribute to order server or payment server? **Default order server**, clearly labelled, with payment-server attribution separate if wanted; never infer performance from sales alone.

Technical follow-ups for CC (not extra Juan questions): confirm 0221 reservation; piece-3 export seam; live schema/writer/scopes/closeout evidence; sanitized Toast reconciliation fixtures; refund-component/date semantics and API access for employee/fulfillment sources. No decision here authorizes implementation before the requested cross-family plan review.

## Validation performed in this dispatch

Repository references above were read before drafting; official sources linked at their claims. Read the written plan back and checked its repository file:line anchors and whitespace. Document-only change: no app code, migration, ingestion, commit, push or merge.

Baseline verification:

```text
npm test
  Could not launch: PowerShell execution policy blocks npm.ps1.
npm.cmd test
  Exited 1 before a test summary; global Git ignore path permission warning.
npm.cmd test -- --maxWorkers=2 --no-file-parallelism
  266 files passed; 4,705 tests passed, 1 skipped (4,706 total).
  Wrapper still exited 1 with the global Git ignore permission warning.
$env:XDG_CONFIG_HOME = (Get-Location).Path
$env:GIT_CONFIG_GLOBAL = 'NUL'
npm.cmd test -- --maxWorkers=2 --no-file-parallelism
  Exit 0; 266 files passed; 4,705 tests passed, 1 skipped; 121.48 seconds.
git diff --check
  Exit 0. No application-code diff.
```

The Git environment overrides applied only to the test process session; no global configuration was edited. Typecheck/build/SQL harness are implementation gates above, not claimed as run for this plan-only change. Live freshness, financial reconciliation, API entitlements, cross-family plan review and migration reservation remain open.
