# Stage 6 — Catering Menu Seed — Implementation Plan

> **For agentic workers:** This is a GATED DATA-SEED plan executed inline by CC (the main loop), not subagents — every task writes to PROD and stops for Juan's checkpoint. The seed idiom (proven in Stages 1–3) replaces TDD: **author idempotent script → `SEED_DRY=1` dry-run (the test) → present dry-run for Juan's gate → run on prod → verify with SQL read-back → commit.** Steps use `- [ ]` for tracking.

**Goal:** Mirror CO's live Toast menu into CO-OPS (`menu_items` + prepped-item sides + resale) and seed the catering packages, so catering pricing/quotes and cost-to-make/depletion run on real data.

**Architecture:** Extend the shared recipe engine (`scripts/seed/lib-recipe-seed.ts`) to support consumer output (`output_menu_item_id`) and create-item-if-missing, then run four gated seed scripts (6a birth sub-items → 6b subs+builds → 6c sides+resale → 6d packages). Menu data is scraped from two Toast pages via the Playwright browser MCP into committed `docs/seed/source/toast-menu-*.md` artifacts (reproducibility), then hand-transcribed into typed script data.

**Tech Stack:** TypeScript + `tsx --env-file=.env.local`; Supabase service-role; Playwright MCP browser; the existing `seedRecipes` engine.

---

## File structure

- **Modify** `scripts/seed/lib-recipe-seed.ts` — add consumer-output + create-item-if-missing support (Task 1).
- **Create** `docs/seed/source/toast-menu-regular.md` + `toast-menu-catering.md` — scraped menu artifacts (Task 0).
- **Create** `scripts/seed/06a-deferred-subitems.ts` — Meatballs / Green Goddess / Caesar Dressing (Task 2).
- **Create** `scripts/seed/06b-menu-subs.ts` — subs → `menu_items` + consumer recipes (Task 3).
- **Create** `scripts/seed/06c-sides-and-resale.ts` — prepped-item sides (item.sold_directly) + resale menu_items (Task 4).
- **Create** `scripts/seed/06d-catering-packages.ts` — `catering_packages` (Task 5).
- **Update** `docs/superpowers/specs/2026-07-21-operational-seed-decisions.md` + memory after each gated stage.

---

## Task 0: Scrape the two Toast pages into source artifacts

**Files:** Create `docs/seed/source/toast-menu-regular.md`, `docs/seed/source/toast-menu-catering.md`.

- [ ] **Step 1: Render + snapshot the regular menu.** Playwright: `browser_navigate` to `https://order.toasttab.com/online/compliments-only-capitol-hill-526-8th-street-southeast`, then `browser_snapshot` (accessibility tree carries item name + price as text — reliable, unlike vision on a thumbnail). If a section is lazy-loaded, `browser_snapshot` after scroll or read the saved `.playwright-mcp/*.yml`.
- [ ] **Step 2: Transcribe** every line into `toast-menu-regular.md` as a table: `name | section | price`. Sections: Subs, Build Your Own, Chips & Sides, Drinks, Sweets, Gear.
- [ ] **Step 3: Render + snapshot the catering menu** at `https://www.toasttab.com/catering/compliments-only-capitol-hill-526-8th-street-southeast` (add `?mode=fulfillment` if it opens a date modal). Transcribe into `toast-menu-catering.md`: à-la-carte prices + the package sections (Sandwich Platters, Individual Lunch Boxes, Really Big Subs) with `serves N / min headcount` where shown.
- [ ] **Step 4: Commit** both artifacts.

```bash
git add docs/seed/source/toast-menu-regular.md docs/seed/source/toast-menu-catering.md
git commit -m "seed(stage6): capture Toast regular + catering menus as source artifacts"
```

**Verify:** both files list every visible menu line with a price; counts roughly match the on-screen menu (subs ~20, drinks ~15, sides ~10, packages ~6).

---

## Task 1: Engine extensions (consumer output + create-item-if-missing)

