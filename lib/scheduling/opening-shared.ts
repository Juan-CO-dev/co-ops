/**
 * THE EARLIER OPENING, PER DATE — pure, client-safe, zero I/O (PR SCH, plan r5 sections 4, 20.4, 20.8, 22.1).
 *
 * Juan (2026-11-21): a heavy catering day normally brings MORE PEOPLE EARLY inside the normal morning; opening the shop
 * earlier is the extreme case. So:
 *  - A heavy STATIONS-engine day raises Prep/Dishwasher's head limit by the catering extra (`extraPrepDishHeads`), so the
 *    extra person the catering rule asks for is really added inside each order's prep window, clipped to the day's start.
 *    The crew engine gets no rise: its extra people are the `crewShift` path.
 *  - An EARLIER OPENING is a per-date decision stored in the revision's own context (`DayContext.opening`): a GM and up may
 *    open a date earlier by hand ("manual"), accept or decline a proposal, or clear the decision. When an opening applies
 *    (accepted / manual / auto), the date is built from a per-day structure whose prep start and Prep / Prep-Dishwasher
 *    opens move to it, on either engine.
 *  - The MODE (`earlyOpenMode`: manual / semi / auto) is SCH-2's setting and needs a migration. In SCH-1 it is PINNED to
 *    "manual" (`earlyOpenModeOf`): the schedule never proposes or applies an opening by itself; the triggers and the semi /
 *    auto branches exist and are tested through `resolveOpening`'s explicit mode argument.
 *
 * "Heavy" is the day's TOTAL guests (`catering-day-shared`, PR 5's one rule); a window is `cateringPrepWindowQ`. There is
 * no second threshold or window formula here.
 *
 * Two kinds of head limit (ruling D8): the SAVED setting stays 0–8 and is validated as today; the DERIVED runtime limit
 * (saved + the heavy-day extra, 0–16) lives only in a day's context, is never saved back, and is checked by
 * `assertRuntimeLimits`.
 */
import type { DayContext } from "./context-shared";
import { cateringDayLoad, cateringPrepWindowQ } from "./catering-day-shared";
import { ScheduleError } from "./errors-shared";
import { positionIds, scheduleEngine, type ScheduleStructure, type StructurePosition } from "./structure-shared";

/** T1: the earliest prep window starts MORE than this many minutes before the normal prep start. */
export const EARLY_OPEN_FIT_MIN = 60;
/** T2: the day's total guests reach this multiple of the heavy threshold (with a timed order before service start). */
export const EARLY_OPEN_HUGE_FACTOR = 2;
/** The derived runtime head limit (saved ≤ 8 + the heavy-day extra ≤ 8). */
export const RUNTIME_HEADS_MAX = 16;

export type EarlyOpenMode = "manual" | "semi" | "auto";
export type OpeningTrigger = "prep_fit" | "huge_day";
export type OpeningStatus = "proposed" | "accepted" | "manual" | "auto" | "declined";
/** A persistent per-date decision (the generator input). `proposed` and `auto` are never decisions: they are recomputed. */
export type OpeningDecision = { kind: "accepted"; startQ: number } | { kind: "manual"; startQ: number } | { kind: "declined" };

/** Stored on `DayContext.opening`; absent on an ordinary day. */
export interface DayOpening {
  readonly status: OpeningStatus;
  /** The opening applied or proposed (the normal start for `declined`). */
  readonly startQ: number;
  readonly normalStartQ: number;
  /** The triggers that fire on the date's current orders ([] for manual). */
  readonly triggers: readonly OpeningTrigger[];
  /** `cateringDayLoad`, display only. */
  readonly guests: number;
  readonly orders: number;
}

/** What a per-day structure changed, to restore the shop's own structure behind it. */
export interface DayBase {
  readonly prepStartQ: number;
  readonly positions: Readonly<Record<string, Pick<StructurePosition, "openQ" | "headsBefore" | "headsAfter">>>;
}

type Catering = ReadonlyArray<{ readonly headcount: number | null; readonly eventQ: number | null }>;
const APPLIED: readonly OpeningStatus[] = ["accepted", "manual", "auto"];

