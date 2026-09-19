# Vendor Ordering V3-C — vendor export import

**DRAFT for CC review · 2026-09-18 · waves 1–3 groundwork.** This document proposes the write design; this branch contains only offline normalization, comparison, tests, and reports. No import writer, migration, network operation, or production read was performed.

## 1. Evidence and governing contracts

The [re-runnable PFG report](../../seed/source/vendor-exports/reports/2026-09-18-pfg-diff.md) cites physical source lines for every table row. Five CustomerFirst files contain 273 observations, 115 distinct item numbers. The independent counts are 97 purchase history, 84 Izzy MAIN, 58 Opening, 14 managed, 20 Paper. Last Purchase is the **last event only**, not cumulative transaction history. The 60-calendar-day window is July 21–September 18 inclusive.

The supplied September 16 readiness snapshot has 210 SKUs, including 84 PFG, but **no item numbers, pack values, UOM, location_id, or price amounts**. A readiness flag is not a value. Exact catalog identity, price changes, and pack changes remain unverified. CC must supply a richer offline snapshot before an executable import plan can be signed; no new prod access is implied.

Contracts read before this draft:

| Reference | Binding contract |
| --- | --- |
| [V3-A §11](2026-09-16-vendor-ordering-v3a-order-guides-design.md#11-aggie-review-r2--adjudication-2026-09-16) | One guide per vendor; one placement per SKU; preserve human edits; unmatched laminate lines remain visible; one order-body renderer. |
| [0205](../../../supabase/migrations/0205_order_guides.sql) | Guide → sections → lines → nullable SKU; `unique(vendor_id)`; no location column on guides; deny-all access for app database roles. |
| [0207](../../../supabase/migrations/0207_save_order_guide_rpc.sql) | Transactional full guide save; row lock, expected token, ownership validation, dense positions, deferrable constraints. |
| [0208](../../../supabase/migrations/0208_rerun_order_guide_rpc.sql) | Same-lock rematch/append writer; `clock_timestamp()` tokens; active required only for new placements on save. |
| [0209](../../../supabase/migrations/0209_rerun_order_guide_section_match.sql) | Rerun section match is `lower(btrim(name))`; retain manager spelling/id; append at the end. |
| [Guide library](../../../lib/order-guides.ts), [shared model](../../../lib/order-guides-shared.ts) | Existing writer and validation; frozen confirmed-snapshot keys win even when their recorded value is null; only legacy absence falls back. |
| [Seed 37](../../../scripts/seed/37-order-guides.ts), [seed 34](../../../scripts/seed/34-order-guide-2026-09-13.ts) | Vendor routing, number → normalized name → unambiguous contains; dry-run digest; readback; no importing the seed module into this offline tool. |
| [SKU model](../../../lib/admin/skus.ts), [pack-chain writer](../../../lib/admin/pack-chain.ts) | SKU location can be null/global or explicit; pack hierarchy supersedes as a whole, flat fields derive from it; new measures require existing registry discipline. |
| [Price reader/writer](../../../lib/admin/cost.ts), [price-basis logic](../../../lib/angel-price-fill.ts) | `vendor_price_history.unit_price` means ONE internal purchase pack; append-only ledger, not a mutable vendor_items price field. |

Two corrections to earlier assumptions need CC's review: V3-A's introductory “PFG MOXē” wording does not describe these CustomerFirst files (MOXē belongs to the US Foods exports now supplied). Its §11 egg-repeat explanation is contradicted by distinct shell/cooked export products and seed 37's two unresolved lines. Preserve the uniqueness rule, reconsider the identity explanation; do not silently edit the locked prior spec.

## 2. Adapter registry and observation contract

The registry chooses **vendor folder AND header signature**, not filename alone. An unknown vendor/header fails loudly without publishing partial outputs. PFG CustomerFirst v1, `usfoods-moxe-list`, and `receipts-json` are implemented. MOXē has grouped nine-column and ungrouped seven-column headers. The five measured counts are managed 96, Daily 241, Master 76, Recently Purchased 101, Catering 52 (566 observations). Account 71628390 and capture date come from the reviewed README/filename, not invented CSV columns. README sidecars are excluded from data parsing; unknown data files still fail. A new account capture needs its own reviewed binding; this fixture binding is not a general tenant default.

Receipts-by-photo are a first-class adapter: CC transcribes today; OCR can propose the same shape later. Two real JSON batches contain ten documents, 31 lines and eight vendors: Thompson Delivers, Baldor, Whisked, TriMark, Berger, Country Snacks, Cardinal Bakery and Boar's Head. Each line preserves vendor/document/line identity, physical transcription line, receipt date, printed quantity, known customer number, billed basis and clarification notes. Missing item numbers remain unresolved, never invented vendor identifiers. Invoice/line identity, not an empty item number or description, deduplicates transactions. Original photos are outside this clone, so image hashes/regions are not fabricated; future ingestion must preserve and verify them. No OCR is implemented here.

**Missing price is not a price update.** US Foods supplies neither prices nor purchase dates. Its null price fields mean “not supplied” and MUST NOT blank an existing accepted price, append a zero price, or displace a priced observation. Recently Purchased membership is an undated purchase proxy only; it cannot establish 60-day volume, a latest purchase date or discontinuation. Site badges report discontinued counts but do not identify rows. Daily-list grouping is preserved for reference and never replaces laminate sequence.

**Explicit vendor-line `price_basis` is required in the future write model:** per case | per lb | per each, with the actual billing denominator preserved for per-dozen and per-bundle lines. The offline observation uses `per dozen`/`per bundle` as well; any future conversion to the three core bases must carry the exact factor and original billed unit. LBA sets `pack_catch_weight: true`; ranges retain endpoints, not an invented mean. `2/90/.5 OZ` retains both count levels. Catch-weight receipt `qty` counts pieces; `net_wt_lb` is the billed mass, never inferred from piece count. $6.29/lb is $0.393125/oz, not a $6.29 case. Existing pack-price history needs an explicit reviewed denominator before it can receive such prices.

Country Snacks mixed-flavor cases are **one vendor SKU priced per case**: 14 bags × $1.80 = $25.20, 23 cases. Flavor is untracked at purchase; do not fabricate flavor SKUs or allocations. Thompson's 12.5-oz Ripples are nine bags/box at $4.37/bag ($39.33/box). Mini chips are 60 one-ounce bags at Juan's $0.39/bag ($23.40/box), while the ticket bills item 00602 at $23.35 per club pack: retain both and resolve the five-cent difference before applying. Cardinal 1030 is $7.87/dozen; delivery Mon/Wed/Thu/Fri/Sat, order before 3 pm. Baldor's July 1 prices remain dated historical evidence.

The [US Foods report](../../seed/source/vendor-exports/reports/2026-09-18-usfoods-diff.md) and [receipt report](../../seed/source/vendor-exports/reports/2026-09-18-receipts-diff.md) add section H for cross-vendor twins. Same product bought from two vendors means separate vendor SKUs with one active per shop under the multi-vendor doctrine; preserve the other as a backup. `resolveActive` uses `active_override ?? globalActive`. Product-family resemblance is not substitution approval: Ovengold turkey and 4×6 ham are different products. No activation or product membership changes occur in this groundwork.

Every normalized row carries the requested vendor/source/list/category/item/description/brand/raw pack, parsed pack parts, UOM, mutually exclusive price fields, last-purchase quantity/date, and export date. Added fields are `source_line`, `account_id`, `last_purchase_uom`, and optional `pack_unparsed: true`. `exported_at` has date precision because PFG supplies no clock/timezone. Preserve Product Number as a **string** and distinguish it from Custom Product Number. Raw files remain authoritative; descriptions containing quotes remain intact.

`6/#10 CN` means six number-ten cans, not 60 pounds. `12/12 CT` retains both hierarchy levels. `24/16.9 OZ` does not establish whether a liquid's ounces are volume or weight. `1/13 LB` plus `$2.7263/lb` does not establish a fixed $35.4419 case cost: catch weight remains unknown. Retain 272.63 decimal cents/lb (four decimal dollars), not 273 integer cents or 272.63 case cents. Unknown packs preserve raw text and prevent automatic application; they never disappear from the report.

Inputs are recursively read beneath each vendor directory; context/reports/normalized are excluded. Repeated execution generates identical bytes from identical inputs. Diff regeneration normalizes first and reads only that run's manifest, so stale JSON from a removed source does not re-enter the diff. Twelve generated files are review artifacts, not new evidence. Adapters pin real-file row counts and malformed-input cases.

## 3. Identity, idempotency and scope

Canonical vendor product identity is **(vendor_id, item_no)**. A description, barcode, fuzzy name or list membership never replaces this key. Existing duplicate keys are a blocking ambiguity, not “first row wins.” Repeated rows in several PFG lists are observations of one vendor item, not new SKUs or extra purchases. Existing SKU identity may need an explicit, reviewed location binding where two internal SKU rows carry that vendor item.

Proposed future persistence, requiring separately reviewed migrations after the current lineage:

- An append-only import batch/observation ledger with source SHA-256, adapter/schema version, vendor/account/location, export date, row provenance, normalized payload, report digest and actor. Store account identity without copying contact names/addresses unnecessarily.
- A reviewed identity binding from vendor product key to internal SKU, with explicit scope. Do not add a blind unique constraint to existing vendor_items before duplicate/location analysis. A location variant is still the same vendor product with a scoped internal binding.
- Observation uniqueness on `(vendor, account, file_sha256, adapter_version, source_row)`. Apply uniqueness on `(batch, approved_plan_digest)` plus per-operation identities in the same transaction as writes. A retry after uncertain transport returns the prior applied result and does not append another price or advance a guide token.
- The last-purchase read model is an observation attached to account/item, never a fabricated delivery, invoice or usage row. Its date never moves backward. An empty value does not erase a previous known purchase. Actual receipt transaction history uses its own invoice-line key.

Newest export date wins for quote observations; older batches remain evidence and cannot overwrite a newer accepted observation. Ties with conflicting price/pack/UOM stop the item for review. Newest known last-purchase date wins for purchase metadata. List memberships are sets. For the offline report, history wins an otherwise identical tie; this is not authority to choose a conflicting price at apply time.

**Location gate:** every batch requires a verified vendor-account → location binding. Account **56910015 is Dupont/P Street**, whose historical location code is **EM**; retain it, never rename codes. Capitol Hill's account and price agreement are unknown. The older [2025 Capitol Hill guide](../../seed/source/order-guide-caphill-2025-pfg.csv) establishes historical PFG ordering, not current account equivalence.

Guides remain one per vendor under 0205. `vendor_items.location_id` can already scope a SKU, but the snapshot does not expose those bindings; `location_sku_settings` is not a price overlay. Price readers select by SKU, not PFG account. Therefore a Dupont quote for a global SKU stays an account observation until CC establishes shared pricing or approves a scoped price-model change and its consumers. Do not create duplicate SKUs merely to evade the scope question. Do not insert per-location guides under the current uniqueness constraint. If shop sequences differ, that is a V3-A scope amendment before any writer is built.

## 4. Automatic changes versus human decisions

“Automatic” means deterministic changes **inside an approved dry-run batch**, for an exact reviewed identity and permitted account/location. It does not mean an unattended cron. Missing/stale before-state, mixed units, conflicting evidence or an unknown scope produces an explicit refusal.

| Field/action | May update automatically | Requires a person |
| --- | --- | --- |
| Export quote | Append a newer observation; append effective pack-price history only when identity, scope, UOM and unchanged pack basis are verified. Identical accepted evidence is a no-op. | Unknown case vs each basis, `/lb` without measured weight, pricing scope mismatch, conflicting same-date quote, unexplained large change flagged in D. |
| Pack metadata | Refresh raw vendor wording and verified parsed metadata when the active internal hierarchy is semantically unchanged; fill a missing pack only from a previously approved mapping. | Any change to quantities, container levels, measure dimension, cost denominator, count unit, or existing operator-taught chain. Unparsed pack and #10 weight assumptions are never auto-applied. |
| Last purchase | Append observation / advance latest known date, quantity and purchase UOM for that account/item. | Any attempt to interpret one last event as full history, receipt, depletion, order demand or stock on hand. |
| New vendor item/SKU | Stage as an unresolved candidate with source evidence. | Create SKU, choose class/product membership, unit model, account scope, active status and guide placement through existing catalog authority. Never auto-create from a fuzzy description. |
| Guide linkage | For an approved null-SKU placement, apply the explicitly reviewed exact binding through rerun RPC, maintaining position/label. | Change a non-null binding, item number, line label or sequence; add a row from a vendor list to the laminate; any ambiguous match. |
| Substitution/discontinuation | Record source text/absence as evidence. | Interpret `496 REPLACE 416637`, approve a successor, retire a SKU or remove a guide line. Absence from one list is not discontinuation. Never DELETE SKU/history. |

Price lives in the append-only price ledger; a new price must not rewrite old cost history. Physical pack changes are materially different from spelling updates. When approved, version the **whole** active `sku_pack_levels` chain and derive compatibility fields as the existing pack writer does. Keep recipes, product membership, pars, yield/trim, taught barcodes, inventory counts and delivery history out of the automatic write set.

The current report uses explicit review-only family rules to discover alternatives. For example, 1715 is a 50/50 mozzarella/provolone mix while 288533 is whole-milk mozzarella; similar names do not prove interchangeability. Basil 855571 is the most recently purchased but costs about twice 23097 for the same labeled pack. The report recommends observed live lines while flagging pack and price consequences; it never approves substitution.

## 5. Dry-run and application protocol

1. Read all input files and a complete offline catalog/guide snapshot. Validate adapter, source hashes, account binding, dates, and pack/price units. Produce normalized observations and the same A–G report shape as wave 1: guide gaps; recent unmatched purchases; item conflicts; weighted price deltas; pack mismatches; list metrics; floor questions. Every row links to input evidence. Attach actionable before/after operations and refusal reasons without replacing these seven sections.
2. Compute a canonical plan digest over inputs, adapter versions, identity decisions, location binding, before-state fields/guide tokens and full proposed write set. The reviewer approves this exact digest, not a general “import all.” Re-read the inputs and compare hashes before application. Missing catalog fields cannot be substituted from the laminate or from readiness flags.
3. A future GM+ entry point enforces session, origin and existing admin step-up rules; the library rechecks role and location before service-role I/O. A shop-scoped GM cannot approve a global two-shop effect. The service-role credential never enters the CLI/browser. Current scripts have no apply flag or credential dependency.
4. A future service-role-only coordinator RPC claims the apply key, locks affected guides in stable ID order and SKUs in stable ID order, rechecks exact before-state and scope, performs SKU/price/pack writes and the guide RPC call **in the same database transaction**, and persists the apply result. Existing guide RPCs alone do not update SKUs or make two HTTP calls atomic. This coordinator is a proposal, not a shipped function or assigned migration number.
5. Any stale token, foreign identity, duplicate placement, changed pack or failed rowcount aborts the whole application unit. `guide_stale` becomes 409 and requires a new dry-run; never replay a full stale guide model. Database error and affected rowcount are both checked. Recover uncertain transport by apply-key lookup, not blind replay. Avoid stamping tokens for a no-op batch.
6. Read back the affected state and stored result, compare to the reviewed write scope, save the application report. Correction is a new audited operation with fresh before-state; no destructive reset or historic row deletion. A multi-vendor run consists of explicitly reported per-vendor/account units; it cannot claim all-or-nothing across units.

The coordinator must reuse catalog/pack validation contracts and be tested against them; it must not blindly wrap server helpers that make separate committed requests. Unknown schema columns/registry labels are implementation blockers to resolve from the actual authorized sim schema later, not guessed SQL in this design.

## 6. Guide RPC write paths

**Approved rematch/append:** call `rerun_order_guide(p_guide_id, p_expected_updated_at, p_rematches, p_appends)` as superseded by **0209**. It locks the guide with `FOR UPDATE`, checks the expected timestamp before writing, validates vendor/active SKUs, fills only null links and checks exactly one affected row. Appends join sections by trimmed case-insensitive name, retain human spelling and append densely. It cannot change an existing line's item number. It also does **not independently deduplicate arbitrary appends**: the planner must compute only missing approved rows, and the coordinator's apply key must prevent retries from appending twice. Seed-origin/hand-created guide policy is checked by the caller, not supplied magically by the RPC.

**Approved item-number correction, replacement or sequence edit:** call `save_order_guide(p_guide_id, p_expected_updated_at, p_name, p_sections)` from **0208**, carrying the complete current model with only reviewed edits. It validates section/line ownership and vendor ownership, accepts an inactive SKU already placed but requires active status for a new placement, and rewrites transactionally under deferrable constraints. Omitted lines would be removed, so preservation of every unrelated line is a required planner invariant and regression test. Import must not use omission as retirement. Existing line IDs and positions remain stable when only a binding/number changes.

Both RPCs are `SECURITY DEFINER SET search_path = pg_catalog, public`, revoked from PUBLIC, anon and authenticated, granted only to service_role. Both use `clock_timestamp()` tokens; the row lock and stale comparison provide serialization. Preserve the complete before/after model in evidence and audit. A proposed coordinator must retain the same revoke pattern and privilege assertion.

A vendor without a guide goes through the existing empty-guide creation semantics or a separately reviewed transactional equivalent, then receives **human-approved** positions. No import sorts a new guide alphabetically or by purchase date unless a person explicitly chooses that sequence.

## 7. Audit and the walker

Reuse registered actions: `vendor_item.price_recorded` for applied price observations; `vendor_item.update` for approved SKU metadata changes; `sku.pack_chain_update` for approved hierarchy versions; `vendor.order_guide.edited` for full guide changes. Preserve their current destructive classifications: do not infer step-up from the audit registry. A future batch action, if needed, must be adjudicated into the closed action vocabulary in its implementation PR, never emitted as an unregistered string. Do not mislabel a vendor import as seed 37.

Audit metadata includes actor, vendor/account/location, batch/apply key, file hashes/row references, before/after values with units, old/new guide tokens, refusal counts and the reviewed digest. One batch summary can link per-resource mutation rows. The append-only import result ledger is the transactional retry/accountability record; the existing fail-open `audit()` helper remains fail-open. A logging failure must be disclosed/reconciled through existing gap-recovery discipline, never misreported as a failed transaction that should be retried blindly.

**WALK UNCHANGED, the ORDER follows the guide.** No import changes the walk's usage/name ordering, storage locations, pars, or demand math. Laminate section/line sequence is independent of the best-matching vendor portal list. New unplaced SKUs remain visible in “Not on the guide” until placed. Frozen confirmed PO bodies retain their recorded keys, including recorded null; only the established draft/legacy fallback reads live guides. Copied body, email, preview and receiving continue through existing shared ordering contracts. Import must not rewrite old PO snapshots.

## 8. Verification and rollout gates for the future writer

Wave 1 pins all requested pack examples, sub-cent per-pound prices, quote handling, blank purchase retention and actual five-file counts. A tiny fixture covers number-first matching, vendor/account isolation, ambiguity, 60-day boundaries, deduplication, and comparable-price impact. The report is deterministic and all evidence remains offline.

Before a future writer ships: tests for replay-after-commit, interrupted transport, two competing guide saves, foreign section/line/SKU, inactive retained versus new placement, case-insensitive sections, duplicate appends, changed before-state, no-op tokens, account scope, whole-chain pack versions, unsupported price basis and frozen confirmed PO keys. Exercise the coordinator in sim only; verify rollback on a forced late failure and service-role-only grants. CC reviews the plan, schema and code; ordinary PR CI/build applies then. Juan retains production merge/application authority. US Foods and receipt adapters now have real-file regression fixtures; any writer activation still requires the separate review above.

## 9. Open questions for Juan — floor answers only

1. Which lists do staff open to order today: Izzy MAIN for PFG, and Daily, Master or managed for US Foods, while reading in laminate order?
2. For mayo, Saratoga, Natalie's lemonade, iceberg and cooked eggs, which vendor is the normal source at each shop and which is the backup?
3. Which shell eggs are stocked (PFG 517879 large or 517842 medium), and are cooked eggs (PFG 439686 / US Foods 827428) also ordered separately?
4. Is Dried Chives a separate product; are the vinegars, mint, strawberries and multifold towels regular stock or occasional purchases?
5. Which alternate parmesan, garlic, oregano, basil and mozzarella lines replaced the laminate versus serving as backups; is premium basil intentional, does White onion mean yellow, and is pork 474569 now the code staff keys?
6. Does Capitol Hill use separate PFG/US Foods accounts, prices/packs or laminate sequence from P Street?
7. For mini chips, should the repeat order use the ticket's $23.35/60-pack or the clarified $0.39/bag ($23.40/box)?
8. Are US Foods' 4×6 ham lines still bought for a separate use from Boar's Head Ovengold turkey, and which ham is the current choice?
