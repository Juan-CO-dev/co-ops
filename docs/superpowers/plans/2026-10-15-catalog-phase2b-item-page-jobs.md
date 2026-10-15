# Catalog Redesign — Phase 2 (Shop Versions: Pack, Price, Sourcing + Item Page) Implementation Plan

## Part 2b of 2 — the connected item page, "What this changes", and the two jobs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision r2 (2026-10-15).** This revision answers Astra's review of 2b (CHANGES REQUESTED, 13 findings) and the lead's decisions:
- **D2:** MoO+ writes any active shop; the shop switcher follows the same rule.
- **D4:** the preview is per actual save target and per affected shop. It binds each conversion to its previewed baseline, and pack + par commit atomically in one RPC.
- **D5:** the global boundary moved into 2a; this part only points the old screens at the item page.
- **Numbering:** Phase 1 owns 0257 and 0258 (`0258_recipe_input_write_atomic`, the advisory-locked recipe input writer behind `addRecipeInput` / `updateRecipeInput`). 2a is 0259 + 0260, so this part's migration is **0261**. 2b writes no recipe line; a later recipe-line writer builds on that RPC.

The finding-by-finding map is at the end of this file.

**Goal:** Give every bought item (SKU) one connected page at `/admin/catalog/sku/[id]`. The page shows:
- what the item is;
- which version you're seeing ("Global" / "P Street's version");
- a shop switcher;
- a "How it connects" strip (vendor → recipes → sandwiches);
- the sections How it arrives / Price / Ordering / Counting / Barcodes;
- "What's missing" to-dos with fix-it buttons;
- a History tab with Restore.

It ships the first two guided jobs:
- **"It arrives differently now"**: an always-sentence pack editor, then the "What this changes" preview computed **for the actual save target** (this shop only, or every shop riding the global default), then Save.
- **"Price changed"**.

A **"This case looks different"** button at the receiving door files the change for the GM. Every string is en + es. The page is phone-first, with the 44px floor, and follows the disclosure doctrine.

**Architecture:** 2b is UI and orchestration over 2a's data layer (`docs/superpowers/plans/2026-10-15-catalog-phase2a-shop-versions-data.md`, which must be merged with its 0259/0260 applied first).
- **The preview is pure and target-bound** (`lib/catalog/change-preview-shared.ts`). The server loads one state per shop (its effective pack, its graph, its prices, its D3-stamped par lanes, its open orders). The pure function then works out, for the chosen target:
  - every affected shop's knock-ons;
  - which shops are untouched;
  - a par row per (shop or global lane, day-class) with a status. A conversion is offered **only where that shop's effective pack changes and the par lives in the lane being changed**.
- **The preview carries a token.** It covers target, levels, the target's live version and the offered conversions. A save must present it; the server recomputes and refuses `preview_stale` on any difference.
- **Pack + par save atomically.** They commit in ONE RPC, `apply_sku_pack_change` (0261): under the SKU lock it validates the door report, calls 2a's `save_sku_pack_version`, re-checks each par against the previewed value (refusing everything on a mismatch), and marks the report applied.
- **The sentence editor** is a pure model (`lib/catalog/pack-sentence-shared.ts`) under one component.
- **Writes** go through 2a's gated writers and binds (`catalogShopAllowed`, D2).
- **0261** adds the door's request record, `sku_pack_change_requests` (deny-all, service-role ceiling), and `apply_sku_pack_change`. The door's notification uses the existing `notifications` primitive.
- **Sourcing per shop has no new model.** The page reads the existing `product_primaries` (per shop), `location_sku_settings` (off here, pars) and the rhythm.

**Tech Stack:** Next.js 16.2.4 App Router (page `params`/`searchParams` are Promises), React 19.2.4, TypeScript strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, Supabase (service role), vitest 4 (node env; UI tests render with `react-dom/server`; no jsdom).

**Spec:** `docs/superpowers/specs/2026-10-15-catalog-redesign-design.md` §4 (the item page), §5 jobs 1 and 5, §2 (the door request), §9 (price basis in "Price").

**Working copy:** `C:\Users\conta\co-ops-guides`, on a branch from `origin/main` after 2a has merged:

```bash
git fetch origin && git checkout -b feat/catalog-phase2b-item-page origin/main
ls supabase/migrations | tail -3
```

Expected: `0260_sku_pack_versions_finalize.sql` is the last file. **If 0261 is taken, use the next free number and rename every `0261` literal in this plan's files and tests first.**

**Standing rules for every task:**
- Read `AGENTS.md` first; its "Shop versions" section came with 2a.
- Use the sim only (port 3100).
- Every new string ships en + es, in tú Spanish.
- Every control is at least 44px and paired with `items-center`.
- Use the token roles. Disclosure state is `useState` only.
- Do not apply 0261 outside Task 14.
- Every commit ends with the two trailer lines shown.
- The 2a pins must stay green: `npx vitest run tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts`.

**Step-up (Phase 1, with its migration 0257):** every write on the item page asks for **Tier E**, the 15-minute catalog edit window on its own clock. **No act here takes Phase 1's one-shot grant.** Saving, Restore, back to default and price changes are all reversible (2a keeps every version and price row). Phase 1's "destructive" covers retire product, delete recipe and deactivate SKU, so none of these acts falls under it. The door's request is a report and changes nothing, so it takes no step-up. The previews are reads, so they take no step-up either.

---

## Ground truth this plan is built on (verified 2026-10-15 against `main` @ 98340c95, plus 2a r2 and Phase 1 as planned)

| Fact | Where |
|---|---|
| 2a provides: `loadSkuPackResolution(skuIds, scope, asOf?)`, `loadCurrentSkuPriceHeads/Prices(skuIds, scope)` and `loadRecipeGraph({ locationId, versionLocationId, asOf })`. It also provides `loadPackAwareOverlay(sb, locationId, skuIds)` (D3-stamped overlay + chains), `catalogShopAllowed` (level ≥ 8 or a membership), `versionWriteGate` / `SHOP_VERSION_WRITE_MIN` / `GLOBAL_VERSION_WRITE_MIN` / `FIRST_GLOBAL_WRITE_MIN`, and the gated writers `preparePackVersionWrite / rpcLevels / saveSkuPackVersion / restoreSkuPackVersion / retireShopPackVersion / saveSkuPrice / retireShopPriceLane / loadSkuPackVersionHistory` with `SkuVersionError` + `versionErrorFromRpc`. 0259 provides `save_sku_pack_version(p_sku, p_location, p_levels, p_expected_live, p_based_on, p_note, p_actor, p_first_only)`, which returns `{version_id, retired_version_id, …}` and takes the SKU row lock first. Finally, 2a provides the Tier E routes under `/api/admin/catalog/sku/[id]/…`, and the legacy global writers already enforce the boundary (`global_requires_moo`, en + es). | 2a plan, Tasks 2, 3, 5, 6, 9, 10, 11, 12 |
| `perOrderUnitOz` (order-unit oz = chain root, else the flat pack) lives in the server module `lib/ordering.ts:225-238`, and `orderUnitLabelFor` at `:241-247`. `costPerOzFromGraph` lives in the server module `lib/admin/menu-costing.ts:81-90`. All three are pure. | listed |
| A recipe graph's `skuPack` is consulted at flatten time (`buildRecipeGraph` only indexes outputs), so a hypothetical graph is `{ ...graph, skuPack: copy.set(sku, newPack) }`. | `lib/prep-consumption-graph.ts:501-532` |
| `ozForRecipeInput` returns null for a unit that is neither a chain label (chained), a legacy pack label (unchained), nor a registered measure. That is exactly "a recipe line in a pack unit that would no longer resolve". | `lib/recipe-math.ts:128-168` |
| `rollupMenuItemCost(graph, menuItemId, costPerOz)` gives `{ status, cost }`. `cost` is non-null only when fully costed. | `lib/menu-costing-shared.ts:498-520` |
| `skuDataReadiness(input)` is the pure readiness errands (`no_price`, `price_stale`, `no_countable_chain`, `raw_pack_contents_missing`, `weight_estimate`, `no_par`, `no_rhythm`, `no_vendor`, `no_order_unit`, `recipe_unresolved`), with existing en/es keys `admin.skus.data.errand.<code>`. | `lib/sku-data-readiness.ts:12-62`; `components/admin/skus/SkuDataLane.tsx:48` |
| Pars are stored in ORDER UNITS, in three lanes: human ?? auto ?? global (`resolveParSlot`). A shop's human par is `location_sku_settings.{weekday,weekend}_par` (`id`, `updated_by`, `updated_at`; unique `(location_id, sku_id)`). The global par is `vendor_items.{weekday,weekend}_par`. `parWriteColumns({ kind: "admin" })` is the ONE decider of what a human par write does to the machine lane and pin. Par writes are GM+ (7) and audit `vendor_item.update`. | `lib/location-sku-shared.ts:64-102`; `0174_vendor_ordering.sql:24-38`; `lib/dynamic-pars-shared.ts:1053-1091`; `lib/admin/skus.ts:1101-1290` |
| `PackChainWizard` is a stepwise first-time builder with no prefill. The raw `ChainEditor` lives in `SkuBuilder`. Both emit `StarterChainLevel[]` (index-linked). | `components/admin/skus/PackChainWizard.tsx`; `lib/admin/catalog-shared.ts:193-198` |
| `po_lines (id, po_id → purchase_orders, sku_id, order_qty, order_unit_label)`: ONE FK to `purchase_orders`, so a service-role `purchase_orders!inner(...)` embed is unambiguous. Receivable PO statuses are `draft/confirmed/placed/invoiced` (`received`/`reconciled` are closed). | `0174_vendor_ordering.sql:90-100`; `lib/receiving.ts:1166-1180`; AGENTS.md (service-role embeds) |
| `selectAllRows(build, pageSize)` pages until a short page. | `lib/supabase-paginate.ts` |
| Notifications: `enqueueNotification(service, { type, priority, titleKey, bodyKey, …, recipients })`. The type vocabulary is `NOTIFICATION_TYPES`. The dashboard card is a mark-read button with no link. | `lib/notifications.ts:78-310`; `components/dashboard/NotificationList.tsx:263-300` |
| The door line row (`IntakeLineRow`) has `line.skuId`, `line.level` and `locationId`, and an expanded block with a note and `PhotoCapture`. Door writes are KH+ (`RECEIVE_MIN = 4`) and use `assertSameOrigin`. | `components/receiving/IntakeLineRow.tsx:110-528`; `lib/receiving.ts:70`; `app/api/operations/receiving/scan/teach/route.ts` |
| `sku_barcodes (sku_id, code, level case/inner, taught_at, forgotten_at)`. `vendor_delivery_rhythm (vendor_id, location_id, order_dow, active)`. `vendors.order_days`. | `0206_sku_barcodes.sql:6-18`; `0182:37-55` |
| Shop context: the one resolver is `resolveShopId(allowed, explicit)`, and per-route query params are declared in `SHOP_PARAMS_BY_PATH`/`SHOP_PARAMS_BY_PREFIX`. | `lib/shop-context.ts:30`; `lib/shop-context-shared.ts:79-101` |
| Phase 1: `skuCatalogHref(id)` → `/admin/skus?sku=<id>#<id>`. The vendor-import "needs a person" link uses it, pinned in `tests/catalog-deep-links.test.ts`. | Phase 1 plan Tasks 11–13 |
| `/admin/skus` mounts `SkuCostPanel` (legacy "Record price", global) and `SkuDataDrawer` inside each row's `SummaryRow`. | `components/admin/skus/SkuCatalogClient.tsx:597-605` |
| Error-code → message mapping for the SKU screens is `KNOWN_ERROR_CODES` → `admin.skus.error.<code>`. 2a added `global_requires_moo` and `version_changed` (en + es). | `components/admin/skus/shared.ts:30-71`; 2a Task 10 |
| `formatWeekday(yyyymmdd, language)` and `formatDateLabel` are the language-aware helpers. Inline `toLocale*` is forbidden. | `lib/i18n/format.ts:138, 215`; AGENTS.md i18n |
| A client component keeps its `useState` across a same-route navigation unless its `key` changes, so a `?location=` switch would carry shop A's draft and preview into shop B. | React 19 reconciliation; AGENTS.md ("`router.refresh()` does NOT reset client `useState`") |

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/order-unit-shared.ts` | create | Pure `perOrderUnitOz`, `orderUnitLabel` (moved out of `lib/ordering.ts`, imported AND re-exported there). |
| `lib/menu-costing-shared.ts`, `lib/admin/menu-costing.ts` | modify | `costPerOzFromGraph` moves to the shared module (re-exported). |
| `lib/catalog/change-preview-shared.ts` | create | Pure, target-bound "What this changes": `previewPackChange`, `previewPriceChange`, `convertParQuantity`, `previewToken`. |
| `lib/catalog/pack-sentence-shared.ts` | create | Pure sentence model: `sentenceFromLevels`, `levelsFromSentence`, `leafUnitChoices`. |
| `lib/catalog/sku-item-shared.ts` | create | View-model types, `skuItemHref`, `readJobParam`, `fixItSection`, `versionLabelKind`, `PRICE_BASES`, the dow helper, `parseLevels`, `parseTarget`, `parseConversions`. |
| `lib/catalog/request-guard-shared.ts` | create | `createRequestGuard`: a response from a superseded request (another shop, another draft) is dropped. |
| `lib/pack-change-requests-shared.ts` | create | Pure door proposal parser and `proposalToSentence`. |
| `supabase/migrations/0261_sku_pack_change_requests.sql` | create | The door's request table (deny-all, service-role ceiling), `sku_pack_change_snapshot` (the dependency snapshot) and `apply_sku_pack_change` (atomic pack + pars + request, snapshot re-checked under the SKU lock, the opt-in shop par). |
| `lib/pack-change-requests.ts` | create | File (KH+, bound), list, dismiss (bound to its SKU). Notify the shop's GM. |
| `lib/catalog/sku-item.ts` | create | `loadSkuItemView`, `computePackPreview`, `computePricePreview`, `applyPackChange`, `applyPriceChange`, `setSkuPriceBasis`. |
| `app/api/admin/catalog/sku/[id]/preview/route.ts` | create | POST: a pack or price preview for a target (read; no step-up). |
| `app/api/admin/catalog/sku/[id]/pack/apply/route.ts` | create | POST: the atomic pack + par + door-report save (Tier E). |
| `app/api/admin/catalog/sku/[id]/price/apply/route.ts` | create | POST: a previewed price save (Tier E). |
| `app/api/admin/catalog/sku/[id]/price-basis/route.ts` | create | POST: the plain-words price basis (Tier E). |
| `app/api/admin/catalog/sku/[id]/pack-requests/[requestId]/dismiss/route.ts` | create | POST: "Nothing changed" (Tier E), bound to the SKU in the path. |
| `app/api/operations/receiving/pack-change/route.ts` | create | POST: "This case looks different" (KH+, same-origin). |
| `lib/notifications.ts`, `lib/audit-actions.ts` | modify | New notification type and audit names. |
| `lib/shop-context-shared.ts` | modify | The item page's `?location=` param. |
| `lib/i18n/en.json`, `lib/i18n/es.json` | modify | Every new string. |
| `components/catalog/PackSentenceEditor.tsx` | create | The always-sentence pack editor. |
| `components/catalog/ChangePreviewPanel.tsx` | create | The per-shop preview, the par rows, the conversion choices, and the save button for THE previewed target. |
| `components/catalog/SkuItemClient.tsx` | create | The page body: header, switcher, strip, sections, jobs, history. Remounted per SKU + shop. |
| `components/receiving/CaseLooksDifferent.tsx` | create | The door's report sheet. |
| `app/admin/catalog/sku/[id]/page.tsx` | create | The server page; keys the client by SKU + scope. |
| `components/receiving/IntakeLineRow.tsx` | modify | Mounts the door button. |
| `components/admin/skus/SkuCostPanel.tsx`, `components/admin/skus/SkuCatalogClient.tsx`, `app/admin/skus/page.tsx`, `lib/vendor-import.ts`, `components/admin/vendors/VendorImportPanel.tsx` | modify | Links into the item page; the door requests list. |
| `tests/order-unit-shared.test.ts`, `tests/change-preview-shared.test.ts`, `tests/pack-sentence-shared.test.ts`, `tests/sku-item-shared.test.ts`, `tests/pack-change-requests.test.ts`, `tests/pack-change-requests-migration.test.ts`, `tests/catalog-item-server.test.ts`, `tests/catalog-item-routes.test.ts`, `tests/catalog-item-i18n.test.ts`, `tests/catalog-editor-ui.test.ts`, `tests/catalog-item-ui.test.ts`, `tests/catalog-item-navigation.test.ts`, `tests/case-looks-different.test.ts`, `tests/catalog-legacy-pointers.test.ts`, `tests/catalog-item-links.test.ts` | create | Pure, migration, permission, UI, navigation and source pins. |
| `tests/step-up-tier-map.test.ts`, `tests/location-bind-differential.test.ts`, `tests/catalog-deep-links.test.ts` | modify | Register the new routes, client, RPC and writer, and the moved link. |

---

## Task 1: Move the three pure helpers into client-safe modules (no behaviour change)

**Files:**
- Create: `lib/order-unit-shared.ts`
- Modify: `lib/ordering.ts`, `lib/menu-costing-shared.ts`, `lib/admin/menu-costing.ts`
- Test: `tests/order-unit-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 2b — the order-unit helpers and costPerOzFromGraph are pure and importable from shared modules. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderUnitLabel, perOrderUnitOz } from "@/lib/order-unit-shared";
import { perOrderUnitOz as viaOrdering } from "@/lib/ordering";
import { costPerOzFromGraph } from "@/lib/menu-costing-shared";
import { buildRecipeGraph } from "@/lib/prep-consumption-graph";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";

