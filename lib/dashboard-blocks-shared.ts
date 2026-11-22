/**
 * Nav PR 8: the Dashboard's role blocks, the pure half (plan r2 2.1; spec r5 3.6). Client-safe, zero I/O, no clock, no env.
 *
 * Who gets what is decided by the REAL role, never by a level, and never by "works as" (tests/dashboard-works-as.test.ts
 * scans this file):
 *   - the numbers strip: MoO, Owner, CGS;
 *   - "Needs you": GM, MoO, Owner, CGS (a GM DOES get "Needs you"; a GM never gets the strip);
 *   - the catering block: only the engine's `placement: "block"` item (the lens sets it for the catering manager on the
 *     catering item it kept, which exists only where the viewer holds `catering`): the block's gate is the engine's;
 *   - the "My shift | Shop pulse" toggle: anyone who can open the pulse here, never the social media manager.
 *
 * The cells keep every number's honesty: a sales zero only from a completed capture, never from an empty one; a catering
 * value that never sums a missing price and names its estimates; a labor day that is never another day's number.
 * Nothing here formats a number.
 */
import type { BookedCateringEvent } from "@/lib/catering/booked-events";
import { figureComparable } from "@/lib/business-figure-shared";
import type { LaborView } from "@/lib/business-view-shared";
import { aggregateFailure, shortcutHref } from "@/lib/dashboard-day-shared";
import { lensFor, type DayItem, type DayPlan, type DayPlanInput, type DayViewer } from "@/lib/day-plan-shared";
import { byId } from "@/lib/nav/destinations";
import { canSee } from "@/lib/nav/resolve";
import type { RoleCode } from "@/lib/roles";
import type { SalesTotals } from "@/lib/sales-reports-shared";
import { ezcaterCancelled, type EzcaterOrderRow } from "@/lib/scheduling/inputs-shared";

// ── Who gets which block (REAL role only) ────────────────────────────────────────────────────────────────────────────

export const NUMBERS_STRIP_ROLES: ReadonlySet<RoleCode> = new Set<RoleCode>(["moo", "owner", "cgs"]);
/** GM and up, as the destination list's GM_PLUS (lib/nav/destinations.ts). */
export const NEEDS_YOU_ROLES: ReadonlySet<RoleCode> = new Set<RoleCode>(["gm", "moo", "owner", "cgs"]);

/** The numbers strip: MoO, Owner and CGS, by role. No level test. */
export function numbersStripFor(role: RoleCode): boolean {
  return NUMBERS_STRIP_ROLES.has(role);
}
/** "Needs you": GM, MoO, Owner and CGS, by role. No level test. */
export function needsYouFor(role: RoleCode): boolean {
  return NEEDS_YOU_ROLES.has(role);
}

// ── The catering block (the engine's item) ───────────────────────────────────────────────────────────────────────────

/** The index of the one `placement: "block"` item, or -1. */
export function cateringBlockIndex(plan: Pick<DayPlan, "items">): number {
  return plan.items.findIndex((i) => i.placement === "block");
}

/** Q4: the block carries the "Next up" badge when Next up is the block item; under the aggregate failure, never (PR 7 F2). */
export function nextUpInBlock(plan: Pick<DayPlan, "items" | "nextUp" | "notes">): boolean {
  return !aggregateFailure(plan) && plan.nextUp.kind === "item" && plan.items[plan.nextUp.index]?.placement === "block";
}

// ── "Needs you" ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The items now or urgent with nobody on them (PR 5 section 19 item 5). `own_tasks` and failed assignments never yield
 *  `nobody` (their holders are `unknown`), so they are never counted here. */
export function needsYouTasks(plan: Pick<DayPlan, "items">): DayItem[] {
  return plan.items.filter((i) => (i.band === "urgent" || i.band === "now") && i.holder.kind === "nobody");
}

/** The tasks row may state a number (0 included) only when the whole board's assignments loaded for the plan date. */
export function assignmentsKnown(input: Pick<DayPlanInput, "planDate" | "facts">): boolean {
  const f = input.facts;
  return f.kind === "shop" && f.assignments.kind === "ok" && f.assignments.value.scope === "all_tasks" && f.assignments.value.forDate === input.planDate;
}

/** One source of the line: its count, or null when it could not load (or, for tasks, could not be known). */
export interface NeedsYouCount { readonly count: number | null }
export type NeedsYouSummary = { readonly kind: "count" | "at_least"; readonly n: number } | { readonly kind: "none" };
/**
 * The line: `count` when every source loaded; `at_least` (the loaded counts) when any did not; `none` ONLY when every
 * source loaded and every count is 0. A source that could not load is never read as 0.
 */
export function needsYouSummary(cells: readonly NeedsYouCount[]): NeedsYouSummary {
  let n = 0;
  let unknown = false;
  for (const c of cells) {
    if (c.count === null) unknown = true;
    else n += c.count;
  }
  if (unknown) return { kind: "at_least", n };
  return n === 0 ? { kind: "none" } : { kind: "count", n };
}

// ── The toggle ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** "My shift | Shop pulse": the `mid-shift` shortcut's own rule (its real gate and the `ops` surface here); never the
 *  social media manager, by role. */
export function pulseToggleFor(viewer: Pick<DayViewer, "role" | "level" | "surfaces" | "switches">): boolean {
  return lensFor(viewer.role) !== "smm" && viewer.surfaces.has("ops")
    && canSee(byId("mid-shift"), { role: viewer.role, level: viewer.level, switches: viewer.switches });
}

