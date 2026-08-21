# Product identity + weight/trim audit + equipment identity — design (2026-08-20)

Brainstormed with Juan 2026-08-20 evening (visual-companion session; mockups in `.superpowers/brainstorm/415939-1787264489/content/`). Every locked decision below is his; the drafting is CC's. Foundation docs: `docs/audits/2026-08-20-multivendor-semantics-audit.md` (the gap this closes), the Angel arc's data trail (`docs/seed/source/angel-*`), the truth-model doctrine (audit = owner-invoked tool, never a gate — 2026-08-02 reframe).


> **✅ SHIPPED 2026-08-21 — arc closed.** Seven phases, PRs #273–#281; migrations 0179
> (product layer + primaries + the weight-provenance quartet) · 0180 (count allocation
> provenance) · 0181 (equipment link) all applied live, each at its named gate on Juan's
> word. Every section below is BUILT except the four named non-goals. Eleven deviations
> from this spec were argued and lead-blessed in the plan — read them before treating any
> line here as the last word, especially **D1** (the phase swap: the engine ships before
> the re-point), **D5** (FIFO is a READ-TIME attribution; the depletion ledgers are never
> re-keyed) and **D8** (a product count writes ordinary per-SKU lines). The lead ruling on
> `count_exceeds_lots` REVERSED this spec's implied refusal: a count is ground truth and
> theory yields to it, so the unexplained oz is absorbed by the resolved primary and
> reported, never refused.
> Plan: `docs/superpowers/plans/2026-08-20-product-identity.md` ·
> verification: `docs/sim/2026-08-21-product-identity-simday.md` (2 sim days, 43
> assertions, 6 P1s found and fixed) · law: `AGENTS.md` § Product identity.

## The problem (proven)

Recipes pin ONE vendor's SKU; nothing above the SKU knows two hams are one product. Consequences (all live-verified): vendor-down demand evaporates; depletion follows dead pins producing mirrored false SHORT/OVER variance; counts can't roll twins up; "what we buy most" has no grain to live at; $3,230.74 of real iceberg spend attributes to no SKU we hold; 8 multi-vendor pairs await adjudication with no vocabulary to adjudicate in.

## The locked model (Juan's words: "the recipe should never even be PFG ham — it should be sliced ham; what feeds that should be whatever SKU we actually have")

**Four layers, each speaking its own language:**

1. **MENU layer** — builds speak KITCHEN language: prep items only ("sliced ham", "shredduce"). Never a vendor, never a raw product.
2. **PREP layer** — the EXISTING items registry, unchanged in role. "Ham" the item (par-unit Bundle, 34.4 oz operational) IS sliced ham.
3. **PRODUCT layer (NEW)** — a thin `products` table: the raw identity ("HAM"). Referenced ONLY by prep/portioning recipe inputs. Member SKUs attach via `vendor_items.product_id` (nullable FK). Per-location primary designation.
4. **SKU layer** — untouched. Per-vendor packs, prices, weights, pars. The separation doctrine stays airtight; only the POINTER above changes.

Single-vendor SKUs need no product row: the code treats a productless SKU as an implicit singleton (resolution is trivially itself). Products are created where plurality exists (the 11 multi-vendor names, iceberg) and lazily thereafter.

## Resolution (three questions, three answers — never conflated)

- **What to order / menu-planning price** (the stable question): PRIMARY-FIRST ladder — ① the member Juan flagged primary (per location), if active · ② else most-recently-RECEIVED active member · ③ else any active member · ④ else honest `unresolved`. The menu costing board prices at this resolution (replacement cost — stable for pricing decisions).
- **What actually got eaten** (depletion attribution): **FIFO across receipt LOTS** — all members' delivery lines per location, oldest lot depletes first, regardless of vendor. Juan: "we will FIFO operationally" — the model mirrors the kitchen. Lot data already exists (`vendor_delivery_items` are dated per delivery).
- **On-hand** (two-grain): per-SKU ledgers remain the source of truth (existing engine unchanged); the PRODUCT grain is their sum. Juan: "not just 'we have ham' — 300 oz of ham: 200 PFG + 100 Boar's Head. Theory until an audit; we infer per vendor." Lot-level remaining = per-SKU on-hand distributed newest-back after FIFO consumption.

