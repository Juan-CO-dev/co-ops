/**
 * Catering delivery D1 — cost folding (plan r6 section 4.4): correction chains, snapshot vs delta, the invoice total,
 * and the discriminated ORDER cost. Unknown is not zero.
 */
import { describe, expect, it } from "vitest";
import { costHeads, jobCost, orderCost } from "@/lib/delivery/cost-shared";
import type { DeliveryCostRow } from "@/lib/delivery/types-shared";

let n = 0;
function row(jobId: string, component: DeliveryCostRow["component"], amountCents: number, over: Partial<DeliveryCostRow> = {}): DeliveryCostRow {
  n += 1;
  return { id: `c${n}`, jobId, component, semantics: "snapshot", amountCents, moneyIdentity: `${jobId}:${component}`, source: "manual", providerRef: null,
    observedAt: `2026-11-22T10:${String(n % 60).padStart(2, "0")}:00Z`, correctsId: null, actorId: null, note: null, ...over };
}

describe("the head of a correction chain is the figure", () => {
  it("3000 -> 3500 -> 3600 folds to 3600, whatever the row order", () => {
    const a = row("j1", "base", 3000), b = row("j1", "base", 3500, { correctsId: a.id }), c = row("j1", "base", 3600, { correctsId: b.id });
    for (const rows of [[a, b, c], [c, a, b], [b, c, a]]) {
      expect(costHeads(rows).map((r) => r.id)).toEqual([c.id]);
      expect(jobCost(rows)).toMatchObject({ kind: "known", cents: 3600, basis: "components" });
    }
  });

  it("a job's cost is the sum of its component heads; a credit lowers it", () => {
    const base = row("j1", "base", 3000), fixed = row("j1", "base", 3200, { correctsId: base.id });
    const rows = [base, fixed, row("j1", "wait_time", 800), row("j1", "credit", -200), row("j1", "adjustment", 150)];
    const cost = jobCost(rows);
    expect(cost).toMatchObject({ kind: "known", cents: 3950, basis: "components", componentsCents: 3950, invoiceTotalCents: null, differenceCents: null });
    expect(cost.kind === "known" && cost.components).toEqual([
      { component: "base", cents: 3200 }, { component: "adjustment", cents: 150 }, { component: "wait_time", cents: 800 }, { component: "credit", cents: -200 }]);
  });

  it("an invoice total IS the cost; the components stay as the explanation and the difference is shown, never absorbed", () => {
    const rows = [row("j1", "base", 3000), row("j1", "wait_time", 500), row("j1", "invoice_total", 3900)];
    expect(jobCost(rows)).toMatchObject({ kind: "known", cents: 3900, basis: "invoice_total", componentsCents: 3500, invoiceTotalCents: 3900, differenceCents: 400 });
    expect(jobCost([row("j1", "invoice_total", 4100)])).toMatchObject({ kind: "known", cents: 4100, basis: "invoice_total", componentsCents: 0, differenceCents: null });
  });

  it("delta observations of one identity add up; a snapshot replaces what came before it (the D5 shapes)", () => {
    const d1 = row("j1", "adjustment", 100, { semantics: "delta", source: "provider", moneyIdentity: "p:adj", observedAt: "2026-11-22T10:00:00Z" });
    const d2 = row("j1", "adjustment", 250, { semantics: "delta", source: "provider", moneyIdentity: "p:adj", observedAt: "2026-11-22T11:00:00Z" });
    expect(jobCost([d1, d2])).toMatchObject({ kind: "known", cents: 350 });
    const s1 = row("j1", "base", 3000, { source: "provider", moneyIdentity: "p:base", observedAt: "2026-11-22T10:00:00Z" });
    const s2 = row("j1", "base", 3300, { source: "provider", moneyIdentity: "p:base", observedAt: "2026-11-22T12:00:00Z" });
    expect(jobCost([s2, s1])).toMatchObject({ kind: "known", cents: 3300 });
    const later = row("j1", "base", 40, { semantics: "delta", source: "provider", moneyIdentity: "p:base", observedAt: "2026-11-22T13:00:00Z" });
    const earlier = row("j1", "base", 999, { semantics: "delta", source: "provider", moneyIdentity: "p:base", observedAt: "2026-11-22T09:00:00Z" });
    expect(jobCost([s1, s2, later, earlier])).toMatchObject({ kind: "known", cents: 3340 });
  });
});

describe("unknown is not zero", () => {
  it("a job with no cost row is unknown; an explicit zero is a record", () => {
    expect(jobCost([])).toEqual({ kind: "unknown" });
    expect(jobCost([row("j1", "base", 0)])).toMatchObject({ kind: "known", cents: 0 });
  });

  it("an order's cost: none, unknown, partial, complete", () => {
    expect(orderCost([])).toEqual({ kind: "none" });
    expect(orderCost([{ jobId: "j1", costs: [] }])).toEqual({ kind: "unknown" });
    expect(orderCost([{ jobId: "j1", costs: [] }, { jobId: "j2", costs: [] }])).toEqual({ kind: "unknown" });
    expect(orderCost([{ jobId: "j1", costs: [row("j1", "base", 3000)] }])).toEqual({ kind: "complete", cents: 3000 });
    expect(orderCost([{ jobId: "j1", costs: [row("j1", "base", 0)] }, { jobId: "j2", costs: [row("j2", "base", 3000), row("j2", "wait_time", 500)] }]))
      .toEqual({ kind: "complete", cents: 3500 });
  });

  it("GOLDEN: a cancelled job with no cost row + a replacement at $30 is partial 'at least $30', never $30", () => {
    const got = orderCost([{ jobId: "j1", costs: [] }, { jobId: "j2", costs: [row("j2", "base", 3000)] }]);
    expect(got).toEqual({ kind: "partial", knownCents: 3000, unknownJobs: 1 });
  });

  it("a row is folded into ITS job only (rows of another job handed in by mistake are ignored)", () => {
    expect(orderCost([{ jobId: "j1", costs: [row("j2", "base", 3000)] }])).toEqual({ kind: "unknown" });
  });
});
