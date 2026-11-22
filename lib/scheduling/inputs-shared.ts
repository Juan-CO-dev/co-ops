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
import { operationalNow } from "@/lib/midshift-shared";
import type { RoleCode } from "@/lib/roles";
import type { SkillMatrix } from "@/lib/people/skill-matrix-shared";
import type { ClosingStatusFact, ClosingInstanceFact, ClosingCompletionFact } from "@/lib/people/facts-shared";
import { budgetForDates, type BudgetDayRow, type BudgetEntry } from "./budget-shared";
import { closingDuration, resolveClosingMinutes, type ClosingDurationResult, type ClosingFinalizationFact } from "./closing-duration-shared";
import type { RuleContext } from "./context-shared";
import { dayTypeFor, type CateringEvent, type DayForecast, type DayTypeOverride, type DemandResult } from "./demand-shared";
import { ScheduleError } from "./errors-shared";
import type { BuildDayInput, GeneratorInput, HeadSnapshot, Pin } from "./generator/build-shared";
import { openingApplies, resolveOpening, toDecision, type DayOpening, type OpeningDecision } from "./opening-shared";
import { makeSkillLookup, punchPatterns, toSchedPeople, type ElsewhereShift, type PersonSettingsRow, type PunchEntry } from "./people-input-shared";
import type { DayRecord, DeclaredGap, Shift } from "./rules-shared";
import { scheduleEngine, scheduledOut, type ScheduleStructure } from "./structure-shared";
import { etClockTime } from "@/lib/operational-day";
import { addDays, isoWeekStart, Q_MINUTES, weekDays } from "./time-shared";

/** The structure version id of the seeded defaults (no saved structure). SQL stores NULL for it. */
export const STRUCTURE_DEFAULTS_ID = "defaults";
export const sqlStructureVersion = (id: string): string | null => (id === STRUCTURE_DEFAULTS_ID ? null : id);
export const tsStructureVersion = (id: string | null): string => id ?? STRUCTURE_DEFAULTS_ID;

export interface ScheduleShopSettings { enabled: boolean; estimatedHourlyCents: number | null; estimatedSalariedWeeklyCents: number | null; agmAccess: "read" | "edit" }
/**
 * Juan 2026-10-16 (decision 2): every hourly employee is at the DC minimum wage, so the shop's hourly estimate starts at
 * $18.40/h (both shops) — the DC rate since Jul 1, 2026; DOES adjusts it every July 1 (the settings card says so, dated).
 * The MoO may edit it; 7shifts wages, once synced, override it per person. The salaried estimate stays BLANK (R2).
 */
export const DC_MINIMUM_WAGE_CENTS = 1840;
export const DC_MINIMUM_WAGE_SINCE = "2026-07-01";
/** No row = OFF, the hourly estimate at the DC minimum wage (decision 2), salaried blank (R2), AGM read-only (R1). */
export const DEFAULT_SCHEDULE_SHOP_SETTINGS: ScheduleShopSettings = Object.freeze({ enabled: false, estimatedHourlyCents: DC_MINIMUM_WAGE_CENTS, estimatedSalariedWeeklyCents: null, agmAccess: "read" });

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
  /**
   * PR SCH (D1, F1): every INHERITED date's stored opening, as its origin revision wrote it, of ANY status (proposed and
   * auto included), for both engines — read from the origin contexts by `loadWeekHeads`. The action handler resolves
   * Accept / Decline / Clear against it; the generator input keeps only the persistent decisions. Kept OUT of
   * `context.days`, whose keys are the head's own built dates (the stations advisory and replay read them). Absent = none.
   */
  inheritedOpenings?: Readonly<Record<string, DayOpening>>;
}
export interface StoredWeek {
  weekStart: string;
  weekId: string | null;
  headRevisionId: string | null;
  approvedRevisionId: string | null;
  head: StoredHead | null;
  /** An 'edited' revision is newer than the newest generated / regenerated one (J12). */
  edited: boolean;
  /** Edited origins without crew provenance are retained, including after regeneration. */
  historicalEditedDates?: string[];
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
  /**
   * B133: 7shifts' weekly overtime pay multiplier for the connected company (`weekly_overtime_multiplier`); absent / null
   * = the default (`DEFAULT_OVERTIME_MULTIPLIER`, 1.5×, DC law). Only the premium's price — never a rule input.
   */
  overtimeMultiplier?: number | null;
  keptBudgetDigests: string[];
  /**
   * Staff separations (0279, 2026-10-20): members who are ON LEAVE (while on leave) or SEPARATED (for good — even if their
   * account was reactivated by mistake). They never reach the generator's roster and their open future pins are ignored;
   * history (past shifts, punches, revisions) is untouched. Absent = nobody (fixtures, and before 0279 is applied).
   */
  employmentExcluded?: string[];
  /**
   * B134: this week's shifts of this shop's members at OTHER shops (their head revisions). The roster narrows each
   * person's availability around them and the validator refuses an overlap (`other_shop_overlap`). Absent = none.
   */
  elsewhere?: ElsewhereShift[];
  /**
   * B134 r1: the other shops' shifts could not be read. `elsewhere` is then EMPTY BUT UNKNOWN — never free time: the
   * board renders, but nothing is generated (`other_shop_check_unavailable`). Absent = the read succeeded.
   */
  elsewhereUnavailable?: boolean;
}

