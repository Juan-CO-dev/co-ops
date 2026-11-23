/**
 * Catering delivery D2 — the Delivery panel's view-model (lib/delivery/panel-shared.ts): when the panel shows at all,
 * when "Record a delivery" is offered and in which mode, the taps of an open job, a job's cost lines, typed money.
 * The server's response is the authority; these rules only turn it into the screen.
 */
import { describe, expect, it } from "vitest";
import {
  alertJob, bpsToPercent, canWriteDelivery, deliveryChipTone, deliveryErrorKey, dollarsToCents, jobCostLines, jobsNewestFirst, panelShown, percentToBps, recordOffer, signedCents,
  statusTaps, type DeliveryLeadView,
} from "@/lib/delivery/panel-shared";
import { DELIVERY_STATES, type DeliveryCostRow, type DeliveryJob } from "@/lib/delivery/types-shared";
import { viewOf, jobOf, A, B } from "./helpers/delivery-views";

const cost = (id: string, jobId: string, component: DeliveryCostRow["component"], amountCents: number, correctsId: string | null = null): DeliveryCostRow =>
  ({ id, jobId, component, semantics: "snapshot", amountCents, moneyIdentity: `${jobId}:${component}`, source: "manual", providerRef: null, observedAt: `2026-11-22T10:0${id.length}:00Z`,
    correctsId, actorId: "u", note: null });

describe("the panel renders nothing unless delivery is ON for the lead's shop", () => {
  it("off, not installed, a history answer, nothing at all: not shown", () => {
    for (const view of [null, { view: "off" as const }, { view: "not_installed" as const }, { view: "history" as const, leadId: "l", movedToShopId: B, jobs: [] }]) {
      expect(panelShown(view, "confirmed")).toBe(false);
    }
  });
  it("a lead view whose shop is off is not shown, whatever it holds", () => {
    expect(panelShown(viewOf({ enabled: false, state: "booked", jobs: [jobOf()] }), "confirmed")).toBe(false);
    expect(panelShown(viewOf({ enabled: false, state: "cancel_needed", jobs: [jobOf()] }), "lost")).toBe(false);
  });
  it("on: shown when there is a job, a state, or a delivery to record; hidden on a lead with nothing to say or do", () => {
    expect(panelShown(viewOf({ state: "booked", jobs: [jobOf()] }), "confirmed")).toBe(true);
    expect(panelShown(viewOf({ state: "to_book" }), "confirmed")).toBe(true);
    expect(panelShown(viewOf({ state: "provider_managed", isEzcater: true, orderQuote: { kind: "none", isDelivery: null } }), "confirmed")).toBe(true);
    expect(panelShown(viewOf({ state: "none", orderQuote: { kind: "none", isDelivery: null } }), "confirmed")).toBe(true); // a Toast-rung order: a delivery may be recorded
    expect(panelShown(viewOf({ state: "none" }), "inquiry")).toBe(false); // not confirmed yet
    expect(panelShown(viewOf({ state: "none", orderQuote: { kind: "accepted", isDelivery: false } }), "confirmed")).toBe(false); // a pickup order
    expect(panelShown(viewOf({ state: "none", write: false, orderQuote: { kind: "none", isDelivery: null } }), "confirmed")).toBe(false); // nothing a reader could see
  });
});

