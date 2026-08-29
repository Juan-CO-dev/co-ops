import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLES, type RoleCode } from "@/lib/roles";
import {
  type ActionCategory, type CategoryCounts, emptyCounts,
  scoreFromCounts, healthFromCounts, type Health,
  activeDayStreak, onTimeStreak, personalBest,
} from "@/lib/team-scoring";
import { personCardLine, personReadNarrative, teamBannerNarrative, myPerformanceRead, type NarrativeLine } from "@/lib/people-narrative";
import { etCalendarDate } from "@/lib/operational-day";
import { computeWindows, bucketStart, type TrendGranularity } from "@/lib/reports-trends";
import { selectAllRows } from "@/lib/supabase-paginate";

export const TEAM_VIEW_LEVEL = 6; // AGM+
export const RANKED_MAX_LEVEL = 8; // roster excludes level >= 8 (MoO+)

export const OVERSIGHT_ACTIONS = [
  "checklist_completion.revoke",
  "checklist_completion.revoke_by_authority",
  "checklist_completion.tag_actual_completer",
  "report.update",
  "report.drop",
];

// ─────────────────────────────────────────────────────────────────────────────
// OVERSIGHT — THE LOCATION BIND (audit fix 2026-08-29)
//
// Every other category on this page is location-scoped by construction: tasks and
// notes ride the location's own instance ids, finalizations come from that instance
// list, cash and pm rows are filtered on location_id. Oversight was the exception —
// `audit_log` was read by actor_id alone, so a person active at two shops carried the
// revokes they did at one INTO the other's roster and into their own /my-performance
// read. The 2026-06-18 plan recorded that as a deliberate v1 impurity, on the premise
// that audit_log is "not reliably location-tagged".
//
// THAT PREMISE NO LONGER HOLDS FOR THIS CURATED SET. Each of the five actions hangs
// off exactly one checklist_instance, and every emission site says so:
//   · checklist_completion.revoke / .revoke_by_authority / .tag_actual_completer
//        → resource_table "checklist_completions", metadata.instance_id  (lib/checklists.ts)
//   · report.update
//        → resource_table "checklist_submissions", metadata.report_instance_id
//          (migrations 0044 / 0048 / 0050 / 0053 / 0055 — all five build the same key)
//   · report.drop
//        → resource_table "checklist_instances", resource_id IS the instance id, and
//          metadata carries location_id besides  (lib/checklists.ts dropInstance)
// Live-verified against prod 2026-08-29: 44 of 44 oversight rows resolve this way, none
// unresolvable. So the bind is a metadata read, not a join, and it costs no query.
//
// An UNATTRIBUTABLE row is not counted here. A per-location metric may not claim an act
// it cannot place at this location, and counting it at BOTH shops would score one act
// twice — the very thing this bind exists to stop.
// ─────────────────────────────────────────────────────────────────────────────

/** The audit_log columns the oversight bind reads. */
export interface OversightAuditRow {
  resource_table: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
}

/** The checklist_instance an oversight row is ABOUT, or null when it names none. */
export function oversightInstanceId(row: OversightAuditRow): string | null {
  const meta = row.metadata ?? {};
  for (const key of ["instance_id", "report_instance_id"] as const) {
    const v = meta[key];
    if (typeof v === "string" && v !== "") return v;
  }
  if (row.resource_table === "checklist_instances" && row.resource_id) return row.resource_id;
  return null;
}

/**
 * True when an oversight row belongs to THIS location. The instance link is preferred —
 * membership in the location's own instance list is a fact about our data, where
 * metadata.location_id is a value the writer supplied — and metadata.location_id is the
 * fallback for a row that names a location but no instance.
 */
export function oversightRowAtLocation(
  row: OversightAuditRow,
  locationId: string,
  locationInstanceIds: ReadonlySet<string>,
): boolean {
  const instanceId = oversightInstanceId(row);
  if (instanceId !== null) return locationInstanceIds.has(instanceId);
  const loc = row.metadata?.location_id;
  return typeof loc === "string" && loc === locationId;
}

