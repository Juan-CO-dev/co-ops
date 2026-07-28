# SKU module — top-tier redesign (class-aware pack depth + catalog-grade navigation)

**Status:** APPROVED (Juan, 2026-07-28). Council: `.claude/council/2026-07-28-sku-page-toptier/` (report.md = binding synthesis; r1-builder.md = the code-level reframe; r1-aggie.md = consumer trace + anchor_dimension; cc-take.md = head seat).

Owner's driver (near-verbatim, two phone screenshots as evidence): *"Not all SKUs show the pack chain — some show the old way. In reality it should be a combo of both, but not all SKUs allow for it: packaging and cleaning ones make sense NOT to have something extensive like that — but the ORDERS are needed. Also redesign the SKU page to be much easier to navigate, like the items [catalog] page is now. UX is super important — if managers don't want to use it, employees won't."*

---

## The reframe (builder seat, adopted unanimously-in-substance)

Both original camps misdiagnosed the blocker.

- **The pure walk already handles count leaves honestly.** `walkChainToOz` (`lib/pack-chain-shared.ts`) resolves a count/volume leaf via the SKU's `avg_oz_per_each`; when that's null it returns a *typed, loud* `missing_avg` failure — never a wrong number. So "the leaf law blocks packaging" is false at the walk level.

- **The real blockers are two, both consumer-side:**
  1. `validateChainReachable` **conflates structural reachability with oz-resolvability.** It walks from the root and treats a `missing_avg` result as `!ok` → a structurally-perfect count-terminated chain (e.g. `case → 12 each`) gets the **unverified** badge falsely. This is the boy-who-cried-wolf failure (Disclosure D2): if packaging chains cry wolf, managers learn to ignore the badge.
  2. **Three consumers still read the legacy flat fields, not the chain:** `readiness.skuPackComplete` (checks `units_per_pack`/`each_size`/`each_measure`), `catering/sku-demand`'s `skuContentOz`-without-chain path, and `formatSkuPack`. Even newly-chained *raw* SKUs don't feed reorder until these migrate.

