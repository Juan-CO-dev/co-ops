# People / Team Operating-Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An AGM+ per-location manager "operating-health" team view — role-scoped activity scoring across five action categories, a ranked rich-card roster, per-person detail with our-data streaks, deterministic narrative, plus a trends-landing restructure and an AGM+ dashboard widget.

**Architecture:** Pure scoring/streak helpers (`lib/team-scoring.ts`) + deterministic narrative (`lib/people-narrative.ts`) feed two bulk-load loaders (`lib/team-metrics.ts`) that reuse the trends time-engine (`computeWindows`/`bucketStart`). Presentational components reuse the trends SVG charts. `/reports/trends` becomes a landing; ops content moves to `/reports/trends/ops`; new `/reports/trends/team` + `/team/[personId]` are AGM+ gated. No migrations — pure read surface.

**Tech Stack:** Next.js 16 App Router (Server Components), React 19, TS strict + `noUncheckedIndexedAccess`, Supabase service-role reads, Tailwind v4 tokens. No test framework — `tsc --noEmit` + `next build` + throwaway `tsx` smokes on live rows.

**Branch:** `claude/people-metrics` (created; spec committed there).

**Spec:** `docs/superpowers/specs/2026-06-17-people-metrics-team-view-design.md`

---

## Ground-truth (verified against live prod schema — do not re-assume)

- **Roles** (`lib/roles.ts`): employee 3, key_holder 4, **trainer 4**, shift_lead 5, agm/catering_mgr/prep_mgr/social_media_mgr 6, gm 7, moo 8, owner 9, cgs 10; trainee 2, hired_not_yet_worked 1, prospect 0. `RoleCode` type + `ROLES` registry exported.
- **users**: `id, role (text), active (bool), created_at (timestamptz)`.
- **user_locations**: `user_id, location_id` — **no `active` column** (assignment = row exists; gate activeness on `users.active`).
- **checklist_completions**: `id, instance_id, template_item_id, completed_by, completed_at (tstz), notes, superseded_at, revoked_at`. Live = `superseded_at IS NULL AND revoked_at IS NULL`. Bucket by `completed_at`.
- **checklist_instances**: `id, template_id, location_id, date, status, confirmed_by, confirmed_at`.
- **cash_reports**: `id, location_id, report_date, signed_by, signed_at, over_short_note, superseded_at`.
- **pm_reports**: `id, location_id, report_date, status, mvp_user_id, submitted_by, submitted_at, superseded_at`.
- **pm_employee_evals**: `id, pm_report_id, employee_id, location_id, area_to_improve, note, created_at, superseded_at`.
- **audit_log**: `id, actor_id (uuid), action (text), occurred_at (tstz)`. **Not reliably location-tagged** → oversight is attributed by `actor_id` window-global (documented impurity, acceptable v1).
- **Reuse from `lib/reports-trends.ts`**: `computeWindows(today, granularity, compare)` → `{ currentKeys, previousKeys, loadFrom, loadTo }`, `bucketStart(yyyymmdd, g)`, `BUCKET_COUNT`, types `TrendGranularity`. **Reuse `components/trends/{LineChart,BarChart}`.**
- **Page patterns**: `requireSessionFromHeaders(path)` → `auth.user.id/.language/.role/.level/.locations`; `lockLocationContext(actor, locationId)`; `getServiceRoleClient()`; `serverT(lang, key, params?)`; i18n flat dotted keys at en/es parity; `formatDateLabel`/`formatTime` from `lib/i18n/format`.

**Date math note:** all timestamps → operational-date `YYYY-MM-DD` via the existing pattern (`new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",...})`) so bucketing matches the rest of the app. A shared `opDate(tstz)` helper is defined in Task 3.

---

## File structure

- **`lib/team-scoring.ts`** (new) — pure: `ActionCategory`, `CategoryCounts`, `ROLE_EXPECTED_CATEGORIES`/`expectedCategoriesFor`, `scoreFromCounts`, `healthFromCounts`, streak helpers. No I/O.
- **`lib/people-narrative.ts`** (new) — pure: deterministic narrative selection → `{ key, params }` lines (team banner, person card line, person "read").
- **`lib/team-metrics.ts`** (new) — `TEAM_VIEW_LEVEL`, types, `loadTeamOperatingHealth`, `loadPersonDetail`. Bulk-load + attribute + bucket. Reuses scoring + narrative + trends windows.
- **`components/team/TeamRosterCard.tsx`** (new) — layout B rich card.
- **`components/team/TeamRosterTable.tsx`** (new) — layout C dense table+expand (dashboard widget body).
- **`components/team/PersonDetail.tsx`** (new) — per-person detail sections (reuses trends charts).
- **`components/team/TrendsLanding.tsx`** (new) — entry cards + attention strip + section snapshots.
- **`app/(authed)/reports/trends/page.tsx`** (modify → landing), **`app/(authed)/reports/trends/ops/page.tsx`** (new — moved ops content), **`app/(authed)/reports/trends/team/page.tsx`** (new), **`app/(authed)/reports/trends/team/[personId]/page.tsx`** (new).
- **`app/(authed)/dashboard/page.tsx`** (modify — AGM+ team widget).
- **`lib/i18n/en.json` + `es.json`** (modify — `reports.trends.team.*` + `people.*`).

---

### Task 1: `lib/team-scoring.ts` — pure scoring + health + streaks

**Files:** Create `lib/team-scoring.ts`; Smoke `scripts/smoke-team-scoring.ts` (throwaway).

- [ ] **Step 1: Write the failing smoke** `scripts/smoke-team-scoring.ts` (wrap in `async function main(){...}; main();`):

```ts
import {
  expectedCategoriesFor, scoreFromCounts, healthFromCounts,
  activeDayStreak, onTimeStreak, personalBest, emptyCounts,
} from "@/lib/team-scoring";

function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }
async function main() {
  assert(JSON.stringify(expectedCategoriesFor("employee")) === JSON.stringify(["tasks","notes"]), "employee → tasks,notes");
  assert(expectedCategoriesFor("trainer").join() === "tasks,notes", "trainer (L4) → tasks,notes, NOT KH set");
  assert(expectedCategoriesFor("key_holder").includes("oversight"), "KH → incl oversight");
  assert(expectedCategoriesFor("gm").join() === "finalizations,peopleMgmt,oversight,notes", "gm set");
  assert(expectedCategoriesFor("unknown_role" as never).join() === "tasks,notes", "unknown → default tasks,notes");

  const c = { ...emptyCounts(), tasks: 80, finalizations: 5, oversight: 3, notes: 2, peopleMgmt: 9 };
  // employee scores only tasks+notes = 82 (finals/oversight/people off-role, ignored)
  assert(scoreFromCounts("employee", c) === 82, "employee score = tasks+notes only");
  // gm scores finals+people+oversight+notes = 5+9+3+2 = 19 (tasks off-role)
  assert(scoreFromCounts("gm", c) === 19, "gm score excludes tasks");

  // health: expected category at zero → needs_attention
  const cZero = { ...emptyCounts(), tasks: 30 }; // employee, notes=0
  assert(healthFromCounts("employee", cZero, 30, null).health === "needs_attention", "zero expected cat → needs_attention");
  assert(healthFromCounts("employee", cZero, 30, null).reasons.includes("no_notes"), "reason no_notes");
  // sharp drop
  assert(healthFromCounts("employee", { ...emptyCounts(), tasks: 10, notes: 1 }, 11, 50).health === "needs_attention", "sharp drop → needs_attention");
  assert(healthFromCounts("employee", { ...emptyCounts(), tasks: 40, notes: 5 }, 45, 50).health === "on_track", "small change → on_track");

  assert(activeDayStreak(["2026-06-16","2026-06-17","2026-06-18"], "2026-06-18") === 3, "3-day active streak");
  assert(activeDayStreak(["2026-06-15","2026-06-17","2026-06-18"], "2026-06-18") === 2, "gap breaks streak");
  assert(activeDayStreak(["2026-06-16"], "2026-06-18") === 0, "stale streak = 0 (not active today/yesterday-contiguous)");
  assert(onTimeStreak([true, false, true, true]) === 2, "on-time streak counts trailing trues");
  assert(onTimeStreak([true, false]) === 0, "trailing false → 0");
  assert(personalBest([3, 19, 7, 12]) === 19, "personal best = max day");
  assert(personalBest([]) === 0, "personal best empty = 0");
  console.log("ALL PASS");
}
main();
```

