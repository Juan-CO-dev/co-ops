/**
 * Scheduling Phase 2, Task 11 — the hours budget and its suggestion, pure (spec §5.2; plan "Budget, labor
 * target, horizon": r2 P2-7 date-scoped, r3 per-DATE precedence, r2 P2-8 / r3 / r4 the suggestion).
 */
import { describe, expect, it } from "vitest";
import {
  BUDGET_LINE_KEYS, acceptSuggestion, apportion, budgetForDates, entryDates, minCrewHours, needHours, referenceStructureOf, structureDeltaHours,
  suggestBudget, suggestionHidden, type BudgetEntry, type SuggestBudgetInput,
} from "@/lib/scheduling/budget-shared";
import type { DayForecast } from "@/lib/scheduling/demand-shared";
import { ScheduleError } from "@/lib/scheduling/errors-shared";
import { buildDayNeed } from "@/lib/scheduling/need-shared";
import { addDays, weekDays } from "@/lib/scheduling/time-shared";
import { structure } from "./fixtures/schedule/rules-fixture";

const WEEK = "2026-10-26"; // Mon Oct 26 – Sun Nov 1
const OCT = "2026-10-01";
const NOV = "2026-11-01";
const DAYS = weekDays(WEEK);
const entry = (id: string, over: Partial<BudgetEntry>): BudgetEntry => ({
  id, scope: "week", weekStart: WEEK, month: null, hours: 70, source: "manager", suggestionDigest: null, apportionedBy: "even", createdAt: "2026-10-20T12:00:00Z", ...over,
});

describe("apportion: every entry becomes per-DATE rows when it is written", () => {
  it("a week entry over its 7 dates by forecast share, to 0.01 h, largest remainder, summing EXACTLY to the entry", () => {
    const e = entry("w", { hours: 70.25 });
    const fc = Object.fromEntries(DAYS.map((d, i) => [d, [300, 300, 300, 300, 400, 500, 433][i]!]));
    const rows = apportion(e, { forecastCentsByDate: fc });
    expect(rows.map((r) => r.date)).toEqual(DAYS);
    expect(Math.round(rows.reduce((n, r) => n + r.hours, 0) * 100)).toBe(7025);
    expect(rows.every((r) => Number.isInteger(Math.round(r.hours * 100)) && Math.abs(r.hours * 100 - Math.round(r.hours * 100)) < 1e-9)).toBe(true);
    expect(rows[5]!.hours).toBeGreaterThan(rows[0]!.hours);
  });

  it("an even split with no forecast (no_history) or an all-zero one; a month entry over the month's dates", () => {
    expect(apportion(entry("w", { hours: 70 }), { forecastCentsByDate: null }).map((r) => r.hours)).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect(apportion(entry("w", { hours: 1 }), { forecastCentsByDate: Object.fromEntries(DAYS.map((d) => [d, 0])) }).map((r) => r.hours)).toEqual([0.15, 0.15, 0.14, 0.14, 0.14, 0.14, 0.14]);
    const oct = entry("m", { scope: "month", weekStart: null, month: OCT, hours: 310 });
    expect(entryDates(oct)).toHaveLength(31);
    expect(apportion(oct, { forecastCentsByDate: null }).every((r) => r.hours === 10)).toBe(true);
  });

  it("an accepted suggestion keeps its EXPLICIT per-date amounts; they must cover the entry's dates and sum to it", () => {
    const explicit = Object.fromEntries(DAYS.map((d, i) => [d, [34, 32, 32, 32, 40, 40, 40][i]!]));
    const e = entry("s", { hours: 250, source: "accepted_suggestion", apportionedBy: "explicit" });
    expect(apportion(e, { explicit }).map((r) => r.hours)).toEqual([34, 32, 32, 32, 40, 40, 40]);
    expect(() => apportion({ ...e, hours: 251 }, { explicit })).toThrow(ScheduleError);
    expect(() => apportion(e, { explicit: { ...explicit, [DAYS[6]!]: undefined as never } })).toThrow(ScheduleError);
  });

  it("refuses an invalid entry by name (budget_invalid): negative, over 8000, not a quarter hour, a week that is not a Monday", () => {
    for (const bad of [entry("x", { hours: -1 }), entry("x", { hours: 8000.25 }), entry("x", { hours: 10.1 }), entry("x", { weekStart: "2026-10-27" })]) {
      try { apportion(bad, { forecastCentsByDate: null }); throw new Error("no refusal"); } catch (e) { expect((e as ScheduleError).code).toBe("budget_invalid"); }
    }
  });
});

