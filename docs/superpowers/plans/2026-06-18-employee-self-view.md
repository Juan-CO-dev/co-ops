# Employee Self-View "My Performance" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A positive, own-only "My Performance" page (all levels, per-location switcher, score shown but no rank / no ⚠), reusing the people-metrics engine and absorbing the existing `/my-feedback` eval list.

**Architecture:** Extract a private `computePersonMetrics` core from `loadPersonDetail` (behavior-preserving), then add `loadMyPerformance` (self-gate + positive narrative, no health/rank in its return shape). New positive narrative generator. New `MyPerformance` component. The `/my-feedback` page is rewritten to render it; route + notification deep-link stay.

**Tech Stack:** Next.js 16 App Router (Server Components), React 19, TS strict + `noUncheckedIndexedAccess`, Supabase service-role reads, Tailwind v4. No test framework — `tsc --noEmit` + `next build` + throwaway `tsx` smokes on live rows. **No migrations.**

**Branch:** `claude/employee-self-view` (created; spec committed there).

**Spec:** `docs/superpowers/specs/2026-06-18-employee-self-view-design.md`

---

## Ground-truth (verified against live code/schema — do not re-assume)

- **`lib/team-metrics.ts`** `loadPersonDetail` (lines ~281–461) computes everything via an inline body. Module-private helpers already present: `opDate`, `WEEKDAYS`, `selectAllRows`, `OVERSIGHT_ACTIONS`, `RANKED_MAX_LEVEL`, `TEAM_VIEW_LEVEL`. Imports already present: `scoreFromCounts`, `healthFromCounts`, `activeDayStreak`, `onTimeStreak`, `personalBest`, `emptyCounts`, `ROLES`, `RoleCode`, `personReadNarrative`, `computeWindows`, `bucketStart`, types `CategoryCounts`/`ActionCategory`/`Health`/`NarrativeLine`/`TrendGranularity`/`Viewer`/`PersonStreaks`/`PersonSignals`. **The extraction reuses all of these in-file — no new imports needed for Task 1.**
- **`lib/pm-report.ts`** `loadMyFeedback(service, { userId }): Promise<MyFeedbackItem[]>`; `MyFeedbackItem = { id, date, locationId, arrivedReady, attitude, production, teamPlayer, areaToImprove: string|null, wasMvp }`. NEVER selects `note`. Spans all locations, sorted date desc. Type `Gradient = "great"|"good"|"needs_work"`.
- **`lib/locations.ts`** `accessibleLocations(actor: LocationActor): string[] | "all"` ("all" for level ≥ 9); `lockLocationContext(actor, locationId): boolean`; `LocationActor = { role, locations }`.
- **Current `app/(authed)/my-feedback/page.tsx`**: `requireSessionFromHeaders("/my-feedback")`, no location param, renders eval cards; uses `pm.my_feedback.*` + `pm.eval.*` + `pm.attitude.*` (`GRADIENT_KEY` map) i18n. `DashboardBackLink`.
- **Nav:** `components/DashboardNav.tsx` has `{ key: "nav.my_feedback", href: "/my-feedback", scoped: false }`; `nav.my_feedback` value = "My Feedback" / "Mi Retroalimentación".
- **Reuse for the page:** dashboard's `?loc=` selected-location pattern; `LineChart` from `components/trends/LineChart`; `TrendControls` from `components/trends/TrendControls` (has `basePath` prop); `formatDateLabel` from `lib/i18n/format`.
- **NO migrations.** Pure read surface.

---

## File structure

- **Modify `lib/team-metrics.ts`** — extract `computePersonMetrics` + `PersonMetrics` type; rewire `loadPersonDetail`; add `loadMyPerformance` + `MyPerformanceData`/`MyWins` types.
- **Modify `lib/people-narrative.ts`** — add `myPerformanceRead` (positive-only).
- **Create `components/me/MyPerformance.tsx`** — the page body (hero + score + wins + charts + gradients + streaks + feedback). Reuses `LineChart`.
- **Modify `app/(authed)/my-feedback/page.tsx`** — resolve locations + selected `?loc=` → `loadMyPerformance` + `loadMyFeedback` → render `MyPerformance`.
- **Modify `lib/i18n/en.json` + `es.json`** — `me.*` keys; relabel `nav.my_feedback`.

---

### Task 1: Extract `computePersonMetrics` + rewire `loadPersonDetail` (behavior-preserving)

**Files:** Modify `lib/team-metrics.ts`; Smoke `scripts/smoke-extract-unchanged.ts` (throwaway).

- [ ] **Step 1: Add the `PersonMetrics` interface** to `lib/team-metrics.ts` (immediately above the `loadPersonDetail` function / its doc comment):

