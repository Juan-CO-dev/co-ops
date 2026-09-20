# V3-C-2 verification

Files: `lib/vendor-import-shared/**`, `lib/vendor-import.ts`, script model/parser/adapter re-exports, `0211_vendor_import.sql`, three import routes, both audit registries, moved parser test, matcher/reconcile/routes tests, this file. Tasks 7–9 untouched. Branch `feat/v3c-2-importer`; workspace `C:/Users/conta/co-ops-astra`; uncommitted.

Tests added: matcher 31, reconcile 12, routes 30 (**73**); missing-module RED witnessed before implementation. Targeted gates pass. TypeScript/eslint clean. Full suite: **3,539 passed, 1 failed**: `step-up-tier-map.test.ts` needs the new apply-route `A` entry; outside allowlist, permission pending.

Pack decision: atomic whole-chain versioning and SQL mirror derivation; `non_atomic: []`. Migration unapplied; CC owns sim/runtime verification.

[ASSUMPTION] Ordinal source rows retain physical citations; decisions use `row:kind`; snapshots are companion records; digest is asynchronous browser SHA256; vendor UUID binding is explicit. Unknown/stale/conflicting evidence and duplicate operations refuse. Same-row pack/price pairs use the returned alternate root price (`price_depends_on_pack`); multi-level pack changes require human review. Atomic staging RPC prevents partial batches. Receipt files filter to target vendor; MOXe account uses vendor metadata, not fixture metadata. SKU links target the existing catalog. GET floor=7; origin-less reads allowed, explicit cross-site requests refused. Unchanged files return their original batch, including stale/applied batches.

Verification commands (PowerShell `.cmd` avoids execution-policy restrictions):

```powershell
npx.cmd vitest run tests/vendor-import-parsers.test.ts tests/vendor-exports-diff.test.ts tests/vendor-exports-waves-diff.test.ts tests/seed38-manifest.test.ts tests/seed38-execution.test.ts
npx.cmd vitest run tests/vendor-import-match.test.ts tests/vendor-import-reconcile.test.ts
npx.cmd vitest run tests/vendor-import-routes.test.ts
npx.cmd vitest run tests/vendor-import-match.test.ts tests/vendor-import-reconcile.test.ts tests/vendor-import-routes.test.ts
npm.cmd test
npx.cmd tsc --noEmit
npx.cmd eslint "lib/vendor-import-shared/**/*.ts" lib/vendor-import.ts lib/audit-actions.ts lib/destructive-actions.ts "scripts/vendor-exports/{model,parsers}.ts" "scripts/vendor-exports/adapters/*.ts" "app/api/admin/vendors/*/import/**/*.ts" "tests/vendor-import-*.test.ts"
git diff --check
node --import tsx scripts/vendor-exports/diff.ts
```

Direct regeneration fails `uv_os_get_passwd ENOMEM`; normalizer also wrongly includes existing `review/`. This in-memory workaround succeeds without out-of-scope edits:

```powershell
node -e "require('node:os').userInfo=()=>({username:process.env.USERNAME});const fs=require('node:fs');const read=fs.readdirSync;fs.readdirSync=function(p,o){const entries=read.call(this,p,o);return String(p).replaceAll(String.fromCharCode(92),'/').endsWith('/docs/seed/source/vendor-exports')?entries.filter(e=>(typeof e==='string'?e:e.name)!=='review'):entries};const { require:tsxRequire }=require('tsx/cjs/api');console.log(tsxRequire('./scripts/vendor-exports/diff.ts',process.cwd()+'/runner.cjs').writeReports())"
Get-FileHash docs/seed/source/vendor-exports/reports/2026-09-19-*.md -Algorithm SHA256 | Select-Object Hash,Path | ConvertTo-Json
```

SHA256 before **and** after, identical (all filenames prefixed `2026-09-19-`):

