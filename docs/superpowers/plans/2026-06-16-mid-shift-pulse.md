# Mid-Shift Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only operational "pulse" surface (`/mid-shift`) that lets KH+ managers glance mid-service and see whether the day is on track and what needs action — composed entirely from already-captured data.

**Architecture:** A `lib/midshift.ts` loader composes the shipped dashboard-state loaders (am-prep / mid-day / cash) + inline opening/closing instance queries + `loadMaintenanceOverview` + an "active today" activity query into one `MidShiftPulse` object, applying a clock + closing-dependent overdue model. A server page renders five presentational sections. A nav-bar chip is the entry point. No new tables, no writes.

**Tech Stack:** Next 16 App Router (server components), React 19, Tailwind v4 tokens, TS strict (`noUncheckedIndexedAccess`). No unit-test framework — verify via `npm run typecheck` + `npm run build` + throwaway `tsx` smokes (`npx tsx --env-file=.env.local scripts/X.ts`, self-cleaning).

**Verification note (read once):** CO-OPS has NO test framework. Wherever this plan says "test," it means a throwaway `tsx` smoke script run against live data, then deleted — plus the `tsc`/`build` gates. Commits are per-task. CC reviews each task diff (T0 sole reviewer).

---

## File Structure

- **Create `lib/midshift.ts`** — types (`MidShiftPulse`, `ReportStatusRow`, `ReportKey`, `OverdueState`, `ActiveStaff`), `MIDSHIFT_BASE_LEVEL`, `EXPECTED_BY` config, `operationalNow` helper, status/overdue compute, attention-item derivation, active-today query, `loadMidShiftPulse` orchestrator. One file — it's the brain; all logic is here so the page + components stay dumb.
- **Create `app/(authed)/mid-shift/page.tsx`** — server page: KH+ gate, resolve location, call `loadMidShiftPulse`, render sections.
- **Create `components/midshift/AttentionBanner.tsx`, `ReportStatusList.tsx`, `FridgeStrip.tsx`, `ActiveToday.tsx`, `SalesPlaceholder.tsx`** — server presentational components.
- **Modify `components/DashboardNav.tsx`** — add the Mid-Shift Pulse chip.
- **Modify `lib/i18n/en.json` + `lib/i18n/es.json`** — `midshift.*` keys.

---

## Task 1: `lib/midshift.ts` — types, config, operational-time + overdue logic

**Files:**
- Create: `lib/midshift.ts`

- [ ] **Step 1: Write the module's types + pure logic**

Create `lib/midshift.ts` with EXACTLY this (pure logic + config; loaders added in Tasks 2–3):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export const MIDSHIFT_BASE_LEVEL = 4; // KH+ (key_holder = 4 in lib/roles.ts)

/** Operational timezone — CO is DC-only; hardcoded per the dashboard's convention. */
const OPERATIONAL_TZ = "America/New_York";

export type ReportKey = "opening" | "am_prep" | "mid_day" | "cash" | "closing";

/** Instance statuses that count as "submitted/done" for pulse purposes. */
const SUBMITTED_STATUSES = new Set([
  "phase2_complete",
  "confirmed",
  "incomplete_confirmed",
  "auto_finalized",
]);
export function isSubmitted(status: string | null | undefined): boolean {
  return status != null && SUBMITTED_STATUSES.has(status);
}

export type ReportProgress = "done" | "in_progress" | "not_started";
export type OverdueState = "ok" | "overdue" | "not_due_yet";

export interface ReportStatusRow {
  key: ReportKey;
  progress: ReportProgress;
  doneAt: string | null; // ISO timestamp when finalized, if done
  doneByName: string | null;
  overdue: OverdueState;
  /** mid_day only: how many instances done today (for "#1 done · #2 none"). */
  count?: number;
}

export interface ActiveStaff {
  userId: string;
  name: string;
  reports: ReportKey[]; // which report types they touched today
}

export interface PulseFridge {
  name: string;
  latestF: number | null;
  outOfRange: boolean; // any reading today > safe max
}

export interface MidShiftPulse {
  locationId: string;
  today: string;
  reports: ReportStatusRow[];
  fridges: PulseFridge[];
  fridgeFlagCount: number; // fridges out of range today
  maintenanceNotesToday: number;
  activeToday: ActiveStaff[];
  /** Derived attention items, highest priority first, for the banner. */
  attention: AttentionItem[];
}

export interface AttentionItem {
  kind: "overdue" | "fridge" | "maintenance_note";
  /** i18n key + params resolved at render; we pass a stable shape. */
  reportKey?: ReportKey; // for overdue
  fridgeName?: string; // for fridge
  count?: number; // for maintenance_note
}

