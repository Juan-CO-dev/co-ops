# W1b — Catering Package Builder (design)

> Sub-project of the integrated-wiring pass (backlog: `project_coops_catering_wiring_ideas_backlog`),
> following **W1a** (catering price-derivation core) + **3a** (order-artifact lifecycle). Evolves the
> existing catering-package KB into a real **builder**: spine-linked line items, a per-line
> locked/interchangeable **choice-slot** model, and W1a-derived price advice (recommend +
> reverse-compute). **W1b-core (this spec)** = the admin authoring surface; customer-order
> consumption of choice slots + the staff-quote-builder reskin are deferred fast-follows.

**Goal:** Let the catering team compose a package from REAL catering menu items, mark each line as a
locked FIXED item or an interchangeable CHOICE SLOT (pick N from a designated eligible group), and see
a recommended catering price (derived from the constituents' W1a catering prices) with the implied
bundle-discount reverse-computed from the team's flat price — the team's price stays authoritative.

**Architecture:** EVOLVE the existing `catering_packages` + `catering_package_items` KB (full CRUD,
level-6+, Tier A/B step-up, append-only — `lib/admin/catering/packages.ts`), do NOT rebuild. Add (a)
spine-linking (fixed lines pick a real `menu_item_id`/`item_id`), (b) the choice-slot model (one
migration: `slot_type` + a new `catering_package_slot_options` table), (c) price advice via
`lib/catering/pricing-derivation.ts`. DORMANT until the wiring pass authors menu data (the builder
works against the real catering menu, ~empty in prod today — same posture as W1a/3a).

**Tech stack:** Next.js 16 (App Router, `proxy.ts`, route `params` is a Promise), React 19, Tailwind
v4, TS strict + `noUncheckedIndexedAccess`, Supabase (service-role + RLS), integer-cents money, bps
rates. Builds on W1a's `pricing-derivation.ts` (`cateringUnitPriceCents`, `resolveRateBps`,
`RateRule`) + `catering_rate_rules` + `loadCateringMenuItems`. Tests = `tsx` seeded smoke.

---

## 1. Context (what exists)

- **`catering_packages`** — `location_id` (nullable FK → locations; null = GLOBAL, set = per-location),
  `slug` (system key), `label_en/es` + `description_en/es`, `pricing_mode` (`per_head|per_platter|fixed`
  CHECK), `price_cents` (int ≥ 0, team-set), `min_headcount`, `lead_time_hours`, `active`,
  `display_order`, audit. One-active-per-(location, slug) enforced app-layer (query-first).
- **`catering_package_items`** — `package_id` FK, `item_id`|`menu_item_id` (CHECK `one_ref` = mutually
  exclusive, both-null allowed), `description`, `quantity` (CHECK > 0), `display_order`, `active`,
  `created_by`. **Currently FREEFORM** (item_id/menu_item_id left NULL — the menu was empty when built;
  the lib header explicitly says "spine-linking lands when the menu is authored" → that is now).
- **Lib** `lib/admin/catering/packages.ts`: `loadPackages` / `loadPackageLocations` / `createPackage`
  (Tier B) / `updatePackage` (Tier A) / `deactivatePackage` (Tier B) / `addPackageLineItem` (freeform,
  Tier A) / `removePackageLineItem` (append-only). Admin page `app/admin/catering/packages/page.tsx` +
  routes `app/api/admin/catering/packages/{route,[id]}`. **0 packages / 0 items in prod (dormant).**
- **W1a substrate (reused):** `lib/catering/pricing-derivation.ts` (Portion, `PORTION_FRACTION`,
  `cateringUnitPriceCents(regularCents, portion, rateBps)`, `resolveRateBps(rules, {kind, entityId,
  section})`, `RateRule`, `DEFAULT_RATE_BPS=10000`), `lib/catering/rate-rules.ts loadActiveRateRules`,
  `lib/catering/menu.ts loadCateringMenuItems` + `buildCateringMenuItem` (subs=`menu_items`,
  extras=`items`, priced per location). The **rate-authoring admin** (`app/admin/catering/rate-rules/*`)
  is the bidirectional %/target-price UI pattern to mirror.

## 2. Data model (one migration — 0136)