describe("Record a delivery", () => {
  it("offered to a writer on a confirmed house delivery with nothing open, from the SHOP'S courier list", () => {
    expect(recordOffer(viewOf({ state: "to_book", providers: ["Courier A", "Courier B"] }), "confirmed")).toEqual({ kind: "form", mode: "manual", providers: ["Courier A", "Courier B"] });
    for (const stage of ["out", "completed"] as const) expect(recordOffer(viewOf({ state: "to_book" }), stage)?.kind).toBe("form");
    expect(recordOffer(viewOf({ state: "to_book", jobs: [jobOf({ status: "cancelled", closedAt: "2026-11-22T11:00:00Z" })] }), "confirmed")?.kind).toBe("form"); // a replacement
  });
  it("an ezCater order is only ever the courier ezCater sent: provider_native, never a booking of ours", () => {
    expect(recordOffer(viewOf({ state: "provider_managed", isEzcater: true, orderQuote: { kind: "none", isDelivery: null }, providers: ["Courier A"] }), "confirmed"))
      .toEqual({ kind: "form", mode: "provider_native", providers: [] });
  });
  it("never to a reader, never before the order is confirmed, never on a rejected order, never with a delivery open, never on a pickup", () => {
    expect(recordOffer(viewOf({ state: "to_book", write: false }), "confirmed")).toBeNull();
    for (const stage of ["inquiry", "quote_sent", "lost"] as const) expect(recordOffer(viewOf({ state: "none" }), stage)).toBeNull();
    expect(recordOffer(viewOf({ state: "none", orderQuote: { kind: "rejected", isDelivery: false } }), "confirmed")).toBeNull();
    expect(recordOffer(viewOf({ state: "booked", jobs: [jobOf()] }), "confirmed")).toBeNull();
    expect(recordOffer(viewOf({ state: "none", orderQuote: { kind: "pending", isDelivery: false } }), "confirmed")).toBeNull();
    expect(recordOffer(viewOf({ enabled: false, state: "to_book" }), "confirmed")).toBeNull();
  });
  it("two accepted quotes: named, never guessed", () => {
    expect(recordOffer(viewOf({ state: "none", orderQuote: { kind: "ambiguous", isDelivery: true } }), "confirmed")).toEqual({ kind: "blocked", reason: "quote_ambiguous" });
  });
  it("the server decides who writes: `detail` present = may write", () => {
    expect(canWriteDelivery(viewOf({ state: "booked" }))).toBe(true);
    expect(canWriteDelivery(viewOf({ state: "booked", write: false }))).toBe(false);
  });
});

describe("a job's taps, alerts and order", () => {
  it("Booked → Picked up → Delivered, or Cancelled / Failed; nothing after a closed job", () => {
    expect(statusTaps(jobOf())).toEqual(["picked_up", "delivered", "cancelled", "failed"]);
    expect(statusTaps(jobOf({ status: "picked_up" }))).toEqual(["delivered", "failed", "cancelled"]);
    for (const status of ["delivered", "cancelled", "failed", "returned"] as const) expect(statusTaps(jobOf({ status, closedAt: "2026-11-22T12:00:00Z" }))).toEqual([]);
    expect(statusTaps(jobOf({ status: "en_route_dropoff" }))).toEqual([]); // a provider's status: no manual move from it
  });
  it("the newest job is the highest attempt, never a time", () => {
    const jobs = [jobOf({ id: "1", attemptNo: 1, createdAt: "2026-12-01T00:00:00Z" }), jobOf({ id: "3", attemptNo: 3 }), jobOf({ id: "2", attemptNo: 2 })];
    expect(jobsNewestFirst(jobs).map((j) => j.attemptNo)).toEqual([3, 2, 1]);
    expect(jobs.map((j) => j.attemptNo)).toEqual([1, 3, 2]); // not mutated
  });
  it("a named alert is about the OPEN job; other states have none", () => {
    const open = jobOf({ id: "open", attemptNo: 2, locationId: A }), closed = jobOf({ id: "closed", attemptNo: 1, status: "cancelled", closedAt: "2026-11-22T11:00:00Z" });
    expect(alertJob(viewOf({ state: "pickup_mismatch", jobs: [closed, open] }))?.id).toBe("open");
    expect(alertJob(viewOf({ state: "cancel_needed", jobs: [closed, open] }))?.id).toBe("open");
    expect(alertJob(viewOf({ state: "booked", jobs: [open] }))).toBeNull();
    expect(alertJob(viewOf({ state: "cancel_needed", write: false, jobs: [open] }))).toBeNull(); // a reader has no detail and no action
  });
  it("every state has a chip tone; the three that need a person are alerts", () => {
    const tones = Object.fromEntries(DELIVERY_STATES.map((s) => [s, deliveryChipTone(s)]));
    expect(tones).toEqual({ cancel_needed: "alert", pickup_mismatch: "alert", problem: "alert", to_book: "warn", to_book_soon: "warn", booked: "ok", on_the_way: "ok", delivered: "ok",
      provider_managed: "muted", none: "muted" });
  });
});