**Files:** Modify `scripts/seed/lib-recipe-seed.ts`.

The engine today writes `production` recipes → `recipe_outputs.output_item_id`, and SKIPS a recipe whose output item is missing. Stage 6 needs (a) `consumer` recipes → `output_menu_item_id`, and (b) 6a to birth a missing output item.

- [ ] **Step 1: Extend `RecipeDef`** — add optional `recipeType?: "production" | "consumer"` (default `"production"`), `outputMenuItemName?: string` (a `menu_items.name` to output to instead of an item), and `createItemIfMissing?: { section: string }` (birth the output item when absent).

- [ ] **Step 2: Resolve output target.** In `seedRecipes`, before the missing-item skip:
  - If `r.outputMenuItemName` set → look up `menu_items` by name → `menuItemId`; the output row uses `output_menu_item_id`, `output_item_id=null`, and `recipe_type` defaults to `"consumer"`.
  - Else resolve the item as today; if missing AND `r.createItemIfMissing` → INSERT the item and use its id (see Step 3).
  - Load a `menuItemByName` map alongside `itemByName`:

```ts
const { data: menuItems } = await sb.from("menu_items").select("id, name").eq("active", true).returns<Array<{ id: string; name: string }>>();
const menuItemByName = new Map((menuItems ?? []).map((m) => [m.name.toLowerCase(), m.id]));
```

- [ ] **Step 3: Create-item-if-missing helper.** When `createItemIfMissing` is set and the item is absent (dry: count + report; live: insert):

```ts
async function ensureItem(name: string, section: string): Promise<string> {
  const ex = itemByName.get(name.toLowerCase());
  if (ex) return ex;
  if (dry) { createdItems.push(name); return "DRY"; }
  const { data, error } = await sb.from("items").insert({
    name, section, location_id: null, is_default: true, active: true,
    tracking_type: "portioned", batch_yield: 1, required: false, opening_verify: false,
    sold_directly: false, catering_available: false, catering_only: false, created_by: null,
  }).select("id").single<{ id: string }>();
  if (error) throw new Error(`create item ${name}: ${error.message}`);
  itemByName.set(name.toLowerCase(), data.id); createdItems.push(name);
  void audit({ actorId: null, actorRole: null, action: "item.create", resourceTable: "items", resourceId: data.id, metadata: { name, section, creation_method: "seed_script", phase }, ipAddress: null, userAgent: null });
  return data.id;
}
```
  (Confirm `items` NOT-NULL columns against live schema first — `tracking_type`, `batch_yield`, `required`, `opening_verify`, `active`, `is_default`, `sold_directly`, `catering_available`, `catering_only` are NOT NULL per the Stage-3 grounding; defaults above satisfy them.)

- [ ] **Step 4: Recipe insert honors `recipe_type`.** Change the hardcoded `recipe_type: "production"` to `r.recipeType ?? (r.outputMenuItemName ? "consumer" : "production")`.

- [ ] **Step 5: Output insert branches.** The `recipe_outputs` insert uses either `output_item_id` (production) or `output_menu_item_id` (consumer); idempotency check keys on whichever is set.

- [ ] **Step 6: Report** `createdItems` in the summary.

- [ ] **Step 7: Typecheck** `npx tsc --noEmit` → exit 0.

- [ ] **Step 8: Commit** (engine change ships with Task 2's first use so it's exercised).

**Verify:** `tsc` clean. No behavior change for existing production-only callers (03a–03d) — `recipeType` defaults preserve them; re-running 03a dry-run shows `9 existed` unchanged.

---

## Task 2 (6a): Birth the deferred sub-items

**Files:** Create `scripts/seed/06a-deferred-subitems.ts` (thin caller over the engine).

Birth 3 items the signature-sub builds need, each via a `production` recipe with `createItemIfMissing`. Read their recipes from `docs/seed/recipes/ALL-RECIPES.md` first (Meatballs, Meatball Spice Mix, Green Goddess, Cesear Dressing) and transcribe ingredient qtys like Stage 3.

