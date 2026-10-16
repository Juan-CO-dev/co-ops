/**
 * "WHAT CHANGED" — a pure diff of two week snapshots (Scheduling Phase 2, Task 12; plan "What changed", spec §5.8 /
 * §6.1). It powers Regenerate, the horizon preview and the Wednesday draft: per day, people added / removed, shifts
 * moved (Δstart / Δend), segments relabelled, the Closing Manager changed, MoD gaps opened / closed, coverage-gap
 * hours ± by certificate cause, hourly hours ±, $ ± (money viewers only — the key is absent otherwise) and problems ±
 * split NEW vs INHERITED. Rendered as one summary line per week plus a default-collapsed per-day list (the
 * disclosure doctrine). Deterministic: days by date, changes in a fixed kind order, then user, then time.
 */
import type { NarrativeLine } from "@/lib/people-narrative";
import type { RulePerson } from "./context-shared";
import type { DayRecord, DeclaredGap, GapCause, RuleSeverity, Shift } from "./rules-shared";

export interface WeekSnapshot { shifts: Shift[]; gaps: DeclaredGap[]; days: DayRecord[] }

export type DayChange =
  | { kind: "person_added"; userId: string; startQ: number; endQ: number }
  | { kind: "person_removed"; userId: string; startQ: number; endQ: number }
  | { kind: "shift_moved"; userId: string; fromStartQ: number; fromEndQ: number; toStartQ: number; toEndQ: number; deltaStartQ: number; deltaEndQ: number }
  | { kind: "segments_relabelled"; userId: string; startQ: number; from: string[]; to: string[] }
  | { kind: "closing_manager_changed"; from: string | null; to: string | null }
  | { kind: "mod_gap_opened"; fromQ: number; toQ: number }
  | { kind: "mod_gap_closed"; fromQ: number; toQ: number }
  | { kind: "gap_hours"; cause: GapCause; deltaHours: number }
  | { kind: "hourly_hours"; deltaHours: number }
  | { kind: "cost"; deltaCents: number }
  | { kind: "problems"; severity: RuleSeverity; inherited: boolean; delta: number };

export const DAY_CHANGE_ORDER: ReadonlyArray<DayChange["kind"]> = [
  "person_added", "person_removed", "shift_moved", "segments_relabelled", "closing_manager_changed", "mod_gap_opened", "mod_gap_closed",
  "gap_hours", "hourly_hours", "cost", "problems",
];

export interface WeekDiffSummary {
  added: number;
  removed: number;
  moved: number;
  relabelled: number;
  closingManagerChanged: number;
  gapHoursDelta: number;
  hourlyHoursDelta: number;
  /** Present only for money viewers. */
  costDeltaCents?: number;
  newProblemsDelta: number;
  inheritedProblemsDelta: number;
}

export interface WeekDiff { summary: WeekDiffSummary; summaryLine: NarrativeLine; days: Array<{ date: string; changes: DayChange[] }> }

export interface DiffOpts {
  people: Record<string, Pick<RulePerson, "salaried" | "presenceOnly">>;
  canSeeMoney: boolean;
  wageCentsByUser?: Record<string, number | null>;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isHourly = (o: DiffOpts, userId: string) => { const p = o.people[userId]; return !!p && !p.salaried && !p.presenceOnly; };
const positionsOf = (sh: Shift) => sh.segments.map((g) => g.positionId);

function quarterSet(gaps: readonly DeclaredGap[], date: string): Set<number> {
  const s = new Set<number>();
  for (const g of gaps) if (g.date === date && g.code === "mod_missing") for (let q = g.fromQ; q < g.toQ; q++) s.add(q);
  return s;
}

function runs(qs: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const q of [...qs].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && last[1] === q) last[1] = q + 1;
    else out.push([q, q + 1]);
  }
  return out;
}

function hourlyQ(shifts: readonly Shift[], o: DiffOpts): number {
  return shifts.filter((sh) => isHourly(o, sh.userId)).reduce((n, sh) => n + (sh.endQ - sh.startQ), 0);
}