```ts
/** Raw per-person metric bundle shared by loadPersonDetail (manager) and
 *  loadMyPerformance (self). No health/read/rank — callers layer those on. */
export interface PersonMetrics {
  counts: CategoryCounts;
  score: number;
  previousScore: number | null;
  scoreDeltaPct: number | null;
  bucketKeys: string[];
  contribution: (number | null)[];
  onTime: (number | null)[];
  overallOnTime: number | null;
  gradientTally: { great: number; good: number; needsWork: number };
  streaks: PersonStreaks;
  signals: PersonSignals;
}

/**
 * Core per-person metric computation over a window at one location. Pure of
 * gating/framing — the caller fetches the user + decides access and narrative.
 * SECURITY: reads only data for `personId` at `locationId`; callers enforce who
 * may view it.
 */
async function computePersonMetrics(
  service: SupabaseClient,
  args: { personId: string; role: RoleCode; createdAt: string; locationId: string; granularity: TrendGranularity; compare: boolean; today: string },
): Promise<PersonMetrics> {
  const { currentKeys, previousKeys, loadFrom } = computeWindows(args.today, args.granularity, args.compare);
  const curSet = new Set(currentKeys);
  const prevSet = new Set(previousKeys ?? []);
  const toIncl = args.today;

  const current = emptyCounts();
  const previous = emptyCounts();
  const windowOf = (tstz: string): "cur" | "prev" | null => {
    const bs = bucketStart(opDate(tstz), args.granularity);
    return curSet.has(bs) ? "cur" : prevSet.has(bs) ? "prev" : null;
  };
  const add = (tstz: string, cat: ActionCategory) => {
    const w = windowOf(tstz);
    if (w === "cur") current[cat]++;
    else if (w === "prev") previous[cat]++;
  };

  const contribBucket = new Map<string, number>();
  const activeDates = new Set<string>();
  const dayTaskCounts = new Map<string, number>();
  const weekdayCounts = new Map<string, number>();
  let lastActive: string | null = null;
  const touch = (d: string) => { if (!lastActive || d > lastActive) lastActive = d; activeDates.add(d); };

  const instAll = await selectAllRows<{ id: string }>(
    (from, to) => service
      .from("checklist_instances").select("id").eq("location_id", args.locationId)
      .order("id", { ascending: true }).range(from, to),
  );
  const locInstanceIds = instAll.map((r) => r.id);

  // TASKS + NOTES
  if (locInstanceIds.length) {
    const comps = await selectAllRows<{ completed_at: string; notes: string | null }>(
      (from, to) => service
        .from("checklist_completions").select("completed_at, notes")
        .eq("completed_by", args.personId).in("instance_id", locInstanceIds)
        .gte("completed_at", `${loadFrom}T00:00:00Z`).lte("completed_at", `${toIncl}T23:59:59Z`)
        .is("superseded_at", null).is("revoked_at", null)
        .order("completed_at", { ascending: true }).range(from, to),
    );
    for (const c of comps) {
      add(c.completed_at, "tasks");
      if (c.notes && c.notes.trim()) add(c.completed_at, "notes");
      if (windowOf(c.completed_at) === "cur") {
        const d = opDate(c.completed_at);
        const bs = bucketStart(d, args.granularity);
        contribBucket.set(bs, (contribBucket.get(bs) ?? 0) + 1);
        touch(d);
        dayTaskCounts.set(d, (dayTaskCounts.get(d) ?? 0) + 1);
        const wd = WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
        weekdayCounts.set(wd, (weekdayCounts.get(wd) ?? 0) + 1);
      }
    }
  }

  // FINALIZATIONS (+ on-time)
  const finalsChrono: { at: string; inWindow: boolean }[] = [];
  const { data: finInst } = await service
    .from("checklist_instances").select("date, confirmed_at")
    .eq("location_id", args.locationId).eq("confirmed_by", args.personId).not("confirmed_at", "is", null)
    .gte("confirmed_at", `${loadFrom}T00:00:00Z`).lte("confirmed_at", `${toIncl}T23:59:59Z`);
  for (const f of (finInst ?? []) as Array<{ date: string; confirmed_at: string }>) {
    add(f.confirmed_at, "finalizations");
    if (windowOf(f.confirmed_at) === "cur") { finalsChrono.push({ at: f.confirmed_at, inWindow: opDate(f.confirmed_at) === f.date }); touch(opDate(f.confirmed_at)); }
  }
  const { data: cashRows } = await service
    .from("cash_reports").select("signed_at, over_short_note, report_date")
    .eq("location_id", args.locationId).eq("signed_by", args.personId).is("superseded_at", null)
    .gte("signed_at", `${loadFrom}T00:00:00Z`).lte("signed_at", `${toIncl}T23:59:59Z`);
  for (const c of (cashRows ?? []) as Array<{ signed_at: string | null; over_short_note: string | null; report_date: string }>) {
    if (!c.signed_at) continue;
    add(c.signed_at, "finalizations");
    if (c.over_short_note && c.over_short_note.trim()) add(c.signed_at, "notes");
    if (windowOf(c.signed_at) === "cur") { finalsChrono.push({ at: c.signed_at, inWindow: opDate(c.signed_at) === c.report_date }); touch(opDate(c.signed_at)); }
  }
  const { data: pmMine } = await service
    .from("pm_reports").select("id, submitted_at, report_date")
    .eq("location_id", args.locationId).eq("submitted_by", args.personId).is("superseded_at", null)
    .gte("submitted_at", `${loadFrom}T00:00:00Z`).lte("submitted_at", `${toIncl}T23:59:59Z`);
  for (const r of (pmMine ?? []) as Array<{ id: string; submitted_at: string | null; report_date: string }>) {
    if (!r.submitted_at) continue;
    add(r.submitted_at, "finalizations");
    add(r.submitted_at, "peopleMgmt");
    if (windowOf(r.submitted_at) === "cur") { finalsChrono.push({ at: r.submitted_at, inWindow: opDate(r.submitted_at) === r.report_date }); touch(opDate(r.submitted_at)); }
  }
  if (pmMine && pmMine.length) {
    const submittedAtById = new Map((pmMine as Array<{ id: string; submitted_at: string | null }>).map((r) => [r.id, r.submitted_at] as const));
    const { data: evAuthored } = await service
      .from("pm_employee_evals").select("pm_report_id, area_to_improve, note")
      .in("pm_report_id", (pmMine as Array<{ id: string }>).map((r) => r.id)).is("superseded_at", null);
    for (const e of (evAuthored ?? []) as Array<{ pm_report_id: string; area_to_improve: string | null; note: string | null }>) {
      const at = submittedAtById.get(e.pm_report_id);
      if (at && ((e.area_to_improve && e.area_to_improve.trim()) || (e.note && e.note.trim()))) add(at, "notes");
    }
  }

  // OVERSIGHT
  const { data: auditRows } = await service
    .from("audit_log").select("occurred_at").eq("actor_id", args.personId).in("action", OVERSIGHT_ACTIONS)
    .gte("occurred_at", `${loadFrom}T00:00:00Z`).lte("occurred_at", `${toIncl}T23:59:59Z`);
  for (const a of (auditRows ?? []) as Array<{ occurred_at: string }>) add(a.occurred_at, "oversight");

  // SCORE
  const score = scoreFromCounts(args.role, current);
  const previousScore = args.compare ? scoreFromCounts(args.role, previous) : null;
  const scoreDeltaPct = previousScore && previousScore > 0 ? Math.round(((score - previousScore) / previousScore) * 100) : null;

  // ON-TIME series + overall
  finalsChrono.sort((a, b) => (a.at < b.at ? -1 : 1));
  const onTimeByBucket = new Map<string, { hit: number; total: number }>();
  for (const f of finalsChrono) {
    const bs = bucketStart(opDate(f.at), args.granularity);
    const e = onTimeByBucket.get(bs) ?? { hit: 0, total: 0 };
    e.total++; if (f.inWindow) e.hit++;
    onTimeByBucket.set(bs, e);
  }
  let oh = 0, ot = 0;
  for (const e of onTimeByBucket.values()) { oh += e.hit; ot += e.total; }
  const overallOnTime = ot > 0 ? Math.round((oh / ot) * 100) : null;

  // PM GRADIENTS about this person + flagged-to-improve
  const { data: pmInLoc } = await service
    .from("pm_reports").select("id").eq("location_id", args.locationId).is("superseded_at", null)
    .gte("report_date", loadFrom).lte("report_date", toIncl);
  const repIds = (pmInLoc ?? []).map((r) => (r as { id: string }).id);
  let great = 0, good = 0, needsWork = 0, flaggedToImprove = 0;
  if (repIds.length) {
    const { data: evals } = await service
      .from("pm_employee_evals").select("arrived_ready, attitude, production, team_player, area_to_improve")
      .in("pm_report_id", repIds).eq("employee_id", args.personId).is("superseded_at", null);
    for (const e of (evals ?? []) as Array<{ arrived_ready: string; attitude: string; production: string; team_player: string; area_to_improve: string | null }>) {
      for (const g of [e.arrived_ready, e.attitude, e.production, e.team_player]) {
        if (g === "great") great++; else if (g === "good") good++; else if (g === "needs_work") needsWork++;
      }
      if (e.area_to_improve && e.area_to_improve.trim()) flaggedToImprove++;
    }
  }
  const { data: mvp } = await service
    .from("pm_reports").select("id").eq("location_id", args.locationId).eq("mvp_user_id", args.personId).is("superseded_at", null)
    .gte("report_date", loadFrom).lte("report_date", toIncl);
  const mvpAwards = (mvp ?? []).length;

  // ASSEMBLE
  const contribution = currentKeys.map((k) => (contribBucket.has(k) ? contribBucket.get(k)! : null));
  const onTime = currentKeys.map((k) => { const e = onTimeByBucket.get(k); return e && e.total > 0 ? Math.round((e.hit / e.total) * 100) : null; });
  const streaks: PersonStreaks = {
    activeDays: activeDayStreak([...activeDates], args.today),
    onTime: onTimeStreak(finalsChrono.map((f) => f.inWindow)),
    personalBest: personalBest([...dayTaskCounts.values()]),
  };
  let mostActiveDay: string | null = null; let mx = -1;
  for (const [wd, n] of weekdayCounts) if (n > mx) { mx = n; mostActiveDay = wd; }
  const tenureDays = Math.max(0, Math.round((Date.parse(`${args.today}T00:00:00Z`) - Date.parse(args.createdAt)) / 86400000));

  return {
    counts: current, score, previousScore, scoreDeltaPct,
    bucketKeys: currentKeys, contribution, onTime, overallOnTime,
    gradientTally: { great, good, needsWork }, streaks,
    signals: { mvpAwards, flaggedToImprove, mostActiveDay, tenureDays, lastActive },
  };
}
```

