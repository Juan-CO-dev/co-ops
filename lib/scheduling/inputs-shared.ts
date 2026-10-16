/**
 * THE SCHEDULING INPUTS, assembled — pure (Scheduling Phase 2, Task 16). `loadSchedulingInputs` (inputs.ts) gathers
 * every fact in one batch; this module turns those facts into a `GeneratorInput` for one week, with no I/O, so the
 * lib, the cron and the tests assemble a week the same way.
 *
 * Rules applied here, once:
 *  - the structure is the shop's newest saved version, else the seeded defaults (`STRUCTURE_DEFAULTS_ID`; SQL stores
 *    NULL for it, chunk D deviation 6);
 *  - demand `unavailable` never builds (`demand_unavailable`, r2 P2-6); `no_history` builds on the day-type order;
 *  - the day type per date: the newest manager override, the weekend rule, the forecast thresholds (J14);
 *  - the closing minutes: the override WINS, else the measured p75 (≥ 8 finalized closes), else 45 (J8);
 *  - per-date budgets: the newest entry covering each date (r3);
 *  - availability assumed from Toast punches with a person-specific denominator (J15); wages reduced to cents per
 *    linked user and never placed in a view-model;
 *  - the head's days, shifts, gaps and STORED reasons are carried as they are (the historical contract).
 */
import type { RoleCode } from "@/lib/roles";
import type { SkillMatrix } from "@/lib/people/skill-matrix-shared";
import type { ClosingStatusFact, ClosingInstanceFact, ClosingCompletionFact } from "@/lib/people/facts-shared";
import { budgetForDates, type BudgetDayRow, type BudgetEntry } from "./budget-shared";
import { closingDuration, resolveClosingMinutes, type ClosingDurationResult, type ClosingFinalizationFact } from "./closing-duration-shared";
import type { RuleContext } from "./context-shared";
import { dayTypeFor, type CateringEvent, type DayForecast, type DayTypeOverride, type DemandResult } from "./demand-shared";
import { ScheduleError } from "./errors-shared";
import type { BuildDayInput, GeneratorInput, HeadSnapshot, Pin } from "./generator/build-shared";
import { makeSkillLookup, punchPatterns, toSchedPeople, type PersonSettingsRow, type PunchEntry } from "./people-input-shared";
import type { DayRecord, DeclaredGap, Shift } from "./rules-shared";
import { scheduledOut, type ScheduleStructure } from "./structure-shared";
import { addDays, isoWeekStart, weekDays } from "./time-shared";

/** The structure version id of the seeded defaults (no saved structure). SQL stores NULL for it. */
export const STRUCTURE_DEFAULTS_ID = "defaults";
export const sqlStructureVersion = (id: string): string | null => (id === STRUCTURE_DEFAULTS_ID ? null : id);
export const tsStructureVersion = (id: string | null): string => id ?? STRUCTURE_DEFAULTS_ID;

export interface ScheduleShopSettings { enabled: boolean; estimatedHourlyCents: number | null; estimatedSalariedWeeklyCents: number | null; agmAccess: "read" | "edit" }
/** No row = OFF, money blank (R2), AGM read-only (R1). */
export const DEFAULT_SCHEDULE_SHOP_SETTINGS: ScheduleShopSettings = Object.freeze({ enabled: false, estimatedHourlyCents: null, estimatedSalariedWeeklyCents: null, agmAccess: "read" });

export interface MemberRow { userId: string; name: string; role: RoleCode; memberSince: string | null }
export interface DayTypeRow { id: string; date: string; dayType: DayTypeOverride; createdAt: string }

export interface StoredRevision {
  id: string; kind: "generated" | "regenerated" | "edited"; basedOnRevisionId: string | null; structureVersionId: string; createdAt: string;
  createdBy: string | null; actorContext: "user" | "cron"; generatorVersion: string; inputsDigest: string;
}
export interface StoredHead {
  revision: StoredRevision;
  shifts: Shift[];
  days: DayRecord[];
  gaps: DeclaredGap[];
  /** The stored reasons per shift, `date|user|start` (bound in SQL on inherited days). */
  reasons: Record<string, unknown>;
  /** The head revision's OWN validation context snapshot (original validation replays against it, no live read). */
  context: RuleContext;
}
export interface StoredWeek {
  weekStart: string;
  weekId: string | null;
  headRevisionId: string | null;
  approvedRevisionId: string | null;
  head: StoredHead | null;
  /** An 'edited' revision is newer than the newest generated / regenerated one (J12). */
  edited: boolean;
}