describe("budgetForDates: per-DATE precedence — the newest entry covering a date wins for that date", () => {
  const rowsOf = (e: BudgetEntry) => apportion(e, { forecastCentsByDate: null });
  const week = entry("w", { hours: 70, createdAt: "2026-10-01T10:00:00Z" });
  const october = entry("oct", { scope: "month", weekStart: null, month: OCT, hours: 310, createdAt: "2026-10-02T10:00:00Z" });
  const november = entry("nov", { scope: "month", weekStart: null, month: NOV, hours: 300, createdAt: "2026-10-03T10:00:00Z" });

  it("F11 week → month: Oct 26–31 take October's rows, Nov 1 KEEPS the week entry's row", () => {
    const got = budgetForDates([week, october], [...rowsOf(week), ...rowsOf(october)], DAYS);
    expect(DAYS.map((d) => got.byDate[d])).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect(got.composition.map((c) => c.entryId)).toEqual(["oct", "oct", "oct", "oct", "oct", "oct", "w"]);
    expect(got.unbudgetedDates).toEqual([]);
  });

  it("F12 month → week → adjacent month: the week wins all 7, then November wins Nov 1 only", () => {
    const wk = { ...week, hours: 77, createdAt: "2026-10-02T12:00:00Z" };
    const got = budgetForDates([october, wk, november], [...rowsOf(october), ...rowsOf(wk), ...rowsOf(november)], DAYS);
    expect(got.composition.map((c) => c.entryId)).toEqual(["w", "w", "w", "w", "w", "w", "nov"]);
    expect(DAYS.map((d) => got.byDate[d])).toEqual([11, 11, 11, 11, 11, 11, 10]);
    expect(got.total).toBe(76);
  });

  it("F13 partial week: only October → Nov 1 has NO budget (null, never 0)", () => {
    const got = budgetForDates([october], rowsOf(october), DAYS);
    expect(got.byDate[DAYS[6]!]).toBeNull();
    expect(got.unbudgetedDates).toEqual([DAYS[6]]);
    expect(got.total).toBe(60);
    expect(got.lines).toContainEqual({ key: "schedule.budget.unbudgeted", params: { date: DAYS[6]! } });
  });

  it("October then November and November then October give the SAME week (both entry orders)", () => {
    const a = budgetForDates([october, november], [...rowsOf(october), ...rowsOf(november)], DAYS);
    const flipped = [{ ...november, createdAt: "2026-10-02T09:00:00Z" }, { ...october, createdAt: "2026-10-03T09:00:00Z" }];
    const b = budgetForDates(flipped, flipped.flatMap(rowsOf), DAYS);
    expect(b.byDate).toEqual(a.byDate);
    expect(b.total).toBe(a.total);
  });

  it("emits the composition lines for the reason, every key in the closed list", () => {
    const got = budgetForDates([week, october], [...rowsOf(week), ...rowsOf(october)], DAYS);
    expect(got.lines[0]).toEqual({ key: "schedule.budget.composition", params: { scope: "month", from: DAYS[0]!, to: DAYS[5]!, days: 6, hours: 60 } });
    expect(got.lines[1]).toEqual({ key: "schedule.budget.composition", params: { scope: "week", from: DAYS[6]!, to: DAYS[6]!, days: 1, hours: 10 } });
    for (const l of got.lines) expect(BUDGET_LINE_KEYS).toContain(l.key);
  });
});

// ─── The suggestion ──────────────────────────────────────────────────────────

const REF = "2026-10-12"; // a fully ended reference week (Mon Oct 12 – Sun Oct 18)
const TARGET = "2026-10-26";
const ASOF = "2026-10-21";
const okDay = (date: string, cents: number): DayForecast => ({ kind: "ok", date, hourlyCents: new Array<number>(24).fill(0), dayCents: cents, weeks: 4, basis: "trailing_same_weekday", weeksAhead: 1, confidence: "normal", unknownCents: 0, catering: [] });
const refDates = weekDays(REF);
const targetDates = weekDays(TARGET);

