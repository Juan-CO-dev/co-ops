// Item 4 PR 1: the retrospective (E1) backtest over the three baselines and the two zero-feed candidates,
// and the report Juan reads. Synthetic history only.
import { describe, expect, it } from "vitest";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { runBacktest, type ShopHistory } from "@/lib/demand-signals/backtest";
import { renderReplayReport } from "@/lib/demand-signals/report-shared";
import { laborTargetFromDay, parTargetFromInputs, type LaborInputs, type LaborTarget, type PrepInputs } from "@/lib/demand-signals/replay";
import { buildParInputs, prng } from "./helpers/par-engine-fixture";

const isoDow = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const START = "2026-08-31", DAYS = 84; // through 2026-11-22: Labor Day, Columbus Day, Veterans Day

/** A shop whose sales grow 1% a day and drop 30% on federal holidays. */
function shop(shopId: string, seed: number, holidayDrop = 0.7): ShopHistory {
  const rand = prng(seed);
  const HOLIDAYS = new Set(["2026-09-07", "2026-10-12", "2026-11-11"]);
  const actual = new Map<string, LaborTarget>();
  for (let i = -28; i < DAYS; i += 1) {
    const date = addDaysEt(START, i);
    const level = (300_000 + isoDow(date) * 20_000) * (1 + 0.01 * (i + 28)) * (HOLIDAYS.has(date) ? holidayDrop : 1) * (0.97 + rand() * 0.06);
    const cells = [11, 12, 13, 18].map((hour) => ({ dow: isoDow(date), hour, cents: Math.round(level / 4) }));
    if (i === 20) continue; // one uncaptured day
    actual.set(date, laborTargetFromDay(shopId, date, cells, [date]).payload!);
  }
  const laborDays: LaborInputs[] = [];
  for (let i = 0; i < DAYS - 12; i += 1) {
    const asOf = addDaysEt(START, i);
    const hours: Array<{ dow: number; hour: number; cents: number }> = [];
    const capturedDays: string[] = [];
    for (let k = 1; k <= 28; k += 1) {
      const d = addDaysEt(asOf, -k);
      const t = actual.get(d);
      if (!t) continue;
      capturedDays.push(d);
      t.hourlyCents.forEach((cents, hour) => { if (cents > 0) hours.push({ dow: isoDow(d), hour, cents }); });
    }
    // The RPC returns one cell per (weekday, hour): merge.
    const merged = new Map<string, { dow: number; hour: number; cents: number }>();
    for (const h of hours) { const k = `${h.dow}:${h.hour}`; const m = merged.get(k) ?? { dow: h.dow, hour: h.hour, cents: 0 }; m.cents += h.cents; merged.set(k, m); }
    laborDays.push({ v: 1, locationId: shopId, asOf, baseline: { kind: "ok", raw: { hours: [...merged.values()], capturedDays } }, structureId: "s",
      dayTypes: { slowBelowCents: 400_000, busyAboveCents: 480_000, weekendIsoDows: [6, 7] }, overrides: [] });
  }
  const parNights = [0, 1, 2, 3].map((n) => buildParInputs({ runDate: addDaysEt("2026-10-15", n), seed: seed + n }));
  const lastNight = buildParInputs({ runDate: "2026-10-28", seed: seed + 50 });
  const prep: PrepInputs = { v: 1, locationId: shopId, items: [{ itemId: "aioli", defaultPar: 6, defaultParUnit: "qt", active: true, parRows: [] }] };
  return {
    shopId, shopName: `Shop ${shopId}`, parNights,
    parTargets: (d) => { const t = parTargetFromInputs(lastNight, d); return t === null ? undefined : t.coverage === "covered" ? t.payload! : "not_covered"; },
    laborDays,
    laborTargets: (d) => (d < addDaysEt(START, -28) || d >= addDaysEt(START, DAYS) ? undefined : actual.get(d) ?? "not_covered"),
    prepDays: [{ decisionDate: "2026-10-15", inputs: prep }],
    prepTargets: (d) => (d === "2026-10-15" ? { v: 1, target: "prep_item_day_units", locationId: shopId, validDate: d, units: { aioli: 5 } } : undefined),
  };
}

