# Chunk 7 review fixes — separate uncommitted change set

> Custody (corrected by CC 2026-10-16, Aggie chunk-8 P2-1): these changes are COMMITTED in 8355d7d3 on feat/catalog-p4a; the frozen revision's full suite is 10,423 passed (the 10,421 figure was the pre-credential-isolation tree).

Base: `35748f42`; branch `feat/catalog-p4a`. This set precedes chunk-8 concurrency/release additions. No commit, fetch, push or merge.

| Review item | Change and regression evidence |
| --- | --- |
| P2-1 | `tests/i18n-encoding.test.ts` checks every Spanish value for equal `?`/`¿` counts, retains U+FFFD checks, and explicitly covers `est? disponible` and `cambi?.`. |
| P3-1 | `lib/catalog/error-log.ts`, `job-http.ts`, `new-item.ts`: one safe class/message diagnostic on unexpected failures. The message is fixed and raw exception text is redacted because it can contain SQL/PII. HTTP and setup tests pin logging and generic client bodies. Per-day setup refusals include existing-key-checked `messageKey`. |
| P3-2 | All nine chunk-7 write routes call `assertSameOrigin` before session/body work. Parameterized behavior tests exercise every route's cross-origin refusal and verify no session or step-up call. Older catalog writes' family-wide origin policy remains a 4b item. |
| P3-3 | `tests/swap-vendor.test.ts` exercises Back's library authority against a live swap: below-floor and social-media actors fail; foreign-shop lookup is 404 `swap_not_found`. These newly pin existing behavior. |
| P3-4 | `uuidList` caps arrays at 500. The boundary test accepts 500 and rejects 501; a share route returns named 400 without calling the engine. |
| P3-5/P3-6 | Release packet records sandwich `name_taken` retry reconciliation, swap preview recomputation cost and oversized internal snapshot DTO. Freshness recomputation is retained. |
| P3-7 | Chunk-7 handoff now describes commits `712a57c3`/`35748f42` and names Aggie's reproducible 25-file/600-test selection. The unsupported 602 count is withdrawn. |

CC already resolved P2-2 by committing AGENTS.md in `35748f42`.

## Verification

Test-first route run exposed 11 failures: nine absent origin guards, missing logging and absent UUID cap. Final focused verification passed **4 files / 164 tests, zero failures**, exit 0:

```powershell
npx.cmd vitest run tests/i18n-encoding.test.ts tests/catalog-job-http-routes.test.ts tests/swap-vendor.test.ts tests/new-item.test.ts --pool=threads --no-cache --maxWorkers=1
git diff --check
```

The full chunk-8 verification supersedes this focused result. Changes are reviewable separately by the nine route files, shared HTTP helper, new-item library, diagnostic helper, four tests and the historical handoff correction. Concurrency, preflight and 0266 files are the second change set.
