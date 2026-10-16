# Landing LCP round — implementation and evidence

Branch: `feat/landing-p1` at `c8563eb8`. Worktree: `C:/Users/conta/co-ops-landing`. All changes are uncommitted. CC approved the plan with the first-paint investigation first. No push, merge, deployment, environment-file change, or migration application; 0273 remains file-only. Final code review belongs to CC.

## What changed

- `scripts/assets/export-hero-sizes.mjs`, three `public/media/crunchy-boi-014-{320,640,960}-<hash>.webp` files, their `assets/provenance/hero-poster-*.json` sidecars, `assets/approved-media.json`, and `config/tenant/landing-assets.json`: hash-verified original photo, full-frame uniform resize and WebP encode only. Outputs are 11,156 / 33,496 / 66,754 bytes. Re-running the exporter reproduced all hashes. The original 750px lineup asset is unchanged. Sharp rounds the 640px derivative to 961px tall; no stretch or crop was introduced.
- `lib/landing/media.ts` and `components/landing/Hero.tsx`: one srcset/sizes contract, 28rem object-contain height cap accounted for, eager/high priority and intrinsic 750×1125 dimensions retained. React's preload API coalesces the explicit hint with its automatic image hint; the prior raw link emitted two preload tags.
- `lighthouserc.cjs`, `scripts/landing/perf-ci.mjs`, `scripts/landing/performance-report.mjs`: opt-in `LANDING_PERF_BLOCK_PIXEL=1` blocks provider routes for measurement only, labels reports `first-party-only-pixel-blocked`, checks recorded block patterns and zero third-party transfer, and keeps the default real-Pixel completion requirement. Old raw files are cleared before copying the current three-run set. No thresholds changed.
- `tests/landing/{hero-poster,performance-blocking,assets}.test.ts`, `tests/e2e/landing/hero-poster.spec.ts`, `scripts/landing/lcp-visibility.mjs`: rendered preload contract, provenance, block validity, no-JS en/es DPR1/2/3 and motion preferences, 320/640/768/1024px geometry, hydration node identity, and reproducible CDP visibility trace.

## First-paint investigation (performed before asset changes)

No Reveal ancestor, initial opacity/visibility mask, transform, clip, or CSS animation was found on the H1/poster chain. SectionView's IntersectionObserver is analytics only. There is no decoding=async attribute. DeferredMotion activates only on scroll, not hydration; the original poster survives hydration in Chromium and WebKit. No-JS browser evidence confirms both elements are visible without hydration. Rounded overflow containment is layout styling, not a reveal.

The production CDP diagnostic uses a cold context, 375×812 DPR1, actual 4× CPU throttling, and local unthrottled networking. It is separate from Lighthouse's simulated mobile timing. In the JS trace the poster LCP is 384ms before and 284ms after; recorded WebP decode is 7.843ms before and 1.770ms after. The H1 is a first-paint candidate at 224ms before. The hero rectangle remains x40/y396/295×442.5 in both states, with every ancestor visible and unanimated. No-JS screenshots and traces are under `tmp/lcp-round/visibility-{before,after}`; extracted evidence is in `docs/qa/landing-lcp-visibility.json`.

The earlier 1,855ms render-delay figure is a simulated Lighthouse breakdown, not an observed 1.855-second hidden interval. Both simulated and observed phase breakdowns are preserved below and in JSON. No font or shop-streaming change is justified by these traces: font-display passes, no render-blocking resource savings are reported, and observed image decode is milliseconds. Shared staff layout/font behavior is untouched.

## Three cold runs per state, before and after

LHCI 0.15.1, production builds, Chromium from Playwright, mobile 375×812 DPR1, simulated RTT150ms / throughput1600Kbps / CPU4×. Each collection clears HTTP cache and seeds only the consent cookie. Fresh before and after sets contain three runs for accepted and unset in each mode. No build or test suite ran during after collection. A short red unit test ran during the fresh before real collection; retain this timing caveat and the run spread rather than treating small differences as causal certainty. The earlier isolated baseline is retained in `docs/qa/landing-lcp-baseline.json`.

