/**
 * THE BOARD VIEW-MODEL — pure (Scheduling Phase 2, chunk F, Tasks 20–23). `loadBoard` (board.ts) gathers a
 * `BoardSource` (the head week, its per-day validation contexts, names, live budget, the suggestion, the advisory and
 * the actor's permissions); `boardView` turns it into everything the board renders, so the components never re-derive
 * a rule. Every number comes from the board maths (`board-shared`), the labor-target card, team strength and the
 * validator's recorded problems; every line is an i18n KEY + params.
 *
 * MONEY (J1, J9): with `perms.canSeeMoney` false every $-bearing field is ABSENT (not null) — the strip's `money`, the
 * labor % per hour, the labor card's $ lines — and the wages are dropped before any maths runs. Never per person.
 *
 * The board shows the HEAD exactly as saved (the historical contract): a day's coverage reads that day's own stored
 * context; an inherited day with no context still shows its shifts and its recorded problems.
 */
import type { NarrativeLine } from "@/lib/people-narrative";
import type { RoleCode } from "@/lib/roles";
import {
  closingRoleCells, coverageCells, dayTabs, demandCurve, laborPctByHour, modLane, moneyStrip, shopHours,
  type BoardDayInput, type ClosingRoleCell, type CoverageCell, type DayTab, type LaborHour, type ModLaneHour, type MoneyStrip,
} from "./board-shared";
import type { BudgetForDates, BudgetSuggestion } from "./budget-shared";
import type { AdvisoryItem, DayContext, RuleContext, RulePerson } from "./context-shared";
import { laborTarget, type LaborTarget } from "./labor-target-shared";
import { skillOf, type SchedSkillBand, type SkillLookup } from "./people-input-shared";
import { shiftKey, type Reason, type ShiftReasons } from "./reasons-shared";
import { MOD, approvalRefusal, type DayRecord, type DeclaredGap, type RuleProblem, type Shift } from "./rules-shared";
import { strengthWindows, teamStrength, type WindowStrength } from "./strength-shared";
import type { CrewType, PositionRole } from "./structure-shared";
import { positionIds } from "./structure-shared";
import { Q_PER_HOUR, weekDays } from "./time-shared";

export interface BoardPerms {
  canSeeMoney: boolean;
  /** Generate / regenerate / edit / presence / day type / person settings (GM own, MoO+, an AGM with edit access). */
  canEdit: boolean;
  /** Approve the week (GM own, MoO+; Tier B). */
  canApprove: boolean;
  /** The schedule structure (GM own, MoO+; Tier E). */
  canEditStructure: boolean;
  /** The shop switch + wage estimates (MoO+; Tier E). */
  canManageSwitch: boolean;
  /** Set / accept / keep the budget. */
  canBudget: boolean;
}

export interface BoardWeekSource {
  headRevisionId: string;
  approvedRevisionId: string | null;
  edited: boolean;
  /** The structure version the head was built with. */
  structureVersionId: string;
  shifts: Shift[];
  days: DayRecord[];
  gaps: DeclaredGap[];
  /** Stored reasons per shift (`date|user|start`). */
  reasons: Record<string, unknown>;
  /** Each date's OWN validation context (the head's, or its origin revision's); null = none stored. */
  dayContexts: Record<string, DayContext | null>;
  people: Record<string, RulePerson>;
  closingWindowByDate: Record<string, { fromQ: number; toQ: number }>;
}

export interface PositionLabel { name: string; nameEs: string | null; role: PositionRole }

export interface BoardSource {
  locationId: string;
  weekStart: string;
  /** ET business date. */
  today: string;
  /** Whole ISO weeks ahead of today's week (≥ 2 → the confidence note). */
  weeksAhead: number;
  perms: BoardPerms;
  /** The live structure id (the defaults sentinel when none is saved). */
  liveStructureId: string;
  demand: "ok" | "no_history" | "unavailable";
  names: Record<string, string>;
  roles: Record<string, RoleCode>;
  positions: Record<string, PositionLabel>;
  skills: SkillLookup;
  /** Hourly wage cents per user (7shifts, else the shop estimate); dropped unless `canSeeMoney`. */
  wageCentsByUser: Record<string, number | null>;
  shopEstimateHourlyCents: number | null;
  salariedWeeklyCents: number | null;
  forecastWeekCents: number | null;
  /** The LIVE budget for the week's dates. */
  budget: BudgetForDates;
  /** null = not computed (no budget act, or demand did not load). */
  suggestion: BudgetSuggestion | null;
  advisory: AdvisoryItem[];
  week: BoardWeekSource | null;
}

