# Wave 1 verification and handoff — 2026-09-18

Branch: `feat/vendor-export-diff`. Clone: `C:/Users/conta/co-ops-astra`.

Implementation and artifacts are complete for offline review. **No commits were possible**: `git add` and `git commit` both failed because this session's filesystem policy makes `.git` read-only:

```text
fatal: Unable to create 'C:/Users/conta/co-ops-astra/.git/index.lock': Permission denied
```

All added files remain untracked in this clone. No existing tracked file was modified. No other checkout was written, and no network, migration, prod read/write, push, merge or deployment was used. CC must stage and commit from an environment allowed to write this clone's Git metadata. Cross-family review remains pending as scheduled by the task.

## Checks actually run

| Command/check | Outcome |
| --- | --- |
| Independent PowerShell `ConvertFrom-Csv` count, filtering numeric Product Number | 97 history; 84 Izzy; 58 Opening; 14 managed; 20 Paper. |
| Plain installed `tsx.cmd .../normalize.ts` | Failed before loading project code: Windows `uv_os_get_passwd` ENOMEM. The process-local launcher documented in scripts README succeeded; no dependency/config edits. |
| Installed tsx hook, normalize + diff CLI (README launcher) | 273 observations, 115 distinct items, 90 recent; both commands completed offline. |
| `node_modules/.bin/vitest.cmd run tests/vendor-exports-parsers.test.ts tests/vendor-exports-diff.test.ts` | 2 files, 33 tests passed. |
| `npm.cmd test` — full suite, run once after code completion | **177 files passed; 3,385 tests passed; exit 0** (18.29 seconds). |
| `node_modules/.bin/tsc.cmd --noEmit --incremental false --pretty false` | Passed, no diagnostics. |
| `node_modules/.bin/eslint.cmd scripts/vendor-exports tests/vendor-exports-parsers.test.ts tests/vendor-exports-diff.test.ts` | Passed, no diagnostics. |
| SHA-256 before/after a second diff CLI execution | Five normalized JSONs and the Markdown report were byte-identical. |
| Citation test | Every report table data row cites existing source files and nonblank physical lines. |
| `git diff --check`; `git status --short` | No tracked changes; only new files inside the authorized scope. Git's diff check does not inspect untracked files. |

No Next build was run: this wave changes only offline scripts/tests/docs; full unit suite, full typecheck and scoped lint passed. Future application changes still require the normal PR build gate.

## Findings and unresolved evidence

1. Izzy MAIN is the strongest live-list candidate: 73/90 recent item numbers (81.11%), recent Jaccard 0.7228. Laminate remains sequence law.
2. 439686 is cooked eggs. Shell-egg candidate 517879 was bought more recently than 517842. Both existing egg guide lines were unresolved in seed 37; CC must revisit V3-A's earlier repeat explanation.
3. Dried Chives is the single unresolved guide gap. The laminate says fresh chives, but whether it is the same operational line remains Juan's decision. Tuna, Saratoga and employee water have description-only candidates for their unmatched printed numbers.
4. Six recent item numbers have no PFG catalog name/family candidate: two vinegars, two strawberry packs, mint and multifold towels. Seventeen guide lines have multiple export item-number candidates. These are review hypotheses, not approved substitutions or proof of SKU absence.
5. The readiness snapshot lacks item numbers, prices, pack/UOM and SKU location bindings. Definitive catalog identity and numerical price/pack comparisons cannot be completed from these inputs. Last Purchase is not total 60-day volume; Dupont account 56910015 does not establish Capitol Hill pricing/account scope.

The draft design ends with eight floor-answerable questions. Review entry points: `scripts/vendor-exports/README.md`, `reports/2026-09-18-pfg-diff.md`, and `docs/superpowers/specs/2026-09-18-vendor-ordering-v3c-import-design.md`.

Suggested commit boundaries once Git writes are available: (1) parser/adapter/normalizer + generated JSON + parser tests + plan; (2) pure diff/CLI + report + diff tests; (3) draft design + usage/verification handoff. These are proposed commit messages, not existing commits.
