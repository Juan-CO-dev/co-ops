/**
 * Catering delivery D4 — the pure economics rules (lib/delivery/economics-shared.ts; plan r6 sections 6.3, 4.4, 4.5, 4.8).
 *
 *  - The fee is known ONLY from the accepted order quote; every other case is a NAMED gap, never 0.
 *  - The cost is known ONLY when every delivery of the order has a cost; partial is "at least", never a figure.
 *  - A net exists only with a known fee AND a complete cost; totals run only over orders with a net, and the orders
 *    left out are counted per reason.
 *  - The gratuity is the HEAD of the order's chain; totals count heads only; a void or a 0-cent head allocates nothing;
 *    before delivery the split is EXPECTED.
 *  - `computedSplit` / `recomputeWouldWrite` mirror 0356 (`delivery_computed_split`, `delivery_write_split`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ECONOMICS_GAPS, computedSplit, deliveryEconomics, deliveryOrderHref, deliveryOrderRef, gratuityCorrectionOffer, isDeliveryOrder, orderEconomics, recomputeWouldWrite,
  type EconomicsJob, type OrderEconomicsInput,
} from "@/lib/delivery/economics-shared";
import type { CostFoldRow } from "@/lib/delivery/cost-shared";
import type { SplitFoldRow } from "@/lib/delivery/gratuity-shared";
import type { QuoteCandidate } from "@/lib/delivery/types-shared";

const quote = (o: Partial<QuoteCandidate> = {}): QuoteCandidate =>
  ({ id: "q1", status: "accepted", isDelivery: true, gratuityCents: 10_000, deliveryFeeCents: 4_500, createdAt: "2026-11-20T10:00:00Z", ...o });
const job = (attemptNo: number, status: EconomicsJob["status"], o: Partial<EconomicsJob> = {}): EconomicsJob =>
  ({ id: `job-${attemptNo}`, attemptNo, status, bookedVia: "manual", providerLabel: `Courier ${attemptNo}`, ...o });
const cost = (jobId: string, amountCents: number, o: Partial<CostFoldRow> = {}): CostFoldRow =>
  ({ id: `${jobId}-c-${amountCents}`, jobId, component: "base", semantics: "snapshot", amountCents, moneyIdentity: `${jobId}:base`, observedAt: "2026-11-22T10:00:00Z", correctsId: null, ...o });
const split = (id: string, o: Partial<SplitFoldRow> = {}): SplitFoldRow =>
  ({ id, jobId: "job-1", kind: "split", gratuityCents: 10_000, driverBps: 1000, driverCents: 1_000, crewCents: 9_000, supersedesId: null, ...o });
const ZERO = { orders: 0, gratuityCents: 0, driverCents: 0, crewCents: 0, deliveredNoGratuity: 0, sourceUnknown: 0, zeroHead: 0, voided: 0, needsRecalc: 0, expected: 0 };
const order = (o: Partial<OrderEconomicsInput> = {}): OrderEconomicsInput =>
  ({ leadId: "lead-1", eventDate: "2026-11-25", stage: "completed", isEzcater: false, candidates: [quote()], jobs: [], costs: [], splits: [], driverBps: 1000, ...o });

describe("the fee: only from the accepted order quote; every other case is named", () => {
  it("accepted(q): the quote's delivery fee", () => {
    expect(orderEconomics(order()).fee).toEqual({ kind: "known", cents: 4_500 });
    // An accepted quote with a fee of 0 is a KNOWN zero (the customer was charged no fee), not a gap.
    expect(orderEconomics(order({ candidates: [quote({ deliveryFeeCents: 0 })] })).fee).toEqual({ kind: "known", cents: 0 });
  });
  it("an accepted family beside a declined sibling is still accepted", () => {
    expect(orderEconomics(order({ candidates: [quote(), quote({ id: "q2", status: "declined", deliveryFeeCents: 9_999 })] })).fee).toEqual({ kind: "known", cents: 4_500 });
  });
  it("two accepted quotes: quote_ambiguous, never a guess", () => {
    expect(orderEconomics(order({ candidates: [quote(), quote({ id: "q2" })] })).fee).toEqual({ kind: "gap", reason: "quote_ambiguous" });
  });
  it("nothing accepted (pending, or no quote at all): fee_not_on_quote", () => {
    expect(orderEconomics(order({ candidates: [quote({ status: "sent" })] })).fee).toEqual({ kind: "gap", reason: "fee_not_on_quote" });
    expect(orderEconomics(order({ candidates: [] })).fee).toEqual({ kind: "gap", reason: "fee_not_on_quote" });
  });
  it("an ezCater order: ezcater_fee_unknown, whatever its quotes say", () => {
    expect(orderEconomics(order({ isEzcater: true })).fee).toEqual({ kind: "gap", reason: "ezcater_fee_unknown" });
    expect(orderEconomics(order({ isEzcater: true, candidates: [] })).fee).toEqual({ kind: "gap", reason: "ezcater_fee_unknown" });
  });
  it("a rejected order (lost, or every quote declined) charges no fee: order_rejected", () => {
    expect(orderEconomics(order({ stage: "lost" })).fee).toEqual({ kind: "gap", reason: "order_rejected" });
    expect(orderEconomics(order({ candidates: [quote({ status: "declined" })] })).fee).toEqual({ kind: "gap", reason: "order_rejected" });
  });
});

describe("the cost and the net: unknown is not zero", () => {
  it("fee known + every delivery costed = a net", () => {
    const o = orderEconomics(order({ jobs: [job(1, "delivered")], costs: [cost("job-1", 3_000)] }));
    expect([o.cost, o.netCents, o.gaps]).toEqual([{ kind: "complete", cents: 3_000 }, 1_500, []]);
  });
  it("a net can be negative (the courier cost more than the fee)", () => {
    expect(orderEconomics(order({ jobs: [job(1, "delivered")], costs: [cost("job-1", 6_000)] })).netCents).toBe(-1_500);
  });
  it("an explicit 'no charge' (a 0 row) is a record: complete at 0", () => {
    const o = orderEconomics(order({ jobs: [job(1, "cancelled")], costs: [cost("job-1", 0)] }));
    expect([o.cost, o.netCents]).toEqual([{ kind: "complete", cents: 0 }, 4_500]);
  });
  it("no delivery recorded, or no delivery costed: cost_not_recorded, no net", () => {
    for (const o of [orderEconomics(order()), orderEconomics(order({ jobs: [job(1, "delivered")] }))]) expect([o.netCents, o.gaps]).toEqual([null, ["cost_not_recorded"]]);
    expect(orderEconomics(order()).cost).toEqual({ kind: "none" });
    expect(orderEconomics(order({ jobs: [job(1, "delivered")] })).cost).toEqual({ kind: "unknown" });
  });
  it("GOLDEN: a cancelled job with no cost row + a replacement at $30 = partial 'at least $30', no net, out of the totals", () => {
    const input = order({ jobs: [job(1, "cancelled"), job(2, "delivered")], costs: [cost("job-2", 3_000)] });
    const o = orderEconomics(input);
    expect(o.cost).toEqual({ kind: "partial", knownCents: 3_000, unknownJobs: 1 });
    expect([o.netCents, o.gaps]).toEqual([null, ["cost_partial"]]);
    const report = deliveryEconomics([input]);
    expect(report.coverage).toEqual({ orders: 1, withNet: 0 });
    expect(report.totals).toEqual({ feeCents: 0, costCents: 0, netCents: 0 });
    expect(report.excluded).toEqual([{ reason: "cost_partial", orders: 1 }]);
  });
  it("a correction replaces the figure it corrects; an invoice total stands for the job", () => {
    const corrected = orderEconomics(order({ jobs: [job(1, "delivered")], costs: [cost("job-1", 3_000, { id: "c1" }), cost("job-1", 3_500, { id: "c2", correctsId: "c1" })] }));
    expect(corrected.cost).toEqual({ kind: "complete", cents: 3_500 });
    const invoiced = orderEconomics(order({ jobs: [job(1, "delivered")], costs: [cost("job-1", 3_000), cost("job-1", 3_300, { component: "invoice_total", moneyIdentity: "job-1:invoice_total" })] }));
    expect(invoiced.cost).toEqual({ kind: "complete", cents: 3_300 });
  });
  it("both sides missing: both reasons, fee side first", () => {
    expect(orderEconomics(order({ candidates: [], jobs: [job(1, "accepted")] })).gaps).toEqual(["fee_not_on_quote", "cost_not_recorded"]);
    expect(orderEconomics(order({ isEzcater: true, candidates: [], jobs: [job(1, "delivered", { bookedVia: "provider_native" }), job(2, "delivered", { bookedVia: "provider_native" })],
      costs: [cost("job-2", 2_000)] })).gaps).toEqual(["ezcater_fee_unknown", "cost_partial"]);
  });
  it("the couriers named are the jobs' own labels, newest first, once each", () => {
    expect(orderEconomics(order({ jobs: [job(1, "cancelled", { providerLabel: "A" }), job(2, "cancelled", { providerLabel: "B" }), job(3, "delivered", { providerLabel: "A" })] })).providers).toEqual(["A", "B"]);
  });
});

describe("which leads are delivery orders", () => {
  it("any lead with a recorded delivery, in any stage", () => {
    for (const stage of ["confirmed", "out", "completed", "lost", "inquiry"] as const) expect(isDeliveryOrder({ stage, isEzcater: false, candidates: [], jobs: [job(1, "cancelled")] })).toBe(true);
    expect(isDeliveryOrder({ stage: "completed", isEzcater: true, candidates: [], jobs: [job(1, "delivered", { bookedVia: "provider_native" })] })).toBe(true);
  });
  it("with no record: only a confirmed / out / completed HOUSE order whose order quote is a delivery", () => {
    for (const stage of ["confirmed", "out", "completed"] as const) expect(isDeliveryOrder({ stage, isEzcater: false, candidates: [quote()], jobs: [] })).toBe(true);
    for (const stage of ["inquiry", "quote_sent", "lost"] as const) expect(isDeliveryOrder({ stage, isEzcater: false, candidates: [quote()], jobs: [] })).toBe(false);
    expect(isDeliveryOrder({ stage: "completed", isEzcater: false, candidates: [quote({ isDelivery: false })], jobs: [] })).toBe(false); // a pickup
    expect(isDeliveryOrder({ stage: "completed", isEzcater: false, candidates: [], jobs: [] })).toBe(false); // no quote: not known to be a delivery
    expect(isDeliveryOrder({ stage: "completed", isEzcater: true, candidates: [], jobs: [] })).toBe(false); // ezCater's courier, no record
    expect(isDeliveryOrder({ stage: "completed", isEzcater: false, candidates: [quote({ status: "declined" })], jobs: [] })).toBe(false);
  });
});

describe("the computed allocation (twin of 0356 delivery_computed_split)", () => {
  it("credits the delivered job with the highest attempt, never the courier ezCater sent", () => {
    expect(computedSplit(order({ jobs: [job(1, "delivered"), job(2, "delivered")] }))).toEqual({ kind: "split", jobId: "job-2", attemptNo: 2, gratuityCents: 10_000, driverBps: 1000, driverCents: 1_000, crewCents: 9_000 });
    expect(computedSplit(order({ jobs: [job(1, "delivered"), job(2, "cancelled"), job(3, "accepted")] }))).toMatchObject({ kind: "split", jobId: "job-1" });
    expect(computedSplit(order({ jobs: [job(1, "delivered", { bookedVia: "provider_native" })] }))).toEqual({ kind: "nothing" });
    expect(computedSplit(order({ jobs: [job(1, "picked_up")] }))).toEqual({ kind: "nothing" });
  });
  it("gratuity only from an accepted quote; pending / rejected / none = 0; ambiguous = no allocation at all", () => {
    const jobs = [job(1, "delivered")];
    expect(computedSplit(order({ jobs, candidates: [quote({ status: "sent" })] }))).toMatchObject({ kind: "split", gratuityCents: 0, driverCents: 0, crewCents: 0 });
    expect(computedSplit(order({ jobs, candidates: [] }))).toMatchObject({ kind: "split", gratuityCents: 0 });
    expect(computedSplit(order({ jobs, candidates: [quote({ status: "declined" })] }))).toMatchObject({ kind: "split", gratuityCents: 0 });
    expect(computedSplit(order({ jobs, candidates: [quote(), quote({ id: "q2" })] }))).toEqual({ kind: "ambiguous" });
  });
  it("the shop's share, 10% when it has no settings row; round half up, parts sum to the whole", () => {
    expect(computedSplit(order({ jobs: [job(1, "delivered")], driverBps: null }))).toMatchObject({ driverBps: 1000, driverCents: 1_000 });
    expect(computedSplit(order({ jobs: [job(1, "delivered")], driverBps: 2_500, candidates: [quote({ gratuityCents: 1_015 })] }))).toMatchObject({ driverBps: 2_500, driverCents: 254, crewCents: 761 });
  });
  it("the SQL it mirrors still says the same (text pin on the migration)", () => {
    const sql = readFileSync("supabase/migrations/0356_delivery_jobs.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create function public.delivery_computed_split"), sql.indexOf("create function public.delivery_write_split"));
    expect(fn).toContain("if v_quote->>'kind' = 'ambiguous' then return jsonb_build_object('kind', 'ambiguous'); end if;");
    expect(fn).toContain("j.status = 'delivered' and j.booked_via in ('manual', 'co_ops_api')");
    expect(fn).toContain("order by j.attempt_no desc limit 1");
    expect(fn).toContain("case when v_quote->>'kind' = 'accepted' then (v_quote->>'gratuity_cents')::integer else 0 end");
    expect(fn).toContain("v_bps := coalesce(v_bps, 1000);");
    const write = sql.slice(sql.indexOf("create function public.delivery_write_split"), sql.indexOf("-- 6. The writers."));
    expect(write).toContain("if v_head.id is null or v_head.kind = 'void' then return null; end if;");
    expect(write).toContain("if v_head.id is null and v_gratuity = 0 then return null; end if;");
    expect(write).toContain("v_head.kind = 'split' and v_head.job_id = v_job and v_head.gratuity_cents = v_gratuity");
  });
});

describe("which correction is offered (twin of delivery_write_split's no-op checks)", () => {
  const c = (o: Partial<OrderEconomicsInput> = {}) => computedSplit(order({ jobs: [job(1, "delivered")], ...o }));
  it("no head: recalculate only when there is gratuity to record", () => {
    expect([recomputeWouldWrite(null, c()), gratuityCorrectionOffer(null, c())]).toEqual([true, "recompute"]);
    expect([recomputeWouldWrite(null, c({ candidates: [quote({ gratuityCents: 0 })] })), gratuityCorrectionOffer(null, c({ candidates: [quote({ gratuityCents: 0 })] }))]).toEqual([false, null]);
  });
  it("a head that already says it: no recalculation; 'Remove' while it allocates", () => {
    expect([recomputeWouldWrite(split("s1"), c()), gratuityCorrectionOffer(split("s1"), c())]).toEqual([false, "void"]);
  });
  it("another amount, another job or another share: recalculate", () => {
    expect(gratuityCorrectionOffer(split("s1"), c({ candidates: [quote({ gratuityCents: 8_000 })] }))).toBe("recompute");
    expect(gratuityCorrectionOffer(split("s1"), c({ jobs: [job(1, "delivered"), job(2, "delivered")] }))).toBe("recompute");
    expect(gratuityCorrectionOffer(split("s1"), c({ driverBps: 2_000 }))).toBe("recompute");
    expect(gratuityCorrectionOffer(split("s1"), c({ candidates: [quote({ gratuityCents: 0 })] }))).toBe("recompute"); // to zero: a 0-cent head reverses it
  });
  it("a 0-cent head that matches, or a void with nothing delivered: nothing to offer; after a void with the delivery still on record the way back is 'restore'", () => {
    const zero = split("s2", { gratuityCents: 0, driverCents: 0, crewCents: 0, supersedesId: "s1" });
    expect(gratuityCorrectionOffer(zero, c({ candidates: [quote({ gratuityCents: 0 })] }))).toBeNull();
    const voided = split("s3", { kind: "void", jobId: null, gratuityCents: 0, driverCents: 0, crewCents: 0, supersedesId: "s1" });
    expect(gratuityCorrectionOffer(voided, computedSplit(order({ jobs: [job(1, "cancelled")] })))).toBeNull();
    // Ruled 2026-11-23: offered, worded as putting the split back (the same recompute request underneath).
    expect(gratuityCorrectionOffer(voided, c())).toBe("restore");
    expect(recomputeWouldWrite(voided, c())).toBe(true);
    // Only a void head reads "restore": no head, or a live head, stays "recompute".
    expect([gratuityCorrectionOffer(null, c()), gratuityCorrectionOffer(split("s1"), c({ driverBps: 2_000 }))]).toEqual(["recompute", "recompute"]);
  });
  it("an ambiguous quote is never recalculated; an allocating head can still be removed", () => {
    const ambiguous = c({ candidates: [quote(), quote({ id: "q2" })] });
    expect([gratuityCorrectionOffer(null, ambiguous), gratuityCorrectionOffer(split("s1"), ambiguous)]).toEqual([null, "void"]);
  });
});

describe("the gratuity of an order: the head of its chain", () => {
  it("delivered: the recorded split, with the job credited and the share used", () => {
    expect(orderEconomics(order({ jobs: [job(1, "delivered")], splits: [split("s1")] })).gratuity).toEqual(
      { kind: "allocated", headId: "s1", jobId: "job-1", attemptNo: 1, gratuityCents: 10_000, driverBps: 1000, driverCents: 1_000, crewCents: 9_000, needsRecalc: false });
  });
  it("the recorded share is the row's own (a later change of the shop's setting only flags it)", () => {
    const g = orderEconomics(order({ jobs: [job(1, "delivered")], splits: [split("s1")], driverBps: 2_000 })).gratuity;
    expect(g).toMatchObject({ kind: "allocated", driverBps: 1000, driverCents: 1_000, needsRecalc: true });
  });
  it("GOLDEN: a mistaken delivery then a replacement = ONE allocation, credited to job 2, counted once", () => {
    const input = order({ jobs: [job(1, "delivered"), job(2, "delivered")], costs: [cost("job-1", 0), cost("job-2", 3_000)],
      splits: [split("s1"), split("s2", { jobId: "job-2", supersedesId: "s1" })] });
    expect(orderEconomics(input).gratuity).toMatchObject({ kind: "allocated", headId: "s2", jobId: "job-2", attemptNo: 2, gratuityCents: 10_000, needsRecalc: false });
    expect(deliveryEconomics([input]).gratuity).toMatchObject({ orders: 1, gratuityCents: 10_000, driverCents: 1_000, crewCents: 9_000 });
  });
  it("GOLDEN: a revision to zero gratuity + recompute = a 0-cent head; the totals drop", () => {
    const before = order({ jobs: [job(1, "delivered")], splits: [split("s1")] });
    expect(deliveryEconomics([before]).gratuity).toMatchObject({ orders: 1, gratuityCents: 10_000, driverCents: 1_000, crewCents: 9_000 });
    // The quote is revised to no gratuity: the old head no longer matches, and says so.
    const revised = { ...before, candidates: [quote({ gratuityCents: 0 })] };
    expect(orderEconomics(revised).gratuity).toMatchObject({ kind: "allocated", gratuityCents: 10_000, needsRecalc: true });
    expect(deliveryEconomics([revised]).gratuity.needsRecalc).toBe(1);
    // After "Recalculate": a 0-cent split supersedes it.
    const after = { ...revised, splits: [split("s1"), split("s2", { gratuityCents: 0, driverCents: 0, crewCents: 0, supersedesId: "s1" })] };
    expect(orderEconomics(after).gratuity).toEqual({ kind: "zero_head", headId: "s2", needsRecalc: false });
    // Its OWN count (ruled 2026-11-23): a 0-cent head is not "delivered with no gratuity on the quote".
    expect(deliveryEconomics([after]).gratuity).toEqual({ ...ZERO, zeroHead: 1 });
    // The quote gets its gratuity back: the 0-cent head no longer matches, and says so.
    const again = { ...after, candidates: [quote()] };
    expect(orderEconomics(again).gratuity).toEqual({ kind: "zero_head", headId: "s2", needsRecalc: true });
    expect(deliveryEconomics([again]).gratuity).toEqual({ ...ZERO, zeroHead: 1, needsRecalc: 1 });
  });
  it("GOLDEN: void = the head allocates nothing; the totals drop", () => {
    const input = order({ jobs: [job(1, "delivered")], splits: [split("s1"), split("s2", { kind: "void", jobId: null, gratuityCents: 0, driverCents: 0, crewCents: 0, supersedesId: "s1" })] });
    expect(orderEconomics(input).gratuity).toEqual({ kind: "voided", headId: "s2" });
    expect(deliveryEconomics([input]).gratuity).toEqual({ ...ZERO, voided: 1 });
  });
  it("delivered, the ACCEPTED quote has no gratuity: the only true 'no gratuity on the quote', counted", () => {
    const input = order({ jobs: [job(1, "delivered")], candidates: [quote({ gratuityCents: 0 })] });
    expect(orderEconomics(input).gratuity).toEqual({ kind: "none_on_quote" });
    expect(deliveryEconomics([input]).gratuity).toEqual({ ...ZERO, deliveredNoGratuity: 1 });
  });
  it("delivered, the quote was accepted afterwards: nothing recorded yet, flagged (never counted as 'no gratuity')", () => {
    const input = order({ jobs: [job(1, "delivered")] });
    expect(orderEconomics(input).gratuity).toEqual({ kind: "not_recorded" });
    expect(deliveryEconomics([input]).gratuity).toEqual({ ...ZERO, needsRecalc: 1 });
  });
  describe("A MISSING GRATUITY SOURCE IS NOT A ZERO (review DELIV4-r1): delivered with no accepted quote", () => {
    it.each([
      ["a pending quote carrying a $100 gratuity", [quote({ status: "sent" })], "pending"],
      ["a pending draft quote with no gratuity typed yet", [quote({ status: "draft", gratuityCents: 0 })], "pending"],
      ["no quote at all (a Toast-rung order)", [], "none"],
      ["two accepted quotes", [quote(), quote({ id: "q2", gratuityCents: 0 })], "ambiguous"],
      ["every quote declined", [quote({ status: "declined" })], "rejected"],
    ] as const)("%s: source_unknown, never 'no gratuity on the quote'", (_name, candidates, reason) => {
      const input = order({ stage: "confirmed", candidates: [...candidates], jobs: [job(1, "delivered")] });
      expect(orderEconomics(input).gratuity).toEqual({ kind: "source_unknown", reason });
      // Its own count: out of "delivered with no gratuity", out of the sums, and nothing to recalculate yet.
      expect(deliveryEconomics([input]).gratuity).toEqual({ ...ZERO, sourceUnknown: 1 });
      // The allocation rule itself is unchanged: with no accepted quote the database allocates nothing, and no correction is offered.
      const computed = computedSplit(input);
      expect(computed.kind === "split" ? computed.gratuityCents : computed.kind).toBe(reason === "ambiguous" ? "ambiguous" : 0);
      expect(gratuityCorrectionOffer(null, computed)).toBeNull();
    });
    it("once the quote is accepted it leaves the unknown state: recorded-to-be (gratuity) or a true zero", () => {
      const delivered = { stage: "confirmed" as const, jobs: [job(1, "delivered")] };
      expect(orderEconomics(order({ ...delivered, candidates: [quote({ status: "sent" })] })).gratuity.kind).toBe("source_unknown");
      expect(orderEconomics(order({ ...delivered, candidates: [quote()] })).gratuity.kind).toBe("not_recorded");
      expect(orderEconomics(order({ ...delivered, candidates: [quote({ gratuityCents: 0 })] })).gratuity.kind).toBe("none_on_quote");
    });
    it("a recorded head still wins: an allocation made while a quote was accepted stays shown after the quote goes back to pending", () => {
      const input = order({ candidates: [quote({ status: "sent" })], jobs: [job(1, "delivered")], splits: [split("s1")] });
      expect(orderEconomics(input).gratuity).toMatchObject({ kind: "allocated", gratuityCents: 10_000, needsRecalc: true });
    });
    it("the courier ezCater sent is never 'unknown': no split applies at all", () => {
      expect(orderEconomics(order({ isEzcater: true, candidates: [], jobs: [job(1, "delivered", { bookedVia: "provider_native" })] })).gratuity).toEqual({ kind: "none" });
    });
  });
  it("not delivered yet: the EXPECTED split from the pure rule, never in a total", () => {
    for (const jobs of [[], [job(1, "accepted")], [job(1, "cancelled"), job(2, "picked_up")]]) {
      const input = order({ stage: "confirmed", jobs });
      expect(orderEconomics(input).gratuity).toEqual({ kind: "expected", gratuityCents: 10_000, driverBps: 1000, driverCents: 1_000, crewCents: 9_000 });
      expect(deliveryEconomics([input]).gratuity).toEqual({ ...ZERO, expected: 1 });
    }
    expect(orderEconomics(order({ stage: "confirmed", driverBps: null })).gratuity).toMatchObject({ kind: "expected", driverBps: 1000 });
  });
  it("nothing to expect: no gratuity on the quote, nothing accepted, a rejected order, a pickup with no courier", () => {
    for (const o of [{ candidates: [quote({ gratuityCents: 0 })] }, { candidates: [quote({ status: "sent" })] }, { candidates: [] }, { stage: "lost" as const },
      { candidates: [quote({ isDelivery: false })] }]) expect(orderEconomics(order({ stage: "confirmed", ...o })).gratuity).toEqual({ kind: "none" });
  });
  it("an ezCater order never takes a split: the tip is ezCater's fact", () => {
    const input = order({ isEzcater: true, candidates: [], jobs: [job(1, "delivered", { bookedVia: "provider_native" })], costs: [cost("job-1", 2_000)] });
    expect(orderEconomics(input)).toMatchObject({ fee: { kind: "gap", reason: "ezcater_fee_unknown" }, cost: { kind: "complete", cents: 2_000 }, netCents: null, gratuity: { kind: "none" } });
  });
  it("two accepted quotes: no gratuity source — before delivery `quote_ambiguous`, after it `source_unknown`", () => {
    const candidates = [quote(), quote({ id: "q2" })];
    expect(orderEconomics(order({ stage: "confirmed", jobs: [job(1, "accepted")], candidates })).gratuity).toEqual({ kind: "quote_ambiguous" });
    expect(orderEconomics(order({ jobs: [job(1, "delivered")], candidates })).gratuity).toEqual({ kind: "source_unknown", reason: "ambiguous" });
  });
});

describe("a period: coverage first, totals only over orders with a net", () => {
  const inputs = [
    order({ leadId: "a", eventDate: "2026-11-20", jobs: [job(1, "delivered")], costs: [cost("job-1", 3_000)], splits: [split("s1")] }), // net +1500
    order({ leadId: "b", eventDate: "2026-11-22", jobs: [job(1, "delivered")], costs: [cost("job-1", 5_000)], candidates: [quote({ gratuityCents: 0 })] }), // net -500
    order({ leadId: "c", eventDate: "2026-11-21", jobs: [job(1, "cancelled"), job(2, "delivered")], costs: [cost("job-2", 3_000)] }), // partial
    order({ leadId: "d", eventDate: "2026-11-21", jobs: [job(1, "delivered")] }), // no cost
    order({ leadId: "e", eventDate: "2026-11-23", candidates: [], jobs: [job(1, "delivered")], costs: [cost("job-1", 2_500)] }), // no fee
    order({ leadId: "f", eventDate: "2026-11-24", isEzcater: true, candidates: [], jobs: [job(1, "delivered", { bookedVia: "provider_native" })] }), // ezCater, no cost
    order({ leadId: "g", eventDate: null, candidates: [quote(), quote({ id: "q2" })], jobs: [job(1, "delivered")], costs: [cost("job-1", 100)] }), // ambiguous
  ];
  const report = deliveryEconomics(inputs);
  it("N of M: only the orders with both sides", () => {
    expect(report.coverage).toEqual({ orders: 7, withNet: 2 });
    expect(report.totals).toEqual({ feeCents: 9_000, costCents: 8_000, netCents: 1_000 });
  });
  it("the orders left out are counted per reason, in the canonical order; an order missing both sides counts under both", () => {
    expect(report.excluded).toEqual([
      { reason: "ezcater_fee_unknown", orders: 1 }, { reason: "quote_ambiguous", orders: 1 }, { reason: "fee_not_on_quote", orders: 1 },
      { reason: "cost_not_recorded", orders: 2 }, { reason: "cost_partial", orders: 1 },
    ]);
    expect(report.excluded.map((e) => e.reason)).toEqual(ECONOMICS_GAPS.filter((g) => report.excluded.some((e) => e.reason === g)));
    // Every order without a net is counted at least once; none with a net is.
    expect(report.orders.filter((o) => o.netCents === null).every((o) => o.gaps.length > 0)).toBe(true);
    expect(report.orders.filter((o) => o.netCents !== null).every((o) => o.gaps.length === 0)).toBe(true);
  });
  it("a known cost on an order with no net never reaches the totals", () => {
    expect(report.totals.costCents).toBe(3_000 + 5_000); // not + 3000 (partial) + 2500 (no fee) + 100 (ambiguous)
  });
  it("newest event date first, then the lead id; an order with no date last", () => {
    expect(report.orders.map((o) => o.leadId)).toEqual(["f", "e", "b", "c", "d", "a", "g"]);
  });
  it("an empty period is zeros over ZERO orders (the coverage line says so), never a failure", () => {
    expect(deliveryEconomics([])).toEqual({ orders: [], coverage: { orders: 0, withNet: 0 }, totals: { feeCents: 0, costCents: 0, netCents: 0 }, excluded: [],
      gratuity: ZERO });
  });
});

describe("an order's reference and its link (review DELIV4-r1): told apart without a customer field", () => {
  it("the first six hex characters of the lead id, upper case", () => {
    expect(deliveryOrderRef("0a1b2c3d-4e5f-4000-8000-0000000000d1")).toBe("0A1B2C");
    expect(deliveryOrderRef("ffeeddcc-0000-4000-8000-000000000000")).toBe("FFEEDD");
  });
  it("links to the order's card on the pipeline board through the board's own hash", () => {
    expect(deliveryOrderHref("0a1b2c3d-4e5f-4000-8000-0000000000d1")).toBe("/catering/pipeline#lead-0a1b2c3d-4e5f-4000-8000-0000000000d1");
    // The board opens a lead from exactly this hash (components/catering/pipeline/PipelineClient.tsx), and takes no shop parameter.
    const board = readFileSync("components/catering/pipeline/PipelineClient.tsx", "utf8");
    expect(board).toContain("window.location.hash === `#lead-${lead.id}`");
    expect(board).toContain("id={`lead-${lead.id}`}");
  });
});