- [ ] **Step 2: Run → FAIL** `npx tsx --env-file=.env.local scripts/smoke-team-scoring.ts`

- [ ] **Step 3: Create `lib/team-scoring.ts`:**

```ts
import type { RoleCode } from "@/lib/roles";

export type ActionCategory = "tasks" | "finalizations" | "peopleMgmt" | "oversight" | "notes";
export const ALL_CATEGORIES: ActionCategory[] = ["tasks", "finalizations", "peopleMgmt", "oversight", "notes"];
export type CategoryCounts = Record<ActionCategory, number>;

export function emptyCounts(): CategoryCounts {
  return { tasks: 0, finalizations: 0, peopleMgmt: 0, oversight: 0, notes: 0 };
}

/**
 * Role code → expected categories. Keyed by ROLE CODE, not level: trainer and
 * key_holder are both level 4 but have different expected work. Unknown role
 * codes default to ["tasks","notes"]. moo/owner/cgs are excluded from the
 * roster (level < 8 filter upstream), so they need no entry.
 */
const ROLE_EXPECTED: Partial<Record<RoleCode, ActionCategory[]>> = {
  prospect: ["tasks", "notes"],
  hired_not_yet_worked: ["tasks", "notes"],
  trainee: ["tasks", "notes"],
  employee: ["tasks", "notes"],
  trainer: ["tasks", "notes"],
  key_holder: ["tasks", "finalizations", "notes", "oversight"],
  shift_lead: ["tasks", "finalizations", "notes", "oversight"],
  agm: ["finalizations", "peopleMgmt", "oversight", "notes"],
  gm: ["finalizations", "peopleMgmt", "oversight", "notes"],
  catering_mgr: ["finalizations", "peopleMgmt", "oversight", "notes"],
  prep_mgr: ["finalizations", "peopleMgmt", "oversight", "notes"],
  social_media_mgr: ["finalizations", "peopleMgmt", "oversight", "notes"],
};

export function expectedCategoriesFor(role: RoleCode): ActionCategory[] {
  return ROLE_EXPECTED[role] ?? ["tasks", "notes"];
}

/** Score = sum of counts in the role's expected categories (off-role categories not scored). */
export function scoreFromCounts(role: RoleCode, counts: CategoryCounts): number {
  return expectedCategoriesFor(role).reduce((s, c) => s + counts[c], 0);
}

export type Health = "on_track" | "needs_attention";
export interface HealthResult {
  health: Health;
  /** machine reasons, e.g. "no_notes", "sharp_drop" — narrative maps to copy. */
  reasons: string[];
}

/**
 * needs_attention when ANY expected category is zero in the window, OR the
 * current score dropped to <= 60% of the previous window (when prev > 0).
 */
export function healthFromCounts(
  role: RoleCode,
  counts: CategoryCounts,
  currentScore: number,
  previousScore: number | null,
): HealthResult {
  const reasons: string[] = [];
  for (const c of expectedCategoriesFor(role)) {
    if (counts[c] === 0) reasons.push(`no_${c}`);
  }
  if (previousScore !== null && previousScore > 0 && currentScore <= previousScore * 0.6) {
    reasons.push("sharp_drop");
  }
  return { health: reasons.length ? "needs_attention" : "on_track", reasons };
}

// ── Streaks (pure; derived from the action timestamp series) ──

/**
 * Consecutive active days ending at `today` (or yesterday-contiguous). Counts
 * backward from today while each prior calendar day is present in the set. If
 * the person was NOT active today AND not yesterday, streak is 0 (stale).
 */
export function activeDayStreak(activeDates: string[], today: string): number {
  const set = new Set(activeDates);
  // allow the streak to "end" today or yesterday (shift not yet worked today)
  const start = set.has(today) ? today : shiftDay(today, -1);
  if (!set.has(start)) return 0;
  let streak = 0;
  let d = start;
  while (set.has(d)) {
    streak++;
    d = shiftDay(d, -1);
  }
  return streak;
}

/** Trailing-true count in a chronological boolean list (most recent last). */
export function onTimeStreak(inWindowChrono: boolean[]): number {
  let n = 0;
  for (let i = inWindowChrono.length - 1; i >= 0; i--) {
    if (inWindowChrono[i]) n++;
    else break;
  }
  return n;
}

/** Max single-day count. */
export function personalBest(dayCounts: number[]): number {
  return dayCounts.length ? Math.max(...dayCounts) : 0;
}

function shiftDay(yyyymmdd: string, delta: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run smoke → `ALL PASS`.**
- [ ] **Step 5: `npx tsc --noEmit` → clean.**
- [ ] **Step 6: Delete smoke, commit:**
```bash
rm scripts/smoke-team-scoring.ts
git add lib/team-scoring.ts
git commit -m "feat(people-metrics): pure role-scoped scoring + health + streak helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `lib/people-narrative.ts` — deterministic narrative selection

**Files:** Create `lib/people-narrative.ts`; Smoke `scripts/smoke-people-narrative.ts` (throwaway).

