/**
 * Item 9b fix round 3 (review ITEM9B-r3): THE descriptor of every figure the business report shows — its value,
 * its STATE and why. Three review rounds found the same defect in a new place each time (an unknown shown as a
 * plain number, "No labor", or a fully loaded % without its estimate labels), because every surface decided for
 * itself how to qualify a number. Now no surface decides: the page (every tab, card, collapsed summary row and
 * drawer, components/reports-business) and the export (lib/report-export-shared.ts) take a `Figure` from the
 * builders below and render it through one formatter (BusinessParts `FigureView` / `figureText`).
 *
 *   known      — the number, plain.
 *   estimated  — the number, with the estimates behind it named (burden at 12%, salary from the shop's estimate).
 *   incomplete — a number that is not the whole truth (hours "so far", a sales floor, payroll gaps), with why.
 *   unknown    — no number: a dash with the reason. NEVER 0, never "No labor".
 *
 * Pure: zero I/O, client-safe. A new figure on the business report gets a builder here, never a hand format.
 */
import {
  laborHoursComplete, laborReasonKey, loadedReasonKey, type BUSINESS_REPORT_I18N_KEYS, type LaborFigures, type LaborState,
} from "@/lib/business-report-shared";

export type FigureKind = "known" | "estimated" | "incomplete" | "unknown";
export type FigureUnit = "pct" | "cents" | "minutes";
export type FigureKey = (typeof BUSINESS_REPORT_I18N_KEYS)[number];
/** A qualification: `estimate` (the figure is shown, built on an estimate) or `gap` (something is missing). */
export interface FigureNote { kind: "estimate" | "gap"; key: FigureKey; short: FigureKey; values?: Record<string, number> }
export interface Figure {
  unit: FigureUnit;
  value: number | null;
  kind: FigureKind;
  /** Why the figure is unknown or incomplete; null for known / estimated. */
  reason: FigureKey | null;
  notes: readonly FigureNote[];
  /** The value is what is counted SO FAR (hours or money of a week not final). */
  soFar: boolean;
  /** The word for a KNOWN zero ("No labor"); only ever set on a known figure. */
  zero?: FigureKey;
  /** Sales: checks / orders of unknown amount behind the value (> 0 = a floor). */
  missing?: number;
  /** Sales: the sum of the covered days only. */
  coveredOnly?: boolean;
}

const FALLBACK: FigureKey = "reports.business.figure.not_available";

function make(unit: FigureUnit, value: number | null | undefined, reason: FigureKey | null,
  o: { notes?: readonly FigureNote[]; provisional?: boolean; soFar?: boolean; zero?: FigureKey; missing?: number; coveredOnly?: boolean } = {}): Figure {
  const v = value === undefined ? null : value;
  const notes = o.notes ?? [];
  if (v === null) {
    // An unknown keeps only its gaps (an estimate qualifies a number that is not there).
    return { unit, value: null, kind: "unknown", reason: reason ?? FALLBACK, notes: notes.filter((n) => n.kind === "gap"), soFar: false };
  }
  const provisional = o.provisional ?? false;
  const kind: FigureKind = provisional || notes.some((n) => n.kind === "gap") ? "incomplete" : notes.length > 0 ? "estimated" : "known";
  return {
    unit, value: v, kind, reason: provisional ? reason ?? FALLBACK : null, notes, soFar: provisional && (o.soFar ?? true),
    ...(o.zero && kind === "known" ? { zero: o.zero } : {}),
    ...(o.missing !== undefined ? { missing: o.missing } : {}), ...(o.coveredOnly ? { coveredOnly: true } : {}),
  };
}
export function figureKindOf(f: Figure): FigureKind { return f.kind; }
/** A figure two periods may be compared on: shown and whole (an estimate is whole; a gap or "so far" is not). */
export function figureComparable(f: Figure): boolean { return f.kind === "known" || f.kind === "estimated"; }

const BURDEN: FigureNote = { kind: "estimate", key: "reports.business.burden_estimated", short: "reports.business.qual.burden_estimated" };
const SALARY: FigureNote = { kind: "estimate", key: "reports.business.salary_estimated", short: "reports.business.qual.salary_estimated" };
const gaps = (n: number): FigureNote => ({ kind: "gap", key: "reports.business.salary_gaps", short: "reports.business.qual.salary_gaps", values: { n } });
/** The qualifications of a fully loaded figure (or one of its parts: `salaried` carries no burden, `burden` no salary). */
function loadedNotes(l: LaborFigures, part: "loaded" | "salaried" | "burden"): FigureNote[] {
  return [
    ...(l.burdenEstimated && part !== "salaried" ? [BURDEN] : []),
    ...(l.salaryEstimated && part !== "burden" ? [SALARY] : []),
    ...(l.salaryGaps > 0 ? [gaps(l.salaryGaps)] : []),
  ];
}