export type BannerTone = "info" | "warn" | "danger";
export interface BoardBanner { id: string; line: NarrativeLine; tone: BannerTone }

export interface ProblemLine { code: string; severity: RuleProblem["severity"]; date: string; userId: string | null; positionId: string | null; q: number | null; line: NarrativeLine; inherited: boolean }

export interface GapLine {
  date: string;
  code: DeclaredGap["code"];
  positionId: string | null;
  fromQ: number;
  toQ: number;
  cause: DeclaredGap["cause"];
  /** The certificate, as the board words it. */
  line: NarrativeLine;
  /** amber = budget_limited / unresolved_search (a manager may find one); gap = a proven cause. */
  tone: "amber" | "gap";
  blocksApprove: boolean;
  inherited: boolean;
  candidateIds: string[];
}

export interface SegmentView { positionId: string; startQ: number; endQ: number; mod: boolean; lastResort: boolean; reasons: Reason[] }
export interface ShiftView {
  ref: { date: string; userId: string; startQ: number };
  startQ: number;
  endQ: number;
  closingManager: boolean;
  flex: boolean;
  pinned: boolean;
  locked: boolean;
  segments: SegmentView[];
  reasons: Reason[];
  alternates: Array<{ userId: string; band: SchedSkillBand }>;
}
export interface PersonRowView {
  userId: string;
  name: string;
  role: RoleCode | null;
  salaried: boolean;
  presenceOnly: boolean;
  weekHours: number;
  otRisk: boolean;
  shifts: ShiftView[];
  assumedAvailability: boolean;
  startingPoint: boolean;
  /** The worked skill profile as BANDS on the positions they may work (no number, no wage). */
  profile: Array<{ positionId: string; band: SchedSkillBand }>;
}

export interface DayView {
  date: string;
  locked: boolean;
  inherited: boolean;
  dayType: CrewType | null;
  demandKind: "ok" | "no_history" | null;
  hours: number[];
  /** The demand curve as RELATIVE heights 0..1 (no $); `centsByHour` only with money permission. */
  curve: Array<{ hour: number; level: number }> | null;
  centsByHour?: Array<{ hour: number; cents: number }>;
  laborByHour: LaborHour[] | null;
  coverage: CoverageCell[];
  positionOrder: string[];
  mod: ModLaneHour[];
  closing: ClosingRoleCell[];
  strength: Array<Omit<WindowStrength, "mean">>;
  labor: LaborTarget | null;
  rows: PersonRowView[];
  notes: NarrativeLine[];
  gaps: GapLine[];
  /** The day's structure limits the editor needs (segment minimum, shop day bounds). */
  bounds: { fromQ: number; toQ: number; segmentMinQ: number } | null;
}

export interface BoardView {
  locationId: string;
  weekStart: string;
  today: string;
  dates: string[];
  weeksAhead: number;
  perms: BoardPerms;
  banners: BoardBanner[];
  generate: { disabled: boolean; expectedHead: string | null; edited: boolean };
  week: { headRevisionId: string; approved: boolean; edited: boolean } | null;
  strip: MoneyStrip | null;
  budgetLines: NarrativeLine[];
  suggestion: BudgetSuggestion | null;
  advisory: NarrativeLine[];
  tabs: DayTab[];
  days: DayView[];
  rules: { fresh: ProblemLine[]; inherited: ProblemLine[] };
  gaps: GapLine[];
  approve: { allowed: boolean; refusal: "unresolved_gaps" | "rules_failing" | "forbidden" | "no_week" | "approved" | null };
  names: Record<string, string>;
  positions: Record<string, PositionLabel>;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const isHourly = (p: RulePerson | undefined) => !!p && !p.salaried && !p.presenceOnly;

// ─── Gaps ────────────────────────────────────────────────────────────────────

/** The certificate as the board words it (CC chunk D design ruling: "Over budget: needs at least ~W h (best fill found)"). */
export function gapLine(g: DeclaredGap): NarrativeLine {
  switch (g.cause) {
    case "budget_limited": return { key: "schedule.gap.certificate.budget_limited", params: { fillHours: g.certificate.fillHours, remainingHours: g.certificate.remainingHours } };
    case "floor_limit": return { key: "schedule.gap.certificate.floor_limit", params: { limitH: g.certificate.limitH } };
    case "capacity": return { key: "schedule.gap.certificate.capacity", params: { requiredHeads: g.certificate.requiredHeads, people: g.certificate.people, shortBy: g.certificate.shortBy } };
    case "structure": {
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(g.certificate.detail)) if (typeof v === "number" || typeof v === "string") params[k] = v;
      return { key: `schedule.gap.structure.${g.certificate.rule}`, params };
    }
    case "unresolved_search": return { key: "schedule.gap.certificate.unresolved_search" };
    default: return { key: `schedule.gap.certificate.${g.cause}` };
  }
}

