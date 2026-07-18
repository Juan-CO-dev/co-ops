# W1a — Catering Pricing Core (design)

> **Sub-project of the integrated wiring pass (W1).** Decomposition + rationale live in
> the `project_coops_catering_wiring_ideas_backlog` memory. W1a is the un-gated keystone:
> it lights up the dormant self-serve portal with real catering prices. W1b (the slot-based
> package/platter builder) is a separate spec that follows.
>
> **Revised 2026-07-18** after a live-schema confirm-before-authoring pass — see §0.

**Goal:** Replace the portal's raw `menu_price` pass-through with a live, per-location
**catering price derivation** — subs (`menu_items`) priced in ¼/½/whole portions and extras
(`items`) priced whole, all derived from the regular sell price × a category/item catering rate —
so à-la-carte catering ordering works end-to-end with correct, server-authoritative prices.

**Architecture:** A pure, bidirectional derivation engine (`lib/catering/pricing-derivation.ts`)
computes prices on read (never stored); the existing quote **snapshot** freezes them on a
submitted order. Rates live in a new append-only `catering_rate_rules` table resolved
most-specific-wins (entity → section → location default → regular). The catering menu is the
**union** of catering-tagged `items` (extras/sides) and `menu_items` (assembled subs). No new
pricing store, no recompute sweeps — a regular-price change flows straight through.

**Tech stack:** Next.js 16 (App Router, `proxy.ts`), React 19, Tailwind v4, TS strict +
`noUncheckedIndexedAccess`, Supabase Postgres (service-role + RLS), integer-cents money model,
basis-points rates (mirrors `catering_pricing_rules`).

---

## 0. Live-schema findings (confirm-before-authoring, 2026-07-18)

Queried the live co-ops DB (project `bgcvurheqzylyfehqgzh`). What changed vs. the first draft:

- **Subs are `menu_items`, not `items`.** Migration 0105 (recipe-refinement) established the
  regular sale model: `items.sold_directly` + `sell_portion` + `sell_portion_unit` + `menu_price`
  = a **made-in-house item sold directly** (antipasta side, meatballs). `menu_items.menu_price` =
  the **assembled-to-order** sell face (a turkey sub = a consumer recipe). **Juan's call
  (2026-07-18): a constructed sub is ONE `menu_items` entity, catering-*tagged* so the same sub is
  offered for catering at the catering price — no duplicate catering-sub entity.** So portions +
  catering flags belong on **`menu_items`** (subs); `items` stay production/directly-sold sides
  (catering extras, via their existing 0123 flags).
