/**
 * PM REPORTS v2 — the PURE rules (client-safe, zero I/O). Scheduling Phase 1, Task 19.
 *
 * Each manager on shift fills in their OWN copy of the day's report; nobody sees another copy until the
 * closing manager submits (blind by design, so the average is independent). After submit:
 *   - grades are AVERAGED per person × position × criterion, WEIGHTED by the minutes that manager actually
 *     observed that person at that position (the overlap of the manager's "time on the floor" with the
 *     person's position intervals); "Didn't see" (a null grade) is excluded; when every weight is 0 the
 *     average falls back to equal weights and says so;
 *   - write-ins (free text) are surfaced attributed, and RECURRING THEMES are pulled forward: a term that
 *     comes back from ≥ 2 managers or on ≥ 3 days for one person × position (en + es stopwords, light
 *     stemming, accents folded). Free text stays with managers (R9): the subject never sees it.
 *
 * r1 P1-1: `gradeTargetProblem` is the lib twin of the 0271 RPC checks 5–8 and returns the SAME codes (one
 * shared case file pins both: tests/fixtures/pm-grade-target-cases.json), so the form only ever offers
 * valid targets. r1 P2-9: the copy form's state comes from the ONE lifecycle table (PM_COPY_TRANSITIONS).
 */
import {
  PM_COPY_TRANSITIONS, canReadPmCopy, canSubmitPmDay, pmDaySubmitted, type PeopleActor, type PmCopyRef, type PmCopyRefusal,
  type PmDayRef,
} from "@/lib/people/access-shared";
import { positionsWorked, type PositionInterval } from "@/lib/people/positions-shared";
import { etClockTime, etWallClockToUtcIso, etYmdMinusDays } from "@/lib/operational-day";

export type PmGrade = "great" | "good" | "needs_work";
export const PM_GRADES: readonly PmGrade[] = ["great", "good", "needs_work"];
/** The display scale for managers ("Great 2.6"). Skills use their own tunable `gradeValue`. */
export const PM_GRADE_VALUE = { great: 3, good: 2, needs_work: 1 } as const;

/** Every refusal the PM v2 lib and RPCs can name, with its HTTP status. */
export const PM_V2_ERROR_STATUS = {
  forbidden: 403, not_copy_author: 403, not_found: 404, invalid_payload: 400, invalid_note: 400, invalid_reason: 400,
  invalid_window: 400, window_required: 409, format_mismatch: 409, pm_v2_unavailable: 409, report_already_submitted: 409,
  copy_done: 409, copy_sealed: 409, copy_not_done: 409, subject_unavailable: 422, position_not_at_shop: 422,
  position_retired: 422, position_not_worked: 422, criterion_mismatch: 422, write_failed: 500,
} as const;
export type PmV2ErrorCode = keyof typeof PM_V2_ERROR_STATUS;
export const PM_V2_ERROR_CODES = Object.keys(PM_V2_ERROR_STATUS) as PmV2ErrorCode[];

/** The pure lifecycle refusal → the code the RPC raises for the same state. */
export function pmRefusalCode(r: PmCopyRefusal): PmV2ErrorCode {
  if (r === "not_author") return "not_copy_author";
  if (r === "day_closed") return "report_already_submitted";
  return r;
}

// ─── observation and the weighted average ────────────────────────────────────

export interface CopyObservation { copyId: string; authorId: string; from: string | null; to: string | null }

function ms(iso: string): number { return Date.parse(iso); }
function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const from = Math.max(aStart, bStart);
  const to = Math.min(aEnd, bEnd);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? to - from : 0;
}

/**
 * Minutes manager m observed person p at position s = the overlap of m's window with p's intervals at s
 * that day (closed intervals only). A manager-ADDED position, and the null bucket ("no position
 * recorded"), count the overlap with the person's whole day presence — or the whole window when the
 * person has no recorded interval at all. No window (or an open one) observes nothing. Whole minutes.
 */
export function observationMinutes(
  copy: CopyObservation, intervals: readonly PositionInterval[], subjectId: string, positionId: string | null,
  opts: { added?: boolean } = {},
): number {
  if (!copy.from || !copy.to) return 0;
  const wStart = ms(copy.from);
  const wEnd = ms(copy.to);
  if (!Number.isFinite(wStart) || !Number.isFinite(wEnd) || wEnd <= wStart) return 0;
  const mine = intervals.filter((i) => i.userId === subjectId && i.end !== null);
  const presence = positionId === null || opts.added === true;
  const counted = presence ? mine : mine.filter((i) => i.positionId === positionId);
  if (presence && mine.length === 0) return Math.round((wEnd - wStart) / 60_000);
  let total = 0;
  for (const i of counted) total += overlapMs(wStart, wEnd, ms(i.start), ms(i.end as string));
  return Math.round(total / 60_000);
}

