# Landing merge-gate and P3 round

Custody: `feat/landing-p1`, HEAD/base `21eeedde`, dedicated clone `C:/Users/conta/co-ops-landing`. Clean at intake; this round remains UNCOMMITTED. No push, merge, deployment, environment-file change or production write. Migration 0273 remains unchanged and file-only. CC's supplied rulings are the implementation contract; final review remains with CC.

## Changes and contracts

- `lighthouserc.cjs`, `scripts/landing/perf-ci.mjs`, `perf-consent.cjs`, `performance-report.mjs`, `package.json`, and `landing-checks.yml`: default merge gate measures UNSET and ACCEPTED with provider requests blocked only in Lighthouse's browser. Performance >=0.85, LCP <2500 ms, TBT <=200 ms and first-party <=500,000 bytes remain unchanged. Existing accessibility and CLS assertions remain unchanged too. The report checker independently rejects metric regressions. Each invocation archives raw LHRs and summaries in a timestamp/mode/UUID directory.
- `npm run perf:launch` requires process-local `LANDING_PERF_URL` pointing to the real HTTPS preview, seeds accepted consent there, starts no local fixture server, and measures real Pixel traffic. It records page TBT, third-party blocking attribution (null if unavailable), and transfer bytes. Completed real SDK traffic is required; budget failure does not erase successfully measured third-party evidence. This is a release/spend gate, not CI.
- `app/error.tsx` and `app/global-error.tsx` use the already allowed SVG wordmark. `app/eat/page.tsx` and `app/not-found.tsx` mark their wordmarks lazy so the hero is the only image preload. Next serializes the inactive not-found fallback and otherwise emits its wordmark preload too. Boundary routing, fallback SSR and full-page browser tests cover these contracts.
- Asset exporters, inventory enforcement, approved-media records and sidecars: full-frame derivatives use `resize-only`; EXIF auto-orientation is explicit. Sidecar source paths use source IDs or repository-relative paths; the source manifest resolves local masters. Existing richer SUBDEX provenance is retained. The hero derivatives reproduce identical bytes; no food image was regenerated or altered.
- Six custody headers, release packet and checklist distinguish this round from prior committed work. Ordinary order-probe 4xx is pinned as review-required, not pause-required; hard failure rules are unchanged.

## Validation

TDD: the initial targeted run failed on the old boundary assets, derivation mode/source metadata, missing budget checks and unguarded blocking configuration. Ordinary 4xx tests passed immediately, pinning existing behavior. A separate third-party attribution test failed before implementation. The first full-suite run picked up that red test (1 failed / 9,925 passed / 3 skipped); it is superseded by the final run below.

The first production browser run had 187 passed / 5 skipped / 2 failed: the new preload test found the hidden fallback's wordmark in both engines. An SSR regression test reproduced it before the fallback fix. The boundary asset test's source parser was also corrected to allow attributes before `src`. Final verification below supersedes that run.

Raw logs are local-only under `tmp/round-*`.

| Command | Result |
| --- | --- |
| `npx.cmd vitest run tests/landing --maxWorkers=3` | EXIT 0; 36 files / 286 tests passed, 0 failures. |
| `npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3` | EXIT 0 after the fallback fix; 654 passed / 1 skipped files; 9,927 passed / 3 skipped tests, 0 failures; 268.60 s. |
| `npx.cmd tsc --noEmit --incremental false` | EXIT 0, no diagnostics. |
| `node scripts/assets/inventory.mjs --sources` | EXIT 0; 29 assets verified, including original hashes and raster re-derivation. |
| `node scripts/assets/export-hero-sizes.mjs` | EXIT 0; unchanged 320/640/960px hashes and 11,156 / 33,496 / 66,754 bytes. |
| `node node_modules/next/dist/bin/next build --webpack` | EXIT 0 after the fallback fix; production build including TypeScript and prerendering passed. Initial interrupted build is superseded. |
| `LANDING_E2E_USE_BUILD=1 npx.cmd playwright test` | EXIT 0 after the fallback fix; 189 passed / 5 skipped / 0 failed, 6.3 min. Both engines pass the one-hero-preload assertion. Skips remain the existing WebKit decoder cases, not device proof. |
| `npm.cmd run perf:ci` | EXIT 0; all unchanged LHCI assertions, first-party budgets and consent/blocking checks pass in both states. |

## Merge performance evidence

Three cold runs per state, Lighthouse 12.6.1 / Headless Chrome 153, mobile 375x812, simulated RTT 150 ms / 1600 Kbps / CPU multiplier 4. No other build/test job ran during collection. [Portable six-run summary](qa/landing-merge-performance.json).

| State | Median performance | Median LCP | Median TBT | First-party bytes, every run |
| --- | --- | --- | --- | --- |
| UNSET | 0.97 | 2439.4525 ms | 98 ms | 261068 |
| ACCEPTED, Pixel blocked | 0.98 | 2355.6175 ms | 55 ms | 261068 |

The first LCP run in each state exceeded 2500 ms (2554.0625 / 2544.222 ms); the unchanged three-run median assertions pass. All samples are retained, not filtered. Third-party bytes are zero because this is the blocked merge measurement; real Pixel cost is explicitly unmeasured.

Raw JSON/HTML LHRs and assertions are local-only under `tmp/landing-performance/2026-10-16T18-02-00.778Z-merge-5290f71b/raw-{unset,accepted}/`, three raw LHRs per state. Later invocations use new directories. LHCI printed a Windows cleanup `Access denied` message, but completed all assertions and exited 0; the wrapper's cleanup removed its PID file and all four harness ports were verified closed afterward.

Local reproduction (process-only flags; no environment files or deployment settings changed):

```powershell
$env:CHROME_PATH='C:/Users/conta/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
$env:LANDING_E2E_USE_BUILD='1'
$env:LANDING_PERF_NO_SANDBOX='1'
$env:LHCI_CLI_PATH='C:/Users/conta/AppData/Local/npm-cache/_npx/7c4c7312e9ccc7bf/node_modules/@lhci/cli/src/cli.js'
npm.cmd run perf:ci
```

CI uses pinned LHCI 0.15.1 through npx. The local command uses that existing cached CLI with the completed production build.

## Open release gates

`npm.cmd run perf:launch` currently exits 1: `Launch measurement requires LANDING_PERF_URL: real HTTPS preview`. No actual preview URL was supplied in the dispatch; the existing packet explicitly reserves retrieval to CC. Requested the URL during implementation. Real HTTPS launch numbers are UNMEASURED, not zero. No local run substitutes for this gate.

Real devices, merchant branch/serving-option inspection, Pixel/AEM/Test Events, optional CAPI/WAF and counter activation, monitoring baseline/US runner/alert receipt, production environment/DNS and indexing decisions remain open as listed in `release-checklist.md`.