| Mode / consent | Before median LCP ms | After median LCP ms | Before bytes | After bytes |
|---|---:|---:|---:|---:|
| real-accepted | 2661.2 | 2521.9 | 293970 | 261072 |
| real-unset | 2683.8 | 2335.6 | 293970 | 261072 |
| blocked-accepted | 2783.6 | 2436.8 | 293970 | 261072 |
| blocked-unset | 2780.9 | 2417.3 | 293970 | 261072 |

| State | Run | LCP ms | Performance | TBT ms | First-party bytes |
|---|---:|---:|---:|---:|---:|
| before-real-accepted | 1 | 3343.2 | 0.9 | 151.0 | 293970 |
| before-real-accepted | 2 | 2605.0 | 0.96 | 73.0 | 293970 |
| before-real-accepted | 3 | 2661.2 | 0.96 | 96.5 | 293970 |
| before-real-unset | 1 | 2797.9 | 0.95 | 85.5 | 293970 |
| before-real-unset | 2 | 2667.7 | 0.96 | 111.5 | 293970 |
| before-real-unset | 3 | 2683.8 | 0.96 | 102.5 | 293970 |
| before-blocked-accepted | 1 | 3219.8 | 0.93 | 83.0 | 293970 |
| before-blocked-accepted | 2 | 2783.6 | 0.94 | 145.0 | 293970 |
| before-blocked-accepted | 3 | 2239.1 | 0.97 | 145.5 | 293970 |
| before-blocked-unset | 1 | 2845.9 | 0.94 | 114.0 | 293970 |
| before-blocked-unset | 2 | 2608.7 | 0.96 | 77.5 | 293970 |
| before-blocked-unset | 3 | 2780.9 | 0.94 | 146.5 | 293970 |
| after-real-accepted | 1 | 2640.1 | 0.96 | 100.0 | 261072 |
| after-real-accepted | 2 | 2480.8 | 0.97 | 114.5 | 261072 |
| after-real-accepted | 3 | 2521.9 | 0.97 | 94.5 | 261072 |
| after-real-unset | 1 | 2672.1 | 0.95 | 121.0 | 261072 |
| after-real-unset | 2 | 2335.6 | 0.98 | 52.5 | 261072 |
| after-real-unset | 3 | 2288.1 | 0.98 | 55.0 | 261072 |
| after-blocked-accepted | 1 | 3173.1 | 0.93 | 81.0 | 261072 |
| after-blocked-accepted | 2 | 2436.8 | 0.97 | 70.0 | 261072 |
| after-blocked-accepted | 3 | 2406.5 | 0.98 | 41.5 | 261072 |
| after-blocked-unset | 1 | 2449.3 | 0.97 | 48.5 | 261072 |
| after-blocked-unset | 2 | 2346.0 | 0.98 | 63.5 | 261072 |
| after-blocked-unset | 3 | 2417.3 | 0.98 | 53.5 | 261072 |

## LCP breakdown (median of each phase, ms)

Phase medians need not sum to the median LCP. Observed timing is from the trace-based lcp-phases-insight; simulated timing is from largest-contentful-paint-element.

