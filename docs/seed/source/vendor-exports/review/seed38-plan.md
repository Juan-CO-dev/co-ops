```text
Offline review-check output (2026-09-20; commands in verification.md):
dedupe_level: 55
price_conflict: 8
price_basis: 92
item_number: 68
vendor_merge: 29
guide_absent: 41
needs_juan: 74
total: 293
```

# Seed 38 — catalog repair and vendor identity review

**REVIEW DRAFT, not executable approval.** [Sheet](seed38-review.csv); [verification and command transcript](verification.md). CC rules on the sheet and plan; Juan answers flagged floor rows; only then is the seed authored. No network, seed script, migration file, commit, or production operation belongs to this wave.

## Ground truth and scope decisions

The complete September 19 export contains 229 SKUs, 186 levels (95 active, 91 inactive), 103 prices, and 163 guide lines. **All 55 repeated-ordinal SKUs already have unique active ordinals.** The 28 conflicting historical groups are version history, not duplicate live chains (BC-009). Fifty DL rows retain current IDs; five name an export-matching historical source for a possible whole-chain replacement: Basil, Garlic, Oregano, Parsley, Thyme. Retired source IDs never become active again. CC must explicitly approve those pack changes; they are not deduplication no-ops.

Eight SKUs have historical same-date price differences. Black peppercorn's exact winner is already current. Oregano has a conditional superseding proposal, coupled to its pack decision. Six have no evidence-supported winner; proximity to a later quote cannot authenticate a historical price. Keep them held.

The 68 IN rows are the requested 67 numberless linked lines **plus** Juan's existing plain-Eggs line amendment. That line is unlinked, and no SKU has number 517842. Propose printed number 517842 and note `tentative — confirm at the door`; keep its SKU link null until CC approves a genuine shell-egg identity. Never bind it to cooked eggs or invent a SKU ID.

Boar's Head has 27 SKUs; Delmar has zero. VM contains one decision header, one loser row, and all 27 member inventories. Only the header needs Juan. `vendors.notes` exists in `lib/admin/vendors.ts`, but its value is omitted from the snapshot; append the purveyor attribution after reading existing notes.

Receipt coverage cannot fill all 67 lines. Baldor ICE1 is tentative for generic Lettuce; A3/RA1A/D/PAMILKRB1 match none of the other numberless Baldor labels. Cardinal 1030 matches Sub Roll; 3290 has no matching guide SKU. Berger 1001/1010 have no catalog/guide SKU. Thompson has no vendor row: 27149 matches Country Snacks' Ripples pack but cannot become that vendor's number. Raw ticket 00602 means a 60-ounce bag; CC §9 overrides its stale normalized mini-chip interpretation. Country Snacks/Amazon/Webstaurant remain null. Other unmatched numbers remain unknown, not nonexistent.

## Migration 0210 (DDL for the future seed PR)

Land as `supabase/migrations/0210_vendor_items_price_basis.sql`, after checking lineage and authorized schema. No file is created in this wave.

```sql
ALTER TABLE public.vendor_items
  ADD COLUMN price_basis text
  CONSTRAINT vendor_items_price_basis_check
  CHECK (price_basis IN
    ('per_case', 'per_each', 'per_lb', 'per_dozen', 'per_bundle'));
COMMENT ON COLUMN public.vendor_items.price_basis IS
  'Reviewed vendor purchase denomination. Nullable until adjudicated; no default. '
  'Does not reinterpret vendor_price_history.unit_price, which remains dollars '
  'per internal purchase root. Pack conversion is required when bases differ.';
```

No default, NOT NULL, enum, RLS relaxation, or grant change. The distinction is necessary: Butter is per_each (one pound), Duke's per_each (one gallon), turkey per_lb, and Cardinal per_dozen, while turkey's stored $58.18 still prices a 148-oz piece. Ricotta's two-tub internal unit is unresolved. A five-value column cannot encode conversion factors; ordering must not treat the stored piece price as a pound price. `computeSkuCostPerOz` remains unchanged.

## Write order and exact operations

Follow seeds 36/37: pure manifest/planner, default dry-run, target guards, digest-bound execution, direct-invocation guard, no env loading on import. Future implementation plan and code require CC's cross-family review before execution.

