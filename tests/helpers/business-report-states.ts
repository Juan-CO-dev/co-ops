// Item 9b fix round 3 (review ITEM9B-r3): every labor state the pure core can return, as a DTO in which every
// day / week / total carries that state, plus quarters with a sales-only and a labor-carrying slot per day.
// Shared by tests/business-report-9b-r3.test.ts (drawers open) and tests/business-report-9b-r3-closed.test.ts
// (the real CollapsibleSection, closed).
import en from "@/lib/i18n/en.json";
import type { BusinessReportDto } from "@/lib/business-report";
import { laborHoursComplete, type LaborFigures, type LaborState, type LoadedState } from "@/lib/business-report-shared";

export const EN = en as Record<string, string>;

/** Every pure-hourly state (`LaborState`), the denominator states included. */
export const PURE_STATES: readonly LaborState[] = [
  "ok", "rebuilding", "unbuilt", "before_history", "hours_unknown", "sales_not_covered", "net_unknown", "ezcater_missing", "zero_sales",
];
/** The variants of the fully loaded figure on top of a known pure hourly one. */
export const LOADED_VARIANTS = ["known", "estimated", "salary_incomplete", "salary_unknown"] as const;
export type LoadedVariant = (typeof LOADED_VARIANTS)[number];

const BLOCKED: readonly LaborState[] = ["rebuilding", "unbuilt", "before_history"];

/** Labor figures shaped exactly as lib/business-report-shared.ts `figures` / `withheld` return them for `state`. */
export function laborIn(base: LaborFigures, state: LaborState): LaborFigures {
  const common = { ...base, state, burdenEstimated: false, salaryEstimated: false, salaryGaps: 0, tone: "none" as const, loadedTone: "none" as const };
  if (BLOCKED.includes(state)) {
    return { ...common, minutes: state === "before_history" ? null : 300, pureHourlyCents: null, otPremiumCents: null, otMinutes: null, pct: null,
      loadedState: state, salariedCents: null, burdenCents: null, fullyLoadedCents: null, loadedPct: null };
  }
  const money = { minutes: 300, pureHourlyCents: 5_000, otPremiumCents: 0, otMinutes: 0, salariedCents: 2_000, burdenCents: 600, fullyLoadedCents: 7_600 };
  if (state === "ok") return { ...common, ...money, pct: 20, loadedState: "ok", loadedPct: 30.4, tone: "watch", loadedTone: "high" };
  return { ...common, ...money, pct: null, loadedState: state, loadedPct: null };
}
export function loadedIn(base: LaborFigures, v: LoadedVariant): LaborFigures {
  const ok = laborIn(base, "ok");
  if (v === "known") return ok;
  if (v === "estimated") return { ...ok, burdenEstimated: true, salaryEstimated: true, salaryGaps: 2 };
  return { ...ok, loadedState: v as LoadedState, salariedCents: null, burdenCents: null, fullyLoadedCents: null, loadedPct: null,
    salaryGaps: v === "salary_incomplete" ? 2 : 0 };
}

/** Every labor figure of `dto` replaced by `f(labor)`, with two quarters per day (sales-only + labor-carrying). */
export function withLabor(dto: BusinessReportDto, f: (l: LaborFigures) => LaborFigures): BusinessReportDto {
  const days = dto.days.map((d) => ({ ...d, labor: f(d.labor) }));
  const quarters = days.flatMap((d, i) => {
    const complete = laborHoursComplete(d.labor.state);
    const at = (h: number) => new Date(Date.parse(`${d.date}T${String(h).padStart(2, "0")}:00:00Z`)).toISOString();
    const q = { date: d.date, wallQuarter: 0, fold: 0, basis: "toast_only_straight_time" as const, tone: "none" as const, amountMissing: 0 };
    return [
      // A quarter with sales and no labor row (the reviewer's sales-only quarter).
      { ...q, quarterStartAt: at(15), wallQuarter: 44 + i, checks: 3, toastCents: 4_500, laborMinutes: null, straightCents: null, pct: null },
      // A quarter carrying labor minutes (provisional unless the day's hours are final).
      { ...q, quarterStartAt: at(16), wallQuarter: 48 + i, checks: 2, toastCents: 3_000, laborMinutes: 45,
        straightCents: d.labor.pureHourlyCents === null ? null : 1_400, pct: complete && d.labor.state === "ok" ? 12.5 : null },
    ];
  });
  return { ...dto, days, weeks: dto.weeks.map((w) => ({ ...w, labor: f(w.labor) })), total: { ...dto.total, labor: f(dto.total.labor) },
    quarters, quartersUnassigned: [] };
}

/** What a sighted reader sees: markup with every tag (and so every attribute) removed. */
export function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
}
export const reasonOf = (s: string) => EN[`reports.business.labor.state.${s}`]!;
