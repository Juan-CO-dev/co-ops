/**
 * Item 9b: THE descriptor of every figure the business report shows — its value, its STATE and why.
 *
 * Fix round 3 (review ITEM9B-r3) made every surface take a `Figure` from the builders below. Fix round 4 (review
 * ITEM9B-r4) closes the class for good: A FIGURE IS OPAQUE. Its number cannot be read from outside this module —
 * `Figure` has no `value` a component or an export can reach (a compile error, pinned in
 * tests/business-report-figure-census.test.ts). A number leaves this module in exactly three forms, and each one
 * carries the state with it:
 *
 *   figureDisplay / figureText   words for the page: the value as its state allows ("so far", "at least",
 *                                "covered days only") or a dash, with the reason and every qualification;
 *   figureCells                  cells for a file: the values AND one `figure_notes` cell naming every figure of the
 *                                row that is not plainly known (`col=kind(codes)`), written by the same call;
 *   figureChange                 this period against the one before: a change only when BOTH figures are whole.
 *
 *   known      — the number, plain.
 *   estimated  — the number, with the estimates behind it named (burden at 12%, the shop's salary estimate, a wage
 *                priced at the shop's estimated rate).
 *   incomplete — a number that is not the whole truth (hours "so far", a sales floor, covered days only, a breakdown
 *                that holds only its ready days, payroll gaps), with why.
 *   unknown    — no number: a dash with the reason. NEVER 0, never "No labor".
 *
 * The page and the export never see the DTO: they get lib/business-view-shared.ts `businessView(dto)`, in which
 * every money, percent, hours and count value is a `Figure`.
 *
 * Pure: zero I/O, client-safe. A new figure on the business report gets a builder here, never a hand format.
 */
import {
  compareChange, laborHoursComplete, laborReasonKey, loadedReasonKey,
  type BUSINESS_REPORT_I18N_KEYS, type BreakdownCoverage, type CompareChange, type LaborFigures, type LaborState,
} from "@/lib/business-report-shared";

export type FigureKind = "known" | "estimated" | "incomplete" | "unknown";
export type FigureUnit = "pct" | "cents" | "minutes" | "count";
export type FigureKey = (typeof BUSINESS_REPORT_I18N_KEYS)[number];
/** A qualification: `estimate` (the figure is shown, built on an estimate) or `gap` (something is missing). */
interface FigureNote { kind: "estimate" | "gap"; key: FigureKey; short: FigureKey; values?: Record<string, number> }

declare const FIGURE: unique symbol;
/** A figure of the business report. Opaque: read it only through figureDisplay / figureText / figureCells /
 * figureChange (and the state readers figureKindOf / figureReasonOf / figureComparable / figureHasNote). */
export interface Figure { readonly [FIGURE]: "figure" }

interface Data {
  unit: FigureUnit;
  value: number | null;
  kind: FigureKind;
  /** Why the figure is unknown or incomplete; null for known / estimated. */
  reason: FigureKey | null;
  notes: readonly FigureNote[];
  /** The value is what is counted SO FAR (hours or money of a week not final). */
  soFar: boolean;
  /** The word for a zero that is final ("No labor"); never set on an incomplete figure. */
  zero?: FigureKey;
  /** A count's own words ("{n} checks"), applied before any qualifier. */
  label?: FigureKey;
  /** Sales: checks / orders of unknown amount behind the value (> 0 = a floor). */
  missing?: number;
  /** Sales: the sum of the covered days only. */
  coveredOnly?: boolean;
  /** A breakdown (channels, servers, large checks): only the days whose breakdown is ready. */
  daysOnly?: boolean;
}
const seal = (d: Data): Figure => d as unknown as Figure;
const open = (f: Figure): Data => f as unknown as Data;

const FALLBACK: FigureKey = "reports.business.figure.not_available";
type Opts = { notes?: readonly FigureNote[]; provisional?: boolean; soFar?: boolean; zero?: FigureKey; label?: FigureKey; missing?: number; coveredOnly?: boolean; daysOnly?: boolean };