Narrative functions return `{ key, params }` (key is a plain string; the component casts to `TranslationKey` when calling `serverT`, mirroring the dashboard's `role.<code>` pattern). This keeps the pure module decoupled from the JSON union.

- [ ] **Step 1: Write the failing smoke** `scripts/smoke-people-narrative.ts` (wrap in main()):

```ts
import { personReadNarrative, teamBannerNarrative, personCardLine } from "@/lib/people-narrative";

function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }
async function main() {
  // needs-attention with no_tasks reason → tasks_down read
  const down = personReadNarrative({ rank: 5, role: "employee", health: "needs_attention", reasons: ["no_notes","sharp_drop"], scoreDeltaPct: -42, onTimePct: 88 });
  assert(down.key.startsWith("people.read."), "read key namespaced");
  assert(typeof down.params?.pct === "number" || down.params === undefined || "pct" in (down.params ?? {}), "params present where used");

  // top contributor (rank 1, positive delta) → top_contributor
  const top = personReadNarrative({ rank: 1, role: "key_holder", health: "on_track", reasons: [], scoreDeltaPct: 22, onTimePct: 96 });
  assert(top.key === "people.read.top_contributor", "rank1 positive → top_contributor");

  const banner = teamBannerNarrative({ onTrack: 5, needsAttention: 2, attentionNames: ["Devon","Sam"] });
  assert(banner.key.startsWith("people.banner."), "banner key namespaced");
  assert(banner.params?.needs === 2, "banner needs param");

  const line = personCardLine({ rank: 3, role: "employee", health: "needs_attention", reasons: ["sharp_drop"], scoreDeltaPct: -40, onTimePct: 90 });
  assert(line.key.startsWith("people.line."), "card line key namespaced");
  console.log("ALL PASS");
}
main();
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Create `lib/people-narrative.ts`:**

```ts
import type { RoleCode } from "@/lib/roles";
import type { Health } from "@/lib/team-scoring";

export interface NarrativeLine {
  /** i18n key as plain string; caller casts to TranslationKey for serverT. */
  key: string;
  params?: Record<string, string | number>;
}

export interface PersonNarrativeInput {
  rank: number;
  role: RoleCode;
  health: Health;
  reasons: string[];
  /** score change vs previous window in %, or null when no previous. */
  scoreDeltaPct: number | null;
  /** on-time % (task-window) or null. */
  onTimePct: number | null;
}

/** The rich "read" — one summary line chosen by the dominant signal. */
export function personReadNarrative(p: PersonNarrativeInput): NarrativeLine {
  if (p.health === "needs_attention") {
    if (p.reasons.includes("sharp_drop") && p.scoreDeltaPct !== null) {
      return { key: "people.read.tasks_down", params: { pct: Math.abs(p.scoreDeltaPct) } };
    }
    if (p.reasons.some((r) => r.startsWith("no_"))) {
      const missing = p.reasons.find((r) => r.startsWith("no_"))!.slice(3);
      return { key: "people.read.missing_category", params: { category: missing } };
    }
    return { key: "people.read.needs_attention_generic" };
  }
  if (p.rank === 1) return { key: "people.read.top_contributor", params: { delta: p.scoreDeltaPct ?? 0 } };
  if (p.onTimePct !== null && p.onTimePct >= 95) return { key: "people.read.steady_reliable", params: { ontime: p.onTimePct } };
  return { key: "people.read.on_track_generic" };
}

/** Short one-liner under a roster card. */
export function personCardLine(p: PersonNarrativeInput): NarrativeLine {
  if (p.health === "needs_attention") {
    if (p.reasons.includes("sharp_drop") && p.scoreDeltaPct !== null) {
      return { key: "people.line.down", params: { pct: Math.abs(p.scoreDeltaPct) } };
    }
    return { key: "people.line.check_in" };
  }
  if (p.rank === 1) return { key: "people.line.top" };
  return { key: "people.line.steady" };
}

export function teamBannerNarrative(s: { onTrack: number; needsAttention: number; attentionNames: string[] }): NarrativeLine {
  if (s.needsAttention === 0) return { key: "people.banner.all_on_track", params: { onTrack: s.onTrack } };
  return {
    key: "people.banner.some_attention",
    params: { onTrack: s.onTrack, needs: s.needsAttention, names: s.attentionNames.join(", ") },
  };
}
```

- [ ] **Step 4: Run smoke → `ALL PASS`. Step 5: `tsc` clean. Step 6: delete smoke + commit:**
```bash
rm scripts/smoke-people-narrative.ts
git add lib/people-narrative.ts
git commit -m "feat(people-metrics): deterministic narrative selection (team/card/read)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `lib/team-metrics.ts` — types + `loadTeamOperatingHealth`

**Files:** Create `lib/team-metrics.ts`; Smoke `scripts/smoke-team-metrics.ts` (throwaway, live rows).

**Curated oversight action set** (supervisory actions managers take; from the audit vocabulary): `checklist_completion.revoke`, `checklist_completion.revoke_by_authority`, `checklist_completion.tag_actual_completer`, `report.update`, `report.drop`. (Excludes `user.*` admin + `audit.*`/system actions.)

- [ ] **Step 1: Create `lib/team-metrics.ts` (types + helpers + loadTeamOperatingHealth):**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLES, type RoleCode } from "@/lib/roles";
import {
  type ActionCategory, type CategoryCounts, emptyCounts,
  scoreFromCounts, healthFromCounts, type Health,
} from "@/lib/team-scoring";
import { personCardLine, teamBannerNarrative, type NarrativeLine } from "@/lib/people-narrative";
import { computeWindows, bucketStart, type TrendGranularity } from "@/lib/reports-trends";

export const TEAM_VIEW_LEVEL = 6; // AGM+
export const RANKED_MAX_LEVEL = 8; // roster excludes level >= 8 (MoO+)

export const OVERSIGHT_ACTIONS = [
  "checklist_completion.revoke",
  "checklist_completion.revoke_by_authority",
  "checklist_completion.tag_actual_completer",
  "report.update",
  "report.drop",
];

const OPERATIONAL_TZ = "America/New_York";
/** timestamptz → operational YYYY-MM-DD (matches the rest of the app's bucketing). */
function opDate(tstz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(tstz));
}

export interface Viewer { userId: string; level: number; }

export interface TeamMember {
  userId: string;
  name: string;
  role: RoleCode;
  level: number;
  score: number;
  previousScore: number | null;
  counts: CategoryCounts;
  health: Health;
  reasons: string[];
  /** per-bucket contribution sparkline (current window, score-relevant actions). */
  sparkline: number[];
  cardLine: NarrativeLine;
}

export interface TeamOperatingHealth {
  granularity: TrendGranularity;
  members: TeamMember[]; // ranked desc by score
  summary: { onTrack: number; needsAttention: number };
  banner: NarrativeLine;
}

interface MemberAcc {
  current: CategoryCounts;
  previous: CategoryCounts;
  byBucketScoreActions: Map<string, number>; // current-window bucket → count of score-relevant actions
}

