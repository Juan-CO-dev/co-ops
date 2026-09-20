# Seed 38 review verification — 2026-09-20

Branch: `feat/seed38-catalog-repair`. Clone: `C:/Users/conta/co-ops-astra`.
Offline only; no credentials, network, commits, seed execution, or production access.

## Checker execution

Normal CLI command:

```powershell
.\node_modules\.bin\tsx.cmd scripts/vendor-exports/review-check.ts
```

This environment failed before loading the checker:

```text
SystemError [ERR_SYSTEM_ERROR]: uv_os_get_passwd returned ENOMEM (not enough memory)
Node.js v22.20.0
```

`node --import tsx` failed the same way. The checked-in validator was then run successfully using the already-installed TypeScript compiler in memory. This bypasses the tsx launcher, creates no files, and invokes the same `checkReview` and `formatReviewCounts` exports:

```powershell
@'
const fs = require('node:fs');
const ts = require('typescript');
const options = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } };
const dataUrl = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const parserUrl = dataUrl(ts.transpileModule(fs.readFileSync('scripts/vendor-exports/parsers.ts', 'utf8'), options).outputText);
const checker = ts.transpileModule(fs.readFileSync('scripts/vendor-exports/review-check.ts', 'utf8'), options).outputText.replace('"./parsers"', JSON.stringify(parserUrl));
import(dataUrl(checker)).then(mod => {
  const csv = fs.readFileSync('docs/seed/source/vendor-exports/review/seed38-review.csv', 'utf8');
  const catalog = JSON.parse(fs.readFileSync('docs/seed/source/vendor-exports/context/catalog-prod-2026-09-19.json', 'utf8'));
  console.log(mod.formatReviewCounts(mod.checkReview(csv, catalog)));
}).catch(e => { console.error(e.message); process.exitCode = 1; });
'@ | node
```

```text
dedupe_level: 55
price_conflict: 8
price_basis: 92
item_number: 68
vendor_merge: 29
guide_absent: 41
needs_juan: 74
total: 293
```

Counts describe review rows, including no-ops, held proposals, inventories and absence reviews; they are not production mutation counts. The additional item_number row is the explicit existing Eggs-line amendment. Only VM-001 has `needs_juan=true` within the vendor merge section. No basis value or confidence label is execution approval.

## Tests

```powershell
npm.cmd test -- tests/vendor-exports-review-check.test.ts
npm.cmd test
```

```text
Targeted: 1 test file passed, 1 test passed.
Full suite: 182 test files passed, 3430 tests passed (22.18s).
```

`node node_modules/typescript/bin/tsc --noEmit` also passed (exit 0, no diagnostics).
`git diff --check` passed; all deliverable files are new/untracked for CC to review and commit.

The single checker fixture covers quoted/multiline CSV, unknown kinds and identifiers, wrong-table IDs, ownership, malformed fields, and the narrow unlinked-Eggs exception. `npm.cmd` bypasses PowerShell's blocked `npm.ps1` launcher. The test suite's pass does not adjudicate receipt matches or seed writes.

## Data checks

An independent read-only Python check compared CSV SKU/guide membership sets against the complete JSON export, checked each cited file and physical line, and hashed the final CSV:

```text
Coverage PASS: 55 duplicate-history SKUs; 92 priced SKUs;
67 numberless guide lines; all 27 Boar's Head members.
Citation PASS: 894 distinct existing file/line references;
every row cites a report or normalized source.
Active duplicate ordinal groups: 0
CSV SHA256: 532039a33c13042d427858313dc81da8ab582f50c0f381b878f253efe3a6f3f4
```

The source has 28 conflicting historical pack groups, all already unique on active ordinals. Historical duplicate rows and all price history remain intact. Review considerations: BC-009 (inactive history versus live chains), BC-007 (future coupled writes), and BC-001 (identifier existence plus ownership, applied to the checker). This is author verification, not CC's required cross-family review.

## Five least-certain decisions

- **DL-040 / Oregano:** 80-oz historical source matches the export; active 96-oz/$4.50 does not. Whole-chain and price decisions are coupled.
- **PB-080 / Ricotta:** $34.10 implies two 5-lb tubs; `per_each` cannot alone express that factor.
- **PB-071 / Onion Powder:** $6.65 implies a pound, but the active purchase root is 80 oz.
- **IN-008 / Baldor Lettuce:** ICE1 is iceberg, but the generic guide name and 15-head catalog pack do not establish a match to 24 heads.
- **IN-045 / Utz Ripples:** Thompson 27149 matches the pack, but catalog ownership is Country Snacks; the vendor identity must be resolved first.
