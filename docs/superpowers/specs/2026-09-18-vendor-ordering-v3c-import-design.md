# Vendor Ordering V3-C — vendor export import

**DRAFT for CC review · updated 2026-09-19 · waves 1–4 groundwork.** This document proposes the write design; this branch contains only offline normalization, comparison, tests, and reports. No import writer, migration, network operation, or production read was performed by Astra. CC supplied the offline production export.

## 0. CC ruling (2026-09-19, after the four-wave R0) — what V3-C is, in order

**Verdict on the groundwork:** accepted. The adapters, parsers, real-catalog loader and the four reports are correct where sampled, conservative where they could not be sure, and every table row cites its source. PR #374 lands them as tooling; nothing in it writes to prod.

**The finding that reorders the arc.** The join was built to compare vendor prices against the catalog. What it actually exposed is that the catalog is not yet a stable thing to import INTO:

| Defect (prod export 2026-09-19) | Count | Example |
|---|---|---|
| SKUs whose pack chain has duplicate `display_ordinal` levels **among ACTIVE rows** | **0** of 73 chained SKUs (CORRECTED 2026-09-20: CC's first count ignored `active`; the 55 "duplicates" are historical `active=false` levels — 91 of 186 level rows — that append-only correctly keeps) | Oregano 261432 has `jug 80 oz` retired and `jug 96 oz` active |
| SKUs holding more than one price on ONE `effective_date` | 8 of 92 priced | Oregano: 55.27 and 13.82 on 2026-08-14, then 4.50 on 08-31 |
| "case"-format SKUs whose `units_per_pack` is 1 — the catalog's *case* is the vendor's *each* | 35 of 86 | Butter "case" = 1 lb @ $2.25 (PFG sells 36/1 LB @ $80.30); Duke's "case" = 1 gal @ $18.50 (PFG 4/1 GA @ $73.99) |
| Guide lines whose SKU has no vendor item number | 67 of 163 | every Boar's Head, Baldor and Amazon line |

The dollar "deltas" in the reports are therefore mostly **denominator mismatches and duplicate-level artefacts from the seed and Angel waves**, not vendor price moves. An importer that wrote observations into this catalog today would propagate the duplicates and misread every case-versus-each row. So:

**V3-C is two deliverables, and the order is not negotiable.**

**V3-C-1 — catalog repair + vendor identity, as a seed (seed 38), before any importer.** Built from the reviewed join, human-reviewed CSV → seed with dry-run + audit rows, the repo's existing law for data changes:
1. ~~Dedupe `sku_pack_levels`~~ — WITHDRAWN 2026-09-20 (see the corrected table: active chains are already unique per ordinal). What remains for packs is the ACTIVE level's quantity where it disagrees with the vendor export (e.g. Oregano active `jug 96 oz` vs PFG `1/5 LB` = 80 oz): those become reviewed `price_basis`/pack rows, not a dedupe.
2. Resolve the 8 same-date price conflicts the same way; the survivor is the one that reconciles to the vendor's pack at the catalog's purchase basis.
3. **Declare the purchase basis explicitly** — migration 0210 adds `vendor_items.price_basis` (`per_case | per_each | per_lb | per_dozen | per_bundle`) and, where the catalog's "case" is the vendor's each, records that fact rather than silently renaming. Costing (`computeSkuCostPerOz`) is untouched; ordering gains the true purchase pack for PO quantities.
4. Attach `item_number` to the 67 number-less guide lines from the exports and receipts (Boar's Head from the Delmar invoices: 278, 505, 137, 558, 546, 12011, 30, 795; Baldor from its invoice codes; Cardinal 1030/3290; Thompson 27149/00602; Berger 1001/1010). Amazon/Webstaurant lines stay null — no vendor number exists.
5. Vendor identity: `Boar's Head` and `Delmar Provisions` are one purveyor in the catalog today; Juan names the survivor and the seed re-points the other's SKUs (append-only: the losing vendor row goes `active = false`).
6. Guide hygiene from section I: the 41 numbered lines absent from every export are NOT touched by the seed — they become the first human review list, with the export's nearest candidates beside each.

**V3-C-2 — the importer, as designed in §§2–8 of this draft**, after V3-C-1 is on prod: adapter registry, upload, dry-run report identical in shape to these reports, apply through the 0207–0209 RPC pattern with the auto-versus-human table of §4 enforced structurally (no-price adapters never blank a price; catch weight needs `price_basis`; mixed-flavor DSD cases are one SKU priced per case). Second export cycle (October) is the acceptance test.

**Rulings on the report's own open items:** Izzy MAIN and US Foods Order Guide #514925 are treated as the live lists until a manager says otherwise (question 1 stays open only to confirm). Eggs: the guide's plain "Eggs" line re-points to 517879 (large) unless Juan says medium. The former question 6 is withdrawn (see the note in §9). Five floor questions remain; they go to Juan in one list.

## 0b. V3-C-2 v1 — shipped scope (CC, 2026-09-20, built on auto; plan `docs/superpowers/plans/2026-09-20-v3c-2-vendor-importer.md`)

- **R1** write set = price observations (append), item numbers (null → value only), pack chains (whole active chain versioned) through ONE transactional RPC `apply_vendor_import` (0211). Guide writes (§6) and SKU creation stay human: the report lists them as `needs_person` with deep links to the Order Guide panel and the SKU editor.
- **R2** audit = the seed-38 row actions + `vendor.import_staged` (non-destructive) / `vendor.import_applied` (destructive), `actor_context: vendor_import`; the spec's `vendor_item.update` / `sku.pack_chain_update` names do not exist and were not created.
- **R3** stage at GM (7); **apply at 9 + step-up Tier A** — both shops share the vendor accounts (§9a.5), so an applied price is a two-shop effect.
- **R4** identity: exact `(vendor_id, item_number)` → exact normalized name → `ambiguous` / `unmatched` (a person decides). **R5** a missing price never blanks a price; `/lb` applies only to weight-denominated roots. **R6** pack changes only within one dimension (fl oz vs oz = needs a person). **R7** batches are global in v1; the account id is recorded as evidence.
- Idempotency: `vendor_import_applies` UNIQUE `(batch_id, plan_digest)` is the apply claim; before-state is re-checked inside the RPC (`stale_before_state` → 409, fresh dry-run required). Same file twice = same batch (`(vendor_id, source_sha256, adapter_version)` unique).
- v2 (not built): guide RPC calls inside the same transaction; SKU creation from a staged candidate; receipts by OCR; per-location batches.

## 1. Evidence and governing contracts

The [re-runnable PFG report](../../seed/source/vendor-exports/reports/2026-09-18-pfg-diff.md) cites physical source lines for every table row. Five CustomerFirst files contain 273 observations, 115 distinct item numbers. The independent counts are 97 purchase history, 84 Izzy MAIN, 58 Opening, 14 managed, 20 Paper. Last Purchase is the **last event only**, not cumulative transaction history. The 60-calendar-day window is July 21–September 18 inclusive.

The September 19 [real catalog join](../../seed/source/vendor-exports/reports/2026-09-19-catalog-join.md) supersedes the readiness-only comparison. CC's export contains 2 locations, 21 vendors, 229 vendor_items (including inactive), 186 pack levels, 21 measures, 103 price-history rows, zero location overlays, and 15 guides / 24 sections / 163 lines. `vendor_items.id` IS the SKU id. Null stored identifiers/packs/prices remain null; US Foods still supplies no quote prices or dated purchases. The September 16 snapshot remains available for one release via `--catalog snapshot` to regenerate wave 1 unchanged.

The wave-4 window is July 22–September 19 inclusive. The loader imports the pure production pack/cost functions; it joins history by `vendor_item_id`, orders `effective_date DESC, recorded_at DESC, id DESC`, and preserves the winning price's date and source line. Active pack pointers govern contents; display ordinal never defines conversion. Flat pack fields remain a separately shown mirror. Latest unit_price is dollars per internal purchase root, not necessarily a vendor case. Report cents are dollars ×100; derived lb prices are cost/oz ×16×100. Count/volume averages remain estimates, never actual invoice weights.

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

Canonical vendor product identity/idempotency key against the real schema is **(vendor_items.vendor_id, vendor_items.item_number)**, with export `item_no` mapped to `item_number` as a string (leading zeroes preserved). This is the proposed import identity, not a claim that the export proves a database unique constraint. `vendor_items.id` remains the FK target of price history and guide lines. Null/empty item_number cannot be an apply key. A description, barcode, fuzzy name or list membership never replaces this key. Duplicate keys are blocking ambiguity, not “first row wins.” Repeated export lists observe one item without adding purchase volume. Location-scoped internal variants still require explicit reviewed binding. Batch replay additionally needs the apply key below; product identity alone cannot deduplicate price observations.

Proposed future persistence, requiring separately reviewed migrations after the current lineage:

- An append-only import batch/observation ledger with source SHA-256, adapter/schema version, vendor/account/location, export date, row provenance, normalized payload, report digest and actor. Store account identity without copying contact names/addresses unnecessarily.
- A reviewed identity binding from vendor product key to internal SKU, with explicit scope. Do not add a blind unique constraint to existing vendor_items before duplicate/location analysis. A location variant is still the same vendor product with a scoped internal binding.
- Observation uniqueness on `(vendor, account, file_sha256, adapter_version, source_row)`. Apply uniqueness on `(batch, approved_plan_digest)` plus per-operation identities in the same transaction as writes. A retry after uncertain transport returns the prior applied result and does not append another price or advance a guide token.
- The last-purchase read model is an observation attached to account/item, never a fabricated delivery, invoice or usage row. Its date never moves backward. An empty value does not erase a previous known purchase. Actual receipt transaction history uses its own invoice-line key.

Newest export date wins for quote observations; older batches remain evidence and cannot overwrite a newer accepted observation. Ties with conflicting price/pack/UOM stop the item for review. Newest known last-purchase date wins for purchase metadata. List memberships are sets. For the offline report, history wins an otherwise identical tie; this is not authority to choose a conflicting price at apply time.

**Location gate:** every batch requires a verified vendor-account → location binding. Account **56910015 is Dupont/P Street**, whose historical location code is **EM**; retain it, never rename codes. Capitol Hill's account and price agreement are unknown. The older [2025 Capitol Hill guide](../../seed/source/order-guide-caphill-2025-pfg.csv) establishes historical PFG ordering, not current account equivalence.

Guides remain one per vendor under 0205. The real export now exposes `vendor_items.location_id` → `locations.code`; null means global, not unknown shop stocking. `location_sku_settings` has zero rows and is not a price overlay. Price readers select by SKU, not PFG account. Therefore a Dupont quote for a global SKU stays an account observation until CC establishes shared pricing or approves a scoped price-model change and its consumers. Do not create duplicate SKUs merely to evade the scope question. Do not insert per-location guides under the current uniqueness constraint. If shop sequences differ, that is a V3-A scope amendment before any writer is built.

### 3.1 Concrete adapter → schema mapping (proposed writes, not an implemented importer)

The real join detects duplicate PFG keys `870550` and `439686` (see report C),
so `(vendor_id, item_number)` cannot be blindly upserted as though it already
uniquely selects a SKU. It also finds all 229 location_id values null/global,
119 numbered SKUs, 92 with a latest price and 111 with a derivable pack. These
are configuration facts, not proof of per-shop assortment or current quote entitlement.

| Adapter / export column | Real destination / transformation | Source contract |
| --- | --- | --- |
| PFG `Product Number` | `vendor_items.item_number`; reviewed vendor binding → `vendor_items.vendor_id`; never Custom Product Number | [pfg.ts:22](../../../scripts/vendor-exports/adapters/pfg.ts#L22) |
| PFG `Product Description`, `Brand` | Description proposes `vendor_items.name`; brand remains observation metadata (no invented brand column) | [pfg.ts:26](../../../scripts/vendor-exports/adapters/pfg.ts#L26) |
| PFG `Pack Size`, `UOM` | Reviewed root label + parsed quantities → `sku_pack_levels.label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal`; active chain superseded as a whole. Production helper derives `vendor_items.pack_format, units_per_pack, each_size, each_measure` mirror | [pack writer:138](../../../lib/admin/pack-chain.ts#L138), [pure mirror:349](../../../lib/admin/catalog-shared.ts#L349) |
| PFG `Price`, Generated date | After denominator reconciliation only: dollars per internal pack → `vendor_price_history.unit_price`, bound SKU id → `vendor_item_id`, quote date → `effective_date`; `recorded_at` is ingestion time. `/lb` cannot be inserted as a case price | [cost.ts:87](../../../lib/admin/cost.ts#L87), [pfg.ts:27](../../../scripts/vendor-exports/adapters/pfg.ts#L27) |
| PFG `Last Purchase (qty & date)`, category/list | Observation metadata only; no fabricated deliveries, pars or guide positions | [pfg.ts:27](../../../scripts/vendor-exports/adapters/pfg.ts#L27) |
| US Foods `Product Number`, `Product Description`, `Product Package Size` | Same `vendor_items.item_number/name` and reviewed `sku_pack_levels` mapping; US Foods vendor id distinct from PFG | [usfoods.ts:36](../../../scripts/vendor-exports/adapters/usfoods.ts#L36) |
| US Foods `Product Brand`, Customer Product Number, Class, Storage, Group/Line | Observation metadata; no automatic SKU-class/storage/guide-order overwrite | [usfoods.ts:43](../../../scripts/vendor-exports/adapters/usfoods.ts#L43) |
| US Foods prices / dated purchases | No source columns: no price-history write, no dated purchase inference; Recently Purchased remains undated membership | [usfoods.ts:39](../../../scripts/vendor-exports/adapters/usfoods.ts#L39) |
| Receipts `vendor`, `lines.item_no`, `description` | Reviewed vendor id + item_number identity; null printed numbers stay unresolved; description proposes name only | [receipts.ts:39](../../../scripts/vendor-exports/adapters/receipts.ts#L39) |
| Receipts `unit_net` / `price_per_case` / `price`, `unit`, `date` | Reconcile billing denominator to internal purchase pack before `vendor_price_history.unit_price`; receipt date → effective_date; document/line identifies observation, not SKU | [receipts.ts:50](../../../scripts/vendor-exports/adapters/receipts.ts#L50) |
| Receipts `net_wt_lb`, qty, pack/clarification notes | Net pounds extend lb rates; pieces do not. Notes may propose reviewed chain quantities/measures; qty alone never changes units_per_pack. Preserve billed mini-chip price and clarified bag price independently | [receipts.ts:54](../../../scripts/vendor-exports/adapters/receipts.ts#L54) |
| All adapters account metadata | Reviewed location binding → existing SKU scope; never infer shared prices or change `locations.code` from a vendor label | [skus.ts:238](../../../lib/admin/skus.ts#L238) |

Section I uses `order_guide_lines.sku_id` → `vendor_items.id` → current SKU item_number, not a stale copied line.item_number. It accounts for every seeded line, distinguishes null links from linked SKUs without numbers, and lists dated recent export identities absent from all guides. A guide line with an unlinked printed number is still unresolved; a potential addition must resolve that existing line before creating a duplicate. No guide or PO snapshot is modified; `resolveGuideKey` remains unchanged.

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

## 9a. Juan's floor answers (2026-09-19 night)

1. **Live lists confirmed:** Izzy MAIN at PFG; the managed Order Guide #514925 at US Foods.
2. **Twins: no fixed primary.** "Whichever one has what we need available." The product ladder's rung ② (most-recently-received active member) IS the policy; seed 38 designates no primaries.
3. **Shell eggs: medium, tentatively** (517842) — "I think medium, I'm not sure." Confirm at the door; the seed points the plain "Eggs" line at 517842 with a note.
4. **Dried Chives, vinegars, mint, strawberries, towels:** not sure; "some of those are just specials or seasonal." → occasional-purchase class; NOT standing guide lines; never added to a guide from purchase history alone.
5. **Capitol Hill orders on the SAME PFG and US Foods accounts, choosing the store in the vendor's UI at order time.** Consequence for §3: the account→location binding is not by account. Both shops share item numbers, prices and lists; per-location facts (pars, sequence, active overlay) come from CO-OPS, not from the vendor. Exports are account-wide evidence for BOTH locations.

## 9. Open questions for Juan — floor answers only

> CC 2026-09-19: the former question 6 (mini-chip billing $23.35 vs $23.40) is withdrawn — the Thompson ticket's $23.35 line is the **60 oz Utz Club Pack** (a 60-OUNCE bag, qty 2), not the 60-COUNT mini-chips box; the ticket carries no mini-chips line at all. Mini chips are priced solely from Juan's note ($0.39/bag, 60/box). Nothing to reconcile.

The join answers the former **evidence requests** for stored SKU identifiers, active flags, pack chains, dated catalog prices, locations and actual guide links; those requests are dropped. None of the eight previous floor questions is fully answered by stored configuration alone. In particular, global active flags with zero shop overrides do not prove normal-versus-backup usage. The six decisions below consolidate related questions without falsely closing them (old 2+8 and 3+5 are grouped).

1. Which PFG/US Foods lists do staff actually open while ordering in laminate order?
2. Which vendor is normal versus backup at each shop for the twin families, and which US Foods ham is still bought for its separate use (never a turkey substitute)?
3. Which shell-egg size and cooked-egg line are intended, and which alternate parmesan/garlic/oregano/basil/mozzarella/onion/pork numbers supersede the laminate versus remain backups?
4. Is Dried Chives separate, and are the unmatched vinegars/mint/strawberries/towels regular stock or occasional purchases?
5. Does Capitol Hill use separate accounts, prices/packs or guide sequence? Stored location bindings do not establish account-price equivalence.