- [ ] **Step 1: Ground** — confirm none of "Meatballs", "Green Goddess", "Caesar Dressing" already exist as active items (`SELECT name FROM items WHERE active AND name IN (...)`). Read the 4 recipes.
- [ ] **Step 2: Author** `RECIPES` with `createItemIfMissing: { section }` (Meatballs→Cooks, Green Goddess→Sauces, Caesar Dressing→Sauces). Meatballs consumes Ground Beef/Ground Pork/Eggs/Panko/Parmesan + the Meatball Spice Mix (recursive — birth Meatball Spice Mix too, or fold its spices inline; prefer a separate Meatball Spice Mix item + recipe so the recursive graph mirrors reality). Green Goddess: Sour Cream/Lemon Juice/herbs/Garlic/Salt. Caesar Dressing: Garlic/Lemon Juice/Dijon/Duke's Mayo/Parmesan/Grapeseed Oil/Salt/Pepper. Unresolved ingredients auto-placeholder.
- [ ] **Step 3: Dry-run** `SEED_DRY=1 npx tsx --env-file=.env.local scripts/seed/06a-deferred-subitems.ts` → expect 4–5 recipes, 3–4 items created, some placeholders (e.g. beef base already exists; herbs). Present to Juan.
- [ ] **Step 4: (gate) Run on prod** after Juan's OK.
- [ ] **Step 5: Verify** — `SELECT name FROM items WHERE name IN ('Meatballs','Green Goddess','Caesar Dressing')` returns 3 active; each has a production recipe output.
- [ ] **Step 6: Commit + update decisions doc/memory.**

---

## Task 3 (6b): Subs → menu_items + consumer-recipe builds

**Files:** Create `scripts/seed/06b-menu-subs.ts`.

- [ ] **Step 1: Ground** — re-read `menu_items` columns; confirm the audit action for menu items (`grep menu_item lib/destructive-actions.ts`; use `menu_item.create` if present, else `recipe.create`/a sensible action + note). Read `docs/seed/source/sandwich-build-sheet.csv` + `toast-menu-regular.md`.
- [ ] **Step 2: Insert menu_items** for the 11 signature subs + ~9 Build-Your-Own subs: `{ name, section: "Subs"/"Build Your Own", menu_price: <regular from toast-menu-regular.md>, catering_available: true, catering_portionable: true, catering_only: false, active: true }`. Idempotent by `name`. Audit each.
- [ ] **Step 3: Author consumer recipes** using the extended engine — `RecipeDef` with `outputMenuItemName: "<sub name>"`, `recipeType: "consumer"`, inputs from the build sheet. Ingredient resolution (item-first for prepped, SKU for raw), per the spec's mapping table: sauces/deli/veg/cook names → wired ITEMS (`item: true`); `Shredduce`→Iceberg (item), `Oil/Vin`→Vin (item), `Shredded Cheese`→Shredded Mozzarella (item); `Utz Ripples`→Utz chips SKU, `Arugula`→Arugula SKU, `Bacon`→Bacon SKU, seasonings→raw SKUs. Auto-placeholder unresolved SKUs.
- [ ] **Step 4: BYO subs** — simple builds: the meat/salad ITEM + standard fixings (Shredduce/Onion/Oil-Vin/Oregano items) + the roll SKU (`Sub Roll` — placeholder if unseeded).
- [ ] **Step 5: Dry-run** → expect 20 menu_items, 20 consumer recipes, inputs mostly sub-items, a few placeholder SKUs (rolls, chips). Present to Juan.
- [ ] **Step 6: (gate) Run on prod.**
- [ ] **Step 7: Verify** — `SELECT count(*) FROM menu_items` = 20; every signature sub has a `consumer` recipe with ≥1 input via `recipe_outputs.output_menu_item_id`; spot-check one sub's build resolves to real items.
- [ ] **Step 8: Commit + update docs/memory.**

---

## Task 4 (6c): Prepped-item sides + resale menu_items

