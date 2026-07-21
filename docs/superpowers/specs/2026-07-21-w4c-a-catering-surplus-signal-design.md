# W4c-a — Catering Surplus Signal (design)

**Date:** 2026-07-21
**Status:** approved (Juan), ready for implementation plan
**Part of:** the catering↔inventory reserve/deplete moat. W4a = prep-demand reserve (confirmed→ledger); W4b = prep→SKU flatten + on-hand shortfall. **W4c = the cancellation flip-side (surplus).** W4c is split into **W4c-a (this spec) = the surplus SIGNAL** and **W4c-b (deferred, own design) = the LTO/discount ACTION engine.**
**Backlog ref:** field-note ④ (over-prep redistribution). See `project_coops_catering_wiring_ideas_backlog.md`.

---

## Goal

When a confirmed catering order is cancelled, its released prep/SKU reservations become **surplus**. W4c-a detects that surplus, **classifies it by the 72h prep-start window** (cancelled before the window → raw SKU surplus; cancelled inside it → perishable prepped-item surplus), and surfaces it with suggested destinations. The manager *acting* on surplus (creating an LTO or a discount) is **W4c-b** and out of scope here.

W4c-a is **advisory** (consistent with W4a/W4b — the moat has no stored on-hand) and **dormant until catering data lands**.

## Non-goals

