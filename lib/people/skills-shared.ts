/**
 * THE SKILL MODEL — pure, client-safe. Scheduling Phase 1, Task 15.
 *
 * A skill is per person × STATION POSITION (`station_positions.id`, shop-scoped by construction, J2).
 * It is LEARNED at read time from dated quality observations the shop already captures, blended with a
 * prior (the manager's new-hire rating, else a neutral 0.5, J5), and optionally moved by a manager
 * adjustment. Nothing is materialized: the loader (lib/people/skills.ts) reads facts, these functions
 * compute. The constants come in as a resolved `SkillTunables` PARAMETER (R11); nothing here imports the
 * defaults.
 *
 * THE FORMULA (r1 P2-7, r2 #3):
 *  - observations are DATED (one per grade / closing line / production row) and deduplicated by
 *    (kind, sourceId); only those whose ET business day lies in the window [asOf − windowDays + 1, asOf]
 *    count;
 *  - per kind, `mean` = the observation-weight-weighted mean of its values (equal weights when the kind's
 *    weights sum to 0, flagged `equalWeightFallback`), so a kind with observations always has a mean;
 *  - a kind COUNTS when it has ≥ 1 observation AND its tunable weight is > 0. An observed kind with weight
 *    0 is SHOWN (evidence, `perKind`) but contributes nothing to q, n or confidence;
 *  - q = Σ_counting w_k · mean_k / Σ_counting w_k (weights normalised at use: 3/1/1 ≡ 0.6/0.2/0.2);
 *  - n = |the SET of distinct days across the counting kinds' observations| — a day with a PM grade, a
 *    closing line and a batch counts ONCE; a day only worked counts ZERO;
 *  - n > 0: learned = (k·prior + n·q) / (k + n); n = 0: learned = prior, and q is never computed (no
 *    division by a zero sum ever runs);
 *  - confidence = n / (k + n); value = clamp(learned + adjustment, 0, 1);
 *  - startingPoint = n = 0 or n < minQualityDaysForLearned.
 * Every numeric output is asserted finite and in range before returning (`skill_not_finite`).
 */
import type { NarrativeLine } from "@/lib/people-narrative";
import type { PositionInterval } from "@/lib/people/positions-shared";
import type { SkillTunables } from "@/lib/people/tunables-shared";
import { batchSignedDrift, isUsableBatch, type YieldBatch } from "@/lib/yield-stats-shared";
import { etWallClockToUtcIso } from "@/lib/operational-day";

export type QualityKind = "pm" | "closeOnTime" | "prepYield";
export const QUALITY_KINDS: readonly QualityKind[] = ["pm", "closeOnTime", "prepYield"];

export interface QualityObservation {
  positionId: string;
  /** YYYY-MM-DD, the ET business day. */
  day: string;
  kind: QualityKind;
  /** 0..1 */
  value: number;
  /** pm: observed minutes; closing: 1 per line; prep: 1 per production row. */
  weight: number;
  /** The grade / completion / production id: a re-loaded row never counts twice. */
  sourceId: string;
}
export interface WorkedDay { positionId: string; day: string; minutes: number }
export interface PositionSignals {
  positionId: string;
  /** The window's last ET business day. */
  asOf: string;
  /** Exposure (from position intervals): shown, never mixed into n. */
  worked: readonly WorkedDay[];
  /** Quality, dated. */
  observations: readonly QualityObservation[];
}

export type SkillBand = "building" | "solid" | "strong";
export const SKILL_BANDS: readonly SkillBand[] = ["building", "solid", "strong"];

export interface KindSummary {
  mean: number;
  count: number;
  days: number;
  /** weight > 0 in the tunables: enters q and n. */
  counted: boolean;
  /** The kind's observation weights summed to 0, so its mean used equal weights. */
  equalWeightFallback: boolean;
}

