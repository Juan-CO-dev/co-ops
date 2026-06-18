# Public Employee Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Positive-only public employee profiles — a `/profile` directory of teammates you share a location with, and a `/profile/[userId]` card (MVP wins, mostly-Great ratings, streaks, contribution, tenure, recent task-velocity), never showing scores/needs-work/notes.

**Architecture:** A new `lib/profiles.ts` with `loadPublicProfile` (shared-location gated, person-level positive aggregate) + `loadProfileDirectory` (shared-location teammates, MVP-headline). Reuses the streak helpers + shared paginator. Fills the `/profile` stub. No migration.

**Tech Stack:** Next.js 16 App Router (Server Components), TS strict + `noUncheckedIndexedAccess`, Supabase service-role reads, Tailwind v4. No test framework — `tsc` + `next build` + throwaway `tsx` smokes (incl. a live gate-null smoke).

**Branch:** `claude/public-profiles` (created; spec committed there).

**Spec:** `docs/superpowers/specs/2026-06-18-public-profiles-design.md`

---

## Ground-truth (verified)

- `auth.locations: string[]` (the viewer's location ids). **L9+ get all-locations override** (the dashboard treats `level >= 9 && auth.locations.length === 0` as "all"); `accessibleLocations(actor): string[] | "all"` (`@/lib/locations`) returns `"all"` for level ≥ 9. The profile pages compute `accessibleLocations(actor)` and pass `string[] | "all"` to the loaders; `"all"` → no shared-location restriction.
- `user_locations(user_id, location_id)` (no `active` col); `users(id, name, role, created_at, active)`; `locations(id, code, active)`.
- `pm_reports(mvp_user_id, superseded_at)`; `pm_employee_evals(employee_id, arrived_ready, attitude, production, team_player, superseded_at)`; `checklist_completions(completed_by, completed_at, superseded_at, revoked_at)` — live = both null.
- `lib/team-scoring.ts` exports `activeDayStreak(dates, today)`, `personalBest(dayCounts)`; has a module-private `shiftDay(yyyymmdd, n)` (used by `activeDayStreak`). `longestStreak` will be added there (reuses `shiftDay`).
- `opDate(tstz)` (tstz → operational `YYYY-MM-DD`, TZ America/New_York) is **private in `lib/team-metrics.ts`** — `lib/profiles.ts` defines its own small copy.
- `selectAllRows` is in `@/lib/supabase-paginate`.
- `app/profile/page.tsx` is a `PlaceholderCard` stub; `nav.profile` chip → `/profile` (unscoped). `requireSessionFromHeaders` + `getServiceRoleClient` + `serverT` patterns as elsewhere. `RoleCode`/`ROLES` from `@/lib/roles` (`ROLES[role].shortLabel`).
- Reuse `components/trends/LineChart` (or a small bar) for the velocity sparkline; the "mostly Great" segmented bar is great/good only.

---

## File structure

- **Modify `lib/team-scoring.ts`** — add pure `longestStreak`.
- **Create `lib/profiles.ts`** — types + `loadPublicProfile` + `loadProfileDirectory` + local `opDate`.
- **Modify `lib/i18n/en.json` + `es.json`** — `profile.*`.
- **Create `components/profile/PublicProfileCard.tsx`** + **`components/profile/ProfileDirectory.tsx`**.
- **Modify `app/profile/page.tsx`** (stub → directory); **Create `app/profile/[userId]/page.tsx`**.

---

### Task 1: `longestStreak` pure helper

**Files:** Modify `lib/team-scoring.ts`; Smoke `scripts/smoke-longest-streak.ts` (throwaway).

- [ ] **Step 1: Append to `lib/team-scoring.ts`** (after `personalBest`, reusing the existing private `shiftDay`):
```ts
/** Longest run of consecutive calendar days present in the set. */
export function longestStreak(dates: string[]): number {
  const set = new Set(dates);
  let best = 0;
  for (const d of set) {
    if (set.has(shiftDay(d, -1))) continue; // only count from a run start
    let len = 1;
    let cur = d;
    while (set.has(shiftDay(cur, 1))) { len++; cur = shiftDay(cur, 1); }
    if (len > best) best = len;
  }
  return best;
}
```

- [ ] **Step 2: Smoke** `scripts/smoke-longest-streak.ts` (wrap in `main()`):
```ts
import { longestStreak } from "@/lib/team-scoring";
function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }
async function main() {
  assert(longestStreak([]) === 0, "empty → 0");
  assert(longestStreak(["2026-06-10"]) === 1, "single → 1");
  assert(longestStreak(["2026-06-10","2026-06-11","2026-06-12"]) === 3, "3 contiguous → 3");
  assert(longestStreak(["2026-06-10","2026-06-12","2026-06-13","2026-06-14"]) === 3, "longest of split runs");
  assert(longestStreak(["2026-06-14","2026-06-13","2026-06-12"]) === 3, "unordered input");
  assert(longestStreak(["2026-06-10","2026-06-10"]) === 1, "dup dates → 1");
  assert(longestStreak(["2026-02-28","2026-03-01"]) === 2, "crosses month boundary");
  console.log("ALL PASS");
}
main();
```

- [ ] **Step 3:** Run → `ALL PASS`. **Step 4:** `tsc` clean. **Step 5:** delete smoke + commit:
```bash
rm scripts/smoke-longest-streak.ts
git add lib/team-scoring.ts
git commit -m "feat(profiles): longestStreak pure helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `lib/profiles.ts` — `loadPublicProfile` + `loadProfileDirectory`

**Files:** Create `lib/profiles.ts`; Smoke `scripts/smoke-profiles.ts` (throwaway, live gate-null).

- [ ] **Step 1: Create `lib/profiles.ts`:**
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLES, type RoleCode } from "@/lib/roles";
import { activeDayStreak, longestStreak, personalBest } from "@/lib/team-scoring";
import { selectAllRows } from "@/lib/supabase-paginate";

const OPERATIONAL_TZ = "America/New_York";
/** timestamptz → operational YYYY-MM-DD. */
function opDate(tstz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(tstz));
}
function addDays(yyyymmdd: string, n: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const VELOCITY_DAYS = 30;

export interface PublicProfile {
  userId: string;
  name: string;
  role: RoleCode;
  locationCodes: string[];
  tenureDays: number;
  mvpWins: number;
  tasksAllTime: number;
  /** Positive ratings only — needs-work is computed but deliberately NOT returned. */
  gradient: { great: number; good: number };
  streaks: { current: number; longest: number; personalBest: number };
  /** Recent daily task counts, oldest→newest, length VELOCITY_DAYS. */
  velocity: number[];
}

export interface DirectoryEntry {
  userId: string;
  name: string;
  role: RoleCode;
  /** MVP wins (all-time) — the one cheaply-tallyable directory headline; 0 = none shown. */
  mvpWins: number;
}

/** Resolve the active user ids the viewer may see: shares ≥1 location, or all (L9+). */
async function viewableUserIds(
  service: SupabaseClient,
  viewerLocations: string[] | "all",
): Promise<string[]> {
  if (viewerLocations === "all") {
    const { data } = await service.from("users").select("id").eq("active", true);
    return (data ?? []).map((r) => (r as { id: string }).id);
  }
  if (viewerLocations.length === 0) return [];
  const ulRows = await selectAllRows<{ user_id: string }>(
    (from, to) => service.from("user_locations").select("user_id")
      .in("location_id", viewerLocations).order("user_id", { ascending: true }).range(from, to),
  );
  const ids = [...new Set(ulRows.map((r) => r.user_id))];
  if (ids.length === 0) return [];
  const { data: users } = await service.from("users").select("id").in("id", ids).eq("active", true);
  return (users ?? []).map((r) => (r as { id: string }).id);
}

export async function loadProfileDirectory(
  service: SupabaseClient,
  args: { viewer: { userId: string; locations: string[] | "all" } },
): Promise<DirectoryEntry[]> {
  const ids = await viewableUserIds(service, args.viewer.locations);
  if (ids.length === 0) return [];
  const { data: users } = await service.from("users").select("id, name, role").in("id", ids);
  const userRows = (users ?? []) as Array<{ id: string; name: string; role: RoleCode }>;

  // MVP tally (one query over the viewable set).
  const mvpByUser = new Map<string, number>();
  const mvp = await selectAllRows<{ mvp_user_id: string | null }>(
    (from, to) => service.from("pm_reports").select("mvp_user_id")
      .in("mvp_user_id", ids).is("superseded_at", null)
      .order("mvp_user_id", { ascending: true }).range(from, to),
  );
  for (const r of mvp) if (r.mvp_user_id) mvpByUser.set(r.mvp_user_id, (mvpByUser.get(r.mvp_user_id) ?? 0) + 1);

  return userRows
    .map((u) => ({ userId: u.id, name: u.name, role: u.role, mvpWins: mvpByUser.get(u.id) ?? 0 }))
    .sort((a, b) => b.mvpWins - a.mvpWins || a.name.localeCompare(b.name));
}

export async function loadPublicProfile(
  service: SupabaseClient,
  args: { viewerUserId: string; viewerLocations: string[] | "all"; targetUserId: string; today: string },
): Promise<PublicProfile | null> {
  // ── Target must be active ──
  const { data: u } = await service
    .from("users").select("id, name, role, created_at, active").eq("id", args.targetUserId)
    .maybeSingle<{ id: string; name: string; role: RoleCode; created_at: string; active: boolean }>();
  if (!u || !u.active) return null;

  // ── Visibility gate: viewer shares ≥1 location with target (unless viewer is all-locations) ──
  const { data: tul } = await service.from("user_locations").select("location_id").eq("user_id", args.targetUserId);
  const targetLocationIds = (tul ?? []).map((r) => (r as { location_id: string }).location_id);
  if (args.viewerLocations !== "all") {
    const shared = targetLocationIds.some((l) => args.viewerLocations.includes(l));
    if (!shared) return null;
  }

  // ── Location codes ──
  let locationCodes: string[] = [];
  if (targetLocationIds.length) {
    const { data: locs } = await service.from("locations").select("code").in("id", targetLocationIds);
    locationCodes = (locs ?? []).map((r) => (r as { code: string }).code);
  }

  // ── Completion series (live, by completer) → tasksAllTime + streaks + velocity ──
  const comps = await selectAllRows<{ completed_at: string }>(
    (from, to) => service.from("checklist_completions").select("completed_at")
      .eq("completed_by", args.targetUserId).is("superseded_at", null).is("revoked_at", null)
      .order("completed_at", { ascending: true }).range(from, to),
  );
  const tasksAllTime = comps.length;
  const dayCounts = new Map<string, number>();
  for (const c of comps) {
    const d = opDate(c.completed_at);
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  }
  const activeDates = [...dayCounts.keys()];
  const streaks = {
    current: activeDayStreak(activeDates, args.today),
    longest: longestStreak(activeDates),
    personalBest: personalBest([...dayCounts.values()]),
  };
  // Recent velocity: VELOCITY_DAYS ending today, oldest→newest.
  const velocity: number[] = [];
  for (let i = VELOCITY_DAYS - 1; i >= 0; i--) {
    velocity.push(dayCounts.get(addDays(args.today, -i)) ?? 0);
  }

  // ── MVP wins (all-time) ──
  const { count: mvpCount } = await service
    .from("pm_reports").select("id", { count: "exact", head: true })
    .eq("mvp_user_id", args.targetUserId).is("superseded_at", null);
  const mvpWins = mvpCount ?? 0;

  // ── Gradient distribution (great/good shown; needs-work computed, NOT returned) ──
  const evals = await selectAllRows<{ arrived_ready: string; attitude: string; production: string; team_player: string }>(
    (from, to) => service.from("pm_employee_evals").select("arrived_ready, attitude, production, team_player")
      .eq("employee_id", args.targetUserId).is("superseded_at", null)
      .order("pm_report_id", { ascending: true }).range(from, to),
  );
  let great = 0, good = 0; // needsWork intentionally not tracked/returned
  for (const e of evals) {
    for (const g of [e.arrived_ready, e.attitude, e.production, e.team_player]) {
      if (g === "great") great++; else if (g === "good") good++;
    }
  }

  const tenureDays = Math.max(0, Math.round((Date.parse(`${args.today}T00:00:00Z`) - Date.parse(u.created_at)) / 86400000));

  return {
    userId: u.id, name: u.name, role: u.role, locationCodes, tenureDays,
    mvpWins, tasksAllTime, gradient: { great, good }, streaks, velocity,
  };
}
```
(`ROLES` import is used by the components, not here — REMOVE the `ROLES` import from this file if tsc flags it unused; keep `RoleCode`. Verify and report.)

- [ ] **Step 2: Live gate-null smoke** `scripts/smoke-profiles.ts` (wrap in `main()`):
```ts
import { loadPublicProfile, loadProfileDirectory } from "@/lib/profiles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { operationalNow } from "@/lib/midshift";
function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }
async function main() {
  const sb = getServiceRoleClient();
  const { data: locs } = await sb.from("locations").select("id, code").eq("active", true).order("code");
  if (!locs || locs.length === 0) { console.log("no loc"); return; }
  const today = operationalNow(new Date()).date;

  // a user assigned to locs[0]
  const { data: ul } = await sb.from("user_locations").select("user_id").eq("location_id", locs[0]!.id).limit(1).maybeSingle<{ user_id: string }>();
  if (!ul) { console.log("no assigned user; skipping"); return; }
  const target = ul.user_id;

  // viewer sharing locs[0] can see the profile
  const prof = await loadPublicProfile(sb, { viewerUserId: "viewer", viewerLocations: [locs[0]!.id], targetUserId: target, today });
  assert(prof !== null, "shared-location viewer sees profile");
  const keys = Object.keys(prof as object);
  for (const banned of ["score", "needsWork", "areaToImprove", "note", "mvpNote", "flaggedToImprove"]) {
    assert(!keys.includes(banned), `profile shape has NO ${banned}`);
  }
  assert(!("needsWork" in (prof!.gradient as object)), "gradient has NO needsWork");
  assert(prof!.velocity.length === 30, "velocity length 30");
  assert(prof!.tasksAllTime >= 0 && prof!.mvpWins >= 0, "counts non-negative");
  assert(prof!.streaks.longest >= prof!.streaks.current || prof!.streaks.current === 0 || prof!.streaks.longest >= 1, "longest >= current (or trivial)");

  // viewer sharing NO location → null (visibility gate). Use a bogus location id.
  const denied = await loadPublicProfile(sb, { viewerUserId: "viewer", viewerLocations: ["00000000-0000-0000-0000-000000000000"], targetUserId: target, today });
  // only assert null if the target is NOT also assigned to the bogus loc (it isn't) AND target has at least one real location
  if ((await sb.from("user_locations").select("location_id").eq("user_id", target)).data?.length) {
    assert(denied === null, "no-shared-location viewer → null (visibility gate)");
  }

  // all-locations viewer sees it
  const allView = await loadPublicProfile(sb, { viewerUserId: "viewer", viewerLocations: "all", targetUserId: target, today });
  assert(allView !== null, "all-locations viewer sees profile");

  // directory: shared-location set, sorted by mvp desc
  const dir = await loadProfileDirectory(sb, { viewer: { userId: "viewer", locations: [locs[0]!.id] } });
  assert(dir.every((e) => e.mvpWins >= 0 && typeof e.name === "string"), "directory entries shaped");
  assert(dir.some((e) => e.userId === target), "directory includes the shared-location user");
  for (let i = 1; i < dir.length; i++) assert(dir[i - 1]!.mvpWins >= dir[i]!.mvpWins, "directory sorted mvp desc");

  console.log("sample:", JSON.stringify({ name: prof!.name, mvpWins: prof!.mvpWins, tasks: prof!.tasksAllTime, streaks: prof!.streaks, gradient: prof!.gradient }));
  console.log("ALL PASS");
}
main();
```

- [ ] **Step 3:** Run → `ALL PASS` (print sample). **Step 4:** `tsc` clean. **Step 5:** delete smoke + commit:
```bash
rm scripts/smoke-profiles.ts
git add lib/profiles.ts
git commit -m "feat(profiles): loadPublicProfile + loadProfileDirectory — positive aggregate, shared-location gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: i18n `profile.*` (en + es)

**Files:** Modify `lib/i18n/en.json` + `es.json`; parity smoke (throwaway).

- [ ] **Step 1: en.json:**
```json
  "profile.directory_title": "Team Profiles",
  "profile.directory_sub": "Teammates at your location",
  "profile.directory_empty": "No teammates to show yet.",
  "profile.you": "You",
  "profile.tenure_months": "{n} months on the team",
  "profile.tenure_days": "{n} days on the team",
  "profile.mvp_wins": "MVP wins",
  "profile.longest_streak": "longest streak",
  "profile.current_streak": "current streak",
  "profile.tasks_all_time": "tasks all-time",
  "profile.personal_best": "personal best / day",
  "profile.velocity_title": "Task velocity — recent",
  "profile.velocity_note": "Days active over the last 30 days.",
  "profile.ratings_title": "Manager ratings — mostly Great 🌟",
  "profile.ratings_note": "{great}% Great · {good}% Good.",
  "profile.ratings_none": "No ratings yet.",
  "profile.reassure": "Profiles show positive highlights only — never scores, notes, or areas to improve.",
  "profile.toast_note": "Early-clock-in streaks unlock when Toast connects.",
  "profile.not_found": "That profile isn't available.",
  "profile.back": "Back to profiles"
```
- [ ] **Step 2: es.json** (tú-form):
```json
  "profile.directory_title": "Perfiles del Equipo",
  "profile.directory_sub": "Compañeros de tu ubicación",
  "profile.directory_empty": "Aún no hay compañeros para mostrar.",
  "profile.you": "Tú",
  "profile.tenure_months": "{n} meses en el equipo",
  "profile.tenure_days": "{n} días en el equipo",
  "profile.mvp_wins": "premios MVP",
  "profile.longest_streak": "racha más larga",
  "profile.current_streak": "racha actual",
  "profile.tasks_all_time": "tareas en total",
  "profile.personal_best": "récord personal / día",
  "profile.velocity_title": "Velocidad de tareas — reciente",
  "profile.velocity_note": "Días activo en los últimos 30 días.",
  "profile.ratings_title": "Calificaciones — casi todo Excelente 🌟",
  "profile.ratings_note": "{great}% Excelente · {good}% Bien.",
  "profile.ratings_none": "Aún sin calificaciones.",
  "profile.reassure": "Los perfiles muestran solo aspectos positivos — nunca puntajes, notas ni áreas para mejorar.",
  "profile.toast_note": "Las rachas de reloj de entrada se activan cuando se conecte Toast.",
  "profile.not_found": "Ese perfil no está disponible.",
  "profile.back": "Volver a perfiles"
```
- [ ] **Step 3: Parity smoke** (assert key parity + ≥ 19 `profile.*` keys + `{n}`/`{great}`/`{good}` tokens aligned). Run → `ALL PASS`. **Step 4:** `tsc` clean. **Step 5:** delete smoke + commit:
```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(profiles): profile.* i18n (en+es)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `PublicProfileCard` + `ProfileDirectory` components

**Files:** Create both under `components/profile/`. Server Components; verify `tsc` + `next build`.

- [ ] **Step 1: `components/profile/PublicProfileCard.tsx`** — props `{ profile: PublicProfile; language: Language; isSelf: boolean }`. Layout (the approved mockup):
  - Header: avatar circle (first letter of `profile.name`, `bg-co-gold`), `profile.name` (text-xl font-extrabold) + role chip (`ROLES[profile.role].shortLabel`) + meta line `📍 {locationCodes.join(" · ")} · {tenure}` where tenure uses `profile.tenureDays >= 60 ? serverT("profile.tenure_months",{n: Math.round(tenureDays/30)}) : serverT("profile.tenure_days",{n: tenureDays})`. If `isSelf`, show a small `profile.you` badge.
  - Highlight tiles (flex): `⭐ {mvpWins}` `profile.mvp_wins`; `🔥 {streaks.longest}` `profile.longest_streak`; `{tasksAllTime}` `profile.tasks_all_time`. (Show current-streak + personal-best as smaller chips below, using `profile.current_streak` / `profile.personal_best`.)
  - **Velocity** card: title `profile.velocity_title`; render `profile.velocity` as a small bar chart — reuse `BarChart` from `@/components/trends/BarChart` (`current={profile.velocity}` colorCurrent `var(--co-success)` height 40) or a simple inline `<div>` bar row; note `profile.velocity_note`.
  - **Ratings** card: title `profile.ratings_title`; if `great+good === 0` show `profile.ratings_none`; else a segmented bar of great:good (great=`var(--co-success)`, good=`#9ccc9c`) + `profile.ratings_note` with `great`/`good` as integer percentages of (great+good).
  - Footnote: `profile.toast_note` (small) + `profile.reassure` (small, centered).

- [ ] **Step 2: `components/profile/ProfileDirectory.tsx`** — props `{ entries: DirectoryEntry[]; viewerUserId: string; language: Language }`. A 2-col grid of `<Link href={\`/profile/${e.userId}\`}>` cards: avatar initial · name (+ `profile.you` badge when `e.userId === viewerUserId`) · role · `⭐ {e.mvpWins}` when `> 0`. If `entries.length === 0`, render `profile.directory_empty`.

- [ ] **Step 3:** `tsc` + `npm run build` → clean. **Step 4:** commit:
```bash
git add components/profile/PublicProfileCard.tsx components/profile/ProfileDirectory.tsx
git commit -m "feat(profiles): PublicProfileCard + ProfileDirectory components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `/profile` directory page + `/profile/[userId]` page

**Files:** Modify `app/profile/page.tsx`; Create `app/profile/[userId]/page.tsx`.

- [ ] **Step 1: Rewrite `app/profile/page.tsx`:**
```tsx
/** /profile — team directory of viewable teammates (shared location). */
import { serverT } from "@/lib/i18n/server";
import { accessibleLocations, type LocationActor } from "@/lib/locations";
import { loadProfileDirectory } from "@/lib/profiles";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { ProfileDirectory } from "@/components/profile/ProfileDirectory";

export default async function ProfilePage() {
  const auth = await requireSessionFromHeaders("/profile");
  const lang = auth.user.language;
  const sb = getServiceRoleClient();
  const actor: LocationActor = { role: auth.role, locations: auth.locations };
  const entries = await loadProfileDirectory(sb, {
    viewer: { userId: auth.user.id, locations: accessibleLocations(actor) },
  });
  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="text-lg font-bold text-co-text">{serverT(lang, "profile.directory_title")}</h1>
      <p className="mb-4 text-xs text-co-text-muted">{serverT(lang, "profile.directory_sub")}</p>
      <ProfileDirectory entries={entries} viewerUserId={auth.user.id} language={lang} />
    </main>
  );
}
```

- [ ] **Step 2: Create `app/profile/[userId]/page.tsx`:**
```tsx
/** /profile/[userId] — a teammate's positive public profile (shared-location gated). */
import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import { accessibleLocations, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { loadPublicProfile } from "@/lib/profiles";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { PublicProfileCard } from "@/components/profile/PublicProfileCard";

interface PageProps { params: Promise<{ userId: string }>; }

export default async function PublicProfilePage({ params }: PageProps) {
  const auth = await requireSessionFromHeaders("/profile");
  const { userId } = await params;
  const lang = auth.user.language;
  const sb = getServiceRoleClient();
  const actor: LocationActor = { role: auth.role, locations: auth.locations };
  const profile = await loadPublicProfile(sb, {
    viewerUserId: auth.user.id,
    viewerLocations: accessibleLocations(actor),
    targetUserId: userId,
    today: operationalNow(new Date()).date,
  });
  if (!profile) redirect("/profile"); // not viewable / not found → back to directory

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <PublicProfileCard profile={profile} language={lang} isSelf={profile.userId === auth.user.id} />
    </main>
  );
}
```

- [ ] **Step 3:** `tsc` + `npm run build` → clean. Confirm `/profile` + `/profile/[userId]` in the route list. **Step 4:** commit:
```bash
git add "app/profile/page.tsx" "app/profile/[userId]/page.tsx"
git commit -m "feat(profiles): /profile directory + /profile/[userId] pages (fills the stub)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Final verification + PR

