import { operationalDayUtcRange } from "@/lib/operational-day";

export type ReportGrain = "day" | "week" | "month";
export interface ReportRange { range: string; from: string; to: string; compare: boolean; previous: { from: string; to: string } }
export function validReportDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function shiftReportDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
function monthStart(date: string, offset = 0): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 10);
}
function cappedFrom(to: string, grain: ReportGrain): string {
  if (grain === "month") return monthStart(to, -11);
  if (grain === "week") {
    const weekday = new Date(`${to}T00:00:00Z`).getUTCDay();
    return shiftReportDate(to, -((weekday + 6) % 7) - 25 * 7);
  }
  return shiftReportDate(to, -91);
}
export function parseReportRange(p: Record<string, string | undefined>, today: string, grain: ReportGrain = "day"): ReportRange {
  const range = p.range ?? (p.from || p.to ? "custom" : "last7");
  let to = today; let from = shiftReportDate(today, -6);
  if (range === "today") from = today;
  else if (range === "yesterday") from = to = shiftReportDate(today, -1);
  else if (range === "last30") from = shiftReportDate(today, -29);
  else if (range === "this_month") from = monthStart(today);
  else if (range === "last_month") { from = monthStart(today, -1); to = shiftReportDate(monthStart(today), -1); }
  else if (range === "custom") { from = validReportDate(p.from) ? p.from : from; to = validReportDate(p.to) ? p.to : today; }
  if (to > today) to = today;
  if (from > to) from = to;
  const minimum = cappedFrom(to, grain); // Day grain: 92 INCLUSIVE days.
  if (from < minimum) from = minimum;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  let previous = { from: shiftReportDate(from, -days), to: shiftReportDate(from, -1) };
  if (range === "this_month") {
    const priorStart = monthStart(from, -1);
    const priorEnd = shiftReportDate(monthStart(from), -1);
    const sameDay = shiftReportDate(priorStart, Number(to.slice(8)) - 1);
    previous = { from: priorStart, to: sameDay < priorEnd ? sameDay : priorEnd };
  }
  // Calendar months vary in length. At the cap, the adjacent comparison can
  // touch an extra bucket; clip that first partial bucket to the same budget.
  const previousMinimum = cappedFrom(previous.to, grain);
  if (previous.from < previousMinimum) previous.from = previousMinimum;
  return { range, from, to, previous, compare: p.compare === "true" || p.compare === "1" || p.cmp === "1" || p.cmp === "true" };
}
export function reportRangeParams(r: ReportRange): URLSearchParams {
  return new URLSearchParams({ range: r.range, from: r.from, to: r.to, compare: String(r.compare) });
}
export function reportRangeWasShortened(r: ReportRange, requestedFrom: string | undefined): boolean {
  return r.range === "custom" && validReportDate(requestedFrom) && requestedFrom < r.from;
}
export function reportTimestampBounds(from: string, to: string): { start: string; end: string } {
  return { start: operationalDayUtcRange(from).startIso, end: operationalDayUtcRange(shiftReportDate(to, 1)).startIso };
}
