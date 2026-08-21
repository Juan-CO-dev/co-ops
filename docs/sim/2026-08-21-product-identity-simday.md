# SIM DAY — product identity (2026-08-21)

Two compressed operational days against the **product-identity arc** (PRs #273–#280,
migrations 0179/0180/0181 all applied live), plus a T0 sweep of the arc's cumulative
diff. Harness: `scripts/sim/product-identity/`. Prior days: `scripts/sim/FINDINGS.md`
(2026-08-11 persona day) and `scripts/sim/concurrency/FULLDAY-FINDINGS.md`.

---

## VERDICT

**The arc's five payoffs are REAL and PROVEN.** A vendor going down reroutes the par to
the backup with the demand intact, the cost board does not move by a single ounce, the
cook can record from the backup, two par'd twins produce exactly one suggestion, and a
product count writes per-SKU lines that sum to the counted number exactly. **43 named
assertions, 0 failures.**

**The GAP is not the model — it is that six things in the shipped code never ran.**
Every one of the six P1s below is a path that had *never been executed*: a fail-open
audit write that 400'd silently on every invocation, a wire mapper that dropped the new
field, a wire guard that never learned the new variant, a disjointness rule guarded in
one direction only. Phase-by-phase Juan smokes could not have caught them, because each
sits behind a code path a smoke does not walk — which is exactly the argument the spec
made for requiring this day.

The arc is **DONE** on its own terms. The honest caveat: **most of it is dark in
production until Juan's first count and first receiving-against-a-member**, and the sim
says so in three places rather than letting an empty panel read as a broken one.

---

## HOW THE DAYS WERE RUN (read this before reading a verdict)

The plan expected a sandbox: *"the lead deactivates the PRIMARY ham twin on the sandbox
DB."* The 2026-08-11 program had one (`co-ops-sim`, a prod-schema clone). **It does not
exist today**, and the run happened at **08:58 ET on a Friday** — peak prep, both shops
about to order. Deactivating a live SKU two kitchens were about to order ham from was
not a defensible way to prove that a failover works.

So the days run the **REAL, unmodified server code against REAL production rows**, with
two substitutions, both stated in every assertion that depends on them:

| | How the sandbox would have done it | How this ran |
| --- | --- | --- |
| **Writes** | write to the clone, read them back | intercepted at the `fetch` boundary: every non-GET PostgREST request is **CAPTURED** (payload recorded, answered synthetically) or **REFUSED**. Assertions read the exact payload the code *tried* to write. **Zero rows written to production**, and the guarantee is mechanical, not disciplinary. |
| **Fault injection** | flip `vendor_items.active` on the clone | flip it in the PostgREST **response**. `loadWalkerData`, `loadProductIndex`, `resolveProductMember`, the flatten and `createCountEvent` are untouched real code that cannot tell the difference. |

**What that buys:** no fixture drift, no "the clone was seeded differently" caveat — the
numbers below are CO's real numbers. **What it costs:** a write is proven by its captured
payload rather than by reading it back out of a table afterwards.