- [ ] **Step 2: Replace the body of `loadPersonDetail`** (everything after the `if (level >= RANKED_MAX_LEVEL) return null;` line) with a call to the core:

```ts
  const m = await computePersonMetrics(service, {
    personId: u.id, role: u.role, createdAt: u.created_at,
    locationId: args.locationId, granularity: args.granularity, compare: args.compare, today: args.today,
  });
  const { health, reasons } = healthFromCounts(u.role, m.counts, m.score, m.previousScore);
  const read = personReadNarrative({ rank: 0, role: u.role, health, reasons, scoreDeltaPct: m.scoreDeltaPct, onTimePct: m.overallOnTime });

  return {
    userId: u.id, name: u.name, role: u.role, level,
    score: m.score, previousScore: m.previousScore, counts: m.counts, health, reasons,
    read, aiInsight: null, bucketKeys: m.bucketKeys, contribution: m.contribution, onTime: m.onTime,
    gradientTally: m.gradientTally, streaks: m.streaks, signals: m.signals,
  };
}
```

Keep the `loadPersonDetail` head (the `viewer.level < TEAM_VIEW_LEVEL` gate, the `user_locations` IDOR check, the `users` fetch, and the `RANKED_MAX_LEVEL` check) exactly as-is. The result is byte-identical output to before — only the computation moved into the core.

