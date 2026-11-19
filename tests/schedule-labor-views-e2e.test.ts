// Board two labor views PR 1, END TO END (CC's rulings on Astra r4 P1 + P2):
//   the REAL board loader (the in-memory schedule store) -> the REAL projection -> the loader's REAL reads against
//   the REAL schema (PGlite: parents + 0338 + 0339 + 0340 + 0345) -> the facts' own two-view pricer -> the
//   SERIALIZED board (JSON).
//  - a genuinely UNBUILT future week with a 48-hour schedule gets projected minutes, the 8 overtime hours, both
//    percentages over PROJECTED net sales (the scheduling forecast) and the salary allocated by 0340's rule;
//  - each missing input withholds exactly its figure with a named reason (never 0);
//  - a MIXED week: settled days are the facts over the Sales report's net; today and later are the schedule
//    over the forecast; the two strip lines are separate and never blended;
//  - a source that moved with no rebuild makes the settled days "not settled" (hours only);
//  - dark by default, absent for an AGM, and the payload is an allowlist with no wage, rate or person in it.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const lib = await import("@/lib/scheduling/schedules");
const { loadBoard } = await import("@/lib/scheduling/board");
const { supabaseLaborReads } = await import("@/lib/scheduling/labor-projection");
const { loadSchedulingInputs } = await import("@/lib/scheduling/inputs");
import type { PeopleActor } from "@/lib/people/access-shared";
import type { BoardLaborViews, BoardLaborViewsReady, PlanShift } from "@/lib/scheduling/labor-projection-shared";
import type { DemandResult } from "@/lib/scheduling/demand-shared";
import { weekDays } from "@/lib/scheduling/time-shared";
import { AGM, GM, MOO, P_REG, STAFF, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";
import { M0345 } from "./helpers/fact-0338-parents";
import { A, ALICE, B, FUTURE_W, GMU, MGR, laborPlanDb, type LaborPlanDb } from "./helpers/labor-plan-fixture";
import { pgliteClient, type PgliteClientOpts } from "./helpers/pglite-postgrest";
import { BOARD_LABOR_VIEW_PATHS } from "./fixtures/schedule/labor-views-paths";

const ON = { SCHEDULE_LABOR_VIEWS: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const actor = (userId: string, role: PeopleActor["role"], level: number, locations: string[]): PeopleActor => ({ userId, role, level, locations });
const gm = actor(GM, "gm", 7, [A]), agm = actor(AGM, "agm", 6, [A]), moo = actor(MOO, "moo", 8, []);
const NEW_HIRE = STAFF[5]!; // on the schedule store's roster, with no 7shifts account in the labor database

let f: LaborPlanDb;
beforeAll(async () => {
  f = await laborPlanDb();
  await f.db.exec(M0345);
}, 240_000);

const shift = (userId: string, date: string, hours: number, startQ = 24): PlanShift => ({ userId, date, startQ, endQ: startQ + hours * 4 });
/** The Sales report's raw day: $4,000 Toast net + $1,000 ezCater = $5,000 net sales. */
const salesDay = (d: string) => ({ classes: [{ business_date: d, sale_class: "sale", checks: 40, amount_cents: 400_000, tax_cents: 0, amount_missing: 0, tax_missing: 0,
  gross_cents: 400_000, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 }],
  ezcater: [{ business_date: d, orders: 1, subtotal_cents: 100_000, amount_missing: 0 }] });
const span = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

interface BoardOpts {
  now: Date; week: string; shifts: PlanShift[];
  /** the previous board week's shifts; null = that week has no schedule at all */
  prevShifts?: PlanShift[] | null;
  /** forecast cents per date (default $2,000 a day); null = no forecast that day */
  forecast?: (date: string) => number | null;
  /** business dates the Sales report has captured (default: every day asked) */
  salesCaptured?: (date: string) => boolean;
  viewer?: PeopleActor; env?: Record<string, string | undefined>; rpc?: PgliteClientOpts["rpc"];
  /** PR 3: generate the week with this forecast per hour (7:00 to 20:59, cents), so the stored day contexts carry a
   * demand curve and the labor card computes (default: the store's own inputs, no sales history). */
  genHourlyCents?: number;
}
async function board(o: BoardOpts) {
  const s = scheduleStore(shopTables());
  // Schedules are generated a week ahead by the real generator, then their shift rows are replaced by this test's.
  const genNow = new Date(Date.parse(`${o.week}T16:00:00Z`) - 10 * 86_400_000);
  const gen = { service: s.client, now: genNow, newId: s.newId };
  const setShifts = (revisionId: string, shifts: PlanShift[]) => {
    const rows = s.tables.schedule_revision_shifts!;
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.revision_id === revisionId) rows.splice(i, 1);
    for (const sh of shifts) rows.push({ revision_id: revisionId, location_id: A, user_id: sh.userId, business_date: sh.date, start_q: sh.startQ, end_q: sh.endQ,
      segments: [{ positionId: P_REG, startQ: sh.startQ, endQ: sh.endQ }], closing_manager: false, flex: false, pinned: false, reasons: null });
  };
  const prevWeek = new Date(Date.parse(`${o.week}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  if (o.prevShifts !== null) {
    const p = await lib.generateWeek(gen, { actor: gm, locationId: A, weekStart: prevWeek, expectedHead: null });
    setShifts(p.revisionId, o.prevShifts ?? []);
  }
  const dates = weekDays(o.week);
  const genDemand: DemandResult | null = o.genHourlyCents === undefined ? null : { kind: "ok", days: dates.map((date) => ({
    kind: "ok" as const, date, hourlyCents: Array.from({ length: 24 }, (_, h) => (h >= 7 && h <= 20 ? o.genHourlyCents! : 0)), dayCents: 14 * o.genHourlyCents!,
    weeks: 4, basis: "trailing_same_weekday" as const, weeksAhead: 1, confidence: "normal" as const, unknownCents: 0, catering: [] })) };
  const g = await lib.generateWeek(genDemand ? { ...gen, loadInputs: async (svc, a) => ({ ...(await loadSchedulingInputs(svc, a)), demand: genDemand }) } : gen,
    { actor: gm, locationId: A, weekStart: o.week, expectedHead: null });
  setShifts(g.revisionId, o.shifts);
  const demand: DemandResult = { kind: "ok", days: dates.map((date) => {
    const cents = (o.forecast ?? (() => 200_000))(date);
    return cents === null ? { kind: "no_history" as const, date, weeksAhead: 1, catering: [] }
      : { kind: "ok" as const, date, hourlyCents: [], dayCents: cents, weeks: 4, basis: "trailing_same_weekday" as const, weeksAhead: 1, confidence: "normal" as const, unknownCents: 0, catering: [] };
  }) };
  const calls: NonNullable<PgliteClientOpts["calls"]> = [];
  const labor = pgliteClient(f.db, { calls, rpc: {
    sales_report_daily: (a) => {
      const days = span(String(a.p_from), String(a.p_to)).filter((d) => (o.salesCaptured ?? (() => true))(d));
      return { data: { classes: days.flatMap((d) => salesDay(d).classes), tips: [], discounts: [], refunds: [], captured_days: days, ezcater: days.flatMap((d) => salesDay(d).ezcater) }, error: null };
    },
    ...o.rpc,
  } });
  const loaded = await loadBoard({
    service: s.client, now: o.now, newId: s.newId, env: o.env ?? ON, laborReads: supabaseLaborReads(labor),
    loadInputs: async (svc, a) => ({ ...(await loadSchedulingInputs(svc, a)), demand }),
  }, { actor: o.viewer ?? gm, locationId: A, weekStart: o.week });
  if (loaded.state !== "ready") throw new Error(`board ${loaded.state}`);
  // What the browser receives.
  const json = JSON.parse(JSON.stringify(loaded)) as { laborViews?: BoardLaborViews };
  return { json, calls, views: json.laborViews as BoardLaborViewsReady };
}
const day = (v: BoardLaborViewsReady, date: string) => v.days.find((d) => d.date === date)!;

describe("a genuinely unbuilt future week (Astra r4 P1): SQL -> shared pricer -> serialized board", () => {
  const WEEK = "2099-01-05", NOW = new Date("2099-01-01T16:00:00Z");
  const fortyEight = [...weekDays(WEEK).slice(0, 6).map((d) => shift(ALICE, d, 8)), shift(GMU, WEEK, 8)];

  it("nothing is stored for that week: no coverage row, no fact row, no salaried row", async () => {
    for (const t of ["labor_week_coverage", "labor_quarter", "labor_week_salaried"]) {
      expect((await f.q<{ n: number }>(`select count(*)::int n from ${t} where week_start >= $1`, [FUTURE_W]))[0]!.n, t).toBe(0);
    }
  });

  it("a 48-hour schedule: projected minutes, 8 overtime hours on Saturday, both percentages over the forecast, labelled projected", async () => {
    const { views } = await board({ now: NOW, week: WEEK, shifts: fortyEight });
    expect(views.state).toBe("ready");
    expect(views.days.map((d) => d.kind)).toEqual(Array(7).fill("projected"));
    // Monday: Alice 8 h at $20 + the GM's 8 h of salaried presence; a seventh of the $1,400 salary; 12% burden.
    expect(day(views, "2099-01-05")).toMatchObject({
      minutes: 960, otMinutes: 0, straightCents: 16_000, otPremiumCents: 0, pureHourlyCents: 16_000, salariedCents: 20_000, burdenCents: 4_320, fullyLoadedCents: 40_320,
      sales: { basis: "forecast", cents: 200_000 }, pureHourlyPct: 8, pureHourlyTone: "good", fullyLoadedPct: 20.2, fullyLoadedTone: "good",
      otState: "projected", salaryProjected: true, rateEstimated: false, reasons: [],
    });
    // Saturday: the 41st to 48th hours, at half of $20 on top.
    expect(day(views, "2099-01-10")).toMatchObject({ minutes: 480, otMinutes: 480, straightCents: 16_000, otPremiumCents: 8_000, pureHourlyCents: 24_000, pureHourlyPct: 12, reasons: [] });
    // Sunday starts the next payroll week: nobody scheduled, the salary share still counted.
    expect(day(views, "2099-01-11")).toMatchObject({ minutes: 0, pureHourlyCents: 0, salariedCents: 20_000, pureHourlyPct: 0, otState: "projected" });
    // The week: the pricer's own answer for the seven projected days (two payroll weeks, raw cents first).
    expect(views.strip.actual).toBeNull();
    expect(views.strip).toMatchObject({ notSettledDays: 0, noScheduleDays: 0 });
    expect(views.strip.projected).toMatchObject({
      days: 7, minutes: 3_360, otMinutes: 480, straightCents: 96_000, otPremiumCents: 8_000, pureHourlyCents: 104_000,
      salariedCents: 140_000, burdenCents: 26_880 + 2_400, fullyLoadedCents: 104_000 + 140_000 + 29_280,
      sales: { basis: "forecast", cents: 1_400_000 }, pureHourlyPct: 7.4, fullyLoadedPct: 19.5, pureHourlyTone: "good", fullyLoadedTone: "good", reasons: [],
    });
    expect(views.targets).toEqual({ hourlyPct: 18, loadedPct: 28 });
  });

  it("parity: the same 48 hours cost the same projected as they did when they were worked and built", async () => {
    const { views } = await board({ now: NOW, week: WEEK, shifts: weekDays(WEEK).slice(0, 6).map((d) => shift(ALICE, d, 8)) });
    const [built] = await f.q<Record<string, unknown>>("select * from fact_labor_cost($1, '2026-10-04', '2026-10-10', 'first_known')", [A]);
    // The built week also holds Bob's 6 h at $30 and one no-wage hour.
    expect(views.strip.projected!.straightCents).toBe(Number(built!.hourly_straight_cents) - 18_000 - 1_840);
    expect(views.strip.projected!.otPremiumCents).toBe(Number(built!.ot_premium_cents));
    expect(views.strip.projected!.otMinutes).toBe(Number(built!.ot_minutes));
  });

  it("no schedule for the week before (its Sunday starts this payroll week): overtime not assessed; straight time stays, no % and no tone", async () => {
    const { views } = await board({ now: NOW, week: WEEK, shifts: fortyEight, prevShifts: null });
    const sat = day(views, "2099-01-10");
    expect(sat).toMatchObject({ minutes: 480, straightCents: 16_000, otMinutes: null, otPremiumCents: null, pureHourlyCents: null, fullyLoadedCents: null,
      pureHourlyPct: null, pureHourlyTone: "none", fullyLoadedPct: null, fullyLoadedTone: "none", otState: "not_assessed" });
    expect(sat.reasons).toContain("schedule_incomplete");
    // The board Sunday's own payroll week has everything it needs.
    expect(day(views, "2099-01-11")).toMatchObject({ otState: "projected", pureHourlyPct: 0, reasons: [] });
    expect(views.strip.projected).toMatchObject({ straightCents: 96_000, pureHourlyCents: null, pureHourlyPct: null, fullyLoadedPct: null });
  });

  it("a scheduled person with no wage: that day's $ and % are unknown with the reason, the other days keep theirs", async () => {
    const { views } = await board({ now: NOW, week: WEEK, shifts: [...fortyEight, shift(NEW_HIRE, "2099-01-06", 4)] });
    const tue = day(views, "2099-01-06");
    expect(tue).toMatchObject({ minutes: 720, straightCents: null, pureHourlyCents: null, fullyLoadedCents: null, pureHourlyPct: null, fullyLoadedPct: null, pureHourlyTone: "none" });
    expect(tue.reasons).toEqual(["wage_unknown"]);
    expect(day(views, "2099-01-05")).toMatchObject({ pureHourlyPct: 8, reasons: [] });
    expect(views.strip.projected).toMatchObject({ pureHourlyCents: null, pureHourlyPct: null, reasons: ["wage_unknown"] });
  });

  it("a salaried account nobody assigned to a payroll shop: fully loaded is unknown with its count; pure hourly keeps its number and tone", async () => {
    await f.q("insert into sevenshifts_users(id, company_id, first_name, active) values(77, 1, 'X', true)");
    await f.wage(77, 5_200_000, "annual_salary");
    try {
      const { views } = await board({ now: NOW, week: WEEK, shifts: fortyEight });
      expect(day(views, "2099-01-05")).toMatchObject({ pureHourlyCents: 16_000, pureHourlyPct: 8, pureHourlyTone: "good", salariedCents: null, fullyLoadedCents: null,
        fullyLoadedPct: null, fullyLoadedTone: "none", salaryGaps: 1 });
      expect(day(views, "2099-01-05").reasons).toEqual(["salary_incomplete"]);
    } finally {
      // Assign it elsewhere-free: an excluded account is a recorded decision and leaves the allocation.
      await f.q("select save_labor_payroll_shop($1, 77, null, 'excluded', '2026-07-19', 'test: not on a shop payroll', null)", [MGR]);
      // A new salaried account and a payroll-shop row move every week's source: rebuild the stored weeks.
      await f.build("2026-10-04"); await f.build("2026-10-11");
    }
    const { views } = await board({ now: NOW, week: WEEK, shifts: fortyEight });
    expect(day(views, "2099-01-05")).toMatchObject({ salariedCents: 20_000, fullyLoadedPct: 20.2 });
  });
});

describe("the projected denominator (Astra r4 P2): forecast sales, never a covered actual", () => {
  const WEEK = "2099-01-05", NOW = new Date("2099-01-01T16:00:00Z");
  const shifts = weekDays(WEEK).slice(0, 5).map((d) => shift(ALICE, d, 8));
  it("FUTURE ONLY: every % divides by the forecast; the Sales report is never asked about a day that has not happened", async () => {
    const { views, calls } = await board({ now: NOW, week: WEEK, shifts, forecast: (d) => (d === "2099-01-06" ? 320_000 : 200_000) });
    expect(views.days.every((d) => d.sales.basis === "forecast")).toBe(true);
    expect(day(views, "2099-01-06")).toMatchObject({ sales: { basis: "forecast", cents: 320_000 }, pureHourlyPct: 5 });
    expect(views.strip.projected!.sales).toEqual({ basis: "forecast", cents: 6 * 200_000 + 320_000 });
    expect(calls.some((c) => c.name === "sales_report_daily")).toBe(false);
  });
  it("a day with no forecast has no %, with the reason; its $ stay; the week's % is withheld too (never a partial denominator)", async () => {
    const { views } = await board({ now: NOW, week: WEEK, shifts, forecast: (d) => (d === "2099-01-07" ? null : 200_000) });
    const wed = day(views, "2099-01-07");
    expect(wed).toMatchObject({ pureHourlyCents: 16_000, sales: { basis: "forecast", cents: null }, pureHourlyPct: null, fullyLoadedPct: null, pureHourlyTone: "none" });
    expect(wed.reasons).toEqual(["forecast_missing"]);
    expect(day(views, "2099-01-08").pureHourlyPct).toBe(8);
    expect(views.strip.projected).toMatchObject({ pureHourlyCents: 80_000, sales: { basis: "forecast", cents: null }, pureHourlyPct: null, reasons: ["forecast_missing"] });
  });
  it("a zero forecast is no % either (never Infinity, never 0)", async () => {
    const { views } = await board({ now: NOW, week: WEEK, shifts, forecast: (d) => (d === "2099-01-05" ? 0 : 200_000) });
    expect(day(views, "2099-01-05")).toMatchObject({ pureHourlyPct: null, reasons: ["zero_sales"] });
  });
});

describe("a MIXED week: settled days are the facts, today and later are the schedule; never blended", () => {
  // Wed 2026-10-07, noon ET. The labor database holds the whole week as built facts (Mon 17 h, Tue 10 h, ...);
  // the board treats Mon and Tue as settled and everything from today on as the schedule.
  const WEEK = "2026-10-05", NOW = new Date("2026-10-07T16:00:00Z");
  const shifts = [shift(ALICE, "2026-10-05", 8), shift(ALICE, "2026-10-06", 8), ...["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"].map((d) => shift(ALICE, d, 8))];

  it("days: actual over the Sales report's net, projected over the forecast; the facts of the planned days are replaced", async () => {
    const { views } = await board({ now: NOW, week: WEEK, shifts });
    expect(views.days.map((d) => d.kind)).toEqual(["actual", "actual", "projected", "projected", "projected", "projected", "projected"]);
    // Monday is the FACTS (17 recorded hours), not its 8 scheduled ones: Alice 10 h x $20, Bob 6 h x $30, 1 h at the estimate.
    expect(day(views, "2026-10-05")).toMatchObject({
      minutes: 1_020, straightCents: 20_000 + 18_000 + 1_840, otPremiumCents: 0, salariedCents: 20_000, burdenCents: 7_181, fullyLoadedCents: 39_840 + 20_000 + 7_181,
      sales: { basis: "actual", cents: 500_000 }, pureHourlyPct: 8, fullyLoadedPct: 13.4, rateEstimated: true, salaryProjected: false, otState: "assessed", reasons: [],
    });
    // Friday is the schedule: 20 recorded + 8 + 8 planned hours before it, so its last 4 h are overtime (the stored 8 h are gone).
    expect(day(views, "2026-10-09")).toMatchObject({ minutes: 480, otMinutes: 240, straightCents: 16_000, otPremiumCents: 4_000, sales: { basis: "forecast", cents: 200_000 },
      pureHourlyPct: 10, otState: "projected", reasons: [] });
    expect(day(views, "2026-10-10")).toMatchObject({ otMinutes: 480, otPremiumCents: 8_000 });
  });

  it("the strip: 'actual, 2 of 7 days' and 'projected, 5 days' are two figures with two denominators", async () => {
    const { views } = await board({ now: NOW, week: WEEK, shifts });
    expect(views.strip.actual).toMatchObject({
      days: 2, minutes: 1_620, straightCents: 59_840, otPremiumCents: 0, salariedCents: 40_000, burdenCents: 11_981,
      sales: { basis: "actual", cents: 1_000_000 }, pureHourlyPct: 6, fullyLoadedPct: 11.2, pureHourlyTone: "none", fullyLoadedTone: "none", reasons: ["partial_week"],
    });
    expect(views.strip.projected).toMatchObject({
      days: 5, minutes: 1_920, otMinutes: 720, straightCents: 64_000, otPremiumCents: 12_000, pureHourlyCents: 76_000, salariedCents: 100_000, burdenCents: 18_720 + 2_400,
      sales: { basis: "forecast", cents: 1_000_000 }, pureHourlyPct: 7.6, fullyLoadedPct: 19.7, pureHourlyTone: "good", reasons: [],
    });
    // Never blended: no figure anywhere divides actual + forecast, and the parts add to nothing that is serialized.
    expect(views.strip.actual!.sales.basis).not.toBe(views.strip.projected!.sales.basis);
    expect(views.strip).toMatchObject({ notSettledDays: 0, noScheduleDays: 0 });
  });

  it("an actual day whose sales are not captured has no % (9a's rule); the forecast never stands in for it", async () => {
    const { views } = await board({ now: NOW, week: WEEK, shifts, salesCaptured: (d) => d !== "2026-10-06" });
    expect(day(views, "2026-10-06")).toMatchObject({ kind: "actual", sales: { basis: "actual", cents: null }, pureHourlyPct: null, reasons: ["sales_not_covered"] });
    expect(day(views, "2026-10-05").pureHourlyPct).toBe(8);
    expect(views.strip.actual).toMatchObject({ sales: { basis: "actual", cents: null }, pureHourlyPct: null });
    expect(views.strip.projected!.pureHourlyPct).toBe(7.6);
  });

  it("a week whose labor rows moved while they were read is 'rebuilding' as a whole: no figure from two generations", async () => {
    let n = 0;
    const { views } = await board({ now: NOW, week: WEEK, shifts, rpc: {
      // The fingerprint answers the stored one on the first pass and another one on the closing pass.
      fact_labor_week_fingerprint: async (a) => {
        const [r] = await f.q<{ fp: string }>("select fact_labor_week_fingerprint($1, $2) fp", [a.p_week_start, a.p_builder_version]);
        return { data: ++n > 2 ? "0".repeat(32) : r!.fp, error: null };
      },
    } });
    expect(views).toEqual({ state: "rebuilding" });
  });

  it("0345 not applied (the planned pricer is an unknown function): 'not_installed', and the board itself still loads", async () => {
    const { json } = await board({ now: NOW, week: WEEK, shifts, rpc: { fact_labor_cost_planned: () => ({ data: null, error: { code: "PGRST202", message: "x" } }) } });
    expect(json.laborViews).toEqual({ state: "not_installed" });
  });

  it("LAST (it moves the source): a payroll-shop save with no rebuild makes the settled days 'not settled': hours only, no $, no %", async () => {
    await f.q("select save_labor_payroll_shop($1, 20, $2, 'shop', '2026-07-19', 'test: same shop again', (select max(seq) from labor_payroll_shops where sevenshifts_user_id = 20))", [MGR, A]);
    const { views } = await board({ now: NOW, week: WEEK, shifts });
    expect(views.days.slice(0, 2).map((d) => d.kind)).toEqual(["not_settled", "not_settled"]);
    // Hours only: the SCHEDULED 8 h (the day is planned now), nothing priced.
    expect(day(views, "2026-10-05")).toMatchObject({ minutes: 480, straightCents: null, pureHourlyCents: null, fullyLoadedCents: null, pureHourlyPct: null, pureHourlyTone: "none", reasons: ["not_settled"] });
    expect(views.strip.actual).toBeNull();
    expect(views.strip.notSettledDays).toBe(2);
    // The projection counts the not-settled days' SCHEDULED minutes toward the 40 h (never their recorded ones on top):
    // Mon-Sat 8 h each = 48 h, so Saturday's 8 h are overtime.
    expect(views.strip.projected).toMatchObject({ days: 5, otMinutes: 480, otPremiumCents: 8_000 });
  });

  it("fix r1 P2-1, AFTER IT: the GM's salary REASSIGNED to the other shop with no rebuild: the stored (old) salary never prices the projection", async () => {
    // The stored labor_week_salaried row still says $1,400 at shop A; a fresh allocation says nothing is paid here.
    await f.q("select save_labor_payroll_shop($1, 20, $2, 'shop', '2026-07-19', 'test: moved to shop B payroll', (select max(seq) from labor_payroll_shops where sevenshifts_user_id = 20))", [MGR, B]);
    try {
      expect((await f.q<{ c: number }>("select salaried_cents::int c from labor_week_salaried where week_start = '2026-10-04' and location_id = $1", [A]))[0]!.c).toBe(140_000);
      const { views } = await board({ now: NOW, week: WEEK, shifts });
      for (const fig of [day(views, "2026-10-08"), views.strip.projected!]) {
        expect(fig).toMatchObject({ salariedCents: null, burdenCents: null, fullyLoadedCents: null, fullyLoadedPct: null, fullyLoadedTone: "none", salaryProjected: false });
        expect(fig.reasons).toEqual(["salary_rebuilding"]);
      }
      // Hourly money does not depend on the allocation: it keeps its number, its % and its tone.
      expect(day(views, "2026-10-08")).toMatchObject({ straightCents: 16_000, pureHourlyCents: 16_000, pureHourlyPct: 8, pureHourlyTone: "good" });
      // Once the week is rebuilt the stored row IS the new allocation: the old $200 a day is gone from shop A.
      await f.build("2026-10-04"); await f.build("2026-10-11");
      const rebuilt = (await board({ now: NOW, week: WEEK, shifts })).views;
      expect(day(rebuilt, "2026-10-08").reasons).not.toContain("salary_rebuilding");
      expect(day(rebuilt, "2026-10-08").salariedCents).not.toBe(20_000);
    } finally {
      await f.q("select save_labor_payroll_shop($1, 20, $2, 'shop', '2026-07-19', 'test: back to shop A payroll', (select max(seq) from labor_payroll_shops where sevenshifts_user_id = 20))", [MGR, A]);
      await f.build("2026-10-04"); await f.build("2026-10-11");
    }
  });
});

// ── PR 3: the screens' payload, over the REAL loader ────────────────────────────────────────────
describe("PR 3: with the views the real board prices no labor; who gets what per hour", () => {
  const WEEK = "2099-01-05", NOW = new Date("2099-01-01T16:00:00Z");
  const shifts = weekDays(WEEK).slice(0, 6).map((d) => shift(ALICE, d, 8));
  type AnyBoard = { strip: { money?: unknown } | null; tabs: Array<Record<string, unknown>>; days: Array<Record<string, unknown> & { date: string; hours: number[]; labor: { state: string; lines?: Array<{ key: string; params?: Record<string, number> }>; errand?: { key: string } } | null }> };
  const full = async (o: Partial<BoardOpts>) => (await board({ now: NOW, week: WEEK, shifts, ...o })).json as unknown as AnyBoard & { laborViews?: BoardLaborViews };
  const MONEY_KEYS = /"(money|hourlyCostCents|hourlyPct|salariedFixedCents|totalPct|centsByHour)"/;

  it("a GM: no strip money, no tab %, no labor $ / % and no forecast $ per hour; hours per hour; the day and week totals are the views'", async () => {
    const b = await full({ viewer: gm });
    expect(b.laborViews?.state).toBe("ready");
    expect(b.strip!.money).toBeUndefined();
    expect(b.tabs.every((t) => !("hourlyPct" in t))).toBe(true);
    const withHours = b.days.filter((d) => d.hours.length > 0);
    expect(withHours.length).toBeGreaterThan(0);
    for (const d of withHours) {
      expect(d.laborByHour).toBeNull();
      expect("centsByHour" in d).toBe(false);
      const byHour = d.hoursByHour as Array<{ hour: number; hours: number }>;
      expect(byHour.map((h) => h.hour)).toEqual(d.hours);
      // Alice's shift (6:00 to 14:00) on the days she works, hour by hour of the shop's axis; nothing on Sunday.
      for (const h of byHour) expect(h.hours, `${d.date} ${h.hour}`).toBe(d.date !== "2099-01-11" && h.hour >= 6 && h.hour < 14 ? 1 : 0);
      if (d.date !== "2099-01-11") expect(byHour.some((h) => h.hours === 1)).toBe(true);
    }
    // The labor card never shows the board's own money lines: the views' lines, or a named errand.
    for (const d of b.days.filter((x) => x.labor)) {
      const keys = (d.labor!.lines ?? []).map((l) => l.key);
      expect(keys.some((k) => /schedule\.labor\.(max_labor|minus_salaried|max_hours)$/.test(k))).toBe(false);
      if (d.labor!.state === "ok") expect(keys).toEqual(expect.arrayContaining(["schedule.labor.views_max_hours"]));
    }
    // Outside `laborViews` and the labor card, no money key at all.
    const rest = JSON.parse(JSON.stringify(b)) as Record<string, unknown>;
    delete rest.laborViews;
    for (const d of rest.days as Array<Record<string, unknown>>) delete d.labor;
    expect(JSON.stringify(rest)).not.toMatch(MONEY_KEYS);
  });
  it("the labor card's lines ARE the day's views figure: the same sales, salaries, burden and pure hourly $ (a week generated with a forecast)", async () => {
    const b = await full({ viewer: gm, genHourlyCents: 20_000 });
    const views = b.laborViews as BoardLaborViewsReady;
    const mon = day(views, "2099-01-05");
    // Monday as PR 1 pins it: Alice 8 h at $20, a seventh of the $1,400 salary, 12% burden, $2,000 forecast.
    expect(mon).toMatchObject({ straightCents: 16_000, hourlyMinutes: 480, otPremiumCents: 0, pureHourlyCents: 16_000, salariedCents: 20_000, burdenPct: 12, sales: { basis: "forecast", cents: 200_000 } });
    const card = b.days.find((d) => d.date === "2099-01-05")!.labor!;
    expect(card.state).toBe("ok");
    const params = (key: string) => card.lines!.find((l) => l.key === key)?.params;
    // $2,000 x 28% / 1.12 = $500; minus $200 of salaries = $300.
    expect(params("schedule.labor.views_allowance_total")).toEqual({ salesCents: mon.sales.cents, targetPct: views.targets.loadedPct, burdenPct: mon.burdenPct, salariedDayCents: mon.salariedCents, allowanceCents: 30_000 });
    expect(params("schedule.labor.views_max_hours")).toEqual({ allowanceCents: 30_000, premiumCents: mon.otPremiumCents, wageCents: 2_000, hours: 15 });
    expect(params("schedule.labor.views_verdict_under")).toEqual({ projectedCents: mon.pureHourlyCents, allowanceCents: 30_000, diffCents: 14_000 });
    // Saturday carries the week's 8 overtime hours: its premium comes off the hours, and the verdict is its pure hourly $.
    const sat = day(views, "2099-01-10");
    const satCard = b.days.find((d) => d.date === "2099-01-10")!.labor!;
    expect(sat).toMatchObject({ otPremiumCents: 8_000, pureHourlyCents: 24_000 });
    expect(satCard.lines!.find((l) => l.key === "schedule.labor.views_max_hours")?.params).toEqual({ allowanceCents: 30_000, premiumCents: 8_000, wageCents: 2_000, hours: 11 });
    expect(satCard.lines!.find((l) => l.key === "schedule.labor.views_verdict_under")?.params).toEqual({ projectedCents: 24_000, allowanceCents: 30_000, diffCents: 6_000 });
    // A GM's windows are the displayed fields only.
    for (const w of (card as unknown as { windows: Array<Record<string, unknown>> }).windows) expect(Object.keys(w).sort()).toEqual(["amberReasons", "floorHeads", "fromQ", "key", "on", "optimal", "toQ", "tone"]);
  });
  it("a MoO: the same board plus straight-time % per hour and the forecast $ per hour; still no strip money and no tab %", async () => {
    const b = await full({ viewer: moo });
    expect(b.strip!.money).toBeUndefined();
    expect(b.tabs.every((t) => !("hourlyPct" in t))).toBe(true);
    for (const d of b.days.filter((x) => x.hours.length > 0)) {
      expect(Array.isArray(d.laborByHour)).toBe(true);
      expect((d.hoursByHour as unknown[]).length).toBe(d.hours.length);
    }
  });
  it("an AGM's board with the switch on is byte for byte the board with it off (no additions)", async () => {
    const on = await board({ now: NOW, week: WEEK, shifts, viewer: agm });
    const off = await board({ now: NOW, week: WEEK, shifts, viewer: agm, env: {} });
    expect(JSON.stringify(on.json)).toBe(JSON.stringify(off.json));
    expect(JSON.stringify(on.json)).not.toMatch(/hoursByHour|laborViews/);
  });
  it("switch OFF: a GM's board is what it was (its own strip money, tab %, labor % per hour; no hours row, no views)", async () => {
    const b = await full({ viewer: gm, env: {} });
    expect(b.strip!.money).toBeDefined();
    expect(b.tabs.every((t) => "hourlyPct" in t)).toBe(true);
    for (const d of b.days.filter((x) => x.hours.length > 0)) {
      expect(Array.isArray(d.laborByHour)).toBe(true);
      expect("hoursByHour" in d).toBe(false);
    }
    expect("laborViews" in b).toBe(false);
  });
});

describe("dark by default; who receives it; what is in it", () => {
  const WEEK = "2099-01-05", NOW = new Date("2099-01-01T16:00:00Z");
  const shifts = weekDays(WEEK).slice(0, 6).map((d) => shift(ALICE, d, 8));
  it("without SCHEDULE_LABOR_VIEWS (or either fact switch) the board carries no laborViews key and makes no labor read", async () => {
    for (const env of [{}, { ...ON, SCHEDULE_LABOR_VIEWS: "0" }, { ...ON, FACT_LAYER_LABOR: undefined }]) {
      const { json, calls } = await board({ now: NOW, week: WEEK, shifts, env });
      expect("laborViews" in json).toBe(false);
      expect(calls).toEqual([]);
    }
  });
  it("an AGM never receives it (and no labor read is made for one); a MoO does", async () => {
    const a = await board({ now: NOW, week: WEEK, shifts, viewer: agm });
    expect("laborViews" in a.json).toBe(false);
    expect(a.calls).toEqual([]);
    expect((await board({ now: NOW, week: WEEK, shifts, viewer: moo })).views.state).toBe("ready");
  });
  it("the serialized payload is an allowlist: shop totals per day and per strip line, no wage, no rate, no person", async () => {
    const leaves = (v: unknown, p: string, out: Set<string>): Set<string> => {
      if (Array.isArray(v)) { if (v.length === 0 || v.every((x) => typeof x !== "object")) out.add(`${p}[]`); else for (const x of v) leaves(x, `${p}[]`, out); return out; }
      if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) leaves(x, `${p}.${k}`, out); return out; }
      out.add(p);
      return out;
    };
    const allowed = new Set<string>(BOARD_LABOR_VIEW_PATHS);
    for (const o of [{ now: NOW, week: WEEK, shifts }, { now: new Date("2026-10-07T16:00:00Z"), week: "2026-10-05", shifts: [shift(ALICE, "2026-10-08", 8), shift(NEW_HIRE, "2026-10-09", 2)] }]) {
      for (const viewer of [gm, moo]) {
        const { json } = await board({ ...o, viewer });
        for (const p of leaves(json.laborViews, "", new Set())) expect(allowed.has(p), p).toBe(true);
        const text = JSON.stringify(json.laborViews);
        for (const banned of ["person_key", "rate_cents", "wage_cents", "rate_basis", ALICE, NEW_HIRE, GMU, "u:"]) expect(text.includes(banned), banned).toBe(false);
      }
    }
  });
});