describe("the E1 backtest", () => {
  const shops = [shop("a", 1), shop("b", 2)];
  const report = runBacktest(shops, { from: START, to: addDaysEt(START, DAYS - 1) });

  it("is deterministic", () => {
    expect(JSON.stringify(runBacktest(shops, { from: START, to: addDaysEt(START, DAYS - 1) }))).toBe(JSON.stringify(report));
  });
  it("scores each baseline per target and per decision lead, never pooled across them", () => {
    const labor = report.baselines.filter((b) => b.surface === "labor");
    expect(new Set(labor.map((b) => `${b.scope.target}:${b.scope.leadDays}`)).size).toBe(24);
    expect(labor.every((b) => b.result.n > 0 && b.result.baseline.wape !== null && Object.keys(b.result.byShop).length === 2)).toBe(true);
    expect(report.baselines.some((b) => b.surface === "pars" && b.scope.target === "par_product_day_oz")).toBe(true);
    expect(report.baselines.find((b) => b.surface === "prep")!.result).toMatchObject({ n: 2 });
    // a growing shop: the trailing average runs low, and lower the further out it looks
    const day = (lead: number) => labor.find((b) => b.scope.target === "labor_day_cents" && b.scope.leadDays === lead)!.result.baseline;
    expect(day(0).bias!).toBeLessThan(0);
    expect(day(11).bias!).toBeLessThan(day(0).bias!);
    expect(labor.find((b) => b.scope.leadDays === 0)!.result.excluded.missingActual).toBeGreaterThan(0);
  });
  it("the trend candidate helps a trending shop, and it is still E1: shown, never qualified", () => {
    const trend = report.candidates.filter((c) => c.surface === "labor" && c.candidate === "trend" && c.scope.target === "labor_day_cents");
    expect(trend.length).toBe(12);
    expect(trend.every((c) => c.result.relGain !== null && c.result.relGain > 0)).toBe(true);
    for (const c of report.candidates) {
      expect(c.qualification.pass).toBe(false);
      expect(c.qualification.failures).toEqual(expect.arrayContaining(["evidence_not_e2", "holdout_missing"]));
      expect(c.qualification.authorized).toBeNull();
      expect(c.modelHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("the holiday candidate learns only from EARLIER holidays (walk-forward) and counts each holiday once", () => {
    const hol = report.candidates.find((c) => c.surface === "labor" && c.candidate === "calendar_holiday" && c.scope.target === "labor_day_cents" && c.scope.leadDays === 1)!;
    // Labor Day has nothing before it; Columbus Day and Veterans Day each learn from what came before: 2 episodes at 2 shops.
    expect(hol.result.episodes).toBe(2);
    expect(hol.result.relGain!).toBeGreaterThan(0);
    // A future holiday's actual cannot reach an earlier decision.
    const altered = [shop("a", 1, 0.2), shop("b", 2, 0.2)];
    const first = (r: typeof report) => r.debug.laborSignals.filter((s) => s.candidate === "calendar_holiday" && s.validDate === "2026-09-07");
    expect(first(runBacktest(altered, { from: START, to: addDaysEt(START, DAYS - 1) })).every((s) => s.multiplier === 1)).toBe(true);
    expect(first(report).every((s) => s.multiplier === 1)).toBe(true);
  });
  it("simulates par coverage as shortfall and over-cover ounces", () => {
    const base = report.coverage.filter((c) => c.arm === "baseline");
    expect(base.length).toBe(2);
    expect(base.every((c) => c.units + c.skippedUnits > 0 && c.shortfallOz >= 0 && c.overCoverOz >= 0)).toBe(true);
  });
});

describe("the report for Juan", () => {
  const md = renderReplayReport(runBacktest([shop("a", 1), shop("b", 2)], { from: START, to: addDaysEt(START, DAYS - 1) }));
  it("opens with how each number is computed today", () => {
    const first = md.indexOf("## 1. How each number is computed today");
    expect(first).toBeGreaterThan(-1);
    expect(md.indexOf("## 2.")).toBeGreaterThan(first);
    for (const phrase of ["21 days", "Fri, Sat and Sun", "like-for-like", "28 days", "same weekday", "default par"]) expect(md).toContain(phrase);
  });
  it("says plainly that nothing here can go live", () => {
    expect(md).toContain("retrospective (E1)");
    expect(md).toContain("cannot turn anything on");
    expect(md).not.toMatch(/stockout/i);
    expect(md).toContain("Shop a");
    expect(md).toMatch(/\| Lead \| Shop \| WAPE \| Bias \|/);
    expect(md).toContain("—"); // an undefined score is a dash
  });
  it("uses no em-dash in prose lines and no shop code", () => {
    for (const line of md.split("\n").filter((l) => !l.startsWith("|"))) expect(line).not.toContain("—");
  });
});
