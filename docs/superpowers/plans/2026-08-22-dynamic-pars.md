# Dynamic Pars — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⛔ MIGRATION LAW (house law since the 0178 lesson): a build agent NEVER applies a migration.** Migration `.sql` files are AUTHORED and COMMITTED in their phase's PR like any other file. Applying them to the live database (`mcp__plugin_supabase__apply_migration`, the Supabase dashboard, `psql`) is a **named LEAD/JUAN gate step**, marked `🔒 GATE`. If a task says `🔒 GATE`, you stop, report, and wait. Writing the file is your job; running it is not.
>
> **⛔ SEED LAW: the same rule covers every `scripts/seed/*.ts` and `scripts/sim/*` write path in this plan.** They ship dry-run-by-default (`const EXECUTE = process.argv.includes("--execute")`). A build agent may run the DRY RUN and paste its output. Only the lead runs `--execute`.
>
> **⛔ PRE-APPLY DEGRADATION IS A TASK REQUIREMENT, NOT A NICETY.** Every phase in this plan must be CI-green, deployable, and **byte-identical on the walker** before its migration is applied. The `products_schema_pending` probe (`lib/counts.ts:136-154`, `lib/products.ts:101`) is the pattern: probe once, cache only the TRUE answer, re-probe while false, log the pending state once.

