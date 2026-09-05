# Catering truth — test purge · insights v2 · same-day sales pinger · pulse catering panel v2

**Date:** 2026-09-05 · **Owner:** CC · **Status:** DESIGN (Juan's rulings below; awaiting his go on the written spec)
**Follows:** the Toast catering scan (PR #329, migs 0191/0192 applied), ezCater lifecycle (#328), the go-live batch memory.
**Not in this spec:** Stripe. Juan has the account; hosted Checkout for deposit/balance gets its own spec after this arc.

## Rulings (Juan, 2026-09-05)
1. **Test catering data is physically deleted.** "The law is for the people using it, not for us making it." The append-only law protects operators' history; builder test artifacts are not history. The purge is a migration with an explicit id manifest and ONE audit row, never an app code path — no DELETE route is added anywhere.
2. **Insights windows:** this week · this month · last 30 days · all time. Plus a **calendar** of confirmed catering dates.
3. **Pulse:** the desktop pinger keeps today's Toast sales current through the day; the catering panel shows stage, due time, source, headcount, delivery, and a "tomorrow" line.
4. **Stripe:** account exists; hook-up is the next spec.

## Ground truth (live, 2026-09-05)
`catering_pipeline` = 16 rows: **11 portal test leads** (all `lost`, customers `juan@complimentsonlysubs.com` / `contactmgb202@gmail.com`) + **5 real** (2 `toast_catering`, 3 `ezcater`, all `confirmed`, revenue on `estimated_revenue_cents`, no quotes). Both `catering_customers` rows are Juan's. `catering_orders` = 0 rows ever. `catering_quotes` = 12 (11 test + 1 orphan staff quote `b90fded5…`, no pipeline, $375). `catering_payments` = 4 test `due` rows. `catering_prep_demand` = 3 (all test). Portal tokens 25 / sessions 20, all Juan's emails. `catering_companies` = 0. `catering_pipeline_events` = 34 (26 test). `catering_pipeline_events` CHECKs include `out` (0191 applied). `catering_insights` RPC (0121): all-time only, counts `lost`, revenue from `catering_orders` (empty) + accepted quotes (none) → shows $0 against ≈$2,800 confirmed.

---

## 1. Test-data purge — migration `0193_catering_test_purge.sql`

**What is deleted (the manifest; the migration lists ids literally, derived from these predicates at authoring time and re-asserted with `ASSERT count = N` before each DELETE so a drifted prod refuses):**

| Table | Rows | Predicate |
|---|---|---|
| `catering_prep_demand` | 3 | `pipeline_id IN test_leads` |
| `catering_quote_item_options` | all under test/orphan quotes | `quote_item_id IN (items of test quotes ∪ orphan quote)` |
| `catering_quote_items` | 42 | `quote_id IN test_quotes ∪ {orphan}` |
| `catering_payments` | 4 | all rows (every one is a test intent) |
| `catering_quotes` | 12 | `pipeline_id IN test_leads` ∪ `id = 'b90fded5-fbd1-4f69-b03e-59c08f707dbb'` |
| `catering_pipeline_events` | 26 | `pipeline_id IN test_leads` |
| `catering_pipeline` | 11 | `lead_source = 'portal' AND customer_id IN test_customers` |
| `catering_portal_sessions` | 20 | `customer_id IN test_customers` |
| `catering_portal_tokens` | 25 | `lower(email) IN (the two test emails)` |
| `catering_portal_rate_limits` | all | transient |
| `catering_customers` | 2 | the two test emails |

**Untouched:** the 5 real leads and their 8 events, `toast_catering_orders`, `ezcater_events`, `audit_log` (rows that reference deleted ids stay — orphaned `resource_id`s are forensic evidence per the law), `customer_feedback` (0 catering rows).

**Audit:** one row, action **`catering.test_data_purge`** (new; registered in `lib/audit-actions.ts` AND `DESTRUCTIVE_ACTIONS` — a human act deleting shared operational rows), `actor_id` null, `metadata = { actor_context: "migration_apply", migration: "0193", ruling: "Juan 2026-09-05", counts: {…}, ids: {…}, test_emails: […] }`, `destructive = true` set literally (SQL path bypasses `isDestructive`; `RESERVED_ACTIONS`-style note in the registry).

**Order:** children before parents exactly as the table above; wrapped in one transaction; `ASSERT`s guard every count. Applied via MCP on Juan's explicit "confirm purge" after he reads this manifest; lands in the repo in the same PR as the code below.

**Side effect to name:** Juan's own portal account disappears. His next portal test starts from a fresh intake — expected and fine; future test leads are avoided by using the sim sandbox project, not prod.

## 2. Insights v2

**RPC `catering_insights_v2(p_location_ids uuid[], p_today date)`** (SECURITY DEFINER, `search_path = pg_catalog, public`, EXECUTE revoked from `anon` and `authenticated` — the 0189 lesson), replacing `catering_insights` (dropped in the same migration). Returns one JSONB with four windows keyed `this_week` (Mon–Sun ET containing `p_today`), `this_month`, `last_30` (29 days back through today), `all_time`, each:

| Field | Definition |
|---|---|
| `leads_new` | leads with `created_at::date` in window |
| `by_source` | `{source: count}` of those leads (`lead_source`, legacy free text verbatim) |
| `by_stage` | `{stage: count}` of leads **whose event_date is in window** (what's happening), not created — inquiry / quote_sent / confirmed / out / completed / lost |
| `booked_events` | count of leads `stage IN ('confirmed','out','completed')` with `event_date` in window |
| `booked_value_cents` | `SUM(COALESCE(q.total_cents, p.estimated_revenue_cents))` over those leads, where `q` = the live accepted quote of the lead if any (`superseded_at IS NULL AND status='accepted'`) — one value per lead, never both |
| `lost` | leads with stage `lost` **created** in window |
| `win_rate_bps` | `booked_created / (booked_created + lost)` over leads created in window whose stage is settled (`confirmed/out/completed/lost`); null when denominator 0 — never a fake 0% |
| `avg_headcount` | over booked events in window |
| `pipeline_open_value_cents` | (all windows identical, current state) `SUM(estimated_revenue or live quote total)` over open leads `stage IN ('inquiry','quote_sent')` |

Plus top-level `calendar`: every lead `stage IN ('confirmed','out','completed')` with `event_date` between `p_today - 30` and `p_today + 90`: `{id, event_date, time_window, name (event_name ?? company ?? contact_name), headcount, source, stage, location_id, value_cents}`.

**Why event_date for money and created_at for leads:** revenue is realized when the event happens; lead flow is measured when it arrives. Mixing them is how the old page lied. Every number on the page says which one it is.

**Page `/catering/insights`** (floor unchanged, level 5): a window switcher (four pills, default this month) over the numbers; a source breakdown; the stage strip; and the **calendar**: a month grid (ET, Mon-start) with a dot per booked event (colour by stage: confirmed gold, out ink, completed green-text), tap a day → the day's events listed under the grid (time, name, headcount, source, value at this floor). Prev/next month; defaults to the current month; 90 days forward of data. Disclosure doctrine: summary numbers first, calendar and breakdowns in collapsible sections; en + es keys for every string; `formatDateLabel`/`formatTime` helpers. Pure logic (`lib/catering/insights-shared.ts`): window bounds in ET, grid construction, event grouping — vitest-covered. Loader keeps the bounded `customer_feedback` list.

## 3. Same-day sales pinger

- New route **`GET /api/cron/toast-sales-today`**: for every active location with Toast configured, `pullSalesSystemTrigger(locationId, todayEt, { context: "pinger" })` — **events only** (the EVENTS-ONLY law is untouched; the nightly cron remains the sole ledger materializer). Auth: `x-cron-secret` = **`CATERING_SCAN_SECRET`** (the dedicated low-blast desktop secret; same blast class — read-only Toast pulls; `CRON_SECRET` never leaves Vercel). `maxDuration` 120. Per-location debounce inside the lib: skip when the last attempt for (location, today) is < 8 min old (reuses the audit-row debounce, parameterised). Response = per-location result summary, no secrets.
- Desktop: `C:\co\bin\catering-scan.cmd` gains a second curl to the new route; `CO_CateringScan` keeps its 10-minute cadence 06:00–22:00 ET. The pulse's own on-visit trigger stays (belt and braces); the panel's "as of HH:MM" already tells the truth.
- Staleness after this: ≤ 10 min in business hours regardless of visits.

## 4. Pulse catering panel v2

`CateringDueItem` gains `stage` (`confirmed|out`), `source` (`lead_source`), `dueTime` (from `time_window`; Toast leads carry `promised_at`'s time there already), and the pulse gains `cateringTomorrow: number` + `cateringTomorrowFirst: string | null` (time window of the earliest). Component: stage chip (confirmed = gold badge tint, out = ink), source label in plain English (Toast · ezCater · Portal · Staff · Phone · Walk-in), time front and center as today, headcount, delivery/pickup; footer line "Tomorrow: 2 events, first at 11:30" or "Tomorrow: none". Still no revenue at the level-4 floor. Loader: one query for today (`stage IN ('confirmed','out')`), one count+min for tomorrow; fail-open per lane as the pulse does. i18n en + es. Tests: shared mapping (source labels, chip variants) and the tomorrow summary are pure and vitest-covered.

## Testing & rollout
- vitest: insights window math + calendar grid + tomorrow summary + source labels; existing pulse/pipeline tests untouched.
- Migration 0193 dry-run on the sim project first (its counts differ — the `ASSERT`s are prod-derived, so the sim run is `--dry` with counts logged, not asserted).
- One PR (code + migration file), CI green, smoke on the preview: `/catering/insights` shows 5 booked events and ≈$2,800 booked value all-time after the purge; `/mid-shift` shows stage chips and the tomorrow line; the pinger route 200s with the desktop secret and 401s without.
- Juan clicks merge; purge applied via MCP on his "confirm purge"; desktop task updated by CC over ssh.
