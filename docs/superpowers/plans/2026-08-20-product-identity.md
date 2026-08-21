# Product Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⛔ MIGRATION LAW (the 0178 lesson, now house law): a build agent NEVER applies a migration.** Migration `.sql` files are AUTHORED and COMMITTED in their phase's PR like any other file. Applying them to the live database (`mcp__plugin_supabase__apply_migration`, the Supabase dashboard, `psql`, a seed script with `--execute`) is a **named LEAD/JUAN gate step** in this plan, marked `🔒 GATE`. If you are a build agent and a task says `🔒 GATE`, you stop, report, and wait. Writing the file is your job; running it is not.
>
> **⛔ SEED LAW: the same rule covers every `scripts/seed/*.ts` in this plan.** They ship dry-run-by-default (the seed-18 idiom: `const EXECUTE = process.argv.includes("--execute")`). A build agent may run the DRY RUN and paste its output. Only the lead runs `--execute`.


> **✅ SHIPPED 2026-08-21 — every phase merged, every gate discharged.**
> P1 #273 (0179 · 🔒 M1 applied) · P2 #274 (🔒 S1 run, the 8-pair adjudication sheet) ·
> P3 #275 (resolution + read-time FIFO through all nine consumers) · P4 #276 (🔒 S2 run,
> oz-parity gated) · P5 #278 (0180 · 🔒 M2 applied) · P6a #279 (weight & trim board) ·
> P6b #280 (0181 · 🔒 M3 applied) · **P7 #281 (this one: the two sim days, the T0 sweep
> over the cumulative diff, and the arc close).**
> Findings: `docs/sim/2026-08-21-product-identity-simday.md` — 43 assertions, 0 failures,
> **6 P1s found and fixed inside Phase 7** (every one a path that had never executed), 2
> P1s + a P2 list filed to `docs/ROADMAP.md`. The arc's law now lives in `AGENTS.md`
> § Product identity.

**Base:** repo `C:\Users\conta\co-ops`, branch `main` @ `69404ac`.
**Spec (the contract):** `docs/superpowers/specs/2026-08-20-product-identity-design.md` — Juan-ratified 2026-08-20.
**Foundation audit (the integration checklist):** `docs/audits/2026-08-20-multivendor-semantics-audit.md`, gap P2.
**Law:** `AGENTS.md` (+ `docs/DISCLOSURE_DOCTRINE.md` for any admin surface).

---

## Goal

Give the system a **product identity above SKUs**, so that "sliced ham" is one thing the kitchen, the recipe, the count sheet, the order walk and the cost board all agree on — while the SKU layer stays exactly what it is today (per-vendor packs, prices, weights, pars). Concretely, when this arc closes:

- A recipe pins **HAM**, not *Baldor Ham*. One pure resolution function decides which member SKU that means, per location, and every consumer (costing, depletion, production, ordering) asks that same function.
- A vendor going down **routes demand to the backup member** instead of silently evaporating it.
- Two vendors' hams **roll up to one on-hand number** with a per-vendor split underneath, and a product-level count allocates back down FIFO instead of producing mirrored false SHORT/OVER alarms.
- A cook can **record production from the backup SKU** (today the dropdown derives from the pin, so they cannot).
- The **weight & trim audit** exists as an owner-invoked tool beside the costing board — every weight the system believes, its class, its provenance, its drift, and a ranked suggestion list that suggests and never nags.
- Fridge temperature lines **link to the equipment they measure**, clearing a 32-row "needs link" false positive and giving each fridge one asset page with its temp history and its maintenance trail.

**Non-goals (named in the spec, do not build here):** P6 usage-seed · missing-water recipes · pack-chain-blind `$/oz` on `/admin/skus` + `/admin/vendors` · any per-tenant vocabulary in code.

---

## Architecture

**Four layers, one new node.** `menu_items` → `items` (prep registry, unchanged) → **`products` (NEW)** → `vendor_items` (unchanged). Only the POINTER above SKUs changes: `recipe_inputs` gains a third component target, `vendor_items` gains a nullable `product_id`, and a `product_primaries` table carries the per-location primary designation.

**Resolution happens exactly once, at graph-build time, and it is pure.**

`loadRecipeGraph()` already loads the whole recipe universe in a fixed number of queries and hands a `RecipeGraph` to nine callers. This plan adds two more batch queries (products + members, product primaries) and one pre-indexing step, so a product-pinned `recipe_inputs` row becomes a **resolved member SKU id** before any math runs. Every existing consumer — `lib/admin/menu-costing.ts`, `lib/admin/catalog.ts`, `lib/admin/toast-map.ts`, `lib/catering/sku-demand.ts`, `lib/catering/surplus.ts`, `lib/catering/toast-sales.ts`, `lib/admin/readiness-load.ts`, `scripts/parity-angel.ts`, `scripts/seed/23-ladle-measure.ts` — keeps its SKU-keyed output shape and gains failover for free. That is the whole trick: **one seam, nine payoffs, zero re-plumbing downstream.**

The pure core lives in **`lib/products-shared.ts`** (zero I/O, client-safe, the `*-shared.ts` pattern; `lib/location-sku-shared.ts` is the template). It owns four families of pure function, all vitest-pinned:

| Family | Function | Answers |
| --- | --- | --- |
| Resolution ladder | `resolveProductMember` | *What to order / what to price* — ① location primary if active ② else most-recently-received active member ③ else any active member ④ else `unresolved` |
| Recipe basis | `productInputBasis` | *What does one unit of the PRODUCT weigh* — measure-registry-only pack shape so a member flip can never re-denominate a line |
| FIFO | `attributeFifo` · `remainingByLot` · `allocateProductVariance` · `allocateProductCount` | *What actually got eaten* / *where does a product-level count land* |
| Two-grain | `rollupProductGrain` | *On-hand*: per-SKU ledgers stay the truth, the product grain is their sum |

**Three questions, three answers, never conflated** (the spec's own framing, carried into code):

1. **What to order / what to price** — `resolveProductMember` with the walk's location. Costing calls it with `locationId: null` (the global primary row).
2. **What got eaten** — the depletion ledgers stay per-SKU and untouched; the **rollup** is where twins cancel. `toast_daily_depletion.direct_oz` keeps its exact meaning and the double-count law is not touched at all (see **D5**).
3. **On-hand** — `loadOnHand`'s per-SKU rows are unchanged and remain the source of truth; a new `products[]` view-model on `OnHandView` is their sum, with the per-vendor split underneath and FIFO lot remaining.

**The weight audit is a read surface over facts the system already stores**, plus one owner-invoked session that writes weights with a class and an audit row — doctrine-identical to the inventory audit at `/operations/counts`: no clocks, no due dates, no gates.

**Equipment identity is the same pattern, cold side:** `checklist_template_items.equipment_id` is a third link target pointing at the existing `maintenance_equipment` registry; the needs-link queue and its two predicate copies learn it; the fridge page gains the maintenance trail beside the temp history.

**What this arc deliberately does NOT do:** it does not rewrite the flatten's math, does not touch `batch_yield`, does not re-key any ledger, does not add a per-node query, does not delete or supersede a single row (append-only law), and does not introduce a fifth private opinion about which vendor a product means.

---

## Tech Stack

- **Next.js 16.2.4** App Router (Server Components), **React 19.2.4**, TypeScript `strict` + `noUncheckedIndexedAccess`
- **Postgres 17** on Supabase (project `bgcvurheqzylyfehqgzh`), migrations `supabase/migrations/NNNN_*.sql`, **next number = `0179`**
- **Tailwind v4** CSS-first (`app/globals.css` `@theme inline`) — token floor + the four button grammars per AGENTS.md
- **Vitest** (`tests/`, `npm test`, CI-gated) — pure modules only
- **i18n** — flat dotted keys in `lib/i18n/en.json` + `lib/i18n/es.json`, en **and** es in the same PR
- Row types are **hand-declared** (there is no generated `types/supabase.ts`); numerics come off PostgREST as `number | string | null` and are coerced with a local `num()`

---

## Deviations from the spec (READ FIRST — these need the lead's ruling)

The spec's model is followed exactly. Nine places where live code makes a spec line impossible, unsafe, or wasteful are argued here rather than silently absorbed.

**D1 — Phase 3 and Phase 4 must SWAP. Re-pointing before the reader exists deletes numbers.**
Spec §Migration path orders: (3) re-point the portioned prep recipes SKU-pin → product-pin, then (4) resolution fn + FIFO into the seams. Executed in that order, every re-pointed line becomes a `recipe_inputs` row whose `component_product_id` no engine reads: `batchOz` (`lib/prep-consumption-graph.ts:206-219`) falls through both branches to `else return null`, poisoning the flatten. Every recipe consuming ham or mozzarella silently drops out of costing **and** depletion — exactly the failure `scripts/seed/18-twin-adjudication.ts` refused itself over ("a re-point would not shift the number, it would DELETE it"). **Resolution:** plan Phase 3 = the resolution engine (spec §4), plan Phase 4 = the re-point (spec §3). The engine ships **dormant and behavior-identical** (zero product-pinned rows exist when it lands), and the re-point is the data gate that lights it. The spec's phase numbers are mapped in the coverage table at the foot.

**D2 — `products` cannot be as thin as the spec says. It must own what one unit of the product weighs.**
Spec §Migration path calls `products` "a thin `products` table: the raw identity". Live, that is not sufficient, and the reason is already written down in this repo. `scripts/seed/18-twin-adjudication.ts` and `docs/seed/source/twin-adjudication-dryrun.md` record that both live ham/mozzarella pins read `quantity = 1, unit = "unit"`, `unit` is a COUNT measure, and `ozForRecipeInput` (`lib/recipe-math.ts:165`) therefore resolves the line through **the SKU's own `avg_oz_per_each`** — Baldor Ham 1.2, PFG Ham `NULL`. A product pin that resolves to a different member on Tuesday than Monday would swing or delete the line's oz with no error anywhere. The dry-run names the fix verbatim: *"the pin cannot follow the par until something owns what one 'unit' of the product weighs."* **Resolution:** `products` carries `unit_oz` + the same weight-class/provenance quartet the weight audit already speaks (`unit_oz_class`, `unit_oz_source_note`, `unit_oz_established_at`, `unit_oz_established_by`), and `productInputBasis` builds the recipe basis from `products.unit_oz` — **member-independent by construction**. This is four extra columns and it is the difference between the arc working and the arc silently un-costing the menu.

**D3 — A product-pinned recipe line may only use MEASURE-REGISTRY units, never a member's pack or chain label.**
`ozForRecipeInput`'s steps 1 and 2 match the unit against the SKU's own `packChain` labels and its `pack_format` / `each_container_label`. Those are per-vendor spellings: "1 case" of Baldor ham and "1 case" of PFG ham are different masses, and a product pin has no honest way to choose. **Resolution:** `productInputBasis` returns a `RecipeInputSku` with `packChain: null`, `packFormat: null`, `eachContainerLabel: null` and `avgOzPerEach: product.unitOz`, so `ozForRecipeInput` goes straight to step 3 (the measure registry) — deterministic, member-independent. A product-pinned line spelled with a pack label resolves to `null` and poisons to the honest `unresolved` status, which is the same posture the module already takes for an unknown unit (the ladle refusal, 2026-08-20). `addRecipeInput` rejects it at write time with a named code so an author sees it immediately instead of on the board.

**D4 — There is no `equipment` table. It is `maintenance_equipment`, and there is no existing XOR to extend.**
Spec §Equipment identity says `checklist_template_items.equipment_id` is a "third XOR target beside item/SKU" pointing at "the maintenance `equipment` registry". Live: (a) the table is `public.maintenance_equipment` (migration 0070) — `public.equipment` does not exist; (b) there is **no DB-level XOR on `checklist_template_items` at all** — the spine-link CHECK in `0163_hard_gate_and_spine_floor.sql:62-97` is a commented-out DEFERRED block that was never applied, precisely because a `NOT VALID` CHECK would 500 the `fillItemTranslations` es-fill campaign on the 34 legacy unlinked rows. Today's "XOR" is app-layer only. **Resolution:** the plan writes `equipment_id uuid REFERENCES public.maintenance_equipment(id)`, keeps enforcement app-layer exactly as it is today, and does **not** enable the deferred CHECK in this arc — but it does drop the backlog from 34 → 2 (verified live: 32 of the 34 rows already have a `maintenance_equipment` row pointing at them), which is what finally makes that deferred constraint shippable in a follow-up. That follow-up goes to `docs/ROADMAP.md`, not into this arc.

**D5 — FIFO is a READ-TIME attribution, not a re-keying of the depletion ledger. The double-count law is not touched.**
Spec §Resolution says depletion attribution is "FIFO across receipt LOTS". Implemented at the WRITER (`materializeDailyDepletion`, `lib/catering/toast-sales.ts:295`), FIFO would break that function's idempotence contract: it deletes and re-inserts ONE `(location, business_date)` day, so a lot balance carried from prior days makes a retro re-pull silently invalidate every later day's attribution. It would also put a lot-balance dependency inside the one lane the double-count law protects. **Resolution:** the ledgers stay exactly as they are — `toast_daily_depletion.direct_oz` keeps its meaning byte-for-byte, `flattened_oz` is still never summed into drift, `production_inputs` is still the human-attested lane. FIFO runs at READ time in `lib/products-shared.ts`, over lots assembled from `vendor_delivery_items`, and it is used for the two things the spec actually needs it for: allocating a **product-level count** down to member anchor lines, and allocating **product-grain variance** to the oldest lot for the reason-code trail. The mirrored false SHORT/OVER alarm is cured by the **rollup** (twins net against each other at product grain), not by re-keying rows. Net: no migration on `toast_daily_depletion`, no backfill, no risk to the law.

**D6 — Per-location primary uses the `location_id NULL = global` idiom, not a row per location.**
Spec says "per-location primary designation". A strict per-location-only table forces Juan to say "PFG ham is primary" twice for two shops that agree, and leaves `loadMenuCostingBoard` (which has no location — see D7) with no primary at all. **Resolution:** `product_primaries (product_id, location_id NULL, primary_sku_id)` with `UNIQUE (product_id, location_id) NULLS NOT DISTINCT` (Postgres 17). Resolution reads the location-specific row, else the `location_id IS NULL` global row, else falls to ladder rung ②. This is the established house idiom — `vendor_cutoffs` is read exactly this way in `lib/ordering.ts:1374-1378` (`.or("location_id.is.null,location_id.eq.<loc>")`) and `vendor_items.location_id` carries the same "null = global" semantics from migration 0095. Membership is DB-enforced: `primary_sku_id` cannot name a non-member, because a composite FK `(primary_sku_id, product_id) → vendor_items(id, product_id)` proves it — the same denormalized-composite-FK move migration 0178 made yesterday, MATCH SIMPLE and all.

**D7 — The menu costing board is location-blind, and this arc does not fix that.**
`loadMenuCostingBoard(actor)` (`lib/admin/menu-costing.ts:104`) takes no location; neither does `loadRecipeGraph()`. With per-location primaries, two shops could genuinely cost a sandwich differently. **Resolution:** `loadRecipeGraph(opts?: { locationId?: string | null })` — optional, defaulting to `null`. Location-aware callers (`lib/catering/toast-sales.ts`, `lib/catering/sku-demand.ts`, `lib/catering/surplus.ts`, and the new counts/ordering readers) pass theirs; costing, catalog, toast-map, readiness and the scripts pass nothing and resolve against the **global** primary row, which is the honest org-level replacement cost the spec asks the board to price at. A location selector on `/admin/menu-costing` is a separate, cheap follow-up and goes to `docs/ROADMAP.md`. Do not widen this arc to chase it.

**D8 — A product-level count writes per-SKU lines. `sku_count_lines` does not gain a product grain.**
Spec §Counting UX says a product-level count "allocates variance FIFO". `sku_count_lines.sku_id` is `NOT NULL` and the whole anchor/drift/variance engine (`resolvePerSkuAnchors`, `computeOnHand`, `computeVariance`) is per-SKU keyed. Adding a product-grain line would fork that engine. **Resolution:** C-mode entry resolves to oz through the **resolved primary's** basis, then `allocateProductCount` distributes that oz across member lots **newest-back** (the newest lots are what is physically still on the shelf) and writes one ordinary `sku_count_line` per member — with a new nullable `allocated_from_product_id` column for honest provenance ("this line was derived from a product count, not counted per-vendor"). The existing engine is untouched; the rollup re-sums the members and gets the counted number back exactly. Tap-to-split writes per-SKU lines directly, as today, with `allocated_from_product_id` NULL.

**D9 — `usageRank` has no seam. Grouping it by product is a change to a private function, and it is in scope.**
The audit's P2 coupling list names `usageRank`. Live it is not a type, not an export, and not a wire field: it is the local `usageBySku` map from the private `loadSkuUsageRank` (`lib/ordering.ts:229`), consumed only by the sort at `:590-591`, where a null usage sorts at `-Infinity`. That is why a backup twin sorts dead last — all consumption is pinned to the primary. **Resolution:** `loadSkuUsageRank` gains a product-aware roll-up (members of one product share the product's summed usage) inside `lib/ordering.ts`. No new export, no wire change, one new pure helper (`rollupUsageByProduct`) in `lib/products-shared.ts` so it is testable. **P6's Angel spend seed is explicitly still out of scope** — this only stops the backup from sorting last.

**D10 — "class, already live in audit metadata" is exactly right, and that is the problem. The weight board needs persisted columns.**
Spec §Weight & trim audit says the surface shows *"value · class (`OPERATIONAL` / `SPEC` / `INVOICE_DERIVED`, already live in audit metadata) · who/when established"*. Verified live: `weight_class` is **only** a JSONB key inside `audit_log.metadata`, written by two seed scripts; there is no column, no enum, no CHECK, and no migration that created one. The `WeightClass` union is a TypeScript type at `lib/angel-wave4.ts:48`. Worse, "who established" **does not exist at all** — `scripts/seed/20-angel-wave3.ts:1410` writes `actorId: null, actorRole: null`, so the only "who" is `metadata.script`. A board built on `audit_log` alone would be a per-SKU scan of a fail-open forensic table to answer a routine read. **Resolution:** `vendor_items` gains `weight_class`, `weight_source_note`, `weight_established_at`, `weight_established_by` — **nullable text/timestamptz/uuid with NO enum and NO CHECK**, following migration `0177_vendor_price_history_provenance.sql`'s explicit precedent for exactly this decision (*"the vocabulary … is expected to grow … pinning it in DDL now would force a migration per source"*). The historical audit rows stay the forensic trail; the columns are the read surface. Backfill is one pass over `audit_log` where `action = 'sku.weight_fill'` — evidence-based, no invention, and rows with no audit history stay NULL (honest absence, the 0161 LOCK-1 doctrine: *"a sentinel would be a SILENT-WRONG-NUMBER trap … NULL is honest"*).

**D11 — the standard-trim registry shipped in #271 is not importable. It must be lifted before it can be a "standard" anything.**
Spec §Weight & trim audit treats the *"standard trim registry (shipped in #271)"* as the expectation half of a standard-vs-observed comparison. Live it is a `const TRIM_STANDARDS` object at `scripts/seed/22-portioned-recipe-fix.ts:150-236` inside a one-shot seed script that **exports nothing** and contains a NUL byte at ~45135 (ripgrep classifies the file as binary). Its values reach the DB only as baked-in `recipe_inputs.quantity`, a prose stanza in `recipes.notes`, and `audit_log.metadata.trim_fraction`. **Resolution:** lift `TrimEvidence`, `TrimStandard`, `TRIM_STANDARDS` and `PORTIONED_ITEMS` verbatim into `lib/trim-standards-shared.ts` (pure, client-safe, per the `*-shared.ts` law) and have seed 22 import them, so there is one copy. That is a pure move with zero behavior change and it is what makes the drift comparison possible at all.