export interface LiveGrade {
  copyId: string; authorId: string; subjectId: string; positionId: string | null; criterionId: string; grade: PmGrade | null;
}
export function weightKey(copyId: string, subjectId: string, positionId: string | null): string {
  return `${copyId}|${subjectId}|${positionId ?? ""}`;
}
export interface AveragedCell {
  subjectId: string; positionId: string | null; criterionId: string;
  /** On the 1..3 scale; null when nobody observed it (every grade "Didn't see"). */
  average: number | null;
  notObserved: number;
  weights: "observed" | "equal_fallback";
  contributions: Array<{ copyId: string; authorId: string; grade: PmGrade | null; minutes: number }>;
}

/** Weighted average per (subject, position, criterion). Deterministic: cells and contributions sorted. */
export function averageGrades(grades: readonly LiveGrade[], weights: ReadonlyMap<string, number>): AveragedCell[] {
  const cells = new Map<string, AveragedCell>();
  for (const g of grades) {
    const key = `${g.subjectId}|${g.positionId ?? ""}|${g.criterionId}`;
    const cell = cells.get(key) ?? { subjectId: g.subjectId, positionId: g.positionId, criterionId: g.criterionId, average: null, notObserved: 0, weights: "observed", contributions: [] };
    const w = weights.get(weightKey(g.copyId, g.subjectId, g.positionId));
    cell.contributions.push({ copyId: g.copyId, authorId: g.authorId, grade: g.grade, minutes: typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 0 });
    cells.set(key, cell);
  }
  for (const cell of cells.values()) {
    cell.contributions.sort((a, b) => a.authorId.localeCompare(b.authorId) || a.copyId.localeCompare(b.copyId));
    const graded = cell.contributions.filter((c) => c.grade !== null);
    cell.notObserved = cell.contributions.length - graded.length;
    if (graded.length === 0) continue;
    const sumW = graded.reduce((s, c) => s + c.minutes, 0);
    if (sumW > 0) {
      cell.average = graded.reduce((s, c) => s + c.minutes * PM_GRADE_VALUE[c.grade as PmGrade], 0) / sumW;
    } else {
      cell.weights = "equal_fallback";
      cell.average = graded.reduce((s, c) => s + PM_GRADE_VALUE[c.grade as PmGrade], 0) / graded.length;
    }
  }
  return [...cells.values()].sort((a, b) => a.subjectId.localeCompare(b.subjectId)
    || (a.positionId ?? "").localeCompare(b.positionId ?? "") || a.criterionId.localeCompare(b.criterionId));
}

/** The subject's band (positive-only wording; never a number): great ≥ 2.5, good ≥ 1.75, else building. */
export type PmBand = "great" | "good" | "building";
export function gradeBand(average: number): PmBand {
  if (average >= 2.5) return "great";
  if (average >= 1.75) return "good";
  return "building";
}

// ─── write-ins and themes ────────────────────────────────────────────────────

export interface AttributedNote {
  noteId: string; authorId: string; authorName?: string | null; day: string; text: string; subjectId: string; positionId: string | null;
}
export interface Theme {
  term: string; stem: string; authors: number; days: number;
  sources: Array<{ noteId: string; authorId: string; authorName: string | null; day: string; text: string }>;
}

const STOPWORDS = new Set((
  "a an the and or but on in at to of for with was were is are be been being he she they them his her their it its this that these those " +
  "very really too so not no did do does done had has have as by from up out again just got get all also when while then than there here " +
  "we i you me my our your him us one some any more most much many can could would should will today shift " +
  "el la los las un una unos unas y o pero en con de del al a por para que se su sus es son fue era estaba estuvo muy mas no si lo le les " +
  "otra otro otras otros vez veces ya cuando como este esta estos estas eso esa ese hoy tambien hay mi tu nos le turno"
).split(" "));

function fold(word: string): string {
  return word.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}
/** Light stemming: strip a plural -s (never -ss), then a trailing -e — so box/boxes, table/tables, papel/papeles fold. */
export function themeStem(word: string): string {
  let w = fold(word);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith("e") && w.length > 3) w = w.slice(0, -1);
  return w;
}
function tokens(text: string): Array<{ stem: string; surface: string }> {
  const out: Array<{ stem: string; surface: string }> = [];
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || /^\p{N}+$/u.test(raw)) continue;
    const surface = fold(raw);
    if (STOPWORDS.has(surface)) continue;
    const stem = themeStem(raw);
    if (stem.length < 3 || STOPWORDS.has(stem)) continue;
    out.push({ stem, surface });
  }
  return out;
}

