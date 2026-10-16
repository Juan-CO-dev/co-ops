/**
 * THE PEOPLE PERFORMANCE RULES — pure functions of loaded facts.
 *
 * Scheduling Phase 1, Task 11. These are the materialization bodies of lib/team-metrics.ts
 * (`loadTeamWindow`, `computePersonMetrics`), moved here unchanged in meaning: the wrappers in
 * team-metrics now gate, load facts once (`loadPeopleFacts`), and call these. The people
 * equivalence pin (tests/people-layer-equivalence.test.ts) proves every number is byte-identical.
 *
 * A COMPARE LOADS ONCE. The wrappers load facts over the union of the current and previous windows
 * and call these twice. So every rule first narrows each family to ITS window exactly as the legacy
 * query filtered it (timestamp bounds [start, end) for acts, the business-date range for PM grades
 * and MVPs) — a task first completed in the previous window still counts in the current one, as it
 * did with two separate loads.
 */
import type { RoleCode } from "@/lib/roles";
import {
  type ActionCategory, type CategoryCounts, emptyCounts,
  scoreFromCounts, healthFromCounts, type Health,
  activeDayStreak, onTimeStreak, personalBest,
} from "@/lib/team-scoring";
import { personCardLine, teamBannerNarrative, type NarrativeLine } from "@/lib/people-narrative";
import { etCalendarDate } from "@/lib/operational-day";
import type { TrendGranularity } from "@/lib/reports-trends";
import {
  inBounds, requireFamilies, type FactWindow, type OversightAuditRow, type PeopleFacts,
} from "@/lib/people/facts-shared";

export type { OversightAuditRow } from "@/lib/people/facts-shared";

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

// ─── the window a rule computes over ─────────────────────────────────────────

/** One window: its ET dates, the timestamp bounds the legacy query used, and its buckets. */
export interface PeopleWindow extends FactWindow {
  granularity: TrendGranularity;
  /** clippedBucketKeys(from, to, granularity), in order. */
  keys: readonly string[];
  /** bucketStart(day, granularity). */
  bucketOf: (day: string) => string;
}

/** A rule may compute only inside what was loaded. */
function requireCovered(facts: PeopleFacts, w: FactWindow): void {
  const lb = facts.window.bounds;
  if (Date.parse(w.bounds.start) < Date.parse(lb.start) || Date.parse(w.bounds.end) > Date.parse(lb.end)
    || w.dates.from < facts.window.dates.from || w.dates.to > facts.window.dates.to) {
    throw new Error("fact_window_not_loaded");
  }
}

// ─── team scoring ────────────────────────────────────────────────────────────

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

/** A roster member (active, at the shop, below RANKED_MAX_LEVEL), in the roster query's order. */
export interface RosterMember { userId: string; name: string; role: RoleCode; level: number }

export function emptyTeam(granularity: TrendGranularity): TeamOperatingHealth {
  return {
    granularity, members: [], summary: { onTrack: 0, needsAttention: 0 },
    banner: teamBannerNarrative({ onTrack: 0, needsAttention: 0, attentionNames: [] }),
  };
}

/** 1 when the category is expected for the role (counts toward score/sparkline), else 0. */
function scoreRelevant(role: RoleCode, category: ActionCategory): number {
  return scoreFromCounts(role, { ...emptyCounts(), [category]: 1 }) > 0 ? 1 : 0;
}

/**
 * The team roster over ONE window (the legacy `loadTeamWindow` materialization). `previousScore` is
 * null and health is judged without one; a compare re-judges with the previous window's scores
 * (`withPreviousScores`), exactly as the legacy loader did.
 */
