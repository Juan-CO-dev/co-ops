# Employee Self-View — "My Performance" (Design)

**Date:** 2026-06-18
**Status:** Approved design, pre-plan
**Builds on:** the People/Team Operating-Health module (`lib/team-metrics.ts` — `loadPersonDetail`, role-scoped scoring, the trends time-engine) and the existing `/my-feedback` page (`lib/pm-report.ts loadMyFeedback`).
**Cycle:** the positive/own-only fast-follow to PR #70 (manager team-view). Free-text search is the separate next cycle.

---

## Goal

Give every employee their own **"My Performance"** page — their contribution, streaks, MVP wins, gradient highlights, and on-time over time — framed **positively and for themselves**. It absorbs the existing `/my-feedback` PM-eval list as one section. This is the self-facing counterpart to the AGM+ manager team-view: same engine, opposite posture (encouragement, not ranking/triage).

## Audience, scope, framing

- **All levels see their OWN data only.** The hard rule: `personId === viewer.userId` (you can always see yourself; no one else). No AGM+ gate.
- **Per-location with a switcher** — reuse `accessibleLocations(actor)`; single-location staff see no switcher. The selected location is validated via `lockLocationContext` (the employee may only view locations they're assigned to). Metrics AND the Feedback section both filter to the selected location.
- **Positive-leaning, score shown, NO rank, NO ⚠ needs-attention.** The composite role-scoped **score is shown as a personal stat** (with a +/−% vs-previous delta and a one-line "counts the work your role is here to do" demystifier) — but never a rank, and the manager-side `health: "needs_attention"` flag/reasons are **never rendered**. Even a quiet period reads neutrally/encouragingly, never as a flag.
- **Time:** Day / Week / Month + compare (reuse `TrendControls`, `basePath="/my-feedback"`).
- **Manager-private notes never appear** (the existing `loadMyFeedback` already omits `note` — preserved). The employee's own `area_to_improve` IS shown, framed as "area to grow."
- **Toast-blocked:** clock-in / early-arrival streaks + punctuality → small footnote, not faked (same as elsewhere).

## Surface

- **Route stays `/my-feedback`** (the PM module's `shift_feedback` notification deep-links there — renaming the URL would break it). The **label + page title** change to "My Performance"; the nav chip relabels. The PM-eval list absorbs in as the bottom "Feedback from shifts" section.

Page layout (approved mockup), top → bottom:
1. **Header** — "My Performance" + location switcher (when >1) + Day/Week/Month + compare controls.
2. **Positive hero** — an encouraging read line + the **score** (large) with vs-previous delta + the demystifier line + a **wins strip** (🔥 active-day streak · ⭐ MVP wins · 🏅 personal-best day · ✓ on-time %).
3. **Your contribution** — tasks-per-bucket chart (`LineChart`) + a positive one-liner.
4. **On-time completion** — task-window % chart + one-liner (explicitly NOT clock-in).
5. **How managers have rated you** — the gradient distribution (great/good/needs-work) as a segmented bar, framed warmly.
6. **🔥 Streaks** — active-day / on-time / personal-best (+ MVP) chips + the Toast footnote.
7. **Feedback from shifts** — the absorbed `loadMyFeedback` evals (per-shift gradients + "area to grow"), filtered to the selected location, with the explicit "manager-private notes are never shown here" reassurance line.

## Architecture (reuse, don't duplicate)

`loadPersonDetail` already computes everything we need, but it (a) gates AGM+ and (b) frames around rank/health. Refactor for clean reuse:

- **Extract a private `computePersonMetrics(service, { personId, locationId, granularity, compare, today })`** in `lib/team-metrics.ts` returning the raw bundle (`counts`, `current`/`previous` `CategoryCounts`, `score`, `previousScore`, `scoreDeltaPct`, `bucketKeys`, `contribution`, `onTime`, `overallOnTime`, `gradientTally`, `streaks`, `signals`). `loadPersonDetail` becomes: AGM+ gate + roster IDOR + `computePersonMetrics` + manager read (`personReadNarrative`) — **behavior-preserving** (verified by re-running the existing detail/roster smokes).
- **New `loadMyPerformance(service, { viewer, locationId, granularity, compare, today })`** in `lib/team-metrics.ts`: gate = the viewer is assigned (`user_locations`) to `locationId` AND active (and `personId` is implicitly `viewer.userId`); calls `computePersonMetrics({ personId: viewer.userId, ... })`; returns the metric bundle + a **positive `read`** + a `wins` summary; **no `health`/`reasons`/rank** in the returned shape (so the page literally cannot render them).
- **`lib/people-narrative.ts`** gains positive-only generators: `myPerformanceRead(input)` (picks an encouraging key by the strongest positive signal — top streak / MVP / strong gradients / contribution-up / steady) and `myWins(input)` (the wins-strip items). Never selects a "needs attention" key.
- **Components** (`components/team/` or a new `components/me/`): `MyPerformance.tsx` (the page body — hero + sections, reusing `LineChart`), and a small location-switcher (reuse the dashboard's pattern or a simple `Link` pill row). The Feedback section reuses the existing `/my-feedback` rendering (lift the eval-item markup into a shared `MyFeedbackList` if it isn't already a component, else reuse in place).
- **Page** `app/(authed)/my-feedback/page.tsx` is rewritten to: auth → resolve accessible locations + selected location (`?loc=`) → `loadMyPerformance` + `loadMyFeedback` (filtered to the selected location) → render `MyPerformance`.

## i18n

New `me.*` (or `pm.my_feedback.*`-adjacent) keys EN+ES for the title, hero read variants, wins labels, section headings, demystifier, reassurance, Toast footnote. Reuse existing `pm.my_feedback.*` where they already fit. Nav label → "My Performance" (`nav.my_feedback` value updated, or a new `nav.my_performance`). Parity maintained. Spanish tú-form. Language-aware dates via `lib/i18n/format.ts`.

## Security

- `personId === viewer.userId` is the invariant — the loader never accepts an arbitrary personId (it derives person from the session). No cross-person exposure possible.
- `lockLocationContext` validates the selected location belongs to the viewer (IDOR on the `?loc=` param).
- `loadMyFeedback` keeps omitting the manager `note` (column never selected) — preserved.

## Verification (no test framework)

`tsc` + `next build` + throwaway `tsx` smokes on live rows:
- `computePersonMetrics` extraction is behavior-preserving: `loadPersonDetail` output unchanged for a known member (re-run the people-metrics detail/roster smokes).
- `loadMyPerformance` returns metrics for the viewer's own id; returns null/blocked for a location the viewer is NOT assigned to (IDOR); the returned shape has NO `health`/`rank` fields.
- Score matches `loadPersonDetail`'s score for the same person+location+window (consistency).
- `aiInsight` not applicable here (manager-only); confirm the positive read never yields a needs-attention key.
- Feedback section omits the manager note.

## Deferred (tracked)

- **Public profiles** (peers see each other's positive highlights) — the Profile module; this self-view's positive-computable data feeds it later.
- AI-generated encouragement; clock-in streaks/punctuality (Toast); per-category multipliers.
- **Free-text search** — the next cycle.
