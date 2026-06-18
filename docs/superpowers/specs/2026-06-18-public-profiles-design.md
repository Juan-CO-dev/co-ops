# Public Employee Profiles (Design)

**Date:** 2026-06-18
**Status:** Approved design, pre-plan
**Builds on:** the My Performance self-view (#71) + the team-metrics engine (`lib/team-metrics.ts` — streak helpers, completion/eval data). Fills the existing `/profile` coming-soon stub (`nav.profile` chip).
**Cycle:** Juan's deferred "Profile module" — the peer-visible, positive counterpart to the private self-view.

---

## Goal

A peer-visible, **positive-only** profile for each employee — MVP wins, "mostly Great" ratings, streaks, contribution, tenure, and a recent task-velocity sparkline. Teammates who share a location can look each other up via a directory. **Never** shows scores, needs-work, areas-to-improve, or any note.

## Visibility & data model

- **Viewer must share at least one location with the target** (`user_locations` intersection). Otherwise the profile is not viewable (redirect to the directory). The gate is about *who can look you up* — not field redaction (all profile data is positive by design).
- **Data is the person's aggregate** (across all locations they work) — a profile is about the person, not a location. Since CO is 2 locations and most staff are single-location, aggregate ≈ their location anyway.
- **All-time headlines + a recent trend** (the velocity sparkline). No per-viewer variation in the data — only in *whether* you can view it.
- It's a **stats card**, not a bio/photo profile (no new storage; **no migration**). Avatar = initial.

## Public projection (positive-only — the privacy contract)

Shown:
- **MVP wins** (all-time count of `pm_reports.mvp_user_id = target`).
- **Tasks all-time** (count of live `checklist_completions.completed_by = target`).
- **Tenure** (`users.created_at` → "N months on the team") + **location(s)** (codes).
- **Streaks** — current active-day streak + **longest** active-day streak + personal-best day (our-data; clock-in streaks Toast-deferred).
- **"Mostly Great" manager ratings** — the Great/Good distribution from `pm_employee_evals` (employee_id = target). The bar shows **Great vs Good proportions only**; the needs-work count is computed for nothing user-facing and is **never displayed** (positive-only by design).
- **Recent task-velocity sparkline** — tasks/day over a recent window (~30 days), from `completed_at`.

**Never shown:** role-scoped score, needs-work count, area-to-improve, completion/cash/PM notes, MVP notes, flagged-to-improve. (These never enter the public loader's output.)

## Surfaces

- **`/profile`** — the **directory**: active teammates the viewer shares a location with, each as a card (avatar initial · name · role · one headline highlight — MVP count if >0, else current streak, else task count). The `nav.profile` chip opens it (replaces the coming-soon stub). The viewer's own card is present (a "how others see me" preview).
- **`/profile/[userId]`** — the public profile card (the approved layout). Not-viewable (no shared location / inactive / not found) → redirect to `/profile`.

## Architecture

- **`lib/profiles.ts`** (new):
  - `loadProfileDirectory(service, { viewer: { userId, locations } })` → `DirectoryEntry[]` (`{ userId, name, role, headline: { kind: "mvp"|"streak"|"tasks"; value: number } }`) for active users sharing ≥1 location with the viewer (incl. the viewer). One bulk pass: resolve the viewable user set via `user_locations` intersection, then a light per-headline aggregate.
  - `loadPublicProfile(service, { viewerUserId, viewerLocations, targetUserId })` → `PublicProfile | null`. Returns `null` unless the target is active AND shares a location with the viewer. Then assembles the positive aggregate: `mvpWins`, `tasksAllTime`, `tenureDays`, `locationCodes[]`, `streaks { current, longest, personalBest }`, `gradient { great, good }` (needs-work omitted), `velocity (number|null)[]` (recent daily series).
  - All-time counts via Supabase `{ count: "exact", head: true }` (don't load rows). Streak/velocity from the target's `completed_at` series (timestamps only), paginated via `selectAllRows` (the shared util). Reuses `activeDayStreak`/`personalBest` from `lib/team-scoring`; add a small `longestStreak(dates)` pure helper there.
  - **Security:** `targetUserId` is gated by the shared-location check before any aggregate runs; positive fields only; no note/score/needs-work column is ever selected for display.
- **Components** (`components/profile/`): `ProfileDirectory` (the grid), `PublicProfileCard` (header + highlight tiles + velocity sparkline [reuse `components/trends/LineChart` or a small bar] + "mostly Great" segmented bar + reassurance line).
- **Pages:** rewrite `app/profile/page.tsx` (stub → directory); create `app/profile/[userId]/page.tsx`. Both auth-gated; the directory uses `auth.locations`; the detail enforces the shared-location gate via the loader.
- **i18n** `profile.*` EN+ES (title, directory heading, tenure "N months"/"N days", highlight labels, velocity, ratings "mostly Great", reassurance, empty states, Toast footnote for clock-in streaks). Language-aware.

## Verification (no test framework)

- `tsc` + `next build`.
- Pure smoke: `longestStreak` (gaps, single, empty, all-contiguous).
- Live smoke: `loadPublicProfile` returns positive aggregate for a target sharing the viewer's location; **returns null** for a target the viewer shares NO location with (visibility gate); the returned object has **no** `score`/`needsWork`/`areaToImprove`/`note` keys; `loadProfileDirectory` lists only shared-location active users (incl. viewer); MVP/tasks counts match a hand count for a known user.

## Deferred (tracked)

- Company-wide profiles (Juan chose same-location for now).
- Bio / photo / avatar upload (needs storage).
- Profile links from names elsewhere in the app (team view, report rows) — the "link app-wide" option; a later reach-expansion.
- Clock-in streaks / punctuality (Toast).
- Opt-out toggle (positive-only → low need now).
