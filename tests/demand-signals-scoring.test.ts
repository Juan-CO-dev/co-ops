// Item 4 PR 1: the scoring contract and the pass rule, fixed in code before any run.
// Astra r2 P2 #2: a qualification is for ONE target x decision lead, and authorizes only that.
import { describe, expect, it } from "vitest";
import {
  PASS_RULE, authorizes, biasOf, classAccuracy, coverageSim, episodeIdsFor, qualify, scoreScope, signalHelpsInCombination, wapeOf,
  type PairedRow, type ScopeResult,
} from "@/lib/demand-signals/scoring-shared";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";

const SHOP_A = "shop-a", SHOP_B = "shop-b";
interface Opts { lead?: number; target?: PairedRow["target"]; weeks?: number; baseErr?: number; candErr?: number; candErrB?: number; baseBias?: number; candBias?: number; episodesEvery?: number }
/** `weeks` weeks of daily rows at two shops. Errors alternate sign so the bias is what `*Bias` says. */
function rows(o: Opts = {}): PairedRow[] {
  const out: PairedRow[] = [];
  const weeks = o.weeks ?? 10;
  for (let d = 0; d < weeks * 7; d += 1) {
    const validDate = addDaysEt("2026-08-03", d);
    for (const shopId of [SHOP_A, SHOP_B]) {
      const actual = 1000 + (d % 7) * 50;
      const sign = d % 2 === 0 ? 1 : -1;
      const be = (o.baseErr ?? 100) * sign + (o.baseBias ?? 0);
      const ce = ((shopId === SHOP_B ? o.candErrB : undefined) ?? o.candErr ?? 80) * sign + (o.candBias ?? 0);
      out.push({ shopId, target: o.target ?? "labor_day_cents", leadDays: o.lead ?? 3, validDate, unitKey: "", baseline: actual + be, candidate: actual + ce, actual,
        episodeId: o.episodesEvery != null && d % o.episodesEvery === 0 ? `e:${validDate}` : null });
    }
  }
  return out;
}
const scope = (lead = 3, target: PairedRow["target"] = "labor_day_cents") => ({ target, leadDays: lead });
const score = (o: Opts = {}): ScopeResult => scoreScope(rows(o), scope(o.lead ?? 3, o.target ?? "labor_day_cents"));
const q = (dev: ScopeResult, holdout: ScopeResult | null, evidenceClass: "E0" | "E1" | "E2" = "E2") =>
  qualify({ scope: dev.scope, modelHash: "m".repeat(64), evidenceClass, dev, holdout, evidenceRunId: "run-1", holdoutReadId: "read-1" });

describe("formulas", () => {
  const r = (forecast: number | null, actual: number | null) => ({ forecast, actual });
  it("WAPE = sum|F-A| / sum A and bias = sum(F-A) / sum A", () => {
    const xs = [r(110, 100), r(80, 100), r(100, 100)];
    expect(wapeOf(xs).value).toBeCloseTo(30 / 300, 12);
    expect(biasOf(xs).value).toBeCloseTo(-10 / 300, 12);
  });
  it("sum A = 0 is undefined (null), never 0 and never infinite", () => {
    expect(wapeOf([r(5, 0), r(0, 0)]).value).toBeNull();
    expect(biasOf([r(5, 0)]).value).toBeNull();
    expect(wapeOf([]).value).toBeNull();
  });
  it("a missing actual or forecast is excluded and counted, never scored as zero", () => {
    const w = wapeOf([r(110, 100), r(50, null), r(null, 100)]);
    expect(w.value).toBeCloseTo(0.1, 12);
    expect(w.n).toBe(1);
    expect(w.excluded).toBe(2);
  });
  it("the coverage simulation reports shortfall and over-cover ounces (never called stockouts)", () => {
    expect(coverageSim(100, 130)).toEqual({ shortfallOz: 30, overCoverOz: 0 });
    expect(coverageSim(100, 70)).toEqual({ shortfallOz: 0, overCoverOz: 30 });
    expect(Object.keys(coverageSim(1, 1)).join(",")).not.toMatch(/stock/i);
  });
  it("the slow / normal / busy call is an accuracy, with weekends as their own class", () => {
    expect(classAccuracy([{ forecast: "slow", actual: "slow" }, { forecast: "busy", actual: "normal" }, { forecast: "weekend", actual: "weekend" }, { forecast: null, actual: "busy" }]))
      .toEqual({ n: 3, correct: 2, value: 2 / 3, excluded: 1 });
  });
});

describe("one scope = one target x one decision lead", () => {
  it("refuses rows of another lead or another target (dollars and ounces are never pooled)", () => {
    expect(() => scoreScope([...rows({ lead: 3 }), ...rows({ lead: 7 })], scope(3))).toThrow("mixed_scope");
    expect(() => scoreScope([...rows(), ...rows({ target: "par_product_day_oz" })], scope(3))).toThrow("mixed_scope");
  });
  it("a row missing in either arm leaves BOTH arms", () => {
    const xs = rows({ weeks: 4 });
    xs[0] = { ...xs[0]!, candidate: null };
    xs[1] = { ...xs[1]!, actual: null };
    const s = scoreScope(xs, scope());
    expect(s.n).toBe(xs.length - 2);
    expect(s.excluded).toEqual({ missingActual: 1, missingForecast: 1 });
  });
  it("pools shops inside the scope and keeps each shop's own score", () => {
    const s = score({ candErr: 80, candErrB: 90 });
    expect(s.relGain).toBeCloseTo(0.15, 6);
    expect(s.byShop[SHOP_A]!.relGain).toBeCloseTo(0.2, 6);
    expect(s.byShop[SHOP_B]!.relGain).toBeCloseTo(0.1, 6);
  });
  it("the week-block bootstrap is deterministic and needs enough weeks", () => {
    expect(score().bootstrapLower).toBe(score().bootstrapLower);
    expect(score().bootstrapLower).toBeGreaterThan(0);
    expect(score({ weeks: PASS_RULE.minWeekBlocks - 1 }).bootstrapLower).toBeNull();
  });
});

