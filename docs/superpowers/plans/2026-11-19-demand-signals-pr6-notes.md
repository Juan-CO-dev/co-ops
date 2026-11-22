# Demand signals (item 4): PR 6 (first half) build notes: signals on the order walk, by name

Plan: CHIEF `item-04-DEMAND-SIGNALS-PLAN-r2.md` (section 5; PR split rows 4 and 6). Stacked on PR 5 (#611). **No migration.** Dark behind `DEMAND_SIGNALS`.

## What it is

Juan asked that signals reach THAT DAY's order. This PR puts them on the order walk by name:

- On `/ordering`, above the walk, a collapsed section "Coming up": the days after today (14 days, the walk's own event look-ahead) that have an event, each with the day's forecast line when we hold one, the events by name, and what the person who entered them expects (busier, slower, not known).
- One sentence about a number: "There is no tested number for these days yet. If you expect a different day, change the lines yourself on this order."
- "These are for this order only. Nothing here changes a par."

It suggests no quantity and prefills nothing. The person reads it and changes a line by hand, as they can today.

## Why there is no number yet

The approved plan allows a number only for a signal that (1) was recorded night by night beside today's forecast, (2) beat it on days it could not have seen, at least eight separate times, (3) was approved by a manager of operations or the owner, and (4) rests on sources that are verified at that moment. None of that history exists yet: the nightly ledger started on 2026-11-18 and records baselines only.

So this PR ships the GATE a number must pass (`orderNudgeFor`) and nothing that can open it. Today it answers "no approved signal" for every day, and the walk shows that sentence. The gate is tested for every refusal, so the number cannot arrive later by a side door.

## Decisions (CC to confirm)

1. **Whoever can do the walk sees the section.** The events are public facts (a game, a storm warning), and the person ordering at 6 AM is often a key holder. The link to the signals page shows only to who may open it (GM of the shop, MoO+).
2. **The look-ahead is the walk's own 14 days after today,** not each vendor's cover-through date. The walk data does not carry a per-vendor window; naming every event in the next two weeks is the honest superset.
3. **The read has 2.5 seconds.** Past that the section says "could not be read just now. Order as usual." The walk never waits longer and never fails because of it.

## Owed: the second half (its own PR, with a migration)

In order, each needed before a number may show:

1. **Record a candidate nightly** beside the baseline (`demand_forecast_record` already takes a model hash), so a signal can earn point-in-time evidence. Start with the two zero-feed candidates (trend, the federal holiday calendar).
2. **Store a qualification:** the pass rule's result for one model, target and lead, with its evidence run and the one holdout read.
3. **Approve:** a MoO / Owner / CGS approves exactly that model, target, shop and lead (Tier B, audited). A retrain or a revoked source returns the signal to observing.
4. **Produce the term** nightly: the multiplier per shop and date, with each signal's share, the model hash, the vintage ids and the source ids.
5. **The nudge on the walk:** the day's lines the order covers get "about N% more / less"; accepting prefills that ONE line for that ONE walk through its own writer, with its own arbiter row and audit name, and `demand_sources_assert_usable` inside the write (revoked between display and accept = `source_revoked`, nothing written).

## Standing pars (stub: nothing is built)

**Demand signals never change a standing par.** A signal says "this Thursday is different" and is used up by that day's order.

A lasting change in demand is a different decision with a different owner, evidence bar and undo. It gets its own later PR, built on Dynamic Pars (the machine lane, the band, the budget, the pin, the one par-write authority), not on the signal tables. Until then a standing par moves only by a manager's edit or by the Dynamic Pars engine under its own gate. A test in this PR scans the signal layer for any par writer or par column and fails if one appears.
