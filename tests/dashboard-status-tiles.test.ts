/**
 * The three status-tile compose functions (design §1). Pure transforms from
 * existing loader outputs to {headline, pills, rows} view models — the
 * dashboard tiles and the mid-shift strip are thin renderings of these.
 */
import { describe, it, expect } from "vitest";
import {
  daysBetweenYmd,
  deriveMissingEmailIds,
  composeCountsTile,
  composeReceivingTile,
  composeOrderingTile,
  type ReceivingDeliveryFacts,
  type OrderingCutoffFacts,
  type OrderingOrderFacts,
} from "@/lib/dashboard-status-shared";

const delivery = (over: Partial<ReceivingDeliveryFacts> & { id: string }): ReceivingDeliveryFacts => ({
  vendorName: `Vendor ${over.id}`,
  deliveryDate: "2026-08-19",
  matchState: "counted_only",
  deliveryStatus: "complete",
  receiptUrl: "/api/photos/x",
  arrivedAt: "9:14 AM",
  missingEmail: false,
  ...over,
});

describe("daysBetweenYmd", () => {
  it("counts calendar days, not elapsed milliseconds", () => {
    expect(daysBetweenYmd("2026-08-19", "2026-08-19")).toBe(0);
    expect(daysBetweenYmd("2026-08-18", "2026-08-19")).toBe(1);
    expect(daysBetweenYmd("2026-07-19", "2026-08-19")).toBe(31);
  });

  it("crosses a DST boundary without drifting (UTC-midnight arithmetic)", () => {
    // US DST ends 2026-11-01; a naive local-time diff would return 30.958…
    expect(daysBetweenYmd("2026-10-25", "2026-11-24")).toBe(30);
  });

  it("never returns a negative day count", () => {
    expect(daysBetweenYmd("2026-08-20", "2026-08-19")).toBe(0);
  });
});

describe("deriveMissingEmailIds", () => {
  const nowMs = Date.parse("2026-08-19T12:00:00Z");
  const base = { deliveryStatus: "complete" as const, matchState: "counted_only" as const, emailReceiptId: null };

  it("flags a completed, unclaimed, never-attested delivery past the 48h grace", () => {
    const ids = deriveMissingEmailIds(
      [{ id: "a", ...base, createdAt: "2026-08-16T12:00:00Z" }],
      nowMs,
    );
    expect([...ids]).toEqual(["a"]);
  });

  it("does not flag inside the grace window", () => {
    const ids = deriveMissingEmailIds(
      [{ id: "a", ...base, createdAt: "2026-08-18T12:00:00Z" }],
      nowMs,
    );
    expect(ids.size).toBe(0);
  });

  it("does not flag an in-progress door, an attested match, or a claimed delivery", () => {
    const old = "2026-08-01T12:00:00Z";
    const ids = deriveMissingEmailIds(
      [
        { id: "a", ...base, deliveryStatus: "in_progress", createdAt: old },
        { id: "b", ...base, matchState: "matched", createdAt: old },
        { id: "c", ...base, emailReceiptId: "rcpt-1", createdAt: old },
      ],
      nowMs,
    );
    expect(ids.size).toBe(0);
  });
});

