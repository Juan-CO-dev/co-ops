# Catalog Redesign — Phase 4 (Guided Jobs: New Item, New Sandwich + Toast, Swap Vendor; Shop-Only Things) Implementation Plan

## Part 4b of 2 — the job pages, the Toast link on the sandwich, Share and Back to normal, en + es

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Part 4a's engines in front of the people who use them (spec §5 jobs 2–4, "each starts from the item page and from wherever the problem first shows up, and ends with the same preview and save choices"):
- **New item** (`/admin/catalog/new/item`) — what it is → vendor (pick, or add one inline) → name + vendor item number → how it arrives (2b's sentence editor) → price → **Create** → then par, order days, order-guide section, where it's used and barcode, each saved on its own line.
- **New sandwich** (`/admin/catalog/new/sandwich`) — name → price for my shop → recipe with the searchable ingredient picker and the **cost per sandwich updating live** → **Add to the menu** → the **Toast link** (the app suggests the match; confirm, or pick from a searchable list).
- **Swap vendor** (`/admin/catalog/sku/[id]/swap`) — pick the replacement → "Just for now at my shop" / "For good" → the preview (every recipe line that switches, every sandwich's cost before and after) → **Swap it**; the item page then shows **Back to normal**.
- The menu-item page gets the **Toast link** section (Toast linking moves out of Catering); a shop-only sandwich gets its own page body (its price, its recipe, its Toast link) and, for MoO+, **Share with every shop**; the item page gets the "only at" badge, Share, **Swap vendor** and the Back-to-normal banner.
- Every way in: the admin hub cards, the costing board's "+ New sandwich", the legacy recipe list (New recipe — a GM's is its shop's own, lead decision 1 — and New sandwich), the legacy SKU form (a GM picks a shop), the recipe page's "Only at" and Share for a shop's own prep recipe. The Catering Toast tab stays exactly as it is (lead decision 6).

**Architecture:** Pure view-model rules in `lib/catalog/jobs-shared.ts`; ONE server module of page views in `lib/catalog/jobs.ts` (batch reads, fixed query count, never a read in a loop); thin server pages; client components that call only Part 4a's routes, through `postJson` / `useStepUpPost`, asking the route's own tier first (`requestStepUp("E")`, the Toast link `"A"`, an inline vendor `"B"`) and dropping late previews with 2b's `createRequestGuard`. Every string in en and es (tú).

**Tech Stack:** Next.js 16.2.4 (App Router), React 19.2.4, TypeScript strict + `noUncheckedIndexedAccess`, Tailwind (the `co-` tokens), vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-15-catalog-redesign-design.md` §5 (jobs 2–4, line 76 "ends with the same preview and save choices", line 82 "Toast linking moves out of Catering"), §3 (line 45), §8 (UI walks, en + es).

**Astra round 1 (10 P2), folded in:** the swap page sends back EXACTLY the request its preview hashed (`preview.request`) — its first confirmation is never stale; the live sandwich cost drops a stale answer on every draft change, shows "working it out" at once and clears on a refusal (a small pure state machine, tested with the real request guard); the recipe page names `ownership_changed`, `line_other_shop` and `shop_owned_edit_here`; the vendor's guide editor labels each shop's own line "Only at <shop>" (decision (b)); `ownership_changed` and `recipes_changed` have their own messages (en/es). The engine-side findings (product resolution, readiness / weights / Toast, the swap's set and primary, Back to normal's race, the item-number race, the route typing, the 0266 deploy gate) are 4a's.

**Builds on:** Part 4a (`docs/superpowers/plans/2026-10-15-catalog-phase4a-shop-only-and-job-engines.md`) merged, 0264 + 0265 applied (0266 is independent of 4b) — its routes, `lib/catalog/{shop-owned-shared, new-item-shared, new-item, new-sandwich-shared, new-sandwich, share, swap-shared, swap-vendor}.ts`, `loadToastLinkChoices`, `CatalogEntity.onlyAtShopName`, `RecipeItemView.owner`; Phase 3b's pages (`/admin/catalog/recipe/[id]`, `/admin/catalog/menu-item/[id]`, `recipeItemHref`, `menuItemPageHref`, the line-refusal pass-through in `postJson`); Phase 2b's item page and components (`PackSentenceEditor`, `levelsFromSentence`, `skuItemHref`, `createRequestGuard`); Phase 1's `IngredientPicker` / `RecipeLineEditor`.

**Working copy:** `C:\Users\conta\co-ops-guides` (or the build worktree CC assigns). Branch once 4a is on `origin/main`:

```bash
git fetch origin && git checkout -b feat/catalog-phase4b-job-pages origin/main
```

No migration in 4b.

**Standing rules for every task:** as in 4a (AGENTS.md first; sim only; en + es in the same PR, tú; every commit ends with the two trailer lines). The 4a equivalence pins stay green: `npx vitest run tests/shop-owned-equivalence.test.ts tests/recipe-versions-equivalence.test.ts`.

---

## Ground truth this plan is built on (verified 2026-10-15 against `origin/main` @ ebca0ac2 merged into `feat/catalog-p2b` @ d4399c77, plus the 3b and 4a plans' contracts)

| Fact | Where |
|---|---|
| 4a's routes and bodies: `POST jobs/new-item` (E) · `POST sku/[id]/setup` (E) `{ shopId, step }` · `POST jobs/new-sandwich/preview` (read) · `POST jobs/new-sandwich` (E) · `GET/POST menu-item/[id]/toast` (POST A; GET `?location=`) · `GET/POST menu-item/[id]/share` (E) `{ expectedOwner, shareSkuIds }` · `GET/POST sku/[id]/share` (E) `{ expectedOwner }` · `POST sku/[id]/swap/preview` (read) · `POST sku/[id]/swap` (E) `{ …request, token }` · `GET/POST swaps/[swapId]/back-to-normal` (E) `{ token }`. Every route answers `jsonOk(value)` and a refusal `jsonError(status, code, { message, line? })`. | 4a Task 12 |
| 4a's shapes: `NewItemRequest`, `SetupStep` (`par` · `order_days` · `guide_line` · `use_in` · `barcode`), `CreatedItem`, `SetupResult`; `SandwichDraft`, `SandwichCost { status, cost, pricedCost, unpricedSkuIds, foodCostPct, marginDollars }`; `ToastLinkChoices { reachable, linked, suggestions, all }`; `ShareMenuItemPreview`, `ShareRecipePreview`, `ShareSkuPreview`; `SwapRequest`, `SwapPreview { request (normalized — send it back as is), …, recipes[].changes, refused, followsPrimary, bound, untouchedShops, costs, token }`, `SwapStarted { swapId, productId, versions }` (no par write — lead decision 3), `BackToNormalPreview`; `loadLiveSwapsForItem`; `NEW_THING_MIN = 7`, `SHARE_MIN = 8`, `ownerVisible`. | 4a Tasks 2, 7–10 |
| `postJson(url, body, method?) → { ok: true, data } | { ok: false, code, line? }` (3b passes `line: { position, name, reason }` through); `useStepUpPost()` forgets the unlock on a step-up refusal; `useStepUp().requestStepUp(tier)` resolves `"ok"` when unlocked. | `components/admin/vendors/shared.ts:11-40`; 3b plan `:3425-3460`; `components/admin/useStepUpPost.ts:16-26`; `components/catalog/SkuItemClient.tsx:62-63, 142` (2b) |
| `createRequestGuard()` drops a late response (`guard.run(fn)` → null when superseded; `guard.invalidate()`). | `lib/catalog/request-guard-shared.ts` (2b) |
| `PackSentenceEditor({ draft, onChange, units, skuClass, currentLeafUnit, avgOzPerEach, error, busy })`; `SentenceDraft { containers: { label, qty }[], leafQty, leafUnit }`; `levelsFromSentence(draft, measureLabels) → { ok, levels } | { ok: false, error, index }`. | `components/catalog/PackSentenceEditor.tsx:32-50`, `lib/catalog/pack-sentence-shared.ts:17-60` (2b) |
| `IngredientPicker({ options, value, onChange, disabled })`; `buildIngredientOptions({ skus, items, products })`; `RecipeLineEditor({ title, submitLabel, options, skus, products, measures, activeMeasureLabels, initial, busy, errorMsg, onSubmit, onCancel })` with `RecipeLineDraft` (= `RecipeLineFields` + `componentName`); `loadRecipeBuilderCatalog() → { skus, items, products, unitOptions, measures, activeMeasureLabels }` (every active, non-inventory-only SKU — no owner filter); `scopedPickerSkus(skus, packs)` + `loadSkuPackResolution(ids, scope)` give the shop's packs (3b). | `components/admin/recipes/IngredientPicker.tsx:33-45`, `RecipeLineEditor.tsx:30-60`; `lib/ingredient-picker-shared.ts:13-50`; `lib/admin/recipe-builder-data.ts:17-88`; 3b plan `:281-290, 1810-1815` |
| The menu-item page (3b) resolves its scope, loads `loadMenuItemPageView(auth, id, scope)` and renders `MenuItemClient` keyed by `pageClientKey("menu", …)`; `view.toastLinks` counts confirmed links. | 3b plan `:4373-4425, 2067-2110` |
| The item page (2b) reads `vendor_items (id, location_id)`, offers only the owner shop for a shop-owned item, renders `SkuItemClient` keyed by `itemClientKey(…)`. | `app/admin/catalog/sku/[id]/page.tsx:39-68` (2b) |
| Shop params: exact routes `SHOP_PARAMS_BY_PATH`, prefixes `SHOP_PARAMS_BY_PREFIX` (`/admin/catalog/sku/` is a prefix); `shopParamFor(path, searchParamValues(sp))`, `resolveShopId(ids, explicit)`. | `lib/shop-context-shared.ts:70-115` (2b) |
| The admin hub registry `ADMIN_SECTIONS { id, i18nKey, href, minLevel }`, display order; `menu-costing` sits after `items`. | `lib/admin/sections.ts:15-60` |
| Vendors: `POST /api/admin/vendors` (GM+, **Tier B**) `{ name, categoryIds[], orderTypeIds[], firstContact { name, email?, phone? }, firstOrdering { method, value } }` → `201 { id }`; `loadCategories(actor)` / `loadOrderTypes(actor)` → `{ id, slug, label, labelEs }`; ordering methods `email · url · phone · portal · other`. | `app/api/admin/vendors/route.ts:21-76`; `lib/admin/vendors.ts:63, 73-85, 302, 397` |
| Order guides are `vendor_order_guides (id, vendor_id, name, updated_at)` + `order_guide_sections (id, guide_id, name, position)`; rhythm pairs `vendor_delivery_rhythm (vendor_id, location_id, order_dow 0 = Sun … 6 = Sat, lead_days, active)`; weekday labels `people.weekday.sun … sat`. | `lib/order-guides.ts:61-68`; `lib/vendor-rhythm.ts:174-230`; `lib/vendor-rhythm-shared.ts:47`; `components/admin/vendors/VendorListClient.tsx:193-197` |
| The menu price writer `PATCH /api/admin/menu-items/[id]/price { menuPrice, expectedMenuPrice }` (Tier E; GM for a shop-only sandwich since 4a). | `app/api/admin/menu-items/[id]/price/route.ts`; 4a Task 6 |
| Legacy screens: `RecipesClient` shows "New recipe" for `level >= RECIPE_WRITE_MIN` (`components/admin/recipes/RecipesClient.tsx:43, 111-121`); `/admin/recipes/new` gates only `RECIPE_READ_MIN` (`app/admin/recipes/new/page.tsx:35-37`); `SkuBuilder` create mode offers "Global" as the location's empty option (`components/admin/skus/SkuBuilder.tsx:252, 326, 527-533`); the Catering Toast tab's body opens with `<div className="mt-4 flex flex-col gap-6">` and its error line (`components/admin/catering/menu/ToastTab.tsx:119-121`); the catalog list's row summary renders `{e.name}`, `<TypeBadge e={e} />`, `<RoleBadges e={e} />` (`components/admin/catalog/CatalogClient.tsx:329-334`). | as named |
| `formatCents(cents, language)`, `formatDateLabel(yyyymmdd, language)`, `formatQuantity(n, language)`; `t(key, params)`; `TranslationKey = keyof typeof en`. | `lib/i18n/format.ts:138, 224, 242`; `lib/i18n/types.ts:20` |

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/catalog/jobs-shared.ts`, `tests/catalog-jobs-shared.test.ts` | create | Links, the error → message map, the setup checklist state, the cost line, weekday keys. |
| `lib/catalog/jobs.ts`, `tests/catalog-jobs-views.test.ts` | create | The page views: new item, new sandwich, swap, a shop-only sandwich, the item page's jobs strip. |
| `lib/i18n/en.json`, `lib/i18n/es.json`, `tests/catalog-jobs-i18n.test.ts` | modify / create | Every string, en + es. |
| `components/catalog/ToastLinkSection.tsx`, `components/catalog/ShareWithEveryShop.tsx` | create | Shared by the job and the pages. |
| `components/catalog/jobs/NewItemJob.tsx`, `app/admin/catalog/new/item/page.tsx` | create | Job 2. |
| `components/catalog/jobs/NewSandwichJob.tsx`, `app/admin/catalog/new/sandwich/page.tsx` | create | Job 4. |
| `components/catalog/jobs/SwapVendorJob.tsx`, `app/admin/catalog/sku/[id]/swap/page.tsx`, `components/catalog/ItemJobsStrip.tsx`, `app/admin/catalog/sku/[id]/page.tsx` | create / modify | Job 3; the item page's badge, Share, Swap and Back to normal. |
| `components/catalog/OwnedSandwichClient.tsx`, `app/admin/catalog/menu-item/[id]/page.tsx` | create / modify | A shop-only sandwich's page; the Toast link on every menu item at a shop. |
| `lib/shop-context-shared.ts`, `lib/admin/sections.ts`, `app/admin/menu-costing/page.tsx`, `components/admin/recipes/RecipesClient.tsx`, `components/admin/recipes/RecipeBuilder.tsx`, `app/admin/recipes/new/page.tsx`, `components/admin/skus/SkuBuilder.tsx`, `components/admin/catalog/CatalogClient.tsx`, `app/admin/catalog/recipe/[id]/page.tsx` | modify | Every way in; a GM's legacy recipe is its shop's own; a shop's own prep recipe shows "Only at" and Share. |
| `tests/catalog-jobs-ui.test.ts`, `tests/step-up-tier-map.test.ts` | create / modify | Source pins for the clients and navigation; the clients' tiers. |
| `docs/guides/manager-guide.md` | modify | Guide text (en + es). |
| `AGENTS.md` | modify | The pages' law. |

---

## Task 1: The pure view rules (`lib/catalog/jobs-shared.ts`)

**Files:**
- Create: `lib/catalog/jobs-shared.ts`, `tests/catalog-jobs-shared.test.ts`

- [ ] **Step 1: Write the failing test `tests/catalog-jobs-shared.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  costLine, initialSetupState, JOB_ERROR_CODES, jobErrorKey, liveCostOnAnswer, liveCostOnDraftChange, newItemHref, newSandwichHref,
  setupRemaining, swapHref, WEEKDAY_KEYS, type LiveCost,
} from "@/lib/catalog/jobs-shared";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";

const SHOP = "11111111-1111-4111-8111-111111111111";
const SKU = "22222222-2222-4222-8222-222222222222";

describe("links", () => {
  it("each job has one address; a shop rides ?location=", () => {
    expect(newItemHref()).toBe("/admin/catalog/new/item");
    expect(newItemHref({ shopId: SHOP })).toBe(`/admin/catalog/new/item?location=${SHOP}`);
    expect(newItemHref({ shopId: null })).toBe("/admin/catalog/new/item?location=global");
    expect(newSandwichHref({ shopId: SHOP })).toBe(`/admin/catalog/new/sandwich?location=${SHOP}`);
    expect(swapHref(SKU, { shopId: SHOP })).toBe(`/admin/catalog/sku/${SKU}/swap?location=${SHOP}`);
  });
});

describe("jobErrorKey", () => {
  it("every known refusal has its own message; anything else is the generic one", () => {
    for (const c of JOB_ERROR_CODES) expect(jobErrorKey(c)).toBe(`catalog.jobs.error.${c}`);
    expect(jobErrorKey("boom")).toBe("catalog.jobs.error.generic");
  });
});

describe("the setup checklist", () => {
  it("a step that needs a vendor waits for one; nothing is done yet", () => {
    expect(initialSetupState(false)).toEqual({ par: "todo", order_days: "needs_vendor", guide_line: "needs_vendor", use_in: "todo", barcode: "needs_vendor" });
    expect(setupRemaining(initialSetupState(true))).toEqual(["par", "order_days", "guide_line", "use_in", "barcode"]);
    expect(setupRemaining({ ...initialSetupState(true), par: "done", barcode: "skipped" })).toEqual(["order_days", "guide_line", "use_in"]);
  });
});

describe("costLine — what the live cost says", () => {
  const base = { pricedCost: 0, unpricedSkuIds: [] as string[], foodCostPct: null, marginDollars: null };
  it("a whole cost, a lower bound while something is unpriced, or nothing yet", () => {
    expect(costLine({ ...base, status: "costed", cost: 3.2, foodCostPct: 26.7, marginDollars: 8.8 })).toEqual({ kind: "costed", cost: 3.2, pct: 26.7, margin: 8.8 });
    expect(costLine({ ...base, status: "partial", cost: null, pricedCost: 2.5, unpricedSkuIds: ["a", "b"] })).toEqual({ kind: "partial", pricedCost: 2.5, missing: 2 });
    expect(costLine({ ...base, status: "no_recipe", cost: null })).toEqual({ kind: "empty" });
    expect(costLine({ ...base, status: "unresolved", cost: null })).toEqual({ kind: "unresolved" });
  });
});

describe("the live cost — behaviorally, with the real request guard (Astra 4b r1#9)", () => {
  it("a draft change shows PENDING at once; a late answer for the old draft is dropped; a refusal never leaves the old cost", async () => {
    const guard = createRequestGuard();
    let state: LiveCost<number> = liveCostOnDraftChange<number>(true);
    let releaseOld!: (v: { ok: true; data: number }) => void;
    const old = guard.run(() => new Promise<{ ok: true; data: number }>((r) => { releaseOld = r; }));
    // The draft changes before the old answer lands: drop what is in flight, show pending.
    guard.invalidate();
    state = liveCostOnDraftChange<number>(true);
    const fresh = guard.run(async () => ({ ok: false as const, code: "invalid_quantity" }));
    releaseOld({ ok: true, data: 3.2 });
    state = liveCostOnAnswer(state, await old);
    expect(state).toEqual({ status: "pending" }); // the old draft's 3.20 never shows
    state = liveCostOnAnswer(state, await fresh);
    expect(state).toEqual({ status: "refused", code: "invalid_quantity" }); // and no stale cost survives the refusal
    expect(liveCostOnAnswer(state, { ok: true, data: 4 })).toEqual({ status: "ready", cost: 4 });
    expect(liveCostOnDraftChange<number>(false)).toEqual({ status: "idle" });
  });
});

describe("weekdays", () => {
  it("0 = Sunday … 6 = Saturday, the rhythm's own convention", () => {
    expect(WEEKDAY_KEYS[0]).toBe("people.weekday.sun");
    expect(WEEKDAY_KEYS[6]).toBe("people.weekday.sat");
  });
});
```

- [ ] **Step 2: Create `lib/catalog/jobs-shared.ts`**

```ts
/**
 * THE GUIDED JOBS' PAGES — shared and pure (catalog Phase 4b). Their addresses, the refusal → message map, the new
 * item's setup checklist, and what the live sandwich cost says. No I/O; safe in client bundles.
 */
import type { TranslationKey } from "@/lib/i18n/types";
import type { SandwichCost } from "@/lib/catalog/new-sandwich-shared";
import type { SetupStep } from "@/lib/catalog/new-item-shared";

const withShop = (path: string, shopId: string | null | undefined): string =>
  shopId === undefined ? path : `${path}?location=${shopId === null ? "global" : encodeURIComponent(shopId)}`;

/** Job 2. `shopId` null = every shop (MoO+); undefined = the remembered shop. */
export function newItemHref(opts: { shopId?: string | null } = {}): string {
  return withShop("/admin/catalog/new/item", opts.shopId);
}
/** Job 4 (a sandwich always starts at a shop). */
export function newSandwichHref(opts: { shopId?: string | null } = {}): string {
  return withShop("/admin/catalog/new/sandwich", opts.shopId);
}
/** Job 3, from the item page. */
export function swapHref(skuId: string, opts: { shopId?: string | null } = {}): string {
  return withShop(`/admin/catalog/sku/${encodeURIComponent(skuId)}/swap`, opts.shopId);
}

/** Every refusal the job routes name (4a), each with its own message in en + es. */
export const JOB_ERROR_CODES = [
  "forbidden", "not_found", "global_requires_moo", "shop_owned_edit_here", "name_taken", "item_number_taken", "invalid_name",
  "invalid_price", "invalid_date", "invalid_levels", "invalid_payload", "incomplete_recipe", "invalid_quantity", "invalid_component",
  "product_line_needs_measure_unit", "label_is_measure_unit", "duplicate_label", "invalid_label", "invalid_qty", "invalid_link",
  "unknown_measure", "leaf_needs_avg", "chain_unreachable", "needs_vendor", "overlay_changed", "rhythm_pair_conflict", "guide_stale",
  "level_differs", "invalid_code", "version_changed", "dependencies_changed", "dependencies_busy", "preview_stale",
  "swap_line_unit_unknown", "already_swapped", "in_other_product", "product_needs_primary", "product_name_taken", "sku_not_found",
  "swap_not_found", "not_live", "ownership_changed", "recipes_changed", "already_shared", "skus_changed", "uses_other_shop_sku", "invalid_entity",
  "open_item_guid", "conflict", "vendor_not_found", "location_not_found", "step_up_required", "step_up_stale",
  "line_other_shop", "uses_shop_only_item", "items_changed", "location_required", "share_the_sandwich",
] as const;

export function jobErrorKey(code: string): TranslationKey {
  return ((JOB_ERROR_CODES as readonly string[]).includes(code) ? `catalog.jobs.error.${code}` : "catalog.jobs.error.generic") as TranslationKey;
}

/** One line per setup step: to do, saving, done, skipped, waiting for a vendor, or failed (with the refusal's code). */
export type SetupStatus = "todo" | "saving" | "done" | "skipped" | "needs_vendor" | { failed: string };
export type SetupState = Record<SetupStep["kind"], SetupStatus>;
export const SETUP_ORDER: readonly SetupStep["kind"][] = ["par", "order_days", "guide_line", "use_in", "barcode"];

/** A new item's checklist: order days, its vendor's guide and the barcode all need a vendor. */
export function initialSetupState(hasVendor: boolean): SetupState {
  const v: SetupStatus = hasVendor ? "todo" : "needs_vendor";
  return { par: "todo", order_days: v, guide_line: v, use_in: "todo", barcode: v };
}

/** What is still open, in the checklist's order (failed steps stay open). */
export function setupRemaining(s: SetupState): SetupStep["kind"][] {
  return SETUP_ORDER.filter((k) => s[k] !== "done" && s[k] !== "skipped" && s[k] !== "needs_vendor");
}

export type CostLine =
  | { kind: "costed"; cost: number; pct: number | null; margin: number | null }
  | { kind: "partial"; pricedCost: number; missing: number }
  | { kind: "unresolved" }
  | { kind: "empty" };

/** What the live cost says: the whole cost, a lower bound while an ingredient has no price, or why there is none. */
export function costLine(c: SandwichCost): CostLine {
  if (c.cost !== null) return { kind: "costed", cost: c.cost, pct: c.foodCostPct, margin: c.marginDollars };
  if (c.unpricedSkuIds.length > 0) return { kind: "partial", pricedCost: c.pricedCost, missing: c.unpricedSkuIds.length };
  if (c.status === "no_recipe") return { kind: "empty" };
  return { kind: "unresolved" };
}

/**
 * THE LIVE SANDWICH COST as a small state machine (Astra 4b r1#9). A draft change makes the shown cost PENDING at once —
 * never the previous draft's number; an answer for an older draft is dropped (the request guard hands back null for it);
 * a refusal clears the cost and says why.
 */
export type LiveCost<C> = { status: "idle" } | { status: "pending" } | { status: "ready"; cost: C } | { status: "refused"; code: string };

export function liveCostOnDraftChange<C>(hasLines: boolean): LiveCost<C> {
  return hasLines ? { status: "pending" } : { status: "idle" };
}

export function liveCostOnAnswer<C>(current: LiveCost<C>, answer: { ok: true; data: C } | { ok: false; code: string } | null): LiveCost<C> {
  if (answer === null) return current;
  return answer.ok ? { status: "ready", cost: answer.data } : { status: "refused", code: answer.code };
}

/** Weekday 0 = Sunday … 6 = Saturday (the rhythm's own convention) → the people.weekday.* labels. */
export const WEEKDAY_KEYS: readonly TranslationKey[] = [
  "people.weekday.sun", "people.weekday.mon", "people.weekday.tue", "people.weekday.wed",
  "people.weekday.thu", "people.weekday.fri", "people.weekday.sat",
] as TranslationKey[];
```

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/catalog-jobs-shared.test.ts` → expected: PASS once Task 3's strings exist for `tsc`; vitest passes now (the keys are only strings here).

```bash
git add lib/catalog/jobs-shared.ts tests/catalog-jobs-shared.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4b pure job-page rules — links, refusal messages, setup checklist, cost line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 2: The page views (`lib/catalog/jobs.ts`)

Each view is a fixed number of batch reads (no read inside a loop), gated before any I/O, and built only from what the actor may use at that shop (`ownerVisible`).

**Files:**
- Create: `lib/catalog/jobs.ts`, `tests/catalog-jobs-views.test.ts`

- [ ] **Step 1: Write the failing test `tests/catalog-jobs-views.test.ts`**

```ts
/** Catalog Phase 4b — the job pages' views: only what this shop may use, in a fixed number of reads. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture, LOC, OTHER, OWNED_MENU, OWNED_RECIPE } from "./fixtures/shop-owned-fixture";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no database expected");
  return current.client;
} }));
vi.mock("@/lib/admin/vendors", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin/vendors")>()),
  loadCategories: async () => [{ id: "c-1", slug: "produce", label: "Produce", labelEs: "Frutas y verduras" }],
  loadOrderTypes: async () => [{ id: "o-1", slug: "delivery", label: "Delivery", labelEs: "Entrega" }],
}));

import { loadItemJobsStrip, loadNewItemJobView, loadNewSandwichJobView, loadOwnedSandwichView, loadSwapJobView } from "@/lib/catalog/jobs";

const gm = { user: { id: "u-1", role: "gm", name: "T" }, role: "gm", level: 7, locations: [LOC] } as never;
const moo = { user: { id: "u-2", role: "moo", name: "T" }, role: "moo", level: 8, locations: [] } as never;

beforeEach(() => {
  const t = buildShopOwnedFixture();
  t.vendor_items!.push({ id: "s-b-only", name: "B relish", vendor_id: null, location_id: OTHER, active: true, inventory_only: false });
  // The recipe builder's catalog reads `inventory_only = false` (and `location_id` for the owner filter): say so on every row.
  for (const s of t.vendor_items!) { s.inventory_only ??= false; s.location_id ??= null; }
  t.vendor_order_guides = [];
  t.order_guide_sections = [];
  t.vendor_delivery_rhythm = [];
  t.sku_swaps = [];
  t.toast_menu_map = [];
  current = createFakeDb(t);
});
afterEach(() => { current = null; });

describe("loadNewItemJobView", () => {
  it("a GM's shops only, no 'every shop'; every shared recipe plus its shop's own, with the versions an add must name", async () => {
    const v = await loadNewItemJobView(gm, LOC);
    expect(v.shops.map((s) => s.id)).toEqual([LOC]);
    expect(v.canCreateEverywhere).toBe(false);
    const own = v.recipes.find((r) => r.id === OWNED_RECIPE)!;
    expect(own).toMatchObject({ ownedHere: true, expectedVersionId: `rv-${OWNED_RECIPE}-base`, basedOnVersionId: null });
    expect(v.recipes.find((r) => r.id === "r-italian")).toMatchObject({ ownedHere: false, expectedVersionId: null, basedOnVersionId: "rv-r-italian-base" });
    expect(v.categories).toHaveLength(1);
  });
  it("another shop's GM never sees Shop one's own recipe; a level-6 is refused before any read", async () => {
    const other = { user: { id: "u-3", role: "gm", name: "T" }, role: "gm", level: 7, locations: [OTHER] } as never;
    expect((await loadNewItemJobView(other, OTHER)).recipes.some((r) => r.id === OWNED_RECIPE)).toBe(false);
    current = null;
    await expect(loadNewItemJobView({ user: { id: "x", role: "agm", name: "T" }, role: "agm", level: 6, locations: [LOC] } as never, LOC))
      .rejects.toMatchObject({ status: 403 });
  });
});

describe("loadNewSandwichJobView", () => {
  it("the picker never offers another shop's own item", async () => {
    const v = await loadNewSandwichJobView(gm, LOC);
    expect(v.picker.skus.some((s) => s.id === "s-b-only")).toBe(false);
    expect(v.picker.skus.some((s) => s.id === "s-turkey")).toBe(true);
  });
});

describe("loadSwapJobView", () => {
  it("offers every other item this shop may buy, and says whether 'every shop' is allowed", async () => {
    const v = await loadSwapJobView(gm, "s-pickle", LOC);
    expect(v.oldSku.id).toBe("s-pickle");
    expect(v.candidates.some((c) => c.id === "s-pickle")).toBe(false);
    expect(v.candidates.some((c) => c.id === "s-b-only")).toBe(false);
    expect(v.canEverywhere).toBe(false);
    expect((await loadSwapJobView(moo, "s-pickle", LOC)).canEverywhere).toBe(true);
  });
});

describe("loadOwnedSandwichView and loadItemJobsStrip", () => {
  it("a shop-only sandwich: its price, its recipe, its cost where it is sold; MoO may share", async () => {
    const v = await loadOwnedSandwichView(gm, OWNED_MENU);
    expect(v).toMatchObject({ menuItem: { id: OWNED_MENU, price: 11 }, owner: { shopId: LOC, shopName: "Shop one" }, canEditPrice: true, canShare: false, recipe: { id: OWNED_RECIPE } });
    expect(v.cost).not.toBeNull();
    expect((await loadOwnedSandwichView(moo, OWNED_MENU)).canShare).toBe(true);
  });
  it("the item page's strip: swap offered at a shop; no live swap yet", async () => {
    const s = await loadItemJobsStrip(gm, "s-pickle", LOC);
    expect(s).toMatchObject({ skuId: "s-pickle", owner: null, canShare: false, canSwap: true, liveSwaps: [] });
  });
});
```

Run: `npx vitest run tests/catalog-jobs-views.test.ts` → expected: FAIL (module missing).

- [ ] **Step 2: Create `lib/catalog/jobs.ts`**

```ts
/**
 * THE GUIDED JOBS' PAGE VIEWS (catalog Phase 4b). SERVER-ONLY, service role. Each view is gated before any I/O and is a
 * fixed number of batch reads; each offers only what the actor may use at that shop (a shop-only thing of another shop
 * is never offered — ownerVisible). The writes are 4a's routes; nothing here writes.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { AuthContext } from "@/lib/session";
import { catalogShopAllowed, GLOBAL_VERSION_WRITE_MIN, type VersionScope } from "@/lib/sku-versions-shared";
import { NEW_THING_MIN, ownerVisible, SHARE_MIN, ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { loadCategories, loadOrderTypes } from "@/lib/admin/vendors";
import { loadRecipeBuilderCatalog } from "@/lib/admin/recipe-builder-data";
import { loadRecipeGraph, loadSkuPackResolution } from "@/lib/prep-consumption";
import { scopedPickerSkus } from "@/lib/catalog/recipe-item-shared";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { loadLiveSwapsForItem } from "@/lib/catalog/swap-vendor";
import { TOAST_MAP_MIN } from "@/lib/admin/toast-map";
import { swapHref } from "@/lib/catalog/jobs-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;
export interface JobShop { id: string; name: string }

function requireJobLevel(actor: AuthContext): void {
  if (actor.level < NEW_THING_MIN) throw new ShopOwnedError(403, "forbidden");
}

/** The active shops this actor may start things at (MoO+ every one). One read. */
async function allowedShops(sb: Sb, actor: AuthContext): Promise<JobShop[]> {
  const { data, error } = await sb.from("locations").select("id, name").eq("active", true).order("name").order("id")
    .returns<JobShop[]>();
  if (error) throw new Error(`job shops: ${error.message}`);
  return (data ?? []).filter((l) => catalogShopAllowed(actor, l.id));
}

/** recipe → { owner, global head, this shop's live version }: two paged reads, never one per recipe. */
async function recipeHeads(sb: Sb, scope: VersionScope): Promise<{
  recipes: Array<{ id: string; name: string; location_id: string | null }>;
  heads: Map<string, { global: string | null; shop: string | null }>;
}> {
  const [recipes, versions] = await Promise.all([
    selectAllRows<{ id: string; name: string; location_id: string | null }>(async (from, to) => {
      const { data, error } = await sb.from("recipes").select("id, name, location_id").eq("active", true)
        .order("name", { ascending: true }).order("id", { ascending: true }).range(from, to)
        .returns<Array<{ id: string; name: string; location_id: string | null }>>();
      if (error) throw new Error(`job recipes: ${error.message}`);
      return { data };
    }),
    selectAllRows<{ id: string; recipe_id: string; location_id: string | null }>(async (from, to) => {
      const base = sb.from("recipe_versions").select("id, recipe_id, location_id").eq("active", true);
      const scoped = scope === null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${scope}`);
      const { data, error } = await scoped.order("id", { ascending: true }).range(from, to)
        .returns<Array<{ id: string; recipe_id: string; location_id: string | null }>>();
      if (error) throw new Error(`job recipe versions: ${error.message}`);
      return { data };
    }),
  ]);
  const heads = new Map<string, { global: string | null; shop: string | null }>();
  for (const v of versions) {
    const h = heads.get(v.recipe_id) ?? { global: null, shop: null };
    if (v.location_id === null) h.global = v.id; else h.shop = v.id;
    heads.set(v.recipe_id, h);
  }
  return { recipes: recipes.filter((r) => ownerVisible(r.location_id ?? null, scope)), heads };
}