| Report | Before = After |
|---|---|
| catalog-join.md | E134E9EF7A77B668FE2D7F9B9D3FC61D90416088905924E7C7EEEC56B44274A6 |
| pfg-diff.md | 21B86D67D77F946D37BF75766514317F0251CA47EA61DB615BAABCBC59D81EA9 |
| receipts-diff.md | F333915F8392F468208EFD717628B0872FA9755E6C492F01BCD85B53FD355F76 |
| usfoods-diff.md | 9C3D04B674B70F0071D5FCBAE5FEC19D8EA3474640FB570E7D44F007C27AAF0C |

## CC R0 + sim rehearsal (2026-09-20, CC)

R0 fixes on Astra's tasks 1–6 (commit 7920b6e): 0211 keys uniqueness on **staged** batches only (partial unique index; ON CONFLICT + lookup carry the predicate) and the lib retires a batch to `superseded` on the RPC's `stale_before_state`, so the same file can be re-staged instead of 409ing forever; `invalid_price` → 409, `forbidden` → 403, `batch_not_found` → 404 (were 500); the apply route pinned as Tier A in `tests/step-up-tier-map.test.ts`.

Task 7 (Astra, commit d31e13f): BOMs stripped from the two new files, cents rounded before `formatCents`, `aria-label` on the file input; `next build` exit 0 with network.

**Rehearsal catch (commit f209d03):** the first sim run proposed Butter 2.25 → 80.30 and Kosher Salt 6.98 → 62.83. `priceAtRoot` priced one root (the 36 lb case) while `vendor_items.unit_price` is per the SKU's `price_basis` (per each = the pound, seed 38). Four of five "price changed" rows and all three "pack changed" rows were that artifact (`packComparison` scaled the vendor contents by the basis and proposed shrinking Butter's root to 16 oz). Fixed: a proposal is dollars for ONE unit of the declared basis (per_case/per_bundle = root, per_each = the vendor's each, per_lb = 16 oz, per_dozen = 12); pack comparison is basis-independent.

Sim rehearsal after the fix (`scripts/sim/rehearsals/2026-09-20-v3c2-vendor-import.ts`; sim restored cold-empty from the 2026-09-20 06:22Z prod config snapshot, post seed 38; 0211 applied to the sim; run 0a119994):

| Step | Result |
|---|---|
| Stage `list-izzy-main-2026-09-18.csv` on PFG | batch `34a98aa3`, 84 rows → 84 observations: noop 20 · price 2 · needs_person 62 (no_match 15 · price_basis_unresolved 36 · pack_dimension_mismatch 8 · duplicate_item_number 2 · per_lb_on_count_root 1); default plan 2 ops |
| The two moves | Butter 1051772: 2.25 → 2.23 per each · Powdered sugar 913783: 33.51 → 33.04 |
| Stage again | same batch id, same digest |
| Human edits Butter's price under the staged batch, apply both | `409 stale_before_state`, batch → `superseded`, zero `vendor_import` price rows |
| Stage again | new batch `e77c6ec1`; Butter now `needs_person / stale_price_evidence`; price 1 |
| Apply the sugar move | one `sku.price_supersede`, `non_atomic: []`, read-back 33.04 @ 2026-09-18 `source=vendor_import` |
| Replay same digest | identical stored result, no new rows |
| Audit | `vendor.import_staged` ×2 batches; per batch `sku.price_supersede` + `vendor.import_applied` |
| Stage a third time | fresh batch, noop 21, default plan 0 ops (an applied batch never blocks re-staging) |

Harness: `fixtures/manifest.json` 147 → 150 tables (the three 0211 tables are HISTORY), private `schema-meta.json` +3 tables / +7 FKs, `tests/sim-fixtures.test.ts` pins 150 / 389; claim `admin.vendor_import.stage-review-apply` (manager guide § Ordering 8, revision f33a8be) + the journey leg in `journeys/ordering-receiving.spec.ts` (GM stages via multipart, pinned counts, same file twice, employee 403, GM apply 403 — the sim roster has no level-9 persona, so the apply write is the rehearsal above).