function costCents(shifts: readonly Shift[], o: DiffOpts): number | null {
  let c = 0;
  for (const sh of shifts) {
    if (!isHourly(o, sh.userId)) continue;
    const w = o.wageCentsByUser?.[sh.userId];
    if (w === null || w === undefined) return null;
    c += (w * (sh.endQ - sh.startQ)) / 4;
  }
  return Math.round(c);
}

function changeKey(c: DayChange): [number, string, number] {
  const user = "userId" in c ? c.userId : "cause" in c ? c.cause : "severity" in c ? `${c.severity}|${c.inherited ? 1 : 0}` : "";
  const q = "fromQ" in c ? c.fromQ : "startQ" in c ? c.startQ : "fromStartQ" in c ? c.fromStartQ : 0;
  return [DAY_CHANGE_ORDER.indexOf(c.kind), user, q];
}

/** The diff of one day. */
function diffDay(date: string, before: WeekSnapshot | null, after: WeekSnapshot, o: DiffOpts): DayChange[] {
  const out: DayChange[] = [];
  const b = (before?.shifts ?? []).filter((x) => x.date === date);
  const a = after.shifts.filter((x) => x.date === date);
  const users = [...new Set([...b, ...a].map((x) => x.userId))].sort(cmp);
  for (const u of users) {
    const bs = b.filter((x) => x.userId === u).sort((x, y) => x.startQ - y.startQ);
    const as = a.filter((x) => x.userId === u).sort((x, y) => x.startQ - y.startQ);
    const n = Math.max(bs.length, as.length);
    for (let i = 0; i < n; i++) {
      const x = bs[i];
      const y = as[i];
      if (!x && y) { out.push({ kind: "person_added", userId: u, startQ: y.startQ, endQ: y.endQ }); continue; }
      if (x && !y) { out.push({ kind: "person_removed", userId: u, startQ: x.startQ, endQ: x.endQ }); continue; }
      if (!x || !y) continue;
      if (x.startQ !== y.startQ || x.endQ !== y.endQ) {
        out.push({ kind: "shift_moved", userId: u, fromStartQ: x.startQ, fromEndQ: x.endQ, toStartQ: y.startQ, toEndQ: y.endQ, deltaStartQ: y.startQ - x.startQ, deltaEndQ: y.endQ - x.endQ });
      }
      const fp = positionsOf(x);
      const tp = positionsOf(y);
      const sameTimes = x.segments.length === y.segments.length && x.segments.every((g, k) => g.startQ - x.startQ === y.segments[k]!.startQ - y.startQ && g.endQ - g.startQ === y.segments[k]!.endQ - y.segments[k]!.startQ);
      if (fp.join("|") !== tp.join("|") || (!sameTimes && x.startQ === y.startQ && x.endQ === y.endQ)) out.push({ kind: "segments_relabelled", userId: u, startQ: y.startQ, from: fp, to: tp });
    }
  }
  const cmB = b.find((x) => x.closingManager)?.userId ?? null;
  const cmA = a.find((x) => x.closingManager)?.userId ?? null;
  if (cmB !== cmA) out.push({ kind: "closing_manager_changed", from: cmB, to: cmA });
  const mb = quarterSet(before?.gaps ?? [], date);
  const ma = quarterSet(after.gaps, date);
  for (const [fromQ, toQ] of runs([...ma].filter((q) => !mb.has(q)))) out.push({ kind: "mod_gap_opened", fromQ, toQ });
  for (const [fromQ, toQ] of runs([...mb].filter((q) => !ma.has(q)))) out.push({ kind: "mod_gap_closed", fromQ, toQ });
  const causeHours = (gs: readonly DeclaredGap[]) => {
    const m = new Map<GapCause, number>();
    for (const g of gs) if (g.date === date && g.code === "coverage_gap") m.set(g.cause, (m.get(g.cause) ?? 0) + (g.toQ - g.fromQ));
    return m;
  };
  const gb = causeHours(before?.gaps ?? []);
  const ga = causeHours(after.gaps);
  for (const cause of [...new Set([...gb.keys(), ...ga.keys()])].sort(cmp)) {
    const d = ((ga.get(cause) ?? 0) - (gb.get(cause) ?? 0)) / 4;
    if (d !== 0) out.push({ kind: "gap_hours", cause, deltaHours: d });
  }
  const dh = (hourlyQ(a, o) - hourlyQ(b, o)) / 4;
  if (dh !== 0) out.push({ kind: "hourly_hours", deltaHours: dh });
  if (o.canSeeMoney) {
    const cb = costCents(b, o);
    const ca = costCents(a, o);
    if (cb !== null && ca !== null && ca !== cb) out.push({ kind: "cost", deltaCents: ca - cb });
  }
  const probs = (snap: WeekSnapshot | null) => {
    const m = new Map<string, number>();
    for (const p of snap?.days.find((d) => d.date === date)?.problems ?? []) m.set(`${p.severity}|${p.inherited ? 1 : 0}`, (m.get(`${p.severity}|${p.inherited ? 1 : 0}`) ?? 0) + 1);
    return m;
  };
  const pb = probs(before);
  const pa = probs(after);
  for (const key of [...new Set([...pb.keys(), ...pa.keys()])].sort(cmp)) {
    const delta = (pa.get(key) ?? 0) - (pb.get(key) ?? 0);
    if (delta === 0) continue;
    const [severity, inh] = key.split("|") as [RuleSeverity, string];
    out.push({ kind: "problems", severity, inherited: inh === "1", delta });
  }
  return out.sort((x, y) => {
    const [kx, ux, qx] = changeKey(x);
    const [ky, uy, qy] = changeKey(y);
    return kx - ky || cmp(ux, uy) || qx - qy;
  });
}

