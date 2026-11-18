# Demand signals (item 4): PR 1 build notes, and the contracts PR 2 and PR 7 must meet

Plan: CHIEF `03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-04-DEMAND-SIGNALS-PLAN-r2.md`. Review: Astra r2, four P2, no P1. Built at `ba3e603c` (origin/main), 2026-11-17.

## Astra r2: where each finding went

| Finding | Where it is answered |
|---|---|
| P2 #1 forecasts plus fingerprints are not a replay | **Fixed in PR 1.** Inputs are stored whole. See "What E2 means". |
| P2 #2 qualification not scoped to target and lead | **Fixed in PR 1.** One scope = one target × one lead. See "The pass rule". |
| P2 #3 revocation stops collection, not use | **Contract written for PR 2**, with a census test that PR 2 cannot get past unread. See "PR 2 must". |
| P2 #4 the AI sentence bypasses validation | **Contract written for PR 7**, same census. See "PR 7 must". |

## What E2 means (P2 #1)

A forecast ledger row is E2 evidence when all three hold:

1. It was recorded on its decision date. 0342's `demand_forecast_record` accepts only the database's ET date, and the first write wins.
2. Its manifest resolves: every part is in `demand_input_blobs` and hashes to its name, and re-running the engine over those parts gives the recorded forecast (`replayVerdict` = `reproduced`), or the row was recorded by an older engine version and its inputs are intact (`engine_changed`).
3. Its target was frozen at D+4 or later (`demand_target_freezes`).

What is stored for a pars night: the SKU catalog as the engine saw it (resolved ounces per order unit, has-chain, cushion class, par step, global pars), the shop overlay (human lane, machine lane, pins, activation), rhythms, cutoffs and skips, pack epochs, the guard state (hysteresis priors, spent budgets, recipe-edit date, signals start, lane starts), and one part per window day (three ounce lanes per SKU, the two observation flags, the catering-suspect flag).

**The claim is narrowed on purpose.** `createDatedGraphs` has no decision-time parameter, so the orders → ounces derivation cannot be re-run as of a past decision. PR 1 does not try. It stores what that derivation PRODUCED as of the decision (the ounce lanes and the ounces per order unit), which is everything the engine reads. A later recipe, pack or item-basis change makes new parts; the earlier manifest still names the earlier ones. Tests: `tests/demand-signals-replay.test.ts` ("ORDER CORRECTED AFTER THE DECISION", "CONFIG CHANGED AFTER THE DECISION") and the same against the real SQL in `tests/demand-signals-0342-harness.test.ts`.

Retention: nothing is deleted by PR 1. The 25-month sweep is its own reviewed change and must keep every blob a row still names.

## The pass rule (P2 #2)

`lib/demand-signals/scoring-shared.ts`. Every gate is evaluated inside ONE scope (target × decision lead):

- pooling is allowed only across the shops and valid dates of that scope; `scoreScope` throws `mixed_scope` otherwise;
- episodes are counted inside the scope;
- bias is compared in absolute value (`|candidate| <= |baseline|`);
- a pass returns `QualifiedScope { modelHash, target, leadDays, shopIds, evidenceRunId, holdoutReadId }`, and `authorizes()` is an exact match on model, target, lead and shop;
- the holdout is claimed once per (model hash, target, lead) in SQL.

The bootstrap bound is the 5th percentile of the week-block resampled relative gain (the low end of a two-sided 90% interval). The plan said "lower 90% bound"; this is the stricter reading. Juan or CC can relax it to the 10th percentile by changing `PASS_RULE.bootstrapQuantile`, which is a new rule: earlier results stand under the old one.

## PR 2 must (P2 #3: revocation stops USE)

Contract: `lib/demand-signals/contracts-shared.ts`, `signalUsable`. Census: `tests/demand-signals-contracts.test.ts`.

1. Call `signalUsable(currentSourceStatuses, use)` at all four use points: `collect` (adapter, backfill), `compute` (the nightly term builder), `render` (page and chip loader), `accept` (the chip's accept route).
2. Read the register's CURRENT status each time. Never carry a status from an earlier step.
3. Put source ids on every persisted term (`sourceIds`), so a consumer can ask the register about a term computed days ago.
4. In the accept route, re-check INSIDE the write (same lock or same statement). Ship a test of "revoked between display and accept": the answer is `source_revoked` and nothing is written.
5. Keep stored rows from a revoked source as historical evidence under retention. A revocation never deletes. A qualification that leaned on that source returns the signal to observing.
6. Add each new module to the census with `contract: "revocation"`. The test then requires the module to call `signalUsable`.

## PR 7 must (P2 #4: the AI sentence is validated evidence)

Contract: same file, `validateInsightClaims`, `INSIGHT_CLAIMS`, `MODEL_FREE_TEXT_RENDERED`.

1. The model returns claims only: `{ type, evidenceIds }`. No sentence field, no free text of any kind.
2. Run every claim through `validateInsightClaims` against the evidence DTO the model was given. Render valid claims only.
3. Render each sentence from a deterministic en + es template keyed by `insightSentenceKey(type)`, with every number, shop and date supplied from the evidence.
4. `MODEL_FREE_TEXT_RENDERED` stays false. The r2 plan's "one optional plain sentence, dropped if it has a digit" is withdrawn: a lexical filter passes "Demand will surge because of the shutdown".
5. Adding a claim type is a reviewed change to `INSIGHT_CLAIMS`. No type may forecast or state a cause.
6. Add each new module to the census with `contract: "ai"`.

## Decisions taken in the build (CC to confirm)

- **No new cron and no lease change.** The ledger pass rides the nightly (`lib/toast-sales-pull-run.ts`), after the par run and before the labor pull, with its own heartbeat (`demand-ledger`). This avoids re-emitting `claim_cron_route` while the salary PR (0340) is in flight.
- **Pars lead 0 is the morning after the run date.** The nightly for business date B runs the next morning; its decision date is B+1.
- **A missed night is not made up.** The ledger refuses a decision date that is not the database's today.
- **Baselines only in the ledger for now.** PR 1 registers and records the three baseline engines. The trend and holiday candidates are scored retrospectively in the report; recording their forecasts nightly (so they can earn E2) is a small follow-up once Juan has seen the first report and wants them on the clock.
- **Prep targets are not frozen.** No reviewed reading of a prep item's use per day exists. Prep pars are ledgered from night one; their score waits.
- **The par engine was moved, not copied.** `computeParLedger` is the nightly loop verbatim. The equivalence golden was produced by the pre-move text.

## Citations re-pinned at ba3e603c

The r2 plan could not read the repo. Current homes:

| Plan citation | Now |
|---|---|
| peak floor, `lib/dynamic-pars-shared.ts:352` | `observedPeakCoverageOz`, same file, same line |
| guard stack, `dynamic-pars-shared.ts:596` | `applyGuardStack`, line 804 |
| persisted terms, `dynamic-pars-shared.ts:1200` | `PersistedDemandTerms`, line 1200 |
| engine loop, `lib/dynamic-pars.ts:952` | `computeParLedger`, `lib/dynamic-pars-engine-shared.ts` |
| write bit, `lib/dynamic-pars.ts:150` | `PAR_AUTO_APPLY_ENABLED`, `lib/dynamic-pars.ts` |
| `forecastDay` / `dayTypeFor`, `lib/scheduling/demand-shared.ts:89` | lines 51 and 89 |
| prep par, `lib/items.ts:131` | `resolveItemPar`, `lib/items.ts` |
| the walkthrough requirement, smart-scheduling spec `:312` | section 11, line 312 |