**The resolution: ONE mechanism — the chain, at class-aware depth.** The pure walk is NEVER touched (opus's type-purity concern honored). Class-awareness lives only in (a) a **validation split** — structural validity vs oz-resolvability, only the latter class-gated — and (b) the **unverified badge read-path**. opus's `pack_qty` alternative was rejected (re-creates the two-vocabulary pain, loses level-aware receiving); opus's count-space-ordering insight survives as PR-C.

**The rule (class-aware pack depth):**
- **raw** → full oz-terminated chain (unchanged): its leaf must be oz-resolvable (weight-dim measure, OR count/volume + `avg_oz_per_each`). It feeds depletion/cost.
- **packaging / cleaning / misc** → shallow ORDER CHAIN: the leaf may be a **bare count-dim measure** (e.g. `each`), NO `avg` required. These never enter recipes/depletion; the chain exists so ORDERS work (`case → 12 each`).
- Cleaning chemicals get an **opt-in** weight leaf later (bleach 128 oz/jug — aggie); not required.

A non-raw count-terminated chain is **COMPLETE BY DESIGN** — no unverified badge.

---

## The 3-PR build shape (builder's sequence)

- **PR-A (this spec — visible win, no consumer work):** navigation lenses + human vocabulary + **validation split** (structural vs oz-resolvable, class-gated) + **class-aware unverified badge** + **seed 14** (count-chains for non-raw from legacy flat fields).
- **PR-B:** the guided chain **wizard** (class-aware depth, flat-field sync-on-save) replacing the quick-pack fields in `SkuBuilder`.
- **PR-C (the real work):** count-native counts/reorder for non-recipe classes — counts gain `anchor_dimension` (`'weight'|'count'`), packaging counts anchor in leaf units, ordering reads count-space ("2 cases short"). Wire the 3 laggard consumers to chains along the way.

---

## PR-A contents (this PR)

### 1. Validation split (`lib/pack-chain-shared.ts` + `lib/admin/pack-chain.ts`)

Separate **structural validity** from **oz-resolvability**. The pure walk (`walkChainToOz`, `validateChainReachable`, `countReachable`) stays byte-identical.

- New pure `validateChainStructure(chain, measures)` in `-shared.ts`: single root, acyclic, all levels reachable from the root, leaf terminates in a **registered measure of any dimension** (weight/volume/count). No `avg` needed. Returns a typed result reusing `PackChainWalkFailure` reasons (`unknown_label` for no-unique-root, `dangling_pointer` for unreachable/fork, `cycle`, `missing_measure`).
- New pure `isChainUnverified(chain, measures, avgOzPerEach, skuClass)` in `-shared.ts` — the single source of truth for the badge:
  ```
  UNVERIFIED  ⇔  !validateChainStructure(chain, measures).ok
                 OR ( skuClass === 'raw' AND !walkChainToOz(root, …).ok )
  ```
  i.e. any structural break is unverified for every class; oz-unresolvability is unverified **only for raw**. Non-raw structurally-valid count-chains are COMPLETE BY DESIGN.
- Read path (`app/admin/skus/page.tsx`): replace the bare `!validateChainReachable(...).ok` with `isChainUnverified(..., skuClass)`, threading each SKU's `skuClass`.
- Write path (`lib/admin/pack-chain.ts` `validateSubmission`): accept a count-dim leaf without `avg` for non-raw classes; **raw** keeps the current `leaf_needs_avg` requirement. `sku_class` is read in `assertSkuExists` and threaded through `loadSkuPackChain` + `replaceSkuPackChain`.

The `firstLabelMeasureCollision` (L1), single-root, acyclic, reachable, and terminates-in-a-measure checks all remain enforced on the write path for every class.

### 2. Navigation (`SkuCatalogClient.tsx` + page)

Port the `CatalogClient` pattern 1:1:
- **Lens chips:** `[All · Raw · Packaging · Cleaning · Misc · No pack info (N) · Unverified (N)]`. The four class chips filter by `sku_class`; the last two are **cross-cutting** status lenses carrying campaign counters (D2, never collapse; D5 i18n'd counts via `t(key,{n})`).
- **Vendor stays a `<select>`** (17 vendors = chip sprawl, D8).
- **Search** over name + item number.
- **Grouping by CLASS** with i18n'd counts on each `<h2>` header.
- W2 **SummaryRow drawers unchanged** (lazy `SkuCostPanel`, multi-expand Set).
- The existing `chainFilter` select folds into the **No pack info** chip.

### 3. Human vocabulary (i18n en + es)

- `"Unchained"` → **"No pack info"** everywhere it renders (chip, badge).
- Row CTA for a no-pack-info SKU: **"Add ordering info"** (task-oriented, not defect-shaming — sonnet).
- The **unverified** badge gains a `title`/tooltip explaining what to fix: *"Can't compute ounces — check the measure unit or per-each weight."*
- The `sku_class` picker (`SkuForm`) gains one-line **hint text per class** (raw needs weights; packaging/cleaning/misc just need pack counts).
- Keep existing keys that still fit; add/rename via new keys (never orphan a referenced key).

### 4. Seed 14 (`scripts/seed/14-shallow-pack-chains.ts`)

Staged (prod apply on Juan's go). For every **active non-raw-class** SKU with **NO chain** and usable legacy pack data (`pack_format` + `units_per_pack`): generate a **count-terminated** chain — root = `canonicalContainerLabel(pack_format)` containing `units_per_pack` of a leaf `"inner"`-style count level terminating in the `"each"` **measure**. Reuses seed 13's label canonicalization and the `firstLabelMeasureCollision` measure-collision guard **exactly** (fail loud, exit 1, on any collision — the BC class was caught twice; this seed runs the same guard). SKUs with garbage/missing legacy data are **SKIPPED** with a printed list (they surface via the No-pack-info lens — never guessed). Idempotent (supersede-as-a-SET), `SEED_DRY=1` dry-run flag, `pathToFileURL` direct-invocation guard.

### 5. Tests

- `tests/pack-chain.test.ts` extended: validation-split cases (structural-vs-oz; non-raw count-leaf-no-avg = **verified**; raw count-leaf-no-avg = **unverified**; structural break unverified for every class) + seed 14 label-guard cases.
- i18n en/es key parity.
- `npm test` + `npm run build` green.

### Out of PR-A scope (do NOT touch)

The pure walk internals; the three laggard consumers (`skuPackComplete`, `sku-demand`, `formatSkuPack` — wired in PR-C); counts/receiving libs; `SkuBuilder`'s quick-pack (replaced in PR-B); toast-sales; proxy; staff runtime.

---

## D-law compliance (Disclosure Doctrine binds this UI)

D1 identity line always visible · D2 unverified/no-pack-info badges + campaign counters never collapse · D5 i18n'd counts on collapsed headers · D6 lens chips + search on a ≥10-row list · D8 phone-first full-row toggles, vendor as select not chip · D9 disclosure state = useState only · D10 a11y `<button>`+aria on chips.
