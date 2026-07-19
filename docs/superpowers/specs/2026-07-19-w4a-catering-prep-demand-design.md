# W4a — Catering Prep-Demand (the prep layer of the reserve/deplete moat)

**Date:** 2026-07-19
**Status:** Design approved (Juan), pre-implementation
**Follows:** W1a (catering pricing core, #139), 3a (order artifact, #140), W1b (package builder, #148)

## 1. Context & goal

The catering ↔ inventory cross-axis link is the moat: catering demand should propagate through the operation as a **two-tier signal** —

1. **Prep layer (W4a, this spec):** a confirmed catering order *consumes prep items*; that should tell the prep team to **make more** and, when it recurs, prompt **raising prep pars**.
2. **SKU layer (W4b, later):** when the ability to *make* that prep is low (not enough raw ingredients), that should trigger **ordering SKUs** / raising SKU pars.

W4a builds **only the prep layer**, and only the parts buildable today at the **item grain** (a confirmed quote already says "40 turkey subs" — no recipes needed). Tier 2 (prep-demand → SKU-demand) needs the item→recipe→SKU recipes, of which **0 are authored today**, so it is deferred to W4b.

**Mechanism (Juan-locked):** this is an **advisory "brain" signal, not a hard hold.** There is no stored on-hand balance in CO-OPS (inventory truth is COUNT-based), so a reservation cannot decrement a stock number — it records committed demand and *surfaces* it. Confirmed catering produces a **date-scoped demand overlay + over-par alert**; it never auto-writes pars (a *manual* one-click par bump is offered instead — no par thrash).

**Posture:** DORMANT until menu/catering data lands (same as W1a/W1b/3a). With 0 catering rows today the overlay is simply empty; nothing breaks.

## 2. Scope

**In scope (W4a):**
- An append-only `catering_prep_demand` ledger (reserve on `confirmed`, consume on `out`/`completed`, release on revert/lost).
- Resolution of a confirmed lead's current quote → concrete prep demand (direct `item`/`menu_item` lines + fixed package components), with unresolved W1b **choice slots** surfaced as "needs pick."
- A derive-on-read aggregation → a **date-scoped demand overlay** + an **over-par alert** (item-grain, where pars exist) + a **manual par-bump affordance** (pre-fills the existing par editor).
- A **standalone manager-facing "Catering Prep Demand" read surface** + a compact per-lead demand breakdown on the pipeline lead detail.
- A seeded lifecycle smoke.

**Out of scope (deferred):**
- **W4b** — the prep-demand → SKU-demand recipe cascade + SKU ordering / SKU-par bump (needs recipes authored).
- **Weaving catering demand into the frontline daily prep list** (couples the prep-list-generation model) — clean follow-up once this substrate exists.
- **Auto-writing pars** — never; only the manual affordance.
- **Choice-slot resolution** (letting staff/customer pick the concrete option) — a separate concern; W4a only *flags* unresolved slots.
- **Self-serve portal orders that never enter the pipeline** — W4a triggers only off pipeline stage transitions.

## 3. Data model — the `catering_prep_demand` ledger

One append-only table; one row per resolved prep-demand unit from a confirmed order.

| Column | Type / rule | Notes |
|---|---|---|
| `id` | uuid PK, `gen_random_uuid()` | |
| `pipeline_id` | uuid NOT NULL, FK → `catering_pipeline(id)` | the lead; **drives the lifecycle** (status flips key off this) |
| `quote_id` | uuid NOT NULL, FK → `catering_quotes(id)` | exact versioned quote the demand was snapshotted from (provenance) |
| `location_id` | uuid NOT NULL, FK → `locations(id)` | which location preps (from `quote.location_id`) |
| `need_date` | date NOT NULL | the event date (from `quote.event_date`) |
| `item_id` | uuid NULL, FK → `items(id)` | resolved extra |
| `menu_item_id` | uuid NULL, FK → `menu_items(id)` | resolved sub |
| `choice_package_item_id` | uuid NULL, FK → `catering_package_items(id)` | an **unresolved** W1b choice slot |
| `portion` | text NULL, CHECK in (`quarter`,`half`,`whole`) | carried from the quote line for menu_items; NULL for extras |
| `qty` | numeric NOT NULL, CHECK > 0 | resolved quantity (`line.quantity × package_component.quantity`) |
| `status` | text NOT NULL default `reserved`, CHECK in (`reserved`,`consumed`,`released`) | lifecycle |
| `created_at` | timestamptz NOT NULL default `now()` | |
| `created_by` | uuid NULL, FK → `users(id)` | the actor who moved the stage |
| `consumed_at` | timestamptz NULL | set when flipped to `consumed` |

**3-way XOR CHECK:** exactly one of `item_id`, `menu_item_id`, `choice_package_item_id` is non-null:
```sql
CONSTRAINT catering_prep_demand_one_ref CHECK (
  (item_id IS NOT NULL)::int + (menu_item_id IS NOT NULL)::int + (choice_package_item_id IS NOT NULL)::int = 1
)
```

**Indexes:** `(location_id, need_date) WHERE status = 'reserved'` (the overlay read); `(pipeline_id)` (lifecycle ops).

**RLS:** parent-anchored on `location_id`, mirroring the catering child-table pattern (migration 0113): readable when the row's `location_id ∈ current_user_locations()` (the level-7+ all-locations override applies). `location_id` is NOT NULL here, so there are no "global" demand rows. **Writes service-role only** via the lib. Append-only: explicit `_no_user_delete USING (false)`; status transitions only through the lib.

## 4. Triggers + resolution logic

**Single hook:** `moveStage()` in `lib/catering/pipeline.ts` (the only stage-transition site) calls a new `lib/catering/prep-demand.ts` after the stage update.

| Transition | Action |
|---|---|
| → `confirmed` | **reserve** — resolve the lead's current quote → insert `reserved` rows |
| → `out` or `completed` | **consume** — flip still-`reserved` rows for this `pipeline_id` → `consumed` (`consumed_at = now()`) |
| → `lost`, or revert to `inquiry`/`quote_sent` | **release** — flip still-`reserved` rows → `released`; already-`consumed` rows stay consumed |

**Resolution (the confirm step):** load the lead's **latest non-superseded** quote (`loadQuotesByPipeline`, pick the current). Walk its `catering_quote_items`:
- **Direct line** (`item_id` or `menu_item_id` set) → one demand row; `qty = line.quantity`, `portion = line.portion`.
- **Package line** (`package_id` set, item/menu null) → walk active `catering_package_items`:
  - `slot_type='fixed'` with a ref → demand row; `qty = line.quantity × component.quantity`.
  - `slot_type='choice'` → one **unresolved** row (`choice_package_item_id = component.id`, same qty math); options are **not** expanded.

Resolution depth is shallow (quote line → package → components). Location + `need_date` come from the quote.

**Idempotency:** reserve is guarded — if the lead already has active `reserved` rows, **release-then-reinsert** (never double-count). Exposed as `resyncPrepDemand(pipelineId)` for the "quote re-versioned while confirmed" edge.

**Lib surface (`lib/catering/prep-demand.ts`):** `reservePrepDemand(actor, pipelineId)`, `consumePrepDemand(actor, pipelineId)`, `releasePrepDemand(actor, pipelineId)`, `resyncPrepDemand(actor, pipelineId)`, `loadCateringPrepDemand(actor, {locationId, from, to})`, `loadLeadPrepDemand(actor, pipelineId)`. Service-role; each audits (`catering.prep_demand.{reserve,consume,release}`).

## 5. Derive-on-read: overlay, over-par alert, par bump

`loadCateringPrepDemand(actor, {locationId, from, to})` aggregates `reserved` rows by `(need_date, ref, portion)`, summing `qty`. Output = the **overlay**:

> *Fri 7/24 · Capitol Hill — catering needs: 40 × ½ Turkey Sub, 10 × whole Turkey Sub, 6 × Caesar Platter, [needs pick: 1 × "choose a side" slot]*

**Over-par comparison (item-grain).** For each `item`-ref demand, resolve the item's standing par for `need_date`'s weekday via the existing day-aware resolver (`lib/items.ts resolveLineDefinition` over `item_par_levels`). Portions collapse to **whole-equivalents** via W1a's `PORTION_FRACTION` (`½=0.5`) for comparability. The overlay always shows the demand-vs-par ratio; the **alert** fires when catering demand (whole-equivalent) for a `(date, item)` is **≥ the item's standing par** for that weekday, **or no par is set** — i.e. the event alone needs as much as (or more than) a normal full day's target, so the standing prep won't cover it. (The exact threshold constant is a plan detail; `≥ par` is the default trigger.)

> **Nuance (verified):** `item_par_levels` is **`item`-only** — there are no par rows for `menu_items`. So the over-par comparison applies to `item`-ref (extras) demand. **`menu_item` (sub) demand surfaces in the overlay as info without a par comparison** at W4a's grain; the sub → prep-item par comparison arrives with W4b's recipe cascade. Items with **no par set** likewise show demand flagged "no par." Unresolved **choice slots** are excluded from par math ("needs pick").

**Manual par-bump affordance.** Each alerted item offers a one-click "raise this item's par" that opens the **existing** par editor **pre-filled with a suggested value** (e.g. `par + observed catering demand`). The write goes through the existing `item_par_levels` par-setting path (MoO+ gated). W4a supplies only the affordance + suggestion — **never auto-writes**.

**Read-only + dormant-safe:** 0 data → empty overlay; the surface renders without error (soft-gate on loader failure, per the readiness pattern).

## 6. Read surface

- **Primary — a standalone "Catering Prep Demand" manager view** (admin/catering side): per location, upcoming ~2 weeks; each date's aggregated demand + over-par alerts + the par-bump affordance. The prep-*manager* planning surface.
- **Secondary — per-lead breakdown** on the catering pipeline lead detail: "this confirmed order will consume: 40 subs, 6 platters…" (reads that lead's own rows via `loadLeadPrepDemand`).
- **Deferred (not W4a)** — weaving catering demand into the frontline **daily prep list** on the demand date; couples the prep-list-generation model; clean follow-up.

i18n: EN + ES (tú-form) for every new visible string, per the translate-from-day-one convention.

## 7. Error handling & edge cases

- **Demand-sync never breaks the stage move.** The stage transition is authoritative; reserve/consume runs alongside it **best-effort with an audit marker on failure** (same philosophy as `audit()` — the advisory layer can't break operations). A failed reserve is visible + re-syncable, not a blocker.
- **Re-confirm idempotency:** release-then-reinsert; never double-counts.
- **Quote re-versioned while confirmed:** `resyncPrepDemand` (release old `reserved` + insert fresh). Defined edge, not happy path.
- **Confirmed lead with no quote:** no-op. Safe.
- **Item with no par / menu_item demand:** overlay shows demand, flagged "no par" / info; no over-par math.
- **Inactive or renamed refs:** the ledger stores the ref; the read resolves names best-effort; append-only history preserved.
- **Authz:** reads location-gated (parent-anchored RLS); par-bump uses the existing MoO+ par authority; `moveStage` already gates stage moves.

## 8. Testing

`scripts/w4a-smoke.ts` — seeded lifecycle smoke (same pattern as w1a/w1b/3a: seed → drive real lib → assert → hard-delete, **zero residue**). Seed a location + pipeline lead + quote + `catering_quote_items` covering **all four line shapes** (direct `item`; direct `menu_item` with `portion='half'`; a package with a `fixed` component; a package with a `choice` slot) + a seeded `item_par_levels` row. Assert:
- **reserve** (`reservePrepDemand`/`moveStage→confirmed`) → correct rows incl `qty = line × component`, `portion` carried, exactly one **unresolved choice** row;
- `loadCateringPrepDemand` → correct `(date, item, portion)` aggregation + whole-equivalent over-par flag on the item-ref demand; menu_item demand present without par comparison;
- **consume** (`→out`) → `reserved`→`consumed` (`consumed_at` set);
- **release** (revert) → `reserved`→`released`;
- **re-confirm** → no duplicates.

Plus `npm run build` / `typecheck` / `eslint` clean.

## 9. Confirm-before-authoring — verified against live DB (2026-07-19)

- `catering_quotes` cols incl `pipeline_id, location_id, status, event_date, superseded_at, root_id, version` ✓. `status` CHECK = `draft|sent|accepted|declined|expired|submitted`.
- `catering_quote_items` cols: `id, quote_id, item_id, menu_item_id, package_id, description, quantity, unit_price_cents, line_total_cents, display_order, created_at, created_by, portion` ✓ (**`portion` exists** — W1a). `one_ref` CHECK = `(item_id IS NULL OR menu_item_id IS NULL)` (package lines have both null + `package_id`).
- `catering_pipeline` cols incl `stage, location_id, event_date`; `PIPELINE_STAGES = inquiry, quote_sent, confirmed, out, completed, lost` (`lib/catering/pipeline.ts`); the sole transition fn is `moveStage()`.
- `catering_package_items` has `slot_type` (`fixed|choice`, W1b, migration 0136) + `catering_package_slot_options`.
- **`item_par_levels`** cols: `id, item_id, location_id, day_of_week, par_value, par_unit, par_mode, active, …` — **`item`-only** (no `menu_item` pars). Day-aware resolver: `lib/items.ts resolveLineDefinition`.
- W1a derivation helpers (`PORTION_FRACTION`) in `lib/catering/pricing-derivation.ts`.
- **Next repo migration number = 0137** (0136 = W1b, applied). Migration file: `supabase/migrations/0137_catering_prep_demand.sql`, applied via Supabase MCP by CC.

## 10. W4b boundary (deferred)

W4b will read W4a's `consumed`/`reserved` demand history, flatten each prep-item to its consumed SKUs via the item→recipe→SKU graph (`lib/recipes.ts` + `lib/prep-consumption.ts` pattern), compare against SKU availability, and surface **SKU ordering / SKU-par** signals — plus the `menu_item` (sub) → prep-item par comparison W4a can't do at item grain. Gated on recipes being authored.
