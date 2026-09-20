# Seed 38 — catalog repair and vendor identity (built 2026-09-20)

Authority: seed38-rulings.md + the CODE dispatch override the earlier review draft.
Branch: feat/seed38-catalog-repair, C:/Users/conta/co-ops-astra. Files only; CC commits,
reviews, applies 0210, and runs the seed on sim then prod. No network or DB access
was used during implementation; validation uses the committed fixtures.

## Files and contracts

- 0210_vendor_items_price_basis.sql: exactly the reviewed nullable text column,
  five-value CHECK and COMMENT. No default, grants, RLS, enum or data changes.
- 38-manifest.ts: pure planner over the real 293-row CSV, the September 19 catalog
  and normalized vendor evidence. Literal review and operation counts; exact SKU
  identities; no fuzzy pack changes. The CLI pins all evidence with SHA-256.
- 38-catalog-repair.ts: one guarded CLI, default dry-run, paginated complete reads,
  checked UPDATE rowcounts, read-back after every mutation and audit, closed audit
  vocabulary, one audit per changed class, and explicit interrupted-run refusal.
- Audit registries: existing vendor.create moves to NON_DESTRUCTIVE_ACTIONS per
  the dispatch; vendor.deactivate is reused; the other seven new names are typed
  and classified exactly as requested. This changes no permission or step-up gate.
- seed38-manifest.test.ts + seed38-execution.test.ts: real-fixture math/counts and
  refusal tests, plus the actual runner against an in-memory Supabase double.

## First-run fixture counts (logical operations)

| Class | Ready | Already |
|---|---:|---:|
| vendor.create | 1 | 0 |
| vendor.deactivate | 1 | 0 |
| vendor.merge | 1 | 0 |
| sku.vendor_repoint | 1 | 0 |
| vendor_item.create | 1 | 0 |
| sku.item_number_set | 17 | 0 |
| sku.price_basis_set | 53 | 0 |
| sku.pack_level_supersede | 15 | 0 |
| sku.price_supersede | 13 | 1 |

The 17 number operations are 16 SKU attachments plus IN-068's existing guide
line. Of the 92 PB rows, 46 reconcile and 46 remain basis_unresolved; seven Utz
assignments carry the explicit per_each ruling. Prices: six PC appends plus seven
Utz appends; Black peppercorn is already current; Ever Roast is held. dedupe_level
is withdrawn; guide_absent has no mutations. Historical prices/levels are kept.

## Implementation decisions and assumptions

- [ASSUMPTION] IN-068 has no sku_id; both its guide line and the distinct plain
  Eggs SKU currently carry 439686. Amend ONLY the existing unlinked guide line to
  517842 and append "tentative — confirm at the door". Preserve sku_id=NULL and
  every SKU number. The full-model save_order_guide RPC validates ownership and
  the old token, preserves all IDs/order, and advances the token atomically.
  This follows the original plan's guide exception; ordinary SKU numbers remain
  strictly null-to-value. A different non-null SKU number always refuses.
- [ASSUMPTION] Keep the locked ledger denomination: dollars per purchase root.
  Ripples stores 4.37 x 9 = 39.33/Box; Mini stores 0.39 x 60 = 23.40/Box, both
  with price_basis=per_each (bag). Pepperoni stores 4.99 x 55.88/16 = 17.427575
  per piece. The printed bag/pound rates and arithmetic remain in source_note,
  dry-run and audit. No costing function is changed.
- [ASSUMPTION] Catch-weight receipts explicitly billed per lb normalize the
  existing purchase-root price by its proven pounds before comparing to the
  billed rate. Thus Ovengold 58.18 / (148/16) reconciles to 6.29/lb. No unproven
  count-to-weight or volume-to-weight conversion is made.
- [ASSUMPTION] Country Snacks has FIVE flavor SKUs, each a 2.75-oz Bag, and no
  mixed-case SKU. Apply 1.80/bag to all five, keeping those identities and roots.
  Do not invent five separate 14-bag flavor cases from a mixed-flavor receipt.
  Thompson's Mini SKU is new and intentionally has no ticket number 00602.