function make(unit: FigureUnit, value: number | null | undefined, reason: FigureKey | null, o: Opts = {}): Figure {
  const v = value === undefined ? null : value;
  const notes = o.notes ?? [];
  if (v === null) {
    // An unknown keeps only its gaps (an estimate qualifies a number that is not there).
    return seal({ unit, value: null, kind: "unknown", reason: reason ?? FALLBACK, notes: notes.filter((n) => n.kind === "gap"), soFar: false });
  }
  const provisional = o.provisional ?? false;
  const kind: FigureKind = provisional || notes.some((n) => n.kind === "gap") ? "incomplete" : notes.length > 0 ? "estimated" : "known";
  return seal({
    unit, value: v, kind, reason: provisional ? reason ?? FALLBACK : null, notes, soFar: provisional && (o.soFar ?? true),
    ...(o.zero && kind !== "incomplete" ? { zero: o.zero } : {}), ...(o.label ? { label: o.label } : {}),
    ...(o.missing !== undefined ? { missing: o.missing } : {}), ...(o.coveredOnly ? { coveredOnly: true } : {}), ...(o.daysOnly ? { daysOnly: true } : {}),
  });
}

// ── State readers (never the number) ────────────────────────────────────────────────────────────

export function figureKindOf(f: Figure): FigureKind { return open(f).kind; }
export function figureReasonOf(f: Figure): FigureKey | null { return open(f).reason; }
/** A figure two periods may be compared on: shown and whole (an estimate is whole; a gap or "so far" is not). */
export function figureComparable(f: Figure): boolean { const k = open(f).kind; return k === "known" || k === "estimated"; }
/** Whether a SHOWN figure carries a qualification (`burden_estimated`, `wage_estimated`, ...); null when it is unknown. */
export function figureHasNote(f: Figure, code: string): boolean | null {
  const d = open(f);
  return d.value === null ? null : d.notes.some((n) => codeOf(n.key) === code);
}
/** A count the page branches on ("any large check?", "any overtime?"): true only for a shown value above zero. */
export function figureIsPositive(f: Figure): boolean { const v = open(f).value; return v !== null && v > 0; }

const BURDEN: FigureNote = { kind: "estimate", key: "reports.business.burden_estimated", short: "reports.business.qual.burden_estimated" };
const SALARY: FigureNote = { kind: "estimate", key: "reports.business.salary_estimated", short: "reports.business.qual.salary_estimated" };
/** Fix round 4 (ITEM9B-r4 P2): some hours are priced at the shop's estimated wage. */
const RATE: FigureNote = { kind: "estimate", key: "reports.business.wage_estimated", short: "reports.business.qual.wage_estimated" };
const gaps = (n: number): FigureNote => ({ kind: "gap", key: "reports.business.salary_gaps", short: "reports.business.qual.salary_gaps", values: { n } });
/** Fix round 4 (own sweep): some days' hours are the Toast fallback (7shifts not covered): shown, not confirmed. */
const UNVERIFIED: FigureNote = { kind: "estimate", key: "reports.business.hours_unverified", short: "reports.business.qual.hours_unverified" };
type Provenance = Pick<LaborFigures, "wageEstimated" | "hoursUnverified">;
/** What qualifies a figure built on hourly MONEY: an estimated wage, hours from the unverified fallback. */
const wageNotes = (l: Provenance): FigureNote[] => [...(l.wageEstimated ? [RATE] : []), ...(l.hoursUnverified ? [UNVERIFIED] : [])];
/** What qualifies a figure of HOURS alone. */
const hourNotes = (unverified: boolean): FigureNote[] => (unverified ? [UNVERIFIED] : []);
/** The qualifications of a fully loaded figure (or one of its parts: `salaried` carries no burden and no hourly
 * wage; `burden` is a share of hourly + salaried pay, so it carries the wage and not the salary estimate label). */
function loadedNotes(l: LaborFigures, part: "loaded" | "salaried" | "burden"): FigureNote[] {
  return [
    ...(part !== "salaried" ? wageNotes(l) : []),
    ...(l.burdenEstimated && part !== "salaried" ? [BURDEN] : []),
    ...(l.salaryEstimated && part !== "burden" ? [SALARY] : []),
    ...(l.salaryGaps > 0 ? [gaps(l.salaryGaps)] : []),
  ];
}

// ── Labor ───────────────────────────────────────────────────────────────────────────────────────