const measures = new Map<string, MeasureUnitFactor>([["oz", { dimension: "weight", toBaseFactor: 1 }], ["lb", { dimension: "weight", toBaseFactor: 16 }]]);
const turkey: RecipeInputSku = {
  packFormat: "case", eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null,
  packChain: [
    { id: "c", label: "case", containsQty: 4, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "b", label: "bag", containsQty: 5, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
  ],
};

describe("order-unit-shared", () => {
  it("chain root is the order unit; its oz walks the chain", () => {
    expect(perOrderUnitOz(turkey, turkey.packChain ?? null, measures)).toBe(320);
    expect(orderUnitLabel("ignored", turkey.packChain ?? null)).toBe("case");
  });
  it("lib/ordering re-exports the same function AND imports it locally (a re-export binds nothing locally)", () => {
    expect(viaOrdering).toBe(perOrderUnitOz);
    const src = readFileSync("lib/ordering.ts", "utf8");
    expect(src).toContain('import { orderUnitLabel as orderUnitLabelFor, perOrderUnitOz } from "@/lib/order-unit-shared";');
    expect(src).toContain("export { perOrderUnitOz };");
  });
  it("unchained: the flat pack", () => {
    const flat: RecipeInputSku = { packFormat: "tub", eachContainerLabel: null, unitsPerPack: 1, eachSize: 30, eachMeasure: "lb", avgOzPerEach: null };
    expect(perOrderUnitOz(flat, null, measures)).toBe(480);
    expect(orderUnitLabel("tub", null)).toBe("tub");
  });
  it("costPerOzFromGraph prices every graph SKU: price ÷ content oz", () => {
    const graph = buildRecipeGraph([], new Map([["t", turkey]]), measures);
    expect(costPerOzFromGraph(graph, new Map([["t", 128]])).get("t")).toBeCloseTo(0.4, 12);
  });
});
```

Run: `npx vitest run tests/order-unit-shared.test.ts` → FAIL (`Failed to resolve import "@/lib/order-unit-shared"`).

- [ ] **Step 2: Create `lib/order-unit-shared.ts`** (the bodies are byte-identical to `lib/ordering.ts:225-247`)

```ts
/**
 * The ORDER UNIT of a SKU — PURE, client-safe (catalog Phase 2b moved these out of lib/ordering.ts
 * so the item page's preview can import them; lib/ordering.ts re-exports perOrderUnitOz, so the
 * walker and the nightly pars engine keep ONE spelling of the denominator).
 *
 * The order unit is the chain ROOT (chained) else pack_format; its oz is ozForRecipeInput(1, root)
 * for a chained SKU and the pack content for an unchained one. Pars are stored in these units.
 */
import { buildPackChain, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";
import { ozForRecipeInput, skuContentOz, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";

export function perOrderUnitOz(
  sku: RecipeInputSku,
  chain: PackChainLevel[] | null,
  measures: Map<string, MeasureUnitFactor>,
): number | null {
  const hasChain = chain != null && chain.length > 0;
  if (hasChain) {
    const root = chainRootLabel(buildPackChain(chain));
    if (root == null) return null; // no unique root → can't name the order unit → advisory-null.
    return ozForRecipeInput(1, root, sku, measures);
  }
  // Unchained: the order unit is one pack_format pack; its oz is the pack content.
  return skuContentOz(sku, measures);
}

/** The order-unit label = chain root label (chained) else pack_format else null. */
export function orderUnitLabel(packFormat: string | null, chain: PackChainLevel[] | null): string | null {
  if (chain != null && chain.length > 0) {
    const root = chainRootLabel(buildPackChain(chain));
    if (root != null) return root;
  }
  return packFormat;
}
```

- [ ] **Step 3: Re-export from `lib/ordering.ts`**

Delete the body of `export function perOrderUnitOz(` (from that line through its closing `}`) and the whole local `orderUnitLabelFor` function (its `/** The order-unit label = chain root label (chained) else pack_format else null. */` comment through its closing `}`). In their place, put:

```ts
import { orderUnitLabel as orderUnitLabelFor, perOrderUnitOz } from "@/lib/order-unit-shared";
// Re-exported so the walker's existing importers keep ONE spelling of the denominator. A re-export
// alone creates NO local binding — the import above is what this file's own calls resolve to.
export { perOrderUnitOz };
```

Every existing `perOrderUnitOz(` and `orderUnitLabelFor(` call in the file keeps working, through the local import.

- [ ] **Step 4: Move `costPerOzFromGraph`**

In `lib/admin/menu-costing.ts`, replace the function `export function costPerOzFromGraph(` … `}` (lines 81–90) with:

```ts
export { costPerOzFromGraph } from "@/lib/menu-costing-shared";
import { costPerOzFromGraph } from "@/lib/menu-costing-shared";
```

At the end of `lib/menu-costing-shared.ts`, append:

```ts
/**
 * Cost of one oz per SKU in a graph = current pack price ÷ chain-aware content oz (moved here from
 * lib/admin/menu-costing.ts in catalog Phase 2b so the pure preview can reuse THE costing formula).
 */
export function costPerOzFromGraph(
  graph: RecipeGraph,
  prices: ReadonlyMap<string, number>,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const [skuId, pack] of graph.skuPack) {
    out.set(skuId, skuCostPerOz(prices.get(skuId) ?? null, skuContentOz(pack, graph.measures)));
  }
  return out;
}
```

and add `skuContentOz, skuCostPerOz` to `lib/menu-costing-shared.ts`'s import from `@/lib/recipe-math` (add the import line if the module does not import from it yet).

- [ ] **Step 5: Lint, typecheck, run**

Run: `npm run lint` and remove **only** the imports it reports unused in `lib/ordering.ts` and `lib/admin/menu-costing.ts`. Then run `npx tsc --noEmit 2>&1 | grep -v leaflet | grep "error TS"` and expect no output. Then run `npx vitest run tests/order-unit-shared.test.ts tests/shop-versions-equivalence.test.ts tests/menu-prices-data.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/order-unit-shared.ts lib/ordering.ts lib/menu-costing-shared.ts lib/admin/menu-costing.ts tests/order-unit-shared.test.ts
git commit -F - <<'EOF'
refactor(catalog): order-unit helpers and costPerOzFromGraph move to client-safe shared modules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 2: "What this changes" — the pure preview, per save target and per affected shop (D4)

**The rule (D4).** A preview is computed for the **actual save target**:
- `{ kind: "shop", shopId }` reaches exactly that shop.
- `{ kind: "global" }` reaches every shop riding the global pack. A shop with its own live version is listed as untouched.

Each affected shop gets its own before → after: order unit, cost per oz, sandwich costs, broken recipe lines and open orders. Then one **par row** per (lane, day-class), with a status that says why a number can or cannot be converted:

| Lane answering the shop's par | Shop-only save | Global save |
|---|---|---|
| human (the shop's own par) | `convertible` — the shop's par converts | `convertible` — that shop's par converts (its pack changes) |
| global (inherited) | `convertible`, **inherited** — the opt-in "give this shop its own par": the shop's own slot is CREATED from the converted value; the global par itself is untouched | one GLOBAL row: `convertible` only if **every** shop whose par DEPENDS on the global value rides the global pack, else `global_par_shared` |
| auto (the machine) | `machine_par` — nothing to convert; D3 retires it once the effective pack changes | `machine_par` for a shop riding the global pack. For a shop with its own pack, its auto value still DEPENDS on the global par (its baseline), so it counts as a dependent of the global row above |

**Dependents, judged after the save (Astra 2b r2#1).** A shop's resolved par depends on the global par value when its lane is `global` or `auto`: an auto value stands only while its baseline equals the global par. So converting the global par would change such a shop's par even if its own case did not change. The global row therefore refuses conversion (`global_par_shared`) whenever any dependent keeps its own pack. A shop listed as **untouched** never has its resolved par changed by the save.

A row can also be `no_weight` (a size with no honest ounce: keep only). Each offered conversion carries its **expected** current value; an inherited one also expects the shop's own slot to be still EMPTY. The save is refused if any of that moved. `previewToken` digests the target, the live version, the levels, the offered conversions and the **dependency snapshot**, so a save must present the preview it was shown. The snapshot is rechecked under the SKU lock (Task 5).

**Files:**
- Create: `lib/catalog/change-preview-shared.ts`
- Test: `tests/change-preview-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Catalog Phase 2b — "What this changes" (spec §4, §5 jobs 1 + 5, §8 "Preview tests"; lead D4): computed
 * for the ACTUAL save target, every affected shop listed with its pack and its par lane, conversion
 * offered only where that shop's effective pack changes and the par lives in the lane being changed.
 */
import { describe, expect, it } from "vitest";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import {
  convertParQuantity, previewPackChange, previewPriceChange, previewToken, type PreviewShopState,
} from "@/lib/catalog/change-preview-shared";

const measures = new Map<string, MeasureUnitFactor>([["oz", { dimension: "weight", toBaseFactor: 1 }], ["lb", { dimension: "weight", toBaseFactor: 16 }]]);
const globalChain: PackChainLevel[] = [
  { id: "c", label: "case", containsQty: 4, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
  { id: "b", label: "bag", containsQty: 80, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
];
const ownChain: PackChainLevel[] = [{ id: "o", label: "case", containsQty: 10, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }];
// It arrives differently now: 4 × 10 lb (the bag is now a "sack").
const newChain: PackChainLevel[] = [
  { id: "n0", label: "case", containsQty: 4, containsLevelId: "n1", containsMeasureUnit: null, displayOrdinal: 0 },
  { id: "n1", label: "sack", containsQty: 10, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
];
const pack = (chain: PackChainLevel[]): RecipeInputSku => ({ packFormat: "case", eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null, packChain: chain });
const recipe = (id: string, menuId: string, inputs: GraphRecipe["inputs"]): GraphRecipe => ({
  recipeId: id, batchYield: 1, inputs,
  outputs: [{ outputItemId: null, outputMenuItemId: menuId, yield: 1, ozPerParUnit: null, parUnitLabel: null }],
});
const line = (quantity: number, unit: string) => ({ quantity, unit, componentSkuId: "t", componentItemId: null, componentProductId: null });
const graphFor = (p: RecipeInputSku) => buildRecipeGraph([
  recipe("r1", "m-oz", [line(4, "oz")]),
  recipe("r2", "m-case", [line(0.0125, "case")]),
  recipe("r3", "m-bag", [line(1, "bag")]),
], new Map([["t", p]]), measures);
const menuItems = [{ id: "m-oz", name: "By ounce", nameEs: null }, { id: "m-case", name: "By case", nameEs: "Por caja" }, { id: "m-bag", name: "By bag", nameEs: null }, { id: "m-none", name: "Unrelated", nameEs: null }];
const recipeLines = [{ recipeId: "r3", recipeName: "Bag sub", quantity: 1, unit: "bag" }, { recipeId: "r1", recipeName: "Oz sub", quantity: 4, unit: "oz" }];

type Lane = "human" | "auto" | "global" | "none";
function shop(id: string, opts: { own?: boolean; weekday: [number | null, Lane]; weekend?: [number | null, Lane]; ownPrice?: boolean; price?: number; globalDate?: string }): PreviewShopState {
  const p = pack(opts.own ? ownChain : globalChain);
  return {
    shopId: id, shopName: id === "A" ? "P Street" : "Cap Hill", basePack: p, ownPackVersion: opts.own === true, ownPriceLane: opts.ownPrice === true,
    priceHeads: {
      global: { value: 128, effectiveDate: opts.globalDate ?? "2026-10-01" },
      lane: opts.ownPrice ? { value: opts.price ?? 128, effectiveDate: "2026-10-01" } : null,
    },
    graph: graphFor(p), prices: new Map([["t", opts.price ?? 128]]),
    slots: [{ slot: "weekday", value: opts.weekday[0], lane: opts.weekday[1] }, { slot: "weekend", value: opts.weekend?.[0] ?? null, lane: opts.weekend?.[1] ?? "none" }],
    openOrders: [{ poId: `po-${id}`, displayCode: `${id}-1`, status: "placed", orderQty: 2, orderUnitLabel: "case", shopId: id, shopName: id }],
  };
}
const base = { skuId: "t", newChain, parStep: null, menuItems, recipeLines, liveVersionId: "gv", basedOnVersionId: null };

describe("a shop-only save (target = that shop)", () => {
  it("reaches only that shop, with its own before → after", () => {
    const p = previewPackChange({ ...base, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "human"] }), shop("B", { weekday: [3, "global"] })] });
    expect(p.changed).toBe(true);
    expect(p.shops.map((s) => s.shopId)).toEqual(["A"]);
    expect(p.unaffected.map((s) => s.shopId)).toEqual(["B"]);
    const a = p.shops[0]!;
    expect(a.orderUnitOz).toEqual({ before: 320, after: 640 });
    expect(a.costPerOz.before).toBeCloseTo(0.4, 12);
    expect(a.costPerOz.after).toBeCloseTo(0.2, 12);
    const byId = Object.fromEntries(a.menuItems.map((m) => [m.id, m]));
    expect(byId["m-oz"]!.after).toBeCloseTo(0.8, 10);
    expect(byId["m-bag"]!.after).toBeNull(); // its unit goes away → it stops costing
    expect(byId["m-none"]).toBeUndefined();
    expect(a.brokenLines.map((l) => l.recipeId)).toEqual(["r3"]);
    expect(a.openOrders.map((o) => o.displayCode)).toEqual(["A-1"]);
  });
  it("the shop's OWN par converts, bound to the value it was computed from", () => {
    const p = previewPackChange({ ...base, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "human"] })] });
    expect(p.pars).toEqual([{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "human", status: "convertible", inherited: false, current: 3, currentOz: 960, keepOz: 1920, convertTo: 2 }]);
    expect(p.conversions).toEqual([{ locationId: "A", slot: "weekday", expected: 3, to: 2 }]);
  });
  it("an INHERITED global par: the opt-in 'give this shop its own par' — the shop's slot is created, the global par untouched (2b r2#3)", () => {
    const p = previewPackChange({ ...base, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "global"] })] });
    expect(p.pars).toEqual([{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "global", status: "convertible", inherited: true, current: 3, currentOz: 960, keepOz: 1920, convertTo: 2 }]);
    expect(p.conversions).toEqual([{ locationId: "A", slot: "weekday", expected: 3, to: 2, inherited: true }]);
  });
  it("a machine par is named, never converted (D3 retires it)", () => {
    const p = previewPackChange({ ...base, target: { kind: "shop", shopId: "A" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [5, "auto"] })] });
    expect(p.pars.map((r) => r.status)).toEqual(["machine_par"]);
    expect(p.conversions).toEqual([]);
  });
});

describe("a save for everyone (target = global)", () => {
  it("every shop riding the global pack is affected; a shop with its own version is untouched", () => {
    const p = previewPackChange({ ...base, target: { kind: "global" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: 4 },
      shops: [shop("A", { weekday: [5, "human"], weekend: [4, "global"] }), shop("B", { own: true, weekday: [3, "global"], weekend: [4, "global"] })] });
    expect(p.shops.map((s) => s.shopId)).toEqual(["A"]);
    expect(p.unaffected).toEqual([{ shopId: "B", shopName: "Cap Hill" }]);
    // A's own weekday par converts; the global weekend par is shared with B (whose case is NOT changing) → not converted.
    expect(p.pars.map((r) => [r.locationId, r.slot, r.status])).toEqual([["A", "weekday", "convertible"], [null, "weekend", "global_par_shared"], [null, "weekday", "global_par_shared"]]);
    expect(p.conversions).toEqual([{ locationId: "A", slot: "weekday", expected: 5, to: 3 }]);
  });
  it("the global par converts when every shop inheriting it rides the global pack", () => {
    const p = previewPackChange({ ...base, target: { kind: "global" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "global"] }), shop("B", { weekday: [3, "global"] })] });
    expect(p.pars).toEqual([{ locationId: null, shops: ["P Street", "Cap Hill"], slot: "weekday", lane: "global", status: "convertible", inherited: false, current: 3, currentOz: 960, keepOz: 1920, convertTo: 2 }]);
    expect(p.conversions).toEqual([{ locationId: null, slot: "weekday", expected: 3, to: 2 }]);
    expect(p.shops.flatMap((s) => s.openOrders.map((o) => o.displayCode))).toEqual(["A-1", "B-1"]);
  });
});

describe("a shop with its OWN pack whose AUTO par rests on the global par (Astra 2b r2#1)", () => {
  it("is a dependent: the global par is NOT converted, and the shop is never 'untouched' with a changed par", () => {
    // A inherits the global 3; B keeps its own case but its auto par 5 stands only while the global par is 3.
    const p = previewPackChange({ ...base, target: { kind: "global" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "global"] }), shop("B", { own: true, weekday: [5, "auto"] })] });
    expect(p.unaffected).toEqual([{ shopId: "B", shopName: "Cap Hill" }]);
    expect(p.pars.map((r) => [r.locationId, r.slot, r.status, r.shops])).toEqual([[null, "weekday", "global_par_shared", ["P Street", "Cap Hill"]]]);
    expect(p.conversions).toEqual([]); // so B's resolved par (5) cannot change: its label "untouched" stays true
  });
});

describe("nothing changes", () => {
  it("an identical chain changes nothing and asks nothing", () => {
    const p = previewPackChange({ ...base, newChain: globalChain, target: { kind: "global" }, targetBasePack: pack(globalChain), globalPars: { weekday: 3, weekend: null },
      shops: [shop("A", { weekday: [3, "global"] })] });
    expect(p.changed).toBe(false);
    expect(p.shops).toEqual([]);
    expect(p.pars).toEqual([]);
    expect(p.conversions).toEqual([]);
  });
});

describe("previewPriceChange — per target", () => {
  it("a global price reaches every shop without its own price; a shop price reaches that shop", () => {
    const shops = [shop("A", { weekday: [3, "global"] }), shop("B", { weekday: [3, "global"], ownPrice: true, price: 150 })];
    const g = previewPriceChange({ skuId: "t", target: { kind: "global" }, shops, newPrice: 160, effectiveDate: "2026-10-16", menuItems });
    expect(g.shops.map((s) => s.shopId)).toEqual(["A"]);
    expect(g.unaffected.map((s) => s.shopId)).toEqual(["B"]);
    expect(g.shops[0]!.price).toEqual({ before: 128, after: 160 });
    expect(g.shops[0]!.costPerOz.after).toBeCloseTo(0.5, 12);
    expect(g.shops[0]!.menuItems.find((m) => m.id === "m-oz")!.after).toBeCloseTo(2, 10);
    const s = previewPriceChange({ skuId: "t", target: { kind: "shop", shopId: "B" }, shops, newPrice: 160, effectiveDate: "2026-10-16", menuItems });
    expect(s.shops.map((x) => [x.shopId, x.price.before])).toEqual([["B", 150]]);
  });
  it("the EFFECTIVE DATE decides (Astra 2b r3#2): a price dated before the current one changes nothing today", () => {
    // The current global price is $100, dated Oct 15. A save of $80 dated Oct 14 is history, not today's price.
    const shops = [{ ...shop("A", { weekday: [3, "global"], globalDate: "2026-10-15" }), prices: new Map([["t", 100]]) }];
    shops[0]!.priceHeads = { global: { value: 100, effectiveDate: "2026-10-15" }, lane: null };
    const back = previewPriceChange({ skuId: "t", target: { kind: "global" }, shops, newPrice: 80, effectiveDate: "2026-10-14", menuItems });
    expect(back.shops[0]).toMatchObject({ becomesCurrent: false, price: { before: 100, after: 100 } });
    expect(back.shops[0]!.menuItems.every((m) => m.before === m.after)).toBe(true);
    const same = previewPriceChange({ skuId: "t", target: { kind: "global" }, shops, newPrice: 80, effectiveDate: "2026-10-15", menuItems });
    expect(same.shops[0]).toMatchObject({ becomesCurrent: true, price: { before: 100, after: 80 } }); // same date: the newer row wins
  });
  it("a shop's FIRST own price opens its lane, so even a back-dated one becomes that shop's current price", () => {
    const shops = [shop("A", { weekday: [3, "global"], globalDate: "2026-10-15" })];
    const p = previewPriceChange({ skuId: "t", target: { kind: "shop", shopId: "A" }, shops, newPrice: 80, effectiveDate: "2026-10-14", menuItems });
    expect(p.shops[0]).toMatchObject({ becomesCurrent: true, price: { after: 80 } });
  });
});

describe("previewToken — a save must present the preview it was shown", () => {
  it("changes when the target, the live version, the levels or an offered conversion changes", () => {
    const a = previewToken({ target: { kind: "global" }, liveVersionId: "gv", levels: [1], conversions: [{ locationId: null, slot: "weekday", expected: 3, to: 2 }] });
    expect(previewToken({ target: { kind: "global" }, liveVersionId: "gv", levels: [1], conversions: [{ locationId: null, slot: "weekday", expected: 3, to: 2 }] })).toBe(a);
    expect(previewToken({ target: { kind: "shop", shopId: "A" }, liveVersionId: "gv", levels: [1], conversions: [{ locationId: null, slot: "weekday", expected: 3, to: 2 }] })).not.toBe(a);
    expect(previewToken({ target: { kind: "global" }, liveVersionId: "gv", levels: [1], conversions: [{ locationId: null, slot: "weekday", expected: 4, to: 2 }] })).not.toBe(a);
    expect(previewToken({ kind: "price", newPrice: 80, effectiveDate: "2026-10-14" })).not.toBe(previewToken({ kind: "price", newPrice: 80, effectiveDate: "2026-10-15" }));
  });
});

describe("convertParQuantity", () => {
  it("rounds to the par step (default 1 for a whole par, 0.5 for a half) and never below one step", () => {
    expect(convertParQuantity(3, 320, 640, null)).toBe(2);
    expect(convertParQuantity(1.5, 320, 640, null)).toBe(1);
    expect(convertParQuantity(1, 320, 6400, null)).toBe(1);
    expect(convertParQuantity(4, 320, 640, 0.25)).toBe(2);
    expect(convertParQuantity(0, 320, 640, null)).toBe(0);
    expect(convertParQuantity(3, null, 640, null)).toBeNull();
  });
});
```

The row order is pinned. The per-shop rows come first, in each shop's slot order (weekday, then weekend). The global-lane rows follow, because the pure function walks the global lane weekend → weekday. The panel renders `pars` in exactly this order.

Run: `npx vitest run tests/change-preview-shared.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `lib/catalog/change-preview-shared.ts`**

```ts
/**
 * "WHAT THIS CHANGES" — the preview every pack or price save shows first (catalog Phase 2b; spec
 * §4 "What this changes", §5 jobs 1 + 5; lead decision D4). PURE: the server hands in one state per
 * shop (its effective pack, graph, prices, D3-stamped par lanes, open orders); this works out the
 * knock-ons FOR THE ACTUAL SAVE TARGET:
 *   · { kind: "shop", shopId } — exactly that shop;
 *   · { kind: "global" }       — every shop riding the global pack (a shop with its own live version
 *                                 is listed as untouched).
 *
 * It never decides for the human. Where a par stored in order units would change meaning, it says
 * so per lane and offers a conversion ONLY where that shop's effective pack changes AND the par lives
 * in the lane being changed. Every offered conversion carries the value it was computed from
 * (`expected`); the save refuses if that value moved (apply_sku_pack_change, 0261).
 */
import { perUnitSkuOzForMenuItemFromGraph, type RecipeGraph } from "@/lib/prep-consumption-graph";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { orderUnitLabel, perOrderUnitOz } from "@/lib/order-unit-shared";
import { ozForRecipeInput, skuContentOz, skuCostPerOz, type RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { ParLane } from "@/lib/location-sku-shared";

export type PreviewTarget = { kind: "shop"; shopId: string } | { kind: "global" };
export type ParSlotName = "weekday" | "weekend";

export interface PreviewMenuItem { id: string; name: string; nameEs: string | null }
export interface PreviewRecipeLine { recipeId: string; recipeName: string; quantity: number; unit: string | null }
export interface PreviewOpenOrder { poId: string; displayCode: string; status: string; orderQty: number; orderUnitLabel: string | null; shopId: string; shopName: string }
export interface MenuItemDelta { id: string; name: string; nameEs: string | null; before: number | null; after: number | null }

/** One shop as it stands today, for one SKU (the server fills this through the 2a resolvers). */
export interface PreviewShopState {
  shopId: string;
  shopName: string;
  /** The pack this shop effectively receives NOW: its own live version, else the global one. */
  basePack: RecipeInputSku;
  /** This shop has its OWN live pack version — a global save does not reach it. */
  ownPackVersion: boolean;
  /** This shop has its OWN live price lane — a global price does not reach it. */
  ownPriceLane: boolean;
  /**
   * The newest row of each price sequence a save could append to (resolveCurrentPrices' order:
   * effective_date desc, then recorded_at desc): the GLOBAL head, and this shop's live LANE head.
   */
  priceHeads: { global: PriceHead | null; lane: PriceHead | null };
  /** This shop's graph (its pack versions) and its current prices. */
  graph: RecipeGraph;
  prices: ReadonlyMap<string, number>;
  /** Each day-class's par here and the lane that answers it (from the D3-stamped overlay). */
  slots: ReadonlyArray<{ slot: ParSlotName; value: number | null; lane: ParLane }>;
  openOrders: readonly PreviewOpenOrder[];
}

export type ParRowStatus = "convertible" | "global_par_shared" | "machine_par" | "no_weight";

export interface PreviewParRow {
  /** null = the GLOBAL par lane (vendor_items); a shop id = that shop's own par (location_sku_settings). */
  locationId: string | null;
  /** The shops this number governs (a global row: every shop inheriting it). */
  shops: string[];
  slot: ParSlotName;
  lane: ParLane;
  status: ParRowStatus;
  /**
   * true = the opt-in "give this shop its own par" (2b r2#3): the shop inherits the global par today;
   * converting CREATES the shop's own slot from the converted value and leaves the global par alone.
   */
  inherited: boolean;
  current: number;
  currentOz: number | null;
  keepOz: number | null;
  convertTo: number | null;
}

/**
 * A conversion the preview OFFERS, bound to the value it was computed from. `inherited` = create the
 * shop's own par slot (which must still be EMPTY) from the inherited global value `expected`.
 */
export interface ParConversion { locationId: string | null; slot: ParSlotName; expected: number; to: number; inherited?: true }

export interface PackShopDelta {
  shopId: string;
  shopName: string;
  orderUnit: { before: string | null; after: string | null };
  orderUnitOz: { before: number | null; after: number | null };
  costPerOz: { before: number | null; after: number | null };
  menuItems: MenuItemDelta[];
  brokenLines: PreviewRecipeLine[];
  openOrders: PreviewOpenOrder[];
}

export interface PackPreview {
  kind: "pack";
  target: PreviewTarget;
  changed: boolean;
  /** The live version of the TARGET scope the preview was computed against (the save's expected_live). */
  liveVersionId: string | null;
  /** A shop's FIRST own version is based on the global one it replaces. */
  basedOnVersionId: string | null;
  shops: PackShopDelta[];
  unaffected: Array<{ shopId: string; shopName: string }>;
  pars: PreviewParRow[];
  conversions: ParConversion[];
  /**
   * The dependency snapshot (0261 sku_pack_change_snapshot), taken BEFORE the preview was computed:
   * each reached shop's own live version, pack epoch and par lanes, the global version and pars, the
   * active shops. apply_sku_pack_change recomputes it UNDER THE SKU LOCK and refuses any difference.
   */
  snapshot: unknown;
  /** previewToken(…) — set by the server; a save must present it. */
  token: string;
}

/** The current head of a price sequence: its value and its effective date (YYYY-MM-DD). */
export interface PriceHead { value: number; effectiveDate: string }

export interface PriceShopDelta {
  shopId: string;
  shopName: string;
  /** Will the saved row be this shop's CURRENT price? (false = a back-dated row: history only) */
  becomesCurrent: boolean;
  price: { before: number | null; after: number | null };
  costPerOz: { before: number | null; after: number | null };
  menuItems: MenuItemDelta[];
}

export interface PricePreview {
  kind: "price";
  target: PreviewTarget;
  newPrice: number;
  /** The date the price takes effect — part of the preview, its token, and the save. */
  effectiveDate: string;
  shops: PriceShopDelta[];
  unaffected: Array<{ shopId: string; shopName: string }>;
  token: string;
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

/**
 * The par, re-expressed in the new order unit, rounded to the par step (par_step, else 1 for a
 * whole par and 0.5 for a fractional one), never below one step for a par above zero. Null when
 * either unit has no honest ounce — then only "keep" is possible.
 */
export function convertParQuantity(par: number, beforeOz: number | null, afterOz: number | null, parStep: number | null): number | null {
  if (beforeOz == null || afterOz == null || !(afterOz > 0) || !(beforeOz > 0)) return null;
  if (par === 0) return 0;
  const step = parStep != null && parStep > 0 ? parStep : Number.isInteger(par) ? 1 : 0.5;
  const raw = (par * beforeOz) / afterOz;
  return round4(Math.max(step, Math.round(raw / step) * step));
}

/**
 * A short, deterministic digest (FNV-1a, 32-bit, hex) of what a preview showed. Not a security
 * boundary — the server recomputes the preview and compares digests, so a save made against a
 * different target, live version, chain or set of offered conversions is refused as stale.
 */
export function previewToken(parts: unknown): string {
  const s = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function sameChain(a: readonly PackChainLevel[], b: readonly PackChainLevel[]): boolean {
  const sig = (c: readonly PackChainLevel[]) => {
    const byId = new Map(c.map((l) => [l.id, l]));
    return c.map((l) => `${l.label.trim()}|${l.containsQty}|${l.containsLevelId ? byId.get(l.containsLevelId)?.label.trim() ?? "?" : `=${l.containsMeasureUnit ?? ""}`}`).sort().join(";");
  };
  return sig(a) === sig(b);
}

const chainOf = (p: RecipeInputSku): PackChainLevel[] | null => (p.packChain && p.packChain.length > 0 ? p.packChain : null);

function menuDeltas(
  skuId: string,
  before: RecipeGraph,
  after: RecipeGraph,
  costBefore: Map<string, number | null>,
  costAfter: Map<string, number | null>,
  menuItems: readonly PreviewMenuItem[],
): MenuItemDelta[] {
  const out: MenuItemDelta[] = [];
  for (const m of menuItems) {
    const ozBefore = perUnitSkuOzForMenuItemFromGraph(before, m.id);
    const ozAfter = perUnitSkuOzForMenuItemFromGraph(after, m.id);
    const touched = ozBefore.has(skuId) || ozAfter.has(skuId) || (ozBefore.size > 0 && ozAfter.size === 0);
    if (!touched) continue;
    out.push({
      id: m.id, name: m.name, nameEs: m.nameEs,
      before: rollupMenuItemCost(before, m.id, costBefore).cost,
      after: rollupMenuItemCost(after, m.id, costAfter).cost,
    });
  }
  return out;
}

function withPack(graph: RecipeGraph, skuId: string, p: RecipeInputSku): RecipeGraph {
  return { ...graph, skuPack: new Map(graph.skuPack).set(skuId, p) };
}

function shopPackDelta(
  skuId: string,
  s: PreviewShopState,
  newChain: PackChainLevel[],
  menuItems: readonly PreviewMenuItem[],
  recipeLines: readonly PreviewRecipeLine[],
): PackShopDelta {
  const m = s.graph.measures;
  const newPack: RecipeInputSku = { ...s.basePack, packChain: newChain };
  const price = s.prices.get(skuId) ?? null;
  const before = s.graph.skuPack.has(skuId) ? s.graph : withPack(s.graph, skuId, s.basePack);
  const after = withPack(s.graph, skuId, newPack);
  return {
    shopId: s.shopId,
    shopName: s.shopName,
    orderUnit: { before: orderUnitLabel(s.basePack.packFormat, chainOf(s.basePack)), after: orderUnitLabel(s.basePack.packFormat, newChain) },
    orderUnitOz: { before: perOrderUnitOz(s.basePack, chainOf(s.basePack), m), after: perOrderUnitOz(newPack, newChain, m) },
    costPerOz: { before: skuCostPerOz(price, skuContentOz(s.basePack, m)), after: skuCostPerOz(price, skuContentOz(newPack, m)) },
    menuItems: menuDeltas(skuId, before, after, costPerOzFromGraph(before, s.prices), costPerOzFromGraph(after, s.prices), menuItems),
    brokenLines: recipeLines.filter((l) =>
      ozForRecipeInput(l.quantity, l.unit, s.basePack, m) != null && ozForRecipeInput(l.quantity, l.unit, newPack, m) == null),
    openOrders: [...s.openOrders],
  };
}

function parRow(
  locationId: string | null, shops: string[], slot: ParSlotName, lane: ParLane, status: ParRowStatus,
  current: number, beforeOz: number | null, afterOz: number | null, convertTo: number | null, inherited = false,
): PreviewParRow {
  return {
    locationId, shops, slot, lane, status, inherited, current,
    currentOz: beforeOz == null ? null : round4(current * beforeOz),
    keepOz: afterOz == null ? null : round4(current * afterOz),
    convertTo: status === "convertible" ? convertTo : null,
  };
}

export function previewPackChange(input: {
  skuId: string;
  target: PreviewTarget;
  /** The pack the TARGET has today (a shop: its effective pack; global: the global pack). */
  targetBasePack: RecipeInputSku;
  newChain: PackChainLevel[];
  /** Every active shop, in display order (the global target needs them all to know who it reaches). */
  shops: readonly PreviewShopState[];
  /** The global par per day-class (vendor_items). */
  globalPars: { weekday: number | null; weekend: number | null };
  parStep: number | null;
  menuItems: readonly PreviewMenuItem[];
  /** Recipe lines that name THIS SKU directly (active recipes). */
  recipeLines: readonly PreviewRecipeLine[];
  liveVersionId: string | null;
  basedOnVersionId: string | null;
}): Omit<PackPreview, "token" | "snapshot"> {
  const target = input.target;
  const affected = target.kind === "shop"
    ? input.shops.filter((s) => s.shopId === target.shopId)
    : input.shops.filter((s) => !s.ownPackVersion);
  const unaffected = input.shops.filter((s) => !affected.includes(s)).map((s) => ({ shopId: s.shopId, shopName: s.shopName }));
  const changed = !sameChain(input.targetBasePack.packChain ?? [], input.newChain);
  const shell = { kind: "pack" as const, target, changed, liveVersionId: input.liveVersionId, basedOnVersionId: input.basedOnVersionId, unaffected };
  if (!changed) return { ...shell, shops: [], pars: [], conversions: [] };

  const deltas = affected.map((s) => shopPackDelta(input.skuId, s, input.newChain, input.menuItems, input.recipeLines));
  const pars: PreviewParRow[] = [];

  // Per affected shop: its own (human) par converts; an inherited global par on a SHOP-only save is
  // the opt-in "give this shop its own par" (the global par is untouched); the machine's par is
  // named (D3 retires it once the pack changes).
  affected.forEach((s, i) => {
    const { before: beforeOz, after: afterOz } = deltas[i]!.orderUnitOz;
    if (beforeOz === afterOz) return;
    for (const sl of s.slots) {
      if (sl.value == null || !(sl.value > 0)) continue;
      if (sl.lane === "global" && target.kind === "global") continue; // the global lane, below
      if (sl.lane === "human") {
        const to = convertParQuantity(sl.value, beforeOz, afterOz, input.parStep);
        pars.push(parRow(s.shopId, [s.shopName], sl.slot, "human", to == null ? "no_weight" : "convertible", sl.value, beforeOz, afterOz, to));
      } else if (sl.lane === "auto") {
        pars.push(parRow(s.shopId, [s.shopName], sl.slot, "auto", "machine_par", sl.value, beforeOz, afterOz, null));
      } else if (sl.lane === "global") {
        const to = convertParQuantity(sl.value, beforeOz, afterOz, input.parStep);
        pars.push(parRow(s.shopId, [s.shopName], sl.slot, "global", to == null ? "no_weight" : "convertible", sl.value, beforeOz, afterOz, to, true));
      }
    }
  });

  // A global save: the global par converts only if EVERY shop whose resolved par DEPENDS on it rides
  // the global pack. A dependent is a shop answered by the global lane, or by an AUTO value — an auto
  // stands only while its baseline equals the global par, so converting the global par would move
  // that shop too (Astra 2b r2#1). A dependent with its own case would get a number re-expressed in
  // a case it never bought, so the global row is then named, never converted.
  if (target.kind === "global") {
    for (const slot of ["weekend", "weekday"] as const) {
      const value = input.globalPars[slot];
      if (value == null || !(value > 0)) continue;
      const inheriting = input.shops.filter((s) => {
        const lane = s.slots.find((x) => x.slot === slot)?.lane;
        return lane === "global" || lane === "auto";
      });
      if (inheriting.length === 0) continue;
      const m = inheriting[0]!.graph.measures;
      const newPack: RecipeInputSku = { ...input.targetBasePack, packChain: input.newChain };
      const beforeOz = perOrderUnitOz(input.targetBasePack, chainOf(input.targetBasePack), m);
      const afterOz = perOrderUnitOz(newPack, input.newChain, m);
      if (beforeOz === afterOz) continue;
      const shared = inheriting.some((s) => s.ownPackVersion);
      const to = shared ? null : convertParQuantity(value, beforeOz, afterOz, input.parStep);
      const status: ParRowStatus = shared ? "global_par_shared" : to == null ? "no_weight" : "convertible";
      pars.push(parRow(null, inheriting.map((s) => s.shopName), slot, "global", status, value, beforeOz, afterOz, to));
    }
  }

  const conversions: ParConversion[] = pars
    .filter((p) => p.status === "convertible" && p.convertTo != null)
    .map((p) => (p.inherited
      ? { locationId: p.locationId, slot: p.slot, expected: p.current, to: p.convertTo!, inherited: true as const }
      : { locationId: p.locationId, slot: p.slot, expected: p.current, to: p.convertTo! }));
  return { ...shell, shops: deltas, pars, conversions };
}

/**
 * THE REAL SELECTION RULE applied to the row a save would append (Astra 2b r3#2): the newest
 * effective date wins, and on a tie the newest recorded row (this one) wins. So the new row becomes
 * current iff there is no head yet, or its date is on or after the head's.
 */
export function priceBecomesCurrent(effectiveDate: string, head: PriceHead | null): boolean {
  return head == null || effectiveDate >= head.effectiveDate;
}

export function previewPriceChange(input: {
  skuId: string;
  target: PreviewTarget;
  shops: readonly PreviewShopState[];
  newPrice: number;
  effectiveDate: string;
  menuItems: readonly PreviewMenuItem[];
}): Omit<PricePreview, "token"> {
  const target = input.target;
  const affected = target.kind === "shop"
    ? input.shops.filter((s) => s.shopId === target.shopId)
    : input.shops.filter((s) => !s.ownPriceLane);
  return {
    kind: "price",
    target,
    newPrice: input.newPrice,
    effectiveDate: input.effectiveDate,
    unaffected: input.shops.filter((s) => !affected.includes(s)).map((s) => ({ shopId: s.shopId, shopName: s.shopName })),
    shops: affected.map((s) => {
      const m = s.graph.measures;
      const graph = s.graph.skuPack.has(input.skuId) ? s.graph : withPack(s.graph, input.skuId, s.basePack);
      const before = s.prices.get(input.skuId) ?? null;
      // The sequence this save appends to: the global one (a global save), or the shop's lane — and a
      // shop with no live lane gets a NEW lane whose only row is this one, so it is current regardless.
      const head = target.kind === "global" ? s.priceHeads.global : s.ownPriceLane ? s.priceHeads.lane : null;
      const becomesCurrent = priceBecomesCurrent(input.effectiveDate, head);
      const after = becomesCurrent ? input.newPrice : before;
      const afterPrices = becomesCurrent ? new Map(s.prices).set(input.skuId, input.newPrice) : new Map(s.prices);
      const content = skuContentOz(s.basePack, m);
      return {
        shopId: s.shopId,
        shopName: s.shopName,
        becomesCurrent,
        price: { before, after },
        costPerOz: { before: skuCostPerOz(before, content), after: skuCostPerOz(after, content) },
        menuItems: menuDeltas(input.skuId, graph, graph, costPerOzFromGraph(graph, s.prices), costPerOzFromGraph(graph, afterPrices), input.menuItems),
      };
    }),
  };
}
```

- [ ] **Step 3: Run**

Run: `npx vitest run tests/change-preview-shared.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add lib/catalog/change-preview-shared.ts tests/change-preview-shared.test.ts
git commit -F - <<'EOF'
feat(catalog): "What this changes" — the pure preview, per save target and per affected shop (D4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 3: The always-sentence pack model

The sentence reads "1 [case] holds [6] [bag]; each [bag] weighs [5] [lb]". It is a linear chain, root first. `containers[i].qty` is how many of `containers[i]` sit inside `containers[i-1]` (the root's qty is ignored and shown as "1"), and the leaf is "each last container weighs / holds [leafQty] [leafUnit]". Every real chain is linear, because 0159's validation requires all levels on one pointer path. So the sentence can express every valid chain, and a chain that is not linear is reported as `null`.

**Files:**
- Create: `lib/catalog/pack-sentence-shared.ts`
- Test: `tests/pack-sentence-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 2b — the sentence pack model: chain ⇄ "1 case holds 6 bag; each bag weighs 5 lb". */
import { describe, expect, it } from "vitest";
import { leafUnitChoices, levelsFromSentence, sentenceFromLevels, type SentenceDraft } from "@/lib/catalog/pack-sentence-shared";

const chain = [
  { id: "b", label: "bag", containsQty: 5, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
  { id: "c", label: "case", containsQty: 6, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
];
const measureLabels = new Set(["oz", "lb", "each", "gal"]);

describe("sentenceFromLevels", () => {
  it("walks root → leaf by pointer (never by ordinal)", () => {
    expect(sentenceFromLevels(chain)).toEqual({ containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "6" }], leafQty: "5", leafUnit: "lb" });
  });
  it("a one-level chain and an empty chain", () => {
    expect(sentenceFromLevels([{ id: "t", label: "tub", containsQty: 30, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }]))
      .toEqual({ containers: [{ label: "tub", qty: "1" }], leafQty: "30", leafUnit: "lb" });
    expect(sentenceFromLevels([])).toBeNull();
  });
});

describe("levelsFromSentence", () => {
  const ok: SentenceDraft = { containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "4" }], leafQty: "10", leafUnit: "lb" };
  it("builds the index-linked chain the writer takes, root first", () => {
    expect(levelsFromSentence(ok, measureLabels)).toEqual({ ok: true, levels: [
      { label: "case", containsQty: 4, containsIndex: 1, containsMeasureUnit: null },
      { label: "bag", containsQty: 10, containsIndex: null, containsMeasureUnit: "lb" },
    ] });
  });
  it("refuses, by name: empty label, duplicate label, a measure word as a container, a bad number, no unit", () => {
    expect(levelsFromSentence({ ...ok, containers: [{ label: " ", qty: "1" }] }, measureLabels)).toEqual({ ok: false, error: "empty_label", index: 0 });
    expect(levelsFromSentence({ ...ok, containers: [{ label: "case", qty: "1" }, { label: "Case", qty: "2" }] }, measureLabels)).toEqual({ ok: false, error: "duplicate_label", index: 1 });
    expect(levelsFromSentence({ ...ok, containers: [{ label: "lb", qty: "1" }] }, measureLabels)).toEqual({ ok: false, error: "label_is_measure_unit", index: 0 });
    expect(levelsFromSentence({ ...ok, containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "0" }] }, measureLabels)).toEqual({ ok: false, error: "bad_qty", index: 1 });
    expect(levelsFromSentence({ ...ok, leafQty: "x" }, measureLabels)).toEqual({ ok: false, error: "bad_qty", index: 1 });
    expect(levelsFromSentence({ ...ok, leafUnit: "" }, measureLabels)).toEqual({ ok: false, error: "no_leaf_unit", index: 1 });
  });
});

describe("leafUnitChoices", () => {
  const units = [
    { label: "oz", dimension: "weight" as const }, { label: "lb", dimension: "weight" as const },
    { label: "each", dimension: "count" as const }, { label: "gal", dimension: "volume" as const },
  ];
  it("a raw item ends in a weight — unless its current leaf already uses the per-piece weight", () => {
    expect(leafUnitChoices(units, "raw", null)).toEqual(["oz", "lb"]);
    expect(leafUnitChoices(units, "raw", "each")).toEqual(["oz", "lb", "each"]);
  });
  it("supplies may end in any unit", () => {
    expect(leafUnitChoices(units, "packaging", null)).toEqual(["oz", "lb", "each", "gal"]);
  });
});
```

Run: `npx vitest run tests/pack-sentence-shared.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `lib/catalog/pack-sentence-shared.ts`**

```ts
/**
 * THE ALWAYS-SENTENCE PACK MODEL (catalog Phase 2b; spec §4 "The pack editor is always the sentence
 * editor"). PURE, client-safe. A chain is shown and edited as
 *
 *     1 [case] holds [6] [bag]; each [bag] weighs [5] [lb]
 *
 * containers[0] is the root (what you order by); containers[i].qty is how many containers[i] sit
 * inside containers[i-1] (the root's own qty is always "1"); the leaf is what ONE last container
 * weighs or holds. Valid chains are linear (0159: single root, every level on one pointer path), so
 * the sentence expresses every one of them; a non-linear chain reads back as null.
 *
 * The writer still runs the full validation (lib/admin/pack-chain.ts validateSubmission) — this
 * model only refuses what a person can fix in the sentence itself, by name.
 */
import { buildPackChain, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";
import type { StarterChainLevel } from "@/lib/admin/catalog-shared";

export interface SentenceContainer { label: string; qty: string }
export interface SentenceDraft { containers: SentenceContainer[]; leafQty: string; leafUnit: string }
export type SentenceError = "empty_label" | "duplicate_label" | "label_is_measure_unit" | "bad_qty" | "no_leaf_unit";

/** The live chain as a sentence; null for an empty or non-linear chain. */
export function sentenceFromLevels(levels: readonly PackChainLevel[]): SentenceDraft | null {
  if (levels.length === 0) return null;
  const chain = buildPackChain([...levels]);
  const rootLabel = chainRootLabel(chain);
  if (rootLabel == null) return null;
  const containers: SentenceContainer[] = [];
  const seen = new Set<string>();
  let cur: PackChainLevel | undefined = chain.byLabel.get(rootLabel);
  let parentQty = "1";
  while (cur) {
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    containers.push({ label: cur.label, qty: parentQty });
    if (cur.containsLevelId == null) {
      if (seen.size !== levels.length || cur.containsMeasureUnit == null) return null;
      return { containers, leafQty: String(cur.containsQty), leafUnit: cur.containsMeasureUnit };
    }
    parentQty = String(cur.containsQty);
    cur = chain.byId.get(cur.containsLevelId);
  }
  return null;
}

function positive(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The sentence as the index-linked chain the writer takes (root first), or the first problem by name. */
export function levelsFromSentence(
  draft: SentenceDraft,
  measureLabels: ReadonlySet<string>,
): { ok: true; levels: StarterChainLevel[] } | { ok: false; error: SentenceError; index: number } {
  const n = draft.containers.length;
  if (n === 0) return { ok: false, error: "empty_label", index: 0 };
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const label = draft.containers[i]!.label.trim();
    if (!label) return { ok: false, error: "empty_label", index: i };
    if (measureLabels.has(label)) return { ok: false, error: "label_is_measure_unit", index: i };
    const key = label.toLowerCase();
    if (seen.has(key)) return { ok: false, error: "duplicate_label", index: i };
    seen.add(key);
    if (i > 0 && positive(draft.containers[i]!.qty) == null) return { ok: false, error: "bad_qty", index: i };
  }
  const leafQty = positive(draft.leafQty);
  if (leafQty == null) return { ok: false, error: "bad_qty", index: n - 1 };
  if (!draft.leafUnit.trim()) return { ok: false, error: "no_leaf_unit", index: n - 1 };
  const levels: StarterChainLevel[] = draft.containers.map((c, i) => i < n - 1
    ? { label: c.label.trim(), containsQty: positive(draft.containers[i + 1]!.qty)!, containsIndex: i + 1, containsMeasureUnit: null }
    : { label: c.label.trim(), containsQty: leafQty, containsIndex: null, containsMeasureUnit: draft.leafUnit.trim() });
  return { ok: true, levels };
}

/**
 * Which units may end the sentence. A RAW item feeds cost and depletion, so it ends in a WEIGHT
 * ("each bag weighs 5 lb") — the per-piece weight lives in the sentence, never in a hidden avg —
 * except that a chain which ALREADY ends in a count/volume unit keeps that choice (it converts
 * through the item's existing per-piece weight, shown read-only). Supplies may end in any unit.
 */
export function leafUnitChoices(
  units: ReadonlyArray<{ label: string; dimension: "weight" | "volume" | "count" }>,
  skuClass: string,
  currentLeafUnit: string | null,
): string[] {
  if (skuClass !== "raw") return units.map((u) => u.label);
  const weights = units.filter((u) => u.dimension === "weight").map((u) => u.label);
  return currentLeafUnit && !weights.includes(currentLeafUnit) && units.some((u) => u.label === currentLeafUnit)
    ? [...weights, currentLeafUnit]
    : weights;
}
```

- [ ] **Step 3: Run**

Run: `npx vitest run tests/pack-sentence-shared.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add lib/catalog/pack-sentence-shared.ts tests/pack-sentence-shared.test.ts
git commit -F - <<'EOF'
feat(catalog): the always-sentence pack model (chain ⇄ "1 case holds 6 bag; each bag weighs 5 lb")

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 4: The item page's shared surface — view types, deep link, jobs, fix-it routing

**Route decision:** `/admin/catalog/sku/[id]`. Spec §4 asks for one "Catalog" area that replaces the scattered pages, and this is the first page of it. The bought item is one kind of item, so it gets a kind segment; later phases add `/admin/catalog/prep/[id]`, `/recipe/[id]` and `/sandwich/[id]`. It sits under `/admin`, so the admin layout's level-6 floor and `StepUpProvider` apply unchanged. `/admin/skus` stays working: Phase 1's `skuCatalogHref` keeps landing on the list row, and each row gains an "Open item page" link (Task 13). That keeps every existing deep link compatible.

**Files:**
- Create: `lib/catalog/sku-item-shared.ts`
- Modify: `lib/shop-context-shared.ts`
- Test: `tests/sku-item-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 2b — the item page's pure surface. */
import { describe, expect, it } from "vitest";
import { fixItSection, PRICE_BASES, readJobParam, skuItemHref, sundayAnchoredDate, versionLabelKind } from "@/lib/catalog/sku-item-shared";
import { shopParamNames } from "@/lib/shop-context-shared";

const SKU = "7d0c1f2e-0000-4000-8000-000000000001";
const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";

describe("skuItemHref — lands on the item, optionally in a job", () => {
  it("plain, per shop, global, and with a job and a door request", () => {
    expect(skuItemHref(SKU)).toBe(`/admin/catalog/sku/${SKU}`);
    expect(skuItemHref(SKU, { shopId: SHOP })).toBe(`/admin/catalog/sku/${SKU}?location=${SHOP}`);
    expect(skuItemHref(SKU, { shopId: null })).toBe(`/admin/catalog/sku/${SKU}?location=global`);
    expect(skuItemHref(SKU, { shopId: SHOP, job: "pack", requestId: "r1" })).toBe(`/admin/catalog/sku/${SKU}?location=${SHOP}&job=pack&request=r1`);
  });
  it("readJobParam takes only the two jobs", () => {
    expect(readJobParam("pack")).toBe("pack");
    expect(readJobParam("price")).toBe("price");
    expect(readJobParam(["pack"])).toBeNull();
    expect(readJobParam("delete")).toBeNull();
  });
  it("the shop switcher's param is declared for the route (the one shop resolver reads it)", () => {
    expect(shopParamNames(`/admin/catalog/sku/${SKU}`)).toEqual(["location"]);
  });
});

describe("what the page says it is showing", () => {
  it("global view, a shop riding the default, a shop with its own pack and/or price", () => {
    expect(versionLabelKind(null, false, false)).toBe("global");
    expect(versionLabelKind(SHOP, false, false)).toBe("shop_default");
    expect(versionLabelKind(SHOP, true, false)).toBe("shop_own");
    expect(versionLabelKind(SHOP, false, true)).toBe("shop_own");
  });
});

describe("fix-it routing for every readiness errand", () => {
  it("each errand opens the section that fixes it", () => {
    expect(fixItSection("no_price")).toBe("price");
    expect(fixItSection("price_stale")).toBe("price");
    expect(fixItSection("raw_pack_contents_missing")).toBe("arrives");
    expect(fixItSection("no_countable_chain")).toBe("arrives");
    expect(fixItSection("no_order_unit")).toBe("arrives");
    expect(fixItSection("no_par")).toBe("ordering");
    expect(fixItSection("no_rhythm")).toBe("ordering");
    expect(fixItSection("no_vendor")).toBe("ordering");
    expect(fixItSection("weight_estimate")).toBe("arrives");
    expect(fixItSection("recipe_unresolved")).toBe("connections");
  });
});

describe("helpers", () => {
  it("the five price bases, and a Sunday-anchored date per day of week for formatWeekday", () => {
    expect(PRICE_BASES).toEqual(["per_case", "per_each", "per_lb", "per_dozen", "per_bundle"]);
    expect(sundayAnchoredDate(0)).toBe("2026-10-18");
    expect(sundayAnchoredDate(6)).toBe("2026-10-24");
  });
});
```

Run: `npx vitest run tests/sku-item-shared.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `lib/catalog/sku-item-shared.ts`**

```ts
/**
 * The connected ITEM PAGE for a bought item — the client-safe surface (catalog Phase 2b; spec §4).
 * View-model types the server fills (lib/catalog/sku-item.ts) and the client renders
 * (components/catalog/SkuItemClient.tsx), the deep-link builder, the job param, and where each
 * "What's missing" errand sends the fix-it button.
 */
import type { DataErrand, DataErrandCode } from "@/lib/sku-data-readiness";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { PackChangeProposal } from "@/lib/pack-change-requests-shared";

export const PRICE_BASES = ["per_case", "per_each", "per_lb", "per_dozen", "per_bundle"] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

export type ItemJob = "pack" | "price";
export type ItemSection = "arrives" | "price" | "ordering" | "counting" | "barcodes" | "connections" | "history";

/** The page for one bought item; `shopId` null = the global default, undefined = the remembered shop. */
export function skuItemHref(skuId: string, opts: { shopId?: string | null; job?: ItemJob; requestId?: string } = {}): string {
  const q: string[] = [];
  if (opts.shopId !== undefined) q.push(`location=${opts.shopId === null ? "global" : encodeURIComponent(opts.shopId)}`);
  if (opts.job) q.push(`job=${opts.job}`);
  if (opts.requestId) q.push(`request=${encodeURIComponent(opts.requestId)}`);
  return `/admin/catalog/sku/${encodeURIComponent(skuId)}${q.length ? `?${q.join("&")}` : ""}`;
}

export function readJobParam(v: string | string[] | undefined): ItemJob | null {
  return v === "pack" || v === "price" ? v : null;
}

/** What the header says: the global default, a shop riding it, or a shop with its own version. */
export function versionLabelKind(scope: string | null, shopPack: boolean, shopPrice: boolean): "global" | "shop_default" | "shop_own" {
  if (scope === null) return "global";
  return shopPack || shopPrice ? "shop_own" : "shop_default";
}

/** Where each readiness errand's fix-it button goes (spec §4 "What's missing … each with a fix-it button"). */
export function fixItSection(code: DataErrandCode): ItemSection {
  switch (code) {
    case "no_price":
    case "price_stale":
      return "price";
    case "raw_pack_contents_missing":
    case "no_countable_chain":
    case "no_order_unit":
    case "weight_estimate":
      return "arrives";
    case "no_par":
    case "no_rhythm":
    case "no_vendor":
      return "ordering";
    case "recipe_unresolved":
      return "connections";
  }
}

/** A date whose weekday is `dow` (0 = Sunday), for lib/i18n/format.ts formatWeekday. */
export function sundayAnchoredDate(dow: number): string {
  return `2026-10-${String(18 + dow).padStart(2, "0")}`;
}

export interface SkuItemView {
  sku: {
    id: string; name: string; itemNumber: string | null; active: boolean; skuClass: string;
    priceBasis: PriceBasis | null; avgOzPerEach: number | null; packFormat: string | null;
  };
  vendor: { id: string; name: string; active: boolean } | null;
  product: { id: string; name: string; primarySkuId: string | null; primarySkuName: string | null } | null;
  shops: Array<{ id: string; name: string }>;
  scope: string | null;
  scopeName: string | null;
  can: { editShop: boolean; editGlobal: boolean; editPar: boolean; editBasis: boolean };
  pack: {
    levels: PackChainLevel[];
    versionId: string | null;
    isShopVersion: boolean;
    effectiveFrom: string | null;
    globalVersionId: string | null;
    orderUnit: string | null;
    orderUnitOz: number | null;
    descriptor: string | null;
  };
  price: {
    value: number | null; effectiveDate: string | null; isShopLane: boolean;
    globalValue: number | null; costPerOz: number | null;
    history: Array<{ id: string; unitPrice: number; effectiveDate: string; shop: boolean }>;
  };
  ordering: {
    slots: Array<{ slot: "weekday" | "weekend"; value: number | null; lane: "human" | "auto" | "global" | "none" }>;
    orderDays: number[];
    offHere: boolean;
  };
  counting: { unit: string | null };
  barcodes: Array<{ code: string; level: "case" | "inner"; taughtAt: string }>;
  connections: {
    uses: Array<{ id: string; name: string }>;
    menuItems: Array<{ id: string; name: string; nameEs: string | null; cost: number | null }>;
  };
  missing: DataErrand[];
  history: Array<{ id: string; scope: "global" | "shop"; active: boolean; effectiveFrom: string; retiredAt: string | null; who: string | null; labels: string[] }>;
  openRequests: Array<{ id: string; filedBy: string | null; filedAt: string; note: string | null; proposal: PackChangeProposal | null }>;
  measures: Array<{ label: string; dimension: "weight" | "volume" | "count"; toBaseFactor: number }>;
}
```

- [ ] **Step 3: Declare the route's shop param**

In `lib/shop-context-shared.ts`, replace:

```ts
const SHOP_PARAMS_BY_PREFIX: ReadonlyArray<readonly [string, readonly string[]]> = [["/mid-shift/", ["location"]]];
```

with:

```ts
const SHOP_PARAMS_BY_PREFIX: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/mid-shift/", ["location"]],
  // Catalog Phase 2b — the item page's shop switcher (?location=<shop> | global).
  ["/admin/catalog/sku/", ["location"]],
];
```

The test imports `PackChangeProposal` from `@/lib/pack-change-requests-shared`, which Task 5 creates. Create its stub now so this task compiles. Task 5 replaces it with the full module:

```ts
// lib/pack-change-requests-shared.ts (Task 5 replaces this file whole)
export interface PackChangeProposal { innerCount: number | null; eachWeight: number | null; eachUnit: "oz" | "lb" | null }
```

- [ ] **Step 4: Run**

Run: `npx vitest run tests/sku-item-shared.test.ts tests/shop-context.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add lib/catalog/sku-item-shared.ts lib/pack-change-requests-shared.ts lib/shop-context-shared.ts tests/sku-item-shared.test.ts
git commit -F - <<'EOF'
feat(catalog): the item page's shared surface — view model, deep link, jobs, fix-it routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 5: "This case looks different" and the atomic apply — migration 0261 and the request lib

**The minimal record:** one row per report: SKU, shop, optional delivery, an optional note, an optional quick proposal (how many inside, about how much each weighs), an optional photo, a status (`open → applied | dismissed`), and who resolved it with which version. There is at most **one open report per (SKU, shop)**: a second report of the same thing joins the first (the door is told "already reported") instead of spamming the GM. The GM is told through the existing in-app notification, and the report also shows on the item page and in a list on `/admin/skus`.

**The atomic apply (D4, Astra 2b#3, #11, r2#2, r2#3).** `apply_sku_pack_change` is the ONE write behind "Save" in "It arrives differently now". In one transaction, under the SKU row lock:
1. It **re-takes the dependency snapshot** (`sku_pack_change_snapshot`), with every reached shop's overlay row locked too, and refuses `dependencies_changed` if it differs from the one the preview was computed on. The snapshot covers each reached shop's own live version, pack epoch and par lanes, the global version and pars, and the active shops. So a shop that gained its own case between preview and save can never have its par converted.
2. It validates the door report: it must be open, for THIS SKU, and for a shop this save reaches.
3. It saves the version through 2a's `save_sku_pack_version`, which also derives the global flat mirror in this same transaction.
4. It re-checks every par conversion against the value the person was shown, then applies it. An **inherited** conversion ("give this shop its own par") re-checks the inherited global value AND that the shop's own slot is still empty, then creates that slot.
5. It marks the report applied with the version that answered it.

Any mismatch refuses **everything**, the version included. A report is therefore marked applied only by a save that belongs to its SKU and scope, and a conversion can never land on a number the person did not see. "Nothing changed" (dismiss) binds the report to the SKU in its path.

**Files:**
- Create: `supabase/migrations/0261_sku_pack_change_requests.sql`
- Rewrite: `lib/pack-change-requests-shared.ts`
- Create: `lib/pack-change-requests.ts`
- Modify: `lib/notifications.ts`, `lib/audit-actions.ts`, `tests/location-bind-differential.test.ts`
- Test: `tests/pack-change-requests-migration.test.ts`, `tests/pack-change-requests.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/pack-change-requests-migration.test.ts`:

```ts
/** Catalog Phase 2b — 0261 pinned: house header, gate line, deny-all + privilege ceiling, one open report, the atomic apply. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0261_sku_pack_change_requests.sql", "utf8").replace(/\r\n/g, "\n");

describe("0261_sku_pack_change_requests", () => {
  it("header + gate line", () => {
    expect(sql.split("\n")[0]).toBe("-- Migration 0261_sku_pack_change_requests");
    expect(sql).toContain("NOT YET APPLIED — apply via MCP after review");
  });
  it("the record, its status pairing, and one open report per (sku, shop)", () => {
    expect(sql).toContain("create table if not exists public.sku_pack_change_requests");
    expect(sql).toContain("check (status in ('open', 'applied', 'dismissed'))");
    expect(sql).toContain("check ((status = 'open') = (resolved_at is null))");
    expect(sql).toContain("on public.sku_pack_change_requests (sku_id, location_id) where status = 'open';");
  });
  it("deny-all AND a service-role privilege ceiling: revoke all (service_role too), grant exactly, assert both sets", () => {
    expect(sql).toContain("alter table public.sku_pack_change_requests enable row level security;");
    expect(sql).toContain("revoke all on public.sku_pack_change_requests from public, anon, authenticated, service_role;");
    expect(sql).toContain("grant select, insert, update on public.sku_pack_change_requests to service_role;");
    for (const p of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "SELECT", "INSERT", "UPDATE"]) {
      expect(sql).toContain(`has_table_privilege('service_role', 'public.sku_pack_change_requests', '${p}')`);
    }
    expect(sql).toContain("raise exception '0261: unexpected table grant'");
    expect(sql).toContain("raise exception '0261: service_role above its ceiling'");
  });
  it("apply_sku_pack_change: definer, locked search_path, service_role only", () => {
    expect(sql).toContain("create or replace function public.apply_sku_pack_change(");
    expect(sql).toMatch(/apply_sku_pack_change\([\s\S]*?security definer\s+set search_path = pg_catalog, public/);
    expect(sql).toContain("revoke all on function public.apply_sku_pack_change(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean, jsonb, uuid, jsonb) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.apply_sku_pack_change(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean, jsonb, uuid, jsonb) to service_role;");
  });
  it("the SKU lock first, then the dependency snapshot re-taken and compared UNDER the lock (2b r2#2)", () => {
    const body = sql.slice(sql.indexOf("create or replace function public.apply_sku_pack_change("));
    const lock = body.indexOf("from public.vendor_items where id = p_sku for update");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(body.indexOf("public.sku_pack_change_snapshot(p_sku, v_shops) is distinct from p_snapshot"));
    expect(body).toContain("'sku_pack_change:dependencies_changed'");
    expect(sql).toContain("create or replace function public.sku_pack_change_snapshot(p_sku uuid, p_shops uuid[])");
    expect(sql).toContain("revoke all on function public.sku_pack_change_snapshot(uuid, uuid[]) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.sku_pack_change_snapshot(uuid, uuid[]) to service_role;");
  });
  it("an inherited conversion creates the shop's own slot only while it is still EMPTY and the global value is unchanged (2b r2#3)", () => {
    const body = sql.slice(sql.indexOf("create or replace function public.apply_sku_pack_change("));
    expect(body).toContain("if coalesce((v_change->>'inherited')::boolean, false) then");
    expect(body).toContain("insert into public.location_sku_settings (location_id, sku_id, updated_by) values (v_loc, p_sku, p_actor) returning * into v_row;");
  });
  it("the report bound to this SKU and scope, then the version, then each par against its expected value", () => {
    const body = sql.slice(sql.indexOf("create or replace function public.apply_sku_pack_change("));
    const lock = body.indexOf("from public.vendor_items where id = p_sku for update");
    expect(lock).toBeLessThan(body.indexOf("v_req.sku_id <> p_sku"));
    expect(body.indexOf("v_req.sku_id <> p_sku")).toBeLessThan(body.indexOf("public.save_sku_pack_version("));
    expect(body.indexOf("public.save_sku_pack_version(")).toBeLessThan(body.indexOf("is distinct from v_expected"));
    expect(body).toContain("'sku_pack_change:par_changed'");
    expect(body).toContain("'sku_pack_change:request_mismatch'");
    expect(body).toContain("'sku_pack_change:par_lane_mismatch'");
    expect(body).toContain("'sku_pack_change:invalid_patch'");
    expect(body).toContain("resolved_version_id = v_version");
  });
});
```

`tests/pack-change-requests.test.ts`:

```ts
/** Catalog Phase 2b — the door report: parsed strictly, bound to the shop before any I/O, dismiss bound to its SKU. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { parsePackChangeProposal, proposalToSentence } from "@/lib/pack-change-requests-shared";
import { dismissPackChangeRequest, filePackChangeRequest, PackChangeRequestError } from "@/lib/pack-change-requests";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
afterEach(() => { current = null; });

const A = "6f1d2c3e-0000-4000-8000-00000000000a";
const B = "6f1d2c3e-0000-4000-8000-00000000000b";
const actor = (role: RoleCode, level: number, locations: string[]) =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;
async function refused(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof PackChangeRequestError) return { status: e.status, code: e.code }; throw e; }
  throw new Error("expected a refusal");
}

describe("parsePackChangeProposal", () => {
  it("absent is null; numbers within reason; anything else is invalid", () => {
    expect(parsePackChangeProposal(undefined)).toBeNull();
    expect(parsePackChangeProposal({ innerCount: 4, eachWeight: 10, eachUnit: "lb" })).toEqual({ innerCount: 4, eachWeight: 10, eachUnit: "lb" });
    expect(parsePackChangeProposal({ innerCount: null, eachWeight: null, eachUnit: null })).toBeNull();
    expect(parsePackChangeProposal({ innerCount: -1, eachWeight: null, eachUnit: null })).toBe("invalid");
    expect(parsePackChangeProposal({ innerCount: 2, eachWeight: 3, eachUnit: "kg" })).toBe("invalid");
  });
});

describe("proposalToSentence — what the GM sees prefilled", () => {
  it("edits the inner count and the leaf weight of the current sentence", () => {
    expect(proposalToSentence({ innerCount: 4, eachWeight: 10, eachUnit: "lb" },
      { containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "6" }], leafQty: "5", leafUnit: "lb" }))
      .toEqual({ containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "4" }], leafQty: "10", leafUnit: "lb" });
  });
  it("adds an inner level when the current sentence has none, and starts from a case when there is no chain", () => {
    expect(proposalToSentence({ innerCount: 12, eachWeight: null, eachUnit: null }, null))
      .toEqual({ containers: [{ label: "case", qty: "1" }, { label: "inner", qty: "12" }], leafQty: "", leafUnit: "oz" });
  });
});

describe("the bind holds before any I/O", () => {
  it("a key holder at shop A cannot report for shop B; an employee cannot report at all", async () => {
    expect(await refused(filePackChangeRequest(actor("key_holder", 4, [A]), { skuId: "s", locationId: B, deliveryId: null, note: null, proposal: null, photoId: null }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(filePackChangeRequest(actor("employee", 3, [A]), { skuId: "s", locationId: A, deliveryId: null, note: null, proposal: null, photoId: null }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("only an AGM+ dismisses a report", async () => {
    expect(await refused(dismissPackChangeRequest(actor("shift_lead", 5, [A]), { requestId: "r", skuId: "s" }))).toEqual({ status: 403, code: "forbidden" });
  });
});

describe("dismiss is bound to the report's SKU and shop", () => {
  const open = (sku: string, loc: string) => ({ sku_pack_change_requests: [{ id: "r1", sku_id: sku, location_id: loc, status: "open" }] });
  it("a report for another SKU cannot be dismissed through this SKU's page (404)", async () => {
    current = createFakeDb(open("s-other", A));
    expect(await refused(dismissPackChangeRequest(actor("gm", 7, [A]), { requestId: "r1", skuId: "s" }))).toEqual({ status: 404, code: "not_found" });
  });
  it("a GM elsewhere cannot dismiss shop B's report (404)", async () => {
    current = createFakeDb(open("s", B));
    expect(await refused(dismissPackChangeRequest(actor("gm", 7, [A]), { requestId: "r1", skuId: "s" }))).toEqual({ status: 404, code: "not_found" });
  });
  it("an UNASSIGNED MoO passes every bind (D2) — it reaches the write", async () => {
    current = createFakeDb(open("s", B));
    const p = dismissPackChangeRequest(actor("moo", 8, []), { requestId: "r1", skuId: "s" });
    await expect(p).rejects.not.toBeInstanceOf(PackChangeRequestError); // the fake db has no update(); the gates all passed
  });
});
```

Run: `npx vitest run tests/pack-change-requests-migration.test.ts tests/pack-change-requests.test.ts` → FAIL (`ENOENT` / module not found).

- [ ] **Step 2: Create `supabase/migrations/0261_sku_pack_change_requests.sql`**

```sql
-- Migration 0261_sku_pack_change_requests
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review.
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase2b-item-page-jobs.md (Task 5).
-- Spec: docs/superpowers/specs/2026-10-15-catalog-redesign-design.md §2 ("This case looks different",
-- which files a pack change for the GM to approve), §4 ("What this changes"), §5 job 1.
--
-- WHAT.
--   (1) sku_pack_change_requests — one row per "This case looks different" report from the receiving
--       door: the SKU, the shop, optionally the delivery it arrived on, an optional note, an optional
--       quick proposal (how many inside, about how much each weighs — the door does not edit chains),
--       an optional photo, and the outcome. One OPEN report per (SKU, shop): a second crew member
--       reporting the same case joins the first instead of stacking duplicate chores on the GM.
--       WORKING RECORD, NOT A LEDGER: open → applied | dismissed exactly once (guarded). No delete path.
--   (2) apply_sku_pack_change — THE save behind "It arrives differently now" (lead decision D4). One
--       transaction under the SKU row lock: the report must be open, for THIS SKU, for a shop this
--       save reaches → 0259's save_sku_pack_version → each par conversion re-checked against the
--       value the person was SHOWN (refusing EVERYTHING on a mismatch) → the report marked applied
--       with the version that answered it. The par patch for a shop is computed in TypeScript by
--       parWriteColumns({ kind: "admin" }) — THE one decider of what a human par write does to the
--       machine lane and the pin; this function only refuses a key outside the slot being converted.
--       FIRST, under the SKU lock (and with every reached shop's overlay row locked), it re-takes the
--       DEPENDENCY SNAPSHOT (3) and refuses any difference from the one the preview was computed on:
--       a shop that gained its own case, a par lane that moved, a new active shop — "something changed".
--       An INHERITED conversion ("give this shop its own par") creates the shop's slot only while it is
--       still empty and the inherited global value is still the one shown.
--   (3) sku_pack_change_snapshot — the dependency snapshot: the global live version and pars; per
--       reached shop its own live version, pack epoch (0259) and overlay lanes; the active shops.
--       STABLE, read-only, service_role only; the preview takes it, the apply re-takes it.
--
-- RLS: deny-all (RLS on, every PostgREST role revoked, no policies — the 0203/0214 posture) AND the
-- service-role privilege CEILING (the 0257/0259 pattern): revoke all from every role INCLUDING
-- service_role (Supabase's default privileges grant it DELETE and TRUNCATE), grant exactly SELECT,
-- INSERT, UPDATE, then assert both the forbidden and the required set. The only reader/writer is
-- lib/pack-change-requests.ts + lib/catalog/sku-item.ts (service role), which bind the actor to the
-- shop before any I/O; tests/location-bind-differential.test.ts lists the table, the RPC and the files.
--
-- VERIFY AFTER APPLY:
--   select relrowsecurity from pg_class where oid = 'public.sku_pack_change_requests'::regclass;  -- t
--   select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public'
--     and table_name = 'sku_pack_change_requests' order by 1, 2;   -- service_role INSERT / SELECT / UPDATE only (plus the owner)
--   select grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name = 'apply_sku_pack_change' and privilege_type = 'EXECUTE' order by 1;  -- service_role (+ owner)

begin;

-- ── (1) the door's report ───────────────────────────────────────────────────
create table if not exists public.sku_pack_change_requests (
  id                  uuid        primary key default gen_random_uuid(),
  sku_id              uuid        not null references public.vendor_items(id),
  location_id         uuid        not null references public.locations(id),
  delivery_id         uuid        null references public.vendor_deliveries(id),
  note                text        null check (note is null or length(note) <= 500),
  proposal            jsonb       null,
  photo_id            uuid        null references public.photos(id),
  status              text        not null default 'open'
                        check (status in ('open', 'applied', 'dismissed')),
  filed_by            uuid        not null references public.users(id),
  filed_at            timestamptz not null default now(),
  resolved_by         uuid        null references public.users(id),
  resolved_at         timestamptz null,
  resolved_version_id uuid        null references public.sku_pack_versions(id),
  constraint sku_pack_change_requests_resolution_pair check ((status = 'open') = (resolved_at is null))
);

comment on table public.sku_pack_change_requests is
  '"This case looks different" reports from the receiving door (0261). open → applied (a pack version '
  'saved by apply_sku_pack_change, resolved_version_id) | dismissed (nothing changed). One open report '
  'per (sku, shop). Deny-all; service_role SELECT/INSERT/UPDATE only.';

create unique index if not exists sku_pack_change_requests_one_open
  on public.sku_pack_change_requests (sku_id, location_id) where status = 'open';
create index if not exists sku_pack_change_requests_shop_open_ix
  on public.sku_pack_change_requests (location_id, filed_at desc) where status = 'open';

alter table public.sku_pack_change_requests enable row level security;
revoke all on public.sku_pack_change_requests from public, anon, authenticated, service_role;
grant select, insert, update on public.sku_pack_change_requests to service_role;

-- ── (2) the dependency snapshot (taken by the preview, re-taken by the apply under the lock) ──
create or replace function public.sku_pack_change_snapshot(p_sku uuid, p_shops uuid[])
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'global', (select jsonb_build_object(
                 'version_id', (select v.id from public.sku_pack_versions v where v.sku_id = p_sku and v.location_id is null and v.active),
                 'weekday_par', vi.weekday_par, 'weekend_par', vi.weekend_par)
                 from public.vendor_items vi where vi.id = p_sku),
    'shops', coalesce((
      select jsonb_agg(jsonb_build_object(
               'shop_id', sh.id,
               'own_version_id', (select v.id from public.sku_pack_versions v where v.sku_id = p_sku and v.location_id = sh.id and v.active),
               'pack_epoch', coalesce((select e.epoch from public.sku_pack_epochs e where e.sku_id = p_sku and e.location_id = sh.id), 0),
               'overlay', (select jsonb_build_object(
                             'weekday_par', o.weekday_par, 'weekend_par', o.weekend_par,
                             'auto_weekday_par', o.auto_weekday_par, 'auto_weekend_par', o.auto_weekend_par,
                             'auto_weekday_baseline_par', o.auto_weekday_baseline_par, 'auto_weekend_baseline_par', o.auto_weekend_baseline_par,
                             'auto_weekday_pack_epoch', o.auto_weekday_pack_epoch, 'auto_weekend_pack_epoch', o.auto_weekend_pack_epoch)
                             from public.location_sku_settings o where o.location_id = sh.id and o.sku_id = p_sku))
             order by sh.id)
        from unnest(p_shops) as sh(id)), '[]'::jsonb),
    'active_shops', coalesce((select jsonb_agg(l.id order by l.id) from public.locations l where l.active), '[]'::jsonb));
$$;

-- ── (3) the atomic apply ────────────────────────────────────────────────────
create or replace function public.apply_sku_pack_change(
  p_sku           uuid,
  p_location      uuid,
  p_levels        jsonb,
  p_expected_live uuid,
  p_based_on      uuid,
  p_note          text,
  p_actor         uuid,
  p_first_only    boolean,
  p_par_changes   jsonb,
  p_request       uuid,
  p_snapshot      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_req      record;
  v_saved    jsonb;
  v_version  uuid;
  v_change   jsonb;
  v_slot     text;
  v_loc      uuid;
  v_expected numeric;
  v_to       numeric;
  v_patch    jsonb;
  v_current  numeric;
  v_row      public.location_sku_settings%rowtype;
  v_new      public.location_sku_settings%rowtype;
  v_n        integer;
  v_applied  integer := 0;
  v_shops    uuid[];
  v_has_row  boolean;
begin
  -- THE SKU LOCK FIRST — the order every catalog writer takes (0259). save_sku_pack_version re-takes
  -- it in this same transaction (a no-op re-lock), so nothing below interleaves with another writer.
  perform 1 from public.vendor_items where id = p_sku for update;
  if not found then
    raise exception 'sku_pack_change:sku_not_found' using errcode = 'P0001';
  end if;

  -- THE DEPENDENCY SNAPSHOT, re-taken UNDER the lock (Astra 2b r2#2). Every other pack writer takes
  -- the SKU lock first, so no version, lane epoch or global par of this SKU can move from here to the
  -- commit; the reached shops' overlay rows are locked too. Anything that moved since the preview
  -- (a shop's own case, a par lane, a new shop) refuses the whole save: "something changed".
  if p_snapshot is null or jsonb_typeof(p_snapshot -> 'shops') <> 'array' then
    raise exception 'sku_pack_change:invalid_payload' using errcode = 'P0001';
  end if;
  v_shops := array(select (x ->> 'shop_id')::uuid from jsonb_array_elements(p_snapshot -> 'shops') x);
  perform 1 from public.location_sku_settings where sku_id = p_sku and location_id = any (v_shops) order by id for update;
  if public.sku_pack_change_snapshot(p_sku, v_shops) is distinct from p_snapshot then
    raise exception 'sku_pack_change:dependencies_changed' using errcode = 'P0001';
  end if;

  -- The door report this save answers: OPEN, for THIS SKU, for a shop this save reaches.
  if p_request is not null then
    select id, sku_id, location_id, status into v_req
      from public.sku_pack_change_requests where id = p_request for update;
    if not found then
      raise exception 'sku_pack_change:request_mismatch' using errcode = 'P0001';
    end if;
    if v_req.status <> 'open' then
      raise exception 'sku_pack_change:request_not_open' using errcode = 'P0001';
    end if;
    if v_req.sku_id <> p_sku then
      raise exception 'sku_pack_change:request_mismatch' using errcode = 'P0001';
    end if;
    if p_location is not null and v_req.location_id <> p_location then
      raise exception 'sku_pack_change:request_mismatch' using errcode = 'P0001';
    end if;
    if p_location is null and exists (select 1 from public.sku_pack_versions
                                        where sku_id = p_sku and location_id = v_req.location_id and active) then
      -- A global save does not reach a shop with its own case, so it cannot answer that shop's report.
      raise exception 'sku_pack_change:request_mismatch' using errcode = 'P0001';
    end if;
  end if;

  -- THE VERSION — 0259's writer: expected_live, first-only below MoO, validation, close + open.
  v_saved := public.save_sku_pack_version(p_sku, p_location, p_levels, p_expected_live, p_based_on, p_note, p_actor, p_first_only);
  v_version := (v_saved->>'version_id')::uuid;

  -- THE PARS, each bound to the value the person was shown. ANY mismatch refuses EVERYTHING (the
  -- version above included): a conversion computed from a number that has since moved is a guess.
  for v_change in select value from jsonb_array_elements(coalesce(p_par_changes, '[]'::jsonb)) loop
    v_slot := v_change->>'slot';
    if v_slot is null or v_slot not in ('weekday', 'weekend') then
      raise exception 'sku_pack_change:invalid_payload' using errcode = 'P0001';
    end if;
    v_loc := (v_change->>'location_id')::uuid;
    v_expected := (v_change->>'expected')::numeric;
    v_to := (v_change->>'to')::numeric;
    if v_expected is null or v_to is null or v_to < 0 then
      raise exception 'sku_pack_change:invalid_payload' using errcode = 'P0001';
    end if;

    if v_loc is null then
      -- The GLOBAL par: only a global save converts it.
      if p_location is not null then
        raise exception 'sku_pack_change:par_lane_mismatch' using errcode = 'P0001';
      end if;
      execute format('select %I from public.vendor_items where id = $1', v_slot || '_par') into v_current using p_sku;
      if v_current is distinct from v_expected then
        raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
      end if;
      execute format('update public.vendor_items set %I = $1 where id = $2', v_slot || '_par') using v_to, p_sku;
      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
      end if;
    else
      -- A SHOP's own par: only where this save changes THAT shop's effective pack.
      if p_location is not null and v_loc <> p_location then
        raise exception 'sku_pack_change:par_lane_mismatch' using errcode = 'P0001';
      end if;
      if p_location is null and exists (select 1 from public.sku_pack_versions
                                          where sku_id = p_sku and location_id = v_loc and active) then
        raise exception 'sku_pack_change:par_lane_mismatch' using errcode = 'P0001';
      end if;
      v_patch := v_change->'patch';
      if v_patch is null or jsonb_typeof(v_patch) <> 'object'
         or (v_patch->>(v_slot || '_par'))::numeric is distinct from v_to
         or exists (select 1 from jsonb_object_keys(v_patch) as k(key)
                     where k.key not in (v_slot || '_par', 'auto_' || v_slot || '_par', 'auto_' || v_slot || '_baseline_par',
                                         'auto_' || v_slot || '_applied_at', 'pinned_' || v_slot || '_at')) then
        raise exception 'sku_pack_change:invalid_patch' using errcode = 'P0001';
      end if;
      select * into v_row from public.location_sku_settings where location_id = v_loc and sku_id = p_sku for update;
      v_has_row := found;
      if coalesce((v_change->>'inherited')::boolean, false) then
        -- "GIVE THIS SHOP ITS OWN PAR" (2b r2#3): only a shop-only save, only while the shop still
        -- inherits the value it was shown, and only into a slot that is still EMPTY. The global par
        -- itself is never touched.
        if p_location is null or v_loc <> p_location then
          raise exception 'sku_pack_change:par_lane_mismatch' using errcode = 'P0001';
        end if;
        execute format('select %I from public.vendor_items where id = $1', v_slot || '_par') into v_current using p_sku;
        if v_current is distinct from v_expected then
          raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
        end if;
        if v_has_row and (to_jsonb(v_row)->>(v_slot || '_par')) is not null then
          raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
        end if;
        if not v_has_row then
          insert into public.location_sku_settings (location_id, sku_id, updated_by) values (v_loc, p_sku, p_actor) returning * into v_row;
        end if;
      else
        if not v_has_row then
          raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
        end if;
        v_current := (to_jsonb(v_row)->>(v_slot || '_par'))::numeric;
        if v_current is distinct from v_expected then
          raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
        end if;
      end if;
      v_new := jsonb_populate_record(v_row, v_patch);
      update public.location_sku_settings
         set weekday_par = v_new.weekday_par, weekend_par = v_new.weekend_par,
             auto_weekday_par = v_new.auto_weekday_par, auto_weekend_par = v_new.auto_weekend_par,
             auto_weekday_baseline_par = v_new.auto_weekday_baseline_par, auto_weekend_baseline_par = v_new.auto_weekend_baseline_par,
             auto_weekday_applied_at = v_new.auto_weekday_applied_at, auto_weekend_applied_at = v_new.auto_weekend_applied_at,
             pinned_weekday_at = v_new.pinned_weekday_at, pinned_weekend_at = v_new.pinned_weekend_at,
             updated_by = p_actor, updated_at = now()
       where id = v_row.id;
      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
      end if;
    end if;
    v_applied := v_applied + 1;
  end loop;

  -- THE REPORT, closed by the version that answered it.
  if p_request is not null then
    update public.sku_pack_change_requests
       set status = 'applied', resolved_by = p_actor, resolved_at = now(), resolved_version_id = v_version
     where id = p_request and status = 'open';
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'sku_pack_change:request_not_open' using errcode = 'P0001';
    end if;
  end if;

  return v_saved || jsonb_build_object('pars_converted', v_applied, 'request_applied', p_request is not null);
end;
$$;

revoke all on function public.apply_sku_pack_change(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean, jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_sku_pack_change(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean, jsonb, uuid, jsonb) to service_role;
revoke all on function public.sku_pack_change_snapshot(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.sku_pack_change_snapshot(uuid, uuid[]) to service_role;

-- ── (4) the guards ──────────────────────────────────────────────────────────
do $$ begin
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'sku_pack_change_requests'
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0261: unexpected table grant';
  end if;
  if has_table_privilege('service_role', 'public.sku_pack_change_requests', 'DELETE')
     or has_table_privilege('service_role', 'public.sku_pack_change_requests', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.sku_pack_change_requests', 'REFERENCES')
     or has_table_privilege('service_role', 'public.sku_pack_change_requests', 'TRIGGER') then
    raise exception '0261: service_role above its ceiling';
  end if;
  if not (has_table_privilege('service_role', 'public.sku_pack_change_requests', 'SELECT')
          and has_table_privilege('service_role', 'public.sku_pack_change_requests', 'INSERT')
          and has_table_privilege('service_role', 'public.sku_pack_change_requests', 'UPDATE')) then
    raise exception '0261: service_role is missing a privilege the lib needs';
  end if;
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public' and routine_name in ('apply_sku_pack_change', 'sku_pack_change_snapshot')
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0261: unexpected execute grant';
  end if;
end $$;

commit;
```

- [ ] **Step 3: Rewrite `lib/pack-change-requests-shared.ts`**

```ts
/**
 * "This case looks different" — the client-safe half (catalog Phase 2b, 0261). The door sends a
 * note and, optionally, two numbers it can see; the GM's sentence editor opens prefilled from them.
 */
import type { SentenceDraft } from "@/lib/catalog/pack-sentence-shared";

export interface PackChangeProposal { innerCount: number | null; eachWeight: number | null; eachUnit: "oz" | "lb" | null }

/** Reporting is a key-holder act at the door (receiving's own floor, RECEIVE_MIN). */
export const PACK_REQUEST_FILE_MIN = 4;
/** Resolving (apply or "nothing changed") is the shop's version writer: AGM+. */
export const PACK_REQUEST_RESOLVE_MIN = 6;
export const PACK_REQUEST_NOTE_MAX = 500;

/** null = no proposal (absent, or every field empty); "invalid" = refuse the request. */
export function parsePackChangeProposal(raw: unknown): PackChangeProposal | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, max: number): number | null | "invalid" => {
    if (v === null || v === undefined) return null;
    return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : "invalid";
  };
  const innerCount = num(r.innerCount, 1000);
  const eachWeight = num(r.eachWeight, 10000);
  const eachUnit = r.eachUnit === null || r.eachUnit === undefined ? null : r.eachUnit === "oz" || r.eachUnit === "lb" ? r.eachUnit : "invalid";
  if (innerCount === "invalid" || eachWeight === "invalid" || eachUnit === "invalid") return "invalid";
  if ((eachWeight === null) !== (eachUnit === null)) return "invalid";
  if (innerCount === null && eachWeight === null) return null;
  return { innerCount, eachWeight, eachUnit };
}

/** Prefill the GM's sentence from the door's numbers, on top of the current sentence. */
export function proposalToSentence(p: PackChangeProposal, current: SentenceDraft | null): SentenceDraft {
  const base: SentenceDraft = current
    ? { containers: current.containers.map((c) => ({ ...c })), leafQty: current.leafQty, leafUnit: current.leafUnit }
    : { containers: [{ label: "case", qty: "1" }], leafQty: "", leafUnit: "oz" };
  if (p.innerCount != null) {
    if (base.containers.length >= 2) base.containers[1] = { ...base.containers[1]!, qty: String(p.innerCount) };
    else base.containers.push({ label: "inner", qty: String(p.innerCount) });
  }
  if (p.eachWeight != null && p.eachUnit != null) {
    base.leafQty = String(p.eachWeight);
    base.leafUnit = p.eachUnit;
  }
  return base;
}
```

- [ ] **Step 4: Register the notification type and the audit names**

In `lib/notifications.ts`, inside `NOTIFICATION_TYPES` after `  SHIFT_FEEDBACK: "shift_feedback",`, add:

```ts
  // Catalog Phase 2b (0261): a crew member reported "This case looks different" at the door.
  PACK_CHANGE_REQUEST: "pack_change_request",
```

In `lib/audit-actions.ts`, inside `NON_DESTRUCTIVE_ACTIONS` directly after `  "sku.barcode.taught",`, add:

```ts
  // Catalog Phase 2b (0261): a door report and its closing are REQUESTS — the pack change itself is
  // audited as sku.pack_version_save (destructive) when the GM applies it.
  "sku.pack_change_request.file",
  "sku.pack_change_request.resolve",
```

- [ ] **Step 5: Create `lib/pack-change-requests.ts`**

```ts
/**
 * "This case looks different" — file, list, dismiss (catalog Phase 2b, 0261). SERVER-ONLY, service
 * role. THE LIB BINDS (spec §2; lead D2): filing requires KH+ at that shop; dismissing requires AGM+
 * at the report's shop — a membership, or MoO+ for any active shop (catalogShopAllowed) — and the
 * report must belong to the SKU whose page asked. Both decided before any write (requireLocation).
 * APPLYING a report is NOT here: apply_sku_pack_change (0261) closes it in the same transaction as
 * the pack version that answers it, so a save of another SKU or scope can never close it.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { enqueueNotification, NOTIFICATION_TYPES } from "@/lib/notifications";
import type { AuthContext } from "@/lib/session";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import {
  PACK_REQUEST_FILE_MIN, PACK_REQUEST_NOTE_MAX, PACK_REQUEST_RESOLVE_MIN, type PackChangeProposal,
} from "@/lib/pack-change-requests-shared";

export class PackChangeRequestError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "PackChangeRequestError";
  }
}

/** THE BIND (a BIND_PRIMITIVES name): the floor, then the shop (a membership, or MoO+ — D2). */
function requireLocation(actor: AuthContext, locationId: string, min: number): void {
  if (actor.level < min) throw new PackChangeRequestError(403, "forbidden");
  if (!catalogShopAllowed(actor, locationId)) throw new PackChangeRequestError(404, "not_found");
}

export interface FilePackChangeInput {
  skuId: string;
  locationId: string;
  deliveryId: string | null;
  note: string | null;
  proposal: PackChangeProposal | null;
  photoId: string | null;
}

/** File a report (or join the open one). Notifies the shop's GM(s); if the shop has none, MoO and the owner. */
export async function filePackChangeRequest(actor: AuthContext, input: FilePackChangeInput): Promise<{ id: string; already: boolean }> {
  requireLocation(actor, input.locationId, PACK_REQUEST_FILE_MIN);
  const note = input.note?.trim() ? input.note.trim().slice(0, PACK_REQUEST_NOTE_MAX) : null;
  const sb = getServiceRoleClient();
  const { data: sku, error: sErr } = await sb.from("vendor_items").select("id, name, location_id")
    .eq("id", input.skuId).eq("active", true).maybeSingle<{ id: string; name: string; location_id: string | null }>();
  if (sErr) throw new Error(`filePackChangeRequest sku: ${sErr.message}`);
  if (!sku || (sku.location_id !== null && sku.location_id !== input.locationId)) throw new PackChangeRequestError(404, "sku_not_found");

  const { data: inserted, error } = await sb.from("sku_pack_change_requests").insert({
    sku_id: input.skuId, location_id: input.locationId, delivery_id: input.deliveryId,
    note, proposal: input.proposal, photo_id: input.photoId, filed_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (error) {
    if (error.code === "23505") {
      const { data: open, error: oErr } = await sb.from("sku_pack_change_requests").select("id")
        .eq("sku_id", input.skuId).eq("location_id", input.locationId).eq("status", "open").maybeSingle<{ id: string }>();
      if (oErr) throw new Error(`filePackChangeRequest open: ${oErr.message}`);
      if (open) return { id: open.id, already: true };
    }
    throw new Error(`filePackChangeRequest insert: ${error.message}`);
  }
  if (!inserted) throw new Error("filePackChangeRequest returned no row");

  const [{ data: shop }, recipients, { data: me }] = await Promise.all([
    sb.from("locations").select("name").eq("id", input.locationId).maybeSingle<{ name: string }>(),
    shopManagers(sb, input.locationId),
    sb.from("users").select("name").eq("id", actor.user.id).maybeSingle<{ name: string | null }>(),
  ]);
  if (recipients.length > 0) {
    await enqueueNotification(sb, {
      type: NOTIFICATION_TYPES.PACK_CHANGE_REQUEST,
      priority: "info",
      titleKey: "notif.pack_change_request.title",
      titleParams: { item: sku.name, shop: shop?.name ?? "" },
      bodyKey: "notif.pack_change_request.body",
      bodyParams: { who: me?.name ?? "" },
      extraData: { skuId: input.skuId, requestId: inserted.id },
      relatedTable: "sku_pack_change_requests",
      relatedId: inserted.id,
      locationId: input.locationId,
      createdBy: actor.user.id,
      recipients: recipients.map((userId) => ({ userId })),
    });
  }
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.pack_change_request.file", resourceTable: "sku_pack_change_requests", resourceId: inserted.id,
    metadata: { sku_id: input.skuId, location_id: input.locationId, delivery_id: input.deliveryId, has_proposal: input.proposal != null, notified: recipients.length },
    ipAddress: null, userAgent: null,
  });
  return { id: inserted.id, already: false };
}

/** Active GMs assigned to the shop; none → active MoO and owner (org-wide). */
async function shopManagers(sb: ReturnType<typeof getServiceRoleClient>, locationId: string): Promise<string[]> {
  const { data: links, error } = await sb.from("user_locations").select("user_id").eq("location_id", locationId).eq("active", true)
    .returns<Array<{ user_id: string }>>();
  if (error) throw new Error(`shopManagers links: ${error.message}`);
  const ids = [...new Set((links ?? []).map((l) => l.user_id))];
  if (ids.length > 0) {
    const { data: gms, error: gErr } = await sb.from("users").select("id").in("id", ids).eq("role", "gm").eq("active", true)
      .returns<Array<{ id: string }>>();
    if (gErr) throw new Error(`shopManagers gms: ${gErr.message}`);
    if ((gms ?? []).length > 0) return (gms ?? []).map((g) => g.id);
  }
  const { data: org, error: oErr } = await sb.from("users").select("id").in("role", ["moo", "owner"]).eq("active", true)
    .returns<Array<{ id: string }>>();
  if (oErr) throw new Error(`shopManagers org: ${oErr.message}`);
  return (org ?? []).map((u) => u.id);
}

export interface OpenPackRequest {
  id: string; skuId: string; skuName: string; locationId: string;
  filedBy: string | null; filedAt: string; note: string | null; proposal: PackChangeProposal | null;
}

/** Open reports for the shops the actor may resolve in (AGM+; MoO+ every shop), newest first; optionally one SKU. */
export async function loadOpenPackChangeRequests(actor: AuthContext, opts: { locationIds: string[]; skuId?: string }): Promise<OpenPackRequest[]> {
  if (actor.level < PACK_REQUEST_RESOLVE_MIN) return [];
  const allowed = opts.locationIds.filter((id) => catalogShopAllowed(actor, id));
  if (allowed.length === 0) return [];
  const sb = getServiceRoleClient();
  let q = sb.from("sku_pack_change_requests").select("id, sku_id, location_id, filed_by, filed_at, note, proposal")
    .eq("status", "open").in("location_id", allowed);
  if (opts.skuId) q = q.eq("sku_id", opts.skuId);
  const { data, error } = await q.order("filed_at", { ascending: false }).limit(200)
    .returns<Array<{ id: string; sku_id: string; location_id: string; filed_by: string; filed_at: string; note: string | null; proposal: PackChangeProposal | null }>>();
  if (error) throw new Error(`loadOpenPackChangeRequests: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const [{ data: skus, error: sErr }, { data: users, error: uErr }] = await Promise.all([
    sb.from("vendor_items").select("id, name").in("id", [...new Set(rows.map((r) => r.sku_id))]).returns<Array<{ id: string; name: string }>>(),
    sb.from("users").select("id, name").in("id", [...new Set(rows.map((r) => r.filed_by))]).returns<Array<{ id: string; name: string | null }>>(),
  ]);
  if (sErr) throw new Error(`loadOpenPackChangeRequests skus: ${sErr.message}`);
  if (uErr) throw new Error(`loadOpenPackChangeRequests users: ${uErr.message}`);
  const skuName = new Map((skus ?? []).map((s) => [s.id, s.name]));
  const userName = new Map((users ?? []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id, skuId: r.sku_id, skuName: skuName.get(r.sku_id) ?? "(sku)", locationId: r.location_id,
    filedBy: userName.get(r.filed_by) ?? null, filedAt: r.filed_at, note: r.note, proposal: r.proposal,
  }));
}

/**
 * "Nothing changed": close an OPEN report as dismissed. Bound twice before the write: the report
 * must belong to `skuId` (the page that asked — a report for another item is not found here), and
 * the actor must be AGM+ for the report's shop. Guarded: open → dismissed exactly once.
 */
export async function dismissPackChangeRequest(actor: AuthContext, input: { requestId: string; skuId: string }): Promise<void> {
  if (actor.level < PACK_REQUEST_RESOLVE_MIN) throw new PackChangeRequestError(403, "forbidden");
  const sb = getServiceRoleClient();
  const { data: req, error } = await sb.from("sku_pack_change_requests").select("id, sku_id, location_id, status")
    .eq("id", input.requestId).maybeSingle<{ id: string; sku_id: string; location_id: string; status: string }>();
  if (error) throw new Error(`dismissPackChangeRequest read: ${error.message}`);
  if (!req || req.sku_id !== input.skuId) throw new PackChangeRequestError(404, "not_found");
  requireLocation(actor, req.location_id, PACK_REQUEST_RESOLVE_MIN);
  if (req.status !== "open") throw new PackChangeRequestError(409, "already_resolved");
  const { error: uErr, count } = await sb.from("sku_pack_change_requests")
    .update({ status: "dismissed", resolved_by: actor.user.id, resolved_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", input.requestId).eq("sku_id", input.skuId).eq("status", "open");
  if (uErr) throw new Error(`dismissPackChangeRequest update: ${uErr.message}`);
  if (count === 0) throw new PackChangeRequestError(409, "already_resolved");
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.pack_change_request.resolve", resourceTable: "sku_pack_change_requests", resourceId: input.requestId,
    metadata: { sku_id: req.sku_id, location_id: req.location_id, outcome: "dismissed", version_id: null },
    ipAddress: null, userAgent: null,
  });
}
```

- [ ] **Step 6: Register with the differential bind check**

In `tests/location-bind-differential.test.ts`:
- Add `"sku_pack_change_requests",` to `TENANCY_SCOPED_TABLES`, under the 0259 block, with the comment `// 0261 — a door report belongs to one shop.`
- Add `"apply_sku_pack_change",` to `TENANCY_SCOPED_RPCS`, with the comment `// 0261 — lib/catalog/sku-item.ts binds before calling it.`
- Add `"lib/pack-change-requests.ts",` to `FILES`.

- [ ] **Step 7: Run**

Run: `npx vitest run tests/pack-change-requests-migration.test.ts tests/pack-change-requests.test.ts tests/location-bind-differential.test.ts tests/audit-actions.test.ts`
Expected: PASS, 0 failed. (`lib/catalog/sku-item.ts`, the RPC's caller, joins `FILES` in Task 6. If the differential test insists that every listed RPC has a caller among `FILES` already, add the RPC line in Task 6 Step 4 instead.)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0261_sku_pack_change_requests.sql lib/pack-change-requests-shared.ts lib/pack-change-requests.ts lib/notifications.ts lib/audit-actions.ts tests/pack-change-requests-migration.test.ts tests/pack-change-requests.test.ts tests/location-bind-differential.test.ts
git commit -F - <<'EOF'
feat(catalog): 0261 — door reports (deny-all, service-role ceiling) and the atomic pack+par+report apply (NOT APPLIED)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 6: The server half — the page view, the previews, the atomic apply, price basis (`lib/catalog/sku-item.ts`)

Everything the page shows comes from **the 2a resolvers**:
- `loadSkuPackResolution`;
- `loadCurrentSkuPriceHeads/Prices`;
- `loadRecipeGraph` per shop;
- `loadPackAwareOverlay` (the D3-stamped par lanes).

This module never resolves a version itself.

**Reads** follow the house read rule: the shop must be the actor's, or the actor is level 8+ (`canReadReportLocation`). A **global-target preview** shows every shop's numbers, so it is open to MoO+, and below MoO only while no global value exists yet (the first-value case; the same rule the writers apply).

**Writes:**
- The pack save is `applyPackChange`. It runs the 2a gate (`preparePackVersionWrite`) and the par-conversion permissions (GM+; each converted shop allowed by `catalogShopAllowed`) before any write. It then **recomputes the preview for the posted target and requires the posted token and conversions to match** (`409 preview_stale`), and makes ONE call to `apply_sku_pack_change`.
- The price save is `applyPriceChange`, the same idea over 2a's `saveSkuPrice`.

**Sourcing per shop (brief item 4): no new model.** The page reads:
- which SKU the shop buys (`product_primaries` at the shop, else global);
- whether it is off here (`location_sku_settings.active_override`);
- the pars (with their lane) and the order days at that shop.

Changing them stays on today's surfaces in Phase 2 (`/admin/products`, `/admin/skus`); the Pars page is Phase 5.

**Files:**
- Create: `lib/catalog/sku-item.ts`
- Modify: `lib/catalog/sku-item-shared.ts` (adds `parseLevels`, `parseTarget`, `parseConversions`, `itemClientKey`), `lib/catalog/change-preview-shared.ts` (adds `conversionKey`), `tests/location-bind-differential.test.ts`
- Test: `tests/catalog-item-server.test.ts`

- [ ] **Step 1: Write the failing test (every gate holds before any write)**

```ts
/** Catalog Phase 2b — the item page's server half refuses before any write; the parsers are strict. */
import { describe, expect, it } from "vitest";
import { applyPackChange, CatalogItemError, computePackPreview, computePricePreview, loadSkuItemView, setSkuPriceBasis } from "@/lib/catalog/sku-item";
import { itemClientKey, parseConversions, parseLevels, parseTarget } from "@/lib/catalog/sku-item-shared";
import { conversionKey } from "@/lib/catalog/change-preview-shared";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

const A = "6f1d2c3e-0000-4000-8000-00000000000a";
const B = "6f1d2c3e-0000-4000-8000-00000000000b";
const actor = (role: RoleCode, level: number, locations: string[]) =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;
async function refused(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof CatalogItemError) return { status: e.status, code: e.code }; throw e; }
  throw new Error("expected a refusal");
}
const LEVELS = [{ label: "case", containsQty: 1, containsIndex: null, containsMeasureUnit: "lb" }];
const apply = (a: AuthContext, over: Partial<Parameters<typeof applyPackChange>[1]> = {}) =>
  applyPackChange(a, { skuId: "s", target: { kind: "shop", shopId: A }, levels: LEVELS, conversions: [], requestId: null, previewToken: "t", ...over });

describe("reads: AGM+, and only a shop you may read (level 8 reads every shop)", () => {
  it("a shift lead cannot open the page; a GM cannot open or preview another shop", async () => {
    expect(await refused(loadSkuItemView(actor("shift_lead", 5, [A]), "s", A, []))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(loadSkuItemView(actor("gm", 7, [A]), "s", B, []))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(computePackPreview(actor("gm", 7, [A]), "s", { kind: "shop", shopId: B }, LEVELS))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(computePricePreview(actor("agm", 6, [A]), "s", { kind: "shop", shopId: B }, 10, "2026-10-15"))).toEqual({ status: 404, code: "not_found" });
  });
  it("an AGM cannot preview a GLOBAL pack change (it would show every shop; the save is MoO+ or a GM's first chain)", async () => {
    expect(await refused(computePackPreview(actor("agm", 6, [A]), "s", { kind: "global" }, LEVELS))).toEqual({ status: 403, code: "global_requires_moo" });
  });
  it("a preview of an empty chain or a bad price is refused by name", async () => {
    expect(await refused(computePackPreview(actor("gm", 7, [A]), "s", { kind: "shop", shopId: A }, []))).toEqual({ status: 400, code: "empty_chain" });
    expect(await refused(computePricePreview(actor("gm", 7, [A]), "s", { kind: "shop", shopId: A }, -1, "2026-10-15"))).toEqual({ status: 400, code: "invalid_price" });
    expect(await refused(computePricePreview(actor("gm", 7, [A]), "s", { kind: "shop", shopId: A }, 10, "Oct 15"))).toEqual({ status: 400, code: "invalid_date" });
  });
});

describe("the atomic apply refuses before any write", () => {
  it("another shop (the 2a gate), an AGM converting a par, a GM converting another shop's par", async () => {
    expect(await refused(apply(actor("gm", 7, [A]), { target: { kind: "shop", shopId: B } }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(apply(actor("agm", 6, [A]), { conversions: [{ locationId: A, slot: "weekday", expected: 3, to: 2 }] }))).toEqual({ status: 403, code: "par_forbidden" });
    expect(await refused(apply(actor("gm", 7, [A]), { conversions: [{ locationId: B, slot: "weekday", expected: 3, to: 2 }] }))).toEqual({ status: 404, code: "not_found" });
  });
  it("an UNASSIGNED MoO passes every gate for shop B (D2) — it fails later only for want of a database", async () => {
    const p = apply(actor("moo", 8, []), { target: { kind: "shop", shopId: B }, conversions: [{ locationId: B, slot: "weekday", expected: 3, to: 2 }] });
    await expect(p).rejects.toThrow();
    await expect(p).rejects.not.toBeInstanceOf(CatalogItemError);
  });
  it("price basis: GM+ only, and only a known basis", async () => {
    expect(await refused(setSkuPriceBasis(actor("agm", 6, [A]), "s", "per_case"))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(setSkuPriceBasis(actor("moo", 8, [A]), "s", "per_gallon" as never))).toEqual({ status: 400, code: "invalid_basis" });
  });
});

describe("the routes' explicit field lists", () => {
  it("parseLevels accepts the writer's shape and refuses anything else", () => {
    expect(parseLevels([{ label: "case", containsQty: 4, containsIndex: 1 }, { label: "bag", containsQty: 5, containsMeasureUnit: "lb" }]))
      .toEqual([{ label: "case", containsQty: 4, containsIndex: 1, containsMeasureUnit: null }, { label: "bag", containsQty: 5, containsIndex: null, containsMeasureUnit: "lb" }]);
    expect(parseLevels("x")).toBeNull();
    expect(parseLevels([{ label: 3, containsQty: 1 }])).toBeNull();
    expect(parseLevels(new Array(9).fill({ label: "a", containsQty: 1, containsMeasureUnit: "oz" }))).toBeNull();
  });
  it("parseTarget: a uuid shop or global, nothing else", () => {
    expect(parseTarget({ kind: "global" })).toEqual({ kind: "global" });
    expect(parseTarget({ kind: "shop", shopId: A })).toEqual({ kind: "shop", shopId: A });
    expect(parseTarget({ kind: "shop", shopId: "x" })).toBeNull();
    expect(parseTarget({ kind: "everyone" })).toBeNull();
  });
  it("parseConversions: ≤ 8 rows of { locationId uuid|null, slot, expected ≥ 0, to ≥ 0 }", () => {
    expect(parseConversions([{ locationId: null, slot: "weekday", expected: 3, to: 2 }])).toEqual([{ locationId: null, slot: "weekday", expected: 3, to: 2 }]);
    expect(parseConversions([{ locationId: A, slot: "weekend", expected: 3, to: -1 }])).toBeNull();
    expect(parseConversions([{ locationId: A, slot: "weekday", expected: 3, to: 2, inherited: true }])).toEqual([{ locationId: A, slot: "weekday", expected: 3, to: 2, inherited: true }]);
    expect(parseConversions([{ locationId: null, slot: "weekday", expected: 3, to: 2, inherited: true }])).toBeNull();
    expect(parseConversions([{ locationId: "x", slot: "weekday", expected: 3, to: 2 }])).toBeNull();
    expect(parseConversions(undefined)).toEqual([]);
  });
  it("conversionKey and itemClientKey are stable identities", () => {
    expect(conversionKey({ locationId: null, slot: "weekday", expected: 3, to: 2 })).toBe("global|weekday|3|2");
    expect(conversionKey({ locationId: A, slot: "weekday", expected: 3, to: 2, inherited: true })).toBe(`${A}|weekday|3|2|inherited`);
    expect(itemClientKey("s", A)).not.toBe(itemClientKey("s", B));
    expect(itemClientKey("s", null)).toBe("s:global");
  });
});
```

Run: `npx vitest run tests/catalog-item-server.test.ts` → FAIL (module not found).

- [ ] **Step 2: The parsers and keys**

Append to `lib/catalog/sku-item-shared.ts`, and put the two `import type` lines with the module's other imports at the top. They are type-only, so they erase and the module stays client-safe. The routes cannot export helpers, because Next 16 refuses non-HTTP-method exports from a route file, so the parsers live here.

```ts
import type { PackChainLevelInput } from "@/lib/admin/pack-chain";
import type { ParConversion, PreviewTarget } from "@/lib/catalog/change-preview-shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The explicit level field list every pack route accepts (≤ 8 levels). null = refuse. */
export function parseLevels(raw: unknown): PackChainLevelInput[] | null {
  if (!Array.isArray(raw) || raw.length > 8) return null;
  const out: PackChainLevelInput[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) return null;
    const l = r as Record<string, unknown>;
    if (typeof l.label !== "string" || l.label.length > 60 || typeof l.containsQty !== "number") return null;
    const idx = l.containsIndex === null || l.containsIndex === undefined ? null : l.containsIndex;
    const unit = l.containsMeasureUnit === null || l.containsMeasureUnit === undefined ? null : l.containsMeasureUnit;
    if ((idx !== null && typeof idx !== "number") || (unit !== null && typeof unit !== "string")) return null;
    out.push({ label: l.label, containsQty: l.containsQty, containsIndex: idx as number | null, containsMeasureUnit: unit as string | null });
  }
  return out;
}

/** The save target: `{ kind: "global" }` or `{ kind: "shop", shopId: uuid }`. null = refuse. */
export function parseTarget(raw: unknown): PreviewTarget | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === "global") return { kind: "global" };
  if (t.kind === "shop" && typeof t.shopId === "string" && UUID.test(t.shopId)) return { kind: "shop", shopId: t.shopId };
  return null;
}

/** The conversions a person accepted (absent = none). null = refuse. */
export function parseConversions(raw: unknown): ParConversion[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 8) return null;
  const out: ParConversion[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) return null;
    const c = r as Record<string, unknown>;
    const locationId = c.locationId === null ? null : typeof c.locationId === "string" && UUID.test(c.locationId) ? c.locationId : undefined;
    if (locationId === undefined) return null;
    if (c.slot !== "weekday" && c.slot !== "weekend") return null;
    if (typeof c.expected !== "number" || !Number.isFinite(c.expected) || c.expected < 0) return null;
    if (typeof c.to !== "number" || !Number.isFinite(c.to) || c.to < 0) return null;
    if (c.inherited !== undefined && c.inherited !== true && c.inherited !== false) return null;
    if (c.inherited === true && locationId === null) return null; // "give a shop its own par" names the shop
    out.push(c.inherited === true
      ? { locationId, slot: c.slot, expected: c.expected, to: c.to, inherited: true }
      : { locationId, slot: c.slot, expected: c.expected, to: c.to });
  }
  return out;
}

/** The client body's identity: a different SKU or shop is a different page (state never carries over). */
export function itemClientKey(skuId: string, scope: string | null): string {
  return `${skuId}:${scope ?? "global"}`;
}
```

Append to `lib/catalog/change-preview-shared.ts`:

```ts
/** One conversion's identity (target lane + slot + the bound values) — the client's choice set and the server's match. */
export function conversionKey(c: ParConversion): string {
  return `${c.locationId ?? "global"}|${c.slot}|${c.expected}|${c.to}${c.inherited ? "|inherited" : ""}`;
}
```

Keep each displayed "before → after" as ONE JS string, because React's static markup puts `<!-- -->` between adjacent text nodes and the UI tests read whole strings.

- [ ] **Step 3: Create `lib/catalog/sku-item.ts`**

```ts
/**
 * The connected ITEM PAGE for a bought item — the server half (catalog Phase 2b; spec §4, §5).
 * SERVER-ONLY, service role. Reads go through the 2a resolvers ONLY (pack: loadSkuPackResolution;
 * price: loadCurrentSkuPriceHeads/Prices; costs and depletion: loadRecipeGraph per shop; par lanes:
 * loadPackAwareOverlay, D3-stamped) — this module never picks a version.
 *
 * WRITES (lead decision D4): the pack save is ONE transaction (apply_sku_pack_change, 0261) — the
 * version, every accepted par conversion bound to the value the person was shown, and the door
 * report — after the 2a gate and the par permissions have passed, and only if the preview the person
 * saw (its token) is still exactly what the server computes for that target now.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { canReadReportLocation } from "@/lib/locations";
import { AdminSkuError, loadMeasureUnits } from "@/lib/admin/skus";
import { loadRecipeGraph, loadSkuPackResolution } from "@/lib/prep-consumption";
import { loadPackAwareOverlay } from "@/lib/ordering";
import { loadCurrentSkuPriceHeads, loadCurrentSkuPrices } from "@/lib/admin/cost";
import {
  loadSkuPackVersionHistory, preparePackVersionWrite, rpcLevels, saveSkuPrice, SkuVersionError, versionErrorFromRpc,
} from "@/lib/admin/sku-versions";
import { assertSkuExists, loadMeasureLabels, loadMeasuresMap, PackChainError, validateSubmission, type PackChainLevelInput } from "@/lib/admin/pack-chain";
import { loadOpenPackChangeRequests, PackChangeRequestError } from "@/lib/pack-change-requests";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { perUnitSkuOzForItemFromGraph, perUnitSkuOzForMenuItemFromGraph, type GraphRecipe, type RecipeGraph } from "@/lib/prep-consumption-graph";
import { orderUnitLabel, perOrderUnitOz } from "@/lib/order-unit-shared";
import { resolveParSlot, type LocationSkuOverlay } from "@/lib/location-sku-shared";
import { parWriteColumns } from "@/lib/dynamic-pars-shared";
import { skuDataReadiness } from "@/lib/sku-data-readiness";
import { etBusinessDate } from "@/lib/counts-shared";
import { skuContentOz, skuCostPerOz, type RecipeInputSku } from "@/lib/recipe-math";
import { buildPackChain, formatChainDescriptor, type PackChainLevel } from "@/lib/pack-chain-shared";
import {
  conversionKey, previewPackChange, previewPriceChange, previewToken,
  type PackPreview, type ParConversion, type PreviewMenuItem, type PreviewOpenOrder, type PreviewRecipeLine,
  type PreviewShopState, type PreviewTarget, type PricePreview,
} from "@/lib/catalog/change-preview-shared";
import {
  catalogShopAllowed, FIRST_GLOBAL_WRITE_MIN, GLOBAL_VERSION_WRITE_MIN, SHOP_VERSION_WRITE_MIN, type VersionScope,
} from "@/lib/sku-versions-shared";
import { PRICE_BASES, type PriceBasis, type SkuItemView } from "@/lib/catalog/sku-item-shared";

export class CatalogItemError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "CatalogItemError";
  }
}

const READ_MIN = 6;
const PAR_WRITE_MIN = 7;
const BASIS_WRITE_MIN = 7;
const RECEIVABLE_PO = ["draft", "confirmed", "placed", "invoiced"];

type Sb = ReturnType<typeof getServiceRoleClient>;
type Shop = { id: string; name: string };
type SkuRow = {
  id: string; name: string; item_number: string | null; vendor_id: string | null; product_id: string | null;
  location_id: string | null; active: boolean; sku_class: string | null; price_basis: string | null;
  avg_oz_per_each: number | string | null; pack_format: string | null; each_container_label: string | null;
  units_per_pack: number | null; each_size: number | string | null; each_measure: string | null;
  weekday_par: number | string | null; weekend_par: number | string | null; par_step: number | string | null;
  weight_class: string | null;
};
const SKU_COLUMNS =
  "id, name, item_number, vendor_id, product_id, location_id, active, sku_class, price_basis, avg_oz_per_each, pack_format, each_container_label, units_per_pack, each_size, each_measure, weekday_par, weekend_par, par_step, weight_class";

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function rethrow(e: unknown): never {
  if (e instanceof SkuVersionError || e instanceof PackChainError || e instanceof AdminSkuError || e instanceof PackChangeRequestError) {
    throw new CatalogItemError(e.status, e.code, e.message);
  }
  throw e;
}

const scopeOf = (t: PreviewTarget): VersionScope => (t.kind === "global" ? null : t.shopId);

/** Reads: AGM+, and a shop the actor works in (level 8 reads every shop, the report rule). Global is readable. */
function requireRead(actor: AuthContext, scope: VersionScope): void {
  if (actor.level < READ_MIN) throw new CatalogItemError(403, "forbidden");
  if (scope !== null && !canReadReportLocation({ role: actor.user.role, locations: actor.locations }, scope)) {
    throw new CatalogItemError(404, "not_found");
  }
}

/**
 * A GLOBAL-target preview shows every shop's numbers for a save only MoO+ (or, for a SKU with no
 * global value yet, the first-value floor) can make. Refuse it below that — before any read where the
 * level alone decides, and with one indexed read where the first-value case needs to know.
 */
async function requireGlobalTarget(actor: AuthContext, sb: Sb, skuId: string, kind: "pack" | "price"): Promise<void> {
  if (actor.level >= GLOBAL_VERSION_WRITE_MIN) return;
  if (actor.level < FIRST_GLOBAL_WRITE_MIN[kind]) throw new CatalogItemError(403, "global_requires_moo");
  const exists = kind === "pack"
    ? await sb.from("sku_pack_versions").select("id", { count: "exact", head: true }).eq("sku_id", skuId).is("location_id", null).eq("active", true)
    : await sb.from("vendor_price_history").select("id", { count: "exact", head: true }).eq("vendor_item_id", skuId).is("location_id", null);
  if (exists.error) throw new Error(`sku-item global gate: ${exists.error.message}`);
  if ((exists.count ?? 0) > 0) throw new CatalogItemError(403, "global_requires_moo");
}

function basePackOf(row: SkuRow, levels: PackChainLevel[]): RecipeInputSku {
  return {
    packFormat: row.pack_format, eachContainerLabel: row.each_container_label,
    unitsPerPack: row.units_per_pack, eachSize: num(row.each_size), eachMeasure: row.each_measure,
    avgOzPerEach: num(row.avg_oz_per_each), packChain: levels.length > 0 ? levels : null,
  };
}

/** The writer's index-linked levels as chain levels with synthetic ids (for the hypothetical graph). */
function toChainLevels(levels: readonly PackChainLevelInput[]): PackChainLevel[] {
  return levels.map((l, i) => ({
    id: `new-${i}`, label: l.label.trim(), containsQty: l.containsQty,
    containsLevelId: l.containsIndex != null ? `new-${l.containsIndex}` : null,
    containsMeasureUnit: l.containsIndex != null ? null : (l.containsMeasureUnit ?? "").trim(),
    displayOrdinal: i,
  }));
}

async function loadSkuRow(sb: Sb, skuId: string): Promise<SkuRow> {
  const { data: row, error } = await sb.from("vendor_items").select(SKU_COLUMNS).eq("id", skuId).maybeSingle<SkuRow>();
  if (error) throw new Error(`sku-item sku: ${error.message}`);
  if (!row) throw new CatalogItemError(404, "sku_not_found");
  return row;
}

async function loadActiveShops(sb: Sb): Promise<Shop[]> {
  const { data, error } = await sb.from("locations").select("id, name").eq("active", true).order("name").returns<Shop[]>();
  if (error) throw new Error(`sku-item shops: ${error.message}`);
  return data ?? [];
}

async function loadShop(sb: Sb, shopId: string): Promise<Shop> {
  const { data, error } = await sb.from("locations").select("id, name").eq("id", shopId).eq("active", true).maybeSingle<Shop>();
  if (error) throw new Error(`sku-item shop: ${error.message}`);
  if (!data) throw new CatalogItemError(404, "not_found");
  return data;
}

async function loadMenuItems(sb: Sb): Promise<PreviewMenuItem[]> {
  const { data, error } = await sb.from("menu_items").select("id, name, name_es").eq("active", true).order("name")
    .returns<Array<{ id: string; name: string; name_es: string | null }>>();
  if (error) throw new Error(`sku-item menu items: ${error.message}`);
  return (data ?? []).map((m) => ({ id: m.id, name: m.name, nameEs: m.name_es }));
}

async function loadDirectRecipeLines(sb: Sb, skuId: string): Promise<PreviewRecipeLine[]> {
  const { data: lines, error } = await sb.from("recipe_inputs").select("recipe_id, quantity, unit").eq("component_sku_id", skuId)
    .returns<Array<{ recipe_id: string; quantity: number | string; unit: string | null }>>();
  if (error) throw new Error(`sku-item recipe lines: ${error.message}`);
  const ids = [...new Set((lines ?? []).map((l) => l.recipe_id))];
  if (ids.length === 0) return [];
  const { data: recipes, error: rErr } = await sb.from("recipes").select("id, name").in("id", ids).eq("active", true)
    .returns<Array<{ id: string; name: string }>>();
  if (rErr) throw new Error(`sku-item recipes: ${rErr.message}`);
  const name = new Map((recipes ?? []).map((r) => [r.id, r.name]));
  return (lines ?? []).filter((l) => name.has(l.recipe_id))
    .map((l) => ({ recipeId: l.recipe_id, recipeName: name.get(l.recipe_id)!, quantity: num(l.quantity) ?? 0, unit: l.unit }));
}

/**
 * Orders not received yet for this SKU at this shop. The parent relation filters BEFORE the page
 * (status + shop on purchase_orders, one FK — an unambiguous service-role embed), and the result is
 * paged, so a long PO history can never push an open order off the first page.
 */
async function loadOpenOrders(sb: Sb, skuId: string, shop: Shop): Promise<PreviewOpenOrder[]> {
  type Row = { po_id: string; order_qty: number | string; order_unit_label: string | null; purchase_orders: { display_code: string; status: string } };
  const rows = await selectAllRows<Row>(async (from, to) => {
    const { data, error } = await sb.from("po_lines")
      .select("id, po_id, order_qty, order_unit_label, purchase_orders!inner(display_code, status, location_id)")
      .eq("sku_id", skuId).eq("purchase_orders.location_id", shop.id).in("purchase_orders.status", RECEIVABLE_PO)
      .order("id", { ascending: true }).range(from, to).returns<Row[]>();
    if (error) throw new Error(`sku-item open orders: ${error.message}`);
    return { data };
  });
  return rows.map((r) => ({
    poId: r.po_id, displayCode: r.purchase_orders.display_code, status: r.purchase_orders.status,
    orderQty: num(r.order_qty) ?? 0, orderUnitLabel: r.order_unit_label, shopId: shop.id, shopName: shop.name,
  }));
}

function slotsFrom(overlay: LocationSkuOverlay | null, row: SkuRow): PreviewShopState["slots"] {
  const global = { weekdayPar: num(row.weekday_par), weekendPar: num(row.weekend_par) };
  return (["weekday", "weekend"] as const).map((slot) => {
    const r = resolveParSlot(overlay, global, slot);
    return { slot, value: r.value, lane: r.lane };
  });
}

/** One shop as it stands today for this SKU — every number through the 2a resolvers, par lanes D3-stamped. */
async function loadShopState(sb: Sb, row: SkuRow, shop: Shop): Promise<PreviewShopState & { overlay: (LocationSkuOverlay & { activeOverride: boolean | null }) | null }> {
  const [graph, packAware, heads, openOrders] = await Promise.all([
    loadRecipeGraph({ locationId: shop.id }),
    loadPackAwareOverlay(sb, shop.id, [row.id]),
    loadCurrentSkuPriceHeads([row.id], shop.id),
    loadOpenOrders(sb, row.id, shop),
  ]);
  const pack = packAware.packResolution.get(row.id) ?? null;
  const [prices, globalHeads] = await Promise.all([
    loadCurrentSkuPrices([...new Set([...graph.skuPack.keys(), row.id])], shop.id),
    loadCurrentSkuPriceHeads([row.id], null),
  ]);
  const overlay = packAware.overlayBySku.get(row.id) ?? null;
  const shopHead = heads.get(row.id) ?? null;
  const globalHead = globalHeads.get(row.id) ?? null;
  return {
    shopId: shop.id, shopName: shop.name,
    basePack: basePackOf(row, pack?.levels ?? []),
    ownPackVersion: pack?.locationId === shop.id,
    ownPriceLane: shopHead?.laneId != null,
    // The heads the real selection rule compares a new row against (Astra 2b r3#2).
    priceHeads: {
      global: globalHead ? { value: globalHead.value, effectiveDate: globalHead.effectiveDate } : null,
      lane: shopHead?.laneId != null ? { value: shopHead.value, effectiveDate: shopHead.effectiveDate } : null,
    },
    graph, prices, slots: slotsFrom(overlay, row), openOrders, overlay,
  };
}

function uniqueRecipes(graph: RecipeGraph): GraphRecipe[] {
  return [...new Set([...graph.byOutputItem.values(), ...graph.byOutputMenuItem.values()])];
}

function pinsSku(graph: RecipeGraph, r: GraphRecipe, skuId: string): boolean {
  return r.inputs.some((i) => i.componentSkuId === skuId
    || (i.componentProductId != null && graph.products.resolution.get(i.componentProductId)?.skuId === skuId));
}

// ── The page ────────────────────────────────────────────────────────────────

export async function loadSkuItemView(
  actor: AuthContext,
  skuId: string,
  scope: VersionScope,
  shops: Shop[],
): Promise<SkuItemView> {
  requireRead(actor, scope);
  const sb = getServiceRoleClient();
  const row = await loadSkuRow(sb, skuId);
  const [packs, globalPacks, graph, heads, globalHeads, packAware, menuItems, measureUnits, historyRows, requests] = await Promise.all([
    loadSkuPackResolution([skuId], scope),
    loadSkuPackResolution([skuId], null),
    loadRecipeGraph(scope === null ? undefined : { locationId: scope }),
    loadCurrentSkuPriceHeads([skuId], scope),
    loadCurrentSkuPriceHeads([skuId], null),
    scope === null ? Promise.resolve(null) : loadPackAwareOverlay(sb, scope, [skuId]),
    loadMenuItems(sb),
    loadMeasureUnits(actor),
    loadSkuPackVersionHistory(actor, skuId, scope).catch(rethrow),
    scope !== null ? loadOpenPackChangeRequests(actor, { locationIds: [scope], skuId }) : Promise.resolve([]),
  ]);
  const pack = packs.get(skuId) ?? null;
  const levels = pack?.levels ?? [];
  const basePack = basePackOf(row, levels);
  const prices = await loadCurrentSkuPrices([...new Set([...graph.skuPack.keys(), skuId])], scope);
  const measures = graph.measures;
  const usingRecipes = uniqueRecipes(graph).filter((r) => pinsSku(graph, r, skuId));
  const overlay = packAware?.overlayBySku.get(skuId) ?? null;

  const vendorRes = row.vendor_id
    ? await sb.from("vendors").select("id, name, active, order_days").eq("id", row.vendor_id)
        .maybeSingle<{ id: string; name: string; active: boolean; order_days: number[] | null }>()
    : { data: null, error: null };
  if (vendorRes.error) throw new Error(`sku-item vendor: ${vendorRes.error.message}`);
  const recipeRes = usingRecipes.length
    ? await sb.from("recipes").select("id, name").in("id", usingRecipes.map((r) => r.recipeId)).returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (recipeRes.error) throw new Error(`sku-item recipes: ${recipeRes.error.message}`);
  const rhythmRes = scope !== null && row.vendor_id
    ? await sb.from("vendor_delivery_rhythm").select("order_dow").eq("vendor_id", row.vendor_id).eq("location_id", scope).eq("active", true)
        .returns<Array<{ order_dow: number }>>()
    : { data: [] as Array<{ order_dow: number }>, error: null };
  if (rhythmRes.error) throw new Error(`sku-item rhythm: ${rhythmRes.error.message}`);
  const cutoffRes = row.vendor_id
    ? await sb.from("vendor_cutoffs").select("id, location_id").eq("vendor_id", row.vendor_id).eq("active", true)
        .returns<Array<{ id: string; location_id: string | null }>>()
    : { data: [] as Array<{ id: string; location_id: string | null }>, error: null };
  if (cutoffRes.error) throw new Error(`sku-item cutoffs: ${cutoffRes.error.message}`);
  const barcodeRes = await sb.from("sku_barcodes").select("code, level, taught_at").eq("sku_id", skuId).is("forgotten_at", null)
    .order("taught_at", { ascending: false }).returns<Array<{ code: string; level: "case" | "inner"; taught_at: string }>>();
  if (barcodeRes.error) throw new Error(`sku-item barcodes: ${barcodeRes.error.message}`);
  const priceBase = sb.from("vendor_price_history").select("id, unit_price, effective_date, location_id").eq("vendor_item_id", skuId);
  const priceRowsRes = await (scope === null ? priceBase.is("location_id", null) : priceBase.or(`location_id.is.null,location_id.eq.${scope}`))
    .order("effective_date", { ascending: false }).order("recorded_at", { ascending: false }).order("id", { ascending: false }).limit(12)
    .returns<Array<{ id: string; unit_price: number | string; effective_date: string; location_id: string | null }>>();
  if (priceRowsRes.error) throw new Error(`sku-item prices: ${priceRowsRes.error.message}`);

  // Sourcing per shop: the member this shop buys (its own primary, else the global one).
  let product: SkuItemView["product"] = null;
  if (row.product_id) {
    const [{ data: prod, error: pErr }, { data: prims, error: prErr }] = await Promise.all([
      sb.from("products").select("id, name").eq("id", row.product_id).maybeSingle<{ id: string; name: string }>(),
      sb.from("product_primaries").select("location_id, primary_sku_id").eq("product_id", row.product_id)
        .returns<Array<{ location_id: string | null; primary_sku_id: string }>>(),
    ]);
    if (pErr) throw new Error(`sku-item product: ${pErr.message}`);
    if (prErr) throw new Error(`sku-item primaries: ${prErr.message}`);
    const primary = (prims ?? []).find((p) => p.location_id === scope) ?? (prims ?? []).find((p) => p.location_id === null) ?? null;
    let primarySkuName: string | null = null;
    if (primary && primary.primary_sku_id !== skuId) {
      const { data: ps, error: psErr } = await sb.from("vendor_items").select("name").eq("id", primary.primary_sku_id).maybeSingle<{ name: string }>();
      if (psErr) throw new Error(`sku-item primary name: ${psErr.message}`);
      primarySkuName = ps?.name ?? null;
    }
    if (prod) product = { id: prod.id, name: prod.name, primarySkuId: primary?.primary_sku_id ?? null, primarySkuName };
  }

  // Connections: recipes that pin it, and the sandwiches it reaches — costed at this scope.
  const costPerOz = costPerOzFromGraph(graph, prices);
  const reaching = menuItems.filter((m) => perUnitSkuOzForMenuItemFromGraph(graph, m.id).has(skuId));
  const recipeNames = new Map((recipeRes.data ?? []).map((r) => [r.id, r.name]));
  const unresolvedRecipes = usingRecipes.filter((r) => r.outputs.every((o) =>
    (o.outputItemId != null ? perUnitSkuOzForItemFromGraph(graph, o.outputItemId) : perUnitSkuOzForMenuItemFromGraph(graph, o.outputMenuItemId ?? "")).size === 0))
    .map((r) => recipeNames.get(r.recipeId) ?? r.recipeId);

  // What's missing — the readiness errands for THIS scope's pack, price and par (lanes D3-stamped).
  const slots = slotsFrom(overlay, row);
  const today = etBusinessDate(new Date().toISOString());
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekend = day === 5 || day === 6 || day === 0;
  const weekendPar = slots.find((s) => s.slot === "weekend")?.value ?? null;
  const par = weekend && weekendPar != null ? weekendPar : (slots.find((s) => s.slot === "weekday")?.value ?? null);
  const head = heads.get(skuId) ?? null;
  const cutoffs = (cutoffRes.data ?? []).filter((c) => scope === null || c.location_id === null || c.location_id === scope);
  const rhythmPresent = cutoffs.length > 0 && (scope === null || (rhythmRes.data ?? []).length > 0);
  const missing = skuDataReadiness({
    sku: { ...basePack, skuClass: row.sku_class ?? "raw", weightClass: row.weight_class },
    headPrice: head ? { value: head.value, effectiveDate: head.effectiveDate } : null,
    par, rhythmPresent, vendorActive: vendorRes.data?.active === true,
    unresolvedRecipes, asOf: today, measures,
  }).errands;

  const whoIds = [...new Set(historyRows.map((h) => h.createdBy).filter((v): v is string => v != null))];
  const whoRes = whoIds.length
    ? await sb.from("users").select("id, name").in("id", whoIds).returns<Array<{ id: string; name: string | null }>>()
    : { data: [] as Array<{ id: string; name: string | null }>, error: null };
  if (whoRes.error) throw new Error(`sku-item history names: ${whoRes.error.message}`);
  const who = new Map((whoRes.data ?? []).map((u) => [u.id, u.name]));

  const chainOrNull = levels.length > 0 ? levels : null;
  const orderDays = scope === null
    ? [...new Set(vendorRes.data?.order_days ?? [])].sort((a, b) => a - b)
    : [...new Set((rhythmRes.data ?? []).map((r) => r.order_dow))].sort((a, b) => a - b);

  return {
    sku: {
      id: row.id, name: row.name, itemNumber: row.item_number, active: row.active, skuClass: row.sku_class ?? "raw",
      priceBasis: (PRICE_BASES as readonly string[]).includes(row.price_basis ?? "") ? (row.price_basis as PriceBasis) : null,
      avgOzPerEach: num(row.avg_oz_per_each), packFormat: row.pack_format,
    },
    vendor: vendorRes.data ? { id: vendorRes.data.id, name: vendorRes.data.name, active: vendorRes.data.active } : null,
    product,
    shops,
    scope,
    scopeName: scope === null ? null : (shops.find((s) => s.id === scope)?.name ?? null),
    can: {
      // D2: a membership, or MoO+ for ANY active shop — the same rule the 2a writers bind with.
      editShop: scope !== null && actor.level >= SHOP_VERSION_WRITE_MIN && catalogShopAllowed(actor, scope),
      editGlobal: actor.level >= GLOBAL_VERSION_WRITE_MIN,
      editPar: actor.level >= PAR_WRITE_MIN,
      editBasis: actor.level >= GLOBAL_VERSION_WRITE_MIN || (actor.level >= BASIS_WRITE_MIN && row.price_basis == null),
    },
    pack: {
      levels, versionId: pack?.versionId ?? null, isShopVersion: pack?.locationId != null, effectiveFrom: pack?.effectiveFrom ?? null,
      globalVersionId: globalPacks.get(skuId)?.versionId ?? null,
      orderUnit: orderUnitLabel(row.pack_format, chainOrNull),
      orderUnitOz: perOrderUnitOz(basePack, chainOrNull, measures),
      descriptor: chainOrNull ? formatChainDescriptor(buildPackChain(levels)) : null,
    },
    price: {
      value: head?.value ?? null, effectiveDate: head?.effectiveDate ?? null, isShopLane: head?.laneId != null,
      globalValue: globalHeads.get(skuId)?.value ?? null,
      costPerOz: skuCostPerOz(head?.value ?? null, skuContentOz(basePack, measures)),
      history: (priceRowsRes.data ?? []).map((p) => ({ id: p.id, unitPrice: num(p.unit_price) ?? 0, effectiveDate: p.effective_date, shop: p.location_id != null })),
    },
    ordering: { slots, orderDays, offHere: overlay?.activeOverride === false },
    counting: { unit: orderUnitLabel(row.pack_format, chainOrNull) },
    barcodes: (barcodeRes.data ?? []).map((b) => ({ code: b.code, level: b.level, taughtAt: b.taught_at })),
    connections: {
      uses: usingRecipes.map((r) => ({ id: r.recipeId, name: recipeNames.get(r.recipeId) ?? r.recipeId })),
      menuItems: reaching.map((m) => ({ id: m.id, name: m.name, nameEs: m.nameEs, cost: rollupMenuItemCost(graph, m.id, costPerOz).cost })),
    },
    missing,
    history: historyRows.map((h) => ({
      id: h.id, scope: h.locationId === null ? "global" : "shop", active: h.active, effectiveFrom: h.validFrom,
      retiredAt: h.validTo, who: h.createdBy ? (who.get(h.createdBy) ?? null) : null, labels: h.labels,
    })),
    openRequests: requests.map((r) => ({ id: r.id, filedBy: r.filedBy, filedAt: r.filedAt, note: r.note, proposal: r.proposal })),
    measures: measureUnits.map((m) => ({ label: m.label, dimension: m.dimension, toBaseFactor: m.toBaseFactor })),
  };
}

// ── The previews ────────────────────────────────────────────────────────────

/**
 * "What this changes" for a proposed pack, for THE SAVE TARGET (D4): a shop → that shop; global →
 * every active shop is loaded so the preview knows who rides the global pack and who keeps its own.
 * Validated exactly as the writer will. The token binds what was shown.
 */
export async function computePackPreview(actor: AuthContext, skuId: string, target: PreviewTarget, levels: PackChainLevelInput[]): Promise<PackPreview> {
  const scope = scopeOf(target);
  requireRead(actor, scope);
  if (target.kind === "global" && actor.level < FIRST_GLOBAL_WRITE_MIN.pack) throw new CatalogItemError(403, "global_requires_moo");
  if (levels.length === 0) throw new CatalogItemError(400, "empty_chain");
  const sb = getServiceRoleClient();
  if (target.kind === "global") await requireGlobalTarget(actor, sb, skuId, "pack");
  const { avgOzPerEach, skuClass } = await assertSkuExists(skuId).catch(rethrow);
  const [labels, measures] = await Promise.all([loadMeasureLabels(), loadMeasuresMap()]);
  let validated: PackChainLevelInput[] = [];
  try { validated = validateSubmission(levels, labels, measures, avgOzPerEach, skuClass); } catch (e) { rethrow(e); }
  const row = await loadSkuRow(sb, skuId);
  const shops = target.kind === "shop" ? [await loadShop(sb, target.shopId)] : await loadActiveShops(sb);
  // THE DEPENDENCY SNAPSHOT FIRST (2b r2#2): anything that moves after it — while the preview is being
  // computed, or before the save — makes the apply's re-take differ, and the save is refused.
  const { data: snapshot, error: snapErr } = await sb.rpc("sku_pack_change_snapshot", { p_sku: skuId, p_shops: shops.map((s) => s.id) });
  if (snapErr) throw new Error(`sku-item snapshot: ${snapErr.message}`);
  const [states, menuItems, recipeLines, targetPacks] = await Promise.all([
    Promise.all(shops.map((s) => loadShopState(sb, row, s))),
    loadMenuItems(sb),
    loadDirectRecipeLines(sb, skuId),
    loadSkuPackResolution([skuId], scope),
  ]);
  const tp = targetPacks.get(skuId) ?? null;
  // expected_live is the TARGET scope's OWN live version (a shop riding the global one has none);
  // a shop's first own version is based on the global version it replaces.
  const liveVersionId = tp != null && tp.locationId === scope ? tp.versionId : null;
  const basedOnVersionId = scope !== null && tp != null && tp.locationId === null ? tp.versionId : null;
  const body = previewPackChange({
    skuId, target, targetBasePack: basePackOf(row, tp?.levels ?? []), newChain: toChainLevels(validated),
    shops: states, globalPars: { weekday: num(row.weekday_par), weekend: num(row.weekend_par) },
    parStep: num(row.par_step), menuItems, recipeLines, liveVersionId, basedOnVersionId,
  });
  return {
    ...body, snapshot,
    token: previewToken({ kind: "pack", target, liveVersionId, basedOnVersionId, levels: rpcLevels(validated), conversions: body.conversions, snapshot }),
  };
}

/** "What this changes" for a new price, for THE SAVE TARGET (a shop → its lane; global → every shop without one). */
export async function computePricePreview(actor: AuthContext, skuId: string, target: PreviewTarget, newPrice: number, effectiveDate: string): Promise<PricePreview> {
  const scope = scopeOf(target);
  requireRead(actor, scope);
  if (target.kind === "global" && actor.level < FIRST_GLOBAL_WRITE_MIN.price) throw new CatalogItemError(403, "global_requires_moo");
  if (!Number.isFinite(newPrice) || newPrice <= 0) throw new CatalogItemError(400, "invalid_price");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(Date.parse(effectiveDate))) throw new CatalogItemError(400, "invalid_date");
  const sb = getServiceRoleClient();
  if (target.kind === "global") await requireGlobalTarget(actor, sb, skuId, "price");
  const row = await loadSkuRow(sb, skuId);
  const shops = target.kind === "shop" ? [await loadShop(sb, target.shopId)] : await loadActiveShops(sb);
  const [states, menuItems] = await Promise.all([Promise.all(shops.map((s) => loadShopState(sb, row, s))), loadMenuItems(sb)]);
  const body = previewPriceChange({ skuId, target, shops: states, newPrice, effectiveDate, menuItems });
  return {
    ...body,
    // The effective date is bound into the token: a save with any other date is a different change.
    token: previewToken({
      kind: "price", target, newPrice, effectiveDate,
      before: body.shops.map((s) => [s.shopId, s.price.before, s.becomesCurrent]), unaffected: body.unaffected.map((u) => u.shopId),
    }),
  };
}

// ── Apply ───────────────────────────────────────────────────────────────────

export interface ApplyPackChangeInput {
  skuId: string;
  target: PreviewTarget;
  levels: PackChainLevelInput[];
  /** The conversions the person accepted — each EXACTLY as the preview offered it (expected included). */
  conversions: ParConversion[];
  /** The door report this answers, if the job came from one. */
  requestId: string | null;
  /** The token of the preview the person saw — for THIS target. */
  previewToken: string;
}

/**
 * Save "It arrives differently now": the gates (2a's version gate; the par permissions) before any
 * write, then the preview recomputed for the posted target (stale → 409), then ONE transaction
 * (apply_sku_pack_change): the version, every accepted conversion bound to its expected value, and
 * the door report. Any mismatch refuses everything — nothing half-applies.
 */
export async function applyPackChange(
  actor: AuthContext,
  input: ApplyPackChangeInput,
): Promise<{ versionId: string; retiredVersionId: string | null; parsConverted: number; requestApplied: boolean }> {
  const scope = scopeOf(input.target);
  // 1) Who may convert which par: GM+ (the par floor), and each converted SHOP par only where the
  //    actor may act (a membership, or MoO+ — D2). Pure, before any I/O.
  if (input.conversions.length > 0) {
    if (actor.level < PAR_WRITE_MIN) throw new CatalogItemError(403, "par_forbidden");
    for (const c of input.conversions) {
      if (c.locationId !== null && !catalogShopAllowed(actor, c.locationId)) throw new CatalogItemError(404, "not_found");
    }
  }
  // 2) 2a's version gate (role + shop, before I/O) and the full chain validation.
  let prepared!: Awaited<ReturnType<typeof preparePackVersionWrite>>;
  try {
    prepared = await preparePackVersionWrite(actor, { skuId: input.skuId, scope, levels: input.levels });
  } catch (e) {
    rethrow(e);
  }
  // 3) The save must present the preview it was shown, for THIS target, and accept only what it offered.
  const preview = await computePackPreview(actor, input.skuId, input.target, input.levels);
  if (preview.token !== input.previewToken) throw new CatalogItemError(409, "preview_stale");
  const offered = new Set(preview.conversions.map(conversionKey));
  for (const c of input.conversions) {
    if (!offered.has(conversionKey(c))) throw new CatalogItemError(409, "preview_stale");
  }
  // 4) ONE transaction.
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("apply_sku_pack_change", {
    p_sku: input.skuId, p_location: scope, p_levels: rpcLevels(prepared.levels),
    p_expected_live: preview.liveVersionId, p_based_on: preview.basedOnVersionId, p_note: null,
    p_actor: actor.user.id, p_first_only: prepared.firstOnly,
    p_par_changes: input.conversions.map((c) => {
      // A SHOP par's patch comes from THE one decider (parWriteColumns, kind "admin"): the human value,
      // and the machine lane + pin of that slot cleared. The global par is one column; SQL writes it.
      const eff = parWriteColumns({ kind: "admin", dayClass: c.slot, value: c.to });
      return {
        location_id: c.locationId, slot: c.slot, expected: c.expected, to: c.to, inherited: c.inherited === true,
        patch: c.locationId === null ? null : { ...eff.human, ...eff.autoLane },
      };
    }),
    p_request: input.requestId,
    // The snapshot of the preview recomputed just above (its token matched the person's): the RPC
    // re-takes it under the SKU lock and refuses any difference.
    p_snapshot: preview.snapshot,
  });
  if (error) {
    try { versionErrorFromRpc(error.message); } catch (e) { rethrow(e); }
  }
  const r = data as { version_id: string; retired_version_id: string | null; pars_converted: number; request_applied: boolean; mirror_synced: boolean | null };

  // The GLOBAL flat mirror was derived INSIDE the transaction (0259 sku_flat_mirror_apply via
  // save_sku_pack_version; Astra 2b r2#6) — nothing is synced after the lock is released.
  const flatFieldsSynced = r.mirror_synced;
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.pack_version_save", resourceTable: "sku_pack_versions", resourceId: r.version_id,
    metadata: {
      sku_id: input.skuId, location_id: scope, scope: scope === null ? "global" : "shop", via: "catalog_item_page",
      retired_version_id: r.retired_version_id, based_on_version_id: preview.basedOnVersionId ?? r.retired_version_id,
      first_only: prepared.firstOnly, labels: prepared.levels.map((l) => l.label.trim()), level_count: prepared.levels.length,
      flat_fields_synced: flatFieldsSynced, pars_converted: r.pars_converted, request_id: input.requestId,
    },
    ipAddress: null, userAgent: null,
  });
  for (const c of input.conversions) {
    await audit({
      actorId: actor.user.id, actorRole: actor.user.role,
      action: "vendor_item.update", resourceTable: "vendor_items", resourceId: input.skuId,
      metadata: {
        scope: c.locationId === null ? "global_par" : "location_settings", location_id: c.locationId, inherited: c.inherited === true,
        edited_slots: [c.slot], before: c.expected, after: c.to, via: "pack_change_conversion", version_id: r.version_id,
      },
      ipAddress: null, userAgent: null,
    });
  }
  if (input.requestId) {
    await audit({
      actorId: actor.user.id, actorRole: actor.user.role,
      action: "sku.pack_change_request.resolve", resourceTable: "sku_pack_change_requests", resourceId: input.requestId,
      metadata: { sku_id: input.skuId, location_id: scope, outcome: "applied", version_id: r.version_id },
      ipAddress: null, userAgent: null,
    });
  }
  return { versionId: r.version_id, retiredVersionId: r.retired_version_id, parsConverted: r.pars_converted, requestApplied: r.request_applied };
}

/** Save "Price changed" for THE previewed target: the token must still match, then 2a's gated writer. */
export async function applyPriceChange(
  actor: AuthContext,
  input: { skuId: string; target: PreviewTarget; unitPrice: number; effectiveDate: string; previewToken: string },
): Promise<{ priceId: string; laneId: string | null; laneCreated: boolean }> {
  // Recomputed WITH the posted date: a different date (or a head that moved) is a different token.
  const preview = await computePricePreview(actor, input.skuId, input.target, input.unitPrice, input.effectiveDate);
  if (preview.token !== input.previewToken) throw new CatalogItemError(409, "preview_stale");
  try {
    return await saveSkuPrice(actor, { skuId: input.skuId, scope: scopeOf(input.target), unitPrice: input.unitPrice, effectiveDate: input.effectiveDate });
  } catch (e) {
    rethrow(e);
  }
}

// ── Price basis (plain words; spec §9 "a plain-words field in Price") ──────

/**
 * What the vendor's price is FOR (vendor_items.price_basis, 0210). SKU identity, so GLOBAL: MoO+
 * changes it; a GM may set it the first time (when unset). Metadata only — it never reinterprets
 * vendor_price_history.unit_price.
 */
export async function setSkuPriceBasis(actor: AuthContext, skuId: string, basis: PriceBasis | null): Promise<void> {
  if (actor.level < BASIS_WRITE_MIN) throw new CatalogItemError(403, "forbidden");
  if (basis !== null && !(PRICE_BASES as readonly string[]).includes(basis)) throw new CatalogItemError(400, "invalid_basis");
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb.from("vendor_items").select("id, price_basis, location_id").eq("id", skuId)
    .maybeSingle<{ id: string; price_basis: string | null; location_id: string | null }>();
  if (error) throw new Error(`setSkuPriceBasis read: ${error.message}`);
  if (!row) throw new CatalogItemError(404, "sku_not_found");
  // A shop-scoped SKU (a store copy) is that shop's: bind to it (a membership, or MoO+ — D2).
  if (row.location_id !== null && !catalogShopAllowed(actor, row.location_id)) throw new CatalogItemError(404, "not_found");
  if (actor.level < GLOBAL_VERSION_WRITE_MIN && row.price_basis !== null) throw new CatalogItemError(403, "global_requires_moo");
  // Compare-and-set on the value just read: a concurrent change is 409 version_changed (the D5 posture).
  const base = sb.from("vendor_items").update({ price_basis: basis }, { count: "exact" }).eq("id", skuId);
  const { error: uErr, count } = await (row.price_basis === null ? base.is("price_basis", null) : base.eq("price_basis", row.price_basis));
  if (uErr) throw new Error(`setSkuPriceBasis update: ${uErr.message}`);
  if (count === 0) throw new CatalogItemError(409, "version_changed");
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.price_basis_set", resourceTable: "vendor_items", resourceId: skuId,
    metadata: { before: row.price_basis, after: basis, via: "catalog_item_page" },
    ipAddress: null, userAgent: null,
  });
}
```

Notes for the implementer:
- If TS reports `prepared` as used before assignment, the `!` on its declaration (already there) is the fix.
- `loadShopState` returns the overlay alongside the state for a future caller; `previewPackChange` ignores the extra field (structural typing).

- [ ] **Step 4: Register the file with the differential bind check**

In `tests/location-bind-differential.test.ts` `FILES`, add:

```ts
  // Catalog Phase 2b — applyPackChange binds conversions (catalogShopAllowed) and delegates the version
  // to the bound 2a gate before calling apply_sku_pack_change; setSkuPriceBasis binds a shop-scoped SKU.
  "lib/catalog/sku-item.ts",
```

`catalogShopAllowed` is called inside `applyPackChange` and `setSkuPriceBasis`. If the differential test's `BIND_PRIMITIVES` does not list `catalogShopAllowed`, add it there, with the comment `// 2a: level ≥ 8 or a membership (D2)`. 2a registered `requireLocation`, which wraps it in `lib/admin/sku-versions.ts`.

- [ ] **Step 5: Run**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → no output.
Run: `npx vitest run tests/catalog-item-server.test.ts tests/location-bind-differential.test.ts tests/change-preview-shared.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add lib/catalog/sku-item.ts lib/catalog/sku-item-shared.ts lib/catalog/change-preview-shared.ts tests/catalog-item-server.test.ts tests/location-bind-differential.test.ts
git commit -F - <<'EOF'
feat(catalog): item page server half — per-target previews with a token, the atomic pack+par apply, price apply, basis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 7: The item page's routes

**Files:**
- Create: `app/api/admin/catalog/sku/[id]/preview/route.ts`
- Create: `app/api/admin/catalog/sku/[id]/pack/apply/route.ts`
- Create: `app/api/admin/catalog/sku/[id]/price/apply/route.ts`
- Create: `app/api/admin/catalog/sku/[id]/price-basis/route.ts`
- Create: `app/api/admin/catalog/sku/[id]/pack-requests/[requestId]/dismiss/route.ts`
- Modify: `tests/step-up-tier-map.test.ts`
- Test: `tests/catalog-item-routes.test.ts`

- [ ] **Step 1: Write the failing source pins**

```ts
/** Catalog Phase 2b — the item page's routes: writes are Tier E; the preview is a read; explicit fields; the target is posted, never inferred. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WRITES = {
  "app/api/admin/catalog/sku/[id]/pack/apply/route.ts": "applyPackChange(",
  "app/api/admin/catalog/sku/[id]/price/apply/route.ts": "applyPriceChange(",
  "app/api/admin/catalog/sku/[id]/price-basis/route.ts": "setSkuPriceBasis(",
  "app/api/admin/catalog/sku/[id]/pack-requests/[requestId]/dismiss/route.ts": "dismissPackChangeRequest(",
} as const;

describe.each(Object.entries(WRITES))("%s", (file, call) => {
  const src = readFileSync(file, "utf8");
  it("Tier E after the session, then the lib", () => {
    expect(src).toContain('assertStepUp(ctx, "E")');
    expect(src.indexOf("requireSession(")).toBeLessThan(src.indexOf('assertStepUp(ctx, "E")'));
    expect(src).toContain(call);
  });
});

describe("the saves carry their target and the preview they were shown", () => {
  it("pack apply: target, conversions and the token through the strict parsers", () => {
    const src = readFileSync("app/api/admin/catalog/sku/[id]/pack/apply/route.ts", "utf8");
    for (const s of ["parseTarget(b.target)", "parseConversions(b.conversions)", "parseLevels(b.levels)", "previewToken"]) expect(src).toContain(s);
  });
  it("price apply: target and the token", () => {
    const src = readFileSync("app/api/admin/catalog/sku/[id]/price/apply/route.ts", "utf8");
    for (const s of ["parseTarget(b.target)", "previewToken"]) expect(src).toContain(s);
  });
  it("dismiss binds the SKU in its path", () => {
    expect(readFileSync("app/api/admin/catalog/sku/[id]/pack-requests/[requestId]/dismiss/route.ts", "utf8"))
      .toContain("dismissPackChangeRequest(ctx, { requestId, skuId: id })");
  });
});

describe("the preview is a read", () => {
  const src = readFileSync("app/api/admin/catalog/sku/[id]/preview/route.ts", "utf8");
  it("no step-up, no write, both kinds, the target and the level parsers", () => {
    expect(src).not.toContain("assertStepUp");
    expect(src).toContain("computePackPreview(");
    expect(src).toContain("computePricePreview(");
    expect(src).toContain("parseLevels(");
    expect(src).toContain("parseTarget(b.target)");
  });
});
```

Run → FAIL (`ENOENT`).

- [ ] **Step 2: `app/api/admin/catalog/sku/[id]/preview/route.ts`**

```ts
/**
 * POST /api/admin/catalog/sku/[id]/preview — "What this changes" (catalog Phase 2b). A READ: it
 * computes, it never writes, so it takes no step-up. The TARGET is explicit (D4):
 *   { kind: "pack", target: { kind: "shop", shopId } | { kind: "global" }, levels: [...] }
 *   { kind: "price", target: …, unitPrice: number, effectiveDate: "YYYY-MM-DD" }
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CatalogItemError, computePackPreview, computePricePreview } from "@/lib/catalog/sku-item";
import { parseLevels, parseTarget } from "@/lib/catalog/sku-item-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/preview`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < 6) return jsonError(403, "forbidden");
  const b = (parsed ?? {}) as Record<string, unknown>;
  const target = parseTarget(b.target);
  if (!target) return jsonError(400, "invalid_payload", { field: "target" });
  try {
    if (b.kind === "pack") {
      const levels = parseLevels(b.levels);
      if (!levels) return jsonError(400, "invalid_payload", { field: "levels" });
      return jsonOk({ preview: await computePackPreview(ctx, id, target, levels) });
    }
    if (b.kind === "price") {
      if (typeof b.unitPrice !== "number") return jsonError(400, "invalid_price", { field: "unitPrice" });
      if (typeof b.effectiveDate !== "string") return jsonError(400, "invalid_date", { field: "effectiveDate" });
      return jsonOk({ preview: await computePricePreview(ctx, id, target, b.unitPrice, b.effectiveDate) });
    }
    return jsonError(400, "invalid_payload", { field: "kind" });
  } catch (e) {
    if (e instanceof CatalogItemError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 3: `app/api/admin/catalog/sku/[id]/pack/apply/route.ts`**

```ts
/**
 * POST /api/admin/catalog/sku/[id]/pack/apply — "It arrives differently now", saved (catalog Phase 2b).
 * Body: { target: { kind: "shop", shopId } | { kind: "global" }, levels: [...],
 *         conversions: [{ locationId: uuid | null, slot, expected, to }], requestId?: uuid | null,
 *         previewToken: string }
 * Tier E. ONE transaction (apply_sku_pack_change): the version, the accepted conversions bound to the
 * values the person was shown, and the door report. A stale preview is 409 preview_stale.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { applyPackChange, CatalogItemError } from "@/lib/catalog/sku-item";
import { parseConversions, parseLevels, parseTarget } from "@/lib/catalog/sku-item-shared";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/pack/apply`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const target = parseTarget(b.target);
  if (!target) return jsonError(400, "invalid_payload", { field: "target" });
  const levels = parseLevels(b.levels);
  if (!levels) return jsonError(400, "invalid_payload", { field: "levels" });
  const conversions = parseConversions(b.conversions);
  if (!conversions) return jsonError(400, "invalid_payload", { field: "conversions" });
  const requestId = b.requestId === null || b.requestId === undefined ? null
    : typeof b.requestId === "string" && UUID_RE.test(b.requestId) ? b.requestId : undefined;
  if (requestId === undefined) return jsonError(400, "invalid_payload", { field: "requestId" });
  const previewToken = typeof b.previewToken === "string" && /^[0-9a-f]{8}$/.test(b.previewToken) ? b.previewToken : null;
  if (!previewToken) return jsonError(400, "invalid_payload", { field: "previewToken" });
  try {
    const r = await applyPackChange(ctx, { skuId: id, target, levels, conversions, requestId, previewToken });
    return jsonOk(r, 201);
  } catch (e) {
    if (e instanceof CatalogItemError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 4: `app/api/admin/catalog/sku/[id]/price/apply/route.ts`**

```ts
/**
 * POST /api/admin/catalog/sku/[id]/price/apply — "Price changed", saved for THE previewed target
 * (catalog Phase 2b). Body: { target, unitPrice: number, effectiveDate: "YYYY-MM-DD", previewToken }.
 * Tier E. 2a's gated writer decides who may write which lane.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { applyPriceChange, CatalogItemError } from "@/lib/catalog/sku-item";
import { parseTarget } from "@/lib/catalog/sku-item-shared";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/price/apply`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const target = parseTarget(b.target);
  if (!target) return jsonError(400, "invalid_payload", { field: "target" });
  if (typeof b.unitPrice !== "number") return jsonError(400, "invalid_price", { field: "unitPrice" });
  if (typeof b.effectiveDate !== "string") return jsonError(400, "invalid_date", { field: "effectiveDate" });
  const previewToken = typeof b.previewToken === "string" && /^[0-9a-f]{8}$/.test(b.previewToken) ? b.previewToken : null;
  if (!previewToken) return jsonError(400, "invalid_payload", { field: "previewToken" });
  try {
    const r = await applyPriceChange(ctx, { skuId: id, target, unitPrice: b.unitPrice, effectiveDate: b.effectiveDate, previewToken });
    return jsonOk(r, 201);
  } catch (e) {
    if (e instanceof CatalogItemError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 5: `app/api/admin/catalog/sku/[id]/price-basis/route.ts`**

```ts
/** POST /api/admin/catalog/sku/[id]/price-basis — { basis: "per_case" | … | null } (catalog Phase 2b). Tier E. */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CatalogItemError, setSkuPriceBasis } from "@/lib/catalog/sku-item";
import { PRICE_BASES, type PriceBasis } from "@/lib/catalog/sku-item-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/price-basis`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  const basis = b.basis === null
    ? null
    : typeof b.basis === "string" && (PRICE_BASES as readonly string[]).includes(b.basis) ? (b.basis as PriceBasis) : undefined;
  if (basis === undefined) return jsonError(400, "invalid_basis", { field: "basis" });
  try {
    await setSkuPriceBasis(ctx, id, basis);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof CatalogItemError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 6: `app/api/admin/catalog/sku/[id]/pack-requests/[requestId]/dismiss/route.ts`**

```ts
/**
 * POST …/pack-requests/[requestId]/dismiss — "Nothing changed": close a door report (catalog Phase 2b).
 * Tier E. The report must belong to the SKU in the path (a report for another item is not found here).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { dismissPackChangeRequest, PackChangeRequestError } from "@/lib/pack-change-requests";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(requestId)) return jsonError(404, "not_found");
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/pack-requests/${requestId}/dismiss`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < 6) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  try {
    await dismissPackChangeRequest(ctx, { requestId, skuId: id });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof PackChangeRequestError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 7: Pin the tiers**

In `tests/step-up-tier-map.test.ts` `SERVER_TIER_MAP`, add:

```ts
  // Catalog Phase 2b — the item page's writes run in the edit window; the preview is a read (no tier).
  "app/api/admin/catalog/sku/[id]/pack/apply/route.ts": ["E"],
  "app/api/admin/catalog/sku/[id]/price/apply/route.ts": ["E"],
  "app/api/admin/catalog/sku/[id]/price-basis/route.ts": ["E"],
  "app/api/admin/catalog/sku/[id]/pack-requests/[requestId]/dismiss/route.ts": ["E"],
```

- [ ] **Step 8: Run and commit**

Run: `npx vitest run tests/catalog-item-routes.test.ts tests/step-up-tier-map.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS, and no tsc output.

```bash
git add app/api/admin/catalog tests/catalog-item-routes.test.ts tests/step-up-tier-map.test.ts
git commit -F - <<'EOF'
feat(catalog): item page routes — per-target preview (read), atomic pack apply, price apply, basis, dismiss (Tier E)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 8: Every string, en + es (tú)

The count assertion is gone (Astra 2b#13). The test names **every required key explicitly**, checks both languages and the placeholders, and refuses any `catalog.*` key that is not on the list, so an untranslated extra cannot slip in either.

**Files:**
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`
- Test: `tests/catalog-item-i18n.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 2b — every new string ships en AND es (AGENTS.md translate-from-day-one), by NAME. */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const REQUIRED = [
  "customers.catering.sort.quiet", "catalog.item.kind_bought", "catalog.item.version_global",
  "catalog.item.version_shop_default", "catalog.item.version_shop", "catalog.item.based_on_global",
  "catalog.item.shop_switcher", "catalog.item.shop_global", "catalog.item.inactive", "catalog.item.item_number",
  "catalog.item.connections", "catalog.item.comes_from", "catalog.item.no_vendor", "catalog.item.used_in",
  "catalog.item.used_in_none", "catalog.item.menu_count", "catalog.item.menu_none", "catalog.item.part_of_product",
  "catalog.item.buys_this_one", "catalog.item.buys_other", "catalog.item.off_here", "catalog.item.section.arrives",
  "catalog.item.section.price", "catalog.item.section.ordering", "catalog.item.section.counting",
  "catalog.item.section.barcodes", "catalog.item.section.history", "catalog.item.missing",
  "catalog.item.missing_none", "catalog.item.fix", "catalog.item.no_pack", "catalog.item.order_unit",
  "catalog.item.job_pack", "catalog.item.job_price", "catalog.item.back_to_default",
  "catalog.item.back_to_default_confirm", "catalog.item.cancel", "catalog.item.see_changes",
  "catalog.item.see_changes_everyone", "catalog.item.saved", "catalog.price.current", "catalog.price.none",
  "catalog.price.shop_own", "catalog.price.global_is", "catalog.price.cost_per_oz", "catalog.price.new",
  "catalog.price.date", "catalog.price.basis", "catalog.price.basis.unset", "catalog.price.basis.per_case",
  "catalog.price.basis.per_each", "catalog.price.basis.per_lb", "catalog.price.basis.per_dozen",
  "catalog.price.basis.per_bundle", "catalog.price.history", "catalog.price.history_shop",
  "catalog.price.history_global", "catalog.ordering.par", "catalog.ordering.par_none", "catalog.ordering.lane.human",
  "catalog.ordering.lane.global", "catalog.ordering.lane.auto", "catalog.ordering.order_days",
  "catalog.ordering.no_days", "catalog.ordering.change_pars", "catalog.counting.unit", "catalog.counting.open",
  "catalog.barcodes.none", "catalog.barcodes.level.case", "catalog.barcodes.level.inner", "catalog.history.live",
  "catalog.history.retired", "catalog.history.restore", "catalog.history.scope_global", "catalog.history.scope_shop",
  "catalog.history.empty", "catalog.requests.title", "catalog.requests.by", "catalog.requests.proposal_count",
  "catalog.requests.proposal_weight", "catalog.requests.review", "catalog.requests.dismiss",
  "catalog.pack.sentence_aria", "catalog.pack.container_label", "catalog.pack.inner_label", "catalog.pack.holds",
  "catalog.pack.qty_aria", "catalog.pack.remove_level", "catalog.pack.remove_level_aria", "catalog.pack.each_weighs",
  "catalog.pack.each_holds", "catalog.pack.amount", "catalog.pack.unit", "catalog.pack.leaf_uses_avg",
  "catalog.pack.add_level", "catalog.pack.error.empty_label", "catalog.pack.error.duplicate_label",
  "catalog.pack.error.label_is_measure_unit", "catalog.pack.error.bad_qty", "catalog.pack.error.no_leaf_unit",
  "catalog.preview.title", "catalog.preview.target_shop", "catalog.preview.target_global",
  "catalog.preview.no_shops", "catalog.preview.unaffected", "catalog.preview.no_change", "catalog.preview.price_not_current",
  "catalog.preview.order_unit", "catalog.preview.cost_per_oz", "catalog.preview.price", "catalog.preview.menu_items",
  "catalog.preview.menu_none", "catalog.preview.par_question_shop", "catalog.preview.par_question_global",
  "catalog.preview.par_question_inherited", "catalog.preview.par_keep_inherited", "catalog.preview.par_set_shop",
  "catalog.preview.par_status.global_par_shared",
  "catalog.preview.par_status.machine_par", "catalog.preview.par_keep", "catalog.preview.par_convert",
  "catalog.preview.par_cant_convert", "catalog.preview.par_gm_only", "catalog.preview.slot.weekday",
  "catalog.preview.slot.weekend", "catalog.preview.broken_lines", "catalog.preview.open_orders",
  "catalog.preview.save_shop", "catalog.preview.save_everyone", "catalog.error.generic",
  "catalog.error.version_changed", "catalog.error.forbidden", "catalog.error.not_found",
  "catalog.error.global_requires_moo", "catalog.error.invalid_price", "catalog.error.invalid_date",
  "catalog.error.step_up_required", "catalog.error.step_up_stale", "catalog.error.empty_chain",
  "catalog.error.label_is_measure_unit", "catalog.error.duplicate_label", "catalog.error.leaf_needs_avg",
  "catalog.error.unknown_measure", "catalog.error.chain_unreachable", "catalog.error.chain_cycle",
  "catalog.error.invalid_basis", "catalog.error.already_resolved", "catalog.error.no_shop_price",
  "catalog.error.not_live", "catalog.error.preview_stale", "catalog.error.par_changed",
  "catalog.error.request_mismatch", "catalog.error.request_not_open", "catalog.error.par_forbidden",
  "catalog.error.par_lane_mismatch", "catalog.error.dependencies_changed", "receiving.case_different.button", "receiving.case_different.title",
  "receiving.case_different.note", "receiving.case_different.inner_count", "receiving.case_different.each_weight",
  "receiving.case_different.unit", "receiving.case_different.send", "receiving.case_different.sent",
  "receiving.case_different.already", "receiving.case_different.error", "receiving.case_different.close",
  "notif.pack_change_request.title", "notif.pack_change_request.body", "admin.skus.open_item",
  "admin.skus.pack_requests.title", "admin.skus.pack_requests.review", "admin.skus.cost.use_item_page",
] as const;
const E = en as Record<string, string>;
const S = es as Record<string, string>;

describe("catalog Phase 2b strings", () => {
  it("every required string exists in both languages", () => {
    for (const k of REQUIRED) {
      expect(E[k], `en missing ${k}`).toBeTruthy();
      expect(S[k], `es missing ${k}`).toBeTruthy();
    }
  });
  it("placeholders match between languages", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const k of REQUIRED) expect(ph(S[k]!), k).toBe(ph(E[k]!));
  });
  it("no stray catalog.* key outside the list, in either language", () => {
    const req = new Set<string>(REQUIRED);
    for (const k of [...Object.keys(E), ...Object.keys(S)].filter((k) => k.startsWith("catalog."))) expect(req.has(k), k).toBe(true);
  });
  it("the readiness errand keys the page reuses, and 2a's two SKU-screen refusals, already exist", () => {
    for (const code of ["no_price", "price_stale", "no_countable_chain", "raw_pack_contents_missing", "weight_estimate", "no_par", "no_rhythm", "no_vendor", "no_order_unit", "recipe_unresolved"]) {
      expect(E[`admin.skus.data.errand.${code}`]).toBeTruthy();
      expect(S[`admin.skus.data.errand.${code}`]).toBeTruthy();
    }
    for (const k of ["admin.skus.error.global_requires_moo", "admin.skus.error.version_changed"]) {
      expect(E[k]).toBeTruthy();
      expect(S[k]).toBeTruthy();
    }
  });
});
```

Run: `npx vitest run tests/catalog-item-i18n.test.ts` → FAIL (`en missing catalog.item.kind_bought`).

- [ ] **Step 2: Add the English strings**

In `lib/i18n/en.json`, put a comma after the current last entry (after 2a, that is `"admin.skus.error.version_changed": …`) and paste this block just before the closing `}`. 2a already owns `admin.skus.error.global_requires_moo` and `admin.skus.error.version_changed`, so they are not repeated here; Task 12 rewords the first.

```json
  "customers.catering.sort.quiet": "Quiet repeat accounts",
  "catalog.item.kind_bought": "Bought item",
  "catalog.item.version_global": "Global default",
  "catalog.item.version_shop_default": "{shop} · using the global default",
  "catalog.item.version_shop": "{shop}'s version",
  "catalog.item.based_on_global": "Based on the global default",
  "catalog.item.shop_switcher": "Show it for",
  "catalog.item.shop_global": "Everyone (global)",
  "catalog.item.inactive": "Not active",
  "catalog.item.item_number": "Vendor item # {n}",
  "catalog.item.connections": "How it connects",
  "catalog.item.comes_from": "Comes from {vendor}",
  "catalog.item.no_vendor": "No vendor yet",
  "catalog.item.used_in": "Used in",
  "catalog.item.used_in_none": "Not used in any recipe",
  "catalog.item.menu_count": "Menu items: {n}",
  "catalog.item.menu_none": "Not on the menu",
  "catalog.item.part_of_product": "Part of {product}",
  "catalog.item.buys_this_one": "This shop buys this one",
  "catalog.item.buys_other": "This shop buys {sku} instead",
  "catalog.item.off_here": "Off at this shop",
  "catalog.item.section.arrives": "How it arrives",
  "catalog.item.section.price": "Price",
  "catalog.item.section.ordering": "Ordering",
  "catalog.item.section.counting": "Counting",
  "catalog.item.section.barcodes": "Barcodes",
  "catalog.item.section.history": "History",
  "catalog.item.missing": "What's missing",
  "catalog.item.missing_none": "Nothing is missing.",
  "catalog.item.fix": "Fix it",
  "catalog.item.no_pack": "We don't know how this arrives yet.",
  "catalog.item.order_unit": "You order it by the {unit} ({oz})",
  "catalog.item.job_pack": "It arrives differently now",
  "catalog.item.job_price": "Price changed",
  "catalog.item.back_to_default": "Back to default",
  "catalog.item.back_to_default_confirm": "Tap again: {shop} goes back to the global default",
  "catalog.item.cancel": "Cancel",
  "catalog.item.see_changes": "See what this changes",
  "catalog.item.see_changes_everyone": "See what this changes for everyone",
  "catalog.item.saved": "Saved.",
  "catalog.price.current": "{price} per {unit}",
  "catalog.price.none": "No price yet",
  "catalog.price.shop_own": "{shop} pays its own price",
  "catalog.price.global_is": "Global price: {price}",
  "catalog.price.cost_per_oz": "Cost per oz: {cost}",
  "catalog.price.new": "New price",
  "catalog.price.date": "Starting",
  "catalog.price.basis": "The vendor's price is for",
  "catalog.price.basis.unset": "Not set yet",
  "catalog.price.basis.per_case": "a whole case",
  "catalog.price.basis.per_each": "one piece",
  "catalog.price.basis.per_lb": "one pound",
  "catalog.price.basis.per_dozen": "a dozen",
  "catalog.price.basis.per_bundle": "a bundle",
  "catalog.price.history": "Recent prices",
  "catalog.price.history_shop": "this shop",
  "catalog.price.history_global": "global",
  "catalog.ordering.par": "{slot} par: {n}",
  "catalog.ordering.par_none": "{slot}: no par",
  "catalog.ordering.lane.human": "set for this shop",
  "catalog.ordering.lane.global": "the default",
  "catalog.ordering.lane.auto": "set by the app",
  "catalog.ordering.order_days": "Order days: {days}",
  "catalog.ordering.no_days": "No order days set here",
  "catalog.ordering.change_pars": "Change pars",
  "catalog.counting.unit": "Counted by the {unit}",
  "catalog.counting.open": "Open counts",
  "catalog.barcodes.none": "No barcode yet — the app learns it at the first delivery.",
  "catalog.barcodes.level.case": "case",
  "catalog.barcodes.level.inner": "inner pack",
  "catalog.history.live": "In use",
  "catalog.history.retired": "Replaced {date}",
  "catalog.history.restore": "Restore",
  "catalog.history.scope_global": "Global",
  "catalog.history.scope_shop": "This shop",
  "catalog.history.empty": "No versions yet.",
  "catalog.requests.title": "Reported at the door",
  "catalog.requests.by": "{who} said this case looks different · {date}",
  "catalog.requests.proposal_count": "They counted {n} inside",
  "catalog.requests.proposal_weight": "About {w} {unit} each",
  "catalog.requests.review": "Review it",
  "catalog.requests.dismiss": "Nothing changed",
  "catalog.pack.sentence_aria": "How it arrives, as a sentence",
  "catalog.pack.container_label": "What it comes in",
  "catalog.pack.inner_label": "What's inside",
  "catalog.pack.holds": "holds",
  "catalog.pack.qty_aria": "How many inside each {container}",
  "catalog.pack.remove_level": "Remove",
  "catalog.pack.remove_level_aria": "Remove the {container} level",
  "catalog.pack.each_weighs": "each {container} weighs",
  "catalog.pack.each_holds": "each {container} holds",
  "catalog.pack.amount": "How much",
  "catalog.pack.unit": "Unit",
  "catalog.pack.leaf_uses_avg": "Uses this item's per-piece weight ({oz} oz).",
  "catalog.pack.add_level": "Another container inside",
  "catalog.pack.error.empty_label": "Every container needs a name.",
  "catalog.pack.error.duplicate_label": "Two containers have the same name.",
  "catalog.pack.error.label_is_measure_unit": "That's a unit, not a container — name the container (case, bag, tub).",
  "catalog.pack.error.bad_qty": "Enter a number above zero.",
  "catalog.pack.error.no_leaf_unit": "Pick a unit.",
  "catalog.preview.title": "What this changes",
  "catalog.preview.target_shop": "Worked out for {shop} only",
  "catalog.preview.target_global": "Worked out for every shop on the global default",
  "catalog.preview.no_shops": "No shop uses the global default right now.",
  "catalog.preview.price_not_current": "Dated {date}, before the current price — it's kept as history and today's costs don't change.",
  "catalog.preview.unaffected": "Not changed (they have their own): {shops}",
  "catalog.preview.no_change": "Nothing changes.",
  "catalog.preview.order_unit": "Order unit",
  "catalog.preview.cost_per_oz": "Cost per oz",
  "catalog.preview.price": "Price",
  "catalog.preview.menu_items": "Sandwich costs",
  "catalog.preview.menu_none": "No sandwich cost moves.",
  "catalog.preview.par_question_shop": "{shop}'s {slot} par is {n} {unit} ({oz}). With the new {unit} that's {newOz}.",
  "catalog.preview.par_question_global": "The global {slot} par is {n} {unit} ({oz}), used by {shops}. With the new {unit} that's {newOz}.",
  "catalog.preview.par_question_inherited": "{shop} uses the global {slot} par: {n} {unit} ({oz}). With the new {unit} that's {newOz}.",
  "catalog.preview.par_keep_inherited": "Keep using the global par",
  "catalog.preview.par_set_shop": "Give {shop} its own par: {n} {unit}",
  "catalog.preview.par_status.global_par_shared": "The global {slot} par ({n} {unit}) stays as it is: {shops} also use it, and not all of their cases change.",
  "catalog.preview.par_status.machine_par": "The app's {slot} par at {shop} stops counting; the default answers until the app learns the new size.",
  "catalog.preview.par_keep": "Keep {n} {unit}",
  "catalog.preview.par_convert": "Change to {n} {unit}",
  "catalog.preview.par_cant_convert": "The new size has no weight yet, so the par stays as it is.",
  "catalog.preview.par_gm_only": "A GM can change the par.",
  "catalog.preview.slot.weekday": "weekday",
  "catalog.preview.slot.weekend": "weekend",
  "catalog.preview.broken_lines": "These recipe lines use a unit that goes away. Fix them after you save:",
  "catalog.preview.open_orders": "Orders not received yet (ordered in the old size):",
  "catalog.preview.save_shop": "Save for {shop}",
  "catalog.preview.save_everyone": "Save for everyone",
  "catalog.error.generic": "Something went wrong. Try again.",
  "catalog.error.version_changed": "Someone changed this while you were editing. Reload and try again.",
  "catalog.error.forbidden": "You can't change this.",
  "catalog.error.not_found": "This isn't one of your shops.",
  "catalog.error.global_requires_moo": "Only a Manager of Operations or higher can change it for everyone. Save it for your shop instead.",
  "catalog.error.invalid_price": "Enter a price above zero.",
  "catalog.error.invalid_date": "Pick the date the price starts.",
  "catalog.error.step_up_required": "Enter your password to keep editing.",
  "catalog.error.step_up_stale": "Enter your password to keep editing.",
  "catalog.error.empty_chain": "Tell us how it arrives first.",
  "catalog.error.label_is_measure_unit": "That's a unit, not a container — name the container (case, bag, tub).",
  "catalog.error.duplicate_label": "Two containers have the same name.",
  "catalog.error.leaf_needs_avg": "This item needs a weight per piece — end the sentence with a weight.",
  "catalog.error.unknown_measure": "That unit isn't set up yet.",
  "catalog.error.chain_unreachable": "Every container has to sit inside the one above it.",
  "catalog.error.chain_cycle": "A container can't hold itself.",
  "catalog.error.invalid_basis": "Pick what the vendor's price is for.",
  "catalog.error.already_resolved": "Someone already handled this report.",
  "catalog.error.no_shop_price": "This shop already uses the global price.",
  "catalog.error.not_live": "That version is no longer in use.",
  "catalog.error.preview_stale": "Something changed since you looked. See what this changes again.",
  "catalog.error.par_changed": "A par changed since you looked. See what this changes again.",
  "catalog.error.request_mismatch": "That report is for a different item or shop.",
  "catalog.error.request_not_open": "Someone already handled this report.",
  "catalog.error.par_forbidden": "A GM can change the par. Keep it, or ask your GM.",
  "catalog.error.par_lane_mismatch": "That par isn't part of this change. See what this changes again.",
  "catalog.error.dependencies_changed": "Something changed since you looked — review it again.",
  "receiving.case_different.button": "This case looks different",
  "receiving.case_different.title": "What's different?",
  "receiving.case_different.note": "Tell your manager",
  "receiving.case_different.inner_count": "How many inside (if you know)",
  "receiving.case_different.each_weight": "About how much each one weighs",
  "receiving.case_different.unit": "Unit",
  "receiving.case_different.send": "Send to my manager",
  "receiving.case_different.sent": "Sent. Your manager will review it.",
  "receiving.case_different.already": "Already reported — your manager has it.",
  "receiving.case_different.error": "Couldn't send it. Try again.",
  "receiving.case_different.close": "Close",
  "notif.pack_change_request.title": "{item} arrived different at {shop}",
  "notif.pack_change_request.body": "{who} reported it at the door. Open the SKU catalog in Admin to review it.",
  "admin.skus.open_item": "Open item page",
  "admin.skus.pack_requests.title": "Cases reported different at the door",
  "admin.skus.pack_requests.review": "Review {item} · {shop}",
  "admin.skus.cost.use_item_page": "Change it for your shop on the item page"
```

- [ ] **Step 3: Add the Spanish strings**

In `lib/i18n/es.json`, do the same:

```json
  "customers.catering.sort.quiet": "Cuentas habituales sin volver",
  "catalog.item.kind_bought": "Artículo comprado",
  "catalog.item.version_global": "Predeterminado global",
  "catalog.item.version_shop_default": "{shop} · usa el predeterminado global",
  "catalog.item.version_shop": "Versión de {shop}",
  "catalog.item.based_on_global": "Basada en el predeterminado global",
  "catalog.item.shop_switcher": "Verlo para",
  "catalog.item.shop_global": "Todos (global)",
  "catalog.item.inactive": "No activo",
  "catalog.item.item_number": "N.º de artículo del proveedor {n}",
  "catalog.item.connections": "Cómo se conecta",
  "catalog.item.comes_from": "Viene de {vendor}",
  "catalog.item.no_vendor": "Todavía sin proveedor",
  "catalog.item.used_in": "Se usa en",
  "catalog.item.used_in_none": "No se usa en ninguna receta",
  "catalog.item.menu_count": "Productos del menú: {n}",
  "catalog.item.menu_none": "No está en el menú",
  "catalog.item.part_of_product": "Parte de {product}",
  "catalog.item.buys_this_one": "Esta tienda compra este",
  "catalog.item.buys_other": "Esta tienda compra {sku} en su lugar",
  "catalog.item.off_here": "Desactivado en esta tienda",
  "catalog.item.section.arrives": "Cómo llega",
  "catalog.item.section.price": "Precio",
  "catalog.item.section.ordering": "Pedidos",
  "catalog.item.section.counting": "Conteo",
  "catalog.item.section.barcodes": "Códigos de barras",
  "catalog.item.section.history": "Historial",
  "catalog.item.missing": "Lo que falta",
  "catalog.item.missing_none": "No falta nada.",
  "catalog.item.fix": "Arreglar",
  "catalog.item.no_pack": "Todavía no sabemos cómo llega.",
  "catalog.item.order_unit": "Lo pides por {unit} ({oz})",
  "catalog.item.job_pack": "Ahora llega diferente",
  "catalog.item.job_price": "Cambió el precio",
  "catalog.item.back_to_default": "Volver al predeterminado",
  "catalog.item.back_to_default_confirm": "Toca otra vez: {shop} vuelve al predeterminado global",
  "catalog.item.cancel": "Cancelar",
  "catalog.item.see_changes": "Ver qué cambia",
  "catalog.item.see_changes_everyone": "Ver qué cambia para todos",
  "catalog.item.saved": "Guardado.",
  "catalog.price.current": "{price} por {unit}",
  "catalog.price.none": "Todavía sin precio",
  "catalog.price.shop_own": "{shop} paga su propio precio",
  "catalog.price.global_is": "Precio global: {price}",
  "catalog.price.cost_per_oz": "Costo por oz: {cost}",
  "catalog.price.new": "Precio nuevo",
  "catalog.price.date": "Desde",
  "catalog.price.basis": "El precio del proveedor es por",
  "catalog.price.basis.unset": "Sin definir",
  "catalog.price.basis.per_case": "una caja completa",
  "catalog.price.basis.per_each": "una pieza",
  "catalog.price.basis.per_lb": "una libra",
  "catalog.price.basis.per_dozen": "una docena",
  "catalog.price.basis.per_bundle": "un paquete",
  "catalog.price.history": "Precios recientes",
  "catalog.price.history_shop": "esta tienda",
  "catalog.price.history_global": "global",
  "catalog.ordering.par": "Par de {slot}: {n}",
  "catalog.ordering.par_none": "{slot}: sin par",
  "catalog.ordering.lane.human": "fijado para esta tienda",
  "catalog.ordering.lane.global": "el predeterminado",
  "catalog.ordering.lane.auto": "fijado por la app",
  "catalog.ordering.order_days": "Días de pedido: {days}",
  "catalog.ordering.no_days": "Sin días de pedido aquí",
  "catalog.ordering.change_pars": "Cambiar pares",
  "catalog.counting.unit": "Se cuenta por {unit}",
  "catalog.counting.open": "Abrir conteos",
  "catalog.barcodes.none": "Todavía sin código: la app lo aprende en la primera entrega.",
  "catalog.barcodes.level.case": "caja",
  "catalog.barcodes.level.inner": "paquete interior",
  "catalog.history.live": "En uso",
  "catalog.history.retired": "Reemplazada el {date}",
  "catalog.history.restore": "Restaurar",
  "catalog.history.scope_global": "Global",
  "catalog.history.scope_shop": "Esta tienda",
  "catalog.history.empty": "Todavía no hay versiones.",
  "catalog.requests.title": "Reportado en la puerta",
  "catalog.requests.by": "{who} dijo que esta caja se ve diferente · {date}",
  "catalog.requests.proposal_count": "Contaron {n} adentro",
  "catalog.requests.proposal_weight": "Como {w} {unit} cada uno",
  "catalog.requests.review": "Revisarlo",
  "catalog.requests.dismiss": "No cambió nada",
  "catalog.pack.sentence_aria": "Cómo llega, en una frase",
  "catalog.pack.container_label": "En qué viene",
  "catalog.pack.inner_label": "Qué trae adentro",
  "catalog.pack.holds": "trae",
  "catalog.pack.qty_aria": "Cuántos trae cada {container}",
  "catalog.pack.remove_level": "Quitar",
  "catalog.pack.remove_level_aria": "Quitar el nivel {container}",
  "catalog.pack.each_weighs": "cada {container} pesa",
  "catalog.pack.each_holds": "cada {container} trae",
  "catalog.pack.amount": "Cuánto",
  "catalog.pack.unit": "Unidad",
  "catalog.pack.leaf_uses_avg": "Usa el peso por pieza de este artículo ({oz} oz).",
  "catalog.pack.add_level": "Otro empaque adentro",
  "catalog.pack.error.empty_label": "Cada empaque necesita un nombre.",
  "catalog.pack.error.duplicate_label": "Dos empaques tienen el mismo nombre.",
  "catalog.pack.error.label_is_measure_unit": "Eso es una unidad, no un empaque: ponle nombre al empaque (caja, bolsa, tina).",
  "catalog.pack.error.bad_qty": "Escribe un número mayor que cero.",
  "catalog.pack.error.no_leaf_unit": "Elige una unidad.",
  "catalog.preview.title": "Qué cambia",
  "catalog.preview.target_shop": "Calculado solo para {shop}",
  "catalog.preview.target_global": "Calculado para todas las tiendas con el predeterminado global",
  "catalog.preview.no_shops": "Ahora ninguna tienda usa el predeterminado global.",
  "catalog.preview.price_not_current": "Con fecha {date}, anterior al precio actual: queda como historial y los costos de hoy no cambian.",
  "catalog.preview.unaffected": "No cambian (tienen el suyo): {shops}",
  "catalog.preview.no_change": "No cambia nada.",
  "catalog.preview.order_unit": "Unidad de pedido",
  "catalog.preview.cost_per_oz": "Costo por oz",
  "catalog.preview.price": "Precio",
  "catalog.preview.menu_items": "Costo de los sándwiches",
  "catalog.preview.menu_none": "No cambia el costo de ningún sándwich.",
  "catalog.preview.par_question_shop": "El par de {slot} de {shop} es {n} {unit} ({oz}). Con el nuevo {unit} son {newOz}.",
  "catalog.preview.par_question_global": "El par global de {slot} es {n} {unit} ({oz}) y lo usan {shops}. Con el nuevo {unit} son {newOz}.",
  "catalog.preview.par_question_inherited": "{shop} usa el par global de {slot}: {n} {unit} ({oz}). Con el nuevo {unit} son {newOz}.",
  "catalog.preview.par_keep_inherited": "Seguir usando el par global",
  "catalog.preview.par_set_shop": "Darle a {shop} su propio par: {n} {unit}",
  "catalog.preview.par_status.global_par_shared": "El par global de {slot} ({n} {unit}) se queda igual: también lo usan {shops} y no a todas les cambia la caja.",
  "catalog.preview.par_status.machine_par": "El par de {slot} que puso la app en {shop} deja de contar; el predeterminado responde hasta que la app aprenda el tamaño nuevo.",
  "catalog.preview.par_keep": "Mantener {n} {unit}",
  "catalog.preview.par_convert": "Cambiar a {n} {unit}",
  "catalog.preview.par_cant_convert": "El tamaño nuevo todavía no tiene peso, así que el par se queda igual.",
  "catalog.preview.par_gm_only": "Un GM puede cambiar el par.",
  "catalog.preview.slot.weekday": "entre semana",
  "catalog.preview.slot.weekend": "fin de semana",
  "catalog.preview.broken_lines": "Estas líneas de receta usan una unidad que desaparece. Corrígelas después de guardar:",
  "catalog.preview.open_orders": "Pedidos que aún no llegan (pedidos con el tamaño anterior):",
  "catalog.preview.save_shop": "Guardar para {shop}",
  "catalog.preview.save_everyone": "Guardar para todos",
  "catalog.error.generic": "Algo salió mal. Inténtalo de nuevo.",
  "catalog.error.version_changed": "Alguien cambió esto mientras editabas. Vuelve a cargar e inténtalo otra vez.",
  "catalog.error.forbidden": "No puedes cambiar esto.",
  "catalog.error.not_found": "Esta no es una de tus tiendas.",
  "catalog.error.global_requires_moo": "Solo un Gerente de Operaciones o superior puede cambiarlo para todos. Guárdalo para tu tienda.",
  "catalog.error.invalid_price": "Escribe un precio mayor que cero.",
  "catalog.error.invalid_date": "Elige la fecha en que empieza el precio.",
  "catalog.error.step_up_required": "Escribe tu contraseña para seguir editando.",
  "catalog.error.step_up_stale": "Escribe tu contraseña para seguir editando.",
  "catalog.error.empty_chain": "Primero dinos cómo llega.",
  "catalog.error.label_is_measure_unit": "Eso es una unidad, no un empaque: ponle nombre al empaque (caja, bolsa, tina).",
  "catalog.error.duplicate_label": "Dos empaques tienen el mismo nombre.",
  "catalog.error.leaf_needs_avg": "Este artículo necesita un peso por pieza: termina la frase con un peso.",
  "catalog.error.unknown_measure": "Esa unidad todavía no está configurada.",
  "catalog.error.chain_unreachable": "Cada empaque tiene que ir dentro del de arriba.",
  "catalog.error.chain_cycle": "Un empaque no puede contenerse a sí mismo.",
  "catalog.error.invalid_basis": "Elige por qué es el precio del proveedor.",
  "catalog.error.already_resolved": "Alguien ya atendió este reporte.",
  "catalog.error.no_shop_price": "Esta tienda ya usa el precio global.",
  "catalog.error.not_live": "Esa versión ya no está en uso.",
  "catalog.error.preview_stale": "Algo cambió desde que lo viste. Vuelve a ver qué cambia.",
  "catalog.error.par_changed": "Un par cambió desde que lo viste. Vuelve a ver qué cambia.",
  "catalog.error.request_mismatch": "Ese reporte es de otro artículo u otra tienda.",
  "catalog.error.request_not_open": "Alguien ya atendió este reporte.",
  "catalog.error.par_forbidden": "Un GM puede cambiar el par. Mantenlo o pídeselo a tu GM.",
  "catalog.error.par_lane_mismatch": "Ese par no es parte de este cambio. Vuelve a ver qué cambia.",
  "catalog.error.dependencies_changed": "Algo cambió desde que lo viste: revísalo otra vez.",
  "receiving.case_different.button": "Esta caja se ve diferente",
  "receiving.case_different.title": "¿Qué cambió?",
  "receiving.case_different.note": "Cuéntale a tu gerente",
  "receiving.case_different.inner_count": "Cuántos trae adentro (si sabes)",
  "receiving.case_different.each_weight": "Más o menos cuánto pesa cada uno",
  "receiving.case_different.unit": "Unidad",
  "receiving.case_different.send": "Enviar a mi gerente",
  "receiving.case_different.sent": "Enviado. Tu gerente lo va a revisar.",
  "receiving.case_different.already": "Ya se reportó: tu gerente ya lo tiene.",
  "receiving.case_different.error": "No se pudo enviar. Inténtalo de nuevo.",
  "receiving.case_different.close": "Cerrar",
  "notif.pack_change_request.title": "{item} llegó diferente a {shop}",
  "notif.pack_change_request.body": "{who} lo reportó en la puerta. Abre el catálogo de SKU en Admin para revisarlo.",
  "admin.skus.open_item": "Abrir la página del artículo",
  "admin.skus.pack_requests.title": "Cajas reportadas diferentes en la puerta",
  "admin.skus.pack_requests.review": "Revisar {item} · {shop}",
  "admin.skus.cost.use_item_page": "Cámbialo para tu tienda en la página del artículo"
```

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/catalog-item-i18n.test.ts && node -e "JSON.parse(require('fs').readFileSync('lib/i18n/en.json','utf8'));JSON.parse(require('fs').readFileSync('lib/i18n/es.json','utf8'));console.log('json ok')"`
Expected: PASS, then `json ok`.

Then check for duplicate keys, because JSON.parse silently keeps the last one. Run `node -e "for (const f of ['lib/i18n/en.json','lib/i18n/es.json']) { const k=[...require('fs').readFileSync(f,'utf8').matchAll(/^\s*\"([^\"]+)\":/gm)].map(m=>m[1]); console.log(f, k.length-new Set(k).size) }"` → each prints `0`.

```bash
git add lib/i18n/en.json lib/i18n/es.json tests/catalog-item-i18n.test.ts
git commit -F - <<'EOF'
feat(i18n): catalog Phase 2b strings — item page, sentence editor, per-target preview, door report (en + es)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 9: The sentence editor and the preview panel

**Files:**
- Create: `components/catalog/PackSentenceEditor.tsx`
- Create: `components/catalog/ChangePreviewPanel.tsx`
- Test: `tests/catalog-editor-ui.test.ts`

- [ ] **Step 1: Write the failing UI test**

```ts
/** Catalog Phase 2b — the sentence editor and "What this changes" render accessibly, at the 44px floor, in en and es. */
import { type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import { PackSentenceEditor } from "@/components/catalog/PackSentenceEditor";
import { ChangePreviewPanel } from "@/components/catalog/ChangePreviewPanel";
import type { PackPreview } from "@/lib/catalog/change-preview-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));
const units = [{ label: "oz", dimension: "weight" as const }, { label: "lb", dimension: "weight" as const }, { label: "each", dimension: "count" as const }];
const draft = { containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "4" }], leafQty: "10", leafUnit: "lb" };

describe("PackSentenceEditor", () => {
  it("reads as one sentence: 1 case · holds 4 bag · each bag weighs 10 lb — every control 44px", () => {
    const html = render(jsx(PackSentenceEditor, { draft, onChange: () => {}, units, skuClass: "raw", currentLeafUnit: "lb", avgOzPerEach: null, error: null, busy: false }));
    expect(html).toContain('role="group"');
    expect(html).toContain(en["catalog.pack.holds"]);
    expect(html).toContain("each bag weighs");
    expect(html).toContain('value="10"');
    expect(html).not.toContain(">each<"); // a raw item ends in a weight
    expect(html.match(/min-h-\[44px\]/g)!.length).toBeGreaterThanOrEqual(7);
  });
  it("names the problem in Spanish", () => {
    const html = render(jsx(PackSentenceEditor, { draft, onChange: () => {}, units, skuClass: "raw", currentLeafUnit: "lb", avgOzPerEach: null, error: { error: "duplicate_label", index: 1 }, busy: false }), "es");
    expect(html).toContain('role="alert"');
    expect(html).toContain(es["catalog.pack.error.duplicate_label"]);
  });
});

const shopDelta = {
  shopId: "A", shopName: "P Street",
  orderUnit: { before: "case", after: "case" }, orderUnitOz: { before: 320, after: 640 },
  costPerOz: { before: 0.4, after: 0.2 },
  menuItems: [{ id: "m", name: "Italian", nameEs: "Italiano", before: 1.6, after: 0.8 }],
  brokenLines: [{ recipeId: "r", recipeName: "Bag sub", quantity: 1, unit: "bag" }],
  openOrders: [{ poId: "p", displayCode: "CH-1", status: "placed", orderQty: 2, orderUnitLabel: "case", shopId: "A", shopName: "P Street" }],
};
const shopPreview: PackPreview = {
  kind: "pack", target: { kind: "shop", shopId: "A" }, changed: true, liveVersionId: null, basedOnVersionId: "gv",
  shops: [shopDelta], unaffected: [],
  pars: [
    { locationId: "A", shops: ["P Street"], slot: "weekday", lane: "human", status: "convertible", inherited: false, current: 3, currentOz: 960, keepOz: 1920, convertTo: 2 },
    { locationId: "A", shops: ["P Street"], slot: "weekend", lane: "global", status: "convertible", inherited: true, current: 4, currentOz: 1280, keepOz: 2560, convertTo: 2 },
  ],
  conversions: [{ locationId: "A", slot: "weekday", expected: 3, to: 2 }, { locationId: "A", slot: "weekend", expected: 4, to: 2, inherited: true }],
  snapshot: null,
  token: "0000abcd",
};
const globalPreview: PackPreview = {
  ...shopPreview, target: { kind: "global" }, liveVersionId: "gv", basedOnVersionId: null,
  unaffected: [{ shopId: "B", shopName: "Cap Hill" }],
  pars: [{ locationId: null, shops: ["P Street", "Cap Hill"], slot: "weekday", lane: "global", status: "global_par_shared", inherited: false, current: 3, currentOz: 960, keepOz: 1920, convertTo: null }],
  conversions: [],
};
const props = { canSave: true, canEditPar: true, chosen: new Set<string>(), onToggleConversion: () => {}, onSave: () => {}, busy: false };

describe("ChangePreviewPanel", () => {
  it("a shop preview: every knock-on, the shop's own par as a keep-or-convert choice, the inherited par as keep-or-give-its-own, and ONE save — for that shop", () => {
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: shopPreview }));
    expect(html).toContain(en["catalog.preview.title"]);
    expect(html).toContain("Worked out for P Street only");
    expect(html).toContain("$0.4000/oz → $0.2000/oz");
    expect(html).toContain("Italian");
    expect(html).toContain("Keep 3 case");
    expect(html).toContain("Change to 2 case");
    expect(html).toContain('aria-pressed="true"'); // keep is the default
    expect(html).toContain("P Street uses the global weekend par");
    expect(html).toContain(en["catalog.preview.par_keep_inherited"]); // the opt-in: keep inheriting…
    expect(html).toContain("Give P Street its own par: 2 case"); // …or give the shop its own par (2b r2#3)
    expect(html).toContain("Bag sub");
    expect(html).toContain("CH-1");
    expect(html).toContain("Save for P Street");
    expect(html).not.toContain(en["catalog.preview.save_everyone"]);
  });
  it("a global preview: the untouched shops, a shared global par named (no conversion), and the save for everyone", () => {
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: globalPreview }));
    expect(html).toContain(en["catalog.preview.target_global"]);
    expect(html).toContain("Cap Hill");
    expect(html).not.toContain("Change to");
    expect(html).toContain(en["catalog.preview.save_everyone"]);
    expect(html).not.toContain("Save for P Street");
  });
  it("an AGM sees the par question without the convert choice; Spanish names the sandwich in Spanish", () => {
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: shopPreview, canEditPar: false }), "es");
    expect(html).toContain(es["catalog.preview.par_gm_only"]);
    expect(html).not.toContain("Cambiar a 2");
    expect(html).toContain("Italiano");
  });
  it("a chosen conversion shows as pressed; every button is 44px", () => {
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: shopPreview, chosen: new Set(["A|weekday|3|2"]) }));
    expect(html.match(/aria-pressed="true"/g)!.length).toBe(2); // the chosen convert + the inherited row's default keep
    expect(html).toMatch(/aria-pressed="true"[^>]*>Change to 2 case/);
    expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/);
  });
});
```

Run: `npx vitest run tests/catalog-editor-ui.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `components/catalog/PackSentenceEditor.tsx`**