- [ ] **Step 3: Behavior-preserving smoke** `scripts/smoke-extract-unchanged.ts` (wrap in `main()`):

```ts
import { loadTeamOperatingHealth, loadPersonDetail } from "@/lib/team-metrics";
import { getServiceRoleClient } from "@/lib/supabase-server";
function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }
async function main() {
  const sb = getServiceRoleClient();
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).order("code").limit(1).maybeSingle<{ id: string }>();
  if (!loc) { console.log("no loc"); return; }
  const today = new Date().toISOString().slice(0, 10);
  const team = await loadTeamOperatingHealth(sb, { viewer: { userId: "x", level: 6 }, locationId: loc.id, granularity: "day", compare: true, today });
  if (!team || !team.members.length) { console.log("no members"); return; }
  const m = team.members[0]!;
  const d = await loadPersonDetail(sb, { viewer: { userId: "x", level: 6 }, personId: m.userId, locationId: loc.id, granularity: "day", compare: true, today });
  assert(d !== null, "detail loads");
  assert(d!.score === m.score, "detail score === roster score (unchanged)");
  assert(d!.bucketKeys.length === 30 && d!.contribution.length === 30, "series unchanged length");
  assert(d!.health === "on_track" || d!.health === "needs_attention", "health still present on manager detail");
  assert(d!.aiInsight === null, "aiInsight still null");
  console.log("ALL PASS");
}
main();
```

- [ ] **Step 4:** Run → `ALL PASS`. **Step 5:** `npx tsc --noEmit` → clean. **Step 6:** delete smoke + commit:
```bash
rm scripts/smoke-extract-unchanged.ts
git add lib/team-metrics.ts
git commit -m "refactor(people-metrics): extract computePersonMetrics core from loadPersonDetail (behavior-preserving)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `myPerformanceRead` positive narrative

**Files:** Modify `lib/people-narrative.ts`; Smoke `scripts/smoke-my-read.ts` (throwaway).

- [ ] **Step 1: Append to `lib/people-narrative.ts`:**

```ts
export interface MyPerformanceReadInput {
  role: RoleCode;
  scoreDeltaPct: number | null;
  onTimePct: number | null;
  activeDayStreak: number;
  mvpAwards: number;
  gradient: { great: number; good: number; needsWork: number };
}

/**
 * Positive-only "read" for the employee self-view. NEVER returns a
 * needs-attention key — picks the strongest positive signal, falling back to a
 * neutral-encouraging steady line. (A quiet period reads as "steady", not a flag.)
 */
export function myPerformanceRead(p: MyPerformanceReadInput): NarrativeLine {
  if (p.mvpAwards > 0) return { key: "me.read.mvp", params: { n: p.mvpAwards } };
  if (p.activeDayStreak >= 5) return { key: "me.read.streak", params: { n: p.activeDayStreak } };
  if (p.scoreDeltaPct !== null && p.scoreDeltaPct > 0) return { key: "me.read.up", params: { pct: p.scoreDeltaPct } };
  if (p.onTimePct !== null && p.onTimePct >= 90) return { key: "me.read.reliable", params: { ontime: p.onTimePct } };
  if (p.gradient.great >= p.gradient.good + p.gradient.needsWork && p.gradient.great > 0) return { key: "me.read.strong_gradients" };
  return { key: "me.read.steady" };
}
```

- [ ] **Step 2: Smoke** `scripts/smoke-my-read.ts` (wrap in `main()`): assert mvp→`me.read.mvp`, streak≥5 (mvp=0)→`me.read.streak`, positive delta (mvp=0,streak<5)→`me.read.up`, high on-time→`me.read.reliable`, all-great→`me.read.strong_gradients`, empty→`me.read.steady`; and assert the key NEVER contains "needs" / "attention" / "down" / "tasks_down" across a range of inputs (incl. negative delta + zero everything → still `me.read.steady`). Run → `ALL PASS`.

- [ ] **Step 3:** `tsc` clean. **Step 4:** delete smoke + commit:
```bash
rm scripts/smoke-my-read.ts
git add lib/people-narrative.ts
git commit -m "feat(my-performance): myPerformanceRead positive-only narrative

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `loadMyPerformance`

**Files:** Modify `lib/team-metrics.ts` (append); Smoke `scripts/smoke-my-performance.ts` (throwaway).

- [ ] **Step 1: Add `myPerformanceRead` to the `@/lib/people-narrative` import** at the top of `lib/team-metrics.ts` (the import already pulls `personCardLine, personReadNarrative, teamBannerNarrative, type NarrativeLine` — add `myPerformanceRead` + `type MyPerformanceReadInput` is not needed, just the fn).

- [ ] **Step 2: Append to `lib/team-metrics.ts`:**