/** Pure hourly %: shown only when the state is ok. */
export function purePctFigure(l: LaborFigures): Figure {
  return make("pct", l.pct, laborReasonKey(l.state), { notes: wageNotes(l) });
}
/** Fully loaded %, with its estimates and payroll gaps. */
export function loadedPctFigure(l: LaborFigures): Figure {
  return make("pct", l.loadedPct, loadedReasonKey(l.loadedState), { notes: loadedNotes(l, "loaded") });
}
/** Pure hourly money (straight + overtime premium, the premium alone): "so far" while hours are not final. */
export function pureCentsFigure(l: LaborFigures, field: "pureHourlyCents" | "otPremiumCents"): Figure {
  return make("cents", l[field], laborReasonKey(l.state), { notes: wageNotes(l), provisional: !laborHoursComplete(l.state) });
}
/** Salaried / burden / fully loaded money. */
export function loadedCentsFigure(l: LaborFigures, field: "salariedCents" | "burdenCents" | "fullyLoadedCents"): Figure {
  const part = field === "salariedCents" ? "salaried" : field === "burdenCents" ? "burden" : "loaded";
  return make("cents", l[field], loadedReasonKey(l.loadedState),
    { notes: loadedNotes(l, part), provisional: !laborHoursComplete(l.state) });
}
/** Minutes under a labor state: final, "so far", or unknown with the state's reason. */
export function minutesFigure(minutes: number | null | undefined, state: LaborState, unverified = false): Figure {
  return make("minutes", minutes, laborReasonKey(state), { notes: hourNotes(unverified), provisional: !laborHoursComplete(state) });
}
export function hoursFigure(l: LaborFigures): Figure { return minutesFigure(l.minutes, l.state, l.hoursUnverified); }
export function otHoursFigure(l: LaborFigures): Figure { return minutesFigure(l.otMinutes, l.state, l.hoursUnverified); }
/** Net sales for labor: the exact net, or what is known of it with why it is not exact. */
export function netFigure(l: LaborFigures): Figure {
  const reason = l.denominator.state === "ok" ? null : `reports.business.labor.state.${l.denominator.state}` as const;
  return make("cents", l.denominator.cents, reason, { provisional: l.denominator.state !== "ok", soFar: false });
}
/**
 * Fix round 4 (ITEM9B-r4 P2): one person's straight-time cost. It is money over the same hours as the line above
 * it, so it is "so far" (with the reason) whenever those hours are, and estimated when the range holds hours priced
 * at the shop's estimated wage (the per-person read does not say whose, so every hourly cost is qualified). A cost
 * that is withheld (a week being recounted) or not per person (a salary) is unknown, with that sentence.
 */
export function personCostFigure(cents: number | null | undefined, payClass: string, labor: Pick<LaborFigures, "state"> & Provenance): Figure {
  const withheld: FigureKey = payClass === "hourly" ? "reports.business.people.cost_withheld" : "reports.business.people.salaried_cost";
  if (cents === null || cents === undefined) return make("cents", null, withheld);
  return make("cents", cents, laborReasonKey(labor.state), { notes: wageNotes(labor), provisional: !laborHoursComplete(labor.state) });
}

// ── 15 minutes ──────────────────────────────────────────────────────────────────────────────────

/** A quarter's minutes. No minutes is "No labor" ONLY when the day's hours are final; otherwise unknown. */
export function quarterHoursFigure(minutes: number | null | undefined, dayState: LaborState, unverified = false): Figure {
  if ((minutes ?? 0) === 0) {
    return laborHoursComplete(dayState) ? make("minutes", 0, null, { notes: hourNotes(unverified), zero: "reports.business.hours.no_labor" })
      : make("minutes", null, laborReasonKey(dayState));
  }
  return minutesFigure(minutes, dayState, unverified);
}
/** A quarter's straight-time dollars (MoO+). No minutes on a day whose money is known = $0, never a dash. */
export function quarterCentsFigure(cents: number | null | undefined, minutes: number | null | undefined, day: LaborFigures): Figure {
  if ((cents === null || cents === undefined) && (minutes ?? 0) === 0 && day.pureHourlyCents !== null && laborHoursComplete(day.state)) return make("cents", 0, null);
  return make("cents", cents, laborReasonKey(day.state) ?? "reports.business.labor.state.rebuilding",
    { notes: wageNotes(day), provisional: !laborHoursComplete(day.state) });
}
/** A quarter's straight-time %: the day's reason when its hours are not final, else "no % for this 15 minutes". */
export function quarterPctFigure(pct: number | null | undefined, day: Pick<LaborFigures, "state"> & Provenance): Figure {
  return make("pct", pct, laborHoursComplete(day.state) ? "reports.business.hours.no_pct" : laborReasonKey(day.state), { notes: wageNotes(day) });
}

// ── Sales ───────────────────────────────────────────────────────────────────────────────────────

