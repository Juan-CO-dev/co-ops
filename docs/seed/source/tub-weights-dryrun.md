# Wave 5 — Juan's tub readings (DRY RUN)

**Status: NOTHING HAS BEEN WRITTEN.** This is the output of
`scripts/seed/28-tub-weights.ts` in its default (dry-run) mode. The script writes only
under an explicit `--execute` flag, and that flag is not used until the lead says so.

**Generated:** 2026-08-21, against `docs/angel-purchase-history.csv` and live prod (`bgcvurheqzylyfehqgzh`).
Every SKU id, vendor, pack chain, recipe pin, price and audit provenance below was
resolved live at run time; every Angel figure was re-derived from the purchase history
rather than quoted from a previous wave's document.

---

## The reading

> Juan 2026-08-21, from the shop: "Garlic powder tub is 6 LB, oregano tub is 6 LB, garlic tub is 5 LB, crushed red pepper tub is 4 LB, whole black pepper is 5.75 LB — those are all the tubs I see."

**Evidence class: `SPEC`** (the DEFAULT — Juan has not answered yet).

> Asked of Juan 2026-08-21, unanswered at authoring time: were the five tub weights READ OFF THE TUBS (a printed net weight -> weight_class SPEC) or WEIGHED ON A SCALE (our own measurement -> weight_class OPERATIONAL)? The two classes are not interchangeable: wave 3 measured spec running 20-60% above operational on every deli item Juan has actually weighed, so a SPEC number is a placeholder awaiting a scale and an OPERATIONAL one is the answer. This wave is authored with the class as a single constant (--evidence-class), defaulting to the conservative SPEC, so his one-word answer is a one-constant fill and never a re-derivation.

Basis stamped on every row this run writes: _Juan read the weight PRINTED ON THE TUB. A document states it; no scale was involved here, so it is a placeholder of documentary standing awaiting a weighing — wave 3's SPEC, exactly._

**The class is ONE CONSTANT.** When Juan answers, re-run with `--evidence-class SPEC|OPERATIONAL` and every source note, audit row and table below follows. Nothing is re-derived and no row moves; only what the record CLAIMS about where these numbers came from changes — which is the entire point of having the class at all.

## Read this first — the four things that matter

1. **The scale gate closes on oregano, and it closes the way nobody predicted.** Wave 3 wrote the jug at its pack string's nominal 5 lb and waited for a scale. Juan says 6 LB — which is Angel's MEASURED value, not the pack string. Two independent sources now say 6 and only PFG's catalog says 5.
2. **Garlic is a CONFLICT and is not written.** His 5 LB contradicts wave 4's 95.94 oz INVOICE_DERIVED pack — seven real deliveries, ratified 2026-08-20. Both numbers are in section C with the arithmetic, the two hypotheses and a recommendation. Neither is written today.
3. **Two SKUs get their first denominator ever.** `Garlic Powder` and `Black peppercorn` have carried no pack of any kind, which is why neither has ever had a price and why black pepper blocks menu items it appears in. Section B counts exactly how many, computed through the production costing engine rather than asserted.
4. **The 5.75 is NOT the scale tell it looks like.** McCormick's pack string is literally `1/5.75LB`. The quarter pound comes from the vendor's pack size, and Juan's reading matches it exactly — so it is the one row where a suspicion the brief raised is answered by the data rather than carried forward.

## Section A — the five tubs, resolved live

Each spoken tub, the SKU it resolves to, and what happens to it. `agreement` answers one
question — which documented number does the reading equal — and only `measurement` is
informative; see the note under the table.

| Juan said | our SKU | vendor | match | reading | live pack | pack provenance | agreement | disposition |
|---|---|---|---|---:|---:|---|---|---|
| "Garlic powder tub is 6 LB" | `Garlic Powder` | PFG | verbatim | **96 oz** | **(none)** | _(unclassed)_ | matches pack string | **write new pack** |
| "oregano tub is 6 LB" | `Oregano` | PFG | verbatim | **96 oz** | 80 oz | _(unclassed)_ | matches measurement | **write resolution** |
| "garlic tub is 5 LB" | `Garlic` | PFG | verbatim | **80 oz** | 95.94 oz | INVOICE_DERIVED | matches pack string | **conflict present only** |
| "crushed red pepper tub is 4 LB" | `Chili Flake` | PFG | **synonym** | **64 oz** | 64 oz | _(unclassed)_ | no angel row | **confirms live** |
| "whole black pepper is 5.75 LB" | `Black peppercorn` | PFG | **synonym** | **92 oz** | **(none)** | _(unclassed)_ | matches pack string | **write new pack** |