function gapLines(week: BoardWeekSource): GapLine[] {
  const inheritedDates = new Set(week.days.filter((d) => d.inherited).map((d) => d.date));
  return week.gaps.map((g) => ({
    date: g.date, code: g.code, positionId: g.positionId, fromQ: g.fromQ, toQ: g.toQ, cause: g.cause, line: gapLine(g),
    tone: g.cause === "budget_limited" || g.cause === "unresolved_search" ? "amber" as const : "gap" as const,
    blocksApprove: g.cause === "unresolved_search", inherited: inheritedDates.has(g.date),
    candidateIds: g.cause === "unresolved_search" ? [...g.certificate.candidateIds] : [],
  })).sort((a, b) => cmp(a.date, b.date) || a.fromQ - b.fromQ || cmp(a.positionId ?? "", b.positionId ?? ""));
}

// ─── Problems ────────────────────────────────────────────────────────────────

function problemLines(week: BoardWeekSource): ProblemLine[] {
  const out: ProblemLine[] = [];
  for (const d of [...week.days].sort((a, b) => cmp(a.date, b.date))) {
    for (const p of d.problems) {
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(p.params)) if (typeof v === "number" || typeof v === "string") params[k] = v;
      out.push({ code: p.code, severity: p.severity, date: p.day, userId: p.userId ?? null, positionId: p.positionId ?? null, q: p.q ?? null,
        line: { key: `schedule.rule.${p.code}`, params }, inherited: d.inherited || p.inherited });
    }
  }
  return out;
}

// ─── Reasons ─────────────────────────────────────────────────────────────────

const isReason = (r: unknown): r is Reason => !!r && typeof r === "object" && typeof (r as Reason).key === "string";
function storedReasons(raw: unknown): ShiftReasons {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<ShiftReasons>;
  return {
    shift: Array.isArray(o.shift) ? o.shift.filter(isReason) : [],
    segments: Array.isArray(o.segments) ? o.segments.map((s) => (Array.isArray(s) ? s.filter(isReason) : [])) : [],
    alternates: Array.isArray(o.alternates) ? o.alternates.filter((a) => a && typeof a.userId === "string") : [],
  };
}

// ─── Days ────────────────────────────────────────────────────────────────────

function ruleContext(src: BoardSource, week: BoardWeekSource): RuleContext {
  const days: Record<string, DayContext> = {};
  for (const [d, c] of Object.entries(week.dayContexts)) if (c) days[d] = c;
  return {
    version: 1, locationId: src.locationId, weekStart: src.weekStart, today: src.today, dates: weekDays(src.weekStart), days,
    budgetByDate: src.budget.byDate, closingWindowByDate: week.closingWindowByDate, people: week.people,
  };
}

function assumed(p: RulePerson | undefined, date: string): boolean {
  const w = p?.availability[date];
  return !!w && (w.source === "toast_pattern" || w.source === "insufficient_history");
}

function rowsFor(src: BoardSource, week: BoardWeekSource, date: string, ctx: DayContext | null, weekQ: Map<string, number>, wages: Record<string, number | null>): PersonRowView[] {
  void wages;
  const locked = date < src.today;
  const day = week.shifts.filter((sh) => sh.date === date);
  const users = [...new Set(day.map((sh) => sh.userId))];
  const overtimeH = ctx?.structure.limits.overtimeH ?? 40;
  const rows = users.map((userId): PersonRowView => {
    const p = week.people[userId];
    const mine = day.filter((sh) => sh.userId === userId).sort((a, b) => a.startQ - b.startQ);
    const s = ctx?.structure;
    const shifts = mine.map((sh): ShiftView => {
      const r = storedReasons(week.reasons[shiftKey(sh.date, sh.userId, sh.startQ)]);
      return {
        ref: { date: sh.date, userId: sh.userId, startQ: sh.startQ }, startQ: sh.startQ, endQ: sh.endQ, closingManager: sh.closingManager, flex: sh.flex, pinned: sh.pinned, locked,
        segments: sh.segments.map((g, i) => ({ positionId: g.positionId, startQ: g.startQ, endQ: g.endQ, mod: g.positionId === MOD, lastResort: !!g.lastResort, reasons: r.segments[i] ?? [] })),
        reasons: r.shift,
        alternates: r.alternates.map((a) => {
          const ap = week.people[a.userId];
          const pos = sh.segments[0] && s ? s.positions[sh.segments[0].positionId] : undefined;
          return { userId: a.userId, band: ap && sh.segments[0] ? skillOf(src.skills, ap, sh.segments[0].positionId, pos).band : "unproven" as SchedSkillBand };
        }),
      };
    });
    const profile = p && s ? positionIds(s).filter((id) => skillOf(src.skills, p, id, s.positions[id]).value > 0)
      .map((id) => ({ positionId: id, band: skillOf(src.skills, p, id, s.positions[id]).band })) : [];
    const startingPoint = !!p && !!s && mine.some((sh) => sh.segments.some((g) => g.positionId !== MOD && skillOf(src.skills, p, g.positionId, s.positions[g.positionId]).band === "unproven"));
    const hours = (weekQ.get(userId) ?? 0) / Q_PER_HOUR;
    return {
      userId, name: src.names[userId] ?? userId, role: p?.role ?? src.roles[userId] ?? null, salaried: !!p?.salaried, presenceOnly: !!p?.presenceOnly,
      weekHours: hours, otRisk: isHourly(p) && hours > overtimeH, shifts, assumedAvailability: assumed(p, date), startingPoint, profile,
    };
  });
  return rows.sort((a, b) => (a.shifts[0]?.startQ ?? 0) - (b.shifts[0]?.startQ ?? 0) || cmp(a.name, b.name) || cmp(a.userId, b.userId));
}