/** A sales total by its coverage: missing = unknown; partial or with unknown amounts = incomplete (a floor). */
export function salesFigure(sales: { coverage: string; totalCents: number }, missing: number): Figure {
  return coverageFigure("cents", sales.totalCents, sales.coverage, { missing });
}
/**
 * Fix round 4 (ITEM9B-r4 P2): ANY value read from the Sales capture (ezCater's own total and orders, Toast check
 * totals, checks, refunds) by the coverage of its period. No capture = unknown, never 0; part of the period = the
 * covered days only; with `missing` > 0 (checks / orders of unknown amount) = a floor. `unknownReason` names a
 * value that is absent though sales were captured (the exact Toast net).
 */
export function coverageFigure(unit: "cents" | "count", value: number | null, coverage: string,
  o: { missing?: number; label?: FigureKey; missingReason?: FigureKey; unknownReason?: FigureKey } = {}): Figure {
  if (coverage === "missing") return make(unit, null, o.missingReason ?? "reports.business.sales.not_captured");
  if (value === null) return make(unit, null, o.unknownReason ?? FALLBACK);
  const partial = coverage !== "complete";
  const floor = (o.missing ?? 0) > 0;
  return make(unit, value, partial ? "reports.business.coverage.partial" : "reports.business.figure.amount_missing",
    { provisional: partial || floor, soFar: false, label: o.label, coveredOnly: partial, ...(o.missing !== undefined ? { missing: o.missing } : {}) });
}
/**
 * A value of the BREAKDOWN (channels, servers, large checks): it holds only the days whose cuts recomposed. No day
 * ready = unknown (an empty list is not zero); some = the ready days only; all = the value (a floor when checks of
 * unknown amount are behind it).
 */
export function breakdownFigure(unit: "cents" | "count", value: number, days: Pick<BreakdownCoverage, "state">, o: { missing?: number; label?: FigureKey } = {}): Figure {
  if (days.state === "none") return make(unit, null, "reports.business.figure.breakdown_none");
  const partial = days.state !== "complete";
  const floor = (o.missing ?? 0) > 0;
  return make(unit, value, partial ? "reports.business.figure.breakdown_partial" : "reports.business.figure.amount_missing",
    { provisional: partial || floor, soFar: false, label: o.label, daysOnly: partial, ...(o.missing !== undefined ? { missing: o.missing } : {}) });
}
/** A value that is exact when present (a day's own cuts, a rush window); absent = unknown with `reason`. */
export function exactFigure(unit: "cents" | "count", value: number | null | undefined, reason: FigureKey, o: { missing?: number; label?: FigureKey } = {}): Figure {
  const floor = (o.missing ?? 0) > 0;
  return make(unit, value, floor ? "reports.business.figure.amount_missing" : reason,
    { provisional: floor, soFar: false, label: o.label, ...(o.missing !== undefined && o.missing !== null ? { missing: o.missing } : {}) });
}

// ── Out: words ──────────────────────────────────────────────────────────────────────────────────

/** How the caller writes a number and a sentence (the page passes its language's formatters). */
export interface FigureFormat {
  cents(cents: number): string;
  hours(minutes: number): string;
  pct(pct: number): string;
  count(n: number): string;
  t(key: FigureKey, values?: Record<string, string | number>): string;
}
/** The value of a figure as words, qualified as its state demands, or null when it is unknown. */
export function figureValueText(f: Figure, fmt: FigureFormat): string | null {
  const d = open(f);
  if (d.value === null) return null;
  const n = d.missing ?? 0;
  let s: string;
  if (d.unit === "pct") s = fmt.pct(d.value);
  else if (d.unit === "minutes") s = d.value === 0 && d.zero ? fmt.t(d.zero) : fmt.hours(d.value);
  else if (d.unit === "count") s = d.label ? fmt.t(d.label, { n: fmt.count(d.value) }) : fmt.count(d.value);
  // An amount holding checks of unknown amount is a FLOOR: "at least $20.00 + 1 unknown"; with no known cents it is
  // "amount unknown (2 checks)", never $0.00.
  else s = n <= 0 ? fmt.cents(d.value) : d.value === 0 ? fmt.t("reports.business.amount_unknown", { n })
    : fmt.t("reports.business.amount_at_least", { amount: fmt.cents(d.value), n });
  if (d.coveredOnly) s = fmt.t("reports.business.sales_covered_only", { amount: s });
  if (d.daysOnly) s = fmt.t("reports.business.breakdown_days_only", { amount: s });
  if (d.soFar) s = fmt.t("reports.business.hours_so_far", { h: s });
  return s;
}
/** Whether the reason is said beside a SHOWN value: an incomplete figure whose value does not already say it. */
function reasonBesideValue(d: Data): boolean {
  return d.kind === "incomplete" && d.reason !== null && !(((d.missing ?? 0) > 0 || d.daysOnly) && !d.coveredOnly);
}
export interface FigureDisplay { /** The value as words; null = a dash. */ words: string | null; reason: string | null; notes: Array<{ id: string; gap: boolean; text: string }> }
/** A figure for the page: the value (null = a dash), the reason to show, the qualifications. `compact` (a list row)
 * shows the reason only when there is no value, unless `reason: "always"`, and uses the short qualifier words. */