export type EvidenceSource = "worked" | "pm" | "closeOnTime" | "prepYield" | "adjustment" | "rating" | "noMaker";
/** An i18n key + params, never prose. `source` lets the self view strip what it must never show (R8). */
export interface SkillEvidenceLine extends NarrativeLine { source: EvidenceSource }

/** Who / when / why behind the prior and the adjustment, for the evidence lines (managers only). */
export interface SkillNotes {
  adjustment?: { delta: number; actorName: string; at: string; reasonCode: string } | null;
  rating?: { rating: number; actorName: string; at: string } | null;
  /** Prep rows at this shop in the window with no maker recorded. */
  noMakerBatches?: number;
}

export interface SkillResult {
  positionId: string;
  learned: number;
  prior: number;
  priorSource: "manager_rating" | "neutral";
  adjustment: number;
  /** clamp(learned + adjustment, 0, 1) — the number Phase 2 weighs. */
  value: number;
  band: SkillBand;
  /** n: distinct days with ≥ 1 counted observation. */
  qualityDays: number;
  workedDays: number;
  minutesWorked: number;
  /** n / (k + n): 0 = all prior, → 1 = all data. */
  confidence: number;
  startingPoint: boolean;
  perKind: Record<QualityKind, KindSummary | null>;
  evidence: SkillEvidenceLine[];
}

export class SkillNotFiniteError extends Error {
  constructor(public field: string) { super("skill_not_finite"); }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The window's first day: asOf − (windowDays − 1), on the calendar (UTC arithmetic over a YYYY-MM-DD). */
export function skillWindowStart(asOf: string, windowDays: number): string {
  const [y, m, d] = asOf.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - (windowDays - 1))).toISOString().slice(0, 10);
}
function inWindow(day: string, from: string, to: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= from && day <= to;
}

/** < building → Building · building..strong → Solid · ≥ strong → Strong. */
export function skillBand(value: number, t: SkillTunables): SkillBand {
  if (value < t.bands.building) return "building";
  if (value < t.bands.strong) return "solid";
  return "strong";
}

/** A signed two-decimal delta for display ("+0.10", "−0.05", "0.00"). */
export function formatDelta(delta: number): string {
  const v = Math.round(delta * 100) / 100;
  if (v === 0) return "0.00";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
}

