/**
 * EDIT OPERATIONS — pure (Scheduling Phase 2, Task 12; the mockup v17 `adjust` / `canSet` / `scaleSegments`).
 *
 * Every edit is on 15-minute snaps and is one of: `move` (the whole shift), `start` / `end` (the segments scale
 * proportionally, each ≥ `limits.segmentMinQ`), `divider` (the boundary between two segments), `addShift`,
 * `removeShift`, `setSegmentPosition`. Only STRUCTURAL failures are refused, by name: `edit_off_grid`,
 * `edit_overlap`, `edit_segments_malformed`, `edit_below_segment_min`, `day_locked` (a past day — an inherited
 * past day is never touched), `position_not_at_shop`, `person_not_at_shop`, `head_moved` (the shift is not there:
 * a stale board) and — CC chunk B ruling 3, HARD — `shift_over_maximum`. An edit that breaks a RULE is ALLOWED and
 * returns the new problems (spec §6.5), unlike the mockup, which silently rejects (J6).
 *
 * The edited day is re-validated under the CURRENT context (`ctx`, the live inputs for that date), its proven
 * deficits are re-declared with their certificates (an unprovable one stays an `undeclared_gap` the board shows),
 * and its day record's `originRevisionId` becomes the new revision. Every other day is untouched.
 */
import type { RuleContext } from "./context-shared";
import { ScheduleError, type ScheduleErrorCode } from "./errors-shared";
import { MOD, checkScheduleRules, proveGap, type DayRecord, type DeclaredGap, type GapCode, type RuleProblem, type Segment, type Shift, type WeekSchedule } from "./rules-shared";
import { Q_PER_DAY } from "./time-shared";

export interface ShiftRef { date: string; userId: string; startQ: number }

export type EditOp =
  | { kind: "move"; shift: ShiftRef; deltaQ: number }
  | { kind: "start"; shift: ShiftRef; toQ: number }
  | { kind: "end"; shift: ShiftRef; toQ: number }
  | { kind: "divider"; shift: ShiftRef; index: number; toQ: number }
  | { kind: "setSegmentPosition"; shift: ShiftRef; index: number; positionId: string }
  | { kind: "removeShift"; shift: ShiftRef }
  | { kind: "addShift"; date: string; userId: string; startQ: number; endQ: number; positionId: string };

const OP_KEYS: Readonly<Record<EditOp["kind"], readonly string[]>> = {
  move: ["kind", "shift", "deltaQ"], start: ["kind", "shift", "toQ"], end: ["kind", "shift", "toQ"], divider: ["kind", "shift", "index", "toQ"],
  setSegmentPosition: ["kind", "shift", "index", "positionId"], removeShift: ["kind", "shift"], addShift: ["kind", "date", "userId", "startQ", "endQ", "positionId"],
};
const INT = new Set(["deltaQ", "toQ", "index", "startQ", "endQ"]);
const STR = new Set(["date", "userId", "positionId"]);
const plainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]) => Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const fieldOk = (k: string, v: unknown) => (INT.has(k) ? Number.isInteger(v) : STR.has(k) ? typeof v === "string" && v.length > 0 : true);

/**
 * Astra chunk E P3-5: the EXACT discriminated union of an edit op — the kind's keys and no others, integers where a
 * quarter / index / delta goes, non-empty strings for ids and dates, and an exact `ShiftRef`. The route answers 400
 * `bad_request` before the lib; the lib refuses `invalid_payload` itself (defence in depth).
 */
export function isEditOp(v: unknown): v is EditOp {
  if (!plainObject(v) || typeof v.kind !== "string" || !Object.hasOwn(OP_KEYS, v.kind)) return false;
  const keys = OP_KEYS[v.kind as EditOp["kind"]];
  if (!exactKeys(v, keys)) return false;
  for (const k of keys) {
    if (k === "kind") continue;
    if (k === "shift") {
      const r = v.shift;
      if (!plainObject(r) || !exactKeys(r, ["date", "userId", "startQ"]) || !fieldOk("date", r.date) || !fieldOk("userId", r.userId) || !fieldOk("startQ", r.startQ)) return false;
      continue;
    }
    if (!fieldOk(k, v[k])) return false;
  }
  return true;
}

export interface EditResult { schedule: WeekSchedule; day: DayRecord; problems: RuleProblem[]; gaps: DeclaredGap[] }