**Read the `agreement` column asymmetrically.** A reading that equals the vendor's pack string is consistent with a label read AND with a scale that confirmed the label, so it distinguishes nothing. A reading that equals the MEASUREMENT while contradicting the pack string could not have come from that pack string. Exactly one row does that:

| our SKU | reading | Angel pack string | Angel measured | n | spread | agreement |
|---|---:|---|---:|---:|---:|---|
| `Garlic Powder` | 6 lb | `3/6 LB` → 6 lb | 6.624 lb | 1 | _(n=1)_ | matches pack string |
| `Oregano` | 6 lb | `1/5 LB` → 5 lb | 6.001 lb | 3 | +0.00% | matches measurement |
| `Garlic` | 5 lb | `1/5 LB` → 5 lb | 5.996 lb | 7 | +0.24% | matches pack string |
| `Black peppercorn` | 5.75 lb | `1/5.75LB` → 5.75 lb | 6.119 lb | 3 | +0.05% | matches pack string |

_Equals the invoice measurement and CONTRADICTS the pack string. Whatever produced this number, it was not the vendor's catalog — the strongest evidence in the wave that these readings are of the physical tubs._ Oregano is that row: 6 against a measured 6.001 lb, and against a pack string that says 5.

Chili Flake has no Angel row at all, in the catalog or in 441 invoice lines, so it is absent
from the table above by construction rather than by omission.

### A1 — how each tub was matched, including the two that are not verbatim

| Juan's phrase | our SKU | basis |
|---|---|---|
| "Garlic powder tub is 6 LB" | `Garlic Powder` | his phrase IS the SKU name |
| "oregano tub is 6 LB" | `Oregano` | his phrase IS the SKU name |
| "garlic tub is 5 LB" | `Garlic` | his phrase IS the SKU name |
| "crushed red pepper tub is 4 LB" | `Chili Flake` | `crushed red pepper` and `chili flake` are the same product; the recipe seed's own alias table maps both (`scripts/seed/lib-recipe-seed.ts`: "chili flake" and "red pepper flakes" -> "Chili Flake"). It is also the only candidate: no live SKU matches `crushed`, `red pepper` or `flake` under any spelling. The pack agreeing to the ounce is itself corroboration of the match. |
| "whole black pepper is 5.75 LB" | `Black peppercorn` | Our SKU is named `Black peppercorn`; Juan said `whole black pepper`, which is the same product said the other way round and is how Angel spells it too (`PEPPER BLK WHL`). The recipe seed's alias table maps "black pepper" -> "Black peppercorn", and it is the only pepper SKU under PFG. |

**Ambiguity is a refusal.** `resolveSku` requires exactly one ACTIVE global row under the named vendor; zero rows, a vendor mismatch or two twins all stop the row rather than picking. Every one of the five resolved cleanly this run.

## Section B — what would be written


### B1 — pack chains

── WOULD WRITE ──
| our SKU | vendor | before | after | chain | par (packs) | unit price | $/oz before | $/oz after | $/oz change |
|---|---|---:|---:|---|---:|---:|---:|---:|---:|
| `Garlic Powder` | PFG | **(no pack)** | **96 oz** | `tub=96oz` | 0.25 | _(unpriced)_ | — | — | _(no basis)_ |
| `Oregano` | PFG | 80 oz | **96 oz** | `jug=96oz` | 0.25 | $55.27 | $0.6909 | **$0.5757** | **-16.7%** |
| `Black peppercorn` | PFG | **(no pack)** | **92 oz** | `tub=92oz` | 1 | _(unpriced)_ | — | — | _(no basis)_ |

**Every pack is written at the TUB, and on garlic powder that is a deliberate choice with a reason in the `par` column.** Angel sells garlic powder `3/6 LB`, so a case-grain chain (3 x 96 = 288 oz) was available and would have let its $210.84 case price in with no divisor. It is the wrong grain: a par is denominated in OUR PACKS, this SKU already carries **0.25**, and every sibling in the spice family is packed at one tub — oregano's 0.25 is a quarter jug, chili flake's 1.00 is one tub, garlic's 0.75 is one tub. A case-grain pack would silently re-read that existing 0.25 as three quarters of a tub — a 3x change to an ordering quantity, with the column untouched and nothing in the audit row mentioning it. Pars are suppressed but never mutated (AGENTS.md); re-denominating one underneath is worse, because the number still reads the same. The cost is that garlic powder's case price now needs a divisor of 3, which is exactly what section D asks one approval for.