function dayView(src: BoardSource, week: BoardWeekSource, date: string, weekQ: Map<string, number>, wages: Record<string, number | null>, gaps: GapLine[]): DayView {
  const ctx = week.dayContexts[date] ?? null;
  const record = week.days.find((d) => d.date === date);
  const money = src.perms.canSeeMoney;
  const shifts = week.shifts.filter((sh) => sh.date === date);
  const notes: NarrativeLine[] = [];
  if (ctx?.inputs.demandKind === "no_history") notes.push({ key: "schedule.note.no_history" });
  if (ctx?.need.shapeNote === "zero_demand") notes.push({ key: "schedule.note.zero_demand" });
  if (ctx?.need.shapeNote === "zero_profile") notes.push({ key: "schedule.note.zero_profile" });
  const base = {
    date, locked: date < src.today, inherited: !!record?.inherited, dayType: ctx?.dayType ?? null, demandKind: ctx?.inputs.demandKind ?? null,
    rows: rowsFor(src, week, date, ctx, weekQ, wages), notes, gaps: gaps.filter((g) => g.date === date),
  };
  if (!ctx) {
    return { ...base, hours: [], curve: null, laborByHour: null, coverage: [], positionOrder: [], mod: [], closing: [], strength: [], labor: null, bounds: null };
  }
  const input: BoardDayInput = { date, day: ctx, shifts, people: week.people, skills: src.skills, wageCentsByUser: wages };
  const curve = demandCurve(input);
  const peak = curve ? Math.max(0, ...curve.map((c) => c.cents)) : 0;
  const s = ctx.structure;
  const strength = teamStrength(week.shifts, date, week.people, s, src.skills, ctx.dayType, ctx.scheduledOutQ).map(({ mean: _mean, ...w }) => w);
  const labor = laborTarget({
    date, demand: src.demand === "unavailable" && ctx.inputs.demandKind !== "ok" ? { kind: "unavailable" }
      : ctx.inputs.demandKind === "ok" && ctx.inputs.hourlyCents && ctx.inputs.dayCents !== null ? { kind: "ok", hourlyCents: ctx.inputs.hourlyCents, dayCents: ctx.inputs.dayCents } : { kind: "no_history" },
    structure: s, need: ctx.need, windows: strengthWindows(s, ctx.dayType, ctx.scheduledOutQ).map((w) => ({ key: w.key, fromQ: w.fromQ, toQ: w.toQ })),
    shifts, people: week.people, wageCentsByUser: wages, shopEstimateHourlyCents: money ? src.shopEstimateHourlyCents : null,
    salariedWeeklyCents: money ? src.salariedWeeklyCents : null, weekForecastCents: src.forecastWeekCents,
  }, { canSeeMoney: money });
  return {
    ...base,
    hours: shopHours(ctx),
    curve: curve ? curve.map((c) => ({ hour: c.hour, level: peak > 0 ? round2(c.cents / peak) : 0 })) : null,
    ...(money && curve ? { centsByHour: curve } : {}),
    laborByHour: laborPctByHour(input, { canSeeMoney: money }),
    coverage: coverageCells(input),
    positionOrder: positionIds(s),
    mod: modLane(input),
    closing: closingRoleCells(input),
    strength,
    labor,
    bounds: { fromQ: s.shopDay.prepStartQ, toQ: ctx.scheduledOutQ, segmentMinQ: s.limits.segmentMinQ },
  };
}