const refuse = (code: ScheduleErrorCode, params: Record<string, string | number> = {}): never => { throw new ScheduleError(code, { params }); };
const onGrid = (q: number) => Number.isInteger(q) && q >= 0 && q <= Q_PER_DAY;
const cloneShift = (s: Shift): Shift => ({ ...s, segments: s.segments.map((g) => ({ ...g })) });
const sameRef = (s: Shift, r: ShiftRef) => s.date === r.date && s.userId === r.userId && s.startQ === r.startQ;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The mockup's `scaleSegments`, with the shop's segment minimum: each boundary moves proportionally to the new span,
 * every segment keeps at least `minQ`; the last segment ends exactly at the new end. Refused when the span cannot
 * hold every segment at its minimum.
 */
export function scaleSegments(parts: readonly Segment[], oldStart: number, oldEnd: number, start: number, end: number, minQ: number): Segment[] {
  if (end - start < parts.length * minQ) refuse("edit_below_segment_min", { minutes: minQ * 15 });
  let cursor = start;
  return parts.map((g, i) => {
    const remaining = parts.length - i - 1;
    const next = i === parts.length - 1 ? end
      : Math.max(cursor + minQ, Math.min(end - remaining * minQ, Math.round(start + ((g.endQ - oldStart) * (end - start)) / (oldEnd - oldStart))));
    const seg: Segment = { ...g, startQ: cursor, endQ: next };
    cursor = next;
    return seg;
  });
}

function validateShape(sh: Shift, minQ: number, maxQ: number): void {
  if (!onGrid(sh.startQ) || !onGrid(sh.endQ) || sh.segments.some((g) => !onGrid(g.startQ) || !onGrid(g.endQ))) refuse("edit_off_grid");
  const segs = sh.segments;
  if (segs.length === 0 || sh.startQ >= sh.endQ || segs[0]!.startQ !== sh.startQ || segs[segs.length - 1]!.endQ !== sh.endQ
    || segs.some((g, i) => g.startQ >= g.endQ || (i > 0 && segs[i - 1]!.endQ !== g.startQ))) refuse("edit_segments_malformed");
  if (segs.some((g) => g.endQ - g.startQ < minQ)) refuse("edit_below_segment_min", { minutes: minQ * 15 });
  if (sh.endQ - sh.startQ > maxQ) refuse("shift_over_maximum", { minutes: (sh.endQ - sh.startQ) * 15, maximumMinutes: maxQ * 15 });
}