// ── Job 2: New item ──────────────────────────────────────────────────────────

export interface NewItemJobView {
  shops: JobShop[];
  /** MoO+: may create an item for every shop (scope null). */
  canCreateEverywhere: boolean;
  scope: string | null;
  scopeName: string | null;
  vendors: Array<{ id: string; name: string; hasGuide: boolean; sections: Array<{ id: string; name: string }>; daysHere: number[] }>;
  categories: Array<{ id: string; label: string; labelEs: string | null }>;
  orderTypes: Array<{ id: string; label: string; labelEs: string | null }>;
  /** The measure registry, for the sentence editor's leaf ("lb", "each", "fl oz"). */
  units: Array<{ label: string; dimension: "weight" | "volume" | "count" }>;
  /** Recipes this shop makes — where the item may be used — with the versions an added line must name (3a). */
  recipes: Array<{ id: string; name: string; ownedHere: boolean; expectedVersionId: string | null; basedOnVersionId: string | null }>;
}

export async function loadNewItemJobView(actor: AuthContext, scope: VersionScope): Promise<NewItemJobView> {
  requireJobLevel(actor);
  if (scope === null && actor.level < GLOBAL_VERSION_WRITE_MIN) throw new ShopOwnedError(403, "global_requires_moo");
  const sb = getServiceRoleClient();
  const [shops, vendors, guides, units, categories, orderTypes, rhythm, { recipes, heads }] = await Promise.all([
    allowedShops(sb, actor),
    sb.from("vendors").select("id, name").eq("active", true).eq("source_kind", "vendor").order("name").returns<Array<{ id: string; name: string }>>(),
    sb.from("vendor_order_guides").select("id, vendor_id").returns<Array<{ id: string; vendor_id: string }>>(),
    sb.from("measure_units").select("label, dimension").eq("active", true).order("display_order").returns<Array<{ label: string; dimension: "weight" | "volume" | "count" }>>(),
    loadCategories(actor),
    loadOrderTypes(actor),
    scope === null
      ? Promise.resolve({ data: [] as Array<{ vendor_id: string; order_dow: number }>, error: null })
      : sb.from("vendor_delivery_rhythm").select("vendor_id, order_dow").eq("location_id", scope).eq("active", true)
          .returns<Array<{ vendor_id: string; order_dow: number }>>(),
    recipeHeads(sb, scope),
  ]);
  for (const [label, r] of [["vendors", vendors], ["guides", guides], ["units", units], ["rhythm", rhythm]] as const) {
    if (r.error) throw new Error(`new item view ${label}: ${r.error.message}`);
  }
  if (scope !== null && !shops.some((s) => s.id === scope)) throw new ShopOwnedError(404, "not_found");
  const guideIds = (guides.data ?? []).map((g) => g.id);
  const sections = guideIds.length
    ? await sb.from("order_guide_sections").select("id, guide_id, name, position").in("guide_id", guideIds).order("position")
        .returns<Array<{ id: string; guide_id: string; name: string; position: number }>>()
    : { data: [] as Array<{ id: string; guide_id: string; name: string; position: number }>, error: null };
  if (sections.error) throw new Error(`new item view sections: ${sections.error.message}`);
  const guideOf = new Map((guides.data ?? []).map((g) => [g.vendor_id, g.id]));
  return {
    shops, canCreateEverywhere: actor.level >= GLOBAL_VERSION_WRITE_MIN, scope, scopeName: shops.find((s) => s.id === scope)?.name ?? null,
    vendors: (vendors.data ?? []).map((v) => ({
      id: v.id, name: v.name, hasGuide: guideOf.has(v.id),
      sections: (sections.data ?? []).filter((s) => s.guide_id === guideOf.get(v.id)).map((s) => ({ id: s.id, name: s.name })),
      daysHere: [...new Set((rhythm.data ?? []).filter((p) => p.vendor_id === v.id).map((p) => p.order_dow))].sort((a, b) => a - b),
    })),
    categories: categories.map((c) => ({ id: c.id, label: c.label, labelEs: c.labelEs })),
    orderTypes: orderTypes.map((o) => ({ id: o.id, label: o.label, labelEs: o.labelEs })),
    units: units.data ?? [],
    recipes: recipes.map((r) => {
      const h = heads.get(r.id) ?? { global: null, shop: null };
      // A shop's own recipe is edited as itself (its global head); a shared one gets this shop's version (3a / 4a).
      const ownedHere = scope !== null && r.location_id === scope;
      return {
        id: r.id, name: r.name, ownedHere,
        expectedVersionId: ownedHere || scope === null ? h.global : h.shop,
        basedOnVersionId: ownedHere || scope === null || h.shop !== null ? null : h.global,
      };
    }),
  };
}

// ── Job 4: New sandwich ──────────────────────────────────────────────────────

export interface NewSandwichJobView {
  shops: JobShop[];
  shopId: string;
  shopName: string;
  sections: string[];
  picker: {
    skus: ReturnType<typeof scopedPickerSkus>;
    items: Array<{ id: string; name: string }>;
    products: Array<{ id: string; name: string; unitOz: number | null }>;
    measures: Array<{ label: string; dimension: string; toBaseFactor: number }>;
    activeMeasureLabels: string[];
  };
}

/** SKUs another shop owns (0095 / 0264): never offered to this shop. One read. */
async function otherShopsSkuIds(sb: Sb, shopId: string | null): Promise<Set<string>> {
  const rows = await selectAllRows<{ id: string; location_id: string }>(async (from, to) => {
    const { data, error } = await sb.from("vendor_items").select("id, location_id").not("location_id", "is", null)
      .order("id", { ascending: true }).range(from, to).returns<Array<{ id: string; location_id: string }>>();
    if (error) throw new Error(`job owned items: ${error.message}`);
    return { data };
  });
  return new Set(rows.filter((r) => r.location_id !== shopId).map((r) => r.id));
}

export async function loadNewSandwichJobView(actor: AuthContext, shopId: string): Promise<NewSandwichJobView> {
  requireJobLevel(actor);
  if (!catalogShopAllowed(actor, shopId)) throw new ShopOwnedError(404, "not_found");
  const sb = getServiceRoleClient();
  const [shops, catalog, hidden, sectionsRes] = await Promise.all([
    allowedShops(sb, actor),
    loadRecipeBuilderCatalog(),
    otherShopsSkuIds(sb, shopId),
    sb.from("menu_items").select("section").eq("active", true).not("section", "is", null).returns<Array<{ section: string }>>(),
  ]);
  if (sectionsRes.error) throw new Error(`new sandwich sections: ${sectionsRes.error.message}`);
  const shop = shops.find((s) => s.id === shopId);
  if (!shop) throw new ShopOwnedError(404, "not_found");
  const skus = catalog.skus.filter((s) => !hidden.has(s.id));
  // …and another shop's own prep items (lead decision 2): one read, then the same rule.
  const ownedItems = await selectAllRows<{ id: string; location_id: string }>(async (from, to) => {
    const { data, error } = await getServiceRoleClient().from("items").select("id, location_id").not("location_id", "is", null)
      .order("id", { ascending: true }).range(from, to).returns<Array<{ id: string; location_id: string }>>();
    if (error) throw new Error(`new sandwich owned items: ${error.message}`);
    return { data };
  });
  const hiddenItems = new Set(ownedItems.filter((i) => i.location_id !== shopId).map((i) => i.id));
  // THE SHOP'S packs for the picker (3b's scopedPickerSkus): a line in "case" means this shop's case.
  const packs = await loadSkuPackResolution(skus.map((s) => s.id), shopId);
  return {
    shops, shopId, shopName: shop.name,
    sections: [...new Set((sectionsRes.data ?? []).map((m) => m.section))].sort((a, b) => a.localeCompare(b)),
    picker: {
      skus: scopedPickerSkus(skus, packs), items: catalog.items.filter((i) => !hiddenItems.has(i.id)), products: catalog.products,
      measures: [...catalog.measures].map(([label, m]) => ({ label, dimension: m.dimension, toBaseFactor: m.toBaseFactor })),
      activeMeasureLabels: catalog.activeMeasureLabels,
    },
  };
}

// ── Job 3: Swap vendor ───────────────────────────────────────────────────────

export interface SwapJobView {
  oldSku: { id: string; name: string; vendorName: string | null; ownerShopId: string | null };
  shops: JobShop[];
  scope: string;
  scopeName: string;
  /** MoO+: "For good, every shop" (the default) is offered. */
  canEverywhere: boolean;
  /** Every OTHER active item this shop may buy (shared, or its own). */
  candidates: Array<{ id: string; name: string; vendorName: string | null }>;
  liveSwapId: string | null;
}

export async function loadSwapJobView(actor: AuthContext, skuId: string, scope: string): Promise<SwapJobView> {
  requireJobLevel(actor);
  if (!catalogShopAllowed(actor, scope)) throw new ShopOwnedError(404, "not_found");
  const sb = getServiceRoleClient();
  const [shops, skus, vendors, live] = await Promise.all([
    allowedShops(sb, actor),
    selectAllRows<{ id: string; name: string; vendor_id: string | null; location_id: string | null }>(async (from, to) => {
      const { data, error } = await sb.from("vendor_items").select("id, name, vendor_id, location_id").eq("active", true)
        .order("name", { ascending: true }).order("id", { ascending: true }).range(from, to)
        .returns<Array<{ id: string; name: string; vendor_id: string | null; location_id: string | null }>>();
      if (error) throw new Error(`swap view items: ${error.message}`);
      return { data };
    }),
    sb.from("vendors").select("id, name").returns<Array<{ id: string; name: string }>>(),
    loadLiveSwapsForItem(actor, skuId, scope),
  ]);
  if (vendors.error) throw new Error(`swap view vendors: ${vendors.error.message}`);
  const vendorName = (id: string | null) => (id === null ? null : (vendors.data ?? []).find((v) => v.id === id)?.name ?? null);
  const old = skus.find((s) => s.id === skuId);
  const shop = shops.find((s) => s.id === scope);
  if (!old || !shop || !ownerVisible(old.location_id ?? null, scope)) throw new ShopOwnedError(404, "not_found");
  return {
    oldSku: { id: old.id, name: old.name, vendorName: vendorName(old.vendor_id), ownerShopId: old.location_id ?? null },
    shops, scope, scopeName: shop.name,
    canEverywhere: actor.level >= GLOBAL_VERSION_WRITE_MIN && (old.location_id ?? null) === null,
    candidates: skus.filter((s) => s.id !== skuId && ownerVisible(s.location_id ?? null, scope))
      .map((s) => ({ id: s.id, name: s.name, vendorName: vendorName(s.vendor_id) })),
    liveSwapId: live.find((l) => l.oldSkuId === skuId)?.swapId ?? null,
  };
}

// ── A shop-only sandwich's page ──────────────────────────────────────────────

export interface OwnedSandwichView {
  menuItem: { id: string; name: string; nameEs: string | null; price: number | null; section: string | null };
  owner: { shopId: string; shopName: string };
  /** Its shop's GM (and MoO+) sets its price (4a). */
  canEditPrice: boolean;
  /** MoO+ shares it with every shop. */
  canShare: boolean;
  /** GM+ links it to Toast at its shop. */
  canLinkToast: boolean;
  recipe: { id: string; name: string } | null;
  /** What one costs where it is sold (THE costing rollup on its shop's graph). */
  cost: number | null;
}

export async function loadOwnedSandwichView(actor: AuthContext, menuItemId: string): Promise<OwnedSandwichView> {
  if (actor.level < 6) throw new ShopOwnedError(403, "forbidden");
  const sb = getServiceRoleClient();
  const { data: m, error } = await sb.from("menu_items").select("id, name, name_es, menu_price, section, location_id, active").eq("id", menuItemId)
    .maybeSingle<{ id: string; name: string; name_es: string | null; menu_price: number | string | null; section: string | null; location_id: string | null; active: boolean }>();
  if (error) throw new Error(`owned sandwich: ${error.message}`);
  if (!m || !m.active || !m.location_id) throw new ShopOwnedError(404, "not_found");
  const owner = m.location_id;
  const [shop, outs, graph] = await Promise.all([
    sb.from("locations").select("id, name").eq("id", owner).maybeSingle<{ id: string; name: string }>(),
    sb.from("recipe_outputs").select("recipe_id").eq("output_menu_item_id", menuItemId).returns<Array<{ recipe_id: string }>>(),
    loadRecipeGraph({ locationId: owner }),
  ]);
  if (shop.error) throw new Error(`owned sandwich shop: ${shop.error.message}`);
  if (outs.error) throw new Error(`owned sandwich recipe: ${outs.error.message}`);
  const recipeId = (outs.data ?? [])[0]?.recipe_id ?? null;
  const recipe = recipeId
    ? await sb.from("recipes").select("id, name").eq("id", recipeId).maybeSingle<{ id: string; name: string }>()
    : { data: null, error: null };
  if (recipe.error) throw new Error(`owned sandwich recipe name: ${recipe.error.message}`);
  const prices = await loadCurrentSkuPrices([...graph.skuPack.keys()], owner);
  const atOwner = catalogShopAllowed(actor, owner);
  return {
    menuItem: { id: m.id, name: m.name, nameEs: m.name_es, price: m.menu_price == null ? null : Number(m.menu_price), section: m.section },
    owner: { shopId: owner, shopName: shop.data?.name ?? "" },
    canEditPrice: actor.level >= NEW_THING_MIN && atOwner,
    canShare: actor.level >= SHARE_MIN,
    canLinkToast: actor.level >= TOAST_MAP_MIN && atOwner,
    recipe: recipe.data ?? null,
    cost: rollupMenuItemCost(graph, menuItemId, costPerOzFromGraph(graph, prices)).cost,
  };
}

// ── The item page's jobs strip ───────────────────────────────────────────────

export interface ItemJobsStripView {
  skuId: string;
  scope: string | null;
  owner: { shopId: string; shopName: string } | null;
  canShare: boolean;
  /** A swap starts at a shop (GM+ there). */
  canSwap: boolean;
  swapHref: string | null;
  liveSwaps: Array<{ swapId: string; oldName: string; newName: string; startedAt: string }>;
}

