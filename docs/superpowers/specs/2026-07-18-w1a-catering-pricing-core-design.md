# W1a — Catering Pricing Core (design)

> **Sub-project of the integrated wiring pass (W1).** Decomposition + rationale live in
> the `project_coops_catering_wiring_ideas_backlog` memory. W1a is the un-gated keystone:
> it lights up the dormant self-serve portal with real catering prices. W1b (the slot-based
> package/platter builder) is a separate spec that follows.

**Goal:** Replace the portal's raw `menu_price` pass-through with a live, per-location
**catering price derivation** — subs priced in ¼/½/whole portions and extras priced whole,
all derived from the regular menu price × a category/item catering rate — so à-la-carte
catering ordering works end-to-end with correct, server-authoritative prices.

**Architecture:** A pure, bidirectional derivation engine (`lib/catering/pricing-derivation.ts`)
computes prices on read (never stored); the existing quote **snapshot** freezes them on a
submitted order. Rates live in a new append-only `catering_rate_rules` table resolved
most-specific-wins (item → section → location default → regular). No new pricing store, no
recompute sweeps — a regular-price change flows straight through (which is what "push to Toast
from the regular menu pricing" wants later).

**Tech stack:** Next.js 16 (App Router, `proxy.ts`), React 19, Tailwind v4, TS strict +
`noUncheckedIndexedAccess`, Supabase Postgres (service-role + RLS), integer-cents money model,
basis-points rates (mirrors `catering_pricing_rules`).

---

## 1. Where this fits (context)

Today `loadPublicCateringMenu` (portal) and `loadCateringMenuItems` (staff) both do
`unitPriceCents = dollarsToCents(items.menu_price)` — the **raw regular price, no catering
adjustment**. `submitOrder` enforces strict server-side price authority (D20) off those loaders.
The whole portal is **dormant** because prod has 0 priced catering data. W1a fills the pricing
seam so that, once Juan authors a catering menu + rates, à-la-carte ordering goes live.

**Confirmed model (Juan, 2026-07-18):**
- Core catering unit = a **sub sold in portion sizes**: **¼**, **½** (the standard "sub platter"
  serving), **whole** (à la carte). Portions are a **universal** set across all portionable subs.
- Catering price **derives from the regular whole-sub price**, **proportional × a catering rate**:
  `portionPrice = regular × portionFraction × rate`. The rate is a **% of regular** (a wholesale
  rate that lowers per-head cost), set **per menu section with per-item override**. It can raise
  *or* lower (rate > 100% is a raise).
- **Extras** (chips/drinks/sweets) are `portionable = false` → sold **whole** at
  `regular × rate`.
- **Bidirectional:** the engine both **recommends** a price (forward) and **reverse-computes the
  implied effective rate** from a manually chosen price (used by the per-item override here, and
  by W1b's package pricing).
- **Headcount "tiers"** are **not** a computed discount in v1: the wholesale rate is baked into the
  unit price. A **customer-facing visual** ("bigger headcounts = better per-head value") is a
  presentation concern, out of W1a's pricing scope.

**Deferred to W1b (separate spec):** the package/platter builder (fixed / interchangeable /
locked-customizable sub slots), lunch boxes & combos (they need slot-choice), and the auto-sum
package price = Σ component catering prices. W1a **builds the `sumComponentsCents` primitive**
they'll consume, but ships no package UI.

---

## 2. Data model

All amounts integer cents; all rates basis points (`10000 = 100%`), consistent with
`lib/catering/quotes.ts` and `lib/admin/catering/pricing.ts`.

### 2.1 New table — `catering_rate_rules`
The catering rate is a *distinct* layer from `catering_pricing_rules` (which is the **charge
stack**: tax/gratuity/service/deposit). This table sets **per-item base catering prices**.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `location_id` | uuid FK→locations, NOT NULL | rates are per-location (mirrors charge-stack rules) |
| `scope` | text CHECK in (`location`,`section`,`item`) | grain of the rule |
| `scope_ref` | text NULL | null for `location`; section name for `section`; item_id (as text) for `item` |
| `rate_bps` | int NOT NULL, CHECK 0..30000 | catering price as a fraction of regular. `10000` = same as regular; `8500` = 85% (wholesale); `12000` = +20%. Ceiling 30000 (3×) is a sanity bound. |
| `active` | bool NOT NULL default true | append-only; deactivate never DELETE |
| `created_by`/`updated_by`/`created_at`/`updated_at` | | audit columns, mirror pricing.ts |

- **One active rule per (location_id, scope, scope_ref)** — enforced app-layer query-first
  (matches the `catering_packages` one-active-per-(location,slug) precedent), OR a partial-unique
  index `WHERE active` if a clean expression is available (decide at plan time; app-layer is the
  safe default). `scope_ref` NULL for `location` scope needs a coalesced uniqueness expression if
  going the index route — app-layer avoids that wrinkle.
- **RLS:** `ENABLE ROW LEVEL SECURITY` + deny-all to end users (service-role only), exactly like
  the other catering-KB tables.

### 2.2 New column — `items.portionable boolean NOT NULL DEFAULT false`
Subs = true (offered in ¼/½/whole). Extras = false (whole only). Additive, safe. A partial index
is unnecessary (the catering menu already filters on `catering_available`).

### 2.3 New column — `catering_quote_items.portion text NULL`
Persist the chosen portion on the snapshot line (`quarter`|`half`|`whole`; NULL = whole /
non-portioned) so labels, the coverage guide, the account view, and W1b/reorder all see the
portion. `unit_price_cents` already stores the **derived** price (frozen), so no other money
column changes.

> **Confirm-before-authoring at plan time (live schema):** verify `items` has no existing
> portion-like column; verify `catering_quote_items` column set matches lib/catering/quotes.ts
> `ITEM_COLS`; verify `pg_constraint` on both tables before altering (the Portal-2 dual-FK lesson).

---

## 3. The derivation engine — `lib/catering/pricing-derivation.ts` (pure, unit-tested)

No I/O. Mirrors the rounding convention of `quotes.ts` (`Math.round`, nearest cent).

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

**Rate resolution** (impure — needs the loaded rules; lives in the loader/authoring lib, not the
pure module):
```
resolveRateBps(rules, { itemId, section }): number
  // most specific ACTIVE rule wins: item(scope_ref=itemId) → section(scope_ref=section) → location-default → 10000
```

**Worked examples** — whole sub regular **$12.00** (`1200¢`), section rate **85%** (`8500`):
- whole → `round(1200 × 1 × 8500/10000)` = **$10.20**
- ½ → `round(1200 × 0.5 × 8500/10000)` = **$5.10**
- ¼ → **$2.55**
- Per-item override raise to **110%** → whole **$13.20**.
- Reverse: team types **$45.00** for a package whose recommended (auto-sum) baseline is **$49.00**
  → `impliedRateBps(4500, 4900)` ≈ **9184** → "**91.8% of recommended**, ~8% under." (W1b UX; the
  same call powers a per-item override typed as a price here.)

---

## 4. Wire points

### 4.1 Menu loaders (portal + staff)
Both loaders apply the rate and expose portions. **`loadPublicCateringMenu` gains a `locationId`
param** (currently none — rates are per-location). `CateringMenuItem` grows:
```ts
interface CateringMenuItem {
  id; name; nameEs; section; cateringOnly;         // (unchanged)
  portionable: boolean;                             // NEW
  unitPriceCents: number;                           // = whole catering price (portionable) OR extra catering price
  portionPricesCents?: { quarter: number; half: number; whole: number }; // NEW, present when portionable
  regularPriceCents: number;                        // NEW (for the recommend/implied-rate UI)
  rateBps: number;                                  // NEW (the resolved effective rate)
}
```
- Portionable item with no `menu_price` → **excluded** from the orderable menu (unpriceable),
  never silently `0`.
- The three portion prices double as **servings** for the coverage guide (¼/½/whole = serving
  weights).

### 4.2 `submitOrder` (server price authority, D20)
- `SubmitLineInput` grows a `portion?: Portion` field. Server resolves the derived price for
  `(item, portion)` from the loader map — client price still never read.
- Validation: a `portion` on a `portionable=false` item → `invalid_line`; a portionable item with
  no portion defaults to `whole`.
- Persist `portion` on the `catering_quote_items` insert; `unit_price_cents` = the derived price
  (already snapshotted, unchanged mechanism). Charge stack unchanged.

### 4.3 Staff à-la-carte quote path
No lib signature change required — `createQuote`/`reviseQuote`/`previewQuote` already accept a
caller-supplied `unitPriceCents` (the override contract, D per 0123 "overridable per quote line").
The **staff builder UI** pre-fills the recommended derived price from the updated
`loadCateringMenuItems` (with portions), and shows the implied rate when a staffer overrides.
`QuoteLineInput` grows `portion?: Portion` so staff à-la-carte lines snapshot the portion too —
cheap, and keeps staff quotes portion-aware; **included in W1a**.

### 4.4 Portal build page (`app/order/build/page.tsx`)
Add a **portion selector** (¼/½/whole) per portionable sub in the cart; send `portion` in the
submit payload; the existing coverage guide counts servings by portion. Extras render as-is at
their catering price.

---

## 5. Authoring — `lib/admin/catering/rate-rules.ts` (+ routes + UI)

Models `lib/admin/catering/pricing.ts` exactly:
- Service-role; app-layer authz at the route (`requireSession → level floor → assertStepUp`) AND
  re-checked per-action in the lib.
- **Financial floor: level 8 (MoO+)** — matches the charge-stack pricing rule. `PRICING_ALL_LOCATIONS_MIN = 9`.
- bps validated/recomputed server-side (`0..30000`); never trust client bps.
- Append-only: deactivate, never DELETE. One active rule per (location, scope, scope_ref).
- Exports: `loadRateRules(actor, locationId)` (location default + section defaults + item
  overrides, hydrated with the **recommended vs. implied** figures), `upsertRateRule`,
  `deactivateRateRule`.
- Audit actions in the existing namespace: `catering.kb.rate.create` / `.update` / `.deactivate`.

**UI:** a page under the catering admin surface — a location's default rate, a row per section, and
searchable per-item overrides. Each override input accepts **either a % or a target price**; the
system fills in the other (forward `cateringUnitPriceCents` / reverse `impliedRateBps`), showing
"recommended $X (rate%)" alongside.

---

## 6. Error handling & edge cases

- **Unpriceable item** (`menu_price` null/≤0) → excluded from the orderable catering menu +
  flagged in the admin surface; never sold at `$0`.
- **No matching rule** → `10000` (regular price), never a crash.
- **Portion on a non-portionable item** → `invalid_line` (server) / not offered (UI).
- **rate_bps out of bounds** → `invalid_rate` (server recompute + revalidate).
- **Price authority** → client-supplied price ignored end-to-end (unchanged D20 guarantee); the
  derived price is recomputed server-side at submit.
- **Rounding** → nearest cent (`Math.round`), consistent with `lineTotalCents`/`bpsOf`.
- **Filter-injection parity** → any new `locationId` reaching a `.or()` string keeps the UUID guard
  (`assertLocationId`) already used in `lib/portal/menu.ts`.

---

## 7. Testing

- **Unit (pure engine):** portion math (¼/½/whole), forward/reverse round-trip, raise vs.
  discount, rounding at boundaries, `impliedRateBps` baseline-0 → null, `sumComponentsCents`.
- **Unit (resolver):** most-specific-wins (item > section > location > default), inactive rules
  ignored, missing rule → 10000.
- **Seeded dormant smoke** (the proven pattern — prod has 0 data): seed a location + a portionable
  sub (`menu_price`) + a section rate + an item override → assert `loadPublicCateringMenu(locationId)`
  returns correct ¼/½/whole + extra prices; assert `submitOrder` recomputes the derived price,
  persists `portion`, and rejects a spoofed client price. Roll back after.

---

## 8. Scope boundary & decisions

**In W1a:** derivation engine (+ reverse + auto-sum primitive), `catering_rate_rules` +
`items.portionable` + `catering_quote_items.portion`, menu-loader rate application + portions,
`submitOrder` portion handling, staff recommendation feed, portal build-page portion picker, rate
authoring surface, tests.

**Deferred to W1b:** slot-based package/platter builder (fixed / interchangeable / locked-
customizable), lunch boxes & combos, package price = auto-sum with team override + implied-rate.

**Locked decisions:** per-category + item override (Q1); percentage of regular (Q2); per-unit
à-la-carte in ¼/½/whole (Q3); no computed headcount tiers in v1, visual only (Q4); proportional ×
rate (portion formula); derived combos auto-summed; derive-on-read + snapshot-on-order;
bidirectional engine; nearest-cent rounding; level-8 rate floor; `items.portionable`.

**Natural build phasing** (for writing-plans to sequence): (1) migration + pure engine + resolver
+ unit tests; (2) menu-loader + `submitOrder` wiring + seeded smoke; (3) rate authoring lib +
routes + UI; (4) portal build-page portion picker + staff builder recommendation.

---

## 9. Confirm-before-authoring checklist (run at plan/authoring time, against live schema)

- `items` columns + no existing portion column; `pg_constraint` before ALTER.
- `catering_quote_items` columns match `ITEM_COLS`; `pg_constraint` before ALTER.
- Live migration tip (0127 last seen) — next number at author time.
- `catering_pricing_rules` pattern (one-active partial index vs app-layer) to mirror the uniqueness
  approach.
- `audit_log.resource_id` is uuid — use it for the rule row id; non-uuid context → metadata (the
  Portal-2 lesson).