/** The skill at ONE position. See the module header for the formula. */
export function skillFor(
  signals: PositionSignals, prior: number | null, adjustment: number, t: SkillTunables, notes: SkillNotes = {},
): SkillResult {
  const from = skillWindowStart(signals.asOf, t.windowDays);
  const to = signals.asOf;

  // Observations: this position, a usable value, in the window, deduplicated by (kind, sourceId).
  const seen = new Set<string>();
  const byKind: Record<QualityKind, QualityObservation[]> = { pm: [], closeOnTime: [], prepYield: [] };
  for (const o of signals.observations) {
    if (o.positionId !== signals.positionId || !QUALITY_KINDS.includes(o.kind) || !finite(o.value)) continue;
    if (!inWindow(o.day, from, to)) continue;
    const key = `${o.kind}\u0000${o.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byKind[o.kind].push({ ...o, value: clamp01(o.value), weight: finite(o.weight) && o.weight > 0 ? o.weight : 0 });
  }

  const perKind = {} as Record<QualityKind, KindSummary | null>;
  for (const kind of QUALITY_KINDS) {
    const obs = byKind[kind];
    if (!obs.length) { perKind[kind] = null; continue; }
    const maxW = Math.max(...obs.map((o) => o.weight));
    let mean: number;
    let equalWeightFallback = false;
    if (maxW > 0) {
      let num = 0, den = 0;
      for (const o of obs) { const w = o.weight / maxW; num += w * o.value; den += w; }
      mean = num / den;
    } else {
      equalWeightFallback = true;
      mean = obs.reduce((s, o) => s + o.value, 0) / obs.length;
    }
    perKind[kind] = {
      mean: clamp01(mean), count: obs.length, days: new Set(obs.map((o) => o.day)).size,
      counted: t.weights[kind] > 0, equalWeightFallback,
    };
  }

  const counting = QUALITY_KINDS.filter((k) => perKind[k]?.counted);
  const qualityDays = new Set(counting.flatMap((k) => byKind[k].map((o) => o.day))).size;
  const k = t.priorStrength;
  const priorSource: SkillResult["priorSource"] = finite(prior) ? "manager_rating" : "neutral";
  const p = clamp01(finite(prior) ? prior : t.priorWhenNoRating);
  let learned = p;
  if (qualityDays > 0) {
    const maxTw = Math.max(...counting.map((kind) => t.weights[kind]));
    let num = 0, den = 0;
    for (const kind of counting) { const w = t.weights[kind] / maxTw; num += w * perKind[kind]!.mean; den += w; }
    const q = clamp01(num / den);
    learned = clamp01((k * p + qualityDays * q) / (k + qualityDays));
  }
  const confidence = qualityDays > 0 ? qualityDays / (k + qualityDays) : 0;
  const adj = finite(adjustment) ? adjustment : 0;
  const value = clamp01(learned + adj);

  const worked = signals.worked.filter((w) => w.positionId === signals.positionId && inWindow(w.day, from, to) && finite(w.minutes) && w.minutes > 0);
  const workedDays = new Set(worked.map((w) => w.day)).size;
  const minutesWorked = Math.round(worked.reduce((s, w) => s + w.minutes, 0));

  const result: SkillResult = {
    positionId: signals.positionId, learned, prior: p, priorSource, adjustment: adj, value,
    band: skillBand(value, t), qualityDays, workedDays, minutesWorked, confidence,
    startingPoint: qualityDays === 0 || qualityDays < t.minQualityDaysForLearned,
    perKind, evidence: evidenceLines(perKind, workedDays, minutesWorked, priorSource, notes),
  };
  assertFiniteSkill(result);
  return result;
}

function assertFiniteSkill(r: SkillResult): void {
  for (const f of ["learned", "prior", "value", "confidence"] as const) {
    if (!finite(r[f]) || r[f] < 0 || r[f] > 1) throw new SkillNotFiniteError(f);
  }
  if (!finite(r.adjustment)) throw new SkillNotFiniteError("adjustment");
  for (const f of ["qualityDays", "workedDays", "minutesWorked"] as const) {
    if (!Number.isInteger(r[f]) || r[f] < 0) throw new SkillNotFiniteError(f);
  }
  for (const kind of QUALITY_KINDS) {
    const s = r.perKind[kind];
    if (s && (!finite(s.mean) || s.mean < 0 || s.mean > 1)) throw new SkillNotFiniteError(`perKind.${kind}`);
  }
  if (!SKILL_BANDS.includes(r.band)) throw new SkillNotFiniteError("band");
}

/** The evidence, as i18n keys under `people.skills.evidence.*` (managers see all of it). */
function evidenceLines(
  perKind: Record<QualityKind, KindSummary | null>, workedDays: number, minutesWorked: number,
  priorSource: SkillResult["priorSource"], notes: SkillNotes,
): SkillEvidenceLine[] {
  const lines: SkillEvidenceLine[] = [];
  if (workedDays > 0) {
    lines.push({ key: "people.skills.evidence.worked", params: { days: workedDays, hours: Math.round(minutesWorked / 60) }, source: "worked" });
  }
  const pm = perKind.pm;
  if (pm) lines.push({ key: pm.counted ? "people.skills.evidence.pm" : "people.skills.evidence.pmNotCounted", params: { count: pm.count, days: pm.days }, source: "pm" });
  const close = perKind.closeOnTime;
  if (close) {
    lines.push({
      key: close.counted ? "people.skills.evidence.closeOnTime" : "people.skills.evidence.closeOnTimeNotCounted",
      params: { onTime: Math.round(close.mean * close.count), count: close.count }, source: "closeOnTime",
    });
  }
  const prep = perKind.prepYield;
  if (prep) {
    lines.push({
      key: prep.counted ? "people.skills.evidence.prepYield" : "people.skills.evidence.prepYieldNotCounted",
      params: { count: prep.count, pct: Math.round(prep.mean * 100) }, source: "prepYield",
    });
  }
  if ((notes.noMakerBatches ?? 0) > 0) {
    lines.push({ key: "people.skills.evidence.noMaker", params: { count: notes.noMakerBatches! }, source: "noMaker" });
  }
  if (priorSource === "manager_rating" && notes.rating) {
    lines.push({ key: "people.skills.evidence.rating", params: { actor: notes.rating.actorName, date: notes.rating.at.slice(0, 10) }, source: "rating" });
  }
  if (notes.adjustment && notes.adjustment.delta !== 0) {
    lines.push({
      key: "people.skills.evidence.adjustment",
      params: { delta: formatDelta(notes.adjustment.delta), actor: notes.adjustment.actorName, date: notes.adjustment.at.slice(0, 10), reason: notes.adjustment.reasonCode },
      source: "adjustment",
    });
  }
  return lines;
}

// ─── Signal builders: facts → dated observations (pure) ──────────────────────

/** An observation for a person (the builders attribute; `skillFor` takes one person's at a time). */
export interface PersonObservation extends QualityObservation { userId: string }

/** The position a person held at an instant: the CLOSED interval [start, end) containing it, or null. */
export function positionAt(intervals: readonly PositionInterval[], userId: string, at: string): PositionInterval | null {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  for (const i of intervals) {
    if (i.userId !== userId || i.end === null) continue;
    if (Date.parse(i.start) <= t && t < Date.parse(i.end)) return i;
  }
  return null;
}

/**
 * Worked minutes per (person, position, business day) from CLOSED intervals. An interval with a null
 * position (a 0217-era event) never makes a skill row: its minutes go to `unrecordedMinutes`.
 */
export function workedDays(intervals: readonly PositionInterval[]): {
  byUser: Map<string, WorkedDay[]>; unrecordedMinutes: Map<string, number>;
} {
  const sums = new Map<string, { userId: string; positionId: string; day: string; ms: number }>();
  const unrecorded = new Map<string, number>();
  for (const i of intervals) {
    if (i.end === null) continue;
    const ms = Date.parse(i.end) - Date.parse(i.start);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    if (i.positionId === null) { unrecorded.set(i.userId, (unrecorded.get(i.userId) ?? 0) + ms / 60_000); continue; }
    const key = `${i.userId}/${i.positionId}/${i.businessDate}`;
    const row = sums.get(key) ?? { userId: i.userId, positionId: i.positionId, day: i.businessDate, ms: 0 };
    row.ms += ms;
    sums.set(key, row);
  }
  const byUser = new Map<string, WorkedDay[]>();
  for (const r of sums.values()) {
    const list = byUser.get(r.userId) ?? [];
    list.push({ positionId: r.positionId, day: r.day, minutes: r.ms / 60_000 });
    byUser.set(r.userId, list);
  }
  return { byUser, unrecordedMinutes: new Map([...unrecorded].map(([u, m]) => [u, Math.round(m)])) };
}

export interface ClosingCompletion { id: string; instanceId: string; templateItemId: string; completedBy: string | null; completedAt: string }
export interface ClosingStationFact { id: string; name: string; usuallyClosesAt: string | null }

/**
 * Closing on time: one observation per closing-template line completion by the person (`sourceId` = the
 * completion id, `day` = its instance's business day). The line's station (`checklist_template_items.station`,
 * trimmed) must match a station's `name` at the shop (the 0230 `station_closures` join). value = 1 when it
 * was done at or before the station's usual close (`usually_closes_at`, an ET wall time on that day,
 * DST-correct) + `closeGraceMinutes`; when the station has no usual close, 1 when done at or before its
 * observed closure that day; a station with neither is not judged. Attributed to the position the person
 * held at completion time; with no position held it is not a skill observation.
 */
export function closeOnTimeObservations(input: {
  completions: readonly ClosingCompletion[];
  instanceDay: ReadonlyMap<string, string>;
  lineStation: ReadonlyMap<string, string>;
  stations: readonly ClosingStationFact[];
  /** `${stationId}/${day}` → the station's observed closure (0230). */
  closures: ReadonlyMap<string, string>;
  intervals: readonly PositionInterval[];
}, t: SkillTunables): PersonObservation[] {
  const stationByName = new Map(input.stations.map((s) => [s.name.trim(), s] as const));
  const out: PersonObservation[] = [];
  for (const c of input.completions) {
    if (!c.completedBy) continue;
    const day = input.instanceDay.get(c.instanceId);
    const stationName = input.lineStation.get(c.templateItemId)?.trim();
    const station = stationName ? stationByName.get(stationName) : undefined;
    if (!day || !station) continue;
    let deadline: number | null = null;
    if (station.usuallyClosesAt) {
      const iso = etWallClockToUtcIso(day, station.usuallyClosesAt);
      if (iso) deadline = Date.parse(iso) + t.closeGraceMinutes * 60_000;
    } else {
      const closed = input.closures.get(`${station.id}/${day}`);
      if (closed) deadline = Date.parse(closed);
    }
    const at = Date.parse(c.completedAt);
    if (deadline === null || !Number.isFinite(deadline) || !Number.isFinite(at)) continue;
    const held = positionAt(input.intervals, c.completedBy, c.completedAt);
    if (!held?.positionId) continue;
    out.push({ userId: c.completedBy, positionId: held.positionId, day, kind: "closeOnTime", value: at <= deadline ? 1 : 0, weight: 1, sourceId: c.id });
  }
  return out;
}

/**
 * Prep yield: ONE observation per PRODUCTION ROW in the `YieldBatch` shape (r1 P2-6; `sourceId` =
 * `productions.id`, `day` = the ET business day of `produced_at`). Attributed to the position the maker
 * held at `produced_at`, else to the shop's `prep_position_id`, else to "unplaced" (evidence only, no
 * skill). value = 1 when |came_out_to / batches_made − yield_at_time| / yield_at_time ≤ yieldTolerance
 * (`batchSignedDrift`, the 0218 math). Rows with no maker are counted, never attributed.
 */
export function prepYieldObservations(
  batches: readonly YieldBatch[], intervals: readonly PositionInterval[], prepPositionId: string | null,
  t: SkillTunables, dayOf: (iso: string) => string,
): { observations: PersonObservation[]; noMaker: number; unplaced: Map<string, number> } {
  const observations: PersonObservation[] = [];
  const unplaced = new Map<string, number>();
  let noMaker = 0;
  for (const b of batches) {
    if (!isUsableBatch(b)) continue;
    if (!b.madeBy) { noMaker++; continue; }
    const positionId = positionAt(intervals, b.madeBy, b.producedAt)?.positionId ?? prepPositionId;
    if (!positionId) { unplaced.set(b.madeBy, (unplaced.get(b.madeBy) ?? 0) + 1); continue; }
    const onTarget = Math.abs(batchSignedDrift(b)) <= t.yieldTolerance + 1e-9;
    observations.push({ userId: b.madeBy, positionId, day: dayOf(b.producedAt), kind: "prepYield", value: onTarget ? 1 : 0, weight: 1, sourceId: b.id });
  }
  return { observations, noMaker, unplaced };
}

export type PmGrade = "great" | "good" | "needs_work";
export interface PmPositionGrade {
  /** The live grade row id. */
  id: string; day: string; subjectId: string; positionId: string; grade: PmGrade;
  /** The grading copy's observed minutes of that person at that position (Task 19). */
  observedMinutes: number;
}

/**
 * PM grades → observations: one per live grade of a SUBMITTED v2 day (the caller passes only those),
 * weighted by observed minutes. Two managers grading the same day still add ONE quality day. Phase 1
 * loads none until Task 23 wires the 0271 grades; PM v1 grades have no position and never enter (J6).
 */
export function pmObservations(grades: readonly PmPositionGrade[], t: SkillTunables): PersonObservation[] {
  return grades.map((g) => ({
    userId: g.subjectId, positionId: g.positionId, day: g.day, kind: "pm" as const,
    value: t.gradeValue[g.grade], weight: g.observedMinutes, sourceId: g.id,
  }));
}

/** One person's signals at one position, from the builders' output. */
export function signalsFor(
  userId: string, positionId: string, asOf: string,
  worked: ReadonlyMap<string, readonly WorkedDay[]>, observations: readonly PersonObservation[],
): PositionSignals {
  return {
    positionId, asOf,
    worked: (worked.get(userId) ?? []).filter((w) => w.positionId === positionId),
    observations: observations.filter((o) => o.userId === userId && o.positionId === positionId),
  };
}

// ─── the write rules (pure; the lib checks them before any I/O, the 0270 RPCs again) ──

/** The closed reason list (0270 CHECK). 'other' needs a note. */
export const SKILL_REASON_CODES = ["observed_on_floor", "training_completed", "correction", "other"] as const;
export type SkillReasonCode = (typeof SKILL_REASON_CODES)[number];
export const SKILL_ADJUSTMENT_STEP = 0.05;
export const SKILL_ADJUSTMENT_LIMIT = 0.3;
export const SKILL_NOTE_MAX = 500;

/** A finite multiple of 0.05 (to the cent), within the range. */
function onStep(v: unknown, lo: number, hi: number): v is number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo - 1e-9 || v > hi + 1e-9) return false;
  const cents = Math.round(v * 100);
  return Math.abs(v * 100 - cents) < 1e-6 && cents % 5 === 0;
}
/**
 * THE CONTROL'S STEPPER (CC ruling 2 on chunk E): the adjust and rate controls offer ONLY values the RPC
 * accepts. `snapSkillStep` puts any start on the 0.05 grid inside [min, max] (an off-grid or non-finite
 * start can never be sent), and `stepSkillControl` moves one step and clamps. Every value they return
 * passes `validAdjustmentDelta` (±0.30) or `validSkillRating` (0..1) for those ranges.
 */
export function snapSkillStep(v: number, min: number, max: number): number {
  const lo = Math.ceil(Math.round(min * 100) / 5) * 5;
  const hi = Math.floor(Math.round(max * 100) / 5) * 5;
  const c = Number.isFinite(v) ? Math.round((v * 100) / 5) * 5 : 0;
  return Math.min(hi, Math.max(lo, c)) / 100;
}
export function stepSkillControl(current: number, dir: 1 | -1, min: number, max: number): number {
  return snapSkillStep(snapSkillStep(current, min, max) + dir * SKILL_ADJUSTMENT_STEP, min, max);
}
/** ±0.30 in 0.05 steps (the mockup's control). */
export function validAdjustmentDelta(v: unknown): v is number {
  return onStep(v, -SKILL_ADJUSTMENT_LIMIT, SKILL_ADJUSTMENT_LIMIT);
}
/** The new-hire rating: 0..1 in 0.05 steps (one scale everywhere, J5). */
export function validSkillRating(v: unknown): v is number {
  return onStep(v, 0, 1);
}
/** The value sent to SQL: exactly two decimals, so 0.1 + 0.2 never reaches numeric as 0.30000000000000004. */
export function toCents(v: number): number {
  return Math.round(v * 100) / 100;
}
/** The reason rule: a closed code; 'other' needs a non-blank note; a note ≤ 500 characters. */
export function skillReasonValid(code: unknown, note: unknown): boolean {
  if (typeof code !== "string" || !(SKILL_REASON_CODES as readonly string[]).includes(code)) return false;
  if (note !== null && note !== undefined && (typeof note !== "string" || note.length > SKILL_NOTE_MAX)) return false;
  if (code === "other" && !(typeof note === "string" && /\S/.test(note))) return false;
  return true;
}