export async function loadTeamOperatingHealth(
  service: SupabaseClient,
  args: { viewer: Viewer; locationId: string; granularity: TrendGranularity; compare: boolean; today: string },
): Promise<TeamOperatingHealth | null> {
  if (args.viewer.level < TEAM_VIEW_LEVEL) return null; // AGM+ only

  const { currentKeys, previousKeys, loadFrom, loadTo } = computeWindows(args.today, args.granularity, args.compare);
  const curSet = new Set(currentKeys);
  const prevSet = new Set(previousKeys ?? []);
  // loadTo is a bucket-start date; actions can occur through end of `today`.
  const loadToInclusive = args.today;

  // ── Roster: location-assigned, active, level < 8 ──
  const { data: ulRows } = await service
    .from("user_locations").select("user_id").eq("location_id", args.locationId);
  const userIds = [...new Set((ulRows ?? []).map((r) => (r as { user_id: string }).user_id))];
  if (userIds.length === 0) {
    return { granularity: args.granularity, members: [], summary: { onTrack: 0, needsAttention: 0 }, banner: teamBannerNarrative({ onTrack: 0, needsAttention: 0, attentionNames: [] }) };
  }
  const { data: userRows } = await service
    .from("users").select("id, name, role, active").in("id", userIds).eq("active", true);
  const members = new Map<string, { name: string; role: RoleCode; level: number; acc: MemberAcc }>();
  for (const u of (userRows ?? []) as Array<{ id: string; name: string; role: RoleCode; active: boolean }>) {
    const level = ROLES[u.role]?.level ?? 0;
    if (level >= RANKED_MAX_LEVEL) continue; // exclude MoO+
    members.set(u.id, { name: u.name, role: u.role, level, acc: { current: emptyCounts(), previous: emptyCounts(), byBucketScoreActions: new Map() } });
  }
  if (members.size === 0) {
    return { granularity: args.granularity, members: [], summary: { onTrack: 0, needsAttention: 0 }, banner: teamBannerNarrative({ onTrack: 0, needsAttention: 0, attentionNames: [] }) };
  }
  const memberIds = [...members.keys()];

  // window-membership helper for a timestamp
  const place = (uid: string, tstz: string, category: ActionCategory) => {
    const m = members.get(uid);
    if (!m) return;
    const bs = bucketStart(opDate(tstz), args.granularity);
    if (curSet.has(bs)) {
      m.acc.current[category]++;
      // score-relevant for sparkline only if expected category — but sparkline shows
      // total expected-category actions per bucket; we add post-hoc below. Track raw here.
      m.acc.byBucketScoreActions.set(bs, (m.acc.byBucketScoreActions.get(bs) ?? 0) + scoreRelevant(m.role, category));
    } else if (prevSet.has(bs)) {
      m.acc.previous[category]++;
    }
  };

  // ── location instance ids (for completion attribution) ──
  const { data: instRows } = await service
    .from("checklist_instances").select("id, confirmed_by, confirmed_at").eq("location_id", args.locationId);
  const locInstanceIds = new Set((instRows ?? []).map((r) => (r as { id: string }).id));

  // 1. TASKS + NOTES (completions: completed_at in span, live, instance at location)
  if (locInstanceIds.size) {
    const { data: comps } = await service
      .from("checklist_completions")
      .select("instance_id, completed_by, completed_at, notes")
      .in("instance_id", [...locInstanceIds])
      .gte("completed_at", `${loadFrom}T00:00:00Z`).lte("completed_at", `${loadToInclusive}T23:59:59Z`)
      .is("superseded_at", null).is("revoked_at", null);
    for (const c of (comps ?? []) as Array<{ completed_by: string | null; completed_at: string; notes: string | null }>) {
      if (!c.completed_by) continue;
      place(c.completed_by, c.completed_at, "tasks");
      if (c.notes && c.notes.trim()) place(c.completed_by, c.completed_at, "notes");
    }
  }

  // 2. FINALIZATIONS (instance confirmed + cash signed + pm submitted)
  for (const i of (instRows ?? []) as Array<{ confirmed_by: string | null; confirmed_at: string | null }>) {
    if (i.confirmed_by && i.confirmed_at) place(i.confirmed_by, i.confirmed_at, "finalizations");
  }
  const { data: cashRows } = await service
    .from("cash_reports").select("signed_by, signed_at, over_short_note")
    .eq("location_id", args.locationId).is("superseded_at", null)
    .gte("signed_at", `${loadFrom}T00:00:00Z`).lte("signed_at", `${loadToInclusive}T23:59:59Z`);
  for (const c of (cashRows ?? []) as Array<{ signed_by: string | null; signed_at: string | null; over_short_note: string | null }>) {
    if (c.signed_by && c.signed_at) {
      place(c.signed_by, c.signed_at, "finalizations");
      if (c.over_short_note && c.over_short_note.trim()) place(c.signed_by, c.signed_at, "notes");
    }
  }
  const { data: pmRows } = await service
    .from("pm_reports").select("id, submitted_by, submitted_at, mvp_user_id")
    .eq("location_id", args.locationId).is("superseded_at", null)
    .gte("submitted_at", `${loadFrom}T00:00:00Z`).lte("submitted_at", `${loadToInclusive}T23:59:59Z`);
  for (const r of (pmRows ?? []) as Array<{ submitted_by: string | null; submitted_at: string | null }>) {
    if (r.submitted_by && r.submitted_at) {
      place(r.submitted_by, r.submitted_at, "finalizations"); // finalizing the PM report
      place(r.submitted_by, r.submitted_at, "peopleMgmt"); // authoring evals/awarding = managing people
    }
  }

  // 3. NOTES from pm evals (area_to_improve / note authored by the report submitter)
  const pmReportById = new Map((pmRows ?? []).map((r) => [(r as { id: string }).id, r as { id: string; submitted_by: string | null; submitted_at: string | null }]));
  if (pmReportById.size) {
    const { data: evalRows } = await service
      .from("pm_employee_evals").select("pm_report_id, area_to_improve, note")
      .in("pm_report_id", [...pmReportById.keys()]).is("superseded_at", null);
    for (const e of (evalRows ?? []) as Array<{ pm_report_id: string; area_to_improve: string | null; note: string | null }>) {
      const rep = pmReportById.get(e.pm_report_id);
      if (rep?.submitted_by && rep.submitted_at && ((e.area_to_improve && e.area_to_improve.trim()) || (e.note && e.note.trim()))) {
        place(rep.submitted_by, rep.submitted_at, "notes");
      }
    }
  }

  // 4. OVERSIGHT (audit_log by actor_id — window-global, not location-tagged; documented impurity)
  const { data: auditRows } = await service
    .from("audit_log").select("actor_id, action, occurred_at")
    .in("actor_id", memberIds).in("action", OVERSIGHT_ACTIONS)
    .gte("occurred_at", `${loadFrom}T00:00:00Z`).lte("occurred_at", `${loadToInclusive}T23:59:59Z`);
  for (const a of (auditRows ?? []) as Array<{ actor_id: string | null; occurred_at: string }>) {
    if (a.actor_id) place(a.actor_id, a.occurred_at, "oversight");
  }

  // ── materialize members ──
  const out: TeamMember[] = [];
  let onTrack = 0, needsAttention = 0;
  const attentionNames: string[] = [];
  for (const [uid, m] of members) {
    const score = scoreFromCounts(m.role, m.acc.current);
    const previousScore = args.compare ? scoreFromCounts(m.role, m.acc.previous) : null;
    const { health, reasons } = healthFromCounts(m.role, m.acc.current, score, previousScore);
    const sparkline = currentKeys.map((k) => m.acc.byBucketScoreActions.get(k) ?? 0);
    const scoreDeltaPct = previousScore && previousScore > 0 ? Math.round(((score - previousScore) / previousScore) * 100) : null;
    if (health === "needs_attention") { needsAttention++; attentionNames.push(m.name); } else onTrack++;
    out.push({
      userId: uid, name: m.name, role: m.role, level: m.level,
      score, previousScore, counts: m.acc.current, health, reasons, sparkline,
      cardLine: personCardLine({ rank: 0, role: m.role, health, reasons, scoreDeltaPct, onTimePct: null }),
    });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    granularity: args.granularity,
    members: out,
    summary: { onTrack, needsAttention },
    banner: teamBannerNarrative({ onTrack, needsAttention, attentionNames: attentionNames.slice(0, 3) }),
  };
}

/** 1 when the category is expected for the role (counts toward score/sparkline), else 0. */
function scoreRelevant(role: RoleCode, category: ActionCategory): number {
  return scoreFromCounts(role, { ...emptyCounts(), [category]: 1 }) > 0 ? 1 : 0;
}
```

- [ ] **Step 2: Write live smoke** `scripts/smoke-team-metrics.ts` (wrap in main()):

```ts
import { loadTeamOperatingHealth, TEAM_VIEW_LEVEL, RANKED_MAX_LEVEL } from "@/lib/team-metrics";
import { getServiceRoleClient } from "@/lib/supabase-server";