**Extend `catering_package_items`:**
- `slot_type text NOT NULL DEFAULT 'fixed' CHECK (slot_type IN ('fixed','choice'))`.
  - **fixed** — a locked constituent. Spine-links exactly one of `menu_item_id`/`item_id` (the existing
    `one_ref` CHECK holds; a both-null freeform fixed line stays DB-valid transitionally). The customer
    can customize this item (hold ingredients / allergen flags) but NOT swap it. `quantity` = how many.
  - **choice** — an interchangeable slot. Both FKs NULL; `description` = the slot label (e.g. "Choose
    your sub"); `quantity` = **N**, how many the customer picks from the eligible group ↓.
  - (No new CHECK needed: `one_ref` + `quantity > 0` already cover both types; a choice line's both-null
    is allowed, and its `description` carries the label.)

**New `catering_package_slot_options`** (the eligible set for a choice slot; append-only):
```sql
CREATE TABLE public.catering_package_slot_options (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_item_id   uuid NOT NULL REFERENCES public.catering_package_items(id),
  item_id           uuid REFERENCES public.items(id),
  menu_item_id      uuid REFERENCES public.menu_items(id),
  display_order     integer NOT NULL DEFAULT 0,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.users(id),
  -- An eligible option is ALWAYS a concrete item (stricter than the line CHECK): exactly one FK set.
  CONSTRAINT catering_package_slot_options_one_ref CHECK ((item_id IS NULL) <> (menu_item_id IS NULL))
);
CREATE INDEX catering_package_slot_options_package_item ON public.catering_package_slot_options (package_item_id) WHERE active;
ALTER TABLE public.catering_package_slot_options ENABLE ROW LEVEL SECURITY;
-- Deny-all to end users; service-role only (the lib is the authority), like the other catering-KB tables.
```

## 3. The builder — lib surface (`lib/admin/catering/packages.ts`, extended)

Level-6+ (`PACKAGE_WRITE_MIN`), Tier A for line/slot edits (mirrors the existing line-item ops),
append-only, audited. New/changed exports:
- **`PackageLineItemView`** grows: `slotType: 'fixed'|'choice'`, and for choice lines a resolved
  `options: SlotOptionView[]` (each `{ id, kind:'item'|'menu_item', refId, name }`). `hydratePackages`
  batch-loads the slot options + resolves option/fixed names from `items`/`menu_items`.
- **`addPackageLine(actor, { packageId, slotType, ref?, description, quantity })`** — supersedes the
  freeform `addPackageLineItem`: a `fixed` line requires a `ref` (`{kind, id}` → a real catering-available
  `menu_item_id`/`item_id`, validated as catering-available) OR a freeform description; a `choice` line
  requires a `description` (slot label) + `quantity` (N), both FKs null. (Keep `addPackageLineItem` as a
  thin wrapper or refactor callers — decide at plan time.)
- **`addSlotOption(actor, { lineItemId, ref })`** — add an eligible option (a catering-available
  `menu_item_id`/`item_id`) to a `choice` line; rejects if the line isn't `choice`.
- **`removeSlotOption(actor, { optionId })`** — append-only (`active=false`).
- **`removePackageLineItem`** (existing) — also cascades the line's slot options to `active=false`.
- **Picker:** `loadPackagePickerMenu(actor)` — the catering-available items (`catering_available=true`)
  from `items` ∪ `menu_items` (id, kind, name, section, regular menu_price) for the fixed-line + slot-option
  pickers. **Location-agnostic** (the item SET is global; only the RATE is per-location — §4). Level-6+.

## 4. Price advice (advisory; team price authoritative)

The team's flat `price_cents` (per the `pricing_mode`) stays the AUTHORITATIVE package price. The
builder computes an advisory recommendation via W1a derivation:
- **`recommendPackagePrice(actor, { packageId, locationId })` → `{ alaCarteCents, priceCents,
  impliedDiscountBps, hasBasis }`.** Loads the package's lines + the location's active rate rules
  (`loadActiveRateRules(locationId)`), then:
  - **à-la-carte value** `alaCarteCents` = Σ over active lines of:
    - **fixed** line: `cateringUnitPriceCents(regularCents, 'whole', resolveRateBps(...)) × quantity`.
    - **choice** line: `avg( cateringUnitPriceCents(option) for each active eligible option ) × quantity`
      — the "typical" à-la-carte value of the slot (advisory; averaging the eligible options).
    - a freeform line (no ref, no options) contributes 0 (can't be priced) — flagged in the response.
  - **impliedDiscountBps** = `round((1 − price_cents / alaCarteCents) × 10000)` (0 if `alaCarteCents ≤ 0`);
    e.g. a $60 package vs a $70.50 à-la-carte value → 1489 bps ≈ 15% off. Positive = a discount; negative
    = priced above à-la-carte (surfaced as a warning, not an error — the team may intend a premium).
- **Location basis:** use the package's `location_id` when set; for a GLOBAL package (null), the caller
  passes a **preview `locationId`** (a staff-chosen location whose rates seed the recommendation). This
  is advisory-only and also seeds the future staff-quote per-location re-derivation (the W1a T4 follow-up).
- **UI (mirrors `rate-rules-client`):** as the team edits the fixed flat `price_cents`, show the
  recommended à-la-carte value + the implied discount % live; a "use recommended" affordance can set
  `price_cents` to `alaCarteCents`. `per_head`/`per_platter` nuance is a display note (the recommendation
  compares one package's constituent value to the flat price; head/platter scaling is out of the advisory
  math for v1).

## 5. The builder — routes + admin UI

- **Routes** `app/api/admin/catering/packages/*`: extend the line-item POST/DELETE for `slot_type` +
  `ref` + a slot-option add/remove endpoint; add a `recommend` GET (packageId + preview locationId →
  the advice payload). requireSession → `PACKAGE_WRITE_MIN` → `assertStepUp` (Tier A for line/slot edits,
  matching the existing pattern; Tier B stays for create/deactivate).
- **UI** `app/admin/catering/packages/page.tsx` + a client: the package list (existing) + the builder —
  per line, **Add fixed item** (pick from `loadPackagePickerMenu`) or **Add choice slot** (label + N +
  add eligible options from the picker); a locked/interchangeable badge per line; the price-advice panel
  (recommended value + implied discount, live vs the flat price, with a preview-location selector for
  global packages). Reorder/remove append-only. EN/ES i18n (`catering.package.*`), mirroring the
  rate-rules UI.

## 6. Scope & decisions

**In W1b-core:** the migration (slot_type + slot-options table), the builder lib (fixed spine-link +
choice slots + options + picker + `recommendPackagePrice`), the routes + admin UI, EN/ES i18n, a seeded
smoke.

**Deferred fast-follows:** **customer-order consumption** of choice slots (portal — extends 3a's
`/order/build` so a customer picks the sub in a slot; the package line resolves to the picked item at
order time); the **staff-quote-builder reskin** (the W1a T4 deviation — the staff quote page re-derives
price per the quote's selected location, consuming packages). `per_head`/`per_platter` scaling in the
recommendation math. Both build ON W1b-core's model.

**Locked decisions (Juan, 2026-07-19):** admin builder only this slice; per-line FIXED item vs CHOICE
SLOT with a designated eligible group; team sets the flat package price, system recommends (à-la-carte
derived) + reverse-computes the implied bundle discount, advisory only (interchangeable picks don't
change the flat price); a locked FIXED item = customize-not-swap.

## 7. Error handling & edges

- A `choice` line with 0 active options → priced as 0 in the recommendation + flagged (`hasBasis=false`
  contribution); the builder warns "add eligible options."
- A fixed `ref` that isn't catering-available → `invalid_ref` (the picker only offers catering-available
  items, but the lib re-validates).
- Global package + no preview location chosen → the recommendation returns `hasBasis=false` (show
  "pick a location to preview pricing"), never a crash.
- Dormant data: with 0 catering-available items the picker is empty + the recommendation is 0 — the
  builder is correct + smoke-proven, DORMANT until data (same as W1a/3a).
- `impliedDiscountBps` negative (price above à-la-carte) → a warning tone, not an error.
- Append-only throughout: lines + slot options deactivate, never DELETE; removing a choice line cascades
  its options to `active=false`.

## 8. Testing

Seeded smoke (`scripts/w1b-smoke.ts`) against a seeded catering menu + rate rule: create a package →
add a **fixed** spine-linked line (a catering menu_item) + a **choice** slot (label + N=1) with 2
eligible options → assert `loadPackages` hydrates `slotType` + resolved option names → assert
`recommendPackagePrice` math (fixed price × qty + avg(options) × N; the implied discount vs a set flat
price) → append-only remove the slot option + the line (assert cascade) → roll back every seeded row
(zero residue), mirroring `scripts/w1a-smoke.ts`.

## 9. Confirm-before-authoring checklist (run at plan/authoring time, live DB `bgcvurheqzylyfehqgzh`)

- `catering_package_items` columns + CHECKs (`one_ref`, `quantity`) before adding `slot_type` +
  `pg_constraint`; next migration number (0135 is the current tip after the security pass → **0136**).
- `catering_packages` pricing_mode CHECK + price_cents shape (for the recommend comparison).
- `lib/catering/menu.ts` `CateringMenuItem` shape + `buildCateringMenuItem` + `loadActiveRateRules` +
  `pricing-derivation` exact exports (reuse, don't re-derive).
- The existing `packages.ts` line-item ops + the routes' step-up tiers (mirror them for the new ops).
- The `rate-rules-client` bidirectional %/target UI pattern (mirror for the price-advice panel).
