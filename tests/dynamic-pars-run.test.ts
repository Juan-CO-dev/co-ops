/**
 * Unit spine — the nightly RUN's pure assembly rules (lib/dynamic-pars-run-shared.ts).
 *
 * These are the three decisions the shadow engine makes that a regression would be SILENT
 * about, so each is pinned against the failure it prevents rather than against its own
 * implementation:
 *
 *   · the per-date product rollup — a primary flip reading as demand collapse (r1-3),
 *   · the prior + budget derivation — a re-invoked nightly run reaching a DIFFERENT
 *     verdict than the first (projects r3 P2-10; this is the whole idempotence property),
 *   · the run tally — the reason histogram, which is this phase's success measure.
 */
import { describe, it, expect } from "vitest";

import {
  derivePriorAndBudget,
  directionConfirmed,
  normalizePerOrderUnitOz,
  perSkuSeries,
  rollupPerDate,
  slotKey,
  tallyRun,
  type LedgerPriorInputRow,
  type SuggestionActionRow,
  type TallyRow,
} from "@/lib/dynamic-pars-run-shared";
import { classifyParReason, type ParReasonCode } from "@/lib/dynamic-pars-shared";

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface Dep { date: string; sku: string; oz: number }
const dep = (date: string, sku: string, oz: number): Dep => ({ date, sku, oz });
const rollup = (rows: Dep[], productBySku: Map<string, string>) =>
  rollupPerDate(rows, (r) => r.date, (r) => r.sku, (r) => r.oz, productBySku);

const led = (o: Partial<LedgerPriorInputRow> & { skuId: string; runDate: string }): LedgerPriorInputRow => ({
  dayClass: "weekday", outcome: "advisory_null", currentPar: null, suggestedPar: null,
  generationId: null, ...o,
});

const tally = (o: Partial<TallyRow>): TallyRow => ({
  outcome: "advisory_null", tier: "none", suppressedBy: null,
  reasonCode: "ok" as ParReasonCode, ...o,
});

// ── The per-date product rollup ───────────────────────────────────────────────

describe("rollupPerDate — twins net at PRODUCT grain, per day", () => {
  // Two vendors' ham under one product. The primary flips mid-window: Baldor's rows stop
  // and PFG's start. At SKU grain that reads as "ham demand collapsed"; at product grain
  // it is one steady identity.
  const productBySku = new Map([["ham-baldor", "HAM"], ["ham-pfg", "HAM"]]);

  it("gives every member the product's total for THAT date", () => {
    const out = rollup([dep("2026-08-01", "ham-baldor", 30), dep("2026-08-01", "ham-pfg", 20)], productBySku);
    expect(out.get("2026-08-01")?.get("ham-baldor")).toBe(50);
    expect(out.get("2026-08-01")?.get("ham-pfg")).toBe(50);
  });

  it("A PRIMARY FLIP DOES NOT READ AS DEMAND COLLAPSE — the whole point (r1-3)", () => {
    const out = rollup(
      [dep("2026-08-01", "ham-baldor", 40), dep("2026-08-02", "ham-pfg", 40)],
      productBySku,
    );
    // Both days show 40 for BOTH members, so the daily series velocity and the peak floor
    // read is flat — not a 100% crash followed by a 100% spike.
    expect(out.get("2026-08-01")?.get("ham-baldor")).toBe(40);
    expect(out.get("2026-08-01")?.get("ham-pfg")).toBe(40);
    expect(out.get("2026-08-02")?.get("ham-baldor")).toBe(40);
    expect(out.get("2026-08-02")?.get("ham-pfg")).toBe(40);
  });

  it("a rollup over the WHOLE WINDOW would not have caught that — hence per date", () => {
    // Same rows, but ask each date separately: the per-date answer is what velocity reads.
    const out = rollup([dep("2026-08-01", "ham-baldor", 40), dep("2026-08-02", "ham-pfg", 10)], productBySku);
    expect(out.get("2026-08-01")?.get("ham-pfg")).toBe(40);
    expect(out.get("2026-08-02")?.get("ham-baldor")).toBe(10);
  });

  it("a singleton SKU (product_id NULL) is untouched", () => {
    const out = rollup([dep("2026-08-01", "salt", 3)], productBySku);
    expect(out.get("2026-08-01")?.get("salt")).toBe(3);
  });

  it("sums repeated rows for one (date, sku) before rolling up", () => {
    const out = rollup([dep("2026-08-01", "salt", 3), dep("2026-08-01", "salt", 4)], new Map());
    expect(out.get("2026-08-01")?.get("salt")).toBe(7);
  });

  it("DROPS zero and non-finite values — absent means 'no demand', not '0 oz recorded'", () => {
    // computeBaseRate's TRUE-ZERO rule depends on this distinction: a day the register ran
    // and this SKU did not move is a zero in the DENOMINATOR, resolved from the window's
    // observability oracles, never from a 0-valued ledger row.
    const out = rollup([dep("2026-08-01", "salt", 0), dep("2026-08-01", "pepper", NaN)], new Map());
    expect(out.get("2026-08-01")).toBeUndefined();
  });

  it("ignores rows with an empty date rather than bucketing them under ''", () => {
    const out = rollup([dep("", "salt", 5)], new Map());
    expect(out.size).toBe(0);
  });
});