/** Each side's link, the shop in the route's own declared parameter (`?loc=` / `?location=`); bare without a shop. */
export function toggleHrefs(shopId: string | null): { myShift: string; pulse: string } {
  return { myShift: shortcutHref(byId("dashboard"), shopId), pulse: shortcutHref(byId("mid-shift"), shopId) };
}

// ── The numbers strip ────────────────────────────────────────────────────────────────────────────────────────────────

/** Each cell's page: sales today, the business report on the labor day, catering insights. */
export function stripLinks(shopId: string, laborDay: string | null): { sales: string; labor: string; catering: string } {
  const loc = encodeURIComponent(shopId);
  const labor = laborDay
    ? `/reports/business?location=${loc}&range=custom&from=${laborDay}&to=${laborDay}`
    : `/reports/business?location=${loc}`;
  return { sales: `/reports/sales?location=${loc}&range=today`, labor, catering: "/catering/insights" };
}

/** What the sales cell may say (A1). A zero is said only from a completed capture; an empty answer is "not captured". */
export type SalesStripCell =
  | { readonly kind: "amount"; readonly cents: number; readonly partial: boolean; readonly capturedAt: string | null }
  | { readonly kind: "covered_zero"; readonly capturedAt: string | null }
  | { readonly kind: "not_captured" };
export interface SalesTodayInput {
  readonly totals: Pick<SalesTotals, "toastChecksCents" | "checks" | "amountMissing" | "coverage" | "coveredDays">;
  readonly capturedAt: string | null;
}
/**
 * The pulse card's own headline (`toastChecksCents`) and its own `hasData` (lib/pulse/sections.ts):
 *   - checks > 0: the amount; "at least" when an amount is unknown or the day is not completely covered;
 *   - no checks and the day covered completely: a covered zero ("No sales yet today");
 *   - nothing covered and no checks: not captured yet, NEVER a zero;
 *   - covered partly with no checks: what was captured says nothing yet, so not a claim of zero either.
 */
export function salesStripCell(today: SalesTodayInput): SalesStripCell {
  const t = today.totals;
  if (t.checks > 0) return { kind: "amount", cents: t.toastChecksCents, partial: t.amountMissing > 0 || t.coverage !== "complete", capturedAt: today.capturedAt };
  if (t.coverage === "complete" && t.coveredDays > 0) return { kind: "covered_zero", capturedAt: today.capturedAt };
  return { kind: "not_captured" };
}

/** What the catering cell may say (A2): counts and a pipeline-only value, every gap named. */
export interface CateringStripCell {
  /** Pipeline booked orders + unlinked ezCater orders that are not cancelled: the engine's population. */
  readonly orders: number;
  readonly pipeline: number;
  readonly unlinkedEzcater: number;
  /** Σ accepted quote totals + estimates of the PIPELINE orders; null when no order has a value. Never includes a 0 for
   *  a missing price, never an ezCater total. */
  readonly valuedCents: number | null;
  /** How many of the valued orders are valued from an estimate (never shown without its line). */
  readonly estimated: number;
  /** Pipeline orders with neither an accepted quote nor an estimate: named, never summed as $0. */
  readonly missing: number;
}
export type CateringValueBasis = "accepted" | "estimated" | "missing";
/** The booked-events reader's fallback (accepted quote → estimate → 0) WITHOUT the `?? 0`: one classification per order. */
export function cateringValueBasis(e: Pick<BookedCateringEvent, "acceptedQuote" | "estimatedRevenueCents">): CateringValueBasis {
  return e.acceptedQuote !== null ? "accepted" : e.estimatedRevenueCents !== null ? "estimated" : "missing";
}
export function cateringStripCell(
  booked: ReadonlyArray<Pick<BookedCateringEvent, "acceptedQuote" | "estimatedRevenueCents" | "eventDate">>,
  ezcater: ReadonlyArray<Pick<EzcaterOrderRow, "status" | "event_date">>,
  planDate: string,
): CateringStripCell {
  const today = booked.filter((b) => b.eventDate === planDate);
  let valued = 0;
  let any = false;
  let estimated = 0;
  let missing = 0;
  for (const b of today) {
    const basis = cateringValueBasis(b);
    if (basis === "accepted") { valued += b.acceptedQuote!.totalCents; any = true; }
    else if (basis === "estimated") { valued += b.estimatedRevenueCents!; any = true; estimated += 1; }
    else missing += 1;
  }
  const unlinkedEzcater = ezcater.filter((o) => o.event_date === planDate && !ezcaterCancelled(o.status)).length;
  return { orders: today.length + unlinkedEzcater, pipeline: today.length, unlinkedEzcater, valuedCents: any ? valued : null, estimated, missing };
}

/** One labor day of the strip, as lib/dashboard-blocks.ts hands it to the component (a view, never raw figures). */
export interface LaborStripDay { readonly date: string; readonly view: LaborView }
/**
 * Q2: the newest of the days (ascending, the three before today) whose FULLY LOADED % is comparable; with none, the
 * newest day as it stands, so its dash and its reason show under ITS OWN date. A day's number is never shown under
 * another day's label: the day returned carries its own view.
 */
export function newestLaborDay(days: readonly LaborStripDay[]): LaborStripDay | null {
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const d = days[i]!;
    if (d.view.loadedPct !== undefined && figureComparable(d.view.loadedPct)) return d;
  }
  return days.at(-1) ?? null;
}
