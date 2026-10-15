# Sales export intermittent failure — 2026-10-15

Branch: `fix/sales-export-flake`, base `8003f38c`. Node 22.20.0,
V8 12.4.254.21-node.33, Vitest 4.1.10. No database access.

## Evidence and diagnosis

The route's existing payload-free catch logged:

```text
[/api/reports/export] render Cannot read properties of undefined (reading 'period_start')
```

`toCsv` reads the first column of an undefined export row. The failure is downstream
of loading, date resolution, and the row-cap check. Both the CSV writer and the
breakdown mapper are synchronous, with no deadline, clock, shared cache or promise.
The loaders await their bounded workers; aggregation uses a local Map and a dense
array. No relevant prototype mutation or shared mock was found.

The original test reproduced under the full suite twice. Temporary diagnostics
ran only after failure and counted missing rows without logging report data:

```text
rows: 25000, missingRows: 3240
```

For a faster reproduction, 40 exact UTF-8 copies of the unchanged
`tests/sales-reports-r1.test.ts` ran in separate Vitest files with default isolation:

```text
npx.cmd vitest run tests/sales-export-repro --reporter=verbose
Test Files  1 failed | 39 passed (40)
Tests       1 failed | 599 passed (600)
Duration    14.26s
rows: 25000, missingRows: 461, missingOwnRows: 461,
firstMissing: 24539, lastMissing: 24999
```

These were own properties containing undefined, not sparse-array holes. Additional
temporary instrumentation counted mapper callbacks and fallthroughs after the
switch. It reproduced in batches 1 and 3 of five parallel batches:

```text
MAPPER_SHAPE { calls: 25000, unmatched: 1, inputMissing: 0, items: true }
```

All callbacks ran on present inputs, but one fell through despite the enclosing
view still equalling `items`. This localizes the malformed output to the switch
inside the hot `Array.map` callback. The exact Node/V8 optimization or Vitest
transform mechanism remains unproven; standalone probes did not reproduce it.
It would be incorrect to claim a confirmed upstream V8 bug or a demonstrated
failure of a deployed Next.js build.

## Fix and scope

This is a product-code workaround for the reproduced runtime-dependent mapper
failure, not another mock-isolation change. Select the view once, outside the
mapping callback. Each view now has an unconditional object-returning callback.
The six projections, ordering, cap, authorization, and CSV format are unchanged.
No rows are filtered, no retries added, and no test timing settings changed.
The same mapper serves CSV and PDF.

The route retains its existing error-message-only log; temporary shape diagnostics
and copied test files were removed. New tests cover all six projections and every
item identity/order through a 25,000-row CSV. Those contract tests are not claimed
to fail deterministically on the old implementation: the parallel reproduction
above is the regression evidence.

## Verification

After the fix, six consecutive parallel batches passed: **240/240 executions of
the unchanged large-export test; 3,600/3,600 tests total**. Each batch used:

```text
npx.cmd vitest run tests/sales-export-repro --reporter=dot
Test Files  40 passed (40)
Tests       600 passed (600)
```

Focused contract checks:

```text
npx.cmd vitest run tests/sales-breakdown-export.test.ts tests/sales-reports-r1.test.ts tests/sales-reports-export.test.ts tests/report-export-shared.test.ts --reporter=dot
Test Files  4 passed (4)
Tests       51 passed (51)

npx.cmd tsc --noEmit
exit 0 (no diagnostics)

npx.cmd vitest run
Test Files  598 passed | 1 skipped (599)
Tests       9053 passed | 3 skipped (9056)
Duration    117.72s
exit 0

git diff --check
exit 0
```

Raw local logs live under
`tmp/sales-export-flake/` (ignored scratch), including `parallel-copies.log`,
`instrumented-{1,3}.log`, and `fixed-parallel-*.log`.

Cross-family review by CC remains a handoff requirement before merge. Changes are
uncommitted; no push, fetch, rebase, merge, deployment, or database operation occurred.