describe("episodes", () => {
  it("contiguous days of one event are ONE episode, at every shop (a shutdown counts once)", () => {
    const ids = episodeIdsFor([
      { date: "2026-10-01", eventKey: "shutdown" }, { date: "2026-10-02", eventKey: "shutdown" }, { date: "2026-10-03", eventKey: "shutdown" },
      { date: "2026-10-10", eventKey: "shutdown" }, { date: "2026-10-02", eventKey: "holiday" }]);
    expect(ids.get("shutdown|2026-10-02")).toBe("shutdown:2026-10-01");
    expect(ids.get("shutdown|2026-10-10")).toBe("shutdown:2026-10-10");
    expect(new Set(ids.values()).size).toBe(3);
    const xs = rows({ weeks: 2 }).map((r) => ({ ...r, episodeId: r.validDate <= "2026-08-05" ? "shutdown:2026-08-03" : null }));
    expect(scoreScope(xs, scope()).episodes).toBe(1);
  });
});

describe("the pass rule", () => {
  const good = { candErr: 80, episodesEvery: 7 };
  it("is frozen in code", () => {
    expect(PASS_RULE).toEqual({ minRelGain: 0.05, shopMaxRelLoss: 0.01, minEpisodes: 8, bootstrapSamples: 2000, bootstrapQuantile: 0.05, minWeekBlocks: 4, seed: 20261117 });
    expect(Object.isFrozen(PASS_RULE)).toBe(true);
  });
  it("passes a candidate that clears every gate, and names what it authorizes", () => {
    const res = q(score(good), score(good));
    expect(res.failures).toEqual([]);
    expect(res.pass).toBe(true);
    expect(res.authorized).toMatchObject({ target: "labor_day_cents", leadDays: 3, shopIds: [SHOP_A, SHOP_B], evidenceRunId: "run-1", holdoutReadId: "read-1" });
  });
  it("only E2 evidence can pass (E1 is a display, E0 is nothing)", () => {
    expect(q(score(good), score(good), "E1")).toMatchObject({ pass: false, failures: ["evidence_not_e2"], authorized: null });
    expect(q(score(good), score(good), "E0").failures).toContain("evidence_not_e2");
  });
  it("names each failed gate", () => {
    expect(q(score(good), null).failures).toContain("holdout_missing");
    expect(q(score(good), score({ candErr: 97, episodesEvery: 7 })).failures).toContain("gain_below_min");
    expect(q(score(good), score({ candErr: 60, candErrB: 103, episodesEvery: 7 })).failures).toContain("shop_worse");
    expect(q(score(good), score({ candErr: 80, episodesEvery: 14 })).failures).toContain("episodes_below_min");
    expect(q(score({ candErr: 120, episodesEvery: 7 }), score(good)).failures).toContain("sign_mismatch");
    expect(q(score(good), score({ candErr: 80, episodesEvery: 7, weeks: 3 })).failures).toContain("bootstrap_lower_not_above_zero");
  });
  it("bias is compared in ABSOLUTE value: a more negative bias is worse, not smaller", () => {
    const worse = score({ ...good, baseBias: 20, candBias: -100 });
    expect(worse.candidate.bias!).toBeLessThan(worse.baseline.bias!);
    expect(q(score(good), worse).failures).toContain("bias_worse");
    const better = score({ ...good, baseBias: -100, candBias: 20 });
    expect(q(score(good), better).failures).not.toContain("bias_worse");
  });
  it("a gain at a short lead never authorizes the scheduling lead", () => {
    const short = q(score({ ...good, lead: 1 }), score({ ...good, lead: 1 }));
    const long = q(score({ ...good, lead: 7 }), score({ candErr: 130, episodesEvery: 7, lead: 7 }));
    expect(short.pass).toBe(true);
    expect(long.pass).toBe(false);
    const use = { modelHash: "m".repeat(64), target: "labor_day_cents" as const, shopId: SHOP_A };
    expect(authorizes(short.authorized, { ...use, leadDays: 1 })).toBe(true);
    expect(authorizes(short.authorized, { ...use, leadDays: 7 })).toBe(false);
    expect(authorizes(short.authorized, { ...use, leadDays: 1, target: "labor_hour_cents" })).toBe(false);
    expect(authorizes(short.authorized, { ...use, leadDays: 1, shopId: "shop-c" })).toBe(false);
    expect(authorizes(short.authorized, { ...use, leadDays: 1, modelHash: "n".repeat(64) })).toBe(false);
    expect(authorizes(long.authorized, { ...use, leadDays: 7 })).toBe(false);
  });
  it("a qualification whose dev or holdout is another scope is refused", () => {
    expect(() => qualify({ scope: scope(3), modelHash: "m".repeat(64), evidenceClass: "E2", dev: score({ lead: 1 }), holdout: score(good), evidenceRunId: "r", holdoutReadId: "h" })).toThrow("mixed_scope");
  });
  it("in a combined model a signal must help when left out and added back", () => {
    expect(signalHelpsInCombination(score({ candErr: 70 }), score({ candErr: 80 }))).toBe(true);
    expect(signalHelpsInCombination(score({ candErr: 80 }), score({ candErr: 80 }))).toBe(false);
  });
});
