# Catalog Redesign — Phase 3 (Shop Versions: Recipes + Menu Items, Adopt / Promote) Implementation Plan

## Part 3b of 2 — the recipe and menu-item pages, the preview before save, adopt / promote / back to default, the Shop changes list, GM notices

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision r3 (2026-10-15)** answers Astra's round 2 (5 P2): scoped, serialized snapshots (lead decision (a)); only added / created lines are judged, carried broken lines are flagged, every refusal names its line (b); attributed hub readiness (c). Map at the end.

**Revision r2 (2026-10-15)** answers Astra's round-1 review of 3b (CHANGES REQUESTED, 9 P2) and carries the lead's decisions (L1 yields stay global · L2 catering untouched · L3 a shop's board margins use its overlay price · L4 every consumer reads the shop's resolved recipe — 3a Task 6b · L5 promote returns the source shop to the default, atomically · L6 GM-created shop-only recipes wait for Phase 4). **Rule:** the legacy builder's MoO-only line restriction (Task 11) ships with this part, never with 3a alone. The finding-by-finding map is at the end of this file.

**Goal:** Give every recipe and every menu item a connected page in the Catalog area — `/admin/catalog/recipe/[id]` and `/admin/catalog/menu-item/[id]` — in the shape 2b gave a bought item: what it is, which version you are seeing ("Global default" / "P Street's version · based on …"), a shop switcher, "How it connects", sections with their own edit, History with Restore, and **"What this changes" before every save**. On a recipe page a GM edits **their shop's version** line by line; a MoO edits the global default; anyone may **adopt** another shop's version as-is; a GM can go **back to the default**; a MoO can **promote** a shop's version to the default (the preview lists every shop on the default that will change and every shop left untouched). A menu item page sets this shop's price, whether it is sold here, and its name here. A **Shop changes** list (MoO+, Cristian) shows every shop version as it is made — what, where, who — with Promote or Leave. **GM notices** ("P Street updated this · take the update?", "this is the new default") are computed at read time, never swept. Every string ships en + es (tú); every control is 44px; the disclosure doctrine holds; phone / tablet / desktop.

**Architecture:**
- 3b is UI and orchestration over 3a's data layer (`docs/superpowers/plans/2026-10-15-catalog-phase3a-recipe-menu-versions-data.md`, merged with 0262/0263 applied). **3b adds no migration.**
- **One change model.** A page posts a `RecipeChangeRequest` (`lines` · `restore` · `back_to_default` · `adopt` · `promote`) or a `MenuChangeRequest` (`save` · `back_to_default` · `restore` · `promote`). The server computes the preview for exactly that change — the lines after, every affected scope's graph before and after (through 3a's `recipeOverrides`, so a hypothetical ingredient is resolved like a real one), the cost of every sandwich that moves, the shops left untouched — and a **token** (2b's `previewToken`). The preview takes 3a's **scoped dependency snapshot** (`loadRecipeChangeSnapshot(recipe, scope, lines)` / `loadMenuChangeSnapshot(item, scope)` — the change's dependency closure only, lead decision (a)) as soon as the set being written is known and before any number is computed, and the token binds the snapshot AND every number shown (costs, margins, reached / untouched / returned shops, flagged lines). Apply recomputes the preview, refuses `preview_stale` on any difference, then hands that same snapshot to 3a's gated writer, which takes the graph lock, the target row and the closure locks (NOWAIT) and only then re-takes it — `dependencies_changed` if anything moved, `dependencies_busy` if a dependency is being written right now — so nothing can change between the check and the commit (the 2b atomic-apply pattern, serialized). The SQL compare-and-set stays the real guard.
- **Adopt / promote** are thin lib functions over 3a's one writer (`writeRecipeVersion`), which copies the source version's lines IN SQL (validated like an edit). **Promote returns the source shop to the default** in the same transaction (lead decision 5): the preview names it ("P Street goes back to the default · its food stays the same"). A menu promote does the same for the promoted fields, and lists the shops that change **field by field**.
- **Notices** are pure (`computeRecipeNotices`) over the versions the server reads per request; "Keep mine" / "Got it" append a `recipe_notice_dismissals` row (0262) for the version seen **in the state seen** (`source_changed` live · `source_retired` retired · `new_default`), so the next change — or the same version's retirement, including the source going back to the default with no newer save — raises it again.
- **The legacy builder** (`/admin/recipes/[id]`) stops editing lines globally for a GM: `addRecipeInput` / `updateRecipeInput` / `removeRecipeEdge(recipe_inputs)` become MoO+ (`global_requires_moo`, en + es), and the page links to the shop-version page. Recipe creation, outputs, yields, batch mode and the header keep their current floors (versions cover the lines). **This restriction ships here, with the pages that replace it — never in 3a alone.**
- **Every read of a version line set is paged and id-chunked** (the Shop changes list, the notices read, the page's history and source versions), so nothing truncates at the PostgREST 1000-row cap. "Used in" on the recipe page comes from the scope-resolved graph. A line editor holding a draft keeps "What goes in" mounted and locked open (D10). The menu form resets to the committed row after every refresh.

**Tech Stack:** Next.js 16.2.4 App Router (page `params`/`searchParams` are Promises), React 19.2.4, TypeScript strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, Supabase (service role), vitest 4 (node env; UI tests render with `react-dom/server`; no jsdom).

**Spec:** `docs/superpowers/specs/2026-10-15-catalog-redesign-design.md` §3 (adopt, promote, back to default, history), §4 (the item page shape, the preview, History + Restore, passwords, screens), §6 (Shop changes list, GM notices), §8 (UI walks).

**Working copy:** `C:\Users\conta\co-ops-guides`, on a branch from `origin/main` after 3a has merged:

```bash
git fetch origin && git checkout -b feat/catalog-phase3b-recipe-menu-pages origin/main
ls supabase/migrations | tail -2
```

Expected: `0262_recipe_shop_versions.sql` and `0263_menu_item_shop_settings.sql` are the last two files, and both carry an `APPLIED TO PROD` stamp (3a Task 12 Step 8).

**Standing rules for every task:**
- Read `AGENTS.md` first; its "Recipe and menu-item shop versions" section came with 3a.
- Sim only (port 3100). 3b applies no migration.
- Every new string ships en + es, tú Spanish. Every control is at least 44px with `items-center`. Token roles only. Disclosure state is `useState` only.
- Every commit ends with the two trailer lines shown.
- The pins stay green: `npx vitest run tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts`.

**Step-up:** every write on these pages asks **Tier E** (the 15-minute catalog edit window). **No act here takes a one-shot grant** — save, restore, back to default, adopt and promote all keep every row, so each is reversible (Restore / a new save). Previews are reads (no step-up). "Keep mine" / "Got it" on a notice changes no food: it takes the session, the GM floor, the shop bind and a same-origin check, not a password.

---

## Ground truth this plan is built on (verified 2026-10-15 against `main` @ 2e59def7, plus 3a / 2a / 2b as planned)

| Fact | Where |
|---|---|
| **3a contract:** `lib/recipe-versions-shared.ts` — `RecipeVersionRow`, `RecipeVersionLineRow`, `LiveRecipeLine { lineId, fields }`, `RecipeLineOp`, `applyRecipeLineOp`, `parseRecipeLineOp`, `diffRecipeLineSets` → `RecipeLineChange { kind, key, before, after }`, `recipeLineTargetKey`, `recipeVersionWriteGate`, `RECIPE_SHOP_WRITE_MIN = 7`, `RECIPE_GLOBAL_WRITE_MIN = 8`. `lib/admin/recipe-versions.ts` — `RecipeVersionError`, `loadRecipeLiveSet(recipeId, scope)` → `{ scopeVersionId, globalVersionId, ridesDefault, lines, recipeActive, recipeName }`, `writeRecipeVersion(actor, { …, lines: null + restoredFrom/adoptedFrom/promotedFrom, snapshot })` (validates every line it writes, copied sets included; audits `recipe_version.save/adopt/promote`; returns `returnedShop` on promote), `saveRecipeLines` / `restoreRecipeVersion` / `retireShopRecipeVersion` (each takes an optional `snapshot`; absent = taken at the start of the call), `loadRecipeChangeSnapshot(recipeId, scope, lines)`, `RecipeChangeSnapshot`, `loadRecipeVersionHistory(actor, recipeId, scope, { allShops })` (paged). `lib/prep-consumption.ts` — `loadResolvedRecipeInputs(scope, asOf?)`, `loadRecipeInputsAcrossScopes()` (3a Task 6b). `lib/menu-item-shop-shared.ts` — `resolveMenuItemForShop`, `parseMenuShopPatch`, `menuShopWriteGate`, `menuPromoteGate`, `MENU_SHOP_WRITE_MIN = 7`; `lib/menu-item-shop.ts` — `loadLiveMenuItemShopSettings(shopId)`, `MENU_SHOP_SETTING_COLUMNS`; `lib/admin/menu-item-shop.ts` — `MenuShopError`, `menuShopErrorFromRpc`, `loadMenuChangeSnapshot(menuItemId, locationId)`, `MenuChangeSnapshot`, `saveMenuItemShopSetting` / `restoreMenuItemShopSetting` / `retireMenuItemShopSetting` (optional `snapshot`), `loadMenuItemShopHistory` (paged). `loadRecipeGraph({ locationId, versionLocationId, asOf, recipeOverrides })`. Audit names registered in 3a: `recipe_version.save/retire/adopt/promote`, `menu_item.shop_setting_save/retire/promote`. SQL: `save_recipe_version(…, p_restored_from, p_adopted_from, p_promoted_from, p_snapshot)` copies the source IN SQL, applies the product rule to every line, re-checks the scoped `recipe_change_snapshot` under the graph lock and the closure locks (`dependencies_changed`, `dependencies_busy`), refuses an ADDED invalid product line as `product_line_invalid:<position>`, and on promote retires the source in the same transaction (returns `returned_shop`); `promote_menu_item_shop_setting(p_setting, p_fields, p_expected_price, p_expected_name, p_expected_name_es, p_actor, p_snapshot)` (field-by-field `changed_shops`, the source returns for the promoted fields); `recipe_notice_dismissals (location_id, recipe_id, kind 'source_changed'|'source_retired'|'new_default', seen_version_id)` unique on all four, service_role SELECT/INSERT. | 3a plan Tasks 2–10 |
| **2a/2b contract:** `catalogShopAllowed`, `assertScopeToken`, `VersionScope` (`lib/sku-versions-shared.ts`); `loadCurrentSkuPrices(ids, scope)`; `costPerOzFromGraph` (`lib/admin/menu-costing.ts:83` as merged — 3b imports it from there, which stays valid whether or not 2b moves it); merged 2a's `createDatedGraphs` caches per pack interval and 3a cuts those intervals at recipe boundaries too; `NIL_SCOPE` (`lib/sku-versions-shared.ts:30`) = "the global view alone" for a menu promote's snapshot; `previewToken(parts)` (`lib/catalog/change-preview-shared.ts`); `createRequestGuard` (`lib/catalog/request-guard-shared.ts`); `SHOP_PARAMS_BY_PREFIX` already carries `["/admin/catalog/sku/", ["location"]]`; `resolveShopId(allowed, explicit)` (`lib/shop-context.ts`). | 2a Tasks 2, 6, 6b; 2b Tasks 1, 2, 4, 10 |
| `rollupMenuItemCost(graph, menuItemId, costPerOz)` → `{ status, cost }`; `rollupItemCost(graph, itemId, costPerOz)`. | `lib/menu-costing-shared.ts:498-520` |
| The Phase 1 line editor: `RecipeLineEditor({ title, submitLabel, options, skus, products, measures: Map, activeMeasureLabels, initial: RecipeLineDraft | null, busy, errorMsg, onSubmit, onCancel })`; `buildIngredientOptions({ skus, items, products })`; the picker universe loader `loadRecipeBuilderCatalog()` → `{ skus: RecipeBuilderSku[], items, products: RecipeBuilderProduct[], unitOptions, measures: Map, activeMeasureLabels }`. | `components/admin/recipes/RecipeLineEditor.tsx:30-58`; `lib/ingredient-picker-shared.ts:39-51`; `lib/admin/recipe-builder-data.ts:17-90` |
| The legacy recipe page renders `<RecipeBuilder … />` inside `return (\n    <div>`; the builder's error strings resolve through `KNOWN_ERROR_CODES` → `recipes.error.<code>`. Legacy line routes assert Tier E. | `app/admin/recipes/[id]/page.tsx:20-80`; `components/admin/recipes/shared.ts:9-50`; `tests/step-up-tier-map.test.ts:98-106` |
| `lib/recipes.ts`: `addRecipeInput` `:579`, `updateRecipeInput` `:630`, `removeRecipeEdge` `:756` (after 3a, inputs go through `remove_recipe_input_atomic`); the shared `requireLevel(actor, min)` throws `RecipeError(403, "forbidden")`. | `lib/recipes.ts:52-54` |
| The costing board client renders each row's drawer with `<RowDrawer\n                      row={row}\n                      skuNames={skuNames}`; drawer links use `drawerLinkCls`. | `components/admin/menu-costing/MenuCostingClient.tsx:60, 229-236` |
| The admin hub cards come from `ADMIN_SECTIONS` (`id, i18nKey, href, minLevel`). | `lib/admin/sections.ts:31-70` |
| UI primitives: `CollapsibleSection({ idBase, title, count, badge, open, onToggle, children })`, `SummaryRow({ summary, badges, expanded, onToggle, toggleLabel, drawerId, children })`, `PageHeader({ title, subtitle, children })`; `useStepUp().requestStepUp("E")`, `useStepUpPost()`, `postJson`; `formatDateLabel`, `formatQuantity`; `serverT(lang, key, params)`; `auth.user.language`; `ROLES[role].level`. | `components/ui/*`; `components/admin/StepUpProvider`; `components/admin/useStepUpPost.ts:16`; `components/admin/vendors/shared.ts:20`; `lib/i18n/format.ts:138, 242` |
| `assertSameOrigin(req)` returns a 403 `NextResponse` or null. | `lib/portal/csrf.ts:18` |
| The manager guide and its three guide tests. | `docs/guides/manager-guide.md`; `tests/guides-reading-level.test.ts`, `tests/guides-v2-shape.test.ts`, `tests/guides-markdown.test.ts` |

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/catalog/recipe-item-shared.ts`, `tests/recipe-item-shared.test.ts` | create | View models, deep links, the version label, the client key, the two change-request unions and their parsers. |
| `lib/catalog/recipe-preview-shared.ts`, `tests/recipe-preview-shared.test.ts` | create | Pure "What this changes": sandwich cost deltas, the line text, the menu preview math, the tokens. |
| `lib/catalog/recipe-notices-shared.ts`, `tests/recipe-notices-shared.test.ts` | create | Pure read-time notices (source changed / gone; new default). |
| `lib/admin/recipe-versions.ts`, `lib/admin/menu-item-shop.ts`, `lib/audit-actions.ts`, `tests/recipe-adopt-promote-permissions.test.ts` | modify / create | `adoptRecipeVersion`, `promoteRecipeVersion`, `dismissRecipeNotice`, `promoteMenuItemShopSetting`; `recipe_version.notice_dismiss`. |
| `lib/catalog/recipe-item.ts`, `lib/catalog/menu-item-page.ts`, `lib/catalog/shop-changes.ts`, `tests/catalog-recipe-server.test.ts` | create | Page views, previews, apply-with-token, the Shop changes list, the notices read. |
| `app/api/admin/catalog/recipe/[id]/{preview, apply, notices/dismiss}/route.ts`, `app/api/admin/catalog/menu-item/[id]/{preview, apply}/route.ts`, `tests/catalog-recipe-routes.test.ts` | create | Read previews; Tier E applies; the notice answer. |
| `lib/i18n/en.json`, `lib/i18n/es.json`, `tests/catalog-recipe-i18n.test.ts` | modify / create | Every string. |
| `components/catalog/RecipePreviewPanel.tsx`, `components/catalog/RecipeItemClient.tsx`, `app/admin/catalog/recipe/[id]/page.tsx` | create | The recipe page. |
| `components/catalog/MenuItemClient.tsx`, `app/admin/catalog/menu-item/[id]/page.tsx` | create | The menu item page. |
| `components/catalog/ShopChangesClient.tsx`, `app/admin/catalog/shop-changes/page.tsx`, `components/catalog/RecipeNoticesClient.tsx`, `app/admin/catalog/notices/page.tsx` | create | The Shop changes list (MoO+) and the GM notices. |
| `tests/catalog-recipe-ui.test.ts`, `tests/catalog-recipe-navigation.test.ts` | create | Render and navigation pins. |
| `lib/shop-context-shared.ts`, `lib/admin/sections.ts` | modify | The pages' `?location=` param; two hub cards. |
| `lib/recipes.ts`, `components/admin/recipes/shared.ts`, `app/admin/recipes/[id]/page.tsx`, `components/admin/menu-costing/MenuCostingClient.tsx`, `tests/legacy-recipe-line-boundary.test.ts` | modify / create | The legacy builder's line writes become MoO+; links into the new pages. |
| `tests/step-up-tier-map.test.ts` | modify | Register the two applies and the three clients that ask Tier E (3a already registered every table, RPC and lib file with the location-bind check). |
| `docs/guides/manager-guide.md` | modify | Guide text for the changed screens (en + es; photos in the one pass after Phase 5). |
| `AGENTS.md` | modify | The adopt / promote / notices law. |

---

## Task 1: The pages' shared surface — view models, links, labels, change requests

**Files:**
- Create: `lib/catalog/recipe-item-shared.ts`
- Modify: `lib/shop-context-shared.ts`, `lib/recipe-line-shared.ts` (a chained SKU offers its chain's labels)
- Test: `tests/recipe-item-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 3b — the recipe / menu-item pages' pure surface. */
import { describe, expect, it } from "vitest";
import {
  menuFormRevision, menuItemPageHref, noticesHref, pageClientKey, parseMenuChange, parseRecipeChange, recipeChangeTarget,
  recipeItemHref, recipeVersionLabel, scopedPickerSkus, lineEditStale,
} from "@/lib/catalog/recipe-item-shared";
import { shopParamNames } from "@/lib/shop-context-shared";
import { ozForRecipeInput } from "@/lib/recipe-math";
import { lineUnitChoices } from "@/lib/recipe-line-shared";

const R = "7d0c1f2e-0000-4000-8000-000000000001";
const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const V = "7d0c1f2e-0000-4000-8000-0000000000aa";
const SKU = "7d0c1f2e-0000-4000-8000-000000000002";

describe("links land on the item", () => {
  it("recipe, menu item, notices — plain, per shop, global", () => {
    expect(recipeItemHref(R)).toBe(`/admin/catalog/recipe/${R}`);
    expect(recipeItemHref(R, { shopId: SHOP })).toBe(`/admin/catalog/recipe/${R}?location=${SHOP}`);
    expect(recipeItemHref(R, { shopId: null })).toBe(`/admin/catalog/recipe/${R}?location=global`);
    expect(menuItemPageHref(R, { shopId: SHOP })).toBe(`/admin/catalog/menu-item/${R}?location=${SHOP}`);
    expect(noticesHref(SHOP)).toBe(`/admin/catalog/notices?location=${SHOP}`);
  });
  it("the shop switcher's param is declared for both pages and the notices list", () => {
    expect(shopParamNames(`/admin/catalog/recipe/${R}`)).toEqual(["location"]);
    expect(shopParamNames(`/admin/catalog/menu-item/${R}`)).toEqual(["location"]);
    expect(shopParamNames("/admin/catalog/notices")).toEqual(["location"]);
  });
  it("the client remounts per (kind, item, shop)", () => {
    expect(pageClientKey("recipe", R, SHOP)).not.toBe(pageClientKey("recipe", R, null));
    expect(pageClientKey("recipe", R, null)).not.toBe(pageClientKey("menu", R, null));
  });
  it("the menu form's revision moves with every committed change — back to default included (Astra 3b r1#6)", () => {
    const item = { id: R, name: "Italian", nameEs: "Italiano", menuPrice: 12.5, section: "Subs" };
    const own = { settingId: "s1", price: 13.5, soldHere: false, nameOverride: null, nameOverrideEs: null, name: "Italian", nameEs: "Italiano", typedPrice: 13.5 };
    const back = { ...own, settingId: null, price: null, soldHere: true, typedPrice: 12.5 };
    expect(menuFormRevision({ item, here: own })).not.toBe(menuFormRevision({ item, here: back }));
    expect(menuFormRevision({ item, here: own })).toBe(menuFormRevision({ item, here: { ...own } }));
    expect(menuFormRevision({ item: { ...item, menuPrice: 14 }, here: back })).not.toBe(menuFormRevision({ item, here: back }));
  });
});

describe("what the header says", () => {
  it("global, a shop on the default, a shop's own, a shop's adopted copy", () => {
    expect(recipeVersionLabel({ scope: null, scopeName: null, hasOwn: false, adoptedFromShopName: null })).toEqual({ kind: "global" });
    expect(recipeVersionLabel({ scope: SHOP, scopeName: "P Street", hasOwn: false, adoptedFromShopName: null })).toEqual({ kind: "shop_default", shop: "P Street" });
    expect(recipeVersionLabel({ scope: SHOP, scopeName: "P Street", hasOwn: true, adoptedFromShopName: null })).toEqual({ kind: "shop_own", shop: "P Street" });
    expect(recipeVersionLabel({ scope: SHOP, scopeName: "P Street", hasOwn: true, adoptedFromShopName: "Capitol Hill" })).toEqual({ kind: "shop_adopted", shop: "P Street", from: "Capitol Hill" });
  });
});

describe("parseRecipeChange — the five recipe acts", () => {
  const line = { componentSkuId: SKU, quantity: 5, unit: "oz" };
  it("lines (shop or global), restore, back to default, adopt, promote", () => {
    expect(parseRecipeChange({ kind: "lines", target: { kind: "shop", shopId: SHOP }, op: { kind: "add", line } })).toMatchObject({ ok: true, change: { kind: "lines" } });
    expect(parseRecipeChange({ kind: "lines", target: { kind: "global" }, op: { kind: "add", line } })).toMatchObject({ ok: true });
    expect(parseRecipeChange({ kind: "restore", target: { kind: "shop", shopId: SHOP }, fromVersionId: V })).toMatchObject({ ok: true, change: { kind: "restore", fromVersionId: V } });
    expect(parseRecipeChange({ kind: "back_to_default", shopId: SHOP })).toEqual({ ok: true, change: { kind: "back_to_default", shopId: SHOP } });
    expect(parseRecipeChange({ kind: "adopt", shopId: SHOP, sourceVersionId: V })).toEqual({ ok: true, change: { kind: "adopt", shopId: SHOP, sourceVersionId: V } });
    expect(parseRecipeChange({ kind: "promote", sourceVersionId: V })).toEqual({ ok: true, change: { kind: "promote", sourceVersionId: V } });
  });
  it("refuses an unknown kind, a non-uuid id, a bad target, a bad line", () => {
    expect(parseRecipeChange({ kind: "delete" })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeChange({ kind: "adopt", shopId: "x", sourceVersionId: V })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeChange({ kind: "lines", target: { kind: "elsewhere" }, op: { kind: "add", line } })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeChange({ kind: "lines", target: { kind: "global" }, op: { kind: "add", line: { componentSkuId: SKU, quantity: -1 } } })).toEqual({ ok: false, code: "invalid_quantity" });
  });
  it("the save target of each act", () => {
    expect(recipeChangeTarget({ kind: "back_to_default", shopId: SHOP })).toEqual({ kind: "shop", shopId: SHOP });
    expect(recipeChangeTarget({ kind: "adopt", shopId: SHOP, sourceVersionId: V })).toEqual({ kind: "shop", shopId: SHOP });
    expect(recipeChangeTarget({ kind: "promote", sourceVersionId: V })).toEqual({ kind: "global" });
  });
});

describe("parseMenuChange — the four menu acts", () => {
  it("save, back to default, restore, promote", () => {
    expect(parseMenuChange({ kind: "save", shopId: SHOP, patch: { price: 13.5, soldHere: true } })).toEqual({ ok: true, change: { kind: "save", shopId: SHOP, patch: { price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null } } });
    expect(parseMenuChange({ kind: "back_to_default", shopId: SHOP })).toMatchObject({ ok: true });
    expect(parseMenuChange({ kind: "restore", shopId: SHOP, fromSettingId: V })).toMatchObject({ ok: true });
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["price"] })).toEqual({ ok: true, change: { kind: "promote", settingId: V, fields: ["price"] } });
  });
  it("refuses a promote of sold-here, an empty field list, a bad price", () => {
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: ["sold_here"] })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseMenuChange({ kind: "promote", settingId: V, fields: [] })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseMenuChange({ kind: "save", shopId: SHOP, patch: { price: -2, soldHere: true } })).toEqual({ ok: false, code: "invalid_menu_price" });
  });
});

describe("an open edit keeps its baseline across a refresh (Astra 3b r5#1)", () => {
  const seen = { componentSkuId: "s1", componentItemId: null, componentProductId: null, quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false };
  it("a changed line under the edit is stale; the same line is not", () => {
    expect(lineEditStale(seen, { ...seen })).toBe(false);
    expect(lineEditStale(seen, { ...seen, quantity: 5 })).toBe(true);
  });
});

describe("the picker speaks the SHOP's pack (Astra 3b r4#1)", () => {
  const measures = new Map([["lb", { dimension: "weight" as const, toBaseFactor: 16 }]]);
  const sku = { id: "s1", name: "Turkey", vendorName: null, packFormat: "case", eachContainerLabel: null, unitsPerPack: 1, eachSize: 30, eachMeasure: "lb", avgOzPerEach: null };
  const caseOf = (lb: number, label = "case") => [{ id: "c", label, containsQty: lb, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }];
  it("the shop's 40 lb case converts to 640 oz in the editor where the default's 30 lb gives 480 — the numbers the preview uses", () => {
    const [shop] = scopedPickerSkus([sku], new Map([["s1", { levels: caseOf(40) }]]));
    const [global] = scopedPickerSkus([sku], new Map([["s1", { levels: caseOf(30) }]]));
    expect(ozForRecipeInput(1, "case", shop!, measures)).toBe(640);
    expect(ozForRecipeInput(1, "case", global!, measures)).toBe(480);
    expect(scopedPickerSkus([sku], new Map())[0]!.packChain).toBeNull(); // no chain → the flat fields, as before
  });
  it("the shop's own container labels are the ones offered", () => {
    const [shop] = scopedPickerSkus([sku], new Map([["s1", { levels: caseOf(40, "crate") }]]));
    const choices = lineUnitChoices("sku", shop!, ["oz", "lb"], null);
    expect(choices).toContain("crate");
    expect(choices).not.toContain("case");
    expect(lineUnitChoices("sku", sku, ["oz", "lb"], null)).toContain("case"); // unchained: the flat labels, unchanged
  });
});
```

Run: `npx vitest run tests/recipe-item-shared.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `lib/catalog/recipe-item-shared.ts`**

```ts
/**
 * The connected pages for a RECIPE and a MENU ITEM — the client-safe surface (catalog Phase 3b; spec §3,
 * §4, §6). View models the server fills (lib/catalog/recipe-item.ts, lib/catalog/menu-item-page.ts,
 * lib/catalog/shop-changes.ts) and the clients render; the deep links; what the version label says; and
 * the change requests a page may post, with the parsers the routes use.
 */
import type { RecipeLineFields } from "@/lib/recipe-line-shared";
import { parseRecipeLineOp, type RecipeLineChange, type RecipeLineOp } from "@/lib/recipe-versions-shared";
import { parseMenuShopPatch, type MenuShopPatch } from "@/lib/menu-item-shop-shared";
import type { RecipeNotice } from "@/lib/catalog/recipe-notices-shared";
import type { RecipeBuilderProduct, RecipeBuilderSku } from "@/components/admin/recipes/RecipeBuilder";
import type { PackChainLevel } from "@/lib/pack-chain-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// ── Links ─────────────────────────────────────────────────────────────────────

function withShop(path: string, shopId: string | null | undefined): string {
  if (shopId === undefined) return path;
  return `${path}?location=${shopId === null ? "global" : encodeURIComponent(shopId)}`;
}
/** The recipe page; `shopId` null = the global default, undefined = the remembered shop. */
export function recipeItemHref(recipeId: string, opts: { shopId?: string | null } = {}): string {
  return withShop(`/admin/catalog/recipe/${encodeURIComponent(recipeId)}`, opts.shopId);
}
export function menuItemPageHref(menuItemId: string, opts: { shopId?: string | null } = {}): string {
  return withShop(`/admin/catalog/menu-item/${encodeURIComponent(menuItemId)}`, opts.shopId);
}
export const SHOP_CHANGES_HREF = "/admin/catalog/shop-changes";
export function noticesHref(shopId?: string | null): string {
  return withShop("/admin/catalog/notices", shopId);
}

/** A same-route shop switch remounts the page body (2b: useState survives a navigation otherwise). */
/**
 * The shop whose recipe this History row's version STOPPED following, from what 0262 recorded on it
 * (`adoption_ended_from_version_id`: the replaced version on a restore's row, the row itself on a Back-to-default
 * retirement) — never inferred from based_on (Astra r7). Returns that source shop's id, or null.
 */
export function historyLinkEndedSource(
  v: { adoptionEndedFromVersionId: string | null },
  byId: ReadonlyMap<string, { locationId: string | null; adoptedFromVersionId: string | null }>,
): string | null {
  if (!v.adoptionEndedFromVersionId) return null;
  const ended = byId.get(v.adoptionEndedFromVersionId);
  const source = ended?.adoptedFromVersionId ? byId.get(ended.adoptedFromVersionId) : undefined;
  return source?.locationId ?? null;
}

/** Has the line changed under an open edit since its baseline was captured? (Astra 3b r5#1.) */
export function lineEditStale(expected: RecipeLineFields, current: RecipeLineFields): boolean {
  const key = (f: RecipeLineFields) => JSON.stringify([f.componentSkuId, f.componentItemId, f.componentProductId, f.quantity,
    f.unit ?? null, f.eachContainerLabel ?? null, f.portioned]);
  return key(expected) !== key(current);
}

/**
 * THE PICKER SPEAKS THE SHOP'S PACK (Astra 3b r4#1): each SKU carries the chain this scope resolves (2a's one
 * resolver — the shop's own pack version, else the default's), so the line editor's unit choices (the chain's
 * labels) and its ounce conversion (ozForRecipeInput walks the chain first) are the ones the preview and the
 * graph use. No resolved chain = the SKU's flat fields, exactly as before.
 */
export function scopedPickerSkus<S extends { id: string }>(
  skus: readonly S[],
  packs: ReadonlyMap<string, { levels: PackChainLevel[] }>,
): Array<S & { packChain: PackChainLevel[] | null }> {
  return skus.map((s) => {
    const levels = packs.get(s.id)?.levels ?? [];
    return { ...s, packChain: levels.length > 0 ? levels : null };
  });
}

export function pageClientKey(kind: "recipe" | "menu", id: string, scope: string | null): string {
  return `${kind}:${id}:${scope ?? "global"}`;
}

/**
 * The COMMITTED revision of a menu item page's form (Astra 3b r1#6): this shop's live row and the global
 * values it inherits. MenuItemClient resets its fields whenever this moves (a save, Back to default,
 * Restore, a promote), so a retired price or "not sold here" never rides into the next save.
 */
export function menuFormRevision(view: Pick<MenuItemPageView, "item" | "here">): string {
  const h = view.here;
  return JSON.stringify([h.settingId, h.price, h.soldHere, h.nameOverride, h.nameOverrideEs, view.item.menuPrice, view.item.name, view.item.nameEs]);
}

// ── What the header says ──────────────────────────────────────────────────────

export type RecipeVersionLabel =
  | { kind: "global" }
  | { kind: "shop_default"; shop: string }
  | { kind: "shop_own"; shop: string }
  | { kind: "shop_adopted"; shop: string; from: string };

export function recipeVersionLabel(input: { scope: string | null; scopeName: string | null; hasOwn: boolean; adoptedFromShopName: string | null }): RecipeVersionLabel {
  if (input.scope === null) return { kind: "global" };
  const shop = input.scopeName ?? "";
  if (!input.hasOwn) return { kind: "shop_default", shop };
  return input.adoptedFromShopName ? { kind: "shop_adopted", shop, from: input.adoptedFromShopName } : { kind: "shop_own", shop };
}

// ── Change requests ───────────────────────────────────────────────────────────

export type RecipeTarget = { kind: "shop"; shopId: string } | { kind: "global" };

export type RecipeChangeRequest =
  | { kind: "lines"; target: RecipeTarget; op: RecipeLineOp }
  | { kind: "restore"; target: RecipeTarget; fromVersionId: string }
  | { kind: "back_to_default"; shopId: string }
  | { kind: "adopt"; shopId: string; sourceVersionId: string }
  | { kind: "promote"; sourceVersionId: string };

export type ChangeParse<T> = { ok: true; change: T } | { ok: false; code: string };

function parseTarget(raw: unknown): RecipeTarget | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === "global") return { kind: "global" };
  if (t.kind === "shop" && isUuid(t.shopId)) return { kind: "shop", shopId: t.shopId };
  return null;
}

export function parseRecipeChange(raw: unknown): ChangeParse<RecipeChangeRequest> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const b = raw as Record<string, unknown>;
  switch (b.kind) {
    case "lines": {
      const target = parseTarget(b.target);
      if (!target) return { ok: false, code: "invalid_payload" };
      const op = parseRecipeLineOp(b.op);
      if (!op.ok) return { ok: false, code: op.code };
      return { ok: true, change: { kind: "lines", target, op: op.op } };
    }
    case "restore": {
      const target = parseTarget(b.target);
      if (!target || !isUuid(b.fromVersionId)) return { ok: false, code: "invalid_payload" };
      return { ok: true, change: { kind: "restore", target, fromVersionId: b.fromVersionId } };
    }
    case "back_to_default":
      return isUuid(b.shopId) ? { ok: true, change: { kind: "back_to_default", shopId: b.shopId } } : { ok: false, code: "invalid_payload" };
    case "adopt":
      return isUuid(b.shopId) && isUuid(b.sourceVersionId)
        ? { ok: true, change: { kind: "adopt", shopId: b.shopId, sourceVersionId: b.sourceVersionId } }
        : { ok: false, code: "invalid_payload" };
    case "promote":
      return isUuid(b.sourceVersionId) ? { ok: true, change: { kind: "promote", sourceVersionId: b.sourceVersionId } } : { ok: false, code: "invalid_payload" };
    default:
      return { ok: false, code: "invalid_payload" };
  }
}

/** Where an act saves: back to default and adopt are a shop's; promote is everyone's. */
export function recipeChangeTarget(c: RecipeChangeRequest): RecipeTarget {
  if (c.kind === "lines" || c.kind === "restore") return c.target;
  if (c.kind === "promote") return { kind: "global" };
  return { kind: "shop", shopId: c.shopId };
}

export type MenuPromoteField = "price" | "name";
export type MenuChangeRequest =
  | { kind: "save"; shopId: string; patch: MenuShopPatch }
  | { kind: "back_to_default"; shopId: string }
  | { kind: "restore"; shopId: string; fromSettingId: string }
  | { kind: "promote"; settingId: string; fields: MenuPromoteField[] };

export function parseMenuChange(raw: unknown): ChangeParse<MenuChangeRequest> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const b = raw as Record<string, unknown>;
  switch (b.kind) {
    case "save": {
      if (!isUuid(b.shopId)) return { ok: false, code: "invalid_payload" };
      const p = parseMenuShopPatch(b.patch);
      return p.ok ? { ok: true, change: { kind: "save", shopId: b.shopId, patch: p.patch } } : { ok: false, code: p.code };
    }
    case "back_to_default":
      return isUuid(b.shopId) ? { ok: true, change: { kind: "back_to_default", shopId: b.shopId } } : { ok: false, code: "invalid_payload" };
    case "restore":
      return isUuid(b.shopId) && isUuid(b.fromSettingId)
        ? { ok: true, change: { kind: "restore", shopId: b.shopId, fromSettingId: b.fromSettingId } }
        : { ok: false, code: "invalid_payload" };
    case "promote": {
      const fields = Array.isArray(b.fields) ? b.fields : [];
      const ok = fields.length > 0 && fields.length <= 2 && fields.every((f) => f === "price" || f === "name") && new Set(fields).size === fields.length;
      return ok && isUuid(b.settingId)
        ? { ok: true, change: { kind: "promote", settingId: b.settingId, fields: fields as MenuPromoteField[] } }
        : { ok: false, code: "invalid_payload" };
    }
    default:
      return { ok: false, code: "invalid_payload" };
  }
}

// ── View models ───────────────────────────────────────────────────────────────

export interface RecipeLineView {
  lineId: string;
  fields: RecipeLineFields;
  name: string;
  kind: "sku" | "item" | "product";
  vendorName: string | null;
  /** A shop version's line that differs from (or is absent in) the global default. */
  changedHere: boolean;
  /** Why this saved line would not pass an add today (lead decision (b): FLAGGED, may stay until fixed), or null. */
  problem: "invalid_component_product" | "product_line_needs_measure_unit" | null;
}

export interface RecipeItemView {
  recipe: { id: string; name: string; nameEs: string | null; recipeType: "production" | "consumer"; active: boolean };
  shops: Array<{ id: string; name: string }>;
  scope: string | null;
  scopeName: string | null;
  can: { editShop: boolean; editGlobal: boolean };
  version: {
    scopeVersionId: string | null;
    globalVersionId: string | null;
    ridesDefault: boolean;
    adoptedFromShopName: string | null;
    validFrom: string | null;
  };
  lines: RecipeLineView[];
  /** A shop with its own version: how it differs from today's global default. */
  differsFromDefault: RecipeLineChange[];
  makes: Array<{ kind: "menu_item" | "item"; id: string; name: string; nameEs: string | null; yield: number; costHere: number | null }>;
  usedIn: Array<{ id: string; name: string }>;
  vendors: string[];
  otherShopVersions: Array<{ versionId: string; shopId: string; shopName: string; validFrom: string; createdByName: string | null; changes: RecipeLineChange[] }>;
  notices: RecipeNotice[];
  history: Array<{
    id: string; scope: "global" | "shop"; shopName: string | null; active: boolean; validFrom: string; validTo: string | null;
    who: string | null; note: string | null; lineCount: number; promotedFromShopName: string | null; adoptedFromShopName: string | null;
    /** This version ENDED the link to that shop's recipe (a restore from before the adoption). */
    linkEndedFromShopName: string | null;
  }>;
  /** recipeLineTargetKey → display name, for the line changes. */
  names: Record<string, string>;
  picker: {
    skus: RecipeBuilderSku[];
    items: Array<{ id: string; name: string }>;
    products: RecipeBuilderProduct[];
    measures: Array<{ label: string; dimension: "weight" | "volume" | "count"; toBaseFactor: number }>;
    activeMeasureLabels: string[];
  };
}

export interface MenuItemPageView {
  item: { id: string; name: string; nameEs: string | null; menuPrice: number | null; section: string | null };
  shops: Array<{ id: string; name: string }>;
  scope: string | null;
  scopeName: string | null;
  can: { editShop: boolean };
  here: {
    settingId: string | null; price: number | null; soldHere: boolean; nameOverride: string | null; nameOverrideEs: string | null;
    name: string; nameEs: string | null; typedPrice: number | null;
  };
  cost: number | null;
  recipe: { id: string; name: string } | null;
  toastLinks: number;
  history: Array<{ id: string; active: boolean; validFrom: string; validTo: string | null; who: string | null; price: number | null; soldHere: boolean; nameOverride: string | null; nameOverrideEs: string | null }>;
}
```

- [ ] **Step 2b: A chained SKU offers its chain's labels (`lib/recipe-line-shared.ts`)** — the shop's own container units reach the line editor (Astra 3b r4#1). In `lineUnitChoices` AND `lineUnitOptions`, widen the `sku` parameter type `{ packFormat: string | null; eachContainerLabel: string | null; eachMeasure: string | null } | null` to `{ packFormat: string | null; eachContainerLabel: string | null; eachMeasure: string | null; packChain?: ReadonlyArray<{ label: string }> | null } | null`. In `lineUnitChoices`, replace

```ts
  push(current);
  push(sku?.packFormat);
  push(sku?.eachContainerLabel);
  push(sku?.eachMeasure);
```

with

```ts
  push(current);
  if (sku?.packChain && sku.packChain.length > 0) {
    // A CHAINED SKU's container units are its chain's labels — the scope's own pack (catalog Phase 3b):
    // ozForRecipeInput walks the chain first and does not honour the legacy flat labels for it.
    for (const level of sku.packChain) push(level.label);
  } else {
    push(sku?.packFormat);
    push(sku?.eachContainerLabel);
  }
  push(sku?.eachMeasure);
```

The legacy builder's catalog carries no chain, so its choices are unchanged.

- [ ] **Step 3: Declare the pages' shop param**

In `lib/shop-context-shared.ts`, inside 2b's `SHOP_PARAMS_BY_PREFIX` array, after `["/admin/catalog/sku/", ["location"]],`, add:

```ts
  // Catalog Phase 3b — the recipe and menu-item pages' shop switcher (?location=<shop> | global).
  ["/admin/catalog/recipe/", ["location"]],
  ["/admin/catalog/menu-item/", ["location"]],
```

and in `SHOP_PARAMS_BY_PATH` add `  "/admin/catalog/notices": ["location"], // catalog Phase 3b — the GM's recipe notices`.

`RecipeNotice` is imported from `@/lib/catalog/recipe-notices-shared`, which Task 3 creates. Create its stub now so this task compiles; Task 3 replaces the file whole:

```ts
// lib/catalog/recipe-notices-shared.ts (Task 3 replaces this file whole)
export type RecipeNotice = { kind: "source_changed" | "new_default"; recipeId: string };
```

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/recipe-item-shared.test.ts tests/shop-context.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output.

```bash
git add lib/catalog/recipe-item-shared.ts lib/catalog/recipe-notices-shared.ts lib/shop-context-shared.ts lib/recipe-line-shared.ts tests/recipe-item-shared.test.ts
git commit -F - <<'EOF'
feat(catalog): the recipe and menu-item pages' shared surface — links, labels, change requests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 2: "What this changes" — the pure recipe and menu previews

**The rule.** A recipe preview is computed for the act's save target. A **shop** target reaches that shop only. A **global** target (a MoO's edit, a global restore, a promote) reaches the global view and every active shop **riding the default for this recipe**; every shop with its own live version is listed as **untouched** — its food does not change. A **promote** also names the **source shop, which returns to the default** in the same save (lead decision 5; its food stays the same — the new default IS its lines). For each reached scope: the line changes, the cost per unit of each prep item the recipe makes, and every sandwich whose cost (or costing status) moves, before → after. **The token digests the dependency snapshot (3a's `recipe_change_snapshot`, taken BEFORE the numbers are computed) AND every number the preview shows** — the act, the target, the versions the person saw, the lines after, the reached / untouched / returned shops, and each reached scope's item and sandwich costs before → after (Astra 3b r1#3). Apply recomputes the preview; an equal token means nothing the person saw has moved, and the same snapshot is then re-checked by SQL under the graph lock, so nothing can move between the check and the write.

**Files:**
- Create: `lib/catalog/recipe-preview-shared.ts`
- Test: `tests/recipe-preview-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 3b — "What this changes" (pure): sandwich deltas, the line text, the menu preview, the tokens. */
import { describe, expect, it } from "vitest";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";
import { costPerOzFromGraph } from "@/lib/admin/menu-costing";
import { lineText, menuCostDeltas, menuPreviewMath, menuPreviewToken, menuPromoteChangedShops, recipePreviewToken } from "@/lib/catalog/recipe-preview-shared";

const measures = new Map<string, MeasureUnitFactor>([["oz", { dimension: "weight", toBaseFactor: 1 }]]);
const turkey: RecipeInputSku = { packFormat: "case", eachContainerLabel: null, unitsPerPack: 1, eachSize: 160, eachMeasure: "oz", avgOzPerEach: null };
const recipe = (qty: number): GraphRecipe => ({
  recipeId: "r", batchYield: 1,
  inputs: [{ quantity: qty, unit: "oz", componentSkuId: "turkey", componentItemId: null }],
  outputs: [{ outputItemId: null, outputMenuItemId: "m-italian", yield: 1, ozPerParUnit: null }],
});
const side = (): GraphRecipe => ({
  recipeId: "s", batchYield: 1,
  inputs: [{ quantity: 1, unit: "oz", componentSkuId: "turkey", componentItemId: null }],
  outputs: [{ outputItemId: null, outputMenuItemId: "m-side", yield: 1, ozPerParUnit: null }],
});
const prices = new Map([["turkey", 80]]); // $80 / 160 oz = $0.50 / oz

describe("menuCostDeltas — only the sandwiches that move", () => {
  it("the Italian goes $2.00 → $2.50; the side does not move and is left out", () => {
    const before = buildRecipeGraph([recipe(4), side()], new Map([["turkey", turkey]]), measures);
    const after = buildRecipeGraph([recipe(5), side()], new Map([["turkey", turkey]]), measures);
    const d = menuCostDeltas(["m-italian", "m-side"], new Map([["m-italian", { name: "Italian", nameEs: "Italiano" }], ["m-side", { name: "Side", nameEs: null }]]),
      { graph: before, costPerOz: costPerOzFromGraph(before, prices) }, { graph: after, costPerOz: costPerOzFromGraph(after, prices) });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ menuItemId: "m-italian", name: "Italian", before: 2, after: 2.5 });
  });
});

describe("lineText — a line in plain words", () => {
  it("name, amount, unit; a missing name falls back to the key", () => {
    const names = { "sku:turkey": "Turkey" };
    expect(lineText({ componentSkuId: "turkey", componentItemId: null, componentProductId: null, quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false }, names, (n) => String(n))).toBe("Turkey 4 oz");
    expect(lineText({ componentSkuId: "ham", componentItemId: null, componentProductId: null, quantity: 1, unit: null, eachContainerLabel: null, portioned: false }, names, (n) => String(n))).toBe("sku:ham 1");
  });
});

describe("menuPreviewMath — price and margin before and after", () => {
  it("a shop price on a $1.80 cost", () => {
    expect(menuPreviewMath({ before: 12.5, after: 13.5, cost: 1.8 })).toEqual({ marginBefore: 10.7, marginAfter: 11.7 });
    expect(menuPreviewMath({ before: null, after: 13.5, cost: null })).toEqual({ marginBefore: null, marginAfter: null });
  });
});

describe("menuPromoteChangedShops — field by field (Astra 3b r1#4)", () => {
  const shops = [{ id: "A", name: "A" }, { id: "B", name: "B" }, { id: "C", name: "C" }, { id: "S", name: "Src" }];
  it("promoting price AND name: a shop with its own price but the default name still changes", () => {
    const live = [{ location_id: "B", price: 14, name_override: null }, { location_id: "C", price: 14, name_override: "Mine" }, { location_id: "S", price: 13, name_override: "New" }];
    expect(menuPromoteChangedShops({ shops, sourceShopId: "S", fields: ["price", "name"], live }).map((c) => c.shopId)).toEqual(["A", "B"]);
    expect(menuPromoteChangedShops({ shops, sourceShopId: "S", fields: ["price"], live }).map((c) => c.shopId)).toEqual(["A"]);
    expect(menuPromoteChangedShops({ shops, sourceShopId: "S", fields: ["name"], live }).map((c) => c.shopId)).toEqual(["A", "B"]);
  });
});

describe("tokens — the same preview, the same token; any difference, another", () => {
  it("recipe and menu", () => {
    const a = { kind: "lines", recipeId: "r", target: { kind: "global" }, expected: "v1", basedOn: null, lines: [1], reached: ["a"], untouched: ["b"] };
    expect(recipePreviewToken(a)).toBe(recipePreviewToken({ ...a }));
    expect(recipePreviewToken(a)).not.toBe(recipePreviewToken({ ...a, untouched: [] }));
    expect(menuPreviewToken({ x: 1 })).not.toBe(menuPreviewToken({ x: 2 }));
  });
});
```

Run: `npx vitest run tests/recipe-preview-shared.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `lib/catalog/recipe-preview-shared.ts`**

```ts
/**
 * "WHAT THIS CHANGES" for recipes and menu items — PURE, client-safe (catalog Phase 3b; spec §4).
 * The server (lib/catalog/recipe-item.ts, lib/catalog/menu-item-page.ts) loads, per reached scope, the
 * graph before and after (3a's recipeOverrides) and the prices; this module turns them into the
 * deltas a person reads, and digests the preview into the token a save must present (2b's
 * previewToken: one spelling of the digest).
 */
import type { RecipeGraph } from "@/lib/prep-consumption-graph";
import { rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { previewToken } from "@/lib/catalog/change-preview-shared";
import type { RecipeLineFields } from "@/lib/recipe-line-shared";
import { recipeLineTargetKey, type RecipeLineChange } from "@/lib/recipe-versions-shared";
import type { RecipeChangeRequest, RecipeTarget } from "@/lib/catalog/recipe-item-shared";

export interface MenuCostDelta {
  menuItemId: string;
  name: string;
  nameEs: string | null;
  before: number | null;
  after: number | null;
  statusBefore: string;
  statusAfter: string;
}

export interface ScopeImpact {
  /** null = the global view ("everyone on the default"). */
  scope: string | null;
  scopeName: string | null;
  menu: MenuCostDelta[];
  /** Cost per unit of each prep item this recipe makes, before → after. */
  items: Array<{ itemId: string; name: string; before: number | null; after: number | null }>;
}

export interface RecipePreview {
  kind: RecipeChangeRequest["kind"];
  recipeId: string;
  target: RecipeTarget;
  changes: RecipeLineChange[];
  /** recipeLineTargetKey → display name. */
  names: Record<string, string>;
  reached: ScopeImpact[];
  untouched: Array<{ shopId: string; shopName: string }>;
  /** PROMOTE: the source shop, which goes back to the default in the same save (its food does not change). */
  returnedShop: { shopId: string; shopName: string } | null;
  /** Restore of a pre-adoption version / back to default: the shop whose recipe this shop stops following, else null. */
  dropsLinkTo: string | null;
  /** Lines the save CARRIES that would not pass an add today — flagged, not refused (lead decision (b)). */
  flagged: Array<{ position: number; name: string; reason: string }>;
  expectedVersionId: string | null;
  basedOnVersionId: string | null;
  /** The dependency snapshot (3a recipe_change_snapshot) this preview was computed on — opaque digests and ids; the token binds it, apply hands it to the writer. */
  snapshot: Record<string, unknown>;
  token: string;
}

interface Costed { graph: RecipeGraph; costPerOz: ReadonlyMap<string, number | null> }

/** Every sandwich whose cost or costing status moves, in the order given. Unmoved ones are left out. */
export function menuCostDeltas(
  menuIds: readonly string[],
  names: ReadonlyMap<string, { name: string; nameEs: string | null }>,
  before: Costed,
  after: Costed,
): MenuCostDelta[] {
  const out: MenuCostDelta[] = [];
  for (const id of menuIds) {
    const b = rollupMenuItemCost(before.graph, id, new Map(before.costPerOz));
    const a = rollupMenuItemCost(after.graph, id, new Map(after.costPerOz));
    const same = b.status === a.status && (b.cost === a.cost || (b.cost !== null && a.cost !== null && Math.abs(b.cost - a.cost) < 0.005));
    if (same) continue;
    const n = names.get(id);
    out.push({ menuItemId: id, name: n?.name ?? id, nameEs: n?.nameEs ?? null, before: b.cost, after: a.cost, statusBefore: b.status, statusAfter: a.status });
  }
  return out;
}

/** "Turkey 4 oz" — the line in plain words (the name from `names`, the amount through `fmt`). */
export function lineText(f: RecipeLineFields, names: Readonly<Record<string, string>>, fmt: (n: number) => string): string {
  const key = recipeLineTargetKey(f);
  return [names[key] ?? key, fmt(f.quantity), f.unit ?? ""].filter((s) => s !== "").join(" ");
}

/** Price and margin before and after a menu change (margin = price − food cost; null when either is unknown). */
export function menuPreviewMath(input: { before: number | null; after: number | null; cost: number | null }): { marginBefore: number | null; marginAfter: number | null } {
  const m = (p: number | null) => (p === null || input.cost === null ? null : Math.round((p - input.cost) * 100) / 100);
  return { marginBefore: m(input.before), marginAfter: m(input.after) };
}

export function recipePreviewToken(parts: unknown): string {
  return previewToken(["recipe", parts]);
}

export function menuPreviewToken(parts: unknown): string {
  return previewToken(["menu", parts]);
}

export interface MenuPreviewSide {
  name: string;
  nameEs: string | null;
  price: number | null;
  soldHere: boolean;
  /** true = this value is the default's (no own value at this shop). */
  inherits: { price: boolean; name: boolean };
}

/** A save's patch, normalized exactly as the writer stores it — what a menu token binds (Astra 3b r4#2). */
export function normalizeMenuPatch(p: { price: number | null; soldHere: boolean; nameOverride: string | null; nameOverrideEs: string | null }) {
  const text = (v: string | null) => (v === null ? null : v.trim() === "" ? null : v.trim());
  return { price: p.price, soldHere: p.soldHere, nameOverride: text(p.nameOverride), nameOverrideEs: text(p.nameOverrideEs) };
}

export interface MenuPreview {
  kind: "save" | "back_to_default" | "restore" | "promote";
  menuItemId: string;
  /** null = everyone (promote). */
  shopId: string | null;
  /** Each side in FULL (Astra 3b r4#2): both names, the price, sold here, and which values are inherited. */
  before: MenuPreviewSide;
  after: MenuPreviewSide;
  cost: number | null;
  marginBefore: number | null;
  marginAfter: number | null;
  /** Promote: the shops whose menu changes — FIELD BY FIELD, every shop inheriting ANY promoted field. */
  changedShops: Array<{ shopId: string; shopName: string }>;
  /** Promote: the source shop, which goes back to the default for the promoted fields in the same save. */
  returnedShop: { shopId: string; shopName: string } | null;
  /** The dependency snapshot (3a menu_item_change_snapshot) this preview was computed on; the token binds it. */
  snapshot: Record<string, unknown>;
  expectedSettingId: string | null;
  expectedGlobal: { price: number | null; name: string; nameEs: string | null } | null;
  token: string;
}

/**
 * Which shops' menus a promote changes, FIELD BY FIELD (Astra 3b r1#4; the 0263 SQL predicate): a shop
 * changes when it inherits ANY promoted field. The source shop is excluded — its values ARE the promoted ones.
 */
export function menuPromoteChangedShops(input: {
  shops: ReadonlyArray<{ id: string; name: string }>;
  sourceShopId: string;
  fields: ReadonlyArray<"price" | "name">;
  live: ReadonlyArray<{ location_id: string; price: number | string | null; name_override: string | null }>;
}): Array<{ shopId: string; shopName: string }> {
  const ownPrice = new Set(input.live.filter((o) => o.price !== null).map((o) => o.location_id));
  const ownName = new Set(input.live.filter((o) => o.name_override !== null).map((o) => o.location_id));
  return input.shops
    .filter((s) => s.id !== input.sourceShopId)
    .filter((s) => (input.fields.includes("price") && !ownPrice.has(s.id)) || (input.fields.includes("name") && !ownName.has(s.id)))
    .map((s) => ({ shopId: s.id, shopName: s.name }));
}
```

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/recipe-preview-shared.test.ts`
Expected: PASS, 0 failed.

```bash
git add lib/catalog/recipe-preview-shared.ts tests/recipe-preview-shared.test.ts
git commit -F - <<'EOF'
feat(catalog): "What this changes" for recipes and menu items — pure deltas, line text, tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 3: GM notices — computed at read time, never swept

**The rule.**
- **Source changed.** A shop's live version adopted from shop S's version A. Look at S's newest version of that recipe (live or retired). If it is not A, S has moved on: notice "S updated this · take the update?" (or, when that newest version is retired, "S went back to the default"). **If it IS A but A is retired, S has moved on too** — S went back to the default, or S's version was promoted (lead decision 5 retires the source on promote: "S's recipe is now the default · go back to the default?") (Astra 3b r1#5). Seen = that newest version's id.
- **Dismissal identity carries the STATE.** A "keep mine" records `(recipe, kind, seen version)` where kind is `source_changed` while the seen version is live and `source_retired` once it is retired. So a dismissal of "S updated to B" does not silence "S then went back to the default" (B retired later): same version id, a different kind. 3a's 0262 CHECK allows the three kinds.
- **New default.** A shop riding the default for a recipe whose live global version was **promoted** within the last 30 days: notice "this is the new default (from S)". Seen = the global version's id. The source shop itself is not told about its own promotion (it rides the default now — lead decision 5 — but it made this).
- A notice is gone once the shop has a dismissal for (recipe, kind, seen version) — or once the shop acts (adopting again makes A the newest; a shop with its own version does not ride the default). A later change has a new id (or a new state) and raises the notice again.

**Files:**
- Modify (replace the stub): `lib/catalog/recipe-notices-shared.ts`
- Test: `tests/recipe-notices-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 3b — the GM notices (pure): source changed / gone, new default; dismissals; no sweeper. */
import { describe, expect, it } from "vitest";
import { computeRecipeNotices, NEW_DEFAULT_NOTICE_DAYS, type NoticeVersionRow } from "@/lib/catalog/recipe-notices-shared";

const HERE = "shop-here";
const SRC = "shop-src";
const v = (id: string, recipe: string, loc: string | null, from: string, to: string | null, over: Partial<NoticeVersionRow> = {}): NoticeVersionRow => ({
  id, recipe_id: recipe, location_id: loc, valid_from: from, valid_to: to, active: to === null,
  adopted_from_version_id: null, promoted_from_version_id: null, ...over,
});
const names = { recipeNames: new Map([["r1", "Italian"], ["r2", "Slaw"]]), shopNames: new Map([[SRC, "P Street"], [HERE, "Capitol Hill"]]) };
const NOW = "2026-10-15T15:00:00Z";

describe("source changed", () => {
  const base = [
    v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-10T00:00:00Z"),
    v("b", "r1", SRC, "2026-10-10T00:00:00Z", null),
    v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null, { adopted_from_version_id: "a" }),
  ];
  it("P Street moved on from the version this shop copied → take the update", () => {
    expect(computeRecipeNotices({ shopId: HERE, versions: base, dismissals: [], now: NOW, ...names })).toEqual([
      { kind: "source_changed", recipeId: "r1", recipeName: "Italian", sourceShopId: SRC, sourceShopName: "P Street", seenVersionId: "b",
        sourceLiveVersionId: "b", dismissKind: "source_changed", promotedToDefault: false, editedSinceAdopting: false, at: "2026-10-10T00:00:00Z" },
    ]);
  });
  it("dismissed for THAT version → quiet; a later change raises it again", () => {
    const dismissed = [{ recipe_id: "r1", kind: "source_changed" as const, seen_version_id: "b" }];
    expect(computeRecipeNotices({ shopId: HERE, versions: base, dismissals: dismissed, now: NOW, ...names })).toEqual([]);
    const later = [...base.map((x) => (x.id === "b" ? { ...x, active: false, valid_to: "2026-10-14T00:00:00Z" } : x)), v("c", "r1", SRC, "2026-10-14T00:00:00Z", null)];
    expect(computeRecipeNotices({ shopId: HERE, versions: later, dismissals: dismissed, now: NOW, ...names }).map((n) => n.seenVersionId)).toEqual(["c"]);
  });
  it("P Street went back to the default → the notice says so (no live source to take)", () => {
    const gone = base.map((x) => (x.id === "b" ? { ...x, active: false, valid_to: "2026-10-12T00:00:00Z" } : x));
    expect(computeRecipeNotices({ shopId: HERE, versions: gone, dismissals: [], now: NOW, ...names })[0]).toMatchObject({ sourceLiveVersionId: null, seenVersionId: "b", dismissKind: "source_retired", at: "2026-10-12T00:00:00Z" });
  });
  it("still on the version it copied → nothing", () => {
    const same = [v("a", "r1", SRC, "2026-10-01T00:00:00Z", null), v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null, { adopted_from_version_id: "a" })];
    expect(computeRecipeNotices({ shopId: HERE, versions: same, dismissals: [], now: NOW, ...names })).toEqual([]);
  });
  it("THE VERSION IT COPIED was retired with no newer save (S went back to the default) → a heads-up (Astra 3b r1#5)", () => {
    const back = [v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-11T00:00:00Z"), v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null, { adopted_from_version_id: "a" })];
    expect(computeRecipeNotices({ shopId: HERE, versions: back, dismissals: [], now: NOW, ...names })).toEqual([
      { kind: "source_changed", recipeId: "r1", recipeName: "Italian", sourceShopId: SRC, sourceShopName: "P Street", seenVersionId: "a",
        sourceLiveVersionId: null, dismissKind: "source_retired", promotedToDefault: false, editedSinceAdopting: false, at: "2026-10-11T00:00:00Z" },
    ]);
  });
  it("the version it copied was PROMOTED (and so retired) → 'it is the default now'", () => {
    const promotedSrc = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-11T00:00:00Z"),
      v("g", "r1", null, "2026-10-11T00:00:00Z", null, { promoted_from_version_id: "a" }),
      v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null, { adopted_from_version_id: "a" }),
    ];
    expect(computeRecipeNotices({ shopId: HERE, versions: promotedSrc, dismissals: [], now: NOW, ...names })[0])
      .toMatchObject({ kind: "source_changed", seenVersionId: "a", sourceLiveVersionId: null, dismissKind: "source_retired", promotedToDefault: true });
  });
  it("PROVENANCE FOLLOWS THE CONTENT: adopt → restore an adopted-lineage version → source update → the notice fires", () => {
    const restoredLineage = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-12T00:00:00Z"),
      v("b", "r1", SRC, "2026-10-12T00:00:00Z", null),
      v("copy", "r1", HERE, "2026-10-05T00:00:00Z", "2026-10-08T00:00:00Z", { adopted_from_version_id: "a", based_on_version_id: "a" }),
      // restored from "copy": 0262 copies the restored version's pointer
      v("restored", "r1", HERE, "2026-10-08T00:00:00Z", null, { adopted_from_version_id: "a", based_on_version_id: "copy" }),
    ];
    expect(computeRecipeNotices({ shopId: HERE, versions: restoredLineage, dismissals: [], now: NOW, ...names }))
      .toEqual([expect.objectContaining({ kind: "source_changed", seenVersionId: "b" })]);
  });
  it("adopt → restore a PRE-adoption version (no pointer) → source update → no notice: the link ended, as intended", () => {
    const restoredPre = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-12T00:00:00Z"),
      v("b", "r1", SRC, "2026-10-12T00:00:00Z", null),
      v("pre", "r1", HERE, "2026-09-20T00:00:00Z", "2026-10-05T00:00:00Z"),
      v("copy", "r1", HERE, "2026-10-05T00:00:00Z", "2026-10-08T00:00:00Z", { adopted_from_version_id: "a", based_on_version_id: "a" }),
      v("restored", "r1", HERE, "2026-10-08T00:00:00Z", null, { adopted_from_version_id: null, based_on_version_id: "pre" }),
    ];
    expect(computeRecipeNotices({ shopId: HERE, versions: restoredPre, dismissals: [], now: NOW, ...names })).toEqual([]);
  });
  it("adopt → LOCAL EDIT → source update: the notice continues and says the copy was changed (lead decision, Astra 3a r5#1)", () => {
    const edited = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-12T00:00:00Z"),
      v("b", "r1", SRC, "2026-10-12T00:00:00Z", null),
      v("copy", "r1", HERE, "2026-10-05T00:00:00Z", "2026-10-07T00:00:00Z", { adopted_from_version_id: "a", based_on_version_id: "a" }),
      // HERE adjusted one ingredient on 10-07: provenance kept (0262), based_on moved to its own predecessor
      v("mine2", "r1", HERE, "2026-10-07T00:00:00Z", null, { adopted_from_version_id: "a", based_on_version_id: "copy" }),
    ];
    const [n] = computeRecipeNotices({ shopId: HERE, versions: edited, dismissals: [], now: NOW, ...names });
    expect(n).toMatchObject({ kind: "source_changed", seenVersionId: "b", editedSinceAdopting: true, dismissKind: "source_changed" });
    // still dismissible per state seen
    expect(computeRecipeNotices({ shopId: HERE, versions: edited, dismissals: [{ recipe_id: "r1", kind: "source_changed", seen_version_id: "b" }], now: NOW, ...names })).toEqual([]);
  });
  it("dismissing 'S updated to B' does not silence 'S then went back to the default' (same version, new state)", () => {
    const updated = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-10T00:00:00Z"),
      v("b", "r1", SRC, "2026-10-10T00:00:00Z", null),
      v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null, { adopted_from_version_id: "a" }),
    ];
    const keptB = [{ recipe_id: "r1", kind: "source_changed" as const, seen_version_id: "b" }];
    expect(computeRecipeNotices({ shopId: HERE, versions: updated, dismissals: keptB, now: NOW, ...names })).toEqual([]);
    const thenBack = updated.map((x) => (x.id === "b" ? { ...x, active: false, valid_to: "2026-10-13T00:00:00Z" } : x));
    expect(computeRecipeNotices({ shopId: HERE, versions: thenBack, dismissals: keptB, now: NOW, ...names })[0])
      .toMatchObject({ seenVersionId: "b", dismissKind: "source_retired" });
    const keptBoth = [...keptB, { recipe_id: "r1", kind: "source_retired" as const, seen_version_id: "b" }];
    expect(computeRecipeNotices({ shopId: HERE, versions: thenBack, dismissals: keptBoth, now: NOW, ...names })).toEqual([]);
  });
});

describe("new default", () => {
  const promoted = [
    v("p", "r2", SRC, "2026-10-01T00:00:00Z", null),
    v("g", "r2", null, "2026-10-12T00:00:00Z", null, { promoted_from_version_id: "p" }),
  ];
  it("a shop riding the default hears about a promotion within the window", () => {
    expect(computeRecipeNotices({ shopId: HERE, versions: promoted, dismissals: [], now: NOW, ...names })).toEqual([
      { kind: "new_default", recipeId: "r2", recipeName: "Slaw", seenVersionId: "g", fromShopName: "P Street", at: "2026-10-12T00:00:00Z" },
    ]);
  });
  it("the source shop (its own promotion, even though it now rides the default) and an old promotion are quiet", () => {
    expect(computeRecipeNotices({ shopId: SRC, versions: promoted, dismissals: [], now: NOW, ...names })).toEqual([]);
    const sourceReturned = promoted.map((x) => (x.id === "p" ? { ...x, active: false, valid_to: "2026-10-12T00:00:00Z" } : x));
    expect(computeRecipeNotices({ shopId: SRC, versions: sourceReturned, dismissals: [], now: NOW, ...names })).toEqual([]);
    const late = new Date(Date.parse("2026-10-12T00:00:00Z") + (NEW_DEFAULT_NOTICE_DAYS + 1) * 86_400_000).toISOString();
    expect(computeRecipeNotices({ shopId: HERE, versions: promoted, dismissals: [], now: late, ...names })).toEqual([]);
  });
});
```

Run: `npx vitest run tests/recipe-notices-shared.test.ts` → FAIL (`computeRecipeNotices` is not exported by the stub).

- [ ] **Step 2: Replace `lib/catalog/recipe-notices-shared.ts` whole**

```ts
/**
 * GM NOTICES — PURE, client-safe (catalog Phase 3b; spec §3 "a shop's food never changes without its
 * own GM's yes", §6). Computed at READ time from the versions the server reads per request — no
 * sweeper, no stored "unread" state. A "Keep mine" / "Got it" answer is a recipe_notice_dismissals row
 * (0262) for the version SEEN, so the next change (a new version id) raises the notice again.
 *
 *   source_changed — this shop's live version was adopted from shop S's version A, and S has moved on:
 *                    S's newest version of the recipe is no longer A (S edited it), or it IS A but A is
 *                    retired (S went back to the default, or A was promoted — 3a retires a promoted source).
 *                    A dismissal names the STATE seen: `source_changed` (seen version live) or
 *                    `source_retired` (seen version retired), so a later retirement of the same version
 *                    is a new notice (Astra 3b r1#5).
 *   new_default    — this shop rides the default for a recipe whose live global version was PROMOTED
 *                    within NEW_DEFAULT_NOTICE_DAYS — unless this shop is the one it was promoted from.
 */
export const NEW_DEFAULT_NOTICE_DAYS = 30;

export type RecipeNotice =
  | {
      kind: "source_changed";
      recipeId: string;
      recipeName: string;
      sourceShopId: string;
      sourceShopName: string;
      /** S's newest version — what a dismissal records as seen. */
      seenVersionId: string;
      /** S's LIVE version to take, or null when S went back to the default (or its version became the default). */
      sourceLiveVersionId: string | null;
      /** What a "Keep mine" records: the seen version's STATE (live → source_changed, retired → source_retired). */
      dismissKind: "source_changed" | "source_retired";
      /** This shop has edited its copy since adopting it (lead decision: provenance kept, the notice continues). */
      editedSinceAdopting: boolean;
      /** The seen version was promoted to the global default (3a retires a promoted source). */
      promotedToDefault: boolean;
      at: string;
    }
  | { kind: "new_default"; recipeId: string; recipeName: string; seenVersionId: string; fromShopName: string | null; at: string };

export interface NoticeVersionRow {
  id: string;
  recipe_id: string;
  location_id: string | null;
  valid_from: string;
  valid_to: string | null;
  active: boolean;
  adopted_from_version_id: string | null;
  promoted_from_version_id: string | null;
  /** The version this one was made from (0262). An adopted copy's own edits keep adopted_from but move based_on. */
  based_on_version_id?: string | null;
}

export type NoticeDismissKind = "source_changed" | "source_retired" | "new_default";
export interface NoticeDismissalRow { recipe_id: string; kind: NoticeDismissKind; seen_version_id: string }

export function computeRecipeNotices(input: {
  shopId: string;
  versions: readonly NoticeVersionRow[];
  dismissals: readonly NoticeDismissalRow[];
  recipeNames: ReadonlyMap<string, string>;
  shopNames: ReadonlyMap<string, string>;
  now: string;
}): RecipeNotice[] {
  const byId = new Map(input.versions.map((v) => [v.id, v]));
  const dismissed = new Set(input.dismissals.map((d) => `${d.recipe_id}|${d.kind}|${d.seen_version_id}`));
  const newest = (recipeId: string, locationId: string): NoticeVersionRow | null => {
    let best: NoticeVersionRow | null = null;
    for (const v of input.versions) {
      if (v.recipe_id !== recipeId || v.location_id !== locationId) continue;
      if (!best || Date.parse(v.valid_from) > Date.parse(best.valid_from) || (v.valid_from === best.valid_from && v.id > best.id)) best = v;
    }
    return best;
  };
  const out: RecipeNotice[] = [];
  const mine = input.versions.filter((v) => v.location_id === input.shopId && v.active);
  const ownRecipes = new Set(mine.map((v) => v.recipe_id));
  const promotedSources = new Set(input.versions
    .filter((v) => v.location_id === null && v.promoted_from_version_id !== null)
    .map((v) => v.promoted_from_version_id as string));

  for (const v of mine) {
    if (!v.adopted_from_version_id) continue;
    const src = byId.get(v.adopted_from_version_id);
    if (!src || src.location_id === null) continue;
    const latest = newest(v.recipe_id, src.location_id);
    if (!latest) continue;
    // Still the very version this shop copied, and still live → nothing to say. The SAME version, now
    // RETIRED (S went back to the default, or it was promoted) → S has moved on all the same.
    if (latest.id === src.id && latest.active) continue;
    const dismissKind = latest.active ? "source_changed" as const : "source_retired" as const;
    if (dismissed.has(`${v.recipe_id}|${dismissKind}|${latest.id}`)) continue;
    out.push({
      kind: "source_changed", recipeId: v.recipe_id, recipeName: input.recipeNames.get(v.recipe_id) ?? v.recipe_id,
      sourceShopId: src.location_id, sourceShopName: input.shopNames.get(src.location_id) ?? src.location_id,
      seenVersionId: latest.id, sourceLiveVersionId: latest.active ? latest.id : null,
      dismissKind, promotedToDefault: !latest.active && promotedSources.has(latest.id),
      // An adopt makes based_on = the source; any later edit of the copy moves based_on to its own predecessor.
      editedSinceAdopting: (v.based_on_version_id ?? v.adopted_from_version_id) !== v.adopted_from_version_id,
      at: latest.active ? latest.valid_from : (latest.valid_to ?? latest.valid_from),
    });
  }

  const cutoff = Date.parse(input.now) - NEW_DEFAULT_NOTICE_DAYS * 86_400_000;
  for (const head of input.versions) {
    if (head.location_id !== null || !head.active || !head.promoted_from_version_id) continue;
    if (ownRecipes.has(head.recipe_id)) continue; // a shop with its own version is untouched by a promotion
    if (Date.parse(head.valid_from) < cutoff) continue;
    if (dismissed.has(`${head.recipe_id}|new_default|${head.id}`)) continue;
    const from = byId.get(head.promoted_from_version_id);
    if (from?.location_id === input.shopId) continue; // this shop made the new default (lead decision 5 returned it to it)
    out.push({
      kind: "new_default", recipeId: head.recipe_id, recipeName: input.recipeNames.get(head.recipe_id) ?? head.recipe_id,
      seenVersionId: head.id, fromShopName: from?.location_id ? (input.shopNames.get(from.location_id) ?? null) : null, at: head.valid_from,
    });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
```

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run tests/recipe-notices-shared.test.ts tests/recipe-item-shared.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output.

```bash
git add lib/catalog/recipe-notices-shared.ts tests/recipe-notices-shared.test.ts
git commit -F - <<'EOF'
feat(catalog): GM recipe notices — source changed, new default — computed at read time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 4: Adopt, promote, the notice answer, the menu promote — thin libs over 3a's writers

**Files:**
- Modify: `lib/admin/recipe-versions.ts`, `lib/admin/menu-item-shop.ts`, `lib/audit-actions.ts`
- Test: `tests/recipe-adopt-promote-permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 3b — adopt binds the adopting shop; promote is MoO+; the notice answer binds the shop; menu promote is MoO+. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import { adoptRecipeVersion, dismissRecipeNotice, promoteRecipeVersion, RecipeVersionError } from "@/lib/admin/recipe-versions";
import { MenuShopError, promoteMenuItemShopSetting } from "@/lib/admin/menu-item-shop";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
afterEach(() => { current = null; });

const actor = (role: RoleCode, level: number, locations: string[]): AuthContext =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;

async function refused(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try { await p; } catch (e) {
    if (e instanceof RecipeVersionError || e instanceof MenuShopError) return { status: e.status, code: e.code };
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("adopt", () => {
  it("a GM adopts only INTO its own shop", async () => {
    expect(await refused(adoptRecipeVersion(actor("gm", 7, [LOC]), { recipeId: "r-slaw", locationId: OTHER, sourceVersionId: "v", expectedVersionId: null, basedOnVersionId: null })))
      .toEqual({ status: 404, code: "not_found" });
  });
  it("its own shop passes the gate and reaches the writer (the stand-in has no rpc)", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const p = adoptRecipeVersion(actor("gm", 7, [LOC]), { recipeId: "r-slaw", locationId: LOC, sourceVersionId: "v", expectedVersionId: null, basedOnVersionId: null });
    await expect(p).rejects.toThrow();
    await expect(p).rejects.not.toBeInstanceOf(RecipeVersionError);
  });
});

describe("promote", () => {
  it("is the Director of Operations' act — a GM is refused before any I/O", async () => {
    expect(await refused(promoteRecipeVersion(actor("gm", 7, [LOC, OTHER]), { recipeId: "r-slaw", sourceVersionId: "v", expectedGlobalVersionId: "g" })))
      .toEqual({ status: 403, code: "global_requires_moo" });
    expect(await refused(promoteMenuItemShopSetting(actor("gm", 7, [LOC]), { menuItemId: "m-italian", settingId: "s", fields: ["price"], expected: { price: 12.5, name: "Italian", nameEs: "Italiano" } })))
      .toEqual({ status: 403, code: "global_requires_moo" });
  });
});

describe("the notice answer", () => {
  it("binds the shop", async () => {
    expect(await refused(dismissRecipeNotice(actor("gm", 7, [LOC]), { locationId: OTHER, recipeId: "r-slaw", kind: "new_default", seenVersionId: "g" })))
      .toEqual({ status: 404, code: "not_found" });
  });
  it("its own shop writes ONE idempotent row (twice answered, once stored)", async () => {
    const t = buildRecipeVersionsFixture();
    current = createFakeDb(t);
    await dismissRecipeNotice(actor("gm", 7, [LOC]), { locationId: LOC, recipeId: "r-slaw", kind: "new_default", seenVersionId: "rv-r-slaw-base" });
    await dismissRecipeNotice(actor("gm", 7, [LOC]), { locationId: LOC, recipeId: "r-slaw", kind: "new_default", seenVersionId: "rv-r-slaw-base" });
    expect(t.recipe_notice_dismissals).toHaveLength(1);
    expect(t.recipe_notice_dismissals![0]).toMatchObject({ location_id: LOC, recipe_id: "r-slaw", kind: "new_default", seen_version_id: "rv-r-slaw-base", created_by: "u1" });
  });
});
```

Run: `npx vitest run tests/recipe-adopt-promote-permissions.test.ts` → FAIL (`adoptRecipeVersion` is not exported).

- [ ] **Step 2: Register the notice answer in the audit vocabulary**

In `lib/audit-actions.ts` `NON_DESTRUCTIVE_ACTIONS`, directly after `  "par.suggestion_dismiss",`, insert:

```ts
  // recipe_version.notice_dismiss (catalog Phase 3b): a GM answers a read-time notice ("keep mine" /
  // "got it"). Nothing in the kitchen changes — no recipe, no version — so it is findable, never destructive.
  "recipe_version.notice_dismiss",
```

- [ ] **Step 3: Append to `lib/admin/recipe-versions.ts`** (`loadRecipeChangeSnapshot` and `RecipeChangeSnapshot` are already in this file, 3a Task 7)

```ts
// ── Adopt, promote, the notice answer (catalog Phase 3b) ──────────────────────

/**
 * ADOPT: this shop takes another shop's LIVE version as-is — a new version of THIS shop based on it
 * (adopted_from recorded), its lines copied IN SQL. A copy, never a link: when the source changes later,
 * this shop's GM is asked (computeRecipeNotices), and nothing changes without their yes.
 */
export async function adoptRecipeVersion(
  actor: AuthContext,
  input: {
    recipeId: string; locationId: string; sourceVersionId: string; expectedVersionId: string | null; basedOnVersionId: string | null;
    /** The preview's dependency snapshot; absent = taken now (a direct call). */
    snapshot?: RecipeChangeSnapshot;
  },
): Promise<WriteRecipeVersionResult> {
  requireLocation(actor, input.locationId);
  const snapshot = input.snapshot ?? await loadRecipeChangeSnapshot(input.recipeId, input.locationId, await loadVersionLineFields(input.sourceVersionId));
  return writeRecipeVersion(actor, {
    recipeId: input.recipeId, scope: input.locationId, expectedVersionId: input.expectedVersionId,
    basedOnVersionId: input.basedOnVersionId, lines: null, adoptedFromVersionId: input.sourceVersionId, op: "adopt", snapshot,
  });
}

/**
 * PROMOTE (MoO+): a shop's live version becomes the new GLOBAL default (promoted_from recorded), its
 * lines copied IN SQL into recipe_inputs and journaled — and, in the SAME transaction, the source shop
 * RETURNS TO THE DEFAULT (lead decision 5): its version is retired (history kept), so later global edits
 * reach it again; its food does not change today (the new default IS its lines). Every other shop riding
 * the default changes; every other shop with its own version is untouched.
 */
export async function promoteRecipeVersion(
  actor: AuthContext,
  input: { recipeId: string; sourceVersionId: string; expectedGlobalVersionId: string | null; snapshot?: RecipeChangeSnapshot },
): Promise<WriteRecipeVersionResult> {
  requireLocation(actor, null);
  const snapshot = input.snapshot ?? await loadRecipeChangeSnapshot(input.recipeId, null, await loadVersionLineFields(input.sourceVersionId));
  return writeRecipeVersion(actor, {
    recipeId: input.recipeId, scope: null, expectedVersionId: input.expectedGlobalVersionId,
    basedOnVersionId: null, lines: null, promotedFromVersionId: input.sourceVersionId, op: "promote", snapshot,
  });
}

/**
 * A GM's "Keep mine" / "Got it" on a read-time notice: one row for the version SEEN in the STATE seen
 * (`source_changed` live, `source_retired` retired, `new_default`), idempotent on the 0262 unique index,
 * so a later change — a new version id, or the same version's retirement — raises the notice again.
 * Changes no food.
 */
export async function dismissRecipeNotice(
  actor: AuthContext,
  input: { locationId: string; recipeId: string; kind: "source_changed" | "source_retired" | "new_default"; seenVersionId: string },
): Promise<void> {
  requireLocation(actor, input.locationId);
  const { error } = await getServiceRoleClient().from("recipe_notice_dismissals").upsert(
    [{ location_id: input.locationId, recipe_id: input.recipeId, kind: input.kind, seen_version_id: input.seenVersionId, created_by: actor.user.id }],
    { onConflict: "location_id,recipe_id,kind,seen_version_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`dismissRecipeNotice: ${error.message}`);
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "recipe_version.notice_dismiss", resourceTable: "recipe_notice_dismissals", resourceId: input.seenVersionId,
    metadata: { location_id: input.locationId, recipe_id: input.recipeId, kind: input.kind }, ipAddress: null, userAgent: null,
  });
}
```

`requireLocation(actor, null)` is the global gate (`recipeVersionWriteGate` with scope null): MoO+ passes; a GM is `global_requires_moo`.

- [ ] **Step 4: Append to `lib/admin/menu-item-shop.ts`**

Add `menuPromoteGate` to the `@/lib/menu-item-shop-shared` import and `NIL_SCOPE` to the `@/lib/sku-versions-shared` import (`loadMenuChangeSnapshot` and `MenuChangeSnapshot` are already in this file, 3a Task 8), then append:

```ts
/**
 * PROMOTE (MoO+): a shop's price and/or name becomes the global one (menu_items), under a
 * compare-and-set on the global values the preview showed and the dependency snapshot. "Sold here" is
 * never promoted. FIELD BY FIELD: a shop changes when it inherits ANY promoted field (one with its own
 * price but the default name changes when both are promoted). In the same transaction the source shop
 * returns to the default for the promoted fields (lead decision 5).
 */
export async function promoteMenuItemShopSetting(
  actor: AuthContext,
  input: {
    menuItemId: string; settingId: string; fields: Array<"price" | "name">; expected: { price: number | null; name: string; nameEs: string | null };
    snapshot?: MenuChangeSnapshot;
  },
): Promise<{ changedShops: string[]; returnedShop: string | null }> {
  const gate = menuPromoteGate(actor.level);
  if (!gate.ok) throw new MenuShopError(gate.status, gate.code);
  // A promote shows the GLOBAL cost only: the global view alone (NIL_SCOPE; 0263 snapshots the same scope).
  const snapshot = input.snapshot ?? await loadMenuChangeSnapshot(input.menuItemId, NIL_SCOPE);
  const sb = getServiceRoleClient();
  const { data: row, error: rErr } = await sb.from("menu_item_shop_settings").select("id, menu_item_id, location_id")
    .eq("id", input.settingId).maybeSingle<{ id: string; menu_item_id: string; location_id: string }>();
  if (rErr) throw new Error(`promoteMenuItemShopSetting read: ${rErr.message}`);
  if (!row || row.menu_item_id !== input.menuItemId) throw new MenuShopError(404, "not_found");
  // The shop whose setting is promoted is bound like any write of it (MoO+ passes for every active shop).
  requireLocation(actor, row.location_id);
  const { data, error } = await sb.rpc("promote_menu_item_shop_setting", {
    p_setting: input.settingId, p_fields: input.fields, p_expected_price: input.expected.price,
    p_expected_name: input.expected.name, p_expected_name_es: input.expected.nameEs, p_actor: actor.user.id,
    p_snapshot: snapshot,
  });
  if (error) menuShopErrorFromRpc(error.message);
  const r = data as {
    changed_shops: string[] | null; before: Record<string, unknown>;
    returned_shop: string | null; retired_setting_id: string | null; remaining_setting_id: string | null;
  };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "menu_item.shop_setting_promote", resourceTable: "menu_items", resourceId: input.menuItemId,
    metadata: {
      setting_id: input.settingId, location_id: row.location_id, fields: input.fields, before: r.before, changed_shops: r.changed_shops ?? [],
      returned_shop: r.returned_shop, remaining_setting_id: r.remaining_setting_id,
    },
    ipAddress: null, userAgent: null,
  });
  return { changedShops: r.changed_shops ?? [], returnedShop: r.returned_shop ?? null };
}
```

- [ ] **Step 5: Run, then commit**

Run: `npx vitest run tests/recipe-adopt-promote-permissions.test.ts tests/location-bind-differential.test.ts tests/audit-actions.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output.

```bash
git add lib/admin/recipe-versions.ts lib/admin/menu-item-shop.ts lib/audit-actions.ts tests/recipe-adopt-promote-permissions.test.ts
git commit -F - <<'EOF'
feat(catalog): adopt and promote recipe versions, answer a notice, promote a shop's menu price or name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 5: The server half — page views, previews, apply-with-token, the Shop changes list, the notices read

**Files:**
- Create: `lib/catalog/recipe-item.ts`, `lib/catalog/menu-item-page.ts`, `lib/catalog/shop-changes.ts`
- Modify: `lib/catalog/recipe-item-shared.ts` (the Shop changes view types)
- Test: `tests/catalog-recipe-server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Catalog Phase 3b — the server half over the fixture: the recipe page view, a shop preview that names
 * the sandwich it moves, a global preview that lists the untouched shop, apply refuses a stale token,
 * the token binds the dependency snapshot AND every number shown, promote names its returning source,
 * the menu preview's margin and field-by-field promote, and the Shop changes list's gate and paging.
 * The stand-in database has no rpc(), so the two snapshot loaders are replaced by a controllable value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import { readFileSync } from "node:fs";
import { applyRecipeChange, computeRecipePreview, loadRecipeItemView } from "@/lib/catalog/recipe-item";
import { applyMenuChange, computeMenuPreview } from "@/lib/catalog/menu-item-page";
import { loadShopChanges } from "@/lib/catalog/shop-changes";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
let snap: Record<string, unknown> = { v: 1 };
vi.mock("@/lib/admin/recipe-versions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/recipe-versions")>()),
  loadRecipeChangeSnapshot: async () => snap,
}));
vi.mock("@/lib/admin/menu-item-shop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/menu-item-shop")>()),
  loadMenuChangeSnapshot: async () => snap,
}));
let tables: ReturnType<typeof buildRecipeVersionsFixture>;

const actor = (role: RoleCode, level: number, locations: string[]): AuthContext =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;
const gm = actor("gm", 7, [LOC]);
const moo = actor("moo", 8, []);
const turkey = (qty: number) => ({ componentSkuId: "s-turkey", componentItemId: null, componentProductId: null, quantity: qty, unit: "case", eachContainerLabel: null, portioned: false });

beforeEach(() => {
  const t = buildRecipeVersionsFixture();
  // OTHER has its own Italian (so a global change leaves it untouched).
  t.recipe_versions!.push({ id: "ov-italian", recipe_id: "r-italian", location_id: OTHER, based_on_version_id: "rv-r-italian-base", adopted_from_version_id: null,
    promoted_from_version_id: null, active: true, valid_from: "2026-10-10T00:00:00Z", valid_to: null, note: null, created_at: "2026-10-10T00:00:00Z", created_by: null, retired_by: null });
  for (const l of t.recipe_version_lines!.filter((x) => x.version_id === "rv-r-italian-base")) {
    t.recipe_version_lines!.push({ ...l, id: `o-${String(l.id)}`, version_id: "ov-italian", location_id: OTHER });
  }
  t.users = [{ id: "u1", name: "Ana" }];
  snap = { v: 1 };
  tables = t;
  current = createFakeDb(t);
});
afterEach(() => { current = null; });

describe("the recipe page view", () => {
  it("a GM at its shop: riding the default, may edit its shop, not everyone; OTHER's version is listed to adopt", async () => {
    const view = (await loadRecipeItemView(gm, "r-italian", LOC))!;
    expect(view.version).toMatchObject({ ridesDefault: true, scopeVersionId: null, globalVersionId: "rv-r-italian-base" });
    expect(view.can).toEqual({ editShop: true, editGlobal: false });
    expect(view.lines.map((l) => l.lineId)).toContain("ri-03");
    expect(view.otherShopVersions.map((o) => o.shopId)).toEqual([OTHER]);
    expect(view.makes.map((m) => m.id)).toEqual(["m-italian"]);
  });
});

describe("previews", () => {
  it("a shop edit reaches that shop only and names the sandwich whose cost moves", async () => {
    const p = await computeRecipePreview(gm, "r-italian", { kind: "lines", target: { kind: "shop", shopId: LOC },
      op: { kind: "update", lineId: "ri-03", line: turkey(0.025), expected: turkey(0.0125) } });
    expect(p.reached.map((r) => r.scope)).toEqual([LOC]);
    expect(p.changes).toHaveLength(1);
    expect(p.expectedVersionId).toBeNull();
    expect(p.basedOnVersionId).toBe("rv-r-italian-base");
  });
  it("a global edit (MoO) reaches the default and LOC; OTHER (its own version) is untouched", async () => {
    const p = await computeRecipePreview(moo, "r-italian", { kind: "lines", target: { kind: "global" },
      op: { kind: "update", lineId: "ri-03", line: turkey(0.025), expected: turkey(0.0125) } });
    expect(p.reached.map((r) => r.scope)).toEqual([null, LOC]);
    expect(p.untouched.map((u) => u.shopId)).toEqual([OTHER]);
  });
  it("a GM may not preview a global save", async () => {
    await expect(computeRecipePreview(gm, "r-italian", { kind: "promote", sourceVersionId: "ov-italian" })).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
  });
  it("apply recomputes the preview and refuses a stale token", async () => {
    await expect(applyRecipeChange(gm, "r-italian", { kind: "lines", target: { kind: "shop", shopId: LOC },
      op: { kind: "update", lineId: "ri-03", line: turkey(0.025), expected: turkey(0.0125) } }, "not-the-token"))
      .rejects.toBeInstanceOf(RecipeVersionError);
  });
  const edit = { kind: "lines", target: { kind: "shop", shopId: LOC },
    op: { kind: "update", lineId: "ri-03", line: turkey(0.025), expected: turkey(0.0125) } } as const;
  it("the token binds the dependency snapshot: a moved dependency makes the old token stale (Astra 3b r1#3)", async () => {
    const a = await computeRecipePreview(gm, "r-italian", edit);
    expect(a.snapshot).toEqual({ v: 1 });
    snap = { v: 2 };
    expect((await computeRecipePreview(gm, "r-italian", edit)).token).not.toBe(a.token);
    await expect(applyRecipeChange(gm, "r-italian", edit, a.token)).rejects.toMatchObject({ code: "preview_stale" });
  });
  it("the token binds every number shown: a nested recipe that moves changes it even under the same snapshot", async () => {
    const a = await computeRecipePreview(gm, "r-italian", edit);
    const lettuce = tables.recipe_inputs!.find((r) => r.id === "ri-01")!;
    lettuce.quantity = 96; // the slaw inside the Italian now costs more — before AND after move
    const b = await computeRecipePreview(gm, "r-italian", edit);
    expect(b.token).not.toBe(a.token);
  });
  it("restore before the adoption, and back to default, say they drop the link — in the preview (Astra r6)", async () => {
    const vrow = (id: string, active: boolean, extra: Record<string, unknown>) => ({ id, recipe_id: "r-italian", location_id: LOC,
      based_on_version_id: null, adopted_from_version_id: null, promoted_from_version_id: null, active,
      valid_from: "2026-10-01T00:00:00Z", valid_to: active ? null : "2026-10-05T00:00:00Z", note: null,
      created_at: "2026-10-01T00:00:00Z", created_by: null, retired_by: null, ...extra });
    tables.recipe_versions!.push(
      vrow("pre", false, {}),                                                        // LOC's own, before adopting
      vrow("adopted", true, { adopted_from_version_id: "ov-italian", based_on_version_id: "ov-italian", valid_from: "2026-10-05T00:00:00Z" }),
    );
    for (const id of ["pre", "adopted"]) {
      for (const l of tables.recipe_version_lines!.filter((x) => x.version_id === "rv-r-italian-base")) {
        tables.recipe_version_lines!.push({ ...l, id: `${id}-${String(l.id)}`, version_id: id, location_id: LOC });
      }
    }
    const pre = await computeRecipePreview(gm, "r-italian", { kind: "restore", target: { kind: "shop", shopId: LOC }, fromVersionId: "pre" });
    expect(pre.dropsLinkTo).not.toBeNull();                      // "This drops the link to <OTHER>'s recipe …"
    const back = await computeRecipePreview(gm, "r-italian", { kind: "back_to_default", shopId: LOC });
    expect(back.dropsLinkTo).toBe(pre.dropsLinkTo);
    // a version of the adopted lineage keeps the link: no drop line
    tables.recipe_versions!.push(vrow("adopted-old", false, { adopted_from_version_id: "ov-italian", based_on_version_id: "ov-italian" }));
    for (const l of tables.recipe_version_lines!.filter((x) => x.version_id === "rv-r-italian-base")) {
      tables.recipe_version_lines!.push({ ...l, id: `ao-${String(l.id)}`, version_id: "adopted-old", location_id: LOC });
    }
    expect((await computeRecipePreview(gm, "r-italian", { kind: "restore", target: { kind: "shop", shopId: LOC }, fromVersionId: "adopted-old" })).dropsLinkTo).toBeNull();
    // History's record of the end is tested on the REAL writer's rows (tests/recipe-provenance-history.test.ts).
  });
  it("promote: the source shop RETURNS to the default (named), it is not 'untouched' (lead decision 5)", async () => {
    const p = await computeRecipePreview(moo, "r-italian", { kind: "promote", sourceVersionId: "ov-italian" });
    expect(p.returnedShop).toMatchObject({ shopId: OTHER });
    expect(p.untouched).toEqual([]);
    expect(p.reached.map((r) => r.scope)).toEqual([null, LOC]);
  });
  it("an ADDED broken line is refused at preview and named; a CARRIED one is only flagged (lead decision (b))", async () => {
    for (const p of tables.products!) if (p.id === "p-ham") p.active = false; // ri-05 (ham) is now a broken line
    const carried = await computeRecipePreview(gm, "r-italian", edit); // edits the turkey; the ham line is carried
    expect(carried.flagged.some((f) => f.reason === "invalid_component_product" && f.name.length > 0)).toBe(true);
    await expect(computeRecipePreview(gm, "r-italian", { kind: "lines", target: { kind: "shop", shopId: LOC },
      op: { kind: "add", line: { componentSkuId: null, componentItemId: null, componentProductId: "p-ham", quantity: 2, unit: "oz", eachContainerLabel: null, portioned: false } } }))
      .rejects.toMatchObject({ code: "invalid_component_product", line: { position: 7, reason: "invalid_component_product" } });
  });
  it("the menu preview: a shop price and its margin over this shop's food cost", async () => {
    const p = await computeMenuPreview(gm, "m-italian", { kind: "save", shopId: LOC, patch: { price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null } });
    expect(p.before.price).toBe(12.5);
    expect(p.after.price).toBe(13.5);
    expect(p.expectedSettingId).toBeNull();
    if (p.cost !== null) expect(p.marginAfter! - p.marginBefore!).toBeCloseTo(1, 10);
  });
  it("the menu token binds the COMPLETE patch: a Spanish-only change moves it, and an old token cannot save a new patch (Astra 3b r4#2)", async () => {
    const patch = { price: 13.5, soldHere: true, nameOverride: "Italian Grande", nameOverrideEs: "Italiano Grande" };
    const a = await computeMenuPreview(gm, "m-italian", { kind: "save", shopId: LOC, patch });
    const b = await computeMenuPreview(gm, "m-italian", { kind: "save", shopId: LOC, patch: { ...patch, nameOverrideEs: "Italiano Grandote" } });
    expect(b.after.nameEs).toBe("Italiano Grandote");
    expect(b.token).not.toBe(a.token);
    // "inherit the price" vs "this shop's own price, equal to the default": same price shown, different change
    const own = await computeMenuPreview(gm, "m-italian", { kind: "save", shopId: LOC, patch: { ...patch, price: 12.5 } });
    const inherit = await computeMenuPreview(gm, "m-italian", { kind: "save", shopId: LOC, patch: { ...patch, price: null } });
    expect(own.after.price).toBe(inherit.after.price);
    expect(own.token).not.toBe(inherit.token);
    expect(inherit.after.inherits.price).toBe(true);
    await expect(applyMenuChange(gm, "m-italian", { kind: "save", shopId: LOC, patch: { ...patch, nameOverrideEs: "Otro" } }, a.token))
      .rejects.toMatchObject({ code: "preview_stale" });
  });
  it("menu promote: field by field — a shop with its own price but the default name still changes; the source returns (Astra 3b r1#4)", async () => {
    const row = (id: string, loc: string, price: number, name: string | null) => ({
      id, menu_item_id: "m-italian", location_id: loc, based_on_setting_id: null, price, sold_here: true, name_override: name,
      name_override_es: null, active: true, valid_from: "2026-10-10T00:00:00Z", valid_to: null, note: null, created_by: null,
    });
    tables.menu_item_shop_settings!.push(row("ms-loc", LOC, 13.5, "Italian Grande"), row("ms-other", OTHER, 14, null));
    const p = await computeMenuPreview(moo, "m-italian", { kind: "promote", settingId: "ms-loc", fields: ["price", "name"] });
    expect(p.changedShops.map((c) => c.shopId)).toEqual([OTHER]);
    expect(p.returnedShop).toMatchObject({ shopId: LOC });
    // promoting the NAME also promotes the Spanish name (0263): the preview shows it (Astra 3b r5#2)
    tables.menu_item_shop_settings!.find((r) => r.id === "ms-loc")!.name_override_es = "Italiano Grande";
    const named = await computeMenuPreview(moo, "m-italian", { kind: "promote", settingId: "ms-loc", fields: ["name"] });
    expect(named.before.nameEs).toBe("Italiano");
    expect(named.after.nameEs).toBe("Italiano Grande");
    expect(readFileSync("components/catalog/ShopChangesClient.tsx", "utf8")).toContain('t("catalog.menu.preview.name_es", { before: preview.before.nameEs ?? "—", after: preview.after.nameEs ?? "—" })');
    const priceOnly = await computeMenuPreview(moo, "m-italian", { kind: "promote", settingId: "ms-loc", fields: ["price"] });
    expect(priceOnly.changedShops).toEqual([]);
  });
});

describe("the Shop changes list", () => {
  it("is MoO+; it lists OTHER's Italian with what changed against the default (nothing yet)", async () => {
    await expect(loadShopChanges(gm)).rejects.toMatchObject({ status: 403 });
    const list = await loadShopChanges(moo);
    expect(list.recipes.map((r) => [r.shopId, r.recipeId, r.sameAsDefault])).toEqual([[OTHER, "r-italian", true]]);
  });
  it("pages past the 1000-row cap: an 1,100-line shop version equal to its 1,100-line default reads as unchanged (Astra 3b r1#9)", async () => {
    for (let i = 0; i < 1098; i++) {
      tables.recipe_inputs!.push({ id: `ri-bulk-${String(i).padStart(4, "0")}`, recipe_id: "r-slaw", component_sku_id: "s-lettuce",
        component_item_id: null, component_product_id: null, quantity: 1, unit: "oz", each_container_label: null, portioned: false, display_order: 100 + i });
    }
    tables.recipe_versions!.push({ id: "lv-slaw", recipe_id: "r-slaw", location_id: LOC, based_on_version_id: "rv-r-slaw-base", adopted_from_version_id: null,
      promoted_from_version_id: null, active: true, valid_from: "2026-10-11T00:00:00Z", valid_to: null, note: null, created_at: "2026-10-11T00:00:00Z", created_by: null, retired_by: null });
    const slaw = tables.recipe_inputs!.filter((r) => r.recipe_id === "r-slaw");
    expect(slaw).toHaveLength(1100);
    slaw.forEach((r, i) => tables.recipe_version_lines!.push({
      id: `lv-${String(i).padStart(4, "0")}`, version_id: "lv-slaw", recipe_id: "r-slaw", location_id: LOC,
      component_sku_id: r.component_sku_id ?? null, component_item_id: r.component_item_id ?? null, component_product_id: r.component_product_id ?? null,
      quantity: r.quantity, unit: r.unit ?? null, each_container_label: null, portioned: false, display_order: Number(r.display_order ?? i), source_line_id: r.id,
    }));
    const row = (await loadShopChanges(moo)).recipes.find((r) => r.versionId === "lv-slaw")!;
    expect(row.changes).toEqual([]);
    expect(row.sameAsDefault).toBe(true);
  });
});
```

Run: `npx vitest run tests/catalog-recipe-server.test.ts` → FAIL (module not found).

- [ ] **Step 1b: History reads the REAL writer's record (Astra r7)** — create `tests/recipe-provenance-history.test.ts`. It runs 3a's 0258 + 0262 in PGlite (`tests/fixtures/recipe-versions-pglite.ts`, 3a Task 3 Step 6b) through the four sequences and feeds the rows the writers produced to the History view-model:

```ts
/** Catalog Phase 3b — History's "Link to <shop>'s recipe ended" comes from what 0262 WROTE, for every way a link ends. */
import { beforeAll, describe, expect, it } from "vitest";
import { ID, migratedRecipeDb, runProvenanceSequences, versionRows } from "./fixtures/recipe-versions-pglite";
import { historyLinkEndedSource } from "@/lib/catalog/recipe-item-shared";

describe("History's link-ended entries, from the writer's real rows", () => {
  let ids: Awaited<ReturnType<typeof runProvenanceSequences>>;
  let byId: Map<string, { locationId: string | null; adoptedFromVersionId: string | null; adoptionEndedFromVersionId: string | null }>;
  beforeAll(async () => {
    const db = await migratedRecipeDb();
    ids = await runProvenanceSequences(db);
    byId = new Map((await versionRows(db)).map((r) => [r.id, {
      locationId: r.location_id, adoptedFromVersionId: r.adopted_from_version_id, adoptionEndedFromVersionId: r.adoption_ended_from_version_id,
    }]));
  }, 60_000);
  const ended = (id: string) => historyLinkEndedSource(byId.get(id)!, byId);

  it("adopt → restore a pre-adoption version: the new row says the link to the source shop ended", () => {
    expect(ended(ids.restoredPre)).toBe(ID.source);
  });
  it("adopt → restore global history: the same", () => {
    expect(ended(ids.restoredGlobal)).toBe(ID.source);
  });
  it("adopt → restore pre-adoption → back to default: BOTH entries survive — the restore's row still says the link ended (Astra r8)", () => {
    expect(ended(ids.restoredPre)).toBe(ID.source);
    expect(ended(ids.adopted1)).toBeNull();
  });
  it("adopt → back to default: the retired row says so", () => {
    expect(ended(ids.adopted3)).toBe(ID.source);
  });
  it("adopt → edit → restore the adopted lineage: no row says the link ended", () => {
    for (const id of [ids.adopted4, ids.edited4, ids.restoredLineage, ids.adopted1, ids.pre1]) expect(ended(id)).toBeNull();
  });
});
```

Run: `npx vitest run tests/recipe-provenance-history.test.ts` → FAIL until Step 2 adds `historyLinkEndedSource`; then 4 passed.

- [ ] **Step 2: Append the Shop changes view types to `lib/catalog/recipe-item-shared.ts`**

```ts
// ── The Shop changes list (MoO+, catalog Phase 3b) ────────────────────────────

export interface ShopChangeRecipeRow {
  recipeId: string;
  recipeName: string;
  versionId: string;
  shopId: string;
  shopName: string;
  validFrom: string;
  createdByName: string | null;
  adoptedFromShopName: string | null;
  changes: RecipeLineChange[];
  sameAsDefault: boolean;
}

export interface ShopChangeMenuRow {
  menuItemId: string;
  menuItemName: string;
  settingId: string;
  shopId: string;
  shopName: string;
  validFrom: string;
  createdByName: string | null;
  price: number | null;
  soldHere: boolean;
  nameOverride: string | null;
  nameOverrideEs: string | null;
  global: { price: number | null; name: string; nameEs: string | null };
}

export interface ShopChangesView {
  recipes: ShopChangeRecipeRow[];
  menu: ShopChangeMenuRow[];
  /** recipeLineTargetKey → display name, for every change listed. */
  names: Record<string, string>;
}
```

- [ ] **Step 3: Create `lib/catalog/recipe-item.ts`**

```ts
/**
 * The RECIPE PAGE — server half (catalog Phase 3b; spec §3, §4, §6). SERVER-ONLY, service role.
 *   loadRecipeItemView   — what the page shows for one recipe at one scope (global or a shop).
 *   computeRecipePreview — "What this changes" for ONE act (lines / restore / back to default / adopt /
 *                          promote) at its save target: every reached scope's graph before and after
 *                          (3a's recipeOverrides — a hypothetical ingredient resolves like a real one),
 *                          the sandwiches whose cost moves, the shops left untouched, and the token.
 *   applyRecipeChange    — recomputes the preview, refuses preview_stale on any difference, then calls
 *                          3a's gated writer. The SQL compare-and-set stays the real guard.
 * Gates: a preview is offered only to someone who may SAVE that target (recipeVersionWriteGate), so a
 * preview never shows a choice the save would refuse. Reads of versions are org-wide at 6.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { loadRecipeGraph, loadSkuPackResolution } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph } from "@/lib/admin/menu-costing";
import { rollupItemCost, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { loadRecipeBuilderCatalog } from "@/lib/admin/recipe-builder-data";
import { catalogShopAllowed, type VersionScope } from "@/lib/sku-versions-shared";
import { lineFromRow, recipeLineKind, type RecipeLineFields, type RecipeLineRow } from "@/lib/recipe-line-shared";
import {
  RECIPE_VERSION_READ_MIN, addedLinePositions, applyRecipeLineOp, diffRecipeLineSets, recipeLineProblem, recipeLineTargetKey,
  recipeVersionWriteGate, type RecipeVersionLineRow,
} from "@/lib/recipe-versions-shared";
import {
  RecipeVersionError, adoptRecipeVersion, loadRecipeChangeSnapshot, loadRecipeLiveSet, loadRecipeVersionHistory,
  promoteRecipeVersion, restoreRecipeVersion, retireShopRecipeVersion, saveRecipeLines,
} from "@/lib/admin/recipe-versions";
import { selectAllRows } from "@/lib/supabase-paginate";
import { menuCostDeltas, recipePreviewToken, type RecipePreview, type ScopeImpact } from "@/lib/catalog/recipe-preview-shared";
import { historyLinkEndedSource, recipeChangeTarget, scopedPickerSkus, type RecipeChangeRequest, type RecipeItemView } from "@/lib/catalog/recipe-item-shared";
import { computeShopNotices } from "@/lib/catalog/shop-changes";

type Sb = ReturnType<typeof getServiceRoleClient>;

export async function loadActiveShops(sb: Sb): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await sb.from("locations").select("id, name").eq("active", true).order("name", { ascending: true })
    .returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`catalog shops: ${error.message}`);
  return data ?? [];
}

/** recipeLineTargetKey → display name (and SKU → vendor name) for every line given. */
export async function lineNames(sb: Sb, lines: readonly RecipeLineFields[]): Promise<{ names: Record<string, string>; vendorBySku: Map<string, string | null> }> {
  const skuIds = [...new Set(lines.map((l) => l.componentSkuId).filter((v): v is string => v !== null))];
  const itemIds = [...new Set(lines.map((l) => l.componentItemId).filter((v): v is string => v !== null))];
  const productIds = [...new Set(lines.map((l) => l.componentProductId).filter((v): v is string => v !== null))];
  const [skus, items, products] = await Promise.all([
    skuIds.length ? sb.from("vendor_items").select("id, name, vendor_id").in("id", skuIds).returns<Array<{ id: string; name: string; vendor_id: string | null }>>() : Promise.resolve({ data: [] as Array<{ id: string; name: string; vendor_id: string | null }>, error: null }),
    itemIds.length ? sb.from("items").select("id, name").in("id", itemIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
    productIds.length ? sb.from("products").select("id, name").in("id", productIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
  ]);
  for (const r of [skus, items, products]) if (r.error) throw new Error(`catalog line names: ${r.error.message}`);
  const vendorIds = [...new Set((skus.data ?? []).map((s) => s.vendor_id).filter((v): v is string => v !== null))];
  const { data: vendors, error: vErr } = vendorIds.length
    ? await sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (vErr) throw new Error(`catalog vendor names: ${vErr.message}`);
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const names: Record<string, string> = {};
  for (const s of skus.data ?? []) names[`sku:${s.id}`] = s.name;
  for (const i of items.data ?? []) names[`item:${i.id}`] = i.name;
  for (const p of products.data ?? []) names[`product:${p.id}`] = p.name;
  return { names, vendorBySku: new Map((skus.data ?? []).map((s) => [s.id, s.vendor_id ? (vendorName.get(s.vendor_id) ?? null) : null])) };
}

/** What `recipeLineProblem` needs for these lines: which of their products are active, and the active measures. */
async function lineProblemContext(sb: Sb, lines: readonly RecipeLineFields[]): Promise<{ activeProductIds: Set<string>; activeMeasureLabels: Set<string> }> {
  const productIds = [...new Set(lines.map((f) => f.componentProductId).filter((v): v is string => v !== null))];
  const [products, measures] = await Promise.all([
    productIds.length
      ? sb.from("products").select("id").in("id", productIds).eq("active", true).returns<Array<{ id: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
    sb.from("measure_units").select("label").eq("active", true).returns<Array<{ label: string }>>(),
  ]);
  if (products.error) throw new Error(`catalog line flags products: ${products.error.message}`);
  if (measures.error) throw new Error(`catalog line flags measures: ${measures.error.message}`);
  return { activeProductIds: new Set((products.data ?? []).map((p) => p.id)), activeMeasureLabels: new Set((measures.data ?? []).map((m) => m.label)) };
}

function gateFor(actor: AuthContext, scope: VersionScope) {
  return recipeVersionWriteGate({ level: actor.level, scope, scopeAllowed: scope !== null && catalogShopAllowed(actor, scope) });
}

/** One version's lines (any scope), or null. */
async function versionWithLines(sb: Sb, versionId: string): Promise<{ id: string; recipe_id: string; location_id: string | null; active: boolean; adopted_from_version_id: string | null; lines: RecipeLineFields[] } | null> {
  const { data: v, error } = await sb.from("recipe_versions").select("id, recipe_id, location_id, active, adopted_from_version_id").eq("id", versionId)
    .maybeSingle<{ id: string; recipe_id: string; location_id: string | null; active: boolean; adopted_from_version_id: string | null }>();
  if (error) throw new Error(`catalog version: ${error.message}`);
  if (!v) return null;
  // Paged like every version line-set read (Astra 3a r1#6 / 3b r1#9).
  const rows = await selectAllRows<RecipeLineRow & { id: string; display_order: number | null }>(async (from, to) => {
    const { data, error: lErr } = await sb.from("recipe_version_lines")
      .select("component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order, id")
      .eq("version_id", versionId).order("display_order", { ascending: true }).order("id", { ascending: true })
      .range(from, to).returns<Array<RecipeLineRow & { id: string; display_order: number | null }>>();
    if (lErr) throw new Error(`catalog version lines: ${lErr.message}`);
    return { data };
  });
  return { ...v, lines: rows.map(lineFromRow) };
}

export async function loadRecipeItemView(actor: AuthContext, recipeId: string, scope: VersionScope): Promise<RecipeItemView | null> {
  if (actor.level < RECIPE_VERSION_READ_MIN) throw new RecipeVersionError(403, "forbidden");
  const sb = getServiceRoleClient();
  const shops = await loadActiveShops(sb);
  if (scope !== null && !shops.some((s) => s.id === scope)) throw new RecipeVersionError(404, "not_found");
  const { data: recipe, error: rErr } = await sb.from("recipes").select("id, name, name_es, recipe_type, active").eq("id", recipeId)
    .maybeSingle<{ id: string; name: string; name_es: string | null; recipe_type: "production" | "consumer"; active: boolean | null }>();
  if (rErr) throw new Error(`loadRecipeItemView recipe: ${rErr.message}`);
  if (!recipe) return null;

  const live = await loadRecipeLiveSet(recipeId, scope);
  const globalSet = scope === null || live.ridesDefault ? live : await loadRecipeLiveSet(recipeId, null);
  const all = await loadRecipeVersionHistory(actor, recipeId, scope, { allShops: true });
  const shopName = (id: string | null) => (id === null ? null : (shops.find((s) => s.id === id)?.name ?? null));
  const byId = new Map(all.map((v) => [v.id, v]));
  const ownLive = scope === null ? null : all.find((v) => v.locationId === scope && v.active) ?? null;
  const others = all.filter((v) => v.locationId !== null && v.locationId !== scope && v.active);

  const globalFields = globalSet.lines.map((l) => l.fields);
  const involved = [...live.lines.map((l) => l.fields), ...globalFields, ...others.flatMap((o) => o.lines)];
  const { names, vendorBySku } = await lineNames(sb, involved);
  const globalKeys = new Set(globalFields.map((f) => JSON.stringify(f)));

  // What it makes, and what that costs HERE.
  const { data: outs, error: oErr } = await sb.from("recipe_outputs").select("output_item_id, output_menu_item_id, yield").eq("recipe_id", recipeId)
    .returns<Array<{ output_item_id: string | null; output_menu_item_id: string | null; yield: number | string }>>();
  if (oErr) throw new Error(`loadRecipeItemView outputs: ${oErr.message}`);
  const outItemIds = (outs ?? []).map((o) => o.output_item_id).filter((v): v is string => v !== null);
  const outMenuIds = (outs ?? []).map((o) => o.output_menu_item_id).filter((v): v is string => v !== null);
  const [itemRows, menuRows, graph] = await Promise.all([
    outItemIds.length ? sb.from("items").select("id, name").in("id", outItemIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
    outMenuIds.length ? sb.from("menu_items").select("id, name, name_es").in("id", outMenuIds).returns<Array<{ id: string; name: string; name_es: string | null }>>() : Promise.resolve({ data: [] as Array<{ id: string; name: string; name_es: string | null }>, error: null }),
    loadRecipeGraph(scope === null ? undefined : { locationId: scope }),
  ]);
  for (const r of [itemRows, menuRows]) if (r.error) throw new Error(`loadRecipeItemView connections: ${r.error.message}`);
  // "USED IN" FROM THE SAME SCOPE-RESOLVED GRAPH (Astra 3b r1#7): a shop recipe that adds or drops this
  // prep item shows here exactly as that shop makes it — never the global recipe_inputs.
  const outItemSet = new Set(outItemIds);
  const usedInIds = [...new Set([...new Set([...graph.byOutputItem.values(), ...graph.byOutputMenuItem.values()])]
    .filter((r) => r.recipeId !== recipeId && r.inputs.some((i) => i.componentItemId != null && outItemSet.has(i.componentItemId)))
    .map((r) => r.recipeId))];
  const { data: usedIn, error: uErr } = usedInIds.length
    ? await sb.from("recipes").select("id, name").in("id", usedInIds).eq("active", true).order("name").returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (uErr) throw new Error(`loadRecipeItemView used-in: ${uErr.message}`);
  const costPerOz = costPerOzFromGraph(graph, await loadCurrentSkuPrices([...graph.skuPack.keys()], scope));
  const makes: RecipeItemView["makes"] = (outs ?? []).map((o) => o.output_item_id
    ? { kind: "item" as const, id: o.output_item_id, name: (itemRows.data ?? []).find((i) => i.id === o.output_item_id)?.name ?? "", nameEs: null, yield: Number(o.yield), costHere: rollupItemCost(graph, o.output_item_id, costPerOz).cost }
    : { kind: "menu_item" as const, id: o.output_menu_item_id!, name: (menuRows.data ?? []).find((m) => m.id === o.output_menu_item_id)?.name ?? "", nameEs: (menuRows.data ?? []).find((m) => m.id === o.output_menu_item_id)?.name_es ?? null, yield: Number(o.yield), costHere: rollupMenuItemCost(graph, o.output_menu_item_id!, costPerOz).cost });

  const catalog = await loadRecipeBuilderCatalog();
  // The SHOP's packs for the picker (Astra 3b r4#1): 2a's resolver, paged and chunked, as of now.
  const pickerPacks = await loadSkuPackResolution(catalog.skus.map((s) => s.id), scope);
  const canEditShop = scope !== null && gateFor(actor, scope).ok;
  const notices = canEditShop && scope !== null
    ? (await computeShopNotices(sb, scope, new Date().toISOString())).filter((n) => n.recipeId === recipeId)
    : [];
  const adoptedFrom = ownLive?.adoptedFromVersionId ? byId.get(ownLive.adoptedFromVersionId) : undefined;
  const flagCtx = await lineProblemContext(sb, live.lines.map((l) => l.fields));

  return {
    recipe: { id: recipe.id, name: recipe.name, nameEs: recipe.name_es, recipeType: recipe.recipe_type, active: recipe.active !== false },
    shops, scope, scopeName: shopName(scope),
    can: { editShop: canEditShop, editGlobal: gateFor(actor, null).ok },
    version: {
      scopeVersionId: live.scopeVersionId, globalVersionId: live.globalVersionId, ridesDefault: live.ridesDefault,
      adoptedFromShopName: adoptedFrom ? shopName(adoptedFrom.locationId) : null,
      validFrom: ownLive?.validFrom ?? null,
    },
    lines: live.lines.map((l) => ({
      lineId: l.lineId!, fields: l.fields, name: names[recipeLineTargetKey(l.fields)] ?? recipeLineTargetKey(l.fields),
      kind: recipeLineKind(l.fields), vendorName: l.fields.componentSkuId ? (vendorBySku.get(l.fields.componentSkuId) ?? null) : null,
      changedHere: scope !== null && !live.ridesDefault && !globalKeys.has(JSON.stringify(l.fields)),
      problem: recipeLineProblem(l.fields, flagCtx),
    })),
    differsFromDefault: scope !== null && !live.ridesDefault ? diffRecipeLineSets(globalFields, live.lines.map((l) => l.fields)) : [],
    makes,
    usedIn: usedIn ?? [],
    vendors: [...new Set([...vendorBySku.values()].filter((v): v is string => v !== null))].sort(),
    otherShopVersions: others.map((o) => ({
      versionId: o.id, shopId: o.locationId!, shopName: shopName(o.locationId) ?? "", validFrom: o.validFrom, createdByName: o.createdByName,
      changes: diffRecipeLineSets(globalFields, o.lines),
    })),
    notices,
    history: all.filter((v) => v.locationId === null || v.locationId === scope).map((v) => ({
      id: v.id, scope: v.locationId === null ? "global" as const : "shop" as const, shopName: shopName(v.locationId), active: v.active,
      validFrom: v.validFrom, validTo: v.validTo, who: v.createdByName, note: v.note, lineCount: v.lines.length,
      promotedFromShopName: v.promotedFromVersionId ? shopName(byId.get(v.promotedFromVersionId)?.locationId ?? null) : null,
      adoptedFromShopName: v.adoptedFromVersionId ? shopName(byId.get(v.adoptedFromVersionId)?.locationId ?? null) : null,
      // The END of an adoption link is what 0262 RECORDED on this row (Astra r7) — never inferred from based_on.
      linkEndedFromShopName: shopName(historyLinkEndedSource(v, byId)),
    })),
    names,
    picker: {
      skus: scopedPickerSkus(catalog.skus, pickerPacks), items: catalog.items, products: catalog.products,
      measures: [...catalog.measures].map(([label, m]) => ({ label, dimension: m.dimension, toBaseFactor: m.toBaseFactor })),
      activeMeasureLabels: catalog.activeMeasureLabels,
    },
  };
}

export async function computeRecipePreview(actor: AuthContext, recipeId: string, change: RecipeChangeRequest): Promise<RecipePreview> {
  const target = recipeChangeTarget(change);
  const scope: VersionScope = target.kind === "shop" ? target.shopId : null;
  const gate = gateFor(actor, scope);
  if (!gate.ok) throw new RecipeVersionError(gate.status, gate.code);
  const sb = getServiceRoleClient();
  const live = await loadRecipeLiveSet(recipeId, scope);
  if (!live.recipeActive) throw new RecipeVersionError(409, "recipe_inactive");
  const before = live.lines.map((l) => l.fields);
  let after: RecipeLineFields[];
  let sourceVersionId: string | null = null;
  let sourceShopId: string | null = null;
  let restoredAdoptedFrom: string | null = null;
  switch (change.kind) {
    case "lines": {
      const r = applyRecipeLineOp(live.lines, change.op);
      if (!r.ok) throw new RecipeVersionError(r.status, r.code);
      if (!r.changed) throw new RecipeVersionError(400, "nothing_changed");
      after = r.lines.map((l) => l.fields);
      break;
    }
    case "restore": {
      const v = await versionWithLines(sb, change.fromVersionId);
      if (!v || v.recipe_id !== recipeId || (v.location_id !== null && v.location_id !== scope)) throw new RecipeVersionError(404, "not_found");
      after = v.lines;
      sourceVersionId = v.id;
      restoredAdoptedFrom = v.adopted_from_version_id;
      break;
    }
    case "back_to_default": {
      if (live.ridesDefault || live.scopeVersionId === null) throw new RecipeVersionError(409, "not_live");
      after = (await loadRecipeLiveSet(recipeId, null)).lines.map((l) => l.fields);
      break;
    }
    case "adopt": {
      const v = await versionWithLines(sb, change.sourceVersionId);
      if (!v || v.recipe_id !== recipeId || v.location_id === null || v.location_id === scope || !v.active) throw new RecipeVersionError(400, "invalid_source");
      after = v.lines;
      sourceVersionId = v.id;
      break;
    }
    case "promote": {
      const v = await versionWithLines(sb, change.sourceVersionId);
      if (!v || v.recipe_id !== recipeId || v.location_id === null || !v.active) throw new RecipeVersionError(400, "invalid_source");
      after = v.lines;
      sourceVersionId = v.id;
      sourceShopId = v.location_id;
      break;
    }
  }

  // THE SCOPED DEPENDENCY SNAPSHOT (lead decision (a)), taken as soon as the set being written is known and BEFORE
  // any number is computed: every number below comes from a state no later than this one. The token binds it; the
  // writer re-derives the same closure (recipe, scope, these lines), locks it and re-checks it.
  const snapshot = await loadRecipeChangeSnapshot(recipeId, scope, after);

  // WHO IT REACHES: a shop target → that shop; a global target → the default itself and every active
  // shop riding it for this recipe. A shop with its own live version is untouched.
  const shops = await loadActiveShops(sb);
  let reachedScopes: VersionScope[];
  let untouched: RecipePreview["untouched"] = [];
  if (scope !== null) {
    reachedScopes = [scope];
  } else {
    const { data: own, error } = await sb.from("recipe_versions").select("location_id").eq("recipe_id", recipeId).eq("active", true).not("location_id", "is", null)
      .returns<Array<{ location_id: string }>>();
    if (error) throw new Error(`computeRecipePreview shops: ${error.message}`);
    const ownSet = new Set((own ?? []).map((r) => r.location_id));
    reachedScopes = [null, ...shops.filter((s) => !ownSet.has(s.id)).map((s) => s.id)];
    // PROMOTE: the source shop is neither reached (its food does not change) nor untouched — it RETURNS to
    // the default in the same save (lead decision 5), shown on its own line.
    untouched = shops.filter((s) => ownSet.has(s.id) && s.id !== sourceShopId).map((s) => ({ shopId: s.id, shopName: s.name }));
  }
  const returnedShop = change.kind === "promote" && sourceShopId !== null
    ? { shopId: sourceShopId, shopName: shops.find((s) => s.id === sourceShopId)?.name ?? "" }
    : null;
  // PROVENANCE FOLLOWS THE CONTENT (lead decision, Astra r6): restoring a version from BEFORE the adoption (it carries
  // no adoption pointer) — like going back to the default — ends this shop's link to the shop it adopted from. Said
  // plainly before saving. Restoring a version of the adopted lineage keeps the link (0262 copies its pointer).
  let dropsLinkTo: string | null = null;
  if (scope !== null && live.scopeVersionId && (change.kind === "back_to_default" || (change.kind === "restore" && restoredAdoptedFrom === null))) {
    const current = await versionWithLines(sb, live.scopeVersionId);
    if (current?.adopted_from_version_id) {
      const src = await versionWithLines(sb, current.adopted_from_version_id);
      dropsLinkTo = src?.location_id ? (shops.find((s) => s.id === src.location_id)?.name ?? "") : null;
    }
  }

  const { data: menu, error: mErr } = await sb.from("menu_items").select("id, name, name_es").eq("active", true).order("name")
    .returns<Array<{ id: string; name: string; name_es: string | null }>>();
  if (mErr) throw new Error(`computeRecipePreview menu: ${mErr.message}`);
  const menuIds = (menu ?? []).map((m) => m.id);
  const menuNames = new Map((menu ?? []).map((m) => [m.id, { name: m.name, nameEs: m.name_es }]));
  const { data: outs, error: oErr } = await sb.from("recipe_outputs").select("output_item_id").eq("recipe_id", recipeId).not("output_item_id", "is", null)
    .returns<Array<{ output_item_id: string }>>();
  if (oErr) throw new Error(`computeRecipePreview outputs: ${oErr.message}`);
  const outItemIds = (outs ?? []).map((o) => o.output_item_id);
  const { names } = await lineNames(sb, [...before, ...after]);
  // LEAD DECISION (b) at preview time: a line the save ADDS that would fail is refused HERE, naming it (the writer
  // refuses it again under its locks); a line it only CARRIES is flagged on the preview, never refused.
  const flagCtx = await lineProblemContext(sb, after);
  // An EDIT may carry lines (counted with multiplicity); a COPIED set — restore, adopt, promote — carries nothing:
  // every line it copies is an addition (Astra 3a r3#3). Back to default writes no new line of its own.
  const added = new Set(change.kind === "lines" ? addedLinePositions(before, after)
    : change.kind === "back_to_default" ? [] : after.map((_, i) => i + 1));
  const flagged: RecipePreview["flagged"] = [];
  after.forEach((f, i) => {
    const reason = recipeLineProblem(f, flagCtx);
    if (!reason) return;
    const line = { position: i + 1, name: names[recipeLineTargetKey(f)] ?? recipeLineTargetKey(f), reason };
    if (added.has(i + 1)) throw new RecipeVersionError(400, reason, undefined, line);
    flagged.push(line);
  });
  const { data: itemNames, error: iErr } = outItemIds.length
    ? await sb.from("items").select("id, name").in("id", outItemIds).returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (iErr) throw new Error(`computeRecipePreview items: ${iErr.message}`);

  const overrideRows: RecipeVersionLineRow[] = after.map((f, i) => ({
    id: `preview-${i}`, version_id: "preview", recipe_id: recipeId,
    component_sku_id: f.componentSkuId, component_item_id: f.componentItemId, component_product_id: f.componentProductId,
    quantity: f.quantity, unit: f.unit, each_container_label: f.eachContainerLabel, portioned: f.portioned, display_order: i,
  }));
  const reached: ScopeImpact[] = [];
  for (const s of reachedScopes) {
    const opts = s === null ? {} : { locationId: s };
    const [gBefore, gAfter] = await Promise.all([
      loadRecipeGraph(opts),
      loadRecipeGraph({ ...opts, recipeOverrides: new Map([[recipeId, overrideRows]]) }),
    ]);
    const prices = await loadCurrentSkuPrices([...new Set([...gBefore.skuPack.keys(), ...gAfter.skuPack.keys()])], s);
    const cb = costPerOzFromGraph(gBefore, prices);
    const ca = costPerOzFromGraph(gAfter, prices);
    reached.push({
      scope: s, scopeName: s === null ? null : (shops.find((x) => x.id === s)?.name ?? null),
      menu: menuCostDeltas(menuIds, menuNames, { graph: gBefore, costPerOz: cb }, { graph: gAfter, costPerOz: ca }),
      items: outItemIds.map((id) => ({
        itemId: id, name: (itemNames ?? []).find((i) => i.id === id)?.name ?? id,
        before: rollupItemCost(gBefore, id, cb).cost, after: rollupItemCost(gAfter, id, ca).cost,
      })),
    });
  }

  const expectedVersionId = live.scopeVersionId;
  const basedOnVersionId = live.ridesDefault ? live.globalVersionId : null;
  // THE TOKEN BINDS THE SNAPSHOT AND EVERY NUMBER SHOWN (Astra 3b r1#3): a price, a pack, a nested recipe or
  // a shop's own version that moved changes the snapshot; a number that moved changes the impacts.
  const token = recipePreviewToken({
    kind: change.kind, recipeId, target, expectedVersionId, basedOnVersionId, sourceVersionId, snapshot,
    after: after.map((f) => [f.componentSkuId, f.componentItemId, f.componentProductId, f.quantity, f.unit, f.eachContainerLabel, f.portioned]),
    reached: reached.map((r) => ({
      scope: r.scope,
      menu: r.menu.map((m) => [m.menuItemId, m.before, m.after, m.statusBefore, m.statusAfter]),
      items: r.items.map((i) => [i.itemId, i.before, i.after]),
    })),
    untouched: untouched.map((u) => u.shopId), returnedShop: returnedShop?.shopId ?? null,
    flagged: flagged.map((f) => [f.position, f.reason]), dropsLinkTo,
  });
  return {
    kind: change.kind, recipeId, target, changes: diffRecipeLineSets(before, after), names, reached, untouched, returnedShop,
    flagged, dropsLinkTo, expectedVersionId, basedOnVersionId, token, snapshot,
  };
}

/** Save EXACTLY what the preview showed: recompute it, refuse preview_stale on any difference, then write. */
export async function applyRecipeChange(
  actor: AuthContext, recipeId: string, change: RecipeChangeRequest, token: string,
): Promise<{ versionId: string | null }> {
  const preview = await computeRecipePreview(actor, recipeId, change);
  if (preview.token !== token) throw new RecipeVersionError(409, "preview_stale");
  const scope: VersionScope = preview.target.kind === "shop" ? preview.target.shopId : null;
  // The SAME snapshot the matching token was computed on goes to the writer; SQL re-takes it under the
  // graph lock and refuses dependencies_changed if anything moved since (the 0261 pattern).
  const snapshot = preview.snapshot;
  switch (change.kind) {
    case "lines": {
      const r = await saveRecipeLines(actor, { recipeId, scope, expectedVersionId: preview.expectedVersionId, basedOnVersionId: preview.basedOnVersionId, op: change.op, snapshot });
      return { versionId: r.versionId };
    }
    case "restore": {
      const r = await restoreRecipeVersion(actor, { recipeId, scope, fromVersionId: change.fromVersionId, expectedVersionId: preview.expectedVersionId, basedOnVersionId: preview.basedOnVersionId, snapshot });
      return { versionId: r.versionId };
    }
    case "back_to_default": {
      await retireShopRecipeVersion(actor, { recipeId, versionId: preview.expectedVersionId!, locationId: change.shopId, snapshot });
      return { versionId: null };
    }
    case "adopt": {
      const r = await adoptRecipeVersion(actor, { recipeId, locationId: change.shopId, sourceVersionId: change.sourceVersionId, expectedVersionId: preview.expectedVersionId, basedOnVersionId: preview.basedOnVersionId, snapshot });
      return { versionId: r.versionId };
    }
    case "promote": {
      const r = await promoteRecipeVersion(actor, { recipeId, sourceVersionId: change.sourceVersionId, expectedGlobalVersionId: preview.expectedVersionId, snapshot });
      return { versionId: r.versionId };
    }
  }
}
```

- [ ] **Step 4: Create `lib/catalog/menu-item-page.ts`**

```ts
/**
 * The MENU ITEM PAGE — server half (catalog Phase 3b; spec §3 "menu items incl. shop price and sold
 * here", §4). SERVER-ONLY. The view, the preview of ONE act (save / back to default / restore / promote)
 * with this scope's food cost and the margin before → after, and apply-with-token over 3a's gated writers.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph } from "@/lib/admin/menu-costing";
import { rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { catalogShopAllowed, NIL_SCOPE, type VersionScope } from "@/lib/sku-versions-shared";
import { loadLiveMenuItemShopSettings, MENU_SHOP_SETTING_COLUMNS } from "@/lib/menu-item-shop";
import {
  menuPromoteGate, menuShopWriteGate, resolveMenuItemForShop, type MenuItemShopSettingRow,
} from "@/lib/menu-item-shop-shared";
import {
  MenuShopError, loadMenuChangeSnapshot, loadMenuItemShopHistory, promoteMenuItemShopSetting, restoreMenuItemShopSetting,
  retireMenuItemShopSetting, saveMenuItemShopSetting,
} from "@/lib/admin/menu-item-shop";
import {
  menuPreviewMath, menuPreviewToken, menuPromoteChangedShops, normalizeMenuPatch, type MenuPreview, type MenuPreviewSide,
} from "@/lib/catalog/recipe-preview-shared";
import type { MenuChangeRequest, MenuItemPageView } from "@/lib/catalog/recipe-item-shared";
import { loadActiveShops } from "@/lib/catalog/recipe-item";

type Sb = ReturnType<typeof getServiceRoleClient>;
type MenuRow = { id: string; name: string; name_es: string | null; menu_price: number | string | null; section: string | null; active: boolean };

const num = (v: number | string | null): number | null => (v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function loadItem(sb: Sb, menuItemId: string): Promise<MenuRow | null> {
  const { data, error } = await sb.from("menu_items").select("id, name, name_es, menu_price, section, active").eq("id", menuItemId).maybeSingle<MenuRow>();
  if (error) throw new Error(`menu item: ${error.message}`);
  return data && data.active ? data : null;
}

async function costAt(menuItemId: string, scope: VersionScope): Promise<number | null> {
  const graph = await loadRecipeGraph(scope === null ? undefined : { locationId: scope });
  const costPerOz = costPerOzFromGraph(graph, await loadCurrentSkuPrices([...graph.skuPack.keys()], scope));
  return rollupMenuItemCost(graph, menuItemId, costPerOz).cost;
}

export async function loadMenuItemPageView(actor: AuthContext, menuItemId: string, scope: VersionScope): Promise<MenuItemPageView | null> {
  if (actor.level < 6) throw new MenuShopError(403, "forbidden");
  const sb = getServiceRoleClient();
  const shops = await loadActiveShops(sb);
  if (scope !== null && !shops.some((s) => s.id === scope)) throw new MenuShopError(404, "not_found");
  const item = await loadItem(sb, menuItemId);
  if (!item) return null;
  const setting = scope === null ? undefined : (await loadLiveMenuItemShopSettings(scope)).get(menuItemId);
  const here = resolveMenuItemForShop({ id: item.id, name: item.name, nameEs: item.name_es, menuPrice: num(item.menu_price) }, setting);
  const [{ data: outs, error: oErr }, toast] = await Promise.all([
    sb.from("recipe_outputs").select("recipe_id").eq("output_menu_item_id", menuItemId).returns<Array<{ recipe_id: string }>>(),
    (() => {
      const q = sb.from("toast_menu_map").select("id").eq("menu_item_id", menuItemId).eq("active", true).eq("match_status", "confirmed");
      return (scope === null ? q : q.eq("location_id", scope)).returns<Array<{ id: string }>>();
    })(),
  ]);
  if (oErr) throw new Error(`menu item recipe: ${oErr.message}`);
  if (toast.error) throw new Error(`menu item toast links: ${toast.error.message}`);
  const recipeIds = [...new Set((outs ?? []).map((o) => o.recipe_id))];
  const { data: recipes, error: rErr } = recipeIds.length
    ? await sb.from("recipes").select("id, name").in("id", recipeIds).eq("active", true).order("created_at", { ascending: true, nullsFirst: true }).order("id", { ascending: true })
        .returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (rErr) throw new Error(`menu item recipes: ${rErr.message}`);
  const history = scope === null ? [] : await loadMenuItemShopHistory(actor, menuItemId, scope);
  return {
    item: { id: item.id, name: item.name, nameEs: item.name_es, menuPrice: num(item.menu_price), section: item.section },
    shops, scope, scopeName: scope === null ? null : (shops.find((s) => s.id === scope)?.name ?? null),
    can: { editShop: scope !== null && menuShopWriteGate({ level: actor.level, scopeAllowed: catalogShopAllowed(actor, scope) }).ok },
    here: {
      settingId: setting?.id ?? null, price: num(setting?.price ?? null), soldHere: setting?.sold_here ?? true,
      nameOverride: setting?.name_override ?? null, nameOverrideEs: setting?.name_override_es ?? null,
      name: here.name, nameEs: here.nameEs, typedPrice: here.typedPrice,
    },
    cost: await costAt(menuItemId, scope),
    recipe: recipes?.[0] ?? null,
    toastLinks: (toast.data ?? []).length,
    history: history.map((h) => ({
      id: h.id, active: h.active !== false && h.valid_to === null, validFrom: h.valid_from, validTo: h.valid_to, who: h.createdByName,
      price: num(h.price), soldHere: h.sold_here, nameOverride: h.name_override, nameOverrideEs: h.name_override_es,
    })),
  };
}

async function settingRow(sb: Sb, settingId: string): Promise<MenuItemShopSettingRow | null> {
  const { data, error } = await sb.from("menu_item_shop_settings").select(MENU_SHOP_SETTING_COLUMNS).eq("id", settingId).maybeSingle<MenuItemShopSettingRow>();
  if (error) throw new Error(`menu setting: ${error.message}`);
  return data;
}

export async function computeMenuPreview(actor: AuthContext, menuItemId: string, change: MenuChangeRequest): Promise<MenuPreview> {
  const sb = getServiceRoleClient();
  if (change.kind === "promote") {
    const gate = menuPromoteGate(actor.level);
    if (!gate.ok) throw new MenuShopError(gate.status, gate.code);
  } else {
    const gate = menuShopWriteGate({ level: actor.level, scopeAllowed: catalogShopAllowed(actor, change.shopId) });
    if (!gate.ok) throw new MenuShopError(gate.status, gate.code);
  }
  // THE SCOPED DEPENDENCY SNAPSHOT FIRST (lead decision (a)): the item, its live shop rows, the active shops and
  // the cost closure at the scope whose cost is shown (a promote shows the default's). The token binds it with
  // every number shown; the writer takes the same closure's locks and re-checks it.
  const snapshot = await loadMenuChangeSnapshot(menuItemId, change.kind === "promote" ? NIL_SCOPE : change.shopId);
  const item = await loadItem(sb, menuItemId);
  if (!item) throw new MenuShopError(404, "menu_item_not_found");
  const g = { id: item.id, name: item.name, nameEs: item.name_es, menuPrice: num(item.menu_price) };

  if (change.kind === "promote") {
    const row = await settingRow(sb, change.settingId);
    if (!row || row.menu_item_id !== menuItemId || row.valid_to !== null) throw new MenuShopError(404, "not_found");
    const wantPrice = change.fields.includes("price");
    const wantName = change.fields.includes("name");
    if ((wantPrice && num(row.price) === null) || (wantName && row.name_override === null)) throw new MenuShopError(400, "nothing_to_promote");
    const shops = await loadActiveShops(sb);
    const { data: others, error } = await sb.from("menu_item_shop_settings").select("location_id, price, name_override")
      .eq("menu_item_id", menuItemId).eq("active", true).returns<Array<{ location_id: string; price: number | string | null; name_override: string | null }>>();
    if (error) throw new Error(`menu promote shops: ${error.message}`);
    const after: MenuPreviewSide = {
      name: wantName ? row.name_override! : g.name, nameEs: wantName ? (row.name_override_es ?? g.nameEs) : g.nameEs,
      price: wantPrice ? num(row.price) : g.menuPrice, soldHere: true, inherits: { price: false, name: false },
    };
    const cost = await costAt(menuItemId, null);
    const expectedGlobal = { price: g.menuPrice, name: g.name, nameEs: g.nameEs };
    // FIELD BY FIELD (Astra 3b r1#4) — the same predicate 0263 returns as changed_shops.
    const changedShops = menuPromoteChangedShops({ shops, sourceShopId: row.location_id, fields: change.fields, live: others ?? [] });
    const returnedShop = { shopId: row.location_id, shopName: shops.find((s) => s.id === row.location_id)?.name ?? "" };
    const math = menuPreviewMath({ before: g.menuPrice, after: after.price, cost });
    return {
      kind: "promote", menuItemId, shopId: null,
      before: { name: g.name, nameEs: g.nameEs, price: g.menuPrice, soldHere: true, inherits: { price: false, name: false } }, after, cost,
      ...math, changedShops, returnedShop, snapshot, expectedSettingId: change.settingId, expectedGlobal,
      token: menuPreviewToken({
        kind: "promote", menuItemId, settingId: change.settingId, fields: change.fields, expectedGlobal, after, snapshot,
        cost, margins: [math.marginBefore, math.marginAfter], changed: changedShops.map((c) => c.shopId), returned: returnedShop.shopId,
      }),
    };
  }

  const live = (await loadLiveMenuItemShopSettings(change.shopId)).get(menuItemId);
  const before = resolveMenuItemForShop(g, live);
  let afterRow: MenuItemShopSettingRow | undefined;
  if (change.kind === "save") {
    afterRow = {
      id: "preview", menu_item_id: menuItemId, location_id: change.shopId, based_on_setting_id: live?.id ?? null,
      price: change.patch.price, sold_here: change.patch.soldHere, name_override: change.patch.nameOverride, name_override_es: change.patch.nameOverrideEs,
      valid_from: new Date(0).toISOString(), valid_to: null, created_by: null,
    };
  } else if (change.kind === "restore") {
    const row = await settingRow(sb, change.fromSettingId);
    if (!row || row.menu_item_id !== menuItemId || row.location_id !== change.shopId) throw new MenuShopError(404, "not_found");
    afterRow = row;
  } else if (!live) {
    throw new MenuShopError(409, "not_live");
  }
  const after = resolveMenuItemForShop(g, afterRow);
  const cost = await costAt(menuItemId, change.shopId);
  const expectedSettingId = live?.id ?? null;
  const side = (r: ReturnType<typeof resolveMenuItemForShop>): MenuPreviewSide => ({
    name: r.name, nameEs: r.nameEs, price: r.typedPrice, soldHere: r.soldHere,
    inherits: { price: !r.overrides.price, name: !r.overrides.name },
  });
  const beforeView = side(before);
  const afterView = side(after);
  const math = menuPreviewMath({ before: before.typedPrice, after: after.typedPrice, cost });
  return {
    kind: change.kind, menuItemId, shopId: change.shopId, before: beforeView, after: afterView, cost,
    ...math, changedShops: [], returnedShop: null, snapshot, expectedSettingId, expectedGlobal: null,
    // THE TOKEN BINDS THE COMPLETE PROPOSED CHANGE (Astra 3b r4#2): the normalized patch the writer will store
    // (every field — the Spanish name and "inherit" included), both full sides, the snapshot and every number shown.
    token: menuPreviewToken({
      kind: change.kind, menuItemId, shopId: change.shopId, expectedSettingId,
      patch: change.kind === "save" ? normalizeMenuPatch(change.patch) : null,
      source: change.kind === "restore" ? change.fromSettingId : null,
      before: beforeView, after: afterView, snapshot, cost, margins: [math.marginBefore, math.marginAfter],
    }),
  };
}

export async function applyMenuChange(actor: AuthContext, menuItemId: string, change: MenuChangeRequest, token: string): Promise<{ ok: true }> {
  const preview = await computeMenuPreview(actor, menuItemId, change);
  if (preview.token !== token) throw new MenuShopError(409, "preview_stale");
  // The snapshot the matching token was computed on; SQL re-takes it under the menu item row lock.
  const snapshot = preview.snapshot;
  switch (change.kind) {
    case "save":
      await saveMenuItemShopSetting(actor, { menuItemId, locationId: change.shopId, expectedSettingId: preview.expectedSettingId, patch: change.patch, snapshot });
      break;
    case "back_to_default":
      await retireMenuItemShopSetting(actor, { menuItemId, locationId: change.shopId, settingId: preview.expectedSettingId!, snapshot });
      break;
    case "restore":
      await restoreMenuItemShopSetting(actor, { menuItemId, locationId: change.shopId, fromSettingId: change.fromSettingId, expectedSettingId: preview.expectedSettingId, snapshot });
      break;
    case "promote":
      await promoteMenuItemShopSetting(actor, { menuItemId, settingId: change.settingId, fields: change.fields, expected: preview.expectedGlobal!, snapshot });
      break;
  }
  return { ok: true };
}
```

- [ ] **Step 5: Create `lib/catalog/shop-changes.ts`**

```ts
/**
 * THE SHOP CHANGES LIST (MoO+, Cristian) and THE GM NOTICES read (catalog Phase 3b; spec §6).
 * SERVER-ONLY. The list: every LIVE shop recipe version and menu overlay — what changed against today's
 * global default, where, who, when — newest first. The notices: computeRecipeNotices over exactly the
 * versions a shop's notices can depend on (its adopted versions' sources; recent promotions).
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { selectAllRows } from "@/lib/supabase-paginate";
import { assertScopeToken, catalogShopAllowed, GLOBAL_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";
import { lineFromRow, type RecipeLineFields, type RecipeLineRow } from "@/lib/recipe-line-shared";
import { diffRecipeLineSets, RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import { MENU_SHOP_SETTING_COLUMNS } from "@/lib/menu-item-shop";
import type { MenuItemShopSettingRow } from "@/lib/menu-item-shop-shared";
import {
  computeRecipeNotices, NEW_DEFAULT_NOTICE_DAYS, type NoticeDismissalRow, type NoticeVersionRow, type RecipeNotice,
} from "@/lib/catalog/recipe-notices-shared";
import type { ShopChangesView } from "@/lib/catalog/recipe-item-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;
const VERSION_COLUMNS = "id, recipe_id, location_id, valid_from, valid_to, active, adopted_from_version_id, promoted_from_version_id, based_on_version_id, created_by";
const LINE_COLUMNS = "id, version_id, recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order";
/** The id-list chunk for `.in()` reads (the request-line budget; 2a's ID_CHUNK). */
const ID_CHUNK = 100;
type VersionRow = NoticeVersionRow & { created_by: string | null };
type LineRow = RecipeLineRow & { id: string; version_id?: string; recipe_id?: string; display_order: number | null };

/**
 * EVERY READ HERE IS PAGED (stable order, `range`) AND EVERY ID LIST IS CHUNKED (Astra 3b r1#9): once the live
 * shop versions' lines pass the PostgREST 1000-row cap, a truncated read would make diffRecipeLineSets
 * report false additions and removals. `inChunks` runs one paged read per id chunk and concatenates.
 */
async function inChunks<T>(ids: readonly string[], read: (chunk: string[], from: number, to: number) => Promise<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    out.push(...await selectAllRows<T>((from, to) => read(chunk, from, to)));
  }
  return out;
}

async function names(sb: Sb, table: "recipes" | "locations" | "users" | "menu_items" | "vendor_items" | "items" | "products", ids: string[]): Promise<Map<string, string>> {
  const rows = await inChunks<{ id: string; name: string }>([...new Set(ids)], async (chunk, from, to) => {
    const { data, error } = await sb.from(table).select("id, name").in("id", chunk).order("id", { ascending: true }).range(from, to)
      .returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`shop changes ${table}: ${error.message}`);
    return { data };
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function loadShopChanges(actor: AuthContext): Promise<ShopChangesView> {
  if (actor.level < GLOBAL_VERSION_WRITE_MIN) throw new RecipeVersionError(403, "forbidden");
  const sb = getServiceRoleClient();
  const vs = await selectAllRows<VersionRow>(async (from, to) => {
    const { data, error } = await sb.from("recipe_versions").select(VERSION_COLUMNS).not("location_id", "is", null).eq("active", true)
      .order("valid_from", { ascending: false }).order("id", { ascending: true }).range(from, to).returns<VersionRow[]>();
    if (error) throw new Error(`shop changes versions: ${error.message}`);
    return { data };
  });
  const recipeIds = [...new Set(vs.map((v) => v.recipe_id))];
  const adoptedIds = [...new Set(vs.map((v) => v.adopted_from_version_id).filter((x): x is string => x !== null))];
  const [shopLines, globalLines, adopted] = await Promise.all([
    inChunks<LineRow>(vs.map((v) => v.id), async (chunk, from, to) => {
      const { data, error } = await sb.from("recipe_version_lines").select(LINE_COLUMNS).in("version_id", chunk)
        .order("version_id", { ascending: true }).order("display_order", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<LineRow[]>();
      if (error) throw new Error(`shop changes lines: ${error.message}`);
      return { data };
    }),
    inChunks<LineRow>(recipeIds, async (chunk, from, to) => {
      const { data, error } = await sb.from("recipe_inputs")
        .select("id, recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order")
        .in("recipe_id", chunk).order("recipe_id", { ascending: true }).order("display_order", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<LineRow[]>();
      if (error) throw new Error(`shop changes default lines: ${error.message}`);
      return { data };
    }),
    inChunks<{ id: string; location_id: string | null }>(adoptedIds, async (chunk, from, to) => {
      const { data, error } = await sb.from("recipe_versions").select("id, location_id").in("id", chunk)
        .order("id", { ascending: true }).range(from, to).returns<Array<{ id: string; location_id: string | null }>>();
      if (error) throw new Error(`shop changes adopted: ${error.message}`);
      return { data };
    }),
  ]);
  const byVersion = new Map<string, RecipeLineFields[]>();
  for (const l of shopLines) byVersion.set(l.version_id!, [...(byVersion.get(l.version_id!) ?? []), lineFromRow(l)]);
  const byRecipe = new Map<string, RecipeLineFields[]>();
  for (const l of globalLines) byRecipe.set(l.recipe_id!, [...(byRecipe.get(l.recipe_id!) ?? []), lineFromRow(l)]);
  const adoptedShop = new Map(adopted.map((a) => [a.id, a.location_id]));

  const ss = await selectAllRows<MenuItemShopSettingRow>(async (from, to) => {
    const { data, error } = await sb.from("menu_item_shop_settings").select(MENU_SHOP_SETTING_COLUMNS).eq("active", true)
      .order("valid_from", { ascending: false }).order("id", { ascending: true }).range(from, to).returns<MenuItemShopSettingRow[]>();
    if (error) throw new Error(`shop changes menu: ${error.message}`);
    return { data };
  });
  const menuIds = [...new Set(ss.map((s) => s.menu_item_id))];
  type MenuRow = { id: string; name: string; name_es: string | null; menu_price: number | string | null };
  const menu = await inChunks<MenuRow>(menuIds, async (chunk, from, to) => {
    const { data, error } = await sb.from("menu_items").select("id, name, name_es, menu_price").in("id", chunk)
      .order("id", { ascending: true }).range(from, to).returns<MenuRow[]>();
    if (error) throw new Error(`shop changes menu items: ${error.message}`);
    return { data };
  });
  const menuBy = new Map(menu.map((m) => [m.id, m]));

  const shopIds = [...new Set([...vs.map((v) => v.location_id!), ...ss.map((s) => s.location_id), ...[...adoptedShop.values()].filter((x): x is string => x !== null)])];
  const userIds = [...new Set([...vs.map((v) => v.created_by), ...ss.map((s) => s.created_by)].filter((u): u is string => u !== null))];
  const allLines = [...byVersion.values(), ...byRecipe.values()].flat();
  const ids = (k: keyof RecipeLineFields) => [...new Set(allLines.map((l) => l[k]).filter((v): v is string => typeof v === "string"))];
  const [recipeNames, shopNames, userNames, skuN, itemN, productN] = await Promise.all([
    names(sb, "recipes", recipeIds), names(sb, "locations", shopIds), names(sb, "users", userIds),
    names(sb, "vendor_items", ids("componentSkuId")), names(sb, "items", ids("componentItemId")), names(sb, "products", ids("componentProductId")),
  ]);
  const keyNames: Record<string, string> = {};
  for (const [id, name] of skuN) keyNames[`sku:${id}`] = name;
  for (const [id, name] of itemN) keyNames[`item:${id}`] = name;
  for (const [id, name] of productN) keyNames[`product:${id}`] = name;

  return {
    recipes: vs.map((v) => {
      const changes = diffRecipeLineSets(byRecipe.get(v.recipe_id) ?? [], byVersion.get(v.id) ?? []);
      const fromShop = v.adopted_from_version_id ? adoptedShop.get(v.adopted_from_version_id) ?? null : null;
      return {
        recipeId: v.recipe_id, recipeName: recipeNames.get(v.recipe_id) ?? v.recipe_id, versionId: v.id,
        shopId: v.location_id!, shopName: shopNames.get(v.location_id!) ?? "", validFrom: v.valid_from,
        createdByName: v.created_by ? (userNames.get(v.created_by) ?? null) : null,
        adoptedFromShopName: fromShop ? (shopNames.get(fromShop) ?? null) : null, changes, sameAsDefault: changes.length === 0,
      };
    }),
    menu: ss.map((s) => {
      const m = menuBy.get(s.menu_item_id);
      return {
        menuItemId: s.menu_item_id, menuItemName: m?.name ?? s.menu_item_id, settingId: s.id, shopId: s.location_id,
        shopName: shopNames.get(s.location_id) ?? "", validFrom: s.valid_from, createdByName: s.created_by ? (userNames.get(s.created_by) ?? null) : null,
        price: s.price === null ? null : Number(s.price), soldHere: s.sold_here, nameOverride: s.name_override, nameOverrideEs: s.name_override_es,
        global: { price: m?.menu_price == null ? null : Number(m.menu_price), name: m?.name ?? "", nameEs: m?.name_es ?? null },
      };
    }),
    names: keyNames,
  };
}

/**
 * The notices for ONE shop, actor-free (callers gate): the shop's live adopted versions and every
 * version of their source shops for those recipes; the global heads promoted within the window, the
 * versions they came from, and the global versions promoted FROM any source version (so "its version is
 * the default now" can be told apart from "it went back to the default"); the shop's dismissals. Paged.
 */
export async function computeShopNotices(sb: Sb, shopId: string, now: string): Promise<RecipeNotice[]> {
  const cutoff = new Date(Date.parse(now) - NEW_DEFAULT_NOTICE_DAYS * 86_400_000).toISOString();
  const paged = (label: string, q: (from: number, to: number) => PromiseLike<{ data: VersionRow[] | null; error: { message: string } | null }>) =>
    selectAllRows<VersionRow>(async (from, to) => {
      const { data, error } = await q(from, to);
      if (error) throw new Error(`shop notices ${label}: ${error.message}`);
      return { data };
    });
  const [mine, promoted, dismissals] = await Promise.all([
    paged("mine", (from, to) => sb.from("recipe_versions").select(VERSION_COLUMNS).eq("location_id", assertScopeToken(shopId)).eq("active", true)
      .order("id", { ascending: true }).range(from, to).returns<VersionRow[]>()),
    paged("promoted", (from, to) => sb.from("recipe_versions").select(VERSION_COLUMNS).is("location_id", null).eq("active", true)
      .not("promoted_from_version_id", "is", null).gte("valid_from", cutoff).order("id", { ascending: true }).range(from, to).returns<VersionRow[]>()),
    selectAllRows<NoticeDismissalRow>(async (from, to) => {
      const { data, error } = await sb.from("recipe_notice_dismissals").select("recipe_id, kind, seen_version_id").eq("location_id", shopId)
        .order("id", { ascending: true }).range(from, to).returns<NoticeDismissalRow[]>();
      if (error) throw new Error(`shop notices dismissals: ${error.message}`);
      return { data };
    }),
  ]);
  const sourceIds = [...new Set([...mine.map((v) => v.adopted_from_version_id), ...promoted.map((v) => v.promoted_from_version_id)].filter((x): x is string => x !== null))];
  const sources = await inChunks<VersionRow>(sourceIds, async (chunk, from, to) => {
    const { data, error } = await sb.from("recipe_versions").select(VERSION_COLUMNS).in("id", chunk).order("id", { ascending: true })
      .range(from, to).returns<VersionRow[]>();
    if (error) throw new Error(`shop notices sources: ${error.message}`);
    return { data };
  });
  const adoptedRecipes = [...new Set(mine.filter((v) => v.adopted_from_version_id).map((v) => v.recipe_id))];
  const sourceShops = [...new Set(sources.map((s) => s.location_id).filter((x): x is string => x !== null))];
  const sourceHistory = adoptedRecipes.length && sourceShops.length
    ? await inChunks<VersionRow>(adoptedRecipes, async (chunk, from, to) => {
        const { data, error } = await sb.from("recipe_versions").select(VERSION_COLUMNS).in("recipe_id", chunk).in("location_id", sourceShops)
          .order("id", { ascending: true }).range(from, to).returns<VersionRow[]>();
        if (error) throw new Error(`shop notices source history: ${error.message}`);
        return { data };
      })
    : [];
  // The global versions PROMOTED FROM any of those source versions (any age): a retired source that was
  // promoted reads "it is the default now", not "it went back to the default".
  const promotedFrom = await inChunks<VersionRow>([...new Set(sourceHistory.map((v) => v.id))], async (chunk, from, to) => {
    const { data, error } = await sb.from("recipe_versions").select(VERSION_COLUMNS).is("location_id", null).in("promoted_from_version_id", chunk)
      .order("id", { ascending: true }).range(from, to).returns<VersionRow[]>();
    if (error) throw new Error(`shop notices promoted from: ${error.message}`);
    return { data };
  });
  const versions = [...new Map([...mine, ...promoted, ...sources, ...sourceHistory, ...promotedFrom].map((v) => [v.id, v])).values()];
  const recipeIds = [...new Set(versions.map((v) => v.recipe_id))];
  const shopIds = [...new Set(versions.map((v) => v.location_id).filter((x): x is string => x !== null))];
  const [recipeNames, shopNames] = await Promise.all([names(sb, "recipes", recipeIds), names(sb, "locations", shopIds)]);
  return computeRecipeNotices({ shopId, versions, dismissals, recipeNames, shopNames, now });
}

/** The GM's notices page: its own shops (MoO+ any). */
export async function loadShopNotices(actor: AuthContext, shopId: string): Promise<RecipeNotice[]> {
  if (actor.level < RECIPE_SHOP_WRITE_MIN) throw new RecipeVersionError(403, "forbidden");
  if (!catalogShopAllowed(actor, shopId)) throw new RecipeVersionError(404, "not_found");
  return computeShopNotices(getServiceRoleClient(), shopId, new Date().toISOString());
}
```

- [ ] **Step 6: Run, then commit**

Run: `npx vitest run tests/catalog-recipe-server.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output.

```bash
git add lib/catalog/recipe-item.ts lib/catalog/menu-item-page.ts lib/catalog/shop-changes.ts lib/catalog/recipe-item-shared.ts tests/catalog-recipe-server.test.ts tests/recipe-provenance-history.test.ts
git commit -F - <<'EOF'
feat(catalog): recipe and menu-item page views, previews with tokens, apply, the Shop changes list, notices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 6: The pages' routes

**Files:**
- Create: `app/api/admin/catalog/recipe/[id]/preview/route.ts`, `app/api/admin/catalog/recipe/[id]/apply/route.ts`, `app/api/admin/catalog/recipe/[id]/notices/dismiss/route.ts`
- Create: `app/api/admin/catalog/menu-item/[id]/preview/route.ts`, `app/api/admin/catalog/menu-item/[id]/apply/route.ts`
- Modify: `tests/step-up-tier-map.test.ts`
- Test: `tests/catalog-recipe-routes.test.ts`

- [ ] **Step 1: Write the failing source-pin test**

```ts
/** Catalog Phase 3b — previews are reads (no step-up); applies are Tier E with the token; the notice answer is same-origin, bound in the lib. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(f, "utf8");

describe("previews: a read for those who may save", () => {
  for (const [file, call] of [
    ["app/api/admin/catalog/recipe/[id]/preview/route.ts", "computeRecipePreview("],
    ["app/api/admin/catalog/menu-item/[id]/preview/route.ts", "computeMenuPreview("],
  ] as const) {
    it(file, () => {
      const src = read(file);
      expect(src).toContain(call);
      expect(src).not.toContain("assertStepUp");
      expect(src).toMatch(/ctx\.level < (RECIPE_SHOP_WRITE_MIN|MENU_SHOP_WRITE_MIN)/);
    });
  }
});

describe("applies: Tier E, the preview token, the lib", () => {
  for (const [file, call] of [
    ["app/api/admin/catalog/recipe/[id]/apply/route.ts", "applyRecipeChange("],
    ["app/api/admin/catalog/menu-item/[id]/apply/route.ts", "applyMenuChange("],
  ] as const) {
    it(file, () => {
      const src = read(file);
      expect(src).toContain('assertStepUp(ctx, "E")');
      expect(src).toContain(call);
      expect(src).toContain("previewToken");
      expect(src).not.toContain("consumeStepUpGrant");
    });
  }
});

describe("the notice answer", () => {
  it("same-origin, a GM floor, the lib binds; no password", () => {
    const src = read("app/api/admin/catalog/recipe/[id]/notices/dismiss/route.ts");
    expect(src).toContain("assertSameOrigin(req)");
    expect(src).toContain("dismissRecipeNotice(");
    expect(src).not.toContain("assertStepUp");
  });
});
```

Run: `npx vitest run tests/catalog-recipe-routes.test.ts` → FAIL (`ENOENT`).

- [ ] **Step 2: Create `app/api/admin/catalog/recipe/[id]/preview/route.ts`**

```ts
/**
 * POST /api/admin/catalog/recipe/[id]/preview — "What this changes" for ONE recipe act (catalog Phase
 * 3b). Body: { change: RecipeChangeRequest }. A read: no step-up. Offered to who may save the act's
 * target (the lib refuses otherwise), so a preview never shows a choice the save would refuse.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { computeRecipePreview } from "@/lib/catalog/recipe-item";
import { parseRecipeChange } from "@/lib/catalog/recipe-item-shared";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/preview`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const change = parseRecipeChange((parsed as Record<string, unknown> | null)?.change);
  if (!change.ok) return jsonError(400, change.code, { field: "change" });
  try {
    return jsonOk({ preview: await computeRecipePreview(ctx, id, change.change) });
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message, ...(e.line ? { line: e.line } : {}) });
    throw e;
  }
}
```

- [ ] **Step 3: Create `app/api/admin/catalog/recipe/[id]/apply/route.ts`**

```ts
/**
 * POST /api/admin/catalog/recipe/[id]/apply — save EXACTLY the previewed recipe act (catalog Phase 3b).
 * Body: { change: RecipeChangeRequest, previewToken: string }. Tier E. The lib recomputes the preview,
 * refuses preview_stale on any difference, then calls 3a's gated writer (which binds the shop).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { applyRecipeChange } from "@/lib/catalog/recipe-item";
import { parseRecipeChange } from "@/lib/catalog/recipe-item-shared";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/apply`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  const change = parseRecipeChange(b.change);
  if (!change.ok) return jsonError(400, change.code, { field: "change" });
  if (typeof b.previewToken !== "string" || b.previewToken.length === 0 || b.previewToken.length > 64) {
    return jsonError(400, "invalid_payload", { field: "previewToken" });
  }
  try {
    const r = await applyRecipeChange(ctx, id, change.change, b.previewToken);
    return jsonOk({ versionId: r.versionId }, 201);
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message, ...(e.line ? { line: e.line } : {}) });
    throw e;
  }
}
```

- [ ] **Step 4: Create `app/api/admin/catalog/recipe/[id]/notices/dismiss/route.ts`**

```ts
/**
 * POST /api/admin/catalog/recipe/[id]/notices/dismiss — a GM's "Keep mine" / "Got it" (catalog Phase 3b).
 * Body: { locationId: uuid, kind: "source_changed" | "source_retired" | "new_default", seenVersionId: uuid }. It changes no
 * food, so no password: same-origin, the GM floor, and the lib binds the shop (dismissRecipeNotice).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { dismissRecipeNotice, RecipeVersionError } from "@/lib/admin/recipe-versions";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/notices/dismiss`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (b.kind !== "source_changed" && b.kind !== "source_retired" && b.kind !== "new_default") return jsonError(400, "invalid_payload", { field: "kind" });
  if (typeof b.seenVersionId !== "string" || !UUID_RE.test(b.seenVersionId)) return jsonError(400, "invalid_payload", { field: "seenVersionId" });
  try {
    await dismissRecipeNotice(ctx, { locationId: b.locationId, recipeId: id, kind: b.kind, seenVersionId: b.seenVersionId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message, ...(e.line ? { line: e.line } : {}) });
    throw e;
  }
}
```

- [ ] **Step 5: Create `app/api/admin/catalog/menu-item/[id]/preview/route.ts`**

```ts
/**
 * POST /api/admin/catalog/menu-item/[id]/preview — "What this changes" for ONE menu act (catalog Phase
 * 3b). Body: { change: MenuChangeRequest }. A read: no step-up; the lib gates who may save it.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { computeMenuPreview } from "@/lib/catalog/menu-item-page";
import { parseMenuChange } from "@/lib/catalog/recipe-item-shared";
import { MenuShopError } from "@/lib/admin/menu-item-shop";
import { MENU_SHOP_WRITE_MIN } from "@/lib/menu-item-shop-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/preview`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < MENU_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const change = parseMenuChange((parsed as Record<string, unknown> | null)?.change);
  if (!change.ok) return jsonError(400, change.code, { field: "change" });
  try {
    return jsonOk({ preview: await computeMenuPreview(ctx, id, change.change) });
  } catch (e) {
    if (e instanceof MenuShopError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 6: Create `app/api/admin/catalog/menu-item/[id]/apply/route.ts`**

```ts
/**
 * POST /api/admin/catalog/menu-item/[id]/apply — save EXACTLY the previewed menu act (catalog Phase 3b).
 * Body: { change: MenuChangeRequest, previewToken: string }. Tier E; the lib recomputes and binds.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { applyMenuChange } from "@/lib/catalog/menu-item-page";
import { parseMenuChange } from "@/lib/catalog/recipe-item-shared";
import { MenuShopError } from "@/lib/admin/menu-item-shop";
import { MENU_SHOP_WRITE_MIN } from "@/lib/menu-item-shop-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/menu-item/${id}/apply`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < MENU_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  const change = parseMenuChange(b.change);
  if (!change.ok) return jsonError(400, change.code, { field: "change" });
  if (typeof b.previewToken !== "string" || b.previewToken.length === 0 || b.previewToken.length > 64) {
    return jsonError(400, "invalid_payload", { field: "previewToken" });
  }
  try {
    await applyMenuChange(ctx, id, change.change, b.previewToken);
    return jsonOk({ ok: true }, 201);
  } catch (e) {
    if (e instanceof MenuShopError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 7: Register the two applies in the tier map**

In `tests/step-up-tier-map.test.ts` `SERVER_TIER_MAP`, after 3a's `app/api/admin/catalog/menu-item/[id]/shop/route.ts` entry, add `  "app/api/admin/catalog/menu-item/[id]/apply/route.ts": ["E"],`, and after 3a's `app/api/admin/catalog/recipe/[id]/back-to-default/route.ts` entry, add `  "app/api/admin/catalog/recipe/[id]/apply/route.ts": ["E"],`. (Previews and the notice answer assert no tier, so they are not in the map.)

- [ ] **Step 8: Run, then commit**

Run: `npx vitest run tests/catalog-recipe-routes.test.ts tests/step-up-tier-map.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: the routes test PASSES. `step-up-tier-map.test.ts` passes its server half; its CLIENT half is completed in Tasks 8–10 (the clients that ask Tier E are created there) — it passes now because no client asks yet. No tsc output.

```bash
git add app/api/admin/catalog/recipe app/api/admin/catalog/menu-item tests/catalog-recipe-routes.test.ts tests/step-up-tier-map.test.ts
git commit -F - <<'EOF'
feat(catalog): recipe and menu-item preview / apply routes, and the notice answer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 7: Every string, en + es (tú)

**Files:**
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`
- Test: `tests/catalog-recipe-i18n.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** Catalog Phase 3b — every key the recipe / menu / shop-changes / notices screens use exists in en AND es; Spanish is tú. */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

export const PHASE3B_KEYS = [
  "catalog.recipe.kind.production", "catalog.recipe.kind.consumer",
  "catalog.recipe.version.global", "catalog.recipe.version.shop_default", "catalog.recipe.version.shop_own", "catalog.recipe.version.shop_adopted",
  "catalog.recipe.shop_switcher", "catalog.recipe.shop_global", "catalog.recipe.inactive",
  "catalog.recipe.connections", "catalog.recipe.ingredients_from", "catalog.recipe.vendors_none", "catalog.recipe.makes", "catalog.recipe.used_in", "catalog.recipe.used_in_none",
  "catalog.recipe.section.lines", "catalog.recipe.lines_count", "catalog.recipe.changed_here", "catalog.recipe.edit_line", "catalog.recipe.remove_line",
  "catalog.recipe.add_line", "catalog.recipe.edit_title", "catalog.recipe.add_title", "catalog.recipe.see_changes", "catalog.recipe.cancel",
  "catalog.recipe.pick_shop_hint", "catalog.recipe.global_moo_hint",
  "catalog.recipe.differs_title", "catalog.recipe.differs_none",
  "catalog.recipe.section.makes", "catalog.recipe.yield", "catalog.recipe.cost_here", "catalog.recipe.edit_outputs",
  "catalog.recipe.section.others", "catalog.recipe.others_count", "catalog.recipe.others_none", "catalog.recipe.adopt", "catalog.recipe.promote",
  "catalog.recipe.back_to_default", "catalog.recipe.back_to_default_hint",
  "catalog.recipe.section.history", "catalog.recipe.history_count", "catalog.recipe.history_global", "catalog.recipe.history_by",
  "catalog.recipe.history_lines", "catalog.recipe.restore", "catalog.recipe.current", "catalog.recipe.promoted_from", "catalog.recipe.adopted_from",
  "catalog.recipe.saved",
  "catalog.recipe.notices", "catalog.recipe.notice.source_changed", "catalog.recipe.notice.source_gone", "catalog.recipe.notice.new_default",
  "catalog.recipe.notice.source_promoted", "catalog.recipe.preview.returned", "catalog.recipe.lines_locked",
  "catalog.recipe.error.dependencies_changed", "catalog.recipe.error.product_line_invalid",
  "catalog.menu.preview.returned", "catalog.menu.error.dependencies_changed",
  "catalog.recipe.error.dependencies_busy", "catalog.menu.error.dependencies_busy", "catalog.recipe.error.line_refused",
  "catalog.recipe.line_problem", "catalog.recipe.preview.flagged_title",
  "catalog.recipe.notice.edited_since", "catalog.recipe.edit_conflict", "catalog.recipe.edit_rebase",
  "catalog.recipe.preview.drops_link", "catalog.recipe.history.link_ended",
  "catalog.menu.preview.name_es", "catalog.menu.preview.inherits", "catalog.menu.preview.inherits_default", "catalog.menu.preview.inherits_own",
  "catalog.recipe.notice.take_update", "catalog.recipe.notice.back_to_default", "catalog.recipe.notice.keep_mine", "catalog.recipe.notice.got_it", "catalog.recipe.notice.open",
  "catalog.recipe.preview.title", "catalog.recipe.preview.changes", "catalog.recipe.preview.added", "catalog.recipe.preview.removed", "catalog.recipe.preview.changed",
  "catalog.recipe.preview.none", "catalog.recipe.preview.scope_global", "catalog.recipe.preview.untouched", "catalog.recipe.preview.no_cost_change",
  "catalog.recipe.preview.cost_row", "catalog.recipe.preview.item_cost", "catalog.recipe.preview.discard",
  "catalog.recipe.preview.save.lines_shop", "catalog.recipe.preview.save.lines_global", "catalog.recipe.preview.save.restore",
  "catalog.recipe.preview.save.back_to_default", "catalog.recipe.preview.save.adopt", "catalog.recipe.preview.save.promote",
  "catalog.recipe.error.generic", "catalog.recipe.error.version_changed", "catalog.recipe.error.forbidden", "catalog.recipe.error.not_found",
  "catalog.recipe.error.global_requires_moo", "catalog.recipe.error.step_up_required", "catalog.recipe.error.step_up_stale", "catalog.recipe.error.preview_stale",
  "catalog.recipe.error.line_changed", "catalog.recipe.error.edge_not_found", "catalog.recipe.error.empty_recipe", "catalog.recipe.error.would_create_cycle",
  "catalog.recipe.error.recipe_inactive", "catalog.recipe.error.invalid_source", "catalog.recipe.error.not_live", "catalog.recipe.error.nothing_changed",
  "catalog.recipe.error.invalid_payload", "catalog.recipe.error.invalid_component", "catalog.recipe.error.invalid_quantity",
  "catalog.recipe.error.product_line_needs_measure_unit", "catalog.recipe.error.invalid_component_product", "catalog.recipe.error.invalid_lines",
  "catalog.recipe.error.recipe_not_found", "catalog.recipe.error.location_not_found",
  "catalog.menu.kind", "catalog.menu.version.global", "catalog.menu.version.shop_default", "catalog.menu.version.shop_own", "catalog.menu.shop_switcher",
  "catalog.menu.global_view_hint", "catalog.menu.section.here", "catalog.menu.price_here", "catalog.menu.price_hint", "catalog.menu.sold_here",
  "catalog.menu.name_here", "catalog.menu.name_here_es", "catalog.menu.name_hint", "catalog.menu.see_changes", "catalog.menu.cancel",
  "catalog.menu.cost", "catalog.menu.cost_unknown", "catalog.menu.recipe", "catalog.menu.recipe_none", "catalog.menu.toast_links",
  "catalog.menu.back_to_default", "catalog.menu.section.history", "catalog.menu.history_count", "catalog.menu.restore", "catalog.menu.current",
  "catalog.menu.history_price", "catalog.menu.history_off", "catalog.menu.history_name", "catalog.menu.saved", "catalog.menu.open_page",
  "catalog.menu.preview.title", "catalog.menu.preview.price", "catalog.menu.preview.margin", "catalog.menu.preview.sold", "catalog.menu.preview.name",
  "catalog.menu.preview.yes", "catalog.menu.preview.no", "catalog.menu.preview.shops", "catalog.menu.preview.save_shop", "catalog.menu.preview.save_promote",
  "catalog.menu.preview.save_back", "catalog.menu.preview.save_restore",
  "catalog.menu.error.generic", "catalog.menu.error.forbidden", "catalog.menu.error.not_found", "catalog.menu.error.version_changed", "catalog.menu.error.not_live",
  "catalog.menu.error.global_changed", "catalog.menu.error.nothing_to_promote", "catalog.menu.error.invalid_menu_price", "catalog.menu.error.invalid_name",
  "catalog.menu.error.empty_setting", "catalog.menu.error.invalid_source", "catalog.menu.error.invalid_payload", "catalog.menu.error.preview_stale",
  "catalog.menu.error.step_up_required", "catalog.menu.error.step_up_stale", "catalog.menu.error.menu_item_not_found", "catalog.menu.error.location_not_found",
  "catalog.menu.error.global_requires_moo",
  "catalog.changes.title", "catalog.changes.intro", "catalog.changes.recipes", "catalog.changes.recipes_count", "catalog.changes.menu", "catalog.changes.menu_count",
  "catalog.changes.none", "catalog.changes.by", "catalog.changes.same_as_default", "catalog.changes.adopted_from", "catalog.changes.promote", "catalog.changes.leave",
  "catalog.changes.promote_price", "catalog.changes.promote_name", "catalog.changes.off_here", "catalog.changes.price_here", "catalog.changes.name_here",
  "catalog.changes.open", "catalog.changes.show", "catalog.changes.hide",
  "catalog.notices.title", "catalog.notices.intro", "catalog.notices.none", "catalog.notices.pick_shop",
  "admin.section.shop-changes", "admin.section.recipe-notices",
  "recipes.error.global_requires_moo", "recipes.catalog_link", "recipes.catalog_link_hint",
] as const;

describe("catalog Phase 3b strings", () => {
  it.each(PHASE3B_KEYS)("%s exists in en and es", (key) => {
    expect((en as Record<string, string>)[key], `en ${key}`).toBeTruthy();
    expect((es as Record<string, string>)[key], `es ${key}`).toBeTruthy();
  });
  it("Spanish is tú, never usted", () => {
    for (const key of PHASE3B_KEYS) expect((es as Record<string, string>)[key]).not.toMatch(/\busted(es)?\b/i);
  });
  it("placeholders match between the languages", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of PHASE3B_KEYS) expect(ph((es as Record<string, string>)[key]!), key).toEqual(ph((en as Record<string, string>)[key]!));
  });
});
```

Run: `npx vitest run tests/catalog-recipe-i18n.test.ts` → FAIL (keys missing).

- [ ] **Step 2: English — in `lib/i18n/en.json`, put a comma after the current last entry and add:**

```json
  "catalog.recipe.kind.production": "Prep recipe",
  "catalog.recipe.kind.consumer": "Sandwich recipe",
  "catalog.recipe.version.global": "Global default",
  "catalog.recipe.version.shop_default": "{shop} · using the global default",
  "catalog.recipe.version.shop_own": "{shop}'s version · based on the global default",
  "catalog.recipe.version.shop_adopted": "{shop}'s version · copied from {from}",
  "catalog.recipe.shop_switcher": "Show the recipe for",
  "catalog.recipe.shop_global": "Everyone (global)",
  "catalog.recipe.inactive": "This recipe is retired.",
  "catalog.recipe.connections": "How it connects",
  "catalog.recipe.ingredients_from": "Ingredients come from",
  "catalog.recipe.vendors_none": "No vendor yet",
  "catalog.recipe.makes": "Makes",
  "catalog.recipe.used_in": "Used in",
  "catalog.recipe.used_in_none": "Not used in another recipe.",
  "catalog.recipe.section.lines": "What goes in",
  "catalog.recipe.lines_count": "{n} ingredients",
  "catalog.recipe.lines_locked": "Save or discard your change to close this.",
  "catalog.recipe.changed_here": "Changed here",
  "catalog.recipe.edit_line": "Edit",
  "catalog.recipe.remove_line": "Remove",
  "catalog.recipe.add_line": "+ Add ingredient",
  "catalog.recipe.edit_title": "Change this ingredient",
  "catalog.recipe.add_title": "Add an ingredient",
  "catalog.recipe.see_changes": "See what this changes",
  "catalog.recipe.cancel": "Cancel",
  "catalog.recipe.pick_shop_hint": "To change your shop's recipe, pick your shop above.",
  "catalog.recipe.global_moo_hint": "Only the Director of Operations changes the recipe for every shop.",
  "catalog.recipe.differs_title": "Changed from the default",
  "catalog.recipe.differs_none": "Same as the default right now.",
  "catalog.recipe.section.makes": "What it makes",
  "catalog.recipe.yield": "Makes {n}",
  "catalog.recipe.cost_here": "Cost here: {cost}",
  "catalog.recipe.edit_outputs": "Edit what it makes, yields and steps",
  "catalog.recipe.section.others": "Other shops' versions",
  "catalog.recipe.others_count": "{n} shops",
  "catalog.recipe.others_none": "No other shop has its own version.",
  "catalog.recipe.adopt": "Use {shop}'s version here",
  "catalog.recipe.promote": "Make it the default for everyone",
  "catalog.recipe.back_to_default": "Go back to the default",
  "catalog.recipe.back_to_default_hint": "Your version stays in the history. You can restore it.",
  "catalog.recipe.section.history": "History",
  "catalog.recipe.history_count": "{n} versions",
  "catalog.recipe.history_global": "Global",
  "catalog.recipe.history_by": "{scope} · {date} · {who}",
  "catalog.recipe.history_lines": "{n} ingredients",
  "catalog.recipe.restore": "Restore",
  "catalog.recipe.current": "In use",
  "catalog.recipe.promoted_from": "Made the default from {shop}'s version",
  "catalog.recipe.adopted_from": "Copied from {shop}",
  "catalog.recipe.saved": "Saved.",
  "catalog.recipe.notices": "Updates from other shops",
  "catalog.recipe.notice.source_changed": "{shop} changed the {recipe} you copied. Take the update?",
  "catalog.recipe.notice.source_gone": "{shop} went back to the default {recipe}.",
  "catalog.recipe.notice.source_promoted": "{shop}'s {recipe} is now the default for every shop. Go back to the default?",
  "catalog.recipe.notice.edited_since": "You've changed your copy since adopting it. Taking the update replaces your changes — see what changes first.",
  "catalog.recipe.edit_conflict": "Someone changed this ingredient while you were editing. Your change still compares against what you saw, so saving will show the conflict.",
  "catalog.recipe.edit_rebase": "Start over from the new version",
  "catalog.recipe.preview.drops_link": "This drops the link to {shop}'s recipe — you'll stop getting its updates.",
  "catalog.recipe.history.link_ended": "Link to {shop}'s recipe ended",
  "catalog.recipe.notice.new_default": "{recipe} has a new default for every shop (from {shop}).",
  "catalog.recipe.notice.take_update": "Take the update",
  "catalog.recipe.notice.back_to_default": "Go back to the default too",
  "catalog.recipe.notice.keep_mine": "Keep mine",
  "catalog.recipe.notice.got_it": "Got it",
  "catalog.recipe.notice.open": "Open the recipe",
  "catalog.recipe.preview.title": "What this changes",
  "catalog.recipe.preview.changes": "Ingredients",
  "catalog.recipe.preview.added": "Add {line}",
  "catalog.recipe.preview.removed": "Remove {line}",
  "catalog.recipe.preview.changed": "{before} → {after}",
  "catalog.recipe.preview.none": "The ingredients stay the same.",
  "catalog.recipe.preview.scope_global": "Everyone on the default",
  "catalog.recipe.preview.untouched": "Not changed (they have their own version): {shops}",
  "catalog.recipe.preview.returned": "{shop} goes back to the default. Its food stays the same.",
  "catalog.recipe.preview.no_cost_change": "No sandwich cost changes.",
  "catalog.recipe.preview.cost_row": "{name}: {before} → {after}",
  "catalog.recipe.preview.item_cost": "{name}, cost per unit: {before} → {after}",
  "catalog.recipe.preview.discard": "Not now",
  "catalog.recipe.preview.save.lines_shop": "Save for {shop}",
  "catalog.recipe.preview.save.lines_global": "Save for everyone",
  "catalog.recipe.preview.save.restore": "Restore it",
  "catalog.recipe.preview.save.back_to_default": "Go back to the default at {shop}",
  "catalog.recipe.preview.save.adopt": "Use it at {shop}",
  "catalog.recipe.preview.save.promote": "Make it the default",
  "catalog.recipe.error.generic": "Something went wrong. Try again.",
  "catalog.recipe.error.version_changed": "Someone changed this recipe a moment ago. Reload the page and try again.",
  "catalog.recipe.error.forbidden": "You can't change this.",
  "catalog.recipe.error.not_found": "That shop or version isn't yours to change here.",
  "catalog.recipe.error.global_requires_moo": "Only the Director of Operations changes the recipe for every shop. Change your shop's version instead.",
  "catalog.recipe.error.step_up_required": "Confirm your password to save.",
  "catalog.recipe.error.step_up_stale": "Your 15 minutes ran out. Confirm your password again.",
  "catalog.recipe.error.preview_stale": "Something changed since you looked. See what this changes again.",
  "catalog.recipe.error.line_changed": "Someone changed that ingredient first. Reload the page and try again.",
  "catalog.recipe.error.edge_not_found": "That ingredient is gone. Reload the page.",
  "catalog.recipe.error.empty_recipe": "A recipe needs at least one ingredient.",
  "catalog.recipe.error.would_create_cycle": "That would make the recipe use itself. Pick another ingredient.",
  "catalog.recipe.error.recipe_inactive": "This recipe is retired.",
  "catalog.recipe.error.invalid_source": "That version can't be copied any more. Reload the page.",
  "catalog.recipe.error.not_live": "There is nothing to undo here. Reload the page.",
  "catalog.recipe.error.nothing_changed": "Nothing changed.",
  "catalog.recipe.error.invalid_payload": "Check what you typed and try again.",
  "catalog.recipe.error.invalid_component": "Pick one ingredient.",
  "catalog.recipe.error.invalid_quantity": "The amount must be more than zero.",
  "catalog.recipe.error.product_line_needs_measure_unit": "A product takes a measure unit, like oz, lb or each.",
  "catalog.recipe.error.invalid_component_product": "That product is retired. Pick another one.",
  "catalog.recipe.error.invalid_lines": "Check the ingredients and try again.",
  "catalog.recipe.error.recipe_not_found": "This recipe is gone.",
  "catalog.recipe.error.location_not_found": "That shop is closed.",
  "catalog.recipe.error.dependencies_changed": "Something this recipe uses changed since you looked. See what this changes again.",
  "catalog.recipe.error.dependencies_busy": "Someone is changing an ingredient of this recipe right now. Try again in a moment.",
  "catalog.recipe.error.product_line_invalid": "That ingredient is a retired product or is measured in a pack word.",
  "catalog.recipe.error.line_refused": "Line {position} ({name}): {reason}",
  "catalog.recipe.line_problem": "Line {position} ({name}) needs fixing: {reason}",
  "catalog.recipe.preview.flagged_title": "Lines that still need fixing (you can save without them)",
  "catalog.menu.kind": "Sandwich",
  "catalog.menu.version.global": "Global menu",
  "catalog.menu.version.shop_default": "{shop} · same as the global menu",
  "catalog.menu.version.shop_own": "{shop}'s settings",
  "catalog.menu.shop_switcher": "Show the menu for",
  "catalog.menu.global_view_hint": "Pick a shop above to set its price, its name, or whether it sells this.",
  "catalog.menu.section.here": "At this shop",
  "catalog.menu.price_here": "Price here",
  "catalog.menu.price_hint": "Leave it empty to use the global price ({price}).",
  "catalog.menu.sold_here": "Sold at this shop",
  "catalog.menu.name_here": "Name here (English)",
  "catalog.menu.name_here_es": "Name here (Spanish)",
  "catalog.menu.name_hint": "Leave it empty to use “{name}”.",
  "catalog.menu.see_changes": "See what this changes",
  "catalog.menu.cancel": "Cancel",
  "catalog.menu.cost": "Food cost here: {cost}",
  "catalog.menu.cost_unknown": "Food cost here: not known yet",
  "catalog.menu.recipe": "Recipe",
  "catalog.menu.recipe_none": "No recipe yet.",
  "catalog.menu.toast_links": "Linked in Toast: {n}",
  "catalog.menu.back_to_default": "Go back to the global menu",
  "catalog.menu.section.history": "History",
  "catalog.menu.history_count": "{n} changes",
  "catalog.menu.restore": "Restore",
  "catalog.menu.current": "In use",
  "catalog.menu.history_price": "Price {price}",
  "catalog.menu.history_off": "Not sold here",
  "catalog.menu.history_name": "Name “{name}”",
  "catalog.menu.saved": "Saved.",
  "catalog.menu.open_page": "Open the sandwich page",
  "catalog.menu.preview.title": "What this changes",
  "catalog.menu.preview.price": "Price: {before} → {after}",
  "catalog.menu.preview.margin": "Margin: {before} → {after}",
  "catalog.menu.preview.sold": "Sold here: {before} → {after}",
  "catalog.menu.preview.name": "Name: {before} → {after}",
  "catalog.menu.preview.name_es": "Spanish name: {before} → {after}",
  "catalog.menu.preview.inherits": "After this save — price: {price} · name: {name}",
  "catalog.menu.preview.inherits_default": "the default's",
  "catalog.menu.preview.inherits_own": "this shop's own",
  "catalog.menu.preview.yes": "yes",
  "catalog.menu.preview.no": "no",
  "catalog.menu.preview.shops": "Shops that change: {shops}",
  "catalog.menu.preview.returned": "{shop} goes back to the default for what you share.",
  "catalog.menu.preview.save_shop": "Save for {shop}",
  "catalog.menu.preview.save_promote": "Make it everyone's",
  "catalog.menu.preview.save_back": "Go back to the global menu",
  "catalog.menu.preview.save_restore": "Restore it",
  "catalog.menu.error.generic": "Something went wrong. Try again.",
  "catalog.menu.error.forbidden": "You can't change this.",
  "catalog.menu.error.not_found": "That shop or setting isn't yours to change here.",
  "catalog.menu.error.version_changed": "Someone changed this a moment ago. Reload the page and try again.",
  "catalog.menu.error.not_live": "There is nothing to undo here. Reload the page.",
  "catalog.menu.error.global_changed": "The global price or name changed since you looked. Reload the page.",
  "catalog.menu.error.nothing_to_promote": "That shop has no price or name of its own to share.",
  "catalog.menu.error.invalid_menu_price": "Type a price like 12.50.",
  "catalog.menu.error.invalid_name": "Names are 120 letters or fewer.",
  "catalog.menu.error.empty_setting": "Nothing is different here. Use “Go back to the global menu” instead.",
  "catalog.menu.error.invalid_source": "That older setting can't be restored here.",
  "catalog.menu.error.invalid_payload": "Check what you typed and try again.",
  "catalog.menu.error.preview_stale": "Something changed since you looked. See what this changes again.",
  "catalog.menu.error.step_up_required": "Confirm your password to save.",
  "catalog.menu.error.step_up_stale": "Your 15 minutes ran out. Confirm your password again.",
  "catalog.menu.error.menu_item_not_found": "This sandwich is off every menu.",
  "catalog.menu.error.location_not_found": "That shop is closed.",
  "catalog.menu.error.global_requires_moo": "Only the Director of Operations changes the menu for every shop.",
  "catalog.menu.error.dependencies_changed": "A price, a cost or another shop's menu changed since you looked. See what this changes again.",
  "catalog.menu.error.dependencies_busy": "Someone is changing an ingredient of this item right now. Try again in a moment.",
  "catalog.changes.title": "Shop changes",
  "catalog.changes.intro": "Each shop's own recipes and menu settings. Make one the default for everyone, or leave it as the shop's.",
  "catalog.changes.recipes": "Recipes",
  "catalog.changes.recipes_count": "{n} shop versions",
  "catalog.changes.menu": "Menu items",
  "catalog.changes.menu_count": "{n} shop settings",
  "catalog.changes.none": "No shop has its own version.",
  "catalog.changes.by": "{shop} · {who} · {date}",
  "catalog.changes.same_as_default": "Same as the default right now",
  "catalog.changes.adopted_from": "Copied from {shop}",
  "catalog.changes.promote": "Make it the default",
  "catalog.changes.leave": "Leave it",
  "catalog.changes.promote_price": "Make {price} everyone's price",
  "catalog.changes.promote_name": "Make “{name}” everyone's name",
  "catalog.changes.off_here": "Not sold here",
  "catalog.changes.price_here": "Price here: {price} (everyone: {global})",
  "catalog.changes.name_here": "Name here: {name}",
  "catalog.changes.open": "Open",
  "catalog.changes.show": "Show what changed",
  "catalog.changes.hide": "Hide what changed",
  "catalog.notices.title": "Recipe updates",
  "catalog.notices.intro": "Other shops changed recipes your shop uses. Your food changes only if you say yes.",
  "catalog.notices.none": "Nothing new for this shop.",
  "catalog.notices.pick_shop": "Pick your shop",
  "admin.section.shop-changes": "Shop changes",
  "admin.section.recipe-notices": "Recipe updates",
  "recipes.error.global_requires_moo": "Only the Director of Operations changes the recipe for every shop. Change your shop's version on the recipe's catalog page.",
  "recipes.catalog_link": "Shop versions of this recipe",
  "recipes.catalog_link_hint": "Each shop can have its own ingredients and amounts. Change them on the catalog page."
```

- [ ] **Step 3: Spanish (tú) — in `lib/i18n/es.json`, put a comma after the current last entry and add:**

```json
  "catalog.recipe.kind.production": "Receta de preparación",
  "catalog.recipe.kind.consumer": "Receta de sándwich",
  "catalog.recipe.version.global": "Predeterminado global",
  "catalog.recipe.version.shop_default": "{shop} · usa el predeterminado global",
  "catalog.recipe.version.shop_own": "Versión de {shop} · basada en el predeterminado global",
  "catalog.recipe.version.shop_adopted": "Versión de {shop} · copiada de {from}",
  "catalog.recipe.shop_switcher": "Ver la receta de",
  "catalog.recipe.shop_global": "Todos (global)",
  "catalog.recipe.inactive": "Esta receta está retirada.",
  "catalog.recipe.connections": "Cómo se conecta",
  "catalog.recipe.ingredients_from": "Los ingredientes vienen de",
  "catalog.recipe.vendors_none": "Todavía sin proveedor",
  "catalog.recipe.makes": "Hace",
  "catalog.recipe.used_in": "Se usa en",
  "catalog.recipe.used_in_none": "No se usa en otra receta.",
  "catalog.recipe.section.lines": "Qué lleva",
  "catalog.recipe.lines_count": "{n} ingredientes",
  "catalog.recipe.lines_locked": "Guarda o descarta tu cambio para cerrar esto.",
  "catalog.recipe.changed_here": "Cambiado aquí",
  "catalog.recipe.edit_line": "Editar",
  "catalog.recipe.remove_line": "Quitar",
  "catalog.recipe.add_line": "+ Agregar ingrediente",
  "catalog.recipe.edit_title": "Cambia este ingrediente",
  "catalog.recipe.add_title": "Agrega un ingrediente",
  "catalog.recipe.see_changes": "Ver qué cambia",
  "catalog.recipe.cancel": "Cancelar",
  "catalog.recipe.pick_shop_hint": "Para cambiar la receta de tu tienda, elige tu tienda arriba.",
  "catalog.recipe.global_moo_hint": "Solo el Director de Operaciones cambia la receta para todas las tiendas.",
  "catalog.recipe.differs_title": "Cambiado respecto al predeterminado",
  "catalog.recipe.differs_none": "Igual que el predeterminado ahora.",
  "catalog.recipe.section.makes": "Qué hace",
  "catalog.recipe.yield": "Hace {n}",
  "catalog.recipe.cost_here": "Costo aquí: {cost}",
  "catalog.recipe.edit_outputs": "Editar qué hace, rendimientos y pasos",
  "catalog.recipe.section.others": "Versiones de otras tiendas",
  "catalog.recipe.others_count": "{n} tiendas",
  "catalog.recipe.others_none": "Ninguna otra tienda tiene su propia versión.",
  "catalog.recipe.adopt": "Usar aquí la versión de {shop}",
  "catalog.recipe.promote": "Hacerla el predeterminado para todos",
  "catalog.recipe.back_to_default": "Volver al predeterminado",
  "catalog.recipe.back_to_default_hint": "Tu versión queda en el historial. Puedes restaurarla.",
  "catalog.recipe.section.history": "Historial",
  "catalog.recipe.history_count": "{n} versiones",
  "catalog.recipe.history_global": "Global",
  "catalog.recipe.history_by": "{scope} · {date} · {who}",
  "catalog.recipe.history_lines": "{n} ingredientes",
  "catalog.recipe.restore": "Restaurar",
  "catalog.recipe.current": "En uso",
  "catalog.recipe.promoted_from": "Hecho predeterminado desde la versión de {shop}",
  "catalog.recipe.adopted_from": "Copiada de {shop}",
  "catalog.recipe.saved": "Guardado.",
  "catalog.recipe.notices": "Novedades de otras tiendas",
  "catalog.recipe.notice.source_changed": "{shop} cambió {recipe}, que copiaste. ¿Tomas la actualización?",
  "catalog.recipe.notice.source_gone": "{shop} volvió al {recipe} predeterminado.",
  "catalog.recipe.notice.source_promoted": "El {recipe} de {shop} ahora es el predeterminado de todas las tiendas. ¿Vuelves al predeterminado?",
  "catalog.recipe.notice.edited_since": "Cambiaste tu copia desde que la adoptaste. Tomar la actualización reemplaza tus cambios — mira primero qué cambia.",
  "catalog.recipe.edit_conflict": "Alguien cambió este ingrediente mientras editabas. Tu cambio se sigue comparando con lo que viste, así que al guardar verás el conflicto.",
  "catalog.recipe.edit_rebase": "Empezar de nuevo desde la versión nueva",
  "catalog.recipe.preview.drops_link": "Esto quita el vínculo con la receta de {shop} — dejarás de recibir sus actualizaciones.",
  "catalog.recipe.history.link_ended": "Terminó el vínculo con la receta de {shop}",
  "catalog.recipe.notice.new_default": "{recipe} tiene un nuevo predeterminado para todas las tiendas (de {shop}).",
  "catalog.recipe.notice.take_update": "Tomar la actualización",
  "catalog.recipe.notice.back_to_default": "Volver también al predeterminado",
  "catalog.recipe.notice.keep_mine": "Quedarme con la mía",
  "catalog.recipe.notice.got_it": "Entendido",
  "catalog.recipe.notice.open": "Abrir la receta",
  "catalog.recipe.preview.title": "Qué cambia",
  "catalog.recipe.preview.changes": "Ingredientes",
  "catalog.recipe.preview.added": "Agregar {line}",
  "catalog.recipe.preview.removed": "Quitar {line}",
  "catalog.recipe.preview.changed": "{before} → {after}",
  "catalog.recipe.preview.none": "Los ingredientes no cambian.",
  "catalog.recipe.preview.scope_global": "Todos con el predeterminado",
  "catalog.recipe.preview.untouched": "Sin cambio (tienen su propia versión): {shops}",
  "catalog.recipe.preview.returned": "{shop} vuelve al predeterminado. Su comida no cambia.",
  "catalog.recipe.preview.no_cost_change": "No cambia el costo de ningún sándwich.",
  "catalog.recipe.preview.cost_row": "{name}: {before} → {after}",
  "catalog.recipe.preview.item_cost": "{name}, costo por unidad: {before} → {after}",
  "catalog.recipe.preview.discard": "Ahora no",
  "catalog.recipe.preview.save.lines_shop": "Guardar para {shop}",
  "catalog.recipe.preview.save.lines_global": "Guardar para todos",
  "catalog.recipe.preview.save.restore": "Restaurarla",
  "catalog.recipe.preview.save.back_to_default": "Volver al predeterminado en {shop}",
  "catalog.recipe.preview.save.adopt": "Usarla en {shop}",
  "catalog.recipe.preview.save.promote": "Hacerla el predeterminado",
  "catalog.recipe.error.generic": "Algo salió mal. Inténtalo de nuevo.",
  "catalog.recipe.error.version_changed": "Alguien cambió esta receta hace un momento. Recarga la página e inténtalo de nuevo.",
  "catalog.recipe.error.forbidden": "No puedes cambiar esto.",
  "catalog.recipe.error.not_found": "Esa tienda o versión no te toca cambiarla aquí.",
  "catalog.recipe.error.global_requires_moo": "Solo el Director de Operaciones cambia la receta para todas las tiendas. Cambia la versión de tu tienda.",
  "catalog.recipe.error.step_up_required": "Confirma tu contraseña para guardar.",
  "catalog.recipe.error.step_up_stale": "Se acabaron tus 15 minutos. Confirma tu contraseña otra vez.",
  "catalog.recipe.error.preview_stale": "Algo cambió desde que miraste. Vuelve a ver qué cambia.",
  "catalog.recipe.error.line_changed": "Alguien cambió ese ingrediente primero. Recarga la página e inténtalo de nuevo.",
  "catalog.recipe.error.edge_not_found": "Ese ingrediente ya no está. Recarga la página.",
  "catalog.recipe.error.empty_recipe": "Una receta necesita al menos un ingrediente.",
  "catalog.recipe.error.would_create_cycle": "Así la receta se usaría a sí misma. Elige otro ingrediente.",
  "catalog.recipe.error.recipe_inactive": "Esta receta está retirada.",
  "catalog.recipe.error.invalid_source": "Esa versión ya no se puede copiar. Recarga la página.",
  "catalog.recipe.error.not_live": "No hay nada que deshacer aquí. Recarga la página.",
  "catalog.recipe.error.nothing_changed": "No cambió nada.",
  "catalog.recipe.error.invalid_payload": "Revisa lo que escribiste e inténtalo de nuevo.",
  "catalog.recipe.error.invalid_component": "Elige un ingrediente.",
  "catalog.recipe.error.invalid_quantity": "La cantidad debe ser mayor que cero.",
  "catalog.recipe.error.product_line_needs_measure_unit": "Un producto lleva una unidad de medida, como oz, lb o each.",
  "catalog.recipe.error.invalid_component_product": "Ese producto está retirado. Elige otro.",
  "catalog.recipe.error.invalid_lines": "Revisa los ingredientes e inténtalo de nuevo.",
  "catalog.recipe.error.recipe_not_found": "Esta receta ya no existe.",
  "catalog.recipe.error.location_not_found": "Esa tienda está cerrada.",
  "catalog.recipe.error.dependencies_changed": "Algo que usa esta receta cambió desde que miraste. Vuelve a ver qué cambia.",
  "catalog.recipe.error.dependencies_busy": "Alguien está cambiando un ingrediente de esta receta ahora mismo. Intenta de nuevo en un momento.",
  "catalog.recipe.error.product_line_invalid": "Ese ingrediente es un producto retirado o se mide con una palabra de empaque.",
  "catalog.recipe.error.line_refused": "Línea {position} ({name}): {reason}",
  "catalog.recipe.line_problem": "La línea {position} ({name}) necesita arreglo: {reason}",
  "catalog.recipe.preview.flagged_title": "Líneas que aún necesitan arreglo (puedes guardar sin ellas)",
  "catalog.menu.kind": "Sándwich",
  "catalog.menu.version.global": "Menú global",
  "catalog.menu.version.shop_default": "{shop} · igual que el menú global",
  "catalog.menu.version.shop_own": "Ajustes de {shop}",
  "catalog.menu.shop_switcher": "Ver el menú de",
  "catalog.menu.global_view_hint": "Elige una tienda arriba para fijar su precio, su nombre o si lo vende.",
  "catalog.menu.section.here": "En esta tienda",
  "catalog.menu.price_here": "Precio aquí",
  "catalog.menu.price_hint": "Déjalo vacío para usar el precio global ({price}).",
  "catalog.menu.sold_here": "Se vende en esta tienda",
  "catalog.menu.name_here": "Nombre aquí (inglés)",
  "catalog.menu.name_here_es": "Nombre aquí (español)",
  "catalog.menu.name_hint": "Déjalo vacío para usar “{name}”.",
  "catalog.menu.see_changes": "Ver qué cambia",
  "catalog.menu.cancel": "Cancelar",
  "catalog.menu.cost": "Costo de comida aquí: {cost}",
  "catalog.menu.cost_unknown": "Costo de comida aquí: todavía no se sabe",
  "catalog.menu.recipe": "Receta",
  "catalog.menu.recipe_none": "Todavía no tiene receta.",
  "catalog.menu.toast_links": "Vinculado en Toast: {n}",
  "catalog.menu.back_to_default": "Volver al menú global",
  "catalog.menu.section.history": "Historial",
  "catalog.menu.history_count": "{n} cambios",
  "catalog.menu.restore": "Restaurar",
  "catalog.menu.current": "En uso",
  "catalog.menu.history_price": "Precio {price}",
  "catalog.menu.history_off": "No se vende aquí",
  "catalog.menu.history_name": "Nombre “{name}”",
  "catalog.menu.saved": "Guardado.",
  "catalog.menu.open_page": "Abrir la página del sándwich",
  "catalog.menu.preview.title": "Qué cambia",
  "catalog.menu.preview.price": "Precio: {before} → {after}",
  "catalog.menu.preview.margin": "Margen: {before} → {after}",
  "catalog.menu.preview.sold": "Se vende aquí: {before} → {after}",
  "catalog.menu.preview.name": "Nombre: {before} → {after}",
  "catalog.menu.preview.name_es": "Nombre en español: {before} → {after}",
  "catalog.menu.preview.inherits": "Después de guardar — precio: {price} · nombre: {name}",
  "catalog.menu.preview.inherits_default": "el predeterminado",
  "catalog.menu.preview.inherits_own": "el propio de esta tienda",
  "catalog.menu.preview.yes": "sí",
  "catalog.menu.preview.no": "no",
  "catalog.menu.preview.shops": "Tiendas que cambian: {shops}",
  "catalog.menu.preview.returned": "{shop} vuelve al predeterminado en lo que compartes.",
  "catalog.menu.preview.save_shop": "Guardar para {shop}",
  "catalog.menu.preview.save_promote": "Hacerlo de todos",
  "catalog.menu.preview.save_back": "Volver al menú global",
  "catalog.menu.preview.save_restore": "Restaurarlo",
  "catalog.menu.error.generic": "Algo salió mal. Inténtalo de nuevo.",
  "catalog.menu.error.forbidden": "No puedes cambiar esto.",
  "catalog.menu.error.not_found": "Esa tienda o ajuste no te toca cambiarlo aquí.",
  "catalog.menu.error.version_changed": "Alguien cambió esto hace un momento. Recarga la página e inténtalo de nuevo.",
  "catalog.menu.error.not_live": "No hay nada que deshacer aquí. Recarga la página.",
  "catalog.menu.error.global_changed": "El precio o el nombre global cambió desde que miraste. Recarga la página.",
  "catalog.menu.error.nothing_to_promote": "Esa tienda no tiene precio ni nombre propio que compartir.",
  "catalog.menu.error.invalid_menu_price": "Escribe un precio como 12.50.",
  "catalog.menu.error.invalid_name": "Los nombres tienen 120 letras o menos.",
  "catalog.menu.error.empty_setting": "Aquí no hay nada distinto. Usa “Volver al menú global”.",
  "catalog.menu.error.invalid_source": "Ese ajuste anterior no se puede restaurar aquí.",
  "catalog.menu.error.invalid_payload": "Revisa lo que escribiste e inténtalo de nuevo.",
  "catalog.menu.error.preview_stale": "Algo cambió desde que miraste. Vuelve a ver qué cambia.",
  "catalog.menu.error.step_up_required": "Confirma tu contraseña para guardar.",
  "catalog.menu.error.step_up_stale": "Se acabaron tus 15 minutos. Confirma tu contraseña otra vez.",
  "catalog.menu.error.menu_item_not_found": "Este sándwich ya no está en ningún menú.",
  "catalog.menu.error.location_not_found": "Esa tienda está cerrada.",
  "catalog.menu.error.global_requires_moo": "Solo el Director de Operaciones cambia el menú para todas las tiendas.",
  "catalog.menu.error.dependencies_changed": "Cambió un precio, un costo o el menú de otra tienda desde que miraste. Vuelve a ver qué cambia.",
  "catalog.menu.error.dependencies_busy": "Alguien está cambiando un ingrediente de este artículo ahora mismo. Intenta de nuevo en un momento.",
  "catalog.changes.title": "Cambios de las tiendas",
  "catalog.changes.intro": "Las recetas y ajustes de menú propios de cada tienda. Haz uno el predeterminado para todos, o déjalo como de la tienda.",
  "catalog.changes.recipes": "Recetas",
  "catalog.changes.recipes_count": "{n} versiones de tienda",
  "catalog.changes.menu": "Productos del menú",
  "catalog.changes.menu_count": "{n} ajustes de tienda",
  "catalog.changes.none": "Ninguna tienda tiene su propia versión.",
  "catalog.changes.by": "{shop} · {who} · {date}",
  "catalog.changes.same_as_default": "Igual que el predeterminado ahora",
  "catalog.changes.adopted_from": "Copiada de {shop}",
  "catalog.changes.promote": "Hacerlo el predeterminado",
  "catalog.changes.leave": "Dejarlo",
  "catalog.changes.promote_price": "Hacer {price} el precio de todos",
  "catalog.changes.promote_name": "Hacer “{name}” el nombre de todos",
  "catalog.changes.off_here": "No se vende aquí",
  "catalog.changes.price_here": "Precio aquí: {price} (todos: {global})",
  "catalog.changes.name_here": "Nombre aquí: {name}",
  "catalog.changes.open": "Abrir",
  "catalog.changes.show": "Ver qué cambió",
  "catalog.changes.hide": "Ocultar qué cambió",
  "catalog.notices.title": "Novedades de recetas",
  "catalog.notices.intro": "Otras tiendas cambiaron recetas que usa tu tienda. Tu comida solo cambia si dices que sí.",
  "catalog.notices.none": "Nada nuevo para esta tienda.",
  "catalog.notices.pick_shop": "Elige tu tienda",
  "admin.section.shop-changes": "Cambios de las tiendas",
  "admin.section.recipe-notices": "Novedades de recetas",
  "recipes.error.global_requires_moo": "Solo el Director de Operaciones cambia la receta para todas las tiendas. Cambia la versión de tu tienda en la página del catálogo de la receta.",
  "recipes.catalog_link": "Versiones de tienda de esta receta",
  "recipes.catalog_link_hint": "Cada tienda puede tener sus propios ingredientes y cantidades. Cámbialos en la página del catálogo."
```

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/catalog-recipe-i18n.test.ts && node -e "JSON.parse(require('fs').readFileSync('lib/i18n/en.json','utf8'));JSON.parse(require('fs').readFileSync('lib/i18n/es.json','utf8'));console.log('json ok')"`
Expected: PASS; `json ok`.

```bash
git add lib/i18n/en.json lib/i18n/es.json tests/catalog-recipe-i18n.test.ts
git commit -F - <<'EOF'
feat(i18n): the recipe, menu-item, shop-changes and notices strings (en + es, tú)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 8: The recipe page — the preview panel, the client body, the server page

Layout follows spec §4 "Screens" and 2b's item page. On a **phone** (one column) "How it connects" sits at the top and the sections follow; on **tablet/desktop** (`md:`) the sections take the main column and the connections move to a side panel. The only horizontal scroller is the shop switcher, inside its own container. Identity and alerts (the version label, the notices) are always visible; "What goes in" is the page's primary content and starts open; "What it makes", "Other shops' versions" and "History" are default-collapsed `CollapsibleSection`s with an i18n'd count. Disclosure state is `useState` only. Every write asks Tier E through `useStepUpPost`; every preview goes through `createRequestGuard`, and the page remounts the body per (recipe, shop).

**Files:**
- Create: `components/catalog/RecipePreviewPanel.tsx`, `components/catalog/RecipeItemClient.tsx`, `app/admin/catalog/recipe/[id]/page.tsx`
- Modify: `components/admin/vendors/shared.ts` (a refusal carries the refused line), `tests/step-up-tier-map.test.ts`
- Test: `tests/catalog-recipe-ui.test.ts`, `tests/catalog-recipe-navigation.test.ts`

- [ ] **Step 1: Write the failing UI test `tests/catalog-recipe-ui.test.ts`**

```ts
/** Catalog Phase 3b — the recipe page body: version, connections, lines, notices, other shops, history (en + es), 44px. */
import { type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import type { RecipeItemView } from "@/lib/catalog/recipe-item-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: async () => "ok", forgetStepUp: () => {} }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => async () => ({ ok: true, data: {} }) }));
const { RecipeItemClient } = await import("@/components/catalog/RecipeItemClient");

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const OTHER = "6f1d2c3e-0000-4000-8000-00000000000b";
const turkey = { componentSkuId: "sku-t", componentItemId: null, componentProductId: null, quantity: 5, unit: "oz", eachContainerLabel: null, portioned: false };
const view: RecipeItemView = {
  recipe: { id: "7d0c1f2e-0000-4000-8000-000000000001", name: "Italian", nameEs: "Italiano", recipeType: "consumer", active: true },
  shops: [{ id: SHOP, name: "P Street" }, { id: OTHER, name: "Capitol Hill" }],
  scope: SHOP, scopeName: "P Street",
  can: { editShop: true, editGlobal: false },
  version: { scopeVersionId: "sv", globalVersionId: "gv", ridesDefault: false, adoptedFromShopName: null, validFrom: "2026-10-10T00:00:00Z" },
  lines: [{ lineId: "l1", fields: turkey, name: "Turkey", kind: "sku", vendorName: "Baldor", changedHere: true, problem: null }],
  differsFromDefault: [{ kind: "changed", key: "sku:sku-t", before: { ...turkey, quantity: 4 }, after: turkey }],
  makes: [{ kind: "menu_item", id: "m1", name: "Italian", nameEs: "Italiano", yield: 1, costHere: 2.5 }],
  usedIn: [],
  vendors: ["Baldor"],
  otherShopVersions: [{ versionId: "ov", shopId: OTHER, shopName: "Capitol Hill", validFrom: "2026-10-11T00:00:00Z", createdByName: "Luis", changes: [] }],
  notices: [{ kind: "new_default", recipeId: "7d0c1f2e-0000-4000-8000-000000000001", recipeName: "Italian", seenVersionId: "gv", fromShopName: "Capitol Hill", at: "2026-10-12T00:00:00Z" }],
  history: [
    { id: "sv", scope: "shop", shopName: "P Street", active: true, validFrom: "2026-10-10T00:00:00Z", validTo: null, who: "Ana", note: null, lineCount: 1, promotedFromShopName: null, adoptedFromShopName: null, linkEndedFromShopName: null },
    { id: "g0", scope: "global", shopName: null, active: false, validFrom: "2000-01-01T00:00:00Z", validTo: "2026-10-01T00:00:00Z", who: null, note: "0262 baseline", lineCount: 1, promotedFromShopName: null, adoptedFromShopName: null, linkEndedFromShopName: null },
  ],
  names: { "sku:sku-t": "Turkey" },
  picker: { skus: [], items: [], products: [], measures: [{ label: "oz", dimension: "weight", toBaseFactor: 1 }], activeMeasureLabels: ["oz"] },
};
const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));

describe("RecipeItemClient", () => {
  it("says which version it shows, how it connects, what changed here, and the notice — always visible", () => {
    const html = render(jsx(RecipeItemClient, { view }));
    expect(html).toContain("P Street&#x27;s version · based on the global default");
    expect(html).toContain(en["catalog.recipe.connections"]);
    expect(html).toContain("Baldor");
    expect(html).toContain(en["catalog.recipe.changed_here"]);
    expect(html).toContain(en["catalog.recipe.notices"]);
    expect(html).toContain("Italian has a new default for every shop (from Capitol Hill).");
    expect(html).toContain(en["catalog.recipe.back_to_default"]);
  });
  it("collapsed sections carry their counts; every button is 44px", () => {
    const html = render(jsx(RecipeItemClient, { view }));
    for (const k of ["catalog.recipe.section.makes", "catalog.recipe.section.others", "catalog.recipe.section.history"] as const) expect(html).toContain(en[k]);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/);
  });
  it("a GM never sees 'for everyone' choices; a MoO in the global view does", () => {
    expect(render(jsx(RecipeItemClient, { view }))).not.toContain(en["catalog.recipe.promote"]);
    const moo = { ...view, scope: null, scopeName: null, can: { editShop: false, editGlobal: true }, version: { ...view.version, ridesDefault: false } };
    expect(render(jsx(RecipeItemClient, { view: moo }))).toContain(en["catalog.recipe.version.global"]);
  });
  it("Spanish throughout (tú)", () => {
    const html = render(jsx(RecipeItemClient, { view }), "es");
    expect(html).toContain("Versión de P Street · basada en el predeterminado global");
    expect(html).toContain(es["catalog.recipe.section.lines"]);
    expect(html).toContain(es["catalog.recipe.notice.got_it"]);
  });
});
```

Run: `npx vitest run tests/catalog-recipe-ui.test.ts` → FAIL (module not found).

- [ ] **Step 2: Write the navigation pin `tests/catalog-recipe-navigation.test.ts`**

```ts
/** Catalog Phase 3b — a shop switch remounts the page body; every preview goes through the guard; saves post the preview's token. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the recipe and menu-item pages remount per (item, shop)", () => {
  it("keys the client by pageClientKey", () => {
    expect(readFileSync("app/admin/catalog/recipe/[id]/page.tsx", "utf8")).toContain('key={pageClientKey("recipe", view.recipe.id, view.scope)}');
    expect(readFileSync("app/admin/catalog/menu-item/[id]/page.tsx", "utf8")).toContain('key={pageClientKey("menu", view.item.id, view.scope)}');
  });
  it("previews run through the guard; a save posts exactly the previewed change and its token", () => {
    for (const f of ["components/catalog/RecipeItemClient.tsx", "components/catalog/MenuItemClient.tsx", "components/catalog/ShopChangesClient.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("guard.run(");
      expect(src, f).toContain("previewToken: preview.token");
      expect(src, f).toContain('requestStepUp("E")');
    }
  });
  it("an edit submits the baseline captured at Edit, never the refreshed props (Astra 3b r5#1)", () => {
    const src = readFileSync("components/catalog/RecipeItemClient.tsx", "utf8");
    expect(src).toContain('op: { kind: "update", lineId: l.lineId, line: fieldsOf(d), expected: editing.expected }');
    expect(src).not.toContain('line: fieldsOf(d), expected: l.fields }');
    expect(src).toContain("lineEditStale(editing.expected, l.fields)");
  });
  it("D10: the ingredients section stays mounted and locked open while a line draft exists (Astra 3b r1#8)", () => {
    const src = readFileSync("components/catalog/RecipeItemClient.tsx", "utf8");
    expect(src).toContain('const linesDirty = editing !== null || pending?.kind === "lines";');
    expect(src).toContain('if (s === "lines" && linesDirty) return;');
    expect(src).toContain("open={open.lines || linesDirty}");
  });
  it("a refused line is NAMED — in the message and beside the line; a carried broken line is flagged (lead decision (b))", () => {
    const src = readFileSync("components/catalog/RecipeItemClient.tsx", "utf8");
    expect(src).toContain("fail(r.code, r.line)");
    expect(src).toContain('t("catalog.recipe.error.line_refused", { position: line.position, name: line.name, reason: t(errorKey(line.reason)) })');
    expect(src).toContain('{l.problem ? (');
    expect(readFileSync("components/catalog/RecipePreviewPanel.tsx", "utf8")).toContain("preview.flagged.map(");
    expect(readFileSync("components/admin/vendors/shared.ts", "utf8")).toContain("return line ? { ok: false, code, line } : { ok: false, code };");
    // the Shop changes list names a refused line too, preview AND promote (Astra 3b r3#3)
    const changes = readFileSync("components/catalog/ShopChangesClient.tsx", "utf8");
    expect(changes).toContain("else setMessage(failMessage(r, p.kind));");
    expect(changes).toContain("else setMessage(failMessage(r, pending.kind));");
    expect(changes).toContain('"invalid_component_product", "product_line_needs_measure_unit"');
  });
  it("the menu form resets to the committed row after every refresh (Astra 3b r1#6)", () => {
    const src = readFileSync("components/catalog/MenuItemClient.tsx", "utf8");
    expect(src).toContain("const revision = menuFormRevision(view);");
    expect(src).toContain("if (formRevision !== revision) {");
    expect(src).toContain("setSoldHere(view.here.soldHere);");
    expect(src).toContain('setPriceText(view.here.price === null ? "" : String(view.here.price));');
  });
});
```

- [ ] **Step 2b: A refusal carries WHICH line (`components/admin/vendors/shared.ts`)** — lead decision (b). The shared `postJson` keeps its machine-stable `code` and now also passes the route's `line` (`{ position, name, reason }`, 3a Task 10) through; every existing caller ignores it.

Replace

```ts
export type PostResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string };
```

with

```ts
export type PostResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; line?: { position: number; name: string; reason: string } };
```

and in `postJson`, replace

```ts
    let code = "generic";
    try {
      const parsed = (await res.json()) as { code?: string };
      if (typeof parsed.code === "string") code = parsed.code;
```

with

```ts
    let code = "generic";
    let line: { position: number; name: string; reason: string } | undefined;
    try {
      const parsed = (await res.json()) as { code?: string; line?: { position?: unknown; name?: unknown; reason?: unknown } };
      if (typeof parsed.code === "string") code = parsed.code;
      // A refused recipe LINE (catalog Phase 3, lead decision (b)): which one and why, for the page to name it.
      const l = parsed.line;
      if (l && typeof l.position === "number" && typeof l.name === "string" && typeof l.reason === "string") {
        line = { position: l.position, name: l.name, reason: l.reason };
      }
```

and the failure return `    return { ok: false, code };` (the one after that `try`) with `    return line ? { ok: false, code, line } : { ok: false, code };`.

- [ ] **Step 3: Create `components/catalog/RecipePreviewPanel.tsx`**

```tsx
"use client";

/**
 * "WHAT THIS CHANGES" for a recipe act (catalog Phase 3b; spec §4). Renders the server's preview: the
 * ingredient changes in plain words, every reached scope's sandwich cost moves (and the prep items it
 * makes), the shops left untouched, and ONE save button for THE previewed act and target.
 */
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatQuantity } from "@/lib/i18n/format";
import { lineText, type RecipePreview } from "@/lib/catalog/recipe-preview-shared";
import type { TranslationKey } from "@/lib/i18n/types";

const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";

export function RecipePreviewPanel({
  preview, saveLabel, busy, onSave, onDiscard,
}: { preview: RecipePreview; saveLabel: string; busy: boolean; onSave: () => void; onDiscard: () => void }) {
  const { t, language } = useTranslation();
  const money = (n: number | null) => (n == null ? "—" : formatCents(Math.round(n * 100), language));
  const fmt = (n: number) => formatQuantity(n, language);
  const line = (f: Parameters<typeof lineText>[0]) => lineText(f, preview.names, fmt);
  return (
    <section aria-label={t("catalog.recipe.preview.title")} className="rounded-xl border-2 border-co-text bg-co-surface p-3">
      <h3 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.recipe.preview.title")}</h3>
      <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.recipe.preview.changes")}</p>
      {preview.changes.length === 0 ? (
        <p className="text-sm text-co-text">{t("catalog.recipe.preview.none")}</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {preview.changes.map((c, i) => (
            <li key={`${c.key}-${i}`} className="text-sm text-co-text">
              {c.kind === "added" && c.after ? t("catalog.recipe.preview.added", { line: line(c.after) })
                : c.kind === "removed" && c.before ? t("catalog.recipe.preview.removed", { line: line(c.before) })
                : c.before && c.after ? t("catalog.recipe.preview.changed", { before: line(c.before), after: line(c.after) }) : null}
            </li>
          ))}
        </ul>
      )}
      {preview.reached.map((r) => (
        <div key={r.scope ?? "global"} className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
            {r.scope === null ? t("catalog.recipe.preview.scope_global") : r.scopeName}
          </p>
          {r.items.map((it) => (
            <p key={it.itemId} className="text-sm text-co-text">
              {t("catalog.recipe.preview.item_cost", { name: it.name, before: money(it.before), after: money(it.after) })}
            </p>
          ))}
          {r.menu.length === 0 ? (
            <p className="text-sm text-co-text-muted">{t("catalog.recipe.preview.no_cost_change")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {r.menu.map((m) => (
                <li key={m.menuItemId} className="text-sm text-co-text">
                  {t("catalog.recipe.preview.cost_row", { name: language === "es" && m.nameEs ? m.nameEs : m.name, before: money(m.before), after: money(m.after) })}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {preview.untouched.length > 0 ? (
        <p className="mt-3 text-sm text-co-text-muted">{t("catalog.recipe.preview.untouched", { shops: preview.untouched.map((u) => u.shopName).join(", ") })}</p>
      ) : null}
      {preview.returnedShop ? (
        <p className="mt-2 text-sm text-co-text">{t("catalog.recipe.preview.returned", { shop: preview.returnedShop.shopName })}</p>
      ) : null}
      {preview.dropsLinkTo !== null ? (
        <p className="mt-2 text-sm font-bold text-co-text">{t("catalog.recipe.preview.drops_link", { shop: preview.dropsLinkTo })}</p>
      ) : null}
      {preview.flagged.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1" aria-label={t("catalog.recipe.preview.flagged_title")}>
          {preview.flagged.map((f) => (
            <li key={f.position} className="text-sm text-co-danger">
              {t("catalog.recipe.line_problem", { position: f.position, name: f.name, reason: t(`catalog.recipe.error.${f.reason}` as TranslationKey) })}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={onSave}>{saveLabel}</button>
        <button type="button" className={btn} disabled={busy} onClick={onDiscard}>{t("catalog.recipe.preview.discard")}</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `components/catalog/RecipeItemClient.tsx`**

```tsx
"use client";

/**
 * THE RECIPE PAGE — client body (catalog Phase 3b; spec §3, §4, §6). Top: what it is, which version you
 * see ("Global default" / "P Street's version · based on …"), a shop switcher, the notices. Then "How it
 * connects" (a strip on a phone, a side panel from md:), "What goes in" (edit / add / remove a line),
 * "What it makes", "Other shops' versions" (adopt; promote for MoO+), and History (Restore).
 *
 * EVERY CHANGE IS PREVIEWED FIRST: the page posts ONE RecipeChangeRequest to /preview (a read, through
 * createRequestGuard so a late answer is dropped), shows "What this changes", and Save posts exactly that
 * change with the preview's token to /apply (Tier E, useStepUpPost). Disclosure state is useState only.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { formatCents, formatDateLabel, formatQuantity } from "@/lib/i18n/format";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { RecipeLineEditor } from "@/components/admin/recipes/RecipeLineEditor";
import { RecipePreviewPanel } from "@/components/catalog/RecipePreviewPanel";
import { buildIngredientOptions } from "@/lib/ingredient-picker-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import type { RecipeLineDraft, RecipeLineFields } from "@/lib/recipe-line-shared";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import { lineText, type RecipePreview } from "@/lib/catalog/recipe-preview-shared";
import type { RecipeLineRefusal } from "@/lib/recipe-versions-shared";
import {
  lineEditStale, menuItemPageHref, recipeItemHref, recipeVersionLabel,
  type RecipeChangeRequest, type RecipeItemView, type RecipeTarget,
} from "@/lib/catalog/recipe-item-shared";

const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const btnDanger =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-cta-text disabled:opacity-50";
const linkRow = "flex min-h-[44px] items-center rounded-lg px-2 text-sm font-bold text-co-text underline hover:bg-co-surface-2";
const pill = (on: boolean) =>
  `inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 px-4 text-sm font-bold ${on ? "border-co-text bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text"}`;

const RECIPE_ERRORS = new Set([
  "version_changed", "forbidden", "not_found", "global_requires_moo", "step_up_required", "step_up_stale", "preview_stale",
  "line_changed", "edge_not_found", "empty_recipe", "would_create_cycle", "recipe_inactive", "invalid_source", "not_live",
  "nothing_changed", "invalid_payload", "invalid_component", "invalid_quantity", "product_line_needs_measure_unit",
  "invalid_component_product", "invalid_lines", "recipe_not_found", "location_not_found",
  "dependencies_changed", "dependencies_busy", "product_line_invalid",
]);
const errorKey = (code: string): TranslationKey =>
  (RECIPE_ERRORS.has(code) ? `catalog.recipe.error.${code}` : "catalog.recipe.error.generic") as TranslationKey;

type Sections = { lines: boolean; makes: boolean; others: boolean; history: boolean };
/**
 * An edit's BASELINE is captured when Edit is tapped (the beginLineEdit pattern, Astra 3b r5#1): `expected` is the line
 * the person SAW and the draft starts from it. A router.refresh() mid-edit never swaps it — the save still compares
 * against what they saw, so an intervening change is caught (line_changed), never silently overwritten. "Start over"
 * rebases on purpose: a new baseline, the editor remounted, any preview cleared.
 */
type Editing = { mode: "add" } | { mode: "edit"; lineId: string; expected: RecipeLineFields; name: string } | null;

const fieldsOf = (d: RecipeLineDraft): RecipeLineFields => ({
  componentSkuId: d.componentSkuId, componentItemId: d.componentItemId, componentProductId: d.componentProductId,
  quantity: d.quantity, unit: d.unit, eachContainerLabel: d.eachContainerLabel, portioned: d.portioned,
});

export function RecipeItemClient({ view }: { view: RecipeItemView }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const base = `/api/admin/catalog/recipe/${view.recipe.id}`;
  const [open, setOpen] = useState<Sections>({ lines: true, makes: false, others: false, history: false });
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, setPending] = useState<RecipeChangeRequest | null>(null);
  const [preview, setPreview] = useState<RecipePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // A late preview from a superseded request (an edited line, a left editor) is dropped, never shown.
  const [guard] = useState(() => createRequestGuard());

  const measures = useMemo(() => new Map<string, MeasureUnitFactor>(view.picker.measures.map((m) => [m.label, { dimension: m.dimension, toBaseFactor: m.toBaseFactor }])), [view.picker.measures]);
  const options = useMemo(() => buildIngredientOptions({ skus: view.picker.skus, items: view.picker.items, products: view.picker.products }), [view.picker]);
  const money = (n: number | null) => (n == null ? "—" : formatCents(Math.round(n * 100), language));
  const day = (iso: string) => formatDateLabel(iso.slice(0, 10), language);
  const fmt = (n: number) => formatQuantity(n, language);
  const shopName = (id: string) => view.shops.find((s) => s.id === id)?.name ?? "";
  // A refused LINE is named — position, name, why — in the message AND beside that line (lead decision (b)).
  const [refused, setRefused] = useState<RecipeLineRefusal | null>(null);
  const fail = (code: string, line?: RecipeLineRefusal) => {
    setRefused(line ?? null);
    setMessage(line
      ? t("catalog.recipe.error.line_refused", { position: line.position, name: line.name, reason: t(errorKey(line.reason)) })
      : t(errorKey(code)));
  };

  // The ONE target this viewer may save lines to here: their shop, or (MoO+) everyone in the global view.
  const target: RecipeTarget | null = view.scope !== null
    ? (view.can.editShop ? { kind: "shop", shopId: view.scope } : null)
    : (view.can.editGlobal ? { kind: "global" } : null);
  const canEditLines = target !== null && view.recipe.active;
  const hasOwn = view.scope !== null && !view.version.ridesDefault;

  const reset = () => { guard.invalidate(); setPending(null); setPreview(null); setEditing(null); };
  const done = () => { reset(); setMessage(t("catalog.recipe.saved")); router.refresh(); };

  // D10 (docs/DISCLOSURE_DOCTRINE.md): a section holding an unsaved draft stays MOUNTED and LOCKED OPEN.
  // CollapsibleSection unmounts closed content, so collapsing "What goes in" with a line editor open (or a
  // line change waiting in its preview) would throw the draft away (Astra 3b r1#8). Save or discard first.
  const linesDirty = editing !== null || pending?.kind === "lines";
  const toggle = (s: keyof Sections) => {
    if (s === "lines" && linesDirty) return;
    setOpen((o) => ({ ...o, [s]: !o[s] }));
  };

  /** "What this changes" for ONE act — a read, guarded against late answers. */
  const askPreview = async (change: RecipeChangeRequest) => {
    setMessage(null); setPreview(null); setPending(change); setBusy(true);
    const r = await guard.run(() => postJson(`${base}/preview`, { change }));
    setBusy(false);
    if (r === null) return; // superseded — a newer request owns the panel
    if (r.ok) { setRefused(null); setPreview(r.data.preview as RecipePreview); } else fail(r.code, r.line);
  };
  /** Save EXACTLY what the preview showed: its change and its token (Tier E). */
  const save = async () => {
    if (!preview || !pending) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/apply`, { change: pending, previewToken: preview.token });
    setBusy(false);
    if (r.ok) done(); else fail(r.code, r.line);
  };
  const dismissNotice = async (kind: "source_changed" | "source_retired" | "new_default", seenVersionId: string) => {
    if (view.scope === null) return;
    setBusy(true);
    const r = await postJson(`${base}/notices/dismiss`, { locationId: view.scope, kind, seenVersionId });
    setBusy(false);
    if (r.ok) router.refresh(); else fail(r.code);
  };

  const saveLabel = (p: RecipePreview): string => {
    switch (p.kind) {
      case "lines": return p.target.kind === "shop" ? t("catalog.recipe.preview.save.lines_shop", { shop: shopName(p.target.shopId) }) : t("catalog.recipe.preview.save.lines_global");
      case "restore": return t("catalog.recipe.preview.save.restore");
      case "back_to_default": return t("catalog.recipe.preview.save.back_to_default", { shop: p.target.kind === "shop" ? shopName(p.target.shopId) : "" });
      case "adopt": return t("catalog.recipe.preview.save.adopt", { shop: p.target.kind === "shop" ? shopName(p.target.shopId) : "" });
      case "promote": return t("catalog.recipe.preview.save.promote");
    }
  };

  const label = recipeVersionLabel({ scope: view.scope, scopeName: view.scopeName, hasOwn, adoptedFromShopName: view.version.adoptedFromShopName });
  const versionText = label.kind === "global" ? t("catalog.recipe.version.global")
    : label.kind === "shop_default" ? t("catalog.recipe.version.shop_default", { shop: label.shop })
    : label.kind === "shop_own" ? t("catalog.recipe.version.shop_own", { shop: label.shop })
    : t("catalog.recipe.version.shop_adopted", { shop: label.shop, from: label.from });

  const panel = preview && pending ? (
    <RecipePreviewPanel preview={preview} saveLabel={saveLabel(preview)} busy={busy} onSave={() => void save()} onDiscard={reset} />
  ) : null;

  const connections = (
    <section aria-label={t("catalog.recipe.connections")} className="rounded-xl border-2 border-co-border bg-co-surface p-3">
      <h2 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.recipe.connections")}</h2>
      <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.recipe.ingredients_from")}</p>
      <p className="px-2 text-sm text-co-text">{view.vendors.length === 0 ? t("catalog.recipe.vendors_none") : view.vendors.join(", ")}</p>
      <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.recipe.makes")}</p>
      {view.makes.map((m) => (
        m.kind === "menu_item"
          ? <Link key={m.id} href={menuItemPageHref(m.id, { shopId: view.scope })} className={linkRow}>{language === "es" && m.nameEs ? m.nameEs : m.name}</Link>
          : <p key={m.id} className="flex min-h-[44px] items-center px-2 text-sm text-co-text">{m.name}</p>
      ))}
      <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.recipe.used_in")}</p>
      {view.usedIn.length === 0 ? (
        <p className="px-2 text-sm text-co-text-muted">{t("catalog.recipe.used_in_none")}</p>
      ) : view.usedIn.map((r) => (
        <Link key={r.id} href={recipeItemHref(r.id, { shopId: view.scope })} className={linkRow}>{r.name}</Link>
      ))}
    </section>
  );

  return (
    <div className="flex w-full flex-col gap-4 pb-16">
      {/* Identity — always visible (D2). */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-co-gold/20 px-3 py-1 text-xs font-bold text-co-text">{versionText}</span>
        {view.version.validFrom ? <span className="text-xs text-co-text-muted">{day(view.version.validFrom)}</span> : null}
        {!view.recipe.active ? <span className="text-xs font-bold text-co-cta-text">{t("catalog.recipe.inactive")}</span> : null}
      </div>

      <nav aria-label={t("catalog.recipe.shop_switcher")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link href={recipeItemHref(view.recipe.id, { shopId: null })} aria-current={view.scope === null ? "page" : undefined} className={pill(view.scope === null)}>
          {t("catalog.recipe.shop_global")}
        </Link>
        {view.shops.map((s) => (
          <Link key={s.id} href={recipeItemHref(view.recipe.id, { shopId: s.id })} aria-current={view.scope === s.id ? "page" : undefined} className={pill(view.scope === s.id)}>
            {s.name}
          </Link>
        ))}
      </nav>

      {message ? <p role="status" className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{message}</p> : null}

      {/* Notices — alerts, always visible. */}
      {view.notices.length > 0 ? (
        <section aria-label={t("catalog.recipe.notices")} className="rounded-xl border-2 border-co-warning bg-co-warning-surface p-3">
          <h2 className="text-[12px] font-bold tracking-wide text-co-warning-text">{t("catalog.recipe.notices")}</h2>
          {view.notices.map((n) => (
            <div key={`${n.kind}-${n.seenVersionId}`} className="mt-2 flex flex-col gap-2">
              {n.kind === "source_changed" ? (
                <>
                  <p className="text-sm text-co-text">
                    {n.sourceLiveVersionId
                      ? t("catalog.recipe.notice.source_changed", { shop: n.sourceShopName, recipe: n.recipeName })
                      : n.promotedToDefault
                        ? t("catalog.recipe.notice.source_promoted", { shop: n.sourceShopName, recipe: n.recipeName })
                        : t("catalog.recipe.notice.source_gone", { shop: n.sourceShopName, recipe: n.recipeName })}
                  </p>
                  {n.editedSinceAdopting ? <p className="text-sm text-co-text-muted">{t("catalog.recipe.notice.edited_since")}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    {n.sourceLiveVersionId && view.scope !== null ? (
                      <button type="button" className={btnPrimary} disabled={busy}
                        onClick={() => void askPreview({ kind: "adopt", shopId: view.scope!, sourceVersionId: n.sourceLiveVersionId! })}>
                        {t("catalog.recipe.notice.take_update")}
                      </button>
                    ) : view.scope !== null && hasOwn ? (
                      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void askPreview({ kind: "back_to_default", shopId: view.scope! })}>
                        {t("catalog.recipe.notice.back_to_default")}
                      </button>
                    ) : null}
                    <button type="button" className={btn} disabled={busy} onClick={() => void dismissNotice(n.dismissKind, n.seenVersionId)}>{t("catalog.recipe.notice.keep_mine")}</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-co-text">{t("catalog.recipe.notice.new_default", { recipe: n.recipeName, shop: n.fromShopName ?? "" })}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={btn} disabled={busy} onClick={() => void dismissNotice("new_default", n.seenVersionId)}>{t("catalog.recipe.notice.got_it")}</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </section>
      ) : null}

      {/* A preview opened from a notice, the history or another shop shows here, above the sections. */}
      {pending && pending.kind !== "lines" ? panel : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
        <aside className="order-1 md:order-2">{connections}</aside>

        <div className="order-2 flex min-w-0 flex-col gap-3 md:order-1">
          {/* What goes in — the primary content, open by default. */}
          <CollapsibleSection idBase="recipe-lines" title={t("catalog.recipe.section.lines")}
            count={t("catalog.recipe.lines_count", { n: view.lines.length })} open={open.lines || linesDirty} onToggle={() => toggle("lines")}
            badge={linesDirty ? <span className="text-xs text-co-text-muted">{t("catalog.recipe.lines_locked")}</span> : undefined}>
            <div className="flex flex-col gap-2 p-3">
              {!canEditLines ? (
                <p className="text-sm text-co-text-muted">{view.scope === null ? t("catalog.recipe.global_moo_hint") : t("catalog.recipe.pick_shop_hint")}</p>
              ) : null}
              <ul className="flex flex-col gap-2">
                {view.lines.map((l) => (
                  <li key={l.lineId} className="flex flex-col gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-co-text">
                        {lineText(l.fields, view.names, fmt)}
                        {l.vendorName ? <span className="text-co-text-muted"> · {l.vendorName}</span> : null}
                      </span>
                      {l.changedHere ? <span className="rounded-full bg-co-gold/20 px-2 py-0.5 text-xs font-bold text-co-text">{t("catalog.recipe.changed_here")}</span> : null}
                    </div>
                    {l.problem ? (
                      <p className="text-xs font-bold text-co-danger">
                        {t("catalog.recipe.line_problem", { position: view.lines.indexOf(l) + 1, name: l.name, reason: t(errorKey(l.problem)) })}
                      </p>
                    ) : null}
                    {refused && refused.position === view.lines.indexOf(l) + 1 && editing?.mode === "edit" && editing.lineId === l.lineId ? (
                      <p role="alert" className="text-xs font-bold text-co-danger">{t(errorKey(refused.reason))}</p>
                    ) : null}
                    {canEditLines && target ? (
                      editing?.mode === "edit" && editing.lineId === l.lineId ? (
                        <>
                          {lineEditStale(editing.expected, l.fields) ? (
                            <div role="status" className="flex flex-col gap-2 rounded-lg border-2 border-co-warning bg-co-warning-surface p-2">
                              <p className="text-sm text-co-text">{t("catalog.recipe.edit_conflict")}</p>
                              <p className="text-xs text-co-text-muted">{lineText(editing.expected, view.names, fmt)} → {lineText(l.fields, view.names, fmt)}</p>
                              <button type="button" className={btn} disabled={busy}
                                onClick={() => { guard.invalidate(); setPending(null); setPreview(null); setEditing({ mode: "edit", lineId: l.lineId, expected: l.fields, name: l.name }); }}>
                                {t("catalog.recipe.edit_rebase")}
                              </button>
                            </div>
                          ) : null}
                          <RecipeLineEditor key={`edit-${l.lineId}-${JSON.stringify(editing.expected)}`}
                            title={t("catalog.recipe.edit_title")} submitLabel={t("catalog.recipe.see_changes")}
                            options={options} skus={view.picker.skus} products={view.picker.products} measures={measures}
                            activeMeasureLabels={view.picker.activeMeasureLabels} initial={{ ...editing.expected, componentName: editing.name }}
                            busy={busy} errorMsg={null}
                            onSubmit={(d) => void askPreview({ kind: "lines", target, op: { kind: "update", lineId: l.lineId, line: fieldsOf(d), expected: editing.expected } })}
                            onCancel={reset} />
                        </>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className={btn} disabled={busy} onClick={() => { reset(); setEditing({ mode: "edit", lineId: l.lineId, expected: l.fields, name: l.name }); }}>{t("catalog.recipe.edit_line")}</button>
                          <button type="button" className={btnDanger} disabled={busy}
                            onClick={() => { setEditing(null); void askPreview({ kind: "lines", target, op: { kind: "remove", lineId: l.lineId, expected: l.fields } }); }}>
                            {t("catalog.recipe.remove_line")}
                          </button>
                        </div>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
              {canEditLines && target ? (
                editing?.mode === "add" ? (
                  <RecipeLineEditor title={t("catalog.recipe.add_title")} submitLabel={t("catalog.recipe.see_changes")}
                    options={options} skus={view.picker.skus} products={view.picker.products} measures={measures}
                    activeMeasureLabels={view.picker.activeMeasureLabels} initial={null} busy={busy} errorMsg={null}
                    onSubmit={(d) => void askPreview({ kind: "lines", target, op: { kind: "add", line: fieldsOf(d) } })}
                    onCancel={reset} />
                ) : (
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => { reset(); setEditing({ mode: "add" }); }}>{t("catalog.recipe.add_line")}</button>
                )
              ) : null}
              {pending?.kind === "lines" ? panel : null}
              {hasOwn ? (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.recipe.differs_title")}</p>
                  {view.differsFromDefault.length === 0 ? (
                    <p className="text-sm text-co-text-muted">{t("catalog.recipe.differs_none")}</p>
                  ) : view.differsFromDefault.map((c, i) => (
                    <p key={`${c.key}-${i}`} className="text-sm text-co-text">
                      {c.kind === "added" && c.after ? t("catalog.recipe.preview.added", { line: lineText(c.after, view.names, fmt) })
                        : c.kind === "removed" && c.before ? t("catalog.recipe.preview.removed", { line: lineText(c.before, view.names, fmt) })
                        : c.before && c.after ? t("catalog.recipe.preview.changed", { before: lineText(c.before, view.names, fmt), after: lineText(c.after, view.names, fmt) }) : null}
                    </p>
                  ))}
                  {view.can.editShop && view.scope !== null ? (
                    <div className="mt-1 flex flex-col gap-1">
                      <button type="button" className={btnDanger} disabled={busy} onClick={() => void askPreview({ kind: "back_to_default", shopId: view.scope! })}>
                        {t("catalog.recipe.back_to_default")}
                      </button>
                      <p className="text-xs text-co-text-muted">{t("catalog.recipe.back_to_default_hint")}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CollapsibleSection>

          {/* What it makes */}
          <CollapsibleSection idBase="recipe-makes" title={t("catalog.recipe.section.makes")}
            count={String(view.makes.length)} open={open.makes} onToggle={() => toggle("makes")}>
            <ul className="flex flex-col gap-2 p-3">
              {view.makes.map((m) => (
                <li key={m.id} className="text-sm text-co-text">
                  {language === "es" && m.nameEs ? m.nameEs : m.name} · {t("catalog.recipe.yield", { n: fmt(m.yield) })} · {t("catalog.recipe.cost_here", { cost: money(m.costHere) })}
                </li>
              ))}
              <li>
                <Link href={`/admin/recipes/${view.recipe.id}`} className={linkRow}>{t("catalog.recipe.edit_outputs")}</Link>
              </li>
            </ul>
          </CollapsibleSection>

          {/* Other shops' versions — adopt (a GM at its shop), promote (MoO+). */}
          <CollapsibleSection idBase="recipe-others" title={t("catalog.recipe.section.others")}
            count={t("catalog.recipe.others_count", { n: view.otherShopVersions.length })} open={open.others} onToggle={() => toggle("others")}>
            <div className="flex flex-col gap-3 p-3">
              {view.otherShopVersions.length === 0 ? <p className="text-sm text-co-text-muted">{t("catalog.recipe.others_none")}</p> : null}
              {view.otherShopVersions.map((o) => (
                <div key={o.versionId} className="flex flex-col gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-2">
                  <p className="text-sm font-bold text-co-text">{o.shopName} · {day(o.validFrom)}{o.createdByName ? ` · ${o.createdByName}` : ""}</p>
                  {o.changes.length === 0 ? <p className="text-sm text-co-text-muted">{t("catalog.recipe.differs_none")}</p> : o.changes.map((c, i) => (
                    <p key={`${c.key}-${i}`} className="text-sm text-co-text">
                      {c.kind === "added" && c.after ? t("catalog.recipe.preview.added", { line: lineText(c.after, view.names, fmt) })
                        : c.kind === "removed" && c.before ? t("catalog.recipe.preview.removed", { line: lineText(c.before, view.names, fmt) })
                        : c.before && c.after ? t("catalog.recipe.preview.changed", { before: lineText(c.before, view.names, fmt), after: lineText(c.after, view.names, fmt) }) : null}
                    </p>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    {view.scope !== null && view.can.editShop ? (
                      <button type="button" className={btn} disabled={busy} onClick={() => void askPreview({ kind: "adopt", shopId: view.scope!, sourceVersionId: o.versionId })}>
                        {t("catalog.recipe.adopt", { shop: o.shopName })}
                      </button>
                    ) : null}
                    {view.can.editGlobal ? (
                      <button type="button" className={btn} disabled={busy} onClick={() => void askPreview({ kind: "promote", sourceVersionId: o.versionId })}>
                        {t("catalog.recipe.promote")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              {view.can.editGlobal && hasOwn && view.version.scopeVersionId ? (
                <button type="button" className={btn} disabled={busy} onClick={() => void askPreview({ kind: "promote", sourceVersionId: view.version.scopeVersionId! })}>
                  {t("catalog.recipe.promote")}
                </button>
              ) : null}
            </div>
          </CollapsibleSection>

          {/* History — every version of this scope and the default; Restore makes a NEW version. */}
          <CollapsibleSection idBase="recipe-history" title={t("catalog.recipe.section.history")}
            count={t("catalog.recipe.history_count", { n: view.history.length })} open={open.history} onToggle={() => toggle("history")}>
            <ul className="flex flex-col gap-2 p-3">
              {view.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-2">
                  <span className="text-sm text-co-text">
                    {t("catalog.recipe.history_by", { scope: h.scope === "global" ? t("catalog.recipe.history_global") : (h.shopName ?? ""), date: day(h.validFrom), who: h.who ?? "—" })}
                    {" · "}{t("catalog.recipe.history_lines", { n: h.lineCount })}
                    {h.promotedFromShopName ? <span className="block text-xs text-co-text-muted">{t("catalog.recipe.promoted_from", { shop: h.promotedFromShopName })}</span> : null}
                    {h.adoptedFromShopName ? <span className="block text-xs text-co-text-muted">{t("catalog.recipe.adopted_from", { shop: h.adoptedFromShopName })}</span> : null}
                    {h.linkEndedFromShopName ? <span className="block text-xs text-co-text-muted">{t("catalog.recipe.history.link_ended", { shop: h.linkEndedFromShopName })}</span> : null}
                  </span>
                  {h.active ? (
                    <span className="text-xs font-bold text-co-confirm-text">{t("catalog.recipe.current")}</span>
                  ) : target && (h.scope === "global" || view.scope !== null) ? (
                    <button type="button" className={btn} disabled={busy} onClick={() => void askPreview({ kind: "restore", target, fromVersionId: h.id })}>
                      {t("catalog.recipe.restore")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create the server page `app/admin/catalog/recipe/[id]/page.tsx`**

```tsx
/**
 * /admin/catalog/recipe/[id] — the connected RECIPE page (catalog Phase 3b; spec §4).
 * Gate: level ≥ 6 (reads are org-wide). ?location=<shop> | global picks the view; otherwise the one
 * shop resolver (resolveShopId) over the viewer's shops (MoO+: every shop) — a level without a shop
 * starts on the global default. The client is keyed by (recipe, scope), so a shop switch remounts it.
 */
import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { loadRecipeItemView } from "@/lib/catalog/recipe-item";
import { pageClientKey } from "@/lib/catalog/recipe-item-shared";
import { RECIPE_VERSION_READ_MIN, RECIPE_GLOBAL_WRITE_MIN } from "@/lib/recipe-versions-shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { RecipeItemClient } from "@/components/catalog/RecipeItemClient";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CatalogRecipePage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireSessionFromHeaders(`/admin/catalog/recipe/${id}`);
  const level = getRoleLevel(auth.user.role);
  if (level < RECIPE_VERSION_READ_MIN) redirect("/dashboard");
  if (!UUID_RE.test(id)) notFound();

  const { data: locs, error } = await getServiceRoleClient().from("locations").select("id").eq("active", true).order("name")
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`catalog recipe page locations: ${error.message}`);
  const active = (locs ?? []).map((l) => l.id);
  const mine = level >= RECIPE_GLOBAL_WRITE_MIN ? active : active.filter((l) => auth.locations.includes(l));
  const explicit = shopParamFor(`/admin/catalog/recipe/${id}`, searchParamValues(sp));
  const scope = explicit === "global" ? null
    : explicit && active.includes(explicit) ? explicit
    : mine.length > 0 ? await resolveShopId(mine, null) : null;

  const view = await loadRecipeItemView(auth, id, scope);
  if (!view) notFound();
  const lang = auth.user.language;
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title={lang === "es" && view.recipe.nameEs ? view.recipe.nameEs : view.recipe.name}
        subtitle={serverT(lang, view.recipe.recipeType === "production" ? "catalog.recipe.kind.production" : "catalog.recipe.kind.consumer")}
      />
      <RecipeItemClient key={pageClientKey("recipe", view.recipe.id, view.scope)} view={view} />
    </div>
  );
}
```

- [ ] **Step 6: Register the client in the tier map**

In `tests/step-up-tier-map.test.ts` `CLIENT_TIER_MAP`, add `  "components/catalog/RecipeItemClient.tsx": ["E"],`.

- [ ] **Step 7: Run, then commit**

Run: `npx vitest run tests/catalog-recipe-ui.test.ts tests/step-up-tier-map.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output. (`tests/catalog-recipe-navigation.test.ts` passes once Tasks 9–10 create the other two clients and the menu page.)

```bash
git add components/admin/vendors/shared.ts components/catalog/RecipePreviewPanel.tsx components/catalog/RecipeItemClient.tsx "app/admin/catalog/recipe/[id]/page.tsx" tests/catalog-recipe-ui.test.ts tests/catalog-recipe-navigation.test.ts tests/step-up-tier-map.test.ts
git commit -F - <<'EOF'
feat(catalog): the recipe page — shop versions line by line, adopt, promote, back to default, history, previews

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 9: The menu item page

**Files:**
- Create: `components/catalog/MenuItemClient.tsx`, `app/admin/catalog/menu-item/[id]/page.tsx`
- Modify: `tests/step-up-tier-map.test.ts`, `tests/catalog-recipe-ui.test.ts`

- [ ] **Step 1: Add the failing UI tests** — append to `tests/catalog-recipe-ui.test.ts`:

```ts
const { MenuItemClient } = await import("@/components/catalog/MenuItemClient");
import type { MenuItemPageView } from "@/lib/catalog/recipe-item-shared";

const menuView: MenuItemPageView = {
  item: { id: "7d0c1f2e-0000-4000-8000-0000000000m1", name: "Italian", nameEs: "Italiano", menuPrice: 12.5, section: "Subs" },
  shops: [{ id: SHOP, name: "P Street" }],
  scope: SHOP, scopeName: "P Street",
  can: { editShop: true },
  here: { settingId: "ms", price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null, name: "Italian", nameEs: "Italiano", typedPrice: 13.5 },
  cost: 2.5,
  recipe: { id: "r", name: "Italian" },
  toastLinks: 1,
  history: [{ id: "ms", active: true, validFrom: "2026-10-10T00:00:00Z", validTo: null, who: "Ana", price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null }],
};

describe("MenuItemClient", () => {
  it("shows this shop's settings, its food cost, the recipe and the Toast link; every button is 44px", () => {
    const html = render(jsx(MenuItemClient, { view: menuView }));
    expect(html).toContain("P Street&#x27;s settings");
    expect(html).toContain(en["catalog.menu.section.here"]);
    expect(html).toContain('value="13.5"');
    expect(html).toContain("Linked in Toast: 1");
    expect(html).toContain(en["catalog.menu.back_to_default"]);
    expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/);
  });
  it("the global view asks to pick a shop; Spanish throughout", () => {
    const g = { ...menuView, scope: null, scopeName: null, can: { editShop: false }, history: [] };
    expect(render(jsx(MenuItemClient, { view: g }))).toContain(en["catalog.menu.global_view_hint"]);
    expect(render(jsx(MenuItemClient, { view: menuView }), "es")).toContain(es["catalog.menu.section.here"]);
  });
});
```

Run: `npx vitest run tests/catalog-recipe-ui.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `components/catalog/MenuItemClient.tsx`**

```tsx
"use client";

/**
 * THE MENU ITEM PAGE — client body (catalog Phase 3b; spec §3 "menu items incl. shop price and sold
 * here", §4). Top: what it is and whose settings you see, a shop switcher. Then "How it connects" (its
 * recipe, its Toast link here), "At this shop" (price here, sold here, name here → What this changes →
 * Save for this shop), back to the global menu, and History (Restore). Promote lives on the Shop changes
 * list (MoO+). Every write: preview first (guarded), then Tier E with the preview's token.
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import type { MenuPreview } from "@/lib/catalog/recipe-preview-shared";
import { menuFormRevision, menuItemPageHref, recipeItemHref, type MenuChangeRequest, type MenuItemPageView } from "@/lib/catalog/recipe-item-shared";

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
const pill = (on: boolean) =>
  `inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 px-4 text-sm font-bold ${on ? "border-co-text bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text"}`;

const MENU_ERRORS = new Set([
  "forbidden", "not_found", "version_changed", "not_live", "global_changed", "nothing_to_promote", "invalid_menu_price",
  "invalid_name", "empty_setting", "invalid_source", "invalid_payload", "preview_stale", "step_up_required", "step_up_stale",
  "menu_item_not_found", "location_not_found", "global_requires_moo", "dependencies_changed", "dependencies_busy",
]);
const errorKey = (code: string): TranslationKey => (MENU_ERRORS.has(code) ? `catalog.menu.error.${code}` : "catalog.menu.error.generic") as TranslationKey;

export function MenuItemClient({ view }: { view: MenuItemPageView }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const base = `/api/admin/catalog/menu-item/${view.item.id}`;
  const [priceText, setPriceText] = useState(view.here.price === null ? "" : String(view.here.price));
  const [soldHere, setSoldHere] = useState(view.here.soldHere);
  const [nameText, setNameText] = useState(view.here.nameOverride ?? "");
  const [nameEsText, setNameEsText] = useState(view.here.nameOverrideEs ?? "");
  const [pending, setPending] = useState<MenuChangeRequest | null>(null);
  const [preview, setPreview] = useState<MenuPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [guard] = useState(() => createRequestGuard());

  const money = (n: number | null) => (n == null ? "—" : formatCents(Math.round(n * 100), language));
  const day = (iso: string) => formatDateLabel(iso.slice(0, 10), language);
  const yesNo = (b: boolean) => t(b ? "catalog.menu.preview.yes" : "catalog.menu.preview.no");
  const fail = (code: string) => setMessage(t(errorKey(code)));
  const reset = () => { guard.invalidate(); setPending(null); setPreview(null); };
  const touched = () => { if (preview) reset(); };

  // THE FORM FOLLOWS THE COMMITTED ROW (Astra 3b r1#6). A save, Back to default, Restore or a promote ends in
  // router.refresh(), which brings a new `view.here` WITHOUT a remount (the key is per item and shop). When the
  // committed revision moves, every field resets to it — React's prev-compare pattern, as MenuCostingClient's
  // revision-sensitive editors do — so a retired price or "not sold here" can never ride into the next save.
  const revision = menuFormRevision(view);
  const [formRevision, setFormRevision] = useState(revision);
  if (formRevision !== revision) {
    setFormRevision(revision);
    setPriceText(view.here.price === null ? "" : String(view.here.price));
    setSoldHere(view.here.soldHere);
    setNameText(view.here.nameOverride ?? "");
    setNameEsText(view.here.nameOverrideEs ?? "");
    guard.invalidate();
    setPending(null);
    setPreview(null);
  }

  const askPreview = async (change: MenuChangeRequest) => {
    setMessage(null); setPreview(null); setPending(change); setBusy(true);
    const r = await guard.run(() => postJson(`${base}/preview`, { change }));
    setBusy(false);
    if (r === null) return;
    if (r.ok) setPreview(r.data.preview as MenuPreview); else fail(r.code);
  };
  const previewSave = () => {
    if (view.scope === null) return;
    const trimmed = priceText.trim();
    const price = trimmed === "" ? null : Number(trimmed);
    if (price !== null && !Number.isFinite(price)) { fail("invalid_menu_price"); return; }
    void askPreview({ kind: "save", shopId: view.scope, patch: { price, soldHere, nameOverride: nameText.trim() || null, nameOverrideEs: nameEsText.trim() || null } });
  };
  const save = async () => {
    if (!preview || !pending) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/apply`, { change: pending, previewToken: preview.token });
    setBusy(false);
    if (r.ok) { reset(); setMessage(t("catalog.menu.saved")); router.refresh(); } else fail(r.code);
  };

  const versionText = view.scope === null ? t("catalog.menu.version.global")
    : view.here.settingId ? t("catalog.menu.version.shop_own", { shop: view.scopeName ?? "" })
    : t("catalog.menu.version.shop_default", { shop: view.scopeName ?? "" });
  const saveLabel = (p: MenuPreview) =>
    p.kind === "save" ? t("catalog.menu.preview.save_shop", { shop: view.scopeName ?? "" })
      : p.kind === "back_to_default" ? t("catalog.menu.preview.save_back")
      : p.kind === "restore" ? t("catalog.menu.preview.save_restore") : t("catalog.menu.preview.save_promote");

  return (
    <div className="flex w-full flex-col gap-4 pb-16">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-co-gold/20 px-3 py-1 text-xs font-bold text-co-text">{versionText}</span>
        <span className="text-xs text-co-text-muted">{t("catalog.menu.kind")}</span>
      </div>

      <nav aria-label={t("catalog.menu.shop_switcher")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link href={menuItemPageHref(view.item.id, { shopId: null })} aria-current={view.scope === null ? "page" : undefined} className={pill(view.scope === null)}>
          {t("catalog.recipe.shop_global")}
        </Link>
        {view.shops.map((s) => (
          <Link key={s.id} href={menuItemPageHref(view.item.id, { shopId: s.id })} aria-current={view.scope === s.id ? "page" : undefined} className={pill(view.scope === s.id)}>
            {s.name}
          </Link>
        ))}
      </nav>

      {message ? <p role="status" className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{message}</p> : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
        <aside className="order-1 md:order-2">
          <section aria-label={t("catalog.recipe.connections")} className="rounded-xl border-2 border-co-border bg-co-surface p-3">
            <h2 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.recipe.connections")}</h2>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.menu.recipe")}</p>
            {view.recipe ? (
              <Link href={recipeItemHref(view.recipe.id, { shopId: view.scope })} className={linkRow}>{view.recipe.name}</Link>
            ) : (
              <p className="px-2 text-sm text-co-text-muted">{t("catalog.menu.recipe_none")}</p>
            )}
            <p className="mt-2 px-2 text-sm text-co-text">{view.cost === null ? t("catalog.menu.cost_unknown") : t("catalog.menu.cost", { cost: money(view.cost) })}</p>
            <p className="px-2 text-sm text-co-text">{t("catalog.menu.toast_links", { n: view.toastLinks })}</p>
          </section>
        </aside>

        <div className="order-2 flex min-w-0 flex-col gap-3 md:order-1">
          <section aria-label={t("catalog.menu.section.here")} className="rounded-xl border-2 border-co-border bg-co-surface p-3">
            <h2 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.menu.section.here")}</h2>
            {view.scope === null || !view.can.editShop ? (
              <p className="mt-2 text-sm text-co-text-muted">{t("catalog.menu.global_view_hint")}</p>
            ) : (
              <div className="mt-2 flex flex-col gap-3">
                <label className="block">
                  <span className={fieldLabel}>{t("catalog.menu.price_here")}</span>
                  <input className={field} inputMode="decimal" value={priceText} disabled={busy}
                    onChange={(e) => { setPriceText(e.target.value); touched(); }} />
                  <span className="text-xs text-co-text-muted">{t("catalog.menu.price_hint", { price: money(view.item.menuPrice) })}</span>
                </label>
                <label className="flex min-h-[44px] items-center gap-3">
                  <input type="checkbox" className="h-5 w-5" checked={soldHere} disabled={busy} onChange={(e) => { setSoldHere(e.target.checked); touched(); }} />
                  <span className="text-sm text-co-text">{t("catalog.menu.sold_here")}</span>
                </label>
                <label className="block">
                  <span className={fieldLabel}>{t("catalog.menu.name_here")}</span>
                  <input className={field} value={nameText} maxLength={120} disabled={busy} onChange={(e) => { setNameText(e.target.value); touched(); }} />
                  <span className="text-xs text-co-text-muted">{t("catalog.menu.name_hint", { name: view.item.name })}</span>
                </label>
                <label className="block">
                  <span className={fieldLabel}>{t("catalog.menu.name_here_es")}</span>
                  <input className={field} value={nameEsText} maxLength={120} disabled={busy} onChange={(e) => { setNameEsText(e.target.value); touched(); }} />
                  <span className="text-xs text-co-text-muted">{t("catalog.menu.name_hint", { name: view.item.nameEs ?? view.item.name })}</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnPrimary} disabled={busy} onClick={previewSave}>{t("catalog.menu.see_changes")}</button>
                  {view.here.settingId ? (
                    <button type="button" className={btnDanger} disabled={busy} onClick={() => void askPreview({ kind: "back_to_default", shopId: view.scope! })}>
                      {t("catalog.menu.back_to_default")}
                    </button>
                  ) : null}
                </div>
              </div>
            )}
            {preview && pending ? (
              <div className="mt-3 rounded-xl border-2 border-co-text bg-co-surface p-3">
                <h3 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.menu.preview.title")}</h3>
                <p className="text-sm text-co-text">{t("catalog.menu.preview.price", { before: money(preview.before.price), after: money(preview.after.price) })}</p>
                <p className="text-sm text-co-text">{t("catalog.menu.preview.margin", { before: money(preview.marginBefore), after: money(preview.marginAfter) })}</p>
                <p className="text-sm text-co-text">{t("catalog.menu.preview.sold", { before: yesNo(preview.before.soldHere), after: yesNo(preview.after.soldHere) })}</p>
                <p className="text-sm text-co-text">{t("catalog.menu.preview.name", { before: preview.before.name, after: preview.after.name })}</p>
                <p className="text-sm text-co-text">{t("catalog.menu.preview.name_es", { before: preview.before.nameEs ?? "—", after: preview.after.nameEs ?? "—" })}</p>
                {preview.before.inherits.price !== preview.after.inherits.price || preview.before.inherits.name !== preview.after.inherits.name ? (
                  <p className="text-sm text-co-text-muted">
                    {t("catalog.menu.preview.inherits", {
                      price: t(preview.after.inherits.price ? "catalog.menu.preview.inherits_default" : "catalog.menu.preview.inherits_own"),
                      name: t(preview.after.inherits.name ? "catalog.menu.preview.inherits_default" : "catalog.menu.preview.inherits_own"),
                    })}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>{saveLabel(preview)}</button>
                  <button type="button" className={btn} disabled={busy} onClick={reset}>{t("catalog.menu.cancel")}</button>
                </div>
              </div>
            ) : null}
          </section>

          {view.scope !== null ? (
            <CollapsibleSection idBase="menu-history" title={t("catalog.menu.section.history")}
              count={t("catalog.menu.history_count", { n: view.history.length })} open={historyOpen} onToggle={() => setHistoryOpen((o) => !o)}>
              <ul className="flex flex-col gap-2 p-3">
                {view.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-2">
                    <span className="text-sm text-co-text">
                      {day(h.validFrom)} · {h.who ?? "—"}
                      {h.price !== null ? <span className="block text-xs">{t("catalog.menu.history_price", { price: money(h.price) })}</span> : null}
                      {!h.soldHere ? <span className="block text-xs">{t("catalog.menu.history_off")}</span> : null}
                      {h.nameOverride ? <span className="block text-xs">{t("catalog.menu.history_name", { name: h.nameOverride })}</span> : null}
                    </span>
                    {h.active ? (
                      <span className="text-xs font-bold text-co-confirm-text">{t("catalog.menu.current")}</span>
                    ) : view.can.editShop ? (
                      <button type="button" className={btn} disabled={busy} onClick={() => void askPreview({ kind: "restore", shopId: view.scope!, fromSettingId: h.id })}>
                        {t("catalog.menu.restore")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the server page `app/admin/catalog/menu-item/[id]/page.tsx`**

```tsx
/**
 * /admin/catalog/menu-item/[id] — the connected MENU ITEM page (catalog Phase 3b; spec §3, §4).
 * Gate: level ≥ 6. ?location=<shop> | global picks the view; else the one shop resolver over the
 * viewer's shops (MoO+: every shop). The client is keyed by (menu item, scope).
 */
import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { loadMenuItemPageView } from "@/lib/catalog/menu-item-page";
import { pageClientKey } from "@/lib/catalog/recipe-item-shared";
import { MENU_GLOBAL_WRITE_MIN } from "@/lib/menu-item-shop-shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { MenuItemClient } from "@/components/catalog/MenuItemClient";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CatalogMenuItemPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireSessionFromHeaders(`/admin/catalog/menu-item/${id}`);
  const level = getRoleLevel(auth.user.role);
  if (level < 6) redirect("/dashboard");
  if (!UUID_RE.test(id)) notFound();

  const { data: locs, error } = await getServiceRoleClient().from("locations").select("id").eq("active", true).order("name")
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`catalog menu page locations: ${error.message}`);
  const active = (locs ?? []).map((l) => l.id);
  const mine = level >= MENU_GLOBAL_WRITE_MIN ? active : active.filter((l) => auth.locations.includes(l));
  const explicit = shopParamFor(`/admin/catalog/menu-item/${id}`, searchParamValues(sp));
  const scope = explicit === "global" ? null
    : explicit && active.includes(explicit) ? explicit
    : mine.length > 0 ? await resolveShopId(mine, null) : null;

  const view = await loadMenuItemPageView(auth, id, scope);
  if (!view) notFound();
  const lang = auth.user.language;
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title={lang === "es" && view.here.nameEs ? view.here.nameEs : view.here.name} subtitle={serverT(lang, "catalog.menu.kind")} />
      <MenuItemClient key={pageClientKey("menu", view.item.id, view.scope)} view={view} />
    </div>
  );
}
```

- [ ] **Step 4: Register the client in the tier map**

In `tests/step-up-tier-map.test.ts` `CLIENT_TIER_MAP`, add `  "components/catalog/MenuItemClient.tsx": ["E"],`.

- [ ] **Step 5: Run, then commit**

Run: `npx vitest run tests/catalog-recipe-ui.test.ts tests/step-up-tier-map.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output.

```bash
git add components/catalog/MenuItemClient.tsx "app/admin/catalog/menu-item/[id]/page.tsx" tests/catalog-recipe-ui.test.ts tests/step-up-tier-map.test.ts
git commit -F - <<'EOF'
feat(catalog): the menu item page — price here, sold here, name here, back to the global menu, history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 10: The Shop changes list (MoO+) and the GM's recipe updates

**Files:**
- Create: `components/catalog/ShopChangesClient.tsx`, `app/admin/catalog/shop-changes/page.tsx`, `components/catalog/RecipeNoticesClient.tsx`, `app/admin/catalog/notices/page.tsx`
- Modify: `lib/admin/sections.ts`, `tests/step-up-tier-map.test.ts`, `tests/catalog-recipe-ui.test.ts`

- [ ] **Step 1: Add the failing UI tests** — append to `tests/catalog-recipe-ui.test.ts`:

```ts
const { ShopChangesClient } = await import("@/components/catalog/ShopChangesClient");
const { RecipeNoticesClient } = await import("@/components/catalog/RecipeNoticesClient");
import type { ShopChangesView } from "@/lib/catalog/recipe-item-shared";

const changes: ShopChangesView = {
  recipes: [{ recipeId: "7d0c1f2e-0000-4000-8000-000000000001", recipeName: "Italian", versionId: "7d0c1f2e-0000-4000-8000-0000000000aa",
    shopId: SHOP, shopName: "P Street", validFrom: "2026-10-14T00:00:00Z", createdByName: "Ana", adoptedFromShopName: null,
    changes: [{ kind: "changed", key: "sku:sku-t", before: { ...turkey, quantity: 4 }, after: turkey }], sameAsDefault: false }],
  menu: [{ menuItemId: "7d0c1f2e-0000-4000-8000-0000000000m1", menuItemName: "Italian", settingId: "7d0c1f2e-0000-4000-8000-0000000000bb",
    shopId: SHOP, shopName: "P Street", validFrom: "2026-10-14T00:00:00Z", createdByName: "Ana", price: 13.5, soldHere: true,
    nameOverride: null, nameOverrideEs: null, global: { price: 12.5, name: "Italian", nameEs: "Italiano" } }],
  names: { "sku:sku-t": "Turkey" },
};

describe("ShopChangesClient and RecipeNoticesClient", () => {
  it("lists every shop version with who and where, and offers Promote or Leave; 44px", () => {
    const html = render(jsx(ShopChangesClient, { view: changes }));
    expect(html).toContain("P Street · Ana");
    expect(html).toContain(en["catalog.changes.promote"]);
    expect(html).toContain(en["catalog.changes.leave"]);
    expect(html).toContain("Price here: $13.50 (everyone: $12.50)");
    expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/);
  });
  it("a GM's notices name the recipe and offer Got it / Keep mine; empty says so", () => {
    const notices = [{ kind: "new_default" as const, recipeId: "7d0c1f2e-0000-4000-8000-000000000001", recipeName: "Italian", seenVersionId: "7d0c1f2e-0000-4000-8000-0000000000cc", fromShopName: "P Street", at: "2026-10-12T00:00:00Z" }];
    const html = render(jsx(RecipeNoticesClient, { shopId: SHOP, notices }));
    expect(html).toContain("Italian has a new default for every shop (from P Street).");
    expect(html).toContain(en["catalog.recipe.notice.got_it"]);
    expect(render(jsx(RecipeNoticesClient, { shopId: SHOP, notices: [] }), "es")).toContain(es["catalog.notices.none"]);
  });
});
```

Run: `npx vitest run tests/catalog-recipe-ui.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `components/catalog/ShopChangesClient.tsx`**

```tsx
"use client";

/**
 * THE SHOP CHANGES LIST — client body (catalog Phase 3b; spec §6, for the Director of Operations). Every
 * live shop recipe version and menu setting, newest first: what changed against today's default, where,
 * who, when. Promote = preview (who it reaches, who stays untouched) → Tier E save with the token; Leave
 * just folds the row away on this screen (the shop keeps its version — nothing is written).
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { formatCents, formatDateLabel, formatQuantity } from "@/lib/i18n/format";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { RecipePreviewPanel } from "@/components/catalog/RecipePreviewPanel";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import { lineText, type MenuPreview, type RecipePreview } from "@/lib/catalog/recipe-preview-shared";
import { menuItemPageHref, recipeItemHref, type ShopChangesView } from "@/lib/catalog/recipe-item-shared";

const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const linkRow = "inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-bold text-co-text underline hover:bg-co-surface-2";

type Pending =
  | { kind: "recipe"; recipeId: string; change: { kind: "promote"; sourceVersionId: string } }
  | { kind: "menu"; menuItemId: string; change: { kind: "promote"; settingId: string; fields: Array<"price" | "name"> } };

export function ShopChangesClient({ view }: { view: ShopChangesView }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  // Both lists are this page's primary content (disclosure doctrine D3): open; each row folds its own detail.
  const [open, setOpen] = useState({ recipes: true, menu: true });
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const [preview, setPreview] = useState<RecipePreview | MenuPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [guard] = useState(() => createRequestGuard());

  const money = (n: number | null) => (n == null ? "—" : formatCents(Math.round(n * 100), language));
  const day = (iso: string) => formatDateLabel(iso.slice(0, 10), language);
  const fmt = (n: number) => formatQuantity(n, language);
  const reset = () => { guard.invalidate(); setPending(null); setPreview(null); };
  const KNOWN: Record<"recipe" | "menu", ReadonlySet<string>> = {
    recipe: new Set(["version_changed", "forbidden", "not_found", "global_requires_moo", "step_up_required", "step_up_stale", "preview_stale",
      "invalid_source", "not_live", "recipe_inactive", "would_create_cycle", "dependencies_changed", "dependencies_busy", "product_line_invalid",
      // the line rules a promote's copied set is judged by (lead decision (b)) — named per line below
      "invalid_component_product", "product_line_needs_measure_unit", "invalid_component", "invalid_quantity", "invalid_payload"]),
    menu: new Set(["version_changed", "forbidden", "not_found", "global_requires_moo", "step_up_required", "step_up_stale", "preview_stale", "invalid_source", "not_live", "global_changed", "nothing_to_promote", "dependencies_changed", "dependencies_busy"]),
  };
  const errKey = (code: string, kind: "recipe" | "menu") =>
    (KNOWN[kind].has(code) ? `catalog.${kind}.error.${code}` : `catalog.${kind}.error.generic`) as TranslationKey;
  // A refused LINE keeps its details here too (Astra 3b r3#3): "Line 3 (Ham): That ingredient is a retired product …".
  const failMessage = (r: { code: string; line?: { position: number; name: string; reason: string } }, kind: "recipe" | "menu") =>
    r.line
      ? t("catalog.recipe.error.line_refused", { position: r.line.position, name: r.line.name, reason: t(errKey(r.line.reason, "recipe")) })
      : t(errKey(r.code, kind));
  const flip = (set: ReadonlySet<string>, id: string) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; };

  const askPreview = async (p: Pending) => {
    setMessage(null); setPreview(null); setPending(p); setBusy(true);
    const url = p.kind === "recipe" ? `/api/admin/catalog/recipe/${p.recipeId}/preview` : `/api/admin/catalog/menu-item/${p.menuItemId}/preview`;
    const r = await guard.run(() => postJson(url, { change: p.change }));
    setBusy(false);
    if (r === null) return;
    if (r.ok) setPreview(r.data.preview as RecipePreview | MenuPreview);
    else setMessage(failMessage(r, p.kind));
  };
  const save = async () => {
    if (!pending || !preview) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const url = pending.kind === "recipe" ? `/api/admin/catalog/recipe/${pending.recipeId}/apply` : `/api/admin/catalog/menu-item/${pending.menuItemId}/apply`;
    const r = await send(url, { change: pending.change, previewToken: preview.token });
    setBusy(false);
    if (r.ok) { reset(); setMessage(t("catalog.recipe.saved")); router.refresh(); }
    else setMessage(failMessage(r, pending.kind));
  };

  const recipes = view.recipes.filter((r) => !left.has(r.versionId));
  const menu = view.menu.filter((m) => !left.has(m.settingId));

  return (
    <div className="flex w-full flex-col gap-4 pb-16">
      <p className="text-sm text-co-text-muted">{t("catalog.changes.intro")}</p>
      {message ? <p role="status" className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{message}</p> : null}

      <CollapsibleSection idBase="changes-recipes" title={t("catalog.changes.recipes")} count={t("catalog.changes.recipes_count", { n: recipes.length })}
        open={open.recipes} onToggle={() => setOpen((o) => ({ ...o, recipes: !o.recipes }))}>
        <ul className="flex flex-col gap-2 p-3">
          {recipes.length === 0 ? <li className="text-sm text-co-text-muted">{t("catalog.changes.none")}</li> : null}
          {recipes.map((r) => (
            <li key={r.versionId} className="flex flex-col gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={recipeItemHref(r.recipeId, { shopId: r.shopId })} className={linkRow}>{r.recipeName}</Link>
                <span className="text-xs text-co-text-muted">{t("catalog.changes.by", { shop: r.shopName, who: r.createdByName ?? "—", date: day(r.validFrom) })}</span>
              </div>
              {r.adoptedFromShopName ? <p className="text-xs text-co-text-muted">{t("catalog.changes.adopted_from", { shop: r.adoptedFromShopName })}</p> : null}
              {r.sameAsDefault ? <p className="text-sm text-co-text-muted">{t("catalog.changes.same_as_default")}</p> : (
                <>
                  <button type="button" className={btn} aria-expanded={shown.has(r.versionId)} onClick={() => setShown((s) => flip(s, r.versionId))}>
                    {shown.has(r.versionId) ? t("catalog.changes.hide") : t("catalog.changes.show")}
                  </button>
                  {shown.has(r.versionId) ? r.changes.map((c, i) => (
                    <p key={`${c.key}-${i}`} className="text-sm text-co-text">
                      {c.kind === "added" && c.after ? t("catalog.recipe.preview.added", { line: lineText(c.after, view.names, fmt) })
                        : c.kind === "removed" && c.before ? t("catalog.recipe.preview.removed", { line: lineText(c.before, view.names, fmt) })
                        : c.before && c.after ? t("catalog.recipe.preview.changed", { before: lineText(c.before, view.names, fmt), after: lineText(c.after, view.names, fmt) }) : null}
                    </p>
                  )) : null}
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} disabled={busy}
                  onClick={() => void askPreview({ kind: "recipe", recipeId: r.recipeId, change: { kind: "promote", sourceVersionId: r.versionId } })}>
                  {t("catalog.changes.promote")}
                </button>
                <button type="button" className={btn} disabled={busy} onClick={() => setLeft((s) => flip(s, r.versionId))}>{t("catalog.changes.leave")}</button>
              </div>
              {pending?.kind === "recipe" && pending.change.sourceVersionId === r.versionId && preview && "reached" in preview ? (
                <RecipePreviewPanel preview={preview} saveLabel={t("catalog.recipe.preview.save.promote")} busy={busy} onSave={() => void save()} onDiscard={reset} />
              ) : null}
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection idBase="changes-menu" title={t("catalog.changes.menu")} count={t("catalog.changes.menu_count", { n: menu.length })}
        open={open.menu} onToggle={() => setOpen((o) => ({ ...o, menu: !o.menu }))}>
        <ul className="flex flex-col gap-2 p-3">
          {menu.length === 0 ? <li className="text-sm text-co-text-muted">{t("catalog.changes.none")}</li> : null}
          {menu.map((m) => (
            <li key={m.settingId} className="flex flex-col gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={menuItemPageHref(m.menuItemId, { shopId: m.shopId })} className={linkRow}>{m.menuItemName}</Link>
                <span className="text-xs text-co-text-muted">{t("catalog.changes.by", { shop: m.shopName, who: m.createdByName ?? "—", date: day(m.validFrom) })}</span>
              </div>
              {m.price !== null ? <p className="text-sm text-co-text">{t("catalog.changes.price_here", { price: money(m.price), global: money(m.global.price) })}</p> : null}
              {!m.soldHere ? <p className="text-sm text-co-text">{t("catalog.changes.off_here")}</p> : null}
              {m.nameOverride ? <p className="text-sm text-co-text">{t("catalog.changes.name_here", { name: m.nameOverride })}</p> : null}
              <div className="flex flex-wrap gap-2">
                {m.price !== null ? (
                  <button type="button" className={btnPrimary} disabled={busy}
                    onClick={() => void askPreview({ kind: "menu", menuItemId: m.menuItemId, change: { kind: "promote", settingId: m.settingId, fields: ["price"] } })}>
                    {t("catalog.changes.promote_price", { price: money(m.price) })}
                  </button>
                ) : null}
                {m.nameOverride ? (
                  <button type="button" className={btn} disabled={busy}
                    onClick={() => void askPreview({ kind: "menu", menuItemId: m.menuItemId, change: { kind: "promote", settingId: m.settingId, fields: ["name"] } })}>
                    {t("catalog.changes.promote_name", { name: m.nameOverride })}
                  </button>
                ) : null}
                <button type="button" className={btn} disabled={busy} onClick={() => setLeft((s) => flip(s, m.settingId))}>{t("catalog.changes.leave")}</button>
              </div>
              {pending?.kind === "menu" && pending.change.settingId === m.settingId && preview && "changedShops" in preview ? (
                <div className="rounded-xl border-2 border-co-text bg-co-surface p-3">
                  <h3 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.menu.preview.title")}</h3>
                  <p className="text-sm text-co-text">{t("catalog.menu.preview.price", { before: money(preview.before.price), after: money(preview.after.price) })}</p>
                  <p className="text-sm text-co-text">{t("catalog.menu.preview.name", { before: preview.before.name, after: preview.after.name })}</p>
                  {/* Promoting the name writes the Spanish name too (0263): show it (Astra 3b r5#2). */}
                  <p className="text-sm text-co-text">{t("catalog.menu.preview.name_es", { before: preview.before.nameEs ?? "—", after: preview.after.nameEs ?? "—" })}</p>
                  <p className="text-sm text-co-text">{t("catalog.menu.preview.shops", { shops: preview.changedShops.map((s) => s.shopName).join(", ") || "—" })}</p>
                  {preview.returnedShop ? (
                    <p className="text-sm text-co-text">{t("catalog.menu.preview.returned", { shop: preview.returnedShop.shopName })}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>{t("catalog.menu.preview.save_promote")}</button>
                    <button type="button" className={btn} disabled={busy} onClick={reset}>{t("catalog.menu.cancel")}</button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/catalog/RecipeNoticesClient.tsx`**

```tsx
"use client";

/**
 * A GM's RECIPE UPDATES (catalog Phase 3b; spec §6) — the read-time notices for one shop. Each names the
 * recipe and opens it (where "Take the update" previews the adopt); "Keep mine" / "Got it" records the
 * answer for the version seen (no password: it changes no food).
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { formatDateLabel } from "@/lib/i18n/format";
import { postJson } from "@/components/admin/vendors/shared";
import type { RecipeNotice } from "@/lib/catalog/recipe-notices-shared";
import { recipeItemHref } from "@/lib/catalog/recipe-item-shared";

const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const linkBtn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text";

export function RecipeNoticesClient({ shopId, notices }: { shopId: string; notices: RecipeNotice[] }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const answer = async (n: RecipeNotice) => {
    setBusy(true);
    // The STATE seen is part of the answer: a retired source is a different notice from an updated one (Astra 3b r1#5).
    const kind = n.kind === "source_changed" ? n.dismissKind : n.kind;
    const r = await postJson(`/api/admin/catalog/recipe/${n.recipeId}/notices/dismiss`, { locationId: shopId, kind, seenVersionId: n.seenVersionId });
    setBusy(false);
    if (r.ok) router.refresh(); else setMessage(t("catalog.recipe.error.generic"));
  };

  if (notices.length === 0) return <p className="text-sm text-co-text-muted">{t("catalog.notices.none")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {message ? <p role="status" className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{message}</p> : null}
      <ul className="flex flex-col gap-2">
        {notices.map((n) => (
          <li key={`${n.kind}-${n.seenVersionId}`} className="flex flex-col gap-2 rounded-xl border-2 border-co-warning bg-co-warning-surface p-3">
            <p className="text-sm text-co-text">
              {n.kind === "new_default"
                ? t("catalog.recipe.notice.new_default", { recipe: n.recipeName, shop: n.fromShopName ?? "" })
                : n.sourceLiveVersionId
                  ? t("catalog.recipe.notice.source_changed", { shop: n.sourceShopName, recipe: n.recipeName })
                  : n.promotedToDefault
                    ? t("catalog.recipe.notice.source_promoted", { shop: n.sourceShopName, recipe: n.recipeName })
                    : t("catalog.recipe.notice.source_gone", { shop: n.sourceShopName, recipe: n.recipeName })}
            </p>
            {n.kind === "source_changed" && n.editedSinceAdopting ? <p className="text-sm text-co-text-muted">{t("catalog.recipe.notice.edited_since")}</p> : null}
            <p className="text-xs text-co-text-muted">{formatDateLabel(n.at.slice(0, 10), language)}</p>
            <div className="flex flex-wrap gap-2">
              <Link href={recipeItemHref(n.recipeId, { shopId })} className={linkBtn}>{t("catalog.recipe.notice.open")}</Link>
              <button type="button" className={btn} disabled={busy} onClick={() => void answer(n)}>
                {n.kind === "new_default" ? t("catalog.recipe.notice.got_it") : t("catalog.recipe.notice.keep_mine")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Create the two server pages**

`app/admin/catalog/shop-changes/page.tsx`:

```tsx
/**
 * /admin/catalog/shop-changes — every shop's own recipe and menu settings (catalog Phase 3b; spec §6,
 * the Director of Operations). Gate: MoO+ (8); the lib re-checks (loadShopChanges).
 */
import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { GLOBAL_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";
import { loadShopChanges } from "@/lib/catalog/shop-changes";
import { PageHeader } from "@/components/ui/PageHeader";
import { ShopChangesClient } from "@/components/catalog/ShopChangesClient";

export default async function ShopChangesPage() {
  const auth = await requireSessionFromHeaders("/admin/catalog/shop-changes");
  if (getRoleLevel(auth.user.role) < GLOBAL_VERSION_WRITE_MIN) redirect("/admin");
  const view = await loadShopChanges(auth);
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title={serverT(auth.user.language, "catalog.changes.title")} />
      <ShopChangesClient view={view} />
    </div>
  );
}
```

`app/admin/catalog/notices/page.tsx`:

```tsx
/**
 * /admin/catalog/notices — a GM's recipe updates for its shop (catalog Phase 3b; spec §6). Gate: GM (7)+;
 * the shop comes from ?location= or the one shop resolver over the viewer's shops (MoO+: every shop).
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { GLOBAL_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";
import { loadShopNotices } from "@/lib/catalog/shop-changes";
import { noticesHref } from "@/lib/catalog/recipe-item-shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { RecipeNoticesClient } from "@/components/catalog/RecipeNoticesClient";

export default async function RecipeNoticesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const auth = await requireSessionFromHeaders("/admin/catalog/notices");
  const level = getRoleLevel(auth.user.role);
  if (level < RECIPE_SHOP_WRITE_MIN) redirect("/admin");
  const lang = auth.user.language;
  const { data: locs, error } = await getServiceRoleClient().from("locations").select("id, name").eq("active", true).order("name")
    .returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`notices page locations: ${error.message}`);
  const shops = (locs ?? []).filter((l) => level >= GLOBAL_VERSION_WRITE_MIN || auth.locations.includes(l.id));
  const explicit = shopParamFor("/admin/catalog/notices", searchParamValues(sp));
  const shopId = shops.length === 0 ? null : await resolveShopId(shops.map((s) => s.id), explicit ?? null);
  const notices = shopId ? await loadShopNotices(auth, shopId) : [];
  const pill = (on: boolean) =>
    `inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 px-4 text-sm font-bold ${on ? "border-co-text bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text"}`;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title={serverT(lang, "catalog.notices.title")} subtitle={serverT(lang, "catalog.notices.intro")} />
      <nav aria-label={serverT(lang, "catalog.notices.pick_shop")} className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
        {shops.map((s) => (
          <Link key={s.id} href={noticesHref(s.id)} aria-current={shopId === s.id ? "page" : undefined} className={pill(shopId === s.id)}>{s.name}</Link>
        ))}
      </nav>
      {shopId ? <RecipeNoticesClient shopId={shopId} notices={notices} /> : null}
    </div>
  );
}
```

- [ ] **Step 5: The two hub cards (`lib/admin/sections.ts`)**

Directly after the line containing `id: "menu-costing",` in `ADMIN_SECTIONS`, insert:

```ts
  // Catalog Phase 3b: every shop's own recipes and menu settings, with Promote / Leave (the Director of Operations).
  { id: "shop-changes",        i18nKey: "admin.section.shop-changes",                          href: "/admin/catalog/shop-changes", minLevel: 8 },
  // Catalog Phase 3b: a GM's read-time notices — another shop changed a recipe this shop copied; a new default.
  { id: "recipe-notices",      i18nKey: "admin.section.recipe-notices",                        href: "/admin/catalog/notices",      minLevel: 7 },
```

- [ ] **Step 6: Register the client in the tier map**

In `tests/step-up-tier-map.test.ts` `CLIENT_TIER_MAP`, add `  "components/catalog/ShopChangesClient.tsx": ["E"],`. (`RecipeNoticesClient` asks no tier.)

- [ ] **Step 7: Run, then commit**

Run: `npx vitest run tests/catalog-recipe-ui.test.ts tests/catalog-recipe-navigation.test.ts tests/step-up-tier-map.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output.

```bash
git add components/catalog/ShopChangesClient.tsx components/catalog/RecipeNoticesClient.tsx app/admin/catalog/shop-changes/page.tsx app/admin/catalog/notices/page.tsx lib/admin/sections.ts tests/catalog-recipe-ui.test.ts tests/step-up-tier-map.test.ts
git commit -F - <<'EOF'
feat(catalog): the Shop changes list (Promote / Leave) and a GM's recipe updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 11: The legacy builder's line writes are the global default's (MoO+); every way in leads to the new pages

Spec §3: "A GM/AGM never edits the global default. Their edit creates (or updates) their shop's version." With the recipe page live, the legacy builder's LINE writes (`addRecipeInput`, `updateRecipeInput`, `removeRecipeEdge` of a line) become the Director of Operations' and refuse a GM with `global_requires_moo` (en + es), and the legacy page links to the shop-version page. **Unchanged** (versions cover the lines only): creating a recipe (`createRecipe` / `createRecipeFull`, GM+ — a GM's new recipe is the global one until Phase 4's "New sandwich" job), the header, outputs, yields (incl. the yield-nudge Retrain, GM-only by 0218), batch mode.

**Files:**
- Modify: `lib/recipes.ts`, `components/admin/recipes/shared.ts`, `app/admin/recipes/[id]/page.tsx`, `components/admin/menu-costing/MenuCostingClient.tsx`, `tests/recipe-line-edit-server.test.ts`, `tests/recipe-input-remove-locked.test.ts`
- Test: `tests/legacy-recipe-line-boundary.test.ts`

- [ ] **Step 1: Write the failing test `tests/legacy-recipe-line-boundary.test.ts`**

```ts
/** Catalog Phase 3b — the legacy builder's LINE writes are MoO+; a GM is told to edit its shop's version; outputs keep their floor. */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("no database expected"); } }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
import { addRecipeInput, removeRecipeEdge, updateRecipeInput } from "@/lib/recipes";

const gm = { user: { id: "u", role: "gm" } } as never;
const agm = { user: { id: "u", role: "agm" } } as never;
const line = { componentSkuId: "s", componentItemId: null, componentProductId: null, quantity: 1, unit: "oz", eachContainerLabel: null, portioned: false };

describe("a GM never edits the global recipe's lines", () => {
  it("add, update and remove of a LINE refuse a GM before any I/O", async () => {
    await expect(addRecipeInput(gm, { recipeId: "r", componentSkuId: "s", quantity: 1, unit: "oz" })).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
    await expect(updateRecipeInput(gm, { recipeId: "r", inputId: "i", line: { ...line, quantity: 2 }, expected: line })).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
    await expect(removeRecipeEdge(gm, { table: "recipe_inputs", id: "i" })).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
  });
  it("below GM it stays the plain forbidden", async () => {
    await expect(addRecipeInput(agm, { recipeId: "r", componentSkuId: "s", quantity: 1, unit: "oz" })).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
  it("an OUTPUT removal keeps its GM floor (it reaches the database)", async () => {
    await expect(removeRecipeEdge(gm, { table: "recipe_outputs", id: "o" })).rejects.toThrow("no database expected");
  });
});

describe("every way in leads to the new pages", () => {
  it("the builder resolves the code; the legacy recipe page and the costing drawer link to the catalog pages", () => {
    expect(readFileSync("components/admin/recipes/shared.ts", "utf8")).toContain('"global_requires_moo"');
    expect(readFileSync("app/admin/recipes/[id]/page.tsx", "utf8")).toContain("recipeItemHref(recipe.id)");
    expect(readFileSync("components/admin/menu-costing/MenuCostingClient.tsx", "utf8")).toContain("menuItemPageHref(row.id)");
  });
});
```

Run: `npx vitest run tests/legacy-recipe-line-boundary.test.ts` → FAIL (a GM's add is accepted as far as the database).

- [ ] **Step 2: `lib/recipes.ts` — the global line writer is MoO+**

1. Add `import { RECIPE_GLOBAL_WRITE_MIN } from "@/lib/recipe-versions-shared";` beside the `@/lib/recipes-shared` import.
2. Directly after the `requireLevel` function, add:

```ts
/**
 * Catalog Phase 3b (spec §3): the GLOBAL recipe's LINES are the Director of Operations' (8+). A GM's
 * line edit is its shop's version (lib/admin/recipe-versions.ts, /admin/catalog/recipe/[id]) — named
 * global_requires_moo so the builder can say where to go. Header, outputs, yields and creation keep
 * their GM floor: Phase 3 versions the lines only.
 */
function requireGlobalLineWriter(actor: AuthContext): void {
  const level = getRoleLevel(actor.user.role);
  if (level < RECIPE_GLOBAL_WRITE_MIN) throw new RecipeError(403, level >= RECIPE_WRITE_MIN ? "global_requires_moo" : "forbidden");
}
```

3. In `addRecipeInput`, replace

```ts
  requireLevel(actor, RECIPE_WRITE_MIN);
  const { skuId, itemId, productId } = componentTargets(input);
```

with

```ts
  requireLevel(actor, RECIPE_WRITE_MIN);
  requireGlobalLineWriter(actor);
  const { skuId, itemId, productId } = componentTargets(input);
```

4. In `updateRecipeInput`, replace

```ts
  requireLevel(actor, RECIPE_WRITE_MIN);
  const { line, expected } = input;
```

with

```ts
  requireLevel(actor, RECIPE_WRITE_MIN);
  requireGlobalLineWriter(actor);
  const { line, expected } = input;
```

5. In `removeRecipeEdge`, replace

```ts
export async function removeRecipeEdge(actor: AuthContext, args: { table: "recipe_inputs" | "recipe_outputs"; id: string }): Promise<void> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const sb = getServiceRoleClient();
```

with

```ts
export async function removeRecipeEdge(actor: AuthContext, args: { table: "recipe_inputs" | "recipe_outputs"; id: string }): Promise<void> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  if (args.table === "recipe_inputs") requireGlobalLineWriter(actor);
  const sb = getServiceRoleClient();
```

- [ ] **Step 3: The builder names the reason** — in `components/admin/recipes/shared.ts` `KNOWN_ERROR_CODES`, after `"product_line_needs_measure_unit",`, add:

```ts
  // Catalog Phase 3b: the global recipe's lines are MoO+; a GM edits its shop's version on the catalog page.
  "global_requires_moo",
```

(`recipes.error.global_requires_moo` came with Task 7.)

- [ ] **Step 4: The legacy recipe page points at the shop-version page** — in `app/admin/recipes/[id]/page.tsx`:
1. Add the imports `import Link from "next/link";`, `import { serverT } from "@/lib/i18n/server";` and `import { recipeItemHref } from "@/lib/catalog/recipe-item-shared";`.
2. Replace

```tsx
  return (
    <div>
      <RecipeBuilder
```

with

```tsx
  const lang = auth.user.language;
  return (
    <div>
      {/* Catalog Phase 3b: each shop's own ingredients and amounts live on the catalog recipe page. */}
      <div className="mx-auto mt-2 w-full max-w-3xl rounded-lg border-2 border-co-border bg-co-surface p-3">
        <Link href={recipeItemHref(recipe.id)} className="inline-flex min-h-[44px] items-center text-sm font-bold text-co-text underline">
          {serverT(lang, "recipes.catalog_link")}
        </Link>
        <p className="text-xs text-co-text-muted">{serverT(lang, "recipes.catalog_link_hint")}</p>
      </div>
      <RecipeBuilder
```

- [ ] **Step 5: The costing board's drawer opens the sandwich page** — in `components/admin/menu-costing/MenuCostingClient.tsx`:
1. Add `import { menuItemPageHref } from "@/lib/catalog/recipe-item-shared";`.
2. Replace

```tsx
                    <RowDrawer
                      row={row}
                      skuNames={skuNames}
```

with

```tsx
                    <a href={menuItemPageHref(row.id)} className={drawerLinkCls}>{t("catalog.menu.open_page")}</a>
                    <RowDrawer
                      row={row}
                      skuNames={skuNames}
```

- [ ] **Step 6: The suites that drive the GLOBAL line writer use its writer** — in `tests/recipe-line-edit-server.test.ts`, replace

```ts
const gm = { user: { id: "u-gm", role: "gm" } } as unknown as AuthContext;
```

with

```ts
// Catalog Phase 3b: the GLOBAL recipe's lines are MoO+ (a GM edits its shop's version). This suite
// exercises the global line writer, so its writer is a MoO; the name stays to keep the suite's diff small.
const gm = { user: { id: "u-gm", role: "moo" } } as unknown as AuthContext;
```

and in `tests/recipe-input-remove-locked.test.ts` (3a), replace

```ts
const gm = { user: { id: "u1", role: "gm" }, role: "gm", level: 7, locations: [] } as never;
```

with

```ts
// Catalog Phase 3b: deleting a GLOBAL recipe line is MoO+.
const gm = { user: { id: "u1", role: "moo" }, role: "moo", level: 8, locations: [] } as never;
```

- [ ] **Step 7: Run, then commit**

Run: `npx vitest run tests/legacy-recipe-line-boundary.test.ts tests/recipe-line-edit-server.test.ts tests/recipe-input-remove-locked.test.ts tests/recipes-batch-mode.test.ts tests/step-up-tier-map.test.ts && npx tsc --noEmit 2>&1 | grep -v -i leaflet | grep "error TS"`
Expected: PASS; no tsc output.

```bash
git add lib/recipes.ts components/admin/recipes/shared.ts "app/admin/recipes/[id]/page.tsx" components/admin/menu-costing/MenuCostingClient.tsx tests/legacy-recipe-line-boundary.test.ts tests/recipe-line-edit-server.test.ts tests/recipe-input-remove-locked.test.ts
git commit -F - <<'EOF'
feat(recipes): the global recipe's lines are MoO+ (a GM edits its shop's version); links into the catalog pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 12: Manager guide — shop versions of recipes and menu items (en + es)

Photos are deferred: the steps carry "(not shown)" and every screen changed in Phases 1–5 gets one retake pass after Phase 5 (spec §7 as amended).

**Files:**
- Modify: `docs/guides/manager-guide.md`
- Test (existing): `tests/guides-reading-level.test.ts`, `tests/guides-v2-shape.test.ts`, `tests/guides-markdown.test.ts`

- [ ] **Step 1: Run the guide tests first (the baseline)**

Run: `npx vitest run tests/guides-reading-level.test.ts tests/guides-v2-shape.test.ts tests/guides-markdown.test.ts`
Expected: PASS. The new text must keep it green.

- [ ] **Step 2: The English section** — insert directly after the line `- On a computer, use the arrow keys and Enter.` (the end of Phase 1's "Find an ingredient" step), after a blank line:

```markdown
### Your shop's recipes and menu

Each shop can change its own recipes and menu. The other shop is not touched.

#### 1. Change your shop's recipe (not shown)

**What to do** — Open the recipe from the catalog. Pick your shop at the top. Edit, add or remove an ingredient. Tap **See what this changes**. Check the costs. Tap **Save for** your shop.

**Worth knowing**

- The top of the page says whose recipe you see.
- Your first change makes your shop's own version. The other shop keeps the default.
- Lines you changed say **Changed here**.
- Only the Director of Operations changes the recipe for every shop.

#### 2. Go back to the default (not shown)

**What to do** — On your shop's recipe, tap **Go back to the default**. Check the costs. Tap the button to save.

**Worth knowing**

- Your version stays in the history. Tap **Restore** to bring it back.

#### 3. Use another shop's recipe (not shown)

**What to do** — Open **Other shops' versions**. Tap **Use** their version **here**. Check the costs. Save.

**Worth knowing**

- You get a copy. If they change it later, the app asks you first.
- **Take the update** copies their new version. **Keep mine** leaves yours as it is.

#### 4. Price, name and "sold here" for your shop (not shown)

**What to do** — Open the sandwich page. Pick your shop. Type the price here, the name here, or clear **Sold at this shop**. Tap **See what this changes**. Save.

**Worth knowing**

- Leave the price empty to use the price for every shop.
- A sandwich not sold here leaves your shop's costing board.

#### 5. Shop changes for the Director of Operations (not shown)

**What to do** — Open **Shop changes**. Read what each shop changed. Tap **Make it the default** to give it to every shop, or **Leave it**.

**Worth knowing**

- The preview lists every shop that will change. Shops with their own version stay as they are.
```

- [ ] **Step 3: The Spanish section** — append to the end of `docs/guides/manager-guide.md`, after a blank line:

```markdown
#### Las recetas y el menú de tu tienda

Cada tienda puede cambiar sus propias recetas y su menú. La otra tienda no cambia.

1. **Cambia la receta de tu tienda.** Abre la receta desde el catálogo. Elige tu tienda arriba. Edita, agrega o quita un ingrediente. Toca **Ver qué cambia**, revisa los costos y toca **Guardar para** tu tienda. Tu primer cambio crea la versión propia de tu tienda. Las líneas que cambiaste dicen **Cambiado aquí**. Solo el Director de Operaciones cambia la receta para todas las tiendas.
2. **Vuelve al predeterminado.** En la receta de tu tienda, toca **Volver al predeterminado**, revisa los costos y guarda. Tu versión queda en el historial; toca **Restaurar** para traerla de vuelta.
3. **Usa la receta de otra tienda.** Abre **Versiones de otras tiendas**, toca **Usar aquí la versión de** esa tienda, revisa y guarda. Recibes una copia. Si la cambian después, la app te pregunta primero: **Tomar la actualización** o **Quedarme con la mía**.
4. **Precio, nombre y "se vende aquí".** Abre la página del sándwich y elige tu tienda. Escribe el precio aquí o el nombre aquí, o quita **Se vende en esta tienda**. Toca **Ver qué cambia** y guarda. Deja el precio vacío para usar el precio de todas las tiendas.
5. **Cambios de las tiendas (Director de Operaciones).** Abre **Cambios de las tiendas**. Toca **Hacerlo el predeterminado** para dárselo a todas las tiendas, o **Dejarlo**. La vista previa muestra cada tienda que cambia; las que tienen su propia versión no cambian.
```

- [ ] **Step 4: Run the guide tests**

Run: `npx vitest run tests/guides-reading-level.test.ts tests/guides-v2-shape.test.ts tests/guides-markdown.test.ts`
Expected: PASS, 0 failed. If "Manager tools" is reported above grade 6, shorten the named longest sentences; never delete a fact to pass.

- [ ] **Step 5: Commit** (docs, shipped in the same PR as the code it describes)

```bash
git add docs/guides/manager-guide.md
git commit -F - <<'EOF'
docs(guides): manager guide — your shop's recipes and menu, back to default, adopt, Shop changes (en + es)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 13: The law (AGENTS.md)

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Append to 3a's `### Recipe and menu-item shop versions (0262–0263, catalog Phase 3, 2026-10-15)` section:**

```markdown
- **NAMED LINES (3b).** A preview refuses a line the change ADDS that would fail, naming it (position, name, reason); it flags lines the change only CARRIES; the writer re-judges added lines under its locks. The page shows a refusal in the message and beside the line, and a flag on every carried broken line, en + es.
- **THE PAGES (3b): every change is previewed, and the save is the preview.** `/admin/catalog/recipe/[id]` and `/admin/catalog/menu-item/[id]` post ONE change request (recipe: `lines` · `restore` · `back_to_default` · `adopt` · `promote`; menu: `save` · `back_to_default` · `restore` · `promote`) to `/preview` (a read, offered only to who may save that target), then `/apply` (Tier E) with the preview's token; the server recomputes the preview and refuses `preview_stale` on any difference before calling the 3a writer with the SAME dependency snapshot (SQL re-checks it under the lock: `dependencies_changed`). The token binds the snapshot and every number shown. The recipe preview reaches the act's target only: a shop act → that shop; a global act → the default and every shop riding it, with every shop that has its own version listed as untouched — except a promote's source, which is named as returning to the default. A menu promote's changed shops are field by field. Hypothetical lines go through `loadRecipeGraph({ recipeOverrides })` — never a second costing path; "Used in" reads the scope-resolved graph.
- **NOTICES ARE COMPUTED, NEVER SWEPT.** `computeRecipeNotices` (`lib/catalog/recipe-notices-shared.ts`) derives "the shop you copied changed / went back to default / is now the default" and "a new default (promoted within 30 days)" from the versions read per request (a retired copy source counts even with no newer save); "Keep mine" / "Got it" is one `recipe_notice_dismissals` row for the version SEEN in the STATE seen (`source_changed` / `source_retired` / `new_default`), so the next change — or that version's retirement — raises it again. A shop's food changes only by its own GM's act (adopt again, back to default); nothing changes it on their behalf.
- **The legacy builder's LINE writes are the global default's (MoO+):** `addRecipeInput` / `updateRecipeInput` / `removeRecipeEdge(recipe_inputs)` refuse a GM with `global_requires_moo`. Creating a recipe, its header, outputs, yields and batch mode keep their GM floor until a later phase versions them.
- **The Shop changes list (MoO+) is read-only until Promote;** "Leave it" writes nothing.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -F - <<'EOF'
docs(agents): the recipe/menu pages, previews as saves, computed notices, the legacy line boundary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 14: Final verification

3b applies **no** migration; its data layer (0262/0263) was applied in 3a Task 12. Confirm before the walk: `select version, name from supabase_migrations.schema_migrations order by version desc limit 2;` on the sim and prod → `0263_menu_item_shop_settings`, `0262_recipe_shop_versions`.

- [ ] **Step 1: Full unit suite** — Run: `npx vitest run`. Expected: every file passes, 0 failed; the two snapshot tests report skipped.
- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit`. Expected: exactly the 6 known Leaflet `TS2307` errors, nothing else.
- [ ] **Step 3: Lint and build** — Run: `npm run lint && npx next build`. Expected: lint clean; build succeeds.
- [ ] **Step 4: The goldens are untouched** — Run: `git log --oneline -- tests/fixtures/recipe-versions-golden.json tests/fixtures/shop-versions-golden.json`. Expected: no 3b commit.
- [ ] **Step 5: Sim browser walk (port 3100)** — phone (390×844), tablet (820×1180), desktop (1440×900), in en and es. Sign in as a GM of shop A unless a step says otherwise.
  1. `/admin` shows **Recipe updates** (GM) and, as a MoO, **Shop changes**. No horizontal page scroll anywhere; the shop switchers scroll inside their own row; every control ≥ 44px.
  2. `/admin/catalog/recipe/<id>` opens on shop A: "Shop A · using the global default". Edit an ingredient's amount → **See what this changes** lists the line change and every sandwich whose cost moves at shop A only → **Save for Shop A** asks for the password once (then 15 minutes free) → the label reads "Shop A's version · based on the global default", the line says **Changed here**, `/admin/menu-costing?location=<A>` shows the new cost, shop B's view does not move.
  3. Same page, shop B pill: read-only for a GM of A ("pick your shop" hint), B's version is listed under **Other shops' versions**; as A's GM, **Use Shop B's version here** previews, saves, and the label reads "copied from Shop B".
  4. As shop B's GM, change that recipe again; as shop A's GM, the recipe page and `/admin/catalog/notices` show "Shop B changed the … you copied. Take the update?" — **Keep mine** clears it; change B again — it returns. **Take the update** previews the adopt and saves.
  5. **Go back to the default** at shop A previews the default's lines and saves; History shows A's version with **Restore**; Restore brings it back as a new version.
  6. As a MoO: `/admin/catalog/shop-changes` lists A's version with who/where/when and what changed; **Make it the default** previews — reaching the default and every shop riding it, listing the shops with their own version as untouched, and "Shop A goes back to the default · its food stays the same" — and saves; shop A's label now reads "using the global default" and its History keeps the retired version; the riding shop's GM sees "… has a new default for every shop (from Shop A)" until **Got it**; shop A's GM sees no notice about its own promotion; a shop that had COPIED A's version sees "Shop A's … is now the default for every shop. Go back to the default?".
  6b. Notice states: as shop B's GM, go back to the default with no other change; as shop A's GM (who copied B), the notice "Shop B went back to the default …" appears; **Keep mine** clears it; it does not return until B saves again.
  6c. A stale preview: open a preview at shop A, then (as a MoO in another tab) enter a new price for one of its ingredients; **Save** in the first tab answers "Something this recipe uses changed since you looked …" and nothing is written. Repeat with a price change on an ingredient this recipe does NOT use: the save goes through (lead decision (a)).
  6d. Two broken lines: retire two products the Italian pins (as a MoO, on the products page). The Italian page flags both lines ("Line 3 (Ham) needs fixing …"); fix one, see what changes (the other is listed as still needing a fix), save — it saves; then fix the second. Adding a new line naming a retired product is refused: "Line 7 (Ham): That ingredient is a retired product …" (en and es).
  6e. The hub: with only shop B's version broken, `/admin` shows the Recipes card's count and under it "1 at Shop B"; the link opens `/admin/recipes?location=<B>` labelled "Readiness at Shop B", where that recipe carries its badge.
  7. As a GM in the global view, no line editor; the hint names the Director of Operations. On `/admin/recipes/<id>` (legacy builder) a GM's line edit shows the `global_requires_moo` message in en and es, and the banner links to the catalog page.
  8. `/admin/catalog/menu-item/<id>` at shop A: set price 13.50 → preview shows price and margin before → after → save; the costing board's shop-A view shows $13.50, shop B's does not; clear **Sold at this shop** → saved → the shop-A board lists it under "Not sold at this shop"; **Go back to the global menu** restores both. On the Shop changes list, **Make $13.50 everyone's price** previews the shops that change and saves.
  9. Yesterday's depletion at shop A is unchanged after the shop version (the 3a Task 13 Step 5 query).
  10. Drafts survive: open a line editor on "What goes in", type a new amount, tap the section header — it stays open (the "Save or discard your change to close this" note shows); Discard, then it collapses.
  11. The menu form follows the row: at shop A set price 13.50 and clear **Sold at this shop**, save; **Go back to the global menu**, save; the form now shows the global price and **Sold at this shop** checked; edit only the name here and preview — price and sold-here show no change.
- [ ] **Step 6: Open the PR** — title `feat(catalog): Phase 3b — recipe and menu-item pages, adopt / promote / back to default, Shop changes, notices`; the body links this plan and 3a, states "no migration (0262/0263 applied in 3a)", attaches the phone/tablet/desktop screenshots, and ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
```

---

## Judgment calls (made in this plan; each is reversible in one place)

1. **Model (§3.1).** The global default's LIVE lines stay in `recipe_inputs` (zero blast radius for its ~15 direct readers and Phase 1's line RPCs); every version owns a full line set in `recipe_version_lines`; the global history is a commit-time **journal** written by deferred constraint triggers (no writer can skip it). This is the "equivalent design that keeps Phase 1's line RPCs and the graph lock semantics" the brief allows.
2. **Edits are dated, existence is not.** Every recipe's first global version starts on 2000-01-01 (backfill and later recipes alike), so a new recipe still explains yesterday's sales exactly as today's code does; only edits are effective-dated.
3. **A version covers the LINES only.** Outputs, yields (the per-unit divisor), batch mode, shelf life, name and directions stay global; batch_yield is a guard, never divided by.
4. **Floors.** Recipe shop versions and menu overlays are GM (7) at its own shops, MoO (8)+ any shop and global — spec §2's table puts recipes and menu items at GM; AGM floor fixes are Phase 5. The constants (`RECIPE_SHOP_WRITE_MIN`, `MENU_SHOP_WRITE_MIN`) are the one place to lower them.
5. **Reads are org-wide at 6** (recipes are the company's knowledge; adopt needs to see other shops' versions); writes are bound.
6. **Promote returns the source shop to the default** (lead decision 5): its version is retired in the promote transaction (closing when the new default opens; history kept), so later global edits reach it again; its food is unchanged today. A menu promote does the same for the promoted fields (a field it did not promote, or "not sold here", carries on in a new row).
7. **Restore** = a new version from this recipe's global history or this shop's own; another shop's version is **adopt**, never restore.
8. **Menu model.** The global default IS the `menu_items` row; overlays are shop rows only. "Sold here" is never promoted; promote copies price and/or name under a compare-and-set.
9. **Catering is untouched** (lead decision 2; spec §3/§9: Keith's setup is global): catering prices and the portal keep the global menu price, no catering file changes. Its shop-scoped ingredient reads already pass their shop to the graph (2a), so they follow that shop's recipe through the one resolver — read as "the food that shop makes", not as a catering change.
10. **Notice answers take no password** (they change no food): same-origin, GM floor, shop bind.
11. **The legacy builder** keeps recipe creation and header/outputs at GM+; only line writes move to MoO+.
12. **The global-lines save** writes `recipe_inputs` with the least churn (kept lines updated in place by id), then journals as the actor; legacy edits through `update_recipe_input_atomic` journal with no actor (its signature has none — re-emits stay byte-faithful), so History shows "—" for who on those rows; the audit log names them.
13. **Toast prices on the costing board's shop view stay the all-shops cache** (filtering them is a behaviour change with no shop version, which the equivalence pin forbids). A shop's TYPED overlay price wins on its board, so its margins use the shop price (lead decision 3).
14. **The dependency snapshot is the change's closure** (lead decision (a); 3a 0262 (7a)): the recipes it reaches and everything they consume, every SKU / product member / vendor / receipt / primary / overlay / pack / price / measure (pack-level AND flat-pack `each_measure`) they resolve through, for exactly the scopes the preview reaches — never an untouched shop. Inside the closure it is conservative — a par edit on a closure SKU stales the preview too (the whole SKU row is digested). Serialization is NOWAIT row and table locks after the graph lock, so a Phase 3 save never waits on (or deadlocks with) another writer: a dependency being written right now answers "try again in a moment".
15. **A save may not ADD or CREATE an invalid line; carried ones may stay** (lead decision (b)): "carried" = the same component, quantity and unit already in the set this scope resolves (a duplicate of a carried line is an addition). Carried broken lines are flagged on the page and in the preview; every refusal names the line (position, name, reason, en + es), in the message and beside the line.
16. **Notice dismissals carry the state seen** (`source_changed` / `source_retired` / `new_default`; 0262's CHECK allows the three). The source shop is not told about its own promotion.
17. **Readiness per shop, attributed** (lead decision (c)): the recipe page shows its shop's readiness; the recipes and items lists show the default's unless opened with `?location=<shop>` (labelled either way); the admin hub's count is not ready for the default OR any active shop, and lists WHERE ("1 in the default · 2 at P Street"), each linking to that scope's list (3a Task 6b).
18. **"Used anywhere" answers** (the SKU list's "used in", product ↔ item links, "N recipes still pin this product") count every scope; per-shop answers (production, par advisories, a location's product pins) count that shop's resolved recipe (3a Task 6b).

## Open questions (for Juan / Cristian / Keith)

Decided by the lead (no longer open): yields stay global (L1); catering untouched (L2); a shop's board margins use its overlay price (L3); readiness, par advisories and every other consumer read the shop's resolved recipe (L4 — 3a Task 6b); promote returns the source shop to the default (L5); GM-created shop-only recipes wait for Phase 4 (L6).

1. Should the costing board's shop view use **that shop's Toast prices** only, instead of the all-shops cache? (Changes numbers with no shop version — needs a written golden reason.)
2. When Keith revisits catering: should "not sold here" hide an item from that shop's catering menu? (Out of Phase 3 by L2.)

---

## Self-review against the spec (Phase 3 = 3a + 3b)

| Spec requirement | Where |
|---|---|
| §3 recipes and menu items are shop-versionable; `location_id NULL = global`; `based_on` recorded | 3a Tasks 3–4; 3b Tasks 1, 8–9 |
| §3 a GM/AGM edit creates/updates the shop's version; the page states "P Street's version · based on …" | 3a Task 7; 3b Tasks 1 (`recipeVersionLabel`), 8 |
| §3 one resolver per kind, never a second time in a consumer; per-shop graphs | 3a Tasks 2, 5, 6 |
| Effective-dated recipes (prior-day repair uses the recipe live that day) — closes 2a's open question 1 | 3a Tasks 3, 5; 3b Task 14 step 9 |
| §3 equivalence pin (fixture matrix + prod-shaped snapshot) | 3a Task 1 (+ 2a pins every task) |
| §3 adopt: a copy, based_on the source; "P Street updated this · take the update?" computed at read time; no change without the GM's yes | 3a Task 3 (`p_adopted_from`); 3b Tasks 3, 4, 5, 8, 10 |
| §3 promote (MoO+): preview lists every shop on the default that will change; own-version shops untouched; the source returns to the default (L5); atomic, audited | 3a Task 3 (`p_promoted_from` + source retired, one transaction), Task 4 (menu, field by field); 3b Tasks 2, 4, 5, 8, 10 |
| Previews bound to everything they show; re-validated under the lock at apply | 3a Tasks 3, 4 (snapshots), 7, 8; 3b Tasks 2, 5 (token = snapshot + numbers; apply hands the snapshot to the writer) |
| Every consumer reads the shop's recipe (L4) | 3a Tasks 5, 6b; 3b Task 5 ("Used in" from the scoped graph) |
| No 1000-row truncation in version line-set reads | 3a Tasks 5, 6b, 7, 8; 3b Task 5 (Shop changes, notices, version lines paged + chunked; an 1,100-line test) |
| Unsaved drafts survive (D10); the menu form follows the committed row | 3b Tasks 8, 9 (+ navigation pins) |
| §3 back to default: retired, never deleted; reversible | 3a Tasks 3, 7, 10; 3b Tasks 5, 8, 9 |
| §3 history append-only and audited; Restore | 3a Tasks 3, 4, 7, 8; 3b Tasks 8, 9 |
| §6 Shop changes list (MoO+): what, where, who, Promote / leave | 3b Tasks 5, 10 |
| §6 GM notices: adopted source changed; new global default | 3b Tasks 3, 5, 8, 10 |
| §2 GM/AGM own shops (lib bind), MoO+ any shop + global; Tier E; grants only for truly destructive acts | 3a Tasks 2, 7, 8, 10; 3b Tasks 4, 6, 11 |
| §4 item-page shape: sections, How it connects, version label, History + Restore, preview before save, phone/tablet/desktop, 44px, disclosure | 3b Tasks 8–10, 14 |
| i18n en + es (tú) | 3a Task 6; 3b Tasks 7, 11, 12 |
| §8 resolver / permission / preview / UI tests | 3a Tasks 2, 5, 7, 8; 3b Tasks 1–11 |
| §7 guide text each phase (photos after Phase 5) | 3b Task 12 |
| Database hardening (deny-all RLS, privilege ceilings, definer + pinned search_path, faithful re-emits with line-subsequence pins), apply runbook | 3a Tasks 3, 4, 12 |

**Placeholder scan:** every step names exact files, exact replaced text and complete new code; the only conditional instructions are explicit fallbacks with the command that decides them.

**Type consistency:** `RecipeChangeRequest`, `MenuChangeRequest`, `RecipeTarget`, `RecipeItemView`, `MenuItemPageView`, `ShopChangesView`, `menuFormRevision` (Tasks 1, 5) are used unchanged by Tasks 5–10; `RecipePreview` (now with `returnedShop`, `snapshot`), `ScopeImpact`, `MenuPreview` (now with `returnedShop`, `snapshot`), `menuPromoteChangedShops` (Task 2) by Tasks 5, 8–10; `RecipeNotice` (source_changed now carries `dismissKind`, `promotedToDefault`), `NoticeVersionRow`, `NoticeDismissKind` (Task 3) by Tasks 4, 5, 6, 8, 10; 3a's `writeRecipeVersion` (snapshot required) / `loadRecipeLiveSet` / `loadRecipeVersionHistory` / `loadRecipeChangeSnapshot` and `loadLiveMenuItemShopSettings` / `loadMenuChangeSnapshot` keep their 3a signatures.

**Astra round 1 (3b) — finding by finding:**

| # | Finding | Resolution |
|---|---|---|
| 1 | Consumers still read global lines | 3a Task 6b routes readiness, par advisories, production picker and conversion check, pins and "used in" through the one resolver (routing table; differing-recipe test). The open question is removed (L4 decided). |
| 2 | Promote does not return the source to default | 3a 0262 retires the source in the promote transaction; 3b `promoteRecipeVersion` doc, the preview's `returnedShop` (not "untouched"), notices (the source is not told about its own promotion; a copier hears "it is the default now"), judgment call 6 flipped, tests, walk step 6. |
| 3 | Preview not bound to the full result | The preview takes the dependency snapshot first; the token binds it and every number shown (impacts, cost, margins, shops); apply passes the same snapshot; SQL re-checks under the lock (`dependencies_changed`, en + es); tests for both a moved snapshot and a moved number. |
| 4 | Menu promote omits partially affected shops | `menuPromoteChangedShops` (field by field) in the preview and the same predicate in 0263; tests. |
| 5 | Retiring an adopted source → no heads-up; dismissal identity | `computeRecipeNotices` treats a retired copy source as moved on; dismissal kind carries the state (`source_retired` added to 0262's CHECK); tests for both sequences. |
| 6 | Menu form keeps stale inputs after restore / back to default | `menuFormRevision` + a prev-compare reset in `MenuItemClient`; pure test + source pin; walk step 11. |
| 7 | "Used in" bypasses the resolver | Derived from the scope-resolved graph already loaded for the page. |
| 8 | Collapsing ingredients discards edits | "What goes in" is locked open (and stays mounted) while a draft exists (D10), with an en/es note; source pin; walk step 10. |
| 9 | Shop changes truncates at the row limit | Every read in `lib/catalog/shop-changes.ts` paged with stable order and id-chunked; an 1,100-line test. |

**Astra round 2 (3b) — finding by finding:**

| # | Finding | Resolution |
|---|---|---|
| 1 | Re-validation permits concurrent changes | 3a `recipe_change_lock` / `menu_item_change_lock`: after the graph lock and the target row, NOWAIT locks block every dependency writer (products / vendor_items FOR UPDATE also block FK-referencing inserts: receipts, prices, packs, members, primaries; `locations` / `measure_units` SHARE); the snapshot is re-taken under them; lock order stated; 3a Task 12 Step 3b two-session check. |
| 2 | Whole-table snapshots | Scoped to the closure (3a `recipe_change_closure`); the preview passes (recipe, scope, lines); sim scenario (g) proves an unrelated SKU leaves it alone; judgment call 14 rewritten; walk step 6c. |
| 3 | Two invalid lines cannot be repaired | Only ADDED / CREATED lines are judged (`addedLinePositions`, same rule in SQL); carried ones are flagged; tests (3a two-broken-lines, 3b preview); walk step 6d. |
| 4 | Errors do not identify the line | `RecipeVersionError.line = { position, name, reason }` (lib, SQL `:<position>`, preview), routes return `line`, `postJson` carries it, the page names it in the message and beside the line; en + es keys; pins. |
| 5 | Hub count loses attribution | 3a `attributeNotReady` + hub "N at shop" links + scoped recipes / items lists (`?location=`); test; walk step 6e. |

**Astra round 3 (3b) — finding by finding** (and rebased on merged 2a @ 4955da7f — the interval-cached `createDatedGraphs`, `NIL_SCOPE`, `costPerOzFromGraph` in `lib/admin/menu-costing.ts`):

| # | Finding | Resolution |
|---|---|---|
| 1 | Flat-pack measures missing from the snapshot | 3a closure takes each closure SKU's `each_measure` registry row (its `units_per_pack` / `each_size` / `avg_oz_per_each` are in the SKU row); `measure_units` stays SHARE-locked; sim scenario (h). |
| 2 | Untouched shops stale a global preview | 3a closure scopes = exactly this preview's reached set (a shop target alone; the default + RIDING shops; NIL for a menu promote); sim scenario (i). |
| 3 | Shop changes drops the line details | `failMessage` names the refused line on preview and promote; the allowlist carries the line-rule codes; pin. |

**Astra round 4 (3b):**

| # | Finding | Resolution |
|---|---|---|
| 1 | The shop editor used global flat-pack data | `loadRecipeItemView` hydrates the picker through 2a's `loadSkuPackResolution(ids, scope)` (`scopedPickerSkus`): each SKU carries the scope's chain, so the editor's ounces and unit labels are the shop's; `lineUnitChoices` offers a chained SKU's own labels; tests (40 lb vs 30 lb case; a shop-only "crate"). |
| r8 | Back to default overwrote an earlier end record | 3a's retirement writes `coalesce(existing, new)` and every closing UPDATE touches only a live row; this view-model test runs on the extended real-writer sequence (adopt → restore pre-adoption → back to default): the end entry survives. |
| r7 | History inferred the link's end from based_on | History reads 0262's recorded `adoption_ended_from_version_id` (`historyLinkEndedSource`); the fabricated fixture is gone; `tests/recipe-provenance-history.test.ts` feeds the REAL writer's PGlite rows (restore pre-adoption, restore global, back to default → ended; adopted lineage → none). |
| r6 | Restoring pre-adoption history drops provenance silently | LEAD DECISION: provenance FOLLOWS THE CONTENT. Restoring an adopted-lineage version keeps the link; restoring a version from before the adoption ends it, like Back to default — said plainly in the preview ("This drops the link to <shop>'s recipe — you'll stop getting its updates.", en + es) and recorded in History ("Link to <shop>'s recipe ended"); tests for both sequences and the preview. |
| r5-1 | A refresh swapped the edit's conflict baseline | The edit captures `expected` (and the draft's start) when Edit is tapped; submit sends that baseline; a changed line shows the conflict with "Start over from the new version" (rebase: new baseline, editor remounted, preview cleared); `lineEditStale` test + source pin. |
| r5-2 | Promotion preview hid the Spanish name | The Shop changes promote preview shows the Spanish name before → after (the menu page already did); test. |
| 3a r5-1 | Adopted copies stop hearing their source after an edit | Provenance kept across edits (0262; provenance follows the content — see r6); the notice gains `editedSinceAdopting` and "You've changed your copy since adopting it …" (en + es); test. |
| 2 | Menu token missed parts of the change | The token binds the normalized patch (every persisted field, `null` = inherit) and both FULL sides (both names, inheritance); the preview shows the Spanish name and what is inherited; tests (Spanish-only change, own-equal-price vs inherit, old token refused). |
