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

/** A labor as serialized (a GM's may lack the money groups the settings do not hold) with every key, the absent
 * ones as "nothing here": what `f` below reads. */
const NOTHING = { pureHourlyCents: null, otPremiumCents: null, pct: null, tone: "none" as const, wageEstimated: false, salariedCents: null, burdenCents: null,
  fullyLoadedCents: null, loadedPct: null, loadedTone: "none" as const, burdenEstimated: false, salaryEstimated: false, salaryGaps: 0 };
const whole = (l: BusinessReportDto["total"]["labor"]): LaborFigures => ({ ...NOTHING, loadedState: l.state, ...l });
/** Every labor figure of `dto` replaced by `f(labor)`, with two quarters per day (sales-only + labor-carrying).
 * The report keeps its `access`: writing a figure into a report whose access does not hold its group must change
 * nothing a surface shows (the view follows the access, never a key). */
export function withLabor<T extends BusinessReportDto>(dto: T, f: (l: LaborFigures) => LaborFigures): T {
  const days = dto.days.map((d) => ({ ...d, labor: f(whole(d.labor)) }));
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
  return { ...dto, days, weeks: dto.weeks.map((w) => ({ ...w, labor: f(whole(w.labor)) })), total: { ...dto.total, labor: f(whole(dto.total.labor)) },
    quarters, quartersUnassigned: [] };
}

const strip = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, "\"");

// ── The marker + legend form (polish, 2026-11-18) ───────────────────────────────────────────────
// A qualification is written ONCE per scope in a legend (`<ul data-legend>`: a mark, then the sentence), and every
// figure it qualifies shows the MARK (`<sup data-marks="a,b">`) and carries the sentence as visually hidden text
// for a screen reader (`<span class="sr-only" data-figure-note>`). The helpers below read that form and PROVE it.

/** Every legend of a markup: mark -> sentence. */
export function legendsOf(markup: string): Array<Map<string, string>> {
  return [...markup.matchAll(/<ul data-legend=""[^>]*>([\s\S]*?)<\/ul>/g)].map((m) =>
    new Map([...m[1]!.matchAll(/<span[^>]*data-mark="([a-z]+)"[^>]*>[^<]*<\/span><span[^>]*>([\s\S]*?)<\/span>/g)].map((e) => [e[1]!, decode(e[2]!)])));
}
/** Every marked figure of a markup: its marks and the sentence it carries for a screen reader. */
export function markedFigures(markup: string): Array<{ marks: string[]; said: string }> {
  return [...markup.matchAll(/<sup[^>]*data-marks="([a-z,]+)"[^>]*>[^<]*<\/sup><span class="sr-only" data-figure-note="">([\s\S]*?)<\/span>/g)]
    .map((m) => ({ marks: m[1]!.split(","), said: decode(m[2]!) }));
}
/** THE PROOF: every mark on every figure names a line of a legend in the same markup, and the sentence that line
 * holds is one the figure itself carries. A mark with no legend line (a dangling footnote), a marked figure with no
 * hidden sentence, or a `<sup>` mark that is not in this form fails by name. */
export function assertMarksResolve(markup: string): void {
  const legends = legendsOf(markup);
  const figures = markedFigures(markup);
  const sups = (markup.match(/<sup\b/g) ?? []).length;
  if (sups !== figures.length) throw new Error(`marker + legend: ${sups} marks on the page, ${figures.length} carry their sentence for a screen reader`);
  for (const f of figures) {
    for (const mark of f.marks) {
      if (!legends.some((l) => l.has(mark) && f.said.includes(l.get(mark)!))) {
        throw new Error(`marker + legend: mark "${mark}" (${f.said.trim()}) has no legend line with that sentence`);
      }
    }
  }
}
/** What a SIGHTED reader sees: the hidden screen-reader sentences removed, so a figure shows its marks and the
 * sentence is where the legend puts it. */
export function sightedText(markup: string): string {
  assertMarksResolve(markup);
  return strip(markup.replace(/<span class="sr-only"[^>]*>[\s\S]*?<\/span>/g, ""));
}
/** What a reader GETS from the page, figure by figure: the text with each figure's qualification said in place
 * (the sentence a screen reader reads at the figure; a sighted reader follows the mark to the same sentence in the
 * legend) — returned only after `assertMarksResolve` proved every mark against its legend. So "this row says X"
 * holds in the marker + legend form exactly when the row's figure is marked with a legend line that says X. */
export function visibleText(markup: string): string {
  assertMarksResolve(markup);
  return strip(markup);
}
export const reasonOf = (s: string) => EN[`reports.business.labor.state.${s}`]!;