/** The diff of two snapshots of one week (`before` null = a brand-new week). */
export function diffWeeks(before: WeekSnapshot | null, after: WeekSnapshot, o: DiffOpts): WeekDiff {
  const dates = [...new Set([...(before?.shifts ?? []), ...after.shifts].map((x) => x.date)
    .concat((before?.gaps ?? []).map((g) => g.date), after.gaps.map((g) => g.date), (before?.days ?? []).map((d) => d.date), after.days.map((d) => d.date)))].sort(cmp);
  const days = dates.map((date) => ({ date, changes: diffDay(date, before, after, o) })).filter((d) => d.changes.length > 0);
  const all = days.flatMap((d) => d.changes);
  const count = (k: DayChange["kind"]) => all.filter((c) => c.kind === k).length;
  const sum = <K extends DayChange["kind"]>(k: K, f: (c: Extract<DayChange, { kind: K }>) => number) => all.filter((c): c is Extract<DayChange, { kind: K }> => c.kind === k).reduce((n, c) => n + f(c), 0);
  const summary: WeekDiffSummary = {
    added: count("person_added"), removed: count("person_removed"), moved: count("shift_moved"), relabelled: count("segments_relabelled"),
    closingManagerChanged: count("closing_manager_changed"),
    gapHoursDelta: sum("gap_hours", (c) => c.deltaHours), hourlyHoursDelta: sum("hourly_hours", (c) => c.deltaHours),
    newProblemsDelta: sum("problems", (c) => (c.inherited ? 0 : c.delta)), inheritedProblemsDelta: sum("problems", (c) => (c.inherited ? c.delta : 0)),
  };
  if (o.canSeeMoney) summary.costDeltaCents = sum("cost", (c) => c.deltaCents);
  const params: Record<string, number> = {
    days: days.length, added: summary.added, removed: summary.removed, moved: summary.moved, relabelled: summary.relabelled,
    closingManagerChanged: summary.closingManagerChanged, gapHoursDelta: summary.gapHoursDelta, hourlyHoursDelta: summary.hourlyHoursDelta,
  };
  if (o.canSeeMoney) params.costDeltaCents = summary.costDeltaCents!;
  const summaryLine: NarrativeLine = days.length === 0 ? { key: "schedule.diff.no_change" } : { key: "schedule.diff.summary", params };
  return { summary, summaryLine, days };
}
