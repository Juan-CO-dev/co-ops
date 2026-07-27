# SKU Builder streamline + dual-role badges — design (2026-07-27)

**Status: APPROVED (Juan, 2026-07-27). Grounded in a six-seat council (session
.claude/council/2026-07-27-sku-module-streamline/ — unanimous on 1-4; the one
divergence resolved by Juan: PREPPED + BADGES).**

## Problem (Juan, near-verbatim)
"The SKU module is only getting more complicated... edit and pack chain are
basically the same thing... one editor/builder for SKUs — streamlined, still
full-featured, or this will confuse people. Also sold-as-is items are ALSO
used to build subs (meatballs, tuna/egg/chicken salads — subs pull from the
portioned salads)."

## Design (council-locked)

### 1. One SkuBuilder surface
Replace the SkuForm / SkuPackChainPanel / SkuCostPanel triad (today MUTUALLY
EXCLUSIVE in render — the builder seat's find) with ONE expanded editor:
- **Section A — Identity & sourcing:** name, vendor, location, item#,
  sku_class, lead time, notes. Dedupe = name-collision warning on save
  (11 dup pairs live).
- **Section B — Pack truth:** the CHAIN is the only pack vocabulary. Chained
  SKU → chain builder inline ("chain unverified" badge on this header).
  Unchained SKU → "quick pack" fields that GENERATE a starter 2-level chain
  on save (the completion path for the 99 unchained; catalog gets an
  "unchained (N)" filter/counter). ADD flow: SKU + chain draft persist in ONE
  atomic request under one Tier-A step-up (kills the create-then-chain
  two-step; relax the pack_format required-field gate — builder seat find).
  "Add pack detail later" escape hatch (opus) — an unchained save stays valid.
- **Section C — Cost & usage (read):** cost/oz readout, receiving-refinement
  status line, used-by. Record-price stays a sub-action.

### 2. Legacy retirement (phased; columns NEVER dropped ahead of readers)
- **Phase 1 (this build, UI-only):** vestigial unit/unit_size/category +
  dormant weekday/weekend pars + each_container_label leave every surface.
  ASK JUAN first: any external spreadsheet reading pars? (sonnet flag)
- **Phase 2 (unchained < threshold):** stop writing each_container_label;
  lockstep-migrate any recipe_inputs.each_container_label refs to chain labels.
- **Phase 3 (unchained = 0):** flat pack fields leave the model; the legacy
  branch of skuContentOz/ozForRecipeInput retires. avg_oz_per_each NEVER
  retires (count/volume chain leaves read it permanently — sonnet).

### 3. Dual-role items: single type + DERIVED role badges (zero schema change)
Roles are graph facts, not properties: "sold" (sold_directly), "used in N
builds" (recipe_inputs.component_item_id), "made" (producing recipe). Catalog
+ item dossiers + SkuBuilder used-by render badges computed at read time —
cannot drift. Multi-select types rejected 6/6. VERIFIED: no engine keys on
item_type (catalog + needs-link badge only).
**Juan's vocabulary call (APPLIED to prod 2026-07-27):** type = production
nature — recipe-produced sellers retyped sold_as_is→prepped (Antipasto Pasta,
Chix/Egg/Tuna Salad, Meatballs, Onion Dip); sold_as_is now reserved for items
with NO producing recipe. Backfill rule for the future: an Issues-lens check
flags sold_as_is items that gain a producing recipe (auto-suggest retype).
Builder's enum-collapse ({prepped,on_hand} + sold badge) DEFERRED to a later
round after badges prove out.

### 6 AM law
One editor; one pack vocabulary (the chain); badges read like a deli-pan
label ("Meatballs: prepped · sold · used in 3 subs"); no taxonomy decisions
at the counter.

## Verification
Vitest where pure (quick-pack→chain generation, collision warning logic);
build green; smoke: edit a chained SKU (one surface, no flat fields), add a
new SKU with chain in one step, catalog badges on Meatballs/salads, unchained
counter visible.