| State | Timing | TTFB | Load delay | Load time | Render delay |
|---|---|---:|---:|---:|---:|
| before-real-accepted | simulated | 460.5 | 478.5 | 180.0 | 1654.5 |
| before-real-accepted | observed | 53.0 | 19.0 | 17.0 | 140.8 |
| before-real-unset | simulated | 464.7 | 654.9 | 155.3 | 1475.7 |
| before-real-unset | observed | 60.0 | 54.2 | 15.7 | 167.9 |
| before-blocked-accepted | simulated | 465.1 | 630.0 | 102.7 | 1485.8 |
| before-blocked-accepted | observed | 89.0 | 22.1 | 14.9 | 168.0 |
| before-blocked-unset | simulated | 468.0 | 542.7 | 159.0 | 1526.4 |
| before-blocked-unset | observed | 56.7 | 19.9 | 14.0 | 143.8 |
| after-real-accepted | simulated | 465.1 | 380.0 | 92.2 | 1543.4 |
| after-real-accepted | observed | 54.1 | 29.0 | 9.7 | 152.8 |
| after-real-unset | simulated | 464.5 | 492.1 | 151.3 | 1314.8 |
| after-real-unset | observed | 39.6 | 39.3 | 35.9 | 144.2 |
| after-blocked-accepted | simulated | 465.0 | 799.0 | 123.3 | 1325.7 |
| after-blocked-accepted | observed | 47.3 | 65.1 | 14.5 | 150.1 |
| after-blocked-unset | simulated | 459.7 | 653.4 | 91.6 | 1152.8 |
| after-blocked-unset | observed | 44.4 | 32.9 | 9.6 | 145.4 |

## Verification

| Command | Outcome |
|---|---|
| `node node_modules/vitest/vitest.mjs run tests/landing --maxWorkers=3` | Exit 0; 36 files, 271 tests passed |
| `node node_modules/vitest/vitest.mjs run --maxWorkers=3` | Exit 0; 654 files / 9,912 tests passed; one file / three tests skipped |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Exit 0, including final browser-test additions |
| `node node_modules/next/dist/bin/next build --webpack` | Exit 0; production build |
| `LANDING_E2E_USE_BUILD=1 node node_modules/@playwright/test/cli.js test` | **Exit 0; 187 passed, five existing skips**; Chromium + WebKit, separate production nearby/not-found fixture included |
| `node scripts/assets/inventory.mjs` | Exit 0; 29 assets |
| `node scripts/assets/export-hero-sizes.mjs` (rerun) | Exit 0; all three hashes reproduced from original |
| `git diff --check` | Exit 0 |
| Default `npm.cmd run perf:ci` after | Exit 1: accepted median LCP 2,521.865ms exceeds unchanged 2,499.999ms threshold; real accepted Pixel transfer incomplete. Unset assertions pass. |
| `LANDING_PERF_BLOCK_PIXEL=1 npm.cmd run perf:ci` after | Exit 0; all unchanged LHCI thresholds and blocking-evidence checks pass for both consent states; first-party-only diagnostic |
| Before LHCI, real / blocked | Both exit 1; all three runs per consent state retained, LCP medians over budget; real accepted Pixel incomplete |

The first full-suite attempt failed only the new overly exact 640×960 assertion (actual 640×961); the corrected full rerun is recorded above. The initial LHCI launch could not locate Chrome; explicit CHROME_PATH to the installed Playwright browser resolved it. Commands use cmd /d /c around native processes so their actual exit status is preserved. Existing Git permission / NO_COLOR / fixture lockfile warnings are retained in logs.

Performance invocation uses process-local LANDING_E2E_USE_BUILD=1, LANDING_PERF_NO_SANDBOX=1, CHROME_PATH and LHCI_CLI_PATH (the installed pinned 0.15.1 CLI); the diagnostic mode additionally uses LANDING_PERF_BLOCK_PIXEL=1. None is an env-file or Vercel change. Before collection used node scripts/landing/perf-ci.mjs, equivalent to the npm script.

Logs: `tmp-lcp-{unit-final,full-verified,tsc-final,build,e2e,before-real,before-blocked,after-real,after-blocked}.log`. Raw report paths and every run's metrics are in `docs/qa/landing-lcp-round.json`; raw LHCI reports remain under `tmp/lcp-round/fresh-{before,after}-{real,blocked}`.

## Remaining gates

First-party bytes improved by 32,898 (11.2%). The default performance gate is still failing; do not claim the round meets all launch thresholds. Real accepted Pixel cost remains unmeasured. Blocked diagnostics are first-party-only, never a replacement for successful real-provider measurement. Final CC implementation review remains outstanding. No speculative shared font or streaming change was made to chase run noise.
