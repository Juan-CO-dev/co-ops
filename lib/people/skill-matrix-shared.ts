/**
 * THE SKILL MATRIX — facts → every person × position skill at one shop, and the two views. Pure.
 *
 * Scheduling Phase 1, Task 16 (the assembly) and Task 17 (the views). lib/people/skills.ts loads the skill
 * families through `loadPeopleFacts` and hands them here; nothing in this module does I/O.
 *
 * WHAT PHASE 2 READS (plan, "What Phase 2 reads"): ONE call, `loadSkillMatrix`, returning a `SkillMatrix`
 * — every member of the shop (managers included) × every ACTIVE position of the shop, each with its
 * `SkillResult` (value, learned, prior, adjustment, band, evidence, perKind, confidence, qualityDays,
 * workedDays, minutesWorked, startingPoint). Positions are keyed on `station_positions.id` (shop-scoped,
 * J2). Their order here is DISPLAY order (station sort, then position sort): it is never a priority, and
 * Phase 1 never reads `station_positions.sort` as one.
 *
 * R8: the self view is built by `toSelfSkillView` at the lib boundary. It carries a band and positive
 * evidence lines only — no number, no confidence, and no trace of a manager adjustment (not the amount,
 * not the fact, not an adjustment-derived line, not a position that only an adjustment or rating names).
 * Its band is read from the LEARNED skill, before any adjustment, so an adjustment cannot even move it.
 */
import type { NarrativeLine } from "@/lib/people-narrative";
import type { RoleCode } from "@/lib/roles";
import { etCalendarDate, operationalDayUtcRange } from "@/lib/operational-day";
import type { FactWindow, SkillFacts } from "@/lib/people/facts-shared";
import { closeOpenIntervals, positionTimeline, type PositionInterval } from "@/lib/people/positions-shared";
import {
  closeOnTimeObservations, pmObservations, prepYieldObservations, signalsFor, skillBand, skillFor, skillWindowStart,
  workedDays, type PersonObservation, type PmPositionGrade, type SkillBand, type SkillResult,
} from "@/lib/people/skills-shared";
import { tunablesDigest, type SkillTunables } from "@/lib/people/tunables-shared";
import type { StationEvent } from "@/lib/assignments-shared";

const RELEASE_REASONS = ["station_closed", "clocked_out", "on_break", "ended_shift", "shop_closed"] as const;
function isReleaseReason(v: unknown): v is NonNullable<StationEvent["releaseReason"]> {
  return typeof v === "string" && (RELEASE_REASONS as readonly string[]).includes(v);
}

/**
 * A position COUNTS only when it AND its parent station are active (Astra chunk E #2): station sync can
 * deactivate a station without retiring its positions. Readiness, the matrix, every list of available
 * positions and every new write (the lib, and 0270's `people_position_at_shop` in SQL) apply this.
 */
export function positionUsable(
  position: { station_id: string; active: boolean }, stations: ReadonlyArray<{ id: string; active: boolean }>,
): boolean {
  return position.active && stations.some((s) => s.id === position.station_id && s.active);
}

export interface SkillMember { userId: string; name: string; role: RoleCode }
export interface SkillMatrixPosition { positionId: string; stationId: string; name: string; nameEs: string | null; active: boolean }
export interface SkillMatrix {
  locationId: string;
  asOf: string;
  /** A digest of the resolved tunables. */
  tunablesVersion: string;
  positions: SkillMatrixPosition[];
  people: Array<{ userId: string; role: RoleCode; skills: SkillResult[] }>;
}

/** The evidence window as a fact window: the ET days [asOf − windowDays + 1, asOf]. */
export function skillFactWindow(asOf: string, t: SkillTunables): FactWindow {
  const from = skillWindowStart(asOf, t.windowDays);
  return { bounds: { start: operationalDayUtcRange(from).startIso, end: operationalDayUtcRange(asOf).endExclusiveIso }, dates: { from, to: asOf } };
}

/**
 * The pure twin of 0230 `station_closures(location, day)`: on the day's LATEST closing instance (shift
 * start, then trigger time, then id, all descending), a station closed when every ACTIVE line of its
 * section (`btrim(station)` = the station's name) has a live completion; closed at the last of them.
 */