function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }
async function main() {
  const sb = getServiceRoleClient();
  const { data: loc } = await sb.from("locations").select("id, code").eq("active", true).order("code").limit(1).maybeSingle<{ id: string; code: string }>();
  if (!loc) { console.log("no location; skipping"); return; }
  const today = new Date().toISOString().slice(0, 10);

  // under-level → null
  const denied = await loadTeamOperatingHealth(sb, { viewer: { userId: "x", level: 5 }, locationId: loc.id, granularity: "day", compare: true, today });
  assert(denied === null, "L5 under gate → null");

  const team = await loadTeamOperatingHealth(sb, { viewer: { userId: "x", level: 6 }, locationId: loc.id, granularity: "day", compare: true, today });
  assert(team !== null, "L6 authorized");
  assert(team!.members.every((m) => m.level < RANKED_MAX_LEVEL), "roster excludes MoO+ (level<8)");
  // ranked desc
  for (let i = 1; i < team!.members.length; i++) assert(team!.members[i - 1]!.score >= team!.members[i]!.score, "ranked desc by score");
  assert(team!.summary.onTrack + team!.summary.needsAttention === team!.members.length, "summary covers all members");
  assert(team!.banner.key.startsWith("people.banner."), "banner narrative present");
  // IDOR: bogus location → empty
  const bogus = await loadTeamOperatingHealth(sb, { viewer: { userId: "x", level: 6 }, locationId: "00000000-0000-0000-0000-000000000000", granularity: "day", compare: false, today });
  assert(bogus!.members.length === 0, "bogus location → no members (no leak)");

  console.log("sample:", JSON.stringify(team!.members.slice(0, 3).map((m) => ({ n: m.name, r: m.role, s: m.score, h: m.health, c: m.counts }))));
  console.log("ALL PASS");
}
main();
```

- [ ] **Step 3: Run smoke → `ALL PASS` (print sample). Step 4: `tsc` clean. Step 5: delete smoke + commit:**
```bash
rm scripts/smoke-team-metrics.ts
git add lib/team-metrics.ts
git commit -m "feat(people-metrics): loadTeamOperatingHealth — role-scoped roster, gate, IDOR

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `lib/team-metrics.ts` — `loadPersonDetail`

**Files:** Modify `lib/team-metrics.ts` (append); Smoke `scripts/smoke-person-detail.ts` (throwaway).

- [ ] **Step 1: Append types + loader to `lib/team-metrics.ts`:**

```ts
import { personReadNarrative } from "@/lib/people-narrative";

export interface PersonStreaks {
  activeDays: number;
  onTime: number;
  personalBest: number;
}

export interface PersonSignals {
  mvpAwards: number;          // times this person was named MVP (recipient)
  flaggedToImprove: number;   // # evals about them with area_to_improve
  mostActiveDay: string | null; // weekday key "mon".."sun" or null
  tenureDays: number | null;  // since users.created_at
  lastActive: string | null;  // YYYY-MM-DD of most recent action
}

export interface PersonDetail {
  userId: string;
  name: string;
  role: RoleCode;
  level: number;
  score: number;
  health: Health;
  reasons: string[];
  read: NarrativeLine;
  aiInsight: string | null; // ALWAYS null this cycle (reserved slot)
  // per-bucket series (current window) for the trends charts
  bucketKeys: string[];
  contribution: (number | null)[]; // tasks per bucket
  onTime: (number | null)[];       // on-time % per bucket (finalizations in-window)
  gradientTally: { great: number; good: number; needsWork: number }; // PM gradients in window
  streaks: PersonStreaks;
  signals: PersonSignals;
}
```

Then the loader (full implementation — uses `imports` already present; add `onTimeStreak`, `activeDayStreak`, `personalBest` to the `team-scoring` import line at top of file, and `EXPECTED_BY`/`computeOverdue` are NOT used here — on-time is computed from finalization-in-window booleans below):