1. Read complete tables using pagination, schema columns/enums, all vendor references and guide tokens. Assert literal input counts above, exact reviewed IDs/values, 92 priced SKUs, 67 missing-number lines, 41 absent lines, 27/0 merge members, and approved sheet hash. Replace literals only through a fresh reviewed export. Refuse unknown/missing/stale rows and unresolved mutating proposals before any write.
2. **dedupe_level:** `no_op_already_retired` writes nothing. A real redundant active row would receive only `active=false`, with survivor pointer reachability validated. Five `review_whole_chain_replacement` rows are held: after explicit approval, deactivate the entire current active set and insert a fresh complete chain from the named source contents. Validate one root, acyclicity, reachability, measures, labels, and ounce resolution; derive/check flat mirror fields. Never apply `retire_ids` blindly or reactivate historical IDs.
3. **price_basis:** guarded `vendor_items.price_basis = proposed` for each approved PB row. Equal values are no-ops; different non-null values refuse. Low-confidence inferred rows need CC adjudication. No existing price/pack amount changes merely from setting basis.
4. **price_conflict:** preserve every historical row. PC-004 writes nothing. PC-007 conditionally INSERTs `vendor_price_history` for the same `vendor_item_id`, `unit_price=55.27`, `effective_date=2026-09-20`, only after the reviewed 80-oz pack is established and the selected source is not already latest. Refresh review date/digest if execution is later. Carry the sheet note/source IDs in audit metadata; only use a ledger note column if schema confirms it. Six held rows write nothing until adjudicated. Recheck `effective_date DESC, recorded_at DESC, id DESC`.
5. **item_number:** guarded null-to-number UPDATE on the reviewed `vendor_items.id`; empty proposals do nothing. Refuse same-vendor identifier collisions. IN-068 updates the existing guide number/note through full-model `save_order_guide` with expected token and all other line IDs/order preserved; no appends.
6. **vendor_merge:** retain Boar's Head active, append Delmar attribution once to existing notes, repoint only approved loser SKUs (zero here), then set Delmar `active=false`. Assert remaining references; historical FKs remain intact. Inventory rows already on the survivor do nothing.
7. **guide_absent:** zero writes. Candidates include weak lexical matches and 35 rows without vendor export coverage; they are not substitutions or standing guide additions.

No twin primaries, location vendor facts, occasional-item additions, product memberships, pars, or historical PO edits. Both shops share accounts (§9a).

## Audit, dry-run, and acceptance

ONE audit row per changed class, aggregating exact before/after IDs, sheet/source hashes, approved decisions and affected counts. Proposed new actions `sku.pack_level_dedupe`, `sku.price_basis_set`, `vendor.merge` must enter `lib/audit-actions.ts` through the closed union and `DESTRUCTIVE_ACTIONS` (human config changes), not `NON_DESTRUCTIVE_ACTIONS`. Reuse `vendor_item.price_recorded` for PC and `vendor_item.update` for IN with existing classifications; the single IN audit includes its guide amendment and both tables' before/after records. No audit for unchanged classes. Do not claim action membership enforces step-up.

Dry-run prints each row's ready/already/held status, exact operations, assertions, conversions, audit classes, refusals and digest. Execution checks errors AND rowcounts; read back every write and audit. Seeds 36/37 are not atomic: coupled pack/price and guide/vendor operations require an explicitly reviewed transaction strategy, or stop on partial completion for CC reconciliation. Retry verifies committed effects/provenance and never appends twice (BC-007).

Acceptance: CC supplies a post-seed export and re-runs `scripts/vendor-exports/diff.ts --catalog prod`. Require ZERO duplicate **active** levels, ZERO **unresolved current** same-date price decisions, every priced SKU with an approved basis, unchanged historical rows and unchanged unrelated guide/PO state. **Literal ZERO historical duplicates/conflicts is impossible under append-only.** The current diff also lacks these diagnostic gates and reads root labels as price basis; its future reporting extension and corrected acceptance wording need CC approval. Do not report the original gate passed or activate the importer while six price decisions or other required repairs remain held.
