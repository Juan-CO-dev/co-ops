/**
 * THE CURVE → SHAPE TRANSFORM AND THE NEED GRID — pure (Scheduling Phase 2, generator step 3a and step
 * 4; r2 P2-4, rewritten r3, r4 zero demand).
 *
 * `shapeFromCurve` turns the day's hourly forecast into line heads per quarter:
 *   - hour → quarter is a STEP (each quarter takes its hour's demand; a peak lands on 12:00 or 13:00);
 *   - c_q = W_q × d_h / d̄ and heads_q = clamp(round_half_up(c_q / Σc × T / 0.25), minHeads, maxHeads),
 *     computed in EXACT integers (d̄ cancels: heads_q = rhu(W_q d_h ΣW / Σ W d)), so a tie is a true .5
 *     and rounds up per quarter, and a flat curve reproduces the waves W exactly;
 *   - r4: an all-zero forecast over the open hours → the floor (`zero_demand`); a zero weighted sum with
 *     demand elsewhere → an even split of ΣW over the open quarters (`zero_profile`). Finite, never throws.
 *   - `rushShiftMaxQ` is DISPLAY ONLY: a rush moved further than it from its configured time is flagged.
 *
 * `needGrid` holds, per position id × quarter, the required heads: the shaped line heads split min-first
 * (the floor), then primaries before secondaries (id order), each capped at its head limit, before
 * service close; the closing crew (register, the walk pair primary-first) in [service close, scheduled
 * out); the BOH crew (Prep until `prepUntil`, Prep/Dishwasher all day; from prep start when it is the
 * primary of a pair with Prep); and the catering prep rule's extra Prep/Dishwasher heads. Every number
 * traces to a source run (the provenance the r4 snapshot persists).
 */
import type { DayNeed, NeedRun, NeedSource, ShapeNote } from "./context-shared";
import {
  isLineRole, isSecondary, lineBounds, positionIds, positionLimit, walkClosers, waveProfile, type CrewType, type ScheduleStructure,
} from "./structure-shared";
import { Q_PER_DAY } from "./time-shared";