export function stationClosures(facts: Pick<SkillFacts, "closingInstances" | "closingItems" | "closingCompletions" | "stations">): Map<string, string> {
  const latestByDay = new Map<string, SkillFacts["closingInstances"][number]>();
  const desc = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : Date.parse(b) - Date.parse(a));
  for (const i of facts.closingInstances) {
    const cur = latestByDay.get(i.date);
    if (!cur) { latestByDay.set(i.date, i); continue; }
    const order = desc(i.shift_start_at, cur.shift_start_at) || desc(i.triggered_at, cur.triggered_at) || (cur.id < i.id ? -1 : 1);
    if (order < 0) latestByDay.set(i.date, i);
  }
  const done = new Map<string, string>(); // `${instance}/${item}` → completed_at (the latest live one)
  for (const c of facts.closingCompletions) {
    const key = `${c.instance_id}/${c.template_item_id}`;
    const prev = done.get(key);
    if (!prev || Date.parse(c.completed_at) > Date.parse(prev)) done.set(key, c.completed_at);
  }
  const out = new Map<string, string>();
  for (const [day, inst] of latestByDay) {
    for (const st of facts.stations) {
      if (!st.active) continue;
      const lines = facts.closingItems.filter((ti) => ti.template_id === inst.template_id && ti.active && (ti.station ?? "").trim() === st.name);
      if (!lines.length) continue;
      const times = lines.map((ti) => done.get(`${inst.id}/${ti.id}`));
      if (times.some((x) => x === undefined)) continue;
      out.set(`${st.id}/${day}`, times.reduce((a, b) => (Date.parse(b!) > Date.parse(a!) ? b : a))!);
    }
  }
  return out;
}

/** Position intervals from the loaded events, open ones closed at min(the day's end, now). */
export function skillIntervals(facts: Pick<SkillFacts, "stationEvents">, nowIso: string): PositionInterval[] {
  const events: StationEvent[] = facts.stationEvents.map((e) => ({
    id: e.id, sequence: e.sequence, locationId: e.locationId, businessDate: e.businessDate, userId: e.userId,
    stationId: e.stationId, positionId: e.positionId, kind: e.kind, actorId: null, actorName: null, at: e.at,
    source: e.source, effectiveAt: e.effectiveAt,
    ...(e.kind === "release" && isReleaseReason(e.reasonCode) ? { releaseReason: e.reasonCode } : {}),
  }));
  const intervals = positionTimeline(events);
  const now = Date.parse(nowIso);
  return intervals.flatMap((i) => {
    if (i.end !== null) return [i];
    const dayEnd = Date.parse(operationalDayUtcRange(i.businessDate).endExclusiveIso);
    return closeOpenIntervals([i], new Date(Math.min(dayEnd, now)).toISOString());
  });
}

/** Usable positions of the shop (active, on an active station) in DISPLAY order (station sort, position sort, name, id) — never a priority. */
export function orderedPositions(facts: Pick<SkillFacts, "positions" | "stations">): SkillMatrixPosition[] {
  const station = new Map(facts.stations.map((s) => [s.id, s] as const));
  return facts.positions
    .filter((p) => positionUsable(p, facts.stations))
    .sort((a, b) => {
      const sa = station.get(a.station_id)?.sort ?? Number.MAX_SAFE_INTEGER, sb = station.get(b.station_id)?.sort ?? Number.MAX_SAFE_INTEGER;
      return sa - sb || a.station_id.localeCompare(b.station_id) || a.sort - b.sort || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    })
    .map((p) => ({ positionId: p.id, stationId: p.station_id, name: p.name, nameEs: p.name_es, active: p.active }));
}

/** The latest row per (user, position): `created_at`, then id, ascending input → last wins. */
function latestBy<T extends { user_id: string; position_id: string; created_at: string; id: string }>(rows: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  const sorted = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
  for (const r of sorted) out.set(`${r.user_id}/${r.position_id}`, r);
  return out;
}