// ── The order-unit denominator ────────────────────────────────────────────────

describe("normalizePerOrderUnitOz — a 0-oz denominator is a WEIGHT errand (F5)", () => {
  it("keeps a positive denominator untouched", () => {
    expect(normalizePerOrderUnitOz(12.5)).toBe(12.5);
  });

  it("collapses 0, negatives and non-finite values to null", () => {
    for (const v of [0, -1, NaN, Infinity]) expect(normalizePerOrderUnitOz(v)).toBeNull();
  });

  it("passes null and undefined straight through", () => {
    expect(normalizePerOrderUnitOz(null)).toBeNull();
    expect(normalizePerOrderUnitOz(undefined)).toBeNull();
  });

  it("A 0-OZ DENOMINATOR LEDGERS no_weight_basis, NEVER thin_history", () => {
    // The bug this closes end to end: classifyParReason silences on `== null` while
    // computeCoverage rejects `<= 0`, so an unnormalized 0 slipped the ladder, reached
    // coverage, came back null, and got miscaused as thin history — an errand pointing at
    // the demand window when the real fault is the SKU's pack chain.
    const LADDER = {
      inventoryOnly: false, productRetired: false, depletionCurrent: true,
      laneNeverStarted: false, laneComplete: true, hasPackChain: false,
      hasRhythm: true, thin: false, slotExists: true, noLocalHistory: false,
    };
    expect(classifyParReason({ ...LADDER, perOrderUnitOz: normalizePerOrderUnitOz(0) }))
      .toBe("no_weight_basis");
    // …and with a pack chain present the ladder names the chain instead, as it should.
    expect(classifyParReason({
      ...LADDER, hasPackChain: true, perOrderUnitOz: normalizePerOrderUnitOz(0),
    })).toBe("unresolvable_pack");
    // Sanity: a real denominator still reaches "ok".
    expect(classifyParReason({ ...LADDER, perOrderUnitOz: normalizePerOrderUnitOz(12) }))
      .toBe("ok");
  });
});

describe("perSkuSeries", () => {
  it("extracts one SKU's date→oz slice and omits the dates it is absent from", () => {
    const byDate = new Map([
      ["2026-08-01", new Map([["a", 5], ["b", 7]])],
      ["2026-08-02", new Map([["b", 7]])],
    ]);
    expect([...perSkuSeries(byDate, "a")]).toEqual([["2026-08-01", 5]]);
  });
});

// ── The prior + the budget: THE IDEMPOTENCE PROPERTY ──────────────────────────

