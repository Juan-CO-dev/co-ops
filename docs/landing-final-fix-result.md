# Landing final fix round - result

Custody (2026-10-16): branch `feat/landing-p1`, HEAD/base `21eeedde`, dedicated clone `C:/Users/conta/co-ops-landing`; clean before this round. Only this merge-gate/P3 round is UNCOMMITTED. Earlier rounds are committed. No push, merge, deploy, environment change or production write; 0273 remains file-only. Current evidence: [merge-gate result](landing-merge-gate-result.md). The results below describe the historical round, not the current diff.

## Outcome

Code and browser gates pass. The performance gate remains RED: final unset LCP is 2723.9 ms, accepted LCP is 2767.4 ms, both above 2499.999 ms. Accepted real-Pixel cost is UNMEASURED: the real fbevents.js request remained unfinished (status -1, zero recorded bytes), so the new validity gate refuses it. No stub or estimated Pixel cost is substituted. CC must rule on LCP; complete real-Pixel measurement remains required.

First-party bytes fell from 545220 to 293921 (251299 bytes, 46.1%). The 500000-byte first-party budget passes every final cold run. Performance >=0.85, LCP <2.5 s and TBT <=200 ms thresholds were not loosened.

## Changes

- Landing page/components: server-render the native FAQ, remove the portal reveal, load playback code on first scroll, preserve a scroll that occurred before hydration. Lineup photos attach URLs only on viewport intersection, retain native no-JS fallback, lazy/low priority, and no preload. Food media bytes are unchanged.
- Tracking transport: SDK insertion waits for load and idle; consent withdrawal is checked again before insertion. Existing queue, attribution, deduplication and bilingual controls remain tested.
- Brand icon/provenance/inventory/proxy: preserve the original and derive a 180x180 icon, 100188 -> 6135 file bytes. The original LHR's entire Other category was /eat/icon.png: 101174 transferred bytes; final icon transfer is 7125 bytes.
- Initial JavaScript: original LHR 146491 bytes; final LHR 145055 bytes. Framework chunks dominate (~126 KB); full staff/i18n dictionaries were not in the landing client import graph. Removed the remaining portal client wrappers and deferred motion; this is a modest JS cut, not a claim of removing the framework.
- Performance reporting: delete unused performance-report.ts; wire performance-report.mjs into the executed perf-ci runner for actual first-party bytes and refused incomplete accepted runs. Preserve all raw evidence; fresh-cache npx and a local installed CLI option support reproduction.
- Monitor: only explicit hard failures request pause; redirect/response drift requests review. Add tested two-hour heartbeat checker and separate flag-OFF workflow. Document CC's reviewed baseline-generation procedure. No baseline or activation is fabricated.
- Fixtures/tests: real local counter RPC increment (204) versus dead-provider refusal (503); dead Supabase URL produces a 200 landing with hero/lineup/catering in en/es, Chromium/WebKit. Pin actual not-found SVG allowance, remove unreachable optimizer branch, explain Chromium media assertion.
- Custody/local-only artifact wording corrected in phase1, release packet and work plan.

## Verification

| Command / configuration | Outcome |
|---|---|
| node node_modules/vitest/vitest.mjs run tests/landing --maxWorkers=3 | 34 files, 265 tests passed |
| node node_modules/vitest/vitest.mjs run --maxWorkers=3 | 652 files passed, 1 skipped; 9906 tests passed, 3 existing artifact skips; exit 0 |
| node node_modules/typescript/bin/tsc --noEmit --incremental false | Zero diagnostics, exit 0 |
| node node_modules/next/dist/bin/next build --webpack | Production build passed, exit 0 |
| LANDING_E2E_USE_BUILD=1; node node_modules/@playwright/test/cli.js test | Chromium + WebKit: 153 passed, 5 existing codec skips, 0 failures, exit 0 |
| node scripts/assets/inventory.mjs | 26 approved assets passed |
| git diff --check | Passed |
| npm.cmd run perf:ci | Six final cold runs collected; exit 1: LCP in both states plus accepted Pixel unmeasured |

Test-first evidence includes Pixel immediate insertion, monitor review/pause and missing-status regressions, square icon, optimizer refusal, and incomplete Pixel measurements. The first full browser pass had one WebKit failure: a real scroll to 79px occurred before hydration; no motion chunk loaded. The production mount check fixed it and the unchanged test passes in the full rerun.

## Lighthouse evidence