> **Two stale anchors in the source documents, corrected here so tasks do not chase them.** (a) The audit cites `lib/ordering.ts:419,484`; commit `e3c9870` moved them — the par filter is now `:450`, the active gate `:526-531`, and it is no longer a bare `continue` (it counts into `WalkerUnroutable`). (b) `supabase/migrations/0178`'s header says "11 ACTIVE SKUs carry NULL" vendor_id; live today it is 6 rows total. Neither changes a design decision; both would waste a build agent's afternoon.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `lib/products-shared.ts` | The whole pure core: types, `resolveProductMember`, `productInputBasis`, `attributeFifo`, `remainingByLot`, `allocateProductCount`, `allocateProductVariance`, `rollupProductGrain`, `rollupUsageByProduct`. Zero I/O, no server imports. |
| `lib/products.ts` | Server: `loadProductIndex`, `loadProductLots`, `listProducts`, `createProduct`, `attachMember`, `detachMember`, `setPrimary`, `setProductUnitOz`. Service-role + app-layer role gates. |
| `lib/weights-shared.ts` | Pure: `WeightBelief`, `classifyWeightDrift`, `rankWeightSuggestions`, `observedTrimFromProduction`. |
| `lib/trim-standards-shared.ts` | The #271 trim registry, lifted verbatim out of the seed script so it is importable (**D11**). |
| `lib/weights.ts` | Server: `loadWeightBoard`, `recordWeightMeasurement` (the audit session writer). |
| `supabase/migrations/0179_product_identity.sql` | Phase 1 schema (**authored, not applied — GATE M1**). |
| `supabase/migrations/0180_count_product_allocation.sql` | Phase 5 schema (**GATE M2**). |
| `supabase/migrations/0181_template_item_equipment_link.sql` | Phase 6 schema + backfill (**GATE M3**). |
| `scripts/seed/24-product-identity.ts` | Phase 2 seed: create products, attach members, set primaries. Dry-run default. |
| `scripts/seed/25-repoint-recipe-pins.ts` | Phase 4 seed: SKU-pin → product-pin, with a live-computed oz-parity refusal gate. Dry-run default. |
| `scripts/seed/26-weight-provenance-backfill.ts` | Phase 6 seed: fill `weight_class` / `weight_established_at` from `audit_log` evidence. Dry-run default. |
| `app/admin/products/page.tsx` + `components/admin/products/*` | The product registry admin surface. |
| `app/admin/weights/page.tsx` + `components/admin/weights/*` | The weight & trim audit surface + session. |
| `tests/products-resolution.test.ts` | Resolution ladder + `productInputBasis`. |
| `tests/products-fifo.test.ts` | `attributeFifo`, `remainingByLot`, `allocateProductCount`, `allocateProductVariance`. |
| `tests/products-rollup.test.ts` | `rollupProductGrain`, `rollupUsageByProduct`. |
| `tests/weights-shared.test.ts` | Drift classification + suggestion ranking + observed trim. |

**Modified**