- No LTO/discount action, no LTO artifact, no menu/pricing/storefront write. That is W4c-b (its own design; overlaps Module #17 LTO Performance).
- No re-architecture of the reserve model. The reservation stays prep-grain at `confirmed` (W4a) with SKU derived on read (W4b); W4c-a classifies surplus **on read** by the 72h rule.
- No general **line** over-prep source in v1 (over-prep vs sales). Only the concrete, attributable **catering reservation-release** source. Line over-prep is a real second source but needs a production-vs-need signal — deferred, noted.
- No hard hold / stock decrement (there is no stored on-hand).

---

## Grounding (verified against live code + DB, 2026-07-21)

- **`lib/catering/prep-demand.ts`** (W4a) — the ledger `catering_prep_demand` with statuses `reserved | consumed | released`. `reservePrepDemand` (idempotent release-then-reinsert at `confirmed`), `consumePrepDemand` (→ `consumed`, stamps `consumed_at`), `releasePrepDemand` (reserved→`released` on lost/revert — **does NOT stamp a timestamp today**). `loadCateringPrepDemand` (over-par overlay), `loadLeadPrepDemand`, `resolveRefs`, `PREP_DEMAND_READ_MIN = 6`, `PORTION_FRACTION`.
- **`catering_prep_demand` columns** (migration 0137): `id, pipeline_id, quote_id, location_id, need_date (date), item_id / menu_item_id / choice_package_item_id (3-way XOR), portion, qty (numeric), status, created_at, created_by, consumed_at`. **No `released_at`** — the one column W4c-a must add.
- **`lib/catering/sku-demand.ts`** (W4b) — `loadCateringSkuDemand`, and the flatten primitives `perUnitSkuOzForItem(itemId)` + `perUnitSkuOzForMenuItem(menuItemId)` (portion-scaled prep→SKU), plus `loadInStockPacks` (exported from `lib/production.ts`) for advisory on-hand. W4c-a reuses these to present SKU-grain surplus.
- **`lib/catering/pipeline.ts`** — `moveStage` already hooks stage transitions to the prep-demand lifecycle: `confirmed → reserve`, `out/completed → consume`, `lost/inquiry/quote_sent → release`. **The cancellation trigger already exists** — W4c-a needs no new hook, only the `released_at` stamp inside `releasePrepDemand`.
- **`components/admin/catering/prep-demand/PrepDemandClient.tsx`** — the existing W4a/W4b surface with `[Demand]` and `[Raw/SKU]` tabs on `/admin/catering/prep-demand`. W4c-a adds a `[Surplus]` tab.
- **`app/lto/page.tsx`** — a `PlaceholderCard` for Module #17 (LTO *performance* tracking: sales / food-cost / rating). NOT a surplus destination. W4c-a surfaces the prep-surplus signal here as the W4c-b teaser; the Module #17 "coming" note stays.
- **`app/admin/catering/page.tsx`** — the catering admin hub (editor cards). W4c-a can add a light surplus count.
- **Production** (`lib/production.ts`) — `productions` records physical make at location+item+date+qty, with **no catering-lead link**. This is why "was this order's prep made?" can't be answered precisely — W4c-a uses the reservation-release + 72h rule as the advisory inference instead.

---

## Mechanism (Juan-locked)

A catering reservation is **time-phased in the operational model**: far out it is effectively a raw-**SKU** commitment; **~2–3 days (72h) before the event** prep actually starts, so within that window it is a **prepped-item** commitment. The code does not model this phasing in the ledger (it reserves prep-grain from `confirmed`), so W4c-a applies it **as a read-time classification of released surplus**:

- **`daysOut = need_date − released_at` (calendar days).**
- **`daysOut ≥ PREP_START_LEAD_DAYS` (3):** the order was cancelled **before** prep would have started → the freed commitment is **raw SKUs** (nothing was prepped; you may have ordered/planned SKUs). Surplus presented **SKU-grain** (flatten via W4b). Destination hint: *"adjust ordering / use in normal ops."*
- **`daysOut < PREP_START_LEAD_DAYS`:** cancelled **inside** the prep window → prep was (or was about to be) physically made → **perishable prepped-item surplus**. Surplus presented **prep-grain** (item / menu_item). Destination hint: *"perishable — route to LTO / discount / staff meal soon."*

`PREP_START_LEAD_DAYS = 3` is a named constant (matches "2–3 days before"). Advisory throughout; the classification is a heuristic, not a measured production fact.

---

## Architecture

Four pieces: a tiny schema stamp, a one-line lifecycle change, a read library, and read surfaces.

### Component 1 — Migration 0140 (`catering_prep_demand.released_at`)

```sql
ALTER TABLE public.catering_prep_demand
  ADD COLUMN released_at timestamptz;
```

- Nullable; stamped when a reservation releases. No RLS change (ledger policies are column-agnostic; writes are service-role). No backfill needed (0 released rows in prod; dormant).

### Component 2 — `releasePrepDemand` stamps `released_at`

In `lib/catering/prep-demand.ts`, the `reserved → released` update also sets `released_at: new Date().toISOString()` (symmetric to how `consumePrepDemand` sets `consumed_at`). This is the **only** change to W4a/W4b behavior. `reservePrepDemand`'s idempotent "retire prior reserved rows" release also stamps `released_at` — those are re-confirm churn, not cancellations, and are correctly excluded from surplus by the source filter below (they have a fresh reserved row superseding them; W4c-a reads only the *latest* disposition per lead — see Component 3).

### Component 3 — Surplus read: `lib/catering/surplus.ts` (server-only, service-role)

```ts
export const PREP_START_LEAD_DAYS = 3;         // ~72h prep-start window
export const SURPLUS_READ_MIN = 6;             // catering_mgr+ (mirrors PREP_DEMAND_READ_MIN)

export type SurplusKind = "raw_sku" | "prep";

export interface SurplusLine {
  kind: SurplusKind;                 // raw_sku (cancelled before prep window) | prep (inside window)
  refKind: "item" | "menu_item" | "choice" | "sku";
  refId: string;
  name: string;
  portion: Portion | null;           // for prep-grain lines
  qty: number;                       // surplus quantity (prep units, or SKU packs for raw_sku)
  needDate: string;
  daysOut: number;                   // need_date − released_at, in days
  pipelineId: string;                // the cancelled lead it came from
  destinationHint: string;           // i18n key: adjust-ordering (raw_sku) | perishable-lto (prep)
}
export interface SurplusDay { needDate: string; lines: SurplusLine[] }

/** Recent catering surplus for a location: released reservations classified by the 72h rule. */
export async function loadCateringSurplus(
  actor: AuthContext,
  args: { locationId: string; from: string; to: string },
): Promise<SurplusDay[]>;

/** Prep-grain (perishable) surplus only — the LTO page's W4c-b teaser feed. */
export async function loadPerishableSurplus(
  actor: AuthContext,
  args: { locationId: string; from: string; to: string },
): Promise<SurplusLine[]>;
```

**`loadCateringSurplus` algorithm:**
1. Read `catering_prep_demand` where `status='released'` AND `released_at` is non-null AND `need_date` in `[from,to]`, for the location.
2. **Exclude re-confirm churn:** a lead that is currently reserved again (has any `status='reserved'` row) is not a cancellation — its released rows are stale idempotency retirements. Filter out released rows whose `pipeline_id` currently has reserved rows. (Cheap: one query for the set of pipeline_ids with reserved rows in-window; subtract.)
3. For each surviving released row, `daysOut = floor((need_date − released_at) / 1 day)`.
4. **Classify:**
   - `daysOut ≥ PREP_START_LEAD_DAYS` → **raw_sku**: flatten the ref to SKUs via W4b (`perUnitSkuOzForItem` for item refs, `perUnitSkuOzForMenuItem` for menu_item refs; choice slots stay unresolved/skipped for SKU flatten), producing SKU-pack quantities. `destinationHint = "catering.surplus.hint.adjust_ordering"`.
   - `daysOut < PREP_START_LEAD_DAYS` → **prep**: keep item/menu_item/choice grain (reuse `resolveRefs` naming from prep-demand.ts). `destinationHint = "catering.surplus.hint.perishable"`.
5. Group by `need_date` then ref; sort dates asc, lines by name. Return.

**`loadPerishableSurplus`** = `loadCateringSurplus` filtered to `kind === "prep"`, flattened to a single list (the LTO page's feed).

Reuse (do not duplicate): `resolveRefs` + `PORTION_FRACTION` from prep-demand.ts (export `resolveRefs` if needed), the W4b flatten primitives, `loadInStockPacks` for optional on-hand context. Keep `surplus.ts` focused on classification + grouping.

### Component 4 — Surfaces

- **`[Surplus]` tab** on `components/admin/catering/prep-demand/PrepDemandClient.tsx` (third tab after Demand / Raw-SKU). Server wrapper (`app/admin/catering/prep-demand/page.tsx`) loads `loadCateringSurplus` for the selected location + date window and passes it in. The tab lists surplus grouped by date, visually split **raw-SKU surplus** vs **perishable prep surplus**, each line showing name / qty / `daysOut` / destination hint. Perishable lines get a visual "act soon" emphasis.
- **LTO page** (`app/lto/page.tsx`) — becomes a real read: a "Surplus available to promote" section fed by `loadPerishableSurplus` (across the actor's locations), teeing up W4c-b. The existing Module #17 "coming" description stays as a secondary "Performance tracking — coming" note. Gate: `SURPLUS_READ_MIN` (≥6). Needs a location scope — use the actor's locations (level ≥7 = all; else their `user_locations`), mirroring existing admin loaders.
- **Catering hub badge** (`app/admin/catering/page.tsx`) — a light count of current perishable-surplus lines (or "N surplus" chip) next to the prep-demand card. Minimal; v1.

### Data flow

`moveStage(confirmed→lost)` → `releasePrepDemand` (now stamps `released_at`) → rows sit `status='released'` with a timestamp → `loadCateringSurplus` reads + classifies on demand → Surplus tab / LTO page / hub badge render advisory surplus. No writes from the read path.

---

## Error handling & edge cases

- **Released row with null `released_at`** (legacy/pre-0140) — excluded from surplus (can't classify without the stamp). None exist in prod today.
- **Re-confirm churn** — released rows for a lead that is currently reserved again are excluded (Component 3 step 2), so a resync doesn't masquerade as a cancellation.
- **Choice-slot refs** — unresolved choice slots can't flatten to SKUs; in the raw_sku branch they are skipped (logged in the line as needsPick-style, or simply omitted from SKU flatten) and always shown at prep grain if `daysOut < 3`. Keep behavior explicit, not silent.
- **`released_at` after `need_date`** (cancelled after the event date somehow) — `daysOut` negative → `< PREP_START_LEAD_DAYS` → classified prep (perishable). Correct-enough (a very late cancel is prep surplus).
- **No surplus in window** — tab + LTO section render an empty state; hub badge hidden.
- **Silent-at-scale:** surplus reads are location + date-window scoped and small; if any loader could exceed 1000 rows as data grows, use the `selectAllRows` pagination helper (as W4b/production do). Note in the plan.

## Testing

- **`scripts/w4c-a-surplus-smoke.ts`** (Fable): seed a confirmed lead + reserve prep-demand; (a) release with `released_at` set ≥3 days before `need_date` → assert the surplus classifies **raw_sku** (SKU-grain lines present); (b) a second lead released `<3` days before `need_date` → assert **prep** (item-grain); (c) a lead released then re-reserved → assert it is **excluded** (churn filter); zero residue (delete all seeded rows).
- **Build gate** + tsc EXIT 0. Recurring-bug-class review (CC).

## Model-tiered build (same loop as W4a/W4b/FR)

- **CC (main loop):** migration 0140 (apply to prod via Supabase MCP, verify, commit) + the `releasePrepDemand` `released_at` stamp + `lib/catering/surplus.ts` + any needed export from `prep-demand.ts`. Sole reviewer; owns migration + git.
- **Sonnet 4.6:** the `[Surplus]` tab + its server-wrapper wiring, the LTO-page surfacing, the hub badge, + EN/ES i18n (`catering.surplus.*`).
- **Fable 5:** `scripts/w4c-a-surplus-smoke.ts`.

Sonnet + Fable dispatched in parallel (disjoint files; neither commits). CC serializes commits + runs the smoke.

---

## Open items / deferred

- **W4c-b — LTO/discount action engine** (manager turns surplus into a live LTO or discount). Own design; touches menu/pricing/storefront; overlaps Module #17. The LTO page's surplus feed is its entry point.
- **General line over-prep** as a second surplus source (over-prep vs sales). Needs a production-vs-need signal; deferred.
- **Time-phased reservation** (real SKU-reserve → 72h → prep-conversion in the ledger) — explicitly rejected for now in favor of the read-time classifier; revisit only if the advisory classification proves insufficient.