// ─── Small pure readers ──────────────────────────────────────────────────────

/**
 * Astra chunk E P2-4: `user_locations.assigned_at` (an instant) as the OPERATIONAL business date (America/New_York, the
 * same clock the punch dates and `operationalNow` use) — never its UTC date: a Sunday-night ET assignment is Sunday,
 * not Monday. This app assignment date never floors punch history. Null / unparseable → null.
 */
export function memberSinceDate(assignedAt: string | null | undefined): string | null {
  if (!assignedAt) return null;
  const t = Date.parse(assignedAt);
  return Number.isFinite(t) ? operationalNow(new Date(t)).date : null;
}

/** The first clock time in a free-text catering window ("11:30 AM–1 PM", "12pm", "13:00") as a quarter, else null. */
export function eventQFromWindow(text: string | null): number | null {
  if (!text) return null;
  // An ISO instant ("2026-09-08T15:30:00Z") is not a wall-clock label; reading its "20" would be a guess.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text.trim())) return null;
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  let ap = m[3]?.toLowerCase().replace(/\./g, "") ?? null;
  // B028: "1:00–1:30 PM" carries ONE meridiem for the whole range, and only a 12-hour reading (1–12; "13:00" stays
  // 24-hour) borrows it. B028 r1: the borrowed meridiem belongs to the END, so a range that crosses noon or midnight
  // ("11:30–12:00 PM", "11:30–1 PM", "11–12 AM") is resolved from BOTH endpoints: the start takes whichever meridiem
  // makes the range shortest going forward (a tie keeps the end's). A later AM/PM that is not a range end ("1 pickup,
  // done by 2 pm") keeps the old rule: the first AM/PM after the first time governs it.
  if (ap === null && h >= 1 && h <= 12) {
    const rest = text.slice(m.index + m[0].length);
    const end = /^\s*(?:-|\u2013|\u2014|to)\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?![a-z])/i.exec(rest);
    if (end && Number(end[1]) >= 1 && Number(end[1]) <= 12 && Number(end[2] ?? 0) <= 59) {
      const endAp = end[3]!.toLowerCase() === "p" ? "pm" : "am";
      const to24 = (hh: number, a: "am" | "pm") => (hh % 12) + (a === "pm" ? 12 : 0);
      const endMin = to24(Number(end[1]), endAp) * 60 + Number(end[2] ?? 0);
      const span = (a: "am" | "pm") => (endMin - (to24(h, a) * 60 + min) + 1440) % 1440;
      const other = endAp === "pm" ? "am" : "pm";
      ap = span(other) < span(endAp) ? other : endAp;
    } else {
      const later = /\b([ap])\.?m\.?\b/i.exec(rest);
      if (later) ap = later[1]!.toLowerCase() === "p" ? "pm" : "am";
    }
  }
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return Math.floor((h * 60 + min) / 15);
}