```ts
export async function loadPersonDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; personId: string; locationId: string; granularity: TrendGranularity; compare: boolean; today: string },
): Promise<PersonDetail | null> {
  if (args.viewer.level < TEAM_VIEW_LEVEL) return null;

  // person must be on this location's roster + active + rankable
  const { data: ul } = await service
    .from("user_locations").select("user_id").eq("location_id", args.locationId).eq("user_id", args.personId).maybeSingle();
  if (!ul) return null; // not assigned here → no cross-location leak
  const { data: u } = await service
    .from("users").select("id, name, role, active, created_at").eq("id", args.personId).maybeSingle<{ id: string; name: string; role: RoleCode; active: boolean; created_at: string }>();
  if (!u || !u.active) return null;
  const level = ROLES[u.role]?.level ?? 0;
  if (level >= RANKED_MAX_LEVEL) return null;

  const { currentKeys, loadFrom } = computeWindows(args.today, args.granularity, args.compare);
  const curSet = new Set(currentKeys);
  const toIncl = args.today;

  const contribBucket = new Map<string, number>();
  const finalsInWindowChrono: { at: string; inWindow: boolean }[] = [];
  const activeDates = new Set<string>();
  const dayTaskCounts = new Map<string, number>();
  const weekdayCounts = new Map<string, number>();
  let lastActive: string | null = null;
  const touch = (d: string) => { if (!lastActive || d > lastActive) lastActive = d; activeDates.add(d); };

  // location instance ids
  const { data: instRows } = await service
    .from("checklist_instances").select("id").eq("location_id", args.locationId);
  const locInstanceIds = (instRows ?? []).map((r) => (r as { id: string }).id);

  // tasks (contribution) by completed_at
  if (locInstanceIds.length) {
    const { data: comps } = await service
      .from("checklist_completions").select("completed_at")
      .eq("completed_by", args.personId).in("instance_id", locInstanceIds)
      .gte("completed_at", `${loadFrom}T00:00:00Z`).lte("completed_at", `${toIncl}T23:59:59Z`)
      .is("superseded_at", null).is("revoked_at", null);
    for (const c of (comps ?? []) as Array<{ completed_at: string }>) {
      const d = opDate(c.completed_at);
      const bs = bucketStart(d, args.granularity);
      if (curSet.has(bs)) contribBucket.set(bs, (contribBucket.get(bs) ?? 0) + 1);
      touch(d);
      dayTaskCounts.set(d, (dayTaskCounts.get(d) ?? 0) + 1);
      const wd = WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
      weekdayCounts.set(wd, (weekdayCounts.get(wd) ?? 0) + 1);
    }
  }

  // on-time: finalizations this person owns, in/out of their expected window.
  // Reuse the report-status expected windows already encoded in lib/midshift via
  // doneAt vs window is per-report-type; here we approximate "on-time" as
  // closing/opening/cash finalized on the operational date they belong to (not late
  // by clock). We compute % of finalizations landing same-op-date as the report date.
  // (Precise window logic deferred; this is task-window timeliness, documented.)
  // closing/opening instances:
  const { data: finInst } = await service
    .from("checklist_instances").select("date, confirmed_at, status")
    .eq("location_id", args.locationId).eq("confirmed_by", args.personId)
    .not("confirmed_at", "is", null)
    .gte("confirmed_at", `${loadFrom}T00:00:00Z`).lte("confirmed_at", `${toIncl}T23:59:59Z`);
  for (const f of (finInst ?? []) as Array<{ date: string; confirmed_at: string }>) {
    const d = opDate(f.confirmed_at);
    finalsInWindowChrono.push({ at: f.confirmed_at, inWindow: d <= f.date /* finalized on/before its op date boundary is "in window" approximation */ ? true : sameOrNextDay(f.date, d) });
    touch(d);
  }
  finalsInWindowChrono.sort((a, b) => (a.at < b.at ? -1 : 1));
  const onTimeByBucket = new Map<string, { hit: number; total: number }>();
  for (const f of finalsInWindowChrono) {
    const bs = bucketStart(opDate(f.at), args.granularity);
    if (!curSet.has(bs)) continue;
    const e = onTimeByBucket.get(bs) ?? { hit: 0, total: 0 };
    e.total++; if (f.inWindow) e.hit++;
    onTimeByBucket.set(bs, e);
  }

  // PM gradients about THIS person in window
  const { data: pmIds } = await service
    .from("pm_reports").select("id, report_date").eq("location_id", args.locationId).is("superseded_at", null)
    .gte("report_date", loadFrom).lte("report_date", toIncl);
  const repIds = (pmIds ?? []).map((r) => (r as { id: string }).id);
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

  // MVP awards (recipient) in window
  const { data: mvp } = await service
    .from("pm_reports").select("id").eq("location_id", args.locationId).eq("mvp_user_id", args.personId).is("superseded_at", null)
    .gte("report_date", loadFrom).lte("report_date", toIncl);
  const mvpAwards = (mvp ?? []).length;

  // assemble
  const contribution = currentKeys.map((k) => (contribBucket.has(k) ? contribBucket.get(k)! : null));
  const onTime = currentKeys.map((k) => { const e = onTimeByBucket.get(k); return e && e.total > 0 ? Math.round((e.hit / e.total) * 100) : null; });
  const overallOnTime = (() => { let h = 0, t = 0; for (const e of onTimeByBucket.values()) { h += e.hit; t += e.total; } return t > 0 ? Math.round((h / t) * 100) : null; })();

  // health + read (reuse team score for this person over the window)
  // lightweight: recompute counts via the same categories is heavy; use contribution+finals as proxy not needed —
  // we recompute score by calling loadTeamOperatingHealth is wasteful. Instead derive a minimal score:
  const score = [...contribBucket.values()].reduce((s, n) => s + n, 0); // contribution-weighted proxy for the detail header
  const streaks: PersonStreaks = {
    activeDays: activeDayStreak([...activeDates], args.today),
    onTime: onTimeStreak(finalsInWindowChrono.map((f) => f.inWindow)),
    personalBest: personalBest([...dayTaskCounts.values()]),
  };
  let mostActiveDay: string | null = null; let max = -1;
  for (const [wd, n] of weekdayCounts) if (n > max) { max = n; mostActiveDay = wd; }
  const tenureDays = Math.max(0, Math.round((Date.parse(`${args.today}T00:00:00Z`) - Date.parse(u.created_at)) / 86400000));

  // health flag for the header: needs attention if no contribution and no finals this window
  const noActivity = contribBucket.size === 0 && finalsInWindowChrono.length === 0;
  const health: Health = noActivity ? "needs_attention" : "on_track";
  const read = personReadNarrative({ rank: 0, role: u.role, health, reasons: noActivity ? ["no_tasks"] : [], scoreDeltaPct: null, onTimePct: overallOnTime });

  return {
    userId: u.id, name: u.name, role: u.role, level, score, health, reasons: noActivity ? ["no_tasks"] : [],
    read, aiInsight: null,
    bucketKeys: currentKeys, contribution, onTime,
    gradientTally: { great, good, needsWork },
    streaks,
    signals: { mvpAwards, flaggedToImprove, mostActiveDay, tenureDays, lastActive },
  };
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function sameOrNextDay(reportDate: string, doneDate: string): boolean {
  // in-window approximation: finalized on the report's operational date.
  return doneDate === reportDate;
}
```

Also update the top import from `@/lib/team-scoring` to include `activeDayStreak, onTimeStreak, personalBest`.

> **Implementer note:** the detail header `score` here is a contribution proxy for display; the authoritative ranked score is in `loadTeamOperatingHealth`. If the spec reviewer flags the divergence, the cleaner fix is to have `loadTeamOperatingHealth` expose a per-person score map the detail reuses — but that couples the two loaders; for v1 the proxy is acceptable since the detail's emphasis is the metric breakdown + streaks, not the rank number (the rank lives on the roster). Surface this to the controller (CC) if unsure.

- [ ] **Step 2: Live smoke** `scripts/smoke-person-detail.ts` — pick a real member from `loadTeamOperatingHealth`, call `loadPersonDetail`, assert: `aiInsight === null`; `contribution.length === bucketKeys.length`; `onTime` values null or 0..100; `gradientTally` non-negative; cross-location personId (not on roster) → null; under-level viewer → null. Run → `ALL PASS`.

- [ ] **Step 3: `tsc` clean. Step 4: delete smoke + commit:**
```bash
rm scripts/smoke-person-detail.ts
git add lib/team-metrics.ts
git commit -m "feat(people-metrics): loadPersonDetail — metrics series, streaks, signals, reserved aiInsight

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: i18n keys (`reports.trends.team.*` + `people.*`)

**Files:** Modify `lib/i18n/en.json` + `es.json`; Smoke parity (throwaway).

- [ ] **Step 1:** Add to BOTH files (parity), alongside other `reports.trends.*` / new `people.*` keys. Keys required by the narrative module + components:

EN (add the same set to ES in tú-form Spanish):
```json
  "reports.trends.team.title": "Team",
  "reports.trends.team.nav_label": "Team",
  "reports.trends.team.subtitle": "Operating health — who's doing their part",
  "reports.trends.landing.title": "Trends",
  "reports.trends.landing.ops_card": "Ops Trends",
  "reports.trends.landing.ops_desc": "Par · temps · cash · completion over time",
  "reports.trends.landing.team_card": "Team",
  "reports.trends.landing.team_desc": "Operating health (managers)",
  "reports.trends.landing.relevant_now": "Relevant right now",
  "reports.trends.landing.ops_snapshot": "Ops snapshot",
  "reports.trends.landing.team_snapshot": "Team snapshot",
  "reports.trends.landing.view_ops": "View ops trends",
  "reports.trends.landing.view_team": "View team",
  "people.score": "score",
  "people.on_track": "on track",
  "people.needs_attention": "needs attention",
  "people.cat.tasks": "tasks",
  "people.cat.finalizations": "finals",
  "people.cat.peopleMgmt": "people",
  "people.cat.oversight": "oversight",
  "people.cat.notes": "notes",
  "people.detail.the_read": "The read",
  "people.detail.ai_insight": "AI Insight",
  "people.detail.ai_pending": "Reserved — an AI summary will appear here once the AI module is enabled.",
  "people.detail.contribution": "Contribution — tasks completed",
  "people.detail.on_time": "On-time completion",
  "people.detail.on_time_sub": "Task-window timeliness (not clock-in)",
  "people.detail.gradients": "PM gradients",
  "people.detail.streaks": "Streaks",
  "people.detail.streaks_from_data": "from our data",
  "people.detail.streak_active": "active days in a row",
  "people.detail.streak_ontime": "on-time in a row",
  "people.detail.streak_best": "personal best / day",
  "people.detail.toast_note": "Clock-in / early-arrival streaks need Toast — those unlock when Toast connects.",
  "people.signals.mvp": "MVP awards",
  "people.signals.flagged": "flagged to improve",
  "people.signals.most_active": "most-active day",
  "people.signals.tenure": "tenure",
  "people.signals.days": "{n}d",
  "people.signals.months": "{n} mo",
  "people.read.top_contributor": "Top contributor this period (+{delta}%). Consistently doing their part.",
  "people.read.steady_reliable": "Steady and reliable — {ontime}% on-time across finalized reports.",
  "people.read.on_track_generic": "On track — fulfilling the actions expected of their role.",
  "people.read.tasks_down": "Activity down ~{pct}% vs the previous period. Worth a check-in — support, not discipline.",
  "people.read.missing_category": "No {category} activity logged this period. Worth a check-in.",
  "people.read.needs_attention_generic": "Some expected activity is missing this period. Worth a check-in.",
  "people.line.top": "Top contributor",
  "people.line.steady": "Steady",
  "people.line.down": "Down ~{pct}% — check in",
  "people.line.check_in": "Worth a check-in",
  "people.banner.all_on_track": "All {onTrack} on track.",
  "people.banner.some_attention": "{onTrack} on track · {needs} need a check-in: {names}.",
  "people.weekday.mon": "Mon", "people.weekday.tue": "Tue", "people.weekday.wed": "Wed",
  "people.weekday.thu": "Thu", "people.weekday.fri": "Fri", "people.weekday.sat": "Sat", "people.weekday.sun": "Sun"