- The literal whole-vendor-pack root rule computes 15 repairs, including Butter
  16→576 oz, Shredded Mozz 80→480 oz, Ground Pork 80→160 oz, Ricotta 160→320 oz,
  Salt 48→432 oz and Garlic Powder 96→288 oz, in addition to the named herbs,
  red onion, Panko, Fusilli, Garlic and Cheddar. It changes cost denominators;
  CC must inspect these printed repairs in the dry-run. Labels/ordinals stay as
  requested. Existing pointer children stay reachable; only roots are replaced.
  Dimension mismatches are printed as pack_unresolved, never guessed.
- Basis decisions use the reviewed pre-seed ledger values, so a price append does
  not change the next run's basis plan. Unresolved entries remain an explicit
  data errand. Original exact-number joins determine pack eligibility forever;
  newly attached ICE1 cannot authorize a later accidental lettuce pack repair.

## Runtime and provenance

```text
node --env-file=<env> --import tsx scripts/seed/38-catalog-repair.ts --target sim
node --env-file=<env> --import tsx scripts/seed/38-catalog-repair.ts --target sim --execute
node --env-file=<env> --import tsx scripts/seed/38-catalog-repair.ts --target prod --execute --i-have-juans-word
```

Only the usual NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed.
No env file loads on import. Fixed exact HTTPS hosts match seed 26/37. An omitted
--target is accepted only for dry-run and only on one of those two known hosts.
Execute internally starts Node with react-server for the house audit() helper;
no extra flag is required from CC. Neither psql nor DATABASE_URL is required.

The existing 0201 angel_wave7_snapshot(NULL) RPC reads information_schema.columns
at runtime. Missing 0210 or missing write columns refuse before any write.
Unexpected user-defined column types refuse for pg_enum review; this manifest
inserts no enum value. vendors.notes is optional: absence is printed, the note
is retained in provenance, and no absent column is written.

Writes follow vendor → SKU → pack → price classes. Because active level labels
are unique, a pack retires its old root before inserting its new root. Every
write is read back. Every audit carries actor_context=seed_38, input digest,
before/after IDs and rows, evidence, counts, and the registry's destructive flag.
Merge provenance explicitly names both vendor IDs. Price rows also carry source
and arithmetic source_note. Identical reruns verify provenance and write nothing.

Like seeds 36/37, the overall seed is NOT atomic. On any failure it stops; CC
must reconcile committed effects. A missing class audit on an already-applied
operation refuses instead of silently continuing or inventing recovery history.
Deterministic insert IDs prevent duplicate prices/levels; newer current prices,
changed identities, changed packs and unrelated concurrent writes refuse.
Only the guide amendment is protected by an existing transactional RPC. The
sim execution remains required before production; offline tests do not validate
PostgREST, live SQL constraints or the deployed RPCs.

## Verification

Focused fixture/runner suite: 37 tests (counts, named basis examples, unresolved,
collision/Delmar/Ripples refusals, append-only history, read-only dry-run, nine
class audits, zero-write rerun, UPDATE 0 and fail-open audit loss).
Final full npm test, tsc --noEmit and scoped eslint results are in the handoff.

Final verification (offline, 2026-09-20):
- npm.cmd test: PASS — 184 files, 3,467 tests (37 seed-38 tests).
  The initial npm test spelling hit the machine's disabled npm.ps1 policy;
  npm.cmd ran the same package script successfully, once, over the full suite.
- node node_modules/typescript/bin/tsc --noEmit --incremental false: PASS.
- Scoped ESLint on both 38 scripts, both seed38 test files and both registries: PASS.
- git diff --check: PASS; only dispatch-allowlisted paths changed.
- Fixture report: 46 basis_unresolved, 8 cross-dimension pack_unresolved, one held
  Ever Roast decision. The mock runner verifies all nine class audits and no-op retry.
- No commits, pushes, network calls, sim operations, production operations or SQL
  application. Live SQL/REST execution and CC cross-review remain outside this run.