```tsx
"use client";

/**
 * PackSentenceEditor — THE pack editor on the item page (catalog Phase 2b; spec §4 "the pack editor
 * is always the sentence editor": first time and every edit, the per-piece weight inline).
 *
 *     1 [case]  holds [6] [bag]  each bag weighs [5] [lb]
 *
 * Controlled: the parent owns the draft (useState-only disclosure law); this renders and reports
 * edits. The model is pure (lib/catalog/pack-sentence-shared.ts). On this path it replaces the raw
 * ChainEditor ("…of / Another level / A measure unit"); PackChainWizard keeps the first-time add flow
 * in SkuBuilder until Phase 4's "New item" job takes over.
 */
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { leafUnitChoices, type SentenceDraft, type SentenceError } from "@/lib/catalog/pack-sentence-shared";

const field =
  "min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const smallBtn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const ERROR_KEY: Record<SentenceError, TranslationKey> = {
  empty_label: "catalog.pack.error.empty_label",
  duplicate_label: "catalog.pack.error.duplicate_label",
  label_is_measure_unit: "catalog.pack.error.label_is_measure_unit",
  bad_qty: "catalog.pack.error.bad_qty",
  no_leaf_unit: "catalog.pack.error.no_leaf_unit",
};
const MAX_LEVELS = 4;

export function PackSentenceEditor({
  draft,
  onChange,
  units,
  skuClass,
  currentLeafUnit,
  avgOzPerEach,
  error,
  busy,
}: {
  draft: SentenceDraft;
  onChange: (next: SentenceDraft) => void;
  units: ReadonlyArray<{ label: string; dimension: "weight" | "volume" | "count" }>;
  skuClass: string;
  currentLeafUnit: string | null;
  avgOzPerEach: number | null;
  error: { error: SentenceError; index: number } | null;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const n = draft.containers.length;
  const lastLabel = draft.containers[n - 1]?.label.trim() || "…";
  const choices = leafUnitChoices(units, skuClass, currentLeafUnit);
  const leafDimension = units.find((u) => u.label === draft.leafUnit)?.dimension ?? "weight";
  const bad = (i: number) => (error != null && error.index === i ? true : undefined);
  const setContainer = (i: number, patch: Partial<SentenceDraft["containers"][number]>) =>
    onChange({ ...draft, containers: draft.containers.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <div role="group" aria-label={t("catalog.pack.sentence_aria")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="text-base font-bold text-co-text">1</span>
        <input
          className={`${field} w-40`}
          value={draft.containers[0]?.label ?? ""}
          disabled={busy}
          aria-invalid={bad(0)}
          aria-label={t("catalog.pack.container_label")}
          onChange={(e) => setContainer(0, { label: e.target.value })}
        />
      </div>
      {draft.containers.slice(1).map((c, k) => {
        const i = k + 1;
        const parent = draft.containers[i - 1]?.label.trim() || "…";
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 pl-4">
            <span className="text-sm text-co-text-muted">{t("catalog.pack.holds")}</span>
            <input
              className={`${field} w-24`}
              inputMode="decimal"
              value={c.qty}
              disabled={busy}
              aria-invalid={bad(i)}
              aria-label={t("catalog.pack.qty_aria", { container: parent })}
              onChange={(e) => setContainer(i, { qty: e.target.value })}
            />
            <input
              className={`${field} w-40`}
              value={c.label}
              disabled={busy}
              aria-invalid={bad(i)}
              aria-label={t("catalog.pack.inner_label")}
              onChange={(e) => setContainer(i, { label: e.target.value })}
            />
            <button
              type="button"
              className={smallBtn}
              disabled={busy}
              aria-label={t("catalog.pack.remove_level_aria", { container: c.label.trim() || "…" })}
              onClick={() => onChange({ ...draft, containers: draft.containers.filter((_, j) => j !== i) })}
            >
              {t("catalog.pack.remove_level")}
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pl-4">
        <span className="text-sm text-co-text-muted">
          {t(leafDimension === "weight" ? "catalog.pack.each_weighs" : "catalog.pack.each_holds", { container: lastLabel })}
        </span>
        <input
          className={`${field} w-24`}
          inputMode="decimal"
          value={draft.leafQty}
          disabled={busy}
          aria-invalid={bad(n - 1)}
          aria-label={t("catalog.pack.amount")}
          onChange={(e) => onChange({ ...draft, leafQty: e.target.value })}
        />
        <select
          className={`${field} w-28`}
          value={draft.leafUnit}
          disabled={busy}
          aria-label={t("catalog.pack.unit")}
          onChange={(e) => onChange({ ...draft, leafUnit: e.target.value })}
        >
          {draft.leafUnit === "" ? <option value="">—</option> : null}
          {choices.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>
      {leafDimension !== "weight" && avgOzPerEach != null ? (
        <p className="text-xs text-co-text-dim">{t("catalog.pack.leaf_uses_avg", { oz: String(avgOzPerEach) })}</p>
      ) : null}
      {n < MAX_LEVELS ? (
        <button
          type="button"
          className={`${smallBtn} self-start`}
          disabled={busy}
          onClick={() => onChange({ ...draft, containers: [...draft.containers, { label: "", qty: "" }] })}
        >
          {t("catalog.pack.add_level")}
        </button>
      ) : null}
      {error ? <p role="alert" className="text-sm text-co-cta-text">{t(ERROR_KEY[error.error])}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: Create `components/catalog/ChangePreviewPanel.tsx`**

```tsx
"use client";

