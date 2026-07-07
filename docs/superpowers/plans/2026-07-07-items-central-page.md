# Items Central Page + Recipe Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin/items` central registry page (item-scoped editing lifted from the checklist-templates Global tab), checklist admin slimmed to prep-report structure, pipeline-ordered hub cards, and a MoO+ recipe delete (deactivate) button.

**Architecture:** Pure relocation of already-global UI (recon: `GlobalRegistryTab` has zero subtype coupling; all API routes reused verbatim). New `lib/admin/items.ts` loader composes the extracted registry query + producing-recipe map. NO migration, NO route renames. Spec: `docs/superpowers/specs/2026-07-07-items-central-page-design.md`.

**Tech Stack:** Next.js 16 App Router, TS strict + `noUncheckedIndexedAccess`, Supabase service-role loaders, i18n EN+ES.

**Conventions (every task):**
- Branch `claude/items-central-page` (Task 0). Commits end `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Gate per task: `npm run typecheck`. Final: `npm run build`.
- Re-read every target file's CURRENT state before editing (anchors below verified at `5a8c33e` unless noted).
- Shared-type changes: grep for ALL consumers before commit (`grep -rn "<TypeName>" lib/ app/ components/`).

**Execution order:** 0 → 1 → 2 → 3 → 4 → 5. Task 1 is independent; 2 is a prerequisite of 3; 4 depends on 3.

---

### Task 0: Branch setup

- [ ] `git fetch origin main && git checkout -b claude/items-central-page origin/main`

---

### Task 1: Recipe delete (deactivate) — floor raise + UI

**Files:**
- Modify: `lib/recipes.ts:204` (`deactivateRecipe`) — floor 7 → 8
- Modify: `app/api/admin/recipes/[id]/route.ts` — DELETE branch floor 7 → 8 (PATCH stays 7)
- Modify: `components/admin/recipes/RecipeBuilder.tsx` (or the detail page component that owns LIVE-mode actions — re-read `app/admin/recipes/[id]/page.tsx` first) — Delete button, ≥8-visible
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json` — `recipes.delete.*` keys