describe("composeReceivingTile", () => {
  const today = "2026-08-19";

  it("is empty when nothing landed today (yesterday's trucks do not count)", () => {
    const vm = composeReceivingTile({
      deliveries: [delivery({ id: "a", deliveryDate: "2026-08-18" })],
      today,
    });
    expect(vm.empty).toBe(true);
    expect(vm.rows).toEqual([]);
  });

  it("leads with the problem count and sorts problem rows first", () => {
    const vm = composeReceivingTile({
      deliveries: [
        delivery({ id: "clean", vendorName: "PFG" }),
        delivery({ id: "short", vendorName: "Ferraro", matchState: "discrepant" }),
      ],
      today,
    });
    expect(vm.headline.key).toBe("dashboard.receiving.headline_problems");
    expect(vm.headline.params).toEqual({ count: 1 });
    expect(vm.headline.tone).toBe("danger");
    expect(vm.rows.map((r) => r.id)).toEqual(["short", "clean"]);
    expect(vm.rows[0]!.problem).toBe(true);
  });

  it("all-clean reads as received-and-clean, not as a problem", () => {
    const vm = composeReceivingTile({
      deliveries: [delivery({ id: "a" }), delivery({ id: "b" })],
      today,
    });
    expect(vm.headline.key).toBe("dashboard.receiving.headline_clean");
    expect(vm.headline.params).toEqual({ count: 2 });
    expect(vm.headline.tone).toBe("ok");
    expect(vm.rows[0]!.pills.map((p) => p.key)).toEqual(["dashboard.receiving.badge_complete"]);
  });

  it("reuses the receiving page's badge vocabulary", () => {
    const vm = composeReceivingTile({
      deliveries: [delivery({ id: "a", matchState: "discrepant", receiptUrl: null, missingEmail: true })],
      today,
    });
    expect(vm.rows[0]!.pills.map((p) => p.key)).toEqual([
      "receiving.badge.discrepant",
      "receiving.badge.photo_missing",
      "receiving.badge.email_missing",
    ]);
  });

  it("caps at three rows and reports the overflow", () => {
    const vm = composeReceivingTile({
      deliveries: ["a", "b", "c", "d", "e"].map((id) => delivery({ id })),
      today,
    });
    expect(vm.rows).toHaveLength(3);
    expect(vm.overflowCount).toBe(2);
  });
});

describe("composeCountsTile", () => {
  it("never-counted renders the em-dash gauge and the start-your-first-count pill, no numbers", () => {
    const vm = composeCountsTile({
      lastCountDate: null,
      today: "2026-08-19",
      anchoredSkuCount: 0,
      varianceCount: null,
    });
    expect(vm.headline.form).toBe("gauge");
    expect(vm.headline.value).toBe("—");
    expect(vm.headline.key).toBe("dashboard.counts.never_caption");
    expect(vm.pills.map((p) => p.key)).toEqual(["dashboard.counts.never_pill"]);
  });

  it("climbs the days-since gauge and warms its tone as it ages", () => {
    const at = (d: string) =>
      composeCountsTile({ lastCountDate: d, today: "2026-08-19", anchoredSkuCount: 163, varianceCount: null });
    expect(at("2026-08-19").headline.value).toBe("0");
    expect(at("2026-08-19").headline.tone).toBe("ok");
    expect(at("2026-08-11").headline.value).toBe("8");
    expect(at("2026-08-11").headline.tone).toBe("warn");
    expect(at("2026-07-04").headline.value).toBe("46");
    expect(at("2026-07-04").headline.tone).toBe("danger");
  });

  it("shows the anchored pill once SKUs are anchored", () => {
    const vm = composeCountsTile({
      lastCountDate: "2026-08-18",
      today: "2026-08-19",
      anchoredSkuCount: 163,
      varianceCount: null,
    });
    const anchored = vm.pills.find((p) => p.key === "dashboard.counts.pill_anchored");
    expect(anchored?.params).toEqual({ count: 163 });
    expect(anchored?.tone).toBe("warn");
  });

  it("NO INVENTED DATA: a null variance term renders no variance pill at all", () => {
    const vm = composeCountsTile({
      lastCountDate: "2026-08-18",
      today: "2026-08-19",
      anchoredSkuCount: 163,
      varianceCount: null,
    });
    expect(vm.pills.some((p) => p.key === "dashboard.counts.pill_variances")).toBe(false);
  });

  it("renders the red variance pill when the term IS supplied, and omits it at zero", () => {
    const withVar = composeCountsTile({
      lastCountDate: "2026-08-18",
      today: "2026-08-19",
      anchoredSkuCount: 163,
      varianceCount: 4,
    });
    const pill = withVar.pills.find((p) => p.key === "dashboard.counts.pill_variances");
    expect(pill?.params).toEqual({ count: 4 });
    expect(pill?.tone).toBe("danger");

    const zeroVar = composeCountsTile({
      lastCountDate: "2026-08-18",
      today: "2026-08-19",
      anchoredSkuCount: 163,
      varianceCount: 0,
    });
    expect(zeroVar.pills.some((p) => p.key === "dashboard.counts.pill_variances")).toBe(false);
  });
});