ONE pure resolution function consumed by costing, depletion, production, and ordering — never four private opinions. Every resolution flip writes an audit row ("why did ham cost move Tuesday" always has an answer).

## Counting UX (locked: option C)

Count sheet shows the PRODUCT with one number by default ("HAM ... [ ] oz"); when 2+ members carry expected stock at that location, a **tap-to-split** expands per-vendor rows (vendor-labeled per PR #267's twin labels). Product-level counts allocate variance FIFO (oldest lot absorbs); split counts anchor per-SKU exactly as today. Audits re-anchor per the truth model — count beats theory, variance gets its reason code, next cycle starts from the count.

## What each old gap becomes (the payoff table)

Vendor down → resolution skips to backup, costing/depletion follow · counts roll twins up · ICEBERG product absorbs the $3,231 attribution (PFG rows become members; the Sysco/Baldor twins join or retire per Juan) · the 8 pairs = create 8 products, attach twins, mark primaries — mechanical, one sitting · usage/spend aggregates at product grain and ranks vendors within it (P6's seat, sequenced after this).

## Weight & trim audit (locked: ON-DEMAND TOOL — "just like the regular audit")

Juan's ruling verbatim: "triggered on demand. Behaves just like the regular audit to establish ground truth as needed." NO clocks, NO due-dates, NO gates — doctrine-identical to the inventory audit.

- **The surface** (admin, beside the costing board): every weight the system believes — value · class (`OPERATIONAL` / `SPEC` / `INVOICE_DERIVED`, already live in audit metadata) · who/when established · spec reference beside operational values · drift advisories (invoice weights moving; observed trim diverging; a count variance implicating a weight) · a RANKED SUGGESTION list (cost-impact × staleness) that suggests, never nags.
- **The audit session**: owner-invoked → pick items (or take the suggestions) → enter surprise-weigh measurements → values update with `OPERATIONAL` class + audit rows; the drift tripwire (`OPERATIONAL_DRIFT`) continues to guard ruled values between sessions.
- **Trim**: standard trim registry (shipped in #271) = the expectation; observed trim = inferred from production capture (SKU-oz in vs prep-units out) once prep flows — surfaced as advisory drift vs standard, feeding the same audit surface. Expectation vs measured, drift is the signal — the count-variance philosophy applied to weights.

## Equipment identity (the same pattern, cold side)

Checklist temperature lines gain an equipment link (`checklist_template_items.equipment_id`, third XOR target beside item/SKU) pointing at the EXISTING maintenance `equipment` registry (the fridges already live there with readings). Yields: per-fridge temp history + maintenance trail on one asset, and properly clears the 32-row "needs link" false positive (a thermometer finally has something to link TO). Admin: the needs-link queue learns the equipment target; temp rows stop counting as unlinked.

## Migration path (phased, each phase shippable)

1. **Schema**: `products` table + `vendor_items.product_id` + `recipe_inputs.component_product_id` (XOR extended) + `checklist_template_items.equipment_id`. Additive only; append-only law untouched.
2. **Seed products** for the 11 multi-vendor names + ICEBERG; attach members; primaries from Juan's standing adjudications (ham/mozz/lettuce done; the 8 pairs = one sitting with the new vocabulary).
3. **Re-point the portioned prep recipes** SKU-pin → product-pin (the wave-3 pin moves become obsolete in the best way).
4. **Resolution fn + FIFO attribution** into the flatten/depletion/production/ordering seams (the audit's P2 coupling list is the checklist: flatten, depletion writer, counts variance, ordering advisory, production dropdown, usageRank).
5. **Count sheet C-mode** + product roll-up views.
6. **Weight-audit surface + session flow**; equipment links + per-fridge history.

## Out of scope (named)

P6 usage-seed (sequenced after) · missing-water recipes arc (awaits the jus quart weight) · pack-chain-blind `$/oz` on /admin/skus + /admin/vendors (queued hardening) · any per-tenant vocabulary in code (law).

## Verification

Vitest: resolution ladder, FIFO lot attribution, two-grain roll-up, count allocation, the XOR extensions — all pure. The sim harness (`scripts/sim/`) gets a vendor-down day and a two-vendor count day before this arc is called done. Juan smokes each phase on preview; phases merge on his word per house law.
