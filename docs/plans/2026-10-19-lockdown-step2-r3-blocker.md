# Chunk 1 stopped at R3: late completion replacement is not benign

Source reviewed: `e9f4c2c9` on `feat/lockdown-step2` (plan/rulings commit above `bd72a8c2`). No application cutover or migration authored. This is a source-traced counterexample, not a concurrency execution result.

## Blocking counterexample (BC-007, BC-023, BC-037)

1. An authorized completer begins replacing existing live completion A on an open instance; the initial open check passes.
2. `confirmInstance` reads A in its live-completion set (`lib/checklists.ts:1284-1288`), validates gates/reasons/PIN, and claims confirmed status (`1519-1531`).
3. The paused completer resumes. Its service-role supersession UPDATE (`994-1000`) marks A superseded without checking the parent's status in that statement.
4. Under the proposed service-client cutover, the INSERT (`1017-1030`) succeeds as B even though the parent is now confirmed. B can change count, photo, notes and credited completer from A.
5. The generic checklist report loads current live heads (`lib/reports-hub.ts:461-468`), without a confirmation-time cutoff or immutable captured completion set. It now displays B instead of A. Confirmation's final submission has `completion_ids: []` (`lib/checklists.ts:1598-1605`); it does not freeze A for readers.

This is not an ignored late row: it replaces the attested live record. Today, the authenticated INSERT can be refused by RLS and the existing error branch restores the claimed prior head (`lib/checklists.ts:1031-1060`). Moving the INSERT to service role removes that refusal. The partial unique index also prevents simply restoring A while B remains live. A post-insert open-state check detects the race only after the confirmed record has changed. Designing a new supersession/revocation compensation protocol would require additional authorization and concurrency review; the ruling's benign-row assumption is insufficient.

Even a new completion with no prior head is visible to the report's live-head query, so a row arriving after confirmation can disagree with the incomplete reasons/status computed before the claim.

## Additional contract mismatch for the prerequisite design

R1 requires an open parent for reasons/submissions, but confirmation intentionally claims a closed status BEFORE inserting its reasons/final submission (`lib/checklists.ts:1519-1605`). These dependent writes need an atomic transaction or an explicitly authorized owned-claim exception; an unconditional post-insert `status=open` check would reject every successful confirmation.

## Required CC decision

Per the user's explicit stop instruction and R3, CC must allocate the guarded-writer prerequisite (R3 proposes 0276, moving lockdown to 0277). The design must serialize completion replacement and confirmation against the same parent and preserve the attested set, including dependent reasons/submissions. No migration number is allocated or SQL authored by this report.

The exhaustive five-table manifest, actor/parity module and writer/route changes remain unimplemented: work stopped when the R3 prerequisite failed. No tests were added, removed or weakened. Existing tests are baseline checks only and cannot establish the proposed cutover's safety.

At entry Git reported `app/(authed)/dashboard/actions.ts` and `app/(authed)/dashboard/page.tsx` as deleted. Later Git reads reported permission denied for these paths, so actual deletion versus filesystem inaccessibility is not established. Neither is restored or staged by this task.

## Verification and delivery

- `npx.cmd vitest run checklist opening prep closing`: PASS, 37 files / 574 tests.
- `npx.cmd tsc --noEmit`: FAIL, TS2307 for dashboard actions imported by `components/dashboard/NotificationList.tsx:50` and dashboard page imported by `tests/dashboard-assignment-visibility.test.ts:54`.
- `npm.cmd test`: FAIL, 828 files passed / 12 failed / 1 skipped; 14,456 tests passed / 15 failed / 7 skipped. Dashboard access produces EPERM and missing-module errors; the schedule focus harness also fails with filesystem access denied. Two script-startup tests fail with `uv_os_get_passwd returned ENOMEM` from tsx.
- Used `.cmd` launchers because PowerShell refuses `npx.ps1` under its execution policy.
- Isolated rerun: `npx.cmd vitest run tests/pm-criteria.test.ts tests/people-chunkE-review.test.ts --maxWorkers=1`: 37 passed / 2 failed, same ENOMEM startup errors. Not established as transient load flakes.
- Staging this report failed: `fatal: Unable to create 'C:/Users/conta/co-ops-sol-sec/.git/index.lock': Permission denied`. The session permission profile marks `.git` read-only. No commit, push or merge performed.
- No external DB writes or .env reads performed. No application or test files changed.
