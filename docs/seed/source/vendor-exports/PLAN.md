# V3-C wave 1 execution plan — 2026-09-18

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