export interface ComputedSkills {
  matrix: SkillMatrix;
  /** Per person: minutes at a station with no recorded position (0217-era events). */
  unrecordedMinutes: Map<string, number>;
  /** Prep rows in the window with no maker recorded (the shop's, not a person's). */
  noMakerBatches: number;
  /** Per maker: prep rows with a maker but no position to count toward (no interval, no shop prep position). */
  unplacedBatches: Map<string, number>;
}

/**
 * Every member × every active position. `actorNames` resolves who adjusted / rated (evidence lines).
 * PM v2 grades enter only through `pmGrades` (Task 23); Phase 1 passes none.
 */
export function computeSkills(input: {
  locationId: string; facts: SkillFacts; members: readonly SkillMember[]; asOf: string; nowIso: string; tunables: SkillTunables;
  actorNames: ReadonlyMap<string, string>; pmGrades?: readonly PmPositionGrade[];
}): ComputedSkills {
  const { facts, tunables: t } = input;
  const intervals = skillIntervals(facts, input.nowIso);
  const worked = workedDays(intervals);
  const closures = stationClosures(facts);
  const instanceDay = new Map(facts.closingInstances.map((i) => [i.id, i.date] as const));
  const lineStation = new Map(facts.closingItems.filter((ti) => ti.station).map((ti) => [ti.id, ti.station!] as const));
  const closing = closeOnTimeObservations({
    completions: facts.closingCompletions.map((c) => ({ id: c.id, instanceId: c.instance_id, templateItemId: c.template_item_id, completedBy: c.completed_by, completedAt: c.completed_at })),
    instanceDay, lineStation,
    instanceStart: new Map(facts.closingInstances.map((i) => [i.id, i.shift_start_at ?? i.triggered_at ?? null] as const)),
    stations: facts.stations.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, usuallyClosesAt: s.usually_closes_at })),
    closures, intervals,
  }, t);
  const prep = prepYieldObservations(facts.productions, intervals, facts.settings?.prepPositionId ?? null, t, etCalendarDate);
  const observations: PersonObservation[] = [...closing, ...prep.observations, ...pmObservations(input.pmGrades ?? [], t)];

  const adjustments = latestBy(facts.adjustments);
  const ratings = latestBy(facts.ratings);
  const positions = orderedPositions(facts);
  const people = input.members.map((m) => ({
    userId: m.userId, role: m.role,
    skills: positions.map((p) => {
      const key = `${m.userId}/${p.positionId}`;
      const adj = adjustments.get(key);
      const rating = ratings.get(key);
      return skillFor(signalsFor(m.userId, p.positionId, input.asOf, worked.byUser, observations), rating ? rating.rating : null, adj ? adj.delta : 0, t, {
        adjustment: adj ? { delta: adj.delta, actorName: input.actorNames.get(adj.actor_id) ?? "", at: adj.created_at, reasonCode: adj.reason_code } : null,
        rating: rating ? { rating: rating.rating, actorName: input.actorNames.get(rating.actor_id) ?? "", at: rating.created_at } : null,
        noMakerBatches: prep.noMaker,
      });
    }),
  }));
  return {
    matrix: { locationId: input.locationId, asOf: input.asOf, tunablesVersion: tunablesDigest(t), positions, people },
    unrecordedMinutes: worked.unrecordedMinutes,
    noMakerBatches: prep.noMaker,
    unplacedBatches: prep.unplaced,
  };
}

// ─── the manager view (Task 17) ──────────────────────────────────────────────

export interface SkillHistoryEntry { id: string; kind: "adjustment" | "rating"; value: number; reasonCode: string; reasonNote: string | null; actorName: string; at: string }
export interface ManagerSkillRow {
  position: SkillMatrixPosition;
  skill: SkillResult;
  /** Worked, observed, adjusted or rated here: the rows the page shows open; the rest sit under "Other positions". */
  hasEvidence: boolean;
  /** Newest first. */
  history: SkillHistoryEntry[];
}
export interface ManagerSkillView {
  locationId: string;
  subjectId: string;
  asOf: string;
  rows: ManagerSkillRow[];
  adjustedCount: number;
  unrecordedMinutes: number;
  /** Prep batches this person made here that could not be placed at a position (evidence only, no skill). */
  unplacedBatches: number;
  /** Set by the lib from `canAdjustSkill` (GM own shop / MoO+, strictly outranking the subject). */
  canAdjust: boolean;
}