- [ ] **Step 1:** `npx tsc --noEmit && npm run build` → clean.
- [ ] **Step 2:** Comprehensive live smoke `scripts/smoke-profiles-final.ts` (throwaway): shared-location viewer sees profile; bogus-location viewer → null; all-locations viewer sees it; profile shape has no score/needsWork/areaToImprove/note keys; velocity length 30; directory shared-location set sorted mvp-desc. Run → `ALL PASS`; `rm`.
- [ ] **Step 3:** Push + PR:
```bash
git push -u origin claude/public-profiles
gh pr create --title "Public employee profiles (positive, shared-location)" --body "$(cat <<'BODY'
## What
Positive-only public profiles. `/profile` = a directory of teammates you share a location with; `/profile/[userId]` = a positive card (MVP wins, mostly-Great ratings, current+longest streak, tasks all-time, tenure, recent task-velocity sparkline). Fills the `/profile` nav stub.

- `lib/profiles.ts`: `loadPublicProfile` (shared-location gated, person-level positive aggregate) + `loadProfileDirectory` (shared-location teammates, MVP-headline). `longestStreak` added to `lib/team-scoring.ts`. Reuses the shared paginator + streak helpers. All-time MVP via `count: exact`.
- Components + pages; i18n `profile.*` EN+ES.

## Security / privacy
Positive fields ONLY — score, needs-work, area-to-improve, and every note are never selected or returned (the gradient returns great/good, needs-work computed-but-omitted). Visibility gate: a viewer sees a profile only if they share ≥1 location with the target (L9+ all-locations); enforced before any aggregate runs. Live smoke proves a no-shared-location viewer → null and the profile shape carries no banned keys.

## NO migration. Person-level aggregate (counts by user id; the gate is visibility, not field redaction).

## Deferred
Company-wide visibility, bio/photo, app-wide name links, opt-out, clock-in streaks (Toast).

## Test plan
- tsc + next build clean.
- Pure smoke: longestStreak (gaps/single/empty/contiguous/month-boundary).
- Live smoke: shared-location → profile; no-shared-location → null; all-locations → profile; no banned keys; velocity length 30; directory shared-location set, mvp-desc.
- Manual (preview): open /profile as a floor employee → directory of your location; tap a teammate → positive card; confirm no score/needs-work/notes; your own card shows a "You" badge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```
- [ ] **Step 4:** Report the preview URL (`co-ops-git-claude-public-profiles-juan-co-devs-projects.vercel.app`).

