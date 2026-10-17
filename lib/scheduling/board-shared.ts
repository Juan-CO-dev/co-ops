/**
 * THE BOARD MATHS — pure (Scheduling Phase 2, Task 9; plan "The board", spec §7). Every number the board shows
 * is computed here from the same schedule and validation context the server judges, so the UI renders a
 * view-model and never re-derives a rule. The mockup v17 is the reference: `coverage` (scheduled / needed per
 * position × hour, its "over" tone), `closingRoleCoverage`, `renderMetrics` (the money strip), `floorHours`
 * (hourly hours that salaried cover saves), `demandSvg` (labor % per hour) and `renderTabs`.
 *
 * MONEY (J1, J9): every $ and % is computed only for an actor who may see shop labor totals
 * (`canSeeScheduleMoney`: GM own shop, MoO+). For anyone else the money keys are ABSENT from the view-model —
 * not null, absent — so nothing reaches the client. Never per person: only shop totals and per-hour ratios.
 * A $ figure with an unknown wage or forecast is null ("—" with its errand), never 0 (R2).
 */
import type { NarrativeLine } from "@/lib/people-narrative";
import type { DayContext, RuleContext, RulePerson } from "./context-shared";
import { skillOf, type SkillLookup } from "./people-input-shared";
import { MOD, closingManagerEligible, coversClosingWindow, eligibleForPosition, modCountsAt, salariedWeek, type Shift } from "./rules-shared";
import { isLineRole, positionIds, positionLimit, type CrewType, type ScheduleStructure } from "./structure-shared";
import { Q_PER_HOUR } from "./time-shared";

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** One built day as the board reads it. */
export interface BoardDayInput {
  date: string;
  day: DayContext;
  shifts: Shift[];
  people: Record<string, RulePerson>;
  skills: SkillLookup;
  /** userId → hourly wage cents (7shifts, else the shop estimate); null = unknown. Salaried people are not read. */
  wageCentsByUser: Record<string, number | null>;
}