/** Whether an opening moves the date's start (accepted / manual / auto); proposed and declined never do. */
export function openingApplies(o: Pick<DayOpening, "status"> | null | undefined): boolean {
  return !!o && APPLIED.includes(o.status);
}

/** SCH-1: the mode is pinned to manual (SCH-2 reads `catering.earlyOpenMode`, behind its readiness gate). */
export function earlyOpenModeOf(s: ScheduleStructure): EarlyOpenMode {
  void s;
  return "manual";
}

/**
 * The triggers on a date's orders, and the candidate start h = min(normal start, every order's window start). Evaluated
 * only on a HEAVY day (ruling C4): T1 "prep can't fit" when h < normal − 60 min (strictly), T2 "huge day" when the total
 * guests reach 2× the threshold and some timed order is before service start. Orders with no guest count add 0.
 */
export function openingTriggers(s: ScheduleStructure, catering: Catering): { triggers: OpeningTrigger[]; candidateQ: number } {
  const normal = s.shopDay.prepStartQ;
  const candidateQ = Math.min(normal, ...catering.map((o) => cateringPrepWindowQ(o.eventQ, s.catering)[0]));
  const load = cateringDayLoad(catering, s.catering);
  if (!load.heavy) return { triggers: [], candidateQ };
  const triggers: OpeningTrigger[] = [];
  if (candidateQ < normal - EARLY_OPEN_FIT_MIN / 15) triggers.push("prep_fit");
  if (load.orders >= 1 && load.guests >= EARLY_OPEN_HUGE_FACTOR * s.catering.minHeadcount
    && catering.some((o) => o.eventQ !== null && o.eventQ < s.shopDay.serviceStartQ)) triggers.push("huge_day");
  return { triggers, candidateQ };
}

/**
 * THE one resolution. The first rule that holds: a `manual` decision applies at its start; `accepted` applies at its
 * STORED start (ruling C6: a GM's decision is never silently undone); `declined` is the normal start; otherwise, when a
 * trigger fires and h < normal: `auto` applies h (recomputed every rebuild), `semi` proposes h (the structure is not
 * changed), `manual` gives nothing. `mode` defaults to the structure's (pinned "manual" in SCH-1).
 */
export function resolveOpening(s: ScheduleStructure, catering: Catering, decision: OpeningDecision | null, mode: EarlyOpenMode = earlyOpenModeOf(s)): DayOpening | null {
  const normalStartQ = s.shopDay.prepStartQ;
  const load = cateringDayLoad(catering, s.catering);
  const base = { normalStartQ, guests: load.guests, orders: load.orders };
  if (decision?.kind === "manual") return { status: "manual", startQ: decision.startQ, triggers: [], ...base };
  const { triggers, candidateQ } = openingTriggers(s, catering);
  if (decision?.kind === "accepted") return { status: "accepted", startQ: decision.startQ, triggers, ...base };
  if (decision?.kind === "declined") return { status: "declined", startQ: normalStartQ, triggers, ...base };
  if (triggers.length === 0 || candidateQ >= normalStartQ || mode === "manual") return null;
  return { status: mode === "auto" ? "auto" : "proposed", startQ: candidateQ, triggers, ...base };
}

/**
 * The structure a date is built from: on a heavy STATIONS day Prep/Dishwasher's heads before and after trim rise by the
 * catering extra; when an opening applies, `prepStartQ` moves to it and every Prep and Prep/Dishwasher open moves to
 * min(open, start). Never mutates `s`; an ordinary day gets THE SAME OBJECT and `base: null` (byte-identical output).
 */