/**
 * "WHAT THIS CHANGES" (catalog Phase 2b; spec §4; lead decision D4). Renders a preview the server
 * computed for ONE save target: which shops it reaches (each with its own before → after), which it
 * does not, and one row per par lane with what happens to it. A conversion is a CHOICE per row,
 * offered only where the preview offered it; the save button is the save for THIS preview's target
 * — "Save for everyone" exists only on a preview computed for everyone. Nothing is saved before the
 * person has seen what it does.
 */
import { useTranslation } from "@/lib/i18n/provider";
import { formatDateLabel, formatQuantity } from "@/lib/i18n/format";
import { conversionKey, type PackPreview, type PreviewParRow, type PricePreview } from "@/lib/catalog/change-preview-shared";

const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const choice = (on: boolean) =>
  `inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 px-3 text-sm font-bold text-co-text disabled:opacity-50 ${on ? "border-co-text bg-co-surface-2" : "border-co-border bg-co-surface hover:border-co-text"}`;
const groupLabel = "text-[12px] font-bold tracking-wide text-co-text-muted";

export function ChangePreviewPanel({
  preview,
  canSave,
  canEditPar,
  chosen,
  onToggleConversion,
  onSave,
  busy,
}: {
  preview: PackPreview | PricePreview;
  /** May this actor save THIS preview's target (its shop, or everyone)? */
  canSave: boolean;
  canEditPar: boolean;
  /** conversionKey(…) of every conversion the person chose; absent = keep. */
  chosen: ReadonlySet<string>;
  onToggleConversion: (key: string, convert: boolean) => void;
  onSave: () => void;
  busy: boolean;
}) {
  const { t, language } = useTranslation();
  const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
  const perOz = (n: number | null) => (n == null ? "—" : `$${n.toFixed(4)}/oz`);
  const oz = (n: number | null) => (n == null ? "—" : `${formatQuantity(n, language)} oz`);
  const qty = (n: number) => formatQuantity(n, language);
  const slotName = (s: "weekday" | "weekend") => t(s === "weekday" ? "catalog.preview.slot.weekday" : "catalog.preview.slot.weekend");
  const row = (label: string, before: string, after: string) => (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-co-border py-2 text-sm">
      <span className="text-co-text-muted">{label}</span>
      <span className="font-bold text-co-text">{`${before} → ${after}`}</span>
    </div>
  );
  const isGlobal = preview.target.kind === "global";
  const targetShopName = preview.target.kind === "shop" ? (preview.shops[0]?.shopName ?? "") : "";
  const nothing = preview.kind === "pack" && !preview.changed;

  const parText = (p: PreviewParRow, unit: string): string => {
    const base = { slot: slotName(p.slot), n: qty(p.current), unit };
    if (p.inherited) {
      return t("catalog.preview.par_question_inherited", { ...base, oz: oz(p.currentOz), newOz: oz(p.keepOz), shop: p.shops[0] ?? "" });
    }
    switch (p.status) {
      case "global_par_shared":
        return t("catalog.preview.par_status.global_par_shared", { ...base, shops: p.shops.join(", ") });
      case "machine_par":
        return t("catalog.preview.par_status.machine_par", { slot: base.slot, shop: p.shops[0] ?? "" });
      default:
        return p.locationId === null
          ? t("catalog.preview.par_question_global", { ...base, oz: oz(p.currentOz), newOz: oz(p.keepOz), shops: p.shops.join(", ") })
          : t("catalog.preview.par_question_shop", { ...base, oz: oz(p.currentOz), newOz: oz(p.keepOz), shop: p.shops[0] ?? "" });
    }
  };

  return (
    <section aria-label={t("catalog.preview.title")} className="mt-3 rounded-xl border-2 border-co-border-2 bg-co-surface-inset p-3">
      <h3 className={groupLabel}>{t("catalog.preview.title")}</h3>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {isGlobal ? t("catalog.preview.target_global") : t("catalog.preview.target_shop", { shop: targetShopName })}
      </p>

      {nothing ? (
        <p className="mt-2 text-sm text-co-text">{t("catalog.preview.no_change")}</p>
      ) : (
        <>
          {preview.shops.length === 0 ? <p className="mt-2 text-sm text-co-text">{t("catalog.preview.no_shops")}</p> : null}

          {preview.kind === "pack"
            ? preview.shops.map((s) => (
                <div key={s.shopId} className="mt-3">
                  <p className={groupLabel}>{s.shopName}</p>
                  {row(t("catalog.preview.order_unit"), `${s.orderUnit.before ?? "—"} (${oz(s.orderUnitOz.before)})`, `${s.orderUnit.after ?? "—"} (${oz(s.orderUnitOz.after)})`)}
                  {row(t("catalog.preview.cost_per_oz"), perOz(s.costPerOz.before), perOz(s.costPerOz.after))}
                  <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.preview.menu_items")}</p>
                  {s.menuItems.length === 0 ? (
                    <p className="text-sm text-co-text">{t("catalog.preview.menu_none")}</p>
                  ) : (
                    <ul className="mt-1 flex flex-col">
                      {s.menuItems.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1 text-sm">
                          <span className="text-co-text">{language === "es" && m.nameEs ? m.nameEs : m.name}</span>
                          <span className="font-bold text-co-text">{`${money(m.before)} → ${money(m.after)}`}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.brokenLines.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-sm font-bold text-co-warning-text">{t("catalog.preview.broken_lines")}</p>
                      <ul className="mt-1 list-disc pl-5 text-sm text-co-text">
                        {s.brokenLines.map((l) => (
                          <li key={`${l.recipeId}-${l.unit ?? ""}-${l.quantity}`}>{`${l.recipeName}: ${qty(l.quantity)} ${l.unit ?? ""}`}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {s.openOrders.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.preview.open_orders")}</p>
                      <ul className="mt-1 list-disc pl-5 text-sm text-co-text">
                        {s.openOrders.map((o) => (
                          <li key={o.poId}>{`${o.displayCode} · ${qty(o.orderQty)} ${o.orderUnitLabel ?? ""}`}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ))
            : preview.shops.map((s) => (
                <div key={s.shopId} className="mt-3">
                  <p className={groupLabel}>{s.shopName}</p>
                  {row(t("catalog.preview.price"), money(s.price.before), money(s.price.after))}
                  {!s.becomesCurrent ? (
                    <p className="text-sm text-co-warning-text">{t("catalog.preview.price_not_current", { date: formatDateLabel(preview.effectiveDate, language) })}</p>
                  ) : null}
                  {row(t("catalog.preview.cost_per_oz"), perOz(s.costPerOz.before), perOz(s.costPerOz.after))}
                  {s.menuItems.length === 0 ? (
                    <p className="text-sm text-co-text">{t("catalog.preview.menu_none")}</p>
                  ) : (
                    <ul className="mt-1 flex flex-col">
                      {s.menuItems.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1 text-sm">
                          <span className="text-co-text">{language === "es" && m.nameEs ? m.nameEs : m.name}</span>
                          <span className="font-bold text-co-text">{`${money(m.before)} → ${money(m.after)}`}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

          {preview.unaffected.length > 0 ? (
            <p className="mt-3 text-sm text-co-text-muted">{t("catalog.preview.unaffected", { shops: preview.unaffected.map((u) => u.shopName).join(", ") })}</p>
          ) : null}

          {preview.kind === "pack" && preview.pars.length > 0 ? (
            <div className="mt-3 flex flex-col gap-3">
              {preview.pars.map((p) => {
                const unit = (p.locationId !== null ? preview.shops.find((s) => s.shopId === p.locationId) : preview.shops[0])?.orderUnit.before ?? "";
                const conv = p.status === "convertible" && p.convertTo != null
                  ? (p.inherited
                      ? { locationId: p.locationId, slot: p.slot, expected: p.current, to: p.convertTo, inherited: true as const }
                      : { locationId: p.locationId, slot: p.slot, expected: p.current, to: p.convertTo })
                  : null;
                const key = conv ? conversionKey(conv) : `${p.locationId ?? "global"}|${p.slot}|${p.status}`;
                const on = conv != null && chosen.has(key);
                return (
                  <div key={key} className="flex flex-col gap-2">
                    <p className="text-sm text-co-text">{parText(p, unit)}</p>
                    {conv && canEditPar ? (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={choice(!on)} aria-pressed={!on} disabled={busy} onClick={() => onToggleConversion(key, false)}>
                          {p.inherited ? t("catalog.preview.par_keep_inherited") : t("catalog.preview.par_keep", { n: qty(p.current), unit })}
                        </button>
                        <button type="button" className={choice(on)} aria-pressed={on} disabled={busy} onClick={() => onToggleConversion(key, true)}>
                          {p.inherited
                            ? t("catalog.preview.par_set_shop", { shop: p.shops[0] ?? "", n: qty(conv.to), unit })
                            : t("catalog.preview.par_convert", { n: qty(conv.to), unit })}
                        </button>
                      </div>
                    ) : conv ? (
                      <p className="text-xs text-co-text-dim">{t("catalog.preview.par_gm_only")}</p>
                    ) : p.status === "no_weight" ? (
                      <p className="text-xs text-co-text-dim">{t("catalog.preview.par_cant_convert")}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {canSave ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} disabled={busy} onClick={onSave}>
                {isGlobal ? t("catalog.preview.save_everyone") : t("catalog.preview.save_shop", { shop: targetShopName })}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

```


- [ ] **Step 4: Run and commit**

Run: `npx vitest run tests/catalog-editor-ui.test.ts`
Expected: PASS, 0 failed.

```bash
git add components/catalog/PackSentenceEditor.tsx components/catalog/ChangePreviewPanel.tsx tests/catalog-editor-ui.test.ts
git commit -F - <<'EOF'
feat(catalog): the always-sentence pack editor and the per-target "What this changes" panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 10: The connected item page — client body + server page

Layout follows spec §4 "Screens". On a **phone** (one column), the connections strip sits at the top and the sections follow. On **tablet/desktop** (`md:`), the sections take the main column and the connections move to a side panel. Every function exists at every size. The only horizontal scroller is the shop switcher, inside its own container, so the page never scrolls sideways. The disclosure doctrine holds. Identity and alerts ("What's missing", door reports) are always visible. Sections are default-collapsed `CollapsibleSection`s with an i18n'd summary in the header, opened by a job or a fix-it button. Disclosure state lives in `useState` only.

**Files:**
- Create: `lib/catalog/request-guard-shared.ts`
- Create: `components/catalog/SkuItemClient.tsx`
- Create: `app/admin/catalog/sku/[id]/page.tsx`
- Modify: `tests/step-up-tier-map.test.ts`
- Test: `tests/catalog-item-ui.test.ts`, `tests/catalog-item-navigation.test.ts`

- [ ] **Step 1: Write the failing UI test**

```ts
/** Catalog Phase 2b — the item page body: identity, version, connections, what's missing, sections, jobs, history (en + es). */
import { type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import type { SkuItemView } from "@/lib/catalog/sku-item-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: async () => "ok", forgetStepUp: () => {} }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => async () => ({ ok: true, data: {} }) }));
const { SkuItemClient } = await import("@/components/catalog/SkuItemClient");

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const view: SkuItemView = {
  sku: { id: "7d0c1f2e-0000-4000-8000-000000000001", name: "Turkey", itemNumber: "TK-9", active: true, skuClass: "raw", priceBasis: "per_case", avgOzPerEach: null, packFormat: "case" },
  vendor: { id: "v", name: "Baldor", active: true },
  product: null,
  shops: [{ id: SHOP, name: "P Street" }],
  scope: SHOP, scopeName: "P Street",
  can: { editShop: true, editGlobal: false, editPar: true, editBasis: false },
  pack: {
    levels: [
      { id: "c", label: "case", containsQty: 4, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "b", label: "bag", containsQty: 10, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
    ],
    versionId: "sv", isShopVersion: true, effectiveFrom: "2026-10-10T00:00:00Z", globalVersionId: "gv",
    orderUnit: "case", orderUnitOz: 640, descriptor: "case → 4 bag → 10 lb",
  },
  price: { value: 150, effectiveDate: "2026-10-10", isShopLane: true, globalValue: 128, costPerOz: 0.234375, history: [{ id: "p", unitPrice: 150, effectiveDate: "2026-10-10", shop: true }] },
  ordering: { slots: [{ slot: "weekday", value: 3, lane: "human" }, { slot: "weekend", value: null, lane: "none" }], orderDays: [1, 4], offHere: false },
  counting: { unit: "case" },
  barcodes: [],
  connections: { uses: [{ id: "r", name: "Italian build" }], menuItems: [{ id: "m", name: "Italian", nameEs: "Italiano", cost: 2.1 }] },
  missing: [{ code: "no_rhythm", blocks: [], degrades: ["order"] }],
  history: [
    { id: "sv", scope: "shop", active: true, effectiveFrom: "2026-10-10T00:00:00Z", retiredAt: null, who: "Ana", labels: ["case", "bag"] },
    { id: "gv-old", scope: "global", active: false, effectiveFrom: "2026-08-01T00:00:00Z", retiredAt: "2026-09-01T00:00:00Z", who: null, labels: ["case", "bag"] },
  ],
  openRequests: [{ id: "req", filedBy: "Luis", filedAt: "2026-10-14T13:00:00Z", note: "Bags are bigger", proposal: { innerCount: 4, eachWeight: 10, eachUnit: "lb" } }],
  measures: [{ label: "oz", dimension: "weight", toBaseFactor: 1 }, { label: "lb", dimension: "weight", toBaseFactor: 16 }],
};
const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));

describe("SkuItemClient", () => {
  it("says which version it is showing, how it connects, and what is missing — always visible", () => {
    const html = render(jsx(SkuItemClient, { view, job: null, requestId: null }));
    expect(html).toContain("P Street&#x27;s version");
    expect(html).toContain(en["catalog.item.connections"]);
    expect(html).toContain("Comes from Baldor");
    expect(html).toContain("Italian build");
    expect(html).toContain(en["catalog.item.missing"]);
    expect(html).toContain(en["admin.skus.data.errand.no_rhythm"]);
    expect(html).toContain(en["catalog.requests.title"]);
    expect(html).toContain("Bags are bigger");
  });
  it("sections are collapsed with their summary in the header; every control is 44px", () => {
    const html = render(jsx(SkuItemClient, { view, job: null, requestId: null }));
    for (const k of ["catalog.item.section.arrives", "catalog.item.section.price", "catalog.item.section.ordering", "catalog.item.section.counting", "catalog.item.section.barcodes", "catalog.item.section.history"] as const) {
      expect(html).toContain(en[k]);
    }
    expect(html).toContain("case → 4 bag → 10 lb");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/);
  });
  it("job=pack opens the sentence editor, prefilled from the door report", () => {
    const html = render(jsx(SkuItemClient, { view, job: "pack", requestId: "req" }));
    expect(html).toContain(en["catalog.pack.sentence_aria"]);
    expect(html).toContain('value="4"');
    expect(html).toContain(en["catalog.item.see_changes"]);
  });
  it("the preview for everyone is offered only to those who may save for everyone", () => {
    expect(render(jsx(SkuItemClient, { view, job: "pack", requestId: null }))).not.toContain(en["catalog.item.see_changes_everyone"]);
    const moo = { ...view, can: { ...view.can, editGlobal: true } };
    expect(render(jsx(SkuItemClient, { view: moo, job: "pack", requestId: null }))).toContain(en["catalog.item.see_changes_everyone"]);
  });
  it("job=price opens the price editor; Spanish throughout", () => {
    const html = render(jsx(SkuItemClient, { view, job: "price", requestId: null }), "es");
    expect(html).toContain(es["catalog.price.new"]);
    expect(html).toContain("Versión de P Street");
    expect(html).toContain(es["catalog.item.connections"]);
  });
});
```

Run: `npx vitest run tests/catalog-item-ui.test.ts` → FAIL (module not found).

- [ ] **Step 2: The navigation guard — `lib/catalog/request-guard-shared.ts` and its test**

vitest runs in node with no jsdom, so the navigation contract is proven in two halves. The pure guard is tested by driving it exactly as the page does. The remount is a source pin on the page's `key`, together with `itemClientKey`'s identity (Task 6).

`tests/catalog-item-navigation.test.ts`:

```ts
/** Catalog Phase 2b — switching shop (or SKU) never shows the previous scope's draft or a late preview (Astra 2b#5). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import { itemClientKey } from "@/lib/catalog/sku-item-shared";

describe("late responses are dropped", () => {
  it("shop A's slow preview resolves after shop B's: A's answer is discarded", async () => {
    const g = createRequestGuard();
    let resolveA!: (v: string) => void;
    const a = g.run(() => new Promise<string>((r) => { resolveA = r; }));
    const b = g.run(async () => "B");
    expect(await b).toBe("B");
    resolveA("A");
    expect(await a).toBeNull();
  });
  it("an edited draft (or a left job) invalidates the in-flight preview", async () => {
    const g = createRequestGuard();
    let resolveA!: (v: string) => void;
    const a = g.run(() => new Promise<string>((r) => { resolveA = r; }));
    g.invalidate();
    resolveA("A");
    expect(await a).toBeNull();
  });
});

describe("a shop switch remounts the page body", () => {
  it("the client is keyed by (SKU, shop), and every preview goes through the guard", () => {
    expect(readFileSync("app/admin/catalog/sku/[id]/page.tsx", "utf8")).toContain("key={itemClientKey(view.sku.id, view.scope)}");
    expect(itemClientKey("s", "a")).not.toBe(itemClientKey("s", "b"));
    const client = readFileSync("components/catalog/SkuItemClient.tsx", "utf8");
    expect(client.match(/guard\.run\(/g)?.length).toBe(2);
    expect(client).toContain("target: preview.target,");
    expect(client).toContain("previewToken: preview.token");
  });
});
```

`lib/catalog/request-guard-shared.ts`:

```ts
/**
 * A tiny client-safe guard against late responses (catalog Phase 2b). Every preview request runs
 * through `run`; only the NEWEST request's answer is returned — an older one resolves to null and is
 * dropped. `invalidate` drops whatever is in flight (the draft changed, the job was left). Paired with
 * the page keying its client by (SKU, shop), a slow answer for one shop can never land in another.
 */
export interface RequestGuard {
  run<T>(fn: () => Promise<T>): Promise<T | null>;
  invalidate(): void;
}

export function createRequestGuard(): RequestGuard {
  let generation = 0;
  return {
    async run<T>(fn: () => Promise<T>): Promise<T | null> {
      const mine = ++generation;
      const result = await fn();
      return mine === generation ? result : null;
    },
    invalidate() {
      generation += 1;
    },
  };
}
```

Run: `npx vitest run tests/catalog-item-navigation.test.ts` → the two guard tests PASS; the remount pin FAILS until Steps 3–4 land.

- [ ] **Step 3: Create `components/catalog/SkuItemClient.tsx`**

```tsx
"use client";

/**
 * THE CONNECTED ITEM PAGE for a bought item — client body (catalog Phase 2b; spec §4, §5 jobs 1 + 5).
 * Top: what it is, which version you're seeing, a shop switcher. Then "How it connects" (a strip on a
 * phone, a side panel from md:), "What's missing" with fix-it buttons, and the sections How it
 * arrives / Price / Ordering / Counting / Barcodes / History. Jobs: "It arrives differently now"
 * (sentence editor → What this changes → Save for my shop / for everyone) and "Price changed".
 *
 * Every write asks Tier E (the 15-minute catalog edit window) and goes through useStepUpPost, which
 * forgets a refused unlock. The preview is a read (postJson, no step-up) for ONE target — this shop,
 * or everyone — and a save posts exactly that preview's target and token (D4). Late answers are
 * dropped (createRequestGuard); the page remounts this body per (SKU, shop). Disclosure state is useState only.
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { formatDateLabel, formatQuantity, formatWeekday } from "@/lib/i18n/format";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { PackSentenceEditor } from "@/components/catalog/PackSentenceEditor";
import { ChangePreviewPanel } from "@/components/catalog/ChangePreviewPanel";
import { levelsFromSentence, sentenceFromLevels, type SentenceDraft, type SentenceError } from "@/lib/catalog/pack-sentence-shared";
import { proposalToSentence } from "@/lib/pack-change-requests-shared";
import {
  fixItSection, PRICE_BASES, skuItemHref, sundayAnchoredDate, versionLabelKind,
  type ItemJob, type ItemSection, type SkuItemView,
} from "@/lib/catalog/sku-item-shared";
import { conversionKey, type PackPreview, type PreviewTarget, type PricePreview } from "@/lib/catalog/change-preview-shared";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import type { DataErrandCode } from "@/lib/sku-data-readiness";
import { skuCatalogHref } from "@/lib/admin/product-item-links-shared";

const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const btnDanger =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-cta-text disabled:opacity-50";
const field =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const fieldLabel = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";
const linkRow = "flex min-h-[44px] items-center rounded-lg px-2 text-sm font-bold text-co-text underline hover:bg-co-surface-2";

const CATALOG_ERRORS = new Set([
  "version_changed", "forbidden", "not_found", "global_requires_moo", "invalid_price", "invalid_date",
  "step_up_required", "step_up_stale", "empty_chain", "label_is_measure_unit", "duplicate_label",
  "leaf_needs_avg", "unknown_measure", "chain_unreachable", "chain_cycle", "invalid_basis",
  "already_resolved", "no_shop_price", "not_live",
  // r2: the per-target preview and the atomic apply.
  "preview_stale", "par_changed", "request_mismatch", "request_not_open", "par_forbidden", "par_lane_mismatch",
  "dependencies_changed",
]);
const errorKey = (code: string): TranslationKey =>
  (CATALOG_ERRORS.has(code) ? `catalog.error.${code}` : "catalog.error.generic") as TranslationKey;

type SectionState = Record<ItemSection, boolean>;

export function SkuItemClient({ view, job, requestId }: { view: SkuItemView; job: ItemJob | null; requestId: string | null }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const base = `/api/admin/catalog/sku/${view.sku.id}`;
  const measureLabels = new Set(view.measures.map((m) => m.label));
  const firstWeight = view.measures.find((m) => m.dimension === "weight")?.label ?? "oz";
  const canEditPack = view.can.editShop || view.can.editGlobal;
  const canSaveShop = view.can.editShop;

  const [activeRequestId, setActiveRequestId] = useState<string | null>(requestId);
  const draftFor = (reqId: string | null): SentenceDraft => {
    const current = sentenceFromLevels(view.pack.levels);
    const seeded: SentenceDraft = current ?? { containers: [{ label: view.pack.orderUnit ?? "case", qty: "1" }], leafQty: "", leafUnit: firstWeight };
    const req = reqId ? view.openRequests.find((r) => r.id === reqId) : undefined;
    return req?.proposal ? proposalToSentence(req.proposal, seeded) : seeded;
  };
  const [open, setOpen] = useState<SectionState>({
    arrives: job === "pack", price: job === "price", ordering: false, counting: false, barcodes: false, connections: false, history: false,
  });
  const [editing, setEditing] = useState<ItemJob | null>(job);
  const [draft, setDraft] = useState<SentenceDraft>(() => draftFor(requestId));
  const [sentenceError, setSentenceError] = useState<{ error: SentenceError; index: number } | null>(null);
  const [preview, setPreview] = useState<PackPreview | PricePreview | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  // A late preview from a superseded request (an edited draft, a left job) is dropped, never shown.
  const [guard] = useState(() => createRequestGuard());
  const [priceText, setPriceText] = useState("");
  const [priceDate, setPriceDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"pack" | "price" | null>(null);

  const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
  const oz = (n: number | null) => (n == null ? "—" : `${formatQuantity(n, language)} oz`);
  const day = (iso: string) => formatDateLabel(iso.slice(0, 10), language);
  const toggle = (s: ItemSection) => setOpen((o) => ({ ...o, [s]: !o[s] }));
  const fail = (code: string) => setMessage(t(errorKey(code)));
  const done = (key: TranslationKey) => { guard.invalidate(); setMessage(t(key)); setEditing(null); setPreview(null); router.refresh(); };

  const startJob = (j: ItemJob, reqId: string | null = activeRequestId) => {
    guard.invalidate(); setEditing(j); setPreview(null); setMessage(null); setChosen(new Set()); setSentenceError(null);
    setOpen((o) => ({ ...o, [j === "pack" ? "arrives" : "price"]: true }));
    if (j === "pack") { setActiveRequestId(reqId); setDraft(draftFor(reqId)); }
  };

  const fixIt = (code: DataErrandCode) => {
    const s = fixItSection(code);
    setOpen((o) => ({ ...o, [s]: true }));
    if (s === "arrives" && canEditPack) startJob("pack");
    if (s === "price" && canEditPack) startJob("price");
    document.getElementById(`item-${s}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ── Pack ──
  const builtLevels = () => {
    const built = levelsFromSentence(draft, measureLabels);
    if (!built.ok) { setSentenceError({ error: built.error, index: built.index }); return null; }
    setSentenceError(null);
    return built.levels;
  };
  /** "What this changes" for ONE target: this shop only, or everyone riding the global default (D4). */
  const previewPack = async (target: PreviewTarget) => {
    setMessage(null); setPreview(null); setChosen(new Set());
    const levels = builtLevels();
    if (!levels) return;
    setBusy(true);
    const r = await guard.run(() => postJson(`${base}/preview`, { kind: "pack", target, levels }));
    setBusy(false);
    if (r === null) return; // superseded — a newer request (or an edited draft) owns the panel
    if (r.ok) setPreview(r.data.preview as PackPreview); else fail(r.code);
  };
  /** Save exactly what the preview showed: its target, its token, the conversions the person chose. */
  const savePack = async () => {
    if (preview?.kind !== "pack") return;
    const levels = builtLevels();
    if (!levels) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/pack/apply`, {
      target: preview.target,
      levels,
      conversions: preview.conversions.filter((c) => chosen.has(conversionKey(c))),
      requestId: activeRequestId,
      previewToken: preview.token,
    });
    setBusy(false);
    if (r.ok) done("catalog.item.saved"); else fail(r.code);
  };

  // ── Price ──
  const priceValue = () => Number(priceText);
  const previewPrice = async (target: PreviewTarget) => {
    setMessage(null); setPreview(null);
    if (!(priceValue() > 0)) { fail("invalid_price"); return; }
    // The date is part of WHAT this changes: a back-dated price may never become today's (Astra 2b r3#2).
    if (!priceDate) { fail("invalid_date"); return; }
    setBusy(true);
    const r = await guard.run(() => postJson(`${base}/preview`, { kind: "price", target, unitPrice: priceValue(), effectiveDate: priceDate }));
    setBusy(false);
    if (r === null) return;
    if (r.ok) setPreview(r.data.preview as PricePreview); else fail(r.code);
  };
  const savePrice = async () => {
    if (preview?.kind !== "price") return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/price/apply`, { target: preview.target, unitPrice: preview.newPrice, effectiveDate: preview.effectiveDate, previewToken: preview.token });
    setBusy(false);
    if (r.ok) { setPriceText(""); setPriceDate(""); done("catalog.item.saved"); } else fail(r.code);
  };
  const setBasis = async (value: string) => {
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/price-basis`, { basis: value === "" ? null : value });
    setBusy(false);
    if (r.ok) done("catalog.item.saved"); else fail(r.code);
  };

  // ── Back to default / Restore / door reports ──
  const backToDefault = async (kind: "pack" | "price") => {
    if (confirming !== kind) { setConfirming(kind); return; }
    setConfirming(null);
    if (view.scope === null) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = kind === "pack"
      ? await send(`${base}/pack/back-to-default`, { locationId: view.scope, versionId: view.pack.versionId })
      : await send(`${base}/price/back-to-default`, { locationId: view.scope });
    setBusy(false);
    if (r.ok) done("catalog.item.saved"); else fail(r.code);
  };
  const restore = async (h: SkuItemView["history"][number]) => {
    if ((await requestStepUp("E")) !== "ok") return;
    const shop = h.scope === "shop";
    setBusy(true);
    const r = await send(`${base}/pack/restore`, {
      locationId: shop ? view.scope : null,
      fromVersionId: h.id,
      expectedLiveVersionId: shop ? (view.pack.isShopVersion ? view.pack.versionId : null) : view.pack.globalVersionId,
    });
    setBusy(false);
    if (r.ok) done("catalog.item.saved"); else fail(r.code);
  };
  const dismissRequest = async (id: string) => {
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/pack-requests/${id}/dismiss`, {});
    setBusy(false);
    if (r.ok) done("catalog.item.saved"); else fail(r.code);
  };

  // ── Header bits ──
  const labelKind = versionLabelKind(view.scope, view.pack.isShopVersion, view.price.isShopLane);
  const versionText = labelKind === "global"
    ? t("catalog.item.version_global")
    : labelKind === "shop_own"
      ? t("catalog.item.version_shop", { shop: view.scopeName ?? "" })
      : t("catalog.item.version_shop_default", { shop: view.scopeName ?? "" });
  // The two save targets this actor may preview (and so save): their shop, and — MoO+ — everyone.
  const shopTarget: PreviewTarget | null = view.scope !== null && canSaveShop ? { kind: "shop", shopId: view.scope } : null;
  const globalTarget: PreviewTarget | null = view.can.editGlobal ? { kind: "global" } : null;
  const toggleConversion = (key: string, on: boolean) =>
    setChosen((c) => { const next = new Set(c); if (on) next.add(key); else next.delete(key); return next; });
  const canSaveFor = (p: PackPreview | PricePreview) => (p.target.kind === "global" ? view.can.editGlobal : canSaveShop);
  const days = view.ordering.orderDays.map((d) => formatWeekday(sundayAnchoredDate(d), language)).join(", ");
  const laneKey = (lane: "human" | "auto" | "global" | "none"): TranslationKey | null =>
    lane === "human" ? "catalog.ordering.lane.human" : lane === "auto" ? "catalog.ordering.lane.auto" : lane === "global" ? "catalog.ordering.lane.global" : null;
  const slotName = (s: "weekday" | "weekend") => t(s === "weekday" ? "catalog.preview.slot.weekday" : "catalog.preview.slot.weekend");
  const weekdayPar = view.ordering.slots.find((s) => s.slot === "weekday")?.value ?? null;

  const connections = (
    <section aria-label={t("catalog.item.connections")} className="rounded-xl border-2 border-co-border bg-co-surface p-3">
      <h2 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.item.connections")}</h2>
      <div className="mt-1 flex flex-col">
        {view.vendor ? (
          <Link href={`/admin/vendors/${view.vendor.id}`} className={linkRow}>{t("catalog.item.comes_from", { vendor: view.vendor.name })}</Link>
        ) : (
          <p className="flex min-h-[44px] items-center px-2 text-sm text-co-cta-text">{t("catalog.item.no_vendor")}</p>
        )}
        {view.product ? (
          <Link href={`/admin/products?product=${view.product.id}#${view.product.id}`} className={linkRow}>
            {t("catalog.item.part_of_product", { product: view.product.name })}
            {" · "}
            {view.product.primarySkuName ? t("catalog.item.buys_other", { sku: view.product.primarySkuName }) : t("catalog.item.buys_this_one")}
          </Link>
        ) : null}
        {view.ordering.offHere ? <p className="flex min-h-[44px] items-center px-2 text-sm font-bold text-co-warning-text">{t("catalog.item.off_here")}</p> : null}
        <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.item.used_in")}</p>
        {view.connections.uses.length === 0 ? (
          <p className="px-2 text-sm text-co-text-muted">{t("catalog.item.used_in_none")}</p>
        ) : view.connections.uses.map((r) => (
          <Link key={r.id} href={`/admin/recipes/${r.id}`} className={linkRow}>{r.name}</Link>
        ))}
        <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {view.connections.menuItems.length === 0 ? t("catalog.item.menu_none") : t("catalog.item.menu_count", { n: view.connections.menuItems.length })}
        </p>
        {view.connections.menuItems.map((m) => (
          <Link key={m.id} href="/admin/menu-costing" className={`${linkRow} justify-between`}>
            <span>{language === "es" && m.nameEs ? m.nameEs : m.name}</span>
            <span className="text-co-text-muted no-underline">{money(m.cost)}</span>
          </Link>
        ))}
      </div>
    </section>
  );

  return (
    <div className="flex w-full flex-col gap-4 pb-16">
      {/* Identity — always visible (D2). */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-co-gold/20 px-3 py-1 text-xs font-bold text-co-text">{versionText}</span>
        {view.pack.isShopVersion ? <span className="text-xs text-co-text-muted">{t("catalog.item.based_on_global")}</span> : null}
        {view.sku.itemNumber ? <span className="text-xs text-co-text-muted">{t("catalog.item.item_number", { n: view.sku.itemNumber })}</span> : null}
        {!view.sku.active ? <span className="text-xs font-bold text-co-cta-text">{t("catalog.item.inactive")}</span> : null}
      </div>

      <nav aria-label={t("catalog.item.shop_switcher")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link href={skuItemHref(view.sku.id, { shopId: null })} aria-current={view.scope === null ? "page" : undefined}
          className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 px-4 text-sm font-bold ${view.scope === null ? "border-co-text bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text"}`}>
          {t("catalog.item.shop_global")}
        </Link>
        {view.shops.map((s) => (
          <Link key={s.id} href={skuItemHref(view.sku.id, { shopId: s.id })} aria-current={view.scope === s.id ? "page" : undefined}
            className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 px-4 text-sm font-bold ${view.scope === s.id ? "border-co-text bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text"}`}>
            {s.name}
          </Link>
        ))}
      </nav>

      {message ? <p role="status" className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{message}</p> : null}

      {/* Door reports — alerts, always visible. */}
      {view.openRequests.length > 0 ? (
        <section aria-label={t("catalog.requests.title")} className="rounded-xl border-2 border-co-warning bg-co-warning-surface p-3">
          <h2 className="text-[12px] font-bold tracking-wide text-co-warning-text">{t("catalog.requests.title")}</h2>
          {view.openRequests.map((r) => (
            <div key={r.id} className="mt-2 flex flex-col gap-1">
              <p className="text-sm text-co-text">{t("catalog.requests.by", { who: r.filedBy ?? "—", date: day(r.filedAt) })}</p>
              {r.note ? <p className="text-sm italic text-co-text">&ldquo;{r.note}&rdquo;</p> : null}
              {r.proposal?.innerCount != null ? <p className="text-xs text-co-text-muted">{t("catalog.requests.proposal_count", { n: formatQuantity(r.proposal.innerCount, language) })}</p> : null}
              {r.proposal?.eachWeight != null ? <p className="text-xs text-co-text-muted">{t("catalog.requests.proposal_weight", { w: formatQuantity(r.proposal.eachWeight, language), unit: r.proposal.eachUnit ?? "" })}</p> : null}
              {canSaveShop ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => startJob("pack", r.id)}>{t("catalog.requests.review")}</button>
                  <button type="button" className={btn} disabled={busy} onClick={() => void dismissRequest(r.id)}>{t("catalog.requests.dismiss")}</button>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Connections: first on a phone (a strip at the top), a side panel from md:. */}
        <aside className="order-1 md:order-2">{connections}</aside>

        <div className="order-2 flex min-w-0 flex-col gap-3 md:order-1">
          {/* What's missing — alerts, always visible. */}
          <section aria-label={t("catalog.item.missing")} className="rounded-xl border-2 border-co-border bg-co-surface p-3">
            <h2 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.item.missing")}</h2>
            {view.missing.length === 0 ? (
              <p className="mt-1 text-sm text-co-text">{t("catalog.item.missing_none")}</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-2">
                {view.missing.map((e) => (
                  <li key={e.code} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-co-text">
                      {e.code === "recipe_unresolved"
                        ? t("admin.skus.data.errand.recipe_unresolved", { recipes: e.recipes.join(", ") })
                        : t(`admin.skus.data.errand.${e.code}` as TranslationKey)}
                    </span>
                    <button type="button" className={btn} onClick={() => fixIt(e.code)}>{t("catalog.item.fix")}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* How it arrives */}
          <div id="item-arrives" className="scroll-mt-24">
            <CollapsibleSection idBase="item-arrives-panel" title={t("catalog.item.section.arrives")}
              count={view.pack.descriptor ?? t("catalog.item.no_pack")} open={open.arrives} onToggle={() => toggle("arrives")}>
              <div className="flex flex-col gap-3 p-3">
                {view.pack.orderUnit ? <p className="text-sm text-co-text">{t("catalog.item.order_unit", { unit: view.pack.orderUnit, oz: oz(view.pack.orderUnitOz) })}</p> : null}
                {editing === "pack" ? (
                  <>
                    <PackSentenceEditor draft={draft} onChange={(d) => { setDraft(d); setPreview(null); guard.invalidate(); }} units={view.measures}
                      skuClass={view.sku.skuClass} currentLeafUnit={view.pack.levels.find((l) => l.containsLevelId == null)?.containsMeasureUnit ?? null}
                      avgOzPerEach={view.sku.avgOzPerEach} error={sentenceError} busy={busy} />
                    <div className="flex flex-wrap gap-2">
                      {shopTarget ? <button type="button" className={btnPrimary} disabled={busy} onClick={() => void previewPack(shopTarget)}>{t("catalog.item.see_changes")}</button> : null}
                      {globalTarget ? (
                        <button type="button" className={btn} disabled={busy} onClick={() => void previewPack(globalTarget)}>
                          {t(view.scope === null ? "catalog.item.see_changes" : "catalog.item.see_changes_everyone")}
                        </button>
                      ) : null}
                      <button type="button" className={btn} disabled={busy} onClick={() => { guard.invalidate(); setEditing(null); setPreview(null); }}>{t("catalog.item.cancel")}</button>
                    </div>
                    {preview?.kind === "pack" ? (
                      <ChangePreviewPanel preview={preview} canSave={canSaveFor(preview)} canEditPar={view.can.editPar}
                        chosen={chosen} onToggleConversion={toggleConversion} onSave={() => void savePack()} busy={busy} />
                    ) : null}
                  </>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {canEditPack ? <button type="button" className={btnPrimary} onClick={() => startJob("pack", null)}>{t("catalog.item.job_pack")}</button> : null}
                    {view.pack.isShopVersion && canSaveShop ? (
                      <button type="button" className={btnDanger} disabled={busy} onClick={() => void backToDefault("pack")}>
                        {confirming === "pack" ? t("catalog.item.back_to_default_confirm", { shop: view.scopeName ?? "" }) : t("catalog.item.back_to_default")}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </CollapsibleSection>
          </div>

          {/* Price */}
          <div id="item-price" className="scroll-mt-24">
            <CollapsibleSection idBase="item-price-panel" title={t("catalog.item.section.price")}
              count={view.price.value == null ? t("catalog.price.none") : t("catalog.price.current", { price: money(view.price.value), unit: view.pack.orderUnit ?? "" })}
              open={open.price} onToggle={() => toggle("price")}>
              <div className="flex flex-col gap-3 p-3">
                {view.price.isShopLane ? (
                  <p className="text-sm text-co-text">{t("catalog.price.shop_own", { shop: view.scopeName ?? "" })} · {t("catalog.price.global_is", { price: money(view.price.globalValue) })}</p>
                ) : null}
                <p className="text-sm text-co-text">{t("catalog.price.cost_per_oz", { cost: view.price.costPerOz == null ? "—" : `$${view.price.costPerOz.toFixed(4)}` })}</p>
                <label className="block">
                  <span className={fieldLabel}>{t("catalog.price.basis")}</span>
                  <select className={field} value={view.sku.priceBasis ?? ""} disabled={busy || !view.can.editBasis} onChange={(e) => void setBasis(e.target.value)}>
                    <option value="">{t("catalog.price.basis.unset")}</option>
                    {PRICE_BASES.map((b) => <option key={b} value={b}>{t(`catalog.price.basis.${b}` as TranslationKey)}</option>)}
                  </select>
                </label>
                {editing === "price" ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className={fieldLabel}>{t("catalog.price.new")}</span>
                        <input className={field} type="number" min={0} step="any" inputMode="decimal" value={priceText} disabled={busy}
                          onChange={(e) => { setPriceText(e.target.value); setPreview(null); guard.invalidate(); }} />
                      </label>
                      <label className="block">
                        <span className={fieldLabel}>{t("catalog.price.date")}</span>
                        <input className={field} type="date" value={priceDate} disabled={busy} onChange={(e) => { setPriceDate(e.target.value); setPreview(null); guard.invalidate(); }} />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {shopTarget ? <button type="button" className={btnPrimary} disabled={busy} onClick={() => void previewPrice(shopTarget)}>{t("catalog.item.see_changes")}</button> : null}
                      {globalTarget ? (
                        <button type="button" className={btn} disabled={busy} onClick={() => void previewPrice(globalTarget)}>
                          {t(view.scope === null ? "catalog.item.see_changes" : "catalog.item.see_changes_everyone")}
                        </button>
                      ) : null}
                      <button type="button" className={btn} disabled={busy} onClick={() => { guard.invalidate(); setEditing(null); setPreview(null); }}>{t("catalog.item.cancel")}</button>
                    </div>
                    {preview?.kind === "price" ? (
                      <ChangePreviewPanel preview={preview} canSave={canSaveFor(preview)} canEditPar={false}
                        chosen={chosen} onToggleConversion={toggleConversion} onSave={() => void savePrice()} busy={busy} />
                    ) : null}
                  </>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {canEditPack ? <button type="button" className={btnPrimary} onClick={() => startJob("price")}>{t("catalog.item.job_price")}</button> : null}
                    {view.price.isShopLane && canSaveShop ? (
                      <button type="button" className={btnDanger} disabled={busy} onClick={() => void backToDefault("price")}>
                        {confirming === "price" ? t("catalog.item.back_to_default_confirm", { shop: view.scopeName ?? "" }) : t("catalog.item.back_to_default")}
                      </button>
                    ) : null}
                  </div>
                )}
                {view.price.history.length > 0 ? (
                  <div>
                    <p className={fieldLabel}>{t("catalog.price.history")}</p>
                    <ul className="mt-1 flex flex-col">
                      {view.price.history.map((p) => (
                        <li key={p.id} className="flex flex-wrap justify-between gap-2 py-1 text-sm text-co-text">
                          <span>{formatDateLabel(p.effectiveDate, language)} · {t(p.shop ? "catalog.price.history_shop" : "catalog.price.history_global")}</span>
                          <span className="font-bold">{money(p.unitPrice)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </CollapsibleSection>
          </div>

          {/* Ordering */}
          <div id="item-ordering" className="scroll-mt-24">
            <CollapsibleSection idBase="item-ordering-panel" title={t("catalog.item.section.ordering")}
              count={weekdayPar == null ? t("catalog.ordering.par_none", { slot: slotName("weekday") }) : t("catalog.ordering.par", { slot: slotName("weekday"), n: formatQuantity(weekdayPar, language) })}
              open={open.ordering} onToggle={() => toggle("ordering")}>
              <div className="flex flex-col gap-2 p-3 text-sm text-co-text">
                {view.ordering.slots.map((s) => {
                  const lane = laneKey(s.lane);
                  return (
                    <p key={s.slot}>
                      {s.value == null ? t("catalog.ordering.par_none", { slot: slotName(s.slot) }) : t("catalog.ordering.par", { slot: slotName(s.slot), n: `${formatQuantity(s.value, language)} ${view.pack.orderUnit ?? ""}` })}
                      {lane ? <span className="text-co-text-muted"> · {t(lane)}</span> : null}
                    </p>
                  );
                })}
                <p>{days ? t("catalog.ordering.order_days", { days }) : t("catalog.ordering.no_days")}</p>
                {view.can.editPar ? <Link href={skuCatalogHref(view.sku.id)} className={linkRow}>{t("catalog.ordering.change_pars")}</Link> : null}
              </div>
            </CollapsibleSection>
          </div>

          {/* Counting */}
          <div id="item-counting" className="scroll-mt-24">
            <CollapsibleSection idBase="item-counting-panel" title={t("catalog.item.section.counting")}
              count={view.counting.unit ?? "—"} open={open.counting} onToggle={() => toggle("counting")}>
              <div className="flex flex-col gap-2 p-3 text-sm text-co-text">
                {view.counting.unit ? <p>{t("catalog.counting.unit", { unit: view.counting.unit })}</p> : null}
                {view.scope ? <Link href={`/operations/counts?location=${view.scope}`} className={linkRow}>{t("catalog.counting.open")}</Link> : null}
              </div>
            </CollapsibleSection>
          </div>

          {/* Barcodes */}
          <div id="item-barcodes" className="scroll-mt-24">
            <CollapsibleSection idBase="item-barcodes-panel" title={t("catalog.item.section.barcodes")}
              count={String(view.barcodes.length)} open={open.barcodes} onToggle={() => toggle("barcodes")}>
              <div className="flex flex-col gap-1 p-3 text-sm text-co-text">
                {view.barcodes.length === 0 ? <p>{t("catalog.barcodes.none")}</p> : view.barcodes.map((b) => (
                  <p key={`${b.code}-${b.level}`} className="break-all">{b.code} · {t(b.level === "case" ? "catalog.barcodes.level.case" : "catalog.barcodes.level.inner")}</p>
                ))}
              </div>
            </CollapsibleSection>
          </div>

          {/* History */}
          <div id="item-history" className="scroll-mt-24">
            <CollapsibleSection idBase="item-history-panel" title={t("catalog.item.section.history")}
              count={String(view.history.length)} open={open.history} onToggle={() => toggle("history")}>
              <div className="flex flex-col gap-2 p-3">
                {view.history.length === 0 ? <p className="text-sm text-co-text">{t("catalog.history.empty")}</p> : view.history.map((h) => {
                  const canRestore = !h.active && (h.scope === "shop" ? canSaveShop : view.can.editGlobal);
                  return (
                    <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-co-border py-2 text-sm text-co-text">
                      <div className="min-w-0">
                        <p className="font-bold">{t(h.scope === "shop" ? "catalog.history.scope_shop" : "catalog.history.scope_global")} · {h.labels.join(" → ")}</p>
                        <p className="text-xs text-co-text-muted">
                          {day(h.effectiveFrom)}{h.who ? ` · ${h.who}` : ""} · {h.active ? t("catalog.history.live") : t("catalog.history.retired", { date: h.retiredAt ? day(h.retiredAt) : "—" })}
                        </p>
                      </div>
                      {canRestore ? <button type="button" className={btn} disabled={busy} onClick={() => void restore(h)}>{t("catalog.history.restore")}</button> : null}
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `app/admin/catalog/sku/[id]/page.tsx`**

```tsx
/**
 * /admin/catalog/sku/[id] — the connected item page for a bought item (catalog Phase 2b; spec §4).
 * Server component: the admin layout holds the auth boundary, the level-6 floor and StepUpProvider;
 * this page re-gates defensively (C.39). The shop comes from THE one resolver (resolveShopId over the
 * shops the actor may work in — catalogShopAllowed: a membership, or MoO+ for every shop, D2);
 * `?location=global` shows the default. The client is KEYED by (SKU, shop), so a switch remounts it.
 * `/admin/skus` keeps working; Phase 1's skuCatalogHref still lands on its row, which links here.
 */
import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { CatalogItemError, loadSkuItemView } from "@/lib/catalog/sku-item";
import { itemClientKey, readJobParam } from "@/lib/catalog/sku-item-shared";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import { readFocusParam } from "@/lib/admin/product-item-links-shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkuItemClient } from "@/components/catalog/SkuItemClient";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CatalogSkuPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const auth = await requireSessionFromHeaders("/admin");
  if (auth.level < 6) redirect("/dashboard");

  const sb = getServiceRoleClient();
  const { data: locs, error } = await sb.from("locations").select("id, name").eq("active", true).order("name")
    .returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`catalog sku page locations: ${error.message}`);
  // The switcher follows the writers' rule (D2): a membership, or MoO+ for every active shop.
  const shops = (locs ?? []).filter((l) => catalogShopAllowed(auth, l.id));
  const explicit = shopParamFor(`/admin/catalog/sku/${id}`, searchParamValues(sp));
  const scope = explicit === "global" ? null : await resolveShopId(shops.map((s) => s.id), explicit ?? null);

  let view;
  try {
    view = await loadSkuItemView(auth, id, scope, shops);
  } catch (e) {
    if (e instanceof CatalogItemError && e.status === 404) notFound();
    if (e instanceof CatalogItemError && e.status === 403) redirect("/dashboard");
    throw e;
  }
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4">
      <PageHeader title={view.sku.name} subtitle={serverT(auth.user.language, "catalog.item.kind_bought")} />
      {/* ONE client per (SKU, shop): a ?location= switch REMOUNTS it, so no draft, preview or chosen
          conversion from the previous shop survives into this one (Astra 2b#5). */}
      <SkuItemClient key={itemClientKey(view.sku.id, view.scope)} view={view} job={readJobParam(sp.job)} requestId={readFocusParam(sp.request)} />
    </div>
  );
}
```

- [ ] **Step 5: Pin the new client in the tier map**

In `tests/step-up-tier-map.test.ts` `CLIENT_TIER_MAP`, add `  "components/catalog/SkuItemClient.tsx": ["E"],`. The file calls `requestStepUp("E")` literally, and only that tier.

- [ ] **Step 6: Run and commit**

Run: `npx vitest run tests/catalog-item-ui.test.ts tests/catalog-item-navigation.test.ts tests/step-up-tier-map.test.ts tests/shop-context.test.ts && npx tsc --noEmit 2>&1 | grep -v leaflet | grep "error TS"`
Expected: PASS, and no tsc output.

```bash
git add lib/catalog/request-guard-shared.ts components/catalog/SkuItemClient.tsx "app/admin/catalog/sku/[id]/page.tsx" tests/catalog-item-ui.test.ts tests/catalog-item-navigation.test.ts tests/step-up-tier-map.test.ts
git commit -F - <<'EOF'
feat(catalog): the connected item page — version, shop switcher, connections, what's missing, sections, jobs, history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 11: "This case looks different" at the receiving door

**Files:**
- Create: `components/receiving/CaseLooksDifferent.tsx`
- Create: `app/api/operations/receiving/pack-change/route.ts`
- Modify: `components/receiving/IntakeLineRow.tsx`
- Test: `tests/case-looks-different.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 2b — the door report: one operational button, a short sheet, a KH+ same-origin route. */
import { readFileSync } from "node:fs";
import { type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import { CaseLooksDifferent } from "@/components/receiving/CaseLooksDifferent";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));

describe("CaseLooksDifferent", () => {
  it("is one closed, labelled button until tapped — en and es", () => {
    const html = render(jsx(CaseLooksDifferent, { skuId: "s", locationId: "l" }));
    expect(html).toContain(en["receiving.case_different.button"]);
    expect(html).toContain('aria-expanded="false"');
    expect(render(jsx(CaseLooksDifferent, { skuId: "s", locationId: "l" }), "es")).toContain(es["receiving.case_different.button"]);
  });
  it("the door line mounts it (not on store-run rows)", () => {
    const src = readFileSync("components/receiving/IntakeLineRow.tsx", "utf8");
    expect(src).toContain("{storeMode ? null : <CaseLooksDifferent skuId={line.skuId} locationId={locationId} />}");
  });
});

describe("POST /api/operations/receiving/pack-change", () => {
  const src = readFileSync("app/api/operations/receiving/pack-change/route.ts", "utf8");
  it("same-origin first, a session, the KH floor, the strict proposal parser, no step-up (it changes nothing)", () => {
    expect(src.indexOf("assertSameOrigin(req)")).toBeLessThan(src.indexOf("requireSession("));
    expect(src).toContain("PACK_REQUEST_FILE_MIN");
    expect(src).toContain("parsePackChangeProposal(");
    expect(src).toContain("filePackChangeRequest(");
    expect(src).not.toContain("assertStepUp");
  });
});
```

Run → FAIL (module not found).

- [ ] **Step 2: Create `components/receiving/CaseLooksDifferent.tsx`**

```tsx
"use client";

/**
 * "This case looks different" — the receiving door's report (catalog Phase 2b; spec §2, §5 job 1).
 * The crew can't change how an item arrives, but they are the first to see a new case. One tap
 * opens a short sheet: what's different, optionally how many are inside and about how much each
 * weighs, and a photo. It files a report for the shop's GM, who answers it on the item page
 * ("It arrives differently now", prefilled). It changes nothing by itself, so it takes no password.
 * Disclosure state is useState only. Operational surface → the ActionButton grammar.
 */
import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { ActionButton } from "@/components/ActionButton";
import { PhotoCapture } from "@/components/photos/PhotoCapture";
import { postJson } from "@/components/admin/vendors/shared";

const field =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const fieldLabel = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";

function positive(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function CaseLooksDifferent({ skuId, locationId, deliveryId = null }: { skuId: string; locationId: string; deliveryId?: string | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [inner, setInner] = useState("");
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState<"oz" | "lb">("lb");
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "already" | "error">("idle");
  const panelId = `case-different-${skuId}`;

  const submit = async () => {
    if (busy) return;
    const innerCount = positive(inner);
    const eachWeight = positive(weight);
    const proposal = innerCount == null && eachWeight == null ? null : { innerCount, eachWeight, eachUnit: eachWeight == null ? null : unit };
    setBusy(true);
    const r = await postJson("/api/operations/receiving/pack-change", {
      skuId, locationId, deliveryId, note: note.trim() || null, proposal, photoId,
    });
    setBusy(false);
    if (!r.ok) { setStatus("error"); return; }
    setStatus(r.data.already === true ? "already" : "sent");
    setOpen(false);
  };

  return (
    <div className="mt-3">
      <ActionButton type="button" variant="secondary" aria-expanded={open} aria-controls={panelId}
        onClick={() => { setOpen((o) => !o); setStatus("idle"); }}>
        {t("receiving.case_different.button")}
      </ActionButton>
      {status === "sent" || status === "already" ? (
        <p role="status" className="mt-2 text-sm text-co-confirm-text">
          {t(status === "sent" ? "receiving.case_different.sent" : "receiving.case_different.already")}
        </p>
      ) : null}
      {status === "error" ? <p role="alert" className="mt-2 text-sm text-co-cta-text">{t("receiving.case_different.error")}</p> : null}
      {open ? (
        <div id={panelId} className="mt-2 flex flex-col gap-2 rounded-xl border-2 border-co-border-2 bg-co-surface-inset p-3">
          <p className="text-sm font-bold text-co-text">{t("receiving.case_different.title")}</p>
          <label className="block">
            <span className={fieldLabel}>{t("receiving.case_different.note")}</span>
            <textarea className={`${field} min-h-[88px] py-2`} maxLength={500} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="block">
              <span className={fieldLabel}>{t("receiving.case_different.inner_count")}</span>
              <input className={field} type="number" min={0} step="any" inputMode="decimal" value={inner} disabled={busy} onChange={(e) => setInner(e.target.value)} />
            </label>
            <label className="block">
              <span className={fieldLabel}>{t("receiving.case_different.each_weight")}</span>
              <input className={field} type="number" min={0} step="any" inputMode="decimal" value={weight} disabled={busy} onChange={(e) => setWeight(e.target.value)} />
            </label>
            <label className="block">
              <span className={fieldLabel}>{t("receiving.case_different.unit")}</span>
              <select className={field} value={unit} disabled={busy} onChange={(e) => setUnit(e.target.value === "oz" ? "oz" : "lb")}>
                <option value="lb">lb</option>
                <option value="oz">oz</option>
              </select>
            </label>
          </div>
          <PhotoCapture locationId={locationId} label={t("receiving.form.photo_capture")} initialPhotoId={photoId} onUploaded={(pid) => setPhotoId(pid)} />
          <div className="flex flex-wrap gap-2">
            <ActionButton type="button" variant="primary" disabled={busy} onClick={() => void submit()}>{t("receiving.case_different.send")}</ActionButton>
            <ActionButton type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{t("receiving.case_different.close")}</ActionButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Create `app/api/operations/receiving/pack-change/route.ts`**

```ts
/**
 * POST /api/operations/receiving/pack-change — "This case looks different" (catalog Phase 2b, 0261).
 * A REPORT, not an edit: KH+ at their shop (the lib binds), same-origin, no step-up.
 * Body: { skuId: uuid, locationId: uuid, deliveryId?: uuid | null, note?: string | null,
 *         proposal?: { innerCount, eachWeight, eachUnit } | null, photoId?: uuid | null }
 * 201 = filed; 200 = joined the shop's open report for this item (the door says "already reported").
 */
import { type NextRequest } from "next/server";

import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { filePackChangeRequest, PackChangeRequestError } from "@/lib/pack-change-requests";
import { PACK_REQUEST_FILE_MIN, PACK_REQUEST_NOTE_MAX, parsePackChangeProposal } from "@/lib/pack-change-requests-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/receiving/pack-change");
  if (ctx instanceof Response) return ctx;
  if (ctx.level < PACK_REQUEST_FILE_MIN) return jsonError(403, "forbidden");

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.skuId !== "string" || !UUID_RE.test(b.skuId)) return jsonError(400, "invalid_payload", { field: "skuId" });
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  const deliveryId = optUuid(b.deliveryId);
  if (deliveryId === undefined) return jsonError(400, "invalid_payload", { field: "deliveryId" });
  const photoId = optUuid(b.photoId);
  if (photoId === undefined) return jsonError(400, "invalid_payload", { field: "photoId" });
  if (b.note !== undefined && b.note !== null && (typeof b.note !== "string" || b.note.length > PACK_REQUEST_NOTE_MAX)) {
    return jsonError(400, "invalid_payload", { field: "note" });
  }
  const proposal = parsePackChangeProposal(b.proposal);
  if (proposal === "invalid") return jsonError(400, "invalid_payload", { field: "proposal" });

  try {
    const r = await filePackChangeRequest(ctx, {
      skuId: b.skuId, locationId: b.locationId, deliveryId, photoId, proposal,
      note: typeof b.note === "string" ? b.note : null,
    });
    return jsonOk({ id: r.id, already: r.already }, r.already ? 200 : 201);
  } catch (e) {
    if (e instanceof PackChangeRequestError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 4: Mount it on the door line**

In `components/receiving/IntakeLineRow.tsx`, add `import { CaseLooksDifferent } from "@/components/receiving/CaseLooksDifferent";` after `import { PhotoCapture } from "@/components/photos/PhotoCapture";`. Directly after the expanded row's photo block:

```tsx
      <PhotoCapture
        className="mt-2"
        locationId={locationId}
        label={t("receiving.form.photo_capture")}
        initialPhotoId={line.photoId}
        onUploaded={(pid) => onChange({ photoId: pid })}
      />
```

insert:

```tsx
      {/* Catalog Phase 2b: the crew reports a case that arrived different; the GM answers it on the item page. */}
      {storeMode ? null : <CaseLooksDifferent skuId={line.skuId} locationId={locationId} />}
```

- [ ] **Step 5: Run and commit**

Run: `npx vitest run tests/case-looks-different.test.ts tests/receiving-shared.test.ts && npx tsc --noEmit 2>&1 | grep -v leaflet | grep "error TS"`
Expected: PASS, no tsc output.

```bash
git add components/receiving/CaseLooksDifferent.tsx app/api/operations/receiving/pack-change/route.ts components/receiving/IntakeLineRow.tsx tests/case-looks-different.test.ts
git commit -F - <<'EOF'
feat(receiving): "This case looks different" — the door files a pack change for the GM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 12: The old SKU screens point at the item page

2a already holds the line: the legacy chain editor, "Record price" and the SKU edit's flat pack fields refuse a GM/AGM's change to an existing global value with `global_requires_moo` (D5, atomic, en + es). That leaves 2b one job: now that the item page exists, the refusal **points at the fix**. The cost panel links to the price job on the item page, and the message names the item page.

**Files:**
- Modify: `components/admin/skus/SkuCostPanel.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json` (the two 2a values, reworded)
- Test: `tests/catalog-legacy-pointers.test.ts`

- [ ] **Step 1: Write the failing pins**

```ts
/** Catalog Phase 2b — a refused global change on /admin/skus points at the item page (the gate itself is 2a's). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

describe("the SKU screens point at the item page", () => {
  it("the cost panel links to the price job when the global price is refused", () => {
    const panel = readFileSync("components/admin/skus/SkuCostPanel.tsx", "utf8");
    expect(panel).toContain('errCode === "global_requires_moo"');
    expect(panel).toContain('skuItemHref(skuId, { job: "price" })');
  });
  it("the refusal names the item page, in both languages", () => {
    expect((en as Record<string, string>)["admin.skus.error.global_requires_moo"]).toContain("item page");
    expect((es as Record<string, string>)["admin.skus.error.global_requires_moo"]).toContain("página del artículo");
  });
});
```

Run → FAIL.

- [ ] **Step 2: `components/admin/skus/SkuCostPanel.tsx`**

Make these edits:
- Add the import `import { skuItemHref } from "@/lib/catalog/sku-item-shared";`, plus `import Link from "next/link";` if the file does not import it yet.
- After `  const [err, setErr] = useState<string | null>(null);` add `  const [errCode, setErrCode] = useState<string | null>(null);`.
- Replace the failure branch of `record` (today `else setErr(t(resolveErrorKey(res.code)));`; if Phase 1 reshaped this line, change the equivalent failure branch) with `else { setErr(t(resolveErrorKey(res.code))); setErrCode(res.code); }`.
- Replace `{err ? <p className="text-sm text-co-cta-text">{err}</p> : null}` with:

```tsx
            {err ? <p className="text-sm text-co-cta-text">{err}</p> : null}
            {errCode === "global_requires_moo" ? (
              <Link href={skuItemHref(skuId, { job: "price" })} className="inline-flex min-h-[44px] items-center text-sm font-bold text-co-text underline">
                {t("admin.skus.cost.use_item_page")}
              </Link>
            ) : null}
```

- [ ] **Step 3: Reword 2a's refusal to name the fix**

In `lib/i18n/en.json`, replace the line `  "admin.skus.error.global_requires_moo": "Only a Manager of Operations or higher can change this for everyone.",` with `  "admin.skus.error.global_requires_moo": "Only a Manager of Operations or higher can change this for everyone. Change it for your shop on the item page.",`. Keep its trailing comma exactly as it was.

In `lib/i18n/es.json`, replace `  "admin.skus.error.global_requires_moo": "Solo un Gerente de Operaciones o superior puede cambiar esto para todos.",` with `  "admin.skus.error.global_requires_moo": "Solo un Gerente de Operaciones o superior puede cambiar esto para todos. Cámbialo para tu tienda en la página del artículo.",`.

(`admin.skus.cost.use_item_page` itself comes with Task 8's block.)

- [ ] **Step 4: Run and commit**

Run: `npx vitest run tests/catalog-legacy-pointers.test.ts tests/legacy-global-writers.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS (2a's pin still holds), no tsc output.

```bash
git add components/admin/skus/SkuCostPanel.tsx lib/i18n/en.json lib/i18n/es.json tests/catalog-legacy-pointers.test.ts
git commit -F - <<'EOF'
feat(catalog): a refused global change on /admin/skus points at the item page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 13: Every way in lands on the item — `/admin/skus` rows, door reports, vendor import

**Files:**
- Create: `components/catalog/PackChangeRequestsList.tsx`
- Modify: `components/admin/skus/SkuCatalogClient.tsx`, `app/admin/skus/page.tsx`, `lib/vendor-import.ts`, `components/admin/vendors/VendorImportPanel.tsx`, `tests/catalog-deep-links.test.ts`
- Test: `tests/catalog-item-links.test.ts`

- [ ] **Step 1: Write the failing pins**

```ts
/** Catalog Phase 2b — every way in lands on the item page (spec §5 "Deep links always land on the item, never a list"). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(f, "utf8");

describe("ways in", () => {
  it("each /admin/skus row links to its item page", () => {
    expect(read("components/admin/skus/SkuCatalogClient.tsx")).toContain("href={skuItemHref(s.id)}");
  });
  it("/admin/skus lists the open door reports, each opening the job on the item", () => {
    expect(read("app/admin/skus/page.tsx")).toContain("<PackChangeRequestsList");
    expect(read("components/catalog/PackChangeRequestsList.tsx")).toContain('skuItemHref(r.skuId, { shopId: r.locationId, job: "pack", requestId: r.id })');
  });
  it("the vendor import's 'needs a person' opens 'It arrives differently now' on the matched SKU", () => {
    expect(read("lib/vendor-import.ts")).toContain('href: o.match.sku_id ? skuItemHref(o.match.sku_id, { job: "pack" }) :');
    expect(read("components/admin/vendors/VendorImportPanel.tsx")).toContain('o.match.sku_id ? skuItemHref(o.match.sku_id, { job: "pack" }) :');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Create `components/catalog/PackChangeRequestsList.tsx`** (server component)

```tsx
/**
 * The open "This case looks different" reports for the actor's shops, on /admin/skus (catalog
 * Phase 2b). Server component; each link opens "It arrives differently now" on the item, at that
 * shop, prefilled from the report. Renders nothing when there are none (no empty chrome).
 */
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { skuItemHref } from "@/lib/catalog/sku-item-shared";
import type { OpenPackRequest } from "@/lib/pack-change-requests";

export function PackChangeRequestsList({ requests, shops, language }: {
  requests: OpenPackRequest[];
  shops: Array<{ id: string; name: string }>;
  language: Language;
}) {
  if (requests.length === 0) return null;
  const shopName = new Map(shops.map((s) => [s.id, s.name]));
  const title = serverT(language, "admin.skus.pack_requests.title");
  return (
    <section aria-label={title} className="mb-4 rounded-xl border-2 border-co-warning bg-co-warning-surface p-3">
      <h2 className="text-[12px] font-bold tracking-wide text-co-warning-text">{title}</h2>
      <ul className="mt-1 flex flex-col">
        {requests.map((r) => (
          <li key={r.id}>
            <Link href={skuItemHref(r.skuId, { shopId: r.locationId, job: "pack", requestId: r.id })}
              className="flex min-h-[44px] items-center text-sm font-bold text-co-text underline">
              {serverT(language, "admin.skus.pack_requests.review", { item: r.skuName, shop: shopName.get(r.locationId) ?? "" })}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: `/admin/skus` mounts it, and each row links to its item page**

In `app/admin/skus/page.tsx`: add the imports `import { loadOpenPackChangeRequests } from "@/lib/pack-change-requests";` and `import { PackChangeRequestsList } from "@/components/catalog/PackChangeRequestsList";`. Directly before `  return (` (the page's final return), add:

```tsx
  // Catalog Phase 2b — open door reports for the shops this actor works in (AGM+; [] otherwise).
  const packRequests = await loadOpenPackChangeRequests(auth, { locationIds: locations.map((l) => l.id) });
```

and directly after the `{level >= ROLES.gm.level ? <StoreManagement … /> : null}` line, add:

```tsx
      <PackChangeRequestsList requests={packRequests} shops={locations} language={lang} />
```

In `components/admin/skus/SkuCatalogClient.tsx`: add `import { skuItemHref } from "@/lib/catalog/sku-item-shared";` and, if the file does not import it yet, `import Link from "next/link";`. Directly before `      <SkuDataDrawer skuId={s.id} shops={dataShops} />`, insert:

```tsx
      <Link href={skuItemHref(s.id)} className="mb-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text">
        {t("admin.skus.open_item")}
      </Link>
```

If the enclosing row component has no `t` in scope, add `  const { t } = useTranslation();` as its first line. The file already imports `useTranslation`.

- [ ] **Step 4: The vendor import's "needs a person" opens the job**

In `lib/vendor-import.ts`, replace `skuCatalogHref(o.match.sku_id)` with `skuItemHref(o.match.sku_id, { job: "pack" })`, and add `import { skuItemHref } from "@/lib/catalog/sku-item-shared";`. Make the same replacement and import in `components/admin/vendors/VendorImportPanel.tsx`. Remove `skuCatalogHref` from either file's import only if it is now unused (`npm run lint` says so). In `tests/catalog-deep-links.test.ts` (Phase 1), update the two expectations that pinned the old link:

```ts
    expect(read("lib/vendor-import.ts")).toContain('href: o.match.sku_id ? skuItemHref(o.match.sku_id, { job: "pack" }) :');
    expect(read("components/admin/vendors/VendorImportPanel.tsx")).toContain('o.match.sku_id ? skuItemHref(o.match.sku_id, { job: "pack" }) :');
```

- [ ] **Step 5: Run and commit**

Run: `npx vitest run tests/catalog-item-links.test.ts tests/catalog-deep-links.test.ts && npm run lint && npx tsc --noEmit 2>&1 | grep -v leaflet | grep "error TS"`
Expected: PASS, lint clean, no tsc output.

```bash
git add components/catalog/PackChangeRequestsList.tsx components/admin/skus/SkuCatalogClient.tsx app/admin/skus/page.tsx lib/vendor-import.ts components/admin/vendors/VendorImportPanel.tsx tests/catalog-item-links.test.ts tests/catalog-deep-links.test.ts
git commit -F - <<'EOF'
feat(catalog): every way in lands on the item — SKU rows, door reports, vendor import's needs-a-person

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 14: Apply runbook — 0261 (sim → prod dry-run with rollback → prod → stamp)

**Gate:** all of these must hold:
- 2a's 0259 and 0260 are applied (0261 references `sku_pack_versions` and calls `save_sku_pack_version`);
- CC review and Astra review are at APPROVE;
- CI is green;
- Juan gives his word for each production step.

The table and the RPC must exist **before** the code merges, because the door route, the item page and the apply route use them.

- [ ] **Step 1: Sim apply** with `apply_migration` (name `0261_sku_pack_change_requests`), then run the three VERIFY queries in its header. Expected:
  - `t`;
  - service_role holds exactly INSERT / SELECT / UPDATE;
  - EXECUTE on `apply_sku_pack_change` and `sku_pack_change_snapshot` belongs to service_role (and the owner) only.

- [ ] **Step 2: Sim smoke of the atomic refusal.** Find a SKU with a global chain, two active shops that both ride it, and a human weekday par of 3 at shop A. Then:
  1. Note `select count(*) from sku_pack_versions where sku_id = '<SKU>'`.
  2. Call `select public.apply_sku_pack_change('<SKU>', '<A>', '[{"label":"case","containsQty":4,"containsIndex":1,"containsMeasureUnit":null},{"label":"bag","containsQty":10,"containsIndex":null,"containsMeasureUnit":"lb"}]'::jsonb, null, '<global version id>', null, '<a GM user id>', false, '[{"location_id":"<A>","slot":"weekday","expected":2,"to":1,"patch":{"weekday_par":1,"auto_weekday_par":null,"auto_weekday_baseline_par":null,"auto_weekday_applied_at":null,"pinned_weekday_at":null}}]'::jsonb, null, public.sku_pack_change_snapshot('<SKU>', array['<A>']::uuid[]));`

     The `expected` is deliberately wrong (2, not 3). Expected: `ERROR: sku_pack_change:par_changed`, and the version count is unchanged (nothing half-applied).
  3. Re-run the call with `"expected":3`. Expected: a JSON result with `pars_converted: 1`. (The last argument takes the dependency snapshot inline, so it is always current here; step 4 shows a stale one being refused.) Shop A's weekday par is now 1 and its `auto_weekday_*` and `pinned_weekday_at` are null. One new shop version exists.
  4. **The dependency recheck (2b r2#2).** Take a snapshot for a GLOBAL save, `select public.sku_pack_change_snapshot('<SKU>', array(select id from locations where active order by id))`. Then give shop B its own version through the API, and call `apply_sku_pack_change` for the global target with that old snapshot. Expected: `ERROR: sku_pack_change:dependencies_changed`, and no new version. Retire B's version afterwards.
  5. Clean up through the app's own path: back to default on the item page (Tier E), then set A's par back to 3 on `/admin/skus`.

- [ ] **Step 3: Prod dry-run with rollback.** Run through `execute_sql`, in this order:
  1. `begin;`
  2. the 0261 body without its own `begin;`/`commit;`
  3. the three VERIFY queries
  4. `rollback;`

  Expected: as in Step 1, then rolled back. Confirm with `select to_regclass('public.sku_pack_change_requests')`, which must return `null`, and `select to_regprocedure('public.apply_sku_pack_change(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean, jsonb, uuid, jsonb)')`, which must return `null`.
- [ ] **Step 4: Prod apply** (Juan's word), then run VERIFY read-only.
- [ ] **Step 5: Merge** (Juan clicks), then take a read-only look at production: pages load, and no test writes happen on prod. The full walk runs on the sim in Task 15.
- [ ] **Step 6: Stamp** the 0261 header in a docs-only commit: put `-- APPLIED TO PROD <date> (schema_migrations version <v>, name '0261_sku_pack_change_requests')` under the gate line. Update the AGENTS.md lineage line.

---

## Task 15: Final verification

- [ ] **Step 1:** `npx vitest run` → every file passes, 0 failed. The 2a pins (`shop-versions-equivalence`, `counts-onhand-equivalence`) stay green.
- [ ] **Step 2:** `npx tsc --noEmit` → exactly the 6 known Leaflet `TS2307` errors, nothing else.
- [ ] **Step 3:** `npm run lint && npx next build` → clean; build succeeds.
- [ ] **Step 4: The open-orders embed matches the query it replaces.** AGENTS.md requires row-for-row parity for a service-role embed. On the sim, for one SKU and shop, compare `loadOpenOrders`' rows with this two-step SQL:

```sql
select l.po_id from po_lines l join purchase_orders p on p.id = l.po_id
 where l.sku_id = '<SKU>' and p.location_id = '<SHOP>' and p.status in ('draft','confirmed','placed','invoiced') order by l.id;
```

Expected: the same `po_id`s in the same order.
- [ ] **Step 5: Sim browser walk (http://localhost:3100)**

Walk each layout: phone (390×844), tablet (820×1180) and desktop (1440×900), in en and es. Take a screenshot per step. On every page, check that `document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth` (no sideways page scroll).
  1. `/admin/skus` → a row's **Open item page** → the item page at the remembered shop. The header says "P Street · using the global default". On a phone the connections strip is at the top; on tablet/desktop it is a side panel.
  2. **Shop switcher:** Everyone (global) / each shop; the version label follows.
     - A GM sees only their shops. A MoO **with no membership** sees every active shop and can save a shop version at any of them (D2).
     - Start "It arrives differently now" at P Street, open the preview, then switch to Cap Hill. The editor and the preview are gone, so nothing from P Street carries over (the remount).
  3. **What's missing** lists the errands. **Fix it** opens the right section: price → the price job; pack errands → the sentence editor.
  4. **GM at P Street: It arrives differently now.**
     - The sentence reads "1 case holds 6 bag, each bag weighs 5 lb". Change it to 4 × 10 lb, then **See what this changes**.
     - The preview says "Worked out for P Street only". It shows the order unit 480 → 640 oz, the cost/oz drop, each sandwich's cost before → after, any recipe line in a renamed unit, and P Street's open POs.
     - If P Street has its own weekday par, there is a Keep / Change-to choice. If P Street inherits the global par, the preview says so, offers no conversion, and names the fix.
     - **Save for P Street** → "Saved." The label reads "P Street's version · Based on the global default". `/ordering?location=<P Street>` shows the new case; Cap Hill is unchanged.
  5. **Choose Change to 2 case, then save.** P Street's own par is now 2 (its overlay on `/admin/skus`), and the version and the par landed together.
     - An AGM in the same flow sees "A GM can change the par." and no convert button; their save lands as P Street's version with the par untouched.
     - Change P Street's par on `/admin/skus` **between** the preview and the save: the save is refused ("A par changed since you looked…" or "Something changed since you looked…"), and NO version was created.
     - P Street inheriting the global par: the preview offers "Keep using the global par / Give P Street its own par: 2 case". Choosing the second creates P Street's own par of 2; the global par is unchanged and Cap Hill keeps 3.
  6. **MoO on Everyone (global): See what this changes.**
     - The preview lists every shop riding the default, each with its own numbers. It names a shop with its own version as untouched.
     - The global par converts only if every shop whose par depends on it (global lane, or a machine par resting on it) rides the global pack; otherwise it says why not. Give Cap Hill its own case between the preview and **Save for everyone**: the save is refused ("Something changed since you looked — review it again.").
     - **Save for everyone** appears only on this global preview, never on a shop preview. On a shop's page, the MoO reaches it through **See what this changes for everyone**.
  7. **History** shows each version with who and when. **Restore** of an old one creates a new version based on it; the old row stays.
  8. **Back to default** (two taps) → P Street rides the global chain again.
  9. **A back-dated price:** with a current price dated today, enter an older date. The preview says "Dated …, before the current price — … today's costs don't change", and the sandwich costs do not move. Saving with a date other than the previewed one is refused as stale.
  10. **Price changed at P Street:** enter $150 → the preview of P Street's sandwich costs → **Save for P Street** → "P Street pays its own price · Global price: $128". The next delivery at P Street with a price lands in its lane. Back to default works. A MoO's global price preview names P Street as untouched while its lane is live.
  11. **The price basis select:** MoO can change it; a GM can set it only when it is unset.
  12. **Receiving door as a KH at P Street:**
      - Expand a line → **This case looks different** → note, "4" inside, "10 lb" → **Send to my manager** → "Sent. …". A second report shows "Already reported …".
      - The GM's dashboard bell has the notification. `/admin/skus` shows "Cases reported different at the door"; the link opens the item with the job prefilled (4 inside, 10 lb).
      - Saving for P Street closes the report as applied, with that version. **Nothing changed** dismisses it.
      - A report can't be closed from another item's page.
  13. **Legacy:** a GM editing an existing chain or recording a price on `/admin/skus` gets the message pointing at the item page, and the cost panel shows its link. A brand-new SKU's first chain and first price still save. MoO saves globally.
  14. A vendor import's "needs a person" link opens **It arrives differently now** on the matched SKU.
  15. **es:** every string on every step above is Spanish (tú). Every control is at least 44px (inspect a sample per screen).
- [ ] **Step 6:** Open the PR, `feat(catalog): Phase 2b — the connected item page, What this changes, It arrives differently now, Price changed`. The body lists 0261 as NOT APPLIED and links this plan. End it with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
```

---

## Review response map (r2)

| Finding | Resolution |
|---|---|
| **D4 / Astra 2b#2, #6** preview vs save target | The preview is computed per target (`{kind:"shop"}` / `{kind:"global"}`). It lists every affected shop with its pack and par lane and names the untouched shops (Task 2). Conversion is offered only where that shop's effective pack changes and the par lives in the lane being changed. A global par converts only when every shop inheriting it rides the global pack. "Save for everyone" exists only on a global preview (Tasks 9, 10), and the server recomputes for the posted target and requires its token (Task 6). Price is per target the same way. |
| **D4 / Astra 2b#3** before-state + overwrite | The baseline comes from the preview, computed before any write, and each conversion carries `expected`. `apply_sku_pack_change` (0261) commits version + pars + report in one transaction and refuses everything on a mismatch (Tasks 5, 6). Task 14 has a sim smoke for the refusal. |
| **D3 / Astra 2b#1, #4** stale auto pars; walk vs submit | Owned by 2a Task 12 (effective-pack stamp; one `loadPackAwareOverlay` for walk and submit, parity-tested). 2b reads par lanes through that same loader (Task 6). |
| **D2 / Astra 2b#8** unassigned MoO | 2a `catalogShopAllowed`. 2b uses it in `can.editShop`, the door/dismiss binds, conversions and price basis (Tasks 5, 6). The switcher lists every active shop at level ≥ 8 (Task 10). There are tests for an unassigned MoO (Tasks 5, 6). |
| **D5 / Astra 2b#9** first global price race | Owned by 2a (Tasks 3, 9, 10: decided under the SKU lock). 2b's old Task 12 gate is gone; Task 12 is UI pointers only. |
| Astra 2b#5 navigation | The page keys the client by `itemClientKey(sku, scope)`, so a shop switch remounts it. `createRequestGuard` drops late responses, and a navigation test pins both (Task 10). |
| Astra 2b#7 privilege ceiling | 0261 revokes all (service_role included), grants SELECT/INSERT/UPDATE, and asserts the forbidden and required sets (Task 5). |
| Astra 2b#10 Task 1 compile | `lib/ordering.ts` imports `perOrderUnitOz` and `orderUnitLabelFor` locally and re-exports, pinned (Task 1). |
| Astra 2b#11 request applied by an unrelated save | Only `apply_sku_pack_change` marks a report applied, after checking same SKU, a reachable shop, and still open. Dismiss binds the SKU in its path (Task 5). |
| Astra 2b#12 open orders lost | `po_lines` with `purchase_orders!inner` filtered by shop + status, then paged (Task 6), with a parity check (Task 15). |
| Astra 2b#13 i18n count | An explicit `REQUIRED` key list, both languages, placeholders matched, no stray `catalog.*` key (Task 8). |

## Review response map (r3 — Astra round 2)

| Finding | Resolution |
|---|---|
| 2b r2#1 "unaffected" shop whose par changes | A shop's par DEPENDS on the global par when its lane is global OR auto (an auto rests on its baseline). The global row converts only if every dependent rides the global pack, so an untouched shop's resolved par never changes. Astra's scenario is a test (Task 2). |
| 2b r2#2 dependencies not rechecked under the lock | `sku_pack_change_snapshot` (global version + pars; per reached shop its own version, pack epoch, overlay lanes; the active shops) is taken BEFORE the preview, digested into its token, and re-taken inside `apply_sku_pack_change` under the SKU lock with the overlay rows locked. Any difference → `dependencies_changed`, nothing saved (Tasks 5, 6, 14). |
| 2b r2#3 opt-in shop par | An inherited par on a shop-only save is `convertible` + `inherited`: "Keep using the global par / Give {shop} its own par". The RPC creates the shop's slot only while it is still empty and the global value is unchanged; the global par is untouched (Tasks 2, 5, 6, 8, 9). |
| 2b r2#4 back-to-default resurrects an auto par | 2a Task 12: monotonic `sku_pack_epochs`. 2b reads lanes through the same loader and snapshots the epochs. |
| 2b r2#5 first global chain rewrites the past | 2a Tasks 2, 3, 5: the pre-chain flat baseline version, resolved as of a past date. |
| 2b r3#2 price preview ignores the date | The preview resolves the would-be row through the real rule (newest effective date; same date → newest row): `priceBecomesCurrent` against the global head or the shop's lane head (a shop's first lane is always current). A back-dated price shows "today's costs don't change". The date is bound into the token and re-checked on save; Oct 14 vs Oct 15 tested (Tasks 2, 6, 7, 9, 10). |
| 2b r3#1 all-null baseline; 2a r3#2 costing board | Both in 2a (Tasks 3 and 6b). |
| 2b r2#6 mirror race | `applyPackChange` no longer syncs anything; the mirror is derived inside the transaction (2a `sku_flat_mirror_apply`), and the RPC returns `mirror_synced` (Task 6). |

## Open questions (new in r2)

1. **A global save where some dependent shops keep their own case** leaves the global par unconverted (`global_par_shared`). The alternative, converting it and pinning the old number onto those shops as their own pars, is a bigger change to their lanes and is not built.
2. **2a's `/price` route** (no preview) stays as an API. The item page saves prices only through `/price/apply` (previewed). Retire the bare route later if nothing else calls it.

---

## Self-review against the spec (Phase 2 = 2a + 2b)

| Spec requirement | Where |
|---|---|
| §7 Phase 2: shop versions for pack and price | 2a Tasks 3, 5, 6, 9, 10 |
| §7 Phase 2: sourcing per shop | 2b Task 6 (`product_primaries` at the shop, off here, pars with their lane, order days; no new model, because none was missing) |
| §3 one resolver per kind; never a second resolution in a consumer; per-shop graphs | 2a Tasks 2, 5, 6, 7 (routing table); 2b reads only through them, per shop |
| §3 "past … sales are never re-resolved" | 2a D1 (dated versions; depletion as of its business date) |
| §3 precondition equivalence pin (fixture + prod-shaped snapshot) | 2a Task 1, green through every task of 2a and 2b |
| §3 back to default; history append-only and audited; restore | 2a RPCs + writers; 2b History tab + Restore + back-to-default buttons |
| §2 AGM/GM own shop, MoO+ any shop and global, bind in the lib | 2a Tasks 2, 9, 10; 2b Tasks 5, 6 (door/dismiss/conversion binds through `catalogShopAllowed`) |
| §2 "This case looks different" files a pack change for the GM | 2b Tasks 5, 11, 13 (0261, door UI, list + notification) |
| §4 item page shape: kind, version label, shop switcher, How it connects, sections, What's missing, History | 2b Tasks 4, 6, 10 |
| §4 sentence editor always; raw ChainEditor retired from this path | 2b Tasks 3, 9 (the item page has no ChainEditor) |
| §4 "What this changes": cost/oz, sandwich costs, par keep-or-convert, broken recipe lines, open orders; Save for my shop / for everyone | 2b Tasks 2, 6, 9, 10 (per target and per shop; atomic save) |
| §4 passwords: one step-up, a 15-minute window | Tier E on every 2a/2b write route (Phase 1 clock); no Phase 2 act needs the one-shot grant |
| §4 screens: phone one column with the strip on top; tablet/desktop side panel; no page-wide table | 2b Task 10 layout + Task 15 walk |
| §5 job 1 (It arrives differently now, from the item page, the door, and the import) | 2b Tasks 10, 11, 13 |
| §5 job 5 (Price changed) | 2b Tasks 6, 7, 10 |
| §5 problems link to their fix | "What's missing" Fix it (2b Task 10); import needs-a-person (2b Task 13); legacy refusals (2b Task 12) |
| §8 preview tests; resolver tests; permission tests; UI en+es; navigation | 2b Tasks 2, 5, 6, 9, 10; 2a Tasks 8, 9, 10 |
| §9 price basis gets a plain-words field in Price | 2b Tasks 6, 7, 10 |
| §9 Dynamic Pars × pack version | 2a Task 12 (D3); 2b reads stamped lanes |
| Database hardening (deny-all RLS, privilege ceiling) | 2a Task 3; 2b Task 5 |
| i18n en + es, tú; 44px floor; disclosure doctrine | 2b Tasks 8–12 (tests assert required keys, placeholders and 44px) |
| **Not in Phase 2 (by the spec's phasing):** recipe and menu-item shop versions, Adopt/Promote, the Shop changes list (Phase 3); the new-item / swap-vendor / new-sandwich jobs (Phase 4); the Pars and Sandwiches pages and the level-wall moves (Phase 5); the Catalog area's one search box (left for the phase that adds the other item kinds) | — |

**Placeholder scan:** every step names exact files, the exact text it replaces, and complete new code. The conditional instructions are explicit fallbacks, each with a command that decides it (a lint-reported unused import; a test name that may differ).

**Type consistency:**
- `PreviewTarget`, `ParConversion`, `PackPreview.token/liveVersionId/basedOnVersionId`, `conversionKey`, `itemClientKey` and `createRequestGuard` are each defined once (Tasks 2, 6, 10) and used with the same names in the routes, the panel and the client.
- `apply_sku_pack_change`'s ten parameters match between the 0261 SQL, the pin, the grant lines and `applyPackChange`'s call.