---

## Self-review

**Spec coverage:** positive projection (T2 — only positive fields returned; gradient great/good, needs-work omitted) ✓; shared-location visibility gate before aggregate (T2 `loadPublicProfile`) ✓; person-level aggregate (counts by user id) ✓; all-time + recent velocity (T2) ✓; directory (T2 `loadProfileDirectory`, MVP-headline — simplification noted; richer per-user stats would need a group-count RPC, deferred) ✓; surfaces `/profile` + `/profile/[userId]` filling the stub (T5) ✓; longest streak helper (T1); i18n (T3); components (T4); no migration ✓; deferred listed ✓.

**Placeholder scan:** complete code T1–T3, T5; structural-with-exact-props T4. No TBD. The `ROLES`-import-unused note in T2 is flagged for the implementer to resolve.

**Type consistency:** `PublicProfile`/`DirectoryEntry` (T2) consumed by components (T4 props) + pages (T5); `loadPublicProfile({viewerUserId, viewerLocations, targetUserId, today})` + `loadProfileDirectory({viewer:{userId,locations}})` signatures match the page calls (T5); `accessibleLocations(actor): string[] | "all"` feeds `viewerLocations`/`locations` (typed `string[] | "all"`) consistently; `longestStreak(dates)` (T1) used in T2; `velocity: number[]` length 30 consistent (T2 builds, T4 renders). `gradient: {great, good}` (no needsWork) consistent T2↔T4.
