# Count ezCater customization effects and package picks

Previously, approving an ezCater item counted its base recipe while discarding selected customizations. This change maps provider customization IDs per shop, then applies the same effect and package-pick math as Toast to both live depletion and the shadow ledger. GF/lettuce swaps remove only the actual parent's bread; extra mozzarella uses its configured portion. Package picks consume choice capacity, including Light Lunch's 0.5 whole-sub depletion, and distribute only the remaining capacity across the assortment.

The existing ezCater review page now supports multiple effects, portions, parent-only removals, package picks and explicit ignores. Fresh 8+/catering-manager authorization and Tier-B step-up remain required. English/Spanish labels ship together. Migration 0236 provides service-only atomic decisions, target/source validation, queue race protection and audit before/after snapshots.

Unmapped options queue a review and make their line unresolved/degraded. They never silently fall back to the reviewed base or reintroduce linked Toast checks. Option quantities are line totals. Shadow graphs now resolve per shop, matching the live path. Added-SKU weights are loaded even when that SKU is absent from recipe inputs.

## Verification

```text
npm.cmd test
384 files passed; one unrelated vendor-export test exceeded its 30-second timeout.
6,040 passed, 1 failed, 1 skipped.

npm.cmd test -- --maxWorkers=2
385 files passed; 6,043 tests passed, 1 skipped.

npm.cmd test -- tests/ezcater-shadow.test.ts tests/ezcater-customizations.test.ts
2 files passed; 33 tests passed (includes the added per-shop shadow regression).

npm.cmd run typecheck
Only the six explicitly excluded Leaflet PNG TS2307 errors:
components/admin/catering/fulfillment/ZoneMap.tsx:24-26
components/order/DeliveryRouteMap.tsx:6-8
No other diagnostics.

git diff --check
Passed.
```

Final focused verification across all eight ezCater files passed 202 tests after integration. Additional review tests cover authorization, step-up, effect/pick exclusivity, units, source-snapshot staleness, API routing, queue isolation and PII projection. SQL and browser preview smoke were not executed in this clone.

## CC handoff / deployment order

1. Cross-family review of this uncommitted diff. No branch push, commit, merge or deployment was performed.
2. Apply `supabase/migrations/0236_ezcater_customization_map.sql` in SIM, then run `scripts/test-ezcater-customizations.sql` as the migration owner with stop-on-error. It checks role refusals, exact error contracts, successful effects/picks, stale sources, queue suppression and effective grants; it ends in `ROLLBACK`.
3. After the migration is approved/applied, run `docs/seed/seed-47-ezcater-customizations.sql` with the session setting `seed47.target='prod'` (or `sim`). It derives customization IDs from current stored provider snapshots, guards target/identity/portion ambiguity, requires seed 46's Light Lunch configuration, emits map rows for inspection and ends in `ROLLBACK`. Production IDs/portions were not fetched or fabricated in this build. Review the discovery output before a separately authorized persistent run replacing the final rollback with commit.
4. Complete the reviewed seed before code deployment while `EZCATER_DEPLETION_ENABLED=1`: missing customization maps deliberately leave affected lines unresolved. Refresh the shadow window to populate reviews for remaining options.

## Remaining limits

- A flat package-level removal without a specific parent-sub association is explicitly unresolved (`customization_parent_unresolved`); the engine does not guess which package choice lost an ingredient.
- SQL runtime/locking behavior, production-shaped seed discovery and phone preview remain validation gates for CC. No production data was touched.

## File anchors

- `lib/ezcater/customizations-shared.ts:24` — provider-ID resolution; `:47` — package allocation; `:87` — shared line counting.
- `lib/ezcater/customizations.ts:8` — bounded map/added-SKU weight loader.
- `lib/ezcater/depletion.ts:24` — live integration and customization read fence.
- `lib/ezcater/pass2.ts:21` — shadow integration, review rows, per-shop graphs.
- `lib/admin/ezcater-review.ts:33` / `:189` — review read/write; `app/admin/catering/ezcater-review/review-client.tsx:148` — customization editor.
- `supabase/migrations/0236_ezcater_customization_map.sql:44` — atomic decision RPC.
- `docs/seed/seed-47-ezcater-customizations.sql:16` — observed provider ID discovery.

Branch: `feat/ezcater-options`. Clone: `C:/Users/conta/co-ops-ezopts`. All changes remain uncommitted.