/** The hours the board draws for a day: prep start → scheduled out, whole hours. */
export function shopHours(day: Pick<DayContext, "structure" | "scheduledOutQ">): number[] {
  const from = Math.floor(day.structure.shopDay.prepStartQ / Q_PER_HOUR);
  const to = Math.ceil(day.scheduledOutQ / Q_PER_HOUR);
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

const quartersOf = (hour: number) => [0, 1, 2, 3].map((i) => hour * Q_PER_HOUR + i);
const onClockAt = (sh: Shift, q: number) => sh.startQ <= q && sh.endQ > q;
const segAt = (sh: Shift, q: number) => sh.segments.find((g) => g.startQ <= q && g.endQ > q);
const isHourly = (p: RulePerson | undefined) => !!p && !p.salaried && !p.presenceOnly;

function occupancy(shifts: readonly Shift[], positionId: string, q: number): number {
  let n = 0;
  for (const sh of shifts) for (const g of sh.segments) if (g.positionId === positionId && g.startQ <= q && g.endQ > q) n++;
  return n;
}

// ─── Coverage ────────────────────────────────────────────────────────────────

export type CoverageTone = "gap" | "over" | "good" | "closed";
export interface CoverageCell {
  positionId: string;
  hour: number;
  /** Head-hours scheduled / needed in the hour (quarter precision). */
  scheduled: number;
  needed: number;
  tone: CoverageTone;
  /** Who else on shift then could work it (not already on it), strongest first. */
  alternates: Array<{ userId: string; skill: number }>;
}

/**
 * Per position × hour: red `gap` when any quarter is short of the need; amber `over` when any quarter has more
 * people than the need (the mockup's over-coverage); grey `closed` when nothing is needed or scheduled; else
 * green `good`. A gap is never hidden behind amber (deviation from the mockup, which ranks "over" first).
 */
export function coverageCells(input: BoardDayInput): CoverageCell[] {
  const { day, shifts } = input;
  const s = day.structure;
  const out: CoverageCell[] = [];
  for (const positionId of positionIds(s)) {
    const pos = s.positions[positionId]!;
    for (const hour of shopHours(day)) {
      let need4 = 0;
      let occ4 = 0;
      let short = false;
      let over = false;
      for (const q of quartersOf(hour)) {
        const need = day.need.positions[positionId]?.[q] ?? 0;
        const occ = occupancy(shifts, positionId, q);
        need4 += need;
        occ4 += occ;
        if (occ < need) short = true;
        if (occ > need) over = true;
      }
      const tone: CoverageTone = need4 === 0 && occ4 === 0 ? "closed" : short ? "gap" : over ? "over" : "good";
      const alternates = shifts
        .filter((sh) => quartersOf(hour).some((q) => onClockAt(sh, q)) && !sh.segments.some((g) => g.positionId === positionId && g.startQ < (hour + 1) * Q_PER_HOUR && g.endQ > hour * Q_PER_HOUR))
        .map((sh) => input.people[sh.userId])
        .filter((p): p is RulePerson => !!p && eligibleForPosition(p, pos))
        .map((p) => ({ userId: p.userId, skill: round3(skillOf(input.skills, p, positionId, pos).value) }))
        .filter((a) => a.skill > 0)
        .sort((a, b) => b.skill - a.skill || cmp(a.userId, b.userId));
      out.push({ positionId, hour, scheduled: occ4 / 4, needed: need4 / 4, tone, alternates });
    }
  }
  return out;
}

// ─── The MoD lane and the Closing Manager row ───────────────────────────────

export interface ModLaneHour { hour: number; userIds: string[]; tone: "good" | "gap" | "none" }

/** Who counts as the manager on duty in each hour (SL+, or a KH after the shop's setting); a gap only when required. */
export function modLane(input: BoardDayInput): ModLaneHour[] {
  const { day, shifts } = input;
  const s = day.structure;
  const { prepStartQ } = s.shopDay;
  return shopHours(day).map((hour) => {
    const ids = new Set<string>();
    let hole = false;
    for (const q of quartersOf(hour)) {
      let any = false;
      for (const sh of shifts) {
        const p = input.people[sh.userId];
        if (p && onClockAt(sh, q) && modCountsAt(p, s, q)) { ids.add(p.userId); any = true; }
      }
      if (!any && q >= prepStartQ && q < day.scheduledOutQ) hole = true;
    }
    const userIds = [...ids].sort(cmp);
    return { hour, userIds, tone: hole ? (s.leadership.modRequired ? "gap" : "none") : "good" };
  });
}

export interface ClosingRoleCell { hour: number; state: "closed" | "covered" | "gap"; userId: string | null }

function closingRequired(day: DayContext): boolean {
  for (const [id, arr] of Object.entries(day.need.positions)) {
    const pos = day.structure.positions[id];
    if (!pos || !isLineRole(pos.role)) continue;
    for (let q = day.structure.shopDay.serviceCloseQ; q < day.scheduledOutQ; q++) if ((arr[q] ?? 0) > 0) return true;
  }
  return false;
}

/** The Closing Manager role per hour: needed in [service close, scheduled out) when the line closes; covered by the flagged eligible closer. */
export function closingRoleCells(input: BoardDayInput): ClosingRoleCell[] {
  const { day, shifts } = input;
  const s = day.structure;
  const from = s.shopDay.serviceCloseQ;
  const to = day.scheduledOutQ;
  const required = closingRequired(day);
  const cm = shifts.find((sh) => sh.closingManager && !!input.people[sh.userId] && closingManagerEligible(input.people[sh.userId]!, s));
  return shopHours(day).map((hour) => {
    const qs = quartersOf(hour).filter((q) => q >= from && q < to);
    if (!required || qs.length === 0) return { hour, state: "closed", userId: null };
    // Astra chunk C P2: COMPLETE coverage, as the validator — the flagged eligible closer's shift spans the whole closing
    // window (service close → everyone out) and is on the clock at every required quarter of this hour.
    const covered = !!cm && coversClosingWindow(cm, day) && qs.every((q) => onClockAt(cm, q));
    return { hour, state: covered ? "covered" : "gap", userId: covered ? cm!.userId : null };
  });
}

// ─── Money ───────────────────────────────────────────────────────────────────

/** Hourly labor cents over [fromQ, toQ) of a set of shifts; null when any hourly person on it has no wage. */
function hourlyCostCents(shifts: readonly Shift[], people: Record<string, RulePerson>, wages: Record<string, number | null>, fromQ = 0, toQ = 96): number | null {
  let cents = 0;
  for (const sh of shifts) {
    const p = people[sh.userId];
    if (!isHourly(p)) continue;
    const q = Math.max(0, Math.min(sh.endQ, toQ) - Math.max(sh.startQ, fromQ));
    if (q === 0) continue;
    const wage = wages[sh.userId];
    if (wage === null || wage === undefined) return null;
    cents += (wage * q) / 4;
  }
  return Math.round(cents);
}

export interface MoneyStripInput {
  dates: string[];
  /** Every shift of the week (inherited days included). */
  shifts: Shift[];
  ctx: RuleContext;
  wageCentsByUser: Record<string, number | null>;
  /** The week's forecast sales; null when the demand is not `ok` for every date. */
  forecastWeekCents: number | null;
  /** The salaried managers' fixed weekly cost (7shifts salaries, else the estimate); null = not set (R2). */
  salariedWeeklyCents: number | null;
}

export interface MoneyStripHours {
  hourlyHours: number;
  hourlyHoursOnBudgetedDates: number;
  /** Σ of the budgeted dates' budgets; null when no date has one. */
  budgetHours: number | null;
  unbudgetedDates: string[];
  /** budgetHours − hourly hours on the budgeted dates (negative = over); null without a budget. */
  remainingHours: number | null;
  /** People over the overtime threshold this week. */
  otRiskCount: number;
  /** Flex days come with availability (Phase 3): 0 and flagged until then. */
  flexUsed: number;
  flexAvailable: false;
  /** Salaried managers' floor (non-MoD) hours, and the hourly hours that floor time saves (no hourly person on that position then). */
  managerFloorHours: number;
  hourlySavedBySalaried: number;
  /** Astra chunk D: salaried managers' MoD-only time, shown SEPARATELY — it never counts toward the floor limit (station time only). */
  managerModHours: number;
  /**
   * CC chunk C ruling 3: the ESSENTIAL hourly hours on the budgeted dates (whole shifts working the closing window) —
   * exempt from the budget cap, counted in every total — and how much of the budget they pass (0 within it; null with
   * no budget).
   */
  essentialHoursOnBudgetedDates: number;
  essentialPastBudgetHours: number | null;
  /**
   * Juan 2026-10-16 (decision 4): each salaried manager's week — the BASE hours (station + MoD, flex aside; the target is
   * 40 h) and the FLEX used by zero-hourly-cost fills ("40 h + X h flex used (keeps hourly labor down)"). Hours only.
   */
  salariedWeeks: Array<{ userId: string; baseHours: number; flexHours: number; targetHours: number; flexLimitHours: number }>;
}
export interface MoneyStripMoney { hourlyCostCents: number | null; hourlyPct: number | null; salariedFixedCents: number | null; totalPct: number | null }
/** `notes`: board lines with no $ (shown to every viewer), e.g. "essential hours past budget: X h" (CC chunk C ruling 3). */
export interface MoneyStrip { hours: MoneyStripHours; notes: NarrativeLine[]; money?: MoneyStripMoney }

function structureFor(ctx: RuleContext, date: string): ScheduleStructure | null {
  const d = ctx.days[date] ?? Object.values(ctx.days)[0];
  return d ? d.structure : null;
}

export function moneyStrip(input: MoneyStripInput, opts: { canSeeMoney: boolean }): MoneyStrip {
  const { ctx, shifts } = input;
  const people = ctx.people;
  const inWeek = shifts.filter((sh) => input.dates.includes(sh.date));
  const budgetedDates = input.dates.filter((d) => ctx.budgetByDate[d] !== null && ctx.budgetByDate[d] !== undefined);
  const unbudgetedDates = input.dates.filter((d) => !budgetedDates.includes(d));
  let hourlyQ = 0;
  let budgetedQ = 0;
  let essentialQ = 0;
  const weekQ = new Map<string, number>();
  for (const sh of inWeek) {
    weekQ.set(sh.userId, (weekQ.get(sh.userId) ?? 0) + (sh.endQ - sh.startQ));
    if (!isHourly(people[sh.userId])) continue;
    hourlyQ += sh.endQ - sh.startQ;
    if (!budgetedDates.includes(sh.date)) continue;
    budgetedQ += sh.endQ - sh.startQ;
    const cw = ctx.closingWindowByDate[sh.date];
    if (cw && sh.segments.some((g) => g.positionId !== MOD && g.startQ < cw.toQ && g.endQ > cw.fromQ)) essentialQ += sh.endQ - sh.startQ;
  }
  const overtimeH = structureFor(ctx, input.dates[0]!)?.limits.overtimeH ?? 40;
  const otRiskCount = [...weekQ.entries()].filter(([u, q]) => isHourly(people[u]) && q / 4 > overtimeH).length;
  let floorQ = 0;
  let savedQ = 0;
  let modQ = 0;
  for (const sh of inWeek) {
    const p = people[sh.userId];
    if (!p?.salaried) continue;
    const s = structureFor(ctx, sh.date);
    const sameDay = inWeek.filter((x) => x.date === sh.date && isHourly(people[x.userId]));
    for (const g of sh.segments) {
      if (g.positionId === MOD) { modQ += g.endQ - g.startQ; continue; }
      floorQ += g.endQ - g.startQ;
      const pos = s?.positions[g.positionId];
      const lo = pos ? Math.max(g.startQ, pos.openQ) : g.startQ;
      const hi = pos ? Math.min(g.endQ, pos.closeQ) : g.endQ;
      for (let q = lo; q < hi; q++) if (!sameDay.some((x) => x.segments.some((y) => y.positionId === g.positionId && y.startQ <= q && y.endQ > q))) savedQ++;
    }
  }
  const budgetHours = budgetedDates.length ? budgetedDates.reduce((n, d) => n + (ctx.budgetByDate[d] ?? 0), 0) : null;
  const firstStructure = structureFor(ctx, input.dates[0]!);
  const salariedWeeks = [...new Set(inWeek.filter((sh) => people[sh.userId]?.salaried).map((sh) => sh.userId))].sort().map((userId) => {
    const w = salariedWeek({ shifts: inWeek }, userId);
    return { userId, baseHours: w.baseH, flexHours: w.flexH, targetHours: firstStructure?.limits.salariedTargetWeekH ?? 40, flexLimitHours: firstStructure?.limits.salariedFlexH ?? 10 };
  });
  const hours: MoneyStripHours = {
    hourlyHours: hourlyQ / 4, hourlyHoursOnBudgetedDates: budgetedQ / 4, budgetHours, unbudgetedDates,
    remainingHours: budgetHours === null ? null : budgetHours - budgetedQ / 4, otRiskCount, flexUsed: 0, flexAvailable: false,
    managerFloorHours: floorQ / 4, hourlySavedBySalaried: savedQ / 4, managerModHours: modQ / 4,
    essentialHoursOnBudgetedDates: essentialQ / 4,
    essentialPastBudgetHours: budgetHours === null ? null : Math.max(0, Math.min(essentialQ / 4, budgetedQ / 4 - budgetHours)),
    salariedWeeks,
  };
  const notes: NarrativeLine[] = [];
  if (hours.essentialPastBudgetHours !== null && hours.essentialPastBudgetHours > 0) {
    notes.push({ key: "schedule.note.essential_past_budget", params: { hours: hours.essentialPastBudgetHours, budgetHours: budgetHours! } });
  }
  if (!opts.canSeeMoney) return { hours, notes };
  const cost = hourlyCostCents(inWeek, people, input.wageCentsByUser);
  const fc = input.forecastWeekCents !== null && input.forecastWeekCents > 0 ? input.forecastWeekCents : null;
  const salaried = input.salariedWeeklyCents;
  return {
    hours,
    notes,
    money: {
      hourlyCostCents: cost,
      hourlyPct: cost !== null && fc !== null ? round1((100 * cost) / fc) : null,
      salariedFixedCents: salaried,
      totalPct: cost !== null && salaried !== null && fc !== null ? round1((100 * (cost + salaried)) / fc) : null,
    },
  };
}

// ─── Labor % per hour, the demand curve, the day tabs ───────────────────────

export type LaborTone = "good" | "watch" | "high" | "none";
export interface LaborHour { hour: number; pct: number | null; tone: LaborTone }

/** The tone of a labor % against the shop's target (the mockup's 30 / 40 generalised): good ≤ target, watch ≤ target + 10, high above. */
export function laborTone(pct: number | null, targetPct: number): LaborTone {
  if (pct === null) return "none";
  return pct <= targetPct ? "good" : pct <= targetPct + 10 ? "watch" : "high";
}

/** Per shop hour: the hour's hourly labor $ ÷ that hour's forecast $. Null rows' pct when unknown; null altogether without money permission. */
export function laborPctByHour(input: BoardDayInput, opts: { canSeeMoney: boolean }): LaborHour[] | null {
  if (!opts.canSeeMoney) return null;
  const { day } = input;
  const target = day.structure.labor.targetPct;
  const curve = day.inputs.demandKind === "ok" ? day.inputs.hourlyCents : null;
  return shopHours(day).map((hour) => {
    const fc = curve?.[hour] ?? null;
    const cost = hourlyCostCents(input.shifts, input.people, input.wageCentsByUser, hour * Q_PER_HOUR, (hour + 1) * Q_PER_HOUR);
    const pct = fc !== null && fc > 0 && cost !== null ? round1((100 * cost) / fc) : null;
    return { hour, pct, tone: laborTone(pct, target) };
  });
}

/** The day's forecast per shop hour (cents); null without a forecast (`no_history`). */
export function demandCurve(input: Pick<BoardDayInput, "day">): Array<{ hour: number; cents: number }> | null {
  const { day } = input;
  if (day.inputs.demandKind !== "ok" || !day.inputs.hourlyCents) return null;
  const curve = day.inputs.hourlyCents;
  return shopHours(day).map((hour) => ({ hour, cents: curve[hour] ?? 0 }));
}

export interface DayTab { date: string; dayType: CrewType | null; locked: boolean; hourlyPct?: number | null }

/** The week's tabs: days before today are locked (completed); the hourly labor % per day for money viewers only. */
export function dayTabs(
  input: { dates: string[]; today: string; ctx: RuleContext; shifts: Shift[]; wageCentsByUser: Record<string, number | null> },
  opts: { canSeeMoney: boolean },
): DayTab[] {
  return input.dates.map((date) => {
    const day = input.ctx.days[date];
    const tab: DayTab = { date, dayType: day ? day.dayType : null, locked: date < input.today };
    if (!opts.canSeeMoney) return tab;
    const fc = day && day.inputs.demandKind === "ok" ? day.inputs.dayCents : null;
    const cost = hourlyCostCents(input.shifts.filter((sh) => sh.date === date), input.ctx.people, input.wageCentsByUser);
    tab.hourlyPct = fc !== null && fc > 0 && cost !== null ? round1((100 * cost) / fc) : null;
    return tab;
  });
}