// ─── The view ────────────────────────────────────────────────────────────────

export function boardView(src: BoardSource): BoardView {
  const money = src.perms.canSeeMoney;
  // J1: wages never enter the maths of an actor who may not see money.
  const wages: Record<string, number | null> = money ? src.wageCentsByUser : {};
  const dates = weekDays(src.weekStart);
  const week = src.week;
  const banners: BoardBanner[] = [];
  if (src.demand === "unavailable") banners.push({ id: "demand_unavailable", tone: "danger", line: { key: "schedule.board.banner.demand_unavailable" } });
  if (week && src.liveStructureId !== week.structureVersionId) banners.push({ id: "settings_changed", tone: "warn", line: { key: "schedule.board.banner.settings_changed" } });
  if (src.weeksAhead >= 2) banners.push({ id: "further_out", tone: "info", line: { key: "schedule.board.banner.further_out" } });
  if (week && (src.demand === "no_history" || Object.values(week.dayContexts).some((c) => c?.inputs.demandKind === "no_history"))) {
    banners.push({ id: "no_history", tone: "info", line: { key: "schedule.note.no_history" } });
  }
  if (week && week.shifts.some((sh) => assumed(week.people[sh.userId], sh.date))) {
    banners.push({ id: "assumed_availability", tone: "info", line: { key: "schedule.board.flag.assumed_availability" } });
  }

  const advisory: NarrativeLine[] = src.advisory.map((a) => ({
    key: `schedule.board.advisory.${a.code}`,
    params: { ...Object.fromEntries(Object.entries(a.params).map(([k, v]) => [k, v === null ? "—" : v])), ...(a.date ? { date: a.date } : {}), ...(a.userId ? { userId: a.userId } : {}) },
  }));

  if (!week) {
    return {
      locationId: src.locationId, weekStart: src.weekStart, today: src.today, dates, weeksAhead: src.weeksAhead, perms: src.perms, banners,
      generate: { disabled: src.demand === "unavailable" || !src.perms.canEdit, expectedHead: null, edited: false },
      week: null, strip: null, budgetLines: src.budget.lines, suggestion: src.perms.canBudget ? src.suggestion : null, advisory: [],
      tabs: dates.map((date) => ({ date, dayType: null, locked: date < src.today })), days: [],
      rules: { fresh: [], inherited: [] }, gaps: [], approve: { allowed: false, refusal: "no_week" }, names: src.names, positions: src.positions,
    };
  }

  const ctx = ruleContext(src, week);
  const weekQ = new Map<string, number>();
  for (const sh of week.shifts) weekQ.set(sh.userId, (weekQ.get(sh.userId) ?? 0) + (sh.endQ - sh.startQ));
  const strip = moneyStrip({ dates, shifts: week.shifts, ctx, wageCentsByUser: wages, forecastWeekCents: money ? src.forecastWeekCents : null, salariedWeeklyCents: money ? src.salariedWeeklyCents : null }, { canSeeMoney: money });
  const gaps = gapLines(week);
  const problems = problemLines(week);
  const headProblems: RuleProblem[] = week.days.flatMap((d) => d.problems.map((p) => ({ ...p, inherited: d.inherited || p.inherited })));
  const refusal = approvalRefusal({ locationId: src.locationId, weekStart: src.weekStart, shifts: week.shifts, gaps: week.gaps, days: week.days }, headProblems);
  const approved = week.approvedRevisionId === week.headRevisionId;
  const approveRefusal = !src.perms.canApprove ? "forbidden" as const : refusal ?? (approved ? "approved" as const : null);
  return {
    locationId: src.locationId, weekStart: src.weekStart, today: src.today, dates, weeksAhead: src.weeksAhead, perms: src.perms, banners,
    generate: { disabled: src.demand === "unavailable" || !src.perms.canEdit, expectedHead: week.headRevisionId, edited: week.edited },
    week: { headRevisionId: week.headRevisionId, approved, edited: week.edited },
    strip, budgetLines: src.budget.lines, suggestion: src.perms.canBudget ? src.suggestion : null, advisory,
    tabs: dayTabs({ dates, today: src.today, ctx, shifts: week.shifts, wageCentsByUser: wages }, { canSeeMoney: money }),
    days: dates.map((d) => dayView(src, week, d, weekQ, wages, gaps)),
    rules: { fresh: problems.filter((p) => !p.inherited), inherited: problems.filter((p) => p.inherited) },
    gaps,
    approve: { allowed: approveRefusal === null, refusal: approveRefusal },
    names: src.names, positions: src.positions,
  };
}