describe("composeOrderingTile", () => {
  const cutoff = (over: Partial<OrderingCutoffFacts> & { vendorId: string }): OrderingCutoffFacts => ({
    vendorName: `Vendor ${over.vendorId}`,
    cutoffTime: "3:00 PM",
    hasDraft: false,
    ...over,
  });
  const order = (over: Partial<OrderingOrderFacts> & { poId: string }): OrderingOrderFacts => ({
    vendorName: `Vendor ${over.poId}`,
    status: "placed",
    ...over,
  });

  it("an open cutoff IS the headline — the clock as the gauge numeral, in red", () => {
    const vm = composeOrderingTile({
      openCutoffs: [cutoff({ vendorId: "ferraro", vendorName: "Ferraro", cutoffTime: "3:00 PM" })],
      orders: [],
    });
    expect(vm.headline.form).toBe("gauge");
    expect(vm.headline.value).toBe("3:00 PM");
    expect(vm.headline.key).toBe("dashboard.ordering.headline_cutoff");
    expect(vm.headline.params).toEqual({ vendor: "Ferraro" });
    expect(vm.headline.tone).toBe("danger");
  });

  it("the NEAREST cutoff leads; the rest become red pills (loader order is authoritative)", () => {
    const vm = composeOrderingTile({
      openCutoffs: [
        cutoff({ vendorId: "a", vendorName: "Baldor", cutoffTime: "11:00 AM" }),
        cutoff({ vendorId: "b", vendorName: "Ferraro", cutoffTime: "3:00 PM" }),
      ],
      orders: [],
    });
    expect(vm.headline.params).toEqual({ vendor: "Baldor" });
    const extra = vm.pills.filter((p) => p.key === "dashboard.ordering.pill_cutoff");
    expect(extra).toHaveLength(1);
    expect(extra[0]!.params).toEqual({ vendor: "Ferraro", time: "3:00 PM" });
    expect(extra[0]!.tone).toBe("danger");
  });

  it("handled orders shrink to per-status pills alongside an open cutoff", () => {
    const vm = composeOrderingTile({
      openCutoffs: [cutoff({ vendorId: "a", vendorName: "Ferraro" })],
      orders: [
        order({ poId: "1", vendorName: "PFG", status: "placed" }),
        order({ poId: "2", vendorName: "Baldor", status: "draft" }),
      ],
    });
    const placed = vm.pills.find((p) => p.id === "order-1");
    expect(placed?.key).toBe("dashboard.ordering.pill_placed");
    expect(placed?.params).toEqual({ vendor: "PFG" });
    expect(placed?.tone).toBe("ok");
    const draft = vm.pills.find((p) => p.id === "order-2");
    expect(draft?.key).toBe("dashboard.ordering.pill_draft");
    expect(draft?.tone).toBe("warn");
  });

  it("no open cutoff with orders in flight reads 'all orders in'", () => {
    const vm = composeOrderingTile({ openCutoffs: [], orders: [order({ poId: "1" })] });
    expect(vm.headline.key).toBe("dashboard.ordering.headline_all_in");
    expect(vm.headline.form).toBe("text");
    expect(vm.headline.tone).toBe("ok");
    expect(vm.empty).toBe(false);
  });

  it("a no-cutoff, no-order day is empty and claims nothing", () => {
    const vm = composeOrderingTile({ openCutoffs: [], orders: [] });
    expect(vm.empty).toBe(true);
    expect(vm.headline.key).toBe("dashboard.ordering.headline_none");
    expect(vm.headline.tone).toBe("info");
  });

  it("an unknown PO status still renders a pill rather than vanishing", () => {
    const vm = composeOrderingTile({
      openCutoffs: [],
      orders: [order({ poId: "1", vendorName: "PFG", status: "some_future_status" })],
    });
    const pill = vm.pills.find((p) => p.id === "order-1");
    expect(pill?.key).toBe("dashboard.ordering.pill_open");
    expect(pill?.tone).toBe("info");
  });
});
