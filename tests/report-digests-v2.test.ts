import { describe, expect, it } from "vitest";
import {
  allShopTotals,
  cutoffInstant,
  cutoffsTomorrow,
  deliveriesLookahead,
  dollarsToCents,
  groupWaste,
  lookaheadDay,
  ok,
  orderingForDay,
  salesDeltaPct,
  summarizeSalesDay,
  sumKnown,
  unavailable,
  walkSnapshot,
  type OrderingInput,
  type PoFact,
  type SalesOrderInput,
  type VendorFact,
} from "@/lib/report-digests-v2-shared";
import { v2Fixture } from "./fixtures/digest-v2";

const LOC = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// ── Sales ────────────────────────────────────────────────────────────────────────────────────

const sel = (check: string, name: string, quantity: number, over: Partial<SalesOrderInput["selections"][number]> = {}) =>
  ({ check_guid: check, selection_guid: `${check}-${name}-${quantity}`, parent_selection_guid: null, item_guid: `g-${name}`, name, quantity, voided: false, deleted: false, ...over });
const order = (id: string, over: Partial<SalesOrderInput> = {}): SalesOrderInput => ({
  snapshotId: id, salesChannel: "dine_in", deleted: false, voided: false, excessFood: false, selections: [], checks: [], ...over,
});

describe("sales: the pulse's net rules, channel mix, top items, discounts and voids", () => {
  const orders: SalesOrderInput[] = [
    order("s1", { checks: [{ checkGuid: "c1", amountCents: 1000, voided: false, deleted: false }], selections: [sel("c1", "Crunchy Boi", 2), sel("c1", "Chips", 1, { parent_selection_guid: "x" })] }),
    order("s2", { salesChannel: "third_party", checks: [{ checkGuid: "c2", amountCents: 500, voided: false, deleted: false }, { checkGuid: "c2v", amountCents: 900, voided: true, deleted: false }], selections: [sel("c2", "Italian", 1), sel("c2", "Crunchy Boi", 1, { voided: true })] }),
    order("s3", { voided: true, checks: [{ checkGuid: "c3", amountCents: 700, voided: false, deleted: false }] }),
    order("s4", { salesChannel: "gift_card", checks: [{ checkGuid: "c4", amountCents: 2500, voided: false, deleted: false }] }),
    order("s5", { excessFood: true, checks: [{ checkGuid: "c5", amountCents: 300, voided: false, deleted: false }] }),
    order("s6", { deleted: true, checks: [{ checkGuid: "c6", amountCents: 999, voided: false, deleted: false }] }),
    order("s7", { salesChannel: null, checks: [{ checkGuid: "c7", amountCents: 250, voided: false, deleted: false }], selections: [sel("c7", "Italian", 3)] }),
  ];
  const discounts = [
    { snapshotId: "s1", checkGuid: "c1", name: "Employee meal", amountCents: 200 },
    { snapshotId: "s7", checkGuid: "c7", name: "Employee meal", amountCents: 100 },
    { snapshotId: "s2", checkGuid: "c2v", name: "Comp", amountCents: 900 }, // on a VOIDED check: excluded
    { snapshotId: "s3", checkGuid: "c3", name: "Comp", amountCents: 700 }, // on a VOIDED order: excluded
  ];
  const s = summarizeSalesDay("2026-10-07", orders, discounts, false);

  it("net sales = live checks on live orders, gift cards / excess food / voids / deletes excluded", () => {
    expect(s.netCents).toBe(1750);
    expect(s.checks).toBe(3);
    expect(s.avgCheckCents).toBe(583);
  });
  it("3rd-party share is the reviewed third_party channel over net", () => {
    expect(s.thirdPartyCents).toBe(500);
    expect(s.thirdPartySharePct).toBe(29);
  });
  it("channel mix, largest first; an unmapped label is its own row (never folded into another)", () => {
    expect(s.channels).toEqual([
      { channel: "dine_in", netCents: 1000, checks: 1 },
      { channel: "third_party", netCents: 500, checks: 1 },
      { channel: null, netCents: 250, checks: 1 },
    ]);
  });
  it("top items count top-level live selections only (modifiers and voided units excluded)", () => {
    expect(s.topItems).toEqual([{ name: "Italian", units: 4 }, { name: "Crunchy Boi", units: 2 }]);
  });
  it("discounts by name only on live checks of counted orders", () => {
    expect(s.discounts).toEqual([{ name: "Employee meal", count: 2, cents: 300 }]);
  });
  it("voids: voided orders, voided checks, voided top-level units", () => {
    expect(s.voids).toEqual({ orders: 1, checks: 1, units: 1 });
  });
  it("an empty captured day is a real zero with no average and no share", () => {
    const e = summarizeSalesDay("2026-10-07", [], [], false);
    expect(e).toMatchObject({ netCents: 0, checks: 0, avgCheckCents: null, thirdPartySharePct: null, channels: [], topItems: [], discounts: [] });
  });
  it("a live check with no amount is the pulse's refusal (unknown money, never $0)", () => {
    expect(() => summarizeSalesDay("2026-10-07", [order("x", { checks: [{ checkGuid: "c", amountCents: null, voided: false, deleted: false }] })], [], false))
      .toThrow("capture_pulse_amount_missing");
  });
  it("vs the same weekday last week; uncomparable is null", () => {
    expect(salesDeltaPct(s, { ...s, netCents: 1590 })).toBe(10);
    expect(salesDeltaPct(s, null)).toBeNull();
    expect(salesDeltaPct(s, { ...s, netCents: 0 })).toBeNull();
  });
});