**No price row is written on any of these, and on oregano that is a deliberate departure from wave 3.** Wave 3 §C moved a DIVISOR — our pack went from a quarter of a jug to a whole jug — so the price of one of OUR packs genuinely changed and a superseding price row was mandatory. Wave 5 changes what a pack CONTAINS while the pack stays the same physical object: one oregano jug cost $55.27 before and one costs $55.27 after. `unit_price` is the price of one of our packs, so it does not move; only the derived $/oz does. Appending a price row here would assert a change nobody made.

### B2 — what re-costs, read live

| SKU | pins | cost effect | recipes |
|---|---:|---|---|
| `Garlic Powder` | 2 | **nothing re-costs** (unpriced — the pack is the denominator it has been waiting for) | Garlic Bread / Compound Butter · Meatball Spice Mix |
| `Oregano` | 13 | **-16.7%** on every line below | Chicken parm (build) · Crunchy Boi (build) · Farmers Market After Dark (build) · Hot Pants (build) · It's a BOI (build) · Marinara · Marisa Tomei Eats Free (build) · Meatball Spice Mix · Never Been Cheddar (build) · Sicky Wicky Club (build) · The Frex (build) · The Teamster (build) · Vesuvio II (build) |
| `Black peppercorn` | 13 | **nothing re-costs** (unpriced — the pack is the denominator it has been waiting for) | Cesear Dressing · Chicken Salad · Egg Salad · French Onion Dip · Garlic Bread / Compound Butter · Honey Chili Aioli · Italian Salsa Verde · Marinara · Meatball Spice Mix · Our French Dip (build) · Tuna Salad · Turkey Caesar Sub (build) · Vodka Sauce |

**Nothing here changes depletion.** `avg_oz_per_each` is the column a COUNT-unit recipe line consumes, and no row in this wave touches it on any SKU — garlic's 0.17 oz/clove, which Marinara's `4 clove` pin resolves through, is untouched even in the conflict row. Only the cost side moves.

### B3 — the menu items a missing denominator is blocking

Computed HERE through the production costing engine — `loadRecipeGraph` +
`costPerOzFromGraph` + `composeMenuCostRows`, the same three calls `loadMenuCostingBoard`
makes — against live prices. A count, not a claim.

| SKU | pack today | price today | menu items blocked | which |
|---|---:|---:|---:|---|
| `Garlic Powder` | **no pack** | **no price** | 3 | Side of Meatballs · Turkey Caesar Sub · Vesuvio II |
| `Oregano` | 80 oz | $55.27 | 0 | — |
| `Garlic` | 95.94 oz | $19.72 | 0 | — |
| `Chili Flake` | 64 oz | **no price** | 0 | — |
| `Black peppercorn` | **no pack** | **no price** | 7 | Chicken Salad · Tuna Salad Sub · Egg Salad Sub · Side of Meatballs · Turkey Caesar Sub · Vesuvio II · Chicken parm |

**A pack is the denominator, not the price.** `costPerOzFromGraph` returns null when a SKU has no price OR no resolvable content ounces, and the board cannot tell the two apart — so writing a pack does NOT clear a row on its own. What it does is remove the reason the price could never be written: a price against a SKU with no pack is exactly how `PICKLES CHIPS` became $35.95/lb. Section D does that arithmetic and stops short of the write.

## Section C — the garlic conflict (PRESENTED, NOT WRITTEN)

This is the one row where Juan's reading contradicts a weight a scale produced, and it is the reason this run has an `--execute` flag it is not expected to use on all five rows.

|  | LIVE (wave 4 §C) | JUAN 2026-08-21 |
|---|---:|---:|
| pack | **95.94 oz** | **80 oz** |
| class | INVOICE_DERIVED | SPEC _(pending his answer)_ |
| basis | quantity-weighted mean of 7 invoice lines / 21 tubs, 5.9935-6.0077 lb (wave 4 §C, Juan-ratified 2026-08-20) | Juan 2026-08-21: "garlic tub is 5 LB" — which is also, exactly, PFG's `1/5 LB` pack string |
| unit price | $19.72 | $19.72 _(unchanged either way)_ |
| $/oz | $0.2055 | **$0.2465** |
| live value in prod right now | 95.94 oz | — |

Moving to 80 oz would raise garlic's cost per ounce by **+19.9%** and re-cost 8 recipe line(s): Cesear Dressing · Garlic Bread / Compound Butter · Garlic Mayo (Aioli) · Green Goddess · Honey Chili Aioli · Italian Salsa Verde · Marinara · Mustard Aioli.


### C1 — the two hypotheses

