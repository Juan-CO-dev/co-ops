# Landing CI LCP investigation

Base: `ac4171f3`, branch `feat/landing-p1`, clone `C:/Users/conta/co-ops-landing`. Application code, image bytes, environment files, workflow, and Lighthouse budgets are unchanged. No commit, push, merge, deployment, or production write.

## CI evidence

Source: the six supplied raw LHRs in `tmp/ci-lhr-run4/raw-{unset,accepted}`. Times below are milliseconds. The observed LCP equals observed FCP in all six runs; the hero image is the LCP element throughout.

| State/run | Simulated LCP | Observed LCP | Observed image load delay | Observed render delay | TBT |
|---|---:|---:|---:|---:|---:|
| unset 1 | 2755.15 | 254 | 21.75 | 74.40 | 35 |
| unset 2 | 1725.26 | 98 | 22.11 | 39.64 | 42 |
| unset 3 | 2732.87 | 131 | 33.49 | 52.76 | 32 |
| accepted 1 | 1887.71 | 224 | 14.90 | 54.87 | 37.5 |
| accepted 2 | 1682.24 | 82 | 15.44 | 43.54 | 29.5 |
| accepted 3 | 2152.51 | 128 | 33.24 | 49.10 | 29 |

CI median simulated LCP: unset **2732.87**, accepted **1887.71**. All six reports have zero CLS and no font-display or render-blocking-resource findings.

### Banner and hydration

`ConsentNotice` already emits its unknown-state panel during server rendering, after the page. `TrackingProvider` starts both states at unknown and reads the cookie in an effect. The hero is not conditionally revealed by consent/hydration. Total style/layout work overlaps across states (unset 37.3–47.3 ms; accepted 34.8–51.1 ms), so these LHRs do not establish that banner rendering caused the failures. Without the raw trace, per-task attribution before first paint remains unproven.

### Font and preload

Root DM Sans uses `display: swap` and next/font/local's default metric-adjusted Arial fallback. The supplied reports do not show a font wait blocking first paint; changing font behavior solely on this evidence is speculative.

The existing production HTML has the responsive hero preload as the first resource hint in `<head>`, before the stylesheet and scripts. Font and CSS requests start earlier because the response's HTTP `Link` header advertises them. Moving the existing Hero preload call earlier was considered and rejected after reading the actual response.

### Lantern

The installed Lighthouse 0.15.1 delegates to `@paulirish/trace_engine/models/trace/lantern/metrics/LargestContentfulPaint.js`. It averages optimistic and pessimistic estimates (0.5 each). Its graph cutoffs depend on observed LCP and which scripts evaluated before that cutoff; the pessimistic graph additionally retains layout work. Thus task/request ordering can change simulated LCP substantially even when the image paints at observed FCP. The reported 807/1097 ms render delays must not be described as measured hidden-image intervals.

Motion is already imported on scroll; lineup image sources wait for intersection; Pixel insertion waits for document load and idle. No obvious large eager third-party chunk was found in this source pass.

## Implementation status

CC reviewed the plan on 2026-10-16 and approved only the measurement-stability change: five cold runs in merge and launch, exactly five reports required by the summary validators, and the third sorted sample as median. Thresholds, throttling, form factor, blocking, application code, fonts, images, and consent remain unchanged.

The inline 320w candidate is REJECTED: it benefits Lighthouse's DPR 1 device while real DPR 2-3 phones select external 640w/960w candidates, tuning the page to the benchmark. The earlier preload-move proposal remains withdrawn. See [approved plan](landing-ci-lcp-plan.md).

## Verification so far

