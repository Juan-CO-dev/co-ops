# ezCater customization effects — implementation plan

CC pre-approved this bounded build in the dispatch. Branch `feat/ezcater-options`, dedicated clone `C:/Users/conta/co-ops-ezopts`; no git writes, deployment, or production access.

## Confirmed contracts

- `lib/ezcater/pass2-shared.ts`: item identity is menu size plus sorted customization ID/quantity pairs. Provider item UUID identifies an order line, not a reusable menu identity.
- `lib/ezcater/depletion.ts`: live source counting excludes reconciled Toast checks, uses per-location graphs and D-1/transfer production evidence. A reviewed item previously discarded all customization meaning.
- `lib/ezcater/pass2.ts`: transactional shadow publication already accepts review rows; its graph was global.
- `lib/toast/modifiers-shared.ts`, `lib/toast/platter-shared.ts`, migration 0226: reusable effect resolution and package pick binding/cap; choice quantity differs from depletion quantity.
- `lib/admin/ezcater-review.ts`, review route/client, migrations 0225/0227/0229: fresh reviewer authorization, Tier-B step-up, service-only atomic writers, append-only audit evidence.
- `lib/ezcater/orders-shared.ts`: options store separate `name` and `typeName`, provider `customizationId`, and explicit selected `quantity`.

## Build sequence

1. Add 0236: shop/provider-ID customization maps, JSON effect snapshots with Toast effect semantics or a package pick target, atomic validation/decision RPC, queue concurrency guard and deny-all RLS/service-only ACLs.
2. Add a pure customization resolver and bounded context loader. Reuse Toast effect and package allocation functions; share the resolver between live/shadow paths; cache shadow graphs per shop.
3. Extend the existing review page with collapsed customization rows, multi-effect/portion/parent-only authoring, package picks and ignore; preserve authorization/step-up and ship en/es together.
4. Add guarded seed 47 deriving provider IDs from persisted current snapshots, exact known option names/types and reviewed target/portion evidence. Ship a transactional SQL harness ending in rollback. CC executes SQL; this build does not.
5. Verify pure effects, package capacities, live linked-check suppression, shadow review publication, API/lib validation, then `npm.cmd test` and `npm.cmd run typecheck`.

## Risks and deployment contract

- Selected option counts are line totals, never multiplied by the parent line count. Missing/invalid quantities refuse counting for that line.
- Unmapped customizations refuse the line and mark coverage degraded; they do not restore the linked Toast check or silently count the base. Apply/review migration and seed before deploying with counting enabled.
- Package picks spend `depletion_qty / quantity` per selected pick; excess is capped and disclosed. Unbound picks refuse the package.
- A package-level removal lacks an individual parent association in the flat provider option shape. Such a combination is explicitly unresolved instead of guessing which sub loses an ingredient.
- Live reads fence concurrent customization changes. SQL runtime/grant behavior and production-shaped seed identity discovery remain CC's sim/dry-run gates; no SQL execution is claimed here.