**Three things had to be injected because production has no data for them**, and each is
labelled SYNTHETIC where it is used: a second par on the backup twin (live, *no* product
has two par'd members, so the dedupe could not otherwise be walked); three interleaved
receipt lots (live, the entire `vendor_delivery_items` ledger holds **one** line for any
product member and its `resolved_oz` is NULL); one prior `product.resolution_flip` audit
row (live there are zero, so only the first-observation SEED branch was reachable).

### The floor, as read live at 08:58 ET

11 products · 23 member SKUs · 11 global primaries · 0 per-location primaries · 11
product-pinned recipe lines · **0 receipt lots** · **0 count events** · **0 productions**
· **0 resolution-flip audit rows** · 3,809 depletion rows · 0 `location_sku_settings`.

HAM: PFG (primary, par 3, `avg_oz 1.2`) + Baldor (backup, no par, `avg_oz 1.2`),
`products.unit_oz = 1.2 OPERATIONAL`. Both shops.

---

## DAY 1 — VENDOR-DOWN DAY (`day1-vendor-down.ts`) · 22/22 PASS

The morning walk is normal; mid-morning the primary ham vendor goes out; the shop does a
normal day.

### Scenario 1 — the walk still offers ham, from the backup

| | |
| --- | --- |
| **Expected** | one ham row, from the BACKUP, carrying the PRIMARY's par, flagged `reroutedFrom`, with the `reroutedToBackup` notice firing. |
| **Observed** | both shops: `Ham [backup] par=3 rerouted_from=<pfg>`, `reroutedToBackup=1`, `productUnroutable=0`. |
| **Verdict** | ✅ **PASS** (D1-A1, D1-A1b × 2 shops). The demand moved; it did not evaporate. This is the single behaviour the whole layer exists for and it works at both locations. |
| | **but** the amber fault box fired too — see **SIM-PI-1**, fixed in this PR. |

### Scenario 2 — the cost board does not move

| | |
| --- | --- |
| **Expected** | ham's oz per menu item byte-identical across the member flip. |
| **Observed** | ladder fell `primary → any` and answered Baldor. Ham oz per menu item **identical to 6 decimal places** on all four ham menu items (The Teamster / The Frex / Ham Sub 3.673469 oz, Sicky Wicky Club 2.448980 oz). Whole board: **0 of 68 rows differ**. |
| **Verdict** | ✅ **PASS** (D1-A2a/b/c). This is deviation **D2** earning its keep: `products.unit_oz` owns the basis, so a member flip cannot re-denominate a count-based line. Without those four columns the arc would have silently un-costed the menu, which is precisely what `seed 18` refused itself over. |

Note the rung: `any`, not `recent`. Ham has zero receipt history, so rung 2 has nothing
to read and rung 3 answers on a stable `skuId` sort. Honest, and the audit row says so.

### Scenario 3 — exactly one suggestion, not two

| | |
| --- | --- |
| **Expected** | with both twins par'd, ONE walk row (the resolved primary), not two. |
| **Observed** | 1 row, `Ham [primary] par=3`, at both shops. With the primary ALSO down: 1 row, the backup, on its own par, `reroutedFrom=null` (covered, not double-counted). |
| **Verdict** | ✅ **PASS** (D1-A4, D1-A4b × 2 shops). The audit's double-order path (P2 §ORDERING (2)) is closed. **SYNTHETIC** — the second par was injected; live, no product has two par'd members. |

### Scenario 4 — production capture accepts the backup

| | |
| --- | --- |
| **Expected** | the cook's dropdown offers the backup SKU's product items (the amplifier fix). |
| **Observed** | both members map to the same item set (`Ham`), unchanged under vendor-down. |
| **Verdict** | ✅ **PASS** (D1-A3, A3b, A3c). The audit's *"a cook CANNOT record production from the backup SKU"* is dead. |

### Scenario 5 — depletion attribution follows FIFO

| | |
| --- | --- |
| **Expected** | consumption eats the oldest lot first, across the vendor boundary. |
| **Observed** | live: 0 lots → 100 oz of consumption reported as **fully unattributed**, no vendor invented. Synthetic interleaved shelf (PFG 120 @08-14, Baldor 80 @08-16, PFG 100 @08-18), 150 oz consumed → `lot-1-pfg:120 + lot-2-bal:30`, remaining `bal:50, pfg:100` oldest-first. |
| **Verdict** | ✅ **PASS** (D1-A6a/b/c). FIFO crosses the vendor boundary without noticing it, and refuses to guess when the ledger is empty. See **SIM-PI-2**. |

### Scenario 6 — the flip is written down

| | |
| --- | --- |
| **Expected** | a `product.resolution_flip` audit row naming from / to / rung. |
| **Observed (first run)** | ❌ `column audit_log.created_at does not exist` → fail-open → **no row, ever**. |
| **Observed (after fix)** | `{from_sku_id: <pfg>, to_sku_id: <baldor>, rung: "any", considered_sku_ids: [...], location_id, product_id}`, `actor_id` null. |
| **Verdict** | ❌ → ✅ after **SIM-PI-3**, fixed in this PR. |

---

## DAY 2 — TWO-VENDOR COUNT DAY (`day2-two-vendor-count.ts`) · 21/21 PASS

### Scenario 7 — the sheet offers HAM as one row

| | |
| --- | --- |
| **Expected** | one product row, tap-to-split available. |
| **Observed** | 11 product rows beside 164 SKU rows. HAM: 2 members, `splitAvailable=true`, `lotBearingMemberCount=0`. |
| **Verdict** | ✅ **PASS** (D2-B0, B0b). The middle case of `productSplitAvailability` — *zero* lot-bearing members still opens the split — is not hypothetical: it is the live case at both shops today, and it is what stops a counter who finds real stock from being trapped in product-only mode. |
| | **but** 4 of the 11 product rows have an empty level picker — see **SIM-PI-6**. |

### Scenario 8 — a product count writes member lines that sum exactly

| | |
| --- | --- |
| **Expected** | N member lines, oz summing exactly to what was entered, `allocated_from_product_id` set. |
| **Observed (live world)** | 300 oz entered → PFG 300, Baldor **0** — sum exactly 300. Both lines carry `allocated_from_product_id`. Advisory: **`no_lot_history`** (not `count_exceeds_lots`), absorbed by the resolved primary, named. |
| **Observed (injected shelf)** | 300 oz against a 300 oz shelf → PFG 220 + Baldor 80, newest-back. Sum exactly 300. **No advisory** — the lots placed it. |
| **Verdict** | ✅ **PASS** (D2-B1, B1b, B1c, B2, B2b, B2c, B5a, B5b, B5c). The Baldor 0 is the **measured zero** Phase 5 designed: a product count re-anchors the *whole* product, so the twin the shelf gave nothing to cannot sit on a stale anchor beside a fresh one — which is how the mirrored SHORT/OVER pair used to be born. And the two reason codes stay separated: conflating them would cry wolf on every count this month, because every count this month will have no lot history. |

### Scenario 9 — the split count anchors per-SKU exactly as before

| | |
| --- | --- |
| **Expected** | split lines carry `allocated_from_product_id` NULL and anchor per-SKU as a pre-arc count. |
| **Observed** | 2 rows, `allocated_from_product_id` NULL on both, `anchor_dimension=weight`, qty as entered. |
| **Verdict** | ✅ **PASS** (D2-B2d, B3c). Deviation **D8** holds: the anchor/drift/variance engine never learned that products exist. |

### Scenario 10 — the mirrored SHORT/OVER pair dies

| | |
| --- | --- |
| **Expected** | member variances that mirror each other net to zero at the product grain. |
| **Observed** | members `−140 / +140` → product variance **0**, total 100. One non-census member → variance **null**, not a half-true number. One unresolvable member → `totalOz` null, `knownOz` 40, the unresolved member **named**. On the live panel, every product row's total equals the sum of its per-SKU rows exactly. |
| **Verdict** | ✅ **PASS** (D2-B4a–B4e). The audit's deepest break — *"A drifts negative (reads OVER) while B inflates (reads SHORT), nothing nets them"* — is closed by the **rollup**, with no ledger row re-keyed and the double-count law untouched (deviation **D5**). |

### Scenario 11 — the same product entered twice on one sheet

| | |
| --- | --- |
| **Expected** | refused, or written disjointly. |
| **Observed (first run)** | ❌ 4 lines for 2 member SKUs — two anchors per SKU in one event. |
| **Observed (after fix)** | refused: `duplicate_product_line`. |
| **Verdict** | ❌ → ✅ after **SIM-PI-5**, fixed in this PR. |

---

## FIXED IN THIS PR — the P1 batch (6 defects, every one a path that had never run)

- **SIM-PI-3 · the resolution-flip trail had never been written once (P1).**
  `lib/products.ts` selected and ordered `audit_log.created_at`; the column is
  `occurred_at`. The SELECT 400'd on every invocation, `recordResolutionFlips` is
  fail-open, and `materializeDailyDepletion` dispatches it with `void` — so the spec's
  named promise (*"why did ham cost move Tuesday always has an answer"*) produced exactly
  zero rows and nothing anywhere said so. Also moved the location filter into SQL (with a
  JS post-filter, one shop's flip volume could evict the other's history from the 500-row
  window and a product whose prior row fell off was **re-seeded as a first observation**,
  losing exactly the event the trail exists to record) and added an `id` tiebreak.
- **SIM-PI-4 · the mid-shift Toast debounce never debounced (P1, PRE-EXISTING, outside
  the arc).** `lib/catering/toast-sales.ts maybeRefreshTodaySales` carried the identical
  `created_at` misspelling **and did not check the error**, so `data` was always null,
  `attemptedRecently` was always false, and **every `/mid-shift` render fired a fresh
  Toast API pull** — the exact API storm the 45-minute window was written to prevent.
  Found while chasing SIM-PI-3. Fixed here because it is the same one-token defect, it
  hits a third-party API on every page load, and it was proven live. A failed debounce
  READ now skips the trigger rather than reading as "no recent attempt".
- **SIM-PI-1 · a false alarm standing beside its own resolution (P1-display).** A par
  whose demand was CARRIED stayed in the fault tally, so the vendor-down day rendered
  *"1 par'd product has no ordering path today — nothing will be suggested for them"*
  (amber) directly above *"1 par moved to a backup item"* (blue). The amber sentence was
  false, on exactly the day the layer exists for. Same class as the August sim's SIM-25
  false all-clear, sign flipped. Also gave the dedupe's name sort an `skuId` tiebreak —
  twins share a NAME by construction, so which vendor got today's suggestion could differ
  between two renders of the same data.
- **SIM-PI-5 · two product lines, two anchors per SKU (P1).** Entering HAM twice on one
  sheet wrote two `sku_count_lines` per member. That is the council-L5 disjointness the
  anchor sum rests on, violated in the one form nothing guarded — `product_line_overlaps_sku`
  covers product-vs-SKU only. Now a named 400 (+ en/es), mirroring `submitParPass`'s own
  `duplicate_product`.
- **SIM-PI-8 · the recipe builder's product picker was a dead end (P1).** `saveDraft`
  never put `componentProductId` on the wire, so a product-pinned draft arrived with all
  three targets null, failed *exactly one component*, and 400'd the **whole recipe** with
  a generic `invalid_component` naming no line. Optional-field typing is why it compiled.
- **SIM-PI-9 · the publish wire guard never learned the third link target (P1).**
  `coerceEdit` rejected `kind:"equipment"`, and a null return fails the **entire** publish
  with a generic `invalid_payload`, discarding every unrelated edit in the batch. Six of
  seven `SpineLinkTarget` sites learned equipment; this one did not.
- **TENANCY · a location-bound GM could re-point another shop (T0 #1/#21).** `setPrimary`
  took a client `locationId` with no `lockLocationContext`, and `/admin/products` listed
  every shop in the tenant — so a GM assigned to one shop had a live control that silently
  re-pointed the other shop's costing, counts and order walk. Bound at both layers; the
  global (`null`) row stays org-scope by design.

---

## OPEN INCIDENTS — data state, not code (all P2 / NOTE)

- **SIM-PI-2 (NOTE) · every FIFO surface in this arc is correct-but-silent in prod.**
  The whole `vendor_delivery_items` ledger holds **one** line for any product member, and
  its `resolved_oz` is NULL. So: no lot shelf anywhere, `remainingByLot` returns empty,
  every product count raises `no_lot_history` and lands whole on the primary. All correct.
  It becomes visible the first time receiving runs against a member SKU.
- **SIM-PI-6 (P2) · 4 of 11 product rows offer no level to count at.** Banana Peppers,
  **Ham**, Hot Peppers and Sweet Peppers have a resolved primary with no pack chain, so
  the product row's level picker — which borrows the primary's chain labels — is empty and
  the operator falls through to `CountForm`'s free-text unit box (the August sim's SIM-19
  path). A data gap (the weigh / pack-chain errand) surfacing as a UX cliff, not a code
  defect. **Worth telling Juan before his first count:** on those four the sheet asks him
  to type the unit.
- **SIM-PI-7 (NOTE) · the two-grain on-hand panel is dark for HAM.** A product row exists
  only where a member carries an on-hand anchor, and neither ham twin has ever been counted
  or received. Correct and honest — recorded so an empty panel is not read as a broken one.

---

## T0 SWEEP — the 20 recurring bug classes over the arc's cumulative diff

`git diff 4859e9e..dadb6f2` — 86 files, ~14.4k insertions. Three parallel Opus passes
(data/scale · authz/contracts/i18n · shared types/totals/boundaries), CC-verified. The
class-labelled findings NOT fixed above:

### P1 — fix batch, next PR

| Class | Site | Finding |
| --- | --- | --- |
| **#6/#24 truncation** (variant: unbounded `.in()` **list**, not row cap) | `lib/products.ts` `allLocationDeliveryIds` → `loadProductLots`; same shape in `loadLastReceivedAt` | The delivery-id list is deliberately unbounded ("the FULL receipt history … no window to bound it with") and then spent as a **GET filter**: `delivery_id=in.(…)` at ~39 bytes/uuid against Kong's 8–16 KB request line ⇒ a hard 414/400 at roughly 200–400 deliveries. Near-daily receiving at two shops reaches that within months. Paging the *lines* does not help — the failure is in the request line, on page 0. `loadCountFormData` has no try/catch, so it **500s the whole `/operations/counts` sheet**, and the same shape sits under `loadProductIndex` (order walk + all nine graph callers). |
| **#9 inactive-edge** | `lib/products.ts loadProductIndex` | `products` is read with no `.eq("active", true)`, so a retired product keeps costing, depleting, routing and rendering a count row. `listProducts` and `loadWeightBoard` both honour `active`; the one loader that decides operational behaviour does not — and `lib/recipes.ts assertProductLineIsValid` refuses a write on the premise that *"a pin at a retired identity would resolve to nothing"*, which is false as written. **Needs a lead ruling, and the ambiguity is itself the P1.** — **✅ RESOLVED 2026-08-21, Juan's ruling A+ ("Option A + loud recipes"):** a retired product REFUSES at the resolution ladder (new rung ⓪ in `resolveProductMember`) with a named `reason: "retired_product"`, so `assertProductLineIsValid`'s premise is now true. The fix is deliberately NOT a `.eq("active", true)` on `loadProductIndex` — a filtered-away row poisons with no name, and `productBySku` stays load-bearing for count-sheet labels; the active filter lands inside the pure resolver instead. Plus: `/admin/products` gains a discontinue affordance that warns "N recipes still pin this" and never blocks; the recipe builder badges a discontinued line; readiness gains `retired_product` (red) and `retired_sku` (amber rider, loudness only). |

### P2 — ROADMAP

**Data & scale.** `recordResolutionFlips`'s `.limit(500)` window (now location-filtered in
SQL, so materially safer, but still a window) · `recordResolutionFlipsForLocation`'s
unpaginated `recipe_inputs` read · two unpaginated `vendor_items` reads over
`.in("product_id", …)` · `loadSalesGapDates` (pre-existing, unpaginated, **unordered**) now
called with the widest window any caller has ever passed · `void
recordResolutionFlipsForLocation(...)` is fire-and-forget in a serverless handler where
`after()` is the house idiom · `lib/weights.ts` slices a **UTC** ISO to compare against an
**ET** `business_date` (class **#8**) · `lib/weights.ts:640` `num(input_oz) ?? 0` fabricates
a zero into the **denominator** of observed trim, so a run with one underivable input reports
the prep running tighter than it is (the module's own `weights-shared.ts` states the rule this
breaks) · seed 24's two first-wins picks over unpaginated, non-total orders.

**Authz & contracts.** `PATCH /api/admin/skus/[id]` sets `product_id` with none of
`attachMember`'s invariants — silent re-parenting, attach-to-inactive, and a composite-FK
**500** where `attachMember` raises a named 409 · `detachMember` ignores the path product id
(the URL contract is decorative and the audit row cannot say which product lost the member) ·
`attachMember` accepts an inactive product · the 0179 provenance quartet goes **stale**:
`lib/receiving.ts` and `lib/admin/skus.ts` both overwrite `avg_oz_per_each` without touching
`weight_class`/`weight_established_*`, so the board renders *"OPERATIONAL, established by
<old person>"* for a number that person never weighed (class **#12**) · item weights edited
through the normal admin path write `item.update`, which the weight board's provenance lookup
does not match, so every one reads *"nobody recorded where this came from"* · seven new audit
actions are absent from `DESTRUCTIVE_ACTIONS` (class **#13**, forensic-filter gap only —
step-up is enforced at the routes) · 0181's 32-row backfill writes no `migration_apply` audit
row although it cites 0071, which does · `.or()` string interpolation in `loadProductIndex`
without the house UUID guard (`lib/email-receipts.ts` names the idiom; `lib/ordering.ts` has
the same gap pre-existing — one sweep) · product routes hardcode `< 6` / `< 7` instead of
importing the exported floors · 0179's two unguarded `alter table … add/drop constraint`
statements are not re-runnable · Tier-B step-up on `/api/admin/weights` is one hop from
Tier-A writes of the same two columns.

**Shared types & totals.** `ReconcileSource.equipmentId` is never populated by its only
producer, so `buildReconcileAddEdit`'s equipment arm is dead **and** "Make B match A" on a
fridge temp line is falsely refused as `unlinked_count` — the exact false positive 0181 exists
to clear (class **#16**) · `copyItemsToVersion` writes `equipment_id` across template versions
with **no location check**, the guard both other writers treat as load-bearing · `RecipeReadout`
omits product lines from the per-batch oz while leaving `anyOz` true, printing a partial as a
total (**partial-results-as-totals**) — hits all 11 re-pointed lines · `CountForm` picks its
advisory sentence off `absorbedByVendorName` when the field that means "nothing absorbed it"
is `absorbedBySkuId`, which the client type does not even carry (class **#12**) · a member
deactivated *at this location only* appears on neither the product row nor the singleton list,
so it is uncountable while `OnHandPanel` still shows its stock · `readiness-load` pushes nothing
into `skuStatuses` for a **resolved** product line, so a recipe whose inputs are all product
pins reads READY with every member SKU incomplete · `QuickAdd` filters link targets by name
only — no kind filter and **no location filter**, unlike the two pickers that were fixed.

**Dead / unwired:** `trimStandardForItem` (zero references), `lib/types.ts` `Product` and
`VendorItem.productId` (zero importers; the live shapes are `ProductView` /
`ProductIndexEntry`), and `attributeFifo` — which the module header names as one of the three
answers ("what actually got EATEN") but which **no app consumer calls**; the arc's FIFO is
consumed through `remainingByLot` / `allocateProductCount` only.

### Verified clean (coverage, so the lead knows what was actually checked)

**i18n** — scripted key-set diff of both JSONs: 204 new keys each side, **0 missing either
way**; every interpolated closed set reconciled (13 `CountError` codes, 12 `ProductError`,
the weight codes, advisory codes, weight classes, rungs, `equipment_*` errors); zero
hardcoded `aria-label`s (class **#17** clean). **RLS / append-only** — no `for delete` /
`for update` / `for all` in any of the three migrations; both new tables carry the REVOKE-only
posture + `enable row level security`; the replaced `create_recipe_full` re-asserts the full
ACL including the `anon` revoke (class **#22** clean). **Silent-UPDATE law** — all 16 new
UPDATEs use `{ count: "exact" }` and throw on 0; the arc adds **zero** `.upsert(`. **#26
unit-heterogeneous aggregation** — `qty_entered` appears nowhere in the diff; both new usage
lanes aggregate `input_oz` / `direct_oz`; `flattened_oz` is never read, so the double-count
law is intact. **Module boundaries** — all six new `-shared` modules verified zero-I/O and
zero server imports; every new `"use client"` import graph traced; no leak. **Step-up path
coverage** (class **#3**) — all five new route families and both new pages match
`isAdminPath`. **Route-group placement** (class **#10**) — correct; `app/error.tsx` +
`global-error.tsx` cover both new families (class **#27**). **Partial-vs-total rendering** —
`totalOz == null` renders an em-dash, `knownOz` renders only under its own
`known_lower_bound` key and only when the total is unknown. **Migration gates** — M1/M2/M3
probes all cache only the definitive answer and degrade to today's exact behaviour.

---

## PROCESS

Six P1s hot-fixed and each re-verified by a sim assertion or a live probe (the 2026-08-11
rule: unambiguous + obvious fix ⇒ fix now; ambiguous + load-bearing ⇒ defer). Nothing was
deferred as ambiguous this round; the two remaining P1s are deferred as **scope**, not as
doubt — one needs a lead ruling on product retirement semantics, the other is a
request-line-length fix that deserves its own diff.

**Go/no-go:** **GO** to close the arc. The follow-on fix batch (2 P1s + the P2 list) is
filed in `docs/ROADMAP.md` and should land before receiving starts writing lots against
member SKUs, because that is the day the `.in()` list starts growing.