/** One current 7shifts wage row of a person (B216). */
export interface ShopWageRow { wage_id: number | string; role_id: number | string | null; wage_type: string; wage_cents: number; effective_date: string | null }

/**
 * B216: the ONE hourly rate a person is priced at for THIS shop. The schedule has no position → 7shifts role mapping,
 * so every hour is priced at one rate, chosen in tiers: (1) a wage of the person's PRIMARY role at this shop's 7shifts
 * location, (2) a wage of any role at that location (`shopRoleIds = null` when the shop has no live 7shifts location
 * link: then any role counts here, as before), (3) a wage with no role. A role at another location is never picked.
 * Within a tier the latest effective date wins — an UNDATED wage is the oldest, never the winner — then the highest
 * wage id. Order-independent. Null = no hourly wage.
 */
export function pickShopWage(rows: readonly ShopWageRow[], opts: { primaryRoleIds: ReadonlySet<string>; shopRoleIds: ReadonlySet<string> | null }): number | null {
  const tier = (r: ShopWageRow): number => {
    if (r.role_id === null || r.role_id === undefined) return 3;
    const role = String(r.role_id);
    if (opts.primaryRoleIds.has(role) && (opts.shopRoleIds === null || opts.shopRoleIds.has(role))) return 1;
    if (opts.shopRoleIds === null || opts.shopRoleIds.has(role)) return 2;
    return 0; // another location's role
  };
  const later = (a: ShopWageRow, b: ShopWageRow): boolean => {
    const da = a.effective_date ?? "";
    const db = b.effective_date ?? "";
    if (da !== db) return da > db;
    const ia = String(a.wage_id);
    const ib = String(b.wage_id);
    return ia.length !== ib.length ? ia.length > ib.length : ia > ib; // digit strings (bigint ids): numeric order
  };
  let best: { row: ShopWageRow; tier: number } | null = null;
  for (const r of rows) {
    if (r.wage_type !== "hourly") continue;
    const t = tier(r);
    if (t === 0) continue;
    if (!best || t < best.tier || (t === best.tier && later(r, best.row))) best = { row: r, tier: t };
  }
  return best ? best.row.wage_cents : null;
}

/** The ezCater orders not already in the pipeline, as booked events (named, never summed). */
export interface EzcaterOrderRow { id: string; event_date: string | null; event_timestamp: string | null; handoff_time: string | null; headcount: number | null; total_cents: number | null; status: string | null }

/** An ezCater order status that means the order is off (the schedule's one rule; the Dashboard reads it too). */
export function ezcaterCancelled(status: string | null): boolean {
  return /cancel/i.test(status ?? "");
}

/** An instant's ET wall-clock quarter of the day (the schedule's rule for an ezCater event timestamp). */
export function etWallQ(iso: string): number {
  const [h, m] = etClockTime(iso).split(":").map(Number);
  return Math.floor((h! * 60 + m!) / Q_MINUTES);
}

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
    if (!o.event_date || ezcaterCancelled(o.status)) continue;
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
 * The person-specific first counted day: the first punch at this shop. App membership is not employment history. The
 * loader reads the punches of the pattern window only: a person who punched in the window's FIRST week is treated as
 * present from before it.
 */
export function firstSeenFor(members: readonly MemberRow[], punches: readonly PunchEntry[], windowStart: string): Record<string, string> {
  const firstPunch = new Map<string, string>();
  for (const p of punches) if (p.userId && !p.deleted) { const c = firstPunch.get(p.userId); if (!c || p.businessDate < c) firstPunch.set(p.userId, p.businessDate); }
  const out: Record<string, string> = {};
  for (const m of members) {
    const fp = firstPunch.get(m.userId);
    const punchFloor = fp && fp >= addDays(windowStart, 7) ? fp : null;
    if (punchFloor) out[m.userId] = punchFloor;
  }
  return out;
}

/** The newest manager override per date (append-only rows; the newest wins). */
export function overrideFor(rows: readonly DayTypeRow[], date: string): { id: string; dayType: DayTypeOverride } | null {
  const mine = rows.filter((r) => r.date === date).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  return mine[0] ? { id: mine[0].id, dayType: mine[0].dayType } : null;
}