export async function loadItemJobsStrip(actor: AuthContext, skuId: string, scope: VersionScope): Promise<ItemJobsStripView> {
  if (actor.level < 6) throw new ShopOwnedError(403, "forbidden");
  const sb = getServiceRoleClient();
  const { data: sku, error } = await sb.from("vendor_items").select("id, location_id").eq("id", skuId)
    .maybeSingle<{ id: string; location_id: string | null }>();
  if (error) throw new Error(`item strip: ${error.message}`);
  if (!sku) throw new ShopOwnedError(404, "not_found");
  const owner = sku.location_id ?? null;
  const [shop, live] = await Promise.all([
    owner ? sb.from("locations").select("id, name").eq("id", owner).maybeSingle<{ id: string; name: string }>() : Promise.resolve({ data: null, error: null }),
    scope !== null && catalogShopAllowed(actor, scope) ? loadLiveSwapsForItem(actor, skuId, scope) : Promise.resolve([]),
  ]);
  if (shop.error) throw new Error(`item strip shop: ${shop.error.message}`);
  const ids = [...new Set(live.flatMap((l) => [l.oldSkuId, l.newSkuId]))];
  const names = ids.length
    ? await sb.from("vendor_items").select("id, name").in("id", ids).returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (names.error) throw new Error(`item strip names: ${names.error.message}`);
  const nameOf = (id: string) => (names.data ?? []).find((n) => n.id === id)?.name ?? "";
  const canSwap = scope !== null && actor.level >= NEW_THING_MIN && catalogShopAllowed(actor, scope) && ownerVisible(owner, scope);
  return {
    skuId, scope,
    owner: owner ? { shopId: owner, shopName: shop.data?.name ?? "" } : null,
    canShare: owner !== null && actor.level >= SHARE_MIN,
    canSwap,
    swapHref: canSwap ? swapHref(skuId, { shopId: scope }) : null,
    liveSwaps: live.map((l) => ({ swapId: l.swapId, oldName: nameOf(l.oldSkuId), newName: nameOf(l.newSkuId), startedAt: l.startedAt })),
  };
}
```

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/catalog-jobs-views.test.ts` → expected: PASS.

```bash
git add lib/catalog/jobs.ts tests/catalog-jobs-views.test.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4b job page views — new item, new sandwich, swap, a shop-only sandwich, the item page's strip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 3: Every string, en + es (tú)

**Files:**
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`
- Create: `tests/catalog-jobs-i18n.test.ts`

- [ ] **Step 1: Write the failing test `tests/catalog-jobs-i18n.test.ts`**

```ts
/**
 * Catalog Phase 4b — every key the job pages use exists in en AND es; Spanish is Spanish (tú, never "usted"); every refusal
 * the job routes name has its own message. Keys are read from the sources, so a new t("…") without a string fails here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { JOB_ERROR_CODES } from "@/lib/catalog/jobs-shared";

const FILES = [
  "components/catalog/jobs/NewItemJob.tsx", "components/catalog/jobs/NewSandwichJob.tsx", "components/catalog/jobs/SwapVendorJob.tsx",
  "components/catalog/ToastLinkSection.tsx", "components/catalog/ShareWithEveryShop.tsx", "components/catalog/ItemJobsStrip.tsx",
  "components/catalog/OwnedSandwichClient.tsx", "app/admin/catalog/new/item/page.tsx", "app/admin/catalog/new/sandwich/page.tsx",
  "app/admin/catalog/sku/[id]/swap/page.tsx", "app/admin/menu-costing/page.tsx", "components/admin/recipes/RecipesClient.tsx",
  "components/admin/skus/SkuBuilder.tsx", "components/admin/catalog/CatalogClient.tsx", "app/admin/recipes/new/page.tsx",
  "app/admin/catalog/recipe/[id]/page.tsx", "components/admin/vendors/OrderGuidePanel.tsx",
];
const E = en as Record<string, string>;
const S = es as Record<string, string>;

/** Every literal key a file passes to t / serverT / rk, or names as a TranslationKey. */
function literalKeys(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/(?:\bt\(|serverT\([a-zA-Z.]+,\s*|\brk\()\s*"([a-zA-Z0-9_.\-]+)"/g)) out.add(m[1]!);
  for (const m of src.matchAll(/"((?:catalog|admin|recipes)\.[a-zA-Z0-9_.\-]+)" as TranslationKey/g)) out.add(m[1]!);
  return [...out];
}
const DYNAMIC = [
  ...["raw", "packaging", "cleaning", "misc"].map((k) => `catalog.newItem.kind.${k}`),
  ...["email", "phone", "url", "portal", "other"].map((m) => `catalog.newItem.vendor.method.${m}`),
  "catalog.newItem.setup.level_case", "catalog.newItem.setup.level_inner",
  "catalog.swap.for_now", "catalog.swap.for_good", "catalog.swap.everywhere", "catalog.share.preview_recipe", "catalog.share.share_the_sandwich",
  ...JOB_ERROR_CODES.map((c) => `catalog.jobs.error.${c}`), "catalog.jobs.error.generic",
  "admin.section.catalog-new-item", "admin.section.catalog-new-sandwich",
  // chosen in an expression rather than passed as a literal
  "catalog.share.preview_sku", "catalog.share.preview_sku_keeps", "catalog.jobs.skip", "catalog.newItem.setup.barcode_later",
  // the 3b recipe page's refusals 4a added (chosen through its errKey expression)
  "catalog.recipe.error.ownership_changed", "catalog.recipe.error.line_other_shop", "catalog.recipe.error.shop_owned_edit_here",
];
/** The same word in both languages, on purpose. */
const SAME_OK = new Set(["catalog.newItem.setup.par", "catalog.swap.line"]);

describe("every 4b string exists in both languages", () => {
  const keys = [...new Set([...FILES.flatMap((f) => literalKeys(readFileSync(f, "utf8"))), ...DYNAMIC])];
  it("en and es carry every key", () => {
    expect(keys.filter((k) => !(k in E))).toEqual([]);
    expect(keys.filter((k) => !(k in S))).toEqual([]);
  });
  it("the Spanish is written, not copied, and uses tú", () => {
    const mine = keys.filter((k) => k.startsWith("catalog.jobs.") || k.startsWith("catalog.newItem.") || k.startsWith("catalog.newSandwich.")
      || k.startsWith("catalog.swap.") || k.startsWith("catalog.share.") || k.startsWith("catalog.owned.") || k.startsWith("catalog.toast."));
    expect(mine.filter((k) => S[k] === E[k] && !SAME_OK.has(k))).toEqual([]);
    expect(mine.filter((k) => /\busted(es)?\b/i.test(S[k] ?? ""))).toEqual([]);
  });
  it("placeholders match between the two languages (the 4b strings)", () => {
    const ph = (s: string | undefined) => [...(s ?? "").matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort().join(",");
    expect(keys.filter((k) => (k.startsWith("catalog.") || k.startsWith("admin.section.catalog-")) && ph(E[k]) !== ph(S[k]))).toEqual([]);
  });
});
```

Run: `npx vitest run tests/catalog-jobs-i18n.test.ts` → expected: FAIL (the keys do not exist yet; after Tasks 4–9 the scan finds them all).

- [ ] **Step 2: The English strings** — in `lib/i18n/en.json`, put a comma after the current last entry and add, before the closing `}`:

```json
  "admin.section.catalog-new-item": "New item",
  "admin.section.catalog-new-sandwich": "New sandwich",
  "admin.menu_costing.new_sandwich": "+ New sandwich",
  "admin.skus.pick_your_shop": "Pick your shop",
  "recipes.create.new_sandwich": "New sandwich at your shop",
  "catalog.jobs.cancel": "Cancel",
  "catalog.jobs.save": "Save",
  "catalog.jobs.saved": "Saved",
  "catalog.jobs.saving": "Saving…",
  "catalog.jobs.skip": "Skip",
  "catalog.jobs.every_shop": "Every shop",
  "catalog.jobs.no_shop": "You don't work at a shop yet. Ask the Director of Operations to add you to one.",
  "catalog.jobs.open_item": "Open the item page",
  "catalog.jobs.open_sandwich": "Open the sandwich page",
  "catalog.jobs.open_recipe": "Open the recipe",
  "catalog.jobs.error.generic": "That didn't save. Try again.",
  "catalog.jobs.error.forbidden": "Your role can't do that.",
  "catalog.jobs.error.not_found": "That isn't here anymore, or it belongs to another shop.",
  "catalog.jobs.error.global_requires_moo": "Only the Director of Operations can do that for every shop.",
  "catalog.jobs.error.shop_owned_edit_here": "This belongs to your shop — edit it on its own page.",
  "catalog.jobs.error.name_taken": "Your shop's menu already has a sandwich with that name.",
  "catalog.jobs.error.item_number_taken": "This vendor already has an item with that number.",
  "catalog.jobs.error.invalid_name": "Type a name (up to 120 letters).",
  "catalog.jobs.error.invalid_price": "Type a price above zero.",
  "catalog.jobs.error.invalid_date": "Pick the day the price started.",
  "catalog.jobs.error.invalid_levels": "Say how it arrives first.",
  "catalog.jobs.error.invalid_payload": "Something on the form is missing. Check it and try again.",
  "catalog.jobs.error.incomplete_recipe": "Add at least one ingredient.",
  "catalog.jobs.error.invalid_quantity": "Type an amount above zero.",
  "catalog.jobs.error.invalid_component": "Pick an ingredient.",
  "catalog.jobs.error.product_line_needs_measure_unit": "This ingredient needs a weight or count unit, like oz or each.",
  "catalog.jobs.error.label_is_measure_unit": "A container can't be named like a unit (oz, lb). Use case, bag, tub…",
  "catalog.jobs.error.duplicate_label": "Two containers have the same name.",
  "catalog.jobs.error.invalid_label": "Every container needs a name.",
  "catalog.jobs.error.invalid_qty": "Every count must be above zero.",
  "catalog.jobs.error.invalid_link": "Finish the sentence: what does the last container hold?",
  "catalog.jobs.error.unknown_measure": "That unit isn't in the list.",
  "catalog.jobs.error.leaf_needs_avg": "Type what one weighs, in ounces.",
  "catalog.jobs.error.chain_unreachable": "The pack sentence doesn't add up. Check each container.",
  "catalog.jobs.error.needs_vendor": "This step needs a vendor. Pick one on the item page first.",
  "catalog.jobs.error.overlay_changed": "Someone set this shop's par already. Change it on the item page.",
  "catalog.jobs.error.rhythm_pair_conflict": "Someone just changed that order day. Reload and try again.",
  "catalog.jobs.error.guide_stale": "The order guide just changed. Reload and try again.",
  "catalog.jobs.error.level_differs": "That code is already taught at the other pack level.",
  "catalog.jobs.error.invalid_code": "That's too short to be a barcode.",
  "catalog.jobs.error.version_changed": "Someone changed that recipe first. Reload and try again.",
  "catalog.jobs.error.dependencies_changed": "Something in this changed while you looked. Look again before saving.",
  "catalog.jobs.error.dependencies_busy": "Someone is saving part of this right now. Try again in a moment.",
  "catalog.jobs.error.preview_stale": "Things changed since you looked. Look again before saving.",
  "catalog.jobs.error.swap_line_unit_unknown": "A recipe line's unit can't be weighed. Fix that line first.",
  "catalog.jobs.error.already_swapped": "This item is already swapped at this shop. Go back to normal first.",
  "catalog.jobs.error.in_other_product": "The two items belong to different products. Ask the Director of Operations.",
  "catalog.jobs.error.product_needs_primary": "Its product has no default item yet. Ask the Director of Operations to set one.",
  "catalog.jobs.error.product_name_taken": "A product with that name already exists. Pick another name.",
  "catalog.jobs.error.sku_not_found": "That item isn't here anymore, or it belongs to another shop.",
  "catalog.jobs.error.swap_not_found": "That swap isn't here anymore.",
  "catalog.jobs.error.not_live": "That swap is already over.",
  "catalog.jobs.error.ownership_changed": "This was shared with every shop (or moved) since you opened it, so your change wasn't saved. Reload.",
  "catalog.jobs.error.recipes_changed": "A recipe started or stopped using this item since you looked. See what changes again.",
  "catalog.jobs.error.already_shared": "Every shop has this already.",
  "catalog.jobs.error.skus_changed": "Its items changed since you looked. Look again.",
  "catalog.jobs.error.uses_other_shop_sku": "It uses an item only another shop buys. Swap that item first.",
  "catalog.jobs.error.invalid_entity": "That can't be linked at this shop.",
  "catalog.jobs.error.open_item_guid": "That Toast item is the shop's typed-in item. Pick another one.",
  "catalog.jobs.error.conflict": "Someone just changed this. Reload and try again.",
  "catalog.jobs.error.vendor_not_found": "That vendor isn't active anymore.",
  "catalog.jobs.error.location_not_found": "That shop isn't active.",
  "catalog.jobs.error.step_up_required": "Enter your PIN to continue.",
  "catalog.jobs.error.step_up_stale": "Your unlock ran out. Enter your PIN again.",
  "catalog.jobs.error.line_other_shop": "A recipe at your shop can't use another shop's own item.",
  "catalog.jobs.error.uses_shop_only_item": "It uses one of your shop's own prep items. Share that item's recipe first.",
  "catalog.jobs.error.items_changed": "What it makes changed since you looked. Look again.",
  "catalog.jobs.error.location_required": "Pick the shop it starts at.",
  "catalog.jobs.error.share_the_sandwich": "This recipe makes a sandwich: share the sandwich instead.",
  "catalog.newItem.title": "New item",
  "catalog.newItem.subtitle": "Something you buy — set it up start to finish",
  "catalog.newItem.where": "Where it starts",
  "catalog.newItem.starts_at": "Starts at: {shop}",
  "catalog.newItem.what": "What is it?",
  "catalog.newItem.kind.raw": "Food",
  "catalog.newItem.kind.packaging": "Packaging",
  "catalog.newItem.kind.cleaning": "Cleaning",
  "catalog.newItem.kind.misc": "Other",
  "catalog.newItem.vendor": "Who you buy it from",
  "catalog.newItem.vendor_none": "No vendor (bought at a store)",
  "catalog.newItem.vendor_add": "Add a new vendor",
  "catalog.newItem.vendor.name": "Vendor name",
  "catalog.newItem.vendor.category": "What they sell",
  "catalog.newItem.vendor.order_type": "How it comes",
  "catalog.newItem.vendor.contact": "Contact name",
  "catalog.newItem.vendor.phone": "Phone",
  "catalog.newItem.vendor.email": "Email",
  "catalog.newItem.vendor.method": "How you order",
  "catalog.newItem.vendor.method.email": "Email",
  "catalog.newItem.vendor.method.phone": "Phone",
  "catalog.newItem.vendor.method.url": "Website",
  "catalog.newItem.vendor.method.portal": "Vendor portal",
  "catalog.newItem.vendor.method.other": "Other",
  "catalog.newItem.vendor.value": "Where the order goes (address, number or link)",
  "catalog.newItem.vendor.days_later": "You'll pick their order days for your shop right after the item is created.",
  "catalog.newItem.vendor.create": "Add vendor",
  "catalog.newItem.name": "Name",
  "catalog.newItem.item_number": "Vendor item number",
  "catalog.newItem.arrives": "How it arrives",
  "catalog.newItem.avg_each": "What one {unit} weighs (oz)",
  "catalog.newItem.price": "Price per {container}",
  "catalog.newItem.price_date": "Price since",
  "catalog.newItem.summary": "This creates {name}, from {vendor}, at {shop}.",
  "catalog.newItem.create": "Create item",
  "catalog.newItem.created": "{name} is ready at {shop}. Finish setting it up below.",
  "catalog.newItem.setup_at_a_shop": "Set it up for each shop from its item page.",
  "catalog.newItem.setup": "Set it up at {shop}",
  "catalog.newItem.setup.par": "Par",
  "catalog.newItem.setup.weekday": "Weekday par ({container})",
  "catalog.newItem.setup.weekend": "Weekend par ({container})",
  "catalog.newItem.setup.days": "Order days",
  "catalog.newItem.setup.days_already": "{vendor} is already ordered here on: {days}",
  "catalog.newItem.setup.lead": "Days until it arrives",
  "catalog.newItem.setup.guide": "Order guide spot",
  "catalog.newItem.setup.guide_section": "Section",
  "catalog.newItem.setup.guide_new": "A new section…",
  "catalog.newItem.setup.guide_new_name": "New section name",
  "catalog.newItem.setup.use_in": "Where it's used",
  "catalog.newItem.setup.recipe": "Recipe",
  "catalog.newItem.setup.recipe_pick": "Pick a recipe",
  "catalog.newItem.setup.use_in_shop": "This becomes {shop}'s version of the recipe.",
  "catalog.newItem.setup.qty": "How much",
  "catalog.newItem.setup.unit": "Unit",
  "catalog.newItem.setup.barcode": "Barcode",
  "catalog.newItem.setup.barcode_code": "Scan or type the code",
  "catalog.newItem.setup.barcode_later": "Learn it at the first delivery",
  "catalog.newItem.setup.level_case": "Case",
  "catalog.newItem.setup.level_inner": "Inner pack",
  "catalog.newItem.setup.done": "Done",
  "catalog.newItem.setup.skipped": "Skipped — do it on the item page",
  "catalog.newItem.setup.needs_vendor": "Needs a vendor",
  "catalog.newSandwich.title": "New sandwich",
  "catalog.newSandwich.subtitle": "Name it, price it, build it, link it to Toast",
  "catalog.newSandwich.at_shop": "A new sandwich at {shop}",
  "catalog.newSandwich.name": "Name",
  "catalog.newSandwich.name_es": "Name in Spanish",
  "catalog.newSandwich.section": "Menu section",
  "catalog.newSandwich.price": "Price at {shop}",
  "catalog.newSandwich.recipe": "What goes in one sandwich",
  "catalog.newSandwich.no_lines": "No ingredients yet.",
  "catalog.newSandwich.add_line": "Add an ingredient",
  "catalog.newSandwich.edit_line": "Change",
  "catalog.newSandwich.remove_line": "Remove",
  "catalog.newSandwich.cost": "Cost per sandwich: {cost}",
  "catalog.newSandwich.food_cost": "food cost {pct}% · margin {margin}",
  "catalog.newSandwich.cost_partial": "At least {cost} — {n} ingredient(s) have no price yet",
  "catalog.newSandwich.cost_unresolved": "The cost can't be worked out yet — check the ingredients' weights.",
  "catalog.newSandwich.cost_none": "Add ingredients to see the cost.",
  "catalog.newSandwich.cost_pending": "Working out the cost…",
  "catalog.swap.product_new": "They'll be grouped as {name}.",
  "catalog.recipe.error.ownership_changed": "This recipe was shared with every shop since you opened it, so your change wasn't saved. Reload.",
  "catalog.recipe.error.line_other_shop": "That item belongs to another shop. Your shop's recipe can use shared items and your shop's own.",
  "catalog.recipe.error.shop_owned_edit_here": "This recipe belongs to your shop — edit the recipe itself.",
  "catalog.newSandwich.summary": "This adds {name} to {shop}'s menu with {n} ingredient(s).",
  "catalog.newSandwich.create": "Add to {shop}'s menu",
  "catalog.newSandwich.created": "{name} is on {shop}'s menu. Link it to Toast so its sales count.",
  "catalog.newSandwich.line_refused": "Line {position} ({name}): {reason}",
  "catalog.toast.title": "Toast link at {shop}",
  "catalog.toast.loading": "Looking at Toast…",
  "catalog.toast.linked": "Linked to: {names}",
  "catalog.toast.none": "Not linked yet — its sales won't count until it is.",
  "catalog.toast.unreachable": "Toast can't be reached right now. Try again later.",
  "catalog.toast.suggested": "Suggested",
  "catalog.toast.link_to": "Link to {name}",
  "catalog.toast.search": "Search Toast's menu",
  "catalog.toast.no_match": "Nothing on Toast's menu matches.",
  "catalog.toast.saved": "Linked.",
  "catalog.share.button": "Share with every shop",
  "catalog.share.preview_menu": "Every shop will sell {name} at {price}, with its recipe, as the default. Each shop can still set its own price.",
  "catalog.share.with_items": "These items only {shop} buys go with it: {names}",
  "catalog.share.blocked": "It can't be shared yet: it uses {names}. Swap out another shop's own item, or share your own item's recipe first.",
  "catalog.share.preview_sku": "Every shop will be able to order {name}.",
  "catalog.share.preview_sku_keeps": "Every shop will be able to order {name}. {shop} keeps its own pack and price.",
  "catalog.share.confirm": "Share it",
  "catalog.share.done": "Shared with every shop.",
  "catalog.owned.only_at": "Only at {shop}",
  "catalog.owned.price": "Price at {shop}",
  "catalog.owned.price_save": "Save price",
  "catalog.owned.cost": "Cost at {shop}: {cost}",
  "catalog.owned.recipe": "Recipe: {name}",
  "catalog.swap.title": "Swap vendor",
  "catalog.swap.open": "Swap vendor",
  "catalog.swap.replace": "Replace {name} ({vendor})",
  "catalog.swap.replacement": "With",
  "catalog.swap.add_new": "Not listed? Add it as a new item first.",
  "catalog.swap.mode": "For how long",
  "catalog.swap.for_now": "Just for now at {shop}",
  "catalog.swap.for_good": "For good at {shop}",
  "catalog.swap.everywhere": "For good, every shop",
  "catalog.swap.preview": "See what changes",
  "catalog.swap.what_changes": "What changes at {shop}",
  "catalog.swap.product_existing": "Both are grouped as {name}.",
  "catalog.swap.product_name": "Group them as",
  "catalog.swap.recipes": "Recipes that switch ({n})",
  "catalog.swap.line": "{recipe}: {before} → {after}",
  "catalog.swap.converted": "(now in ounces — the new pack is a different size)",
  "catalog.swap.refused": "{recipe}, line {position}: its unit can't be weighed. Fix that line first.",
  "catalog.swap.follows": "These follow by themselves: {names}",
  "catalog.swap.untouched": "These shops keep their own recipe: {names}",
  "catalog.swap.no_recipes": "No recipe uses it here — only ordering and counting switch.",
  "catalog.swap.costs": "Cost per sandwich",
  "catalog.swap.before": "Before",
  "catalog.swap.after": "After",
  "catalog.swap.confirm": "Swap it",
  "catalog.swap.done": "Swapped at {shop}.",
  "catalog.swap.set_par": "Set {name}'s par here on its item page.",
  "catalog.share.preview_recipe": "Every shop will be able to make {name}, as the default.",
  "catalog.share.share_the_sandwich": "This recipe makes a sandwich: share the sandwich instead (its recipe goes with it).",
  "recipes.new.starts_at": "New recipes you make start at {shop} — only {shop} uses them until the Director of Operations shares them.",
  "catalog.swap.already": "This item is already swapped at {shop}. Go back to normal from the item page first.",
  "catalog.swap.live": "{old} is swapped for {new} here since {date}.",
  "catalog.swap.back": "Back to normal",
  "catalog.swap.back_preview": "Going back: {names}",
  "catalog.swap.back_kept": "Kept as you changed them: {names}",
  "catalog.swap.back_primary_changed": "Someone changed the default item since — it stays as it is.",
  "catalog.swap.back_confirm": "Go back to normal",
  "catalog.swap.back_done": "Back to normal."
```

- [ ] **Step 3: The Spanish strings** — in `lib/i18n/es.json`, the same way:

```json
  "admin.section.catalog-new-item": "Artículo nuevo",
  "admin.section.catalog-new-sandwich": "Sándwich nuevo",
  "admin.menu_costing.new_sandwich": "+ Sándwich nuevo",
  "admin.skus.pick_your_shop": "Elige tu tienda",
  "recipes.create.new_sandwich": "Sándwich nuevo en tu tienda",
  "catalog.jobs.cancel": "Cancelar",
  "catalog.jobs.save": "Guardar",
  "catalog.jobs.saved": "Guardado",
  "catalog.jobs.saving": "Guardando…",
  "catalog.jobs.skip": "Saltar",
  "catalog.jobs.every_shop": "Todas las tiendas",
  "catalog.jobs.no_shop": "Todavía no trabajas en una tienda. Pídele al Director de Operaciones que te agregue a una.",
  "catalog.jobs.open_item": "Abrir la página del artículo",
  "catalog.jobs.open_sandwich": "Abrir la página del sándwich",
  "catalog.jobs.open_recipe": "Abrir la receta",
  "catalog.jobs.error.generic": "No se guardó. Inténtalo de nuevo.",
  "catalog.jobs.error.forbidden": "Tu puesto no puede hacer eso.",
  "catalog.jobs.error.not_found": "Eso ya no está aquí, o es de otra tienda.",
  "catalog.jobs.error.global_requires_moo": "Solo el Director de Operaciones puede hacer eso para todas las tiendas.",
  "catalog.jobs.error.shop_owned_edit_here": "Esto es de tu tienda: edítalo en su propia página.",
  "catalog.jobs.error.name_taken": "El menú de tu tienda ya tiene un sándwich con ese nombre.",
  "catalog.jobs.error.item_number_taken": "Este proveedor ya tiene un artículo con ese número.",
  "catalog.jobs.error.invalid_name": "Escribe un nombre (hasta 120 letras).",
  "catalog.jobs.error.invalid_price": "Escribe un precio mayor que cero.",
  "catalog.jobs.error.invalid_date": "Elige el día en que empezó el precio.",
  "catalog.jobs.error.invalid_levels": "Primero di cómo llega.",
  "catalog.jobs.error.invalid_payload": "Falta algo en el formulario. Revísalo e inténtalo de nuevo.",
  "catalog.jobs.error.incomplete_recipe": "Agrega al menos un ingrediente.",
  "catalog.jobs.error.invalid_quantity": "Escribe una cantidad mayor que cero.",
  "catalog.jobs.error.invalid_component": "Elige un ingrediente.",
  "catalog.jobs.error.product_line_needs_measure_unit": "Este ingrediente necesita una unidad de peso o de conteo, como oz o pieza.",
  "catalog.jobs.error.label_is_measure_unit": "Un envase no puede llamarse como una unidad (oz, lb). Usa caja, bolsa, tina…",
  "catalog.jobs.error.duplicate_label": "Dos envases tienen el mismo nombre.",
  "catalog.jobs.error.invalid_label": "Cada envase necesita un nombre.",
  "catalog.jobs.error.invalid_qty": "Cada cantidad debe ser mayor que cero.",
  "catalog.jobs.error.invalid_link": "Termina la frase: ¿qué tiene el último envase?",
  "catalog.jobs.error.unknown_measure": "Esa unidad no está en la lista.",
  "catalog.jobs.error.leaf_needs_avg": "Escribe cuánto pesa uno, en onzas.",
  "catalog.jobs.error.chain_unreachable": "La frase del empaque no cuadra. Revisa cada envase.",
  "catalog.jobs.error.needs_vendor": "Este paso necesita un proveedor. Elige uno primero en la página del artículo.",
  "catalog.jobs.error.overlay_changed": "Alguien ya puso el par de esta tienda. Cámbialo en la página del artículo.",
  "catalog.jobs.error.rhythm_pair_conflict": "Alguien acaba de cambiar ese día de pedido. Recarga e inténtalo de nuevo.",
  "catalog.jobs.error.guide_stale": "La guía de pedido acaba de cambiar. Recarga e inténtalo de nuevo.",
  "catalog.jobs.error.level_differs": "Ese código ya está enseñado en el otro nivel de empaque.",
  "catalog.jobs.error.invalid_code": "Es muy corto para ser un código de barras.",
  "catalog.jobs.error.version_changed": "Alguien cambió esa receta primero. Recarga e inténtalo de nuevo.",
  "catalog.jobs.error.dependencies_changed": "Algo cambió mientras mirabas. Vuelve a mirar antes de guardar.",
  "catalog.jobs.error.dependencies_busy": "Alguien está guardando parte de esto ahora mismo. Inténtalo en un momento.",
  "catalog.jobs.error.preview_stale": "Las cosas cambiaron desde que miraste. Vuelve a mirar antes de guardar.",
  "catalog.jobs.error.swap_line_unit_unknown": "La unidad de una línea de receta no se puede pesar. Corrige esa línea primero.",
  "catalog.jobs.error.already_swapped": "Este artículo ya está cambiado en esta tienda. Primero vuelve a lo normal.",
  "catalog.jobs.error.in_other_product": "Los dos artículos son de productos distintos. Pregúntale al Director de Operaciones.",
  "catalog.jobs.error.product_needs_primary": "Su producto aún no tiene un artículo predeterminado. Pídele al Director de Operaciones que lo ponga.",
  "catalog.jobs.error.product_name_taken": "Ya existe un producto con ese nombre. Elige otro nombre.",
  "catalog.jobs.error.sku_not_found": "Ese artículo ya no está aquí, o es de otra tienda.",
  "catalog.jobs.error.swap_not_found": "Ese cambio ya no está aquí.",
  "catalog.jobs.error.not_live": "Ese cambio ya terminó.",
  "catalog.jobs.error.ownership_changed": "Esto se compartió con todas las tiendas (o se movió) desde que lo abriste, así que tu cambio no se guardó. Recarga.",
  "catalog.jobs.error.recipes_changed": "Una receta empezó o dejó de usar este artículo desde que miraste. Vuelve a ver qué cambia.",
  "catalog.jobs.error.already_shared": "Todas las tiendas ya lo tienen.",
  "catalog.jobs.error.skus_changed": "Sus artículos cambiaron desde que miraste. Vuelve a mirar.",
  "catalog.jobs.error.uses_other_shop_sku": "Usa un artículo que solo compra otra tienda. Cambia ese artículo primero.",
  "catalog.jobs.error.invalid_entity": "Eso no se puede vincular en esta tienda.",
  "catalog.jobs.error.open_item_guid": "Ese artículo de Toast es el artículo escrito a mano de la tienda. Elige otro.",
  "catalog.jobs.error.conflict": "Alguien acaba de cambiar esto. Recarga e inténtalo de nuevo.",
  "catalog.jobs.error.vendor_not_found": "Ese proveedor ya no está activo.",
  "catalog.jobs.error.location_not_found": "Esa tienda no está activa.",
  "catalog.jobs.error.step_up_required": "Escribe tu PIN para seguir.",
  "catalog.jobs.error.step_up_stale": "Tu desbloqueo se venció. Escribe tu PIN otra vez.",
  "catalog.jobs.error.line_other_shop": "Una receta de tu tienda no puede usar un artículo propio de otra tienda.",
  "catalog.jobs.error.uses_shop_only_item": "Usa un artículo de preparación propio de tu tienda. Comparte primero la receta de ese artículo.",
  "catalog.jobs.error.items_changed": "Lo que hace cambió desde que miraste. Vuelve a mirar.",
  "catalog.jobs.error.location_required": "Elige la tienda donde empieza.",
  "catalog.jobs.error.share_the_sandwich": "Esta receta hace un sándwich: comparte el sándwich.",
  "catalog.newItem.title": "Artículo nuevo",
  "catalog.newItem.subtitle": "Algo que compras: prepáralo de principio a fin",
  "catalog.newItem.where": "Dónde empieza",
  "catalog.newItem.starts_at": "Empieza en: {shop}",
  "catalog.newItem.what": "¿Qué es?",
  "catalog.newItem.kind.raw": "Comida",
  "catalog.newItem.kind.packaging": "Empaque",
  "catalog.newItem.kind.cleaning": "Limpieza",
  "catalog.newItem.kind.misc": "Otro",
  "catalog.newItem.vendor": "A quién se lo compras",
  "catalog.newItem.vendor_none": "Sin proveedor (se compra en una tienda)",
  "catalog.newItem.vendor_add": "Agregar un proveedor nuevo",
  "catalog.newItem.vendor.name": "Nombre del proveedor",
  "catalog.newItem.vendor.category": "Qué vende",
  "catalog.newItem.vendor.order_type": "Cómo llega",
  "catalog.newItem.vendor.contact": "Nombre del contacto",
  "catalog.newItem.vendor.phone": "Teléfono",
  "catalog.newItem.vendor.email": "Correo",
  "catalog.newItem.vendor.method": "Cómo haces el pedido",
  "catalog.newItem.vendor.method.email": "Correo",
  "catalog.newItem.vendor.method.phone": "Teléfono",
  "catalog.newItem.vendor.method.url": "Sitio web",
  "catalog.newItem.vendor.method.portal": "Portal del proveedor",
  "catalog.newItem.vendor.method.other": "Otro",
  "catalog.newItem.vendor.value": "A dónde va el pedido (dirección, número o enlace)",
  "catalog.newItem.vendor.days_later": "Eliges sus días de pedido para tu tienda justo después de crear el artículo.",
  "catalog.newItem.vendor.create": "Agregar proveedor",
  "catalog.newItem.name": "Nombre",
  "catalog.newItem.item_number": "Número de artículo del proveedor",
  "catalog.newItem.arrives": "Cómo llega",
  "catalog.newItem.avg_each": "Cuánto pesa una {unit} (oz)",
  "catalog.newItem.price": "Precio por {container}",
  "catalog.newItem.price_date": "Precio desde",
  "catalog.newItem.summary": "Esto crea {name}, de {vendor}, en {shop}.",
  "catalog.newItem.create": "Crear artículo",
  "catalog.newItem.created": "{name} está listo en {shop}. Termina de prepararlo abajo.",
  "catalog.newItem.setup_at_a_shop": "Prepáralo para cada tienda desde la página del artículo.",
  "catalog.newItem.setup": "Prepáralo en {shop}",
  "catalog.newItem.setup.par": "Par",
  "catalog.newItem.setup.weekday": "Par entre semana ({container})",
  "catalog.newItem.setup.weekend": "Par de fin de semana ({container})",
  "catalog.newItem.setup.days": "Días de pedido",
  "catalog.newItem.setup.days_already": "A {vendor} ya se le pide aquí los: {days}",
  "catalog.newItem.setup.lead": "Días hasta que llega",
  "catalog.newItem.setup.guide": "Lugar en la guía de pedido",
  "catalog.newItem.setup.guide_section": "Sección",
  "catalog.newItem.setup.guide_new": "Una sección nueva…",
  "catalog.newItem.setup.guide_new_name": "Nombre de la sección nueva",
  "catalog.newItem.setup.use_in": "Dónde se usa",
  "catalog.newItem.setup.recipe": "Receta",
  "catalog.newItem.setup.recipe_pick": "Elige una receta",
  "catalog.newItem.setup.use_in_shop": "Esto se vuelve la versión de la receta de {shop}.",
  "catalog.newItem.setup.qty": "Cuánto",
  "catalog.newItem.setup.unit": "Unidad",
  "catalog.newItem.setup.barcode": "Código de barras",
  "catalog.newItem.setup.barcode_code": "Escanea o escribe el código",
  "catalog.newItem.setup.barcode_later": "Aprenderlo en la primera entrega",
  "catalog.newItem.setup.level_case": "Caja",
  "catalog.newItem.setup.level_inner": "Paquete de adentro",
  "catalog.newItem.setup.done": "Listo",
  "catalog.newItem.setup.skipped": "Saltado: hazlo en la página del artículo",
  "catalog.newItem.setup.needs_vendor": "Necesita un proveedor",
  "catalog.newSandwich.title": "Sándwich nuevo",
  "catalog.newSandwich.subtitle": "Ponle nombre, precio, ingredientes y vincúlalo con Toast",
  "catalog.newSandwich.at_shop": "Un sándwich nuevo en {shop}",
  "catalog.newSandwich.name": "Nombre",
  "catalog.newSandwich.name_es": "Nombre en español",
  "catalog.newSandwich.section": "Sección del menú",
  "catalog.newSandwich.price": "Precio en {shop}",
  "catalog.newSandwich.recipe": "Qué lleva un sándwich",
  "catalog.newSandwich.no_lines": "Aún no hay ingredientes.",
  "catalog.newSandwich.add_line": "Agregar un ingrediente",
  "catalog.newSandwich.edit_line": "Cambiar",
  "catalog.newSandwich.remove_line": "Quitar",
  "catalog.newSandwich.cost": "Costo por sándwich: {cost}",
  "catalog.newSandwich.food_cost": "costo de comida {pct}% · margen {margin}",
  "catalog.newSandwich.cost_partial": "Al menos {cost}: {n} ingrediente(s) aún sin precio",
  "catalog.newSandwich.cost_unresolved": "Aún no se puede calcular el costo: revisa los pesos de los ingredientes.",
  "catalog.newSandwich.cost_none": "Agrega ingredientes para ver el costo.",
  "catalog.newSandwich.cost_pending": "Calculando el costo…",
  "catalog.swap.product_new": "Se agruparán como {name}.",
  "catalog.recipe.error.ownership_changed": "Esta receta se compartió con todas las tiendas desde que la abriste, así que tu cambio no se guardó. Recarga.",
  "catalog.recipe.error.line_other_shop": "Ese artículo es de otra tienda. La receta de tu tienda puede usar artículos compartidos y los propios de tu tienda.",
  "catalog.recipe.error.shop_owned_edit_here": "Esta receta es de tu tienda: edita la receta misma.",
  "catalog.newSandwich.summary": "Esto agrega {name} al menú de {shop} con {n} ingrediente(s).",
  "catalog.newSandwich.create": "Agregar al menú de {shop}",
  "catalog.newSandwich.created": "{name} está en el menú de {shop}. Vincúlalo con Toast para que cuenten sus ventas.",
  "catalog.newSandwich.line_refused": "Línea {position} ({name}): {reason}",
  "catalog.toast.title": "Vínculo con Toast en {shop}",
  "catalog.toast.loading": "Mirando Toast…",
  "catalog.toast.linked": "Vinculado a: {names}",
  "catalog.toast.none": "Aún no está vinculado: sus ventas no cuentan hasta que lo esté.",
  "catalog.toast.unreachable": "No se puede llegar a Toast ahora mismo. Inténtalo más tarde.",
  "catalog.toast.suggested": "Sugerido",
  "catalog.toast.link_to": "Vincular a {name}",
  "catalog.toast.search": "Buscar en el menú de Toast",
  "catalog.toast.no_match": "Nada en el menú de Toast coincide.",
  "catalog.toast.saved": "Vinculado.",
  "catalog.share.button": "Compartir con todas las tiendas",
  "catalog.share.preview_menu": "Todas las tiendas venderán {name} a {price}, con su receta, como lo predeterminado. Cada tienda aún puede poner su propio precio.",
  "catalog.share.with_items": "Estos artículos que solo compra {shop} van con él: {names}",
  "catalog.share.blocked": "Aún no se puede compartir: usa {names}. Cambia el artículo propio de otra tienda, o comparte primero la receta de tu propio artículo.",
  "catalog.share.preview_sku": "Todas las tiendas podrán pedir {name}.",
  "catalog.share.preview_sku_keeps": "Todas las tiendas podrán pedir {name}. {shop} se queda con su propio empaque y precio.",
  "catalog.share.confirm": "Compartirlo",
  "catalog.share.done": "Compartido con todas las tiendas.",
  "catalog.owned.only_at": "Solo en {shop}",
  "catalog.owned.price": "Precio en {shop}",
  "catalog.owned.price_save": "Guardar precio",
  "catalog.owned.cost": "Costo en {shop}: {cost}",
  "catalog.owned.recipe": "Receta: {name}",
  "catalog.swap.title": "Cambiar de proveedor",
  "catalog.swap.open": "Cambiar de proveedor",
  "catalog.swap.replace": "Reemplazar {name} ({vendor})",
  "catalog.swap.replacement": "Con",
  "catalog.swap.add_new": "¿No está en la lista? Agrégalo primero como artículo nuevo.",
  "catalog.swap.mode": "Por cuánto tiempo",
  "catalog.swap.for_now": "Solo por ahora en {shop}",
  "catalog.swap.for_good": "Para siempre en {shop}",
  "catalog.swap.everywhere": "Para siempre, en todas las tiendas",
  "catalog.swap.preview": "Ver qué cambia",
  "catalog.swap.what_changes": "Qué cambia en {shop}",
  "catalog.swap.product_existing": "Los dos quedan agrupados como {name}.",
  "catalog.swap.product_name": "Agruparlos como",
  "catalog.swap.recipes": "Recetas que cambian ({n})",
  "catalog.swap.line": "{recipe}: {before} → {after}",
  "catalog.swap.converted": "(ahora en onzas: el empaque nuevo es de otro tamaño)",
  "catalog.swap.refused": "{recipe}, línea {position}: su unidad no se puede pesar. Corrige esa línea primero.",
  "catalog.swap.follows": "Estas cambian solas: {names}",
  "catalog.swap.untouched": "Estas tiendas se quedan con su propia receta: {names}",
  "catalog.swap.no_recipes": "Ninguna receta lo usa aquí: solo cambian los pedidos y los conteos.",
  "catalog.swap.costs": "Costo por sándwich",
  "catalog.swap.before": "Antes",
  "catalog.swap.after": "Después",
  "catalog.swap.confirm": "Cambiarlo",
  "catalog.swap.done": "Cambiado en {shop}.",
  "catalog.swap.set_par": "Pon el par de {name} aquí, en la página del artículo.",
  "catalog.share.preview_recipe": "Todas las tiendas podrán hacer {name}, como lo predeterminado.",
  "catalog.share.share_the_sandwich": "Esta receta hace un sándwich: comparte el sándwich (su receta va con él).",
  "recipes.new.starts_at": "Las recetas nuevas que haces empiezan en {shop}: solo {shop} las usa hasta que el Director de Operaciones las comparta.",
  "catalog.swap.already": "Este artículo ya está cambiado en {shop}. Primero vuelve a lo normal desde la página del artículo.",
  "catalog.swap.live": "{old} está cambiado por {new} aquí desde el {date}.",
  "catalog.swap.back": "Volver a lo normal",
  "catalog.swap.back_preview": "Vuelven: {names}",
  "catalog.swap.back_kept": "Se quedan como las cambiaste: {names}",
  "catalog.swap.back_primary_changed": "Alguien cambió el artículo predeterminado después: se queda como está.",
  "catalog.swap.back_confirm": "Volver a lo normal",
  "catalog.swap.back_done": "De vuelta a lo normal."
```

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/catalog-jobs-i18n.test.ts` → expected: it passes once Tasks 4–9 exist (run it again in Task 13); run `node -e "JSON.parse(require('fs').readFileSync('lib/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('lib/i18n/es.json','utf8')); console.log('ok')"` → `ok` now.

```bash
git add lib/i18n/en.json lib/i18n/es.json tests/catalog-jobs-i18n.test.ts
git commit -m "$(cat <<'EOF'
feat(i18n): Phase 4b — every job-page string, en + es (tú), with the refusal messages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 4: The shared pieces — styles, the Toast link section, Share with every shop

**Files:**
- Create: `components/catalog/jobs/styles.ts`, `components/catalog/ToastLinkSection.tsx`, `components/catalog/ShareWithEveryShop.tsx`

- [ ] **Step 1: Create `components/catalog/jobs/styles.ts`** (2b's item-page classes, shared by every 4b client)

```ts
/** The catalog pages' control classes (2b's item page), shared by the 4b job clients: 44px targets, the co- tokens. */
export const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
export const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
export const field =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
export const fieldLabel = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";
export const card = "co-card flex flex-col gap-3 p-4";
```

- [ ] **Step 2: Create `components/catalog/ToastLinkSection.tsx`**

```tsx
"use client";

/**
 * ToastLinkSection — link a sandwich to Toast at ONE shop (catalog Phase 4b; spec §5 job 4: "Toast linking moves out of
 * Catering"). Its links there, the matcher's suggestions, and every Toast item, searchable; a link is ONE confirmed
 * mapping (Tier A — the mapping's own tier, app/api/admin/toast-map/manual). Toast out of reach is said plainly — never
 * an empty list that looks like "nothing matches".
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents } from "@/lib/i18n/format";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { jobErrorKey } from "@/lib/catalog/jobs-shared";
import type { ToastLinkChoices } from "@/lib/admin/toast-map";
import { btn, card, field, fieldLabel } from "@/components/catalog/jobs/styles";

export function ToastLinkSection({ menuItemId, shopId, shopName, canLink }: { menuItemId: string; shopId: string; shopName: string; canLink: boolean }) {
  const { t, language } = useTranslation();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const [choices, setChoices] = useState<ToastLinkChoices | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const url = `/api/admin/catalog/menu-item/${menuItemId}/toast`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${url}?location=${encodeURIComponent(shopId)}`, { redirect: "manual" });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setMessage(t(jobErrorKey(typeof body.code === "string" ? body.code : "generic")));
        return;
      }
      setChoices(body as unknown as ToastLinkChoices);
    } catch {
      setMessage(t(jobErrorKey("generic")));
    }
  }, [url, shopId, t]);
  useEffect(() => { void load(); }, [load]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!choices || q.length < 2) return [];
    return choices.all.filter((x) => !x.taken && x.name.toLowerCase().includes(q)).slice(0, 20);
  }, [choices, query]);

  const link = async (guid: string, name: string) => {
    setMessage(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const r = await send(url, { locationId: shopId, toastItemGuid: guid, toastItemName: name });
    setBusy(false);
    if (!r.ok) {
      setMessage(t(jobErrorKey(r.code)));
      return;
    }
    setMessage(t("catalog.toast.saved"));
    setQuery("");
    await load();
  };
  const price = (c: number | null) => (c == null ? "" : ` · ${formatCents(c, language)}`);

  return (
    <section aria-labelledby={`toast-${menuItemId}`} className={card}>
      <h2 id={`toast-${menuItemId}`} className="text-base font-bold text-co-text">{t("catalog.toast.title", { shop: shopName })}</h2>
      {choices === null ? (
        <p className="text-sm text-co-text-muted">{t("catalog.toast.loading")}</p>
      ) : (
        <>
          <p className="text-sm text-co-text">
            {choices.linked.length > 0
              ? t("catalog.toast.linked", { names: choices.linked.map((l) => l.name).join(", ") })
              : t("catalog.toast.none")}
          </p>
          {!choices.reachable ? <p className="text-sm font-semibold text-co-cta-text">{t("catalog.toast.unreachable")}</p> : null}
          {canLink && choices.reachable ? (
            <>
              {choices.suggestions.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className={fieldLabel}>{t("catalog.toast.suggested")}</span>
                  {choices.suggestions.map((s) => (
                    <button key={s.guid} type="button" className={btn} disabled={busy} onClick={() => void link(s.guid, s.name)}>
                      {t("catalog.toast.link_to", { name: `${s.name}${price(s.priceCents)}` })}
                    </button>
                  ))}
                </div>
              ) : null}
              <label className="flex flex-col">
                <span className={fieldLabel}>{t("catalog.toast.search")}</span>
                <input className={field} value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)} />
              </label>
              {matches.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {matches.map((m) => (
                    <li key={m.guid}>
                      <button type="button" className={btn} disabled={busy} onClick={() => void link(m.guid, m.name)}>
                        {t("catalog.toast.link_to", { name: `${m.name}${price(m.priceCents)}` })}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim().length >= 2 ? (
                <p className="text-sm text-co-text-muted">{t("catalog.toast.no_match")}</p>
              ) : null}
            </>
          ) : null}
        </>
      )}
      {message ? <p role="status" className="text-sm font-semibold text-co-text">{message}</p> : null}
    </section>
  );
}
```

- [ ] **Step 3: Create `components/catalog/ShareWithEveryShop.tsx`**

```tsx
"use client";