**Base:** repo `C:\Users\conta\co-ops`, branch `main` @ `2389f5e`.
**Spec (the contract — FOUR layers, all binding, later overrides earlier):** `docs/superpowers/specs/2026-08-21-dynamic-pars-design.md` @ `2389f5e` — original design + COUNCIL AMENDMENTS (r1) + ROUND-2 AMENDMENTS + ROUND-3 AMENDMENTS (head rulings R3-A / R3-B).
**Council materials (the WHY; cited per task where a task guards a specific finding):** `~/.claude/council/2026-08-21-dynamic-pars/` — `report.md` (r1 + r2 syntheses), `cc-take-r3.md`, `r3-aggie.md`, `r3-builder.md`, `r3-projects.md`. *(`r3-opus.md` and `r3-sonnet.md` are zero-byte on disk; their findings survive only as the spec's r3 amendment text. The opus prod-scope arithmetic was therefore **re-verified live against prod on 2026-08-22** — see Scope honesty below, every figure reproduced.)*
**Law:** `AGENTS.md` (+ `docs/DISCLOSURE_DOCTRINE.md` for the reason-lane disclosure, `docs/design/2026-08-19-ux-refresh-handoff/README.md` for the token/grammar floor).

---

## Scope honesty — READ THIS BEFORE THE GOAL

**Re-probed live 2026-08-22 (prod `bgcvurheqzylyfehqgzh`). Every council figure reproduced; two are refined.**

| Fact | Live value | Consequence for v1 |
| --- | --- | --- |
| Par'd SKUs (all active) | **141** | the universe |
| …inventory-only | **57** | scope wall — OUT (receiving-cadence model, different arc) |
| …with **no weight basis at all** (`avg_oz_per_each` NULL **and** no `each_size`/`each_measure`) | **80** *(council said 82 — predicate-dependent; a pack chain can also supply oz)* | advisory-null with the `no_weight_basis` reason |
| `production_inputs` rows | **0** | the production lane is DARK everywhere; every prep-mediated SKU is advisory-null |
| `sku_count_events` | **0** | no count anchor exists ⇒ **no location can graduate**, by construction |
| `vendor_cutoffs` rows | **0** | no rhythm anywhere ⇒ coverage is dead until Juan authors it |
| Vendors with `delivery_days` | **4 of 18** | and the column is vendor-global + never read — legacy, never read here either |
| Par'd SKUs with a **weekend** slot | **20** (121 have none) | the machine may never create the other 121 |
| Deliberately **fractional** pars | **36** | the par-step quantum is load-bearing, not an edge |
| Pars **< 4** | **108 of 141 (77%)** | see the auto-tier row below |
| Par'd SKUs with **contradictory flat weights** (`each_size ≠ avg_oz_per_each`) | **27** *(council said 26)* | listed, never guessed — the weight board's next census |
| Depletion ledger | 3 936 rows, **2026-07-23 → 2026-08-21**, 71 distinct SKUs | 30 days of history, one window's worth |
| 21-day window day-class split | **21 of 21 days present, 9 weekend points** | confirms r2 closure 11 (9, not 6); the full-gap class is currently EMPTY |

### The two numbers that set every phase's success measure

**① v1's live suggestion surface is 14 rows.** Par'd + active + non-inventory + present in `toast_daily_depletion` with `direct_oz > 0` = **9 SKUs**. Two of those nine (Banana Peppers, Parmesan (Grated)) carry **no weight basis**, so they are advisory-null. The remaining **7 SKUs × 2 locations = 14 weekday rows** (plus 2 weekend rows — Prosciutto is the only lane-lit SKU with a weekend slot). Verified names: Arugula · Balsamic Vin · Black peppercorn · Oregano · Salt · Thyme (PFG) · Prosciutto (Boar's Head). **And all 14 stay silent until Juan authors rhythm for exactly two vendors.**

**② the auto tier's live population is ONE SKU.** r3 rules pars **≤ 3 steps** below the band's resolution (manual-only). Of the 7 lane-lit SKUs: Prosciutto 4/6 (4 steps ✅) · Arugula 3 · Thyme 2 · Black peppercorn 1 · Salt 1 · Balsamic Vin 0.25 (1 step at a 0.25 quantum) · Oregano 0.25 (1 step). **Exactly one SKU × two locations is above the band's resolution — and it cannot graduate anyway, because `sku_count_events` is 0.** The auto tier is not a v1 feature; it is code that ships dark.

### Therefore

**THE REASON LANE IS THE PRODUCT.** v1 ships an engine that computes everything, writes a ledger, applies nothing, renders ~14 numeric suggestions — and, for the other ~127 par'd SKUs at each shop, **names the errand that would wake each one**. Phase success is measured in **reason-lane completeness and correctness**, never in suggestion volume. A phase that ships 0 suggestions and a complete, accurate, i18n'd errand list is a **success**. A phase that ships 40 suggestions by loosening a gate is a **failure**.

---

## Goal

Give the ordering walk a par that **moves with demand, and explains itself** — and, where it cannot yet move, says exactly why in the language of an errand.

When this arc closes:

- A nightly step, chained after depletion materialization, computes for every (SKU, location, day-class): a **base consumption rate** (trailing 21 days, day-class-split, observed-day denominators, lane- and time-clamped), a bounded **velocity ratio** (residual momentum above trend), a **coverage window** derived from the vendor's real per-location order→delivery rhythm, a **policy cushion**, and a **suggested par** — writing every term and every guard verdict to an append-only `par_auto_moves` ledger.
- The walker renders that suggestion beside the par as **one number pair** ("par 3 → suggested 5"), with the horizon **recomputed at walk time** so the 9:58 and 10:02 walks correctly differ, the covered-to delivery named in kitchen language, and a one-tap accept that live-recomputes the order quantity.
- **Nothing applies itself.** The full guard stack (par-step band, day-class budget, hysteresis, generation stability, PIN) is *simulated* every night and recorded as would-apply-vs-suppressed-by-which-guard, so it is battle-tested before any flip.
- **Every silent par names its cause** — no production capture · no weight basis · no vendor rhythm · thin history · lane not started · budget spent · unit looks wrong · zero target — aggregated into a per-cause errand list. That list is Juan's data-critical-path, generated live.
- Vendor **rhythm** (per-location order→delivery pairs), **cushion class** and **par step** become authorable data on the existing vendor and SKU admin surfaces, with a one-off vendor-down skip so an outage never reads as par disagreement.

**Non-goals, named and NOT built here:** the statistical cushion (the `cushionFor` socket exists, the implementation waits for variance-worthy history) · the "Add a Location" arc · resale / inventory-only SKU demand · multi-vendor split-order cost optimisation · a first par from zero (named advisory only) · a new admin page.

### v1 scoping, confirmed against the spec text

The brief asks this to be confirmed and stated. Reading all four layers:

| Capability | Spec position | This plan |
| --- | --- | --- |
| Suggestion tier | **LIVE from day one for lane-lit SKUs.** "SHADOW = the auto-apply tier simulated" (r3 suggestion-lane governance section governs the tier "v1 actually ships"). | **Phases 2–4. Live.** |
| Auto-apply tier | Shadow only. "v1 computes everything, writes the ledger + notices, applies NOTHING" (r1) + "shadow SIMULATES the full guard stack… same code, mode flag" (r2-7). | **Built + simulated in Phase 3, write bit hard-off.** |
| Graduation machinery (trust ramp, count anchor) | "auto-apply graduates per-location after a trust ramp + a count anchor" (r1); "graduation widens the TRIGGER, never the write set" (r2-3). | **Counters + gate fn ship in Phase 3 (pure + tested). The flip stays dark** — no route, no toggle, and `sku_count_events = 0` makes it unreachable regardless. |
| Sibling-prior cold start | "sibling designation is one field of location onboarding… the Add-a-Location arc (SEPARATE, Juan-queued)" (original §Scale-readiness); "deferred to Add-a-Location" (r1-11). | **NOT BUILT.** One reason-lane cause (`no_local_history`) and a pure-fn seam (`siblingBlendWeight`, tested, unwired) are the whole footprint. Confirmed correct scoping. |
| Event (catering) layer | "advisory-only in v1… named on the walker, never summed" (r1-1). | **Phase 4, named, never summed.** |
| Velocity | "suggestion-lane ONLY in v1… drops to v1.1 costlessly if the plan runs heavy" (r1-6). | **Phase 2, kept, suggestion-lane only.** Task 2.6 is the named drop-point if the arc runs long. |

---

## Architecture

**Four seams, in dependency order. Each is independently shippable and independently useless-but-harmless without the next.**

**① The rhythm (Phase 1) — the only thing that can answer "how long must this par last?"**
There is no order→delivery mapping anywhere in the schema today (`vendor_cutoffs` is order-day + bare cutoff time; `vendors.delivery_days` is vendor-global, unloaded, and legacy). A new **per-location, explicitly non-inheriting** `vendor_delivery_rhythm` stores **PAIRS** — `(order_dow, lead_days)` with the delivery dow as a *generated* column, because the arrays don't map (a vendor ordering three days may deliver on two). One pure authority, `lib/vendor-rhythm-shared.ts`, answers `nextDeliveryAfter` and `coverageWindow`; it evaluates cutoff state at the instant it is handed and **never reuses `governingCutoffTime`**, whose earliest-of-today tiebreak is a display rule (**R3-A**).

**② The demand core (Phase 2) — pure, and split at the cost seam.**
`lib/dynamic-pars-shared.ts` holds every rule the four spec layers name. It is deliberately split into **two halves**:

| Half | Cost | Runs where |
| --- | --- | --- |
| `computeDemandTerms` — base rate per day-class, observed-day denominators, lane/time clamps, gap-day exclusion, product-grain rollup, velocity ratio | heavy (21 days × 141 SKUs × 2 lanes) | **nightly only**; the terms are persisted on the ledger row |
| `computeCoverageSuggestion` — horizon selection, Σ-per-covered-day, cushion, peak floor, quarantines, guard stack, generation id | trivial (arithmetic over ~10 numbers) | **nightly AND at walk-time render** |

That split *is* R3-A: the walker re-runs a pure **selection** over persisted terms, never a mutation and never a re-derivation — which is why a 9:58 walk and a 10:02 walk legitimately render different numbers from the same ledger row, and why the read path costs one batched query.

**③ The ledger + the nightly step (Phase 3) — chained, watermark-gated, idempotent.**
The pars step is appended to the **existing** `/api/cron/toast-sales-pull` handler, immediately after the per-location `materializeDailyDepletion` loop — no new cron entry, no `vercel.json` change, and the chain order is structural rather than scheduled. A location whose depletion watermark (`MAX(business_date)` in `toast_daily_depletion` — the same read `salesLedgerThrough` already performs) is not current is **skipped with an advisory-null reason**, never computed on a stale day. Writes are idempotent on `(run_date, location_id, sku_id, day_class)`. Audit volume is **one run-level row per (location, night)**; the 282 per-SKU rows go to `par_auto_moves`, not `audit_log`.

**④ The surfaces (Phase 4) — read-only extensions of what exists.**
The walker (`lib/ordering.ts` → `components/ordering/ParPassWalker.tsx`) gains one number pair per row and one global shadow banner. Accept / dismiss / revert go through **ONE par-write authority function** carrying an actor-kind (`admin` | `accept` | `machine`), so there is exactly one place that writes a par overlay and exactly one place that clears a pin. The reason lane lives in the **aggregate** — `WalkerData.parSilence` plus a default-collapsed per-cause errand list on `/ordering` — because in v1 ~94–100% of rows would badge, and a lane that badges everything is a lane that gets scrolled past.

**What this arc deliberately does NOT do:** it does not touch `toast_daily_depletion.direct_oz` or `flattened_oz` (the double-count law is not in play) · it does not restructure `deriveSalesConsumption` · it does not re-key any ledger · it does not add a per-SKU query anywhere · it does not write a global `vendor_items` par · it does not create a par slot that does not exist · it does not add an admin page.

---

## Tech Stack

- **Next.js 16.2.4** App Router (Server Components), **React 19.2.4**, TypeScript `strict` + `noUncheckedIndexedAccess`
- **Postgres 17** on Supabase (project `bgcvurheqzylyfehqgzh`), migrations `supabase/migrations/NNNN_*.sql`, **next numbers = `0182`, `0183`**
- **Tailwind v4** CSS-first (`app/globals.css` `@theme inline`) — token roles, the four button grammars and the 44px floor per `AGENTS.md` § UI design system
- **Vitest** (`tests/`, `npm test`, CI-gated) — pure modules only; this arc's pure surface is the largest single addition to the spine to date
- **i18n** — flat dotted keys in `lib/i18n/en.json` + `lib/i18n/es.json`, **en and es in the same PR**, `formatDateLabel` for every day name
- Row types are **hand-declared** (there is no generated `types/supabase.ts`); PostgREST numerics arrive as `number | string | null` and are coerced with the local `num()`

---

## Deviations from the spec (READ FIRST — these need the lead's ruling)

The spec's model is followed exactly. Sixteen places where live code or live data makes a spec line impossible, unsafe, ambiguous, or wasteful are argued here rather than silently absorbed.

**D1 — "GM ≥6" is wrong by one rung, and the wrong rung hands par-write to the Social Media Manager.**
r3 §Authz: *"accept/dismiss/revert floor = **GM ≥6** (render visible ≥4)"*. Live (`lib/roles.ts:47-62`): `gm` is level **7**. Level **6** is `agm`, `catering_mgr`, `prep_mgr` **and `social_media_mgr`**. The council's builder seat asserted "par edits are GM+ (vendor_item.update, level 6)" — that is the error the spec inherited. The *only* par-write path today is `upsertLocationSkuSettings` (`lib/admin/skus.ts:732`) at `SKU_WRITE_MIN = 7` (`lib/admin/skus.ts:48`, commented "GM+"). **Resolution: the accept / dismiss / revert floor is level 7**, which is what "GM" means in this codebase and exactly today's par-write authority — no escalation in either direction. The suggestion **renders** at `PAR_PASS_MIN = 4` for transparency, as ruled. Dismiss shares the floor deliberately: it feeds the trust ramp's denominator, so a level-4 dismiss would let a key-holder starve a graduation gate they cannot see the consequences of.

**D2 — accept / dismiss / revert take NO step-up, and that is a narrowing, not a loosening.**
The admin overlay route (`app/api/admin/skus/[id]/location-settings/route.ts:22`) calls `assertStepUp(ctx, "A")`. Step-up **auto-clears on `/admin` exit** (`lib/session.ts` `requireSessionCore`), and `/ordering` is an operational surface that has never had it (`lib/ordering.ts:3-5`: *"NO Tier-A step-up — the shelf-walk is an operational KH+ capture"*). A password prompt at 6 AM on a shelf walk is the affordance's death. **Resolution: role gate only (level 7), no step-up, on the three walker routes.** The blast radius is strictly smaller than the admin route's: one `(sku, location, day-class)`, one value, and that value was computed by the system and rendered to the actor before they tapped. The admin route keeps its step-up untouched.

**D3 — the coverage horizon's END is the SECOND-next delivery. R3-A ruled the timing; it did not rule the endpoint, and the naive read under-covers by ~50% on the main path.**
Original §Coverage: *"Par = demand-rate × days-until-next-delivery"*. Builder r3 SC1 proved the arithmetic gap: on PFG Mon/Wed/Fri ordering with 1-day lead, a Monday walk's stock must last until **Thursday's** truck, not Tuesday's — because the order placed Monday *is* Tuesday's truck. Order-up-to-par is a base-stock policy: the target must cover **lead time + review interval**. **Resolution: `coverageWindow` returns `coveredDays` = every ET calendar day strictly between the walk date and the second-next delivery date** (`walkDate < d < coverThrough`), and the reason string names `coverThrough` — which is exactly Juan's own phrasing, *"4 covers you to Friday's truck plus 20%."* Cardinality on the worked example: Tue, Wed = 2 days. The walk day itself is excluded (walks are evening, after service); the arrival day is excluded from the *tail* because a morning delivery replenishes before service. Both assumptions are stated in the function's doc block and pinned by tests.

**D4 — `suspectedCatering` cannot be excluded from the base without restructuring the one writer the double-count law protects. Do not restructure it.**
Verified live at `lib/catering/toast-sales.ts:757-769`: the detector runs **after** `skuDirect` has been summed over every counted line. Filtering suspect checks out of the SKU aggregation would change what `toast_daily_depletion.direct_oz` means — the exact lane the spec forbids touching ("never touches the double-count law's lanes"). **Resolution: a day-grain marker, never a lane change.** `materializeDailyDepletion` additionally writes one `toast_daily_sales_signals` row per (location, business_date) inside its **existing** idempotent delete-and-reinsert scope, carrying `suspect_check_count` and `suspect_qty`. `direct_oz` is byte-identical. Velocity excludes flagged days; days before the first signal row are **UNKNOWN**, and velocity's window clamps to `signals_start_at` — the exact same clamp shape r2-5 already mandates for `lane_start_at`. Stated limitation: velocity cannot see catering spikes older than the marker, which self-heals in one window.

**D5 — the rhythm's cutoff is READ from `vendor_cutoffs` by order-day, not stored a second time.**
r2-1 asks for a rhythm element following "the `vendor_cutoffs` location-scoping pattern"; R3-A forbids reusing `governingCutoffTime`. A `cutoff_time` column on the rhythm row would create a **second cutoff home** and guarantee divergence with the chip the walker already renders. **Resolution: one cutoff store, two selections.** `governingCutoffTime` (`lib/ordering.ts:148`) is untouched and stays the *display* rule (today's dow, earliest-wins). A new pure `cutoffForOrderDay(rows, locationId, dow)` is **dow-parameterised** and location-most-specific — the same tiebreak, a different question. `loadCutoffsByVendor` gains an all-dows variant (drop the `.eq("order_day", dow)` filter) so the rhythm walk can see the whole week in the same single batched query. Note the deliberate asymmetry, stated in the migration comment: **cutoffs may be shared across shops (`location_id NULL`), rhythms may not** — the deadline is usually one phone system, the trucks are not.

**D6 — `sku_class` is `raw` / `packaging` and is NOT the cushion taxonomy. Cushion class is a new per-SKU column with no enum.**
Verified live: `sku_class` has exactly two values across 164 active SKUs (`raw` 102, `packaging` 62). The protein/produce/dry taxonomy r1-9 needs does not exist. **Resolution:** `vendor_items.cushion_class text NULL` — **no enum, no CHECK**, per the explicit `0177_vendor_price_history_provenance.sql` precedent ("the vocabulary is expected to grow; pinning it in DDL now would force a migration per source"). Percentages stay in code (`CUSHION_BY_CLASS`). A NULL class **never silences a suggestion** — it falls to a documented conservative default and raises an *informational* errand row, because r2-13 puts cushion third on the data critical path behind weight and rhythm ("coverage is dead without the first two"), i.e. cushion is not a blocker.

**D7 — the par step is inferred from live pars before it is authored, so the 36 fractional SKUs need zero data entry to be correct.**
r2 requires each SKU to carry a step. **Resolution:** `vendor_items.par_step numeric NULL` (authorable), resolved by a pure `parStepFor()`: explicit `par_step` ?? inferred from the standing pars' observed grain (a par with a `.25 / .5 / .75` fraction ⇒ `0.25`; a `.5` fraction alone ⇒ `0.5`; else `1`). Inference is the honest bootstrap; the column is the override.

**D8 — the pin-clearing human write is `vendor_item.update`, not `item_par.update`.**
r3 §PIN: *"both `item_par.update` and `par.suggestion_accept` clear pins"*. Live, `item_par.update` (`lib/destructive-actions.ts:152`) belongs to the **`item_pars` prep-item layer** — a different table, a different surface. The overlay par write emits `vendor_item.update` with `metadata.scope = "location_settings"` (`lib/admin/skus.ts:794-809`). **Resolution: the two pin-clearing names are `vendor_item.update` (scope `location_settings`) and `par.suggestion_accept`.** Also: **do not co-opt `pars.update`** — it sits in both `DESTRUCTIVE_ACTIONS` and `RESERVED_ACTIONS` as the Foundation-Spec placeholder for the unbuilt admin Pars page, and reusing it would erase that distinction.

**D9 — the depletion watermark is derived, not stored. No new table.**
r3 asks for "a `depletion_current_through` watermark per location". `salesLedgerThrough` (`lib/counts.ts:2099`) already computes exactly that with one indexed `ORDER BY business_date DESC LIMIT 1`. **Resolution: extract it to an exported actor-less helper and gate the pars step on `watermark === runBusinessDate`.** A stored watermark would be a second opinion about a fact the ledger already states, and it would go stale on a manual backfill.

**D10 — the full-gap oracle is `toast_sales_events`, and the class is currently empty.**
r3 names full-gap days (zero events AND zero ledger) as invisible to the existing guardrail. **Resolution:** a day is *observed* for the sales lane iff `toast_sales_events` has ≥1 row for `(location, business_date)` — the register ran. A day with events but no depletion row for a SKU is a **true zero**; a day with no events at all is a **gap** and is dropped from the denominator, never nulled into it. Honest note for the plan's readers: live today the 21-day window has **21 of 21 days present in both tables**, so the class is currently EMPTY at both shops. The guard is built because the class is real (the council measured 8.3% silent down-bias on a wider predicate) and one Toast outage recreates it — not because it is firing.

**D11 — the event advisory needs an actor-less core, because the walker's floor is 4 and the catering demand floor is 6.**
`loadCateringSkuDemand` gates at `PREP_DEMAND_READ_MIN = 6` (`lib/catering/prep-demand.ts:15`). The walker's floor is `PAR_PASS_MIN = 4`. **Resolution:** split it exactly as `salesConsumption` → `deriveSalesConsumption` already is (`lib/catering/toast-sales.ts:429-436`) — the exported gated wrapper keeps its floor; a new actor-less `deriveCateringSkuDemand(locationId, from, to)` is called by the walker, which is already location-bound and already authorized for this shop. Pure refactor, zero behaviour change. The walker shows a **name and a date**, never a summed number.

**D12 — two migrations, two gates. "Auto columns LAST" is read as a separate gate, not a statement order.**
r3 §Also-final: *"migration sequencing per the 0180 probe precedent, auto columns LAST, byte-identical walker pre-apply"*. A single migration would light `resolvePar`'s third lane the same instant the ledger table appears, before any writer exists. **Resolution:** `0182_par_rhythm_and_ledger.sql` (🔒 **M1**, end of Phase 1 — rhythm, skips, ledger, sales signals, `cushion_class`, `par_step`) and `0183_par_auto_lane.sql` (🔒 **M2**, end of Phase 3 — the `auto_*` / baseline / pin columns on `location_sku_settings`). Each is independently probe-gated and each degrades to today's exact behaviour.

**D13 — `par_auto_moves` is append-only with ONE immutable class, and the nightly recompute deletes only the mutable rest.**
The house append-only law and the nightly-idempotence requirement collide. `materializeDailyDepletion` resolves the same collision by treating its table as a re-derivable cache (delete the day, re-insert). **Resolution:** the nightly delete is scoped `(run_date, location_id)` **AND `outcome <> 'applied'`**. A `would_apply` / `suppressed` / `advisory_null` row is a recomputable opinion; an `applied` row is the record of a real par write and is never deleted, never updated. `UNIQUE (run_date, location_id, sku_id, day_class)` makes a Vercel retry a no-op instead of a budget double-count (projects r3 P2-10).

**D14 — one suggestion generation, one human action, arbitrated by a unique index — because that is how SIM-22 was actually fixed.**
r3 demands "idempotency/409 guards keyed on the suggestion generation" on all three routes. **Resolution:** a `par_suggestion_actions` table with `UNIQUE (location_id, sku_id, day_class, generation_id)`. The **index is the guard**: the loser of a double-tap race gets a `23505` mapped to `409 suggestion_already_actioned`, exactly as `createDraftsFromLines`'s `noCodeSuffixRetry` lets the display-code unique index arbitrate the double-generate race (`lib/ordering.ts:1786-1791`). This table is also the trust ramp's denominator and the PIN's state home, so the ramp counts **distinct generations**, structurally, with no chance of counting nightly re-renders.

**D15 — the reason lane has NO per-row badge in v1, and the switch that later turns it on is a pure function, not a future PR.**
aggie r3 P1: with 94–100% of rows silent, a per-row badge is worse than the 94% the r2 rename was commissioned to fix. **Resolution:** `WalkerData.parSilence` (per-cause counts + a capped named errand list) renders as one aggregate line plus a default-collapsed `CollapsibleSection` (Disclosure Doctrine). Whether a row *also* badges is decided by a pure, tested `shouldBadgeSilencePerRow(silentRows, totalRows)` → `silentRows / totalRows < 0.5`, shipped now and returning `false` today. The lane lights itself when silence becomes the minority — no code change, no flag.

**D16 — the weekend day-class is computed and ledgered for all 141 SKUs, but a slot-creation suggestion never renders as a number.**
121 par'd SKUs have no weekend slot, and `resolvePar`'s day rule means a weekend walk on those uses the weekday number. Computing nothing would blind the reason lane; rendering a number would violate both "one number pair" and "the machine never creates a par slot that doesn't exist". **Resolution:** the weekend day-class is always computed and always ledgered with `slot_creation = true`; on the walker it is reported **only in the aggregate** ("N SKUs look like they want a separate weekend par"), never as a row-level number pair. The weekend day-class's horizon is evaluated at the **Friday** walk (the longest gap), per r3.

> **Two source-document anchors corrected here so tasks do not chase them.** (a) `r3-opus.md` and `r3-sonnet.md` are **empty files** — do not go looking for the prod-scope arithmetic or the aggregation-restructure warning in them; both are reproduced above from live probes and live code. (b) The spec's r1 §Base mechanics still says *"21d ≈ 6 weekend points"*; r2-11 corrects it to **9**, and the live probe confirms 9. Pin 9.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `lib/vendor-rhythm-shared.ts` | Pure: `RhythmRow` / `CutoffRow` / `RhythmSkip` types, `cutoffForOrderDay`, `nextDeliveryAfter`, `coverageWindow`, `optimizationWalkDate`. Zero I/O. |
| `lib/vendor-rhythm.ts` | Server: `loadRhythmByVendor`, `loadAllCutoffsByVendor`, `setVendorRhythm`, `addRhythmSkip`, `deactivateRhythmSkip`. Service-role + app-layer role gates. |
| `lib/dynamic-pars-shared.ts` | The whole demand/guard pure core: config constants, `parStepFor`, `dayClassForDate`, `computeBaseRate`, `computeVelocityRatio`, `cushionFor`, `computeCoverageSuggestion`, `applyGuardStack`, `stabilizeSuggestion`, `generationIdFor`, `observedPeakCoverageOz`, `suggestedOrderQty`, `classifyParSilence`, `shouldBadgeSilencePerRow`, `trustRampState`, `siblingBlendWeight`. Zero I/O, client-safe. |
| `lib/dynamic-pars.ts` | Server: `loadDemandInputs` (the batched nightly loader), `runParShadowForLocation`, `loadParSuggestions` (the walker's one batched read), `writeParFromSuggestion` (**THE one par-write authority**), `dismissSuggestion`, `revertAutoMove`, `loadParSilence`. |
| `supabase/migrations/0182_par_rhythm_and_ledger.sql` | Phase 1 schema (**authored, not applied — 🔒 GATE M1**). |
| `supabase/migrations/0183_par_auto_lane.sql` | Phase 3 schema (**🔒 GATE M2**). |
| `app/api/admin/vendors/[id]/rhythm/route.ts` | POST add a rhythm pair · DELETE deactivate one (GM+ / AGM+ mirroring the cutoffs route). |
| `app/api/admin/vendors/[id]/rhythm/skips/route.ts` | POST add a vendor-down skip window · DELETE deactivate one. |
| `app/api/operations/ordering/suggestion/route.ts` | POST `{ action: "accept" \| "dismiss" \| "revert", … }` — level 7, no step-up, 409 on generation. |
| `components/ordering/ParSuggestionRow.tsx` | The one-number-pair block + accept/dismiss affordances + the reason microcopy. |
| `components/ordering/ParSilencePanel.tsx` | The aggregate line + the default-collapsed per-cause errand list. |
| `components/admin/vendors/VendorRhythmCard.tsx` | The per-location order→delivery pair editor + the skip affordance (rides the existing vendor detail page). |
| `tests/vendor-rhythm-shared.test.ts` | Cutoff-by-dow selection, `nextDeliveryAfter`, `coverageWindow` (incl. the 9:58/10:02 pair), skips, the Friday weekend-slot rule. |
| `tests/dynamic-pars-base.test.ts` | Day-class split, observed-day denominators, `lane_start_at` clamp, gap-day exclusion, product-grain rollup, thin thresholds. |
| `tests/dynamic-pars-velocity.test.ts` | Residual form, persistence gate, volume floor, recipe-edit reset, suspect-day exclusion, influence cap. |
| `tests/dynamic-pars-coverage.test.ts` | Σ-per-covered-day, cushion classes, peak-coverage floor, the four quarantines, `suggestedOrderQty`. |
| `tests/dynamic-pars-guards.test.ts` | Par-step band, cap-after-rounding, ≤3-step manual-only, day-class budget, hysteresis + generation, PIN lifecycle, slot creation, self-invalidation, trust ramp. |
| `tests/dynamic-pars-reason.test.ts` | The closed reason vocabulary, cause precedence, `shouldBadgeSilencePerRow`, the aggregate rollup. |
| `scripts/sim/dynamic-pars/scenarios.ts` | Phase 5 regression fixtures (the five r3 scenario walks) — pure, imported by the tests. |

**Modified**

| File | Change |
| --- | --- |
| `lib/audit-actions.ts` | `par.auto_tune_shadow`, `par.auto_tune`, `par.suggestion_dismiss` → `NON_DESTRUCTIVE_ACTIONS`. |
| `lib/destructive-actions.ts` | `par.suggestion_accept`, `par.auto_tune_revert` → `DESTRUCTIVE_ACTIONS`. |
| `lib/location-sku-shared.ts` | `resolvePar` becomes three-lane (`human ?? auto ?? global`); `ParSilenceCause` re-exported for the walker's types; `parReviewAdvisory` untouched. |
| `lib/ordering.ts` | `loadCutoffsByVendor` gains an all-dows variant; `loadWalkerData` gains one batched `loadParSuggestions` call + `WalkerSku.parSuggestion` + `WalkerData.parSilence` + `WalkerData.shadowMode`; `advisoryOnHandBySku` untouched. |
| `lib/admin/skus.ts` | `upsertLocationSkuSettings` routes its write through the new authority fn (nulls the auto column on a blank-to-global, clears the pin, never writes an auto column itself). |
| `lib/catering/toast-sales.ts` | `materializeDailyDepletion` additionally writes the `toast_daily_sales_signals` row (same idempotent day scope; `direct_oz` untouched). |
| `lib/catering/sku-demand.ts` | Actor-less core split (`deriveCateringSkuDemand`), gated wrapper unchanged. |
| `lib/counts.ts` | `salesLedgerThrough` exported as `loadDepletionWatermark` (actor-less; same query). |
| `app/api/cron/toast-sales-pull/route.ts` | The pars step, chained after the materialize loop, watermark-gated, per-location try/catch, one heartbeat field. |
| `app/api/admin/skus/[id]/location-settings/route.ts` | No behaviour change; comment records that the auto columns are structurally excluded. |
| `components/ordering/ParPassWalker.tsx` | Renders `ParSuggestionRow` + `ParSilencePanel` + the shadow banner; the `#283` cause advisory and the numeric suggestion never co-render. |
| `components/admin/vendors/VendorDetailClient.tsx` | Mounts `VendorRhythmCard` beneath the existing schedule card. |
| `components/admin/skus/SkuLocationOverlay.tsx` | Shows the standing auto value read-only when one exists (never editable). |
| `lib/i18n/en.json` · `lib/i18n/es.json` | ~64 new keys, full sentences, both files, same PR. |
| `docs/ROADMAP.md` · `AGENTS.md` | Phase 5 arc close. |

---

## Phases, gates and shippability

| Phase | Ships | Migration | Gate | Independently shippable? |
| --- | --- | --- | --- | --- |
| **1 — schema + rhythm** | rhythm/skip/ledger/signals schema, the pure rhythm authority, the vendor-admin rhythm editor, cushion-class + par-step authoring | `0182` authored | 🔒 **M1** (lead applies after CI-green + Juan smoke of the *pre-apply* walker) | ✅ Walker byte-identical pre- and post-apply; the editor is the only new surface and it degrades to "schema pending". |
| **2 — the demand core** | `lib/dynamic-pars-shared.ts` in full + ~150 vitest cases | none | — | ✅ Pure module, zero call sites. Nothing renders. |
| **3 — shadow cron + ledger** | the nightly step, the guard simulator, the ledger writer, the audit vocabulary, the graduation gate (dark) | `0183` authored | 🔒 **M2** (lead applies) | ✅ Cron no-ops when `0182` is unapplied; writes ledger rows and nothing else. |
| **4 — surfaces** | walker suggestion + accept/dismiss/revert + shadow banner + reason lane + i18n | none | — | ✅ Renders advisory-null everywhere until Phase 3 has written rows. |
| **5 — sim + close** | the five scenario regressions, the T0 sweep, ROADMAP + AGENTS.md | none | — | ✅ Docs + tests only. |

**Success measure per phase (set by the Scope-honesty section — reason-lane completeness, never suggestion volume):**

- **P1:** Juan can author PFG's and Boar's Head's real rhythm in under five minutes, and `nextDeliveryAfter` reproduces his answer for every day of the week by hand-check. Walker unchanged.
- **P2:** every rule named in all four spec layers has at least one vitest case, and the four r3 quarantines each have a case that proves *no number* is emitted.
- **P3:** one nightly run produces **282 ledger rows per location** (141 SKUs × 2 day-classes) of which ~14 are `would_apply`/suggestion-tier and the rest carry a **correct, specific reason code** — and exactly **one** `par.auto_tune_shadow` audit row per (location, night).
- **P4:** the errand list on `/ordering` names, in Spanish and English, every cause blocking every one of the ~127 silent pars, and the 14 lit rows render one number pair whose horizon changes across the 10:00 cutoff.
- **P5:** the five r3 scenarios pass as fixtures; the T0 twenty-class checklist is clean over the cumulative diff.

---

## PHASE 1 — schema + rhythm

*Goal: the system can answer "when is the next truck, and what must this par survive until the one after that?" — and Juan can tell it. Nothing about pars changes.*

### Task 1.1 — Author migration `0182_par_rhythm_and_ledger.sql`

- [ ] Create `supabase/migrations/0182_par_rhythm_and_ledger.sql` with exactly this content.

**RLS posture is the 0174 house idiom** (`ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM anon, authenticated, public`, no stacked deny policies — service-role writes, app-layer gates). **Append-only**: no application DELETE path on any table here except the one documented recompute scope in `par_auto_moves` (**D13**).

```sql
-- 0182: Dynamic Pars — vendor rhythm, the par-move ledger, and the day-grain sales signal
-- Spec:  docs/superpowers/specs/2026-08-21-dynamic-pars-design.md (four layers, final at 2389f5e)
-- Plan:  docs/superpowers/plans/2026-08-22-dynamic-pars.md Task 1.1 (GATE M1)
--
-- WHAT THIS IS NOT: it does not touch toast_daily_depletion, production_inputs, or any
-- par column. The double-count law's two lanes are not in play anywhere in this file.
--
-- RLS posture: deny-all on every new table (service-role writes; app-layer role gates in
-- lib/vendor-rhythm.ts and lib/dynamic-pars.ts). House idiom from 0168+/0174:
--   ALTER TABLE … ENABLE ROW LEVEL SECURITY;  REVOKE ALL … FROM anon, authenticated, public;
-- Explicit deny policies are NOT stacked on top of the revoke (0172/0174 precedent).
--
-- Append-only: rows are never deleted by the application, with ONE documented exception
-- recorded on par_auto_moves below (the nightly recompute of its own non-applied opinions).

-- ── (1) VENDOR DELIVERY RHYTHM — order→delivery PAIRS, explicitly per-location ───────────
--
-- WHY PAIRS AND NOT TWO ARRAYS. vendors.order_days and vendors.delivery_days are both
-- smallint[] and they DO NOT MAP: a vendor that takes orders on three days may run trucks
-- on two, and nothing in two parallel arrays says which order lands on which truck. One row
-- per (order day → lead) IS the pair; delivery_dow is GENERATED from it so there is exactly
-- one authority for the arithmetic and no chance of an authored pair disagreeing with itself.
--
-- WHY location_id IS NOT NULLABLE HERE, unlike vendor_cutoffs. A NULL=all-shops row would let
-- the ghost kitchen silently inherit P Street's trucks — which is precisely the fact that is
-- NOT shared between two shops of one vendor. Cutoffs may be shared (one phone system, one
-- deadline); routes may not. Deliberate asymmetry, ruled by the council's round 3.
--
-- LEGACY: vendors.delivery_days (migration 0094) is vendor-global, set on 4 of 18 vendors,
-- and is NEVER read by this layer. It is not migrated and not deleted; it stays where the
-- vendor calendar uses it.

CREATE TABLE IF NOT EXISTS public.vendor_delivery_rhythm (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     uuid        NOT NULL REFERENCES public.vendors(id),
  -- NOT NULL by design (see the comment block above). No all-shops inheritance, ever.
  location_id   uuid        NOT NULL REFERENCES public.locations(id),
  -- JS getDay convention, matching vendors.order_days and vendor_cutoffs.order_day:
  -- 0 = Sunday … 6 = Saturday.
  order_dow     smallint    NOT NULL CHECK (order_dow BETWEEN 0 AND 6),
  -- Calendar days from placing the order to the truck landing. 0 = same-day delivery.
  -- Capped at 14: anything longer is a standing order, not a rhythm, and would make the
  -- coverage window longer than the demand window that feeds it.
  lead_days     smallint    NOT NULL CHECK (lead_days BETWEEN 0 AND 14),
  -- DERIVED, never authored — one authority for the arithmetic.
  delivery_dow  smallint    GENERATED ALWAYS AS (((order_dow + lead_days) % 7)) STORED,
  active        boolean     NOT NULL DEFAULT true,
  created_by    uuid        NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
  -- One LIVE pair per (vendor, location, order day) — enforced by the partial unique index
  -- below rather than a table constraint, so a changed lead deactivates and re-adds
  -- (append-only) and the deactivated history stays readable.
);

CREATE UNIQUE INDEX IF NOT EXISTS vendor_delivery_rhythm_live_uq
  ON public.vendor_delivery_rhythm (vendor_id, location_id, order_dow)
  WHERE active;

CREATE INDEX IF NOT EXISTS vendor_delivery_rhythm_location_ix
  ON public.vendor_delivery_rhythm (location_id, vendor_id) WHERE active;

ALTER TABLE public.vendor_delivery_rhythm ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_delivery_rhythm FROM anon, authenticated;
REVOKE ALL ON public.vendor_delivery_rhythm FROM public;

COMMENT ON TABLE public.vendor_delivery_rhythm IS
  'Per-location order-day -> delivery-day PAIRS. The ONLY source of the coverage horizon. '
  'location_id is NOT NULL on purpose: no all-shops inheritance (a new shop must not silently '
  'inherit another shop''s trucks). vendors.delivery_days is legacy and is never read here.';

-- ── (2) VENDOR RHYTHM SKIPS — the one-off outage window ─────────────────────────────────
--
-- A vendor-down week is not par disagreement. Without this, a manager handling an outage by
-- ordering elsewhere reads to the machine as "the human keeps overriding the suggestion",
-- which burns budget and PIN state on an event that has nothing to do with the par.
-- Inclusive date range, append-only (retract = active=false).

CREATE TABLE IF NOT EXISTS public.vendor_rhythm_skips (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     uuid        NOT NULL REFERENCES public.vendors(id),
  location_id   uuid        NOT NULL REFERENCES public.locations(id),
  skip_from     date        NOT NULL,
  skip_through  date        NOT NULL,
  note          text        NULL,
  active        boolean     NOT NULL DEFAULT true,
  created_by    uuid        NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_rhythm_skips_range CHECK (skip_through >= skip_from)
);

CREATE INDEX IF NOT EXISTS vendor_rhythm_skips_lookup_ix
  ON public.vendor_rhythm_skips (location_id, vendor_id, skip_from, skip_through) WHERE active;

ALTER TABLE public.vendor_rhythm_skips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_rhythm_skips FROM anon, authenticated;
REVOKE ALL ON public.vendor_rhythm_skips FROM public;

-- ── (3) PAR AUTO MOVES — the nightly ledger, the guard's state home, the history drawer ──
--
-- ONE ROW PER (run_date, location, sku, day_class). 141 SKUs x 2 day-classes x 2 locations
-- = 564 rows a night. That volume is exactly why this is NOT the audit log: 282 audit rows
-- per location-night would be ~21x the entire audit log annually (r3). audit_log gets ONE
-- run-level row per (location, night); the detail lives here.
--
-- IDEMPOTENCE + APPEND-ONLY, RECONCILED. The nightly recompute deletes its own prior
-- opinions for (run_date, location) WHERE outcome <> 'applied' and re-inserts — the
-- materializeDailyDepletion pattern, so a Vercel retry cannot double-count a budget. An
-- 'applied' row records a REAL par write and is never deleted and never updated.
--
-- day_class, NOT "day slot": the budget, the band and the par columns all live at
-- weekday/weekend grain. r2 named it "day-slot"; r3 renamed it throughout. Two values only.

CREATE TABLE IF NOT EXISTS public.par_auto_moves (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date              date        NOT NULL,
  location_id           uuid        NOT NULL REFERENCES public.locations(id),
  sku_id                uuid        NOT NULL REFERENCES public.vendor_items(id),
  day_class             text        NOT NULL CHECK (day_class IN ('weekday','weekend')),
  -- 'shadow' = the write bit is off and the guard stack was SIMULATED. 'live' = graduated.
  mode                  text        NOT NULL CHECK (mode IN ('shadow','live')),
  -- Which tier this row belongs to, after the band decided.
  tier                  text        NOT NULL CHECK (tier IN ('auto','suggestion','none')),
  outcome               text        NOT NULL
                          CHECK (outcome IN ('would_apply','applied','suppressed','advisory_null')),
  -- Which guard stopped it. NULL unless outcome = 'suppressed'.
  suppressed_by         text        NULL
                          CHECK (suppressed_by IS NULL OR suppressed_by IN
                            ('band','budget','hysteresis','pin','slot_creation','below_band_resolution')),
  -- The closed reason vocabulary (lib/dynamic-pars-shared.ts ParReasonCode). Deliberately
  -- NO CHECK: the vocabulary is closed BY THE COMPILER on the write side (the same posture
  -- audit_log takes with AuditAction), and a DDL enum would force a migration per new cause.
  -- Always set — a row that produced a number carries 'ok'.
  reason_code           text        NOT NULL,
  -- Stable suggestion identity. NULL when no number was produced. A standing suggestion
  -- re-offered 14 nights keeps ONE generation id, so the trust ramp counts offers, not renders.
  generation_id         text        NULL,
  -- The numbers, all in ORDER UNITS (never oz).
  current_par           numeric     NULL,
  target_par            numeric     NULL,   -- the raw coverage target, pre-rounding
  suggested_par         numeric     NULL,   -- rounded to the step and clamped; what renders
  par_step              numeric     NULL,
  -- True when the day_class has no par slot on this SKU today: suggestion-only FOREVER.
  slot_creation         boolean     NOT NULL DEFAULT false,
  -- The demand terms, persisted so the walker can re-select a horizon at read time WITHOUT
  -- recomputing 21 days of history (R3-A: the horizon is a read-time pure SELECTION).
  base_rate_oz_per_day  numeric     NULL,
  observed_days         smallint    NULL,
  gap_days              smallint    NULL,
  velocity_ratio        numeric     NULL,
  cushion_pct           numeric     NULL,
  per_order_unit_oz     numeric     NULL,
  peak_floor_oz         numeric     NULL,
  -- The horizon THIS run computed with (the walker names its own, live).
  coverage_days         smallint    NULL,
  next_delivery_date    date        NULL,
  cover_through_date    date        NULL,
  -- The full why, for the history drawer and for forensics. Never parsed by the engine.
  detail                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  computed_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT par_auto_moves_run_uq UNIQUE (run_date, location_id, sku_id, day_class)
);

-- The walker's read: latest row per (location, sku, day_class).
CREATE INDEX IF NOT EXISTS par_auto_moves_walker_ix
  ON public.par_auto_moves (location_id, sku_id, day_class, run_date DESC);
-- The budget read: non-manual writes at one (sku, location, day_class) in a rolling 7 days.
CREATE INDEX IF NOT EXISTS par_auto_moves_budget_ix
  ON public.par_auto_moves (location_id, sku_id, day_class, run_date DESC)
  WHERE outcome IN ('applied','would_apply');

ALTER TABLE public.par_auto_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.par_auto_moves FROM anon, authenticated;
REVOKE ALL ON public.par_auto_moves FROM public;

-- ── (4) PAR SUGGESTION ACTIONS — one human verdict per generation, arbitrated by the index ─
--
-- THE UNIQUE INDEX IS THE CONCURRENCY GUARD. Two taps on one suggestion race; the loser gets
-- 23505 and the route maps it to 409 suggestion_already_actioned. Same move as the display-code
-- unique index arbitrating the double-generate race in lib/ordering.ts (noCodeSuffixRetry) —
-- proven on this exact surface by SIM-22.
--
-- This table is also (a) the trust ramp's numerator/denominator, counted in DISTINCT
-- GENERATIONS by construction, and (b) the PIN's state home ('revert' rows).

CREATE TABLE IF NOT EXISTS public.par_suggestion_actions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id    uuid        NOT NULL REFERENCES public.locations(id),
  sku_id         uuid        NOT NULL REFERENCES public.vendor_items(id),
  day_class      text        NOT NULL CHECK (day_class IN ('weekday','weekend')),
  generation_id  text        NOT NULL,
  action         text        NOT NULL CHECK (action IN ('accept','dismiss','revert')),
  -- Snapshotted so the ramp and the history drawer never re-derive a past offer.
  par_before     numeric     NULL,
  par_after      numeric     NULL,
  actor_id       uuid        NOT NULL REFERENCES public.users(id),
  acted_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT par_suggestion_actions_generation_uq
    UNIQUE (location_id, sku_id, day_class, generation_id)
);

CREATE INDEX IF NOT EXISTS par_suggestion_actions_ramp_ix
  ON public.par_suggestion_actions (location_id, acted_at DESC);

ALTER TABLE public.par_suggestion_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.par_suggestion_actions FROM anon, authenticated;
REVOKE ALL ON public.par_suggestion_actions FROM public;

-- ── (5) TOAST DAILY SALES SIGNALS — the day-grain catering marker (plan D4) ──────────────
--
-- WHY A SEPARATE TABLE AND NOT A FILTER. deriveSalesConsumption computes suspectedCatering
-- AFTER it has summed skuDirect over every counted line (lib/catering/toast-sales.ts:757).
-- Excluding suspect checks from the aggregation would change what direct_oz MEANS — the one
-- lane the double-count law protects. So the detector's verdict is recorded BESIDE the day,
-- at day grain, and the velocity layer reads it. direct_oz is byte-identical.
--
-- Written by materializeDailyDepletion inside its EXISTING idempotent (location, date)
-- delete-and-reinsert scope, so it inherits that function's re-pull safety for free.

CREATE TABLE IF NOT EXISTS public.toast_daily_sales_signals (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         uuid        NOT NULL REFERENCES public.locations(id),
  business_date       date        NOT NULL,
  -- Checks the shipped detector flagged (name hit or quantity threshold).
  suspect_check_count integer     NOT NULL DEFAULT 0 CHECK (suspect_check_count >= 0),
  suspect_qty         numeric     NOT NULL DEFAULT 0 CHECK (suspect_qty >= 0),
  -- The day's resolved sold-line quantity — volume CONTEXT for the ledger and for a future
  -- shop-level floor. The SHIPPED velocity volume floor uses the SKU's own order-units-per-day
  -- (dimensionally honest, needs no cross-SKU denominator), so nothing reads this yet.
  counted_qty         numeric     NOT NULL DEFAULT 0 CHECK (counted_qty >= 0),
  computed_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, business_date)
);

ALTER TABLE public.toast_daily_sales_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.toast_daily_sales_signals FROM anon, authenticated;
REVOKE ALL ON public.toast_daily_sales_signals FROM public;

-- ── (6) ADDITIVE COLUMNS — cushion class + par step, both per-SKU DATA ──────────────────
--
-- cushion_class: NO ENUM, NO CHECK — the 0177_vendor_price_history_provenance precedent
-- ("the vocabulary is expected to grow; pinning it in DDL now would force a migration per
-- source"). sku_class is raw/packaging and is NOT this taxonomy (verified live: two values
-- across 164 active SKUs). The PERCENTAGES stay in code; only the CLASS is tenant data.
--
-- par_step: the SKU's par quantum. NULL = infer from the standing pars' observed grain
-- (36 par'd SKUs are deliberately fractional, e.g. 0.25-case Dijon). The column is the
-- override, the inference is the bootstrap — no data entry required for correctness.

ALTER TABLE public.vendor_items
  ADD COLUMN IF NOT EXISTS cushion_class text    NULL,
  ADD COLUMN IF NOT EXISTS par_step      numeric NULL CHECK (par_step IS NULL OR par_step > 0);

COMMENT ON COLUMN public.vendor_items.cushion_class IS
  'Cushion policy class (protein/produce/dry/…). Deliberately un-enumerated. The percentage '
  'for each class lives in lib/dynamic-pars-shared.ts CUSHION_BY_CLASS; only the class is data.';
COMMENT ON COLUMN public.vendor_items.par_step IS
  'The par quantum in ORDER UNITS. NULL = inferred from the standing pars'' grain by '
  'parStepFor(). The band, the rounding and the below-resolution rule all speak in steps.';
```

- [ ] `npm run build` — SQL is not compiled, but the file must be committed alongside a green build.
- [ ] **DO NOT APPLY.** Record 🔒 GATE M1 in the PR body.

### Task 1.2 — `lib/vendor-rhythm-shared.ts`: the pure rhythm authority (TDD)

**Write `tests/vendor-rhythm-shared.test.ts` FIRST.** The cases that must exist before the implementation:

- [ ] `cutoffForOrderDay` picks a location-scoped row over an all-shops row; among equals it picks the earliest time; it returns `null` when no row matches **that dow** (not today's).
- [ ] `nextDeliveryAfter` at **9:58** on a Monday with a 10:00 Monday cutoff returns Monday's order → Tuesday's delivery; at **10:02** it rolls to the next order day.
- [ ] A vendor with **no rhythm rows** returns `null` (→ the caller degrades to delta-nudging; never a fabricated horizon).
- [ ] `coverageWindow` on PFG Mon/Wed/Fri + 1-day lead, walked Monday 9:58, returns `nextDelivery = Tue`, `coverThrough = Thu`, `coveredDays = [Tue, Wed]` — **two days, not one** (plan **D3**, builder r3 SC1).
- [ ] The same walk at 10:02 returns `nextDelivery = Thu`, `coverThrough = Sat`, `coveredDays = [Tue, Wed, Thu, Fri]` — the 9:58/10:02 pair renders **different, both correct** numbers.
- [ ] A `coveredDays` list that straddles Thursday→Friday contains both day-classes, so the caller can sum per day-class (never rate × days).
- [ ] An active skip window covering Tuesday pushes `nextDelivery` to the following delivery and lengthens `coveredDays` accordingly.
- [ ] `optimizationWalkDate("weekend", runDate)` returns the **Friday** of the coming weekend block; `("weekday", runDate)` returns the next weekday.
- [ ] A single-order-day vendor (one pair) yields `coverThrough = nextDelivery + 7`.

Then create `lib/vendor-rhythm-shared.ts`:

```ts
/**
 * Vendor delivery rhythm — PURE (client-safe, zero I/O, no server imports; the
 * `*-shared.ts` pattern, AGENTS.md). THE one authority for "when is the next truck,
 * and what must a par survive until the one after that".
 *
 * ── WHY THIS IS NOT `governingCutoffTime` (head ruling R3-A) ────────────────────
 * lib/ordering.ts's `governingCutoffTime` answers a DISPLAY question — "what deadline
 * chip do I put on this vendor's header today?" — and its earliest-of-today tiebreak
 * is right for that and wrong for this. The rhythm needs the cutoff for a SPECIFIC
 * candidate order day, which may not be today. `cutoffForOrderDay` is dow-parameterised
 * and shares only the location-most-specific rule. The two never call each other.
 *
 * ── THE COVERAGE WINDOW ENDS AT THE SECOND-NEXT DELIVERY (plan D3) ─────────────
 * Order-up-to-par is a base-stock policy. At the walk the shelf is raised to `par`; the
 * order placed now arrives at D1; the NEXT chance to replenish is D2. So `par` must cover
 * consumption over [walk, D2) — lead time PLUS the review interval. Covering only
 * [walk, D1) under-orders by the whole inter-delivery gap (~50% on the main path).
 *
 * Two stated modelling assumptions, both pinned by tests:
 *   · the walk happens AFTER the walk day's service (shops walk in the evening), so the
 *     walk date itself is not a covered day;
 *   · a delivery lands in the morning, before service, so the coverage tail stops the day
 *     BEFORE coverThrough.
 * Covered days are therefore exactly { d : walkDate < d < coverThrough }.
 */
import { etDayFromDate } from "@/lib/et-day-shared";

/** One authored order→delivery pair, per (vendor, location). */
export interface RhythmRow {
  vendorId: string;
  locationId: string;
  /** JS getDay convention: 0 = Sunday … 6 = Saturday. */
  orderDow: number;
  /** Calendar days from order to truck. 0 = same-day. */
  leadDays: number;
}

/** A `vendor_cutoffs` row as the rhythm reads it. `locationId` null = both shops. */
export interface CutoffRow {
  locationId: string | null;
  orderDay: number;
  /** Bare "HH:MM[:SS]" ET wall clock. */
  cutoffTime: string;
}

/** An active outage window; inclusive on both ends. */
export interface RhythmSkip {
  vendorId: string;
  /** "YYYY-MM-DD" */
  skipFrom: string;
  /** "YYYY-MM-DD" */
  skipThrough: string;
}

export interface CoverageWindow {
  /** The delivery the order placed at this walk will arrive on. */
  nextDeliveryDate: string;
  /** The delivery AFTER that — what this par must carry the shop to. */
  coverThroughDate: string;
  /** Every ET calendar day strictly between the walk date and coverThroughDate. */
  coveredDays: string[];
  /** The order day the walk is placing against (may be a later day than the walk). */
  orderDateEt: string;
}

/** Add n days to a "YYYY-MM-DD" ET calendar date. Pure grid math — DST-safe. */
export function addDaysEt(dateEt: string, n: number): string {
  const [y, m, d] = dateEt.split("-").map(Number);
  if (!y || !m || !d) return dateEt;
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The governing cutoff for a SPECIFIC order dow at a location. Location-scoped rows beat
 * all-shops rows; among the survivors the EARLIEST time governs (it is the binding
 * deadline). Returns the bare time string, or null when nothing governs that dow.
 * Pure over the passed rows — deliberately NOT lib/ordering.ts's governingCutoffTime.
 */
export function cutoffForOrderDay(
  rows: ReadonlyArray<CutoffRow>,
  locationId: string,
  dow: number,
): string | null {
  const onDay = rows.filter((r) => r.orderDay === dow);
  if (onDay.length === 0) return null;
  const scoped = onDay.filter((r) => r.locationId === locationId);
  const pool = scoped.length > 0 ? scoped : onDay;
  return [...pool].sort((a, b) => a.cutoffTime.localeCompare(b.cutoffTime))[0]?.cutoffTime ?? null;
}

/** Minutes-of-day for a bare "HH:MM[:SS]". Malformed → null (never fabricate a deadline). */
export function cutoffMinutes(time: string): number | null {
  const parts = time.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? "0");
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(m) || m < 0 || m > 59) return null;
  return h * 60 + Math.floor(m);
}

function isSkipped(dateEt: string, skips: ReadonlyArray<RhythmSkip>): boolean {
  return skips.some((s) => dateEt >= s.skipFrom && dateEt <= s.skipThrough);
}

export interface NextDeliveryInput {
  rhythm: ReadonlyArray<RhythmRow>;
  cutoffs: ReadonlyArray<CutoffRow>;
  skips: ReadonlyArray<RhythmSkip>;
  locationId: string;
  /** The ET calendar date of the walk. */
  walkDateEt: string;
  /** Minutes-of-day of the walk in ET. Compared against the day's cutoff. */
  walkMinutesEt: number;
  /** How far to look before giving up. 21 days covers every sane weekly rhythm. */
  horizonDays?: number;
}

/**
 * The next order opportunity ON OR AFTER the walk instant, and the delivery it produces.
 *
 * A candidate order day qualifies when (a) an active rhythm pair exists for that dow and
 * (b) either the day is in the future, or it is today AND the walk is at or before that
 * dow's cutoff. No cutoff row for a qualifying dow means the deadline is unknown — we treat
 * TODAY as already missed (the conservative read: never promise a truck we cannot prove
 * the shop can still catch) and future days as available.
 *
 * Returns null when no rhythm is authored, or when nothing qualifies inside the horizon —
 * the caller then degrades to honest delta-nudging with NO coverage claim.
 */
export function nextDeliveryAfter(
  input: NextDeliveryInput,
): { orderDateEt: string; deliveryDateEt: string } | null {
  const horizon = input.horizonDays ?? 21;
  if (input.rhythm.length === 0) return null;
  const byDow = new Map<number, RhythmRow>();
  for (const r of input.rhythm) if (!byDow.has(r.orderDow)) byDow.set(r.orderDow, r);

  for (let offset = 0; offset <= horizon; offset += 1) {
    const orderDateEt = addDaysEt(input.walkDateEt, offset);
    const { dow } = etDayFromDate(orderDateEt);
    const pair = byDow.get(dow);
    if (pair == null) continue;
    if (offset === 0) {
      const bare = cutoffForOrderDay(input.cutoffs, input.locationId, dow);
      const mins = bare != null ? cutoffMinutes(bare) : null;
      // Unknown or passed deadline → today's order day is not available.
      if (mins == null || input.walkMinutesEt > mins) continue;
    }
    const deliveryDateEt = addDaysEt(orderDateEt, pair.leadDays);
    if (isSkipped(deliveryDateEt, input.skips)) continue;
    return { orderDateEt, deliveryDateEt };
  }
  return null;
}

/**
 * The full coverage window for a walk: the delivery this order lands on, the delivery AFTER
 * it (what the par must carry the shop to — plan D3), and every ET day in between.
 *
 * Implemented as two chained nextDeliveryAfter calls, so there is exactly one place that
 * knows about cutoffs, skips and leads. The second call is anchored the day AFTER the first
 * delivery with a walk time of 00:00, because by then the shop is unambiguously ordering
 * against a future day (the cutoff question only ever applies to the walk day itself).
 */
export function coverageWindow(input: NextDeliveryInput): CoverageWindow | null {
  const first = nextDeliveryAfter(input);
  if (first == null) return null;
  const second = nextDeliveryAfter({
    ...input,
    walkDateEt: addDaysEt(first.orderDateEt, 1),
    walkMinutesEt: 0,
  });
  // A single-order-day vendor still has a second truck: one week later.
  const coverThroughDate = second?.deliveryDateEt ?? addDaysEt(first.deliveryDateEt, 7);
  const coveredDays: string[] = [];
  for (let d = addDaysEt(input.walkDateEt, 1); d < coverThroughDate; d = addDaysEt(d, 1)) {
    coveredDays.push(d);
  }
  return {
    orderDateEt: first.orderDateEt,
    nextDeliveryDate: first.deliveryDateEt,
    coverThroughDate,
    coveredDays,
  };
}

/**
 * Which walk day a day-class's NIGHTLY suggestion should optimise for.
 *
 * The weekend slot is ONE number governing three walks (Fri/Sat/Sun) whose horizons differ,
 * and the machine gets one move per week — so it optimises the LONGEST gap, which is the
 * Friday walk (r3). Per-walk-day nuance is not lost: the rendered suggestion re-selects the
 * horizon live at walk time (R3-A), so a Sunday walker sees Sunday's answer.
 */
export function optimizationWalkDate(dayClass: "weekday" | "weekend", runDateEt: string): string {
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = addDaysEt(runDateEt, offset);
    const { dow, weekend } = etDayFromDate(candidate);
    if (dayClass === "weekend" && dow === 5) return candidate; // Friday — the longest gap.
    if (dayClass === "weekday" && !weekend) return candidate;
  }
  return runDateEt;
}
```

- [ ] `npm test -- vendor-rhythm-shared` green.

### Task 1.3 — `lib/vendor-rhythm.ts`: loaders + writers (GM+ / AGM+, mirroring the cutoffs surface)

- [ ] Create `lib/vendor-rhythm.ts` with `VendorRhythmError` (status/code, the `AdminVendorError` shape), `RHYTHM_WRITE_MIN = 7` and `RHYTHM_APPEND_MIN = 6` (the exact floors `vendor.cutoff_change` already uses: *"add = AGM+, deactivate = GM+"*, `lib/destructive-actions.ts:84`).
- [ ] `loadRhythmByVendor(sb, vendorIds, locationId)` → `Map<vendorId, RhythmRow[]>` — ONE batched query, `.eq("location_id", locationId).eq("active", true)`. Empty map on a schema-pending probe failure (see 1.5).
- [ ] `loadRhythmSkips(sb, vendorIds, locationId, fromDate)` → `Map<vendorId, RhythmSkip[]>` — one query, `active`, `skip_through >= fromDate`.
- [ ] `setVendorRhythmPair(actor, { vendorId, locationId, orderDow, leadDays })` — append-only: deactivate the live row for that `(vendor, location, orderDow)` then insert. Check `count` on the UPDATE and return an explicit 404 on 0 (**the silent-UPDATE-denial law**). Audit `vendor.full_profile_edit` with `metadata.scope = "delivery_rhythm"` — the exact precedent `setVendorSchedule` sets (`lib/admin/vendors.ts:1043`); do **not** mint a new action for a vendor-profile edit.
- [ ] `deactivateVendorRhythmPair(actor, id)` — GM+; `active = false`; same audit scope.
- [ ] `addRhythmSkip` / `deactivateRhythmSkip` — same shape, `metadata.scope = "rhythm_skip"`.
- [ ] Every writer calls `assertLocationActive(locationId)` and binds the location via `lockLocationContext` — a rhythm row is location-scoped config and an admin must not author one for a shop they do not hold.

### Task 1.4 — The rhythm authoring UI on the EXISTING vendor page

**No new admin surface** (`AGENTS.md` read-surfaces-over-new-workflows; spec §Surfaces). The vendor detail page already carries a `Card` for the weekly schedule (`components/admin/vendors/VendorDetailClient.tsx:552`, `DayStrip` for order/delivery days) and a `CollapsibleSection` for cutoffs with a location select (`:840`).

- [ ] Create `components/admin/vendors/VendorRhythmCard.tsx` — a `CollapsibleSection` (idBase `vendor-rhythm-${vendorId}`, D5 count header) rendering, per location: the authored pairs as rows ("Order **Mon** → arrives **Tue** (1-day lead)"), a delete affordance (GM+), and an add form: **location select** (required, no "Both" option — the table forbids it and the select must not offer what the schema refuses), **order-day select**, **lead-days number input** (0–14). Derived delivery day is rendered live from the pure `addDaysEt`, never typed.
- [ ] The card renders a plain-language explainer sourced from the reason lane's vocabulary: *"Until a rhythm is set for a shop, that shop's pars can't be given a coverage number — the walk will say so."*
- [ ] A **skip** affordance beneath: "Vendor down — skip deliveries from … through …", with the note field. Copy names the consequence: *"Suggestions will stretch to the next truck for this window instead of reading your workaround as disagreement."*
- [ ] Mount it in `VendorDetailClient.tsx` directly beneath the existing schedule `Card`, passing `locations` (already a prop, `:75`) and the loaded rhythm.
- [ ] Grammar: **admin-form** (`rounded-lg`, 44px, `border-co-gold-deep`, control labels `tracking-[0.1em]`), 44px floor with `items-center`, `co-warning-text` for the "no rhythm yet" note. Never mix in `ActionButton`'s operational grammar on this page.
- [ ] i18n: en + es for every string and every ARIA label in this task's PR (keys listed in Task 4.8).

### Task 1.5 — Pre-apply degradation: the `0182` probe

- [ ] In `lib/vendor-rhythm.ts`, add the probe exactly as `countProductAllocationReady` does (`lib/counts.ts:136-154`): one `select("id").limit(1)` against `vendor_delivery_rhythm`, cache **only** `true`, re-probe while false, `console.warn` once naming migration `0182` and GATE M1.
- [ ] Pre-apply behaviour, asserted by a task-level smoke: `loadRhythmByVendor` returns an **empty map**; the rhythm card renders its own "schema pending" empty state (never a 500); `nextDeliveryAfter` therefore returns `null`; **`loadWalkerData` is byte-identical** because Phase 1 adds no call from it.
- [ ] Add the same probe shape for `par_auto_moves` in `lib/dynamic-pars.ts` when Phase 3 lands (Task 3.9).

### Task 1.6 — Cushion class + par step authoring on the SKU admin

- [ ] `lib/admin/skus.ts`: add `cushionClass` and `parStep` to `SKU_COLS`, the row type, the view mapper, and `updateSku`'s change set (`normalizePar`-style validators: `cushion_class` trimmed to ≤40 chars or null; `par_step` finite `> 0` or null). Existing audit action `vendor_item.update` — no new name.
- [ ] Surface both on the existing SKU edit form as one small "Ordering rhythm" group: a **free-text-with-datalist** cushion class (never a hard select — the vocabulary is deliberately un-enumerated, plan **D6**) and a par-step numeric input with the inferred value shown as the placeholder ("auto: 0.25").
- [ ] i18n both, en + es.

### Task 1.7 — Phase 1 close

- [ ] `npm test` green · `npm run build` green · discipline check clean.
- [ ] PR body records: migration `0182` **authored, not applied**; the 🔒 M1 gate; the pre-apply smoke result; the byte-identical-walker claim with the evidence (no new call site in `lib/ordering.ts`).
- [ ] 🔒 **GATE M1 — the lead applies `0182`.** Then: Juan authors PFG's and Boar's Head's real rhythm at both shops, and hand-checks `nextDeliveryAfter` for each day of one week.

---

## PHASE 2 — the demand core (pure)

*Goal: every rule named in the four spec layers exists as a tested pure function. Zero call sites, zero I/O, nothing renders. This phase is unshippable-in-the-sense-of-invisible and shippable-in-the-sense-of-safe.*

> **TDD is not optional here.** Each task below names its test cases first; write them, watch them fail, then implement. The council's own record is that this design's defects were arithmetic, found by walking real numbers — the test file *is* the guard against re-introducing them.

### Task 2.1 — Config constants + primitives

- [ ] Create `lib/dynamic-pars-shared.ts` opening with the module doc and the tunables. **Every tunable is config-in-code with its rationale, per the spec's repeated "constant, config-in-code" instruction.**

```ts
/**
 * DYNAMIC PARS — the pure demand, coverage and guard core.
 *
 * PURE: client-safe, zero I/O, no server imports (the `*-shared.ts` pattern, AGENTS.md).
 * Both the nightly engine (lib/dynamic-pars.ts) and the walker's read path import from here,
 * so there is exactly ONE spelling of every rule.
 *
 * ── THE TWO HALVES, AND WHY THEY ARE SPLIT (head ruling R3-A) ──────────────────
 *   computeBaseRate / computeVelocityRatio  — HEAVY (21 days x 141 SKUs x 2 lanes).
 *                                             Nightly only; the terms are persisted.
 *   computeCoverageSuggestion / guards      — TRIVIAL (arithmetic over ~10 numbers).
 *                                             Nightly AND at walk-time render.
 * The coverage horizon is a READ-TIME pure SELECTION over persisted terms. That is what
 * makes the 9:58 and the 10:02 walk render different, both-correct numbers from one ledger
 * row, and it is why the walker's read path costs one batched query and no re-derivation.
 *
 * ── THE DOUBLE-COUNT LAW IS NOT IN PLAY, AND THAT IS DELIBERATE ────────────────
 * Consumed oz = production_inputs.input_oz + toast_daily_depletion.direct_oz. NEVER
 * flattened_oz. This module reads flattened oz for exactly ONE purpose — detecting that a
 * SKU's demand is PREP-MEDIATED, i.e. that its true consumption lives in a lane that is
 * currently dark — and never sums it into anything. Same two lanes as loadSkuUsageRank
 * (lib/ordering.ts:314-395) and the counts drift consumed term.
 *
 * ── EVERYTHING IS PER-LOCATION AND PER-DAY-CLASS ───────────────────────────────
 * There is no global par math anywhere in this module. "day-class" is weekday | weekend
 * with the SHIPPED boundary (weekend = Fri/Sat/Sun, lib/et-day-shared.ts isWeekendParDow):
 * the base, the par columns, the band, the budget and the PIN all share one boundary.
 * r2 called this grain "day-slot"; r3 renamed it "day-class" throughout. Two values, ever.
 */
import { etDayFromDate } from "@/lib/et-day-shared";

export type DayClass = "weekday" | "weekend";

/**
 * Every tunable this arc owns, with the reason it has the value it has. Config-in-code by
 * spec instruction: these are BEHAVIOUR, and behaviour lives in code (AGENTS.md tenant law).
 * Only the cushion CLASS and the par STEP are per-SKU data.
 */
export const DYNAMIC_PARS = {
  /** Trailing base window. Deliberately different from usageRank's 30-day sort window
   *  (lib/ordering.ts:337) — that ranks what to walk first, this estimates a rate.
   *  21 days at CO's shipped boundary = 12 weekday + 9 weekend points (probed live). */
  BASE_WINDOW_DAYS: 21,
  /** Per-day-class thin thresholds. A weekday rate wants ~2/3 of its 12 points; a weekend
   *  rate wants ~2/3 of its 9. Below this the base is advisory-null, never a thin guess. */
  MIN_OBSERVED_DAYS: { weekday: 8, weekend: 6 } as Record<DayClass, number>,

  /** Velocity is a bounded, dimensionless RATIO on the residual above trend — never an oz
   *  term, so it cannot enter an oz sum by construction (r1-6, opus). */
  VELOCITY_CAP: 0.25,
  /** A residual smaller than this is noise, not momentum. */
  VELOCITY_DEADBAND: 0.10,
  /** Consecutive same-sign days required before momentum is believed (r1-6). */
  VELOCITY_MIN_PERSISTENCE_DAYS: 3,
  /** How far back the residual run may be sought. */
  VELOCITY_LOOKBACK_DAYS: 7,
  /** The volume floor, in ORDER UNITS PER DAY (r2-10: "a sustained 3-item/day +200% ratio
   *  passes time but not volume"). Expressed in the SKU's own terms so it is dimensionally
   *  honest and needs no new data. Live check: Oregano 0.40 u/d and Prosciutto 1.21 u/d
   *  clear it; Thyme 0.075 u/d and Salt 0.008 u/d do not — which is the intended verdict. */
  VELOCITY_MIN_UNITS_PER_DAY: 0.10,

  /** The band's percentage half. The magnitude is max(1 step, BAND_PCT x par), and the cap
   *  clamps AFTER rounding (projects r3 P2-2). */
  BAND_PCT: 0.25,
  /** Pars below this many STEPS are below the band's resolution: manual-only, suggestion
   *  labelled as such (r3). At CO this is 108 of 141 pars, and that is the honest answer. */
  MIN_STEPS_FOR_AUTO: 4,

  /** ONE non-manual par write per (sku, location, day-class) per rolling window. Consumed by
   *  auto-writes and by reverts; a human ACCEPT is free — the incentive must never punish
   *  engagement (r2-8, final form). */
  BUDGET_WINDOW_DAYS: 7,
  BUDGET_MOVES: 1,

  /** Integer/step rounding of a continuous target oscillates forever without this: the
   *  direction must be confirmed across two consecutive nightly runs (r1-6). */
  HYSTERESIS_CONFIRM_RUNS: 2,
  /** A standing SUGGESTION only changes when the new candidate is this many steps away —
   *  the walker may not read 12 -> 1 Monday and 12 -> 2 Tuesday (r3). */
  SUGGESTION_DEADBAND_STEPS: 1,

  /** The Fresh-Mozz eaches-vs-cases bomb: a target outside this multiple of the standing par
   *  is a UNIT problem, not a demand problem. Reason row, never a number (r3). */
  UNIT_SUSPECT_LOW: 0.5,
  UNIT_SUSPECT_HIGH: 2.0,

  /** The peak-coverage floor: a percentage on a mean is not a service level (the Prosciutto
   *  proof — mean+20% suggested a par the worst observed weekend cleared by 2%). Until the
   *  statistical socket is filled, a suggestion may never fall below the observed peak run
   *  over the horizon length. Quantile, with max() when there are too few runs to rank. */
  PEAK_QUANTILE: 0.9,
  PEAK_MIN_RUNS_FOR_QUANTILE: 5,

  /** Trust ramp: N accepted of M offered inside the window, counted in DISTINCT GENERATIONS
   *  (r2-2 + r3). A post-graduation revert counts against standing. */
  TRUST_RAMP_ACCEPTS: 10,
  TRUST_RAMP_WINDOW_DAYS: 90,

  /** Sibling prior (NOT WIRED IN v1 — the seam only; Add-a-Location owns the rest). */
  SIBLING_QUALIFYING_DAYS: 21,
} as const;

/** Cushion is POLICY, not statistic. The CLASS is per-SKU data; these percentages are code. */
export const CUSHION_BY_CLASS: Readonly<Record<string, number>> = {
  protein: 0.20,
  produce: 0.30,
  dairy: 0.25,
  bakery: 0.30,
  dry: 0.15,
  frozen: 0.10,
};
/** Used when a SKU has no class yet. Conservative, and it NEVER silences a suggestion —
 *  cushion is third on the data critical path, behind weight and rhythm (r2-13). */
export const CUSHION_DEFAULT = 0.20;

/** Kill float drift at the step grain (0.1 + 0.2 must not become 0.30000000000000004). */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Round a value to the nearest multiple of `step`. `step` must be > 0. */
export function roundToStep(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  return round6(Math.round(value / step) * step);
}

/** The day-class of an ET calendar date, through the SHIPPED boundary. One home, forever. */
export function dayClassForDate(dateEt: string): DayClass {
  return etDayFromDate(dateEt).weekend ? "weekend" : "weekday";
}

/**
 * The SKU's par quantum in order units (plan D7).
 *   explicit `parStep` (authored) ?? inferred from the standing pars' observed grain.
 * Inference: a .25/.75 fraction on either par => 0.25 · a .5 fraction => 0.5 · else 1.
 * 36 par'd SKUs are deliberately fractional, so the inference is what makes the band correct
 * on day one with zero data entry; the column is the override.
 */
export function parStepFor(input: {
  parStep: number | null;
  weekdayPar: number | null;
  weekendPar: number | null;
}): number {
  if (input.parStep != null && input.parStep > 0) return input.parStep;
  const fracs = [input.weekdayPar, input.weekendPar]
    .filter((p): p is number => p != null)
    .map((p) => round6(Math.abs(p % 1)));
  if (fracs.some((f) => f > 0 && Math.abs(f - 0.5) > 1e-6)) return 0.25;
  if (fracs.some((f) => Math.abs(f - 0.5) <= 1e-6)) return 0.5;
  return 1;
}

/**
 * Order-up-to-par quantity from a par and an advisory on-hand in order units.
 * BYTE-IDENTICAL to lib/ordering.ts buildRow's suggestion math (`:728`) — lifted here so the
 * client can live-recompute it after an accept without minting a second opinion (r1: the
 * numeric suggestion and the order qty are ONE engine, and accepting recomputes the qty).
 */
export function suggestedOrderQty(par: number, advisoryOrderUnits: number | null): number | null {
  if (advisoryOrderUnits == null) return null;
  return Math.max(Math.ceil(par - advisoryOrderUnits), 0);
}
```

- [ ] Tests (`tests/dynamic-pars-guards.test.ts`, opening block): `roundToStep(2.6, 0.25) === 2.5`; `roundToStep(0.1 + 0.2, 0.25) === 0.25` (drift); `parStepFor` returns `0.25` for a 0.25 par, `0.5` for a 1.5 par, `1` for 3, and honours an explicit `par_step`; `suggestedOrderQty(3, null) === null`, `(3, 1.2) === 2`, `(3, 4) === 0`.

### Task 2.2 — The base rate (day-class, observed-day denominators, clamps, gaps)

**Tests first** (`tests/dynamic-pars-base.test.ts`):

- [ ] Weekday and weekend rates are computed **separately** and a SKU with only weekday data yields `weekend: null`, never a blended number.
- [ ] The denominator is **observed days**, not window days: a window of 21 with 4 shop-closed/no-event days divides by 17, split per day-class.
- [ ] **`lane_start_at` clamp (r2-5):** a lane that began 3 days ago inside a 21-day window yields `observedDays = 3`, not 21 — the other 18 are structural zeros, not measurements.
- [ ] **`lane_start_at` NULL ⇒ advisory-null** with `no_lane_start` (r3), never a zero rate.
- [ ] **Full-gap day (plan D10):** a day with no sales events AND no productions is EXCLUDED and counted into `gapDays`; a day with events but no depletion row for this SKU is a **true zero** and IS counted.
- [ ] Thin: 5 observed weekday points is `thin: true` (below 8) and the rate is still returned so the caller can report `thin_history` — the caller silences, not the rate.
- [ ] **Prep-mediation detection:** a SKU with `flattenedOz > 0` and zero production oz reports `laneComplete: false`; `flattenedOz` is never added to any sum (assert the returned rate equals the direct-only sum).
- [ ] Product-grain: the caller passes already-rolled-up maps; assert the function is agnostic (one test that a twin's oz appears once).

**Then implement:**

```ts
/** One calendar day of the window, with the two observability oracles resolved. */
export interface WindowDay {
  dateEt: string;
  dayClass: DayClass;
  /** The register produced ANY selection that day at this location — the full-gap oracle
   *  (plan D10). A day with events but no depletion row for this SKU is a TRUE ZERO. */
  salesObserved: boolean;
  /** A live production was recorded that day at this location. */
  productionObserved: boolean;
}

export interface BaseRateInput {
  /** Oldest first, one entry per calendar day in the window. */
  window: ReadonlyArray<WindowDay>;
  /** PRODUCT-grain direct-lane oz keyed by ET date (twins already rolled up — a primary flip
   *  must not read as demand collapse, r1-3). */
  directOzByDate: ReadonlyMap<string, number>;
  /** PRODUCT-grain production-lane oz (production_inputs.input_oz) keyed by ET date. */
  productionOzByDate: ReadonlyMap<string, number>;
  /** Flattened oz — read ONLY to detect prep-mediation. NEVER summed. The double-count law. */
  flattenedOzByDate: ReadonlyMap<string, number>;
  /** The first ET date this SKU's lane could produce data at this location. null = never. */
  laneStartAt: string | null;
}

export interface DayClassRate {
  ozPerDay: number | null;
  observedDays: number;
  gapDays: number;
  thin: boolean;
}

export interface BaseRateResult {
  byDayClass: Record<DayClass, DayClassRate>;
  /** False when this SKU's demand is prep-mediated and the production lane is dark — a
   *  HALF-SEEN base, which is silently low and therefore worse than null (r1 V5). */
  laneComplete: boolean;
  /** True when no lane has ever started here — the honest-null root cause (r3). */
  laneNeverStarted: boolean;
  /** The observed daily series, oldest first — the velocity layer and the peak floor read it. */
  series: Array<{ dateEt: string; dayClass: DayClass; oz: number }>;
}

const EMPTY_RATE: DayClassRate = { ozPerDay: null, observedDays: 0, gapDays: 0, thin: true };

/**
 * The trailing base rate, per day-class, over OBSERVED days only.
 *
 * Three exclusions, each for a different reason and each counted separately:
 *   · before `laneStartAt`     — the lane did not exist; those days are structural zeros,
 *                                not measurements (r2-5, the LONGITUDINAL clamp).
 *   · full-gap days            — neither oracle fired; the shop's data is missing, not its
 *                                demand. EXCLUDE the day, never null the window (r3).
 *   · nothing else             — a day the register ran and this SKU did not move is a TRUE
 *                                ZERO and belongs in the denominator AND the numerator.
 */
export function computeBaseRate(input: BaseRateInput): BaseRateResult {
  const byDayClass: Record<DayClass, DayClassRate> = {
    weekday: { ...EMPTY_RATE },
    weekend: { ...EMPTY_RATE },
  };
  const series: BaseRateResult["series"] = [];
  if (input.laneStartAt == null) {
    return { byDayClass, laneComplete: false, laneNeverStarted: true, series };
  }

  const sums: Record<DayClass, number> = { weekday: 0, weekend: 0 };
  let flattenedSeen = 0;
  let productionSeen = 0;

  for (const day of input.window) {
    if (day.dateEt < input.laneStartAt) continue; // longitudinal clamp — not a zero.
    if (!day.salesObserved && !day.productionObserved) {
      byDayClass[day.dayClass].gapDays += 1;
      continue; // full gap — the data is missing, not the demand.
    }
    const direct = input.directOzByDate.get(day.dateEt) ?? 0;
    const production = input.productionOzByDate.get(day.dateEt) ?? 0;
    flattenedSeen += input.flattenedOzByDate.get(day.dateEt) ?? 0;
    productionSeen += production;
    const oz = direct + production; // the two lanes. flattened_oz is NEVER here.
    sums[day.dayClass] += oz;
    byDayClass[day.dayClass].observedDays += 1;
    series.push({ dateEt: day.dateEt, dayClass: day.dayClass, oz });
  }

  for (const dc of ["weekday", "weekend"] as const) {
    const seen = byDayClass[dc].observedDays;
    byDayClass[dc].thin = seen < DYNAMIC_PARS.MIN_OBSERVED_DAYS[dc];
    byDayClass[dc].ozPerDay = seen > 0 ? round6(sums[dc] / seen) : null;
  }

  // Prep-mediated demand with a dark production lane = a half-seen base. Live today this is
  // EVERY prep-mediated SKU, because production_inputs has 0 rows.
  const prepMediated = flattenedSeen > 0;
  return {
    byDayClass,
    laneComplete: !prepMediated || productionSeen > 0,
    laneNeverStarted: false,
    series,
  };
}
```

### Task 2.3 — The peak-coverage floor

**Tests** (`tests/dynamic-pars-coverage.test.ts`):

- [ ] With 20 daily values and a 2-day horizon, `observedPeakCoverageOz` returns the p90 of the 19 consecutive 2-day sums.
- [ ] With 4 values and a 3-day horizon (2 runs), it returns the **max** run, not a quantile.
- [ ] Fewer values than the horizon → `null` (no floor claim).
- [ ] **The Prosciutto proof:** a mean-based target that the worst observed run beats is raised to that run — assert `flooredByPeak: true`.

```ts
/**
 * The observed PEAK coverage over a horizon of `runLength` days, in oz.
 *
 * WHY: a percentage on a mean is not a service level. The council's Prosciutto walk showed
 * mean + 20% producing a par the WORST observed weekend cleared by 2% — i.e. a cushion that
 * covers the average and fails the day it was bought for. Until the statistical socket
 * (z x sigma x sqrt(lead)) has variance-worthy history to fill it, the floor is empirical:
 * whatever the shop has actually had to survive over a window this long.
 *
 * p90 rather than max once there are enough runs to rank, so one catering-shaped outlier
 * cannot permanently inflate a par; max below that, because with 4 runs a "p90" is a max
 * wearing a costume.
 */
export function observedPeakCoverageOz(
  dailyOz: ReadonlyArray<number>,
  runLength: number,
): number | null {
  if (runLength <= 0 || dailyOz.length < runLength) return null;
  const runs: number[] = [];
  for (let i = 0; i + runLength <= dailyOz.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < runLength; j += 1) sum += dailyOz[i + j] ?? 0;
    runs.push(sum);
  }
  if (runs.length === 0) return null;
  runs.sort((a, b) => a - b);
  if (runs.length < DYNAMIC_PARS.PEAK_MIN_RUNS_FOR_QUANTILE) return round6(runs[runs.length - 1]!);
  const idx = Math.min(runs.length - 1, Math.ceil(DYNAMIC_PARS.PEAK_QUANTILE * runs.length) - 1);
  return round6(runs[Math.max(idx, 0)]!);
}
```

### Task 2.4 — Velocity (residual, both gates, reset, suspect-day exclusion)

**Tests** (`tests/dynamic-pars-velocity.test.ts`):

- [ ] A flat series returns `ratio: 1` and `applied: false` with `reason: "no_persistence"`.
- [ ] A **+40% step sustained 3 days** returns `applied: true`, `ratio > 1`, capped at `1 + VELOCITY_CAP`.
- [ ] Two up days and one down day inside the run → `no_persistence` (the run must be consecutive and same-signed).
- [ ] A series whose mean daily oz is below `VELOCITY_MIN_UNITS_PER_DAY × perOrderUnitOz` returns `volume_floor` — assert with **Thyme's live numbers** (0.56 oz/day, 7.52 oz unit = 0.075 u/d) and the complement with **Oregano's** (38.4 oz/day, 96 oz unit = 0.40 u/d).
- [ ] A `recipeEditedAt` inside the lookback **resets the series**: days at or before the edit are dropped, and if fewer than the persistence requirement remain, `applied: false` with `recipe_edited`.
- [ ] **Suspect-day exclusion (plan D4):** a day flagged by `toast_daily_sales_signals` is dropped from the residual run, and dropping it can break persistence — assert a +200% single catering day does NOT produce momentum.
- [ ] **Signals clamp:** days before `signalsStartAt` are excluded; too few remaining → `signals_too_new`.
- [ ] The returned value is **dimensionless** — assert the type carries no oz and that `ratio` multiplies, never adds (a compile-level guarantee reinforced by a test that a null base yields `applied: false`).

```ts
export type VelocityGateReason =
  | "no_base"
  | "no_persistence"
  | "volume_floor"
  | "recipe_edited"
  | "signals_too_new";

export interface VelocityDay {
  dateEt: string;
  dayClass: DayClass;
  oz: number;
  /** The day's catering-suspicion marker (plan D4). Unknown days are `false` + clamped out. */
  suspect: boolean;
}

export interface VelocityInput {
  /** Oldest first — normally BaseRateResult.series enriched with the suspect flag. */
  series: ReadonlyArray<VelocityDay>;
  baseByDayClass: Record<DayClass, number | null>;
  /** oz of one order unit — the volume floor's denominator. */
  perOrderUnitOz: number | null;
  /** ET date of the most recent recipe edit touching this SKU or its product. */
  recipeEditedAt: string | null;
  /** First ET date a sales-signal row exists at this location (plan D4's clamp). */
  signalsStartAt: string | null;
}

export interface VelocitySignal {
  /** 1.0 = no momentum. Bounded to [1 - CAP, 1 + CAP]. DIMENSIONLESS by construction. */
  ratio: number;
  applied: boolean;
  persistedDays: number;
  reason: VelocityGateReason | null;
}

const NO_VELOCITY = (reason: VelocityGateReason): VelocitySignal => ({
  ratio: 1,
  applied: false,
  persistedDays: 0,
  reason,
});

/**
 * Momentum as a bounded RESIDUAL above trend — never a level term.
 *
 * WHY RESIDUAL (aggie r1, unanimous): recent Toast sales are ALREADY inside the trailing
 * base window, so a velocity term expressed as a level double-counts the very days it is
 * meant to lead. The only honest form is "how far above its own day-class trend has this
 * SKU been running, consistently, in the last few days" — a multiplier on the base.
 *
 * TWO GATES, BOTH REQUIRED (r2-10): time (a run of same-signed residuals) AND volume (the
 * SKU actually moves). A sustained 3-item/day +200% passes time and fails volume, and it
 * should: tripling a par on three items a day is how a par teaches a manager to ignore pars.
 */
export function computeVelocityRatio(input: VelocityInput): VelocitySignal {
  if (input.perOrderUnitOz == null || input.perOrderUnitOz <= 0) return NO_VELOCITY("volume_floor");

  let series = [...input.series];
  if (input.signalsStartAt != null) {
    series = series.filter((d) => d.dateEt >= input.signalsStartAt!);
  } else {
    return NO_VELOCITY("signals_too_new"); // no marker at all => nothing is vettable yet.
  }
  if (input.recipeEditedAt != null) {
    // A recipe edit changes what this SKU MEANS; the series before it is a different signal.
    series = series.filter((d) => d.dateEt > input.recipeEditedAt!);
  }
  series = series.filter((d) => !d.suspect).slice(-DYNAMIC_PARS.VELOCITY_LOOKBACK_DAYS);

  const need = DYNAMIC_PARS.VELOCITY_MIN_PERSISTENCE_DAYS;
  if (series.length < need) {
    return NO_VELOCITY(input.recipeEditedAt != null ? "recipe_edited" : "no_persistence");
  }

  // Residual per day against its OWN day-class trend.
  const residuals: number[] = [];
  for (const d of series) {
    const base = input.baseByDayClass[d.dayClass];
    if (base == null || base <= 0) return NO_VELOCITY("no_base");
    residuals.push(round6(d.oz / base - 1));
  }

  // The run must be the MOST RECENT `need` days, all past the deadband, all the same sign.
  const run = residuals.slice(-need);
  const first = run[0]!;
  const sign = Math.sign(first);
  if (sign === 0) return NO_VELOCITY("no_persistence");
  const persisted = run.every(
    (r) => Math.sign(r) === sign && Math.abs(r) >= DYNAMIC_PARS.VELOCITY_DEADBAND,
  );
  if (!persisted) return NO_VELOCITY("no_persistence");

  // Volume floor, in the SKU's own order units per day, over the same run.
  const runDays = series.slice(-need);
  const meanUnitsPerDay =
    runDays.reduce((n, d) => n + d.oz, 0) / need / input.perOrderUnitOz;
  if (meanUnitsPerDay < DYNAMIC_PARS.VELOCITY_MIN_UNITS_PER_DAY) return NO_VELOCITY("volume_floor");

  const mean = run.reduce((n, r) => n + r, 0) / need;
  const bounded = Math.max(-DYNAMIC_PARS.VELOCITY_CAP, Math.min(DYNAMIC_PARS.VELOCITY_CAP, mean));
  return { ratio: round6(1 + bounded), applied: true, persistedDays: need, reason: null };
}
```

### Task 2.5 — Cushion (the C-socket, signature pinned)

**Tests:** a known class returns its percentage; an unknown or null class returns `CUSHION_DEFAULT` with `isDefault: true`; the `demandStats` argument is accepted and ignored (a test that two different stats objects give the same answer — the socket's contract).

```ts
/** What the future statistical implementation will need. Pinned NOW, unused NOW (r1-9). */
export interface DemandStats {
  ozPerDay: number | null;
  observedDays: number;
  /** Reserved for the service-level implementation (z x sigma x sqrt(lead)). */
  stdDevOzPerDay?: number | null;
}

export interface CushionResult {
  pct: number;
  classUsed: string | null;
  isDefault: boolean;
}

/**
 * THE C-SOCKET. Cushion is POLICY, not statistic — a tunable percentage per SKU class,
 * explainable in kitchen terms ("4 covers you to Friday's truck plus 20%").
 *
 * `demandStats` is DELIBERATELY UNUSED. The signature is pinned now so that when a year of
 * per-location variance history exists, a service-level implementation (z x sigma x
 * sqrt(lead-time)) screws into this exact seam without touching a single caller. Building it
 * today on thin data would be confident nonsense — the documented upgrade path, not a TODO.
 */
export function cushionFor(
  sku: { cushionClass: string | null },
  _location: { id: string },
  demandStats: DemandStats,
): CushionResult {
  void demandStats; // the socket: see the doc block above.
  const key = sku.cushionClass?.trim().toLowerCase() ?? null;
  const pct = key != null ? CUSHION_BY_CLASS[key] : undefined;
  if (pct == null) return { pct: CUSHION_DEFAULT, classUsed: key, isDefault: true };
  return { pct, classUsed: key, isDefault: false };
}
```

### Task 2.6 — Coverage: Σ per covered day, cushion, peak floor

> **THE NAMED DROP-POINT.** If the arc runs heavy, Task 2.4 (velocity) is what drops to v1.1 — pass `velocityRatio: 1` here and delete nothing else. The spec authorises this explicitly ("drops to v1.1 costlessly if the plan runs heavy"). Coverage, guards and the reason lane do **not** drop.

**Tests** (`tests/dynamic-pars-coverage.test.ts`):

- [ ] A horizon of Tue+Wed with a weekday rate of 30 oz/day and a 20% cushion returns `72 oz` — and a horizon that straddles into Fri **sums per day-class** (weekday 30 + weekend 45), never `rate × days`.
- [ ] Any covered day whose day-class rate is `null` → the whole result is `null` (you cannot sum an unknown day).
- [ ] `coveredDays` empty (a same-day double-delivery vendor) → `null`, never `0`.
- [ ] The peak floor raises a target it exceeds and sets `flooredByPeak`.
- [ ] `targetUnits = coveredOz / perOrderUnitOz`, and a `perOrderUnitOz` of `null` or `0` returns `null` (never a fabricated unit count — the `perOrderUnitOz` refusal, `lib/ordering.ts:197`).

```ts
export interface CoverageInput {
  /** From vendor-rhythm-shared.coverageWindow — every ET day the par must survive, as
   *  "YYYY-MM-DD". The day-class is derived HERE via dayClassForDate so the caller cannot
   *  hand in a second opinion about where the weekend starts. */
  coveredDays: ReadonlyArray<string>;
  baseOzPerDay: Record<DayClass, number | null>;
  /** From computeVelocityRatio. 1 when velocity did not apply. */
  velocityRatio: number;
  cushionPct: number;
  /** oz of ONE order unit (lib/ordering.ts perOrderUnitOz). null/0 => no honest unit target. */
  perOrderUnitOz: number | null;
  /** From observedPeakCoverageOz over the horizon length. null => no floor claim. */
  peakFloorOz: number | null;
}

export interface CoverageResult {
  demandOz: number;
  coveredOz: number;
  targetUnits: number;
  flooredByPeak: boolean;
}

/**
 * Par target = SUM over covered days of (that day's day-class rate x velocity), plus cushion,
 * floored at the observed peak — expressed in ORDER UNITS.
 *
 * SUM PER COVERED DAY, NEVER rate x days (r1-2, projects). A horizon that crosses Thursday
 * into Friday spans two demand regimes; multiplying one rate by a day count silently averages
 * a busy Friday into a quiet Tuesday, and at CO the weekend IS the volume.
 */
export function computeCoverage(input: CoverageInput): CoverageResult | null {
  if (input.coveredDays.length === 0) return null;
  if (input.perOrderUnitOz == null || input.perOrderUnitOz <= 0) return null;
  let demandOz = 0;
  for (const dateEt of input.coveredDays) {
    const rate = input.baseOzPerDay[dayClassForDate(dateEt)];
    if (rate == null) return null; // an unknown day-class cannot be summed. Honest null.
    demandOz += rate * input.velocityRatio;
  }
  demandOz = round6(demandOz);
  const withCushion = round6(demandOz * (1 + input.cushionPct));
  const floored = input.peakFloorOz != null && input.peakFloorOz > withCushion;
  const coveredOz = floored ? input.peakFloorOz! : withCushion;
  return {
    demandOz,
    coveredOz,
    targetUnits: round6(coveredOz / input.perOrderUnitOz),
    flooredByPeak: floored,
  };
}
```

### Task 2.7 — The closed reason vocabulary + the cause ladder

**Tests** (`tests/dynamic-pars-reason.test.ts`): the vocabulary is closed (a `KNOWN_REASONS` set test in the `tests/readiness.test.ts` shape); `classifyParReason` is **first-cause-wins** and every rung has a case; `inventory_only` outranks everything (57 of 141 SKUs — without that rung the lane cries wolf on day one, the exact `parReviewAdvisory` precedent); `cushion_class_missing` is NOT in `SILENCING_REASONS`.

```ts
/**
 * WHY A PAR IS (OR IS NOT) SPEAKING — the closed vocabulary, and the flagship deliverable.
 *
 * v1 ships an engine that can honestly answer for ~14 rows out of ~282. The other ~268 are
 * the product: each one names the errand that would wake it. "no production capture" is a
 * capture gap, "no weight basis" is a trip to the scale, "no vendor rhythm" is five minutes
 * on the vendor page — and the system generating that list live is the thesis ("the system
 * recognizes what's going on before the human does") applied to its own readiness.
 */
export type ParReasonCode =
  /** A number was produced. */
  | "ok"
  /** Packaging / cleaning supplies. Their pars were never demand-derived. NOT a fault. */
  | "inventory_only"
  /** The product was discontinued — the par is suppressed upstream (#283). NOT a fault. */
  | "product_retired"
  /** No lane has ever produced data for this SKU here. */
  | "no_lane_start"
  /** Demand is prep-mediated and production capture is dark: a HALF-SEEN base. */
  | "no_production_capture"
  /** oz-per-order-unit is unresolvable — no weight, no chain, no honest denominator. */
  | "no_weight_basis"
  /** The pack chain exists but cannot resolve to a root container. */
  | "unresolvable_pack"
  /** No order->delivery rhythm authored for this vendor at this location. */
  | "no_vendor_rhythm"
  /** Too few observed days in this day-class. */
  | "thin_history"
  /** The depletion ledger is not current for this location tonight. */
  | "stale_depletion"
  /** A brand-new location with no local history (the sibling-prior seam; NOT wired in v1). */
  | "no_local_history"
  /** The computed target is zero. A zero par is never a suggestion (r3). */
  | "zero_target"
  /** The target is <50% or >200% of the standing par: the UNIT looks wrong, not the demand. */
  | "par_unit_suspect"
  /** The par is <= 3 steps: below the band's resolution. Suggestion renders, auto never. */
  | "below_band_resolution"
  /** A within-band delta on a slot whose weekly budget is spent (projects r3 P2-3). */
  | "budget_spent"
  /** A human reverted this slot; the machine may not re-apply while the pin stands. */
  | "pinned"
  /** The day-class has no par slot: suggestion-only forever, aggregate-only in v1. */
  | "slot_creation"
  /** Informational only — never silences. */
  | "cushion_class_missing";

export const PAR_REASON_CODES: ReadonlyArray<ParReasonCode> = [
  "ok", "inventory_only", "product_retired", "no_lane_start", "no_production_capture",
  "no_weight_basis", "unresolvable_pack", "no_vendor_rhythm", "thin_history",
  "stale_depletion", "no_local_history", "zero_target", "par_unit_suspect",
  "below_band_resolution", "budget_spent", "pinned", "slot_creation", "cushion_class_missing",
];

/** Codes that mean NO NUMBER RENDERS. The rest annotate a number that did render. */
export const SILENCING_REASONS: ReadonlySet<ParReasonCode> = new Set<ParReasonCode>([
  "inventory_only", "product_retired", "no_lane_start", "no_production_capture",
  "no_weight_basis", "unresolvable_pack", "no_vendor_rhythm", "thin_history",
  "stale_depletion", "no_local_history", "zero_target", "par_unit_suspect", "slot_creation",
]);

/** Which errands a human can actually run, in the order r2-13 names the critical path. */
export const ERRAND_REASONS: ReadonlyArray<ParReasonCode> = [
  "no_weight_basis", "unresolvable_pack", "no_vendor_rhythm", "no_production_capture",
  "par_unit_suspect", "cushion_class_missing",
];

export interface ParReasonInput {
  inventoryOnly: boolean;
  productRetired: boolean;
  depletionCurrent: boolean;
  laneNeverStarted: boolean;
  laneComplete: boolean;
  perOrderUnitOz: number | null;
  hasPackChain: boolean;
  hasRhythm: boolean;
  thin: boolean;
  slotExists: boolean;
  /** Location has zero observed days at all — the cold-start seam. */
  noLocalHistory: boolean;
}

/**
 * FIRST CAUSE WINS, and the order is the whole point — exactly the walkDisposition /
 * parReviewAdvisory precedent (lib/location-sku-shared.ts).
 *
 * `inventory_only` ranks FIRST for the same reason it does in parReviewAdvisory: 57 of the
 * 141 par'd SKUs are packaging, every one has no demand lane by design, and reporting an
 * errand for them would put 57 false chores at the top of Juan's list on day one.
 */
export function classifyParReason(input: ParReasonInput): ParReasonCode {
  if (input.inventoryOnly) return "inventory_only";
  if (input.productRetired) return "product_retired";
  if (!input.depletionCurrent) return "stale_depletion";
  if (input.perOrderUnitOz == null) return input.hasPackChain ? "unresolvable_pack" : "no_weight_basis";
  if (input.noLocalHistory) return "no_local_history";
  if (input.laneNeverStarted) return "no_lane_start";
  if (!input.laneComplete) return "no_production_capture";
  if (!input.hasRhythm) return "no_vendor_rhythm";
  if (input.thin) return "thin_history";
  if (!input.slotExists) return "slot_creation";
  return "ok";
}

/** In v1 ~94-100% of rows are silent, so a per-row badge is worse than the 94% the r2 rename
 *  was commissioned to fix (aggie r3 P1). The lane lights ITSELF when silence stops being the
 *  norm — shipped now, returning false now, no future PR and no flag. */
export function shouldBadgeSilencePerRow(silentRows: number, totalRows: number): boolean {
  if (totalRows <= 0) return false;
  return silentRows / totalRows < 0.5;
}
```

### Task 2.8 — The guard stack + generation identity

**Tests** (`tests/dynamic-pars-guards.test.ts`) — one case per clause, all four spec layers:

- [ ] **Band in par steps:** par 4 step 1 target 4.6 → auto tier, suggested 5. Par 0.25 step 0.25 target 0.5 → **`below_band_resolution`**, suggestion only (the r2-on-r2 defect: `max(1 step, 25%)` would have doubled it).
- [ ] **Cap clamps AFTER rounding (projects P2-2):** par 10 step 1 target 13 → rounded Δ3, cap `max(1, 2.5) = 2.5`, clamped to 2.5, re-rounded to **2** (not 3). Assert 12, never 13.
- [ ] **≤3 steps is manual-only:** par 3 step 1 → tier `suggestion`, `below_band_resolution` annotated, never `auto`.
- [ ] **Never below one positive step; auto-to-zero forbidden:** a target of 0 on a par of 2 → `zero_target`, no number, suggestion-lane reason row.
- [ ] **Slot creation is suggestion-only forever:** `slotExists: false` → tier `suggestion`, `slot_creation`, `suppressedBy: "slot_creation"` on the auto lane, and the row is aggregate-only downstream.
- [ ] **Budget:** a within-band delta with `budgetSpent: true` → `suppressed`, `suppressedBy: "budget"`, reason `budget_spent` — **never a silent stale par** (projects P2-3).
- [ ] **PIN:** `pinned: true` → `suppressed`, `suppressedBy: "pin"`, reason `pinned`; the suggestion still renders (a pin stops the MACHINE, not the conversation).
- [ ] **Hysteresis:** an unconfirmed direction → `suppressed`, `suppressedBy: "hysteresis"`; the same delta on the second consecutive run → `would_apply`.
- [ ] **Generation stability:** a target drifting 4.4 → 4.6 keeps ONE `generationId` (both round to 5); a move to 6 mints a new one; a human par edit (currentPar changes) mints a new one.
- [ ] **`stabilizeSuggestion`:** a standing suggestion of 5 and a candidate of 5.25 at step 0.25 (< deadband 1 step... assert the deadband is in STEPS) keeps 5 — the walker may not read 12→1 Monday and 12→2 Tuesday.
- [ ] **Shadow simulates everything:** with `mode: "shadow"` the outcome is `would_apply`, never `applied`, for an otherwise-passing auto move — and every suppression reason is recorded identically to live mode (r2-7, "same code, mode flag").

```ts
export type GuardName =
  | "band" | "budget" | "hysteresis" | "pin" | "slot_creation" | "below_band_resolution";

export interface GuardInput {
  locationId: string;
  skuId: string;
  dayClass: DayClass;
  /** The resolved par for this day-class today. null = the slot does not exist. */
  currentPar: number | null;
  /** From computeCoverage. */
  targetUnits: number;
  parStep: number;
  /** The last ledger row's rendered suggestion for this (sku, location, day-class). */
  priorSuggestedPar: number | null;
  priorGenerationId: string | null;
  /** True when the PREVIOUS run proposed a move in the same direction (r1-6 hysteresis). */
  directionConfirmed: boolean;
  budgetSpent: boolean;
  pinned: boolean;
  mode: "shadow" | "live";
}

export interface GuardOutcome {
  tier: "auto" | "suggestion" | "none";
  suggestedPar: number | null;
  outcome: "would_apply" | "applied" | "suppressed" | "advisory_null";
  suppressedBy: GuardName | null;
  reasonCode: ParReasonCode;
  generationId: string | null;
  slotCreation: boolean;
}

/** Deterministic, human-readable, and STABLE while both numbers are stable. No hashing: the
 *  identity IS the pair of numbers, so a re-offer keeps its generation and a changed offer
 *  cannot accidentally reuse one. The trust ramp counts these, so this is load-bearing. */
export function generationIdFor(
  locationId: string,
  skuId: string,
  dayClass: DayClass,
  currentPar: number | null,
  suggestedPar: number,
): string {
  return `${locationId}:${skuId}:${dayClass}:${currentPar ?? "none"}>${suggestedPar}`;
}

/** Keep a standing suggestion unless the candidate is at least `SUGGESTION_DEADBAND_STEPS`
 *  steps away from it. Suggestion-lane hysteresis (r3): a number that wobbles nightly is a
 *  number a manager learns to ignore, which is the same failure as a thrashing par. */
export function stabilizeSuggestion(
  priorSuggestedPar: number | null,
  candidate: number,
  parStep: number,
): number {
  if (priorSuggestedPar == null) return candidate;
  const deadband = DYNAMIC_PARS.SUGGESTION_DEADBAND_STEPS * parStep;
  return Math.abs(candidate - priorSuggestedPar) < deadband ? priorSuggestedPar : candidate;
}

/**
 * THE GUARD STACK — one function, one order, simulated in shadow and executed in live.
 *
 * r2-7 is the design's best idea: shadow runs the SAME code with a mode flag and records
 * would-apply-vs-suppressed-by-WHICH-guard, so every guard is battle-tested on real nightly
 * data before the write bit is ever flipped. Do not fork this function for shadow.
 */
export function applyGuardStack(input: GuardInput): GuardOutcome {
  const step = input.parStep;
  const slotCreation = input.currentPar == null;

  // Round the target to the step FIRST; the step grain is the resolution of the whole system.
  const roundedTarget = Math.max(roundToStep(input.targetUnits, step), 0);

  // A zero target is NEVER a suggestion — a zeroed par silently exits every notice, and
  // "stop stocking this" is a human decision, not an arithmetic one (r3).
  if (roundedTarget <= 0) {
    return {
      tier: "none", suggestedPar: null, outcome: "advisory_null", suppressedBy: null,
      reasonCode: "zero_target", generationId: null, slotCreation,
    };
  }

  // Slot creation: compute, ledger, render in the AGGREGATE only. Suggestion-only forever —
  // the machine may not decide that Fri/Sat/Sun should stop following the weekday number.
  if (slotCreation) {
    const gen = generationIdFor(input.locationId, input.skuId, input.dayClass, null, roundedTarget);
    return {
      tier: "suggestion", suggestedPar: roundedTarget, outcome: "suppressed",
      suppressedBy: "slot_creation", reasonCode: "slot_creation", generationId: gen,
      slotCreation: true,
    };
  }

  const current = input.currentPar!;

  // The unit-sanity quarantine, BEFORE any band arithmetic: a target this far from the
  // standing par is a pack/weight problem wearing a demand costume (the Fresh-Mozz bomb).
  if (
    current > 0 &&
    (roundedTarget < current * DYNAMIC_PARS.UNIT_SUSPECT_LOW ||
      roundedTarget > current * DYNAMIC_PARS.UNIT_SUSPECT_HIGH)
  ) {
    return {
      tier: "none", suggestedPar: null, outcome: "advisory_null", suppressedBy: null,
      reasonCode: "par_unit_suspect", generationId: null, slotCreation: false,
    };
  }

  const stabilized = stabilizeSuggestion(input.priorSuggestedPar, roundedTarget, step);
  const generationId = generationIdFor(
    input.locationId, input.skuId, input.dayClass, current, stabilized,
  );

  // No movement worth rendering.
  if (Math.abs(stabilized - current) < step) {
    return {
      tier: "none", suggestedPar: null, outcome: "advisory_null", suppressedBy: null,
      reasonCode: "ok", generationId: null, slotCreation: false,
    };
  }

  // Pars below the band's resolution are MANUAL-ONLY. max(1 step, 25%) silently overrode the
  // cap upward exactly where +-1 step is the largest relative swing (r3). At CO this is 108 of
  // 141 pars, and saying so is the honest answer, not a bug.
  const steps = current / step;
  if (steps < DYNAMIC_PARS.MIN_STEPS_FOR_AUTO) {
    return {
      tier: "suggestion", suggestedPar: stabilized, outcome: "suppressed",
      suppressedBy: "below_band_resolution", reasonCode: "below_band_resolution",
      generationId, slotCreation: false,
    };
  }

  // THE BAND, in par steps. Magnitude = max(1 step, 25% of par); the cap clamps AFTER the
  // rounding (projects r3 P2-2: par 10 -> target 13 rounds to +3, which is a 30% move).
  const maxDelta = Math.max(step, DYNAMIC_PARS.BAND_PCT * current);
  const rawDelta = stabilized - current;
  const clamped = Math.sign(rawDelta) * Math.min(Math.abs(rawDelta), maxDelta);
  const bandedDelta = roundToStep(clamped, step);
  const withinBand = Math.abs(rawDelta) <= maxDelta + 1e-9;

  // Beyond the band => a SUGGESTION at the full target. Nothing beyond the band ever moves
  // itself; the manager sees the honest number, not a clipped one.
  if (!withinBand) {
    return {
      tier: "suggestion", suggestedPar: stabilized, outcome: "suppressed",
      suppressedBy: "band", reasonCode: "ok", generationId, slotCreation: false,
    };
  }

  // Never below one positive step, and never to zero.
  const candidate = Math.max(round6(current + bandedDelta), step);
  if (candidate === current) {
    return {
      tier: "none", suggestedPar: null, outcome: "advisory_null", suppressedBy: null,
      reasonCode: "ok", generationId: null, slotCreation: false,
    };
  }

  // A human reverted this slot. The pin stops the MACHINE; the suggestion still renders,
  // because the conversation is not over — only the unilateral write is.
  if (input.pinned) {
    return {
      tier: "suggestion", suggestedPar: stabilized, outcome: "suppressed",
      suppressedBy: "pin", reasonCode: "pinned", generationId, slotCreation: false,
    };
  }

  // Direction must be confirmed across two consecutive runs, or step-rounding of a continuous
  // target oscillates 2.49 <-> 2.51 forever.
  if (!input.directionConfirmed) {
    return {
      tier: "suggestion", suggestedPar: stabilized, outcome: "suppressed",
      suppressedBy: "hysteresis", reasonCode: "ok", generationId, slotCreation: false,
    };
  }

  // A within-band delta on a spent budget gets its OWN cause. Without it this row is neither
  // auto nor suggestion and renders as a silently stale par (projects r3 P2-3).
  if (input.budgetSpent) {
    return {
      tier: "suggestion", suggestedPar: stabilized, outcome: "suppressed",
      suppressedBy: "budget", reasonCode: "budget_spent", generationId, slotCreation: false,
    };
  }

  return {
    tier: "auto",
    suggestedPar: candidate,
    // THE MODE FLAG, and the only place it matters. Shadow records the verdict it WOULD have
    // executed; live executes it. Same code path, so the guards are proven before the flip.
    outcome: input.mode === "shadow" ? "would_apply" : "applied",
    suppressedBy: null,
    reasonCode: "ok",
    generationId,
    slotCreation: false,
  };
}
```

### Task 2.9 — Trust ramp + the sibling seam (both ship, neither is wired)

**Tests:** 10 accepts of 14 offers with a count anchor → `met: true`; 9 accepts → `blockedBy: "ramp"`; 10 accepts with **no** count anchor → `blockedBy: "count_anchor"`; a post-graduation revert drops net accepts below the threshold; `siblingBlendWeight(0, 21) === 1`, `(21, 21) === 0`, `(7, 21)` ≈ `0.667`.

```ts
export interface TrustRampInput {
  /** DISTINCT generations offered at this location inside the window. */
  offered: number;
  /** DISTINCT generations accepted inside the window. */
  accepted: number;
  /** Reverts inside the window — a post-graduation revert counts AGAINST standing (r2-2). */
  reverts: number;
  /**
   * A physical count exists at this location with `allocated_from_product_id IS NULL`
   * (r3): a product-level count allocates a line to EVERY member, so accepting allocated
   * lines would let one physical count anchor an entire product at once.
   */
  hasDirectCountAnchor: boolean;
}

export interface TrustRampState {
  netAccepted: number;
  offered: number;
  met: boolean;
  blockedBy: "ramp" | "count_anchor" | null;
}

/** Graduation WIDENS THE TRIGGER, NEVER THE WRITE SET (r2-3): a graduated location still
 *  auto-writes only lane-lit SKUs. This function answers "may this location's auto lane run
 *  at all"; the per-SKU lane gate answers "for which SKUs", and it is never relaxed. */
export function trustRampState(input: TrustRampInput): TrustRampState {
  const netAccepted = Math.max(0, input.accepted - input.reverts);
  const rampOk = netAccepted >= DYNAMIC_PARS.TRUST_RAMP_ACCEPTS;
  if (!rampOk) return { netAccepted, offered: input.offered, met: false, blockedBy: "ramp" };
  if (!input.hasDirectCountAnchor) {
    return { netAccepted, offered: input.offered, met: false, blockedBy: "count_anchor" };
  }
  return { netAccepted, offered: input.offered, met: true, blockedBy: null };
}

/**
 * SIBLING PRIOR — the seam only. NOT WIRED IN v1, by spec ("the Add-a-Location arc, SEPARATE").
 * Blend weight on the SIBLING's rate, decaying linearly to zero as local observed days
 * accumulate. Whole-pattern only: the depletion ledger has no channel grain, so a
 * delivery-only prior is structurally infeasible without a ledger extension (r1-11).
 *
 * When it IS wired, inheritance must carry per-SKU lane-lit/dark status (projects r3 P2-5):
 * a sibling's DARKNESS must not launder into the new shop as a number.
 */
export function siblingBlendWeight(
  observedDays: number,
  qualifyingDays: number = DYNAMIC_PARS.SIBLING_QUALIFYING_DAYS,
): number {
  if (qualifyingDays <= 0) return 0;
  return round6(Math.max(0, Math.min(1, 1 - observedDays / qualifyingDays)));
}
```

### Task 2.10 — Phase 2 close

- [ ] `npm test` green with **the full case list above present** — the review criterion is coverage of the four spec layers, not line count.
- [ ] Zero imports of `lib/dynamic-pars-shared.ts` outside `tests/` at the end of this phase. Assert with `grep -rn "dynamic-pars-shared" app lib components | grep -v tests`.
- [ ] `npm run build` green.

---

## PHASE 3 — shadow cron + ledger

*Goal: every night, after depletion materializes, the engine computes 282 rows per location, simulates the full guard stack, and writes a ledger. It applies nothing. One audit row per location-night.*

### Task 3.1 — Adjudicate the audit vocabulary (the compiler enforces this; do it first or nothing compiles)

Verified live: **no `par.*` action exists in either registry today.** `AuditInput.action` is typed as `AuditAction`, so an unlisted spelling is a **build failure at the call site** (`lib/audit.ts:48`).

- [ ] `lib/destructive-actions.ts` — add, after the "Product identity" block:

```ts
  // ── Dynamic Pars (2026-08-22) ─────────────────────────────────────────────
  // The criterion (this file's header): destructive = a HUMAN act altering shared
  // operational config or the accountability record. Both of these are a human moving a
  // par — the same edit vendor_item.update has covered since the catalog shipped, reached
  // by a different affordance. Forensic-filter only: membership changes what is FINDABLE,
  // never what is PERMITTED (step-up is route-gated, and these routes take none — plan D2).
  // — par.suggestion_accept: a manager taking the machine's number. Writes
  //   location_sku_settings' HUMAN par lane at (sku, location, day-class) and clears the pin.
  "par.suggestion_accept",
  // — par.auto_tune_revert: a manager undoing an applied auto-move. Writes the human lane,
  //   nulls the auto column, and SETS the pin. Consumes the weekly budget (r2-8 final).
  "par.auto_tune_revert",
```

- [ ] `lib/audit-actions.ts` — add to `NON_DESTRUCTIVE_ACTIONS`, in the "INVENTORY, RECEIVING & ORDERING" block (alphabetical among its neighbours):

```ts
  // ── Dynamic Pars (2026-08-22) ─────────────────────────────────────────────
  // par.auto_tune / par.auto_tune_shadow are SYSTEM OBSERVATIONS with actor_id null — the
  // product.resolution_flip precedent two lines down. Not destructive however consequential.
  // TWO NAMES, DELIBERATELY (r2-4): one action name may not mean "computed" in v1 and
  // "applied" in v2 under a closed vocabulary. _shadow is the run-level row the nightly
  // simulation writes; par.auto_tune is the run-level row a GRADUATED location writes.
  // ONE ROW PER (location, night), never per SKU: 282 per-SKU rows a night would be ~21x
  // the entire audit log annually (r3). The per-SKU detail lives in par_auto_moves.
  // Both are emitted from TypeScript (app/api/cron/toast-sales-pull), NOT from SQL — so
  // neither takes the RESERVED_ACTIONS/report.update path.
  "par.auto_tune",
  "par.auto_tune_shadow",
  // par.suggestion_dismiss: a human DECLINING. Nothing changes — no par write, no pin, no
  // budget. It exists so the trust ramp has a denominator and the ledger can tell "offered
  // and refused" from "offered and ignored" (r2-2).
  "par.suggestion_dismiss",
```

- [ ] **Do NOT touch `pars.update`.** It sits in `DESTRUCTIVE_ACTIONS:58` *and* `RESERVED_ACTIONS:255` as the Foundation-Spec placeholder for the unbuilt admin Pars page (plan **D8**). Reusing it would erase the "not built yet" vs "nothing will ever write this" distinction the reserved list exists to keep.
- [ ] `npm test -- audit-actions` green (the disjointness / no-duplicates / every-entry-accounted-for invariants).

### Task 3.2 — Author migration `0183_par_auto_lane.sql` (🔒 GATE M2)

```sql
-- 0183: Dynamic Pars — the machine's own par lane on the per-location overlay
-- Spec:  docs/superpowers/specs/2026-08-21-dynamic-pars-design.md (r1 #4, r2 #6, r3 PIN)
-- Plan:  docs/superpowers/plans/2026-08-22-dynamic-pars.md Task 3.2 (GATE M2)
--
-- SEQUENCED LAST ON PURPOSE (plan D12). These columns light resolvePar's third lane, so they
-- land only once the nightly engine that could populate them exists. Pre-apply, resolvePar
-- degrades to the two-layer form it has today (undefined ?? global = global) and the walker
-- is byte-identical. The probe caches only TRUE and re-probes while false (0180 precedent).
--
-- THE MACHINE NEVER MASQUERADES AS AN OPERATOR. A human's number lives in weekday_par /
-- weekend_par and ALWAYS wins; the machine's lives here and is only ever consulted when the
-- human lane is null. Global vendor_items pars are NEVER auto-written — per-location law.
--
-- PER-SLOT, NOT PER-ROW. Two day-classes means two of everything: two auto values, two
-- baselines, two applied stamps, two pins. A single auto_applied_at for both slots would let
-- a weekday move stamp the weekend slot's history (aggie r3).

ALTER TABLE public.location_sku_settings
  -- The machine's lane. NULL = the machine has nothing to say for this slot.
  ADD COLUMN IF NOT EXISTS auto_weekday_par           numeric     NULL,
  ADD COLUMN IF NOT EXISTS auto_weekend_par           numeric     NULL,
  ADD COLUMN IF NOT EXISTS auto_weekday_applied_at    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS auto_weekend_applied_at    timestamptz NULL,
  -- The GLOBAL par each auto value was computed against. When a human edits the global par,
  -- the standing auto value is invalidated on read: a human's global edit always reasserts
  -- the human lane, and a machine number computed against a baseline that no longer exists
  -- is a stale opinion, not a current one (r2-6).
  ADD COLUMN IF NOT EXISTS auto_weekday_baseline_par  numeric     NULL,
  ADD COLUMN IF NOT EXISTS auto_weekend_baseline_par  numeric     NULL,
  -- THE PIN. Set by a revert; NEVER cleared by the act that set it (a revert IS a human
  -- write — r2's "a human par edit clears the pin" was self-defeating and r3 fixed it).
  -- Cleared ONLY by a DIRECT human par edit at the SAME (sku, location, day-class): a global
  -- edit invalidates the auto VALUE but leaves the pin standing, so one Cap Hill decision
  -- can never un-pin a P Street manager's veto. No auto-expiry. Intended, and stated.
  ADD COLUMN IF NOT EXISTS pinned_weekday_at          timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pinned_weekend_at          timestamptz NULL;

COMMENT ON COLUMN public.location_sku_settings.auto_weekday_par IS
  'The machine lane. resolvePar = human ?? auto ?? global. Written ONLY by the graduated '
  'nightly engine through lib/dynamic-pars.ts writeParFromSuggestion(actorKind="machine"); '
  'the admin location-settings route structurally cannot write it (its payload is an '
  'explicit field list that names only the human lane).';
COMMENT ON COLUMN public.location_sku_settings.pinned_weekday_at IS
  'A human reverted the machine on this slot. The machine may not re-apply while it stands. '
  'Cleared only by a direct human par edit at this same (sku, location, weekday) slot.';

-- RLS: location_sku_settings already carries the 0174 deny-all posture (ENABLE RLS + REVOKE
-- ALL FROM anon, authenticated, public). Adding columns does not change it, and no policy is
-- added: service-role writes only, app-layer role gates in lib/dynamic-pars.ts. Stated here
-- because r3 requires the RLS stance to be named in the migration.
```

- [ ] **DO NOT APPLY.** 🔒 GATE M2 in the PR body.

### Task 3.3 — `resolvePar` becomes three-lane

**Tests** (extend `tests/location-sku-shared.test.ts` — it exists):

- [ ] Day-one (no overlay) is **byte-identical** to today: `null ?? global`.
- [ ] Human overlay beats auto beats global, in that order, per field.
- [ ] The weekend day rule is applied **after** the three-lane resolution, byte-identical to `parForDay`.
- [ ] **Self-invalidation:** an auto value whose recorded baseline ≠ the current global par is IGNORED (falls through to global), and the caller can see it was ignored.
- [ ] An auto value on a slot the human has filled is never consulted.

```ts
// lib/location-sku-shared.ts — REPLACES the two-layer resolvePar.

/** Shape of a location_sku_settings row as loaded from the DB (camelCase, JS side). */
export interface LocationSkuOverlay {
  weekdayPar: number | null;
  weekendPar: number | null;
  /** The MACHINE lane (migration 0183). Null pre-apply — resolution degrades to two-layer. */
  autoWeekdayPar?: number | null;
  autoWeekendPar?: number | null;
  /** The global par each auto value was computed against (r2-6 self-invalidation). */
  autoWeekdayBaselinePar?: number | null;
  autoWeekendBaselinePar?: number | null;
}

/** One lane's resolution, so a caller can SAY which lane answered. */
export type ParLane = "human" | "auto" | "global" | "none";

/**
 * THREE LANES: human ?? auto ?? global (r1 #4).
 *
 * A human's number ALWAYS beats the machine's — that is the whole contract, and it is why
 * the machine was given its own columns instead of being allowed to write the human's.
 *
 * SELF-INVALIDATION (r2-6): each auto value records the GLOBAL par it was computed against.
 * When a human edits that global par, the auto value is a stale opinion about a baseline
 * that no longer exists, so it is skipped and the global reasserts itself. This is a READ
 * rule, deliberately: no nightly job has to chase a global edit, and the human's edit takes
 * effect the instant they save it.
 */
function resolveLane(
  human: number | null | undefined,
  auto: number | null | undefined,
  autoBaseline: number | null | undefined,
  global: number | null,
): { value: number | null; lane: ParLane } {
  if (human != null) return { value: human, lane: "human" };
  if (auto != null && (autoBaseline ?? null) === global) return { value: auto, lane: "auto" };
  return { value: global, lane: global == null ? "none" : "global" };
}

export function resolveParWithLane(
  overlay: LocationSkuOverlay | null,
  global: GlobalSkuPar,
  weekend: boolean,
): { par: number | null; lane: ParLane } {
  const wd = resolveLane(
    overlay?.weekdayPar, overlay?.autoWeekdayPar, overlay?.autoWeekdayBaselinePar,
    global.weekdayPar,
  );
  const we = resolveLane(
    overlay?.weekendPar, overlay?.autoWeekendPar, overlay?.autoWeekendBaselinePar,
    global.weekendPar,
  );
  // Weekend-par day rule — byte-identical to lib/ordering.ts parForDay, applied AFTER the
  // lane resolution exactly as the two-layer version applied it after the field resolution.
  if (weekend && we.value != null) return { par: we.value, lane: we.lane };
  return { par: wd.value, lane: wd.lane };
}

/** The shipped signature, unchanged for every existing caller. */
export function resolvePar(
  overlay: LocationSkuOverlay | null,
  global: GlobalSkuPar,
  weekend: boolean,
): number | null {
  return resolveParWithLane(overlay, global, weekend).par;
}
```

- [ ] `grep -rn "resolvePar\b" lib app components tests` — the shared-type consumer sweep. Confirm every call site still type-checks (the added overlay fields are optional, so `lib/ordering.ts:805` and `:1294` are unchanged).
- [ ] Pre-apply: `loadOverlayBySku` selects the auto columns **only when the probe says the migration is applied**; otherwise the fields are absent, `resolveLane` falls through, and the walker is byte-identical.

### Task 3.4 — `materializeDailyDepletion` also stamps the day's sales signal (plan D4)

- [ ] In `lib/catering/toast-sales.ts`, inside `materializeDailyDepletion`, **after** the existing depletion delete+insert and **before** the audit call, write the signal row in the same idempotent day scope:

```ts
  // ── The day-grain catering marker (Dynamic Pars, plan D4) ────────────────────
  // WHY HERE AND NOT IN THE FILTER. `consumption.suspectedCatering` is computed at line ~757
  // AFTER skuDirect has been summed over every counted line. Excluding suspect checks from
  // that aggregation would change what direct_oz MEANS — the one lane the double-count law
  // protects. So the detector's verdict is recorded BESIDE the day and the velocity layer
  // reads it; direct_oz is byte-identical to before this line existed.
  // Same delete-then-insert scope as the ledger above, so a re-pull is idempotent for free.
  const suspectQty = consumption.suspectedCatering.reduce((n, c) => n + c.totalQty, 0);
  const countedQty = consumption.soldLines.reduce((n, l) => n + l.quantity, 0);
  const { error: sigDelErr } = await sb.from("toast_daily_sales_signals")
    .delete().eq("location_id", locationId).eq("business_date", businessDate);
  if (sigDelErr) {
    // NON-FATAL by design: the signal is a velocity input, not a ledger. Losing it degrades
    // velocity to "signals_too_new" for that day, which is an honest null, and must never
    // fail the materialization the drift engine depends on.
    console.error(`[toast-depletion] sales-signal delete failed: ${sigDelErr.message}`);
  } else {
    const { error: sigInsErr } = await sb.from("toast_daily_sales_signals").insert({
      location_id: locationId,
      business_date: businessDate,
      suspect_check_count: consumption.suspectedCatering.length,
      suspect_qty: suspectQty,
      counted_qty: countedQty,
    });
    if (sigInsErr) console.error(`[toast-depletion] sales-signal insert failed: ${sigInsErr.message}`);
  }
```

- [ ] Guard the whole block behind the `0182` probe so a pre-apply run is a silent no-op, not a per-night error log.
- [ ] Assert in the PR body: **`direct_oz` / `flattened_oz` rows are unchanged**, byte-for-byte, verified by a before/after row count + checksum on one location-date.

### Task 3.5 — `lib/dynamic-pars.ts`: the batched nightly loader

**BATCH LAW (`AGENTS.md`, `loadRecipeGraph`):** one query per *kind*, never per SKU. Target ≤ 12 queries per location per night. Every unbounded read is **paged** via `selectAllRows` under a stable total order (the PR #63 lesson), and no read spends an id list in the GET request line (the 414 cliff, `lib/products.ts` `DELIVERY_AT_LOCATION_EMBED`).

- [ ] Create `lib/dynamic-pars.ts` with `loadDemandInputs(sb, locationId, runDateEt)` returning a single `DemandInputs` bundle assembled from exactly these reads:

| # | Read | Notes |
| --- | --- | --- |
| 1 | `vendor_items` where `weekday_par IS NOT NULL OR weekend_par IS NOT NULL` | reuse `WALKER_SKU_COLUMNS` + `cushion_class, par_step, sku_class`; **no `.in()` id list** |
| 2 | `location_sku_settings` for the location | the existing `loadOverlayBySku` shape + the auto lane when probed |
| 3 | `toast_daily_depletion` for the location, `business_date >= windowStart` | **paged**, ordered by `id`; gives `direct_oz` + `flattened_oz` per (sku, date) |
| 4 | `toast_sales_events` distinct `business_date` for the location in the window | the full-gap oracle (plan **D10**); paged, `select("business_date")` only |
| 5 | `toast_daily_sales_signals` for the location in the window | the suspect marker + `signalsStartAt` |
| 6 | `productions` ids for the location in the window (live only: `superseded_at`/`revoked_at` null) | paged, mirrors `loadSkuUsageRank` exactly |
| 7 | `production_inputs` for those ids | paged; **the second lane** |
| 8 | `loadProductIndex(productIds, locationId)` | **the same loader the recipe graph uses — one resolution ladder, not two** |
| 9 | `loadRhythmByVendor` + `loadRhythmSkips` + the **all-dows** cutoff read | Phase 1 loaders |
| 10 | `loadSkuPackChains(skuIds)` + `loadMeasures()` | the `perOrderUnitOz` inputs, exactly as `loadWalkerData` does |
| 11 | `par_auto_moves` latest row per (sku, day-class) for the location | the hysteresis prior + the generation prior; ordered `run_date DESC`, paged |
| 12 | `par_auto_moves` rolling-7-day `applied`/`would_apply` count per (sku, day-class) | the budget; **one grouped read**, never per SKU |
| 13 | `audit_log` latest `recipe_input.*` / `recipe.update` occurred_at | the velocity recipe-edit reset. `occurred_at`, **never `created_at`** — `audit_log` has no `created_at`, and that exact misspelling silently 400'd for weeks (SIM-PI-4, `lib/catering/toast-sales.ts:264`) |

- [ ] `laneStartAt` per SKU is derived in memory: the **earliest** date in the window on which this SKU (at product grain) appears in either lane. Null when it never appears. This is the longitudinal clamp's input and must be computed per SKU, not per location.
- [ ] `directOzByDate` / `productionOzByDate` / `flattenedOzByDate` are rolled to **product grain** using `productIndex.productBySku` before `computeBaseRate` sees them — a primary flip must not read as demand collapse (r1-3). Reuse the pure `rollupUsageByProduct` shape; do **not** write a second rollup.
- [ ] The suggestion's write-home is resolved **once** here, per **R3-B**: `writeHomeSkuId = productIndex.byProduct.get(productId)?.primarySkuId ?? skuId` — the **designated** primary (`product_primaries`, location row over global), never the ladder's transient runtime answer. A write to a backup carrier orphans on restore, taking the tuned par with it (projects r3 P2-1).

### Task 3.6 — The shadow engine

- [ ] `runParShadowForLocation(sb, locationId, runDateEt, mode)` and `recordParRunSkipped(locationId, runDateEt, watermark)` — orchestration only, over `loadDemandInputs` + the Phase 2 core.

**The loop skeleton below is the ORDER and the SHORT-CIRCUITS, which are the decisions. The `{ … }` argument objects are not placeholders: each one is a fully-typed Phase-2 input interface (`ParReasonInput`, `NextDeliveryInput`, `CoverageInput`, `GuardInput`) and the compiler supplies the exact field list — writing them out here would be transcribing Phase 2 twice, and the second copy is the one that goes stale.**

```ts
// Every field the engine assembles becomes one par_auto_moves column or a key inside
// `detail`, so the ledger IS the explanation and nothing is recomputed to answer "why".
for (const sku of inputs.skus) {
  for (const dayClass of ["weekday", "weekend"] as const) {
    // ① the reason ladder runs FIRST and short-circuits. A silenced row still gets a full
    //    ledger row — the reason lane IS the product, so a silent par is a WRITE, not a skip.
    const reason = classifyParReason({ ...ladderInputs });
    if (SILENCING_REASONS.has(reason)) { push(advisoryNullRow(reason)); continue; }

    // ② the horizon THIS RUN computes with. The weekend day-class optimises the FRIDAY walk
    //    (the longest gap, r3); the rendered suggestion re-selects live at walk time (R3-A).
    const walkDateEt = optimizationWalkDate(dayClass, runDateEt);
    const window = coverageWindow({ rhythm, cutoffs, skips, locationId, walkDateEt,
                                    walkMinutesEt: NIGHTLY_HORIZON_WALK_MINUTES });
    if (window == null) { push(advisoryNullRow("no_vendor_rhythm")); continue; }

    // ③ the terms, ④ the coverage, ⑤ the guard stack — all pure, all persisted.
    const coverage = computeCoverage({ ... });
    if (coverage == null) { push(advisoryNullRow("no_weight_basis")); continue; }
    const verdict = applyGuardStack({ ...guardInputs, mode });
    push(ledgerRow(verdict, coverage, terms, window));
  }
}
```

- [ ] `NIGHTLY_HORIZON_WALK_MINUTES = 0` — the nightly run evaluates the horizon **as if walking at the start of the optimisation day**, so every cutoff on that day is still catchable. That is the LONGEST-reach reading, it is what the ledger records in `detail.horizon_basis`, and the walker always overrides it with the real instant — which is exactly R3-A. Naming note: an "end of order day" spelling would be a lie about the value.
- [ ] **Mode is hard-coded `"shadow"`** in v1 with a single named constant `PAR_AUTO_APPLY_ENABLED = false` and a comment naming the two conditions that would flip it (a graduated location per `trustRampState`, and an explicit lead decision). No env var, no admin toggle, no route — the flip is a code change with a PR, deliberately.
- [ ] **Idempotent write (plan D13):** delete `(run_date, location_id)` rows `WHERE outcome <> 'applied'`, then insert the batch. Chunk the insert at 500 rows.
- [ ] **Simulated budget reads the recomputable ledger, not a persistent counter** (projects r3 P2-7): the budget query counts `applied` + `would_apply` rows in the trailing 7 days. In shadow that is a genuine longitudinal simulation; on the day a location goes live the counter is not phantom-spent, because live mode's `applied` rows are the only ones that will exist going forward and the simulated ones age out inside a week. State this in the function's doc block.

### Task 3.7 — Chain the step into the existing cron

- [ ] `app/api/cron/toast-sales-pull/route.ts` — insert after the depletion loop, before the heartbeat:

```ts
    // ── Dynamic Pars: the nightly shadow computation (spec 2026-08-21) ───────────
    // CHAINED, NOT SCHEDULED. It runs here so the ordering is structural: the pars engine
    // reads the ledger this handler just materialized, in the same request, for the same
    // business date. No vercel.json entry, no second secret, no clock to keep in sync.
    //
    // WATERMARK-GATED (r3): a location whose depletion is not current through this business
    // date is SKIPPED with an advisory-null run, never computed on a stale day. Recomputing
    // yesterday's rates as today's is how a phantom velocity signal is born, and the pull is
    // verifiably best-effort (the loop above swallows per-location failures by design).
    let parRunFailures = 0;
    const parRows: Record<string, number> = {};
    for (const r of results) {
      if (!r.ok) continue;
      try {
        const watermark = await loadDepletionWatermark(r.locationId);
        if (watermark !== businessDate) {
          await recordParRunSkipped(r.locationId, businessDate, watermark);
          continue;
        }
        const { rows } = await runParShadowForLocation(r.locationId, businessDate);
        parRows[r.locationId] = rows;
      } catch (e) {
        parRunFailures += 1;
        console.error(`[cron toast-sales-pull] par shadow failed for ${r.locationId}:`, truncateErr(e));
      }
    }
```

- [ ] `metadata` on the existing `cron.success` heartbeat gains `par_rows` and `par_run_failures` — no new heartbeat row.
- [ ] **ONE audit row per (location, night)**, written inside `runParShadowForLocation` (and by `recordParRunSkipped`):

```ts
  await audit({
    actorId: null, actorRole: null,             // system observation — actor IS null.
    action: "par.auto_tune_shadow",             // v1. A graduated location writes par.auto_tune.
    resourceTable: "par_auto_moves", resourceId: locationId,
    metadata: {
      run_date: runDateEt, actor_context: "cron", mode,
      rows, would_apply: counts.wouldApply, suggestions: counts.suggestion,
      advisory_null: counts.advisoryNull, suppressed_by: counts.suppressedBy,
      reason_counts: counts.byReason,           // the reason lane, in one row, every night.
      depletion_through: watermark,
    },
    ipAddress: null, userAgent: null,
  });
```

- [ ] A par-step failure must **never** fail the pull or the depletion materialization — the try/catch above mirrors the depletion loop's own best-effort posture exactly.

### Task 3.8 — THE one par-write authority

Every par write in the system funnels through this function after this task. That is the point: one place decides what a par write does to the auto lane, the pin, and the budget.

```ts
export type ParWriteActorKind = "admin" | "accept" | "machine";

export interface ParWriteInput {
  actor: AuthContext | null;              // null ONLY for actorKind "machine".
  actorKind: ParWriteActorKind;
  locationId: string;
  skuId: string;
  dayClass: DayClass;
  /** The new value for this slot. null = blank-to-global (admin only). */
  value: number | null;
  /** Present for "accept" and "machine": the generation this write answers. */
  generationId?: string | null;
  /** The global par this write was computed against — "machine" only (r2-6 baseline). */
  baselinePar?: number | null;
}

/**
 * THE ONE PAR-WRITE AUTHORITY (r3 authz).
 *
 * Accepting a suggestion used to be a privilege escalation waiting to happen: the walker's
 * floor is KH (4) and a par write is GM (7). One function, one actor-kind, one role check.
 *
 * WHAT EACH KIND DOES, and why the differences are not arbitrary:
 *
 *   "admin"   — the SKU admin's overlay editor. Writes the HUMAN lane. On a blank-to-global
 *               it ALSO NULLS the auto column for that slot: blanking your own override must
 *               not resurrect a stale machine number the human never saw (r3). CLEARS the pin
 *               on that slot — a direct human edit at this exact grain is the human
 *               re-engaging, and it is the ONLY thing that clears a pin. Level 7 + Tier-A
 *               step-up (unchanged — that route keeps its own gate).
 *
 *   "accept"   — the walker's one-tap. Writes the HUMAN lane at this slot, records the
 *               generation in par_suggestion_actions, CLEARS the pin (same reasoning), and
 *               DOES NOT CONSUME THE BUDGET: the incentive must never punish engagement
 *               (r2-8). Level 7, NO step-up (plan D2).
 *
 *   "machine"  — the graduated nightly engine. Writes the AUTO lane ONLY, records the
 *               baseline, stamps applied_at, CONSUMES the budget, and NEVER touches the
 *               human lane, the pin, or the global vendor_items par. actor null.
 *
 * A REVERT is not a kind: it is an "accept"-class human write (it moves the par back) that
 * additionally SETS the pin and DOES consume the budget — reverts are non-manual-origin par
 * writes and the budget is what stops a revert war (r2-8 final form). It has its own
 * exported wrapper so the two behaviours can never drift apart.
 *
 * SILENT-UPDATE-DENIAL LAW: every UPDATE here passes { count: "exact" } and returns an
 * explicit 404 on 0 rows. A denied UPDATE is silent on Supabase (UPDATE 0, no error).
 */
export async function writeParFromSuggestion(input: ParWriteInput): Promise<void>;
```

**The exact column effect of each kind — the table the implementation must satisfy, so no branch is left to interpretation:**

| | human lane (`weekday_par`/`weekend_par`) | auto lane (`auto_*_par`) | `auto_*_baseline_par` | `auto_*_applied_at` | `pinned_*_at` | budget | `par_suggestion_actions` | audit action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `admin` (value) | **written** | **nulled** (this slot) | nulled | nulled | **cleared** | untouched | — | `vendor_item.update` (scope `location_settings`) |
| `admin` (blank-to-global) | nulled | **nulled** | nulled | nulled | **cleared** | untouched | — | `vendor_item.update` |
| `accept` | **written** | **nulled** (this slot) | nulled | nulled | **cleared** | **free** | row `accept` | `par.suggestion_accept` |
| `revert` | **written** (back) | **nulled** | nulled | nulled | **SET** | **consumed** | row `revert` | `par.auto_tune_revert` |
| `dismiss` | untouched | untouched | untouched | untouched | untouched | untouched | row `dismiss` | `par.suggestion_dismiss` |
| `machine` | **never touched** | **written** | **written** | stamped | untouched | **consumed** | — | (counted into the run-level row) |

- [ ] Implement it in `lib/dynamic-pars.ts`, with `requireLevel(actor, PAR_WRITE_MIN)` where `PAR_WRITE_MIN = 7` (**plan D1** — imported from `lib/admin/skus.ts`'s `SKU_WRITE_MIN`, never re-declared, so the walker's authority and the admin's can never drift apart).
- [ ] Add the pure `parActionEffects(action: "accept" | "dismiss" | "revert"): { writesPar: boolean; setsPin: boolean; clearsPin: boolean; consumesBudget: boolean }` to `lib/dynamic-pars-shared.ts` and unit-test it against the table above — the *decision* is pure and testable even though the *write* is not.
- [ ] Rewire `upsertLocationSkuSettings` (`lib/admin/skus.ts:732`) to call it per changed slot with `actorKind: "admin"`. Its own field list already excludes the auto columns (**the machine-lane bypass r3 demands is structurally impossible here**) — add a comment saying so, and a test that the payload object has no `auto_` key.
- [ ] Export `revertAutoMove(actor, …)` and `dismissSuggestion(actor, …)` from the same module.
- [ ] Every write path emits its audit row from Task 3.1's vocabulary, with `metadata.generation_id`, `metadata.day_class`, `before`/`after`.

### Task 3.9 — Probes, and the pre-apply contract

- [ ] `parAutoMovesReady()` and `parAutoLaneReady()` probes in `lib/dynamic-pars.ts`, both the `countProductAllocationReady` shape (cache TRUE only, re-probe while false, warn once naming the migration and its gate).
- [ ] Pre-`0182`: `runParShadowForLocation` returns `{ rows: 0, skipped: "schema_pending" }` and writes **no** audit row (a nightly "I did nothing" row is noise, not evidence).
- [ ] Pre-`0183`: the engine runs, ledgers everything, and `PAR_AUTO_APPLY_ENABLED` is false anyway — so the auto lane is untouched either way. Assert explicitly, because "the write bit is off" and "the columns do not exist" must both be true and must be true *independently*.

### Task 3.10 — Phase 3 close

- [ ] `npm test` + `npm run build` green.
- [ ] Local dry-run against a preview DB: one invocation produces **282 rows for one location** (141 × 2), exactly **one** `par.auto_tune_shadow` audit row, and a reason histogram whose largest buckets are `inventory_only` (114 = 57 × 2) and `no_weight_basis`.
- [ ] Re-invoke the same date: **row count unchanged, no duplicate audit row** (idempotence, projects r3 P2-10).
- [ ] 🔒 **GATE M2 — the lead applies `0183`.**

---

## PHASE 4 — surfaces

*Goal: the 14 lit rows render one number pair with a live horizon and a one-tap accept; the other ~268 rows become an errand list in two languages; one banner says the machine is watching but not touching.*

### Task 4.1 — `loadParSuggestions`: one batched read, horizon re-selected live

- [ ] `lib/dynamic-pars.ts` → `loadParSuggestions(sb, locationId, walkInstant)`:

```ts
/**
 * The walker's par-suggestion payload. ONE batched query for the ledger + the three small
 * rhythm reads, then PURE re-selection of the horizon at the walk instant.
 *
 * ── R3-A, IMPLEMENTED ──────────────────────────────────────────────────────────
 * The nightly row carries the DEMAND TERMS (base rate per day-class, velocity ratio, cushion,
 * per-order-unit oz, peak floor) and the horizon IT computed with. This function recomputes
 * ONLY the horizon — a pure selection over cutoff state at the walk instant — and re-runs
 * computeCoverage + applyGuardStack over the persisted terms. So:
 *   · a 9:58 walk and a 10:02 walk render DIFFERENT, both-correct numbers from ONE row;
 *   · the reason string names the delivery this par is being asked to reach;
 *   · nothing is written on a read (the write-on-read law forbids mutations, not selection);
 *   · the read costs one indexed query, not 21 days of history.
 *
 * `nextDeliveryAfter` is called with the walk's own cutoff state and NEVER reuses
 * governingCutoffTime, whose earliest-of-today tiebreak is a display rule (R3-A).
 */
export async function loadParSuggestions(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  walkInstant: { walkDateEt: string; walkMinutesEt: number; dayClass: DayClass },
): Promise<Map<string, WalkerParSuggestion>>;
```

- [ ] Reads: (1) the latest `par_auto_moves` row per `(sku, day_class = walkInstant.dayClass)` for this location — `order("run_date", desc)`, paged, first-seen-per-key wins (the `loadLatestOrderQtyBySku` idiom, `lib/ordering.ts:1096`); (2) `loadRhythmByVendor`; (3) `loadRhythmSkips`; (4) the **all-dows** cutoff read. Four queries, none per-SKU.
- [ ] **Staleness guard:** a ledger row older than 3 days is treated as absent with reason `stale_depletion` — a suggestion computed from a week-old base is not a current opinion. (3 days clears the Friday→Monday gap, the same reasoning `loadShrinkageSignals`'s 72h window already uses, `lib/ordering.ts:1485`.)
- [ ] The returned type, declared in `lib/dynamic-pars-shared.ts` so the client can import it without touching a server module:

```ts
/** What ONE walker row needs to render a suggestion and act on it. Everything here is either
 *  persisted on the ledger row or re-selected live; nothing is re-derived from history. */
export interface WalkerParSuggestion {
  currentPar: number;
  suggestedPar: number;
  /** The identity the accept/dismiss routes echo back — the 409 idempotency key (plan D14). */
  generationId: string;
  tier: "auto" | "suggestion";
  reasonCode: ParReasonCode;
  /** RE-SELECTED AT THIS WALK'S INSTANT (R3-A) — named in the reason string. */
  coverThroughDate: string;
  coveredDayCount: number;
  cushionPct: number;
  flooredByPeak: boolean;
  velocityApplied: boolean;
  /** True for a day-class with no par slot: aggregate-only, never a row-level number (D16). */
  slotCreation: boolean;
  /** The level-7 check, resolved SERVER-side so the client renders authority without ever
   *  knowing the role model (plan D1). */
  canAct: boolean;
}
```

`canAct` is computed from the request's actor in `loadWalkerData`, never in the component.
- [ ] Pre-`0182`: returns an **empty map**. `loadWalkerData` then behaves exactly as today.

### Task 4.2 — Wire the walker payload

- [ ] Add one pure helper to `lib/vendor-rhythm-shared.ts` (it belongs beside `cutoffMinutes`, which is its inverse-shaped twin):

```ts
/** Minutes-of-day of an instant in ET. The walk-time half of the cutoff comparison — the
 *  cutoff side is `cutoffMinutes`, and the two must live together or they will drift.
 *  `en-GB` + hour12:false gives a stable zero-padded "HH:MM:SS" in the operational zone. */
export function minutesOfDayEt(instant: Date): number {
  const hhmmss = instant.toLocaleTimeString("en-GB", {
    timeZone: "America/New_York", hour12: false,
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  return cutoffMinutes(hhmmss) ?? 0;
}
```

- [ ] `lib/ordering.ts`: add to the existing `Promise.all` in `loadWalkerData` (`:662`) a `loadParSuggestions(sb, locationId, { walkDateEt, walkMinutesEt: minutesOfDayEt(new Date()), dayClass: weekend ? "weekend" : "weekday" })` call. **One more parallel promise — the batch law is preserved and the walk gains no serial step.** The day-class comes from the already-derived `weekend` flag (`etWalkDay()`, `:624`), never from a second derivation.
- [ ] `WalkerSku` gains:

```ts
  /**
   * THE NUMBER PAIR (r1 walker legibility + r3 suggestion governance). null = nothing to say.
   *
   * MUTUALLY EXCLUSIVE WITH `parAdvisory` BY CONSTRUCTION: the #283 cause advisory and the
   * numeric suggestion never render on one row (r1). When both exist the NUMBER wins — a
   * suggestion that names a coverage horizon is strictly more actionable than "a recipe
   * changed", and two claimants on one row at 6 AM is the over-correction r2-9 rejected.
   */
  parSuggestion: WalkerParSuggestion | null;
```

- [ ] `WalkerData` gains `parSilence: ParSilenceSummary` and `shadowMode: boolean`.
- [ ] In `buildRow`, after computing `parAdvisory`, add: `const parSuggestion = suggestionBySku.get(s.id) ?? null;` and `parAdvisory: parSuggestion != null ? null : parAdvisory` — the exclusivity, enforced in the ONE row builder both the par'd walk and the rerouted-backup path share.
- [ ] The `parReview` counter (`:1016`) must count only rows that **actually render** the advisory — it already counts off the final rows, so the exclusivity above is automatically reflected. Add a test.
- [ ] **Retirement suppression is untouched:** a retired product's SKUs `continue` before a row is built (`:828`), so they can never carry a suggestion. Assert it — "never overrides the retirement suppression" is in the spec's *What it never does*.

### Task 4.3 — `ParSuggestionRow`: one number pair, one tap

- [ ] Create `components/ordering/ParSuggestionRow.tsx`. Renders, inside the existing SKU row beneath the `ordering.row.par` line:
  - the pair — `t("ordering.suggestion.pair", { current, suggested })` → **"Par 3 → suggested 5"**;
  - the reason, in kitchen language — `t("ordering.suggestion.reason_coverage", { n, unit, day, pct })` → **"5 covers you to Thursday's truck plus 20%."** `day` via `formatDateLabel(coverThroughDate, language)`;
  - a velocity clause when applied, and a peak-floor clause when `flooredByPeak` — separate keys, never string concatenation;
  - **Accept** and **Not now**, both `ActionButton` (operational grammar: `rounded-xl`, 48px, primary border `border-co-text`, label tracking `0.1em`), disabled with an explanatory title when `canAct` is false;
  - a `below_band_resolution` label when present — *"small pars are tuned by hand"* — so the manager knows the machine is not going to creep this one.
- [ ] **Accept live-recomputes the order quantity** (r1): on success the client sets the row's qty to `suggestedOrderQty(newPar, sku.advisoryOnHand?.orderUnits ?? null)` from `lib/dynamic-pars-shared.ts` — the **same pure function** the server used, imported, not re-derived. Then `router.refresh()` for the server-authoritative par, with the island's own state reset explicitly (the house law: `router.refresh()` does not reset client `useState`).
- [ ] **Shadow mode:** when `walker.shadowMode`, the accept affordance is still LIVE (the suggestion tier is real in v1 — plan §v1 scoping) but any auto-move notice reads **"would tune 3 → 4"** and its revert affordance is **disabled** with a title explaining that nothing was applied (projects r3 P2-9: a "par auto-tuned 3→4" notice beside a par that is still 3, with a revert button for a move that never happened, is a lie).
- [ ] Never render a number for `slotCreation` rows — those live in the aggregate only (**D16**).
- [ ] a11y: the pair carries an `aria-label` naming the SKU, both numbers and the covered-to day; both buttons carry their own labels; 44px floor with `items-center`.

### Task 4.4 — Accept / dismiss / revert

- [ ] Create `app/api/operations/ordering/suggestion/route.ts`:

```ts
// POST { locationId, skuId, dayClass, generationId, action: "accept"|"dismiss"|"revert" }
//
// AUTHORITY (plan D1/D2): level 7 — the value SKU_WRITE_MIN already carries, which is what
// "GM" means in lib/roles.ts (gm = 7; level 6 is AGM / catering_mgr / prep_mgr /
// social_media_mgr). The suggestion RENDERS at PAR_PASS_MIN (4) for transparency; acting on
// it is the same authority that may edit the par in the admin console today, no more and no
// less. NO step-up: /ordering is an operational surface that has never had one, step-up
// auto-clears on /admin exit, and a password prompt at 6 AM on a shelf walk is the
// affordance's death. The blast radius is one slot, one value, computed by the system and
// shown to the actor before the tap.
//
// IDEMPOTENCY (plan D14): par_suggestion_actions carries UNIQUE (location, sku, day_class,
// generation_id). The INDEX is the guard — the loser of a double-tap race takes 23505 and
// this route maps it to 409 suggestion_already_actioned. Same move as the display-code index
// arbitrating the double-generate race in lib/ordering.ts, proven on this surface by SIM-22.
```

- [ ] Validate the wire shape, then delegate wholly to `lib/dynamic-pars.ts` (`writeParFromSuggestion` / `dismissSuggestion` / `revertAutoMove`); the route maps typed errors, exactly like `app/api/operations/ordering/route.ts` does for `OrderingError`.
- [ ] **A stale generation is a 409, not a silent overwrite:** if the posted `generationId` is not the current ledger row's, return `409 suggestion_superseded` and let the client refresh. A manager must never accept a number that has since changed.
- [ ] `revert` additionally: nulls the auto column for the slot, **sets the pin**, and **consumes the budget**. `accept`: clears the pin, **does not** consume the budget. `dismiss`: writes nothing but the action row.
- [ ] Tests for the route's authorization matrix belong to the manual harness (DB-coupled), but the **pure decision** — who may act, what each action does to pin/budget — is unit-tested via a pure `parActionEffects(action)` helper in `lib/dynamic-pars-shared.ts`.

### Task 4.5 — The global shadow banner

- [ ] One banner on `/ordering`, above the vendor list, rendered when `walker.shadowMode`: *"Par tuning is watching, not touching. Suggestions are live; nothing changes a par on its own yet."*
- [ ] **ONE global banner, never a per-row reason** (r3, aggie r3 P1): in v1 100% of rows are in shadow, so a per-row shadow badge would badge everything and destroy the reason lane it sits next to.
- [ ] Tone: `AlertPill`-adjacent info styling on the existing notice stack, `co-warning-surface` + `co-warning-text` (never `co-warning` as text — it measures 1.95:1).

### Task 4.6 — The reason lane: the aggregate line + the errand list

This is the flagship. Build it as the spec's *"per-cause errand list"* on the attention lane, **not** as row badges.

- [ ] `lib/dynamic-pars.ts` → `loadParSilence(sb, locationId, runDateEt)`: one grouped read of the latest run's `par_auto_moves` rows → `ParSilenceSummary`:

```ts
export interface ParSilenceSummary {
  /** Rows the engine could speak for. */
  speaking: number;
  /** Rows silenced, per cause, in ERRAND_REASONS order then the rest. */
  byCause: Array<{ cause: ParReasonCode; count: number; sampleSkuNames: string[] }>;
  /** True when a per-row badge is warranted — false today, and it flips itself. */
  badgePerRow: boolean;
  /** Suggestions offered but not yet actioned, and auto-moves in the last 7 days. */
  suggestionsWaiting: number;
  autoMovesThisWeek: number;
}
```

- [ ] `sampleSkuNames` is capped at **3** and the copy says "and N more" — the named-when-few discipline `/admin/products`' retirement warning already uses.
- [ ] Create `components/ordering/ParSilencePanel.tsx`:
  - **the aggregate line** the spec asks for: *"3 pars auto-tuned this week · 2 suggestions waiting"* (with the shadow-mode variant *"would have tuned"*);
  - beneath it, a **default-collapsed `CollapsibleSection`** (Disclosure Doctrine D3/D4: summary row + drawer, i18n'd count on the collapsed header, phone-first full-row toggle, `useState`-only disclosure) titled *"Why 268 pars are quiet"*;
  - inside, one row per cause in `ERRAND_REASONS` order first (they are the errands), then the not-a-fault causes (`inventory_only`, `product_retired`) in a visually quieter group — **because 114 of the rows are packaging and putting them at the top would bury the real list**;
  - each errand row: count · plain-sentence cause · up to three SKU names · where to fix it (a link to `/admin/weights`, the vendor page, or the SKU page as appropriate).
- [ ] Mount beneath the existing `unroutable` notice block in `ParPassWalker.tsx` (`:463` region).
- [ ] **Success criterion for this task, stated for the reviewer:** on the first real render the panel must account for **every** silent par with a specific cause. A `reasonCode` bucket that reads "other" is a bug.

### Task 4.7 — The event (catering) advisory — named, never summed

- [ ] `lib/catering/sku-demand.ts`: split out an actor-less `deriveCateringSkuDemand(locationId, from, to)` core; `loadCateringSkuDemand(actor, …)` keeps its `PREP_DEMAND_READ_MIN` gate and calls it (**plan D11** — the exact `salesConsumption` → `deriveSalesConsumption` precedent at `lib/catering/toast-sales.ts:429`).
- [ ] `loadWalkerData` calls it for `[walkDate, coverThrough]` — **one call for the whole walk**, in the existing `Promise.all`.
- [ ] `WalkerSku.parEvent: { needDate: string; oz: number } | null` — rendered as *"Catering Thursday needs 38 oz"* using `formatDateLabel`.
- [ ] **NEVER SUMMED into any tunable number** (r1-1, 6/6 unanimous): a fulfilled event's consumption already enters the base through toast/production, and `productions` carries no catering attribution, so the base cannot be cleaned. Enforce structurally — `parEvent` is a display field on `WalkerSku` and is **not** an input to any function in `lib/dynamic-pars-shared.ts`. Add a test that greps the pure module for the string `parEvent` and asserts zero hits.
- [ ] Record the stated v1 limitation in the module doc: *recurring-event consumption pollutes the base once per cycle (single-count) until the `productions` quote-link enabler ships* (r2-12). File that enabler to `docs/ROADMAP.md` in Phase 5.

### Task 4.8 — i18n: en + es, full sentences, same PR

**Full-sentence keys per cause** (r3), operational tú-form Spanish, and **every ARIA label**. The reason lane's technical vocabulary ("production capture") needs an *operational* Spanish equivalent, not a literal one — aggie's two-voice law: the tuned notice is operational shorthand, the reason lane is technical, and both must survive translation.

- [ ] Add to `lib/i18n/en.json` and `lib/i18n/es.json` (~64 keys). The required key families, each with an `_aria` sibling where it names an interactive element:

| Family | Keys |
| --- | --- |
| Suggestion | `ordering.suggestion.pair` · `.reason_coverage` · `.reason_velocity` · `.reason_peak_floor` · `.reason_event` · `.accept` · `.accept_aria` · `.dismiss` · `.dismiss_aria` · `.accepted` · `.superseded` · `.manual_only` · `.pair_aria` |
| Shadow | `ordering.shadow.banner` · `.would_tune` · `.revert_disabled` |
| Auto notice | `ordering.auto.tuned` · `.revert` · `.revert_aria` · `.reverted` |
| Reason lane | `ordering.silence.headline` · `.aggregate` · `.section_title` · `.and_more` · one `ordering.silence.cause.<code>` **and** one `ordering.silence.fix.<code>` for **every** member of `PAR_REASON_CODES` |
| Vendor rhythm admin | `admin.vendors.rhythm.title` · `.pair` · `.add` · `.order_day` · `.lead_days` · `.delivers` · `.location` · `.none_yet` · `.explainer` · `.remove` · `.remove_aria` · `.skip_title` · `.skip_add` · `.skip_from` · `.skip_through` · `.skip_note` · `.skip_explainer` |
| SKU admin | `admin.skus.cushion_class` · `.cushion_hint` · `.par_step` · `.par_step_hint` · `.auto_par_readonly` |

- [ ] Add a test to `tests/dynamic-pars-reason.test.ts` asserting **every** `ParReasonCode` has both a `cause` and a `fix` key present in `en.json` **and** `es.json` — the closed-vocabulary → closed-copy invariant, in the `tests/readiness.test.ts` shape. A missing key must fail CI, not render a key name at 6 AM.

### Task 4.9 — Show the machine's standing number, read-only, where a human edits pars

- [ ] `components/admin/skus/SkuLocationOverlay.tsx`: when `auto_weekday_par` / `auto_weekend_par` is non-null for the selected location, render it as **read-only** context beside the human field — *"machine: 4 (applied Aug 20)"* — never as an editable input.
- [ ] **The route already structurally excludes the auto columns** (its payload is an explicit five-field object, `lib/admin/skus.ts:767`). Add the assertion test and a comment; do not add a filter that implies the columns were ever reachable.
- [ ] A human blanking their own override here **nulls the auto column and clears the pin** for that slot — via the Task 3.8 authority, not inline.

### Task 4.10 — Phase 4 close

- [ ] `npm test` + `npm run build` green.
- [ ] **Screenshot the running app** (the UI-arc law: build-green ≠ renders-right) at the preview URL, phone width first: the walker with a suggestion row, the shadow banner, the collapsed and expanded reason lane, both languages.
- [ ] Juan smoke on the preview URL — never production.

---

## PHASE 5 — sim + arc close

*Goal: the council's own scenario walks become permanent regression fixtures, the cumulative diff clears the T0 checklist, and the law lands in `AGENTS.md`.*

### Task 5.1 — The five r3 scenarios as fixtures

- [ ] Create `scripts/sim/dynamic-pars/scenarios.ts` — **pure fixture data plus the expected verdict for each**, imported by the vitest suites (not a live-DB harness; these are arithmetic regressions and belong in CI).

| # | Scenario | The assertion that must never regress | Source |
| --- | --- | --- | --- |
| 1 | **The ham week** — par 3 weekday, no weekend slot, demand steps +40% (a new sandwich) | The flat 21-day base crosses the band at **~day 18**; velocity sees it at **day 4** but is suggestion-lane only. Assert the ledger says both, every night, so the ~3-week step latency is *visible*, not silent. This is the accepted-and-stated behaviour aggie r3 P1 demanded be documented rather than hidden. | aggie r3 · brief scenario 1 |
| 2 | **Mozz unit bomb** — a target 4× the standing par because eaches were read as cases | `par_unit_suspect`, **no number**, an errand row naming the SKU. Assert `suggestedPar === null`. | r3 quarantines |
| 3 | **Prosciutto floor** — mean + 20% lands under the worst observed weekend run | `flooredByPeak: true` and the suggestion is raised to the observed peak. Assert with the live 435 oz / 30 day series shape. | r3 peak floor |
| 4 | **Primary flip week** — PFG down Tue–Thu, Baldor carries the par | Product-grain rates hold (no demand collapse); the write-home stays the **designated primary's** slot, so the tuned par survives the restore (**R3-B**). Assert the write-home id equals `primarySkuId`, not the carrier. | R3-B · projects P2-1 |
| 5 | **9:58 / 10:02** — one ledger row, two walks across a 10:00 cutoff | Different `coverThroughDate`, different `coveredDays.length`, both correct; the ledger row is **unchanged** by either read. | R3-A |

- [ ] Two more, cheap and high-value: **cold-start location** (zero observed days → `no_local_history`, no number, no sibling number either) and **budget-blocked Sunday** (a within-band delta on a spent budget renders `budget_spent`, never a silently stale par — projects P2-3).

### Task 5.2 — T0 sweep over the cumulative diff

Run the 20-class recurring-bug checklist. The classes this design **structurally invites**, named by three council seats — each needs an explicit line in the sweep notes:

- [ ] **#9 active-filter blindness** — `vendor_delivery_rhythm`, `vendor_rhythm_skips` and `par_suggestion_actions` all need `active`/supersede discipline from birth; assert every read filters it and the partial unique index matches.
- [ ] **#6/#24 unbounded id lists** — no `.in()` over 141 SKU ids in a GET request line anywhere in the engine; every window read is paged under a stable total order.
- [ ] **#13 unregistered audit actions** — `npm test -- audit-actions` and a grep for template-literal action names.
- [ ] **#22 RLS** — both migrations carry `ENABLE ROW LEVEL SECURITY` + the triple `REVOKE`.
- [ ] **#26 unit heterogeneity** — the band speaks in order-unit **steps**, the base in **oz**; assert the conversion happens exactly once, at `computeCoverage`, via `perOrderUnitOz`.
- [ ] **Silent UPDATE denial** — every UPDATE in `lib/dynamic-pars.ts` and `lib/vendor-rhythm.ts` passes `{ count: "exact" }` and 404s on 0.
- [ ] **The write-on-read law** — grep the walker read path for any `insert`/`update`/`upsert`; there must be none. (`loadOnHand` WRITES on read and is *not* called by anything new here — `loadWalkerData` already calls `loadOnHandDerived`, unchanged.)
- [ ] **Fail-open discipline** — the `par_auto_moves` insert is the guard's state home and therefore must **not** be fail-open like `audit()`; a failed ledger write must throw so the run is retried, and the cron's per-location try/catch contains it (projects r3 P3).
- [ ] **Second-resolver** — grep for any resolution of a product outside `loadProductIndex`. There must be exactly one ladder.

### Task 5.3 — Documentation + arc close

- [ ] `docs/ROADMAP.md`: mark the Dynamic Pars arc's v1 shipped; file the follow-ups the four spec layers name as enablers — **quote-link on `productions`** (unblocks a clean event layer and kills the single-count pollution), **the resale marker on `vendor_items`**, **the statistical cushion** (the socket + its data precondition), **Add-a-Location / sibling designation**, **the 27 contradictory flat weights** as the weight board's next census, **the day-class boundary as tenant config** (aggie: "weekend = Fri/Sat/Sun" is CO's vocabulary; a second restaurant's busy days differ — queue with `tenant_role_labels`).
- [ ] `AGENTS.md` § Product identity gains a sibling § **Dynamic pars**, stating the durable laws in the house voice: the three-lane `resolvePar` and that a human always wins · the machine writes only its own columns and only through the one authority · the band speaks in par steps and pars ≤3 steps are manual-only · budget consumed by auto-writes and reverts, accepts free · a pin is cleared only by a direct human edit at the same slot · the coverage horizon ends at the **second-next** delivery and is selected at read time · the reason lane is the product and a silent par always names its errand · velocity is a bounded dimensionless ratio and can never enter an oz sum · the event layer is named and never summed · **the double-count law is not in play and `direct_oz` was not touched**.
- [ ] Update the durable memory topic file for the arc (`project_coops_dynamic_pars_arc.md`) with the scope-honesty numbers, the gate log, and the Phase-5 findings.

---

## Four-layer spec coverage map

Every clause of every layer, mapped to the task that implements or guards it. Later layers override earlier ones; where they do, the row cites the override.

### Layer 1 — the original design (2026-08-21)

| Clause | Task |
| --- | --- |
| Tiered autonomy ("A with a little auto on it") | 2.8 (`applyGuardStack` tiers) |
| Small drifts self-apply, ±1 order unit, one move/SKU/week | **overridden by r2** (par steps) → 2.8 · budget 2.8 + 3.5 |
| Every auto-move writes an audit row with the full why | 3.1 (`par.auto_tune`) + 3.7 (run row) + 1.1 (`par_auto_moves.detail`) |
| Visible "par auto-tuned N→M" notice with one-tap revert | 4.3 · **r3 override**: shadow says "would tune", revert disabled |
| Bigger moves are suggestions, one-tap accept | 4.3 · 4.4 |
| Nothing beyond the band ever moves itself | 2.8 (`withinBand` → suggestion tier) |
| Velocity spikes may SUGGEST immediately, AUTO at most weekly | 2.4 + 2.8 (velocity never reaches the auto tier in v1 — r1-6) |
| Base = trailing consumption, the usageRank lanes, **never `flattened_oz`** | 2.2 (`computeBaseRate`, the two-lane sum) |
| Window 21 days, day-class split, config-in-code | 2.1 (`BASE_WINDOW_DAYS`) + 2.2 |
| Events from W4a/W4b, per-SKU oz, named on the walker | 4.7 · **r1-1 override**: advisory only, never summed |
| Velocity from Toast through the recipe flatten, bounded | 2.4 · **r1-6 override**: residual ratio, not a level |
| Par = rate × days-to-delivery × (1 + cushion), against 0174 config | 1.2 + 2.6 · **plan D3 override**: Σ per covered day to the **second-next** delivery |
| Adding a delivery day reshapes every suggestion | 1.2/1.4 (rhythm is the only horizon input) |
| Cushion = policy, per SKU class, config-in-code | 2.5 + 1.6 (class as data, % in code) |
| Explainable in kitchen terms | 4.3 (`reason_coverage` copy) |
| The C-socket `cushionFor(sku, location, demandStats)` | 2.5 (signature pinned, `demandStats` unused) |
| Degradation: no rhythm → delta-nudging | 2.7 (`no_vendor_rhythm`) + 4.6 (errand row) |
| Degradation: thin history → advisory-null (honest-null law) | 2.2 (`thin`) + 2.7 (`thin_history`) |
| Per-location from birth, no global par math | migrations 0182/0183 (location-keyed) · 2.x (no global path exists) |
| Sibling-prior cold start, scaled + decaying | 2.9 (`siblingBlendWeight`, seam only) · **deferred by r1-11** |
| Sibling channel filter | **infeasible (r1-11)** — recorded in 2.9's doc block, deferred to Add-a-Location |
| Walker = the surface; accept writes par + audit | 4.3 · 4.4 |
| Ordering attention lane aggregate line | 4.6 |
| No new admin surface in v1 | 1.4 (rides the vendor page) · 4.6 (rides `/ordering`) |
| Par-history drawer "if cheap" | **not built** — `par_auto_moves` is its source and is indexed for it (1.1); filed to ROADMAP in 5.3 |
| Never moves beyond the band unaided | 2.8 |
| Never suggests from thin data | 2.2 + 2.7 |
| Never fabricates a demand term (each layer degrades to absent) | 2.2 (null rates) · 2.4 (`applied: false`) · 2.6 (null on unknown) |
| Never mutates pars outside audited paths | 3.8 (the ONE authority) |
| Never overrides retirement suppression (#283) | 4.2 (assert: retired products `continue` before a row exists) |
| Never touches the double-count law's lanes | 2.2 doc + 3.4 (`direct_oz` checksum) + 5.2 |
| Vitest for every pure term | 2.1–2.9 |
| Sim-day scenarios before arc close | 5.1 |
| Out of scope: statistical cushion · Add-a-Location · resale/inventory-only · multi-vendor split | 2.5 doc · 2.9 doc · 2.7 (`inventory_only` rung) · not built |

### Layer 2 — r1 council amendments

| Clause | Task |
| --- | --- |
| **v1 = SHADOW MODE**, computes all, applies nothing | 3.6 (`PAR_AUTO_APPLY_ENABLED = false`) |
| Suggestion-mode unlocks per-SKU as lanes light | 2.7 (the reason ladder IS the per-SKU gate) |
| Lane-coverage gate: prep-mediated ⇒ advisory-null | 2.2 (`laneComplete`) + 2.7 (`no_production_capture`) |
| Auto graduates per-location after ramp + count anchor | 2.9 · dark |
| **The reason lane ships in v1** (4 named causes) | 2.7 + 4.6 (18 causes, superset) |
| r1-1 event layer advisory-only; enabler filed | 4.7 + 5.3 |
| r1-2 rhythm ships on the existing vendor admin; ONE `nextDeliveryAfter`; Σ per day-class | 1.1 · 1.2 · 1.4 · 2.6 |
| r1-3 rates at PRODUCT grain; suggestions attach via the ladder; twins never written | 3.5 (rollup) · 3.5 (write-home, **R3-B**) |
| r1-4 `auto_*` columns; `resolvePar = human ?? auto ?? global`; revert nulls + pins; global never auto-written | 3.2 · 3.3 · 3.8 |
| r1-5 band per (SKU, location, day-class); floor ≥1; auto-to-zero forbidden; one budget/7d; hysteresis + 2-run confirm | 2.8 · **r2 override** on the magnitude · **r3 override** on the grain name |
| r1-6 velocity: ratio, residual, 3-day persistence, recipe-edit reset, suspect-excluded, suggestion-only, capped | 2.4 (+ **plan D4** for the suspect mechanism) |
| r1-7 oz→order-unit via `perOrderUnitOz`; unresolvable pack → advisory-null with the reason | 2.6 · 2.7 (`no_weight_basis` / `unresolvable_pack`) |
| r1-8 audit adjudication now | 3.1 |
| r1-9 cushion classes = per-SKU data, % in code, signature pinned | 1.6 · 2.5 |
| r1-10 day-class segmented, observed-day denominators, per-class thin thresholds, 21d-vs-30d documented | 2.2 · 2.1 (`MIN_OBSERVED_DAYS`, the window comment) |
| r1-11 sibling whole-pattern only, qualification threshold, per-SKU blend | 2.9 |
| r1-12 scope walls: resale/inventory-only OUT · un-par'd = advisory only · new-SKU cold start a known limitation · cron not the read path · ONE number pair · accept live-recomputes qty · advisory and suggestion never co-render | 2.7 · (un-par'd SKUs never enter the walk — `lib/ordering.ts:634` selects only par'd rows) · 5.3 · 3.7 · 4.2 · 4.3 · 4.2 |

### Layer 3 — r2 amendments

| Clause | Task |
| --- | --- |
| **THE FIX**: band in PAR STEPS; magnitude `max(1 step, 25%)`; never below one positive step; round to the step; **no slot creation**; fractional pars render as fractions, order qty ceils | 2.1 (`parStepFor`, `roundToStep`) · 2.8 · **r3 override** adds the ≤3-step rule and cap-after-rounding · 4.3 (fraction rendering) · 2.1 (`suggestedOrderQty` ceils) |
| r2-1 rhythm storage home, location-scoped, exact schema named | 1.1 |
| r2-2 ramp denominator + `par.suggestion_dismiss`; N=10 config; affordances on the suggestion | 2.9 · 3.1 · 2.1 · 4.3 |
| r2-3 graduation widens the TRIGGER, never the write set; count-anchor oracle = physical `sku_count_events` | 2.9 doc + `hasDirectCountAnchor` |
| r2-4 `par.auto_tune_shadow` its own name | 3.1 |
| r2-5 longitudinal clamp to `lane_start_at` | 2.2 |
| r2-6 auto values self-invalidate on a global par change | 3.2 (baseline columns) · 3.3 (`resolveLane`) |
| r2-7 shadow SIMULATES the full guard stack, same code + mode flag | 2.8 (`mode`) · 3.6 |
| r2-8 budget + PIN grain = slot; **budget consumed by auto-writes and reverts, accepts free**; PIN cleared by a human edit; no auto-expiry | 2.8 · 3.8 · **r3 override**: the act that sets a pin never clears it; direct-same-slot only |
| r2-9 reason lane's home = the attention lane / an admin aggregate | 4.6 |
| r2-10 velocity keeps BOTH gates | 2.4 |
| r2-11 day-class boundary = the shipped definition, 9 weekend points | 2.1 (`dayClassForDate` delegates to `isWeekendParDow`) · 2.2 tests |
| r2-12 stated limitation: single-count event pollution | 4.7 doc · 5.3 |
| r2-13 the data critical path: weight → rhythm → cushion | 2.7 (`ERRAND_REASONS` order) · 4.6 |

### Layer 4 — r3 amendments (the exhaustive pass)

| Clause | Task |
| --- | --- |
| **R3-A** horizon = read-time pure selection at walk-time cutoff state; ledger records its own; 9:58 ≠ 10:02; covered-to named; `nextDeliveryAfter` never reuses `governingCutoffTime` | 1.2 · 4.1 · 4.3 · **plan D3** pins the endpoint · **plan D5** pins the cutoff source |
| **R3-B** auto values homed on the STABLE PRIMARY's slot, never a transient carrier | 3.5 (write-home) · 5.1 scenario 4 |
| Suggestion-lane hysteresis + stable GENERATION-ID | 2.8 (`stabilizeSuggestion`, `generationIdFor`) |
| Ramp counts DISTINCT GENERATIONS, not nightly renders | 1.1 (`par_suggestion_actions` unique) · 2.9 |
| Superseded-unactioned offers expire without ramp penalty | 2.9 (only actioned generations are counted) · 4.4 (`409 suggestion_superseded`) |
| NULL `lane_start_at` = advisory-null, stated | 2.2 · 2.7 (`no_lane_start`) |
| A zero target is NEVER a suggestion | 2.8 (`zero_target`) · 5.1 |
| Target <50% or >200% = "par unit looks wrong", never a number | 2.8 (`par_unit_suspect`) · 5.1 scenario 2 |
| Suggestions FLOOR at observed-peak coverage | 2.3 · 2.6 · 5.1 scenario 3 |
| The act that sets a PIN never clears it | 3.8 (revert sets, never clears) |
| Only a DIRECT human par edit at the same slot clears a PIN; global edits invalidate the VALUE, pin stands | 3.3 (`resolveLane`) · 3.8 |
| A human blanking their own override NULLS the auto column on that slot | 3.8 (`admin` kind) · 4.9 |
| Both `item_par.update` and `par.suggestion_accept` clear pins | **plan D8**: the live name is `vendor_item.update` (scope `location_settings`) — 3.8 |
| ONE par-write authority fn with an actor-kind | 3.8 |
| accept/dismiss/revert floor GM; render visible ≥4 | **plan D1**: level **7** — 4.4 · 4.1 (`canAct`) |
| 409 idempotency keyed on the generation, all three routes | **plan D14** — 1.1 · 4.4 |
| `location_sku_settings` RLS stance stated in the migration | 3.2 |
| The admin settings route EXCLUDES the auto columns | 4.9 (assertion test) |
| `depletion_current_through` watermark gates the pars step | **plan D9** — 3.7 |
| Idempotent per (run_date, SKU, location, slot); retries never double-write | **plan D13** — 1.1 · 3.6 |
| Full-gap days = a named gap class: EXCLUDE, never null | **plan D10** — 2.2 |
| Audit volume: ONE run-level row per (location, night) | 3.7 |
| Rhythm = order→delivery PAIRS | 1.1 |
| Rhythm rows EXPLICITLY per-location, no NULL inheritance | 1.1 (`location_id NOT NULL`) |
| Legacy `vendors.delivery_days` never read | 1.1 comment · 5.2 grep |
| "In shadow" = ONE global banner, never a per-row reason | 4.5 |
| Shadow notices say "WOULD tune"; revert disabled | 4.3 |
| `par.auto_tune_shadow` registered (incl. the RESERVED path if SQL-emitted) | 3.1 — **emitted from TS, so no RESERVED path**; stated |
| Pars ≤3 steps are below the band's resolution: manual-only, labelled | 2.8 (`below_band_resolution`) · 4.3 |
| The cap clamps AFTER rounding | 2.8 |
| Budget grain = day-CLASS; "day-slot" renamed throughout | 1.1 (`day_class`) · used consistently in every type |
| The weekend slot optimises the longest-gap walk day (Friday) | 1.2 (`optimizationWalkDate`) · 3.6 |
| Per-walk-day nuance rides the R3-A read-time horizon | 4.1 |
| A within-band-but-budget-blocked delta gets its own reason cause | 2.8 (`budget_spent`) · 5.1 |
| Count anchor requires `allocated_from_product_id IS NULL` | 2.9 (`hasDirectCountAnchor`) + the loader predicate in 3.4 |
| A vendor-down week gets a one-off rhythm-skip affordance | 1.1 (`vendor_rhythm_skips`) · 1.2 · 1.4 |
| Sibling inheritance carries per-SKU lane-lit/dark status | 2.9 doc (the seam's stated contract) |
| Migration sequencing per the 0180 probe precedent, auto columns LAST, byte-identical walker pre-apply | **plan D12** — 1.5 · 3.2 · 3.9 |
| i18n full-sentence keys per cause, en+es, `formatDateLabel` for day names | 4.8 · 4.3 |
| Day-class boundary = one named tenant-shaped constant | 2.1 (`dayClassForDate`) · 5.3 (filed as tenant config) |
| Known conflict class: 27 par'd SKUs with contradictory flat weights — listed, not guessed | Scope-honesty table · 5.3 (filed to the weight board) |
| Scope honesty: exactly 14 rows; **the reason lane is the product** | Scope-honesty section · every phase's success measure |

---

## Open items for the lead

1. **D1 (level 7, not 6)** is the one deviation that changes who may press a button. If the lead wants AGM (6) to be able to accept, say so and the plan flips one constant — but it is then a genuine widening of par authority, not a match to today's.
2. **D3 (second-next delivery)** changes the coverage number by ~2× on the main path versus the naive reading. It is argued from base-stock theory, from builder's SC1, and from Juan's own "covers you to Friday's truck" phrasing — but it is arithmetic the lead should agree with before ~14 rows render it.
3. **D4 (`toast_daily_sales_signals`)** adds a fifth table to serve one gate on a suggestion-lane-only term. If the lead prefers, dropping **velocity** to v1.1 (the spec permits it costlessly) removes this table and Task 2.4 entirely — that is the cheapest way to shrink the arc, and it is the drop the council pre-authorised.
4. **The par-history drawer** is "if cheap" in the spec and is **not** in this plan. `par_auto_moves` is indexed for it; it is one read and one `CollapsibleSection` on the SKU page whenever the lead wants it.

---

*Plan authored 2026-08-22 against spec `2389f5e`, with live prod recon the same day. Every figure in the Scope-honesty table is reproducible from the probes recorded in the session log; every deviation is argued from a file path and a line number rather than from memory. When this plan and the live system disagree, the live system wins — and the plan is corrected in the same PR.*






---

## LEAD RULINGS (CC, 2026-08-22 — plan APPROVED for execution)

**All 16 deviations BLESSED as argued.** D1 verified live (gm=7, level 6 includes social_media_mgr; SKU_WRITE_MIN=7) — it corrects the r3 amendment's own "GM ≥6" error; the accept/dismiss/revert floor is **7**. D3's second-next-delivery endpoint, D4's day-grain signals marker (direct_oz untouched), D5's two-selection cutoff store, and D14's index-as-409 are all the right shapes.

**Recon-uncertainty dispositions:** ① the coveredDays boundary convention (evening-walk/morning-delivery) rides as authored — test-pinned, one-flag flippable, and flagged for Juan's one-word confirm at Phase-4 smoke (not blocking) · ②③④⑤ = builder-verified in-phase as flagged; ④'s degrade-to-never-firing is safe and its emptiness gets logged in the reason lane's aggregate.

**Standing gates:** migrations at 🔒M1/🔒M2 on Juan's word only. Phase success = reason-lane completeness (the product), not suggestion volume. The auto tier's live population is 1 SKU — say so in every phase PR so nobody mistakes shadow-quiet for broken.