export function teamWindow(facts: PeopleFacts, roster: readonly RosterMember[], w: PeopleWindow): TeamOperatingHealth {
  requireFamilies(facts, "instances", "completions", "cash", "pmReports", "pmNotes", "oversight");
  requireCovered(facts, w);
  if (roster.length === 0) return emptyTeam(w.granularity);

  const curSet = new Set(w.keys);
  const members = new Map<string, { name: string; role: RoleCode; level: number; current: CategoryCounts; byBucket: Map<string, number> }>();
  for (const r of roster) members.set(r.userId, { name: r.name, role: r.role, level: r.level, current: emptyCounts(), byBucket: new Map() });

  const place = (uid: string, tstz: string, category: ActionCategory) => {
    const m = members.get(uid);
    if (!m) return;
    const day = etCalendarDate(tstz);
    if (day < w.dates.from || day > w.dates.to) return;
    const bs = w.bucketOf(day);
    if (curSet.has(bs)) {
      m.current[category]++;
      m.byBucket.set(bs, (m.byBucket.get(bs) ?? 0) + scoreRelevant(m.role, category));
    }
  };

  const locInstanceIds = new Set(facts.instances.map((r) => r.id));

  // 1. TASKS + NOTES (completions: completed_at in span, live, instance at location). One task per
  //    (person, instance, item): its first live completion in this window, in query order.
  const tasks = new Set<string>();
  for (const c of facts.completions) {
    if (!inBounds(c.completed_at, w.bounds) || !c.completed_by) continue;
    const key = `${c.completed_by}:${c.instance_id}:${c.template_item_id}`;
    if (!tasks.has(key)) {
      tasks.add(key);
      place(c.completed_by, c.completed_at, "tasks");
    }
    if (c.notes && c.notes.trim()) place(c.completed_by, c.completed_at, "notes");
  }

  // 2. FINALIZATIONS (instances of every date; placed by the confirmation's own day)
  for (const i of facts.instances) {
    if (i.confirmed_by && i.confirmed_at) place(i.confirmed_by, i.confirmed_at, "finalizations");
  }
  for (const c of facts.cash) {
    if (!c.signed_at || !inBounds(c.signed_at, w.bounds)) continue;
    if (c.signed_by) {
      place(c.signed_by, c.signed_at, "finalizations");
      if (c.over_short_note && c.over_short_note.trim()) place(c.signed_by, c.signed_at, "notes");
    }
  }
  const pmRows = facts.pmReports.filter((r) => r.submitted_at && inBounds(r.submitted_at, w.bounds));
  for (const r of pmRows) {
    if (r.submitted_by && r.submitted_at) {
      place(r.submitted_by, r.submitted_at, "finalizations");
      place(r.submitted_by, r.submitted_at, "peopleMgmt");
    }
  }

  // 3. NOTES from pm evals (authored by report submitter)
  const pmReportById = new Map(pmRows.map((row) => [row.id, row] as const));
  for (const e of facts.pmNotes) {
    const rep = pmReportById.get(e.pm_report_id);
    if (rep?.submitted_by && rep.submitted_at && ((e.area_to_improve && e.area_to_improve.trim()) || (e.note && e.note.trim()))) {
      place(rep.submitted_by, rep.submitted_at, "notes");
    }
  }

  // 4. OVERSIGHT (bound to THIS location's instances — see the OVERSIGHT LOCATION BIND note)
  for (const a of facts.oversight) {
    if (!a.actor_id || !inBounds(a.occurred_at, w.bounds)) continue;
    if (!oversightRowAtLocation(a, facts.locationId, locInstanceIds)) continue;
    place(a.actor_id, a.occurred_at, "oversight");
  }

  // ── materialize ──
  const out: TeamMember[] = [];
  let onTrack = 0, needsAttention = 0;
  const attentionNames: string[] = [];
  for (const [uid, m] of members) {
    const score = scoreFromCounts(m.role, m.current);
    const { health, reasons } = healthFromCounts(m.role, m.current, score, null);
    const sparkline = w.keys.map((k) => m.byBucket.get(k) ?? 0);
    if (health === "needs_attention") { needsAttention++; attentionNames.push(m.name); } else onTrack++;
    out.push({
      userId: uid, name: m.name, role: m.role, level: m.level,
      score, previousScore: null, counts: m.current, health, reasons, sparkline,
      cardLine: personCardLine({ rank: 0, role: m.role, health, reasons, scoreDeltaPct: null, onTimePct: null }),
    });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    granularity: w.granularity,
    members: out,
    summary: { onTrack, needsAttention },
    banner: teamBannerNarrative({ onTrack, needsAttention, attentionNames: attentionNames.slice(0, 3) }),
  };
}