describe("derivePriorAndBudget — a re-invoked run must reach the same verdict", () => {
  const ARGS = { runDateEt: "2026-08-22", budgetFrom: "2026-08-15" };

  it("THE PRIOR IS STRICTLY BEFORE THE RUN DATE — this run's own row is not its own prior", () => {
    // The failure this prevents: invocation #1 writes a would_apply for 08-22; invocation
    // #2 reads it as "the previous run", confirms the direction against itself, and
    // auto-applies what #1 only suggested. The delete has not happened yet at read time.
    const { priorBySlot } = derivePriorAndBudget(
      [
        led({ skuId: "s1", runDate: "2026-08-22", currentPar: 4, suggestedPar: 5, outcome: "would_apply" }),
        led({ skuId: "s1", runDate: "2026-08-21", currentPar: 4, suggestedPar: 5, outcome: "suppressed" }),
      ],
      [],
      ARGS,
    );
    const prior = priorBySlot.get(slotKey("s1", "weekday"));
    expect(prior?.suggestedPar).toBe(5);
    expect(prior?.direction).toBe(1);
  });

  it("takes the NEWEST prior row, given newest-first input", () => {
    const { priorBySlot } = derivePriorAndBudget(
      [
        led({ skuId: "s1", runDate: "2026-08-21", currentPar: 4, suggestedPar: 6 }),
        led({ skuId: "s1", runDate: "2026-08-20", currentPar: 4, suggestedPar: 5 }),
      ],
      [], ARGS,
    );
    expect(priorBySlot.get(slotKey("s1", "weekday"))?.suggestedPar).toBe(6);
  });

  it("a prior that proposed nothing has direction 0 and confirms nothing", () => {
    const { priorBySlot } = derivePriorAndBudget(
      [led({ skuId: "s1", runDate: "2026-08-21", currentPar: 4, suggestedPar: null })], [], ARGS,
    );
    expect(priorBySlot.get(slotKey("s1", "weekday"))?.direction).toBe(0);
  });

  it("keeps the two day-classes apart", () => {
    const { priorBySlot } = derivePriorAndBudget(
      [
        led({ skuId: "s1", dayClass: "weekday", runDate: "2026-08-21", currentPar: 4, suggestedPar: 5 }),
        led({ skuId: "s1", dayClass: "weekend", runDate: "2026-08-21", currentPar: 6, suggestedPar: 8 }),
      ],
      [], ARGS,
    );
    expect(priorBySlot.get(slotKey("s1", "weekday"))?.suggestedPar).toBe(5);
    expect(priorBySlot.get(slotKey("s1", "weekend"))?.suggestedPar).toBe(8);
  });

  it("ignores a day_class the vocabulary does not contain", () => {
    const { priorBySlot } = derivePriorAndBudget(
      [led({ skuId: "s1", dayClass: "holiday", runDate: "2026-08-21", currentPar: 4, suggestedPar: 5 })],
      [], ARGS,
    );
    expect(priorBySlot.size).toBe(0);
  });

  it("BUDGET: this run's own would_apply does NOT spend the budget (P2-10)", () => {
    // Invocation #2 must not find the budget spent by invocation #1's simulation.
    const { budgetSpentBySlot } = derivePriorAndBudget(
      [led({ skuId: "s1", runDate: "2026-08-22", outcome: "would_apply" })], [], ARGS,
    );
    expect(budgetSpentBySlot.has(slotKey("s1", "weekday"))).toBe(false);
  });

  it("BUDGET: an EARLIER would_apply does spend it — the simulation is longitudinal", () => {
    const { budgetSpentBySlot } = derivePriorAndBudget(
      [led({ skuId: "s1", runDate: "2026-08-21", outcome: "would_apply" })], [], ARGS,
    );
    expect(budgetSpentBySlot.has(slotKey("s1", "weekday"))).toBe(true);
  });

  it("BUDGET: an `applied` row spends it even on the run date — it was a REAL write", () => {
    const { budgetSpentBySlot } = derivePriorAndBudget(
      [led({ skuId: "s1", runDate: "2026-08-22", outcome: "applied" })], [], ARGS,
    );
    expect(budgetSpentBySlot.has(slotKey("s1", "weekday"))).toBe(true);
  });

  it("BUDGET: a row older than the window does not spend it", () => {
    const { budgetSpentBySlot } = derivePriorAndBudget(
      [led({ skuId: "s1", runDate: "2026-08-14", outcome: "applied" })], [], ARGS,
    );
    expect(budgetSpentBySlot.has(slotKey("s1", "weekday"))).toBe(false);
  });

  it("BUDGET: suppressed / advisory_null rows never spend it", () => {
    const { budgetSpentBySlot } = derivePriorAndBudget(
      [
        led({ skuId: "s1", runDate: "2026-08-21", outcome: "suppressed" }),
        led({ skuId: "s1", runDate: "2026-08-20", outcome: "advisory_null" }),
      ],
      [], ARGS,
    );
    expect(budgetSpentBySlot.size).toBe(0);
  });

  it("BUDGET: a REVERT spends it; an ACCEPT is free; a DISMISS changes nothing (r2-8)", () => {
    const actions: SuggestionActionRow[] = [
      { skuId: "s1", dayClass: "weekday", action: "revert" },
      { skuId: "s2", dayClass: "weekday", action: "accept" },
      { skuId: "s3", dayClass: "weekday", action: "dismiss" },
    ];
    const { budgetSpentBySlot } = derivePriorAndBudget([], actions, ARGS);
    expect(budgetSpentBySlot.has(slotKey("s1", "weekday"))).toBe(true);
    expect(budgetSpentBySlot.has(slotKey("s2", "weekday"))).toBe(false);
    expect(budgetSpentBySlot.has(slotKey("s3", "weekday"))).toBe(false);
  });

  it("IS PURE AND STABLE: two identical invocations give identical answers", () => {
    const rows = [
      led({ skuId: "s1", runDate: "2026-08-22", outcome: "would_apply", currentPar: 4, suggestedPar: 5 }),
      led({ skuId: "s1", runDate: "2026-08-21", outcome: "suppressed", currentPar: 4, suggestedPar: 5 }),
    ];
    const a = derivePriorAndBudget(rows, [], ARGS);
    const b = derivePriorAndBudget(rows, [], ARGS);
    expect([...a.priorBySlot]).toEqual([...b.priorBySlot]);
    expect([...a.budgetSpentBySlot]).toEqual([...b.budgetSpentBySlot]);
  });
});