**If the reading is a NET weight:** The invoice weight is GROSS (garlic + brine + tub) and the label's 5 lb is NET product. 0.996 lb of water and plastic on a 5 lb fill is an ordinary tare for a brine-packed produce tub.

**If the reading is a pack-string read:** The tubs really do hold ~6 lb of garlic and Juan read the pack string off the lid rather than weighing anything — in which case the reading adds no information wave 4 did not already have.

The gap is **15.94 oz** — just under a pound of water and plastic on a 5 lb fill. Suspiciously round, and entirely ordinary for a brine-packed produce tub.


### C2 — why the ratification's own evidence does not settle it

`GARLIC_RATIFICATION` turns on ONE observation: garlic's per-tub weight VARIES while oregano's never moves, so garlic's is a real weighing. That inference is sound, and it is also insufficient. It establishes that something was weighed; it does not establish WHAT was weighed. A tub of peeled garlic packed in water weighs its garlic plus its water plus its tub, and all three vary a little from tub to tub. The spread column discriminates a measurement from a stored constant. It cannot discriminate NET product from GROSS shipping weight, and that is the question in front of us.

**And the precedent is already in this repo, pointing the other way.** Wave 4 §A2 (BEEF_BASE_RULING) refused a GROSS invoice weight as a costing denominator at 1.117x nominal because the excess was glass. Garlic sits at 1.199x and was accepted in the same wave. The two calls need one reconciliation, and it is Juan's to make.

> BILLED_VS_NET — the vendor's invoice weight includes packaging or packing medium that the recipe cannot use (brine, glass, ice). The invoice figure stays true as a BILLED weight; the costing denominator should be USABLE product ounces. Precedents: beef base's glass jars (wave 4 §A2, refused the gross denominator), garlic's brine (wave 5, open). Distinguishable from a feed artifact by the fact that tare is physical and scales with the container, not with a constant multiplier.


### C3 — recommendation

**DO NOT WRITE either way today. Ask one question — label or scale — and if scale, whether the tub was weighed full and undrained. If the tare reading holds, supersede the pack to 80 oz and the costing denominator becomes usable product; the $19.72 price is correct under BOTH readings and does not move.**

**The decisive test:** Weigh one full tub, drain it, weigh the garlic. Gross ~6 lb with net ~5 lb settles it in 90 seconds — the same 90 seconds wave 3 asked for and got.

Worth being precise about what is NOT claimed here: that wave 4 is wrong. 95.94 oz is very likely the correct BILLED weight — what PFG weighed and charged for. The open question is whether a billed weight is the right denominator under a recipe's ounces, and the beef-base ruling already said it is not.

## Section D — decisions this script will not make


### D1 — two SKUs become priceable the moment they have a pack

Both have carried no price ever, because neither had a denominator to hang one on. The
arithmetic is done; the write is not, because binding a price is a different approval from
recording a weight. This is wave 3 §E1's pattern: approve the row and the price follows in
one step.

| our SKU | Angel row | our pack | arithmetic | unit_price to write | effective | → $/oz | caveat |
|---|---|---:|---|---:|---|---:|---|
| `Garlic Powder` | `GARLIC PWDR` [MAGELLAN] 3/6 LB | 96 oz | $210.84 per case / **3** tubs to the case = $70.28 per tub → $0.7321/oz at 96 oz | **$70.28** | 2026-08-14 | **$0.7321** | ⚠ NEEDS A DIVISOR of 3, taken from the pack string `3/6 LB` — whose inner unit Juan's own reading independently confirms. ⚠ ONE invoice line. A price of record from a single observation is thin, and this one has never been seen twice. |
| `Black peppercorn` | `PEPPER BLK WHL` [ROMA] 1/5.75LB | 92 oz | $53.52 per `1/5.75LB` unit / 1 (our pack IS one Angel unit) = $53.52 → $0.5817/oz at 92 oz | **$53.52** | 2026-08-14 | **$0.5817** | 3 invoice lines, latest 2026-08-14. |

**A note on the census.** `docs/seed/source/angel-reconciliation-report.md` §E.2 lists `Garlic Powder` among nine PFG SKUs "absent from the Angel export". That is true of the CATALOG export and false of the purchase history, which carries a `GARLIC PWDR` invoice line. The two are different harvest artifacts and the census only ever read the first. `Chili Flake` IS genuinely absent from both — no crushed-red-pepper row exists anywhere in Angel — so its half of that list stands.

### D2 — onion powder: the half of the gate that stays shut