```ts
// ─────────────────────────────────────────────────────────────────────────────
// loadMyPerformance — the employee self-view. Own data only (personId is ALWAYS
// the session user; the loader never accepts an arbitrary id). Positive framing:
// returns score + a positive read + wins, but NO health/reasons/rank fields.
// ─────────────────────────────────────────────────────────────────────────────

export interface MyWins {
  activeDayStreak: number;
  mvpAwards: number;
  personalBest: number;
  onTimePct: number | null;
}

export interface MyPerformanceData {
  userId: string;
  name: string;
  role: RoleCode;
  score: number;
  previousScore: number | null;
  scoreDeltaPct: number | null;
  read: NarrativeLine;
  wins: MyWins;
  bucketKeys: string[];
  contribution: (number | null)[];
  onTime: (number | null)[];
  gradientTally: { great: number; good: number; needsWork: number };
  streaks: PersonStreaks;
  signals: PersonSignals;
  // NOTE: deliberately NO health / reasons / rank — this is the positive self-view.
}

export async function loadMyPerformance(
  service: SupabaseClient,
  args: { viewer: Viewer; locationId: string; granularity: TrendGranularity; compare: boolean; today: string },
): Promise<MyPerformanceData | null> {
  // SECURITY: self only — person is ALWAYS the session user, never a param.
  // IDOR: the viewer must be assigned to the location they're viewing.
  const { data: ul } = await service
    .from("user_locations").select("user_id").eq("location_id", args.locationId).eq("user_id", args.viewer.userId).maybeSingle();
  if (!ul) return null;
  const { data: u } = await service
    .from("users").select("id, name, role, active, created_at").eq("id", args.viewer.userId)
    .maybeSingle<{ id: string; name: string; role: RoleCode; active: boolean; created_at: string }>();
  if (!u || !u.active) return null;

  const m = await computePersonMetrics(service, {
    personId: u.id, role: u.role, createdAt: u.created_at,
    locationId: args.locationId, granularity: args.granularity, compare: args.compare, today: args.today,
  });

  const read = myPerformanceRead({
    role: u.role, scoreDeltaPct: m.scoreDeltaPct, onTimePct: m.overallOnTime,
    activeDayStreak: m.streaks.activeDays, mvpAwards: m.signals.mvpAwards, gradient: m.gradientTally,
  });
  const wins: MyWins = {
    activeDayStreak: m.streaks.activeDays, mvpAwards: m.signals.mvpAwards,
    personalBest: m.streaks.personalBest, onTimePct: m.overallOnTime,
  };

  return {
    userId: u.id, name: u.name, role: u.role,
    score: m.score, previousScore: m.previousScore, scoreDeltaPct: m.scoreDeltaPct,
    read, wins, bucketKeys: m.bucketKeys, contribution: m.contribution, onTime: m.onTime,
    gradientTally: m.gradientTally, streaks: m.streaks, signals: m.signals,
  };
}
```

(Note: no `RANKED_MAX_LEVEL` / `TEAM_VIEW_LEVEL` gate — every level sees their own, including MoO+.)

- [ ] **Step 3: Live smoke** `scripts/smoke-my-performance.ts` (wrap in `main()`):
```ts
import { loadMyPerformance, loadPersonDetail, loadTeamOperatingHealth } from "@/lib/team-metrics";
import { getServiceRoleClient } from "@/lib/supabase-server";
function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }
async function main() {
  const sb = getServiceRoleClient();
  const { data: locs } = await sb.from("locations").select("id, code").eq("active", true).order("code");
  if (!locs?.length) { console.log("no loc"); return; }
  const loc = locs[0]!;
  const today = new Date().toISOString().slice(0, 10);

  // pick a real assigned user via the roster
  const team = await loadTeamOperatingHealth(sb, { viewer: { userId: "x", level: 6 }, locationId: loc.id, granularity: "day", compare: true, today });
  if (!team || !team.members.length) { console.log("no members"); return; }
  const person = team.members[0]!;
  const viewer = { userId: person.userId, level: ROLES_LEVEL(person.role) };

  const mp = await loadMyPerformance(sb, { viewer, locationId: loc.id, granularity: "day", compare: true, today });
  assert(mp !== null, "my-performance loads for own id");
  assert(!("health" in (mp as object)) && !("reasons" in (mp as object)) && !("rank" in (mp as object)), "shape has NO health/reasons/rank");
  assert(mp!.read.key.startsWith("me.read."), "positive read key (me.read.*)");
  assert(typeof mp!.wins.activeDayStreak === "number", "wins present");

  // consistency with manager detail (same person+loc+window)
  const d = await loadPersonDetail(sb, { viewer: { userId: "x", level: 6 }, personId: person.userId, locationId: loc.id, granularity: "day", compare: true, today });
  assert(d !== null && d!.score === mp!.score, "self score === manager detail score (same core)");

  // IDOR: a location the user is NOT assigned to → null
  if (locs.length >= 2) {
    const other = locs.find((l) => l.id !== loc.id)!;
    const otherTeam = await loadTeamOperatingHealth(sb, { viewer: { userId: "x", level: 6 }, locationId: other.id, granularity: "day", compare: false, today });
    const assignedElsewhere = new Set((otherTeam?.members ?? []).map((x) => x.userId));
    if (!assignedElsewhere.has(person.userId)) {
      const leak = await loadMyPerformance(sb, { viewer, locationId: other.id, granularity: "day", compare: false, today });
      assert(leak === null, "unassigned location → null (IDOR)");
    } else { console.log("ok: (person assigned to both locations; IDOR cross-loc check skipped)"); }
  }
  console.log("sample:", JSON.stringify({ score: mp!.score, read: mp!.read, wins: mp!.wins }));
  console.log("ALL PASS");
}
// tiny inline role→level (avoid importing ROLES just for the smoke)
import { ROLES } from "@/lib/roles";
function ROLES_LEVEL(role: string): number { return (ROLES as Record<string, { level: number }>)[role]?.level ?? 0; }
main();
```