/**
 * Expected-by clock times (minutes-of-day, operational TZ) per Juan:
 *   - opening overdue after 10:30 (store opens 10:30a)
 *   - mid_day due window 14:00–15:30; overdue after 15:30
 *   - closing overdue after 21:00 (store closes 20:00)
 * am_prep + cash are NOT clock-based — they're "expected when closing is done"
 * (computed in computeOverdue against closing's done-ness).
 */
export const EXPECTED_BY = {
  openingOverdueAfter: 10 * 60 + 30, // 630
  midDayDueFrom: 14 * 60, // 840
  midDayOverdueAfter: 15 * 60 + 30, // 930
  closingOverdueAfter: 21 * 60, // 1260
} as const;

/** Operational-TZ "now": the date string + minutes-of-day. Pure, takes a Date. */
export function operationalNow(now: Date): { date: string; minutesOfDay: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = parseInt(get("hour"), 10);
  if (Number.isNaN(hour) || hour === 24) hour = 0;
  const minute = parseInt(get("minute"), 10) || 0;
  return { date, minutesOfDay: hour * 60 + minute };
}

/** Overdue for one report given its done-ness, the clock, and closing's done-ness. */
export function computeOverdue(args: {
  key: ReportKey;
  done: boolean;
  minutesOfDay: number;
  closingDone: boolean;
  midDayDoneCount: number;
}): OverdueState {
  const { key, done, minutesOfDay, closingDone, midDayDoneCount } = args;
  if (done) return "ok";
  switch (key) {
    case "opening":
      return minutesOfDay > EXPECTED_BY.openingOverdueAfter ? "overdue" : "ok";
    case "mid_day":
      if (midDayDoneCount > 0) return "ok";
      if (minutesOfDay < EXPECTED_BY.midDayDueFrom) return "not_due_yet";
      return minutesOfDay > EXPECTED_BY.midDayOverdueAfter ? "overdue" : "ok";
    case "closing":
      return minutesOfDay > EXPECTED_BY.closingOverdueAfter ? "overdue" : "ok";
    case "am_prep":
    case "cash":
      // Closing-dependent: only overdue once closing is done but this isn't.
      return closingDone ? "overdue" : "ok";
    default:
      return "ok";
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: clean (0 errors). `SupabaseClient` import is unused so far — that's fine, Tasks 2–3 use it; if `noUnusedLocals` flags it, leave it (it's a top-level import, not a local) — confirm by checking the error output is empty.

- [ ] **Step 3: Smoke the pure logic**

Create `scripts/smoke-midshift-logic.ts`:

```ts
import { computeOverdue, operationalNow, EXPECTED_BY } from "@/lib/midshift";
let fail = 0;
const ck = (l: string, c: boolean) => { if (c) console.log("  ok " + l); else { fail++; console.error("  X " + l); } };

// opening overdue after 10:30
ck("opening overdue at 11:00", computeOverdue({ key: "opening", done: false, minutesOfDay: 11 * 60, closingDone: false, midDayDoneCount: 0 }) === "overdue");
ck("opening ok at 10:00", computeOverdue({ key: "opening", done: false, minutesOfDay: 10 * 60, closingDone: false, midDayDoneCount: 0 }) === "ok");
ck("opening ok when done", computeOverdue({ key: "opening", done: true, minutesOfDay: 23 * 60, closingDone: false, midDayDoneCount: 0 }) === "ok");
// mid_day window
ck("mid_day not_due at 13:00", computeOverdue({ key: "mid_day", done: false, minutesOfDay: 13 * 60, closingDone: false, midDayDoneCount: 0 }) === "not_due_yet");
ck("mid_day ok in window 14:30", computeOverdue({ key: "mid_day", done: false, minutesOfDay: 14 * 60 + 30, closingDone: false, midDayDoneCount: 0 }) === "ok");
ck("mid_day overdue at 16:00", computeOverdue({ key: "mid_day", done: false, minutesOfDay: 16 * 60, closingDone: false, midDayDoneCount: 0 }) === "overdue");
ck("mid_day ok if one done", computeOverdue({ key: "mid_day", done: false, minutesOfDay: 16 * 60, closingDone: false, midDayDoneCount: 1 }) === "ok");
// closing
ck("closing overdue at 21:30", computeOverdue({ key: "closing", done: false, minutesOfDay: 21 * 60 + 30, closingDone: false, midDayDoneCount: 0 }) === "overdue");
// am_prep / cash closing-dependent
ck("am_prep ok when closing not done (3pm)", computeOverdue({ key: "am_prep", done: false, minutesOfDay: 15 * 60, closingDone: false, midDayDoneCount: 0 }) === "ok");
ck("am_prep overdue when closing done", computeOverdue({ key: "am_prep", done: false, minutesOfDay: 22 * 60, closingDone: true, midDayDoneCount: 0 }) === "overdue");
ck("cash overdue when closing done", computeOverdue({ key: "cash", done: false, minutesOfDay: 22 * 60, closingDone: true, midDayDoneCount: 0 }) === "overdue");
// operationalNow returns a plausible shape
const n = operationalNow(new Date("2026-06-16T18:00:00Z")); // 14:00 EDT
ck("operationalNow date 2026-06-16", n.date === "2026-06-16");
ck("operationalNow minutes 840 (14:00 EDT)", n.minutesOfDay === 840);
ck("EXPECTED_BY constants", EXPECTED_BY.openingOverdueAfter === 630 && EXPECTED_BY.midDayOverdueAfter === 930);

console.log(fail === 0 ? "\nPASS" : `\n${fail} FAIL`);
process.exitCode = fail === 0 ? 0 : 1;
```

Run: `npx tsx --env-file=.env.local scripts/smoke-midshift-logic.ts`
Expected: `PASS`. Then `rm scripts/smoke-midshift-logic.ts`.
(Note: `2026-06-16T18:00:00Z` is 14:00 EDT since DST is active in June → 840 minutes. If the repo is ever run in a non-DST month this exact assertion still holds because the input is a fixed UTC instant and June is always EDT.)

- [ ] **Step 4: Commit**

```bash
git add lib/midshift.ts && git commit -m "feat(midshift): types + EXPECTED_BY overdue model + operationalNow"
```

---

## Task 2: `lib/midshift.ts` — report-status composition

**Files:**
- Modify: `lib/midshift.ts` (append)

Composes the shipped loaders + inline opening/closing queries into `ReportStatusRow[]`. READ these signatures first to call them correctly:
- `lib/prep.ts` — `loadAmPrepDashboardState(service, {locationId, date, actor})` → `{ hasTemplate, todayInstance: { id, status, confirmedAt, confirmedBy } | null, confirmedByName, ..., isVisibleToActor }`; `loadMidDayPrepDashboardState(service, {locationId, date, actor})` → `{ isVisibleToActor, hasTemplate, templateId, instances: { id, status, triggeredAt, confirmedAt, confirmedBy, confirmedByName }[] }` (read the `MidDayPrepInstanceLite` type for exact field names — use them verbatim).
- `lib/cash.ts` — `loadCashDashboardState(service, {locationId, date, actor})` → `{ isVisibleToActor, report: CashReport | null }`; `CashReport` has `signedByName`, `signedAt`.
- `PrepActor` type (lib/prep.ts) — `{ userId, role, level }`. Import it (or define a matching local `MidShiftActor`).

- [ ] **Step 1: Append the opening/closing inline-status helper + status composition**

Append to `lib/midshift.ts`:

```ts
import { loadAmPrepDashboardState, loadMidDayPrepDashboardState } from "@/lib/prep";
import { loadCashDashboardState } from "@/lib/cash";
import type { RoleCode } from "@/lib/roles";

export interface MidShiftActor {
  userId: string;
  role: RoleCode;
  level: number;
}

/** Inline status for a single-template report type (opening or closing). */
async function loadInstanceStatus(
  service: SupabaseClient,
  args: { locationId: string; date: string; type: "opening" | "closing" },
): Promise<{ status: string | null; confirmedAt: string | null; confirmedByName: string | null }> {
  const { data: tmpl } = await service
    .from("checklist_templates")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("type", args.type)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!tmpl) return { status: null, confirmedAt: null, confirmedByName: null };

  const { data: inst } = await service
    .from("checklist_instances")
    .select("status, confirmed_at, confirmed_by")
    .eq("template_id", tmpl.id)
    .eq("location_id", args.locationId)
    .eq("date", args.date)
    .maybeSingle<{ status: string; confirmed_at: string | null; confirmed_by: string | null }>();
  if (!inst) return { status: null, confirmedAt: null, confirmedByName: null };

  let confirmedByName: string | null = null;
  if (inst.confirmed_by) {
    const { data: u } = await service
      .from("users")
      .select("name")
      .eq("id", inst.confirmed_by)
      .maybeSingle<{ name: string }>();
    confirmedByName = u?.name ?? null;
  }
  return { status: inst.status ?? null, confirmedAt: inst.confirmed_at ?? null, confirmedByName };
}

function progressFor(status: string | null, hasAny: boolean): ReportProgress {
  if (isSubmitted(status)) return "done";
  if (hasAny || (status != null && status !== "")) return "in_progress";
  return "not_started";
}

/** Builds the 5 ReportStatusRows (without overdue — overdue applied by caller). */
export async function loadReportStatuses(
  service: SupabaseClient,
  args: { locationId: string; date: string; actor: MidShiftActor },
): Promise<{ rows: Omit<ReportStatusRow, "overdue">[]; closingDone: boolean; midDayDoneCount: number }> {
  const actor = args.actor;

  const opening = await loadInstanceStatus(service, { locationId: args.locationId, date: args.date, type: "opening" });
  const closing = await loadInstanceStatus(service, { locationId: args.locationId, date: args.date, type: "closing" });
  const amPrep = await loadAmPrepDashboardState(service, { locationId: args.locationId, date: args.date, actor });
  const midDay = await loadMidDayPrepDashboardState(service, { locationId: args.locationId, date: args.date, actor });
  const cash = await loadCashDashboardState(service, { locationId: args.locationId, date: args.date, actor });

  const midDayDoneCount = midDay.instances.filter((i) => isSubmitted(i.status)).length;
  const midDayLatestDone = [...midDay.instances].reverse().find((i) => isSubmitted(i.status)) ?? null;
  const closingDone = isSubmitted(closing.status);

  const rows: Omit<ReportStatusRow, "overdue">[] = [
    {
      key: "opening",
      progress: progressFor(opening.status, false),
      doneAt: opening.confirmedAt,
      doneByName: opening.confirmedByName,
    },
    {
      key: "am_prep",
      progress: progressFor(amPrep.todayInstance?.status ?? null, amPrep.todayInstance != null),
      doneAt: amPrep.todayInstance?.confirmedAt ?? null,
      doneByName: amPrep.confirmedByName,
    },
    {
      key: "mid_day",
      progress: midDayDoneCount > 0 ? "done" : midDay.instances.length > 0 ? "in_progress" : "not_started",
      doneAt: midDayLatestDone?.confirmedAt ?? null,
      doneByName: midDayLatestDone?.confirmedByName ?? null,
      count: midDayDoneCount,
    },
    {
      key: "cash",
      progress: cash.report ? "done" : "not_started",
      doneAt: cash.report?.signedAt ?? null,
      doneByName: cash.report?.signedByName ?? null,
    },
    {
      key: "closing",
      progress: progressFor(closing.status, false),
      doneAt: closing.confirmedAt,
      doneByName: closing.confirmedByName,
    },
  ];

  return { rows, closingDone, midDayDoneCount };
}
```

> **Implementer note:** verify `MidDayPrepInstanceLite` exposes `confirmedAt`/`confirmedByName` in camelCase (the loader maps snake→camel at line ~1025 of lib/prep.ts). If the field is named differently (e.g. `confirmedAt` vs `confirmed_at`), use the actual mapped name. Same for `loadAmPrepDashboardState`'s `todayInstance.confirmedAt`.

- [ ] **Step 2: Verify compile**

Run: `npm run typecheck`
Expected: clean. Fix any field-name mismatches flagged against the real loader return types.

- [ ] **Step 3: Commit**

```bash
git add lib/midshift.ts && git commit -m "feat(midshift): report-status composition (opening/closing inline + am/midday/cash loaders)"
```

---

## Task 3: `lib/midshift.ts` — fridges, active-today, attention, `loadMidShiftPulse`

**Files:**
- Modify: `lib/midshift.ts` (append)

- [ ] **Step 1: Append the remaining loaders + orchestrator**

```ts
import { loadMaintenanceOverview } from "@/lib/maintenance";

/** Staff who completed/submitted any report today (proxy for on-shift). */
async function loadActiveToday(
  service: SupabaseClient,
  args: { locationId: string; date: string },
): Promise<ActiveStaff[]> {
  // Report-instance confirmers for today (opening/closing/am/mid-day) + cash signer.
  const { data: insts } = await service
    .from("checklist_instances")
    .select("confirmed_by, template_id")
    .eq("location_id", args.locationId)
    .eq("date", args.date)
    .not("confirmed_by", "is", null);
  const { data: comps } = await service
    .from("checklist_completions")
    .select("completed_by, instance_id")
    .is("superseded_at", null)
    .is("revoked_at", null)
    .limit(2000); // scoped further below via instance date join is overkill; filter in JS by today's instances
  const { data: cash } = await service
    .from("cash_reports")
    .select("signed_by")
    .eq("location_id", args.locationId)
    .eq("report_date", args.date)
    .is("superseded_at", null);

  // Build the set of today's instance ids for this location to scope completions.
  const { data: todayInstances } = await service
    .from("checklist_instances")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("date", args.date);
  const todayInstanceIds = new Set((todayInstances ?? []).map((r) => (r as { id: string }).id));

  const userIds = new Set<string>();
  for (const r of (insts ?? []) as { confirmed_by: string | null }[]) if (r.confirmed_by) userIds.add(r.confirmed_by);
  for (const r of (comps ?? []) as { completed_by: string | null; instance_id: string }[]) {
    if (r.completed_by && todayInstanceIds.has(r.instance_id)) userIds.add(r.completed_by);
  }
  for (const r of (cash ?? []) as { signed_by: string | null }[]) if (r.signed_by) userIds.add(r.signed_by);

  if (userIds.size === 0) return [];
  const { data: users } = await service.from("users").select("id, name").in("id", [...userIds]);
  const nameById = new Map<string, string>();
  for (const u of (users ?? []) as { id: string; name: string }[]) nameById.set(u.id, u.name);

  // v1: list names + a generic "report" tag (per-report attribution is a v1.1 refinement;
  // keep the query cheap — the proxy's value is "who's been active," not exact report breakdown).
  return [...userIds].map((id) => ({ userId: id, name: nameById.get(id) ?? "—", reports: [] as ReportKey[] }));
}

export async function loadMidShiftPulse(
  service: SupabaseClient,
  args: { locationId: string; date: string; now: Date; actor: MidShiftActor },
): Promise<MidShiftPulse> {
  const { minutesOfDay } = operationalNow(args.now);

  const { rows, closingDone, midDayDoneCount } = await loadReportStatuses(service, {
    locationId: args.locationId,
    date: args.date,
    actor: args.actor,
  });

  const reports: ReportStatusRow[] = rows.map((r) => ({
    ...r,
    overdue: computeOverdue({
      key: r.key,
      done: r.progress === "done",
      minutesOfDay,
      closingDone,
      midDayDoneCount,
    }),
  }));

  // Fridges + flags from the maintenance overview (sinceDate = today; we only need today's status).
  const overview = await loadMaintenanceOverview(service, {
    locationId: args.locationId,
    today: args.date,
    sinceDate: args.date,
  });
  const fridges: PulseFridge[] = overview.fridges.map((f) => ({
    name: f.equip.name,
    latestF: f.latest?.valueF ?? null,
    outOfRange: f.status === "out_of_range",
  }));
  const fridgeFlagCount = fridges.filter((f) => f.outOfRange).length;

  // Maintenance notes logged today.
  const { count: notesCount } = await service
    .from("maintenance_notes")
    .select("id", { count: "exact", head: true })
    .eq("location_id", args.locationId)
    .gte("created_at", `${args.date}T00:00:00`)
    .lte("created_at", `${args.date}T23:59:59`);
  const maintenanceNotesToday = notesCount ?? 0;

  const activeToday = await loadActiveToday(service, { locationId: args.locationId, date: args.date });

  // Attention items, priority order: overdue → fridge → maintenance notes.
  const attention: AttentionItem[] = [];
  for (const r of reports) if (r.overdue === "overdue") attention.push({ kind: "overdue", reportKey: r.key });
  for (const f of fridges) if (f.outOfRange) attention.push({ kind: "fridge", fridgeName: f.name });
  if (maintenanceNotesToday > 0) attention.push({ kind: "maintenance_note", count: maintenanceNotesToday });

  return {
    locationId: args.locationId,
    today: args.date,
    reports,
    fridges,
    fridgeFlagCount,
    maintenanceNotesToday,
    activeToday,
    attention,
  };
}
```

> **Implementer note:** confirm `cash_reports` has `superseded_at` + `report_date` columns (it does — migration 0067/0069). Confirm `maintenance_notes.created_at` exists (it does — migration 0070). If the completions query at `.limit(2000)` is a concern, it's bounded to one location's day after the JS filter; acceptable for CO's volume.

- [ ] **Step 2: Verify compile**

Run: `npm run typecheck` — clean.

- [ ] **Step 3: Smoke against live MEP data**

Create `scripts/smoke-midshift.ts`:

```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadMidShiftPulse } from "@/lib/midshift";
const sb = getServiceRoleClient();
const LOC = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a"; // MEP
(async () => {
  const pulse = await loadMidShiftPulse(sb, {
    locationId: LOC,
    date: "2026-06-16",
    now: new Date("2026-06-16T19:00:00Z"), // 15:00 EDT
    actor: { userId: "16329556-900e-4cbb-b6e0-1829c6f4a6ed", role: "cgs", level: 10 },
  });
  console.log("reports:");
  for (const r of pulse.reports) console.log(`  ${r.key.padEnd(9)} ${r.progress.padEnd(12)} overdue=${r.overdue}${r.count !== undefined ? " count=" + r.count : ""}`);
  console.log(`fridges: ${pulse.fridges.length} (flagged ${pulse.fridgeFlagCount})`);
  console.log(`maintenance notes today: ${pulse.maintenanceNotesToday}`);
  console.log(`active today: ${pulse.activeToday.map((s) => s.name).join(", ") || "none"}`);
  console.log(`attention items: ${pulse.attention.length}`);
  console.log(pulse.reports.length === 5 ? "\nPASS (5 report rows)" : "\nFAIL");
  process.exitCode = pulse.reports.length === 5 ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
```

Run: `npx tsx --env-file=.env.local scripts/smoke-midshift.ts`
Expected: 5 report rows print with plausible progress/overdue; no throw; `PASS`. Then `rm scripts/smoke-midshift.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/midshift.ts && git commit -m "feat(midshift): fridges + active-today + attention items + loadMidShiftPulse"
```

---

## Task 4: i18n `midshift.*` keys

**Files:**
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`

- [ ] **Step 1: Add keys to BOTH files (identical key sets; valid JSON; place after the `nav.*` block)**

en.json:
```
"midshift.page.title": "Mid-Shift Pulse",
"midshift.all_clear": "All clear — nothing needs attention right now.",
"midshift.attention.heading": "Needs attention",
"midshift.attention.overdue": "{report} is overdue",
"midshift.attention.fridge": "{fridge} is out of range",
"midshift.attention.maintenance_note": "{count} maintenance note(s) logged today",
"midshift.reports.heading": "Today's reports",
"midshift.progress.done": "Done",
"midshift.progress.in_progress": "In progress",
"midshift.progress.not_started": "Not started",
"midshift.overdue.badge": "Overdue",
"midshift.overdue.not_due_yet": "Not due yet",
"midshift.report.opening": "Opening",
"midshift.report.am_prep": "AM Prep",
"midshift.report.mid_day": "Mid-day Prep",
"midshift.report.cash": "Cash Deposit",
"midshift.report.closing": "Closing",
"midshift.done_by": "{time} by {name}",
"midshift.mid_day_count": "{count} done today",
"midshift.fridges.heading": "Fridge temps",
"midshift.fridges.ok": "All fridges in range",
"midshift.fridges.flagged": "{count} fridge(s) out of range",
"midshift.fridges.view": "View maintenance log",
"midshift.active.heading": "Active today",
"midshift.active.none": "No report activity yet today.",
"midshift.active.proxy_note": "From report activity (scheduled roster arrives with 7shifts).",
"midshift.sales.heading": "Sales & forecast",
"midshift.sales.placeholder": "Connect Toast to see sales velocity and end-of-day forecast.",
"midshift.degrees": "{value}°F"
```

es.json:
```
"midshift.page.title": "Pulso de medio turno",
"midshift.all_clear": "Todo en orden — nada requiere atención ahora.",
"midshift.attention.heading": "Requiere atención",
"midshift.attention.overdue": "{report} está atrasado",
"midshift.attention.fridge": "{fridge} fuera de rango",
"midshift.attention.maintenance_note": "{count} nota(s) de mantenimiento registrada(s) hoy",
"midshift.reports.heading": "Reportes de hoy",
"midshift.progress.done": "Hecho",
"midshift.progress.in_progress": "En progreso",
"midshift.progress.not_started": "No iniciado",
"midshift.overdue.badge": "Atrasado",
"midshift.overdue.not_due_yet": "Aún no toca",
"midshift.report.opening": "Apertura",
"midshift.report.am_prep": "Preparación AM",
"midshift.report.mid_day": "Preparación de mediodía",
"midshift.report.cash": "Depósito de efectivo",
"midshift.report.closing": "Cierre",
"midshift.done_by": "{time} por {name}",
"midshift.mid_day_count": "{count} hechas hoy",
"midshift.fridges.heading": "Temperaturas de refrigeradores",
"midshift.fridges.ok": "Todos los refrigeradores en rango",
"midshift.fridges.flagged": "{count} refrigerador(es) fuera de rango",
"midshift.fridges.view": "Ver registro de mantenimiento",
"midshift.active.heading": "Activos hoy",
"midshift.active.none": "Aún no hay actividad de reportes hoy.",
"midshift.active.proxy_note": "Según actividad de reportes (el roster llega con 7shifts).",
"midshift.sales.heading": "Ventas y pronóstico",
"midshift.sales.placeholder": "Conecta Toast para ver el ritmo de ventas y el pronóstico del día.",
"midshift.degrees": "{value}°F"
```

- [ ] **Step 2: Verify** — both files valid JSON, identical `midshift.*` key counts (29 each). Run `npm run typecheck` (regenerates `TranslationKey`); clean.

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/en.json lib/i18n/es.json && git commit -m "feat(i18n): midshift.* keys (en + es)"
```

---

## Task 5: `components/midshift/*` presentational components

**Files:**
- Create: `components/midshift/AttentionBanner.tsx`, `ReportStatusList.tsx`, `FridgeStrip.tsx`, `ActiveToday.tsx`, `SalesPlaceholder.tsx`

All are **server components** (no `"use client"`), `serverT(language, key, params?)` for text, Tailwind tokens (`co-text`, `co-surface`, `co-border`, `co-text-muted`, `co-gold-deep`, `co-success`, `co-cta`). READ `components/maintenance/EquipmentOverview.tsx` first for the exact `serverT` import + `Language`/`TranslationKey` import paths + the card/section styling to mirror. Import the pulse types from `@/lib/midshift`.

- [ ] **Step 1: `AttentionBanner.tsx`**

Props: `{ items: AttentionItem[]; language: Language }`. If `items.length === 0`, render a calm green-bordered card: `serverT(language, "midshift.all_clear")` (use `text-co-success`). Else render a `co-cta`-accented card titled `midshift.attention.heading` with a `<ul>` of items:
- `overdue` → `serverT(language, "midshift.attention.overdue", { report: serverT(language, ("midshift.report." + item.reportKey) as TranslationKey) })`
- `fridge` → `serverT(language, "midshift.attention.fridge", { fridge: item.fridgeName })`
- `maintenance_note` → `serverT(language, "midshift.attention.maintenance_note", { count: item.count })`

- [ ] **Step 2: `ReportStatusList.tsx`**

Props: `{ reports: ReportStatusRow[]; language: Language }`. Section heading `midshift.reports.heading`. For each row, a bordered row (mirror EquipmentOverview's card): left = report label (`midshift.report.<key>`), right = a status chip. Chip text + color:
- `progress==="done"` → `midshift.progress.done` (`text-co-success`); below it, if `doneAt`, `midshift.done_by` with `{ time: formatTime(doneAt, language), name: doneByName ?? "—" }` (import `formatTime` from `@/lib/i18n/format`).
- `overdue==="overdue"` → also show `midshift.overdue.badge` chip in `text-co-cta` (takes visual priority).
- `overdue==="not_due_yet"` → muted `midshift.overdue.not_due_yet`.
- else `progress` maps to `midshift.progress.in_progress` / `not_started` (muted).
- For `key==="mid_day"` with `count` set, append `midshift.mid_day_count` with `{ count }`.

- [ ] **Step 3: `FridgeStrip.tsx`**

Props: `{ fridges: PulseFridge[]; flagCount: number; locationId: string; language: Language }`. Heading `midshift.fridges.heading`. A summary line: `flagCount === 0 ? midshift.fridges.ok : midshift.fridges.flagged({count: flagCount})`. Then a compact wrapped row of fridge chips (`flex flex-wrap gap-2`): each chip shows `name` + `degrees({value: latestF})` when non-null; `outOfRange` chips get `text-co-cta border-co-cta`, others neutral. A trailing link `midshift.fridges.view` → `/maintenance?location=${locationId}` (use `ActionLink` from `@/components/ActionButton`, `variant="secondary"`).

- [ ] **Step 4: `ActiveToday.tsx`**

Props: `{ staff: ActiveStaff[]; language: Language }`. Heading `midshift.active.heading`. If empty → `midshift.active.none`. Else a wrapped row of name chips. Below, a muted note `midshift.active.proxy_note`.

- [ ] **Step 5: `SalesPlaceholder.tsx`**

Props: `{ language: Language }`. A greyed/dashed-border card (`border-dashed border-co-border text-co-text-muted opacity-70`): heading `midshift.sales.heading`, body `midshift.sales.placeholder`.

- [ ] **Step 6: Verify + commit**

Run: `npm run typecheck` + `npm run build` — both clean.
```bash
git add components/midshift/ && git commit -m "feat(midshift): pulse section components"
```

---

## Task 6: `app/(authed)/mid-shift/page.tsx`

**Files:**
- Create: `app/(authed)/mid-shift/page.tsx`

READ `app/(authed)/maintenance/page.tsx` for the exact pattern: `requireSessionFromHeaders`, location resolution, `auth.user.language`, `auth.level`, `getServiceRoleClient`, soft-deny markup, `DashboardBackLink`, `searchParams` typing.

- [ ] **Step 1: Write the page**

```tsx
import { DashboardBackLink } from "@/components/DashboardBackLink";
import { AttentionBanner } from "@/components/midshift/AttentionBanner";
import { ReportStatusList } from "@/components/midshift/ReportStatusList";
import { FridgeStrip } from "@/components/midshift/FridgeStrip";
import { ActiveToday } from "@/components/midshift/ActiveToday";
import { SalesPlaceholder } from "@/components/midshift/SalesPlaceholder";
import { MIDSHIFT_BASE_LEVEL, loadMidShiftPulse, operationalNow } from "@/lib/midshift";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export default async function MidShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const auth = await requireSessionFromHeaders("/mid-shift");
  const language = auth.user.language;

  if (auth.level < MIDSHIFT_BASE_LEVEL) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <DashboardBackLink language={language} />
        <p className="mt-4 text-sm text-co-text-muted">
          {serverT(language, "midshift.page.title")}
        </p>
      </main>
    );
  }

  const { location } = await searchParams;
  // Nav-link friendly: default to the actor's first location when none specified.
  const locationId = location ?? auth.locations[0] ?? null;
  if (!locationId) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <DashboardBackLink language={language} />
        <h1 className="mt-4 text-lg font-bold text-co-text">{serverT(language, "midshift.page.title")}</h1>
        <p className="mt-2 text-sm text-co-text-muted">{serverT(language, "midshift.active.none")}</p>
      </main>
    );
  }

  const now = new Date();
  const { date } = operationalNow(now);
  const service = getServiceRoleClient();
  const pulse = await loadMidShiftPulse(service, {
    locationId,
    date,
    now,
    actor: { userId: auth.user.id, role: auth.role, level: auth.level },
  });

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
      <DashboardBackLink language={language} />
      <h1 className="text-lg font-bold text-co-text">{serverT(language, "midshift.page.title")}</h1>
      <AttentionBanner items={pulse.attention} language={language} />
      <ReportStatusList reports={pulse.reports} language={language} />
      <FridgeStrip fridges={pulse.fridges} flagCount={pulse.fridgeFlagCount} locationId={locationId} language={language} />
      <ActiveToday staff={pulse.activeToday} language={language} />
      <SalesPlaceholder language={language} />
    </main>
  );
}
```

> **Implementer note:** confirm `DashboardBackLink`'s prop shape against `components/DashboardBackLink.tsx` (it may take `language` or no props — match it). Confirm `auth.locations` is `string[]` of location ids (it is, per the JWT claims). Match the maintenance page's `<main>` wrapper classes if they differ.

- [ ] **Step 2: Verify** — `npm run typecheck` + `npm run build` clean; `/mid-shift` appears as a dynamic route in build output.

- [ ] **Step 3: Commit**

```bash
git add "app/(authed)/mid-shift/" && git commit -m "feat(midshift): /mid-shift page wiring"
```

---

## Task 7: DashboardNav chip

**Files:**
- Modify: `components/DashboardNav.tsx`

- [ ] **Step 1: Add the Mid-Shift Pulse chip**

In `components/DashboardNav.tsx`, add to the `NavLink` key union: `"nav.mid_shift"`, and add `{ key: "nav.mid_shift", href: "/mid-shift" }` as the FIRST entry of `NAV_LINKS` (before `reports_hub` — it's the most operationally useful). Add the i18n key to BOTH `lib/i18n/en.json` (`"nav.mid_shift": "Mid-Shift Pulse"`) and `lib/i18n/es.json` (`"nav.mid_shift": "Pulso de medio turno"`).

> **Gate note:** the nav bar renders for all levels, but `/mid-shift` is KH+ (L4) gated at the page. A sub-KH user tapping the chip hits the soft-deny. Acceptable for v1 (other coming-soon chips behave similarly); a future refinement can hide the chip below L4 by passing `actorLevel` (already a prop) — OPTIONAL, do it if quick: wrap the mid_shift chip in `actorLevel >= 4` like the Admin chip.

Implement the optional gate (preferred): render the mid_shift chip only when `actorLevel >= 4`, mirroring the Admin-chip pattern already in the file.

- [ ] **Step 2: Verify** — `npm run typecheck` + `npm run build` clean; key counts en==es.

- [ ] **Step 3: Commit**

```bash
git add components/DashboardNav.tsx lib/i18n/en.json lib/i18n/es.json && git commit -m "feat(midshift): Mid-Shift Pulse nav chip (KH+ gated)"
```

---

## Task 8: Full smoke + ship PR

**Files:** none (verification + PR)

- [ ] **Step 1: Final gates**

Run: `npm run typecheck` (clear stale cache first if route-type errors appear: `rm -rf .next/types`) + `npm run build`. Both clean.

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin claude/mid-shift-pulse
```
Open a PR (base `main`) titled `Mid-Shift Pulse (Wave 2): read-only operational pulse`. Body covers: the 5 sections, the overdue model (clock + closing-dependent), deferred items (sales/Toast, roster/7shifts, AM-prep under-par), and a test plan pointing to the branch preview URL `https://co-ops-git-claude-mid-shift-pulse-juan-co-devs-projects.vercel.app/mid-shift?location=<MEP id>`. Do NOT merge.

- [ ] **Step 3: Confirm CI build gate green**, then hand to Juan for smoke + merge.

---

## Notes for the executor

- **CC (T0) reviews every task diff** before the next task — RLS/data correctness, field-name accuracy against the real loader return types, no `FOR ALL`/write footguns (N/A here — read-only), token-class consistency.
- **No writes anywhere** — this module only reads. If any task introduces a write, stop: it's out of scope.
- **Field-name accuracy is the main risk** — the loaders map snake→camel; verify `confirmedAt`/`confirmedByName`/`signedAt`/`signedByName`/`triggeredAt` against the actual return types before trusting this plan's property access. The plan's `loadReportStatuses` is the place to double-check.
