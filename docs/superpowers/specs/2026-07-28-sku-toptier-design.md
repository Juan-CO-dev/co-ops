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

## PR-B contents — the class-aware guided chain wizard

**Status:** BUILT 2026-07-28 (branch `claude/sku-toptier-b`, base c4de8b8 / PR #199). Replaces `SkuBuilder`'s legacy quick-pack fields (Section B, add + unchained-edit) with a guided flow that asks the SAME pack questions for every SKU and STOPS SOONER for non-raw. The stop is automatic BY CLASS, never a manager decision. So every SKU speaks ONE pack language — the chain — at class-aware depth.

### 1. The wizard (`components/admin/skus/PackChainWizard.tsx`, pure-presentational client)

An unchained SKU (add OR edit) gets, in Section B, a guided flow in chain vocabulary. Per level, two questions:
- **Q1 "What does it come in?"** — the level label (free text + datalist suggestions from the passed pack-format registry / `sku_pack_formats`). Safe default when blank: `"container"` (root) / `"inner"` (deeper) — NEVER a measure-unit label.
- **Q2 "How many per?"** — the `containsQty` count for that level.

Then a **branch**: **"Another container inside?"** → recurse (a new Q1/Q2 for the inner level) — OR **terminate**. Termination is **CLASS-AWARE and AUTOMATIC** (the wizard renders the correct terminal question for the SKU's class; the manager never chooses "raw vs non-raw"):
- **raw** → the terminal question is **"How big is each?"**: an oz amount + a measure unit. A count/volume unit additionally reveals **avg oz per each** (so the leaf is oz-resolvable — raw feeds depletion/cost).
- **packaging / misc** → may terminate at a **bare count leaf**: the wizard auto-appends a leaf `containsMeasureUnit = "each"` (a registered count measure) with `containsQty = 1`. No size, no avg. Complete by design.
- **cleaning** → same bare count leaf as packaging, BUT the wizard offers an **opt-in "Add a size?"** toggle (bleach = 128 oz/jug) that, when enabled, swaps the count leaf for a weight/volume size leaf. Skippable.

**≤3-question save cap (6AM-risk law):** the shortest valid save is Q1+Q2+terminal = 3 questions. The wizard always keeps a valid save reachable within that; deeper depth is user-chosen recursion. The active question is the only open input; answered levels collapse to summary lines (D8 — no giant always-open form; useState only, D9).

### 2. Label-collision law (BLOOD-BOUGHT — the BC class caught twice)

Every wizard-generated / default level label is guarded against active measure-unit labels. The wizard's chain assembly runs through **the same `firstLabelMeasureCollision` guard** the write path enforces, and the wizard's defaults come from `defaultWizardLevelLabel(index)` — **distinct per depth** (`"container"`, `"inner"`, `"inner 2"`, …) so an all-default multi-level chain never repeats a label (`UNIQUE(sku_id,label)` → `duplicate_label` rejection; the adversarial review traced the canonical case→log→oz chain failing on `"inner"`/`"inner"` pre-fix) and never `"each"`/`"unit"` (active count measures → chain-first resolution would over-deplete 6×–40×). Manager-TYPED labels can still collide; the server rejects those loudly, which is acceptable — defaults must never. The submit path is unchanged: add flow POSTs the `chain[]` to `/api/admin/skus` (which calls `replaceSkuPackChain` → `validateSubmission` → `firstLabelMeasureCollision`); unchained-edit POSTs to the pack-chain route. There is NO new chain-writing path — the wizard reuses the PR-A validated path, so the guard binds automatically. The count leaf's `label` is `"inner"` and its `containsMeasureUnit` is `"each"` — different columns, NOT a collision (identical to seed 14).

### 3. Flat-field SYNC-ON-SAVE (`deriveFlatFieldsFromChain` in `lib/admin/catalog-shared.ts`, pure + tested)

When the wizard saves a chain, the legacy flat fields are DERIVED from that chain and written in the same submission, so the 3 laggard consumers that still read flat fields stay correct until PR-C migrates them (`skuPackComplete`, `sku-demand`'s `skuContentOz`-sans-chain, `formatSkuPack`).

**Derivation rule (linear root→leaf walk):**
- `pack_format` ← the ROOT (top) level's label.
- `units_per_pack` ← the PRODUCT of every NON-leaf level's `containsQty` (root × all intermediate). A single-leaf chain → `1` (the documented legacy "1 for Each" convention — `null` would fail `skuPackComplete` and null out `skuContentOz`'s flat path for a VALID depth-1 raw chain like `tub → 32 oz`). A 2-level chain → the root qty. A 3-level `case(4) → log(2) → bundle(17 oz)` → `4×2 = 8`.
- `each_size` ← the LEAF level's `containsQty`.
- `each_measure` ← the LEAF level's `containsMeasureUnit`.
- `avg_oz_per_each` ← UNCHANGED (SKU-level; already persisted; the sync never touches it).

**Why this exact rule:** `skuContentOz`'s legacy math is `units_per_pack × each_size × ozPerMeasureUnit(each_measure, avg)`. For any LINEAR chain the pointer walk is `(∏ non-leaf qty) × leaf_qty × ozPerLeafUnit(leaf_measure, avg)`. With the mapping above the two are byte-identical → `sku-demand` (which passes NO `packChain`) computes the same content-oz as the chain would. The `case(4)→log(2)→bundle(17 oz)` example: flat `8×17×1 = 136` = walk `4×(2×(17×1)) = 136`. For a non-raw count leaf (`each`, no avg) both paths yield `null` content-oz consistently, and `skuPackComplete` becomes true (units+size+measure set) — correct, since a packaging SKU IS pack-complete for ordering. Derivation is defensive: a malformed/multi-root chain (no unique root) yields `null` flat fields rather than a wrong guess.

**Where the sync runs:** INSIDE `replaceSkuPackChain` (`lib/admin/pack-chain.ts`) — `syncSkuFlatFieldsFromChain` fires after every successful chain insert, so EVERY chain-writing path (add flow, unchained-edit wizard, existing chain editor) syncs through the one server-authoritative site; a hand-crafted client payload can't skip it. The sync is best-effort by design (the chain — the source of truth — is already persisted; a transient flat-write failure logs and never reverts the chain). SkuBuilder OMITS the flat trio from its payload entirely (a key-present `null` would CLEAR the columns on identity edits — the PATCH route treats `"key" in body` null as "clear").

### 4. Legacy quick-pack UI leaves SkuBuilder entirely

The flat COLUMNS stay (fallback math for the laggard consumers), but no UI writes them directly anymore — only the derive-on-save sync. The already-chained-SKU edit path keeps the existing inline chain editor; the wizard is the UNCHAINED path (add + unchained edit).

### 5. Cleanup from PR-A review

Deleted the 2 orphaned i18n keys `admin.skus.filter.unchained` + `admin.skus.filter.unchained_count` (en + es) — grep-confirmed zero code references (the chain filter folded into the "No pack info" lens in PR-A).

### 6. Tests

`tests/pack-chain.test.ts` / `tests/sku-builder-shared.test.ts` extended: `deriveFlatFieldsFromChain` cases (2-level raw oz leaf; 3-level raw avg leaf w/ product-of-non-leaf units; shallow packaging count chain; cleaning opt-in oz) + the wizard's generated-label collision guard. Existing 291 tests stay green.

### Out of PR-B scope (do NOT touch)

The pure walk internals (byte-identical); the 3 laggard consumers' READ logic (still read flat fields — wired to chains in PR-C); counts/receiving; anchor_dimension / count-native ordering (PR-C); toast-sales; proxy; staff runtime. No migration (all columns exist).

---

## D-law compliance (Disclosure Doctrine binds this UI)

D1 identity line always visible · D2 unverified/no-pack-info badges + campaign counters never collapse · D5 i18n'd counts on collapsed headers · D6 lens chips + search on a ≥10-row list · D8 phone-first full-row toggles, vendor as select not chip · D9 disclosure state = useState only · D10 a11y `<button>`+aria on chips. **PR-B wizard:** D4 the wizard is a triggered flow, not a pre-rendered form · D8 one active question at a time (answered levels collapse to summary lines), 44px targets · D9 wizard state = useState only · D10 `<button>` + aria on every branch/terminate control.