| field | value |
|---|---|
| live pack | 80 oz (wave 3 §C nominal) |
| would be | 96 oz, if the cluster argument were acted on |
| Angel pack string | `1/5 LB` |
| Angel measured | 6.002 lb (n=1, Jul 31) |
| unblock | One reading of the onion powder tub. Juan listed five tubs and said they were all he could see, so the first question is whether an onion powder tub is on the floor at all — its single invoice line is from Jul 31, which is consistent with a tub that has since been used up. |

**Why it is not inferred:** Same vendor, brand, pack string and 1.20x ratio as oregano, whose 1.20x a human has now confirmed. That is the strongest cluster argument this arc will ever have and it is still an inference. Wave 3 refused to write these jugs precisely because an inference is not a measurement, and one row resolving does not change what the other row is.

**And a question to put back to Juan.** His "those are all the tubs I see" is a completeness claim about what was VISIBLE on the floor, not an inventory. Onion powder's absence from the list reads as *not observed*, never as *does not exist* — and its single invoice line is from Jul 31, which is consistent with a tub that has since been used up. One question closes both halves of the gate: **is there an onion powder tub out there, and what does it say?**

### D3 — tubs with no matching SKU

_(none)_

All five tubs resolved to exactly one active PFG SKU each. The table is empty, and that is
the finding: nothing Juan is looking at is missing from our catalog.

## Everything this run did NOT do, and why

| our SKU | subject | code | detail |
|---|---|---|---|
| `Garlic` | pack | `MEASURED_CONFLICT` | reading 80 oz against a live 95.94 oz whose class is INVOICE_DERIVED (a scale produced it) — see section C |
| `Chili Flake` | pack | `ALREADY_CORRECT` | live pack is already 64 oz and the reading is 64 oz — a corroboration, and there is nothing to write |
| `Garlic Powder` | price | `PRICE_NEEDS_APPROVAL` | $210.84 per Angel unit / 3 / our 96 oz pack = $0.7321/oz — derivable now, but a tub reading is evidence about a WEIGHT |
| `Black peppercorn` | price | `PRICE_NEEDS_APPROVAL` | $53.52 per Angel unit / our 92 oz pack = $0.5817/oz — derivable now, but a tub reading is evidence about a WEIGHT |
| `Onion Powder` | pack | `NOT_IN_READING` | Juan named five tubs and onion powder was not one of them; its live 80 oz stands |

| code | what it means |
|---|---|
| `MEASURED_CONFLICT` | The reading contradicts a pack a scale produced. Presented in full with both numbers and a recommendation; never silently overwritten. |
| `ALREADY_CORRECT` | The live value already equals the reading. Corroboration, and nothing to write. |
| `PRICE_NEEDS_APPROVAL` | A price is newly derivable now that a pack exists, but pricing is not what a tub reading is evidence about. The arithmetic is done and put in a decision table for one approval. |
| `NOT_IN_READING` | Juan did not name this tub, so this wave has nothing to say about it. Absence from his list is 'not observed', never 'does not exist'. |

## Summary

|  | pack chains | weights | prices |
|---|---:|---:|---:|
| **Section B — first packs + the oregano resolution** | **3** | 0 | 0 |
| Section C — garlic conflict | 0 _(presented)_ | 0 | 0 |
| Section D — decision tables only | 0 | 0 | 0 _(2 proposed)_ |
| **TOTAL would-write rows** | **3** | **0** | **0** |

`source` stamped in the audit metadata of every written row: `juan-tub-readings-2026-08-21`
`weight_class` stamped in that same metadata: `SPEC` (default — pending Juan's answer)

**Where the weight class does and does not go.** It rides in the `sku.pack_chain_update` audit metadata, exactly as wave 4 wrote it, and `vendor_items.weight_class` is NOT touched on any row. That column describes the EACH weight — garlic's 0.17 oz/clove, classed `ESTIMATE` by seed 26 — and a pack's contents are a different number. Writing one into the other is how a single column came to mean two things the first time, which is the defect wave 3's spec-versus-operational split exists to repair.

| disposition | what it means | rows |
|---|---|---:|
| `WRITE_NEW_PACK` | our SKU had no pack at all; the reading gives it its first denominator | 2 |
| `WRITE_RESOLUTION` | a pack exists, the reading moves it, and nothing measured is being overruled | 1 |
| `CONFIRMS_LIVE` | the reading and the live pack are the same number — corroboration, no write | 1 |
| `CONFLICT_PRESENT_ONLY` | the reading contradicts a weight a scale produced; present both, write neither | 1 |
| `NO_MATCHING_SKU` | no live SKU answers to this tub — the answer goes in a decision table | 0 |

**NOTHING HAS BEEN WRITTEN.** Re-run with `--execute` only on the lead's word.