function suggestion(over: Partial<SuggestBudgetInput> = {}, opts: { captured?: number; rho?: number } = {}): SuggestBudgetInput {
  const captured = opts.captured ?? 4; // Mon–Thu captured
  const rho = opts.rho ?? 1;
  return {
    asOf: ASOF, targetWeekStart: TARGET,
    reference: {
      weekStart: REF, complete: true,
      hoursByDate: Object.fromEntries(refDates.map((d) => [d, 40])),
      salesCentsByDate: Object.fromEntries(refDates.slice(0, captured).map((d) => [d, 100_000])),
      cateringHoursByDate: Object.fromEntries(refDates.map((d) => [d, 0])),
      budgetTotal: 280,
    },
    demand: { kind: "ok", days: targetDates.map((d, i) => okDay(d, i < captured ? Math.round(100_000 * rho) : 90_000)) },
    cateringHoursByDate: Object.fromEntries(targetDates.map((d) => [d, 0])),
    structureDeltaByDate: Object.fromEntries(targetDates.map((d) => [d, 0])),
    minCrewHoursByDate: Object.fromEntries(targetDates.map((d, i) => [d, i === 0 ? 34 : i < 4 ? 28 : 40])),
    currentBudgetTotal: null, deadbandH: 2,
    ...over,
  };
}