describe("directionConfirmed — two consecutive runs must agree (r1-6)", () => {
  const up = { suggestedPar: 5, generationId: null, direction: 1 };
  const down = { suggestedPar: 3, generationId: null, direction: -1 };
  const flat = { suggestedPar: 4, generationId: null, direction: 0 };

  it("confirms when this run moves the same way as the last", () => {
    expect(directionConfirmed(up, 4, 5)).toBe(true);
    expect(directionConfirmed(down, 4, 3)).toBe(true);
  });

  it("refuses when the direction reversed — the oscillation this guard exists for", () => {
    expect(directionConfirmed(up, 4, 3)).toBe(false);
  });

  it("refuses on the FIRST night of any move: no prior, or a prior that proposed nothing", () => {
    expect(directionConfirmed(null, 4, 5)).toBe(false);
    expect(directionConfirmed(flat, 4, 5)).toBe(false);
  });

  it("refuses when there is no standing par to move from", () => {
    expect(directionConfirmed(up, null, 5)).toBe(false);
  });
});

// ── The run tally ─────────────────────────────────────────────────────────────

describe("tallyRun — the ONE audit row's payload", () => {
  it("counts outcomes, tiers, guards and reasons independently", () => {
    const counts = tallyRun([
      tally({ outcome: "would_apply", tier: "auto" }),
      tally({ outcome: "suppressed", tier: "suggestion", suppressedBy: "band" }),
      tally({ outcome: "suppressed", tier: "suggestion", suppressedBy: "band" }),
      tally({ outcome: "suppressed", tier: "suggestion", suppressedBy: "budget", reasonCode: "budget_spent" }),
      tally({ outcome: "advisory_null", reasonCode: "inventory_only" }),
      tally({ outcome: "applied", tier: "auto" }),
    ]);
    expect(counts.rows).toBe(6);
    expect(counts.wouldApply).toBe(1);
    expect(counts.applied).toBe(1);
    expect(counts.suggestion).toBe(3);
    expect(counts.advisoryNull).toBe(1);
    expect(counts.suppressedBy).toEqual({ band: 2, budget: 1 });
    expect(counts.byReason).toEqual({ ok: 4, budget_spent: 1, inventory_only: 1 });
  });

  it("EVERY row lands in the reason histogram — a silent par is a WRITE, never a skip", () => {
    // The phase's success measure is reason-lane completeness, so the histogram's total
    // must equal the row count for any ledger at all.
    const ledger = [
      tally({ reasonCode: "inventory_only" }), tally({ reasonCode: "no_weight_basis" }),
      tally({ reasonCode: "no_vendor_rhythm" }), tally({ reasonCode: "ok" }),
    ];
    const counts = tallyRun(ledger);
    const total = Object.values(counts.byReason).reduce((n, v) => n + v, 0);
    expect(total).toBe(counts.rows);
  });

  it("an empty run tallies to zeroes, not to undefined", () => {
    expect(tallyRun([])).toEqual({
      rows: 0, wouldApply: 0, applied: 0, suggestion: 0, advisoryNull: 0,
      suppressedBy: {}, byReason: {},
    });
  });
});