/** Apply one edit. `ctx` is the CURRENT validation context (it must hold the edited date); `today` is the ET business date. */
export function applyEdit(schedule: WeekSchedule, op: EditOp, ctx: RuleContext, opts: { today: string; newRevisionId: string }): EditResult {
  const date = op.kind === "addShift" ? op.date : op.shift.date;
  if (date < opts.today) refuse("day_locked", { date });
  const dayCtx = ctx.days[date];
  if (!dayCtx) refuse("week_not_found", { date });
  const s = dayCtx!.structure;
  const minQ = s.limits.segmentMinQ;
  const maxQ = Math.round(s.limits.maxShiftH * 4);
  const known = (positionId: string) => positionId === MOD || !!s.positions[positionId];
  const shifts = schedule.shifts.map(cloneShift);
  let edited: Shift | null = null;
  let index = -1;
  if (op.kind !== "addShift") {
    index = shifts.findIndex((x) => sameRef(x, op.shift));
    if (index < 0) refuse("head_moved", { date });
    edited = shifts[index]!;
  }
  const sh = edited;
  switch (op.kind) {
    case "move": {
      if (!Number.isInteger(op.deltaQ)) refuse("edit_off_grid");
      sh!.startQ += op.deltaQ;
      sh!.endQ += op.deltaQ;
      for (const g of sh!.segments) { g.startQ += op.deltaQ; g.endQ += op.deltaQ; }
      break;
    }
    case "start":
    case "end": {
      if (!onGrid(op.toQ)) refuse("edit_off_grid");
      const start = op.kind === "start" ? op.toQ : sh!.startQ;
      const end = op.kind === "end" ? op.toQ : sh!.endQ;
      if (end <= start) refuse("edit_segments_malformed");
      sh!.segments = scaleSegments(sh!.segments, sh!.startQ, sh!.endQ, start, end, minQ);
      sh!.startQ = start;
      sh!.endQ = end;
      break;
    }
    case "divider": {
      if (!onGrid(op.toQ)) refuse("edit_off_grid");
      const a = sh!.segments[op.index - 1];
      const b = sh!.segments[op.index];
      if (!a || !b) refuse("edit_segments_malformed");
      a!.endQ = op.toQ;
      b!.startQ = op.toQ;
      break;
    }
    case "setSegmentPosition": {
      const g = sh!.segments[op.index];
      if (!g) refuse("edit_segments_malformed");
      if (!known(op.positionId)) refuse("position_not_at_shop");
      g!.positionId = op.positionId;
      break;
    }
    case "removeShift":
      shifts.splice(index, 1);
      break;
    case "addShift": {
      if (!onGrid(op.startQ) || !onGrid(op.endQ)) refuse("edit_off_grid");
      if (!ctx.people[op.userId]?.activeMember) refuse("person_not_at_shop");
      if (!known(op.positionId)) refuse("position_not_at_shop");
      edited = { userId: op.userId, date, startQ: op.startQ, endQ: op.endQ, segments: [{ positionId: op.positionId, startQ: op.startQ, endQ: op.endQ }], closingManager: false, flex: false, pinned: false };
      shifts.push(edited);
      break;
    }
  }
  if (edited && op.kind !== "removeShift") {
    validateShape(edited, minQ, maxQ);
    if (shifts.some((x) => x !== edited && x.date === date && x.userId === edited!.userId && x.startQ < edited!.endQ && x.endQ > edited!.startQ)) refuse("edit_overlap");
    // CC chunk C ruling 2: the daily maximum is per person per DATE — a second shift that day counts too (HARD).
    const dayQ = shifts.filter((x) => x.date === date && x.userId === edited!.userId).reduce((n, x) => n + (x.endQ - x.startQ), 0);
    if (dayQ > maxQ) refuse("shift_over_maximum", { minutes: dayQ * 15, maximumMinutes: maxQ * 15 });
  }
  shifts.sort((x, y) => cmp(x.date, y.date) || cmp(x.userId, y.userId) || x.startQ - y.startQ);

  // Re-validate the edited day under the CURRENT context; every other day is carried as it is (inherited view).
  const others: DayRecord[] = ctx.dates.filter((d) => d !== date).map((d) => schedule.days.find((r) => r.date === d)
    ?? { date: d, originRevisionId: null, structureVersionId: dayCtx!.structureVersionId, inherited: true, problems: [] }).map((r) => ({ ...r, inherited: true }));
  const vctx: RuleContext = { ...ctx, days: { [date]: dayCtx! } };
  const keptGaps = schedule.gaps.filter((g) => g.date !== date);
  const probe = { locationId: schedule.locationId, weekStart: schedule.weekStart, shifts, gaps: keptGaps, days: others };
  const gaps: DeclaredGap[] = [];
  // CC addendum A: a manager's edit — the station floor (32 h) warns, never blocks.
  for (const p of checkScheduleRules(probe, vctx, { managerEdited: true })) {
    if (p.code !== "undeclared_gap" || p.day !== date) continue;
    const subject = { code: p.params.gap as GapCode, date, positionId: p.positionId ?? null, fromQ: Number(p.params.fromQ), toQ: Number(p.params.toQ) };
    const proof = proveGap(subject, probe, vctx);
    if (proof) gaps.push({ ...subject, cause: proof.cause, certificate: proof.certificate } as DeclaredGap);
  }
  const allGaps = [...keptGaps, ...gaps].sort((a, b) => cmp(a.date, b.date) || cmp(a.code, b.code) || cmp(a.positionId ?? "", b.positionId ?? "") || a.fromQ - b.fromQ);
  const problems = checkScheduleRules({ ...probe, gaps: allGaps }, vctx, { managerEdited: true }).filter((p) => p.day === date && !p.inherited);
  const day: DayRecord = { date, originRevisionId: opts.newRevisionId, structureVersionId: dayCtx!.structureVersionId, inherited: false, problems };
  const days = ctx.dates.map((d) => (d === date ? day : schedule.days.find((r) => r.date === d))).filter((r): r is DayRecord => !!r);
  return { schedule: { ...schedule, shifts, gaps: allGaps, days }, day, problems, gaps };
}