// ── Labor ───────────────────────────────────────────────────────────────────────────────────────

/** Pure hourly %: shown only when the state is ok. */
export function purePctFigure(l: LaborFigures): Figure {
  return make("pct", l.pct, laborReasonKey(l.state));
}
/** Fully loaded %, with its estimates and payroll gaps. */
export function loadedPctFigure(l: LaborFigures): Figure {
  return make("pct", l.loadedPct, loadedReasonKey(l.loadedState), { notes: loadedNotes(l, "loaded") });
}
/** Pure hourly money (straight + overtime premium, the premium alone): "so far" while hours are not final. */
export function pureCentsFigure(l: LaborFigures, field: "pureHourlyCents" | "otPremiumCents"): Figure {
  return make("cents", l[field], laborReasonKey(l.state), { provisional: !laborHoursComplete(l.state) });
}
/** Salaried / burden / fully loaded money. */
export function loadedCentsFigure(l: LaborFigures, field: "salariedCents" | "burdenCents" | "fullyLoadedCents"): Figure {
  const part = field === "salariedCents" ? "salaried" : field === "burdenCents" ? "burden" : "loaded";
  return make("cents", l[field], loadedReasonKey(l.loadedState),
    { notes: loadedNotes(l, part), provisional: !laborHoursComplete(l.state) });
}
/** Minutes under a labor state: final, "so far", or unknown with the state's reason. */
export function minutesFigure(minutes: number | null | undefined, state: LaborState): Figure {
  return make("minutes", minutes, laborReasonKey(state), { provisional: !laborHoursComplete(state) });
}
export function hoursFigure(l: LaborFigures): Figure { return minutesFigure(l.minutes, l.state); }
export function otHoursFigure(l: LaborFigures): Figure { return minutesFigure(l.otMinutes, l.state); }
/** Net sales for labor: the exact net, or what is known of it with why it is not exact. */
export function netFigure(l: LaborFigures): Figure {
  const reason = l.denominator.state === "ok" ? null : `reports.business.labor.state.${l.denominator.state}` as const;
  return make("cents", l.denominator.cents, reason, { provisional: l.denominator.state !== "ok", soFar: false });
}

// ── 15 minutes ──────────────────────────────────────────────────────────────────────────────────

/** A quarter's minutes. No minutes is "No labor" ONLY when the day's hours are final; otherwise unknown. */
export function quarterHoursFigure(minutes: number | null | undefined, dayState: LaborState): Figure {
  if ((minutes ?? 0) === 0) {
    return laborHoursComplete(dayState) ? make("minutes", 0, null, { zero: "reports.business.hours.no_labor" }) : make("minutes", null, laborReasonKey(dayState));
  }
  return minutesFigure(minutes, dayState);
}
/** A quarter's straight-time dollars (MoO+). No minutes on a day whose money is known = $0, never a dash. */
export function quarterCentsFigure(cents: number | null | undefined, minutes: number | null | undefined, day: LaborFigures): Figure {
  if ((cents === null || cents === undefined) && (minutes ?? 0) === 0 && day.pureHourlyCents !== null && laborHoursComplete(day.state)) return make("cents", 0, null);
  return make("cents", cents, laborReasonKey(day.state) ?? "reports.business.labor.state.rebuilding", { provisional: !laborHoursComplete(day.state) });
}
/** A quarter's straight-time %: the day's reason when its hours are not final, else "no % for this 15 minutes". */
export function quarterPctFigure(pct: number | null | undefined, dayState: LaborState): Figure {
  return make("pct", pct, laborHoursComplete(dayState) ? "reports.business.hours.no_pct" : laborReasonKey(dayState));
}

// ── Sales ───────────────────────────────────────────────────────────────────────────────────────

/** A sales total by its coverage: missing = unknown; partial or with unknown amounts = incomplete (a floor). */
export function salesFigure(sales: { coverage: string; totalCents: number }, missing: number): Figure {
  if (sales.coverage === "missing") return make("cents", null, "reports.business.sales.not_captured");
  const partial = sales.coverage !== "complete" || missing > 0;
  return make("cents", sales.totalCents, sales.coverage !== "complete" ? "reports.business.coverage.partial" : "reports.business.figure.amount_missing",
    { provisional: partial, soFar: false, missing, coveredOnly: sales.coverage !== "complete" });
}