- [ ] **Step 4:** Run → `ALL PASS` (print sample). **Step 5:** `tsc` clean. **Step 6:** delete smoke + commit:
```bash
rm scripts/smoke-my-performance.ts
git add lib/team-metrics.ts
git commit -m "feat(my-performance): loadMyPerformance — self-only, positive shape (no health/rank), IDOR

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: i18n `me.*` keys + nav relabel

**Files:** Modify `lib/i18n/en.json` + `es.json`; Smoke parity (throwaway).

- [ ] **Step 1: Add to `en.json`** (alongside other top-level keys):
```json
  "me.title": "My Performance",
  "me.score_label": "your score",
  "me.score_demystify": "counts the work your role is here to do",
  "me.score_up": "▲ {pct}% vs last period",
  "me.score_down": "▼ {pct}% vs last period",
  "me.vs_prev_flat": "even with last period",
  "me.read.mvp": "{n} MVP win(s) this period — keep it up! 🌟",
  "me.read.streak": "{n} days active in a row — strong consistency. 🔥",
  "me.read.up": "Up {pct}% vs last period — nice momentum.",
  "me.read.reliable": "Reliable — {ontime}% of your finalized reports landed on time.",
  "me.read.strong_gradients": "Your managers are rating you highly. Keep it going.",
  "me.read.steady": "Steady work this period. Every shift counts.",
  "me.wins.streak": "{n}-day streak",
  "me.wins.mvp": "{n} MVP",
  "me.wins.best": "best day: {n}",
  "me.wins.ontime": "{n}% on-time",
  "me.contribution": "Your contribution — tasks completed",
  "me.on_time": "On-time completion",
  "me.on_time_sub": "Task-window timeliness (not clock-in)",
  "me.gradients": "How managers have rated you",
  "me.streaks": "Streaks",
  "me.streak_active": "active days",
  "me.streak_ontime": "on-time in a row",
  "me.streak_best": "personal best",
  "me.streak_mvp": "MVP wins",
  "me.toast_note": "Early-clock-in streaks unlock when Toast connects.",
  "me.feedback": "Feedback from shifts",
  "me.feedback_reassure": "Manager-private notes are never shown here — only your own structured feedback.",
  "me.area_to_grow": "Area to grow",
  "me.empty": "No activity recorded for this location yet.",
  "me.location_aria": "Choose location"
```
Also **relabel** the existing `nav.my_feedback` value from `"My Feedback"` to `"My Performance"`.

- [ ] **Step 2: Add the SAME keys to `es.json`** (tú-form), and relabel `nav.my_feedback` → `"Mi Desempeño"`:
```json
  "me.title": "Mi Desempeño",
  "me.score_label": "tu puntaje",
  "me.score_demystify": "cuenta el trabajo que tu puesto debe hacer",
  "me.score_up": "▲ {pct}% vs período anterior",
  "me.score_down": "▼ {pct}% vs período anterior",
  "me.vs_prev_flat": "igual que el período anterior",
  "me.read.mvp": "¡{n} premio(s) MVP este período — sigue así! 🌟",
  "me.read.streak": "{n} días activo seguidos — gran consistencia. 🔥",
  "me.read.up": "Subiste {pct}% vs el período anterior — buen ritmo.",
  "me.read.reliable": "Confiable — {ontime}% de tus reportes finalizados llegaron a tiempo.",
  "me.read.strong_gradients": "Tus gerentes te están calificando muy bien. Sigue así.",
  "me.read.steady": "Trabajo constante este período. Cada turno cuenta.",
  "me.wins.streak": "racha de {n} días",
  "me.wins.mvp": "{n} MVP",
  "me.wins.best": "mejor día: {n}",
  "me.wins.ontime": "{n}% a tiempo",
  "me.contribution": "Tu contribución — tareas completadas",
  "me.on_time": "Cumplimiento a tiempo",
  "me.on_time_sub": "Puntualidad por ventana de tarea (no por reloj de entrada)",
  "me.gradients": "Cómo te han calificado los gerentes",
  "me.streaks": "Rachas",
  "me.streak_active": "días activos",
  "me.streak_ontime": "a tiempo seguidos",
  "me.streak_best": "récord personal",
  "me.streak_mvp": "premios MVP",
  "me.toast_note": "Las rachas de reloj de entrada se activan cuando se conecte Toast.",
  "me.feedback": "Comentarios de turnos",
  "me.feedback_reassure": "Las notas privadas de gerentes nunca se muestran aquí — solo tu propia retroalimentación estructurada.",
  "me.area_to_grow": "Área para crecer",
  "me.empty": "Aún no hay actividad registrada para esta ubicación.",
  "me.location_aria": "Elige ubicación"
```

- [ ] **Step 3: Parity smoke** (same shape as prior cycles — assert `Object.keys(en)` ≡ `Object.keys(es)`, ≥ 30 `me.*` keys, and every `{param}` token aligned between EN and ES for `me.*` keys). Run → `ALL PASS`.

- [ ] **Step 4:** `tsc` clean. **Step 5:** delete smoke + commit:
```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(my-performance): me.* i18n (en+es) + relabel nav to My Performance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `MyPerformance` component

**Files:** Create `components/me/MyPerformance.tsx`. Server Component; reuses `LineChart`. Verify `tsc` + `next build`.