/** The compare step of team scoring: each member re-judged against the previous window's score. */
export function withPreviousScores(current: TeamOperatingHealth, previous: TeamOperatingHealth | null): TeamOperatingHealth {
  const members = current.members.map((m) => {
    const previousScore = previous?.members.find((p) => p.userId === m.userId)?.score ?? 0;
    const { health, reasons } = healthFromCounts(m.role, m.counts, m.score, previousScore);
    const scoreDeltaPct = previousScore > 0 ? Math.round(((m.score - previousScore) / previousScore) * 100) : null;
    return { ...m, previousScore, health, reasons, cardLine: personCardLine({ rank: 0, role: m.role, health, reasons, scoreDeltaPct, onTimePct: null }) };
  });
  const needsAttention = members.filter((m) => m.health === "needs_attention");
  const summary = { onTrack: members.length - needsAttention.length, needsAttention: needsAttention.length };
  return { ...current, members, summary, banner: teamBannerNarrative({ ...summary, attentionNames: needsAttention.slice(0, 3).map((m) => m.name) }) };
}

// ─── one person ──────────────────────────────────────────────────────────────

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

/** Raw per-person metric bundle shared by person detail (manager) and My Performance (self). */
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

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** One person's counts in a window: the score half of `personMetrics`. */
function personCounts(facts: PeopleFacts, w: PeopleWindow) {
  const current = emptyCounts();
  const inWindow = (tstz: string): boolean => {
    const day = etCalendarDate(tstz);
    return day >= w.dates.from && day <= w.dates.to;
  };
  const add = (tstz: string, cat: ActionCategory) => { if (inWindow(tstz)) current[cat]++; };

  const contribBucket = new Map<string, number>();
  const activeDates = new Set<string>();
  const dayTaskCounts = new Map<string, number>();
  const weekdayCounts = new Map<string, number>();
  let lastActive: string | null = null;
  const touch = (d: string) => { if (!lastActive || d > lastActive) lastActive = d; activeDates.add(d); };

  // Query order assigns each task to its first live completion in this window.
  const tasks = new Set<string>();
  for (const c of facts.completions) {
    if (!inBounds(c.completed_at, w.bounds)) continue;
    if (c.notes && c.notes.trim()) add(c.completed_at, "notes");
    const key = `${c.instance_id}:${c.template_item_id}`;
    if (tasks.has(key)) continue;
    tasks.add(key);
    add(c.completed_at, "tasks");
    if (inWindow(c.completed_at)) {
      const d = etCalendarDate(c.completed_at);
      const bs = w.bucketOf(d);
      contribBucket.set(bs, (contribBucket.get(bs) ?? 0) + 1);
      touch(d);
      dayTaskCounts.set(d, (dayTaskCounts.get(d) ?? 0) + 1);
      const wd = WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
      weekdayCounts.set(wd, (weekdayCounts.get(wd) ?? 0) + 1);
    }
  }

  const finalsChrono: { at: string; inWindow: boolean }[] = [];
  for (const f of facts.confirmations) {
    if (!inBounds(f.confirmed_at, w.bounds)) continue;
    add(f.confirmed_at, "finalizations");
    if (inWindow(f.confirmed_at)) { finalsChrono.push({ at: f.confirmed_at, inWindow: etCalendarDate(f.confirmed_at) === f.date }); touch(etCalendarDate(f.confirmed_at)); }
  }
  for (const c of facts.cash) {
    if (!c.signed_at || !inBounds(c.signed_at, w.bounds)) continue;
    add(c.signed_at, "finalizations");
    if (c.over_short_note && c.over_short_note.trim()) add(c.signed_at, "notes");
    if (inWindow(c.signed_at)) { finalsChrono.push({ at: c.signed_at, inWindow: etCalendarDate(c.signed_at) === c.report_date }); touch(etCalendarDate(c.signed_at)); }
  }
  const pmMine = facts.pmReports.filter((r) => r.submitted_at && inBounds(r.submitted_at, w.bounds));
  for (const r of pmMine) {
    if (!r.submitted_at) continue;
    add(r.submitted_at, "finalizations");
    add(r.submitted_at, "peopleMgmt");
    if (inWindow(r.submitted_at)) { finalsChrono.push({ at: r.submitted_at, inWindow: etCalendarDate(r.submitted_at) === r.report_date }); touch(etCalendarDate(r.submitted_at)); }
  }
  if (pmMine.length) {
    const submittedAtById = new Map(pmMine.map((r) => [r.id, r.submitted_at] as const));
    for (const e of facts.pmNotes) {
      const at = submittedAtById.get(e.pm_report_id);
      if (at && ((e.area_to_improve && e.area_to_improve.trim()) || (e.note && e.note.trim()))) add(at, "notes");
    }
  }

  // The roster rule's twin — the same location bind, for the same reason (this is the path
  // /my-performance runs, and it applies no RANKED_MAX_LEVEL ceiling).
  const locInstanceIdSet = new Set(facts.instances.map((r) => r.id));
  for (const a of facts.oversight) {
    if (!inBounds(a.occurred_at, w.bounds)) continue;
    if (oversightRowAtLocation(a, facts.locationId, locInstanceIdSet)) add(a.occurred_at, "oversight");
  }

  return { current, contribBucket, activeDates, dayTaskCounts, weekdayCounts, lastActive: lastActive as string | null, finalsChrono };
}

