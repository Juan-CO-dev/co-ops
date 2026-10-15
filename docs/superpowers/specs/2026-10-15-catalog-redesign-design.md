# Catalog redesign — design

**Date:** 2026-10-15 · **Owner decision:** Juan (approach A, Sections 1–4 approved in chat) · **Status:** approved design, pending spec review

## 1. Why

Juan tried to change how a SKU's package comes from the vendor and found it very hard: "even me knowing the system, had a hard time editing a sku properly. And how everything links is not clear." The goal: GMs can add, configure and edit everything their shop needs, easily, with **full functionality on every screen size** (phone, tablet, desktop), without losing any of the data guards that keep the numbers right.

### What the audit found (2026-10-15, current main)

- **Changing a pack (6×5 lb → 4×10 lb):** Admin → SKU Catalog → search → Edit (password) → scroll past ~13 fields → "Pack truth" → raw chain editor ("…of / Another level / A measure unit"). The friendly wizard (`PackChainWizard.tsx`) only appears for a SKU with no chain yet. `leaf_needs_avg` has no field to fix on the edit path. Knock-on effects are silent: the latest "Price per pack" spreads over the new case weight (cost/oz drops 25%), pars stored in order units ("3 cases") silently mean 120 lb instead of 90 lb, and a recipe line written in a renamed pack unit stops costing (`lib/recipe-math.ts:137-147`).
- **New SKU from a new vendor:** ~6 surfaces, 25+ fields, 3–4 password prompts; price can't be entered while adding (`SkuBuilder.tsx:685`).
- **Recipes:** no edit-in-place (delete + re-add a line), an unsearchable select of every SKU, and a Tier B password prompt on every action (`StepUpProvider.tsx:9`, `RecipeBuilder.tsx:178`).
- **Scattered:** one real change touches SKU, price, per-shop overlay, order guide, products, recipes, weights, and Toast (under Catering). Deep links land on whole lists (`CatalogClient.tsx:376`, `lib/vendor-import.ts:212`).
- **No screen at all:** price basis (`vendor_items.price_basis`, seed-only), `/admin/pars` (placeholder), menu-item management (rename / take off the menu).
- **Level walls:** item edit 8, menu price 8, import apply 9 — a GM can't finish their own work.
- **Jargon on screen:** "Pack truth", "Chain unverified", "Par (order units)", "Member SKUs / Primary member", "Consumer recipe", "Oz per full par-unit", "Cost unresolved", "Toast restaurant GUID", "Run match".
- `components/admin/skus/SkuPackChainPanel.tsx` is dead code.

### Keep (non-negotiable)

Append-only price history; pack chains versioned whole and audited; receipts and counts keep the ounces they had at the time; the single product resolution ladder and vendor failover (`resolveProductMember`); retirement refuses loudly and suppresses pars without mutating them; product lines measured only in an ACTIVE measure-registry unit of any dimension — weight, volume or count, never a vendor's pack label (AGENTS.md "measure-registry unit"; amended 2026-10-15); three-lane pars with "a human always wins" and the Dynamic Pars guards; vendor import's stage → review → apply with before-state snapshots and its refusal to guess multi-level pack changes; readiness errands; step-up for truly destructive writes; the tenant-vocabulary law (no CO literals in code); i18n en + es for every string.

## 2. Users and permissions