// ── Ordering ─────────────────────────────────────────────────────────────────────────────────

const vendor = (id: string, over: Partial<VendorFact> = {}): VendorFact => ({ id, name: id.toUpperCase(), sourceKind: "vendor", active: true, ...over });
const po = (id: string, vendorId: string, over: Partial<PoFact> = {}): PoFact => ({
  id, displayCode: `MEP-${id}`, vendorId, status: "placed", createdAt: "2026-10-07T12:00:00Z", confirmedAt: null, placedAt: null,
  placedByName: null, totalCents: 10000, unpricedLines: 0, ...over,
});
const D = "2026-10-07"; // Wednesday (EDT); 10:00 ET = 14:00Z
function input(over: Partial<OrderingInput> = {}): OrderingInput {
  return {
    day: D, locationId: LOC, now: new Date("2026-10-08T01:00:00Z"), pos: [], vendors: [], cutoffs: [], walks: [], walkLines: [],
    rhythm: [], skips: [], receivedPoIds: new Set(), ...over,
  };
}

describe("ordering: placed, drafts never sent, missed cutoffs", () => {
  const wed = 3;
  const cutoffs = ["v1", "v2", "v3", "v4", "v5", "store"].map((v) => ({ vendorId: v, locationId: null, orderDay: wed, cutoffTime: v === "v5" ? "23:00:00" : "10:00:00" }));
  const walks = [{ eventId: "w1", walkedAt: "2026-10-06T23:00:00Z" }]; // Tue 19:00 ET, inside the 24 h window
  const walkLines = [
    { eventId: "w1", vendorId: "v1", orderQty: 2, parQty: 4, impliedOnHandOz: 10, skuName: "Ham" },
    { eventId: "w1", vendorId: "v1", orderQty: 1, parQty: 2, impliedOnHandOz: 0, skuName: "Rolls" },
    { eventId: "w1", vendorId: "v3", orderQty: 0, parQty: 2, impliedOnHandOz: 20, skuName: "Mayo" },
  ];
  const res = orderingForDay(input({
    vendors: [vendor("v1"), vendor("v2"), vendor("v3"), vendor("v4"), vendor("v5"), vendor("store", { sourceKind: "store" })],
    cutoffs, walks, walkLines,
    pos: [
      po("p2", "v2", { placedAt: "2026-10-07T13:00:00Z", placedByName: "Alex" }),
      po("p4", "v4", { placedAt: "2026-10-07T15:30:00Z" }),
      po("d1", "v1", { status: "draft", totalCents: null, unpricedLines: 3, createdAt: "2026-10-07T13:30:00Z" }),
      po("old", "v2", { placedAt: "2026-10-06T13:00:00Z", createdAt: "2026-10-06T12:00:00Z" }),
    ],
  }));

  it("POs placed on D (by ET day of placed_at), earliest first, with who placed them", () => {
    expect(res.placed.map((p) => [p.id, p.placedByName])).toEqual([["p2", "Alex"], ["p4", null]]);
  });
  it("drafts created on D and never sent", () => {
    expect(res.unsent.map((p) => p.id)).toEqual(["d1"]);
  });
  it("missed = cutoff passed, no order at or beyond confirmed, and the walk suggested items for that vendor", () => {
    expect(res.missed).toEqual([{ vendorId: "v1", vendorName: "V1", cutoffTime: "10:00:00", suggestedLines: 2 }]);
  });
  it("an order placed after the cutoff is late, not missed; a walk that suggested nothing is not missed", () => {
    expect(res.late).toEqual([{ vendorId: "v4", vendorName: "V4", cutoffTime: "10:00:00", displayCode: "MEP-p4" }]);
    expect(res.missed.some((m) => m.vendorId === "v3")).toBe(false);
  });
  it("yesterday's order does not clear today's cutoff; a cutoff still ahead is not judged; stores never have cutoffs", () => {
    expect(res.missed.some((m) => m.vendorId === "v5" || m.vendorId === "store")).toBe(false);
    expect(res.unverified).toEqual([]);
  });
  it("no walk in the 24 h before a passed cutoff and no order = unverified, never missed", () => {
    const r = orderingForDay(input({ vendors: [vendor("v1")], cutoffs: cutoffs.filter((c) => c.vendorId === "v1") }));
    expect(r.missed).toEqual([]);
    expect(r.unverified).toEqual([{ vendorId: "v1", vendorName: "V1", cutoffTime: "10:00:00" }]);
  });
  it("an empty day is empty lists (the composer says No POs placed)", () => {
    const r = orderingForDay(input());
    expect(r).toEqual({ placed: [], unsent: [], missed: [], unverified: [], late: [] });
  });
});