/**
 * One person's metrics over a window at one shop (the legacy `computePersonMetrics`). With
 * `previous`, the previous window's score is computed from the SAME facts (it was a second load).
 */
export function personMetrics(
  facts: PeopleFacts,
  person: { role: RoleCode; createdAt: string },
  w: PeopleWindow,
  today: string,
  previous: PeopleWindow | null = null,
): PersonMetrics {
  requireFamilies(facts, "instances", "completions", "confirmations", "cash", "pmReports", "pmNotes", "oversight", "pmGrades", "mvps");
  if (facts.subject.kind !== "person") throw new Error("person_facts_required");
  requireCovered(facts, w);
  if (previous) requireCovered(facts, previous);

  const c = personCounts(facts, w);
  const score = scoreFromCounts(person.role, c.current);
  const previousScore = previous ? scoreFromCounts(person.role, personCounts(facts, previous).current) : null;
  const scoreDeltaPct = previousScore && previousScore > 0 ? Math.round(((score - previousScore) / previousScore) * 100) : null;

  const finalsChrono = c.finalsChrono;
  finalsChrono.sort((a, b) => (a.at < b.at ? -1 : 1));
  const onTimeByBucket = new Map<string, { hit: number; total: number }>();
  for (const f of finalsChrono) {
    const bs = w.bucketOf(etCalendarDate(f.at));
    const e = onTimeByBucket.get(bs) ?? { hit: 0, total: 0 };
    e.total++; if (f.inWindow) e.hit++;
    onTimeByBucket.set(bs, e);
  }
  let oh = 0, ot = 0;
  for (const e of onTimeByBucket.values()) { oh += e.hit; ot += e.total; }
  const overallOnTime = ot > 0 ? Math.round((oh / ot) * 100) : null;

  // PM v1 grades and MVPs are dated by the REPORT's business date, inside the window's dates.
  const dated = (r: { report_date: string }) => r.report_date >= w.dates.from && r.report_date <= w.dates.to;
  const repIds = new Set(facts.pmGradedReports.filter(dated).map((r) => r.id));
  let great = 0, good = 0, needsWork = 0, flaggedToImprove = 0;
  for (const e of facts.pmGrades) {
    if (!repIds.has(e.pm_report_id)) continue;
    for (const g of [e.arrived_ready, e.attitude, e.production, e.team_player]) {
      if (g === "great") great++; else if (g === "good") good++; else if (g === "needs_work") needsWork++;
    }
    if (e.area_to_improve && e.area_to_improve.trim()) flaggedToImprove++;
  }
  const mvpAwards = facts.mvps.filter(dated).length;

  const contribution = w.keys.map((k) => (c.contribBucket.has(k) ? c.contribBucket.get(k)! : null));
  const onTime = w.keys.map((k) => { const e = onTimeByBucket.get(k); return e && e.total > 0 ? Math.round((e.hit / e.total) * 100) : null; });
  const streaks: PersonStreaks = {
    activeDays: activeDayStreak([...c.activeDates], today),
    onTime: onTimeStreak(finalsChrono.map((f) => f.inWindow)),
    personalBest: personalBest([...c.dayTaskCounts.values()]),
  };
  let mostActiveDay: string | null = null; let mx = -1;
  for (const [wd, n] of c.weekdayCounts) if (n > mx) { mx = n; mostActiveDay = wd; }
  const tenureDays = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(person.createdAt)) / 86400000));

  return {
    counts: c.current, score, previousScore, scoreDeltaPct,
    bucketKeys: [...w.keys], contribution, onTime, overallOnTime,
    gradientTally: { great, good, needsWork }, streaks,
    signals: { mvpAwards, flaggedToImprove, mostActiveDay, tenureDays, lastActive: c.lastActive },
  };
}
