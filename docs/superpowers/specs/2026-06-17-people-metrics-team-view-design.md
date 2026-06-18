# People / Team Operating-Health — Manager Team-View (Design)

**Date:** 2026-06-17
**Status:** Approved design, pre-plan
**Builds on:** the merged trends engine (`lib/reports-trends.ts` — day/week/month + period-over-period compare, `computeWindows`/`bucketStart`/`BUCKET_COUNT`) and chart primitives (`components/trends/{LineChart,BarChart}`), plus `lib/report-signals.ts`.
**Cycle:** Wave 3 follow-up #3 (people metrics — the cycle deferred during trend charts). Free-text search still queued separately.

---

## Goal

Give **AGM+ (level ≥ 6)** a per-location, role-aware **operating-health view of the team** — so MoO+ and on-site senior managers can confirm *every seat is doing its job*. Each person is scored against **what their role is supposed to do** (not raw task volume), with a ranked roster, rich per-person detail, and **narrative reads** (charts + plain-language interpretation), reusing the trends time-engine.

## Audience & privacy (the spine)

- **View gate: level ≥ 6 (AGM+).** AGM/catering/prep/social-mgr (6), GM (7), MoO (8), Owner (9), CGS (10). This is the manager-eyes-only ranked surface — it must never become peer-visible. The positive/own-only **employee self-view is a deferred fast-follow**.
- **Ranked roster = active users assigned to the location (`user_locations`) with `level < 8` (below MoO).** AGM/GM are ranked subjects; **MoO/Owner/CGS are excluded from ranking** (they're the oversight audience, not subjects).
- **Per-location** (matches the hub's `?location=` model). IDOR two-halves: page validates `?location=` via `lockLocationContext`; every loader query binds `location_id = <authorized>`.
- Because the viewer is AGM+ (≥ 6 > the L5 notes tier), manager notes / area-to-improve are visible on this surface.

## Scoring model — role-scoped counting

Five measurable, attributable **action categories** (all from existing data):

| Category | Source |
|---|---|
| **Tasks** | live `checklist_completions.completed_by` |
| **Finalizations** | reports owned: `confirmed_by` (opening/closing/prep), `signed_by` (cash), `submitted_by` (pm) |
| **People-mgmt** | PM evals authored (`pm_reports.submitted_by`) + MVPs awarded (`pm_reports.mvp_user_id` is the recipient; awarding is the submitter's action) |
| **Oversight** | significant `audit_log` actions by `actor_id` (revokes, `report.update`, corrections, tag/authority actions) |
| **Notes** | substantive notes written: `checklist_completions.notes`, `cash_reports.over_short_note`, `pm_employee_evals.area_to_improve`/`note` |

**Role → expected categories**, keyed by **role code, not level** (critical: `trainer` and `key_holder` are both level 4 but have different expected work). Default mapping; a reserved per-category multiplier hook allows finer tuning later — v1 uses weight 1 for expected, 0 for off-role. Unknown/unmapped role codes default to `Tasks, Notes`.

| Role codes | Expected categories |
|---|---|
| `prospect`, `hired_not_yet_worked`, `trainee`, `employee`, `trainer` | Tasks, Notes |
| `key_holder`, `shift_lead` | Tasks, Finalizations, Notes, Oversight |
| `agm`, `gm`, `catering_mgr`, `prep_mgr`, `social_media_mgr` | Finalizations, People-mgmt, Oversight, Notes |

`moo` / `owner` / `cgs` are **excluded from ranking** (the `level < 8` roster filter), so they have no expectation row.

- **Score** = sum of a person's actions across **their role's expected categories** over the window. Off-role actions are shown as context but not scored.
- **Health flag** ● on-track / ⚠ needs-attention: ⚠ when an expected category has ~zero activity in the window, or the person's score dropped sharply vs the previous window. Drives the team banner ("5 of 7 on track · 2 need attention").
- Cross-role ranking is fair because each person is measured against their own role's expectations; the roster shows each person's **role** so a GM low on Tasks isn't misread.

## Narrative (rich, deterministic + reserved AI slot)

- **Rule-based narrative** is the always-on mechanism: deterministic phrases assembled from thresholds + deltas (e.g., "Top contributor (+22%), consistently on-time" / "Tasks down 40%, no notes — worth a check-in, support not discipline"). Fully i18n EN/ES. Lives in `lib/people-narrative.ts`.
- **Reserved AI-insight slot:** the per-person data shape carries `aiInsight: string | null` (always `null` this cycle) and the detail renders a clearly-deferred "AI Insight" placeholder panel. No AI is built now; the seam exists so an AI module can fill it later without rework.

## Surfaces (this cycle)

**1. Trends landing restructure** — `/reports/trends` becomes a **landing**: two entry cards (**Ops Trends**, **Team** [AGM+ only]) + a **"⚡ Relevant right now"** auto-curated attention strip (worst-trending ops signals + people needing a check-in, each linking into the right sub-view) + **section snapshots** (Ops snapshot, Team snapshot) with view-all links. The Team card/highlights render only for AGM+.

**2. Ops sub-view** — the existing #69 four-card ops page **moves to `/reports/trends/ops`** (unchanged content). The dashboard ops widget + hub "View trends" link point at the landing.

**3. Team sub-view** — `/reports/trends/team` (AGM+): the **rich-card roster** (layout B) — team narrative banner + one card per ranked person (sparkline + category breakdown + per-person narrative + ●/⚠). Tap a card → person detail.

**4. Person detail** — `/reports/trends/team/[personId]` (AGM+): header (name · role · tenure · last-active · score · health); **"The read"** deterministic narrative; reserved **AI Insight** placeholder; metric sections on the trends engine — **Contribution** (tasks over time), **On-time** (task-window % — explicitly NOT clock-in), **PM gradients** (great/good/needs-work distribution over time); **🔥 Streaks (our data)** — active-day streak, on-time streak, personal-best day (same-station streak optional); **Signals** chips — MVP awards, flagged-to-improve, most-active day, tenure; a small footnote that *clock-in / early-arrival* streaks + punctuality need Toast.

**5. Dashboard team widget** — layout C (dense table + expand), **AGM+ only**, rendered alongside the existing ops `TrendsWidget`: ranked rows (name/role/score/●⚠), tap a row to expand its breakdown + narrative; links to the Team sub-view.

## Data sources summary (all existing — no migrations)

Contribution/Tasks, Finalizations, People-mgmt, Oversight (audit_log), Notes — as in the scoring table. **Streaks & activity patterns** are derived from the per-person completion/finalization **timestamp series** the trends engine already buckets (consecutive active days, consecutive in-window finalizations, max single-day count). **Tenure** = `users.created_at`; **last-active** = max activity timestamp across the person's actions. **No new tables or migrations** — pure read surface.

## Toast-blocked (honest placeholders, not faked)

Only **clock-in / early-arrival streaks** and **individual punctuality** ("on time" in the attendance sense) are Toast-blocked — same wall as PM "arrived ready." Shown as a small "needs Toast" footnote on the detail, not as fabricated numbers. (Our-data streaks above are NOT blocked.)

## Architecture

- **`lib/team-metrics.ts`** (new) — `loadTeamOperatingHealth({ service, viewer, locationId, granularity, compare, today })` → ranked roster (per-person score, category breakdown, health, narrative) + team summary; `loadPersonDetail({ service, viewer, personId, locationId, granularity, compare, today })` → per-person metric series (reusing trends buckets), streaks, signals, narrative, `aiInsight: null`. Bulk-load per location/window (no N+1). Reuses `computeWindows`/`bucketStart` from `lib/reports-trends.ts`.
- **`lib/people-narrative.ts`** (new) — deterministic narrative assembly (thresholds/deltas → i18n keys + params), for team banner, per-person card lines, and "the read."
- **Action-category attribution helpers** — pure functions mapping each source row to a category + person; oversight reads `audit_log` by `actor_id` over a curated action set.
- **Components** (`components/team/`) — `TeamRosterCard` (B), `TeamRosterTable` (C, dashboard widget), `PersonDetail` sections, `TrendsLanding` (entry cards + attention strip + snapshots). Charts reuse `components/trends/{LineChart,BarChart}`.
- **Pages** — restructure `app/(authed)/reports/trends/page.tsx` → landing; move ops content to `app/(authed)/reports/trends/ops/page.tsx`; add `app/(authed)/reports/trends/team/page.tsx` + `app/(authed)/reports/trends/team/[personId]/page.tsx` (both AGM+ gated, redirect on under-level). Dashboard widget wired into `app/(authed)/dashboard/page.tsx` (AGM+ only).
- **i18n** — `reports.trends.team.*` + `people.*` keys EN+ES, same PR; language-aware via `lib/i18n/format.ts`.

## Verification (no test framework)

`tsc --noEmit` + `next build` + throwaway `tsx` smokes on **live rows**:
- Role-scoped score counts only expected categories; off-role actions excluded from score, present in breakdown.
- Roster excludes MoO+ (level ≥ 8); includes AGM/GM; only location-assigned active users.
- **View gate:** `loadTeamOperatingHealth` for an L5 viewer is unauthorized (page redirects); L6+ authorized.
- **IDOR:** a `locationId` the viewer can name never leaks another store's people; cross-location rows excluded.
- Health flag fires on a zero expected-category / sharp-drop; narrative non-empty and parameterized.
- Streaks computed correctly from a known timestamp series; `aiInsight` is `null`.
- Trends landing renders Ops for all, Team card only for AGM+.

## Deferred (tracked)

- **Employee self-view** (positive/own-only "my performance" page) — fast-follow.
- **AI-generated insight** — reserved slot; maybe-bucket.
- **Clock-in / early-arrival streaks + punctuality** — Toast-blocked.
- **Per-category multipliers** (finer weighting than role-scoped 1/0) — reserved hook.
- **Free-text search** — separate cycle.