- [ ] **Step 1:** In `lib/recipes.ts`, add `export const RECIPE_DELETE_MIN = 8;` next to the other floors and change `deactivateRecipe` from `requireLevel(actor, RECIPE_WRITE_MIN)` to `requireLevel(actor, RECIPE_DELETE_MIN)`. Update its JSDoc.
- [ ] **Step 2:** In `app/api/admin/recipes/[id]/route.ts`, re-read the current gate shape; on the DELETE handler only, raise the level check to ≥8 (import `RECIPE_DELETE_MIN`). `assertStepUp(ctx, "B")` stays. PATCH untouched.
- [ ] **Step 3:** UI — in the LIVE-mode builder (same component that got the what's-missing banner), add at the bottom of the page for `level >= 8` (thread the actor level prop if not already present — re-read what the detail page passes):
  - Idle: red-outline button `recipes.delete.button` ("Delete recipe" / "Eliminar receta").
  - Tapped: inline confirm pair `recipes.delete.confirm` ("Yes, delete" / "Sí, eliminar") + `recipes.delete.cancel` ("Cancel" / "Cancelar") mirroring `SkuCatalogClient`'s `confirmDeactivateId` pattern (`components/admin/skus/SkuCatalogClient.tsx:294-316`).
  - Confirm: `await requestStepUp("B")`, then `postJson(`/api/admin/recipes/${recipe.id}`, {}, "DELETE")` (re-read `components/admin/templates/shared.ts` postJson signature for DELETE support; recipes builder already imports a postJson variant — reuse its established fetch helper), on ok → `router.push("/admin/recipes")` + `router.refresh()`.
- [ ] **Step 4:** Add the 3 i18n keys × EN/ES (place near the other `recipes.*` keys):
  EN: `"recipes.delete.button": "Delete recipe"`, `"recipes.delete.confirm": "Yes, delete"`, `"recipes.delete.cancel": "Cancel"`.
  ES: `"Eliminar receta"`, `"Sí, eliminar"`, `"Cancelar"`.
- [ ] **Step 5:** `npm run typecheck` → clean. Commit: `feat(recipes): MoO+ delete (deactivate) button on recipe detail`.

---

### Task 2: Extract shared UnitSelect

**Files:**
- Create: `components/admin/UnitSelect.tsx`
- Modify: `components/admin/templates/GlobalRegistryTab.tsx` (remove the definition at ~1621-1694, import from the new home)
- Modify: every other importer — grep first: `grep -rn "UnitSelect" app/ components/` and update ALL import sites (recon suggests `LocationChecklistTab` may import it from the templates dir — verify).

- [ ] **Step 1:** Move the `UnitSelect` component (currently `GlobalRegistryTab.tsx:1621-1694`, exported, self-contained: units dropdown + MoO+ inline add via `POST /api/admin/checklist-templates/units`) verbatim into `components/admin/UnitSelect.tsx` with `"use client"` and the imports it needs (re-read the source block for exact deps: useTranslation, postJson/resolveErrorKey from `components/admin/templates/shared`, useStepUp, types). Keep the API route path as-is.
- [ ] **Step 2:** Update all import sites; delete the old definition. `npm run typecheck` → clean.
- [ ] **Step 3:** Commit: `refactor(admin): extract shared UnitSelect component`.

---

### Task 3: `/admin/items` — loader, page, moved components, hub card (THE BIG MOVE)

**Files:**
- Modify: `lib/admin/templates.ts` — extract the registry query (lines ~2018-2025 region) into an exported `loadItemRegistry(sb): Promise<ChecklistRegistryItem[]>` used by `loadChecklistAdminView` (unchanged behavior this task) and by the new items loader. Also export the itemQuestions loader if currently inline.
- Create: `lib/admin/items.ts` — `loadItemsAdminView(actor)`:
  ```ts
  export interface ItemsAdminView {
    actorLevel: number;
    registry: ChecklistRegistryItem[];
    sections: PrepSectionDefn[];          // grouping + section dropdown
    units: <existing units type>[];
    itemQuestions: <existing type>[];
    producingRecipeByItem: Record<string, string>; // itemId → ACTIVE recipe id
  }
  ```
  Gate ≥6. `producingRecipeByItem` = `recipe_outputs.output_item_id → recipe_id` filtered to active recipes (two small selects; mirror the active-filter discipline in `lib/admin/readiness-load.ts` `loadGraphReadiness`).
- Create: `app/admin/items/page.tsx` — mirror `app/admin/skus/page.tsx` shape: `requireSessionFromHeaders("/admin")`, gate ≥6, `loadItemsAdminView(auth)` + `loadGraphReadiness` in try/catch (gaps-only `itemReadiness` record), `AdminBackLink`, title/subtitle keys, `<ItemsClient …>`.
- Create: `components/admin/items/ItemsClient.tsx` (+ sibling files as lifted) — LIFT from `GlobalRegistryTab.tsx`: the blast-radius banner, item groups-by-section rendering (~123-147), `RegistryRow` (~788-1170), `ItemQuestionsEditor` + `ItemQuestionRow` (~1179-1338+), `AddGlobalItem` (~1422-1603), `Labeled` helper. Adaptations ONLY:
  1. Props become `{ view: ItemsAdminView; itemReadiness: Record<string, Readiness> }`.
  2. `UnitSelect` imported from `components/admin/UnitSelect` (Task 2).
  3. The static `<a href="/admin/recipes">` on the row (~947-952) becomes: if `producingRecipeByItem[item.itemId]` → `<Link href={`/admin/recipes/${id}`}>` label `recipes.item_link.production_recipe`; else render nothing (the red "no recipe" badge is the nudge).
  4. All API calls / gates / step-up tiers UNCHANGED.
  Do NOT edit GlobalRegistryTab in this task (Task 4 handles the slim-down) — copy, don't cut, so the app stays coherent between tasks.
- Modify: `lib/admin/sections.ts` — add items card AND reorder to the pipeline:
  ```ts
  export const ADMIN_SECTIONS: AdminSection[] = [
    { id: "users",               …minLevel: 8 },
    { id: "vendors",             …minLevel: 6 },
    { id: "skus",                …minLevel: 6 },
    { id: "recipes",             …minLevel: 6 },
    { id: "items",               i18nKey: "admin.section.items" as TranslationKey, href: "/admin/items", minLevel: 6 },
    { id: "checklist-templates", …minLevel: 7 },
    { id: "categories",          …minLevel: 8 },
    { id: "pars",                …minLevel: 7 },
    { id: "locations",           …minLevel: 9 },
    { id: "audit",               …minLevel: 9 },
  ];
  ```
  (Keep existing entries' fields verbatim; only order + the new row change.)
- Modify: `app/admin/page.tsx` — hub pill mapping: `counts = { skus: c.skus, recipes: c.recipes, items: c.items }` (the items pill moves OFF `checklist-templates` onto `items`; update `wantsCounts` ids to match).
- Modify: `lib/i18n/en.json` / `es.json` — `admin.section.items` ("Items" / "Artículos"), `admin.items.title` ("Item registry" / "Registro de artículos"), `admin.items.subtitle` ("Recipes create items; items feed checklists and reports." / "Las recetas crean artículos; los artículos alimentan checklists y reportes.").

- [ ] **Step 1:** Extract `loadItemRegistry` in templates.ts (behavior-preserving; typecheck after).
- [ ] **Step 2:** Write `lib/admin/items.ts` (verify the itemQuestions + units + sections loaders' actual shapes in templates.ts before composing).
- [ ] **Step 3:** Lift the components into `components/admin/items/` with the 4 adaptations. Keep file sizes sane: `ItemsClient.tsx` (shell + groups), `ItemRow.tsx` (RegistryRow + sold-directly + toggles), `ItemQuestions.tsx`, `AddItemForm.tsx`.
- [ ] **Step 4:** Page + hub card + pill re-point + i18n keys.
- [ ] **Step 5:** `npm run typecheck` → clean; `npm run dev` sanity: `/admin/items` renders, edit panel saves, badge + recipe links present; old Global tab still works (untouched this task).
- [ ] **Step 6:** Commit: `feat(items): /admin/items central registry page (lifted from Global tab) + pipeline hub order`.

---

### Task 4: Slim the checklist-templates admin

**Files:**
- Create: `components/admin/templates/SectionsTab.tsx` — MOVE (cut) from `GlobalRegistryTab.tsx`: sections panel (`SectionRow`, `AddSectionForm`, ~152-539) + section-questions panel (`SectionQuestionRow`, `AddSectionQuestionForm`, ~541-786), plus a pointer link card to `/admin/items` (i18n `admin.templates.items_moved` EN "Item definitions now live in the Item registry." / ES "Las definiciones de artículos ahora viven en el Registro de artículos.").
- Delete: `components/admin/templates/GlobalRegistryTab.tsx` (everything item-scoped now lives in `components/admin/items/`; everything section-scoped in SectionsTab).
- Modify: `components/admin/templates/ChecklistTabs.tsx` — first tab becomes "Sections" (`admin.templates.tab_sections` EN "Sections" / ES "Secciones"; retire or repurpose `tab_global` usage), renders `<SectionsTab sections={…} sectionQuestions={…} actorLevel={…} />`; drop the `itemReadiness` prop; default tab = sections for ≥8 (sections editing is MoO+), else first location.
- Modify: `app/admin/checklist-templates/[subtype]/page.tsx` — drop the `loadGraphReadiness` block (badges live on /admin/items now).
- Modify: `lib/admin/templates.ts` — `loadChecklistAdminView` + `ChecklistAdminView`: DROP `registry`, `itemQuestions`, and the dead BOM/cost payload (`itemComponents`, `skuOptions`, cost-purpose `measureUnits`, `itemCosts` — recon: computed at ~2096-2136, consumed by NOTHING since MadeFromEditor was orphaned). KEEP `sections`, `sectionQuestions`, `locations`, `actorLevel`, `subtype`, and the units load IF the location tabs use UnitSelect (grep before dropping). GREP DISCIPLINE: `grep -rn "ChecklistAdminView\|itemComponents\|skuOptions\|itemCosts\|\.registry" app/ components/ lib/` and reconcile every consumer.

- [ ] **Step 1:** Create SectionsTab (cut from GlobalRegistryTab), rewire ChecklistTabs, delete GlobalRegistryTab.
- [ ] **Step 2:** Slim the loader + type; run the grep; fix all consumers.
- [ ] **Step 3:** `npm run typecheck` → clean; dev sanity: `/admin/checklist-templates/am_prep` shows Sections tab + location tabs; sections rename/add still work; NO item editing remains there; `/admin/items` unaffected.
- [ ] **Step 4:** Commit: `refactor(templates): checklist admin slims to prep-report structure (sections tab); drop dead BOM payload`.

---

### Task 5: Gates + PR

- [ ] **Step 1:** `npm run typecheck` && `npm run build` && `npx tsx scripts/readiness-rules-check.ts` → all clean.
- [ ] **Step 2:** Push + PR titled "Items central page + recipe delete — pipeline IA (SKUs → recipes → items → checklists)". Body: summary (relocation not rebuild, zero migration/route churn, floor raise 7→8 on recipe delete, hub pipeline order, dead-payload cleanup), test plan with PREVIEW url: items page CRUD parity (edit/add item, toggles, questions), per-item recipe link, sections tab intact, per-location tabs intact, recipe delete round-trip as MoO+ (and hidden for GM), hub order + items pill, ES pass. End body with the Claude Code line.

---

## Self-review notes

- Spec coverage: Part A moves (§1-4) → Task 3; stays (§sections) → Task 4; new pieces (loader/page/hub/i18n/pill) → Task 3; cleanup → Task 4; Part B → Task 1; hub order → Task 3. ✓
- Copy-then-cut sequencing keeps every commit shippable (Task 3 duplicates the editor briefly; Task 4 removes the old one — acceptable one-commit overlap, flagged in commit messages).
- Type consistency: `ItemsAdminView` consumed only by the new page/client; `ChecklistAdminView` slimming gated on the grep step.