describe("suggestBudget: an explicit completed reference, the matched-weekday RATIO on matched dates only", () => {
  it("r3: unchanged demand (ρ = 1) with Mon–Thu captured → 280 h, never 160; accepting keeps Fri–Sun at 120 h", () => {
    const s = suggestBudget(suggestion({ minCrewHoursByDate: Object.fromEntries(targetDates.map((d) => [d, 20])) }));
    if (s.kind !== "suggestion") throw new Error(s.kind);
    expect(s.ratio).toBe(1);
    expect(s.matchedDows).toEqual([1, 2, 3, 4]);
    expect(s.total).toBe(280);
    const { entry: e, rows } = acceptSuggestion(s, { id: "acc", createdAt: "2026-10-21T15:00:00Z" });
    expect(e).toMatchObject({ scope: "week", weekStart: TARGET, hours: 280, source: "accepted_suggestion", apportionedBy: "explicit", suggestionDigest: s.digest });
    const got = budgetForDates([e], rows, targetDates);
    expect(targetDates.slice(4).reduce((n, d) => n + (got.byDate[d] ?? 0), 0)).toBe(120);
    expect(s.lines).toContainEqual({ key: "schedule.budget.unmatched_kept", params: { days: 3, hours: 120 } });
  });

  it("r4 F16: ρ = 0.8 → 34 / 32 / 32 / 32 / 40 / 40 / 40 = 250 h with the Monday clamp note; acceptance persists exactly those rows", () => {
    const s = suggestBudget(suggestion({}, { rho: 0.8 }));
    if (s.kind !== "suggestion") throw new Error(s.kind);
    expect(s.ratio).toBe(0.8);
    expect(targetDates.map((d) => s.byDate[d])).toEqual([34, 32, 32, 32, 40, 40, 40]);
    expect(s.total).toBe(250);
    expect(s.clamped).toEqual([targetDates[0]]);
    expect(s.lines).toContainEqual({ key: "schedule.budget.clamped_min_crew", params: { date: targetDates[0]!, hours: 34 } });
    const { entry: e, rows } = acceptSuggestion(s, { id: "f16", createdAt: "2026-10-21T15:00:00Z" });
    expect(rows.map((r) => r.hours)).toEqual([34, 32, 32, 32, 40, 40, 40]);
    expect(e.hours).toBe(250);
    expect(budgetForDates([e], rows, targetDates).total).toBe(250);
  });

  it("r4 F16 negative-delta variant: a −4 h structure change → 34 / 28 / 28 / 28 / 40 / 40 / 40 = 238 h (never applied to unmatched dates)", () => {
    const s = suggestBudget(suggestion({ structureDeltaByDate: Object.fromEntries(targetDates.map((d) => [d, -4])) }, { rho: 0.8 }));
    if (s.kind !== "suggestion") throw new Error(s.kind);
    expect(targetDates.map((d) => s.byDate[d])).toEqual([34, 28, 28, 28, 40, 40, 40]);
    expect(s.total).toBe(238);
  });

  it("full capture uses all 7 days for the ratio; positive deltas reach unmatched dates, negative never", () => {
    const full = suggestBudget(suggestion({ minCrewHoursByDate: Object.fromEntries(targetDates.map((d) => [d, 0])) }, { captured: 7, rho: 1.1 }));
    if (full.kind !== "suggestion") throw new Error(full.kind);
    expect(full.matchedDows).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(full.total).toBe(7 * 44);
    const cat = suggestBudget(suggestion({ cateringHoursByDate: Object.fromEntries(targetDates.map((d, i) => [d, i === 5 ? 4 : 0])), minCrewHoursByDate: Object.fromEntries(targetDates.map((d) => [d, 0])) }));
    if (cat.kind !== "suggestion") throw new Error(cat.kind);
    expect(cat.byDate[targetDates[5]!]).toBe(44); // unmatched Saturday + 4 h booked catering
    expect(cat.lines).toContainEqual({ key: "schedule.budget.catering_delta", params: { date: targetDates[5]!, hours: 4 } });
  });

  it("the catering delta is target minus reference: the same catering on the reference's weekday gives +0 h", () => {
    const base = suggestion({ minCrewHoursByDate: Object.fromEntries(targetDates.map((d) => [d, 0])) });
    base.cateringHoursByDate[targetDates[3]!] = 4;
    base.reference!.cateringHoursByDate[refDates[3]!] = 4;
    const s = suggestBudget(base);
    if (s.kind !== "suggestion") throw new Error(s.kind);
    expect(s.byDate[targetDates[3]!]).toBe(40);
    expect(s.lines.filter((l) => l.key === "schedule.budget.catering_delta")).toEqual([]);
  });

  it("refused suggestion_unavailable: no reference, a reference not fully ended (never the target week itself), an incomplete base, demand not ok, nothing captured, zero sales", () => {
    const cause = (i: SuggestBudgetInput) => { const s = suggestBudget(i); return s.kind === "unavailable" ? [s.code, s.cause] : [s.kind]; };
    expect(cause(suggestion({ reference: null }))).toEqual(["suggestion_unavailable", "no_reference"]);
    const own = suggestion();
    own.reference!.weekStart = TARGET;
    expect(cause(own)).toEqual(["suggestion_unavailable", "reference_not_ended"]);
    const running = suggestion();
    running.reference!.weekStart = "2026-10-19";
    expect(cause(running)).toEqual(["suggestion_unavailable", "reference_not_ended"]);
    const partial = suggestion();
    partial.reference!.complete = false;
    expect(cause(partial)).toEqual(["suggestion_unavailable", "incomplete_reference"]);
    expect(cause(suggestion({ demand: { kind: "no_history", days: [] } }))).toEqual(["suggestion_unavailable", "demand_not_ok"]);
    expect(cause(suggestion({ demand: { kind: "unavailable", cause: "timeout" } }))).toEqual(["suggestion_unavailable", "demand_not_ok"]);
    expect(cause(suggestion({}, { captured: 0 }))).toEqual(["suggestion_unavailable", "no_matched_days"]);
    const zero = suggestion();
    zero.reference!.salesCentsByDate = Object.fromEntries(refDates.slice(0, 4).map((d) => [d, 0]));
    expect(cause(zero)).toEqual(["suggestion_unavailable", "zero_reference_sales"]);
  });

  it("the deadband: no suggestion when within ±2 h of the target week's current budget; the digest is stable; Keep hides that digest", () => {
    const quiet = suggestBudget(suggestion({ currentBudgetTotal: 249 }, { rho: 0.8 }));
    expect(quiet.kind).toBe("quiet");
    const loud = suggestBudget(suggestion({ currentBudgetTotal: 247.75 }, { rho: 0.8 }));
    expect(loud.kind).toBe("suggestion");
    const a = suggestBudget(suggestion({}, { rho: 0.8 }));
    const b = suggestBudget(suggestion({}, { rho: 0.8 }));
    if (a.kind !== "suggestion" || b.kind !== "suggestion") throw new Error("kind");
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^[0-9a-f]{16}$/);
    const c = suggestBudget(suggestion({}, { rho: 0.9 }));
    if (c.kind !== "suggestion") throw new Error("kind");
    expect(c.digest).not.toBe(a.digest);
    expect(suggestionHidden(a, [a.digest])).toBe(true);
    expect(suggestionHidden(c, [a.digest])).toBe(false);
  });

  it("the reason lines: demand compared on the matched weekdays only (with the % and the reference week)", () => {
    const s = suggestBudget(suggestion({}, { rho: 1.12 }));
    if (s.kind !== "suggestion") throw new Error(s.kind);
    expect(s.lines[0]).toEqual({ key: "schedule.budget.ratio", params: { pct: 12, referenceWeek: REF, matched: "1,2,3,4", matchedDays: 4 } });
    for (const l of s.lines) expect(BUDGET_LINE_KEYS).toContain(l.key);
  });
});