describe("tomorrow: business day D looks at D + 1 (America/New_York)", () => {
  it("D + 1 across month ends and both DST transitions", () => {
    expect(lookaheadDay("2026-10-31")).toBe("2026-11-01");
    expect(lookaheadDay("2026-11-01")).toBe("2026-11-02");
    expect(lookaheadDay("2027-03-13")).toBe("2027-03-14");
    expect(lookaheadDay("2026-12-31")).toBe("2027-01-01");
  });

  it("cutoff instants are ET wall time on each side of DST", () => {
    const c = [{ vendorId: "v", locationId: null, orderDay: 0, cutoffTime: "10:00" }, { vendorId: "v", locationId: null, orderDay: 6, cutoffTime: "10:00" }];
    expect(cutoffInstant(c, "v", LOC, "2026-10-31")!.at.toISOString()).toBe("2026-10-31T14:00:00.000Z"); // Sat, EDT
    expect(cutoffInstant(c, "v", LOC, "2026-11-01")!.at.toISOString()).toBe("2026-11-01T15:00:00.000Z"); // Sun, EST
    expect(cutoffInstant(c, "v", LOC, "2027-03-14")!.at.toISOString()).toBe("2027-03-14T14:00:00.000Z"); // Sun, EDT again
  });

  // Saturday D = 2026-10-10 → tomorrow Sunday 2026-10-11.
  const SAT = "2026-10-10";
  const vendors = [vendor("sun"), vendor("mon"), vendor("fri"), vendor("none"), vendor("skip"), vendor("got")];
  const rhythm = [
    { vendorId: "sun", locationId: LOC, orderDow: 6, leadDays: 1 }, // Sat → Sun
    { vendorId: "mon", locationId: LOC, orderDow: 6, leadDays: 2 }, // Sat → Mon
    { vendorId: "fri", locationId: LOC, orderDow: 5, leadDays: 1 }, // Fri → Sat (= D)
    { vendorId: "skip", locationId: LOC, orderDow: 6, leadDays: 1 },
    { vendorId: "got", locationId: LOC, orderDow: 6, leadDays: 1 },
    { vendorId: "sun", locationId: OTHER, orderDow: 6, leadDays: 3 }, // another shop's truck never applies
  ];
  const sat = "2026-10-10T14:00:00Z";
  const pos = [
    po("a", "sun", { placedAt: sat }), po("b", "mon", { placedAt: sat }), po("c", "fri", { placedAt: "2026-10-09T14:00:00Z" }),
    po("d", "none", { placedAt: sat }), po("e", "skip", { placedAt: sat }), po("f", "got", { placedAt: sat }),
    po("g", "sun", { status: "draft", createdAt: sat }), po("h", "sun", { status: "received", placedAt: sat }),
  ];
  const lk = deliveriesLookahead({ day: SAT, locationId: LOC, pos, vendors, rhythm, skips: [{ vendorId: "skip", skipFrom: "2026-10-11", skipThrough: "2026-10-12" }], receivedPoIds: new Set(["f"]) });

  it("a Saturday order at lead 1 is due Sunday; at lead 2 it is Monday's truck, not tomorrow's", () => {
    expect(lk.due.map((d) => [d.po.id, d.deliveryDay])).toEqual([["a", "2026-10-11"]]);
  });
  it("an open order whose truck was due by D with nothing received is overdue", () => {
    expect(lk.overdue.map((d) => [d.po.id, d.deliveryDay])).toEqual([["c", "2026-10-10"]]);
  });
  it("no rhythm pair = undated (never a guessed day); a skip window cancels; received / draft / received-status never count", () => {
    expect(lk.undated.map((d) => d.po.id)).toEqual(["d"]);
    expect([...lk.due, ...lk.overdue].some((d) => ["e", "f", "g", "h"].includes(d.po.id))).toBe(false);
  });

  it("order cutoffs tomorrow: Sunday's governing cutoff per vendor, location row wins, with draft / ordered state", () => {
    const cutoffs = [
      { vendorId: "sun", locationId: null, orderDay: 0, cutoffTime: "11:00:00" },
      { vendorId: "sun", locationId: LOC, orderDay: 0, cutoffTime: "12:00:00" }, // more specific wins over earlier
      { vendorId: "mon", locationId: null, orderDay: 1, cutoffTime: "09:00:00" }, // Monday: not tomorrow
      { vendorId: "fri", locationId: null, orderDay: 0, cutoffTime: "08:00:00" },
      { vendorId: "got", locationId: OTHER, orderDay: 0, cutoffTime: "07:00:00" }, // the other shop's row only
    ];
    expect(cutoffsTomorrow({ day: SAT, locationId: LOC, pos, vendors, cutoffs })).toEqual([
      { vendorId: "fri", vendorName: "FRI", cutoffTime: "08:00:00", hasDraft: false, ordered: false },
      // Saturday morning's order belonged to Saturday's cutoff, so Sunday's is still open.
      { vendorId: "sun", vendorName: "SUN", cutoffTime: "12:00:00", hasDraft: true, ordered: false },
    ]);
    const evening = [...pos, po("late-sat", "sun", { placedAt: "2026-10-11T00:30:00Z" })]; // Sat 20:30 ET
    expect(cutoffsTomorrow({ day: SAT, locationId: LOC, pos: evening, vendors, cutoffs }).find((x) => x.vendorId === "sun")!.ordered).toBe(true);
  });
});

