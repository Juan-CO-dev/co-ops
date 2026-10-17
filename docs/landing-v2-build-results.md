# LANDING v2 build evidence

Chunk 1 only: see [the Chunk 1 result](landing-v2-chunk1-RESULT.md) for file scope, all changed assertions, source/visual evidence, test results and local performance medians.

Worktree `C:/Users/conta/co-ops-landing`, branch `feat/landing-v2`. Implementation remains uncommitted. CI for the exact reviewed revision and CC's implementation review are required before advancement; no later chunk has started.

Landing unit tests (300), assets/source reconstruction (40), type generation, TypeScript and build passed. Full suite: 12,135 passed, 3 skipped, 2 known tsx ENOMEM spawn failures. Browser suite: 181 passed, 5 skipped, 8 unresolved failures; details and exact diagnostics are in the Chunk 1 report. No green overall verification claim.

Final cached-CLI `perf:ci` exited 1. UNSET medians: performance 0.92 / LCP 2163.7925 ms / TBT 331 ms. ACCEPTED: 0.87 / 2021.756 ms / 427.5 ms. Both five-run states failed the unchanged 200 ms TBT limit; accessibility medians 1.00, CLS 0, first-party transfer 283,691 B every run. Raw evidence and the earlier passing advisory baseline are recorded separately in the Chunk 1 report. CI remains authoritative and pending.