```

(ES: translate values, tú-form; keep `{...}` params intact. e.g. `"people.banner.some_attention": "{onTrack} en marcha · {needs} necesitan revisión: {names}."`, `"reports.trends.team.title": "Equipo"`, weekday abbreviations `Lun/Mar/Mié/Jue/Vie/Sáb/Dom`.)

- [ ] **Step 2:** Parity smoke (same as the trends cycle's: assert `Object.keys(en)` ≡ `Object.keys(es)`, and `>= 40` new keys present). Run → `ALL PASS`. **Step 3:** delete smoke + commit:
```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(people-metrics): reports.trends.team.* + people.* i18n (en+es)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `components/team/TeamRosterCard.tsx` (layout B) + `PersonDetail.tsx`

**Files:** Create both. Server Components; reuse `LineChart`/`BarChart` from `components/trends/`. Verify `tsc` + `next build`.

- [ ] **Step 1:** Create `components/team/TeamRosterCard.tsx` — props `{ member: TeamMember; locationId: string; language: Language }`. Renders a `<Link href={\`/reports/trends/team/${member.userId}?location=${locationId}\`}>` card: rank/name + role chip + score + ●/⚠ health dot, a `BarChart`/`LineChart` sparkline from `member.sparkline`, the category breakdown (`people.cat.*` + counts from `member.counts`, expected categories emphasized), and the translated `member.cardLine` (`serverT(language, cardLine.key as TranslationKey, cardLine.params)`). Health dot color: `var(--co-success)` / `var(--co-warning)`. Use the trends card styling (`rounded-2xl border-2 border-co-border bg-co-surface p-4`).

- [ ] **Step 2:** Create `components/team/PersonDetail.tsx` — props `{ detail: PersonDetail; locationId: string; language: Language }`. Renders the v2 layout: header (name · role chip · tenure via `people.signals.months`/`days` · last-active · score · ●/⚠); "The read" callout (`serverT(detail.read.key as TranslationKey, detail.read.params)`); reserved **AI Insight** panel (dashed, `people.detail.ai_pending`); **Contribution** `LineChart` (points `detail.contribution`, color `var(--co-gold-deep)`); **On-time** `LineChart` (points `detail.onTime`, color `var(--co-success)`, sub `people.detail.on_time_sub`); **PM gradients** a segmented bar from `detail.gradientTally`; **Streaks** chips (`detail.streaks`) + the `people.detail.toast_note` footnote; **Signals** chips (`detail.signals`: mvp/flagged/most-active via `people.weekday.<mostActiveDay>`/tenure). All section chrome mirrors the trends `TrendCard`.

- [ ] **Step 3:** `tsc --noEmit` + `npm run build` → clean. **Step 4:** commit:
```bash
git add components/team/TeamRosterCard.tsx components/team/PersonDetail.tsx
git commit -m "feat(people-metrics): TeamRosterCard (B) + PersonDetail components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `components/team/TeamRosterTable.tsx` (layout C) + `TrendsLanding.tsx`

**Files:** Create both. Server Components.

- [ ] **Step 1:** `components/team/TeamRosterTable.tsx` — props `{ health: TeamOperatingHealth; locationId: string; language: Language }`. A dense table (rank/name/role/score/●⚠). Per the "expand" affordance, render each member row followed by a compact breakdown line (`counts` + `cardLine`) — since these are Server Components (no client state), render the breakdown inline beneath each row in a muted style rather than a JS toggle (keeps it server-only; the full detail is one tap away on the Team page). Include the `health.banner` line at top and a footer link to `/reports/trends/team?location=${locationId}`.

- [ ] **Step 2:** `components/team/TrendsLanding.tsx` — props `{ locationId: string; language: Language; canSeeTeam: boolean; ops: { underPar: number; tempFlags: number } | null; team: TeamOperatingHealth | null; attention: { kind: "ops" | "team"; titleKey: string; sub: string }[] }`. Renders: two entry cards (Ops always → `/reports/trends/ops?location=`; Team only when `canSeeTeam` → `/reports/trends/team?location=`); a "Relevant right now" strip from `attention[]`; section snapshots (Ops mini from `ops`, Team mini from `team.summary` when `canSeeTeam`). All copy via `reports.trends.landing.*`.

- [ ] **Step 3:** `tsc` + `build` → clean. **Step 4:** commit:
```bash
git add components/team/TeamRosterTable.tsx components/team/TrendsLanding.tsx
git commit -m "feat(people-metrics): TeamRosterTable (C) + TrendsLanding components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Move ops content to `/reports/trends/ops`

**Files:** Create `app/(authed)/reports/trends/ops/page.tsx`; (the landing replaces the old page in Task 9).

- [ ] **Step 1:** Copy the ENTIRE current body of `app/(authed)/reports/trends/page.tsx` into a new `app/(authed)/reports/trends/ops/page.tsx`, renaming the default export `OpsTrendsPage` and updating `requireSessionFromHeaders("/reports/trends")` → `requireSessionFromHeaders("/reports/trends/ops")`. The `DashboardBackLink` and all chart logic stay identical. `TrendControls` hrefs must now point at `/reports/trends/ops` — update the `TrendControls` `href` builder OR pass a `basePath` prop. **Simplest:** add an optional `basePath = "/reports/trends/ops"` prop to `TrendControls` and use it in `href()`. Update `TrendControls` accordingly (default to `/reports/trends/ops` so existing callers are unaffected — verify no other caller).

