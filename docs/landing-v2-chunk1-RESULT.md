# LANDING v2 — Chunk 1 result

Scope: approved BUILD r2, Chunk 1 only. Branch `feat/landing-v2`, baseline HEAD `460d28b8ef4a28879419246462be7d39256edc87`, worktree `C:/Users/conta/co-ops-landing`. Changes remain UNCOMMITTED. No push, merge, deployment, migration, environment-file or database change.

## Changes

- `scripts/assets/export-landing-v2.mjs`: finite exporter, original-source hash checks before encoding and again before writes; EXIF orientation, uniform full-frame resize, deterministic WebP q78/q86 effort 6. No AI, retouch, recolor or crop of these eleven photos.
- `scripts/assets/inventory.mjs`: separate real-photo detail admission; pinned source IDs/hashes/paths; duplicate identity and classification rejection; exact per-ID quality/width/load/byte ceilings; validated crop mode with oriented coordinates, encoder metadata and deterministic reconstruction. Existing SUBDEX source/cut/extraction pins retained.
- `assets/source-manifest.json`: P013/P016/L083 in `photoDetails`; products remain 11 identities / 10 eligible. Numeric `013` remains refused.
- `assets/approved-media.json`, `config/tenant/landing-assets.json`, eleven `assets/provenance/v2-*.json`, eleven `public/media/v2-*.webp`: registered assets, sidecars and portable runtime ID/path/dimensions. Page composition and image selection are unchanged.
- `tests/landing/v2-assets.test.ts`, `tests/landing/assets.test.ts`, `tests/landing/cache-inventory.test.ts`: tests described below.
- This report and `docs/landing-v2-build-results.md` record evidence and remaining gates.

The only additional implementation file beyond Chunk 1's explicit list is `tests/landing/cache-inventory.test.ts`. The first landing run proved its product-only source lookup rejected the newly approved detail sources. Its lookup now includes `photoDetails` for real-photo entries, retaining every eligibility/hold/identity/hash assertion. This is required integration coverage, not a new asset family.

## Asset evidence

All eleven encoded sizes exactly match r2's measurements. Sharp 0.34.5 / libvips 8.17.3 / WebP 1.6.0. Sources are 2667×4000. The 480w outputs are 480×721: Sharp's JPEG shrink-on-load differs by one pixel from the rounded ideal height (720); the exact approved pipeline and measured bytes are preserved.

| ID | Quality | Bytes | Ceiling |
|---|---:|---:|---:|
| v2-p013-320 | 78 | 16,744 | 20,000 |
| v2-p013-480 | 78 | 30,088 | 35,000 |
| v2-p013-640 | 78 | 46,798 | 50,000 |
| v2-p013-960 | 78 | 84,742 | 90,000 |
| v2-p013-1280 | 78 | 130,616 | 140,000 |
| v2-p016-480 | 86 | 67,070 | 70,000 |
| v2-p016-720 | 86 | 127,440 | 135,000 |
| v2-p016-960 | 86 | 196,008 | 205,000 |
| v2-l083-480 | 86 | 96,506 | 100,000 |
| v2-l083-720 | 86 | 172,414 | 180,000 |
| v2-l083-960 | 86 | 260,624 | 270,000 |

Astra visually inspected all eleven output images and all three originals at mobile/desktop candidate sizes: framing, bread/ingredient geometry and source composition preserved; no added marks or text. Sidecars record that bounded asset QA verdict; this is not CC's final approval or a browser-layout verdict. Source checks rederive all raster outputs and verify originals, including the existing SUBDEX extraction loop. Local evidence is in ignored `tmp/landing-v2/`.

## Every changed or added assertion

Existing assertion changes:

1. `assets.test.ts`: crop mode without a recipe still throws, now specifically `Invalid crop recipe`; added the positive case with complete integer crop/oriented dimensions/steps/tool/effort metadata. The former blanket prohibition is intentionally relaxed only for valid recipes.
2. `cache-inventory.test.ts`: the source lookup used by the existing eligible/hold/confirmedIds/hash/sourcePath assertions now includes real-photo details. No assertion was removed; real-edited entries still consult products only.

New `v2-assets.test.ts` assertions:

1. A synthetic, non-food EXIF-6 JPEG reconstructs exactly after orientation → integer crop → uniform resize → WebP. One asset passes `checkAssets(...,{sources:true})`.
2. Sidecar-only changes to crop, oriented dimensions, quality, steps, encoder version or output width are refused.
3. Consistent but changed crop fails source reconstruction; wrong oriented dimensions fail source validation; wrong output height fails decoded-dimension validation.
4. Source-hash substitution, source-path substitution, drawn relabeling, numeric `013`, held source, changed output bytes and changed original bytes are refused.
5. Valid crop passes; missing/empty/fractional/negative/out-of-bounds/zero-extent crops, stretched output, enlargement and missing oriented dimensions fail. Missing encoder metadata, wrong effort and missing steps fail.
6. Product counts remain 11/10; detail identities are exactly P013/P016/L083. Their class is real-photo; drawn/brand/real-edited requests, held/ineligible/wrong-class/hash/path detail records and duplicate identities fail. Unknown sources, numeric `013`, held `018` and relabeling product `014` as drawn fail.
7. Exactly eleven v2 entries exist. Every measured byte count and exact ceiling is pinned to the r2 table; source ID, mode, classification, width, quality and initial/lazy declaration are pinned.
8. Filename equals ID plus final hash prefix; sidecar equals approved record; decoded dimensions equal declared dimensions; aspect is within one pixel of the rounded ideal; runtime record is exactly ID/path/width/height.
9. Every approved entry validates; extra maxBytes, oversized bytes, changed quality/source/load, and an unrelated ID borrowing a larger ceiling fail.
10. BUILD retains the 818,778-byte figure explicitly as a prototype experiment, not an application score.

No performance threshold, timeout, run count, consent policy, Pixel blocking rule, product-count assertion or SUBDEX pin changed.

## Verification

Initial tests-first run: three new tests failed as expected (crop rejected, photoDetails absent, zero v2 outputs). Additional crop-metadata red test failed before the completeness guard was added. Logs: `chunk1-red.log`, `chunk1-crop-metadata-red.log`.

First landing run: 298 passed / 2 failed. The product-only inventory assertion was corrected as above. The separate `performance-blocking.test.ts` repository scan exceeded its unchanged 30 s timeout under local load. A subsequent run passed all 300 tests; no timeout was raised.

| Command | Outcome |
|---|---|
| `npm.cmd test -- tests/landing --maxWorkers=1` | PASS: 37 files / 300 tests, 17.65 s, after final crop metadata guard. |
| `npm.cmd run assets:check` | PASS: 40 assets. |
| `npm.cmd run assets:check -- --sources` | PASS: 40 assets; final log `chunk1-sources-final.log`. |
| `node node_modules/next/dist/bin/next typegen` | PASS, route types generated. |
| `npm.cmd run typecheck` (`tsc --noEmit`) | PASS, no diagnostics. |
| `npm.cmd run build` | PASS, production build and type validation. |
| `npm.cmd test -- --maxWorkers=3` | EXIT 1: 745 files passed / 2 failed / 1 skipped; 12,135 tests passed / 2 failed / 3 skipped; 375.69 s. |
| `npm.cmd run test:e2e` with process-local `LANDING_E2E_USE_BUILD=1` | EXIT 1: 181 passed / 8 failed / 5 skipped, 22.6 min; existing Chromium + WebKit projects. |
| `npm.cmd run perf:ci` with the pinned cached CLI | EXIT 1: five runs per state completed; both median TBT gates failed. Details below. |
| `git diff --check` | PASS. |

Known tsx ENOMEM spawns, listed separately (both full-suite failures):

- `tests/people-chunkE-review.test.ts:130`, no-database BOH dry-run startup test.
- `tests/pm-criteria.test.ts:140`, no-database seed dry-run startup test.

Both subprocesses fail before the expected credential-validation exit, inside tsx's temporary-directory module:

```text
SystemError [ERR_SYSTEM_ERROR]: A system error occurred:
uv_os_get_passwd returned ENOMEM (not enough memory)
node_modules/tsx/dist/temporary-directory-CwHp0_NW.mjs:1:84
```

