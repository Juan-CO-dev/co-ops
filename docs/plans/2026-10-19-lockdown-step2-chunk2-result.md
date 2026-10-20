# R7 chunk 2 handoff

Base: `37396eac`, branch `feat/lockdown-step2`, clone `C:/Users/conta/co-ops-sol-sec`. Changes intentionally uncommitted for CC. No push, merge, deployment, external DB access, or environment-file access.

## Implementation

- `lib/checklists.ts`: completeItem, submitBatch and confirmInstance use the three 0276 service-only RPCs. Supplied clients retain their read scope. getOrCreateInstance uses a service INSERT with single-row return checking, fresh actor membership/active status, employee floor, type-specific opening/prep floor, and the existing submission gate. Existing-row and unique-race reads retain their supplied client.
- Both instance INSERT policies are OR alternatives: the baseline policy subsumes the closing-staff alternative. Thus old dates, inactive templates and a different starter are not newly forbidden. Owner and level-8 global read authority do not substitute for membership.
- `lib/checklist-write-actor.ts`: the branded actor also carries the freshly read role for audit attribution; a typed resolution refusal lets routes fail closed with 403. All four checklist routes and the closing-page creation caller invoke the resolver on verified AuthContext. Request-body authority is ignored.
- Existing assignment, submission-lock, item/template/active/manual-work, answer/count/photo, lock-up, cash, hard-gate, completed-item role and PIN checks precede RPC calls. Duplicate reasons now fail with existing `extra_reasons`; missing/extra/blank reasons retain their existing errors. Confirmation passes the exact live completion IDs used by those checks.
- Confirm's status rule agrees: exact reason-set validation makes `incompleteRequiredIds.length > 0` equivalent to SQL `jsonb_array_length(p_reasons) > 0`. **0276 SQL is unchanged.** No 0277 or written_reports changes.
- Removed only completeItem's supersede/retry/restore/link writes and confirmInstance's claim/dependent insert/reuse/compensation writes, which now belong to atomic RPCs. Existing revoke/reopen/tag/supersession paths remain unchanged. Completion audit reads committed back-links for the prior ID(s) and carried-time flag; a read error is recorded in metadata. No new audit action.
- Composite RPC results accept a single object or exactly one array row; empty/multiple rows fail. Confirm JSON results validate instance/submission rows, reason cardinality and returned status.

## SQL error mapping

| SQL exception | Existing API outcome |
|---|---|
| `instance_not_open` | Re-read via supplied reader; closed status yields 409 `instance_closed` with instance/status. If no reliable closed state is readable, 409 `concurrent_modification`. |
| `completion_set_changed` | 409 `concurrent_modification`, “The checklist changed. Re-check and try again.” (`_helpers.ts` handles this existing vocabulary for a generic ChecklistError.) |
| `not_authorized`, `item_mismatch` | 403 `role_level_insufficient` |
| `invalid_reasons`, `invalid_payload` | 400 `invalid_payload` |
| `empty_batch`, `completion_not_found`, `completion_wrong_instance`, `completion_wrong_author` | Existing 400 code/message envelope |
| `completion_cardinality`, `submission_cardinality`, `instance_cardinality`, `reason_cardinality`, unknown SQL errors | Existing route 500 `internal_error`; no app compensation |
| `instance_not_found` | Existing unexpected missing-instance 500 behavior |

## Changed and removed test assertions

All assertion changes to existing test files are listed here; new coverage is additive in `tests/checklist-service-writers.test.ts` and the offline harness.