Fresh before and after sets were run sequentially without concurrent test/build jobs, using LHCI 0.15.1 and Chrome 154.0.8037.95 on this laptop. Before uses Aggie's preserved compiled 8720af81 build, not a claim that HEAD was reset; after uses the final production build at 9aeb73a1 plus this uncommitted diff. Mobile 375x812, simulated RTT 150ms, throughput 1600 Kbps, CPU multiplier 4; three cold browser runs per state.

| Build | Consent | Perf median | LCP median ms | TBT median ms | First-party B | Total B recorded |
|---|---|---:|---:|---:|---:|---:|
| Before | unset | 0.93 | 3133.5 | 111.0 | 545220 | 545220 |
| Before | accepted (incomplete) | 0.95 | 2917.1 | 88.5 | 545220 | 545220 |
| After | unset | 0.95 | 2723.9 | 109.0 | 293921 | 293921 |
| After | accepted (incomplete) | 0.94 | 2767.4 | 139.5 | 293921 | 293921 |

| Build | Consent | Run | Perf | LCP ms | TBT ms | First-party B | Third-party B recorded | Total B recorded |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Before | unset | 1 | 0.93 | 3145.6 | 101.0 | 545220 | 0 | 545220 |
| Before | unset | 2 | 0.96 | 2637.9 | 124.5 | 545220 | 0 | 545220 |
| Before | unset | 3 | 0.93 | 3133.5 | 111.0 | 545220 | 0 | 545220 |
| Before | accepted (incomplete) | 1 | 0.96 | 2664.3 | 88.5 | 545220 | 0 | 545220 |
| Before | accepted (incomplete) | 2 | 0.92 | 3130.3 | 149.0 | 545220 | 0 | 545220 |
| Before | accepted (incomplete) | 3 | 0.95 | 2917.1 | 64.5 | 545220 | 0 | 545220 |
| After | unset | 1 | 0.96 | 2701.0 | 86.0 | 293921 | 0 | 293921 |
| After | unset | 2 | 0.95 | 2723.9 | 109.0 | 293921 | 0 | 293921 |
| After | unset | 3 | 0.93 | 2778.3 | 188.7 | 293921 | 0 | 293921 |
| After | accepted (incomplete) | 1 | 0.96 | 2767.4 | 64.0 | 293921 | 0 | 293921 |
| After | accepted (incomplete) | 2 | 0.86 | 2938.6 | 358.4 | 293921 | 0 | 293921 |
| After | accepted (incomplete) | 3 | 0.94 | 2740.0 | 139.5 | 293921 | 0 | 293921 |

Accepted totals above are only RECORDED bytes, not complete consented-page costs. In every fresh accepted run the real Meta SDK request was unfinished; zero is not a measured real-Pixel cost. Aggie's earlier complete baseline, preserved separately, measured about 116126 third-party bytes (median total 661346), perf 0.73 / LCP 2657ms / TBT 1074ms; its CPU benchmark was substantially slower, so it is not used to claim the new timing improvement.

Reproduction on this restricted Windows session:

```powershell
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:LANDING_E2E_USE_BUILD='1'
$env:LANDING_PERF_NO_SANDBOX='1'
$env:LHCI_CLI_PATH='C:\Users\conta\AppData\Local\npm-cache\_npx\7c4c7312e9ccc7bf\node_modules\@lhci\cli\src\cli.js'
npm.cmd run perf:ci
```

Normal CI uses the pinned npx command. Both registry attempts here failed EACCES, including the requested fresh .npm-cache. The existing CLI was confirmed as 0.15.1. Default Puppeteer launch timed out; the explicit local flag matches Playwright's working no-sandbox browser launch. No global environment or installed dependency was modified.

Machine-readable measurements: [landing-final-performance.json](qa/landing-final-performance.json). Local-only raw reports: tmp/landing-before-own-performance/raw-{accepted,unset}, tmp/landing-performance/raw-{accepted,unset}; these include exploratory runs, while the JSON above contains the final three per state. Original Aggie reports are preserved locally in tmp/landing-performance/before-aggie.json. Final logs: tmp-final-{landing2,full3,tsc3,build3,e2e2,before-fresh,perf2}.log. These ignored paths are not repository links.

## Remaining limits

- LCP remains over target; accepted third-party transfer is not completely measured. No release-ready claim.
- Eleven tracked late-refund logs were scanned without printing their contents; no credential patterns were found. git rm --cached was blocked by read-only .git/index.lock permissions. CC must run: `git rm --cached -- late-refund-*.log`. The local files remain intact.
- Monitor baseline, flag activation, US runner and actual notification receipt remain external gates. The separate heartbeat workflow cannot detect a platform-wide GitHub scheduler outage. Existing real-device, merchant, Meta and release gates remain open.