| Role | Can do |
|---|---|
| Crew, key holders | View. At the receiving door: teach a barcode, log a store-run item (today's KH exception), and **"This case looks different"**, which files a pack change for the GM to approve. |
| AGM (level 6) at their shop | Floor fixes in their shop's version: price, pack size, pars, "off here". |
| GM (level 7) at their shop | Everything shop-level: shop versions of pack and price, recipes, menu items and prices; pars; which vendor/SKU the shop buys; the shop's order days; order-guide layout; adopt another shop's version; apply a vendor price file to their shop. |
| Director of Operations (MoO) and above | Global: vendors, global defaults, **Promote**, retire a product, delete a recipe. |

The location bind lives in the lib (as `writeParFromSuggestion` does): a GM/AGM write is refused unless the target shop is one of theirs, independent of the route.

## 3. Global defaults and shop versions (Section 1)

- Every catalog object that can vary by shop has **one global default**. Vendors and SKU identity are global only.
- **Shop-versionable:** recipes; menu items (incl. shop price and "sold here"); sourcing (which SKU/vendor a shop buys — primaries, "off here", pars: already per shop today); **SKU pack chain and price** (shops in other regions will pay differently even from the same vendor).
- **Not shop-versioned (stays global for now):** vendors, SKU identity (name, item number, class), prep items (`items`), products, catering packages (Keith's catering setup).
- A GM/AGM never edits the global default. Their edit creates (or updates) **their shop's version**, recorded as *based on* the version it came from. The page states it: "P Street's version · based on the global default (changed: Turkey 4 oz → 5 oz)".
- **Resolution rule, one place per kind:** every consumer resolves "this shop's version if it has one, else the global default" — costing, depletion, ordering, counts, receiving, prep demand, Toast sales. This happens at the existing single resolver points (`loadRecipeGraph`, the SKU pack/basis loaders, the price lookup, the menu price lookup), never a second time in a consumer — the same law as product resolution. Per-shop graphs: the recipe graph is loaded per location.
- **Adopt** copies another shop's version as it is today (a new shop version *based on* it). When the source changes later, the adopting shop's GM gets "P Street updated this · take the update?" — a shop's food never changes without its own GM saying yes.
- **Promote** (MoO+) makes a shop's version the new global default. The preview lists every shop still on the default that will change. Shops with their own version are not touched.
- **Back to default:** a GM can drop their shop's version at any time (the version row is retired, never deleted).
- **New things a GM creates start shop-only** (e.g., a SKU from a local vendor); MoO+ can promote them to global.
- **History:** every version, adoption, promotion and revert is append-only and audited (who, when, from what). Past counts, receipts and sales are never re-resolved.

### Data shape (direction, finalized in the plan)

Extend the house idiom `location_id NULL = global` already used by `product_primaries` and `location_sku_settings`:

- **Pack chains:** chain versions gain `location_id` (NULL = global) and `based_on_version_id`; the active chain for (SKU, shop) is the shop's live version else the global live version.
- **Prices:** `vendor_price_history` gains `location_id` (NULL = global); the price lookup prefers the shop's latest, else the global latest.
- **Recipes:** a recipe version layer keyed (recipe, location NULL|shop) with `based_on`; lines belong to a version. The graph loader picks the shop version else global.
- **Menu items:** per-shop overlay (price, sold here, name override if needed), `location_id NULL = global`.
- **Adoption links:** `based_on` + a "source changed since adopt" signal computed at read time (no sweeper).
- All new tables: deny-all RLS, service-role writers through the lib with the location bind; writes audited with closed `AuditAction` names.

A precondition test pins the equivalence: **with no shop versions present, every number (costing, depletion, ordering suggestions, counts on-hand) is byte-identical to today** — the same differential-regression approach used for the coverage-horizon ruling.

## 4. The Catalog (Section 2)

- **One "Catalog" area** replaces the scattered pages (SKU Catalog, Products, Items, Recipes, Menu costing, Weights, the Toast tab under Catering). **One search box** finds anything by name, the vendor's item number, or barcode and opens that item.
- **Every item page has the same shape:**
  - Top: what it is in plain words (*Bought item*, *Prep item*, *Recipe*, *Sandwich*), which version you're seeing (*Global* / *P Street's version*), a shop switcher.
  - **"How it connects"** strip, every step tappable: a bought item shows *comes from Baldor → used in Shredded Lettuce, Italian Combo → sold as 4 sandwiches*; a sandwich shows its recipe → ingredients → vendors, and its Toast link.
  - Sections in plain words with their own **Edit**: for a bought item, **How it arrives**, **Price**, **Ordering** (par, order days), **Counting**, **Barcodes**.
  - **"What's missing"** to-dos (no price yet, no weight yet), each with a fix-it button — replaces the readiness drawer.
- **Editing:** edit in place; no separate pages; no delete-and-re-add. The **pack editor is always the sentence editor**: "1 [case] holds [6] [bags]; each bag weighs [5 lb]" (first time and every edit; per-piece weight inline).
- **"What this changes"** preview on every save: each knock-on with before → after (cost per oz, cost per sandwich), and a question wherever a person must decide ("Your par is 3 cases (90 lb). With the new case that's 120 lb. Keep 3 cases or change to 2?"). Save **for my shop**; MoO+ also **for everyone** / **Promote**.
- **History tab** with every version, who and when, and **Restore**.
- **Passwords:** one step-up unlocks editing for **15 minutes** on that device; destructive actions (retire a product, delete a recipe) still ask every time.
- **Screens:** phone = one column, the connections strip at the top; tablet/desktop = connections in a side panel. Same functions everywhere; no table wider than the screen (wide tables scroll inside their own container).

## 5. Guided jobs (Section 3)

Each starts from the item page and from wherever the problem first shows up, and ends with the same preview and save choices.

1. **"It arrives differently now"** (pack size) — from the item page and a **"This case looks different"** button at the receiving door. Sentence editor → preview (cost/oz, pars keep-or-convert, recipe lines in the old pack unit, open orders not yet received). A vendor import's "needs a person" opens this job on the exact item.
2. **New item, start to finish** — what it is → vendor (pick, or add one with its order days inline) → name + vendor item number → how it arrives → **price** → par + order days for my shop → order-guide section → optionally where it's used. Barcode: scan now on a phone or learn at first delivery.
3. **Swap vendor** — pick or add the replacement → **"Just for now at my shop"** or **"For good"**. The app groups the two under one product and switches every recipe that used the old SKU in one go (preview shows cost changes). "Just for now" shows **Back to normal**.
4. **New sandwich** — name → price for my shop → recipe (searchable ingredient picker; oz / each / slices; **cost per sandwich updates live**) → Toast link (app suggests the match; confirm, or pick from a searchable list). Toast linking moves out of Catering.
5. **Price changed** — item page → Price → preview of which sandwiches' costs move and by how much; history kept.
- **Problems link to their fix:** the ordering walk's "check this par" opens the item's Ordering section; a blocked cost on the costing board opens the item's "What's missing"; import "needs a person" opens job 1. Deep links always land on the item, never a list.

## 6. Missing pages and notices (Section 4)

- **Pars for my shop:** everything the shop orders with weekday/weekend par in plain units plus weight ("3 cases (90 lb)"), editable in the list; filter by vendor or order-guide section; Dynamic Pars suggestions shown with number + reason + Accept / Dismiss. A second tab: **prep pars** (today inside checklist template settings, `ParGrid`).
- **Sandwiches:** every menu item with its **price for this shop**, sold-here, Toast link status, **cost and margin**; add, rename, change shop price, take off the menu here (never deleted).
- **"Shop changes" list (Cristian, MoO+):** every shop version as it's made — what, where, who — with **Promote** or leave it.
- **GM notices:** "an adopted version changed · take the update?" and "this is the new global default".

## 7. Phases (each ships and is usable on its own)

1. **Quick fixes:** 15-minute edit unlock; recipe lines editable in place; searchable ingredient picker; deep links land on the item; the avg-weight dead end on chained SKUs; delete the dead `SkuPackChainPanel`.
2. **Shop versions for pack + price, and sourcing; the connected item page + change preview** — starting with "It arrives differently now" and "Price changed".
3. **Shop versions for recipes and menu items; adopt / promote / back to default; the Shop changes list.**
4. **Guided jobs:** new item, swap vendor, new sandwich with Toast.
5. **Pars page, Sandwiches page, the permission changes** (AGM floor fixes, GM shop-complete, level walls moved; lib-level location binds).

Each phase: an Opus builder in its own worktree, Astra review to APPROVE, full vitest + CI, a browser check on the sim, migrations sim → prod dry-run with rollback → prod before merge, then guide TEXT updates for the changed screens every phase; photo retakes happen in ONE pass after Phase 5, because the screens change every phase (amended 2026-10-15, Phase 1 plan review).

## 8. Testing

- **Equivalence pins:** no shop versions ⇒ identical numbers to today across costing, depletion, ordering suggestions and on-hand (fixture matrix + a prod-shaped snapshot).
- **Resolver tests:** shop version beats global; retired shop version falls back to global; adopt copies, never links; promote changes only shops on the default.
- **Permission tests:** AGM/GM writes refused for another shop's version and for global; MoO+ allowed; the lib bind holds even when the route is bypassed.
- **Preview tests:** pack change computes cost/oz, par conversion choices, broken recipe-unit lines, open-order effects.
- **UI:** phone / tablet / desktop walks on the sim for each job; en + es.

## 9. Open items (decided later, not blocking phase 1)

- Whether catering packages get shop versions (Keith) — out of scope now.
- Whether prep items (`items`) need shop versions — global for now.
- Price basis (`price_basis`) gets a plain-words field in "Price" in phase 2.
- How a shop version of a pack chain interacts with Dynamic Pars' baseline par (auto values self-invalidate on a global par change today; the shop-version case is pinned in phase 2's plan).