export interface SchedulingInputs {
  locationId: string;
  /** ET business date of the build (today). */
  asOf: string;
  shopSettings: ScheduleShopSettings;
  structure: { id: string; structure: ScheduleStructure; source: "saved" | "defaults" };
  /** Saved structures by id that heads / the reference name (for the budget suggestion's structure delta). */
  structuresById: Record<string, ScheduleStructure>;
  members: MemberRow[];
  skills: SkillMatrix;
  skillBands: { building: number; strong: number };
  personSettings: PersonSettingsRow[];
  budget: { entries: BudgetEntry[]; rows: BudgetDayRow[] };
  dayTypes: DayTypeRow[];
  pins: Pin[];
  weeks: Record<string, StoredWeek>;
  demand: DemandResult;
  catering: CateringEvent[];
  punches: PunchEntry[];
  closing: ClosingDurationResult;
  wages: { byUserCents: Record<string, number>; source: "sevenshifts" | "none" };
  overtimeH: number | null;
  keptBudgetDigests: string[];
}

// ─── Small pure readers ──────────────────────────────────────────────────────

/** The first clock time in a free-text catering window ("11:30 AM–1 PM", "12pm", "13:00") as a quarter, else null. */
export function eventQFromWindow(text: string | null): number | null {
  if (!text) return null;
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase().replace(/\./g, "") ?? null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return Math.floor((h * 60 + min) / 15);
}

/** The ezCater orders not already in the pipeline, as booked events (named, never summed). */
export interface EzcaterOrderRow { id: string; event_date: string | null; event_timestamp: string | null; handoff_time: string | null; headcount: number | null; total_cents: number | null; status: string | null }

