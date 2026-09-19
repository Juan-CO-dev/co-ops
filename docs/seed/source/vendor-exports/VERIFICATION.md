# Wave 1 verification and handoff — 2026-09-18

## Waves 2–3 continuation — catalog export needed from CC

Wave 1 below is historical; its files are now committed by CC. This continuation leaves edits on `feat/vendor-export-diff` in `C:/Users/conta/co-ops-astra`, with no commit attempts, pushes, network or production access. The readiness snapshot is intentionally unchanged.

### Checks and tallies for waves 2–3

| Command / check | Outcome |
| --- | --- |
| PowerShell `Import-Csv` on each real US Foods file | managed 96, Daily 241, Master 76, Recently Purchased 101, Catering 52; 566 observations / 331 unique IDs. |
| Installed tsx CJS launcher from scripts README, `diff.ts` | Three reports regenerated; 31 receipt lines (12 + 19), ten documents, eight vendors. PFG remains 273 observations / 115 items. |
| `npm.cmd test` (full suite once after implementation) | **178 files / 3,415 tests passed**, exit 0, 17.07 seconds. Vendor-script tests: 63 total. |
| `node_modules/.bin/tsc.cmd --noEmit --incremental false --pretty false` | Exit 0; no diagnostics. |
| `node_modules/.bin/eslint.cmd scripts/vendor-exports tests/vendor-exports-parsers.test.ts tests/vendor-exports-diff.test.ts tests/vendor-exports-waves-diff.test.ts` | Exit 0; no diagnostics. |
| SHA-256 before/after a second `diff.ts` regeneration | All 15 artifacts byte-identical: twelve JSON files + three reports. Five PFG JSONs and PFG report also remain unchanged from committed wave 1. |
| Generated-output/source-citation tests | Byte equality to actual source normalization; every new report table row cites an existing nonblank original source line. |
| `git diff --check` and status scope inspection | Clean diff whitespace; all edits/new files within authorized paths; no Git mutation attempted. |

One focused mutation test initially failed after billed prices were added to every receipt row: changing only the normalized price left the billed extension at $50.40 instead of the fixture's expected $56.00. The fixture now updates the billed and normalized rates together; final full-suite run is green. A plain tsx startup attempt by the report worker hit the same environment `uv_os_get_passwd` ENOMEM recorded in wave 1; the documented installed-hook launcher succeeded. No packages were installed.

The managed US Foods guide is the strongest proxy match: 94/101 coverage (93.07%), Jaccard 0.9126; Master 64/101, Daily 65/101, Catering 0/101. Actual use still needs a floor answer. There are 100 proxy rows without a same-vendor catalog name candidate; these are hypotheses, not 100 proven missing SKUs. Daily/Master/Catering repeat one item each (241/240, 76/75, 52/51 rows/unique). All 566 MOXē packs parse, including ranges and three-level packs. Receipt unknown packs remain flagged.

Five priority cross-vendor findings: Duke's 32118/9189275 both 4/1 GA; Saratoga sparkling 986454/1292481 both 24/12 OZ; Natalie's 1020546/1163624 both 6/12 OZ with a US Foods 6/16 alternative; iceberg has whole/trimmed and 6/24-head alternatives across vendors; cooked eggs 439686/827428 are 144-count packs (12/12 CT versus 12/1 DZ), separate from shell eggs. US Foods supplies no price, so no savings claim is possible. Ovengold turkey is not a 4×6 ham twin. Thompson and Country Snacks Utz purchases have different case sizes and billing bases.

Self-check focused on BC-013/026 (price and quantity units), BC-015 (no invented missing identifiers), BC-019 (verified current contracts), BC-030/031 (real files, dataset counts, duplicates), BC-034 (missing values never fabricated). This is not independent cross-family review (BC-043); CC's review/commit remains pending. No application/build behavior changed; no Next build run. Open floor questions are merged in draft §9 (eight total). Catalog-field and photo-fidelity limitations below remain open.

CC's next offline production export must preserve these **table.column** fields, including nulls and inactive rows. Capture export timestamp and selection scope separately. Names below are verified from current `lib/` reads/types:

| Table | Required columns | Code contract |
| --- | --- | --- |
| `vendor_items` | `id, vendor_id, location_id, name, item_number, active, sku_class, pack_format, units_per_pack, each_size, each_measure, each_container_label, avg_oz_per_each, product_id` | [DbSkuRow / SKU_COLS](../../../../lib/admin/skus.ts#L238); [product membership](../../../../lib/admin/cost.ts#L174). Include inactive twins. |
| `vendors` | `id, name, active` | [vendor lookup](../../../../lib/admin/skus.ts#L216), [vendor labels](../../../../lib/admin/cost.ts#L301). |
| `sku_pack_levels` | `id, sku_id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal, active` | [pack loader](../../../../lib/admin/pack-chain.ts#L135), [PackChainLevel](../../../../lib/pack-chain-shared.ts#L45). Preserve pointers; display order does not define conversion. |
| `measure_units` | `label, dimension, to_base_factor, active` | [measure loader](../../../../lib/admin/pack-chain.ts#L94). Volume/count is not weight. |
| `vendor_price_history` | `id, vendor_item_id, unit_price, effective_date, recorded_at` | [latest-price reader](../../../../lib/admin/cost.ts#L88). Export history or latest by `effective_date DESC, recorded_at DESC, id DESC`, retaining winning ID/date. `unit_price` is dollars per internal purchase pack. |
| `location_sku_settings` | `sku_id, location_id, active_override, weekday_par, weekend_par` | [overlay shape/select](../../../../lib/admin/skus.ts#L964), [resolveActive](../../../../lib/location-sku-shared.ts#L150). This is not a price overlay. |
| `vendor_order_guides` | `id, vendor_id, name, updated_at` | [guide loader](../../../../lib/order-guides.ts#L59). |
| `order_guide_sections` | `id, guide_id, name, position` | [section loader](../../../../lib/order-guides.ts#L62). |
| `order_guide_lines` | `id, section_id, position, sku_id, label, item_number, note` | [line loader](../../../../lib/order-guides.ts#L66). Actual mappings cannot be reconstructed from seed aggregate counts. |

There is **no verified `vendor_items.price_per_oz`, `vendor_items.price_basis`, `vendor_items.pack`, or `vendor_items.uom` column** in these contracts. Dollars/oz is derived by [computeSkuCostPerOz / contentOzForSku](../../../../lib/admin/cost-shared.ts#L62), using current price, active pack chain and measure registry (flat fields only when no chain). Supply derived `price_per_oz` with status/provenance separately from table columns. Unknown conversion remains null; an average is not actual invoice weight.

For the current diff, enrich context `skus[]` rows with the offline `CatalogRow` projection: `item_number`, reviewed raw `pack`, price-denominator `uom`, and either `price_cents` or `price_per_lb_cents`; receipts also accept derived dollar `price_per_oz`. These are export projections, not database column names. Convert dollars to cents only after verifying the denominator. Preserve raw-table provenance beside the projected file; the context loader cites the projected row. Do not manufacture a flat pack from a variable-weight chain to pass `packEqual`. There is no generic raw-table adapter here; CC must prepare that reviewed projection before rerunning `diff.ts`.

Account-to-location binding is reviewed metadata: PFG 56910015 and US Foods 71628390 are P Street; receipts retain known printed IDs. Nothing establishes Capitol Hill accounts or shared pricing. Photos are outside this clone; image fidelity/hash verification remains with CC.

Branch: `feat/vendor-export-diff`. Clone: `C:/Users/conta/co-ops-astra`.

Implementation and artifacts are complete for offline review. **No commits were possible**: `git add` and `git commit` both failed because this session's filesystem policy makes `.git` read-only:

```text
fatal: Unable to create 'C:/Users/conta/co-ops-astra/.git/index.lock': Permission denied
```

All added files remain untracked in this clone. No existing tracked file was modified. No other checkout was written, and no network, migration, prod read/write, push, merge or deployment was used. CC must stage and commit from an environment allowed to write this clone's Git metadata. Cross-family review remains pending as scheduled by the task.

## Checks actually run

| Command/check | Outcome |
| --- | --- |
| Independent PowerShell `ConvertFrom-Csv` count, filtering numeric Product Number | 97 history; 84 Izzy; 58 Opening; 14 managed; 20 Paper. |
| Plain installed `tsx.cmd .../normalize.ts` | Failed before loading project code: Windows `uv_os_get_passwd` ENOMEM. The process-local launcher documented in scripts README succeeded; no dependency/config edits. |
| Installed tsx hook, normalize + diff CLI (README launcher) | 273 observations, 115 distinct items, 90 recent; both commands completed offline. |
| `node_modules/.bin/vitest.cmd run tests/vendor-exports-parsers.test.ts tests/vendor-exports-diff.test.ts` | 2 files, 33 tests passed. |
| `npm.cmd test` — full suite, run once after code completion | **177 files passed; 3,385 tests passed; exit 0** (18.29 seconds). |
| `node_modules/.bin/tsc.cmd --noEmit --incremental false --pretty false` | Passed, no diagnostics. |
| `node_modules/.bin/eslint.cmd scripts/vendor-exports tests/vendor-exports-parsers.test.ts tests/vendor-exports-diff.test.ts` | Passed, no diagnostics. |
| SHA-256 before/after a second diff CLI execution | Five normalized JSONs and the Markdown report were byte-identical. |
| Citation test | Every report table data row cites existing source files and nonblank physical lines. |
| `git diff --check`; `git status --short` | No tracked changes; only new files inside the authorized scope. Git's diff check does not inspect untracked files. |

No Next build was run: this wave changes only offline scripts/tests/docs; full unit suite, full typecheck and scoped lint passed. Future application changes still require the normal PR build gate.

## Findings and unresolved evidence

1. Izzy MAIN is the strongest live-list candidate: 73/90 recent item numbers (81.11%), recent Jaccard 0.7228. Laminate remains sequence law.
2. 439686 is cooked eggs. Shell-egg candidate 517879 was bought more recently than 517842. Both existing egg guide lines were unresolved in seed 37; CC must revisit V3-A's earlier repeat explanation.
3. Dried Chives is the single unresolved guide gap. The laminate says fresh chives, but whether it is the same operational line remains Juan's decision. Tuna, Saratoga and employee water have description-only candidates for their unmatched printed numbers.
4. Six recent item numbers have no PFG catalog name/family candidate: two vinegars, two strawberry packs, mint and multifold towels. Seventeen guide lines have multiple export item-number candidates. These are review hypotheses, not approved substitutions or proof of SKU absence.
5. The readiness snapshot lacks item numbers, prices, pack/UOM and SKU location bindings. Definitive catalog identity and numerical price/pack comparisons cannot be completed from these inputs. Last Purchase is not total 60-day volume; Dupont account 56910015 does not establish Capitol Hill pricing/account scope.

The draft design ends with eight floor-answerable questions. Review entry points: `scripts/vendor-exports/README.md`, `reports/2026-09-18-pfg-diff.md`, and `docs/superpowers/specs/2026-09-18-vendor-ordering-v3c-import-design.md`.

Suggested commit boundaries once Git writes are available: (1) parser/adapter/normalizer + generated JSON + parser tests + plan; (2) pure diff/CLI + report + diff tests; (3) draft design + usage/verification handoff. These are proposed commit messages, not existing commits.