| Existing file | Change and justification |
|---|---|
| `tests/assignment-gates.test.ts` | Fixture only: the three moved writers receive a branded fixture with membership at `stored-shop`, so denial still exercises revoked/missing assignment rather than failing earlier at membership. No assertion removed or weakened; revoke/drop cases retained. |
| `tests/closing-staff-participation.test.ts` | Actor fixtures branded; successful completion double now returns an RPC row. The one payload assertion changes `completed_by: trainee` to `p_actor: trainee`, the new attribution boundary. All role/reference/finalize assertions retained. |
| `tests/checklist-gate-location-bind.test.ts` | Owner case changes from a non-member level-10 bypass to a member level-9 owner reaching the read, per R2. New behavioral test explicitly refuses the non-member owner. Foreign-GM denial and trainee read/create assertions retained; actors branded. |
| `tests/station-close-nudge.test.ts` | Resolver fixture added for the already-mocked closing-page creation flow. All navigation, caller and rendered-state assertions unchanged. |
| `tests/checklist-confirm-denial.test.ts` | Removed source slicing around `if (!updatedRow)` and four assertions about that obsolete branch (closed condition, typed closed throw, role-denial throw, absence of generic throw). Replaced with RPC mapper branch assertions; existing 403 response/code assertion retained. Behavioral tests now exercise closed-race 409, not-authorized 403 and concurrent-confirm ordering. |
| `tests/b8-note-keeps-tick-time.test.ts` | Four pure carry-rule tests retained unchanged. Five old app-insert cases (note timestamp supplied, first tick omits timestamp, free-text omits timestamp while passing notes, tagged head omits timestamp, other author omits timestamp) move to actual SQL execution in the harness. The sixth source test's three assertions (claim SELECT columns, inputType passed to helper, conditional completed_at spread) are removed because SQL now reads those fields and owns that timestamp. Harness also checks changed count and photo. |
| `tests/checklist-supersede-compensation.test.ts` | Ten obsolete app-implementation tests removed/replaced: supersede-before-insert/live filter; retry-on-23505; revert-to-null; id+stamp filter; captured stamp; lap-local claim/no accumulated-ID revert; exact revert count; revert diagnostic; rethrow original insert failure; compensate-before-throw. Replacement asserts one RPC/no app mutations and SQL lock/supersede/insert/link ordering with no swallowed SQL exception. Existing harness executes FK rollback and back-link behavior. Both cash compare-and-set assertions and the closed audit-vocabulary assertion remain; the redundant no-new-action assertion against the removed retry lap is dropped. |

New test helper: `tests/helpers/checklist-actor.ts` (explicitly unit-only cast; production has no actor constructor other than resolver).

New behavioral coverage uses separate clients that throw on authenticated mutations and service UPDATE/DELETE/compensation. It calls all four real route handlers with spoofed body fields, revoked/expired sessions, inactive users, missing membership and a level-8 global reader. It also covers closed instances, wrong/missing PIN/hash, batch ownership/instance/missing IDs, exact/duplicate/blank reasons, confirm status/snapshot, SQL errors/cardinality, replaced-after-confirm refusal, mocked confirm-vs-confirm ordering, retained business gates, instance floor/old-date/handoff behavior, and zero-row instance creation.

## Verification

```powershell
npx.cmd tsc --noEmit
# PASS, exit 0
node scripts/sql-harness-0276.mjs
# PASS: 36,467 checks; 3,300 parity cases; all 8 ACL/lock/open mutations rejected
$testFiles = @(rg --files tests | Where-Object { $_ -match '(checklist|opening|prep|closing|assignment-gates|b8-note|station-close|phase1-chain|digest-routes|whos-here-tick).*\.test\.ts$' })
npx.cmd vitest run @testFiles
# PASS: 47 files / 689 tests
npx.cmd vitest run tests/checklist-service-writers.test.ts tests/checklist-confirm-denial.test.ts tests/checklist-supersede-compensation.test.ts
# Final targeted rerun after array-shape/member-owner/item-floor additions: PASS 3 files / 70 tests
git diff --check
# PASS (Git emits existing CRLF normalization warnings)
```

PowerShell blocked the initial `npx.ps1` invocation under its execution policy; subsequent commands use `npx.cmd` without changing policy. The first compiler run found old test fixtures missing the newly required branded authority; those fixtures were updated as documented above. Final typecheck passes. No failing tests remain.

## Open limits / questions

- No blocking implementation question. CC's separate chunk-1 review/fix round remains outstanding.
- 0276 remains file-only. App deployment requires those functions and refreshed PostgREST schema cache; CC owns review/apply/deploy sequencing.
- Real two-connection PostgreSQL lock proof is not run. PGlite executes transaction rollback, sequential winner/loser behavior and structural lock mutations; app tests use explicitly mocked concurrent ordering.
- Existing other service writers and older deployments do not all share these parent locks. This is the bounded R7 cutover, not a universal freeze claim. Existing manifest paths remain unchanged.