/** Missing edit provenance cannot safely be reconstructed from changed shift keys. */
export function historicalCrewDates(week: StoredWeek | undefined): string[] {
  if (!week?.head) return [];
  if (week.historicalEditedDates !== undefined) return week.historicalEditedDates;
  return week.edited ? week.head.days.filter((d) => !week.head!.context.days[d.date]?.crew).map((d) => d.date) : [];
}

/** The head as the generator's snapshot (null when the week has no revision). */
export function headSnapshotFor(week: StoredWeek | undefined): HeadSnapshot | null {
  const h = week?.head;
  if (!h) return null;
  return {
    revisionId: h.revision.id, shifts: h.shifts, days: h.days, gaps: h.gaps, reasons: h.reasons,
    closingWindowByDate: h.context.closingWindowByDate ?? {},
    ...(Object.values(h.context.days).some((d) => d.crew) ? { dayContexts: h.context.days } : {}),
  };
}

// ─── The week's generator input ──────────────────────────────────────────────

/**
 * One week's `GeneratorInput`. `buildDays` = the dates to (re)build; every other date of the week is carried from the
 * head. `today` is the ET business date. Refuses `demand_unavailable` when demand did not load (never a flat curve).
 */
/**
 * PR SCH (F1): a date's stored opening on a head — its own day first, else the inherited origin's — of any status.
 */
export function headOpeningOf(head: Pick<StoredHead, "context" | "inheritedOpenings"> | null | undefined, date: string): DayOpening | undefined {
  return head?.context.days[date]?.opening ?? head?.inheritedOpenings?.[date];
}