/** Booked catering → the generator's events: the pipeline events plus ezCater orders, id-sorted, one per id. */
export function toCateringEvents(
  booked: ReadonlyArray<{ id: string; eventDate: string; timeWindow: string | null; headcount: number | null; contactName: string; company: string | null; valueCents: number }>,
  ezcater: readonly EzcaterOrderRow[],
  etWallQ: (iso: string) => number,
): CateringEvent[] {
  const out: CateringEvent[] = booked.map((b) => ({
    id: b.id, date: b.eventDate, name: b.company ? `${b.contactName} (${b.company})` : b.contactName,
    headcount: b.headcount ?? 0, valueCents: b.valueCents, eventQ: eventQFromWindow(b.timeWindow),
  }));
  for (const o of ezcater) {
    if (!o.event_date || /cancel/i.test(o.status ?? "")) continue;
    out.push({ id: o.id, date: o.event_date, name: "ezCater", headcount: o.headcount ?? 0, valueCents: o.total_cents,
      eventQ: o.event_timestamp ? etWallQ(o.event_timestamp) : eventQFromWindow(o.handoff_time) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The closing finalization facts (people facts `closingLines` + `closingFinalization`) in closing-duration's shape. */
export function closingFacts(f: { closingInstances: ClosingInstanceFact[]; closingCompletions: ClosingCompletionFact[]; closingStatus: ClosingStatusFact[] }): ClosingFinalizationFact[] {
  const status = new Map(f.closingStatus.map((s) => [s.id, s]));
  const last = new Map<string, string>();
  for (const c of f.closingCompletions) {
    const cur = last.get(c.instance_id);
    if (!cur || Date.parse(c.completed_at) > Date.parse(cur)) last.set(c.instance_id, c.completed_at);
  }
  return f.closingInstances.map((i) => {
    const st = status.get(i.id);
    return {
      instanceId: i.id, date: i.date, shiftStartAt: i.shift_start_at, triggeredAt: i.triggered_at, status: st?.status ?? "open",
      confirmedAt: st?.confirmed_at ?? null, hasFinalConfirmation: st?.final_confirmation ?? false, lastLiveCompletionAt: last.get(i.id) ?? null,
    };
  });
}

/**
 * The person-specific first counted day (J15): the later of their membership and their first punch at the shop. The
 * loader reads the punches of the pattern window only: a person who punched in the window's FIRST week is treated as
 * present from before it (the membership floor still applies).
 */
export function firstSeenFor(members: readonly MemberRow[], punches: readonly PunchEntry[], windowStart: string): Record<string, string> {
  const firstPunch = new Map<string, string>();
  for (const p of punches) if (p.userId && !p.deleted) { const c = firstPunch.get(p.userId); if (!c || p.businessDate < c) firstPunch.set(p.userId, p.businessDate); }
  const out: Record<string, string> = {};
  for (const m of members) {
    const fp = firstPunch.get(m.userId);
    const punchFloor = fp && fp >= addDays(windowStart, 7) ? fp : null;
    const candidates = [m.memberSince, punchFloor].filter((x): x is string => !!x).sort();
    const v = candidates[candidates.length - 1];
    if (v) out[m.userId] = v;
  }
  return out;
}

/** The newest manager override per date (append-only rows; the newest wins). */
export function overrideFor(rows: readonly DayTypeRow[], date: string): { id: string; dayType: DayTypeOverride } | null {
  const mine = rows.filter((r) => r.date === date).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  return mine[0] ? { id: mine[0].id, dayType: mine[0].dayType } : null;
}

/** The head as the generator's snapshot (null when the week has no revision). */
export function headSnapshotFor(week: StoredWeek | undefined): HeadSnapshot | null {
  const h = week?.head;
  if (!h) return null;
  return {
    revisionId: h.revision.id, shifts: h.shifts, days: h.days, gaps: h.gaps, reasons: h.reasons,
    closingWindowByDate: h.context.closingWindowByDate ?? {},
  };
}

// ─── The week's generator input ──────────────────────────────────────────────

/**
 * One week's `GeneratorInput`. `buildDays` = the dates to (re)build; every other date of the week is carried from the
 * head. `today` is the ET business date. Refuses `demand_unavailable` when demand did not load (never a flat curve).
 */
export function generatorInputFor(inputs: SchedulingInputs, weekStart: string, opts: { today: string; buildDays?: readonly string[] }): GeneratorInput {
  if (inputs.demand.kind === "unavailable") throw new ScheduleError("demand_unavailable", { params: { cause: inputs.demand.cause } });
  // 7shifts' weekly overtime line, once synced, overrides the structure's default (plan "Data reality").
  const s = inputs.overtimeH === null ? inputs.structure.structure
    : { ...inputs.structure.structure, limits: { ...inputs.structure.structure.limits, overtimeH: inputs.overtimeH } };
  const dates = weekDays(weekStart);
  const buildDays = (opts.buildDays ?? dates).filter((d) => dates.includes(d) && d >= opts.today);
  const forecastOf = (date: string): DayForecast | null => (inputs.demand.kind === "unavailable" ? null : inputs.demand.days.find((d) => d.date === date) ?? null);
  const closing = resolveClosingMinutes({ override: s.limits.closingMinutesOverride, measured: inputs.closing });
  const outQ = scheduledOut(s, closing.minutes);
  const days: BuildDayInput[] = buildDays.map((date) => {
    const f = forecastOf(date);
    const dt = dayTypeFor(date, { override: overrideFor(inputs.dayTypes, date), structure: s, forecast: f });
    const ok = f?.kind === "ok";
    const catering = inputs.catering.filter((e) => e.date === date).map((e) => ({ id: e.id, headcount: e.headcount, eventQ: e.eventQ }));
    return {
      date, dayType: dt.dayType, dayTypeSource: dt.source, overrideId: dt.overrideId, closingMinutes: closing.minutes, scheduledOutQ: outQ,
      demandKind: ok ? "ok" : "no_history", hourlyCents: ok ? (f as Extract<DayForecast, { kind: "ok" }>).hourlyCents : null,
      dayCents: ok ? (f as Extract<DayForecast, { kind: "ok" }>).dayCents : null, catering,
    };
  });
  const windowStart = addDays(isoWeekStart(inputs.asOf), -56);
  const patterns = punchPatterns(inputs.punches, { asOf: inputs.asOf, firstSeen: firstSeenFor(inputs.members, inputs.punches, windowStart) });
  const skills = makeSkillLookup(inputs.skills, inputs.skillBands);
  const { people } = toSchedPeople({
    members: inputs.members.map((m) => ({ userId: m.userId, role: m.role, active: true })),
    settings: inputs.personSettings, patterns, dates, structure: s,
    shopDay: { fromQ: s.shopDay.prepStartQ, toQ: s.shopDay.outLatestQ },
    wages: { byUserCents: inputs.wages.byUserCents, estimateHourlyCents: inputs.shopSettings.estimatedHourlyCents }, skills,
  });
  const budget = budgetForDates(inputs.budget.entries, inputs.budget.rows, dates);
  return {
    locationId: inputs.locationId, weekStart, today: opts.today, days, structure: s, structureVersionId: inputs.structure.id, people, skills,
    pins: inputs.pins.filter((p) => dates.includes(p.date)), budgetByDate: budget.byDate, head: headSnapshotFor(inputs.weeks[weekStart]),
  };
}

/** Every date of the given weeks (the loader's demand / catering / budget span). */
export function datesOfWeeks(weekStarts: readonly string[]): string[] {
  return [...new Set(weekStarts.flatMap((w) => weekDays(w)))].sort();
}

export { closingDuration };