export function figureDisplay(f: Figure, fmt: FigureFormat, o: { compact?: boolean; reason?: "always" } = {}): FigureDisplay {
  const d = open(f);
  const words = figureValueText(f, fmt);
  const show = d.reason !== null && (words === null || ((!o.compact || o.reason === "always") && reasonBesideValue(d)));
  return { words, reason: show ? fmt.t(d.reason!) : null,
    notes: d.notes.map((n) => ({ id: n.key, gap: n.kind === "gap", text: fmt.t(o.compact ? n.short : n.key, n.values) })) };
}
/** One line of text (a collapsed row's summary): the value or "—", then "(reason; qualifications)". `short`
 * uses the compact qualifier words so a phone row stays one or two lines. */
export function figureText(f: Figure, fmt: FigureFormat, o: { short?: boolean } = {}): string {
  const d = open(f);
  const v = figureValueText(f, fmt) ?? "—";
  const parts = [
    ...(d.reason && (d.value === null || reasonBesideValue(d)) ? [fmt.t(d.reason)] : []),
    ...d.notes.map((n) => fmt.t(o.short ? n.short : n.key, n.values)),
  ];
  return parts.length ? `${v} (${parts.join("; ")})` : v;
}

// ── Out: a file's cells ─────────────────────────────────────────────────────────────────────────

const codeOf = (key: string) => key.slice(key.lastIndexOf(".") + 1);
/** Why a figure is not plainly known, as stable codes: how the value is limited, the reason, the qualifications. */
function codesOf(d: Data): string[] {
  return [
    ...(d.soFar ? ["so_far"] : []), ...(d.coveredOnly ? ["covered_days_only"] : []), ...(d.daysOnly ? ["ready_days_only"] : []),
    ...(d.value !== null && (d.missing ?? 0) > 0 ? ["at_least"] : []),
    ...(d.reason ? [codeOf(d.reason)] : []), ...d.notes.map((n) => codeOf(n.key)),
  ];
}
/** The column every business export table ends its figures with. */
export const FIGURE_NOTES_COLUMN = "figure_notes";
/**
 * THE way a figure enters an export row: `{ column: figure }` in, the cells out — each value (EMPTY when unknown,
 * hours for minutes, integer cents for money) and ONE `figure_notes` cell naming every figure of the row that is
 * not plainly known: `pure_hourly_cost=incomplete(so_far,hours_unknown); fully_loaded_pct=estimated(burden_estimated)`.
 * A row is built by one call, so a value can never be written without its state. An absent figure (a GM's cost)
 * writes nothing.
 */
export function figureCells(figures: Record<string, Figure | null | undefined>): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  const notes: string[] = [];
  for (const [column, f] of Object.entries(figures)) {
    if (!f) continue;
    const d = open(f);
    out[column] = d.value === null ? null : d.unit === "minutes" ? d.value / 60 : d.value;
    if (d.kind !== "known") notes.push(`${column}=${d.kind}(${codesOf(d).join(",")})`);
  }
  out[FIGURE_NOTES_COLUMN] = notes.length ? notes.join("; ") : null;
  return out;
}

// ── Out: a change ───────────────────────────────────────────────────────────────────────────────

/** This period vs the one before, decided HERE by the one rule (`compareChange`): a change only when both figures
 * are shown and whole. Money and hours: a whole %, the earlier above zero. A labor %: the difference in points.
 * Anything else (no earlier period, "so far", a floor, covered days only, a payroll gap) is not comparable. */
export function figureChange(cur: Figure, prev: Figure | null): CompareChange {
  const a = open(cur), b = prev === null ? null : open(prev);
  if (b === null || a.unit !== b.unit) return { kind: "not_comparable" };
  return compareChange({ value: a.value, complete: figureComparable(cur) }, { value: b.value, complete: figureComparable(prev!) }, a.unit === "pct" ? "points" : "money");
}