/**
 * Inclusive UTC upper-bound for a query whose rows are BUCKETED by ET etCalendarDate.
 * The window is [loadFrom, toInclusive] in ET days, but the columns are UTC
 * timestamps. ET-evening work on `toInclusive` (e.g. a 9pm-ET close) has a UTC
 * timestamp on `toInclusive+1` (~01:00-05:00Z), so a `${toInclusive}T23:59:59Z`
 * bound EXCLUDES the whole closing shift until the next day. End-of-ET-day is at
 * most 05:59:59Z the next day (EST; 04:59:59Z EDT), so bound at next-day 05:59:59Z.
 * The extra ~few hours of next-morning ET rows this over-fetches are discarded by
 * the curSet/prevSet bucket-membership check (etCalendarDate not in the window keys).
 */
function nextDayUtcBound(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T05:59:59Z`;
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
  sparkline: number[];
  cardLine: NarrativeLine;
}

export interface TeamOperatingHealth {
  granularity: TrendGranularity;
  members: TeamMember[];
  summary: { onTrack: number; needsAttention: number };
  banner: NarrativeLine;
}

interface MemberAcc {
  current: CategoryCounts;
  previous: CategoryCounts;
  byBucketScoreActions: Map<string, number>;
}

export async function loadTeamOperatingHealth(
  service: SupabaseClient,
  args: { viewer: Viewer; locationId: string; granularity: TrendGranularity; compare: boolean; today: string },
): Promise<TeamOperatingHealth | null> {
  if (args.viewer.level < TEAM_VIEW_LEVEL) return null;

  const { currentKeys, previousKeys, loadFrom } = computeWindows(args.today, args.granularity, args.compare);
  const curSet = new Set(currentKeys);
  const prevSet = new Set(previousKeys ?? []);
  const loadToInclusive = args.today;
  const upperTs = nextDayUtcBound(loadToInclusive);

  const emptyResult = (): TeamOperatingHealth => ({
    granularity: args.granularity, members: [], summary: { onTrack: 0, needsAttention: 0 },
    banner: teamBannerNarrative({ onTrack: 0, needsAttention: 0, attentionNames: [] }),
  });

  // ── Roster: location-assigned, active, level < 8 ──
  const { data: ulRows } = await service
    .from("user_locations").select("user_id").eq("location_id", args.locationId).eq("active", true);
  const userIds = [...new Set((ulRows ?? []).map((r) => (r as { user_id: string }).user_id))];
  if (userIds.length === 0) return emptyResult();

  const { data: userRows } = await service
    .from("users").select("id, name, role, active").in("id", userIds).eq("active", true);
  const members = new Map<string, { name: string; role: RoleCode; level: number; acc: MemberAcc }>();
  for (const u of (userRows ?? []) as Array<{ id: string; name: string; role: RoleCode; active: boolean }>) {
    const level = ROLES[u.role]?.level ?? 0;
    if (level >= RANKED_MAX_LEVEL) continue;
    members.set(u.id, { name: u.name, role: u.role, level, acc: { current: emptyCounts(), previous: emptyCounts(), byBucketScoreActions: new Map() } });
  }
  if (members.size === 0) return emptyResult();
  const memberIds = [...members.keys()];

  const place = (uid: string, tstz: string, category: ActionCategory) => {
    const m = members.get(uid);
    if (!m) return;
    const bs = bucketStart(etCalendarDate(tstz), args.granularity);
    if (curSet.has(bs)) {
      m.acc.current[category]++;
      m.acc.byBucketScoreActions.set(bs, (m.acc.byBucketScoreActions.get(bs) ?? 0) + scoreRelevant(m.role, category));
    } else if (prevSet.has(bs)) {
      m.acc.previous[category]++;
    }
  };

  // location instance ids (for completion attribution + finalizations)
  const instRows = await selectAllRows<{ id: string; confirmed_by: string | null; confirmed_at: string | null }>(
    (from, to) => service
      .from("checklist_instances").select("id, confirmed_by, confirmed_at")
      .eq("location_id", args.locationId)
      .order("id", { ascending: true }).range(from, to),
  );
  const locInstanceIds = new Set(instRows.map((r) => r.id));

  // 1. TASKS + NOTES (completions: completed_at in span, live, instance at location)
  if (locInstanceIds.size) {
    const comps = await selectAllRows<{ completed_by: string | null; completed_at: string; notes: string | null }>(
      (from, to) => service
        .from("checklist_completions")
        .select("instance_id, completed_by, completed_at, notes")
        .in("instance_id", [...locInstanceIds])
        .gte("completed_at", `${loadFrom}T00:00:00Z`).lte("completed_at", upperTs)
        .is("superseded_at", null).is("revoked_at", null)
        .order("completed_at", { ascending: true }).range(from, to),
    );
    for (const c of comps) {
      if (!c.completed_by) continue;
      place(c.completed_by, c.completed_at, "tasks");
      if (c.notes && c.notes.trim()) place(c.completed_by, c.completed_at, "notes");
    }
  }

  // 2. FINALIZATIONS
  for (const i of instRows) {
    if (i.confirmed_by && i.confirmed_at) place(i.confirmed_by, i.confirmed_at, "finalizations");
  }
  // Paginate past the 1000-row cap (WB5-06 sibling of computePersonMetrics — same silent-truncation
  // class over the same growth tables at the location+window grain).
  const cashRows = await selectAllRows<{ signed_by: string | null; signed_at: string | null; over_short_note: string | null }>(
    (from, to) => service
      .from("cash_reports").select("signed_by, signed_at, over_short_note")
      .eq("location_id", args.locationId).is("superseded_at", null)
      .gte("signed_at", `${loadFrom}T00:00:00Z`).lte("signed_at", upperTs)
      .order("id", { ascending: true }).range(from, to),
  );
  for (const c of cashRows) {
    if (c.signed_by && c.signed_at) {
      place(c.signed_by, c.signed_at, "finalizations");
      if (c.over_short_note && c.over_short_note.trim()) place(c.signed_by, c.signed_at, "notes");
    }
  }
  const pmRows = await selectAllRows<{ id: string; submitted_by: string | null; submitted_at: string | null }>(
    (from, to) => service
      .from("pm_reports").select("id, submitted_by, submitted_at")
      .eq("location_id", args.locationId).is("superseded_at", null)
      .gte("submitted_at", `${loadFrom}T00:00:00Z`).lte("submitted_at", upperTs)
      .order("id", { ascending: true }).range(from, to),
  );
  for (const r of pmRows) {
    if (r.submitted_by && r.submitted_at) {
      place(r.submitted_by, r.submitted_at, "finalizations");
      place(r.submitted_by, r.submitted_at, "peopleMgmt");
    }
  }

  // 3. NOTES from pm evals (authored by report submitter)
  const pmReportById = new Map(pmRows.map((row) => [row.id, row] as const));
  if (pmReportById.size) {
    const evalRows = await selectAllRows<{ pm_report_id: string; area_to_improve: string | null; note: string | null }>(
      (from, to) => service
        .from("pm_employee_evals").select("pm_report_id, area_to_improve, note")
        .in("pm_report_id", [...pmReportById.keys()]).is("superseded_at", null)
        .order("pm_report_id", { ascending: true }).range(from, to),
    );
    for (const e of evalRows) {
      const rep = pmReportById.get(e.pm_report_id);
      if (rep?.submitted_by && rep.submitted_at && ((e.area_to_improve && e.area_to_improve.trim()) || (e.note && e.note.trim()))) {
        place(rep.submitted_by, rep.submitted_at, "notes");
      }
    }
  }

  // 4. OVERSIGHT (audit_log by actor_id, bound to THIS location's instances — see the
  //    OVERSIGHT LOCATION BIND note at the top; audit_log grows fastest, so paginate)
  const auditRows = await selectAllRows<OversightAuditRow & { actor_id: string | null; occurred_at: string }>(
    (from, to) => service
      .from("audit_log").select("actor_id, action, occurred_at, resource_table, resource_id, metadata")
      .in("actor_id", memberIds).in("action", OVERSIGHT_ACTIONS)
      .gte("occurred_at", `${loadFrom}T00:00:00Z`).lte("occurred_at", upperTs)
      .order("id", { ascending: true }).range(from, to),
  );
  for (const a of auditRows) {
    if (!a.actor_id) continue;
    if (!oversightRowAtLocation(a, args.locationId, locInstanceIds)) continue;
    place(a.actor_id, a.occurred_at, "oversight");
  }

  // ── materialize ──
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

// ─────────────────────────────────────────────────────────────────────────────
// loadPersonDetail — one member's full breakdown. Score is the TRUE role-scoped
// score (same 5-category model as the roster), so the detail header matches the
// roster rank exactly. Adds per-bucket series, our-data streaks, and signals.
// ─────────────────────────────────────────────────────────────────────────────

export interface PersonStreaks {
  activeDays: number;
  onTime: number;
  personalBest: number;
}

export interface PersonSignals {
  mvpAwards: number;
  flaggedToImprove: number;
  mostActiveDay: string | null; // "mon".."sun" or null
  tenureDays: number;
  lastActive: string | null; // YYYY-MM-DD
}

export interface PersonDetail {
  userId: string;
  name: string;
  role: RoleCode;
  level: number;
  score: number;
  previousScore: number | null;
  counts: CategoryCounts;
  health: Health;
  reasons: string[];
  read: NarrativeLine;
  aiInsight: string | null; // ALWAYS null this cycle (reserved slot)
  bucketKeys: string[];
  contribution: (number | null)[];
  onTime: (number | null)[];
  gradientTally: { great: number; good: number; needsWork: number };
  streaks: PersonStreaks;
  signals: PersonSignals;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

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
 */
async function computePersonMetrics(
  service: SupabaseClient,
  args: { personId: string; role: RoleCode; createdAt: string; locationId: string; granularity: TrendGranularity; compare: boolean; today: string },
): Promise<PersonMetrics> {
  const { currentKeys, previousKeys, loadFrom } = computeWindows(args.today, args.granularity, args.compare);
  const curSet = new Set(currentKeys);
  const prevSet = new Set(previousKeys ?? []);
  const toIncl = args.today;
  const upperTsP = nextDayUtcBound(toIncl);

  const current = emptyCounts();
  const previous = emptyCounts();
  const windowOf = (tstz: string): "cur" | "prev" | null => {
    const bs = bucketStart(etCalendarDate(tstz), args.granularity);
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

  if (locInstanceIds.length) {
    const comps = await selectAllRows<{ completed_at: string; notes: string | null }>(
      (from, to) => service
        .from("checklist_completions").select("completed_at, notes")
        .eq("completed_by", args.personId).in("instance_id", locInstanceIds)
        .gte("completed_at", `${loadFrom}T00:00:00Z`).lte("completed_at", upperTsP)
        .is("superseded_at", null).is("revoked_at", null)
        .order("completed_at", { ascending: true }).range(from, to),
    );
    for (const c of comps) {
      add(c.completed_at, "tasks");
      if (c.notes && c.notes.trim()) add(c.completed_at, "notes");
      if (windowOf(c.completed_at) === "cur") {
        const d = etCalendarDate(c.completed_at);
        const bs = bucketStart(d, args.granularity);
        contribBucket.set(bs, (contribBucket.get(bs) ?? 0) + 1);
        touch(d);
        dayTaskCounts.set(d, (dayTaskCounts.get(d) ?? 0) + 1);
        const wd = WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
        weekdayCounts.set(wd, (weekdayCounts.get(wd) ?? 0) + 1);
      }
    }
  }

  const finalsChrono: { at: string; inWindow: boolean }[] = [];
  const finInst = await selectAllRows<{ date: string; confirmed_at: string }>(
    (from, to) => service
      .from("checklist_instances").select("date, confirmed_at")
      .eq("location_id", args.locationId).eq("confirmed_by", args.personId).not("confirmed_at", "is", null)
      .gte("confirmed_at", `${loadFrom}T00:00:00Z`).lte("confirmed_at", upperTsP)
      .order("id", { ascending: true }).range(from, to),
  );
  for (const f of finInst) {
    add(f.confirmed_at, "finalizations");
    if (windowOf(f.confirmed_at) === "cur") { finalsChrono.push({ at: f.confirmed_at, inWindow: etCalendarDate(f.confirmed_at) === f.date }); touch(etCalendarDate(f.confirmed_at)); }
  }
  const cashRows = await selectAllRows<{ signed_at: string | null; over_short_note: string | null; report_date: string }>(
    (from, to) => service
      .from("cash_reports").select("signed_at, over_short_note, report_date")
      .eq("location_id", args.locationId).eq("signed_by", args.personId).is("superseded_at", null)
      .gte("signed_at", `${loadFrom}T00:00:00Z`).lte("signed_at", upperTsP)
      .order("id", { ascending: true }).range(from, to),
  );
  for (const c of cashRows) {
    if (!c.signed_at) continue;
    add(c.signed_at, "finalizations");
    if (c.over_short_note && c.over_short_note.trim()) add(c.signed_at, "notes");
    if (windowOf(c.signed_at) === "cur") { finalsChrono.push({ at: c.signed_at, inWindow: etCalendarDate(c.signed_at) === c.report_date }); touch(etCalendarDate(c.signed_at)); }
  }
  const pmMine = await selectAllRows<{ id: string; submitted_at: string | null; report_date: string }>(
    (from, to) => service
      .from("pm_reports").select("id, submitted_at, report_date")
      .eq("location_id", args.locationId).eq("submitted_by", args.personId).is("superseded_at", null)
      .gte("submitted_at", `${loadFrom}T00:00:00Z`).lte("submitted_at", upperTsP)
      .order("id", { ascending: true }).range(from, to),
  );
  for (const r of pmMine) {
    if (!r.submitted_at) continue;
    add(r.submitted_at, "finalizations");
    add(r.submitted_at, "peopleMgmt");
    if (windowOf(r.submitted_at) === "cur") { finalsChrono.push({ at: r.submitted_at, inWindow: etCalendarDate(r.submitted_at) === r.report_date }); touch(etCalendarDate(r.submitted_at)); }
  }
  if (pmMine.length) {
    const submittedAtById = new Map(pmMine.map((r) => [r.id, r.submitted_at] as const));
    const evAuthored = await selectAllRows<{ pm_report_id: string; area_to_improve: string | null; note: string | null }>(
      (from, to) => service
        .from("pm_employee_evals").select("pm_report_id, area_to_improve, note")
        .in("pm_report_id", pmMine.map((r) => r.id)).is("superseded_at", null)
        .order("id", { ascending: true }).range(from, to),
    );
    for (const e of evAuthored) {
      const at = submittedAtById.get(e.pm_report_id);
      if (at && ((e.area_to_improve && e.area_to_improve.trim()) || (e.note && e.note.trim()))) add(at, "notes");
    }
  }

  // The roster loader's twin — the same location bind, for the same reason (this is the
  // path /my-performance runs, and it applies no RANKED_MAX_LEVEL ceiling, so it is
  // where a multi-location actor's cross-shop oversight actually surfaces today).
  const locInstanceIdSet = new Set(locInstanceIds);
  const auditRows = await selectAllRows<OversightAuditRow & { occurred_at: string }>(
    (from, to) => service
      .from("audit_log").select("occurred_at, resource_table, resource_id, metadata")
      .eq("actor_id", args.personId).in("action", OVERSIGHT_ACTIONS)
      .gte("occurred_at", `${loadFrom}T00:00:00Z`).lte("occurred_at", upperTsP)
      .order("id", { ascending: true }).range(from, to),
  );
  for (const a of auditRows) {
    if (oversightRowAtLocation(a, args.locationId, locInstanceIdSet)) add(a.occurred_at, "oversight");
  }

  const score = scoreFromCounts(args.role, current);
  const previousScore = args.compare ? scoreFromCounts(args.role, previous) : null;
  const scoreDeltaPct = previousScore && previousScore > 0 ? Math.round(((score - previousScore) / previousScore) * 100) : null;

  finalsChrono.sort((a, b) => (a.at < b.at ? -1 : 1));
  const onTimeByBucket = new Map<string, { hit: number; total: number }>();
  for (const f of finalsChrono) {
    const bs = bucketStart(etCalendarDate(f.at), args.granularity);
    const e = onTimeByBucket.get(bs) ?? { hit: 0, total: 0 };
    e.total++; if (f.inWindow) e.hit++;
    onTimeByBucket.set(bs, e);
  }
  let oh = 0, ot = 0;
  for (const e of onTimeByBucket.values()) { oh += e.hit; ot += e.total; }
  const overallOnTime = ot > 0 ? Math.round((oh / ot) * 100) : null;

  const pmInLoc = await selectAllRows<{ id: string }>(
    (from, to) => service
      .from("pm_reports").select("id").eq("location_id", args.locationId).is("superseded_at", null)
      .gte("report_date", loadFrom).lte("report_date", toIncl)
      .order("id", { ascending: true }).range(from, to),
  );
  const repIds = pmInLoc.map((r) => r.id);
  let great = 0, good = 0, needsWork = 0, flaggedToImprove = 0;
  if (repIds.length) {
    const evals = await selectAllRows<{ arrived_ready: string; attitude: string; production: string; team_player: string; area_to_improve: string | null }>(
      (from, to) => service
        .from("pm_employee_evals").select("arrived_ready, attitude, production, team_player, area_to_improve")
        .in("pm_report_id", repIds).eq("employee_id", args.personId).is("superseded_at", null)
        .order("id", { ascending: true }).range(from, to),
    );
    for (const e of evals) {
      for (const g of [e.arrived_ready, e.attitude, e.production, e.team_player]) {
        if (g === "great") great++; else if (g === "good") good++; else if (g === "needs_work") needsWork++;
      }
      if (e.area_to_improve && e.area_to_improve.trim()) flaggedToImprove++;
    }
  }
  const mvp = await selectAllRows<{ id: string }>(
    (from, to) => service
      .from("pm_reports").select("id").eq("location_id", args.locationId).eq("mvp_user_id", args.personId).is("superseded_at", null)
      .gte("report_date", loadFrom).lte("report_date", toIncl)
      .order("id", { ascending: true }).range(from, to),
  );
  const mvpAwards = mvp.length;

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

export async function loadPersonDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; personId: string; locationId: string; granularity: TrendGranularity; compare: boolean; today: string },
): Promise<PersonDetail | null> {
  if (args.viewer.level < TEAM_VIEW_LEVEL) return null;

  // IDOR: person must be assigned to this location, active, and rankable (< MoO).
  const { data: ul } = await service
    .from("user_locations").select("user_id").eq("location_id", args.locationId).eq("user_id", args.personId).eq("active", true).maybeSingle();
  if (!ul) return null;
  const { data: u } = await service
    .from("users").select("id, name, role, active, created_at").eq("id", args.personId)
    .maybeSingle<{ id: string; name: string; role: RoleCode; active: boolean; created_at: string }>();
  if (!u || !u.active) return null;
  const level = ROLES[u.role]?.level ?? 0;
  if (level >= RANKED_MAX_LEVEL) return null;

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
    .from("user_locations").select("user_id").eq("location_id", args.locationId).eq("user_id", args.viewer.userId).eq("active", true).maybeSingle();
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