No test was skipped, weakened or retried to hide these full-suite failures. Logs: `tmp/landing-v2/chunk1-{landing-final,assets,sources-final,typegen,tsc,build,full,e2e}.log`.

Browser failures are separate unresolved findings, **not** classified as the known tsx ENOMEM spawns:

| Project / cases | Observed failure |
|---|---|
| Chromium accessibility: initial, settings open, accepted (3) | `page.goto` exceeded 60,000 ms waiting for `load`; these cases did not reach an axe verdict. |
| Chromium cache (1) | Test exceeded its unchanged 30,000 ms timeout. |
| WebKit tracking dedup (1) | `#landing-meta-pixel`: expected count 1, received 0 after 5,000 ms. |
| WebKit poster hydration (1) | Privacy settings `aria-expanded`: expected `false`, received `true` after 5,000 ms. |
| WebKit lineup, JS true / false (2) | Each exceeded the unchanged 30,000 ms timeout. |

Traces, screenshots and error contexts are retained under `test-results/`; HTML report is `playwright-report/index.html`. No timeout or browser assertion was changed. The separate nearby/not-found fixture compiled successfully before execution. Application/consent/tracking implementation is unchanged in this chunk; the cause of these browser failures has not been established, and a clean browser gate is not claimed.

## Performance and remaining gates

Cached pinned CLI: `C:/Users/conta/AppData/Local/npm-cache/_npx/7c4c7312e9ccc7bf/node_modules/@lhci/cli/src/cli.js` via `LHCI_CLI_PATH`; supplied Chromium 1243; existing merge harness with Pixel blocked only for measurement, five cold runs per consent state.

Initial unchanged-page advisory baseline: command EXIT 0, both states `failures: []`, first-party transfer 283,693 B on every run. UNSET median performance 0.97 / LCP 1943.64 ms / TBT 135.5 ms. ACCEPTED 0.97 / 1970.072 ms / 152 ms. All runs retained, including individual slow samples; no sample discarded. Console: `tmp/landing-v2/chunk1-baseline-perf.log`; raw evidence: `tmp/landing-performance/2026-10-17T01-53-36.551Z-merge-bbe9c6fb`.

Final advisory run against the completed build: **command EXIT 1**, not a pass. All ten cold measurements completed and were preserved. Both state summaries have `failures: ["tbt"]`; both raw `assertion-results.json` files contain a failing `total-blocking-time <= 200` assertion. The console also reports Windows `ERROR: Access denied` after collection; the TBT assertion failures independently make this a failed run. No claim that cleanup is the sole failure.

| State | Runs | Median performance | Median LCP (ms) | Median TBT (ms) | Median accessibility | Median CLS | First-party bytes, every run |
|---|---:|---:|---:|---:|---:|---:|---:|
| UNSET | 5 | 0.92 | 2163.7925 | **331 — FAIL** | 1.00 | 0 | 283,691 |
| ACCEPTED | 5 | 0.87 | 2021.756 | **427.5 — FAIL** | 1.00 | 0 | 283,691 |

Final evidence: `tmp/landing-performance/2026-10-17T02-47-47.003Z-merge-aa92d469/{unset,accepted}.json`, both `raw-*` directories, and `tmp/landing-v2/chunk1-final-perf.log`. UNSET TBT samples: 451.39, 331, 358.72, 143.5, 176 ms. ACCEPTED: 427.5, 720, 427.433, 388, 484.765 ms. No sample was discarded, no threshold was changed, and no registry failure was substituted for a score. The performance difference from the baseline is observed but its cause is not established. These are unchanged-page first-party-only measurements, not real-Pixel launch evidence or the prototype's 818,778 B figure.

CI is authoritative. No branch CI for this uncommitted revision was submitted or claimed; CC must arrange it before advancement. No Chunk 2 work. Registry failure is NOT a score. Cross-family implementation review, CC approval and resolution of the browser verification failures remain handoff gates. Browser responsive selection/preload/timing for the new assets belongs to the later page integration; these registered assets are not yet requested by the unchanged page. Tracked implementation diff and new-file inventory are archived at `tmp/landing-v2/chunk1-tracked.patch` and `tmp/landing-v2/chunk1-new-files.txt`.