| File | Change |
| --- | --- |
| `lib/prep-consumption-graph.ts` | `GraphInput.componentProductId`; `RecipeGraph.products`; product branch in `batchOz`, `perUnitSkuOzForMenuItemFromGraph`, `perUnitDirectSkuOzForMenuItem`; `buildRecipeGraph` takes the product index. |
| `lib/prep-consumption.ts` | `loadRecipeGraph(opts?)`; two new batch queries; selects `component_product_id`. |
| `lib/recipes.ts` | `addRecipeInput` + `createRecipeFull` learn the third target and the D3 unit rule; `RecipeDraftInput` gains `componentProductId`. |
| `app/api/admin/recipes/[id]/inputs/route.ts` | Passes `componentProductId`. |
| `components/admin/recipes/RecipeBuilder.tsx` | Third "add input" kind: product. |
| `lib/ordering.ts` | Primary-first routing, product-aware dedupe, `rollupUsageByProduct`, `WalkerUnroutable.reroutedToBackup`. |
| `lib/production.ts` | `loadSkuToItems` expands product-pinned inputs to **every** member (the audit's amplifier fix). |
| `lib/counts.ts` | `CountSkuOption.productId/productName`; `CountFormData.products`; `createCountEvent` accepts product lines; `OnHandView.products`. |
| `lib/counts-shared.ts` | Re-exports the product rollup for the panel; `CountLineInput` gains the product form. |
| `components/counts/CountForm.tsx` | C-mode product default + tap-to-split. |
| `components/counts/OnHandPanel.tsx` | Two-grain rendering (product headline, per-vendor split, lot remaining). |
| `lib/admin/skus.ts` | `createSku`/`updateSku` carry `product_id`; `loadLocationSkuSettings` unchanged. |
| `lib/admin/catalog-shared.ts` | `skuNameCollisions` affirms same-product twins instead of nagging (audit P7, folded here because this arc is what makes twins normal). |
| `lib/admin/cost.ts` | `loadSkuUsageMap` counts product-pinned lines toward **every** member's usage (Task 3.13). |
| `lib/admin/readiness-load.ts` | `loadGraphRows` selects `component_product_id`; an `unresolved` product becomes a readiness blocker (Task 3.13). |
| `lib/admin/sections.ts` | Registers `products` and `weights`. |
| `lib/admin/needs-link.ts`, `lib/admin/needs-link-shared.ts`, `lib/admin/template-builder-shared.ts`, `lib/admin/template-builder.ts` | Third link target `equipment` in both predicate copies, both SQL filters, and the publish column map. |
| `lib/template-items.ts` | `TEMPLATE_ITEM_COLUMNS` gains `equipment_id`; `rowToTemplateItem` maps it. |
| `lib/types.ts` | `Product`; `ChecklistTemplateItem.equipmentId`; `VendorItem.productId` (see the staleness note in Task 1.9). |
| `lib/maintenance.ts` | Per-fridge maintenance trail beside temp history. |
| `components/admin/templates/NeedsLinkQueue.tsx`, `components/admin/template-builder/TemplateBuilderClient.tsx` | Fourth filter chip + third target kind. |
| `lib/i18n/en.json`, `lib/i18n/es.json` | Every new string + ARIA label, added in the task that introduces it. |
| `docs/ROADMAP.md` | Arc close: retire the four multi-vendor debt rows; file the three named follow-ups. |

---

## Migration & seed gates (the whole list, up front)

| Gate | What | Who | Blocks |
| --- | --- | --- | --- |
| 🔒 **M1** | Apply `0179_product_identity.sql` | LEAD (MCP) after Juan's word | Phase 1 merge |
| 🔒 **S1** | Run `scripts/seed/24-product-identity.ts --execute` | LEAD, after Juan adjudicates the 8 pairs | Phase 2 close |
| 🔒 **S2** | Run `scripts/seed/25-repoint-recipe-pins.ts --execute` | LEAD, after the dry run shows zero refusals | Phase 4 close |
| 🔒 **M2** | Apply `0180_count_product_allocation.sql` | LEAD | Phase 5 merge |
| 🔒 **M3** | Apply `0181_template_item_equipment_link.sql` | LEAD | Phase 6 merge |

Every gate follows the same protocol: the file is committed in the PR, the lead pre-flights it against the live schema (`information_schema.columns` / `pg_constraint` / a row count), applies it via MCP, pastes the result into the PR, and only then is the PR mergeable. Juan clicks the merge.

---

# PHASE 1 — Schema (spec §1) · migration `0179`

**Ships:** the `products` + `product_primaries` tables, `vendor_items.product_id`, `recipe_inputs.component_product_id` with the XOR extended to three, the `create_recipe_full` RPC replaced, the weight-provenance columns (D10), and the admin surface to create a product and attach members. Nothing resolves yet — zero products exist, so every read path is byte-identical to today.

**Estimated size:** ~10 tasks · 1 migration (~150 lines SQL) · ~500 lines TS · 1 PR.

**Smoke focus (Juan, on the PR preview):** `/admin/products` renders an empty registry; creating "HAM" and attaching both ham SKUs works; `/admin/menu-costing`, `/ordering` and `/operations/counts` render **exactly as they do on prod** — this phase must be invisible outside `/admin/products`.

## Task 1.1 — Branch

- [ ] Create the branch off a clean `main`.

```bash
cd /c/Users/conta/co-ops
git fetch && git checkout main && git reset --hard origin/main
git checkout -b feat/product-identity-p1-schema
git log --oneline -1
```

Expected: `69404ac docs: product identity + weight/trim audit + equipment identity design spec (Juan-ratified, 2026-08-20)`

## Task 1.2 — Author migration `0179_product_identity.sql` (AUTHOR ONLY — DO NOT APPLY)

- [ ] Create `supabase/migrations/0179_product_identity.sql`:

```sql
-- Migration 0179_product_identity
-- AUTHORED 2026-08-20. NOT YET APPLIED — application is a named LEAD/JUAN gate
-- (plan docs/superpowers/plans/2026-08-20-product-identity.md, GATE M1).
-- Canonical reference: docs/superpowers/specs/2026-08-20-product-identity-design.md §1
-- Foundation: docs/audits/2026-08-20-multivendor-semantics-audit.md gap P2.
--
-- WHY: nothing above vendor_items knows that two vendors' hams are one product.
-- Recipes pin ONE vendor's SKU (recipe_inputs.component_sku_id), so a vendor going
-- down evaporates demand, depletion follows a dead pin producing mirrored false
-- SHORT/OVER variance, counts cannot roll twins up, and "what we buy most" has no
-- grain to live at. This adds the missing node: a thin product identity that recipes
-- pin instead of a vendor's SKU, with member SKUs attached beneath it.
--
-- SHAPE:
--   products                 the raw identity ("HAM"). Modeled on public.items
--                            (0079): name + name_es siblings, notes, active, the
--                            four-column audit block.
--   vendor_items.product_id  nullable FK. NULL = an implicit SINGLETON: the code
--                            treats a productless SKU as trivially resolving to
--                            itself, so ~95% of the catalog needs no product row
--                            and no data migration. Products exist only where
--                            plurality does.
--   product_primaries        per-location primary designation, location_id NULL =
--                            global default (the vendor_cutoffs / vendor_items
--                            "null = global" house idiom).
--   recipe_inputs.component_product_id
--                            the third component target; the 2-way XOR CHECK from
--                            0103 is replaced by a 3-way exactly-one.
--
-- WHAT ONE UNIT WEIGHS (products.unit_oz) — LOAD-BEARING, NOT DECORATION.
-- Live, the ham and fresh-mozzarella pins read `quantity = 1, unit = 'unit'`, and
-- 'unit' is a COUNT measure, so lib/recipe-math.ts ozForRecipeInput resolves the
-- line through the SKU'S OWN avg_oz_per_each — Baldor Ham 1.2, PFG Ham NULL. A pin
-- that resolved to a different member would swing or DELETE the line's oz with no
-- error anywhere. scripts/seed/18-twin-adjudication.ts refused its own pin-move over
-- exactly this and named the fix: "the pin cannot follow the par until something owns
-- what one 'unit' of the product weighs." products.unit_oz is that something, and
-- lib/products-shared.ts productInputBasis makes the recipe basis member-independent
-- by construction.
--
-- PROVENANCE COLUMNS (weight audit, spec section "Weight & trim audit").
-- weight_class / weight_source_note / weight_established_at / weight_established_by
-- are NULLABLE text/timestamptz/uuid with NO enum and NO CHECK — the deliberate
-- precedent set by 0177_vendor_price_history_provenance ("the vocabulary ... is
-- expected to grow ... pinning it in DDL now would force a migration per source").
-- Today the class lives only inside audit_log.metadata.weight_class and "who
-- established" is not recorded at all (the seeds write actorId null), so these
-- columns are the read surface the weight board needs; the audit rows remain the
-- forensic trail. NO backfill here — the evidence pass is a separate seed (Phase 6).
--
-- MEMBERSHIP IS DB-PROVEN, NOT APP-TRUSTED: a composite FK forces a primary to be a
-- member of the product it is primary for — the same denormalized-composite-FK move
-- migration 0178 made, MATCH SIMPLE and all: when product_id is NULL the constraint
-- is simply not checked, which is correct for a singleton SKU.
--
-- ADDITIVE + BACKWARD-COMPATIBLE: every new column is nullable with no default, and
-- the replaced CHECK is strictly weaker (it admits a third case and forbids nothing
-- previously legal). Append-only law untouched: no DELETE path, no supersede.
--
-- RLS: the REVOKE-only posture for new tables (0168+, per 0172/0174's stated
-- reasoning: "the revoke is sufficient and avoids the policy-stacking hazard").
-- Reads go through service-role app loaders with app-layer role gates.
--
-- PRE-FLIGHT BEFORE APPLY (lead runs these and pastes the output into the PR):
--   select count(*) from information_schema.tables where table_name = 'products';  -- expect 0
--   select count(*) from recipe_inputs;                                            -- record it
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'recipe_inputs'::regclass;                                    -- expect the 2-way XOR
--   select count(*) from vendor_items;                                             -- expect 182

-- (1) products -----------------------------------------------------------------
create table if not exists public.products (
  id                     uuid        primary key default gen_random_uuid(),
  name                   text        not null,
  name_es                text        null,
  notes                  text        null,
  unit_oz                numeric     null check (unit_oz is null or unit_oz > 0),
  unit_oz_class          text        null,
  unit_oz_source_note    text        null,
  unit_oz_established_at timestamptz null,
  unit_oz_established_by uuid        null references public.users(id),
  active                 boolean     not null default true,
  created_at             timestamptz not null default now(),
  created_by             uuid        null references public.users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid        null references public.users(id)
);

create unique index if not exists products_name_lower_uq
  on public.products (lower(name)) where active;

comment on table public.products is
  'Product identity above SKUs (audit P2, spec 2026-08-20). The raw thing a recipe '
  'means ("HAM"), independent of which vendor supplied it. Member SKUs attach via '
  'vendor_items.product_id. A SKU with product_id NULL is an implicit singleton and '
  'needs no row here — products exist only where plurality does.';

comment on column public.products.unit_oz is
  'What ONE unit of this product weighs, in ounces. THE reason a product-pinned '
  'recipe line survives a member flip: lib/products-shared.ts productInputBasis '
  'builds the line''s pack basis from THIS number, never from the resolved member''s '
  'avg_oz_per_each, so a count-denominated line ("1 unit of HAM") means the same oz '
  'whichever vendor is primary today. NULL = not yet established; a count-denominated '
  'product-pinned line then refuses (poisons the flatten to `unresolved`) rather than '
  'guessing. See scripts/seed/18-twin-adjudication.ts''s refusal.';

comment on column public.products.unit_oz_class is
  'Provenance CLASS of unit_oz: OPERATIONAL | SPEC | INVOICE_DERIVED (lib/angel-wave4.ts '
  'WeightClass). Deliberately unconstrained text, per 0177''s precedent — the vocabulary '
  'is expected to grow and a CHECK would force a migration per class.';

-- (2) vendor_items.product_id + the composite-FK target ------------------------
alter table public.vendor_items
  add column if not exists product_id uuid null references public.products(id);

comment on column public.vendor_items.product_id is
  'The product this SKU is a member of (0179). NULL = implicit singleton (resolution '
  'is trivially itself) — the ~95% case, deliberately not backfilled.';

create index if not exists vendor_items_product_ix on public.vendor_items(product_id);

-- FK target for the primary-membership proof below. `id` is already the PK, so this
-- UNIQUE adds no restriction whatsoever; it exists only because a composite FK
-- requires a UNIQUE/PK on exactly the referenced column pair (the 0178 idiom).
alter table public.vendor_items
  add constraint vendor_items_id_product_uq unique (id, product_id);

-- (3) weight provenance on the SKU (deviation D10) -----------------------------
alter table public.vendor_items
  add column if not exists weight_class          text        null,
  add column if not exists weight_source_note    text        null,
  add column if not exists weight_established_at timestamptz null,
  add column if not exists weight_established_by uuid        null references public.users(id);

comment on column public.vendor_items.weight_class is
  'Provenance CLASS of avg_oz_per_each: OPERATIONAL | SPEC | INVOICE_DERIVED. Was '
  'audit_log.metadata.weight_class only (waves 3-4); promoted to a column so the weight '
  'board is a read, not a forensic scan. Unconstrained text per 0177''s precedent.';

comment on column public.vendor_items.weight_established_by is
  'Who last established avg_oz_per_each. NULL for every seed-written weight — the '
  'seeds audit with actorId null, so there is genuinely nobody to name. NULL is the '
  'honest value; never backfill it with a placeholder actor.';

-- (4) product_primaries (per-location, location_id NULL = global) --------------
create table if not exists public.product_primaries (
  id             uuid        primary key default gen_random_uuid(),
  product_id     uuid        not null references public.products(id),
  location_id    uuid        null references public.locations(id),
  primary_sku_id uuid        not null,
  note           text        null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid        null references public.users(id),
  constraint product_primaries_scope_uq unique nulls not distinct (product_id, location_id),
  -- MEMBERSHIP PROOF: the primary must be a SKU whose product_id equals this row's
  -- product_id. Two columns, one composite FK, zero app trust (0178's move).
  constraint product_primaries_member_fk
    foreign key (primary_sku_id, product_id) references public.vendor_items(id, product_id)
);

create index if not exists product_primaries_product_ix on public.product_primaries(product_id);

comment on table public.product_primaries is
  'Which member SKU is PRIMARY for a product. location_id NULL = the global default '
  '(the vendor_cutoffs / vendor_items "null = global" house idiom); a row with a '
  'location_id overrides it for that shop. Rung 1 of the resolution ladder — if the '
  'named primary is inactive, resolution falls through to rung 2 (most-recently '
  'received active member); it does NOT fail.';

alter table public.products enable row level security;
revoke all on public.products from anon, authenticated;
revoke all on public.products from public;

alter table public.product_primaries enable row level security;
revoke all on public.product_primaries from anon, authenticated;
revoke all on public.product_primaries from public;

-- (5) recipe_inputs: the third component target --------------------------------
alter table public.recipe_inputs
  add column if not exists component_product_id uuid null references public.products(id);

create index if not exists recipe_inputs_product_idx on public.recipe_inputs(component_product_id);

-- Replace the 2-way XOR (0103) with a 3-way exactly-one. Strictly weaker: every row
-- legal before is legal after. Drop-then-add inside the one migration transaction so
-- no window exists in which the table is unconstrained.
alter table public.recipe_inputs drop constraint recipe_inputs_exactly_one_component;
alter table public.recipe_inputs
  add constraint recipe_inputs_exactly_one_component check (
    ((component_sku_id     is not null)::int
   + (component_item_id    is not null)::int
   + (component_product_id is not null)::int) = 1
  );

comment on column public.recipe_inputs.component_product_id is
  'Pin the PRODUCT, not a vendor''s SKU (spec 2026-08-20). Resolution to a member '
  'happens once, at graph build (lib/prep-consumption.ts loadRecipeGraph), so every '
  'downstream consumer keeps its SKU-keyed output. A product-pinned line may only be '
  'denominated in a MEASURE-REGISTRY unit — a pack/chain label is a per-vendor '
  'spelling and is rejected at write and refused at resolve.';

-- (6) create_recipe_full RPC — carry the third target --------------------------
-- Same SECURITY DEFINER + locked search_path + service-role-only grants as 0105.
-- The app layer (lib/recipes.ts createRecipeFull) validates exactly-one BEFORE
-- calling; the table CHECK is the backstop.
create or replace function create_recipe_full(
  p_header jsonb, p_inputs jsonb, p_outputs jsonb, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipe_id uuid; r jsonb;
begin
  insert into recipes (name, name_es, recipe_type, batch_yield, directions, directions_es, active, created_by)
  values (
    p_header->>'name', nullif(p_header->>'name_es',''), p_header->>'recipe_type',
    (p_header->>'batch_yield')::numeric, nullif(p_header->>'directions',''),
    nullif(p_header->>'directions_es',''), true, p_created_by
  ) returning id into v_recipe_id;

  for r in select value from jsonb_array_elements(coalesce(p_inputs,'[]'::jsonb)) as t(value) loop
    insert into recipe_inputs (recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order, created_by)
    values (
      v_recipe_id, nullif(r->>'component_sku_id','')::uuid, nullif(r->>'component_item_id','')::uuid,
      nullif(r->>'component_product_id','')::uuid,
      (r->>'quantity')::numeric, nullif(r->>'unit',''), nullif(r->>'each_container_label',''),
      coalesce((r->>'portioned')::boolean, false), coalesce((r->>'display_order')::int, 0), p_created_by
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value) loop
    insert into recipe_outputs (recipe_id, output_item_id, output_menu_item_id, yield, output_container_label, display_order, created_by)
    values (
      v_recipe_id, nullif(r->>'output_item_id','')::uuid, nullif(r->>'output_menu_item_id','')::uuid,
      (r->>'yield')::numeric, nullif(r->>'output_container_label',''),
      coalesce((r->>'display_order')::int, 0), p_created_by
    );
  end loop;

  return v_recipe_id;
end $$;

-- CREATE OR REPLACE preserves grants, but re-assert them: AGENTS.md's
-- REVOKE-FROM-PUBLIC lesson is that Supabase's default ACLs grant EXECUTE to anon
-- EXPLICITLY, so revoking from public alone is not enough. Verify after apply via
-- information_schema.routine_privileges.
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from public;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from anon;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from authenticated;
grant  execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) to service_role;
```

- [ ] Commit — the file only. Do not run it.

```bash
git add supabase/migrations/0179_product_identity.sql
git commit -m "feat(db): 0179 product identity schema (authored, unapplied)"
```

## Task 1.3 — Resolution ladder: write the failing test

- [ ] Create `tests/products-resolution.test.ts`:

```ts
/**
 * The resolution ladder (spec 2026-08-20, "Resolution"). ONE pure function decides
 * which member SKU a product means, and costing / depletion / production / ordering
 * all ask THIS one — never four private opinions.
 *
 *   (1) the location-flagged primary, if active
 *   (2) else the most-recently-RECEIVED active member
 *   (3) else any active member (stable tiebreak)
 *   (4) else honest `unresolved`
 */
import { describe, it, expect } from "vitest";
import { resolveProductMember, type ProductMember } from "@/lib/products-shared";

const member = (over: Partial<ProductMember> & { skuId: string }): ProductMember => ({
  vendorId: null,
  vendorName: null,
  active: true,
  avgOzPerEach: null,
  lastReceivedAt: null,
  ...over,
});

describe("resolveProductMember", () => {
  it("(1) the flagged primary wins when active", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: "pfg",
      members: [member({ skuId: "baldor", lastReceivedAt: "2026-08-19T00:00:00Z" }), member({ skuId: "pfg" })],
    });
    expect(r).toEqual({ productId: "P", skuId: "pfg", rung: "primary", consideredSkuIds: ["baldor", "pfg"] });
  });

  it("(1) is SKIPPED when the flagged primary is inactive — it falls through, never fails", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: "pfg",
      members: [
        member({ skuId: "pfg", active: false }),
        member({ skuId: "baldor", lastReceivedAt: "2026-08-19T00:00:00Z" }),
      ],
    });
    expect(r.skuId).toBe("baldor");
    expect(r.rung).toBe("recent");
  });

  it("(1) is SKIPPED when the flagged primary is not a member at all", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: "ghost",
      members: [member({ skuId: "baldor" })],
    });
    expect(r.skuId).toBe("baldor");
    expect(r.rung).toBe("any");
  });

  it("(2) most-recently-RECEIVED active member, not most-recently-created", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [
        member({ skuId: "a", lastReceivedAt: "2026-08-01T00:00:00Z" }),
        member({ skuId: "b", lastReceivedAt: "2026-08-18T09:00:00Z" }),
        member({ skuId: "c", lastReceivedAt: "2026-08-18T08:00:00Z" }),
      ],
    });
    expect(r.skuId).toBe("b");
    expect(r.rung).toBe("recent");
  });

  it("(2) ignores INACTIVE members even when they were received most recently", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [
        member({ skuId: "dead", active: false, lastReceivedAt: "2026-08-20T00:00:00Z" }),
        member({ skuId: "live", lastReceivedAt: "2026-08-01T00:00:00Z" }),
      ],
    });
    expect(r.skuId).toBe("live");
  });

  it("(3) any active member when nothing was ever received — and the pick is STABLE", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [member({ skuId: "zeta" }), member({ skuId: "alpha" })],
    });
    expect(r.skuId).toBe("alpha");
    expect(r.rung).toBe("any");
    const flipped = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [member({ skuId: "alpha" }), member({ skuId: "zeta" })],
    });
    expect(flipped.skuId).toBe("alpha");
  });

  it("(3) breaks a received-at TIE on skuId rather than on row order", () => {
    const at = "2026-08-18T00:00:00Z";
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [member({ skuId: "zeta", lastReceivedAt: at }), member({ skuId: "alpha", lastReceivedAt: at })],
    });
    expect(r.skuId).toBe("alpha");
    expect(r.rung).toBe("recent");
  });

  it("(4) every member inactive -> unresolved, NOT a silent pick", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: "a",
      members: [member({ skuId: "a", active: false }), member({ skuId: "b", active: false })],
    });
    expect(r).toEqual({ productId: "P", skuId: null, rung: "unresolved", consideredSkuIds: ["a", "b"] });
  });

  it("(4) no members at all -> unresolved", () => {
    const r = resolveProductMember({ productId: "P", primarySkuId: null, members: [] });
    expect(r.skuId).toBeNull();
    expect(r.rung).toBe("unresolved");
  });

  it("an unparseable lastReceivedAt is treated as NEVER received, never as now", () => {
    const r = resolveProductMember({
      productId: "P",
      primarySkuId: null,
      members: [
        member({ skuId: "bad", lastReceivedAt: "not-a-date" }),
        member({ skuId: "good", lastReceivedAt: "2026-01-01T00:00:00Z" }),
      ],
    });
    expect(r.skuId).toBe("good");
  });
});
```

- [ ] Run it and confirm it fails because the module does not exist:

```bash
npx vitest run tests/products-resolution.test.ts
```

## Task 1.4 — `lib/products-shared.ts`: resolution + recipe basis

- [ ] Create `lib/products-shared.ts`:

```ts
/**
 * Product identity — PURE core (zero I/O, no server imports, client-safe; the
 * `*-shared.ts` pattern, AGENTS.md). lib/location-sku-shared.ts is the template.
 *
 * A PRODUCT is the raw identity a recipe means ("HAM"), independent of which vendor
 * supplied it. Member SKUs attach beneath it. A SKU with no product is an implicit
 * SINGLETON: resolution is trivially itself, which is why ~95% of the catalog needs
 * no product row and no data migration.
 *
 * THREE QUESTIONS, THREE ANSWERS, NEVER CONFLATED (spec 2026-08-20):
 *   - what to ORDER / what to PRICE  -> resolveProductMember (the primary-first ladder)
 *   - what actually got EATEN        -> attributeFifo over receipt lots
 *   - what is ON HAND                -> rollupProductGrain (per-SKU ledgers are the
 *                                      truth; the product grain is their sum)
 *
 * Everything here is total and deterministic: no Date.now(), no Math.random(), no
 * dependence on input array order. That is what lets ONE function be consumed by
 * costing, depletion, production and ordering without any of them disagreeing.
 */
import type { RecipeInputSku } from "@/lib/recipe-math";

// -- Resolution ---------------------------------------------------------------

/** One member SKU of a product, as the resolver needs to see it. */
export interface ProductMember {
  skuId: string;
  vendorId: string | null;
  /** Display only — the twin label on count sheets and order walks. */
  vendorName: string | null;
  /** The location-RESOLVED active flag (overlay ?? global), never the raw column. */
  active: boolean;
  /** The member's own avg_oz_per_each — used ONLY as the fallback basis when the
   *  product has no unit_oz, and reported for the member-divergence advisory. */
  avgOzPerEach: number | null;
  /** ISO of the most recent delivery line for this SKU at the resolving location.
   *  null = never received here. Rung 2 reads this and nothing else. */
  lastReceivedAt: string | null;
}

export interface ProductResolutionInput {
  productId: string;
  /** The primary designated for this location, else the global default, else null. */
  primarySkuId: string | null;
  members: ProductMember[];
}

/** Which rung of the ladder answered. Carried into the audit row on every flip. */
export type ProductResolutionRung = "primary" | "recent" | "any" | "unresolved";

export interface ProductResolution {
  productId: string;
  /** null ONLY on rung "unresolved" — never a fabricated pick. */
  skuId: string | null;
  rung: ProductResolutionRung;
  /** Every member id considered, in input order — the "why" half of the audit row. */
  consideredSkuIds: string[];
}

/** Milliseconds since epoch, or null for absent/unparseable. Never `now`. */
function receivedMs(iso: string | null): number | null {
  if (iso == null) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * THE resolution ladder (spec, "the stable question"):
 *   (1) the member flagged primary for this location, IF ACTIVE
 *   (2) else the most-recently-RECEIVED active member
 *   (3) else any active member (skuId ascending — a STABLE, not arbitrary, pick)
 *   (4) else honest `unresolved`
 *
 * A flagged primary that is inactive or not a member FALLS THROUGH; it never fails
 * the whole product. That is the vendor-down behavior the entire arc exists for.
 * Rungs 2 and 3 break ties on skuId so two callers holding the same data in
 * different row order can never disagree.
 */
export function resolveProductMember(input: ProductResolutionInput): ProductResolution {
  const consideredSkuIds = input.members.map((m) => m.skuId);
  const base = { productId: input.productId, consideredSkuIds };

  const active = input.members.filter((m) => m.active);
  if (active.length === 0) return { ...base, skuId: null, rung: "unresolved" };

  // (1) flagged primary, if it is an ACTIVE member of this product.
  if (input.primarySkuId != null && active.some((m) => m.skuId === input.primarySkuId)) {
    return { ...base, skuId: input.primarySkuId, rung: "primary" };
  }

  // (2) most-recently-received active member.
  const received = active
    .map((m) => ({ skuId: m.skuId, ms: receivedMs(m.lastReceivedAt) }))
    .filter((m): m is { skuId: string; ms: number } => m.ms != null)
    .sort((a, b) => (b.ms !== a.ms ? b.ms - a.ms : a.skuId.localeCompare(b.skuId)));
  if (received.length > 0) return { ...base, skuId: received[0]!.skuId, rung: "recent" };

  // (3) any active member, stably.
  const any = [...active].sort((a, b) => a.skuId.localeCompare(b.skuId));
  return { ...base, skuId: any[0]!.skuId, rung: "any" };
}

// -- Recipe basis (deviation D3) ----------------------------------------------

/** What a product knows about its own mass. */
export interface ProductMassBasis {
  productId: string;
  /** products.unit_oz — what ONE unit of the product weighs. */
  unitOz: number | null;
}

/**
 * The pack shape a PRODUCT-pinned recipe line resolves through.
 *
 * MEASURE-REGISTRY ONLY, BY CONSTRUCTION. packChain / packFormat /
 * eachContainerLabel are all null, so lib/recipe-math.ts ozForRecipeInput skips
 * steps 1 and 2 and lands on step 3 (the measure registry). Those two steps match
 * the unit against a SKU's OWN pack spellings, and "1 case" of Baldor ham is not
 * "1 case" of PFG ham — a product pin has no honest way to choose between them, so
 * it is not offered the choice.
 *
 * avgOzPerEach comes from the PRODUCT (unit_oz), falling back to the resolved
 * member's own value only when the product has not been weighed. The fallback is
 * deliberately last: while it is in play, a member flip CAN move the number, which
 * is exactly the hazard scripts/seed/18-twin-adjudication.ts refused over — so the
 * weight board ranks unweighed multi-member products at the top of its suggestions
 * and the Phase-4 re-point script refuses those lines outright.
 */
export function productInputBasis(
  product: ProductMassBasis,
  resolvedMember: ProductMember | null,
): RecipeInputSku {
  return {
    packFormat: null,
    eachContainerLabel: null,
    unitsPerPack: null,
    eachSize: null,
    eachMeasure: null,
    avgOzPerEach: product.unitOz ?? resolvedMember?.avgOzPerEach ?? null,
    packChain: null,
  };
}

/**
 * Do this product's ACTIVE members disagree about what one unit weighs? Advisory
 * only — it never blocks resolution. It is what the weight board ranks on and what
 * the Phase-4 re-point script refuses on: while members disagree AND the product has
 * no unit_oz, a member flip silently re-denominates every count-based line.
 * Tolerance is a fraction of the larger value. Fewer than 2 KNOWN values -> false
 * (nothing to disagree about; an unknown is not a dissent).
 */
export function membersDisagreeOnUnitOz(
  members: ReadonlyArray<ProductMember>,
  tolerance = 0.02,
): boolean {
  const vals = members
    .filter((m) => m.active)
    .map((m) => m.avgOzPerEach)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (vals.length < 2) return false;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return hi > 0 && (hi - lo) / hi > tolerance;
}
```

- [ ] Run the test — it must now pass:

```bash
npx vitest run tests/products-resolution.test.ts
```

- [ ] Commit: `git commit -am "feat(products): pure resolution ladder + product recipe basis"`

## Task 1.5 — `productInputBasis`: the D3 cases

- [ ] Append to `tests/products-resolution.test.ts`:

```ts
import { productInputBasis, membersDisagreeOnUnitOz } from "@/lib/products-shared";
import { ozForRecipeInput, type MeasureUnitFactor } from "@/lib/recipe-math";

const measures = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["unit", { dimension: "count", toBaseFactor: 1 }],
]);

describe("productInputBasis (deviation D3 — measure-registry only)", () => {
  it("a count-denominated line reads the PRODUCT's unit_oz, not the member's", () => {
    const basis = productInputBasis(
      { productId: "P", unitOz: 1.2 },
      member({ skuId: "pfg", avgOzPerEach: null }),
    );
    expect(ozForRecipeInput(1, "unit", basis, measures)).toBe(1.2);
  });

  it("REGRESSION (seed 18): flipping the resolved member does NOT change the line's oz", () => {
    const product = { productId: "P", unitOz: 1.2 };
    const onBaldor = productInputBasis(product, member({ skuId: "baldor", avgOzPerEach: 1.2 }));
    const onPfg = productInputBasis(product, member({ skuId: "pfg", avgOzPerEach: null }));
    expect(ozForRecipeInput(1, "unit", onBaldor, measures))
      .toBe(ozForRecipeInput(1, "unit", onPfg, measures));
  });

  it("falls back to the member's avg_oz_per_each only when the product is unweighed", () => {
    const basis = productInputBasis({ productId: "P", unitOz: null }, member({ skuId: "b", avgOzPerEach: 1.2 }));
    expect(basis.avgOzPerEach).toBe(1.2);
  });

  it("a weight-denominated line is member-independent regardless", () => {
    const basis = productInputBasis({ productId: "P", unitOz: null }, null);
    expect(ozForRecipeInput(3, "oz", basis, measures)).toBe(3);
  });

  it("a PACK label refuses — 'case' is a per-vendor spelling a product cannot own", () => {
    const basis = productInputBasis({ productId: "P", unitOz: 1.2 }, member({ skuId: "b", avgOzPerEach: 1.2 }));
    expect(ozForRecipeInput(1, "case", basis, measures)).toBeNull();
  });

  it("unweighed product + no member weight -> null, never 0", () => {
    const basis = productInputBasis({ productId: "P", unitOz: null }, member({ skuId: "b", avgOzPerEach: null }));
    expect(ozForRecipeInput(1, "unit", basis, measures)).toBeNull();
  });
});

describe("membersDisagreeOnUnitOz", () => {
  it("1.2 vs 1.0 disagree", () => {
    expect(membersDisagreeOnUnitOz([
      member({ skuId: "a", avgOzPerEach: 1.2 }),
      member({ skuId: "b", avgOzPerEach: 1.0 }),
    ])).toBe(true);
  });
  it("one known value cannot disagree with an unknown one", () => {
    expect(membersDisagreeOnUnitOz([
      member({ skuId: "a", avgOzPerEach: 1.2 }),
      member({ skuId: "b", avgOzPerEach: null }),
    ])).toBe(false);
  });
  it("inactive members do not vote", () => {
    expect(membersDisagreeOnUnitOz([
      member({ skuId: "a", avgOzPerEach: 1.2 }),
      member({ skuId: "dead", active: false, avgOzPerEach: 5 }),
    ])).toBe(false);
  });
  it("rounding-scale differences do not count as disagreement", () => {
    expect(membersDisagreeOnUnitOz([
      member({ skuId: "a", avgOzPerEach: 1.2 }),
      member({ skuId: "b", avgOzPerEach: 1.21 }),
    ])).toBe(false);
  });
});
```

- [ ] `npx vitest run tests/products-resolution.test.ts` — green. Commit.

## Task 1.6 — `lib/products.ts`: the server layer

- [ ] Create `lib/products.ts`, following `lib/admin/skus.ts`'s shape exactly:
  - `import "server-only";`
  - `export const PRODUCT_READ_MIN = 6;` (AGM+ — the `vendor_items` read/cost-read floor) and `export const PRODUCT_WRITE_MIN = 7;` (GM+ — `SKU_WRITE_MIN`, `lib/admin/skus.ts:48`; a product is SKU-registry-grade config).
  - `export class ProductError extends Error { constructor(public status: number, public code: string, message?: string) { super(message ?? code); this.name = "ProductError"; } }`
  - The `DbProductRow` (snake_case; numerics typed `number | string | null`) + `ProductView` (camelCase) pair, next to the loader — the `lib/admin/skus.ts:649-662` precedent.
  - `listProducts(actor): Promise<ProductView[]>` — **three batch queries, never per-product**: one `products` read, one grouped `vendor_items` read for members (`.in("product_id", ids)`), one `product_primaries` read. Vendor names come from ONE batched `vendors` lookup, and a failure there degrades to `null` labels rather than failing the page (the `loadCountFormData` LABEL-ONLY precedent, `lib/counts.ts:128-137`).
  - Writers: `createProduct`, `attachMember`, `detachMember`, `setPrimary`, `setProductUnitOz`.
- [ ] Every writer: `requireLevel(actor, PRODUCT_WRITE_MIN)` -> service-role write with `{ count: "exact" }` -> **`if (count === 0) throw new ProductError(404, "not_found")`** (the silent-UPDATE law) -> `audit(...)`.
- [ ] New audit vocabulary, dot-namespaced (AGENTS.md): `product.create` · `product.member_attach` · `product.member_detach` · `product.primary_set` · `product.unit_oz_set`. None are destructive — do **not** add them to `DESTRUCTIVE_ACTIONS`.
- [ ] `detachMember` refuses with 409 `primary_must_be_reassigned` when a `product_primaries` row names that SKU. The composite FK would reject it anyway; a named 409 is a better error than a constraint violation surfacing as a 500.
- [ ] `setProductUnitOz` writes `unit_oz`, `unit_oz_class`, `unit_oz_source_note`, `unit_oz_established_at = now()`, `unit_oz_established_by = actor.user.id` in one update, and audits the before/after — the weight-audit session (Phase 6) calls this same function.
- [ ] Commit.

## Task 1.7 — `/admin/products` surface

- [ ] `app/admin/products/page.tsx` — the C.39 pattern verbatim: `requireSessionFromHeaders("/admin")` -> `if (ROLES[auth.user.role].level < PRODUCT_READ_MIN) redirect("/dashboard")` -> `listProducts(auth)` -> render.
- [ ] `components/admin/products/ProductsClient.tsx` — Disclosure Doctrine (`docs/DISCLOSURE_DOCTRINE.md`): `CollapsibleSection` groups with **needs attention** first and `defaultOpen` (unresolved · unweighed · members disagree), one `SummaryRow` per product (name · member count · primary vendor · `unit_oz` or a "needs weighing" pill), lazy `RowDrawer` carrying the member list, attach/detach, the per-location primary picker ("All locations" + one row per location), and the `unit_oz` editor. `useState`-only disclosure state.
- [ ] Controls use the **admin-form grammar**: `rounded-lg`, 44px min-height **paired with `items-center`**, `border-co-gold-deep`, control labels at `tracking-[0.1em]`. Group headers 12px/700/`tracking-wide`; field labels 10-11px/700/`tracking-[0.12em]`/`text-co-text-dim`.
- [ ] Register the section in `lib/admin/sections.ts`, immediately **after** `skus` — a product sits above SKUs in Juan's derivation order (vendors -> SKUs -> **products** -> recipes -> items):

```ts
  { id: "products",            i18nKey: "admin.section.products",            href: "/admin/products",            minLevel: 6 },
```

- [ ] Add `admin.section.products` and every new string **and every ARIA label** to BOTH `lib/i18n/en.json` and `lib/i18n/es.json` (operational tú-form Spanish). Register the key in `TranslationKey` rather than casting.
- [ ] Commit.

## Task 1.8 — `product_id` through the SKU admin

- [ ] `lib/admin/skus.ts`: `CreateSkuInput` and the update payload gain `productId?: string | null`; both writers pass `product_id`; both audit rows record it.
- [ ] The SKU form component (grep the `createSku` / `updateSku` consumers) gains a product `<select>` whose first option is an explicit "— none (singleton) —". **Never default it to a product.**
- [ ] i18n both files. Commit.

## Task 1.9 — Types

- [ ] `lib/types.ts`: add `export interface Product { … }` inside the `// Item / inventory registry (Item/Inventory Spine, sub-project 1)` banner, with per-field doc comments naming migration 0179 (house style).
- [ ] Add `productId: string | null` to `VendorItem` (`lib/types.ts:110`).
- [ ] **Do NOT fix the rest of `VendorItem` here.** It is already ~10 columns stale (missing `locationId`, `packFormat`, `unitsPerPack`, `eachSize`, `eachMeasure`, `avgOzPerEach`, `eachContainerLabel`, `inventoryOnly`, `skuClass`, `guidePosition`) and mistypes `vendorId`/`unit` as non-nullable. A drive-by on a 1527-line shared type invites a review this PR should not need. Instead add a `docs/ROADMAP.md` DEBT row: `lib/types.ts VendorItem ~10 columns stale + vendorId/unit mistyped | next types.ts touch`.
- [ ] Run the shared-type consumer grep (AGENTS.md) before committing:

```bash
grep -rE "\bVendorItem\b" --include=*.ts --include=*.tsx . | grep -v node_modules
```

- [ ] Commit.

## Task 1.10 — CI green + PR

- [ ] `npm test` — all suites green.
- [ ] `npx tsc --noEmit` and `npm run build` — clean (`next build` is a separate gate from typecheck).
- [ ] Push, open the PR, confirm the required `build` check is green.

## GATE M1 (LOCKED) — LEAD/JUAN applies migration `0179`

- [ ] **BUILD AGENTS STOP HERE.** Report the PR number and this checklist; do not proceed to Phase 2.
- [ ] **LEAD:** run the four pre-flight queries from the migration header against live prod; paste the output into the PR.
- [ ] **LEAD:** apply `0179` via the Supabase MCP `apply_migration`.
- [ ] **LEAD:** verify after apply and paste:
  - `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='recipe_inputs'::regclass;` -> the 3-way XOR present.
  - `select grantee, privilege_type from information_schema.routine_privileges where routine_name='create_recipe_full';` -> **`service_role` only**; `anon` and `authenticated` absent (the REVOKE-FROM-PUBLIC law — this is the whole reason the grants are re-asserted).
  - `select count(*) from products;` -> 0 · `select count(*) from vendor_items where product_id is not null;` -> 0.
- [ ] **JUAN:** smoke the preview per the focus above, then merge.

---

# PHASE 2 — Seed products, attach members, set primaries (spec §2)

**Ships:** `scripts/seed/24-product-identity.ts` — dry-run-by-default, creating the products plurality demands, attaching member SKUs, setting primaries from Juan's adjudications, and filling `unit_oz` where the evidence is unambiguous. **Pure data. Zero behavior change** — nothing reads `product_id` until Phase 3.

**Estimated size:** ~4 tasks · ~600 lines of seed script (mostly evidence tables + the dry-run report) · 1 PR.

**Smoke focus (Juan):** the dry-run markdown IS the smoke. He reads it and adjudicates the 8 undecided pairs; nothing in the running app changes, and the PR should say so explicitly.

## Task 2.1 — Branch off a fresh main

```bash
git fetch && git checkout main && git reset --hard origin/main
git checkout -b feat/product-identity-p2-seed
```

## Task 2.2 — Discovery pass (read-only; run this first)

- [ ] Write `scripts/seed/24-product-identity.ts` so its dry run prints a DISCOVERY report before it prints any plan:
  - every SKU name (trimmed, case-insensitive) carried by 2+ distinct vendors, and for each twin: `vendor`, `active`, `weekday_par`/`weekend_par`, `avg_oz_per_each`, resolved `content_oz` (via `skuContentOz` + the live pack chain — never the flat-field path), the latest `vendor_price_history` row, its recipe-pin count, and the last `vendor_delivery_items.created_at` per location;
  - ICEBERG specifically — the audit's $3,230.74 of iceberg spend that "attributes to no SKU we hold";
  - `membersDisagreeOnUnitOz(...)` per candidate — the flag that decides whether Phase 4 can re-point it at all.
- [ ] Run the dry run and commit the report as `docs/seed/source/product-identity-dryrun.md` (the seed-18 convention: **the dry run is the decision document**, kept in-repo as the record of what was proposed).

```bash
npx tsx --conditions=react-server --env-file=.env.local scripts/seed/24-product-identity.ts --markdown
```

## Task 2.3 — The plan half of the seed

- [ ] The script's `PRODUCTS` const is the evidence table: per product `name`, `memberSkuNames` + `expectVendor` per member, `primary` (with `location: null` for the global default), optional `unitOz` + `unitOzClass` + `sourceNote`, and a mandatory `decision` string naming **who** decided and **whether it is an inference** — seed 18's discipline verbatim: *"Say so out loud rather than letting an inference harden into a fact."*
- [ ] Seed the two ALREADY-adjudicated pairs from `docs/seed/source/twin-adjudication-dryrun.md`: **Ham** (PFG primary, explicit — the Angel row behind $2,164.94 is a PFG product) and **Fresh Mozzarella** (PFG primary, **flagged `primaryIsInferred: true`** with its basis, exactly as seed 18 flagged it, veto-able by swapping one field).
- [ ] Seed `unit_oz` from `OPERATIONAL_SLICE_OZ` (`lib/angel-wave3.ts:267`, Juan's own ruling) with class `OPERATIONAL` for every product whose name appears there: `Ham 1.2` · `Genoa 0.4` · `Capicola 0.4` · `Provolone 0.7` · `Pepperoni 0.2`. **Ham's 1.2 is what unblocks the ham pin in Phase 4** — without it the re-point script refuses itself exactly as seed 18 did.
- [ ] Import `OPERATIONAL_SLICE_OZ` from `lib/angel-wave3.ts`; do not retype the numbers. (`rulingStatus()` there is keyed by SKU NAME — fine for a seed that already matches on name, but do not carry that key choice into any runtime path.)
- [ ] Lettuce/Iceberg and the other 8 pairs: create the product and attach members **only where Juan has ruled**. An unruled pair gets a product row and members but **no primary row** — resolution then answers on rung 2 (most-recently-received), which is honest and safe. List them in the report as "awaiting adjudication".
- [ ] Carry seed 18/20's four write-loop invariants **verbatim**: re-read the live row and FATAL on a name change · idempotency skip when the value already matches · plan-drift refusal when the before-value moved under us ("Refusing — re-run the dry run") · `if (!count) throw` on every UPDATE.
- [ ] Gate: `const EXECUTE = process.argv.includes("--execute");` + `const MD = process.argv.includes("--markdown");` + the `pathToFileURL(process.argv[1])` direct-invocation guard (an import side-effect re-run is a real incident class).
- [ ] Audit every write with `phase: "product_identity"`, a specific `reason`, `script: "scripts/seed/24-product-identity.ts"`, `source_report`, and `actor_context: "seed"`.
- [ ] Commit, push, PR, CI green.

## GATE S1 (LOCKED) — LEAD runs the seed

- [ ] **BUILD AGENTS STOP.** The dry run is yours; `--execute` is not.
- [ ] **JUAN:** adjudicate the 8 pairs from the report — for each: which vendor is primary, and is that explicit or inferred.
- [ ] **LEAD:** encode Juan's rulings in `PRODUCTS`, re-run the dry run, paste it, then:

```bash
npx tsx --conditions=react-server --env-file=.env.local scripts/seed/24-product-identity.ts --execute
```

- [ ] **LEAD:** verify and paste — `select count(*) from products;` · `select count(*) from vendor_items where product_id is not null;` · `select count(*) from product_primaries;` · and confirm **no SKU changed `active`, `weekday_par` or `weekend_par`** (this seed attaches identity; it does not adjudicate orderability — seed 18 already did that, and re-litigating it here would silently undo Juan's P1 decision).
- [ ] **JUAN:** merge.

---

# PHASE 3 — Resolution + FIFO into the seams (spec §4; **swapped ahead of spec §3, deviation D1**)

**Ships:** the flatten reads product pins · FIFO + two-grain rollup pure core · ordering routes primary-first and stops double-suggesting · production offers every member · `usageRank` rolls up. **No migration.** Ships **dormant and behavior-identical** — zero `component_product_id` rows exist yet, so every number on every surface must be unchanged. That is what makes it safely mergeable ahead of the re-point.

**Estimated size:** ~14 tasks · ~1000 lines TS (~450 of it tests) · 1 PR. The largest phase.

**Smoke focus (Juan):** *nothing changed.* `/admin/menu-costing` totals, `/ordering` walk order and Suggest chips, `/operations/counts` on-hand numbers, and `/operations/production`'s dropdown must all match prod exactly. Then a **deliberate probe**: the lead flips one ham twin inactive on the preview DB, reloads `/ordering`, and the walk still offers ham from the other vendor. Flip it back.

## Task 3.1 — Branch

```bash
git fetch && git checkout main && git reset --hard origin/main
git checkout -b feat/product-identity-p3-resolution
```

## Task 3.2 — FIFO: failing test

- [ ] Create `tests/products-fifo.test.ts`:

```ts
/**
 * FIFO lot attribution (spec 2026-08-20, "what actually got eaten").
 *
 * Juan: "we will FIFO operationally" — the model mirrors the kitchen. Lots are
 * receipt lines (vendor_delivery_items, already dated per delivery), pooled across
 * ALL members of a product at one location: oldest lot depletes first, regardless of
 * vendor. Deviation D5: this runs at READ time; the depletion ledgers are not
 * re-keyed and the double-count law is untouched.
 */
import { describe, it, expect } from "vitest";
import {
  attributeFifo,
  remainingByLot,
  allocateProductCount,
  allocateProductVariance,
  type ReceiptLot,
} from "@/lib/products-shared";

const lot = (lotId: string, skuId: string, receivedAt: string, oz: number): ReceiptLot => ({
  lotId, skuId, receivedAt, oz,
});

// Two vendors, interleaved in time — the whole point is that vendor does not order them.
const LOTS: ReceiptLot[] = [
  lot("L1", "pfg", "2026-08-10T09:00:00Z", 100),
  lot("L2", "baldor", "2026-08-12T09:00:00Z", 60),
  lot("L3", "pfg", "2026-08-15T09:00:00Z", 80),
];

describe("attributeFifo", () => {
  it("consumes the OLDEST lot first, across vendors", () => {
    const r = attributeFifo(LOTS, 130);
    expect(r.shares).toEqual([
      { lotId: "L1", skuId: "pfg", oz: 100 },
      { lotId: "L2", skuId: "baldor", oz: 30 },
    ]);
    expect(r.unattributedOz).toBe(0);
  });

  it("does not depend on input row order — it sorts by receivedAt", () => {
    const shuffled = [LOTS[2]!, LOTS[0]!, LOTS[1]!];
    expect(attributeFifo(shuffled, 130)).toEqual(attributeFifo(LOTS, 130));
  });

  it("breaks a receivedAt TIE on lotId so the answer is total, not mostly-stable", () => {
    const tied = [lot("B", "x", "2026-08-10T09:00:00Z", 10), lot("A", "y", "2026-08-10T09:00:00Z", 10)];
    expect(attributeFifo(tied, 10).shares).toEqual([{ lotId: "A", skuId: "y", oz: 10 }]);
  });

  it("reports UNATTRIBUTED oz rather than inventing a lot", () => {
    const r = attributeFifo(LOTS, 300);
    expect(r.shares.reduce((s, x) => s + x.oz, 0)).toBe(240);
    expect(r.unattributedOz).toBe(60);
  });

  it("zero consumption attributes nothing", () => {
    expect(attributeFifo(LOTS, 0)).toEqual({ shares: [], unattributedOz: 0 });
  });

  it("negative or non-finite consumption is refused, not clamped into a share", () => {
    expect(attributeFifo(LOTS, -5)).toEqual({ shares: [], unattributedOz: 0 });
    expect(attributeFifo(LOTS, Number.NaN)).toEqual({ shares: [], unattributedOz: 0 });
  });

  it("no lots at all -> everything is unattributed", () => {
    expect(attributeFifo([], 50)).toEqual({ shares: [], unattributedOz: 50 });
  });

  it("skips zero/negative-oz lots instead of emitting empty shares", () => {
    const r = attributeFifo([lot("Z", "x", "2026-08-01T00:00:00Z", 0), ...LOTS], 50);
    expect(r.shares).toEqual([{ lotId: "L1", skuId: "pfg", oz: 50 }]);
  });
});

describe("remainingByLot", () => {
  it("what is LEFT is the newest-back tail — oldest was eaten first", () => {
    expect(remainingByLot(LOTS, 130)).toEqual([
      { lotId: "L2", skuId: "baldor", oz: 30 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
  });

  it("consumed >= received leaves nothing (never a negative remainder)", () => {
    expect(remainingByLot(LOTS, 999)).toEqual([]);
  });

  it("consumed 0 leaves every lot whole, oldest-first", () => {
    expect(remainingByLot(LOTS, 0)).toEqual([
      { lotId: "L1", skuId: "pfg", oz: 100 },
      { lotId: "L2", skuId: "baldor", oz: 60 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
  });

  it("INVARIANT: attributed + remaining === total received", () => {
    const total = LOTS.reduce((s, l) => s + l.oz, 0);
    for (const consumed of [0, 1, 99.5, 130, 240]) {
      const a = attributeFifo(LOTS, consumed).shares.reduce((s, x) => s + x.oz, 0);
      const r = remainingByLot(LOTS, consumed).reduce((s, x) => s + x.oz, 0);
      expect(a + r).toBeCloseTo(total, 9);
    }
  });
});

describe("allocateProductCount (deviation D8 — a product count becomes per-SKU lines)", () => {
  it("distributes NEWEST-BACK: what is on the shelf is the freshest stock", () => {
    // 90 oz counted against remaining lots L2(30 baldor) + L3(80 pfg) -> newest first.
    const r = allocateProductCount(90, [
      { lotId: "L2", skuId: "baldor", oz: 30 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
    expect(r.perSku).toEqual([{ skuId: "pfg", oz: 80 }, { skuId: "baldor", oz: 10 }]);
    expect(r.unallocatedOz).toBe(0);
  });

  it("MERGES lots of the same SKU into ONE line — sku_count_lines is per-SKU", () => {
    const r = allocateProductCount(120, [
      { lotId: "A", skuId: "pfg", oz: 50 },
      { lotId: "B", skuId: "pfg", oz: 40 },
      { lotId: "C", skuId: "baldor", oz: 60 },
    ]);
    // Newest-back over [C, B, A]: C 60 baldor, B 40 pfg, A 20 pfg -> pfg 60, baldor 60.
    expect(r.perSku).toEqual([{ skuId: "baldor", oz: 60 }, { skuId: "pfg", oz: 60 }]);
  });

  it("counting MORE than the lots explain leaves an honest unallocated remainder", () => {
    const r = allocateProductCount(200, [{ lotId: "A", skuId: "pfg", oz: 50 }]);
    expect(r.perSku).toEqual([{ skuId: "pfg", oz: 50 }]);
    expect(r.unallocatedOz).toBe(150);
  });

  it("no lots at all -> nothing allocated, everything reported unallocated", () => {
    expect(allocateProductCount(75, [])).toEqual({ perSku: [], unallocatedOz: 75 });
  });

  it("INVARIANT: allocated + unallocated === the counted number, exactly", () => {
    for (const counted of [1, 30, 89.5, 110]) {
      const r = allocateProductCount(counted, [
        { lotId: "L2", skuId: "baldor", oz: 30 },
        { lotId: "L3", skuId: "pfg", oz: 80 },
      ]);
      expect(r.perSku.reduce((s, x) => s + x.oz, 0) + r.unallocatedOz).toBeCloseTo(counted, 9);
    }
  });
});

describe("allocateProductVariance (spec: 'oldest lot absorbs')", () => {
  it("a SHORTAGE lands on the OLDEST remaining lot first", () => {
    const r = allocateProductVariance(-25, [
      { lotId: "L2", skuId: "baldor", oz: 30 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
    expect(r).toEqual([{ lotId: "L2", skuId: "baldor", oz: -25 }]);
  });

  it("a shortage larger than the oldest lot spills forward, still oldest-first", () => {
    const r = allocateProductVariance(-50, [
      { lotId: "L2", skuId: "baldor", oz: 30 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
    expect(r).toEqual([
      { lotId: "L2", skuId: "baldor", oz: -30 },
      { lotId: "L3", skuId: "pfg", oz: -20 },
    ]);
  });

  it("a SURPLUS (counted more than predicted) lands whole on the oldest lot — it is an uncounted receipt, not a spread", () => {
    const r = allocateProductVariance(15, [
      { lotId: "L2", skuId: "baldor", oz: 30 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
    expect(r).toEqual([{ lotId: "L2", skuId: "baldor", oz: 15 }]);
  });

  it("zero variance allocates nothing", () => {
    expect(allocateProductVariance(0, [{ lotId: "A", skuId: "x", oz: 10 }])).toEqual([]);
  });

  it("no lots -> nothing to absorb it; returns empty rather than inventing an owner", () => {
    expect(allocateProductVariance(-10, [])).toEqual([]);
  });
});
```

- [ ] `npx vitest run tests/products-fifo.test.ts` — fails (functions do not exist).

## Task 3.3 — FIFO implementation

- [ ] Append to `lib/products-shared.ts`:

```ts
// -- FIFO over receipt lots (spec: "what actually got eaten") ------------------

/**
 * ONE receipt line, pooled across every member of a product at one location. Lots
 * come from vendor_delivery_items, which are already dated per delivery — the spec's
 * "Lot data already exists" is literally true, and nothing new is captured.
 */
export interface ReceiptLot {
  lotId: string;
  skuId: string;
  /** ISO receipt instant (vendor_delivery_items.created_at — the true write instant,
   *  which is what an anchor timestamp is comparable to; delivery_date is a bare date). */
  receivedAt: string;
  /** vendor_delivery_items.resolved_oz. A NULL resolved_oz never becomes a lot — the
   *  caller drops it and null-taints the term, exactly as the counts received term
   *  already does (lib/counts.ts sumReceivedOzWindow). */
  oz: number;
}

/** A slice of one lot. Negative oz is legal ONLY in allocateProductVariance. */
export interface LotShare {
  lotId: string;
  skuId: string;
  oz: number;
}

/** Oldest first, tie-broken on lotId so the order is TOTAL, not merely mostly-stable
 *  (the same reasoning loadRecipeGraph's `created_at, id` ordering uses). */
function oldestFirst(lots: ReadonlyArray<ReceiptLot>): ReceiptLot[] {
  return [...lots]
    .filter((l) => Number.isFinite(l.oz) && l.oz > 0)
    .sort((a, b) => {
      const ta = Date.parse(a.receivedAt);
      const tb = Date.parse(b.receivedAt);
      const va = Number.isFinite(ta) ? ta : Number.POSITIVE_INFINITY; // unparseable sorts LAST
      const vb = Number.isFinite(tb) ? tb : Number.POSITIVE_INFINITY;
      return va !== vb ? va - vb : a.lotId.localeCompare(b.lotId);
    });
}

/**
 * Attribute `consumeOz` of product-grain consumption across member lots, OLDEST
 * FIRST, regardless of vendor — Juan: "we will FIFO operationally."
 *
 * `unattributedOz` is the honest remainder when the lots cannot explain the
 * consumption (a pre-ledger opening balance, an unrecorded receipt). It is REPORTED,
 * never smeared across lots and never silently dropped: a number the ledger cannot
 * account for is a finding, not a rounding error.
 */
export function attributeFifo(
  lots: ReadonlyArray<ReceiptLot>,
  consumeOz: number,
): { shares: LotShare[]; unattributedOz: number } {
  if (!Number.isFinite(consumeOz) || consumeOz <= 0) return { shares: [], unattributedOz: 0 };
  const shares: LotShare[] = [];
  let left = consumeOz;
  for (const l of oldestFirst(lots)) {
    if (left <= 0) break;
    const take = Math.min(l.oz, left);
    shares.push({ lotId: l.lotId, skuId: l.skuId, oz: take });
    left -= take;
  }
  return { shares, unattributedOz: left > 0 ? left : 0 };
}

/**
 * What is LEFT after FIFO consumption — the newest-back tail. This is the spec's
 * "Lot-level remaining = per-SKU on-hand distributed newest-back after FIFO
 * consumption", and it is what a product-level count is allocated against.
 * Returned OLDEST-FIRST (partial lot first) so callers can read it as a shelf.
 */
export function remainingByLot(
  lots: ReadonlyArray<ReceiptLot>,
  consumedOz: number,
): LotShare[] {
  const consumed = Number.isFinite(consumedOz) && consumedOz > 0 ? consumedOz : 0;
  const out: LotShare[] = [];
  let left = consumed;
  for (const l of oldestFirst(lots)) {
    const eaten = Math.min(l.oz, left);
    left -= eaten;
    const rest = l.oz - eaten;
    if (rest > 0) out.push({ lotId: l.lotId, skuId: l.skuId, oz: rest });
  }
  return out;
}

/**
 * Turn ONE product-level count into ordinary per-SKU count lines (deviation D8).
 *
 * NEWEST-BACK, deliberately: FIFO says the oldest stock left the shelf first, so what
 * the counter is looking at is the freshest lots. Lots of the same SKU merge into one
 * line because sku_count_lines is per-SKU and two lines for one SKU in one event would
 * be a disjointness violation (council L5).
 *
 * `unallocatedOz` is counted stock the lot ledger cannot explain. It is REPORTED to
 * the caller, which surfaces it rather than silently attributing it to a vendor — a
 * count is ground truth, but WHOSE stock it is remains a claim the ledger must support.
 */
export function allocateProductCount(
  countedOz: number,
  remaining: ReadonlyArray<LotShare>,
): { perSku: Array<{ skuId: string; oz: number }>; unallocatedOz: number } {
  if (!Number.isFinite(countedOz) || countedOz <= 0) return { perSku: [], unallocatedOz: 0 };
  const newestFirst = [...remaining].filter((l) => l.oz > 0).reverse();
  const bySku = new Map<string, number>();
  const order: string[] = [];
  let left = countedOz;
  for (const l of newestFirst) {
    if (left <= 0) break;
    const take = Math.min(l.oz, left);
    if (!bySku.has(l.skuId)) order.push(l.skuId);
    bySku.set(l.skuId, (bySku.get(l.skuId) ?? 0) + take);
    left -= take;
  }
  return {
    perSku: order.map((skuId) => ({ skuId, oz: bySku.get(skuId)! })),
    unallocatedOz: left > 0 ? left : 0,
  };
}

/**
 * Allocate a product-grain VARIANCE down to lots — spec: "Product-level counts
 * allocate variance FIFO (oldest lot absorbs)."
 *
 * NEGATIVE (counted less than predicted: shrinkage / waste / over-portion) spills
 * oldest-first and is CAPPED at each lot's remaining oz, because a lot cannot lose
 * more than it held. POSITIVE (counted more) lands whole on the oldest lot and is NOT
 * capped: a surplus is an uncounted receipt or an earlier over-count, and spreading
 * it would invent a distribution nothing supports. Advisory attribution for the
 * reason-code trail — it never edits a ledger row.
 */
export function allocateProductVariance(
  varianceOz: number,
  remaining: ReadonlyArray<LotShare>,
): LotShare[] {
  if (!Number.isFinite(varianceOz) || varianceOz === 0) return [];
  const oldest = [...remaining].filter((l) => l.oz > 0);
  if (oldest.length === 0) return [];
  if (varianceOz > 0) {
    const head = oldest[0]!;
    return [{ lotId: head.lotId, skuId: head.skuId, oz: varianceOz }];
  }
  const out: LotShare[] = [];
  let left = -varianceOz;
  for (const l of oldest) {
    if (left <= 0) break;
    const take = Math.min(l.oz, left);
    out.push({ lotId: l.lotId, skuId: l.skuId, oz: -take });
    left -= take;
  }
  return out;
}
```

- [ ] `npx vitest run tests/products-fifo.test.ts` — green. Commit.

## Task 3.4 — Two-grain rollup + usage rollup: failing test

- [ ] Create `tests/products-rollup.test.ts`:

```ts
/**
 * The two-grain model (spec 2026-08-20, "On-hand"): per-SKU ledgers remain the
 * source of truth; the PRODUCT grain is their sum. Juan: "not just 'we have ham' —
 * 300 oz of ham: 200 PFG + 100 Boar's Head."
 *
 * The completeness rule is lifted from MenuCostRollup (lib/menu-costing-shared.ts):
 * `totalOz` is NON-NULL only when EVERY member resolved; `knownOz` is the sum of what
 * we could resolve and is a lower bound, never "the total". A partial sum presented as
 * a total is a fabricated number, which the advisory-null law forbids.
 */
import { describe, it, expect } from "vitest";
import { rollupProductGrain, rollupUsageByProduct } from "@/lib/products-shared";

describe("rollupProductGrain", () => {
  it("sums the members when every one resolved", () => {
    expect(rollupProductGrain({
      productId: "HAM",
      members: [{ skuId: "pfg", oz: 200 }, { skuId: "bh", oz: 100 }],
    })).toEqual({
      productId: "HAM", totalOz: 300, knownOz: 300, knownMemberCount: 2, unknownSkuIds: [],
    });
  });

  it("ONE unresolved member nulls the total but keeps the honest lower bound", () => {
    expect(rollupProductGrain({
      productId: "HAM",
      members: [{ skuId: "pfg", oz: 200 }, { skuId: "bh", oz: null }],
    })).toEqual({
      productId: "HAM", totalOz: null, knownOz: 200, knownMemberCount: 1, unknownSkuIds: ["bh"],
    });
  });

  it("REGRESSION (audit P2): mirrored twin drift NETS at product grain", () => {
    // The live failure: pin dead + receive the other -> A reads OVER, B reads SHORT,
    // and nothing nets them. At product grain the two cancel to the truth.
    const r = rollupProductGrain({
      productId: "HAM",
      members: [{ skuId: "dead-pin", oz: 140 }, { skuId: "really-bought", oz: -40 }],
    });
    expect(r.totalOz).toBe(100);
  });

  it("no members -> total null, not 0", () => {
    expect(rollupProductGrain({ productId: "X", members: [] })).toEqual({
      productId: "X", totalOz: null, knownOz: 0, knownMemberCount: 0, unknownSkuIds: [],
    });
  });

  it("unknownSkuIds is sorted, so the UI names them in a stable order", () => {
    const r = rollupProductGrain({
      productId: "X",
      members: [{ skuId: "zeta", oz: null }, { skuId: "alpha", oz: null }],
    });
    expect(r.unknownSkuIds).toEqual(["alpha", "zeta"]);
  });

  it("a non-finite member oz is treated as UNKNOWN, never summed", () => {
    const r = rollupProductGrain({
      productId: "X",
      members: [{ skuId: "a", oz: 10 }, { skuId: "b", oz: Number.NaN }],
    });
    expect(r.totalOz).toBeNull();
    expect(r.knownOz).toBe(10);
    expect(r.unknownSkuIds).toEqual(["b"]);
  });
});

describe("rollupUsageByProduct (deviation D9)", () => {
  it("members SHARE the product's summed usage, so a backup no longer sorts last", () => {
    const out = rollupUsageByProduct(
      new Map([["pfg", 900]]),                      // all usage on the pinned twin
      new Map([["pfg", "HAM"], ["baldor", "HAM"]]), // both are HAM
    );
    expect(out.get("pfg")).toBe(900);
    expect(out.get("baldor")).toBe(900);
  });

  it("a productless SKU keeps its own usage untouched", () => {
    const out = rollupUsageByProduct(new Map([["solo", 12]]), new Map());
    expect(out.get("solo")).toBe(12);
  });

  it("a product with ZERO total leaves its members ABSENT, so `?? -Infinity` still sorts them last", () => {
    const out = rollupUsageByProduct(new Map(), new Map([["a", "P"], ["b", "P"]]));
    expect(out.has("a")).toBe(false);
    expect(out.has("b")).toBe(false);
  });

  it("does not mutate the input map", () => {
    const src = new Map([["pfg", 900]]);
    rollupUsageByProduct(src, new Map([["pfg", "HAM"], ["baldor", "HAM"]]));
    expect(src.has("baldor")).toBe(false);
  });
});
```

## Task 3.5 — Rollup implementation

- [ ] Append to `lib/products-shared.ts`:

```ts
// -- Two-grain rollup (spec: "On-hand") ---------------------------------------

export interface ProductGrainInput {
  productId: string;
  /** oz per member; null = that member's own derivation could not resolve. */
  members: Array<{ skuId: string; oz: number | null }>;
}

export interface ProductGrainRollup {
  productId: string;
  /** NON-NULL only when EVERY member resolved (the MenuCostRollup completeness rule). */
  totalOz: number | null;
  /** Sum of what we COULD resolve. A lower bound, never "the total". */
  knownOz: number;
  knownMemberCount: number;
  /** Which members we could not resolve, sorted — name the address, not just the fault. */
  unknownSkuIds: string[];
}

/**
 * Roll member SKUs up to the product grain. The per-SKU ledgers stay the source of
 * truth; this is their sum, and it is where the audit's mirrored false SHORT/OVER
 * alarm dies: a twin reading +140 and a twin reading -40 net to the 100 that is
 * actually on the shelf, without re-keying a single ledger row.
 */
export function rollupProductGrain(input: ProductGrainInput): ProductGrainRollup {
  let knownOz = 0;
  let knownMemberCount = 0;
  const unknownSkuIds: string[] = [];
  for (const m of input.members) {
    if (m.oz == null || !Number.isFinite(m.oz)) { unknownSkuIds.push(m.skuId); continue; }
    knownOz += m.oz;
    knownMemberCount += 1;
  }
  unknownSkuIds.sort();
  const complete = unknownSkuIds.length === 0 && input.members.length > 0;
  return {
    productId: input.productId,
    totalOz: complete ? knownOz : null,
    knownOz,
    knownMemberCount,
    unknownSkuIds,
  };
}

/**
 * Give every member of a product the PRODUCT's total trailing usage (deviation D9).
 *
 * Today all consumption is pinned to one twin (production_inputs.input_sku_id and
 * toast_daily_depletion.sku_id are both pin-derived), so the un-pinned twin reads
 * null and `?? -Infinity` sorts it dead last on the order walk — the audit's "the
 * twin with the real spend reads null and sorts LAST". Sharing the product's number
 * makes both members sort where the PRODUCT belongs.
 *
 * A SKU whose product has zero total stays ABSENT from the map (not zero), so the
 * caller's existing `?? -Infinity` null-sorts-last semantics are preserved exactly.
 * Returns a NEW map; never mutates the input.
 */
export function rollupUsageByProduct(
  usageBySku: ReadonlyMap<string, number>,
  productBySku: ReadonlyMap<string, string>,
): Map<string, number> {
  const totalByProduct = new Map<string, number>();
  for (const [skuId, oz] of usageBySku) {
    const p = productBySku.get(skuId);
    if (p == null) continue;
    totalByProduct.set(p, (totalByProduct.get(p) ?? 0) + oz);
  }
  const out = new Map(usageBySku);
  for (const [skuId, productId] of productBySku) {
    const total = totalByProduct.get(productId);
    if (total != null && total > 0) out.set(skuId, total);
  }
  return out;
}
```

- [ ] `npx vitest run tests/products-rollup.test.ts` — green. Commit.

## Task 3.6 — The flatten reads product pins: failing test

- [ ] Append to `tests/prep-consumption-graph.test.ts` (extend the existing suite — do not fork it):

```ts
describe("product-pinned recipe inputs (spec 2026-08-20)", () => {
  const measures = new Map<string, MeasureUnitFactor>([
    ["oz", { dimension: "weight", toBaseFactor: 1 }],
    ["unit", { dimension: "count", toBaseFactor: 1 }],
  ]);

  const productIndex = (skuId: string | null, unitOz: number | null) => ({
    resolution: new Map([[
      "HAM",
      { productId: "HAM", skuId, rung: skuId ? ("primary" as const) : ("unresolved" as const), consideredSkuIds: ["pfg", "baldor"] },
    ]]),
    basis: new Map([["HAM", {
      packFormat: null, eachContainerLabel: null, unitsPerPack: null,
      eachSize: null, eachMeasure: null, avgOzPerEach: unitOz, packChain: null,
    }]]),
  });

  const recipe = (): GraphRecipe => ({
    recipeId: "R",
    batchYield: 1,
    inputs: [{ quantity: 4, unit: "unit", componentSkuId: null, componentItemId: null, componentProductId: "HAM" }],
    outputs: [{ outputItemId: "SLICED_HAM", outputMenuItemId: null, yield: 1, ozPerParUnit: 4.8 }],
  });

  it("a resolved product line keys the flatten by the RESOLVED MEMBER", () => {
    const g = buildRecipeGraph([recipe()], new Map(), measures, productIndex("pfg", 1.2));
    expect([...perUnitSkuOzForItemFromGraph(g, "SLICED_HAM")]).toEqual([["pfg", 4.8]]);
  });

  it("the SAME line yields the SAME oz on a different member — the whole point", () => {
    const onPfg = perUnitSkuOzForItemFromGraph(buildRecipeGraph([recipe()], new Map(), measures, productIndex("pfg", 1.2)), "SLICED_HAM");
    const onBaldor = perUnitSkuOzForItemFromGraph(buildRecipeGraph([recipe()], new Map(), measures, productIndex("baldor", 1.2)), "SLICED_HAM");
    expect(onPfg.get("pfg")).toBe(onBaldor.get("baldor"));
  });

  it("an UNRESOLVED product poisons the flatten to empty — never a partial number", () => {
    const g = buildRecipeGraph([recipe()], new Map(), measures, productIndex(null, 1.2));
    expect(perUnitSkuOzForItemFromGraph(g, "SLICED_HAM").size).toBe(0);
  });

  it("a resolved product with NO unit_oz refuses rather than guessing", () => {
    const g = buildRecipeGraph([recipe()], new Map(), measures, productIndex("pfg", null));
    expect(perUnitSkuOzForItemFromGraph(g, "SLICED_HAM").size).toBe(0);
  });

  it("BACK-COMPAT: omitting the product index leaves every existing fixture untouched", () => {
    const skuRecipe: GraphRecipe = {
      recipeId: "R2", batchYield: 1,
      inputs: [{ quantity: 2, unit: "oz", componentSkuId: "S", componentItemId: null, componentProductId: null }],
      outputs: [{ outputItemId: "I", outputMenuItemId: null, yield: 1, ozPerParUnit: 2 }],
    };
    const g = buildRecipeGraph([skuRecipe], new Map([["S", {
      packFormat: null, eachContainerLabel: null, unitsPerPack: null,
      eachSize: null, eachMeasure: null, avgOzPerEach: null, packChain: null,
    }]]), measures);
    expect([...perUnitSkuOzForItemFromGraph(g, "I")]).toEqual([["S", 2]]);
  });
});
```

## Task 3.7 — The flatten implementation

- [ ] `lib/prep-consumption-graph.ts`:
  - `GraphInput` gains `componentProductId: string | null`.
  - Add `import type { ProductResolution } from "@/lib/products-shared";` — both modules are pure and client-safe, so this creates no server-import chain. `RecipeInputSku` is already imported from `@/lib/recipe-math` at the top of the file.
  - New exported type, and the graph carries it:

```ts
/** Product pins, pre-resolved ONCE by the loader. Keyed by product id. */
export interface ProductIndex {
  resolution: ReadonlyMap<string, ProductResolution>;
  /** The measure-only pack basis for each product (lib/products-shared productInputBasis). */
  basis: ReadonlyMap<string, RecipeInputSku>;
}
```
  - `RecipeGraph` gains `products: ProductIndex`.
  - `buildRecipeGraph(recipes, skuPack, measures, products: ProductIndex = { resolution: new Map(), basis: new Map() })` — **the default is what keeps ~30 existing fixtures and every current caller compiling untouched.**
  - Add the product branch to the **three** flatten engines that walk `node.inputs` — `batchOz`, `perUnitSkuOzForMenuItemFromGraph`, and `perUnitDirectSkuOzForMenuItem` — placed FIRST so `componentSkuId`/`componentItemId` order is unchanged for existing rows:

```ts
    if (c.componentProductId != null) {
      // Product pin: resolution already happened at load (ONE ladder, no opinions here).
      // Unresolved -> poison, exactly like an unknown SKU pack: the module never
      // returns a partial flatten (module header, "Preserved semantics").
      const res = graph.products.resolution.get(c.componentProductId);
      const basis = graph.products.basis.get(c.componentProductId);
      if (res == null || res.skuId == null || basis == null) return null;   // (or `new Map()` in the menu engines)
      const oz = ozForRecipeInput(c.quantity, c.unit, basis, graph.measures);
      if (oz == null) return null;                                           // (ditto)
      out.set(res.skuId, (out.get(res.skuId) ?? 0) + oz);
      continue;
    }
```
  - `perUnitDirectSkuOzForMenuItem` treats a product line exactly like a direct SKU line (it resolves to a raw SKU, so it belongs in the direct lane). **Re-verify the PR #180 invariant afterwards** — `direct(M) + Σ firstLevel(M)[i] × perUnitItem(i) === perUnitSkuOzForMenuItemFromGraph(M)` — it is already test-pinned; a product line must not break it.
  - `firstLevelItemConsumption` is unchanged: it only walks ITEM refs, and a product is not an item.
  - Update the `buildRecipeGraph` doc block to say resolution is pre-computed and this module has no opinion about which vendor a product means.
- [ ] `npx vitest run tests/prep-consumption-graph.test.ts` — green, **including every pre-existing case**. Commit.

## Task 3.8 — `loadRecipeGraph` resolves products

- [ ] `lib/prep-consumption.ts`:
  - `loadRecipeGraph(opts?: { locationId?: string | null })` — optional, default `null` (deviation D7). Update the doc block: the query count goes from 6 to **8** when products exist, and the two new reads are skipped entirely when `recipe_inputs` references no product (`productIds.length === 0`), so a system with no products pays nothing.
  - The `recipe_inputs` select gains `component_product_id`.
  - New private `loadProductIndex(sb, productIds, locationId)`:
    - ONE `products` read (`id, unit_oz`) `.in("id", productIds)`;
    - ONE `vendor_items` read `.in("product_id", productIds)` for `id, product_id, vendor_id, active, avg_oz_per_each`;
    - ONE `vendors` read for names (LABEL-ONLY: degrade to `null` on error, never fail the graph);
    - ONE `product_primaries` read `.in("product_id", productIds)` `.or("location_id.is.null,location_id.eq.<loc>")` when a location is given, else `.is("location_id", null)` — the `vendor_cutoffs` idiom from `lib/ordering.ts:1374-1378`. A location row beats the global row.
    - ONE `location_sku_settings` read when `locationId` is given, so `active` is the RESOLVED value (`resolveActive(overlay, global)`) and not the raw column. **This is the first time counts/costing see the per-location activation overlay** — the ROADMAP debt row says only ordering reads it. Note that in the PR body.
    - `lastReceivedAt`: ONE grouped read over `vendor_delivery_items` joined to this location's deliveries, taking `max(created_at)` per `vendor_item_id`. Page it (`selectAllRows`, order by `id`) — the delivery ledger crosses 1000 rows and a truncated page would silently mis-rank rung ②.
    - Then, per product: `resolveProductMember(...)` + `productInputBasis(...)` into the `ProductIndex`.
  - Pass the index into `buildRecipeGraph`.
- [ ] **Resolution-flip audit (spec: "Every resolution flip writes an audit row — 'why did ham cost move Tuesday' always has an answer").** Do **not** audit from `loadRecipeGraph` — it is a hot read path on nine callers and `audit()` is fail-open but not free. Instead: `lib/products.ts` gains `recordResolutionFlips(locationId, resolutions)`, called `void`-style from the ONE writer that already runs per day — `materializeDailyDepletion` — comparing today's resolution to the last audited one per (location, product) and appending `product.resolution_flip` with `{ product_id, location_id, from_sku_id, to_sku_id, rung, considered_sku_ids }` only when it CHANGED. One row per real flip; zero rows on a normal day. Name this in the PR: it is a deliberate placement decision, not an omission.
- [ ] Thread `locationId` at the three location-aware callers: `lib/catering/toast-sales.ts:503`, `lib/catering/sku-demand.ts:89`, `lib/catering/surplus.ts:144`. Leave `lib/admin/catalog.ts:183`, `lib/admin/menu-costing.ts:109`, `lib/admin/toast-map.ts:249,594`, `lib/admin/readiness-load.ts`, `scripts/parity-angel.ts:254`, `scripts/seed/23-ladle-measure.ts:114` on the global default (D7).
- [ ] Commit.

## Task 3.9 — `addRecipeInput` / `createRecipeFull` learn the third target

- [ ] `lib/recipes.ts`:
  - `addRecipeInput`'s input gains `componentProductId?: string | null`; the XOR check at `:311` becomes a **count of exactly one**:

```ts
  const skuId = input.componentSkuId ?? null;
  const itemId = input.componentItemId ?? null;
  const productId = input.componentProductId ?? null;
  const targets = (skuId !== null ? 1 : 0) + (itemId !== null ? 1 : 0) + (productId !== null ? 1 : 0);
  if (targets !== 1) throw new RecipeError(400, "invalid_component");
```
  - **The D3 unit rule, enforced at write:** when `productId !== null`, the `unit` must be an ACTIVE `measure_units` label. Anything else (a pack label, a chain label, a typo, null) throws `RecipeError(400, "product_line_needs_measure_unit")`. Rejecting at authoring time is the difference between an author seeing the problem in the builder and Juan seeing an `unresolved` row on the cost board three days later — the same reasoning behind the ladle refusal.
  - `RecipeDraftInput` gains `componentProductId`; the `createRecipeFull` validation loop at `:192-193` gets the same count-of-one + measure-unit rule; `p_inputs` at `:217` carries `component_product_id`.
  - Both audit metadata blocks record `component_product_id`.
- [ ] `app/api/admin/recipes/[id]/inputs/route.ts` passes `componentProductId` through.
- [ ] i18n: `recipes.error.product_line_needs_measure_unit` + `recipes.error.invalid_component_product` in **both** locales.
- [ ] Commit.

## Task 3.10 — RecipeBuilder: the third "add input" kind

- [ ] `components/admin/recipes/RecipeBuilder.tsx`: `addKind` gains `"product"`; a `submitProductInput` mirroring `submitSkuInput` (`:606-643`) but posting `componentProductId`; the unit control for a product line is a `<select>` of measure labels **only** (never the SKU's chain/pack labels) — the UI expresses D3 so a user cannot author the refusal.
- [ ] The draft-input path (`onAddDraftInput`) gains `kind: "product"`; the existing `di.kind === "sku"` oz-readout branches (`:864`, `:1346`) get a product sibling that reads through `productInputBasis`.
- [ ] The input list renders a product line with the product name and an explicit "product" chip, so an author can see at a glance which lines are vendor-free.
- [ ] i18n both locales. Commit.

## Task 3.11 — Ordering: primary-first routing, product dedupe, usage rollup

- [ ] `lib/ordering.ts`:
  - `WalkerSku` gains `productId: string | null`, `productName: string | null`, `memberRole: "primary" | "backup" | "solo"`.
  - `WalkerUnroutable` gains `reroutedToBackup: number` — the count of products whose primary was unroutable and whose demand went to a backup instead of evaporating. This is the P4 notice becoming a **positive** signal, and it is what tells Juan the failover worked.
  - In `loadWalkerData`, after the existing overlay resolution: build the product index for this location (reuse `lib/products.ts`'s loader — do **not** write a second one), then:
    - **the bare `continue` at `:533`** (par null — the one genuinely silent drop left in the walk loop) learns products: if this SKU is a member whose product's resolved primary IS routable, the drop is correct and silent as today; if the product has NO routable member, count it into `unroutable`.
    - the `:526-531` inactive branch: when the SKU is a member and the product resolves to a DIFFERENT active member, increment `reroutedToBackup` instead of `skuInactive` — the demand did not evaporate, it moved.
  - **Dedupe by product, not by SKU** (`:785-790` and `generateDraftForVendor` at `:1305-1322`): two active members of one product must produce ONE suggestion, on the resolved primary. Keep the existing `duplicate_sku` guard and add `duplicate_product` beside it. `lib/purchase-orders.ts:371-374` keeps its SKU-identity check unchanged — a PO is per-vendor and per-SKU by nature.
  - `loadSkuUsageRank` (`:229`) pipes its result through `rollupUsageByProduct` before returning, so the sort at `:590-591` ranks members at the product's level (D9).
- [ ] `components/ordering/ParPassWalker.tsx`: the unroutable notice (`:398-419`) gains a `reroutedToBackup` line with its own tone (informational, not alarm) and its own i18n key.
- [ ] i18n both locales: `ordering.walker.rerouted_to_backup_one` / `_other`, and the product/backup chip labels.
- [ ] Commit.

## Task 3.12 — Production: the amplifier fix

- [ ] `lib/production.ts` `loadSkuToItems` (`:88-125`): after the existing SKU-pin pass, add a product pass — read `recipe_inputs.component_product_id` for active recipes, expand each product to **every member SKU** via `vendor_items.product_id`, and map each member to that recipe's output items. This is the audit's amplifier fix stated exactly: *"the production dropdown derives from pins so a cook CANNOT record production from the backup SKU"* — after this, they can.
- [ ] `recordProduction`'s conversion validation (`:212-229`) accepts the same expansion, so a cook recording from the backup does not hit `invalid_conversion`.
- [ ] Keep both reads batched (`.in(...)`) — the `loadRecipeGraph` law applies to this module too.
- [ ] Add a test note in the PR body: this is the one behavior change in Phase 3 that is visible **before** the re-point, and only for products that already exist. With zero product-pinned recipes it is a no-op.
- [ ] Commit.

## Task 3.13 — The OTHER `recipe_inputs` readers (do not skip this — it is the quiet one)

Three modules read `recipe_inputs` with a hand-rolled `select("recipe_id, component_sku_id, component_item_id")` **outside** `loadRecipeGraph`. After Phase 4 re-points a line, a product-pinned row is invisible to every one of them, and the failure is silent in each case.

- [ ] `lib/admin/cost.ts:100` `loadSkuUsageMap` — "every output item that uses this SKU". A re-pointed SKU would drop out of its own usage map and the SKU editor would report it as unused. Select `component_product_id` too, and seed `recipesUsingSku` for **every member** of a pinned product (a member is genuinely used by that recipe — it is which one that varies).
- [ ] `lib/admin/readiness-load.ts:94` `loadGraphRows` — readiness would see a recipe with fewer inputs than it has and call it ready. Select `component_product_id`; treat a product input as ready iff the product resolves AND (`unit_oz` is set OR the line is weight-denominated). An `unresolved` product is a readiness BLOCKER with its own reason code, beside the existing `duplicate_producers`.
- [ ] `lib/recipes.ts:110-121` — the recipe-detail loader resolves `componentName` from a SKU-name or item-name lookup; a product line would render `"(item)"`. Add a `products` name lookup and a `kind` discriminator so the builder can render the product chip from Task 3.10.
- [ ] Run the grep that finds any reader this task missed, and confirm the list is exactly these three plus `lib/prep-consumption.ts`, `lib/production.ts` and the seed scripts:

```bash
grep -rn "recipe_inputs" --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v "^./scripts/"
```

- [ ] Commit.

## Task 3.14 — CI + PR + the failover probe

- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` — all clean.
- [ ] Run the **byte-identity check** before opening the PR: on the preview DB, capture `/admin/menu-costing` totals and `/ordering` walk order before and after the branch. They must match. Paste both into the PR.
- [ ] PR body must state: *no migration, no ledger change, no product-pinned rows exist — this phase is dormant by construction.*
- [ ] **LEAD (on the preview DB only, never prod):** flip one ham twin inactive, reload `/ordering`, confirm ham is still offered from the other vendor and `reroutedToBackup` reads 1. Flip it back. Paste the result.
- [ ] **JUAN:** smoke, merge.

---

# PHASE 4 — Re-point the portioned prep recipes (spec §3; **moved after §4, deviation D1**)

**Ships:** `scripts/seed/25-repoint-recipe-pins.ts` — SKU-pin → product-pin for the portioned prep recipes, behind a live-computed oz-parity gate. This is the phase that **lights** the Phase-3 engine. No migration, no app code beyond the script.

**Estimated size:** ~4 tasks · ~400 lines of seed script · 1 PR.

**Smoke focus (Juan):** after the execute run, `/admin/menu-costing` shows the **same dollar figures as before** for every re-pointed item — the whole gate exists to guarantee that — and `/ordering` still walks. Then the real payoff smoke: the lead flips the PFG ham twin inactive on preview, and the ham cost **does not move** and ham **stays orderable**.

## Task 4.1 — Branch

```bash
git fetch && git checkout main && git reset --hard origin/main
git checkout -b feat/product-identity-p4-repoint
```

## Task 4.2 — The refusal gate (this is the task that matters)

- [ ] The script must NOT re-point on faith. For every candidate line it computes the line's oz **through the real production functions** — `ozForRecipeInput` from `lib/recipe-math.ts`, against (a) the current pinned SKU's live shape and (b) `productInputBasis(product, resolvedMember)` — and moves the pin only when the two agree within `1e-9`. This is not a new idea: it is exactly the gate `scripts/seed/18-twin-adjudication.ts` built and then refused itself on, and its own note says *"Either way, re-running this script afterwards passes the gate and moves the pins with no code change. The gate is a live computation through the real production function, not a hardcoded refusal."*
- [ ] Refusal codes, each printed with its unblock:
  - `PRODUCT_UNWEIGHED` — the product has no `unit_oz` and the line is count-denominated. Unblock: weigh it (Phase 6) or set `unit_oz` from `OPERATIONAL_SLICE_OZ`.
  - `MEMBERS_DISAGREE` — `membersDisagreeOnUnitOz(members)` is true and `unit_oz` is unset. Unblock: rule on the weight.
  - `PACK_LABEL_LINE` — the line's unit is a pack/chain label, which a product cannot own (D3). Unblock: re-denominate the line in a measure unit first, as its own decision.
  - `OZ_WOULD_MOVE` — the two computations disagree. Unblock: reconcile the numbers; **never** widen the tolerance.
  - `NO_PRODUCT` — the pinned SKU has no `product_id`. Correct and expected for a singleton; not an error.
- [ ] The dry run prints, per line: recipe · item · current pin (SKU + vendor) · unit · quantity · **oz before** · **oz after** · verdict. A reviewer must be able to see that the number does not move without running anything.
- [ ] Commit the dry-run output as `docs/seed/source/repoint-pins-dryrun.md`.

## Task 4.3 — The write half

- [ ] For each PASSING line, ONE `recipe_inputs` UPDATE setting `component_product_id = <product>` and `component_sku_id = null` **in the same statement** — the 3-way XOR CHECK makes any other ordering impossible, which is the constraint doing its job.
- [ ] `if (!count) throw` on every UPDATE (silent-UPDATE law). Re-read and FATAL if the row's `quantity`/`unit` moved under us (plan-drift refusal).
- [ ] Audit each: `action: "recipe_input.update"`, `resourceTable: "recipe_inputs"`, metadata `{ from_component_sku_id, to_component_product_id, unit, quantity, oz_before, oz_after, phase: "product_identity", reason: "pin_moved_to_product", script, actor_context: "seed" }`. `oz_before === oz_after` is the receipt that the move was safe.
- [ ] Append a `recipes.notes` stanza in the seed-22 style (prefix-filtered so a re-run replaces its own line, never duplicates): `[product-pin product-identity-2026-08-20] <item> now pins the PRODUCT <name>, not <vendor> <sku>. Line oz unchanged (<n> oz). Resolution is per-location primary-first.`
- [ ] `EXECUTE` / `MD` / direct-invocation guards as in Phase 2.
- [ ] Commit, push, PR, CI green.

## Task 4.4 — Post-move verification script section

- [ ] The script's final section (runs in both modes) re-derives, through `loadRecipeGraph()`, the per-unit SKU-oz map for every item touched, and prints a before/after table. Zero deltas is the pass condition, and it is printed as a single PASS/FAIL line so nobody has to squint.
- [ ] Also print the **failover proof**: for each re-pointed product, resolve with each member forced inactive in turn and show that the line still resolves (to the other member) with the same oz. That is the arc's thesis, demonstrated on real data.

## GATE S2 (LOCKED) — LEAD runs the re-point

- [ ] **BUILD AGENTS STOP.** Dry run only.
- [ ] **LEAD:** run the dry run. **If ANY line refuses, do not execute.** Report the refusals and their unblocks to Juan; a refusal is the script working (seed 18's precedent), and the honest move is to fix the input, not the gate.

```bash
npx tsx --conditions=react-server --env-file=.env.local scripts/seed/25-repoint-recipe-pins.ts --markdown
```

- [ ] **LEAD:** with zero refusals, execute and paste both the write log and the post-move verification table:

```bash
npx tsx --conditions=react-server --env-file=.env.local scripts/seed/25-repoint-recipe-pins.ts --execute
```

- [ ] **LEAD:** verify live — `select count(*) from recipe_inputs where component_product_id is not null;` matches the plan, and `select count(*) from recipe_inputs where (component_sku_id is not null)::int + (component_item_id is not null)::int + (component_product_id is not null)::int <> 1;` is **0**.
- [ ] **JUAN:** smoke `/admin/menu-costing` (same dollars) and merge.

---

# PHASE 5 — Count sheet C-mode + product roll-up (spec §5) · migration `0180`

**Ships:** the count sheet defaults to the PRODUCT with one number, tap-to-split expands per-vendor rows, product counts allocate to member lines FIFO, and the on-hand panel gains the two-grain view with per-vendor split and lot remaining.

**Estimated size:** ~8 tasks · 1 small migration · ~600 lines TS/TSX · 1 PR.

**Smoke focus (Juan, on a phone):** open `/operations/counts`, see **HAM** as one row with one box; tap it and see the two vendor rows appear; submit a product count and watch the on-hand panel show "HAM 300 oz — 200 PFG / 100 Baldor". Then submit a split count and confirm it anchors per vendor exactly as before.

## Task 5.1 — Branch + migration `0180` (AUTHOR ONLY)

```bash
git fetch && git checkout main && git reset --hard origin/main
git checkout -b feat/product-identity-p5-counts
```

- [ ] Create `supabase/migrations/0180_count_product_allocation.sql`:

```sql
-- Migration 0180_count_product_allocation
-- AUTHORED 2026-08-20. NOT YET APPLIED — GATE M2 (LEAD/JUAN).
-- Canonical reference: docs/superpowers/specs/2026-08-20-product-identity-design.md
--   section "Counting UX (locked: option C)".
--
-- WHY: a product-level count ("HAM ... 300 oz") is entered once but must land as
-- ORDINARY per-SKU anchor lines, because sku_count_lines.sku_id is NOT NULL and the
-- whole anchor/drift/variance engine (resolvePerSkuAnchors, computeOnHand,
-- computeVariance) is per-SKU keyed. Allocation happens in lib/products-shared.ts
-- (allocateProductCount, newest-back over remaining lots). This column records that
-- the line was DERIVED from a product count rather than counted per vendor, so an
-- auditor reading the anchor can tell a measurement from an allocation.
--
-- HONEST-NULL (0161 LOCK-1 doctrine): NULL means "counted directly at this SKU",
-- which is the pre-existing meaning of every row. No sentinel, no backfill.
--
-- ADDITIVE: nullable, no default. Every existing writer keeps working unchanged.
-- RLS unchanged — sku_count_lines stays deny-all to users (0160); service-role writes.
--
-- PRE-FLIGHT: select count(*) from sku_count_lines;   -- expect 0 (no census yet)

alter table public.sku_count_lines
  add column if not exists allocated_from_product_id uuid null references public.products(id);

comment on column public.sku_count_lines.allocated_from_product_id is
  'Set when this line was DERIVED by allocating a product-level count across member '
  'SKUs (spec 2026-08-20, option C; lib/products-shared.ts allocateProductCount, '
  'newest-back over remaining FIFO lots). NULL = counted directly at this SKU, which '
  'is what every pre-0180 row means. The number is still a real anchor either way; '
  'this column only says how the vendor attribution was arrived at.';

create index if not exists sku_count_lines_allocated_product_ix
  on public.sku_count_lines(allocated_from_product_id)
  where allocated_from_product_id is not null;
```

- [ ] Commit the file. Do not run it.

## Task 5.2 — `lib/products.ts`: the lot loader

- [ ] Add `loadProductLots(locationId, productIds): Promise<Map<string, ReceiptLot[]>>`:
  - the delivery-id scoping pattern from `lib/counts.ts locationDeliveryIds` (paged, `order("id")`, throws on error — a short id list silently zeroes intake);
  - `vendor_delivery_items` `.in("vendor_item_id", memberSkuIds)` `.in("delivery_id", deliveryIds)`, selecting `id, vendor_item_id, created_at, resolved_oz`, **paged**;
  - a line with `resolved_oz` NULL is **dropped and reported** (`nullOzLotCount` per product), never coerced to 0 — the same taint discipline `sumReceivedOzWindow` already applies. A product with tainted lots gets FIFO **advisory-null**, not a wrong split.
- [ ] Unit-test the pure part only; the loader itself is DB-coupled and stays on the script harness per the vitest-spine law.
- [ ] Commit.

## Task 5.3 — `CountFormData` gains products

- [ ] `lib/counts.ts` `CountSkuOption` gains `productId: string | null` and `productName: string | null`.
- [ ] New `CountProductOption`:

```ts
/** One PRODUCT row on the count sheet (spec option C). */
export interface CountProductOption {
  productId: string;
  name: string;
  /** Member SKU ids at this location, active first — the tap-to-split rows. */
  memberSkuIds: string[];
  /** The resolved primary — whose chain labels the product row's level picker uses. */
  defaultSkuId: string | null;
  /** Level labels borrowed from the resolved primary (see the D-note below). */
  chainLabels: string[];
  /** True when 2+ members carry expected stock here — the spec's tap-to-split trigger. */
  splitAvailable: boolean;
}
```
- [ ] `CountFormData` gains `products: CountProductOption[]`.
- [ ] `loadCountFormData` builds it from the product index + `loadOnHand`'s per-SKU rows (for "carries expected stock"). **`splitAvailable` must not require `loadOnHand`** if that proves expensive here — a member count of 2+ is a sufficient trigger and the spec's wording ("when 2+ members carry expected stock") is satisfiable from the lot loader alone. Pick one, and say which in a code comment; do not let a tile-shaped perf problem sneak onto a per-render path (the `loadCountsTileState` lesson: `loadOnHand` WRITES on read via the `sku_inferred_baselines` upsert at `lib/counts.ts:467`, so it is **never** safe to add to a new render path casually).

> **Note for the lead — level labels on a product row.** A product's members may carry different pack chains, so there is no product-owned level vocabulary. The C-mode row borrows the **resolved primary's** `chainLabels`, and when members' chains differ the form says so and points at tap-to-split. This is the honest minimum; a product-owned unit vocabulary is a bigger design and is explicitly not in this arc.

## Task 5.4 — Product count lines: `createCountEvent`

- [ ] `lib/counts-shared.ts` `CountLineInput` gains a product form: `{ productId: string; levelLabel: string; qty: number; isLoose?: boolean; partialFraction?: number | null }` as a discriminated alternative to the existing `skuId` form. Keep the existing shape byte-identical so every current caller compiles.
- [ ] `createCountEvent`: for each product line —
  1. resolve the entered qty+level to oz through the **resolved primary's** `RecipeInputSku` (the existing `resolveCountLinesDim` machinery, unchanged);
  2. `remainingByLot(lots, consumedSinceAnchorOz)` for that product;
  3. `allocateProductCount(oz, remaining)`;
  4. write one ordinary `sku_count_line` per allocated member with `allocated_from_product_id = productId`;
  5. `unallocatedOz > 0` → **reject the line** with `CountError(400, "count_exceeds_lots")` carrying the number. A count that the receipt ledger cannot place is a real finding (an unrecorded delivery), and silently assigning it to a vendor would corrupt the anchor the whole drift model rests on. The operator's escape hatch is tap-to-split, which the error message must name.
- [ ] Audit metadata records `product_lines`, `allocated_line_count`, and the per-product allocation, so the derivation is reconstructible.
- [ ] Commit.

## Task 5.5 — `OnHandView.products`

- [ ] `lib/counts.ts`: `OnHandView` gains `products: ProductOnHandRow[]`:

```ts
export interface ProductOnHandRow {
  productId: string;
  productName: string;
  /** rollupProductGrain over the member rows. NON-NULL only when every member resolved. */
  totalOz: number | null;
  knownOz: number;
  unknownSkuIds: string[];
  /** The per-vendor split — Juan's "200 PFG + 100 Boar's Head". */
  members: Array<{ skuId: string; skuName: string; vendorName: string | null; onHandOz: number | null }>;
  /** Product-grain variance: the members' variances summed, null if ANY is null.
   *  This is where the audit's mirrored false SHORT/OVER dies. */
  varianceOz: number | null;
  /** Advisory FIFO attribution of varianceOz to lots (oldest absorbs). */
  varianceLots: LotShare[];
  /** Lot-level remaining, oldest-first — the shelf, newest-back. */
  remaining: LotShare[];
}
```
- [ ] It is computed **purely** from the existing `rows` plus the lot map — `rows` stays untouched and remains the source of truth. Weight rows only (a count-dimension SKU has no oz and no product grain to sum into); a mixed product is reported with its count-dimension members in `unknownSkuIds`.
- [ ] Commit.

## Task 5.6 — `CountForm`: C-mode + tap-to-split

- [ ] `components/counts/CountForm.tsx`: the SKU `<select>` becomes a two-tier option list — products first (one row, one number), then singleton SKUs. A product row renders a **tap-to-split** control: a full-row toggle (Disclosure Doctrine D: phone-first full-row toggles, `useState` only) that replaces the one product line with one line per member, each vendor-labeled via the existing `twinVendorLabels` (PR #267's labels, reused not re-derived).
- [ ] The split control is a 44px hit area **with `items-center`**; the toggle chevron is an icon button sized on **both** axes.
- [ ] The existing incomplete-line warning must count product lines too (council P2 — a silently dropped line is the bug that warning exists for).
- [ ] i18n both locales, including the ARIA label on the split toggle and the `counts.error.count_exceeds_lots` message naming the escape hatch.
- [ ] Commit.

## Task 5.7 — `OnHandPanel`: the two-grain read

- [ ] `components/counts/OnHandPanel.tsx`: product rows render **headline = the product number**, with the per-vendor split and the lot remaining in a drawer. Follow the shipped dashboard grammar: *"the most urgent fact is the headline; handled shrinks to pills."*
- [ ] `totalOz === null` renders an em-dash plus a "N members unresolved" pill naming them — never `knownOz` presented as the total.
- [ ] Variance keeps the existing F5 short/over labeling and its census-only rule (a `par_estimate` or `inferred` anchor can never be a variance reference — `lib/counts.ts:553,700`). A product row's variance is null unless **every** member is census-anchored.
- [ ] i18n both locales. Commit.

## Task 5.8 — CI + PR

- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` — clean.
- [ ] **Screenshot the running app on a phone viewport** (the UI-arc lesson: build-green is not renders-right) and attach: product row collapsed, split expanded, on-hand two-grain.

## GATE M2 (LOCKED) — LEAD applies `0180`

- [ ] **BUILD AGENTS STOP.**
- [ ] **LEAD:** pre-flight `select count(*) from sku_count_lines;`, apply `0180`, verify the column and the partial index exist.
- [ ] **JUAN:** smoke per the focus above, merge.

---

# PHASE 6 — Weight & trim audit + equipment identity (spec §6) · migration `0181`

**Ships:** the weight board beside the costing board, the owner-invoked weigh session, the standard-vs-observed trim advisory, and the equipment link that clears the 32-row needs-link false positive.

**Estimated size:** ~10 tasks · 1 migration + backfill · ~800 lines TS/TSX · 1 PR. Consider splitting into 6a (weights) and 6b (equipment) if the diff exceeds ~1200 lines — they share no code and are independently smokeable.

**Smoke focus (Juan):** `/admin/weights` lists every weight the system believes with its class and provenance, and the suggestion list is ranked by cost impact — **and nothing on it nags** (no due dates, no overdue badges, no red counts on the hub). Then: run a weigh session on two items and watch the class flip to OPERATIONAL. Separately: `/admin/checklist-templates` needs-link badge drops from 32 to 2, and a fridge page shows its temp history beside its maintenance notes.

## Task 6.1 — Branch + lift the trim registry (deviation D11)

```bash
git fetch && git checkout main && git reset --hard origin/main
git checkout -b feat/product-identity-p6-weights-equipment
```

- [ ] Create `lib/trim-standards-shared.ts` and move `TrimEvidence`, `TrimStandard`, `TRIM_STANDARDS` and `PORTIONED_ITEMS` **verbatim** out of `scripts/seed/22-portioned-recipe-fix.ts:150-260`, exporting each. Preserve every `rationale` string exactly — they are the evidence, and the published-yield citation on `HEAD_LETTUCE_CORED_CHOPPED` is load-bearing.
- [ ] Have seed 22 import them so there is exactly one copy. Verify the seed still type-checks. (Note: that file contains a NUL byte at ~45135 and ripgrep treats it as binary — read it with `Read`, or `grep -a`.)
- [ ] Commit as a pure move: `refactor(trim): lift the #271 standard-trim registry into an importable shared module`.

## Task 6.2 — `lib/weights-shared.ts`: failing test

- [ ] Create `tests/weights-shared.test.ts` covering:
  - `observedTrimFromProduction({ outputQty, ozPerParUnit, inputOz })` → `1 − (outputQty × ozPerParUnit) / inputOz`; null when `ozPerParUnit` is null (six live preps are unweighed), null when `inputOz <= 0`, and **negative trim is returned as-is, not clamped** — a pan weighing more than its inputs is a data bug and must surface, which is precisely the one-sided reasoning behind `MASS_BALANCE_TOLERANCE`.
  - `classifyWeightDrift({ standardTrim, observedTrim, tolerance })` → `"agrees" | "over_trim" | "under_trim" | "no_reference"`.
  - `rankWeightSuggestions(beliefs)` → cost-impact × staleness ordering, ties broken on name; a belief with no cost basis ranks **below** every priced one rather than being dropped (it is still weighable, just unrankable); the ordering must be total.
  - A regression case: a multi-member product with `unitOz == null` and `membersDisagreeOnUnitOz === true` ranks **first**, because that is the exact configuration that blocks Phase 4's re-point.
- [ ] Implement `lib/weights-shared.ts` (pure, client-safe). `WeightBelief` carries `{ subjectKind: "sku" | "product" | "item"; subjectId; name; valueOz: number | null; unit: string; weightClass: string | null; establishedAt: string | null; establishedBy: string | null; sourceNote: string | null; costPerOz: number | null; usageOz: number | null; blocksRepoint: boolean }`.
- [ ] Green. Commit.

## Task 6.3 — `lib/weights.ts`: the board loader

- [ ] `loadWeightBoard(actor)` at `COST_READ_MIN` (6), batch-loaded like the costing board: ONE `vendor_items` read (weights + the new provenance columns) · ONE `products` read · ONE `items` read for `oz_per_par_unit` · ONE `loadRecipeGraph()` for cost impact · ONE `loadCurrentSkuPrices` · ONE grouped `productions` + `production_inputs` read for observed trim. **No per-subject query.**
- [ ] "Who/when established" comes from the new columns; where they are NULL (every seed-written weight — the seeds audit with `actorId: null`), the board renders **"seed · <script>"** from the audit trail, and the absence of a person is shown honestly rather than filled in.
- [ ] The drift advisories the spec names: invoice weights moving (compare `vendor_delivery_items.observed_oz_per_each` against `avg_oz_per_each`) · observed trim diverging from standard (`classifyWeightDrift`) · a count variance implicating a weight (a census variance on a SKU whose weight class is `SPEC`).
- [ ] Reuse `rulingStatus` from `lib/angel-wave3.ts:287` for the `OPERATIONAL_DRIFT` tripwire on ruled values — but **note in a comment that it is keyed by SKU NAME against a hardcoded 5-row table**, so it is a legacy check for those five and not a general mechanism. Do not extend it; new rulings live in the columns.
- [ ] Commit.

## Task 6.4 — `/admin/weights` surface

- [ ] `app/admin/weights/page.tsx` + `components/admin/weights/WeightBoardClient.tsx`. Register in `lib/admin/sections.ts` **immediately after `menu-costing`** (the spec: "admin, beside the costing board"):

```ts
  { id: "weights",             i18nKey: "admin.section.weights",             href: "/admin/weights",             minLevel: 6 },
```
- [ ] Structure mirrors `MenuCostingClient`: `CollapsibleSection` groups, `SummaryRow` + lazy `RowDrawer`, spec reference rendered **beside** operational values (the spec's exact wording), drift advisories as pills.
- [ ] **NO CLOCKS, NO DUE DATES, NO GATES.** Juan's ruling is verbatim law here: *"triggered on demand. Behaves just like the regular audit."* Concretely: no `comingSoon`-style deadline copy, no "overdue" tone, **no `AlertPill` count on the `/admin` hub card** for this section (the hub's `countNotReady` pills are for readiness, and wiring weights into them would make the tool nag — which is precisely what the ruling forbids). The suggestion list is a **ranked list**, and its header says it suggests.
- [ ] i18n both locales. Commit.

## Task 6.5 — The weigh session

- [ ] Mirror the `/counts` session flow exactly (that is the doctrine): owner-invoked → pick subjects (or take the suggestions) → enter measurements → commit.
- [ ] Route handler `POST /api/admin/weights` (route handler + `fetch`, **not** a server action — this codebase has none), `PRICE_WRITE_MIN`-equivalent gate at GM+ with `assertStepUp(ctx, "A")`. The form lives under `/admin`, so it uses the existing `StepUpProvider` rather than carrying its own modal (unlike `CountForm`, which is outside it).
- [ ] `recordWeightMeasurement` writes `avg_oz_per_each` (or `products.unit_oz`, or `items.oz_per_par_unit`) **plus** `weight_class = "OPERATIONAL"`, `weight_established_at = now()`, `weight_established_by = actor.user.id`, `weight_source_note`, and audits `sku.weight_fill` / `product.unit_oz_set` / `item.weight_fill` with the before/after and `actor_context: "weight_audit"`. Check `count` and throw on 0.
- [ ] A session is a set of independent measurements, each its own append. There is no session header table and no supersede — the audit trail is the session record, exactly as `sku_count_events` is immutable and per-SKU anchors resolve at read.
- [ ] i18n both locales. Commit.

## Task 6.6 — Weight provenance backfill (evidence-based, dry-run gated)

- [ ] `scripts/seed/26-weight-provenance-backfill.ts`: one pass over `audit_log` where `action = 'sku.weight_fill'`, newest per `resource_id`, writing `weight_class` and `weight_established_at` (the audit row's own timestamp) onto `vendor_items`. **`weight_established_by` stays NULL** — the seeds wrote `actorId: null`, so there is genuinely nobody to name, and inventing one would be worse than the absence.
- [ ] A SKU with no audit history keeps NULL columns. Do not infer a class from the value.
- [ ] Dry-run default. This is a small gate, folded into GATE M3's checklist rather than getting its own.

## Task 6.7 — Migration `0181` (AUTHOR ONLY)

- [ ] Create `supabase/migrations/0181_template_item_equipment_link.sql`:

```sql
-- Migration 0181_template_item_equipment_link
-- AUTHORED 2026-08-20. NOT YET APPLIED — GATE M3 (LEAD/JUAN).
-- Canonical reference: docs/superpowers/specs/2026-08-20-product-identity-design.md
--   section "Equipment identity (the same pattern, cold side)".
--
-- WHY: 32 ACTIVE expects_count template items sit in the Template Doctor's
-- "needs link" queue with item_id AND vendor_item_id both NULL. All 32 are fridge
-- TEMPERATURE lines — verified live: 32 of 32 already have a maintenance_equipment
-- row pointing AT them via opening_temp_item_id / closing_temp_item_id. They are not
-- unlinked; they are linked to a kind of thing the queue could not express. A
-- thermometer finally has something to link TO.
--
-- ⚠ THE TABLE IS maintenance_equipment, NOT equipment. public.equipment does not
-- exist; the registry has been maintenance_equipment since 0070.
--
-- ⚠ NO XOR CHECK IS ADDED, AND NONE IS REMOVED — there is none to extend. The
-- spine-link CHECK in 0163:62-97 is a DEFERRED, commented-out block that was never
-- applied, because a NOT VALID CHECK is enforced on any UPDATE to any column of a
-- legacy row and would have 500'd the fillItemTranslations es-fill campaign on
-- exactly the unlinked rows the Doctor drives managers to fix. Enforcement stays
-- app-layer (linkTemplateItem / fillItemSpineLink / copyItemsToVersion), which is
-- where it already lives. What this migration DOES do is drop the backlog from 34 to
-- 2, which is the first time 0163's deferred constraint becomes near-shippable — as
-- a FOLLOW-UP, filed on the ROADMAP, deliberately not taken here.
--
-- ⚠ REFERENCE CYCLE, ON PURPOSE: maintenance_equipment already points at
-- checklist_template_items (two columns, 0070). This closes the loop. Legal in
-- Postgres (both sides nullable) and both directions are needed:
--   equipment_id                          = "which asset does this line measure"
--   opening_temp_item_id / closing_temp_item_id = "which line is the AM vs the PM
--     reading" — the PHASE discriminator, which equipment_id alone cannot express
--     (lib/maintenance.ts:126 derives AM/PM by comparing against openingTempItemId).
-- Do NOT retire the two existing columns; they answer a different question.
--
-- BACKFILL IS A PURE JOIN, no guesswork: every one of the 32 rows is already named by
-- a maintenance_equipment row. Migration 0071 set the precedent for exactly this join
-- (it bulk-relabeled the same 32 rows and recorded affected_item_count = 32).
--
-- ADDITIVE: nullable, no default. RLS unchanged.
--
-- PRE-FLIGHT (lead runs and pastes):
--   select count(*) from checklist_template_items cti
--     join checklist_templates t on t.id = cti.template_id
--    where cti.active and t.active and cti.expects_count
--      and cti.item_id is null and cti.vendor_item_id is null;          -- expect 32
--   select count(*) from checklist_template_items where equipment_id is not null; -- errors: column absent

alter table public.checklist_template_items
  add column if not exists equipment_id uuid null references public.maintenance_equipment(id);

create index if not exists checklist_template_items_equipment_id_idx
  on public.checklist_template_items (equipment_id);

comment on column public.checklist_template_items.equipment_id is
  'The maintenance_equipment asset this line measures (0181). A third spine-link '
  'target beside item_id and vendor_item_id, so a temperature line is LINKED rather '
  'than counted as a needs-link false positive. It does NOT replace '
  'maintenance_equipment.opening_temp_item_id / closing_temp_item_id: those carry the '
  'AM/PM phase discriminator that lib/maintenance.ts derives readings from.';

-- Backfill from the existing pointers. Both directions then agree by construction.
update public.checklist_template_items cti
   set equipment_id = me.id
  from public.maintenance_equipment me
 where cti.equipment_id is null
   and (cti.id = me.opening_temp_item_id or cti.id = me.closing_temp_item_id);

-- POST-APPLY EXPECTATION (lead verifies):
--   select count(*) from checklist_template_items where equipment_id is not null;  -- expect 32
--   the needs-link pre-flight query above, re-run with
--     and cti.equipment_id is null                                                  -- expect 2
```

- [ ] Commit the file. Do not run it.

## Task 6.8 — The needs-link queue learns `equipment`

Four predicate/filter sites plus the publish map. Change all of them in one commit — a partial change makes the queue and the Doctor disagree.

- [ ] `lib/admin/needs-link-shared.ts:29-31` — `needsLink` gains `equipmentId === null`; `NeedsLinkInput` gains `equipmentId: string | null`.
- [ ] `lib/admin/template-builder-shared.ts:220-225` — `itemNeedsLink` gains the same clause; `SpineLinkTarget` (`:83-86`) gains `| { kind: "equipment"; id: string }`.
- [ ] `lib/admin/needs-link.ts:90-100` and `:138-141` — both SQL filters gain `.is("equipment_id", null)`; `loadLinkTargets` (`:152-178`) gains a third query over `maintenance_equipment`. **`loadLinkTargets` has no location parameter and equipment is location-scoped** (`items` are global, `location_id IS NULL`) — add one, or a Cap Hill line becomes linkable to a P Street fridge. Its three callers (`app/admin/checklist-templates/page.tsx:47`, `.../opening/page.tsx:48`, `.../closing/page.tsx:37`) all have the template's location in hand.
- [ ] `lib/admin/needs-link.ts:206-208` (`already_linked`) and `:224-243` (target validation + the update) gain the third arm.
- [ ] `app/api/admin/checklist-templates/needs-link/[lineId]/route.ts:22` — the `targetKind` whitelist gains `"equipment"`.
- [ ] `lib/admin/template-builder.ts:409-417` (`fillItemSpineLink`) and `:1139-1163` (the version-publish column map) gain `equipment_id`. Copied rows already carry it via the `{...rest}` spread over a `select("*")` at `:812-813` — verify, do not assume.
- [ ] `lib/template-items.ts:78-79` — `TEMPLATE_ITEM_COLUMNS` gains `equipment_id`; `TemplateItemRow` + `rowToTemplateItem` map it; `lib/types.ts` `ChecklistTemplateItem` gains `equipmentId: string | null`. **Nine consumers read that constant** — run the grep and confirm each still compiles.
- [ ] `components/admin/templates/NeedsLinkQueue.tsx` — `kindFilter` becomes `"all" | "item" | "sku" | "equipment"`, a fourth chip, and the type badge learns the equipment label.
- [ ] `components/admin/template-builder/TemplateBuilderClient.tsx` `SpineLinkBlock` (`:1983-1995`) — same three changes; `linked` becomes `item.itemId !== null || item.vendorItemId !== null || item.equipmentId !== null`.
- [ ] i18n: `admin.templates.needs_link.filter_equipment`; **reword** `admin.templates.needs_link` subtitle (`en.json:1043`) and empty state (`:1044`), and the builder's `:1092-1094` keys — all four currently hardcode "master-list item or SKU". Add an equipment label to `admin.catalog.type.*` (`:745-754`). Both locales.
- [ ] Update `tests/master-list-taxonomy.test.ts:78-90` and `tests/template-builder-shared.test.ts:208-221,335-336` for the third target. Commit.

## Task 6.9 — Per-fridge asset page

- [ ] `lib/maintenance.ts`: `loadEquipmentDetail` already returns `readings` + `notes`. Add the **template-line provenance** (which checklist lines feed this asset, now that `equipment_id` names them) so the page can say where each reading comes from. Keep `loadFridgeReadings`' AM/PM derivation on `openingTempItemId` — `equipment_id` cannot express phase, and swapping it in would regress the reading labels.
- [ ] Render the maintenance trail beside the temp history on the equipment detail surface.
- [ ] While here, note but **do not fix** the `loadMaintenanceOverview` per-fridge serial load (2 queries × 8 fridges) — it is already a ROADMAP DEBT row with the trigger "next maintenance-lib touch". Fixing it inside this PR widens a diff that is already large; instead confirm the row is still there and say so in the PR.
- [ ] i18n both locales. Commit.

## Task 6.10 — CI + PR

- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` — clean.
- [ ] Screenshot `/admin/weights` and the equipment detail page.

## GATE M3 (LOCKED) — LEAD applies `0181` + the provenance backfill

- [ ] **BUILD AGENTS STOP.**
- [ ] **LEAD:** run the two pre-flight queries; expect **32** unlinked and no `equipment_id` column.
- [ ] **LEAD:** apply `0181`. Verify: `equipment_id is not null` → **32**; the needs-link query with `and cti.equipment_id is null` → **2**.
- [ ] **LEAD:** dry-run then execute `scripts/seed/26-weight-provenance-backfill.ts`; paste both.
- [ ] **JUAN:** smoke per the focus above, merge.

---

# PHASE 7 — Sim verification + arc close (spec §Verification)

The spec is explicit: *"The sim harness (`scripts/sim/`) gets a vendor-down day and a two-vendor count day before this arc is called done."* This phase is not optional and it is not folded into Phase 6 — a sim run finds architecture, and it should run against the whole assembled arc.

**Estimated size:** ~5 tasks · ~2 sim day-scripts + findings + a fix batch · 1–2 PRs (the sim day itself, then whatever it finds).

**Smoke focus (Juan):** he reads the findings, same as the two prior sim days. The fixes are their own PR with their own smoke.

## Task 7.1 — Vendor-down day

- [ ] Add `scripts/sim/personas.md` entries and a day script in the shape of the existing `scripts/sim/concurrency/fullday.mjs` + the two prior `FINDINGS.md` days. The scenario:
  1. morning: a manager walks pars and orders normally;
  2. mid-morning: the lead deactivates the PRIMARY ham twin on the sandbox DB (the vendor is out);
  3. the personas then do a normal day — prep, production capture, mid-shift, ordering, close.
- [ ] What the day must prove, and each is a named assertion in the findings, not a vibe:
  - the walk still offers ham, from the backup, with a `reroutedToBackup` notice;
  - the cost board's ham figure **does not move**;
  - production capture accepts the backup SKU (the amplifier fix);
  - exactly **one** ham suggestion appears, not two (product dedupe);
  - a `product.resolution_flip` audit row exists naming from/to/rung.
- [ ] Follow the sim handbook's rules — personas stay in character, journal `CONFUSED:` / `BUG?:` / `FELT:` lines, 3-try rule.

## Task 7.2 — Two-vendor count day

- [ ] Scenario: both ham twins carry real stock at one location, with interleaved deliveries so FIFO has something to say.
  1. an AGM opens `/operations/counts` and counts HAM as a **product** (C-mode);
  2. a second session taps to **split** and counts each vendor;
  3. the on-hand panel is read after each.
- [ ] What it must prove:
  - the product count writes N member lines whose oz sum **exactly** to what was entered;
  - `allocated_from_product_id` is set on those lines and NULL on the split ones;
  - the split count anchors per-SKU identically to a pre-arc count;
  - the product row's variance is the members' variances summed, and the mirrored SHORT/OVER pair from the audit does **not** appear;
  - a count larger than the lot ledger explains is REFUSED with `count_exceeds_lots` and the message points at tap-to-split.
- [ ] Write both days' output into `scripts/sim/FINDINGS.md` in the existing format.

## Task 7.3 — Fix batch

- [ ] Triage findings into P1 (fix now, own PR) / P2 (ROADMAP) exactly as the 2026-08-11 sim program did. Concurrency findings get the same seriousness — the prior program found four real concurrency bugs and every one was worth the day.

## Task 7.4 — Run the T0 review checklist over the whole arc

- [ ] Re-read the arc's five PRs against `feedback_recurring_bug_classes.md` (the 20 named classes). The classes most in play here, named so they are actually checked and not just gestured at:
  - **silent-at-scale truncation** — every new read over `vendor_delivery_items`, `productions`, `production_inputs` and `sku_count_lines` must page (`selectAllRows`, `order("id")`). A truncated lot page silently mis-attributes FIFO.
  - **first-wins on an unordered select** — every new ordering must be TOTAL (a tiebreak on a never-null column). This arc adds three sorts; all three are tie-broken on id.
  - **silent UPDATE denial** — every new write checks `count`.
  - **fabricated numbers** — every new null path returns null, never 0. Grep the diff for `?? 0` and justify each survivor.
  - **partial results presented as totals** — `rollupProductGrain.knownOz` must never be rendered where `totalOz` belongs.
  - **shared-type consumer grep** — `RecipeGraph`, `GraphInput`, `CountSkuOption`, `OnHandView`, `ChecklistTemplateItem`, `SpineLinkTarget`, `VendorItem` all changed shape; grep each.
- [ ] Review the **git diff**, not the agent reports (the UI-arc lesson).

## Task 7.5 — Arc close

- [ ] `docs/ROADMAP.md`: retire the four now-closed DEBT rows —
  - `location_sku_settings unseeded (0 rows) … counts never reads it` (Phase 3 makes counts and costing read the overlay through the product index);
  - `skuNameCollisions will nag on doctrine-correct twins` (P7, folded into Phase 3);
  - `Count sheet shows no vendor label on twins` (P8, shipped #267 and consumed by C-mode);
  - `Spine-link DB CHECK + item_id FK action | after the 34-line needs-link backlog clears` — **re-trigger it, do not retire it**: the backlog is now 2, so the 0163 deferred CHECK is finally near-shippable.
- [ ] File the three named follow-ups: **P6 usage seed** (Angel spend as a null-fallback, explicitly sequenced after this arc) · **a location selector on `/admin/menu-costing`** (D7) · **`lib/types.ts` `VendorItem` staleness** (Task 1.9).
- [ ] Update `AGENTS.md`'s "Current state" migration count and add ONE law line under **Engineering doctrine**, since this arc establishes a rule future work must not break:

> **Product identity resolves ONCE, at graph build.** A product-pinned recipe line is resolved to a member SKU by `resolveProductMember` inside `loadRecipeGraph`, and every consumer downstream stays SKU-keyed. Never resolve a product a second time in a consumer, and never denominate a product-pinned line in a vendor's pack or chain label — a product owns `unit_oz`, not a pack.

- [ ] Update the durable-memory topic file for this arc (the session-close convention).

---

## Spec → task coverage map

Every line of `docs/superpowers/specs/2026-08-20-product-identity-design.md` and every P2-coupling item from the audit, mapped to the task that discharges it.

| Spec section / line | Plan phase · task | Note |
| --- | --- | --- |
| §The locked model — 4 layers, `products` table | P1 · 1.2 | `products` created; menu/prep/SKU layers untouched |
| §The locked model — `vendor_items.product_id` nullable FK | P1 · 1.2, 1.8 | Column + admin wiring |
| §The locked model — productless SKU = implicit singleton | P1 · 1.4 | `resolveProductMember` never sees them; no product row required |
| §The locked model — per-location primary designation | P1 · 1.2 (table), 1.7 (UI) | `product_primaries`, `location_id NULL = global` — **D6** |
| §The locked model — "products created where plurality exists, lazily thereafter" | P2 · 2.2, 2.3 | 11 multi-vendor names + ICEBERG; unruled pairs get no primary |
| §Resolution — primary-first ladder ①②③④ | P3 · 1.3, 1.4 (built in P1) | `resolveProductMember`, 11 test cases |
| §Resolution — "menu costing board prices at this resolution" | P3 · 3.8 | Global primary; location selector deferred — **D7** |
| §Resolution — FIFO across receipt lots | P3 · 3.2, 3.3 | Read-time attribution — **D5** |
| §Resolution — "lot data already exists (`vendor_delivery_items` are dated)" | P5 · 5.2 | `loadProductLots`; NULL `resolved_oz` taints, never coerces |
| §Resolution — two-grain on-hand, per-SKU ledgers are truth | P3 · 3.4, 3.5 · P5 · 5.5 | `rollupProductGrain`, `OnHandView.products` |
| §Resolution — lot remaining distributed newest-back | P3 · 3.3 | `remainingByLot` |
| §Resolution — ONE pure fn consumed by costing/depletion/production/ordering | P3 · 3.7, 3.8, 3.11, 3.12 | One seam at graph build; nine callers inherit it |
| §Resolution — "every resolution flip writes an audit row" | P3 · 3.8 | `product.resolution_flip`, emitted from the daily writer not the read path |
| §Counting UX — product row, one number by default | P5 · 5.3, 5.6 | `CountProductOption`, C-mode |
| §Counting UX — tap-to-split when 2+ members carry stock | P5 · 5.3, 5.6 | Full-row toggle, `useState` only |
| §Counting UX — vendor-labeled per #267's twin labels | P5 · 5.6 | Reuses `twinVendorLabels`, not a second derivation |
| §Counting UX — product counts allocate variance FIFO (oldest absorbs) | P3 · 3.3 · P5 · 5.4, 5.5 | `allocateProductCount` (newest-back) + `allocateProductVariance` (oldest-first) — **D8** |
| §Counting UX — split counts anchor per-SKU exactly as today | P5 · 5.4 | Existing engine untouched; `allocated_from_product_id` NULL |
| §Counting UX — audits re-anchor, count beats theory | — | Already true; census tier + variance reason codes unchanged |
| §Payoff — vendor down → resolution skips to backup | P3 · 3.11 · P7 · 7.1 | `reroutedToBackup` + the sim day |
| §Payoff — counts roll twins up | P5 · 5.5 | |
| §Payoff — ICEBERG absorbs the $3,231 | P2 · 2.2, 2.3 | Discovery pass surfaces it; Juan rules |
| §Payoff — the 8 pairs, one sitting | P2 · GATE S1 | The dry run is the adjudication document |
| §Payoff — usage/spend at product grain, ranks vendors within it | P3 · 3.11 | `rollupUsageByProduct` — **D9**; P6 spend seed stays out of scope |
| §Weight audit — ON-DEMAND TOOL, no clocks/due-dates/gates | P6 · 6.4 | Explicitly no hub `AlertPill` |
| §Weight audit — value · class · who/when · spec beside operational | P6 · 6.3, 6.4 | Needs persisted columns — **D10** |
| §Weight audit — drift advisories (invoice · trim · count variance) | P6 · 6.2, 6.3 | Three named advisories |
| §Weight audit — ranked suggestions (cost-impact × staleness), suggests never nags | P6 · 6.2, 6.4 | `rankWeightSuggestions`; blockers-first regression case |
| §Weight audit — session: pick → weigh → OPERATIONAL + audit rows | P6 · 6.5 | Mirrors `/counts`; step-up A |
| §Weight audit — `OPERATIONAL_DRIFT` tripwire keeps guarding ruled values | P6 · 6.3 | `rulingStatus` reused, with its name-keying flagged |
| §Weight audit — standard trim (from #271) vs observed trim | P6 · 6.1, 6.2, 6.3 | Registry lifted — **D11**; observed derived from production capture |
| §Equipment — `checklist_template_items.equipment_id` | P6 · 6.7 | `maintenance_equipment`, not `equipment` — **D4** |
| §Equipment — per-fridge temp history + maintenance trail on one asset | P6 · 6.9 | AM/PM phase stays on the existing pointers |
| §Equipment — clears the 32-row needs-link false positive | P6 · 6.7, 6.8 | 34 → 2, verified live |
| §Equipment — needs-link queue learns the equipment target | P6 · 6.8 | Four predicate/filter sites + publish map |
| §Migration path 1 — schema | P1 | `0179` |
| §Migration path 2 — seed products + members + primaries | P2 | seed 24 |
| §Migration path 3 — re-point pins | **P4** | Moved after the engine — **D1** |
| §Migration path 4 — resolution + FIFO into the seams | **P3** | Moved ahead of the re-point — **D1** |
| §Migration path 5 — count C-mode + roll-up views | P5 | `0180` |
| §Migration path 6 — weight audit + equipment | P6 | `0181` |
| §Out of scope — P6 usage seed · missing-water · pack-chain-blind $/oz · tenant vocabulary | P7 · 7.5 | Filed, not built |
| §Verification — vitest on ladder, FIFO, roll-up, count allocation, XOR | P1 · 1.3/1.5 · P3 · 3.2/3.4/3.6 · P6 · 6.2 | All pure, all TDD |
| §Verification — sim gets a vendor-down day + a two-vendor count day | P7 · 7.1, 7.2 | Arc is not done without them |
| §Verification — Juan smokes each phase, phases merge on his word | Every phase | Named smoke focus per phase |
| **Audit P2 coupling: flatten** | P3 · 3.6, 3.7, 3.8 | |
| **Audit P2 coupling: depletion writer** | P3 · 3.8 · P5 · 5.5 | Ledger untouched; rollup nets the twins — **D5** |
| **Audit P2 coupling: counts variance** | P5 · 5.4, 5.5 | Product-grain variance + FIFO allocation |
| **Audit P2 coupling: ordering advisory** | P3 · 3.11 | Primary-first, product dedupe, rerouted notice |
| **Audit P2 coupling: production dropdown** | P3 · 3.12 | The amplifier fix |
| **Audit P2 coupling: usageRank** | P3 · 3.11 | **D9** |
| Audit P7 — `skuNameCollisions` vendor-aware | P3 · file-structure row | Folded here: this arc is what makes twins normal |
| Audit P8 — count-sheet vendor labels | shipped #267 | Consumed by P5 · 5.6 |

## Open questions for the lead (answer before Phase 1 starts)

1. **D2's four columns on `products`** — confirmed as in scope? Without `unit_oz` the arc cannot re-point the ham pin, which is the single most valuable thing it does.
2. **D1's phase swap** — confirmed? It changes the order Juan will see phases land relative to the spec he approved.
3. **`PRODUCT_WRITE_MIN = 7`** (GM+, matching `SKU_WRITE_MIN`) vs 6 (AGM+, matching the cost read). I have chosen 7; a product designation moves money.
4. **Phase 6 split** — one PR or 6a/6b? The weight board and the equipment link share zero code.
5. **`count_exceeds_lots` as a hard refusal** (Task 5.4) — a product count the receipt ledger cannot place is refused rather than absorbed. That is the honest posture, and it will be the first thing Juan hits if a delivery went unrecorded. Confirm he would rather be stopped than have the system guess a vendor.

---

## LEAD RULINGS (CC, 2026-08-20 night — plan APPROVED for execution)

**All 11 deviations BLESSED as argued.** Notably: D1's phase swap (re-point only after the reader exists — the seed-18 lesson institutionalized) · D5's read-time FIFO (the double-count law's direct_oz lane stays untouchable) · D10's four provenance columns fold into migration 0179 under gate M1 · D11 also fixes the NUL byte while lifting the trim registry.

**CC verification of the recon uncertainties:** ① `created_at` as lot timestamp — SOUND today (0 backdated of 5 live deliveries; PG 17.6); if retro-entry becomes practice, add an explicit `received_at` then, not now. ② `UNIQUE NULLS NOT DISTINCT` — PG 17.6, supported. ③ Live `recipe_inputs.unit` census: oz(235)/each(38)/unit(19) + measure-registry tail — ZERO pack-label units; Phase 4's PACK_LABEL_LINE gate is backstop, not blocker. ④⑤ builder-verified in-phase as flagged.

**The five open questions, ruled:** D2 scope + D1 swap = as argued · `PRODUCT_WRITE_MIN` = **7** (structural edits; matches the input-type-convert precedent) · Phase 6 = **split into two PRs** (weights · equipment) · `count_exceeds_lots` = **NEVER hard-refuse** — a count is ground truth and theory yields to it (doctrine); surface advisory variance with a reason code instead.

**Standing gates:** migrations authored in-PR, applied ONLY at the named 🔒 gates on Juan's word. Every phase ends CI-green + Juan-smoked before the next begins.