describe("a job's cost lines", () => {
  const JOB: DeliveryJob = jobOf({ id: "j1" });
  it("no row = UNKNOWN (never zero), and every figure can still be added", () => {
    const lines = jobCostLines(JOB.id, [cost("a", "other", "base", 9900)]);
    expect(lines.cost).toEqual({ kind: "unknown" });
    expect(lines.heads).toEqual([]);
    expect(lines.addable).toEqual(["base", "adjustment", "wait_time", "cancellation_fee", "credit", "invoice_total"]);
  });
  it("an explicit zero is a record: known, 0", () => {
    expect(jobCostLines(JOB.id, [cost("a", "j1", "base", 0)]).cost).toMatchObject({ kind: "known", cents: 0 });
  });
  it("the heads are what 'Correct' names: the corrected row is gone, its successor stands, in the canonical order", () => {
    const rows = [cost("w", "j1", "wait_time", 500), cost("a", "j1", "base", 3000), cost("ab", "j1", "base", 3175, "a")];
    const lines = jobCostLines("j1", rows);
    expect(lines.heads.map((h) => [h.id, h.component, h.amountCents])).toEqual([["ab", "base", 3175], ["w", "wait_time", 500]]);
    expect(lines.cost).toMatchObject({ kind: "known", cents: 3675 });
    expect(lines.addable).toEqual(["adjustment", "cancellation_fee", "credit", "invoice_total"]);
  });
});

describe("typed money and percentages are judged on the text, never on a float product", () => {
  it("dollars", () => {
    expect([dollarsToCents("30"), dollarsToCents("30.5"), dollarsToCents("30.50"), dollarsToCents(" $31.75 "), dollarsToCents("0"), dollarsToCents("19.99"), dollarsToCents("1234.07")])
      .toEqual([3000, 3050, 3050, 3175, 0, 1999, 123407]);
    for (const bad of ["", " ", "30.505", "-5", "1,200", "abc", "30.", ".5", "1e3", "1234567"]) expect([bad, dollarsToCents(bad)]).toEqual([bad, null]);
  });
  it("a credit is saved negative whatever was typed; everything else as typed", () => {
    expect([signedCents("credit", 500), signedCents("credit", -500), signedCents("base", 500), signedCents("credit", 0)]).toEqual([-500, -500, 500, 0]);
  });
  it("percent ↔ basis points", () => {
    expect([percentToBps("10"), percentToBps("12.5"), percentToBps("0"), percentToBps("100"), percentToBps("7.25")]).toEqual([1000, 1250, 0, 10_000, 725]);
    for (const bad of ["", "100.01", "101", "-1", "10.555", "ten", "1000"]) expect([bad, percentToBps(bad)]).toEqual([bad, null]);
    expect([bpsToPercent(1000), bpsToPercent(1250), bpsToPercent(725), bpsToPercent(0)]).toEqual(["10", "12.5", "7.25", "0"]);
    for (const bps of [0, 1, 725, 1000, 3333, 10_000]) expect(percentToBps(bpsToPercent(bps))).toBe(bps);
  });
  it("an unknown code reads as the generic message, never a raw key", () => {
    expect(deliveryErrorKey("shop_moved")).toBe("delivery.error.shop_moved");
    expect(deliveryErrorKey("network")).toBe("delivery.error.network");
    for (const unknown of ["nope", "", null, undefined, "__proto__"]) expect(deliveryErrorKey(unknown)).toBe("delivery.error.generic");
  });
});

// A type-level pin: the view-model's lead view is the lib's.
const _typed: DeliveryLeadView["view"] = "lead";
void _typed;
