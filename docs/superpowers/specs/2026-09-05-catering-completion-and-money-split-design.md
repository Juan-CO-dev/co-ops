# Catering completion + money split — design

**Date:** 2026-09-05 · **Owner:** CC · **Status:** DESIGN (Juan's asks after smoking #330; awaiting his go)
**Follows:** #330 (catering truth: purge 0193, insights v2 0194). Lineage at 0194.

## Juan's asks (2026-09-05, after the preview smoke)
1. "There are 2 catering orders that already passed that are still in confirmed. If it's passed, it already completed." → confirmed/out events whose date has passed must become `completed` without a human click.
2. "We need money confirmed and money completed, etc." → insights must split booked value into what is still to come and what has been delivered.

## Live facts
`catering_pipeline` = 5 real leads, all `confirmed`: Nav Gill (Sep 3, Toast), Rachel Wagley (Sep 4, Toast), three ezCater orders (Sep 8, 11, 20). The nightly cron `/api/cron/toast-sales-pull` runs at 09:00 UTC (5 AM ET) for business date T-1. `systemMoveStage(sb, lead, toStage, note, actorContext)` (`lib/catering/system-intake.ts:63`) already performs a guarded stage move + `catering_pipeline_events` row + `catering.pipeline.stage_move` audit with `actor_id null`; it returns `moved | stage_changed | event_failed | update_failed`. `LEGAL_TRANSITIONS` (`lib/catering/pipeline-shared.ts`) allows confirmed→completed and out→completed.

## 1. Elapsed events complete themselves

- **Rule:** a lead with `stage IN ('confirmed','out')` and `event_date < today (ET)` is completed by the system at the ET day rollover. Not at read time (a stage is state, and every surface must agree), not on the pinger (10-minute cadence would race a manager marking `out` late in the evening): once a night, in the existing daily cron, **before** the sales pull.
- **Mechanism:** `completeElapsedCateringEvents(todayEt)` in `lib/catering/system-intake.ts` — selects the candidates (all locations; the cron is system-context), calls `systemMoveStage(sb, lead, "completed", "auto: event date passed", "cron_rollover")` per lead, returns `{ completed: string[], stageChanged: number, failed: Array<{id, result}> }`. The cron's `cron.success` audit gains `elapsed_completed` and `elapsed_failed` counts. Per-lead failure never aborts the cron.
- **Backdated first run:** the same function runs once by hand after deploy (CC, via a `?complete_elapsed=1` flag on the cron route is NOT added — instead CC calls the route normally after merge; the nightly run at 5 AM ET completes Nav Gill and Rachel Wagley). If Juan wants it sooner, CC triggers the cron route once with the secret from Vercel's env (never from the desktop secret; this route is CRON_SECRET-gated).
- **`out` is not skipped:** a lead left in `out` past its date is a delivered order nobody marked done — completing it is correct; the events ledger keeps `out → completed` with the auto note.
- **Lost stays lost; inquiry/quote_sent stay open** (an unanswered inquiry with a past date is not a completed event — it renders as stale in the pipeline board, which is the truth).

## 2. Money confirmed vs money completed (insights)

Per window, `catering_insights_window` (0195, create or replace) adds:

| Field | Definition |
|---|---|
| `confirmed_value_cents` | value of leads `stage IN ('confirmed','out')` with `event_date` in window — money still to be earned |
| `completed_value_cents` | value of leads `stage = 'completed'` with `event_date` in window — money earned |
| `confirmed_events` / `completed_events` | the matching counts |

`booked_value_cents` / `booked_events` stay as the sum (the "all booked" number). Value per lead is unchanged (live accepted quote else `estimated_revenue_cents`).

**Page:** the single "Booked value" card becomes two cards side by side — **Confirmed (upcoming)** and **Completed** — each with its count underneath ("3 events"); "Booked events" card stays as the total. Calendar unchanged (dots already colour by stage; completed = green). Loader/types gain the four fields; `WindowStats` too. i18n en + es: `catering.insights.stat.confirmed_value` "Confirmed (upcoming)" / "Confirmado (por venir)", `catering.insights.stat.completed_value` "Completed" / "Completado", `catering.insights.stat.events_count` "{count} events" / "{count} eventos".

## 3. Rollout
One PR: migration 0195 + cron step + loader/page + tests (pure: none new beyond types; the completion selector's date predicate is SQL; the function's result shaping is covered by a vitest on a fake client if the pattern exists, else the route smoke). Sim rehearsal: run the completion step against the sim's fixture leads (the Aug 31 and Sep 5 rows). Juan merges; CC applies 0195; the 5 AM cron completes the two elapsed Toast leads; insights then shows Completed $505.84 (Nav + Rachel) and Confirmed $2,371.13 (three ezCater).
