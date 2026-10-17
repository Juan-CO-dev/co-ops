# LANDING v2 build evidence

Historical chunk 1 evidence: see [the Chunk 1 result](landing-v2-chunk1-RESULT.md) for file scope, all changed assertions, source/visual evidence, test results and local performance medians.

Worktree `C:/Users/conta/co-ops-landing`, branch `feat/landing-v2`. Chunk 1 was committed at `21922b70`, and chunk 2 at `392cfd1c`. Part A review fixes and chunk 3 are now uncommitted; see `landing-v2-chunk3-RESULT.md`. CI for the reviewed revision and CC review remain required.

Landing unit tests (300), assets/source reconstruction (40), type generation, TypeScript and build passed. Full suite: 12,135 passed, 3 skipped, 2 known tsx ENOMEM spawn failures. Browser suite: 181 passed, 5 skipped, 8 unresolved failures; details and exact diagnostics are in the Chunk 1 report. No green overall verification claim.

Final cached-CLI `perf:ci` exited 1. UNSET medians: performance 0.92 / LCP 2163.7925 ms / TBT 331 ms. ACCEPTED: 0.87 / 2021.756 ms / 427.5 ms. Both five-run states failed the unchanged 200 ms TBT limit; accessibility medians 1.00, CLS 0, first-party transfer 283,691 B every run. Raw evidence and the earlier passing advisory baseline are recorded separately in the Chunk 1 report. CI remains authoritative and pending.


## Part A / chunk 3 - 2026-10-17

See [the complete chunk-3 RESULT](landing-v2-chunk3-RESULT.md) for Part A/B file lists, every changed assertion, failing-first evidence, all seven P3 dispositions and commands. Uncommitted on `feat/landing-v2`, HEAD `392cfd1c`.

Final landing suite: 309 passed. Assets: 40 passed, including local source reconstruction. Type generation, tsc and production build passed. Scoped browsers: 119 passed / 1 retained non-Darwin WebKit decoder skip. Worst initial first-party transfer: 401,871 bytes (under 500,000); live Meta and authoritative CI performance remain separate gates. Full suite with `--maxWorkers=3`: 12,144 passed / 3 skipped / 2 known tsx `uv_os_get_passwd` ENOMEM failures, listed separately in the RESULT. No overall full-suite green claim.

## Part A / chunk 5 - 2026-10-17

See [the complete chunk-5 RESULT](landing-v2-chunk5-RESULT.md) for file lists, every changed assertion, failing-first evidence, rail measurements, screenshots and performance records. Uncommitted on `feat/landing-v2`, HEAD `fa004048`, dedicated clone `C:/Users/conta/co-ops-landing`; no push/merge/deploy.

Part A fixes the sticky rail with hysteresis/dwell, constant consent position, stable hint, focus restoration, ARIA and resize-only style reads. Part B adds real P016-to-L083 texture travel, Crunchy Boi-first L083 Field Guide, external ingredient labels, shared catering photo, static fallbacks and the bounded crave-heading ViewContent integration fix. Consent wording and light shop links remain intact.

Final checks: 354 landing tests pass; 40 assets/source reconstructions pass; tsc and build pass. FULL Chromium + WebKit: 347 passed, 5 existing Windows decoder skips, 0 failed (10.5m). Rail: exactly 2 toggles and invariant consent top at all 3 sizes in both engines. Full unit suite (`--maxWorkers=3`): 12,189 passed, 3 skipped, 2 unchanged tsx `uv_os_get_passwd` ENOMEM startup failures; not an overall full-suite pass.

Local `perf:ci` exits 1: five runs per state, performance medians 0.94 both; LCP 3053.178ms unset / 3092.990ms accepted fails the 2500ms limit; TBT 77/59ms, accessibility 1.00, CLS 0.002750/0.052699 and 298,966B first-party per run pass. All raw evidence is retained; no thresholds changed. Authoritative CI for this exact revision and CC review remain pending and block advancement.

## Part A / chunk 6 - 2026-10-17

See [the complete chunk-6 RESULT](landing-v2-chunk6-RESULT.md) for every changed assertion, provenance, failures, reruns and artifact paths. Uncommitted on `feat/landing-v2`, base `d16a7468`, dedicated clone `C:/Users/conta/co-ops-landing`; no push, merge, deploy or database work.

Implements the queued consent/review fixes, observer-based recovering rail, independent text-zoom legend, reserved crave geometry, distinct approved catering photo and six varied bounded touch assignments (mobile checker omitted under the reviewed safe-gutter exception). Five new image derivatives total 56,295B, including the faithful 27,463B mark within its original budget.

365 landing tests, 45 assets, tsc and build pass. Full unit suite (`--maxWorkers=3`): 13,764 passed, 3 skipped, two existing tsx `uv_os_get_passwd` ENOMEM startup failures. Latest full Chromium/WebKit run: 369 passed, 14 WebKit failures, five existing decoder skips; all 14 failed cases pass in the isolated one-worker rerun. This is NOT a clean concurrent full-suite pass. The saved passing rail measurements span 70.68%-86.07% visibility with >=400ms / >=120px transition spacing. All 24 requested viewport/full-page en/es screenshots and six rail JSON files are indexed under `tmp/landing-v2/chunk6/`.

Advisory local performance completes five cold runs per consent state and exits 1 for LCP: medians 3088.846ms unset / 3091.573ms accepted, performance 0.93 both, TBT 105.5/95ms, first-party 301,361B every run. Raw evidence and all failed runs remain linked in the RESULT. Concurrent WebKit timing, authoritative CI and CC cross-family review remain open handoff risks; no thresholds were relaxed.
