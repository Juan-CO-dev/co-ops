# Demand signals (item 4): PR 5 build notes: the signals page, manual events, source verification

Plan: CHIEF `03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-04-DEMAND-SIGNALS-PLAN-r2.md` (PR split, row 5; section 9 for access). Built on `e9e29073` (origin/main), 2026-11-19. **No migration.** Dark behind `DEMAND_SIGNALS`.

## What it is

Two screens and one route on top of what PR 2 stored.

| Piece | Who | What |
|---|---|---|
| `/admin/demand-signals` | GM (own shops), MoO / Owner / CGS (any) | The next 14 days, day by day: the forecast we hold and the events in force. The events for 60 days. How each feed last ran. |
| Add / correct / take back an event | GM (own shops), MoO+ (any shop, or every shop) | `POST /api/admin/demand-signals/events` → 0343 `demand_event_save`. No password prompt. |
| `/admin/demand-signals/sources` | MoO / Owner / CGS | Every registered source with its terms and conditions; Mark verified / Revoke through PR 2's route (Tier B). |

The page gives **names and no number about demand**. That is the plan's rule, not a shortcut: a number may appear only for a signal that qualified on point-in-time evidence and was approved, and none has.

## Decisions in this PR (CC to confirm)

1. **The pages live under `/admin/demand-signals`,** not `/signals`. The admin shell already carries the password prompt the source page needs, and `/api/admin` keeps the Tier B unlock.
2. **Both pages are dark behind `DEMAND_SIGNALS`.** The mark ROUTE is unchanged (not behind the switch, as PR 2 shipped it). The runbook now allows either order: switch first, then verify on the screen.
3. **Entering an event takes no password.** It is a note on a read-only page; a correction is one more row; nothing is deleted. Marking a source keeps Tier B.
4. **The UI collects no note on an event.** 0343 stores one, but no reader returns it, so a field nobody can read back would be a write-only box. A correction made on the page therefore carries no note. If Juan wants notes shown, that needs a small reader function (a migration).
5. **The store reads two non-signal tables for the pages:** the register's definitions (`demand_sources`) and the run ledger (`demand_signal_runs`). PR 2's census pin said "no module reads any of the five tables"; it now says: the signal tables and the mark history, nobody; these two, the store only. No reader skips the gate: neither table holds a signal.
6. **`input-shared.ts`** (new, import-free) holds the two parsers and their bounds so the forms validate with the routes' own rules. `sources-shared.ts` re-exports it, so no server import changed.
7. **A source's text is shown as written** (English), labelled as such in both languages. Translating a feed's titles is out of scope.

## What the page does NOT do yet (stated, not hidden)

- **No number, no chip, no order or schedule suggestion.** See "The this-order nudge" below.
- **No table sizes** on the feeds line (plan section 7). A size needs a SQL function; the run ledger's last run per feed is shown instead. The runbook has the query.
- **No mark history** per source: only the latest mark (who, when). The history is in `demand_source_events` and the audit log.
- **No event older than today** is listed. The reader's window is today to +60 days.
- **No per-source "last collected"** for sources without an adapter (there is nothing to collect).
- **Not rendered in a browser by the builder.** The 375 px en + es pass on a preview is CC's.

## The this-order nudge (plan PR 4 + PR 6) and standing pars: what comes next

Recorded here so it is not lost. Nothing of it is in this PR.

- **A signal adjusts THAT DAY's order only** (Juan, 2026-11-18). When a signal has a tested number, the order walk shows a nudge for the lines the day's order covers; accepting it prefills that one line for that one walk through its OWN writer and arbiter row. It never touches a par column, `parWriteColumns` or `par_suggestion_actions`.
- **Before a number may exist:** the candidate is recorded nightly beside the baseline (so it can earn E2), a qualification passes `PASS_RULE` inside one target and lead, a MoO+ approves that exact model hash, target, shop and lead (Tier B), and every source behind it is verified at compute, render and accept (`demand_sources_assert_usable` inside the accept write).
- **Standing pars get a separate mechanism, its own later PR.** It builds on Dynamic Pars (the machine lane, the band, the budget, the pin), not on the signal tables. Until it exists a standing par moves only by a manager's edit or the Dynamic Pars engine under its own gate. **No code in the signal layer may write a par.**