// ── Receiving / inventory helpers ────────────────────────────────────────────────────────────

describe("money and inventory helpers", () => {
  it("dollars → cents; unknown stays unknown", () => {
    expect(dollarsToCents("123.45")).toBe(12345);
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(null)).toBeNull();
    expect(dollarsToCents("x")).toBeNull();
    expect(sumKnown([100, null, 250])).toEqual({ cents: 350, unknown: 1 });
  });
  it("the walk snapshot: below par = suggested order, out = implied on hand 0; no walk = null", () => {
    const w = walkSnapshot([{ eventId: "w", walkedAt: "x" }], [
      { eventId: "w", vendorId: "v", orderQty: 2, parQty: 4, impliedOnHandOz: 0, skuName: "Rolls" },
      { eventId: "w", vendorId: "v", orderQty: 1, parQty: 4, impliedOnHandOz: 3, skuName: "Ham" },
      { eventId: "w", vendorId: "v", orderQty: 0, parQty: 4, impliedOnHandOz: 30, skuName: "Mayo" },
      { eventId: "other", vendorId: "v", orderQty: 5, parQty: 4, impliedOnHandOz: 0, skuName: "Elsewhere" },
    ]);
    expect(w).toEqual({ walks: 1, belowPar: [{ name: "Ham" }, { name: "Rolls" }], out: [{ name: "Rolls" }] });
    expect(walkSnapshot([], [])).toBeNull();
  });
  it("waste groups by item + unit, largest first", () => {
    expect(groupWaste([{ name: "Tuna", qty: 1, unit: "qt" }, { name: "Tuna", qty: 2, unit: "qt" }, { name: "Egg", qty: 4, unit: "qt" }, { name: "Zero", qty: 0, unit: null }]))
      .toEqual([{ name: "Egg", qty: 4, unit: "qt" }, { name: "Tuna", qty: 3, unit: "qt" }]);
  });
});

// ── All-shop totals (level 8+) ───────────────────────────────────────────────────────────────

describe("all-shop totals", () => {
  it("sums only what is known, and says how many shops the sales cover", () => {
    const t = allShopTotals([v2Fixture(), v2Fixture({ sales: unavailable("no_capture") })]);
    expect(t).toMatchObject({ shops: 2, salesShops: 1, netCents: 10000, checks: 1, lastWeekCents: 8000, cateringCompletedCents: 10000, posPlaced: 2, posPlacedCents: 5000 });
  });
  it("a shop with no last-week capture makes the combined delta unavailable, never a partial comparison", () => {
    const one = v2Fixture();
    const noLast = v2Fixture({ sales: ok({ today: (one.sales as { kind: "ok"; value: { today: ReturnType<typeof summarizeSalesDay> } }).value.today, lastWeek: null }) });
    expect(allShopTotals([one, noLast]).lastWeekCents).toBeNull();
  });
});