export function generatorInputFor(inputs: SchedulingInputs, weekStart: string, opts: {
  today: string; buildDays?: readonly string[]; confirmEdited?: boolean;
  /** PR SCH: `setDayOpening`'s new decision for one date (null = cleared), in place of the head's. */
  openingOverride?: { date: string; decision: OpeningDecision | null };
}): GeneratorInput {
  if (inputs.demand.kind === "unavailable") throw new ScheduleError("demand_unavailable", { params: { cause: inputs.demand.cause } });
  // 7shifts' weekly overtime line, once synced, overrides the structure's default (plan "Data reality").
  const s = inputs.overtimeH === null ? inputs.structure.structure
    : { ...inputs.structure.structure, limits: { ...inputs.structure.structure.limits, overtimeH: inputs.overtimeH } };
  const dates = weekDays(weekStart);
  const preserved = scheduleEngine(s) === "crew" && !opts.confirmEdited ? historicalCrewDates(inputs.weeks[weekStart]) : [];
  const buildDays = (opts.buildDays ?? dates).filter((d) => dates.includes(d) && d >= opts.today && !preserved.includes(d));
  const forecastOf = (date: string): DayForecast | null => (inputs.demand.kind === "unavailable" ? null : inputs.demand.days.find((d) => d.date === date) ?? null);
  const closing = resolveClosingMinutes({ override: s.limits.closingMinutesOverride, measured: inputs.closing });
  const outQ = scheduledOut(s, closing.minutes);
  // PR SCH (D1, F1, F2): each build date's PERSISTENT decision (the head's own day, else its inherited origin; proposed and
  // auto are recomputed), and — resolved BEFORE availability is estimated — the start an applied opening widens the
  // estimated window to.
  const head = inputs.weeks[weekStart]?.head ?? null;
  const decisionOf = (date: string): OpeningDecision | null =>
    opts.openingOverride?.date === date ? opts.openingOverride.decision : toDecision(headOpeningOf(head, date));
  const estimateFromQByDate: Record<string, number> = {};
  const days: BuildDayInput[] = buildDays.map((date) => {
    const f = forecastOf(date);
    const dt = dayTypeFor(date, { override: overrideFor(inputs.dayTypes, date), structure: s, forecast: f });
    const ok = f?.kind === "ok";
    const catering = inputs.catering.filter((e) => e.date === date).map((e) => ({ id: e.id, headcount: e.headcount, eventQ: e.eventQ }));
    const decision = decisionOf(date);
    const opening = resolveOpening(s, catering, decision);
    if (openingApplies(opening)) estimateFromQByDate[date] = opening!.startQ;
    return {
      date, dayType: dt.dayType, dayTypeSource: dt.source, overrideId: dt.overrideId, closingMinutes: closing.minutes, scheduledOutQ: outQ,
      demandKind: ok ? "ok" : "no_history", hourlyCents: ok ? (f as Extract<DayForecast, { kind: "ok" }>).hourlyCents : null,
      dayCents: ok ? (f as Extract<DayForecast, { kind: "ok" }>).dayCents : null, catering, ...(decision ? { decision } : {}),
    };
  });
  const windowStart = addDays(isoWeekStart(inputs.asOf), -56);
  const patterns = punchPatterns(inputs.punches, { asOf: inputs.asOf, firstSeen: firstSeenFor(inputs.members, inputs.punches, windowStart) });
  const skills = makeSkillLookup(inputs.skills, inputs.skillBands);
  const excluded = new Set(inputs.employmentExcluded ?? []);
  const { people } = toSchedPeople({
    members: inputs.members.map((m) => ({ userId: m.userId, role: m.role, active: true })),
    excludedUserIds: [...excluded],
    settings: inputs.personSettings, patterns, dates, structure: s, punches: inputs.punches, asOf: inputs.asOf,
    shopDay: { fromQ: s.shopDay.prepStartQ, toQ: s.shopDay.outLatestQ },
    wages: { byUserCents: inputs.wages.byUserCents, estimateHourlyCents: inputs.shopSettings.estimatedHourlyCents }, skills,
    ...(inputs.elsewhere?.length ? { elsewhere: inputs.elsewhere } : {}),
    ...(Object.keys(estimateFromQByDate).length ? { estimateFromQByDate } : {}),
  });
  // B134: a pin over time the person already holds at another shop is not placed (that shop planned first).
  const busy = (p: { userId: string; date: string; startQ: number; endQ: number }) =>
    (inputs.elsewhere ?? []).some((e) => e.userId === p.userId && e.date === p.date && e.startQ < p.endQ && e.endQ > p.startQ);
  const budget = budgetForDates(inputs.budget.entries, inputs.budget.rows, dates);
  return {
    locationId: inputs.locationId, weekStart, today: opts.today, days, structure: s, structureVersionId: inputs.structure.id, people, skills,
    ...(scheduleEngine(s) === "crew" && inputs.weeks[weekStart]?.head ? { crew: { headContext: inputs.weeks[weekStart]!.head!.context } } : {}),
    pins: inputs.pins.filter((p) => dates.includes(p.date) && !excluded.has(p.userId) && !busy(p)), budgetByDate: budget.byDate, head: headSnapshotFor(inputs.weeks[weekStart]),
  };
}

/** Every date of the given weeks (the loader's demand / catering / budget span). */
export function datesOfWeeks(weekStarts: readonly string[]): string[] {
  return [...new Set(weekStarts.flatMap((w) => weekDays(w)))].sort();
}

export { closingDuration };

/**
 * B134 r1 (CC ruling: Approve is the gate): the shifts of a head that overlap another shop's CURRENT head shifts of the
 * same person, on dates from `fromDate` on (a past day is history and cannot be changed). Pure; sorted.
 */
export function otherShopOverlaps(shifts: ReadonlyArray<{ userId: string; date: string; startQ: number; endQ: number }>, elsewhere: readonly ElsewhereShift[], fromDate: string): Array<{ userId: string; date: string; startQ: number; endQ: number }> {
  const out = shifts.filter((sh) => sh.date >= fromDate && elsewhere.some((e) => e.userId === sh.userId && e.date === sh.date && e.startQ < sh.endQ && e.endQ > sh.startQ))
    .map((sh) => ({ userId: sh.userId, date: sh.date, startQ: sh.startQ, endQ: sh.endQ }));
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0) || a.startQ - b.startQ);
}