/**
 * Recurring terms across DISTINCT (day × author) for one subject × position. A theme needs ≥ minAuthors
 * authors OR ≥ minDays days; the top N by sources, then authors, then the stem. Sources are attributed and
 * sorted by day, author, note. Deterministic for any input order.
 */
export function writeInThemes(notes: readonly AttributedNote[], opts: { minAuthors: number; minDays: number; top: number }): Theme[] {
  const sorted = [...notes].sort((a, b) => a.day.localeCompare(b.day) || a.authorId.localeCompare(b.authorId) || a.noteId.localeCompare(b.noteId));
  const byStem = new Map<string, { sources: Map<string, AttributedNote>; authors: Set<string>; days: Set<string>; surfaces: Map<string, number> }>();
  for (const n of sorted) {
    const seen = new Set<string>();
    for (const t of tokens(n.text)) {
      const entry = byStem.get(t.stem) ?? { sources: new Map(), authors: new Set(), days: new Set(), surfaces: new Map() };
      entry.surfaces.set(t.surface, (entry.surfaces.get(t.surface) ?? 0) + 1);
      if (!seen.has(t.stem)) {
        seen.add(t.stem);
        const sourceKey = `${n.day}|${n.authorId}`;
        if (!entry.sources.has(sourceKey)) entry.sources.set(sourceKey, n);
        entry.authors.add(n.authorId);
        entry.days.add(n.day);
      }
      byStem.set(t.stem, entry);
    }
  }
  const themes: Theme[] = [];
  for (const [stem, e] of byStem) {
    if (e.authors.size < opts.minAuthors && e.days.size < opts.minDays) continue;
    const term = [...e.surfaces.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0]![0];
    themes.push({
      term, stem, authors: e.authors.size, days: e.days.size,
      sources: [...e.sources.values()].map((n) => ({ noteId: n.noteId, authorId: n.authorId, authorName: n.authorName ?? null, day: n.day, text: n.text })),
    });
  }
  return themes
    .sort((a, b) => b.sources.length - a.sources.length || b.authors - a.authors || a.stem.localeCompare(b.stem))
    .slice(0, Math.max(0, opts.top));
}

// ─── who sees what ───────────────────────────────────────────────────────────

/**
 * What this actor may see of this copy. Before submit: its author sees it (author_only); any other
 * manager who could keep a copy sees COUNTS only (MoO and Owner included); everyone else nothing. After
 * submit: the full copy for whoever `canReadPmCopy` allows (authors, GM / Op-6 of the shop, MoO+).
 */
export function copyVisibility(actor: PeopleActor, copy: PmCopyRef, day: PmDayRef): "author_only" | "day_open_counts_only" | "day_submitted_full" | "none" {
  if (copy.locationId !== day.locationId) return "none";
  if (!pmDaySubmitted(day.status)) {
    if (copy.authorId === actor.userId) return "author_only";
    return canSubmitPmDay(actor) ? "day_open_counts_only" : "none";
  }
  return canReadPmCopy(actor, copy, day) ? "day_submitted_full" : "none";
}

/** The copy form's state, from the ONE lifecycle table: editable, read-only with Reopen, or sealed (results). */
export function copyFormState(copy: PmCopyRef, day: PmDayRef): "editable" | "done_readonly" | "sealed" {
  if (copy.status === "sealed" || pmDaySubmitted(day.status)) return "sealed";
  const write: readonly string[] = PM_COPY_TRANSITIONS.write.from;
  return write.includes(copy.status) ? "editable" : "done_readonly";
}

// ─── r1 P1-1: grade targets ──────────────────────────────────────────────────

export type GradeTargetProblem = "position_not_at_shop" | "position_retired" | "position_not_worked" | "criterion_mismatch";

/**
 * The lib twin of the RPC's checks 5–8, run before any write so the form only offers valid targets.
 * `position`: the station_positions row looked up by `positionId` (undefined = no such row). `criterion`:
 * the looked-up criterion (null = not found → criterion_mismatch); pass `undefined` for a NOTE, which has
 * no criterion (check 8 skipped). `addedByThisCopy`: positions THIS copy added for the subject (another
 * manager's addition never counts).
 */
