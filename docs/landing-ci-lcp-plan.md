# CI unset-consent LCP investigation

Base: `ac4171f3`, branch `feat/landing-p1`, dedicated clone `C:/Users/conta/co-ops-landing`. Leave changes uncommitted; no push, merge, deployment, environment-file changes, or production writes.

## Evidence checked before authoring

- Raw CI LHRs: `tmp/ci-lhr-run4/raw-{unset,accepted}`. The first failing unset run has observed LCP 254 ms versus simulated LCP 2755 ms; observed image load delay 21.75 ms and render delay 74.401 ms. Zero CLS; no font-display or render-blocking-resource findings. Do not describe simulated render delay as an observed hidden interval.
- `ConsentNotice.tsx` already renders its unknown state on the server, below the page. `TrackingProvider.tsx` initializes both consent states as unknown, reads the cookie in an effect, and retains fail-closed tracking checks.
- `Hero.tsx` already preloads the responsive image, eager/high priority, with visible server markup. `app/eat/page.tsx` awaits public shop data before rendering Hero. Inspect streamed HTML and the dependency graph before deciding whether earlier preload discovery helps.
- Root DM Sans uses swap with next/font's default adjusted Arial fallback. An optional landing font requires evidence beyond the absence of a font audit failure; shared staff typography must remain stable.
- Baseline Lighthouse configuration was simulated mobile RTT 150 ms, throughput 1600 Kbps, CPU 4x, three cold runs, median LCP < 2500 ms. All budgets and aggregation stay unchanged.

## CC review and approved implementation (2026-10-16)

CC accepted the evidence: observed LCP is 82-254 ms and equals FCP in all six CI reports; Lantern simulated LCP varies with graph ordering. The approved change stabilizes measurement sampling.

REJECTED: inline 320w data URL. It helps only the DPR 1 device Lighthouse emulates; real phones at DPR 2-3 select the external 640w/960w candidates. This would tune the page to the benchmark. No image experiment is authorized.

1. Set `lighthouserc.cjs` to five cold runs for both merge and launch. In `scripts/landing/performance-report.mjs`, require exactly five reports in both validators (`five-cold-runs-required`) and select the third sorted sample as the median. Update the launch evidence count in `scripts/landing/perf-ci.mjs`.
2. Update `tests/landing/performance-budget.test.ts` and `performance-blocking.test.ts` fixtures; pin both modes to five, reject three/four-run summaries, and prove the five-run median at the existing thresholds.
3. Update `docs/release-checklist.md`, `docs/deploy.md`, and current QA wording. Retain the three investigation documents, including the unchanged historical baseline JSON, as evidence; historical three-run results remain historical.
4. Run landing tests, `next typegen` then `tsc`, and `npm run perf:ci` once. Record outcomes in the investigation report. CC explicitly identifies local performance failures on this heavily loaded laptop as expected noise; CI remains authoritative.

Contracts unchanged: all thresholds, throttling, mobile form factor, blocking, consent behavior, fonts, imagery, and application code. Risk: five samples increase measurement time and reduce sensitivity to outliers but do not guarantee a CI pass. Leave all changes uncommitted on `feat/landing-p1` for CC.