| Command | Outcome |
|---|---|
| `node node_modules/vitest/vitest.mjs run tests/landing --maxWorkers=3` | PASS: 36 files, 286 tests |
| `node node_modules/vitest/vitest.mjs run --maxWorkers=3` | FAIL: 744 files / 12,121 tests passed; 2 files / 2 tests failed; 1 file / 3 tests skipped |
| `npx next typegen` | PASS |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS |
| `npm run build` | PASS: fresh Turbopack production build |
| isolated rerun of both failed unit files, `--maxWorkers=3` | Same 2 failures, 37 passed |
| `LANDING_E2E_USE_BUILD=1 npm run test:e2e` | FAIL: 186 passed, 5 skipped, 3 Chromium navigation timeouts; both production builds completed |
| `npm run perf:ci` with installed pinned CLI/browser and existing no-sandbox option | FAIL: accepted median LCP + TBT; unset passes |
| unchanged perf runner with two bounded CPU workers | FAIL: median TBT in both states |

Both full-suite failures are existing CLI smoke tests in `tests/pm-criteria.test.ts` and `tests/people-chunkE-review.test.ts`. Their tsx subprocess crashes before the intended missing-credential guard:

```text
SystemError [ERR_SYSTEM_ERROR]: A system error occurred:
uv_os_get_passwd returned ENOMEM (not enough memory)
at Object.userInfo (node:os:305:11)
at .../tsx/dist/temporary-directory-CwHp0_NW.mjs
```

Logs: `tmp-ci-lcp-baseline-{unit,full,typegen,tsc,build,failures-retry,e2e}.log`.

The three e2e failures are `tests/e2e/landing/accessibility.spec.ts:9`, Chromium initial/settings-open/accepted. Each timed out in `page.goto('/', {waitUntil:'load', timeout:60000})`, before axe ran. They are not reported axe violations, and this run does not establish those three accessibility checks as passing. The complete production suite includes the independently compiled nearby/not-found fixture; that fixture built successfully. Screenshots and traces remain in `test-results/accessibility-landing-pass-*-chromium/`; the HTML report remains in `playwright-report/`. The suite took 15.0 minutes. It has not been rerun or represented as green.

The first performance attempt failed fetching LHCI from the registry (sandbox EACCES). The installed pinned 0.15.1 CLI was located in the existing npm cache. The first offline attempt then timed out launching Chromium without the existing no-sandbox opt-in; no measurements were collected. These are harness launch failures, not measured budget failures. The retry uses process-local `LHCI_CLI_PATH`, `CHROME_PATH`, `LANDING_E2E_USE_BUILD=1`, and `LANDING_PERF_NO_SANDBOX=1`, with no env-file or configuration changes.

## Fresh local baseline, no deliberate CPU burner

`npm run perf:ci` against the fresh production build, unchanged simulated CPU 4x and three cold runs per state. No build/unit suite was running during collection. Other laptop activity was not controlled; this is not proof of GitHub-runner equivalence.

| State | LCP runs ms | Median LCP ms | Median TBT ms | First-party bytes/run | Result |
|---|---|---:|---:|---:|---|
| unset | 2836.04 / 1920.21 / 2192.13 | 2192.13 | 132 | 283693 | PASS |
| accepted, Pixel blocked | 3370.90 / 1986.09 / 3110.73 | 3110.73 | 262 | 283693 | FAIL: LCP + TBT |

Overall command exit 1. Raw reports: `tmp/landing-performance/2026-10-16T21-17-07.997Z-merge-dc7702bd/`. Log: `tmp-ci-lcp-baseline-perf-nosandbox.log`. The reversed state ordering versus CI reinforces that the supplied reports do not establish a banner-specific cause. The logs include an LHCI `ERROR: Access denied` line during cleanup; collection completed with all six reports and the budget failures above.

The tables in this baseline section precede the sampling change; no application change was implemented.

## Controlled-load baseline

The diagnostic `tmp/ci-lcp-load.cjs` starts two CPU-bound worker threads, runs the unchanged `scripts/landing/perf-ci.mjs`, and terminates both threads at completion (hard cap 180 seconds). Both workers remained active throughout this collection and stopped after 142.003 seconds. CPU slowdown remains the same simulated 4x; no build or unit suite was run alongside it.