/**
 * ShareWithEveryShop — MoO+ makes a shop's own sandwich or item every shop's (catalog Phase 4b; spec §3). Preview first
 * (what every shop gets, the shop's own items that go with a sandwich, anything that blocks it), then ONE save (Tier E)
 * that compare-and-sets the owner and the item set the person saw.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents } from "@/lib/i18n/format";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { jobErrorKey } from "@/lib/catalog/jobs-shared";
import type { ShareMenuItemPreview, ShareRecipePreview, ShareSkuPreview } from "@/lib/catalog/share";
import { btn, btnPrimary, card } from "@/components/catalog/jobs/styles";

type Preview = { kind: "menu_item"; p: ShareMenuItemPreview } | { kind: "sku"; p: ShareSkuPreview } | { kind: "recipe"; p: ShareRecipePreview };

export function ShareWithEveryShop({ kind, id }: { kind: "menu_item" | "sku" | "recipe"; id: string }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const url = kind === "menu_item" ? `/api/admin/catalog/menu-item/${id}/share`
    : kind === "recipe" ? `/api/admin/catalog/recipe/${id}/share` : `/api/admin/catalog/sku/${id}/share`;

  const open = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch(url, { redirect: "manual" });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) setMessage(t(jobErrorKey(typeof body.code === "string" ? body.code : "generic")));
      else setPreview(kind === "menu_item" ? { kind, p: body as unknown as ShareMenuItemPreview }
        : kind === "recipe" ? { kind, p: body as unknown as ShareRecipePreview } : { kind, p: body as unknown as ShareSkuPreview });
    } catch {
      setMessage(t(jobErrorKey("generic")));
    }
    setBusy(false);
  };
  const confirm = async () => {
    if (!preview) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = preview.kind === "menu_item"
      ? await send(url, { expectedOwner: preview.p.ownerShopId, shareSkuIds: preview.p.shopOnlySkus.map((s) => s.id) })
      : preview.kind === "recipe"
        ? await send(url, { expectedOwner: preview.p.ownerShopId, shareItemIds: preview.p.shopOnlyItems.map((i) => i.id), shareSkuIds: preview.p.shopOnlySkus.map((s) => s.id) })
        : await send(url, { expectedOwner: preview.p.ownerShopId });
    setBusy(false);
    if (!r.ok) {
      setMessage(t(jobErrorKey(r.code)));
      return;
    }
    setPreview(null);
    setMessage(t("catalog.share.done"));
    router.refresh();
  };
  const blocked = (preview?.kind === "menu_item" && preview.p.blockedBy.length > 0)
    || (preview?.kind === "recipe" && (preview.p.blockedBy.length > 0 || preview.p.makesSandwich !== null));

  return (
    <div className="flex flex-col gap-2">
      {preview === null ? (
        <button type="button" className={btn} disabled={busy} onClick={() => void open()}>{t("catalog.share.button")}</button>
      ) : (
        <div className={card}>
          {preview.kind === "menu_item" ? (
            <>
              <p className="text-sm text-co-text">
                {t("catalog.share.preview_menu", {
                  name: preview.p.name,
                  price: preview.p.price == null ? "—" : formatCents(Math.round(preview.p.price * 100), language),
                })}
              </p>
              {preview.p.shopOnlySkus.length > 0 ? (
                <p className="text-sm text-co-text">
                  {t("catalog.share.with_items", { shop: preview.p.ownerShopName ?? "", names: preview.p.shopOnlySkus.map((s) => s.name).join(", ") })}
                </p>
              ) : null}
              {blocked ? (
                <p className="text-sm font-semibold text-co-cta-text">
                  {t("catalog.share.blocked", { names: preview.p.blockedBy.map((b) => `${b.name} (${b.shopName ?? ""})`).join(", ") })}
                </p>
              ) : null}
            </>
          ) : preview.kind === "recipe" ? (
            <>
              <p className="text-sm text-co-text">{t("catalog.share.preview_recipe", { name: preview.p.name })}</p>
              {preview.p.shopOnlyItems.length + preview.p.shopOnlySkus.length > 0 ? (
                <p className="text-sm text-co-text">
                  {t("catalog.share.with_items", { shop: preview.p.ownerShopName ?? "", names: [...preview.p.shopOnlyItems, ...preview.p.shopOnlySkus].map((x) => x.name).join(", ") })}
                </p>
              ) : null}
              {preview.p.makesSandwich ? <p className="text-sm font-semibold text-co-cta-text">{t("catalog.share.share_the_sandwich")}</p> : null}
              {preview.p.blockedBy.length > 0 ? (
                <p className="text-sm font-semibold text-co-cta-text">
                  {t("catalog.share.blocked", { names: preview.p.blockedBy.map((b) => `${b.name} (${b.shopName ?? ""})`).join(", ") })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-co-text">
              {t(preview.p.ownerKeepsOwnPack || preview.p.ownerKeepsOwnPrice ? "catalog.share.preview_sku_keeps" : "catalog.share.preview_sku",
                { name: preview.p.name, shop: preview.p.ownerShopName ?? "" })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={busy || blocked} onClick={() => void confirm()}>{t("catalog.share.confirm")}</button>
            <button type="button" className={btn} disabled={busy} onClick={() => setPreview(null)}>{t("catalog.jobs.cancel")}</button>
          </div>
        </div>
      )}
      {message ? <p role="status" className="text-sm font-semibold text-co-text">{message}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output (Task 3 added every key).

```bash
git add components/catalog/jobs/styles.ts components/catalog/ToastLinkSection.tsx components/catalog/ShareWithEveryShop.tsx
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4b — the Toast link section (Tier A) and Share with every shop (preview, then one save)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 5: Job 2 — the New item page

**Files:**
- Create: `components/catalog/jobs/NewItemJob.tsx`, `app/admin/catalog/new/item/page.tsx`
- Modify: `lib/shop-context-shared.ts`

- [ ] **Step 1: Declare the page's shop parameter**

In `lib/shop-context-shared.ts` `SHOP_PARAMS_BY_PATH`, after `"/admin/menu-costing": ["location"], // catalog Phase 2a — the costing board's shop switcher`, add:

```ts
  "/admin/catalog/new/item": ["location"], // catalog Phase 4b — where a new item starts ("global" = every shop, MoO+)
  "/admin/catalog/new/sandwich": ["location"], // catalog Phase 4b — the shop a new sandwich starts at
```

(The swap page lives under the `/admin/catalog/sku/` prefix 2b already declared.)

- [ ] **Step 2: Create `components/catalog/jobs/NewItemJob.tsx`**

```tsx
"use client";

/**
 * NewItemJob — job 2, start to finish (catalog Phase 4b; spec §5 job 2). One page, top to bottom:
 *   where it starts (the GM's shop; MoO+ may pick every shop) → what it is → who you buy it from (pick, or add one
 *   inline — Tier B, the vendor directory's own tier) → name + vendor item number → how it arrives (2b's sentence) →
 *   price → CREATE (Tier E; ONE atomic write: the item, its first pack, its first price) → then the setup at the shop,
 *   one line per step, each its own save: par · order days · order-guide section · where it's used · barcode
 *   (or "learn it at the first delivery"). A step that fails says why on its own line; the item page keeps offering it.
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { PackSentenceEditor } from "@/components/catalog/PackSentenceEditor";
import { levelsFromSentence, type SentenceDraft, type SentenceError } from "@/lib/catalog/pack-sentence-shared";
import { skuItemHref } from "@/lib/catalog/sku-item-shared";
import { initialSetupState, jobErrorKey, newItemHref, WEEKDAY_KEYS, type SetupState } from "@/lib/catalog/jobs-shared";
import type { NewItemJobView } from "@/lib/catalog/jobs";
import type { CreatedItem } from "@/lib/catalog/new-item";
import type { SetupStep } from "@/lib/catalog/new-item-shared";
import type { SkuClass } from "@/lib/admin/catalog-shared";
import { btn, btnPrimary, card, field, fieldLabel } from "@/components/catalog/jobs/styles";

const KINDS: readonly SkuClass[] = ["raw", "packaging", "cleaning", "misc"];
const METHODS = ["email", "phone", "url", "portal", "other"] as const;
const today = () => new Date().toISOString().slice(0, 10);
const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

export function NewItemJob({ view }: { view: NewItemJobView }) {
  const { t, language } = useTranslation();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const err = (code: string) => t(jobErrorKey(code));

  // ── The item ──
  const [kind, setKind] = useState<SkuClass>("raw");
  const [vendors, setVendors] = useState(view.vendors);
  const [vendorId, setVendorId] = useState("");
  const [addingVendor, setAddingVendor] = useState(false);
  const [vf, setVf] = useState({
    name: "", categoryId: view.categories[0]?.id ?? "", orderTypeId: view.orderTypes[0]?.id ?? "",
    contact: "", phone: "", email: "", method: "email" as (typeof METHODS)[number], value: "",
  });
  const [name, setName] = useState("");
  const [itemNumber, setItemNumber] = useState("");
  const [sentence, setSentence] = useState<SentenceDraft>({ containers: [{ label: "case", qty: "1" }], leafQty: "", leafUnit: "" });
  const [sentenceError, setSentenceError] = useState<{ error: SentenceError; index: number } | null>(null);
  const [avgOz, setAvgOz] = useState("");
  const [price, setPrice] = useState("");
  const [priceDate, setPriceDate] = useState(today());
  const [created, setCreated] = useState<CreatedItem | null>(null);

  // ── The setup at the shop ──
  const [setup, setSetup] = useState<SetupState>(() => initialSetupState(false));
  const [par, setPar] = useState({ weekday: "", weekend: "" });
  const [days, setDays] = useState<number[]>([]);
  const [lead, setLead] = useState("1");
  const [sectionId, setSectionId] = useState("");
  const [newSection, setNewSection] = useState("");
  const [useIn, setUseIn] = useState({ recipeId: "", qty: "", unit: "oz" });
  const [code, setCode] = useState("");
  const [level, setLevel] = useState<"case" | "inner">("case");

  const vendor = vendors.find((v) => v.id === vendorId) ?? null;
  const measureLabels = useMemo(() => new Set(view.units.map((u) => u.label)), [view.units]);
  const rootLabel = sentence.containers[0]?.label.trim() || "…";
  const leafDimension = view.units.find((u) => u.label === sentence.leafUnit)?.dimension;
  const needsAvg = kind === "raw" && leafDimension !== undefined && leafDimension !== "weight";
  const shopName = view.scopeName ?? t("catalog.jobs.every_shop");
  const canCreate = !busy && created === null && name.trim() !== "" && (price.trim() === "" || Number(price) > 0);

  const addVendor = async () => {
    setMessage(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const r = await send("/api/admin/vendors", {
      name: vf.name.trim(), categoryIds: vf.categoryId ? [vf.categoryId] : [], orderTypeIds: vf.orderTypeId ? [vf.orderTypeId] : [],
      firstContact: { name: vf.contact.trim(), phone: vf.phone.trim() || null, email: vf.email.trim() || null },
      firstOrdering: { method: vf.method, value: vf.value.trim() },
    });
    setBusy(false);
    if (!r.ok) {
      setMessage(err(r.code));
      return;
    }
    const id = String(r.data.id);
    setVendors((vs) => [...vs, { id, name: vf.name.trim(), hasGuide: false, sections: [], daysHere: [] }].sort((a, b) => a.name.localeCompare(b.name)));
    setVendorId(id);
    setAddingVendor(false);
  };

  const create = async () => {
    setMessage(null);
    const built = levelsFromSentence(sentence, measureLabels);
    if (!built.ok) {
      setSentenceError({ error: built.error, index: built.index });
      return;
    }
    setSentenceError(null);
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send("/api/admin/catalog/jobs/new-item", {
      scope: view.scope, vendorId: vendorId || null, name: name.trim(), itemNumber: itemNumber.trim() || null,
      levels: built.levels, avgOzPerEach: needsAvg ? num(avgOz) : null,
      unitPrice: num(price), priceDate: price.trim() === "" ? null : priceDate, skuClass: kind,
    });
    setBusy(false);
    if (!r.ok) {
      setMessage(err(r.code));
      return;
    }
    setCreated(r.data as unknown as CreatedItem);
    setSetup(initialSetupState(vendorId !== ""));
    setMessage(t("catalog.newItem.created", { name: name.trim(), shop: shopName }));
  };

  /** ONE setup step, saved on its own; its line says done or why not. */
  const runStep = async (step: SetupStep) => {
    if (!created || view.scope === null) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setSetup((s) => ({ ...s, [step.kind]: "saving" }));
    const r = await send(`/api/admin/catalog/sku/${created.skuId}/setup`, { shopId: view.scope, step });
    setSetup((s) => ({ ...s, [step.kind]: r.ok ? "done" : { failed: r.code } }));
  };
  const skip = (k: SetupStep["kind"]) => setSetup((s) => ({ ...s, [k]: "skipped" }));
  const isOpen = (k: SetupStep["kind"]) => setup[k] === "todo" || typeof setup[k] === "object";
  const status = (k: SetupStep["kind"]) => {
    const s = setup[k];
    if (s === "done") return <span className="text-xs font-bold text-co-text">{t("catalog.newItem.setup.done")}</span>;
    if (s === "skipped") return <span className="text-xs text-co-text-muted">{t("catalog.newItem.setup.skipped")}</span>;
    if (s === "needs_vendor") return <span className="text-xs text-co-text-muted">{t("catalog.newItem.setup.needs_vendor")}</span>;
    if (s === "saving") return <span className="text-xs text-co-text-muted">{t("catalog.jobs.saving")}</span>;
    if (typeof s === "object") return <span className="text-xs font-semibold text-co-cta-text">{err(s.failed)}</span>;
    return null;
  };
  const stepButtons = (k: SetupStep["kind"], save: () => void, ready: boolean, skipKey: TranslationKey = "catalog.jobs.skip") => (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btnPrimary} disabled={!ready || setup[k] === "saving"} onClick={save}>{t("catalog.jobs.save")}</button>
      <button type="button" className={btn} disabled={setup[k] === "saving"} onClick={() => skip(k)}>{t(skipKey)}</button>
    </div>
  );
  const recipe = view.recipes.find((r) => r.id === useIn.recipeId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <section className={card} aria-label={t("catalog.newItem.where")}>
        <p className="text-sm text-co-text">{t("catalog.newItem.starts_at", { shop: shopName })}</p>
        {view.shops.length > 1 || view.canCreateEverywhere ? (
          <div className="flex flex-wrap gap-2">
            {view.shops.filter((s) => s.id !== view.scope).map((s) => (
              <Link key={s.id} className={btn} href={newItemHref({ shopId: s.id })}>{s.name}</Link>
            ))}
            {view.canCreateEverywhere && view.scope !== null ? <Link className={btn} href={newItemHref({ shopId: null })}>{t("catalog.jobs.every_shop")}</Link> : null}
          </div>
        ) : null}
      </section>

      <fieldset className={card} disabled={created !== null || busy}>
        <legend className="text-base font-bold text-co-text">{t("catalog.newItem.what")}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? btnPrimary : btn} onClick={() => setKind(k)}>
              {t(`catalog.newItem.kind.${k}` as TranslationKey)}
            </button>
          ))}
        </div>

        <label className="flex flex-col">
          <span className={fieldLabel}>{t("catalog.newItem.vendor")}</span>
          <select className={field} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">{t("catalog.newItem.vendor_none")}</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        {!addingVendor ? (
          <button type="button" className={btn} onClick={() => setAddingVendor(true)}>{t("catalog.newItem.vendor_add")}</button>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border-2 border-co-border p-3">
            <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.vendor.name")}</span>
              <input className={field} value={vf.name} onChange={(e) => setVf({ ...vf, name: e.target.value })} /></label>
            <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.vendor.category")}</span>
              <select className={field} value={vf.categoryId} onChange={(e) => setVf({ ...vf, categoryId: e.target.value })}>
                {view.categories.map((c) => <option key={c.id} value={c.id}>{language === "es" && c.labelEs ? c.labelEs : c.label}</option>)}
              </select></label>
            <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.vendor.order_type")}</span>
              <select className={field} value={vf.orderTypeId} onChange={(e) => setVf({ ...vf, orderTypeId: e.target.value })}>
                {view.orderTypes.map((o) => <option key={o.id} value={o.id}>{language === "es" && o.labelEs ? o.labelEs : o.label}</option>)}
              </select></label>
            <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.vendor.contact")}</span>
              <input className={field} value={vf.contact} onChange={(e) => setVf({ ...vf, contact: e.target.value })} /></label>
            <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.vendor.phone")}</span>
              <input className={field} type="tel" value={vf.phone} onChange={(e) => setVf({ ...vf, phone: e.target.value })} /></label>
            <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.vendor.email")}</span>
              <input className={field} type="email" value={vf.email} onChange={(e) => setVf({ ...vf, email: e.target.value })} /></label>
            <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.vendor.method")}</span>
              <select className={field} value={vf.method} onChange={(e) => setVf({ ...vf, method: e.target.value as (typeof METHODS)[number] })}>
                {METHODS.map((m) => <option key={m} value={m}>{t(`catalog.newItem.vendor.method.${m}` as TranslationKey)}</option>)}
              </select></label>
            <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.vendor.value")}</span>
              <input className={field} value={vf.value} onChange={(e) => setVf({ ...vf, value: e.target.value })} /></label>
            <p className="text-xs text-co-text-muted">{t("catalog.newItem.vendor.days_later")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} disabled={!vf.name.trim() || !vf.contact.trim() || !vf.value.trim() || !vf.categoryId || !vf.orderTypeId} onClick={() => void addVendor()}>
                {t("catalog.newItem.vendor.create")}
              </button>
              <button type="button" className={btn} onClick={() => setAddingVendor(false)}>{t("catalog.jobs.cancel")}</button>
            </div>
          </div>
        )}

        <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.name")}</span>
          <input className={field} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></label>
        <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.item_number")}</span>
          <input className={field} value={itemNumber} maxLength={80} onChange={(e) => setItemNumber(e.target.value)} /></label>

        <div className="flex flex-col gap-1">
          <span className={fieldLabel}>{t("catalog.newItem.arrives")}</span>
          <PackSentenceEditor draft={sentence} onChange={setSentence} units={view.units} skuClass={kind} currentLeafUnit={null}
            avgOzPerEach={null} error={sentenceError} busy={busy} />
        </div>
        {needsAvg ? (
          <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.avg_each", { unit: sentence.leafUnit })}</span>
            <input className={field} inputMode="decimal" value={avgOz} onChange={(e) => setAvgOz(e.target.value)} /></label>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.price", { container: rootLabel })}</span>
            <input className={field} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.price_date")}</span>
            <input className={field} type="date" value={priceDate} onChange={(e) => setPriceDate(e.target.value)} /></label>
        </div>

        {/* "Ends with the same preview and save choices" (spec §5): what this creates, in one sentence, before the save. */}
        {name.trim() ? (
          <p className="text-sm text-co-text-muted">
            {t("catalog.newItem.summary", { name: name.trim(), shop: shopName, vendor: vendor?.name ?? t("catalog.newItem.vendor_none") })}
          </p>
        ) : null}
        <button type="button" className={btnPrimary} disabled={!canCreate} onClick={() => void create()}>{t("catalog.newItem.create")}</button>
      </fieldset>

      {message ? <p role="status" className="text-sm font-semibold text-co-text">{message}</p> : null}

      {created && view.scope === null ? (
        <section className={card}>
          <p className="text-sm text-co-text">{t("catalog.newItem.setup_at_a_shop")}</p>
          <Link className={btn} href={skuItemHref(created.skuId, { shopId: null })}>{t("catalog.jobs.open_item")}</Link>
        </section>
      ) : null}

      {created && view.scope !== null ? (
        <section className={card} aria-labelledby="new-item-setup">
          <h2 id="new-item-setup" className="text-base font-bold text-co-text">{t("catalog.newItem.setup", { shop: shopName })}</h2>

          <div className="flex flex-col gap-2 border-t border-co-border pt-3">
            <div className="flex items-center justify-between gap-2"><span className="font-bold text-co-text">{t("catalog.newItem.setup.par")}</span>{status("par")}</div>
            {isOpen("par") ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.setup.weekday", { container: rootLabel })}</span>
                    <input className={field} inputMode="decimal" value={par.weekday} onChange={(e) => setPar({ ...par, weekday: e.target.value })} /></label>
                  <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.setup.weekend", { container: rootLabel })}</span>
                    <input className={field} inputMode="decimal" value={par.weekend} onChange={(e) => setPar({ ...par, weekend: e.target.value })} /></label>
                </div>
                {stepButtons("par", () => void runStep({ kind: "par", weekdayPar: num(par.weekday), weekendPar: num(par.weekend) }), par.weekday.trim() !== "" || par.weekend.trim() !== "")}
              </>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 border-t border-co-border pt-3">
            <div className="flex items-center justify-between gap-2"><span className="font-bold text-co-text">{t("catalog.newItem.setup.days")}</span>{status("order_days")}</div>
            {isOpen("order_days") && vendor ? (
              <>
                {vendor.daysHere.length > 0 ? (
                  <p className="text-xs text-co-text-muted">{t("catalog.newItem.setup.days_already", { vendor: vendor.name, days: vendor.daysHere.map((d) => t(WEEKDAY_KEYS[d]!)).join(" · ") })}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {WEEKDAY_KEYS.map((k, d) => (
                    <button key={k} type="button" aria-pressed={days.includes(d)} className={days.includes(d) ? btnPrimary : btn}
                      onClick={() => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort((a, b) => a - b)))}>
                      {t(k)}
                    </button>
                  ))}
                </div>
                <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.setup.lead")}</span>
                  <input className={field} inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} /></label>
                {stepButtons("order_days", () => void runStep({ kind: "order_days", days: days.map((d) => ({ orderDow: d, leadDays: Number(lead) })) }),
                  days.length > 0 && Number.isInteger(Number(lead)) && Number(lead) >= 0)}
              </>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 border-t border-co-border pt-3">
            <div className="flex items-center justify-between gap-2"><span className="font-bold text-co-text">{t("catalog.newItem.setup.guide")}</span>{status("guide_line")}</div>
            {isOpen("guide_line") && vendor ? (
              <>
                <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.setup.guide_section")}</span>
                  <select className={field} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                    <option value="">{t("catalog.newItem.setup.guide_new")}</option>
                    {vendor.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></label>
                {sectionId === "" ? (
                  <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.setup.guide_new_name")}</span>
                    <input className={field} value={newSection} maxLength={60} onChange={(e) => setNewSection(e.target.value)} /></label>
                ) : null}
                {stepButtons("guide_line", () => void runStep({ kind: "guide_line", sectionId: sectionId || null, newSectionName: sectionId ? null : newSection.trim() || null }),
                  sectionId !== "" || newSection.trim() !== "")}
              </>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 border-t border-co-border pt-3">
            <div className="flex items-center justify-between gap-2"><span className="font-bold text-co-text">{t("catalog.newItem.setup.use_in")}</span>{status("use_in")}</div>
            {isOpen("use_in") ? (
              <>
                <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.setup.recipe")}</span>
                  <select className={field} value={useIn.recipeId} onChange={(e) => setUseIn({ ...useIn, recipeId: e.target.value })}>
                    <option value="">{t("catalog.newItem.setup.recipe_pick")}</option>
                    {view.recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select></label>
                {recipe && !recipe.ownedHere ? <p className="text-xs text-co-text-muted">{t("catalog.newItem.setup.use_in_shop", { shop: shopName })}</p> : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.setup.qty")}</span>
                    <input className={field} inputMode="decimal" value={useIn.qty} onChange={(e) => setUseIn({ ...useIn, qty: e.target.value })} /></label>
                  <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.setup.unit")}</span>
                    <select className={field} value={useIn.unit} onChange={(e) => setUseIn({ ...useIn, unit: e.target.value })}>
                      {[...new Set([...sentence.containers.map((c) => c.label.trim()).filter(Boolean), ...view.units.map((u) => u.label)])].map((u) => <option key={u} value={u}>{u}</option>)}
                    </select></label>
                </div>
                {stepButtons("use_in", () => recipe && void runStep({
                  kind: "use_in", recipeId: recipe.id, quantity: Number(useIn.qty), unit: useIn.unit,
                  expectedVersionId: recipe.expectedVersionId, basedOnVersionId: recipe.basedOnVersionId,
                }), recipe !== null && Number(useIn.qty) > 0)}
              </>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 border-t border-co-border pt-3">
            <div className="flex items-center justify-between gap-2"><span className="font-bold text-co-text">{t("catalog.newItem.setup.barcode")}</span>{status("barcode")}</div>
            {isOpen("barcode") && vendor ? (
              <>
                <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newItem.setup.barcode_code")}</span>
                  <input className={field} inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} /></label>
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {(["case", "inner"] as const).map((l) => (
                    <button key={l} type="button" role="radio" aria-checked={level === l} className={level === l ? btnPrimary : btn} onClick={() => setLevel(l)}>
                      {t(`catalog.newItem.setup.level_${l}` as TranslationKey)}
                    </button>
                  ))}
                </div>
                {stepButtons("barcode", () => void runStep({ kind: "barcode", code: code.trim(), level }), code.trim().length >= 6, "catalog.newItem.setup.barcode_later")}
              </>
            ) : null}
          </div>

          <Link className={btn} href={skuItemHref(created.skuId, { shopId: view.scope })}>{t("catalog.jobs.open_item")}</Link>
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Create `app/admin/catalog/new/item/page.tsx`**

```tsx
/**
 * /admin/catalog/new/item — job 2, New item (catalog Phase 4b). Server component: the admin layout holds the auth
 * boundary and StepUpProvider; this page re-gates (GM+). Where it starts: `?location=<shop>`, or `global` (every shop,
 * MoO+); otherwise the remembered shop among the actor's own. A GM with no shop is told so.
 */
import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { catalogShopAllowed, GLOBAL_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";
import { NEW_THING_MIN, ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { loadNewItemJobView } from "@/lib/catalog/jobs";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewItemJob } from "@/components/catalog/jobs/NewItemJob";

export default async function NewItemJobPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const auth = await requireSessionFromHeaders("/admin/catalog/new/item");
  if (auth.level < NEW_THING_MIN) redirect("/dashboard");
  const lang = auth.user.language;
  const { data: locs, error } = await getServiceRoleClient().from("locations").select("id").eq("active", true).order("name")
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`new item page locations: ${error.message}`);
  const mine = (locs ?? []).map((l) => l.id).filter((id) => catalogShopAllowed(auth, id));
  const explicit = shopParamFor("/admin/catalog/new/item", searchParamValues(sp));
  const everywhere = explicit === "global" && auth.level >= GLOBAL_VERSION_WRITE_MIN;
  const scope = everywhere ? null
    : explicit && explicit !== "global" && mine.includes(explicit) ? explicit
    : mine.length > 0 ? await resolveShopId(mine, null) : null;
  const header = <PageHeader title={serverT(lang, "catalog.newItem.title")} subtitle={serverT(lang, "catalog.newItem.subtitle")} />;
  if (scope === null && !everywhere && auth.level < GLOBAL_VERSION_WRITE_MIN) {
    return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">{header}<p className="text-sm text-co-text">{serverT(lang, "catalog.jobs.no_shop")}</p></div>;
  }
  let view;
  try {
    view = await loadNewItemJobView(auth, scope);
  } catch (e) {
    if (e instanceof ShopOwnedError && e.status === 404) notFound();
    if (e instanceof ShopOwnedError && e.status === 403) redirect("/dashboard");
    throw e;
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
      {header}
      <NewItemJob key={scope ?? "global"} view={view} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

```bash
git add components/catalog/jobs/NewItemJob.tsx app/admin/catalog/new/item/page.tsx lib/shop-context-shared.ts
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4b job 2 — the New item page (inline vendor, sentence, price, one create, then each setup step)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 6: Job 4 — the New sandwich page

**Files:**
- Create: `components/catalog/jobs/NewSandwichJob.tsx`, `app/admin/catalog/new/sandwich/page.tsx`

- [ ] **Step 1: Create `components/catalog/jobs/NewSandwichJob.tsx`**

```tsx
"use client";

/**
 * NewSandwichJob — job 4 (catalog Phase 4b; spec §5 job 4): name → price for my shop → what goes in ONE sandwich (the
 * searchable ingredient picker, oz / each / slices — Phase 1's line editor) with the COST PER SANDWICH UPDATING LIVE
 * (the server prices the draft on the shop's own graph with THE costing rollup; a late answer for an older draft is
 * dropped) → "Add to the menu" (Tier E; ONE write: the menu item and its recipe, owned by the shop) → the Toast link.
 * A refused line is named — its position, its name, why — in the message and beside the line.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatQuantity } from "@/lib/i18n/format";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { RecipeLineEditor } from "@/components/admin/recipes/RecipeLineEditor";
import { ToastLinkSection } from "@/components/catalog/ToastLinkSection";
import { buildIngredientOptions } from "@/lib/ingredient-picker-shared";
import type { RecipeLineDraft } from "@/lib/recipe-line-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import { costLine, jobErrorKey, liveCostOnAnswer, liveCostOnDraftChange, newSandwichHref, type LiveCost } from "@/lib/catalog/jobs-shared";
import type { SandwichCost } from "@/lib/catalog/new-sandwich-shared";
import type { NewSandwichJobView } from "@/lib/catalog/jobs";
import { menuItemPageHref, recipeItemHref } from "@/lib/catalog/recipe-item-shared";
import { btn, btnPrimary, card, field, fieldLabel } from "@/components/catalog/jobs/styles";

const fields = (l: RecipeLineDraft) => ({
  componentSkuId: l.componentSkuId, componentItemId: l.componentItemId, componentProductId: l.componentProductId,
  quantity: l.quantity, unit: l.unit, eachContainerLabel: l.eachContainerLabel, portioned: l.portioned,
});

export function NewSandwichJob({ view }: { view: NewSandwichJobView }) {
  const { t, language } = useTranslation();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const [name, setName] = useState("");
  const [nameEs, setNameEs] = useState("");
  const [section, setSection] = useState(view.sections[0] ?? "");
  const [price, setPrice] = useState("");
  const [lines, setLines] = useState<RecipeLineDraft[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [live, setLive] = useState<LiveCost<SandwichCost>>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  const [created, setCreated] = useState<{ menuItemId: string; recipeId: string } | null>(null);
  const [guard] = useState(() => createRequestGuard());

  const measures = useMemo(
    () => new Map<string, MeasureUnitFactor>(view.picker.measures.map((m) => [m.label, { dimension: m.dimension, toBaseFactor: m.toBaseFactor } as MeasureUnitFactor])),
    [view.picker.measures],
  );
  const options = useMemo(() => buildIngredientOptions({ skus: view.picker.skus, items: view.picker.items, products: view.picker.products }), [view.picker]);
  const priceValue = price.trim() === "" ? null : Number(price);
  const money = (n: number) => formatCents(Math.round(n * 100), language);
  const draft = (forPreview: boolean) => ({
    shopId: view.shopId,
    // The preview never uses the name; it must still parse, so an unnamed draft is previewed as "…".
    name: name.trim() || (forPreview ? "…" : ""),
    nameEs: nameEs.trim() || null, section: section.trim() || null,
    price: priceValue !== null && priceValue > 0 ? priceValue : null,
    lines: lines.map(fields),
  });

  // THE LIVE COST (Astra 4b r1#9): every draft change drops whatever is in flight and shows "working it out" AT ONCE —
  // never the previous draft's number; the server prices the draft a moment later; a refusal clears the cost and says why.
  useEffect(() => {
    guard.invalidate();
    if (created) return;
    setLive(liveCostOnDraftChange<SandwichCost>(lines.length > 0));
    if (lines.length === 0) return;
    const timer = setTimeout(() => {
      void (async () => {
        const r = await guard.run(() => postJson("/api/admin/catalog/jobs/new-sandwich/preview", draft(true)));
        setLive((cur) => liveCostOnAnswer(cur, r === null ? null : r.ok ? { ok: true, data: r.data as unknown as SandwichCost } : { ok: false, code: r.code }));
      })();
    }, 350);
    return () => { clearTimeout(timer); guard.invalidate(); };
    // The draft is rebuilt from these; `draft` itself is a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, price, created]);

  const saveLine = (line: RecipeLineDraft) => {
    setLines((ls) => (editing === "new" ? [...ls, line] : ls.map((l, i) => (i === editing ? line : l))));
    setEditing(null);
    setRefusedAt(null);
  };
  const removeLine = (i: number) => {
    setLines((ls) => ls.filter((_, j) => j !== i));
    setRefusedAt(null);
  };

  const create = async () => {
    setMessage(null);
    setRefusedAt(null);
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send("/api/admin/catalog/jobs/new-sandwich", draft(false));
    setBusy(false);
    if (r.ok) {
      setCreated(r.data as unknown as { menuItemId: string; recipeId: string });
      setMessage(t("catalog.newSandwich.created", { name: name.trim(), shop: view.shopName }));
      return;
    }
    if (r.line) {
      setRefusedAt(r.line.position);
      setMessage(t("catalog.newSandwich.line_refused", {
        position: r.line.position, name: r.line.name || lines[r.line.position - 1]?.componentName || "", reason: t(jobErrorKey(r.line.reason)),
      }));
      return;
    }
    setMessage(t(jobErrorKey(r.code)));
  };

  const cl = live.status === "ready" ? costLine(live.cost) : null;
  const costText = live.status === "pending" ? t("catalog.newSandwich.cost_pending")
    : live.status === "refused" ? t(jobErrorKey(live.code))
    : cl === null || cl.kind === "empty" ? t("catalog.newSandwich.cost_none")
    : cl.kind === "costed"
      ? [t("catalog.newSandwich.cost", { cost: money(cl.cost) }),
         cl.pct !== null && cl.margin !== null ? t("catalog.newSandwich.food_cost", { pct: formatQuantity(Math.round(cl.pct * 10) / 10, language), margin: money(cl.margin) }) : null,
        ].filter(Boolean).join(" · ")
      : cl.kind === "partial" ? t("catalog.newSandwich.cost_partial", { cost: money(cl.pricedCost), n: cl.missing })
      : t("catalog.newSandwich.cost_unresolved");
  const canCreate = !busy && created === null && name.trim() !== "" && lines.length > 0 && editing === null && (priceValue === null || priceValue > 0);

  return (
    <div className="flex flex-col gap-4">
      <fieldset className={card} disabled={created !== null || busy}>
        <legend className="text-base font-bold text-co-text">{t("catalog.newSandwich.at_shop", { shop: view.shopName })}</legend>
        {view.shops.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {view.shops.filter((s) => s.id !== view.shopId).map((s) => <Link key={s.id} className={btn} href={newSandwichHref({ shopId: s.id })}>{s.name}</Link>)}
          </div>
        ) : null}
        <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newSandwich.name")}</span>
          <input className={field} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
        <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newSandwich.name_es")}</span>
          <input className={field} value={nameEs} maxLength={120} onChange={(e) => setNameEs(e.target.value)} /></label>
        <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newSandwich.section")}</span>
          <input className={field} list="new-sandwich-sections" value={section} maxLength={60} onChange={(e) => setSection(e.target.value)} />
          <datalist id="new-sandwich-sections">{view.sections.map((s) => <option key={s} value={s} />)}</datalist></label>
        <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.newSandwich.price", { shop: view.shopName })}</span>
          <input className={field} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      </fieldset>

      <section className={card} aria-labelledby="new-sandwich-recipe">
        <h2 id="new-sandwich-recipe" className="text-base font-bold text-co-text">{t("catalog.newSandwich.recipe")}</h2>
        {lines.length === 0 ? <p className="text-sm text-co-text-muted">{t("catalog.newSandwich.no_lines")}</p> : (
          <ul className="flex flex-col gap-2">
            {lines.map((l, i) => (
              <li key={`${i}-${l.componentName}`} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 p-2 ${refusedAt === i + 1 ? "border-co-cta-text" : "border-co-border"}`}>
                <span className="text-sm text-co-text">{formatQuantity(l.quantity, language)} {l.unit ?? ""} · {l.componentName}</span>
                {created === null ? (
                  <span className="flex gap-2">
                    <button type="button" className={btn} disabled={busy || editing !== null} onClick={() => setEditing(i)}>{t("catalog.newSandwich.edit_line")}</button>
                    <button type="button" className={btn} disabled={busy || editing !== null} onClick={() => removeLine(i)}>{t("catalog.newSandwich.remove_line")}</button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editing !== null ? (
          <RecipeLineEditor
            title={t(editing === "new" ? "catalog.newSandwich.add_line" : "catalog.newSandwich.edit_line")}
            submitLabel={t("catalog.jobs.save")}
            options={options}
            skus={view.picker.skus}
            products={view.picker.products}
            measures={measures}
            activeMeasureLabels={view.picker.activeMeasureLabels}
            initial={editing === "new" ? null : (lines[editing] ?? null)}
            busy={busy}
            errorMsg={null}
            onSubmit={saveLine}
            onCancel={() => setEditing(null)}
          />
        ) : created === null ? (
          <button type="button" className={btn} disabled={busy} onClick={() => setEditing("new")}>{t("catalog.newSandwich.add_line")}</button>
        ) : null}
        <p role="status" aria-live="polite" className="text-sm font-bold text-co-text">{costText}</p>
      </section>

      {created === null ? (
        <>
          {name.trim() ? <p className="text-sm text-co-text-muted">{t("catalog.newSandwich.summary", { name: name.trim(), shop: view.shopName, n: lines.length })}</p> : null}
          <button type="button" className={btnPrimary} disabled={!canCreate} onClick={() => void create()}>{t("catalog.newSandwich.create", { shop: view.shopName })}</button>
        </>
      ) : null}
      {message ? <p role="status" className="text-sm font-semibold text-co-text">{message}</p> : null}

      {created ? (
        <>
          <ToastLinkSection menuItemId={created.menuItemId} shopId={view.shopId} shopName={view.shopName} canLink />
          <div className="flex flex-wrap gap-2">
            <Link className={btn} href={menuItemPageHref(created.menuItemId, { shopId: view.shopId })}>{t("catalog.jobs.open_sandwich")}</Link>
            <Link className={btn} href={recipeItemHref(created.recipeId)}>{t("catalog.jobs.open_recipe")}</Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `app/admin/catalog/new/sandwich/page.tsx`**

```tsx
/**
 * /admin/catalog/new/sandwich — job 4, New sandwich (catalog Phase 4b). A sandwich always starts at ONE shop
 * (`?location=<shop>`, else the remembered shop among the actor's own); MoO+ shares it later from its page.
 */
import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import { NEW_THING_MIN, ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { loadNewSandwichJobView } from "@/lib/catalog/jobs";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewSandwichJob } from "@/components/catalog/jobs/NewSandwichJob";

export default async function NewSandwichJobPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const auth = await requireSessionFromHeaders("/admin/catalog/new/sandwich");
  if (auth.level < NEW_THING_MIN) redirect("/dashboard");
  const lang = auth.user.language;
  const { data: locs, error } = await getServiceRoleClient().from("locations").select("id").eq("active", true).order("name")
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`new sandwich page locations: ${error.message}`);
  const mine = (locs ?? []).map((l) => l.id).filter((id) => catalogShopAllowed(auth, id));
  const explicit = shopParamFor("/admin/catalog/new/sandwich", searchParamValues(sp));
  const shopId = explicit && explicit !== "global" && mine.includes(explicit) ? explicit : mine.length > 0 ? await resolveShopId(mine, null) : null;
  const header = <PageHeader title={serverT(lang, "catalog.newSandwich.title")} subtitle={serverT(lang, "catalog.newSandwich.subtitle")} />;
  if (shopId === null) {
    return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">{header}<p className="text-sm text-co-text">{serverT(lang, "catalog.jobs.no_shop")}</p></div>;
  }
  let view;
  try {
    view = await loadNewSandwichJobView(auth, shopId);
  } catch (e) {
    if (e instanceof ShopOwnedError && e.status === 404) notFound();
    if (e instanceof ShopOwnedError && e.status === 403) redirect("/dashboard");
    throw e;
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
      {header}
      <NewSandwichJob key={shopId} view={view} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

```bash
git add components/catalog/jobs/NewSandwichJob.tsx app/admin/catalog/new/sandwich/page.tsx
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4b job 4 — the New sandwich page (live cost per sandwich, one create, the Toast link)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 7: Job 3 — the Swap vendor page and the item page's strip

**Files:**
- Create: `components/catalog/jobs/SwapVendorJob.tsx`, `app/admin/catalog/sku/[id]/swap/page.tsx`, `components/catalog/ItemJobsStrip.tsx`
- Modify: `app/admin/catalog/sku/[id]/page.tsx`

- [ ] **Step 1: Create `components/catalog/jobs/SwapVendorJob.tsx`**

```tsx
"use client";

/**
 * SwapVendorJob — job 3 (catalog Phase 4b; spec §5 job 3): pick the replacement → "Just for now at my shop" / "For good"
 * (MoO+ also "For good, every shop") → SEE WHAT CHANGES (every recipe line that switches, every sandwich's cost before
 * and after, the product that groups them) → "Swap it" (Tier E) with the preview's token: the server recomputes the
 * preview and refuses a stale one. Changing anything drops the preview.
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { formatCents, formatQuantity } from "@/lib/i18n/format";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { IngredientPicker } from "@/components/admin/recipes/IngredientPicker";
import { buildIngredientOptions, type IngredientOption } from "@/lib/ingredient-picker-shared";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import { jobErrorKey, newItemHref } from "@/lib/catalog/jobs-shared";
import { skuItemHref } from "@/lib/catalog/sku-item-shared";
import type { SwapJobView } from "@/lib/catalog/jobs";
import type { SwapPreview, SwapStarted } from "@/lib/catalog/swap-vendor";
import type { RecipeLineFields } from "@/lib/recipe-line-shared";
import { btn, btnPrimary, card, field, fieldLabel } from "@/components/catalog/jobs/styles";

type Where = "for_now" | "for_good" | "everywhere";

export function SwapVendorJob({ view }: { view: SwapJobView }) {
  const { t, language } = useTranslation();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const [choice, setChoice] = useState<IngredientOption | null>(null);
  const [where, setWhere] = useState<Where>("for_now");
  const [productName, setProductName] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [preview, setPreview] = useState<SwapPreview | null>(null);
  const [result, setResult] = useState<SwapStarted | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [guard] = useState(() => createRequestGuard());
  const options = useMemo(() => buildIngredientOptions({ skus: view.candidates, items: [], products: [] }), [view.candidates]);
  const money = (n: number | null) => (n === null ? "—" : formatCents(Math.round(n * 100), language));

  const request = () => ({
    newSkuId: choice?.id ?? "", scope: where === "everywhere" ? null : view.scope, mode: where === "for_now" ? "for_now" : "for_good",
    productName: productName.trim() || null, productNameEs: null, note: null,
  });
  const reset = () => { guard.invalidate(); setPreview(null); setMessage(null); };

  const seeChanges = async () => {
    if (!choice) return;
    setMessage(null);
    setBusy(true);
    const r = await guard.run(() => postJson(`/api/admin/catalog/sku/${view.oldSku.id}/swap/preview`, request()));
    setBusy(false);
    if (r === null) return;
    if (!r.ok) {
      setMessage(t(jobErrorKey(r.code)));
      return;
    }
    const p = r.data as unknown as SwapPreview;
    setPreview(p);
    // The preview names the new product; the field (outside the preview) shows that name, and editing it drops the preview.
    // The swap sends back EXACTLY the request the preview hashed (preview.request) — never this page's own (Astra 4b r1#5).
    if (p.product.kind === "create") { setNeedsName(true); if (productName.trim() === "") setProductName(p.product.name); }
  };
  const swap = async () => {
    if (!preview) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`/api/admin/catalog/sku/${view.oldSku.id}/swap`, { ...preview.request, token: preview.token });
    setBusy(false);
    if (!r.ok) {
      setMessage(t(jobErrorKey(r.code)));
      return;
    }
    setResult(r.data as unknown as SwapStarted);
    setPreview(null);
  };

  const line = (f: RecipeLineFields, itemName: string) => `${formatQuantity(f.quantity, language)} ${f.unit ?? ""} ${itemName}`.trim();
  const shopLabel = where === "everywhere" ? t("catalog.jobs.every_shop") : view.scopeName;

  if (view.liveSwapId) {
    return (
      <section className={card}>
        <p className="text-sm text-co-text">{t("catalog.swap.already", { shop: view.scopeName })}</p>
        <Link className={btn} href={skuItemHref(view.oldSku.id, { shopId: view.scope })}>{t("catalog.jobs.open_item")}</Link>
      </section>
    );
  }
  if (result) {
    return (
      <section className={card}>
        <p className="text-sm font-bold text-co-text">{t("catalog.swap.done", { shop: shopLabel })}</p>
        {/* A swap writes no par (lead decision 3): the new item's par is set on its own page. */}
        {choice && where !== "everywhere" ? (
          <Link className="text-sm font-semibold text-co-text underline" href={skuItemHref(choice.id, { shopId: view.scope })}>{t("catalog.swap.set_par", { name: choice.name })}</Link>
        ) : null}
        <Link className={btn} href={skuItemHref(view.oldSku.id, { shopId: view.scope })}>{t("catalog.jobs.open_item")}</Link>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className={card} disabled={busy}>
        <legend className="text-base font-bold text-co-text">{t("catalog.swap.replace", { name: view.oldSku.name, vendor: view.oldSku.vendorName ?? "—" })}</legend>
        <span className={fieldLabel}>{t("catalog.swap.replacement")}</span>
        <IngredientPicker options={options} value={choice} onChange={(o) => { setChoice(o); setNeedsName(false); setProductName(""); reset(); }} disabled={busy} />
        <Link className="text-sm font-semibold text-co-text underline" href={newItemHref({ shopId: view.scope })}>{t("catalog.swap.add_new")}</Link>

        <span className={fieldLabel}>{t("catalog.swap.mode")}</span>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {(["for_now", "for_good", ...(view.canEverywhere ? ["everywhere"] : [])] as Where[]).map((w) => (
            <button key={w} type="button" role="radio" aria-checked={where === w} className={where === w ? btnPrimary : btn} onClick={() => { setWhere(w); reset(); }}>
              {t(`catalog.swap.${w}` as TranslationKey, { shop: view.scopeName })}
            </button>
          ))}
        </div>
        {needsName ? (
          <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.swap.product_name")}</span>
            <input className={field} value={productName} maxLength={120} onChange={(e) => { setProductName(e.target.value); reset(); }} /></label>
        ) : null}
        <button type="button" className={btnPrimary} disabled={!choice || busy} onClick={() => void seeChanges()}>{t("catalog.swap.preview")}</button>
      </fieldset>

      {preview ? (
        <section className={card} aria-labelledby="swap-preview">
          <h2 id="swap-preview" className="text-base font-bold text-co-text">{t("catalog.swap.what_changes", { shop: shopLabel })}</h2>
          {preview.product.kind === "existing" ? (
            <p className="text-sm text-co-text">{t("catalog.swap.product_existing", { name: preview.product.name })}</p>
          ) : (
            <p className="text-sm text-co-text">{t("catalog.swap.product_new", { name: preview.product.name })}</p>
          )}
          {preview.recipes.length === 0 ? <p className="text-sm text-co-text">{t("catalog.swap.no_recipes")}</p> : (
            <>
              <span className={fieldLabel}>{t("catalog.swap.recipes", { n: preview.recipes.length })}</span>
              <ul className="flex flex-col gap-1">
                {preview.recipes.flatMap((r) => r.changes.map((c) => (
                  <li key={`${r.recipeId}-${c.position}`} className="text-sm text-co-text">
                    {t("catalog.swap.line", { recipe: r.recipeName, before: line(c.before, preview.oldSku.name), after: line(c.after, preview.newSku.name) })}
                    {c.converted ? <span className="text-co-text-muted"> {t("catalog.swap.converted")}</span> : null}
                  </li>
                )))}
              </ul>
            </>
          )}
          {preview.refused.map((x) => (
            <p key={`${x.recipeId}-${x.position}`} className="text-sm font-semibold text-co-cta-text">{t("catalog.swap.refused", { recipe: x.recipeName, position: x.position })}</p>
          ))}
          {preview.followsPrimary.length > 0 ? <p className="text-sm text-co-text">{t("catalog.swap.follows", { names: preview.followsPrimary.map((f) => f.name).join(", ") })}</p> : null}
          {preview.untouchedShops.length > 0 ? <p className="text-sm text-co-text">{t("catalog.swap.untouched", { names: preview.untouchedShops.map((s) => s.name).join(", ") })}</p> : null}
          {preview.costs.length > 0 ? (
            <table className="w-full text-sm text-co-text">
              <thead><tr><th className="text-left">{t("catalog.swap.costs")}</th><th className="text-right">{t("catalog.swap.before")}</th><th className="text-right">{t("catalog.swap.after")}</th></tr></thead>
              <tbody>
                {preview.costs.map((c) => (
                  <tr key={c.menuItemId}><td>{language === "es" && c.nameEs ? c.nameEs : c.name}</td><td className="text-right">{money(c.before)}</td><td className="text-right">{money(c.after)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={busy || preview.refused.length > 0} onClick={() => void swap()}>{t("catalog.swap.confirm")}</button>
            <button type="button" className={btn} disabled={busy} onClick={reset}>{t("catalog.jobs.cancel")}</button>
          </div>
        </section>
      ) : null}
      {message ? <p role="status" className="text-sm font-semibold text-co-text">{message}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `app/admin/catalog/sku/[id]/swap/page.tsx`**

```tsx
/**
 * /admin/catalog/sku/[id]/swap — job 3, Swap vendor (catalog Phase 4b). The shop comes from `?location=` (2b's
 * `/admin/catalog/sku/` prefix) among the shops the actor works in; a shop-owned item offers only its owner.
 */
import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import { NEW_THING_MIN, ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { loadSwapJobView } from "@/lib/catalog/jobs";
import { PageHeader } from "@/components/ui/PageHeader";
import { SwapVendorJob } from "@/components/catalog/jobs/SwapVendorJob";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SwapVendorPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const auth = await requireSessionFromHeaders(`/admin/catalog/sku/${id}/swap`);
  if (auth.level < NEW_THING_MIN) redirect("/dashboard");
  const sb = getServiceRoleClient();
  const [{ data: locs, error }, { data: sku, error: skuErr }] = await Promise.all([
    sb.from("locations").select("id").eq("active", true).order("name").returns<Array<{ id: string }>>(),
    sb.from("vendor_items").select("id, location_id").eq("id", id).maybeSingle<{ id: string; location_id: string | null }>(),
  ]);
  if (error) throw new Error(`swap page locations: ${error.message}`);
  if (skuErr) throw new Error(`swap page item: ${skuErr.message}`);
  if (!sku) notFound();
  const mine = (locs ?? []).map((l) => l.id).filter((l) => catalogShopAllowed(auth, l) && (sku.location_id === null || sku.location_id === l));
  const explicit = shopParamFor(`/admin/catalog/sku/${id}/swap`, searchParamValues(sp));
  const scope = explicit && explicit !== "global" && mine.includes(explicit) ? explicit : mine.length > 0 ? await resolveShopId(mine, null) : null;
  if (scope === null) notFound();
  let view;
  try {
    view = await loadSwapJobView(auth, id, scope);
  } catch (e) {
    if (e instanceof ShopOwnedError && e.status === 404) notFound();
    if (e instanceof ShopOwnedError && e.status === 403) redirect("/dashboard");
    throw e;
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
      <PageHeader title={serverT(auth.user.language, "catalog.swap.title")} subtitle={view.oldSku.name} />
      <SwapVendorJob key={`${id}:${scope}`} view={view} />
    </div>
  );
}
```

- [ ] **Step 3: Create `components/catalog/ItemJobsStrip.tsx`**

```tsx
"use client";

/**
 * ItemJobsStrip — the item page's jobs (catalog Phase 4b): "Only at <shop>" and (MoO+) Share with every shop; Swap
 * vendor; and, while a "Just for now" swap is live here, the BACK TO NORMAL banner — preview what goes back (retired or
 * restored versions, versions kept because the GM changed them since, the primary), then one save (Tier E) with its token.
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { formatDateLabel } from "@/lib/i18n/format";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { jobErrorKey } from "@/lib/catalog/jobs-shared";
import type { ItemJobsStripView } from "@/lib/catalog/jobs";
import type { BackToNormalPreview } from "@/lib/catalog/swap-vendor";
import { ShareWithEveryShop } from "@/components/catalog/ShareWithEveryShop";
import { btn, btnPrimary, card } from "@/components/catalog/jobs/styles";

export function ItemJobsStrip({ strip }: { strip: ItemJobsStripView }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const [back, setBack] = useState<BackToNormalPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const previewBack = async (swapId: string) => {
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/catalog/swaps/${swapId}/back-to-normal`, { redirect: "manual" });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) setMessage(t(jobErrorKey(typeof body.code === "string" ? body.code : "generic")));
      else setBack(body as unknown as BackToNormalPreview);
    } catch {
      setMessage(t(jobErrorKey("generic")));
    }
    setBusy(false);
  };
  const goBack = async () => {
    if (!back) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`/api/admin/catalog/swaps/${back.swapId}/back-to-normal`, { token: back.token });
    setBusy(false);
    if (!r.ok) {
      setMessage(t(jobErrorKey(r.code)));
      return;
    }
    setBack(null);
    setMessage(t("catalog.swap.back_done"));
    router.refresh();
  };

  if (!strip.owner && !strip.swapHref && strip.liveSwaps.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {strip.owner || strip.swapHref ? (
        <div className="flex flex-wrap items-center gap-2">
          {strip.owner ? (
            <span className="rounded-full border-2 border-co-gold-deep px-3 py-1 text-xs font-bold text-co-text">{t("catalog.owned.only_at", { shop: strip.owner.shopName })}</span>
          ) : null}
          {strip.swapHref ? <Link className={btn} href={strip.swapHref}>{t("catalog.swap.open")}</Link> : null}
          {strip.canShare ? <ShareWithEveryShop kind="sku" id={strip.skuId} /> : null}
        </div>
      ) : null}
      {strip.liveSwaps.map((s) => (
        <div key={s.swapId} className={card} role="status">
          <p className="text-sm text-co-text">{t("catalog.swap.live", { old: s.oldName, new: s.newName, date: formatDateLabel(s.startedAt.slice(0, 10), language) })}</p>
          {back?.swapId === s.swapId ? (
            <>
              {back.goingBack.length > 0 ? <p className="text-sm text-co-text">{t("catalog.swap.back_preview", { names: back.goingBack.map((g) => g.recipeName).join(", ") })}</p> : null}
              {back.kept.length > 0 ? <p className="text-sm text-co-text">{t("catalog.swap.back_kept", { names: back.kept.map((k) => k.recipeName).join(", ") })}</p> : null}
              {back.primary === "changed_since" ? <p className="text-sm text-co-text">{t("catalog.swap.back_primary_changed")}</p> : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => void goBack()}>{t("catalog.swap.back_confirm")}</button>
                <button type="button" className={btn} disabled={busy} onClick={() => setBack(null)}>{t("catalog.jobs.cancel")}</button>
              </div>
            </>
          ) : (
            <button type="button" className={btn} disabled={busy} onClick={() => void previewBack(s.swapId)}>{t("catalog.swap.back")}</button>
          )}
        </div>
      ))}
      {message ? <p role="status" className="text-sm font-semibold text-co-text">{message}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: The item page shows the strip (`app/admin/catalog/sku/[id]/page.tsx`, 2b)**

1. Add imports: `import { loadItemJobsStrip } from "@/lib/catalog/jobs";` and `import { ItemJobsStrip } from "@/components/catalog/ItemJobsStrip";`.
2. Replace

```tsx
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4">
      <PageHeader title={view.sku.name} subtitle={serverT(auth.user.language, "catalog.item.kind_bought")} />
```

with

```tsx
  // Catalog Phase 4b: "only at", Share, Swap vendor and Back to normal — for this item at this shop.
  const strip = await loadItemJobsStrip(auth, id, scope);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4">
      <PageHeader title={view.sku.name} subtitle={serverT(auth.user.language, "catalog.item.kind_bought")} />
      <ItemJobsStrip strip={strip} />
```

- [ ] **Step 5: Typecheck, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

```bash
git add components/catalog/jobs/SwapVendorJob.tsx "app/admin/catalog/sku/[id]/swap/page.tsx" components/catalog/ItemJobsStrip.tsx "app/admin/catalog/sku/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4b job 3 — the Swap vendor page (preview with cost changes, one swap) and Back to normal on the item page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 8: The menu-item page — a shop-only sandwich's own body, and the Toast link on every menu item at a shop

**Files:**
- Create: `components/catalog/OwnedSandwichClient.tsx`
- Modify: `app/admin/catalog/menu-item/[id]/page.tsx`

- [ ] **Step 1: Create `components/catalog/OwnedSandwichClient.tsx`**

```tsx
"use client";

/**
 * OwnedSandwichClient — the page body of a sandwich only one shop sells (catalog Phase 4b; 0264). It has no shop
 * overlay (its row IS that shop's): its price (its shop's GM, Tier E, compare-and-set on the price shown), its recipe
 * (edited as itself on the recipe page), its cost where it is sold, its Toast link there, and — MoO+ — Share with every shop.
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents } from "@/lib/i18n/format";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { jobErrorKey } from "@/lib/catalog/jobs-shared";
import { recipeItemHref } from "@/lib/catalog/recipe-item-shared";
import type { OwnedSandwichView } from "@/lib/catalog/jobs";
import { ToastLinkSection } from "@/components/catalog/ToastLinkSection";
import { ShareWithEveryShop } from "@/components/catalog/ShareWithEveryShop";
import { btn, btnPrimary, card, field, fieldLabel } from "@/components/catalog/jobs/styles";

export function OwnedSandwichClient({ view }: { view: OwnedSandwichView }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const [price, setPrice] = useState(view.menuItem.price === null ? "" : String(view.menuItem.price));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const money = (n: number | null) => (n === null ? "—" : formatCents(Math.round(n * 100), language));
  const next = price.trim() === "" ? null : Number(price);

  const savePrice = async () => {
    setMessage(null);
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`/api/admin/menu-items/${view.menuItem.id}/price`, { menuPrice: next, expectedMenuPrice: view.menuItem.price }, "PATCH");
    setBusy(false);
    if (!r.ok) {
      setMessage(t(jobErrorKey(r.code)));
      return;
    }
    setMessage(t("catalog.jobs.saved"));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border-2 border-co-gold-deep px-3 py-1 text-xs font-bold text-co-text">{t("catalog.owned.only_at", { shop: view.owner.shopName })}</span>
        {view.canShare ? <ShareWithEveryShop kind="menu_item" id={view.menuItem.id} /> : null}
      </div>
      <section className={card}>
        <label className="flex flex-col"><span className={fieldLabel}>{t("catalog.owned.price", { shop: view.owner.shopName })}</span>
          <input className={field} inputMode="decimal" value={price} disabled={!view.canEditPrice || busy} onChange={(e) => setPrice(e.target.value)} /></label>
        {view.canEditPrice ? (
          <button type="button" className={btnPrimary} disabled={busy || next === view.menuItem.price || (next !== null && !(next > 0))} onClick={() => void savePrice()}>
            {t("catalog.owned.price_save")}
          </button>
        ) : null}
        <p className="text-sm text-co-text">{t("catalog.owned.cost", { shop: view.owner.shopName, cost: money(view.cost) })}</p>
        {view.recipe ? <Link className={btn} href={recipeItemHref(view.recipe.id)}>{t("catalog.owned.recipe", { name: view.recipe.name })}</Link> : null}
        {message ? <p role="status" className="text-sm font-semibold text-co-text">{message}</p> : null}
      </section>
      <ToastLinkSection menuItemId={view.menuItem.id} shopId={view.owner.shopId} shopName={view.owner.shopName} canLink={view.canLinkToast} />
    </div>
  );
}
```

- [ ] **Step 2: The page branches (`app/admin/catalog/menu-item/[id]/page.tsx`, 3b)**

1. Add imports: `import { loadOwnedSandwichView } from "@/lib/catalog/jobs";`, `import { OwnedSandwichClient } from "@/components/catalog/OwnedSandwichClient";`, `import { ToastLinkSection } from "@/components/catalog/ToastLinkSection";`, `import { TOAST_MAP_MIN } from "@/lib/admin/toast-map";`, `import { catalogShopAllowed } from "@/lib/sku-versions-shared";`.
2. Directly after `  if (!UUID_RE.test(id)) notFound();`, insert:

```tsx
  // CATALOG PHASE 4b (0264): a sandwich only one shop sells has its own page body — its price, its recipe, its Toast link.
  const { data: own, error: ownErr } = await getServiceRoleClient().from("menu_items").select("location_id").eq("id", id)
    .maybeSingle<{ location_id: string | null }>();
  if (ownErr) throw new Error(`catalog menu page owner: ${ownErr.message}`);
  if (own?.location_id) {
    const owned = await loadOwnedSandwichView(auth, id);
    const ownedLang = auth.user.language;
    return (
      <div className="mx-auto w-full max-w-5xl">
        <PageHeader title={ownedLang === "es" && owned.menuItem.nameEs ? owned.menuItem.nameEs : owned.menuItem.name} subtitle={serverT(ownedLang, "catalog.menu.kind")} />
        <OwnedSandwichClient view={owned} />
      </div>
    );
  }
```

3. Replace

```tsx
      <MenuItemClient key={pageClientKey("menu", view.item.id, view.scope)} view={view} />
```

with

```tsx
      <MenuItemClient key={pageClientKey("menu", view.item.id, view.scope)} view={view} />
      {/* Catalog Phase 4b: the Toast link lives on the sandwich now (spec §5 job 4), at the shop shown. */}
      {view.scope !== null ? (
        <ToastLinkSection menuItemId={view.item.id} shopId={view.scope} shopName={view.scopeName ?? ""}
          canLink={level >= TOAST_MAP_MIN && catalogShopAllowed(auth, view.scope)} />
      ) : null}
```

- [ ] **Step 2b: The recipe page names a shop's own recipe and offers Share (`app/admin/catalog/recipe/[id]/page.tsx`, 3b + 4a)** — add `import { ShareWithEveryShop } from "@/components/catalog/ShareWithEveryShop";` and `import { SHARE_MIN } from "@/lib/catalog/shop-owned-shared";`, then replace

```tsx
      <RecipeItemClient key={pageClientKey("recipe", view.recipe.id, view.scope)} view={view} />
```

with

```tsx
      {/* Catalog Phase 4a/4b: a shop's own recipe (a GM's prep recipe or sandwich recipe) says so; MoO+ may share it.
          A recipe that makes a sandwich is shared WITH the sandwich (its page). */}
      {view.owner ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border-2 border-co-gold-deep px-3 py-1 text-xs font-bold text-co-text">
            {serverT(lang, "catalog.owned.only_at", { shop: view.owner.shopName ?? "" })}
          </span>
          {level >= SHARE_MIN ? <ShareWithEveryShop kind="recipe" id={view.recipe.id} /> : null}
        </div>
      ) : null}
      <RecipeItemClient key={pageClientKey("recipe", view.recipe.id, view.scope)} view={view} />
```

- [ ] **Step 2c: The recipe page names 4a's refusals (3b's `components/catalog/RecipeItemClient.tsx`; Astra 4b r1)** — in every 3b set that maps a refusal to `catalog.recipe.error.<code>` (`RECIPE_ERRORS`, and the `recipe` entry of `KNOWN`), add `"ownership_changed", "line_other_shop", "shop_owned_edit_here",`. A refused LINE (`line_other_shop` carries `line: { position, name, reason }`) already renders through 3b's `catalog.recipe.error.line_refused`; the three keys are Task 3's.

- [ ] **Step 3: Typecheck, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

```bash
git add components/catalog/OwnedSandwichClient.tsx "app/admin/catalog/menu-item/[id]/page.tsx" "app/admin/catalog/recipe/[id]/page.tsx" components/catalog/RecipeItemClient.tsx
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4b — a shop-only sandwich's page; the Toast link on every menu item at a shop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 9: Every way in

Spec §5: each job "starts from the item page and from wherever the problem first shows up". 4b wires: the admin hub, the costing board, the legacy recipe list and its "new" page (a GM's new recipe is its shop's own — lead decision 1 — and the page says which shop), the legacy SKU form (a GM picks its shop — 4a made a no-shop item MoO+), and the catalog list's "only at" badge. The Catering Toast tab is NOT touched (lead decision 6).

**Files:**
- Modify: `lib/admin/sections.ts`, `lib/shop-context-shared.ts`, `app/admin/menu-costing/page.tsx`, `components/admin/recipes/RecipesClient.tsx`, `components/admin/recipes/RecipeBuilder.tsx`, `app/admin/recipes/new/page.tsx`, `components/admin/skus/SkuBuilder.tsx`, `components/admin/catalog/CatalogClient.tsx`, `app/admin/vendors/[id]/page.tsx`, `app/api/admin/vendors/[id]/order-guide/route.ts`, `components/admin/vendors/OrderGuidePanel.tsx`

- [ ] **Step 1: The admin hub (`lib/admin/sections.ts`)** — directly after the line

```ts
  { id: "menu-costing",        i18nKey: "admin.section.menu-costing",                          href: "/admin/menu-costing",        minLevel: 6 },
```

insert:

```ts
  // Catalog Phase 4b: the guided jobs (spec §5). GM+ — a new item or sandwich starts at the GM's shop (4a).
  { id: "catalog-new-item",     i18nKey: "admin.section.catalog-new-item" as TranslationKey,     href: "/admin/catalog/new/item",     minLevel: 7 },
  { id: "catalog-new-sandwich", i18nKey: "admin.section.catalog-new-sandwich" as TranslationKey, href: "/admin/catalog/new/sandwich", minLevel: 7 },
```

- [ ] **Step 2: The costing board (`app/admin/menu-costing/page.tsx`)** — add `import Link from "next/link";` (if absent), `import { newSandwichHref } from "@/lib/catalog/jobs-shared";` and `import { NEW_THING_MIN } from "@/lib/catalog/shop-owned-shared";`; directly before 3a's `      {notSoldHere.length > 0 ? (`, insert:

```tsx
      {level >= NEW_THING_MIN ? (
        <p className="mb-4">
          <Link className="text-sm font-bold text-co-text underline" href={newSandwichHref(scope === null ? {} : { shopId: scope })}>
            {serverT(lang, "admin.menu_costing.new_sandwich")}
          </Link>
        </p>
      ) : null}
```

- [ ] **Step 3: The legacy recipe list and "new" page** (lead decision 1: a GM keeps creating recipes — as its shop's own)

1. `components/admin/recipes/RecipesClient.tsx`: add `import { newSandwichHref } from "@/lib/catalog/jobs-shared";`, then replace

```tsx
      {/* New recipe — link to dedicated page */}
      {canWrite ? (
        <div className="mt-6">
          <Link
            href="/admin/recipes/new"
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text hover:border-co-text transition"
          >
            {t(rk("recipes.create.open_button"))}
          </Link>
        </div>
      ) : null}
```

with

```tsx
      {/* New recipe — a GM's is its shop's own (catalog Phase 4a, lead decision 1); MoO+'s is every shop's. A new
          sandwich has its own guided job (name, price, live cost, Toast link). */}
      {canWrite ? (
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/admin/recipes/new"
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text hover:border-co-text transition"
          >
            {t(rk("recipes.create.open_button"))}
          </Link>
          <Link
            href={newSandwichHref()}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text hover:border-co-text transition"
          >
            {t(rk("recipes.create.new_sandwich"))}
          </Link>
        </div>
      ) : null}
```

2. `components/admin/recipes/RecipeBuilder.tsx` sends the shop: replace

```tsx
  defaultType = "production",
  readiness = null,
}: {
```

with

```tsx
  defaultType = "production",
  readiness = null,
  newRecipeShopId = null,
}: {
```

replace

```tsx
  defaultType?: RecipeType;
  readiness?: Readiness | null;
}) {
```

with

```tsx
  defaultType?: RecipeType;
  readiness?: Readiness | null;
  /** Catalog Phase 4a/4b (lead decision 1): the shop a GM's new recipe belongs to; null = every shop's (MoO+). */
  newRecipeShopId?: string | null;
}) {
```

and replace

```tsx
    const result = await send("/api/admin/recipes/full", {
      name,
```

with

```tsx
    const result = await send("/api/admin/recipes/full", {
      locationId: newRecipeShopId ?? undefined,
      name,
```

3. `lib/shop-context-shared.ts` `SHOP_PARAMS_BY_PATH`: beside 4b's two job routes add `  "/admin/recipes/new": ["location"], // catalog Phase 4b — the shop a GM's new recipe starts at`.
4. `app/admin/recipes/new/page.tsx`: add `import { getServiceRoleClient } from "@/lib/supabase-server";`, `import { resolveShopId } from "@/lib/shop-context";`, `import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";` and `import { RECIPE_GLOBAL_WRITE_MIN } from "@/lib/recipe-versions-shared";` (each if absent). Directly after `  const catalog = await loadRecipeBuilderCatalog();`, insert:

```tsx
  // Catalog Phase 4a/4b (lead decision 1): a GM's new recipe is its SHOP's own — the shop it works at (or picks here);
  // MoO+'s is every shop's.
  let newRecipeShopId: string | null = null;
  let newRecipeShops: Array<{ id: string; name: string }> = [];
  if (level < RECIPE_GLOBAL_WRITE_MIN) {
    const { data: locs, error: lErr } = await getServiceRoleClient().from("locations").select("id, name").eq("active", true).order("name")
      .returns<Array<{ id: string; name: string }>>();
    if (lErr) throw new Error(`recipes new page locations: ${lErr.message}`);
    newRecipeShops = (locs ?? []).filter((l) => auth.locations.includes(l.id));
    const explicit = shopParamFor("/admin/recipes/new", searchParamValues(sp));
    newRecipeShopId = explicit && newRecipeShops.some((s) => s.id === explicit) ? explicit
      : newRecipeShops.length > 0 ? await resolveShopId(newRecipeShops.map((s) => s.id), null) : null;
  }
  const newRecipeShopName = newRecipeShops.find((s) => s.id === newRecipeShopId)?.name ?? "";
```

Replace `      <RecipeBuilder\n` (the element's first line) with

```tsx
      {level < RECIPE_GLOBAL_WRITE_MIN ? (
        <p className="mb-4 text-sm text-co-text">
          {newRecipeShopId === null ? serverT(lang, "catalog.jobs.no_shop") : serverT(lang, "recipes.new.starts_at", { shop: newRecipeShopName })}
          {newRecipeShops.filter((s) => s.id !== newRecipeShopId).map((s) => (
            <a key={s.id} className="ml-2 font-bold underline" href={`/admin/recipes/new?location=${encodeURIComponent(s.id)}`}>{s.name}</a>
          ))}
        </p>
      ) : null}
      <RecipeBuilder
        newRecipeShopId={newRecipeShopId}
```

- [ ] **Step 4: The legacy SKU form (`components/admin/skus/SkuBuilder.tsx`)**

1. Directly after `  const [locationId, setLocationId] = useState<string>(initial?.locationId ?? "");`, add:

```tsx
  // Catalog Phase 4a: a NEW item for every shop is MoO+ — below that it starts at a shop the person works in (the server
  // binds the shop; this only stops the empty "every shop" choice from being offered).
  const needsShop = !isEdit && actorLevel < 8;
```

2. Replace `            <option value="">{t("admin.skus.global")}</option>` with `            <option value="" disabled={needsShop}>{needsShop ? t("admin.skus.pick_your_shop") : t("admin.skus.global")}</option>`.
3. Replace `  const canSubmit = name.trim() !== "" && !busy; // pack_format gate removed (design §1)` with `  const canSubmit = name.trim() !== "" && !busy && !(needsShop && locationId === ""); // pack_format gate removed (design §1); a GM's new item names its shop (4a)`.

- [ ] **Step 5: The catalog list's badge (`components/admin/catalog/CatalogClient.tsx`)** — replace

```tsx
          <TypeBadge e={e} />
          <RoleBadges e={e} />
```

with

```tsx
          <TypeBadge e={e} />
          <RoleBadges e={e} />
          {e.onlyAtShopName ? (
            <span className="rounded-full border border-co-gold-deep px-2 py-0.5 text-[11px] font-bold text-co-text">{t("catalog.owned.only_at", { shop: e.onlyAtShopName })}</span>
          ) : null}
```

- [ ] **Step 5b: The vendor's guide editor names a shop's own lines (decision (b), Astra round 1)** — it keeps the whole guide (a filtered save would delete lines) and labels each shop's own SKU "Only at <shop>":
1. `app/admin/vendors/[id]/page.tsx`: replace `import { loadOrderGuide, ORDER_GUIDE_EDIT_MIN } from "@/lib/order-guides";` with `import { loadGuideSkuShopNames, loadOrderGuide, ORDER_GUIDE_EDIT_MIN } from "@/lib/order-guides";`; in the `Promise.all` destructuring replace `    orderGuide,\n    guideSkuRes,` with `    orderGuide,\n    guideOnlyAt,\n    guideSkuRes,` and in its array `    loadOrderGuide(id),` with `    loadOrderGuide(id),\n    loadGuideSkuShopNames(id),`; replace `          initial={{ guide: orderGuide, skusNotOnGuide }}` with `          initial={{ guide: orderGuide, skusNotOnGuide, onlyAt: guideOnlyAt }}`.
2. `app/api/admin/vendors/[id]/order-guide/route.ts`: add `  loadGuideSkuShopNames,` to its `@/lib/order-guides` import list; replace `  const guide = await loadOrderGuide(id);` with `  const [guide, onlyAt] = await Promise.all([loadOrderGuide(id), loadGuideSkuShopNames(id)]);` and, in the GET's `return jsonOk({`, `    guide,` with `    guide,\n    onlyAt,`.
3. `components/admin/vendors/OrderGuidePanel.tsx`: in `export interface OrderGuideInitial {` after `  skusNotOnGuide: GuideBucketSku[];` add `  /** skuId → the one shop that owns it (decision (b)): its line says "Only at <shop>". Absent = none. */\n  onlyAt?: Record<string, string>;`; directly after `                        {line.itemNumber ? <span className="ml-2 text-co-text-muted">{line.itemNumber}</span> : null}` add

```tsx
                        {line.skuId && baseline.onlyAt?.[line.skuId] ? (
                          <span className="ml-2 rounded-full border border-co-gold-deep px-2 py-0.5 text-[11px] font-bold text-co-text">{t("catalog.owned.only_at", { shop: baseline.onlyAt[line.skuId]! })}</span>
                        ) : null}
```

and directly after the bucket's `{s.itemNumber ? <span className="ml-2 text-co-text-muted">{s.itemNumber}</span> : null}` add the same chip for `s.skuId`:

```tsx
                      {baseline.onlyAt?.[s.skuId] ? (
                        <span className="ml-2 rounded-full border border-co-gold-deep px-2 py-0.5 text-[11px] font-bold text-co-text">{t("catalog.owned.only_at", { shop: baseline.onlyAt[s.skuId]! })}</span>
                      ) : null}
```

(The panel re-reads `GET …/order-guide` after a save, which now carries `onlyAt`; a response without it shows no chips rather than wrong ones.)

- [ ] **Step 6: Typecheck, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"` → expected: no output.

```bash
git add lib/admin/sections.ts lib/shop-context-shared.ts app/admin/menu-costing/page.tsx components/admin/recipes/RecipesClient.tsx components/admin/recipes/RecipeBuilder.tsx app/admin/recipes/new/page.tsx components/admin/skus/SkuBuilder.tsx components/admin/catalog/CatalogClient.tsx "app/admin/vendors/[id]/page.tsx" "app/api/admin/vendors/[id]/order-guide/route.ts" components/admin/vendors/OrderGuidePanel.tsx
git commit -m "$(cat <<'EOF'
feat(catalog): Phase 4b — every way into the jobs: hub cards, the costing board, legacy recipes and SKUs, Catering's Toast tab, the catalog badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 10: The UI pins and the clients' tiers

**Files:**
- Create: `tests/catalog-jobs-ui.test.ts`
- Modify: `tests/step-up-tier-map.test.ts`

- [ ] **Step 1: Write `tests/catalog-jobs-ui.test.ts`**

```ts
/** Catalog Phase 4b — the job clients call only 4a's routes, at the routes' own tiers; every way in leads to a job. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declaredShopRoutes } from "@/lib/shop-context-shared";
import { ADMIN_SECTIONS } from "@/lib/admin/sections";

const src = (p: string) => readFileSync(p, "utf8");

describe("the job clients", () => {
  it("New item: inline vendor at Tier B, the create and every setup step at Tier E, one route each", () => {
    const s = src("components/catalog/jobs/NewItemJob.tsx");
    expect(s).toContain('requestStepUp("B")');
    expect(s).toContain('send("/api/admin/vendors", {');
    expect(s).toContain('send("/api/admin/catalog/jobs/new-item", {');
    expect(s).toContain("send(`/api/admin/catalog/sku/${created.skuId}/setup`, { shopId: view.scope, step })");
    expect(s).toContain("levelsFromSentence(sentence, measureLabels)");
  });
  it("New sandwich: the live cost through the request guard; the create names a refused line", () => {
    const s = src("components/catalog/jobs/NewSandwichJob.tsx");
    expect(s).toContain('guard.run(() => postJson("/api/admin/catalog/jobs/new-sandwich/preview", draft(true)))');
    // every draft change drops what is in flight and shows pending at once (Astra 4b r1#9)
    expect(s).toContain("setLive(liveCostOnDraftChange<SandwichCost>(lines.length > 0));");
    expect(s).toContain("return () => { clearTimeout(timer); guard.invalidate(); };");
    expect(s).toContain('send("/api/admin/catalog/jobs/new-sandwich", draft(false))');
    expect(s).toContain('t("catalog.newSandwich.line_refused", {');
    expect(s).toContain("<ToastLinkSection menuItemId={created.menuItemId}");
  });
  it("Swap: preview through the guard, the swap carries the preview's token, any change drops the preview", () => {
    const s = src("components/catalog/jobs/SwapVendorJob.tsx");
    expect(s).toContain("guard.run(() => postJson(`/api/admin/catalog/sku/${view.oldSku.id}/swap/preview`, request()))");
    // the swap sends back EXACTLY the request the preview hashed (Astra 4b r1#5)
    expect(s).toContain("send(`/api/admin/catalog/sku/${view.oldSku.id}/swap`, { ...preview.request, token: preview.token })");
    expect(s).not.toContain("{ ...request(), token: preview.token }");
    expect(s).toContain("const reset = () => { guard.invalidate(); setPreview(null); setMessage(null); };");
  });
  it("the Toast link asks Tier A; Share, Back to normal and the owned sandwich's price ask Tier E", () => {
    expect(src("components/catalog/ToastLinkSection.tsx")).toContain('requestStepUp("A")');
    expect(src("components/catalog/ShareWithEveryShop.tsx")).toContain('requestStepUp("E")');
    expect(src("components/catalog/ItemJobsStrip.tsx")).toContain("send(`/api/admin/catalog/swaps/${back.swapId}/back-to-normal`, { token: back.token })");
    expect(src("components/catalog/OwnedSandwichClient.tsx")).toContain('{ menuPrice: next, expectedMenuPrice: view.menuItem.price }, "PATCH")');
  });
});

describe("every way in", () => {
  it("the hub, the costing board, the legacy recipe screens, the SKU form, Catering's Toast tab, the catalog list", () => {
    expect(ADMIN_SECTIONS.find((s) => s.id === "catalog-new-item")).toMatchObject({ href: "/admin/catalog/new/item", minLevel: 7 });
    expect(ADMIN_SECTIONS.find((s) => s.id === "catalog-new-sandwich")).toMatchObject({ href: "/admin/catalog/new/sandwich", minLevel: 7 });
    expect(src("app/admin/menu-costing/page.tsx")).toContain('serverT(lang, "admin.menu_costing.new_sandwich")');
    expect(src("components/admin/recipes/RecipesClient.tsx")).toContain("href={newSandwichHref()}");
    expect(src("components/admin/recipes/RecipesClient.tsx")).toContain('href="/admin/recipes/new"'); // a GM keeps creating recipes (lead decision 1)
    expect(src("app/admin/recipes/new/page.tsx")).toContain("newRecipeShopId={newRecipeShopId}");
    expect(src("components/admin/recipes/RecipeBuilder.tsx")).toContain("locationId: newRecipeShopId ?? undefined,");
    expect(src("app/admin/catalog/recipe/[id]/page.tsx")).toContain('<ShareWithEveryShop kind="recipe" id={view.recipe.id} />');
    expect(src("components/admin/skus/SkuBuilder.tsx")).toContain("const needsShop = !isEdit && actorLevel < 8;");
    expect(src("components/admin/catering/menu/ToastTab.tsx")).not.toContain("catalog."); // the Catering Toast tab stays as it is (lead decision 6)
    expect(src("components/admin/catalog/CatalogClient.tsx")).toContain('t("catalog.owned.only_at", { shop: e.onlyAtShopName })');
    // decision (b): the vendor's guide editor labels each shop's own line
    expect(src("components/admin/vendors/OrderGuidePanel.tsx")).toContain('t("catalog.owned.only_at", { shop: baseline.onlyAt[line.skuId]! })');
    expect(src("app/admin/vendors/[id]/page.tsx")).toContain("initial={{ guide: orderGuide, skusNotOnGuide, onlyAt: guideOnlyAt }}");
    for (const code of ["ownership_changed", "line_other_shop", "shop_owned_edit_here"]) {
      expect(src("components/catalog/RecipeItemClient.tsx")).toContain(`"${code}"`);
    }
  });
  it("the item page shows the strip; the menu page branches for a shop-only sandwich and shows the Toast link at a shop", () => {
    expect(src("app/admin/catalog/sku/[id]/page.tsx")).toContain("<ItemJobsStrip strip={strip} />");
    const menu = src("app/admin/catalog/menu-item/[id]/page.tsx");
    expect(menu).toContain("<OwnedSandwichClient view={owned} />");
    expect(menu).toContain("<ToastLinkSection menuItemId={view.item.id} shopId={view.scope}");
  });
  it("the job pages declare and read their shop parameter", () => {
    for (const r of ["/admin/catalog/new/item", "/admin/catalog/new/sandwich", "/admin/recipes/new"]) {
      expect(declaredShopRoutes()).toContain(r);
      expect(src(`app${r}/page.tsx`)).toContain(`shopParamFor("${r}", searchParamValues(sp))`);
    }
  });
});
```

- [ ] **Step 2: Register the clients' tiers** — in `tests/step-up-tier-map.test.ts` `CLIENT_TIER_MAP`, add:

```ts
  // Catalog Phase 4b: the job clients ask exactly the tiers of the routes they call (an inline vendor = the directory's B).
  "components/catalog/jobs/NewItemJob.tsx": ["B", "E"],
  "components/catalog/jobs/NewSandwichJob.tsx": ["E"],
  "components/catalog/jobs/SwapVendorJob.tsx": ["E"],
  "components/catalog/ToastLinkSection.tsx": ["A"],
  "components/catalog/ShareWithEveryShop.tsx": ["E"],
  "components/catalog/ItemJobsStrip.tsx": ["E"],
  "components/catalog/OwnedSandwichClient.tsx": ["E"],
```

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/catalog-jobs-ui.test.ts tests/step-up-tier-map.test.ts tests/shop-context-routes.test.ts` (the last is whichever existing test audits `declaredShopRoutes()` against page sources — `grep -l declaredShopRoutes tests/` names it) → expected: PASS.

```bash
git add tests/catalog-jobs-ui.test.ts tests/step-up-tier-map.test.ts
git commit -m "$(cat <<'EOF'
test(catalog): Phase 4b UI pins — routes, tiers, guards, every way in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
)"
```

---

## Task 11: Manager guide — the three jobs (en + es)

Photos are deferred (spec §7 as amended): the steps carry "(not shown)".

**Files:**
- Modify: `docs/guides/manager-guide.md`
- Test (existing): `tests/guides-reading-level.test.ts`, `tests/guides-v2-shape.test.ts`, `tests/guides-markdown.test.ts`

- [ ] **Step 1: Baseline** — Run: `npx vitest run tests/guides-reading-level.test.ts tests/guides-v2-shape.test.ts tests/guides-markdown.test.ts` → expected: PASS.

- [ ] **Step 2: The English section** — insert directly after 3b's line `- The preview lists every shop that will change. Shops with their own version stay as they are.`, after a blank line:

```markdown
### New items, new sandwiches, and swapping a vendor

New things you make — items, recipes and sandwiches — start at your shop. Other shops don't see them. Only the Director of Operations shares them with every shop.

#### 1. Add a new item (not shown)

**What to do** — Open **New item** from the admin page. Pick what it is and who you buy it from. Type its name and the vendor's number. Say how it arrives. Type the price. Tap **Create item**. Then set the par, the order days, the order guide spot, where it is used, and the barcode.

**Worth knowing**

- No vendor yet? Tap **Add a new vendor** and fill in the short form.
- Each setup line saves on its own. Skip one and do it later on the item page.
- You can scan the barcode later, at the first delivery.

#### 2. Add a new sandwich (not shown)

**What to do** — Open **New sandwich**. Type the name and your shop's price. Add each ingredient. Watch the cost per sandwich. Tap **Add to** your shop's **menu**. Then link it to Toast.

**Worth knowing**

- The app suggests the Toast item. Tap it, or search Toast's menu.
- Until it is linked, its sales do not count.
- The sandwich page shows its price, recipe, cost and Toast link.

#### 3. Swap a vendor (not shown)

**What to do** — Open the item. Tap **Swap vendor**. Pick the new item. Pick **Just for now** or **For good**. Tap **See what changes**. Check the recipes and costs. Tap **Swap it**.

**Worth knowing**

- Every recipe that used the old item switches at once.
- A "just for now" swap shows **Back to normal** on the item page.
- A recipe you changed after the swap stays as you left it.
- A swap never turns the old item off. Set the new item's par on its page.
```

- [ ] **Step 3: The Spanish section** — append to the end of `docs/guides/manager-guide.md`, after a blank line:

```markdown
#### Artículos nuevos, sándwiches nuevos y cambiar de proveedor

Lo nuevo que creas (artículos, recetas y sándwiches) empieza en tu tienda. Las otras tiendas no lo ven. Solo el Director de Operaciones lo comparte con todas las tiendas.

1. **Agrega un artículo nuevo.** Abre **Artículo nuevo** desde la página de administración. Elige qué es y a quién se lo compras. Escribe el nombre y el número del proveedor. Di cómo llega y escribe el precio. Toca **Crear artículo**. Después pon el par, los días de pedido, su lugar en la guía de pedido, dónde se usa y el código de barras. ¿Aún no tienes el proveedor? Toca **Agregar un proveedor nuevo**. Cada línea se guarda sola; puedes terminar después en la página del artículo.
2. **Agrega un sándwich nuevo.** Abre **Sándwich nuevo**. Escribe el nombre y el precio de tu tienda. Agrega cada ingrediente y mira el costo por sándwich. Toca **Agregar al menú** de tu tienda. Después vincúlalo con Toast: la app sugiere el artículo, o búscalo en el menú de Toast. Hasta que esté vinculado, sus ventas no cuentan.
3. **Cambia de proveedor.** Abre el artículo y toca **Cambiar de proveedor**. Elige el artículo nuevo y **Solo por ahora** o **Para siempre**. Toca **Ver qué cambia**, revisa las recetas y los costos, y toca **Cambiarlo**. Todas las recetas cambian a la vez. "Solo por ahora" muestra **Volver a lo normal** en la página del artículo; una receta que cambiaste después se queda como la dejaste.
```

- [ ] **Step 4: Run the guide tests** — `npx vitest run tests/guides-reading-level.test.ts tests/guides-v2-shape.test.ts tests/guides-markdown.test.ts` → expected: PASS. If a section reads above the grade the test allows, shorten the named longest sentences; never delete a fact to pass.

- [ ] **Step 5: Commit**

```bash
git add docs/guides/manager-guide.md
git commit -F - <<'EOF'
docs(guides): manager guide — new item, new sandwich with Toast, swap vendor (en + es)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 12: The law (AGENTS.md)

- [ ] **Step 1: Append to 4a's section `### Shop-only things and the guided jobs (0264–0265, catalog Phase 4a, 2026-10-15)`:**

```markdown
- **THE JOB PAGES (4b) CALL ONLY 4a's ROUTES, AT THE ROUTES' OWN TIERS.** `/admin/catalog/new/item` (an inline vendor through the directory's own route, Tier B; the create and each setup step, Tier E), `/admin/catalog/new/sandwich` (the live cost through `/jobs/new-sandwich/preview` behind 2b's `createRequestGuard`; the create, Tier E; then the Toast link, Tier A), `/admin/catalog/sku/[id]/swap` (preview → swap with the preview's token; any change drops the preview). Their views are `lib/catalog/jobs.ts` — fixed batch reads, gated first, and never offering another shop's own thing. **The Toast link of a sandwich lives on the sandwich** (the job and the menu-item page at a shop); Catering's Toast tab keeps packages, add-ons, assortments and unlinking. A shop-only sandwich's page is `OwnedSandwichClient` (its price, recipe, cost where sold, Toast link, Share).
- **A PREVIEW-BOUND PAGE SENDS BACK THE PREVIEW'S OWN REQUEST** (`preview.request` with its token) — never its own state, or its first confirmation is stale (Astra 4b r1). **A LIVE PREVIEW SHOWS PENDING ON EVERY CHANGE** (`liveCostOnDraftChange` / `liveCostOnAnswer`): the guard is invalidated on the change and on cleanup, and a refusal clears the number. The vendor's guide editor labels each shop's own line "Only at <shop>" (decision (b)).
- **EVERY WAY IN LEADS TO A JOB:** the hub cards, the costing board's "+ New sandwich", the legacy recipe list (New recipe — a GM's is its shop's own, `/admin/recipes/new` says which shop and sends it — and New sandwich), the legacy SKU form (a GM's new item must name its shop), the item page's Swap / Back to normal strip, the recipe page's "Only at" + Share. The Catering Toast tab is not touched (lead decision 6).
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -F - <<'EOF'
docs(agents): the guided job pages (catalog Phase 4b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 13: Final verification

- [ ] **Step 1: Full unit suite** — `npx vitest run` → every file passes, 0 failed (snapshot tests skipped).
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → exactly the 6 known Leaflet `TS2307` errors.
- [ ] **Step 3: Lint and build** — `npm run lint && npx next build` → lint clean; build succeeds.
- [ ] **Step 4: Sim browser walk (port 3100)** — `node scripts/sim/dev-sim.mjs`; phone (390×844), tablet (820×1180), desktop (1440×900), **en and es** (switch the user's language), as a GM of one shop, then as MoO:
  1. **Hub:** "New item" and "New sandwich" cards (GM, MoO); none for level 6.
  2. **New item (GM):** "Starts at <shop>" with no "Every shop" choice. Add a vendor inline (the Tier B prompt), pick it, name the item, item number, "1 case holds 6 bag; each bag weighs 5 lb", price → the summary line → **Create item** (Tier E). Then: par 2/3 → done; Mon + Thu, 1 day → done; a new guide section → done; use it in a shared recipe (the note says it becomes the shop's version) → done; barcode → "Learn it at the first delivery" (skipped). "Open the item page" shows "Only at <shop>". A second create with the same vendor number → the `item_number_taken` message. As MoO: the "Every shop" choice; the setup says to set it up at a shop.
  3. **New sandwich (GM):** add three lines (an oz line, an "each" line, a pack-label line); the cost per sandwich updates within a second of each change and with the price shows food cost and margin; remove a line → the cost follows; a line with an unpriced item → "At least …". **Add to the menu** → the Toast section with suggestions; search "club" → the list; link one (the Tier A prompt) → "Linked to: …". The costing board of that shop lists it; the other shop's does not. The sandwich page shows its price (editable by the GM), recipe link, cost and Toast link; as MoO, **Share with every shop** → the preview names the shop-only items that go with it → share → every shop's board lists it.
  4. **Swap vendor (GM):** from an item used in two recipes, **Swap vendor** → pick a replacement with a different case size → **Just for now** → **See what changes**: both recipes' lines (one "changed to ounces"), the sandwiches' costs before / after → **Swap it** (Tier E) → "Swapped" (+ the par note). The item page shows "… is swapped for … since …" → **Back to normal** → the preview → confirm → the costs return. As MoO: "For good, every shop" appears; a shop with its own version is named as keeping it.
  5. **Every way in:** the costing board's "+ New sandwich" link carries the shop; `/admin/recipes` as a GM shows "New recipe" and "New sandwich at your shop"; `/admin/recipes/new` as a GM says "New recipes you make start at <shop>", and the saved prep recipe opens on the recipe page with "Only at <shop>" (as MoO: **Share with every shop** → its preview names the items it makes → share); the other shop's walk and count sheet never show that shop's own SKU; the SKU form's add as a GM has no "Every shop" choice and needs a shop; Catering → Toast is unchanged; the catalog list shows the "Only at" badge on the sandwich.
  6. **Spanish:** every new string on these screens is Spanish (tú), none falls back to English; the error messages (try a taken name) too.
  7. **Round-1 checks:** a new-product swap's FIRST **Swap it** succeeds (no "things changed" message); type a different product name → the preview drops → **See what changes** → swap. On New sandwich, change a line while the cost is loading → "Working out the cost…" at once, never the old number; enter a refused quantity → the cost line says why, with no old cost left. On a vendor's page, a shop's own item shows "Only at <shop>" on its guide line and in the bucket. As a GM editing a recipe Shop A owns while the MoO shares it in another tab → the recipe page says it was shared and to reload.
- [ ] **Step 5: Open the PR** — title `feat(catalog): Phase 4b — New item, New sandwich + Toast link, Swap vendor pages; Share; Back to normal`; body links this plan and 4a, says "no migration", and ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
```

---

## Self-review against the spec

| Spec item | Where |
|---|---|
| §5 job 2 — what it is → vendor (pick, or add with order days inline) → name + number → how it arrives → price → par + order days → guide section → where used; barcode now or at first delivery | Task 5 (the inline vendor's order days are the "Order days" step right after the create — the vendor's rhythm is per shop) |
| §5 job 3 — replacement → just for now / for good → one product → every recipe → preview with cost changes → Back to normal | Task 7 (+ 4a Task 10) |
| §5 job 4 — name → price for my shop → recipe with live cost → Toast link (suggest; confirm or search) | Task 6 + Task 4's `ToastLinkSection` |
| §5 "Toast linking moves out of Catering" | Task 8 (every menu item at a shop); the Catering tab itself stays as it is (lead decision 6) |
| 2026-10-15 lead decisions 1, 3, 6 | a GM's legacy recipe is its shop's own and its page offers Share (Tasks 8, 9); the swap page says to set the new item's par (no par write); `ToastTab` untouched |
| §5 "each starts from the item page and wherever the problem first shows up … ends with the same preview and save choices" | Task 9; each job previews before its save (the new item's summary line, the live sandwich cost, the swap preview, Share's preview, Back to normal's preview) |
| §3 shop-only + MoO+ promote | the "Only at" badges, `ShareWithEveryShop` (Tasks 4, 7, 8, 9) |
| §8 UI walks phone / tablet / desktop, en + es | Task 13 Step 4 |

Placeholder scan: every step carries its code and command. Type consistency: `NewItemJobView`, `NewSandwichJobView`, `SwapJobView`, `OwnedSandwichView`, `ItemJobsStripView` (Task 2) are the props of Tasks 5–8's clients; 4a's shapes are imported by name.

## Judgment calls (4b)

1. **The inline vendor asks Tier B** (the vendor directory's tier) inside a job that otherwise asks Tier E — the same act keeps the same tier wherever it starts.
2. **Order days for a new vendor are the "Order days" setup step**, right after the create (a rhythm is per vendor *and* shop); the inline vendor form says so.
3. **The live cost is a debounced (350 ms) server preview**, not a client computation: THE costing rollup is server-side; every draft change invalidates the guard and shows "working it out" at once, so a late answer is dropped and never shown against the new draft (Astra 4b r1#9).
7. **The swap's product name lives outside the preview** (it appears once a preview says a new product will be made); editing it drops the preview, and the swap sends `preview.request` — the server's normalized copy — so the token always matches.
4. **A shop-only sandwich gets its own page body** (`OwnedSandwichClient`) instead of 3b's overlay editor (it has no overlay).
5. **The Toast link section shows on every menu item at a shop** (shared ones too); unlinking stays on Catering's Toast tab.
6. **The legacy SKU form's shop list is not filtered** for a GM (only "every shop" is withheld; another shop's name is refused by the server with its message) — filtering would thread a new prop through two clients and four render sites.

## Open questions (4b)

1. Should the New sandwich job also offer **"sold at other shops too"** for MoO (create as every shop's at once), or is create-at-a-shop then Share the one path?
2. Should the swap page offer **"Add a new item"** inline (the New item job as a step) rather than a link out and back?
