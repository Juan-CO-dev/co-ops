/**
 * TEMPLATES — the slots a day asks to be filled, in the mockup's order (Scheduling Phase 2, Task 6).
 *
 * The need grid (chunk A) already holds every required head per position × quarter with its provenance
 * (closing crew · BOH crew · catering · the SHAPED line heads, split floor-first then primaries before
 * secondaries). A template is one HEAD of one provenance run: the k-th layer of a position's heads for
 * one source, over a contiguous run. Order: the closing crew first (line positions in canonical line
 * order — primaries before secondaries — then BOH; the FIRST line closing template is the `closingLead`,
 * which an eligible closer must take), then the BOH crew, then catering prep, then the shaped line
 * arrivals. There is NO head-count fill (CC's W ruling): the need grid is the whole need. Kept / past
 * days produce no templates: they are inherited.
 *
 * `salariedBlocks` gives each GM / AGM not off a MoD block of max(minimum shift, role minimum), anchored
 * by their leader setting (opens / mix → the shop's prep start — the AGM at the Prep/Dishwasher arrival,
 * as in the mockup; closes → ending at the scheduled out), inside their assumed availability; a block that
 * cannot fit is skipped and reported.
 */
import type { DayNeed, NeedSource, RulePerson } from "../context-shared";
import { leaderSettingAllows, leaderSettingOf } from "../rules-shared";
import { isLineRole, lineOrder, positionIds, type ScheduleStructure } from "../structure-shared";
import { Q_PER_DAY } from "../time-shared";

export interface Template {
  positionId: string;
  fromQ: number;
  toQ: number;
  source: NeedSource;
  /** The closing crew is essential: budget-exempt, never reduced by a repair. */
  essential: boolean;
  /** The first line closing template: an eligible Closing Manager must take it. */
  closingLead: boolean;
}

const SOURCE_ORDER: readonly NeedSource[] = ["closing_crew", "boh_crew", "catering", "shape"];

/** Positions in template order: the line in canonical order, then every other (BOH) position by id. */
export function templateOrder(s: ScheduleStructure): string[] {
  const line = lineOrder(s);
  return [...line, ...positionIds(s).filter((id) => !isLineRole(s.positions[id]!.role))];
}

/** The k-th layer runs of a heads-per-quarter array: contiguous quarters where heads ≥ k. */
function layers(heads: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const max = Math.max(0, ...heads);
  for (let k = 1; k <= max; k++) {
    let start: number | null = null;
    for (let q = 0; q <= heads.length; q++) {
      const on = q < heads.length && (heads[q] ?? 0) >= k;
      if (on && start === null) start = q;
      if (!on && start !== null) { out.push([start, q]); start = null; }
    }
  }
  return out;
}

export function templatesFor(need: DayNeed, s: ScheduleStructure): Template[] {
  const out: Template[] = [];
  let leadTaken = false;
  for (const source of SOURCE_ORDER) {
    for (const positionId of templateOrder(s)) {
      const heads = new Array<number>(Q_PER_DAY).fill(0);
      for (const run of need.sources) {
        if (run.positionId !== positionId || run.source !== source) continue;
        for (let q = run.fromQ; q < run.toQ; q++) heads[q]! += run.heads;
      }
      for (const [fromQ, toQ] of layers(heads)) {
        const lead = source === "closing_crew" && !leadTaken && isLineRole(s.positions[positionId]!.role);
        if (lead) leadTaken = true;
        out.push({ positionId, fromQ, toQ, source, essential: source === "closing_crew", closingLead: lead });
      }
    }
  }
  return out;
}

export interface SalariedBlock { userId: string; startQ: number; endQ: number }
export interface SalariedSkip { userId: string; reason: "off" | "no_fit" | "leader_setting" }

/** The MoD blocks of the salaried managers on `date` (reason `salaried_minimum`), and who was skipped and why. */
export function salariedBlocks(
  people: readonly RulePerson[], s: ScheduleStructure, date: string, scheduledOutQ: number,
): { blocks: SalariedBlock[]; skipped: SalariedSkip[] } {
  const blocks: SalariedBlock[] = [];
  const skipped: SalariedSkip[] = [];
  const { prepStartQ, prepDishArrivalQ } = s.shopDay;
  for (const p of [...people].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))) {
    if (!p.salaried || !p.activeMember || p.presenceOnly) continue;
    const window = p.availability[date];
    if (window === null) { skipped.push({ userId: p.userId, reason: "off" }); continue; }
    const roleMinQ = (p.role === "gm" ? s.limits.gmMinimumH : p.role === "agm" ? s.limits.agmMinimumH : 0) * 4;
    const len = Math.max(s.limits.minimumShiftQ, roleMinQ);
    const setting = leaderSettingOf(p, s);
    let startQ = setting === "closes" ? scheduledOutQ - len : p.role === "agm" ? Math.max(prepStartQ, prepDishArrivalQ) : prepStartQ;
    let endQ = startQ + len;
    if (window) {
      if (startQ < window.fromQ) { startQ = window.fromQ; endQ = startQ + len; }
      if (endQ > window.toQ) { endQ = window.toQ; startQ = endQ - len; }
      if (startQ < window.fromQ) { skipped.push({ userId: p.userId, reason: "no_fit" }); continue; }
    }
    if (startQ < prepStartQ || endQ > scheduledOutQ) { skipped.push({ userId: p.userId, reason: "no_fit" }); continue; }
    if (!leaderSettingAllows(p, s, startQ, endQ)) { skipped.push({ userId: p.userId, reason: "leader_setting" }); continue; }
    blocks.push({ userId: p.userId, startQ, endQ });
  }
  return { blocks, skipped };
}