- [ ] **Step 2:** `tsc` + `build` → clean (the old `/reports/trends/page.tsx` still exists and still compiles at this point). **Step 3:** commit:
```bash
git add "app/(authed)/reports/trends/ops/page.tsx" components/trends/TrendControls.tsx
git commit -m "feat(people-metrics): move ops trends to /reports/trends/ops (basePath on TrendControls)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Trends landing + Team pages

**Files:** Modify `app/(authed)/reports/trends/page.tsx` (→ landing); Create `app/(authed)/reports/trends/team/page.tsx` + `app/(authed)/reports/trends/team/[personId]/page.tsx`.

- [ ] **Step 1:** Replace `app/(authed)/reports/trends/page.tsx` body with the **landing**: auth + `lockLocationContext`; `canSeeTeam = auth.level >= TEAM_VIEW_LEVEL`; load a light ops summary (call `loadTrendSeries` day/30/no-compare, take `totals.par.current`/`totals.temps.current`) and, when `canSeeTeam`, `loadTeamOperatingHealth`; build the `attention[]` array (e.g. push an ops item when temps>0 or under-par rising; push a team item when `summary.needsAttention>0` with names); render `<TrendsLanding .../>`.

- [ ] **Step 2:** `app/(authed)/reports/trends/team/page.tsx` — auth; `if (auth.level < TEAM_VIEW_LEVEL) redirect("/dashboard")`; `lockLocationContext`; parse `g`/`cmp`; `loadTeamOperatingHealth`; render the banner + `TeamRosterCard` per member + `TrendControls basePath="/reports/trends/team"`.

- [ ] **Step 3:** `app/(authed)/reports/trends/team/[personId]/page.tsx` — `params: Promise<{ personId: string }>`; auth + level gate + `lockLocationContext`; `loadPersonDetail`; `if (!detail) redirect("/reports/trends/team?location=...")`; render `<PersonDetail/>` + `TrendControls`.

- [ ] **Step 4:** `tsc` + `build` → clean. Confirm `/reports/trends`, `/reports/trends/ops`, `/reports/trends/team`, `/reports/trends/team/[personId]` all appear in the route list. **Step 5:** commit:
```bash
git add "app/(authed)/reports/trends/page.tsx" "app/(authed)/reports/trends/team/page.tsx" "app/(authed)/reports/trends/team/[personId]/page.tsx"
git commit -m "feat(people-metrics): trends landing + Team roster + person detail pages (AGM+)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: AGM+ dashboard team widget

**Files:** Modify `app/(authed)/dashboard/page.tsx`.

- [ ] **Step 1:** Import `loadTeamOperatingHealth, TEAM_VIEW_LEVEL` from `@/lib/team-metrics` and `TeamRosterTable` from `@/components/team/TeamRosterTable`. After the existing `trendsSeries` load block, add (AGM+ only):
```ts
  const teamHealth =
    selectedLocation && operational && auth.level >= TEAM_VIEW_LEVEL
      ? await loadTeamOperatingHealth(sb, {
          viewer: { userId: auth.user.id, level: auth.level },
          locationId: selectedLocation.id,
          granularity: "day",
          compare: false,
          today: operational.todayDate,
        })
      : null;
```
- [ ] **Step 2:** Render after the `TrendsWidget`:
```tsx
        {selectedLocation && teamHealth ? (
          <TeamRosterTable health={teamHealth} locationId={selectedLocation.id} language={language} />
        ) : null}
```
- [ ] **Step 3:** `tsc` + `build` → clean. **Step 4:** commit:
```bash
git add "app/(authed)/dashboard/page.tsx"
git commit -m "feat(people-metrics): AGM+ dashboard team operating-health widget

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Final verification + PR

- [ ] **Step 1:** `npx tsc --noEmit && npm run build` → both clean.
- [ ] **Step 2:** Comprehensive live smoke `scripts/smoke-people-final.ts` (throwaway): across day/week/month — gate (L5 null / L6 ok), roster excludes level≥8, ranked desc, IDOR bogus-location empty, `loadPersonDetail` aiInsight null + series lengths + cross-location null. Run → `ALL PASS`; then `rm`.
- [ ] **Step 3:** Push + PR:
```bash
git push -u origin claude/people-metrics
gh pr create --title "People metrics: AGM+ team operating-health view + trends landing restructure" --body "$(cat <<'EOF'
## What
AGM+ per-location operating-health team view: role-scoped activity scoring across 5 categories (tasks/finalizations/people-mgmt/oversight/notes), ranked rich-card roster + per-person detail (contribution/on-time/PM-gradients/streaks/signals), deterministic narrative + reserved AI-insight slot. Plus the trends-landing restructure (landing + Ops + Team sub-views) and an AGM+ dashboard team widget.

## Key decisions
- View gate AGM+ (level >= 6); roster excludes MoO+ (level >= 8 not ranked). Per-location.
- Role→expected-categories keyed by ROLE CODE (trainer & key_holder both L4, differ).
- Streaks from our own data (active-day/on-time/personal-best); only clock-in/punctuality Toast-gated.
- Oversight from audit_log by actor_id (window-global — audit_log isn't location-tagged; documented).
- NO migrations — pure read surface. Reuses the trends time-engine + SVG charts.

## Deferred
Employee self-view, AI generation, per-category multipliers, clock-in streaks/punctuality (Toast), free-text search.

## Test plan
- tsc + next build clean.
- Live-row smokes: gate (L5 null/L6 ok), roster excludes MoO+, ranked desc, IDOR empty, person-detail aiInsight null + series lengths + cross-location null + streaks.
- Manual (preview URL): /reports/trends landing (Team card AGM+ only) → /reports/trends/team → a person; dashboard team widget for AGM+.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
- [ ] **Step 4:** Report the preview URL (`co-ops-git-claude-people-metrics-juan-co-devs-projects.vercel.app`) for Juan's smoke.

---

## Self-review

**Spec coverage:** view gate AGM+/roster<8 (T3,T9); role-scoped scoring by role code (T1); 5 categories incl. audit_log oversight (T3); narrative + reserved AI slot (T2,T4,T6); streaks our-data + Toast footnote (T1,T4,T6); roster rich-cards B (T6); person detail (T4,T6); landing restructure + ops move + Team pages (T8,T9); dashboard widget C AGM+ (T7,T10); i18n (T5); IDOR two-halves + per-location (T3,T4,T9); no migrations ✓; deferred items listed ✓.

**Placeholder scan:** no TBD/TODO; complete code for pure libs + loaders; components/pages specified with exact props, reusing already-built charts. The `loadPersonDetail` header-score proxy is flagged with an explicit reviewer note (not a placeholder — a documented v1 simplification).

**Type consistency:** `ActionCategory`/`CategoryCounts`/`Health` defined in T1, used T2/T3/T4. `TeamMember`/`TeamOperatingHealth`/`PersonDetail`/`Viewer`/`NarrativeLine` consistent across T3/T4/T6/T7/T9/T10. `TEAM_VIEW_LEVEL`/`RANKED_MAX_LEVEL` defined T3, used T4/T9/T10. `loadTeamOperatingHealth`/`loadPersonDetail` signatures match all call sites. `TrendControls` gains a `basePath` prop (T8) used by ops + team pages (T9).

**Note:** on-time is a documented task-window approximation (finalized on its operational date); precise per-report-type window logic is deferred. `loadPersonDetail` header score is a contribution proxy (rank authority lives on the roster) — flagged for reviewer.
