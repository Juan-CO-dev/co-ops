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