export function toManagerSkillView(input: {
  computed: ComputedSkills; subjectId: string; facts: SkillFacts; actorNames: ReadonlyMap<string, string>; canAdjust: boolean;
}): ManagerSkillView {
  const person = input.computed.matrix.people.find((p) => p.userId === input.subjectId);
  const rows: ManagerSkillRow[] = input.computed.matrix.positions.map((position, i) => {
    const skill = person!.skills[i]!;
    const history: SkillHistoryEntry[] = [
      ...input.facts.adjustments.filter((a) => a.user_id === input.subjectId && a.position_id === position.positionId)
        .map((a) => ({ id: a.id, kind: "adjustment" as const, value: a.delta, reasonCode: a.reason_code, reasonNote: a.reason_note, actorName: input.actorNames.get(a.actor_id) ?? "", at: a.created_at })),
      ...input.facts.ratings.filter((r) => r.user_id === input.subjectId && r.position_id === position.positionId)
        .map((r) => ({ id: r.id, kind: "rating" as const, value: r.rating, reasonCode: r.reason_code, reasonNote: r.reason_note, actorName: input.actorNames.get(r.actor_id) ?? "", at: r.created_at })),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
    const observed = Object.values(skill.perKind).some((k) => k !== null);
    return { position, skill, history, hasEvidence: skill.workedDays > 0 || observed || history.length > 0 };
  });
  return {
    locationId: input.computed.matrix.locationId, subjectId: input.subjectId, asOf: input.computed.matrix.asOf, rows,
    adjustedCount: rows.filter((r) => r.skill.adjustment !== 0).length,
    unrecordedMinutes: input.computed.unrecordedMinutes.get(input.subjectId) ?? 0,
    unplacedBatches: input.computed.unplacedBatches.get(input.subjectId) ?? 0,
    canAdjust: input.canAdjust,
  };
}

// ─── the self view (Task 17, R8) ─────────────────────────────────────────────

export interface SelfSkillRow { positionId: string; name: string; nameEs: string | null; band: SkillBand; lines: NarrativeLine[] }

/**
 * The person's own skills (R8): positions they WORKED or were observed at, each with a band and the
 * positive evidence lines only. Built from the learned skill — never `value`, never `adjustment`, never an
 * evidence line whose source is an adjustment or a rating — so no component can leak either.
 */
export function toSelfSkillView(matrix: SkillMatrix, userId: string, t: SkillTunables): SelfSkillRow[] {
  const person = matrix.people.find((p) => p.userId === userId);
  if (!person) return [];
  const out: SelfSkillRow[] = [];
  matrix.positions.forEach((position, i) => {
    const s = person.skills[i]!;
    const observedKinds = Object.values(s.perKind).filter((k) => k !== null);
    if (s.workedDays === 0 && observedKinds.length === 0) return;
    const lines: NarrativeLine[] = [];
    if (s.workedDays > 0) lines.push({ key: "people.skills.self.worked", params: { days: s.workedDays, hours: Math.round(s.minutesWorked / 60) } });
    const pm = s.perKind.pm;
    if (pm && pm.mean >= t.gradeValue.good) lines.push({ key: "people.skills.self.pm", params: { count: pm.count } });
    const close = s.perKind.closeOnTime;
    const onTime = close ? Math.round(close.mean * close.count) : 0;
    if (onTime > 0) lines.push({ key: "people.skills.self.closeOnTime", params: { count: onTime } });
    const prep = s.perKind.prepYield;
    const onTarget = prep ? Math.round(prep.mean * prep.count) : 0;
    if (onTarget > 0) lines.push({ key: "people.skills.self.prepYield", params: { count: onTarget } });
    out.push({ positionId: position.positionId, name: position.name, nameEs: position.nameEs, band: skillBand(s.learned, t), lines });
  });
  return out;
}