export function structureForDay(s: ScheduleStructure, catering: Catering, opening: DayOpening | null): { structure: ScheduleStructure; base: DayBase | null } {
  const ids = positionIds(s);
  const extra = s.catering.extraPrepDishHeads;
  const dish = ids.find((id) => s.positions[id]!.role === "prep_dish");
  const rise = scheduleEngine(s) === "stations" && extra > 0 && !!dish && cateringDayLoad(catering, s.catering).heavy ? extra : 0;
  const open = openingApplies(opening) && opening!.startQ < s.shopDay.prepStartQ ? opening!.startQ : null;
  if (rise === 0 && open === null) return { structure: s, base: null };
  const positions: Record<string, StructurePosition> = { ...s.positions };
  const touched: Record<string, Pick<StructurePosition, "openQ" | "headsBefore" | "headsAfter">> = {};
  for (const id of ids) {
    const p = s.positions[id]!;
    const lift = id === dish ? rise : 0;
    const openQ = open !== null && (p.role === "prep" || p.role === "prep_dish") ? Math.min(p.openQ, open) : p.openQ;
    if (lift === 0 && openQ === p.openQ) continue;
    touched[id] = { openQ: p.openQ, headsBefore: p.headsBefore, headsAfter: p.headsAfter };
    positions[id] = { ...p, openQ, headsBefore: p.headsBefore + lift, headsAfter: p.headsAfter + lift };
  }
  const structure: ScheduleStructure = { ...s, shopDay: { ...s.shopDay, prepStartQ: open ?? s.shopDay.prepStartQ }, positions };
  return { structure, base: { prepStartQ: s.shopDay.prepStartQ, positions: touched } };
}

/** The shop's own structure behind a date's (restores the prep start and every touched position from `base`). */
export function baseStructureOf(day: { structure: ScheduleStructure; base?: DayBase }): ScheduleStructure {
  const b = day.base;
  if (!b) return day.structure;
  const positions: Record<string, StructurePosition> = { ...day.structure.positions };
  for (const [id, was] of Object.entries(b.positions)) {
    const p = positions[id];
    if (p) positions[id] = { ...p, openQ: was.openQ, headsBefore: was.headsBefore, headsAfter: was.headsAfter };
  }
  return { ...day.structure, shopDay: { ...day.structure.shopDay, prepStartQ: b.prepStartQ }, positions };
}

/** D8: every head limit of a per-day structure is an integer in 0–16; a violation fails like `generator_invalid_output`. */
export function assertRuntimeLimits(s: ScheduleStructure): void {
  for (const id of positionIds(s)) {
    const p = s.positions[id]!;
    for (const [k, v] of [["headsBefore", p.headsBefore], ["headsAfter", p.headsAfter]] as const) {
      if (!Number.isInteger(v) || v < 0 || v > RUNTIME_HEADS_MAX) throw new ScheduleError("generator_invalid_output", { params: { key: `positions.${id}.${k}`, value: v } });
    }
  }
}

/** THE actual start of a built date (quarters): the date's own structure, else the saved one. What the Dashboard reads. */
export function scheduledDayStartQ(day: Pick<DayContext, "structure"> | null | undefined, saved: Pick<ScheduleStructure, "shopDay">): number {
  return day?.structure.shopDay.prepStartQ ?? saved.shopDay.prepStartQ;
}

/** A stored opening as the generator's persistent decision (F1): proposed / auto / absent → null (recomputed). */
export function toDecision(o: DayOpening | null | undefined): OpeningDecision | null {
  if (!o) return null;
  if (o.status === "accepted") return { kind: "accepted", startQ: o.startQ };
  if (o.status === "manual") return { kind: "manual", startQ: o.startQ };
  if (o.status === "declined") return { kind: "declined" };
  return null;
}

// ─── The request contract (D4) ───────────────────────────────────────────────

/** The client's request: an accept NEVER carries a start (the server takes it from the proposal on the expected head). */
export type OpeningDecisionInput = { kind: "accept" } | { kind: "decline" } | { kind: "manual"; startQ: number } | { kind: "clear" };

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exactly = (o: Record<string, unknown>, keys: readonly string[]) => Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));

/** Exactly one of the four shapes, no other key (an extra key, or a start on an accept, is a 400). */
export function isOpeningDecisionInput(v: unknown): v is OpeningDecisionInput {
  if (!plain(v) || typeof v.kind !== "string") return false;
  if (v.kind === "accept" || v.kind === "decline" || v.kind === "clear") return exactly(v, ["kind"]);
  if (v.kind === "manual") return exactly(v, ["kind", "startQ"]) && typeof v.startQ === "number";
  return false;
}