export function gradeTargetProblem(t: {
  position: { id: string; locationId: string; active: boolean } | null | undefined;
  positionId: string | null;
  copyLocationId: string;
  workedPositionIds: ReadonlySet<string>;
  addedByThisCopy: ReadonlySet<string>;
  criterion?: { locationId: string; positionId: string | null; active: boolean } | null;
}): GradeTargetProblem | null {
  if (t.positionId !== null) {
    if (!t.position || t.position.id !== t.positionId || t.position.locationId !== t.copyLocationId) return "position_not_at_shop";
    if (!t.position.active) return "position_retired";
    if (!t.workedPositionIds.has(t.positionId) && !t.addedByThisCopy.has(t.positionId)) return "position_not_worked";
  }
  if (t.criterion === undefined) return null;
  const c = t.criterion;
  if (!c || c.locationId !== t.copyLocationId || !c.active) return "criterion_mismatch";
  if (c.positionId !== null && c.positionId !== t.positionId) return "criterion_mismatch";
  return null;
}

/** "Worked somewhere else?" — checks 5–6 only (adding a position the person did NOT tap into is its purpose). */
export function addedPositionProblem(position: { locationId: string; active: boolean } | null | undefined, copyLocationId: string): "position_not_at_shop" | "position_retired" | null {
  if (!position || position.locationId !== copyLocationId) return "position_not_at_shop";
  return position.active ? null : "position_retired";
}

// ─── the roster and the criteria for a copy ──────────────────────────────────

export interface AddedPosition { subjectId: string; positionId: string; byAuthorId: string; reason: string }
export interface RosterPosition { positionId: string | null; stationId: string | null; minutes: number; added?: { by: string; reason: string } }

/**
 * The people this copy can grade: the presence roster (in its order), each with the positions they held
 * today (closed intervals, first-held order, whole minutes) plus THIS copy's added positions. A person with
 * no recorded position gets one `positionId: null` row (shared criteria only).
 */
export function rosterForCopy(
  presenceRoster: ReadonlyArray<{ id: string; name: string }>, intervals: readonly PositionInterval[], addedPositions: readonly AddedPosition[],
): Array<{ subjectId: string; name: string; positions: RosterPosition[] }> {
  return presenceRoster.map((person) => {
    const worked = positionsWorked(intervals.filter((i) => i.userId === person.id), person.id);
    const positions: RosterPosition[] = worked.filter((w) => w.positionId !== null).map((w) => ({ positionId: w.positionId, stationId: w.stationId, minutes: w.minutes }));
    const unrecorded = worked.filter((w) => w.positionId === null).reduce((s, w) => s + w.minutes, 0);
    for (const a of addedPositions) {
      if (a.subjectId !== person.id || positions.some((p) => p.positionId === a.positionId)) continue;
      positions.push({ positionId: a.positionId, stationId: null, minutes: 0, added: { by: a.byAuthorId, reason: a.reason } });
    }
    if (positions.length === 0) positions.push({ positionId: null, stationId: null, minutes: unrecorded });
    return { subjectId: person.id, name: person.name, positions };
  });
}

export interface PmCriterionLike { id: string; positionId: string | null; label: string; sort: number; active: boolean }
/** The criteria graded at one position: its OWN (sort, then label) first, then the shared ones. Active only. */
export function criteriaForPosition<T extends PmCriterionLike>(criteria: readonly T[], positionId: string | null): T[] {
  const order = (a: T, b: T) => a.sort - b.sort || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  const own = positionId === null ? [] : criteria.filter((c) => c.active && c.positionId === positionId).sort(order);
  const shared = criteria.filter((c) => c.active && c.positionId === null).sort(order);
  return [...own, ...shared];
}

// ─── the form's window (ET wall times) ───────────────────────────────────────

/**
 * "My time on the floor" from the form's ET wall times ("HH:MM") on business day `date`: `from` on that day;
 * `to` on that day, or the NEXT day when it is not after `from` (a close after midnight). DST-correct through
 * `etWallClockToUtcIso`. Null on a malformed time. The 0271 RPC bounds both to [day start, +30 h].
 */
export function windowFromWallTimes(date: string, from: string, to: string | null): { from: string; to: string | null } | null {
  const f = etWallClockToUtcIso(date, from);
  if (!f) return null;
  if (to === null || to === "") return { from: f, to: null };
  let t = etWallClockToUtcIso(date, to);
  if (!t) return null;
  if (Date.parse(t) <= Date.parse(f)) t = etWallClockToUtcIso(etYmdMinusDays(date, -1), to);
  return t ? { from: f, to: t } : null;
}
/** An instant as the ET wall time "HH:MM" for a time input ("" when none). */
export function wallTimeOf(iso: string | null): string {
  return iso ? etClockTime(iso) : "";
}