- [ ] **Step 1:** Create `components/me/MyPerformance.tsx`. Props:
```ts
{
  data: MyPerformanceData;          // from @/lib/team-metrics
  feedback: MyFeedbackItem[];       // from @/lib/pm-report, pre-filtered to the selected location
  language: Language;
}
```
Sections (mirror the approved mockup; brand tokens; positive green accents):
1. **Hero** (`rounded-2xl border-2 border-co-border bg-co-surface p-5`, a subtle green tint via `bg-co-success-surface` on an inner band): the translated `data.read` (`serverT(language, data.read.key as TranslationKey, data.read.params)`, large/bold); the **score** big (`data.score`) with a delta line — `data.scoreDeltaPct === null` → omit; `> 0` → `me.score_up`{pct}; `< 0` → `me.score_down`{pct: abs}; `=== 0` → `me.vs_prev_flat`; then `me.score_label` + `me.score_demystify` small; a **wins strip** of pill chips: `me.wins.streak`{n: data.wins.activeDayStreak} (show only if >0), `me.wins.mvp`{n} (only if mvpAwards>0), `me.wins.best`{n: personalBest} (only if >0), `me.wins.ontime`{n: onTimePct} (only if onTimePct !== null).
2. **Contribution** card: title `me.contribution`; `<LineChart series={[{ points: data.contribution, color: "var(--co-gold-deep)" }]} ariaLabel={serverT(language,"me.contribution")} />`.
3. **On-time** card: title `me.on_time`, sub `me.on_time_sub`; `<LineChart series={[{ points: data.onTime, color: "var(--co-success)" }]} ... />`.
4. **Gradients** card: title `me.gradients`; segmented bar from `data.gradientTally` (great=var(--co-success), good=#9ccc9c, needsWork=var(--co-warning); guard total 0 → muted empty bar).
5. **Streaks** card: title `me.streaks`; chips — `data.streaks.activeDays` `me.streak_active`, `data.streaks.onTime` `me.streak_ontime`, `data.streaks.personalBest` `me.streak_best`, `data.signals.mvpAwards` `me.streak_mvp`; footnote `me.toast_note`.
6. **Feedback** card: title `me.feedback`; if `feedback.length === 0` show `me.empty`; else map each item to the eval row (reuse the markup from the current `/my-feedback` page: a `GRADIENT_KEY` map `{great:"pm.attitude.great",good:"pm.attitude.good",needs_work:"pm.attitude.needs_work"}`, four `pm.eval.*` gradient pills, MVP badge `pm.my_feedback.mvp` when `wasMvp`, and `item.areaToImprove` rendered under `me.area_to_grow`). Below the list: the reassurance line `me.feedback_reassure` (small, muted). Use `formatDateLabel(item.date, language)` + the location code (passed or shown as code) — since the page filters to one location, you may show just the date.

Define small inline `Section`/`Chip` helpers for consistency.

- [ ] **Step 2:** `tsc` + `npm run build` → clean. **Step 3:** commit:
```bash
git add components/me/MyPerformance.tsx
git commit -m "feat(my-performance): MyPerformance component (hero + charts + streaks + feedback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Rewrite the `/my-feedback` page

**Files:** Modify `app/(authed)/my-feedback/page.tsx`.

- [ ] **Step 1:** Rewrite `app/(authed)/my-feedback/page.tsx`:
```tsx
/**
 * /my-feedback — "My Performance" (employee self-view).
 *
 * Route kept (the PM `shift_feedback` notification deep-links here); the label
 * is "My Performance". Own data only, per-location switcher. Positive framing —
 * no rank, no needs-attention. Absorbs the prior eval list as the Feedback
 * section. Security: loadMyPerformance derives the person from the session
 * (never a param); manager notes are never selected.
 */

import { redirect } from "next/navigation";
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { accessibleLocations, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { loadMyFeedback } from "@/lib/pm-report";
import { loadMyPerformance } from "@/lib/team-metrics";
import type { TrendGranularity } from "@/lib/reports-trends";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { TrendControls } from "@/components/trends/TrendControls";
import { MyPerformance } from "@/components/me/MyPerformance";

interface PageProps {
  searchParams: Promise<{ loc?: string; g?: string; cmp?: string }>;
}

function parseGranularity(g: string | undefined): TrendGranularity {
  return g === "week" || g === "month" ? g : "day";
}

interface LocLite { id: string; code: string }

export default async function MyPerformancePage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/my-feedback");
  const language: Language = auth.user.language;
  const { loc, g, cmp } = await searchParams;
  const sb = getServiceRoleClient();

  // Locations the viewer is assigned to (for the switcher). "all" (L9+) → every active location.
  const actor: LocationActor = { role: auth.role, locations: auth.locations };
  const access = accessibleLocations(actor);
  let locQuery = sb.from("locations").select("id, code").eq("active", true).order("code", { ascending: true });
  if (access !== "all") {
    if (access.length === 0) {
      return <EmptyShell language={language} />;
    }
    locQuery = locQuery.in("id", access);
  }
  const { data: locRows } = await locQuery;
  const locations = (locRows ?? []) as LocLite[];
  if (locations.length === 0) return <EmptyShell language={language} />;

  const selected = (loc ? locations.find((l) => l.id === loc) : null) ?? locations[0]!;
  const granularity = parseGranularity(g);
  const compare = cmp === "1";
  const today = operationalNow(new Date()).date;

  const data = await loadMyPerformance(sb, {
    viewer: { userId: auth.user.id, level: auth.level },
    locationId: selected.id, granularity, compare, today,
  });

  // Feedback (own evals) filtered to the selected location.
  const allFeedback = await loadMyFeedback(sb, { userId: auth.user.id });
  const feedback = allFeedback.filter((f) => f.locationId === selected.id);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-co-text">{serverT(language, "me.title")}</h1>
        {locations.length > 1 ? (
          <nav aria-label={serverT(language, "me.location_aria")} className="flex flex-wrap gap-1.5">
            {locations.map((l) => {
              const on = l.id === selected.id;
              const href = `/my-feedback?loc=${l.id}&g=${granularity}${compare ? "&cmp=1" : ""}`;
              return (
                <Link key={l.id} href={href} scroll={false} aria-current={on ? "page" : undefined}
                  className={[
                    "inline-flex min-h-[36px] items-center rounded-full px-3 text-xs font-bold uppercase tracking-[0.1em] transition",
                    on ? "border-2 border-co-text bg-co-gold text-co-text" : "border-2 border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text",
                  ].join(" ")}>
                  {l.code}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>

      <div className="mb-4">
        <TrendControls locationId={selected.id} granularity={granularity} compare={compare} language={language} basePath="/my-feedback" />
      </div>

      {data ? (
        <MyPerformance data={data} feedback={feedback} language={language} />
      ) : (
        <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
          {serverT(language, "me.empty")}
        </p>
      )}
    </main>
  );
}

function EmptyShell({ language }: { language: Language }) {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(language, "me.title")}</h1>
      <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
        {serverT(language, "me.empty")}
      </p>
    </main>
  );
}
```

**Important — `TrendControls` `basePath` builds `?location=`, but this page reads `?loc=`.** `TrendControls`' href is `${basePath}?location=${locationId}&g=...`. This page's switcher + `loadMyPerformance` read `?loc=`. To avoid a param mismatch, **make this page accept BOTH**: in the `searchParams` type add `location?: string`, and resolve the selected id as `const locParam = loc ?? location;` (read whichever is present). Add `location?: string` to `PageProps` and `const { loc, location, g, cmp } = await searchParams;` then `const selectedId = loc ?? location;` used in the `locations.find`. This way the granularity/compare links from `TrendControls` (which use `?location=`) and the switcher links (which use `?loc=`) both work. (Simpler alternative if you prefer: pass `basePath="/my-feedback"` and have the switcher ALSO use `?location=` instead of `?loc=` — pick one param name and use it consistently in BOTH the switcher hrefs and the resolver. Either is fine; just be consistent and report which you chose.)

- [ ] **Step 2:** `tsc` + `npm run build` → clean. Confirm `/my-feedback` still in the route list. **Step 3:** commit:
```bash
git add "app/(authed)/my-feedback/page.tsx"
git commit -m "feat(my-performance): rewrite /my-feedback into the My Performance self-view

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Final verification + PR

- [ ] **Step 1:** `npx tsc --noEmit && npm run build` → both clean.
- [ ] **Step 2:** Comprehensive live smoke `scripts/smoke-my-final.ts` (throwaway): for a real assigned user across day/week/month — `loadMyPerformance` non-null, score === `loadPersonDetail` score, no health/rank in shape, `read.key` always `me.read.*`, IDOR (unassigned location → null), feedback filter excludes other locations. Run → `ALL PASS`; `rm`.
- [ ] **Step 3:** Push + PR:
```bash
git push -u origin claude/employee-self-view
gh pr create --title "My Performance: employee self-view (positive, own-only) on /my-feedback" --body "$(cat <<'EOF'
## What
The positive/own-only employee self-view — fast-follow to the manager team-view (#70). `/my-feedback` becomes **"My Performance"**: each employee sees their own contribution / on-time / gradients / streaks / MVP wins over time, score shown but **no rank, no ⚠ needs-attention**. The prior PM-eval list absorbs in as the "Feedback from shifts" section.

- Extracted `computePersonMetrics` core from `loadPersonDetail` (behavior-preserving) → reused by new `loadMyPerformance` (self-gate, positive narrative, NO health/rank in the return shape).
- `myPerformanceRead` positive-only narrative (never a needs-attention key).
- `MyPerformance` component (hero + score + wins + charts + gradients + streaks + feedback); per-location switcher; Day/Week/Month + compare.
- Route stays `/my-feedback` (notification deep-link); label → "My Performance"; nav relabeled.
- i18n `me.*` EN+ES.

## Security
- `loadMyPerformance` derives the person from the SESSION (never an arbitrary id) — no cross-person exposure.
- `lockLocationContext`-equivalent: the viewer must be assigned to the selected location (IDOR).
- `loadMyFeedback` still never selects the manager `note`.

## NO migrations.

## Deferred
Public profiles (Profile module), AI encouragement, clock-in streaks/punctuality (Toast), free-text search.

## Test plan
- tsc + next build clean.
- Live smokes: score === manager-detail score (same core), shape has no health/rank, read always me.read.*, IDOR unassigned-location → null, feedback filtered to selected location.
- Manual (preview): open My Performance as a floor employee — positive tone, no rank/⚠; location switcher (if multi); Day/Week/Month + compare; Feedback section shows own evals, no manager note.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
- [ ] **Step 4:** Report the preview URL (`co-ops-git-claude-employee-self-view-juan-co-devs-projects.vercel.app`).

---

## Self-review

**Spec coverage:** own-data-only + all-levels (T3 — no level gate, person=session user); per-location switcher (T6); score shown + no rank/⚠ (T3 shape omits health/reasons; T5 renders no rank) ✓; positive narrative (T2); reuse via extraction (T1); absorb /my-feedback + route kept + relabel (T4/T6); Toast footnote (T4/T5); i18n (T4); security: person=session, IDOR, no note (T3/T6); no migrations ✓; deferred listed ✓.

**Placeholder scan:** complete code for T1–T3, T6; structural spec with exact props/keys for T5 (mirrors the people-metrics component tasks). No TBD/TODO.

**Type consistency:** `PersonMetrics` (T1) consumed by `loadPersonDetail` + `loadMyPerformance` (T1/T3); `MyPerformanceData`/`MyWins` (T3) consumed by `MyPerformance` (T5) + page (T6); `myPerformanceRead` signature (T2) matches its call in `loadMyPerformance` (T3); `loadMyPerformance` arg shape matches the page call (T6). `MyFeedbackItem` (existing) consumed by T5/T6.

**Flagged for implementer:** the `?loc=` vs `TrendControls` `?location=` param-name mismatch — T6 step 1 calls it out with two acceptable resolutions; the implementer picks one and uses it consistently, and reports which.
