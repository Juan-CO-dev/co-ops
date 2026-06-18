import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLES, type RoleCode } from "@/lib/roles";
import {
  type ActionCategory, type CategoryCounts, emptyCounts,
  scoreFromCounts, healthFromCounts, type Health,
  activeDayStreak, onTimeStreak, personalBest,
} from "@/lib/team-scoring";
import { personCardLine, personReadNarrative, teamBannerNarrative, myPerformanceRead, type NarrativeLine } from "@/lib/people-narrative";
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

/**
 * Page through a PostgREST query so the default 1000-row cap can't silently
 * truncate a scan. `build(from, to)` must return a query with `.range(from, to)`
 * already applied (and any filters/select). Stops when a short page returns.
 * Without this, an all-users completions scan over a busy location truncates and
 * every member's task count comes back low (caught: roster vs detail score mismatch).
 */
async function selectAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await build(from, from + pageSize - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

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

  const emptyResult = (): TeamOperatingHealth => ({
    granularity: args.granularity, members: [], summary: { onTrack: 0, needsAttention: 0 },
    banner: teamBannerNarrative({ onTrack: 0, needsAttention: 0, attentionNames: [] }),
  });

  // ── Roster: location-assigned, active, level < 8 ──
  const { data: ulRows } = await service
    .from("user_locations").select("user_id").eq("location_id", args.locationId);
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
    const bs = bucketStart(opDate(tstz), args.granularity);
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
        .gte("completed_at", `${loadFrom}T00:00:00Z`).lte("completed_at", `${loadToInclusive}T23:59:59Z`)
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
    .from("pm_reports").select("id, submitted_by, submitted_at")
    .eq("location_id", args.locationId).is("superseded_at", null)
    .gte("submitted_at", `${loadFrom}T00:00:00Z`).lte("submitted_at", `${loadToInclusive}T23:59:59Z`);
  for (const r of (pmRows ?? []) as Array<{ submitted_by: string | null; submitted_at: string | null }>) {
    if (r.submitted_by && r.submitted_at) {
      place(r.submitted_by, r.submitted_at, "finalizations");
      place(r.submitted_by, r.submitted_at, "peopleMgmt");
    }
  }

  // 3. NOTES from pm evals (authored by report submitter)
  const pmReportById = new Map((pmRows ?? []).map((r) => {
    const row = r as { id: string; submitted_by: string | null; submitted_at: string | null };
    return [row.id, row] as const;
  }));
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

  // 4. OVERSIGHT (audit_log by actor_id — window-global)
  const { data: auditRows } = await service
    .from("audit_log").select("actor_id, action, occurred_at")
    .in("actor_id", memberIds).in("action", OVERSIGHT_ACTIONS)
    .gte("occurred_at", `${loadFrom}T00:00:00Z`).lte("occurred_at", `${loadToInclusive}T23:59:59Z`);
  for (const a of (auditRows ?? []) as Array<{ actor_id: string | null; occurred_at: string }>) {
    if (a.actor_id) place(a.actor_id, a.occurred_at, "oversight");
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

  const { data: auditRows } = await service
    .from("audit_log").select("occurred_at").eq("actor_id", args.personId).in("action", OVERSIGHT_ACTIONS)
    .gte("occurred_at", `${loadFrom}T00:00:00Z`).lte("occurred_at", `${toIncl}T23:59:59Z`);
  for (const a of (auditRows ?? []) as Array<{ occurred_at: string }>) add(a.occurred_at, "oversight");

  const score = scoreFromCounts(args.role, current);
  const previousScore = args.compare ? scoreFromCounts(args.role, previous) : null;
  const scoreDeltaPct = previousScore && previousScore > 0 ? Math.round(((score - previousScore) / previousScore) * 100) : null;

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
    .from("user_locations").select("user_id").eq("location_id", args.locationId).eq("user_id", args.personId).maybeSingle();
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
