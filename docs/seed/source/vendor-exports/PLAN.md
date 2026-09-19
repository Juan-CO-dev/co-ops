# V3-C wave 1 execution plan — 2026-09-18

## Wave 4 — real catalog join, 2026-09-19

Continue the recorded deferred CC cross-family review arrangement; files on disk only, no commits.
Read: README, PLAN, VERIFICATION, diff-core/diff/wave-reports, adapter/parser contracts,
real export, admin pack-chain/cost/skus and their pure dependencies, resolveGuideKey,
seed 37, current draft and AGENTS. The export has nullable values, more than three
pack-format labels, and no US Foods quote prices: completeness means reporting every
join and its numerical values or explicit missing-evidence reason, never filling unknowns.

1. Add a real catalog loader with physical-line provenance, latest price ordering,
   active pointer-chain costing through existing pure functions, and location/activity fields.
2. Default the CLI to production-export A–I and cross-vendor master reports; retain
   the previous snapshot renderer behind `--catalog snapshot`. Exact vendor/item
   identity governs numerical comparisons; section I accounts for every seeded line.
3. Update the draft's actual column mappings, identity key and remaining decisions;
   document dollar-impact basis and unresolved scope/units honestly.
4. Pin real counts, latest-price ordering, pack shapes, guide joins and citations;
   run focused tests, then full npm test once, tsc, scoped ESLint and hash regeneration.

Touched scope: scripts/vendor-exports, docs/seed/source/vendor-exports, the existing
V3-C draft, and script tests. Risks: null identifiers, duplicate identity, stale flat
mirrors, average versus measured weight, undated US Foods purchases, and vendor-global
guides versus account-specific export prices. No catalog mutation is authorized.

## Waves 2–3 continuation (CC CODE dispatch, same branch)

Read before authoring: existing parsers/model/adapters/diff/tests, five MOXē files and README, both receipt batches, laminate JSON and Boar's Head vA, location overlay resolver, V3-A §11, draft spec and verification. Continue the wave-1 deferred CC review arrangement; files only, no Git writes.

1. Extend only the offline observation contract/parser and add US Foods header and receipt JSON adapters. Preserve absent prices, catch-weight ranges, nested packs, receipt quantities versus net weight, and original source citations. Ignore only documented README sidecars; unknown data formats still fail before output.
2. Generate vendor-scoped A–H reports with purchase-proxy metrics, unit-aware receipt comparisons and conservative cross-vendor hypotheses. Laminate remains order authority. No inferred substitutions or fabricated dates/prices.
3. Pin real-file counts and new parsing/unit hazards in script tests; update the draft and export-field handoff. Run focused tests while developing, then full npm test once, typecheck, scoped lint, and byte-identical regeneration.

Measured US Foods counts agree: managed 96, Daily 241, Master 76, Recently Purchased 101, Catering 52. Receipt risk: 00602 ticket bills $23.35 per club pack versus Juan's $0.39/bag × 60 = $23.40; preserve both. Receipt LB quantities count pieces, not pounds. Missing receipt identifiers remain missing; never mint an item number. Snapshot limitations remain unchanged.

CC review: deferred to tomorrow by the task's explicit instruction; no claim of cross-family review yet.

1. Add offline, import-safe pure parsers and a folder + header adapter registry under `scripts/vendor-exports/`. Retain source physical lines, account, decimal cents, missing purchases, and unknown raw packs. Generate five JSON files.
2. Add a pure comparison layer and a Markdown report CLI. Join guide numbers first, then conservative description candidates; distinguish identity from product-family similarity. Deduplicate repeated list observations. All report rows cite original inputs. Add parser/adapter and tiny-fixture diff tests.
3. Draft the import design against the actual 0205/0207–0209 RPC contracts and V3-A §11. Preserve laminate sequence, account scope, and frozen PO behavior. Full `npm test`, scoped type/lint checks, deterministic regeneration, clean commits.

Verified references: all five CSVs; transcription; seed 37 report; readiness snapshot; seed 34/37 matching and write patterns; V3-A; migrations 0205/0207–0209; order-guides and order-guides-shared; package/Vitest/TypeScript configs; repository laws.

Input mismatches (non-blocking under the task's assumption instruction):
- Independent PowerShell `ConvertFrom-Csv` count: 97 history, 84 Izzy, 58 Opening, 14 managed, 20 Paper (four lists each exceed the brief by one).
- Snapshot has 210 SKUs with only id/name/vendor/sku_class/cls/status/reasons/lanes. No item_number, pack, or price values. D/E cannot establish numerical deltas/mismatches. Emit explicit unavailable comparisons, and support richer offline snapshots without inventing values.
- Last Purchase is a single last event, not transaction history. Last-event quantity in the window is only a ranking proxy, never total 60-day spend/volume.
- Managed list has real categories, unlike the other three lists; preserve actual values.
- V3-A prose calls PFG's portal MOXē; actual inputs are CustomerFirst. MOXē is the later US Foods adapter.
- Existing guides are vendor-global. `vendor_items.location_id` can be null/global or shop-specific; the readiness snapshot omits it. Prices follow SKU identity, not an account key. Dupont observations must not silently become global writes.

Risks: fuzzy matches suppressing true gaps; repeated observations inflating usage; pack changes changing cost basis; old/new catalog observations crossing dates. Mitigation: explicit assumptions/candidates, raw evidence citations, unit-compatible comparisons only, and no database/import writes in this wave.