describe("Astra chunk E P2-3: the reference week's ACTUAL structure, never the live one", () => {
  const old = structure((x) => { x.crews.normal.waves.service.heads = 2; });
  const live = structure();
  const head = (days: Record<string, unknown>, versionId = "sv-old") => ({
    revision: { id: "r1", kind: "generated" as const, basedOnRevisionId: null, structureVersionId: versionId, createdAt: "2026-10-12T10:00:00Z", createdBy: null, actorContext: "user" as const, generatorVersion: "p2.5", inputsDigest: "d" },
    context: { days } as never,
  });
  it("the structure stored with the reference revision's context wins, even when the live map does not hold it", () => {
    expect(referenceStructureOf(head({ [refDates[0]!]: { structureVersionId: "sv-old", structure: old } }), {})).toEqual(old);
    expect(referenceStructureOf(head({}), { "sv-old": old })).toEqual(old);
  });
  it("missing everywhere → null (never the live structure)", () => {
    expect(referenceStructureOf(head({ [refDates[0]!]: { structureVersionId: "sv-other", structure: live } }), { "sv-live": live })).toBeNull();
    expect(referenceStructureOf(head({}), {})).toBeNull();
  });
  it("an unknown reference structure is SHOWN: the explicit line, and no structure-delta line (never a silent zero)", () => {
    const s = suggestBudget(suggestion({ structureDeltaUnknown: true, structureDeltaByDate: Object.fromEntries(targetDates.map((d) => [d, 5])) }));
    expect(s.kind).toBe("suggestion");
    if (s.kind !== "suggestion") return;
    expect(s.lines).toContainEqual({ key: "schedule.budget.reference_structure_unavailable", params: { referenceWeek: REF } });
    expect(s.lines.some((l) => l.key === "schedule.budget.structure_delta")).toBe(false);
    expect(BUDGET_LINE_KEYS).toContain("schedule.budget.reference_structure_unavailable");
  });
});

describe("the structure delta and the minimum crew, from the need grid", () => {
  const dayIn = { dayType: "normal" as const, scheduledOutQ: 83, hourlyCents: null, demandKind: "no_history" as const, catering: [] };

  it("structureDeltaHours = need hours under the live structure − under the reference revision's, both over the target forecast", () => {
    const ref = structure();
    expect(structureDeltaHours({ live: ref, ref, day: dayIn })).toBe(0);
    const live = structure((x) => { x.crews.normal.prepHeads = 0; });
    const expected = needHours(buildDayNeed({ structure: live, ...dayIn }).need) - needHours(buildDayNeed({ structure: ref, ...dayIn }).need);
    expect(expected).toBeLessThan(0);
    expect(structureDeltaHours({ live, ref, day: dayIn })).toBe(expected);
  });

  it("minCrewHours = the hours of the structural minimum crew (the line floor + BOH + closing crew; no demand, no catering)", () => {
    const s = structure();
    const floor = minCrewHours(s, "normal", 83);
    expect(floor).toBe(needHours(buildDayNeed({ structure: s, dayType: "normal", scheduledOutQ: 83, hourlyCents: new Array<number>(24).fill(0), demandKind: "ok", catering: [] }).need));
    expect(floor).toBeLessThanOrEqual(needHours(buildDayNeed({ structure: s, ...dayIn }).need));
    expect(floor).toBeGreaterThan(0);
  });
});

void addDays;