**Files:** Create `scripts/seed/06c-sides-and-resale.ts`.

- [ ] **Step 1: Flip prepped-item sides to sold_directly** — for each catering side that IS a wired item (Tuna Salad, Egg Salad, Chix Salad, Onion Dip, Antipasto Pasta, Meatballs, Roasted Red Peppers [item? else skip], etc.), `UPDATE items SET sold_directly=true, menu_price=<toast>, sell_portion=<size>, sell_portion_unit=<unit>, catering_available=true` by name (global). Audit `item.update`. Idempotent (only update when changed).
- [ ] **Step 2: Insert resale menu_items** — chips (Utz variants), drinks (DB sodas, Coke, Diet Coke, Topo Chico, Saratoga, teas, Natalie's Lemonade, Water, Red Bull), sweets (cookies, cannoli), gear (tee, sticker): `menu_items { name, section, menu_price, catering_available: (drinks/sweets? true : false), active }`, no recipe. Idempotent by name.
- [ ] **Step 3: Dry-run** → expect N item updates + M resale menu_items. Present to Juan.
- [ ] **Step 4: (gate) Run on prod.**
- [ ] **Step 5: Verify** — `SELECT count(*) FROM items WHERE sold_directly` matches; resale `menu_items` present with prices; no side both an item.sold_directly AND a duplicate menu_item.
- [ ] **Step 6: Commit + update docs/memory.**

---

## Task 5 (6d): Catering packages

**Files:** Create `scripts/seed/06d-catering-packages.ts`.

- [ ] **Step 1: Ground** — re-read `catering_packages` + `catering_package_items` + `catering_package_slot_options` columns (esp. the slot-options FK, which is NOT `package_id` — confirm the real name). Load the two location ids (Cap Hill `54ce1029-...`, P Street `d2cced11-...`).
- [ ] **Step 2: Author packages** from `toast-menu-catering.md`: Sandwich Platters (8/12/48-pc), Light/Full Lunch boxes, Three/Six Footer. Per package: `{ location_id, slug, label_en, description_en, pricing_mode: "flat", price_cents: <toast*100>, min_headcount: <serves N>, lead_time_hours: <e.g. 72 for footers>, active: true, display_order }`. **Seed for BOTH locations** (same prices). Idempotent by (slug, location_id).
- [ ] **Step 3: Slot options / items** — if a platter is "assorted subs, pick from group", seed `catering_package_slot_options` referencing the sub `menu_items` (from 6b); fixed contents → `catering_package_items`. If the Toast packages are flat (no pick-N), skip slots and note it.
- [ ] **Step 4: Dry-run** → expect ~6 packages × 2 locations = ~12 rows. Present to Juan.
- [ ] **Step 5: (gate) Run on prod.**
- [ ] **Step 6: Verify** — `SELECT count(*), sum(price_cents>0) FROM catering_packages`; each has price_cents + min_headcount; both locations covered.
- [ ] **Step 7: Commit; mark Stage 6 COMPLETE in decisions doc + memory; note Stage 7 (checklists) next.**

---

## Self-review (against the spec)

- **Spec coverage:** 6a (Task 2), 6b (Task 3), 6c (Task 4), 6d (Task 5), engine extensions (Task 1), Toast scrape (Task 0), rate-rules deferral (noted, not a task) — all covered.
- **Placeholder scan:** menu data (exact prices, exact package headcounts) is intentionally scrape-derived in Task 0 and consumed downstream — not a plan placeholder but a real dependency ordering. Ingredient qtys transcribed from the build sheet during authoring, like Stages 3a–3d.
- **Type consistency:** `RecipeDef` fields added in Task 1 (`recipeType`, `outputMenuItemName`, `createItemIfMissing`) are the exact names used in Tasks 2–3. `seedRecipes` signature unchanged (opts still `{dry, phase}`).
- **Known follow-ups (out of scope, in spec):** `catering_rate_rules` (Juan/UI), `name_es`, `toast_ref`, resale→SKU depletion recipes.