- **`menu_items` shape:** `id, name, name_es, menu_price (numeric, null-or-≥0), toast_ref, active,
  audit`. **No `section`, no catering flags, no portion flag** → all added here. `toast_ref`
  already exists (the future W6 Toast-push target — not W1a's concern, but confirms the model).
- **`items`** already has `catering_available` + `catering_only` (0123) and the `sold_directly`
  set — **no change to `items`** (extras aren't portioned; they price whole × rate).
- **`catering_quote_items`** has `item_id`, `menu_item_id`, `package_id` (CHECK: item XOR
  menu_item; package separate) — so menu_item lines are already valid. **No `portion` column** →
  added here.
- **Next migration = `0128`** (tip is `0127`).
- **One-active pattern confirmed:** `catering_pricing_rules_one_active_per_location ... WHERE
  active`; `catering_packages` uses `COALESCE(location_id,'000…')`. So `catering_rate_rules` uses a
  **partial-unique index** `(location_id, scope, COALESCE(scope_ref,'')) WHERE active` — not
  app-layer.
- **All catering sale data is 0 rows** (menu_items, catering items, priced rows) → the engine
  ships **dormant**, proven by a seeded smoke.

---

## 1. Where this fits (context)

Today `loadPublicCateringMenu` (portal) and `loadCateringMenuItems` (staff) read **`items` only**
(`catering_available`) at the **raw `menu_price`** — no catering adjustment, and **subs
(`menu_items`) aren't in the catering menu at all**. `submitOrder` enforces strict server-side
price authority (D20) off those loaders. The whole portal is **dormant** (0 priced catering data).
W1a fills the pricing seam AND brings subs into the catering menu so that, once Juan authors the
catering menu + rates, à-la-carte ordering goes live.

**Confirmed model (Juan, 2026-07-18):**
- Core catering unit = a **sub sold in portion sizes**: **¼**, **½** (the standard "sub platter"
  serving), **whole**. Portions are a **universal** set across all portionable subs. A sub is one
  **`menu_items`** row, catering-tagged.
- Catering price **derives from the regular sub price** (`menu_items.menu_price`), **proportional ×
  a catering rate**: `portionPrice = regular × portionFraction × rate`. The rate is a **% of
  regular** (a wholesale rate lowering per-head cost), set **per menu section with per-entity
  override**. It can raise *or* lower (rate > 100% is a raise).
- **Extras** (chips/drinks/sweets/directly-sold sides = `items`, catering-available) are **not
  portioned** → sold **whole** at `items.menu_price × rate`.
- **Bidirectional:** the engine both **recommends** a price (forward) and **reverse-computes the
  implied effective rate** from a manually chosen price (per-entity override here; W1b package
  pricing later).
- **Headcount "tiers"** are **not** a computed discount in v1: the wholesale rate is baked into the
  unit price; a customer-facing "bigger headcount = better per-head value" **visual** is a
  presentation concern, out of W1a's pricing scope.

**Deferred to W1b (separate spec):** the package/platter builder (fixed / interchangeable /
locked-customizable sub slots), lunch boxes & combos (need slot-choice), package price = Σ
component catering prices. W1a **builds the `sumComponentsCents` primitive** they'll consume, but
ships no package UI.

---

## 2. Data model

All amounts integer cents; all rates basis points (`10000 = 100%`), consistent with
`lib/catering/quotes.ts` and `lib/admin/catering/pricing.ts`.

### 2.1 `menu_items` — catering tags + portion + section (the subs)
Add (mirrors the `items` 0123 flags so the two registries behave identically):
- `catering_available boolean NOT NULL DEFAULT false`
- `catering_only boolean NOT NULL DEFAULT false` + CHECK `NOT catering_only OR catering_available`
- `catering_portionable boolean NOT NULL DEFAULT false` — subs = true (¼/½/whole)
- `section text NULL` — for catering-menu grouping (menu_items has none today; items do)
- partial index `ON menu_items (catering_available) WHERE catering_available` (mirrors items)

(`name_es`, `menu_price` (null-or-≥0), `active` already exist. `toast_ref` already exists → W6.)

### 2.2 `items` — no change
Already carries `catering_available` / `catering_only` (0123) + `menu_price` + `sold_directly`.
Extras aren't portioned, so **no `catering_portionable` on `items`**.

### 2.3 New table — `catering_rate_rules`
The catering rate is a *distinct* layer from `catering_pricing_rules` (the **charge stack**:
tax/gratuity/service/deposit). This sets **per-entity base catering prices**.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `location_id` | uuid FK→locations, NOT NULL | per-location (mirrors charge-stack rules) |
| `scope` | text CHECK in (`location`,`section`,`item`,`menu_item`) | grain of the rule |
| `scope_ref` | text NULL | null for `location`; section name for `section`; item_id/menu_item_id (as text) for `item`/`menu_item` |
| `rate_bps` | int NOT NULL, CHECK 0..30000 | catering price as a fraction of regular. `10000`=same; `8500`=85% (wholesale); `12000`=+20%. Ceiling 30000 (3×) is a sanity bound (catering rate can exceed 100%, unlike the charge-stack 0..10000). |
| `active` | bool NOT NULL default true | append-only; deactivate never DELETE |
| `created_by`/`updated_by`/`created_at`/`updated_at` | | mirror `catering_pricing_rules` |

- **Partial unique index** `catering_rate_rules_one_active ON (location_id, scope, COALESCE(scope_ref,'')) WHERE active`.
- **RLS:** `ENABLE ROW LEVEL SECURITY` + deny-all to end users (service-role only), like the other catering-KB tables.

### 2.4 `catering_quote_items.portion text NULL`
Persist the chosen portion on the snapshot line (`quarter`|`half`|`whole`; NULL = whole /
non-portioned), CHECK `portion IS NULL OR portion IN ('quarter','half','whole')`. `unit_price_cents`
already stores the **derived** price (frozen). A portioned line references `menu_item_id` (the sub);
`item_id`/`menu_item_id` FKs already exist — only `portion` is new.

---

## 3. The derivation engine — `lib/catering/pricing-derivation.ts` (pure, unit-tested)

Entity-agnostic (takes a regular price + portion + rate — works for a menu_item sub or an item
extra). Mirrors `quotes.ts` rounding (`Math.round`, nearest cent).

```ts
export type Portion = "quarter" | "half" | "whole";
export const PORTION_FRACTION: Record<Portion, number> = { quarter: 0.25, half: 0.5, whole: 1 };

/** Forward: recommended catering unit price. round(regular × fraction × rate/10000). */
export function cateringUnitPriceCents(regularCents: number, portion: Portion, rateBps: number): number;

/** Reverse: implied effective rate from a chosen price vs a baseline (regular×fraction, or a
 *  package's recommended sum). Returns null when baseline ≤ 0 (unpriceable). round(chosen/baseline×10000). */
export function impliedRateBps(chosenCents: number, baselineCents: number): number | null;

/** Auto-sum primitive (combos/packages — W1b consumes this). Σ round(unitCents × qty). */
export function sumComponentsCents(lines: Array<{ unitCents: number; qty: number }>): number;
```

**Rate resolution** (impure — needs loaded rules; lives in the loader/authoring lib, not the pure
module):
```
resolveRateBps(rules, { kind, entityId, section }): number
  // most specific ACTIVE rule wins:
  //   entity (scope='menu_item'|'item', scope_ref=entityId) → section (scope_ref=section) → location default → 10000
```

**Worked examples** — whole sub regular **$12.00** (`1200¢`), section rate **85%** (`8500`):
- whole → **$10.20**, ½ → **$5.10**, ¼ → **$2.55**. Per-entity override to **110%** → whole **$13.20**.
- Reverse: team types **$45.00** vs a **$49.00** baseline → `impliedRateBps(4500,4900)` ≈ **9184**
  → "**91.8% of recommended**." (W1b UX; same call powers a per-entity override typed as a price.)

---

## 4. Wire points

### 4.1 Menu loaders (portal + staff) — union items + menu_items
Both loaders apply the rate and expose portions, and now read **both registries**.
**`loadPublicCateringMenu` gains a `locationId` param** (rates are per-location). `CateringMenuItem`
grows a discriminator + portion/derivation fields:
```ts
interface CateringMenuItem {
  kind: "item" | "menu_item";                       // NEW — which registry / which FK to set on a line
  id: string;                                        // the entity id (item_id OR menu_item_id)
  name; nameEs; section; cateringOnly;               // (section now present on both registries)
  portionable: boolean;                              // NEW — true for portionable subs
  unitPriceCents: number;                            // whole catering price (portionable) OR extra catering price
  portionPricesCents?: { quarter; half; whole };     // NEW — present when portionable
  regularPriceCents: number;                         // NEW — for recommend/implied-rate UI
  rateBps: number;                                    // NEW — resolved effective rate
}
```
- Subs = `menu_items` with `catering_available` (+ `catering_portionable`) → ¼/½/whole.
- Extras = `items` with `catering_available` (existing) → whole × rate.
- An entity with no/`≤0` regular price → **excluded** (unpriceable), never silently `0`.
- Portion prices double as **servings** for the coverage guide.

### 4.2 `submitOrder` (server price authority, D20)
- `SubmitLineInput` grows `menuItemId?: string` + `portion?: Portion` (already has `itemId?`,
  `packageId?`). Server resolves the derived price for `(kind, id, portion)` from the unified loader
  map — client price still never read.
- Validation: a `portion` on a non-portionable entity → `invalid_line`; a portionable sub with no
  portion defaults to `whole`.
- Persist the correct FK (`item_id` for extras, `menu_item_id` for subs) + `portion`;
  `unit_price_cents` = the derived price (snapshot mechanism unchanged). Charge stack unchanged.

### 4.3 Staff à-la-carte quote path
No lib money-math change — `createQuote`/`reviseQuote`/`previewQuote` already accept a
caller-supplied `unitPriceCents` (the override contract). The **staff builder UI** pre-fills the
recommended derived price from the updated `loadCateringMenuItems` (union + portions) and shows the
implied rate on override. `QuoteLineInput` grows `portion?: Portion` so staff lines snapshot the
portion too — **included in W1a**.

### 4.4 Portal build page (`app/order/build/page.tsx`)
Add a **portion selector** (¼/½/whole) per sub in the cart; send `menuItemId` + `portion` in the
submit payload; the coverage guide counts servings by portion. Extras render whole at their catering
price.

---

## 5. Authoring — `lib/admin/catering/rate-rules.ts` (+ routes + UI)

Models `lib/admin/catering/pricing.ts` exactly:
- Service-role; app-layer authz at the route (`requireSession → level floor → assertStepUp`) AND
  re-checked per-action in the lib. **Financial floor: level 8 (MoO+)**; all-locations at 9.
- bps validated/recomputed server-side (`0..30000`); never trust client bps.
- Append-only: deactivate, never DELETE. One active rule per (location, scope, scope_ref) via the
  partial index.
- Exports: `loadRateRules(actor, locationId)` (location default + section defaults + per-entity
  overrides, hydrated with **recommended vs. implied** figures), `upsertRateRule`,
  `deactivateRateRule`.
- Audit actions: `catering.kb.rate.create` / `.update` / `.deactivate`.

**UI:** a page under the catering admin surface — a location's default rate, a row per section, and
searchable per-entity overrides (subs *and* extras). Each override accepts **either a % or a target
price**; the system fills in the other (forward `cateringUnitPriceCents` / reverse `impliedRateBps`),
showing "recommended $X (rate%)".

---

## 6. Error handling & edge cases

- **Unpriceable entity** (`menu_price` null/≤0) → excluded from the orderable menu + flagged in the
  admin surface; never sold at `$0`.
- **No matching rule** → `10000` (regular price), never a crash.
- **Portion on a non-portionable entity** → `invalid_line` (server) / not offered (UI).
- **rate_bps out of bounds** → `invalid_rate` (server recompute + revalidate).
- **Price authority** → client price ignored end-to-end; derived price recomputed server-side.
- **Rounding** → nearest cent (`Math.round`), consistent with `lineTotalCents`/`bpsOf`.
- **Filter-injection parity** → any new `locationId` reaching a `.or()` string keeps the existing
  UUID guard.

---

## 7. Testing

- **Unit (pure engine):** portion math (¼/½/whole), forward/reverse round-trip, raise vs. discount,
  rounding at boundaries, `impliedRateBps` baseline-0 → null, `sumComponentsCents`.
- **Unit (resolver):** most-specific-wins (entity > section > location > default), inactive rules
  ignored, missing rule → 10000, item vs menu_item scoping.
- **Seeded dormant smoke** (prod has 0 data): seed a location + a **portionable `menu_item` sub** +
  a catering-available `item` extra + a section rate + a per-entity override → assert
  `loadPublicCateringMenu(locationId)` returns correct ¼/½/whole (sub) + whole (extra) prices;
  assert `submitOrder` recomputes, persists the right FK + `portion`, rejects a spoofed price. Roll
  back after.

---

## 8. Scope boundary & decisions

**In W1a:** derivation engine (+ reverse + auto-sum primitive), `menu_items` catering flags +
`catering_portionable` + `section`, `catering_rate_rules`, `catering_quote_items.portion`, union
menu-loader rate application + portions, `submitOrder` portion/menu_item handling, staff
recommendation feed, portal build-page portion picker, rate authoring surface, tests.

**Deferred to W1b:** slot-based package/platter builder (fixed / interchangeable / locked-
customizable), lunch boxes & combos, package price = auto-sum with team override + implied-rate.

**Locked decisions:** per-category + per-entity override (Q1); percentage of regular (Q2); per-unit
à-la-carte ¼/½/whole (Q3); no computed headcount tiers in v1, visual only (Q4); proportional × rate;
derived combos auto-summed; derive-on-read + snapshot-on-order; bidirectional engine; nearest-cent
rounding; level-8 rate floor. **Subs = one `menu_items` entity, catering-tagged, derive from
`menu_items.menu_price`; extras = `items`; loaders union both (Juan, 2026-07-18).**

**Natural build phasing** (for the plan to sequence): (1) migration 0128 + pure engine + resolver +
unit tests; (2) union menu-loader + `submitOrder` wiring + seeded smoke; (3) rate authoring lib +
routes + UI; (4) portal build-page portion picker + staff builder recommendation.

---

## 9. Confirm-before-authoring — DONE (2026-07-18, live DB `bgcvurheqzylyfehqgzh`)

- ✅ `items` / `catering_quote_items` / `menu_items` / `catering_pricing_rules` columns + constraints
  verified (§0).
- ✅ Next migration `0128`.
- ✅ One-active partial-index pattern → `catering_rate_rules` uses it.
- ✅ Subs live in `menu_items` (not `items`) → model corrected; `menu_items` gets the catering tags +
  portion + section.
- ✅ `menu_items.toast_ref` already present (W6 target; out of W1a scope).
- ✅ All catering sale tables empty → ships dormant, proven by the seeded smoke.