| State | LCP runs ms | Median LCP ms | Median TBT ms | Median performance | Result |
|---|---|---:|---:|---:|---|
| unset | 3207.86 / 1799.54 / 1969.66 | 1969.66 | 240 | 0.95 | FAIL: TBT |
| accepted, Pixel blocked | 3713.25 / 2048.88 / 2140.87 | 2140.87 | 433.03 | 0.88 | FAIL: TBT |

All six runs transfer 283,693 first-party bytes and zero third-party bytes. Overall exit 1. Raw reports: `tmp/landing-performance/2026-10-16T21-20-37.208Z-merge-9e1384a5/`. Log: `tmp-ci-lcp-baseline-loaded.log`. Adding CPU load worsened TBT but did not monotonically worsen simulated LCP. These results reproduce variability, not the exact CI consent-state ordering, and establish no reliable fix.

The machine-readable summary of all 18 before runs is [qa/landing-ci-lcp-baselines.json](qa/landing-ci-lcp-baselines.json). It includes each raw report path and observed LCP as well as simulated metrics.

## Approved implementation and verification

The harness and tests now require five runs; configuration tests pin merge and launch, count tests reject three/four-run summaries (and other incorrect counts), and metric tests exercise the actual five-run median with two versus three failing samples. Release instructions now specify five runs. The baseline JSON remains an unchanged historical record of 18 before runs.

This round runs the landing unit suite, type generation/typecheck, and one performance collection. Earlier full-suite and browser-suite results above remain historical, not claims about a new run.

| Command/check | Outcome |
|---|---|
| `node node_modules/vitest/vitest.mjs run tests/landing --maxWorkers=3` | PASS: 36 files, 296 tests |
| `node node_modules/next/dist/bin/next typegen` | PASS |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` (after typegen) | PASS, no diagnostics |
| `npm.cmd run perf:ci` (one invocation) | FAIL, exit 1: accepted median TBT 274 ms > 200 ms; unset passes |
| `git diff --check` | PASS |
| Compare evaluated merge/launch Lighthouse configurations against HEAD | PASS: only `numberOfRuns` changes from 3 to 5 |

Logs: `tmp-ci-lcp-five-{unit,typegen,tsc,perf}.log`. Performance uses the existing production build (application code is unchanged), the installed pinned `@lhci/cli@0.15.1`, and Playwright Chromium. Process-local options: `LHCI_CLI_PATH`, `CHROME_PATH`, `LANDING_E2E_USE_BUILD=1`, `LANDING_PERF_NO_SANDBOX=1`, matching the baseline invocation; no environment files changed.

Branch/worktree: `feat/landing-p1`, `C:/Users/conta/co-ops-landing`, base `ac4171f3`. Leave the implementation and all three investigation documents uncommitted for CC. No push, merge, deploy, or production writes. CI is authoritative; local performance failures on the heavily loaded laptop are expected noise, not proof that the CI gate passes.

### Five-run local result

| State | Runs | Median LCP ms | Median TBT ms | Median performance | First-party bytes/run | Result |
|---|---:|---:|---:|---:|---:|---|
| unset | 5 | 2120.42 | 126 | 0.98 | 283693 | PASS |
| accepted, Pixel blocked | 5 | 1973.56 | 274 | 0.89 | 283693 | FAIL: TBT |

Exactly one `npm.cmd run perf:ci` invocation collected all ten cold reports. Both LCP medians pass; accepted TBT fails the unchanged 200 ms threshold. The heavily loaded laptop's local failure is expected noise per CC's dispatch; CI remains authoritative and has not been rerun here. No selective retry or threshold change was made.

```text
total-blocking-time failure for maxNumericValue
expected: <=200
found: 274
all values: 166, 337, 484.4224999999997, 274, 247.50000000000045
```

Raw reports and summaries: `tmp/landing-performance/2026-10-16T21-56-47.438Z-merge-27c04578/`. Log: `tmp-ci-lcp-five-perf.log`. All ten reports have zero third-party bytes (Pixel blocked; real launch cost remains unmeasured). LHCI also emitted the existing `ERROR: Access denied` cleanup line in each state; all five reports per state and assertions completed. The final nonzero result includes the measured accepted TBT failure above.