/** round_half_up(n / d) for integers n ≥ 0, d > 0 — exact. */
export function roundHalfUp(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

export interface ShapeInput {
  /** 24 hourly cents (`DemandResult.ok`), or null when demand is `no_history` (a flat curve). */
  hourlyCents: number[] | null;
  demandKind: "ok" | "no_history";
  wave: number[];
  minHeads: number[];
  maxHeads: number[];
  /** Display only: the configured rush time and how far it may move before the reason flags it. */
  rush?: { atQ: number; maxShiftQ: number };
}

export interface ShapeResult {
  heads: number[];
  note: ShapeNote;
  /** The target T = ΣW / 4 and what the shape actually staffs (the clamp can move it; the reason shows it). */
  targetHours: number;
  lineHours: number;
  /** Where line heads rise: a wave arrives. */
  arrivals: Array<{ q: number; heads: number }>;
  /** The earliest quarter the line reaches its peak, arriving there; null for an empty line. */
  rushQ: number | null;
  rushMoved: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function shapeFromCurve(input: ShapeInput): ShapeResult {
  const { wave, minHeads, maxHeads } = input;
  const heads = new Array<number>(Q_PER_DAY).fill(0);
  const open: number[] = [];
  for (let q = 0; q < Q_PER_DAY; q++) if ((maxHeads[q] ?? 0) > 0) open.push(q);
  const sumW = open.reduce((n, q) => n + (wave[q] ?? 0), 0);
  const d = (q: number) => (input.demandKind === "ok" && input.hourlyCents ? Math.max(0, input.hourlyCents[Math.floor(q / 4)] ?? 0) : 1);
  const openHours = [...new Set(open.map((q) => Math.floor(q / 4)))];
  const demandOpen = openHours.reduce((n, h) => n + d(h * 4), 0);
  let note: ShapeNote = "normal";
  if (open.length > 0 && demandOpen === 0) {
    note = "zero_demand";
    for (const q of open) heads[q] = clamp(minHeads[q] ?? 0, minHeads[q] ?? 0, maxHeads[q] ?? 0);
  } else if (open.length > 0) {
    const weighted = open.reduce((n, q) => n + (wave[q] ?? 0) * d(q), 0);
    if (weighted === 0) {
      note = "zero_profile";
      const even = roundHalfUp(sumW, open.length);
      for (const q of open) heads[q] = clamp(even, minHeads[q] ?? 0, maxHeads[q] ?? 0);
    } else {
      for (const q of open) heads[q] = clamp(roundHalfUp((wave[q] ?? 0) * d(q) * sumW, weighted), minHeads[q] ?? 0, maxHeads[q] ?? 0);
    }
  }
  const arrivals: Array<{ q: number; heads: number }> = [];
  for (let q = 0; q < Q_PER_DAY; q++) {
    const rise = heads[q]! - (q > 0 ? heads[q - 1]! : 0);
    if (rise > 0) arrivals.push({ q, heads: rise });
  }
  const peak = Math.max(...heads);
  let rushQ: number | null = null;
  if (peak > 0) for (let q = 0; q < Q_PER_DAY; q++) if (heads[q] === peak && (q === 0 || heads[q - 1]! < peak)) { rushQ = q; break; }
  const rushMoved = !!input.rush && rushQ !== null && Math.abs(rushQ - input.rush.atQ) > input.rush.maxShiftQ;
  return { heads, note, targetHours: sumW / 4, lineHours: heads.reduce((a, b) => a + b, 0) / 4, arrivals, rushQ, rushMoved };
}

export interface NeedCatering { id: string; headcount: number; eventQ: number | null }

/** Runs of one array as (from, to, heads) — the provenance rows. */
function runs(positionId: string, arr: number[], source: NeedSource): NeedRun[] {
  const out: NeedRun[] = [];
  for (let q = 0; q < Q_PER_DAY; q++) {
    const v = arr[q] ?? 0;
    if (v <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.toQ === q && last.heads === v) last.toQ = q + 1;
    else out.push({ positionId, fromQ: q, toQ: q + 1, heads: v, source });
  }
  return out;
}

export interface NeedGridInput {
  structure: ScheduleStructure;
  dayType: CrewType;
  scheduledOutQ: number;
  /** The shaped line heads (shapeFromCurve's `heads`). */
  lineHeads: number[];
  shapeNote: ShapeNote;
  catering: readonly NeedCatering[];
}

export function needGrid(input: NeedGridInput): DayNeed {
  const s = input.structure;
  const crew = s.crews[input.dayType];
  const { prepStartQ, prepDishArrivalQ, serviceCloseQ } = s.shopDay;
  const out = input.scheduledOutQ;
  const ids = positionIds(s);
  const parts = new Map<string, Record<NeedSource, number[]>>();
  const part = (id: string, src: NeedSource) => {
    let p = parts.get(id);
    if (!p) {
      const z = () => new Array<number>(Q_PER_DAY).fill(0);
      p = { shape: z(), closing_crew: z(), boh_crew: z(), catering: z(), head_limit: z() };
      parts.set(id, p);
    }
    return p[src];
  };
  const limitAt = (id: string, q: number) => (q < out ? positionLimit(s.positions[id]!, q) : 0);
  const lineIds = ids.filter((id) => isLineRole(s.positions[id]!.role));
  const order = [...lineIds.filter((id) => !isSecondary(s, id)), ...lineIds.filter((id) => isSecondary(s, id))];
  const { minHeads, maxHeads } = lineBounds(s, input.dayType);
  const lineTotal = new Array<number>(Q_PER_DAY).fill(0);

  // The line during service: the shaped heads, the floor first, then primaries before secondaries.
  for (let q = 0; q < Math.min(serviceCloseQ, out); q++) {
    let left = input.lineHeads[q] ?? 0;
    const given = new Map<string, number>();
    for (const id of order) {
      const lim = limitAt(id, q);
      const floor = Math.min(lim, crew.lineMinHeads[id] ?? 0, left);
      given.set(id, floor);
      left -= floor;
    }
    while (left > 0) {
      let placed = false;
      for (const id of order) {
        if (left > 0 && given.get(id)! < limitAt(id, q)) { given.set(id, given.get(id)! + 1); left--; placed = true; }
      }
      if (!placed) break;
    }
    for (const id of order) part(id, "shape")[q] = given.get(id)!;
  }

  // The closing crew in [service close, scheduled out): register; the walk pair, its primary first.
  const { primary: walkPrimary, others: walkOthers } = walkClosers(s);
  for (let q = serviceCloseQ; q < out; q++) {
    for (const id of lineIds) {
      const role = s.positions[id]!.role;
      let n = 0;
      if (role === "register") n = crew.close.registerHeads;
      else if (id === walkPrimary) n = Math.min(1, crew.close.walkHeads);
      else if (walkOthers[0] === id) n = Math.max(0, crew.close.walkHeads - 1);
      part(id, "closing_crew")[q] = Math.min(n, limitAt(id, q));
    }
  }

  // BOH: Prep until prepUntil; Prep/Dishwasher all day (from prep start when it leads a pair with Prep).
  for (const id of ids) {
    const p = s.positions[id]!;
    if (p.role === "prep") {
      for (let q = Math.max(prepStartQ, p.openQ); q < Math.min(crew.prepUntilQ, p.closeQ, out); q++) part(id, "boh_crew")[q] = Math.min(crew.prepHeads, limitAt(id, q));
    }
    if (p.role === "prep_dish") {
      const leadsPrep = s.priority.some((x) => x.primary === id && x.pair.some((o) => o !== id && s.positions[o]?.role === "prep"));
      const start = Math.max(leadsPrep ? prepStartQ : prepDishArrivalQ, p.openQ);
      for (let q = start; q < Math.min(p.closeQ, out); q++) {
        if (q < serviceCloseQ) part(id, "boh_crew")[q] = Math.min(crew.prepDishHeads, limitAt(id, q));
        else part(id, "closing_crew")[q] = Math.min(crew.close.prepDishHeads, limitAt(id, q));
      }
    }
  }

  // The catering prep rule: extra Prep/Dishwasher heads in [event − lead, event), or the default window.
  const dish = ids.find((id) => s.positions[id]!.role === "prep_dish");
  if (dish) {
    for (const ev of [...input.catering].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (ev.headcount < s.catering.minHeadcount || s.catering.extraPrepDishHeads <= 0) continue;
      const from = ev.eventQ === null ? s.catering.defaultStartQ : Math.max(0, ev.eventQ - s.catering.leadMinutes / 15);
      const to = ev.eventQ === null ? s.catering.defaultEndQ : ev.eventQ;
      for (let q = from; q < to; q++) {
        const used = (["boh_crew", "closing_crew", "catering"] as const).reduce((n, src) => n + part(dish, src)[q]!, 0);
        part(dish, "catering")[q]! += Math.max(0, Math.min(s.catering.extraPrepDishHeads, limitAt(dish, q) - used));
      }
    }
  }

  const positions: Record<string, number[]> = {};
  const sources: NeedRun[] = [];
  for (const id of ids) {
    const total = new Array<number>(Q_PER_DAY).fill(0);
    for (const src of ["shape", "closing_crew", "boh_crew", "catering"] as const) {
      const arr = part(id, src);
      for (let q = 0; q < Q_PER_DAY; q++) total[q]! += arr[q]!;
      sources.push(...runs(id, arr, src));
    }
    positions[id] = total;
    if (isLineRole(s.positions[id]!.role)) for (let q = 0; q < Q_PER_DAY; q++) lineTotal[q]! += total[q]!;
  }
  sources.sort((a, b) => (a.positionId < b.positionId ? -1 : a.positionId > b.positionId ? 1 : a.fromQ - b.fromQ || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)));
  return { positions, lineTotal, minHeads, maxHeads, sources, shapeNote: input.shapeNote };
}

/**
 * The line's shaping inputs for a day: W, the floor and the capacity over the SERVICE period
 * (before service close and scheduled out); the closing window is the closing crew's.
 */
export function serviceLineInputs(s: ScheduleStructure, dayType: CrewType, scheduledOutQ: number) {
  const end = Math.min(s.shopDay.serviceCloseQ, scheduledOutQ);
  const cut = (a: number[]) => a.map((v, q) => (q < end ? v : 0));
  const { minHeads, maxHeads } = lineBounds(s, dayType);
  return { wave: cut(waveProfile(s, dayType)), minHeads: cut(minHeads), maxHeads: cut(maxHeads) };
}

/** Shape + grid for one day: what Task 7's builder and the snapshot use. */
export function buildDayNeed(input: {
  structure: ScheduleStructure; dayType: CrewType; scheduledOutQ: number; hourlyCents: number[] | null; demandKind: "ok" | "no_history"; catering: readonly NeedCatering[];
}): { need: DayNeed; shape: ShapeResult } {
  const li = serviceLineInputs(input.structure, input.dayType, input.scheduledOutQ);
  const shape = shapeFromCurve({
    hourlyCents: input.hourlyCents, demandKind: input.demandKind, ...li,
    rush: { atQ: input.structure.crews[input.dayType].waves.rush.atQ, maxShiftQ: input.structure.limits.rushShiftMaxQ },
  });
  const need = needGrid({ structure: input.structure, dayType: input.dayType, scheduledOutQ: input.scheduledOutQ, lineHeads: shape.heads, shapeNote: shape.note, catering: input.catering });
  // The DayNeed's line bounds describe the service period the shape ran over.
  return { need: { ...need, minHeads: li.minHeads, maxHeads: li.maxHeads }, shape };
}
