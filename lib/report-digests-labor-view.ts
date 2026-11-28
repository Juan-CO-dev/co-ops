/**
 * Digest LABOR MONEY (digests round 3, PR 4): the VIEW. The sealed pre-load facts of one shop and day become a
 * structure that holds only `Figure`s (lib/business-figure-shared.ts: opaque — value, state and qualifications),
 * dates, targets, tones and state tags. PURE: zero I/O.
 *
 * THE RULE (plan §3.6): a labor figure is never formatted by hand. Every span is priced figures (`LaborFigures`, made
 * by the business report's own pricer in the loader) and goes through the business report's OWN view,
 * `businessLaborView`, so a digest figure carries exactly the state and the qualifications the report would show
 * ("so far", a dash with its reason, "wage estimated", "Toast hours, not confirmed", "burden estimated", "salary
 * estimated", "N payroll gaps"). A role bucket's amount is an `exactFigure` (always exact: the loader withholds the
 * whole role part rather than print a partial one).
 *
 * The ACCESS is NOT decided here: the view holds every money group (`hourlyCost` and `loaded` both on) and each LINE
 * carries one `needs` (lib/report-digests-labor-compose.ts), so `finishSection` cuts what a recipient may not see
 * before anything is counted. No number is formatted here and none leaves here except inside a Figure.
 */
import { exactFigure, type Figure } from "@/lib/business-figure-shared";
import { businessLaborView, type LaborView } from "@/lib/business-view-shared";
import type { HourlyLaborFacts, LaborTarget, RoleBucket, RoleLaborFacts, SpanPart } from "@/lib/report-digests-labor-shared";

/** One finished span as figures: the business report's own labor view of it, its dates and its two targets. */
export interface LaborSpanView { from: string; to: string; target: LaborTarget; loadedTarget: LaborTarget; labor: LaborView }
export type SpanPartView = { kind: "ok"; span: LaborSpanView } | { kind: "unavailable" } | { kind: "updating" };

export interface HourlyLaborView {
  /** F1 and F4's day part. */
  latestFinalDay: SpanPartView | { kind: "none" };
  /** F2. */
  weekSoFar: SpanPartView | { kind: "no_final_day_this_week" };
  /** F3 and F4's week part. */
  lastFullWeek: SpanPartView;
}

/** One role bucket: what it is called (the composer words `other` / `pool`) and its straight-time amount. */
export interface RoleBucketView { kind: RoleBucket["kind"]; name: string | null; amount: Figure }
export type RoleLaborView =
  | { kind: "ok"; date: string; buckets: RoleBucketView[]; roundedSeparately: boolean; wageEstimated: boolean }
  | { kind: "omitted" }
  | { kind: "unavailable" };

/** The labor money of one shop and day. `hourly` / `roles` null = no entry in the sealed store. */
export interface LaborMoneyView { hourly: HourlyLaborView | null; roles: RoleLaborView | null }

/** Every money group ON: the gate is each line's `needs`, never the view. */
const ALL_GROUPS = { hourlyCost: true, loaded: true } as const;

function partView(p: SpanPart): SpanPartView {
  if (p.kind !== "ok") return { kind: p.kind };
  const s = p.span;
  return { kind: "ok", span: { from: s.from, to: s.to, target: s.target, loadedTarget: s.loadedTarget, labor: businessLaborView(s.labor, ALL_GROUPS) } };
}

function rolesView(r: RoleLaborFacts): RoleLaborView {
  if (r.kind !== "ok") return { kind: r.kind };
  return {
    kind: "ok", date: r.date, roundedSeparately: r.roundedSeparately, wageEstimated: r.wageEstimated,
    // A bucket's amount is exact (the loader never hands a partial role part); "not available" is its fallback reason.
    buckets: r.buckets.map((b) => ({ kind: b.kind, name: b.name, amount: exactFigure("cents", b.cents, "reports.business.figure.not_available") })),
  };
}

/** The sealed facts of one shop and day → figures. Null in = null out (the composer prints the part's one sentence). */
export function laborMoneyView(hourly: HourlyLaborFacts | null, roles: RoleLaborFacts | null): LaborMoneyView {
  return {
    hourly: hourly === null ? null : {
      latestFinalDay: hourly.latestFinalDay.kind === "none" ? { kind: "none" } : partView(hourly.latestFinalDay),
      weekSoFar: hourly.weekSoFar.kind === "no_final_day_this_week" ? { kind: "no_final_day_this_week" } : partView(hourly.weekSoFar),
      lastFullWeek: partView(hourly.lastFullWeek),
    },
    roles: roles === null ? null : rolesView(roles),
  };
}
