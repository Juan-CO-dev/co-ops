/**
 * Count sheet C-mode — the three pure decisions (spec 2026-08-20, "Counting UX
 * (locked: option C)"; plan Phase 5, tasks 5.3/5.4/5.5).
 *
 *   1. ALLOCATION MATH — one product-level count becomes ordinary per-SKU anchor
 *      lines (deviation D8). The counted oz is GROUND TRUTH and must survive the
 *      allocation exactly; only the VENDOR ATTRIBUTION is a claim the receipt
 *      ledger supports or does not.
 *   2. SPLIT AVAILABILITY — when the sheet offers tap-to-split. Ruled (lead, flag
 *      ④): derived from the LOT LOADER + the member count, NEVER from loadOnHand
 *      (which WRITES on read — the sku_inferred_baselines upsert at lib/counts.ts).
 *   3. TWO-GRAIN ON-HAND — the per-SKU ledgers stay the truth; the product grain is
 *      their sum, with the per-vendor split and the lot remaining underneath. This
 *      is where the audit's mirrored false SHORT/OVER pair dies.
 */
import { describe, it, expect } from "vitest";
import {
  allocateProductCountToMembers,
  productSplitAvailability,
  buildProductOnHandRow,
  type LotShare,
  type ReceiptLot,
  type ProductGrainMemberInput,
} from "@/lib/products-shared";

const lot = (over: Partial<ReceiptLot> & { lotId: string; skuId: string }): ReceiptLot => ({
  receivedAt: "2026-08-01T00:00:00Z",
  oz: 100,
  ...over,
});

const share = (lotId: string, skuId: string, oz: number): LotShare => ({ lotId, skuId, oz });

const member = (
  over: Partial<ProductGrainMemberInput> & { skuId: string },
): ProductGrainMemberInput => ({
  skuName: over.skuId,
  vendorName: null,
  onHandOz: null,
  varianceOz: null,
  censusAnchored: false,
  ...over,
});

// ── 1. Allocation math ────────────────────────────────────────────────────────

describe("allocateProductCountToMembers", () => {
  it("splits the counted oz NEWEST-BACK across member lots and preserves the total exactly", () => {
    // remaining is oldest-first (the shelf); the counter is looking at the freshest.
    const remaining = [share("l1", "pfg", 200), share("l2", "baldor", 100)];
    const r = allocateProductCountToMembers(250, remaining, "pfg");
    expect(r.perSku).toEqual([
      { skuId: "baldor", oz: 100 },
      { skuId: "pfg", oz: 150 },
    ]);
    expect(r.perSku.reduce((s, p) => s + p.oz, 0)).toBe(250);
    expect(r.unallocatedOz).toBe(0);
    expect(r.reason).toBeNull();
    expect(r.absorbedBySkuId).toBeNull();
  });

  it("merges several lots of the SAME member into ONE line (council L5 disjointness)", () => {
    const remaining = [share("l1", "pfg", 60), share("l2", "pfg", 40), share("l3", "baldor", 30)];
    const r = allocateProductCountToMembers(100, remaining, "pfg");
    expect(r.perSku).toEqual([
      { skuId: "baldor", oz: 30 },
      { skuId: "pfg", oz: 70 },
    ]);
  });

  it("a count the lots cannot place lands on the PRIMARY with count_exceeds_lots — never refused", () => {
    // LEAD RULING 2026-08-20: count_exceeds_lots NEVER hard-refuses. A count is
    // ground truth and theory yields to it; the ledger-unexplained oz is attributed
    // to the resolved primary and the fact is carried as an advisory reason code.
    const remaining = [share("l1", "baldor", 40)];
    const r = allocateProductCountToMembers(100, remaining, "pfg");
    expect(r.perSku).toEqual([
      { skuId: "baldor", oz: 40 },
      { skuId: "pfg", oz: 60 },
    ]);
    expect(r.perSku.reduce((s, p) => s + p.oz, 0)).toBe(100);
    expect(r.unallocatedOz).toBe(60);
    expect(r.absorbedBySkuId).toBe("pfg");
    expect(r.reason).toBe("count_exceeds_lots");
  });

  it("the absorbed remainder MERGES into the primary's own allocated line, never a second line", () => {
    const remaining = [share("l1", "pfg", 40)];
    const r = allocateProductCountToMembers(100, remaining, "pfg");
    expect(r.perSku).toEqual([{ skuId: "pfg", oz: 100 }]);
    expect(r.unallocatedOz).toBe(60);
    expect(r.reason).toBe("count_exceeds_lots");
  });

  it("with NO lots at all the whole count lands on the primary (a first count, pre-ledger)", () => {
    const r = allocateProductCountToMembers(300, [], "pfg");
    expect(r.perSku).toEqual([{ skuId: "pfg", oz: 300 }]);
    expect(r.unallocatedOz).toBe(300);
    expect(r.reason).toBe("count_exceeds_lots");
  });

  it("with no primary to name, the remainder stays UNALLOCATED — never fabricated onto a member", () => {
    const r = allocateProductCountToMembers(100, [share("l1", "baldor", 40)], null);
    expect(r.perSku).toEqual([{ skuId: "baldor", oz: 40 }]);
    expect(r.unallocatedOz).toBe(60);
    expect(r.absorbedBySkuId).toBeNull();
    expect(r.reason).toBe("count_exceeds_lots");
  });

  it("a non-positive or non-finite count allocates nothing at all", () => {
    expect(allocateProductCountToMembers(0, [share("l1", "pfg", 10)], "pfg").perSku).toEqual([]);
    expect(allocateProductCountToMembers(-5, [share("l1", "pfg", 10)], "pfg").perSku).toEqual([]);
    expect(allocateProductCountToMembers(Number.NaN, [share("l1", "pfg", 10)], "pfg").reason).toBeNull();
  });
});

// ── 2. Split availability ─────────────────────────────────────────────────────

describe("productSplitAvailability", () => {
  it("2+ members that BOTH carry receipt lots here → split offered (the spec's trigger)", () => {
    const r = productSplitAvailability({
      activeMemberSkuIds: ["pfg", "baldor"],
      lots: [lot({ lotId: "l1", skuId: "pfg" }), lot({ lotId: "l2", skuId: "baldor" })],
    });
    expect(r).toEqual({ splitAvailable: true, lotBearingMemberCount: 2 });
  });

  it("a single member never splits, however many lots it has", () => {
    const r = productSplitAvailability({
      activeMemberSkuIds: ["pfg"],
      lots: [lot({ lotId: "l1", skuId: "pfg" }), lot({ lotId: "l2", skuId: "pfg" })],
    });
    expect(r.splitAvailable).toBe(false);
    expect(r.lotBearingMemberCount).toBe(1);
  });

  it("2+ members and the ledger knows NOTHING here → split offered on member count alone", () => {
    // The escape hatch is never withheld on silence: a counter who finds real stock
    // the ledger has not seen must not be trapped in product-only mode (count beats
    // theory — the same doctrine that made count_exceeds_lots advisory).
    const r = productSplitAvailability({ activeMemberSkuIds: ["pfg", "baldor"], lots: [] });
    expect(r).toEqual({ splitAvailable: true, lotBearingMemberCount: 0 });
  });

  it("exactly ONE member stocked here → no split (the ledger positively says the rest are absent)", () => {
    const r = productSplitAvailability({
      activeMemberSkuIds: ["pfg", "baldor"],
      lots: [lot({ lotId: "l1", skuId: "pfg" })],
    });
    expect(r).toEqual({ splitAvailable: false, lotBearingMemberCount: 1 });
  });

  it("a lot for a NON-member (or an inactive member) never counts toward the trigger", () => {
    const r = productSplitAvailability({
      activeMemberSkuIds: ["pfg", "baldor"],
      lots: [lot({ lotId: "l1", skuId: "pfg" }), lot({ lotId: "l9", skuId: "retired-twin" })],
    });
    expect(r).toEqual({ splitAvailable: false, lotBearingMemberCount: 1 });
  });

  it("a zero/negative-oz lot is not stock (it cannot make a member 'carry expected stock')", () => {
    const r = productSplitAvailability({
      activeMemberSkuIds: ["pfg", "baldor"],
      lots: [lot({ lotId: "l1", skuId: "pfg", oz: 100 }), lot({ lotId: "l2", skuId: "baldor", oz: 0 })],
    });
    expect(r).toEqual({ splitAvailable: false, lotBearingMemberCount: 1 });
  });
});

// ── 3. Two-grain on-hand ──────────────────────────────────────────────────────

describe("buildProductOnHandRow", () => {
  const lots = [
    lot({ lotId: "old", skuId: "pfg", receivedAt: "2026-08-01T00:00:00Z", oz: 200 }),
    lot({ lotId: "new", skuId: "baldor", receivedAt: "2026-08-10T00:00:00Z", oz: 200 }),
  ];

  it("the product number is the members' SUM, with the per-vendor split underneath", () => {
    const r = buildProductOnHandRow({
      productId: "P",
      productName: "HAM",
      members: [
        member({ skuId: "pfg", skuName: "Ham", vendorName: "PFG", onHandOz: 200, varianceOz: 0, censusAnchored: true }),
        member({ skuId: "baldor", skuName: "Ham", vendorName: "Baldor", onHandOz: 100, varianceOz: 0, censusAnchored: true }),
      ],
      lots,
    });
    expect(r.totalOz).toBe(300);
    expect(r.knownOz).toBe(300);
    expect(r.unknownSkuIds).toEqual([]);
    expect(r.members.map((m) => [m.vendorName, m.onHandOz])).toEqual([
      ["Baldor", 100],
      ["PFG", 200],
    ]);
  });

  it("THE MIRRORED FALSE ALARM DIES: +140 and -40 twins net to the +100 that is real", () => {
    const r = buildProductOnHandRow({
      productId: "P",
      productName: "HAM",
      members: [
        member({ skuId: "pfg", onHandOz: 200, varianceOz: 140, censusAnchored: true }),
        member({ skuId: "baldor", onHandOz: 100, varianceOz: -40, censusAnchored: true }),
      ],
      lots,
    });
    expect(r.varianceOz).toBe(100);
  });

  it("ONE unresolved member makes totalOz null — knownOz is a lower bound, never the total", () => {
    const r = buildProductOnHandRow({
      productId: "P",
      productName: "HAM",
      members: [
        member({ skuId: "pfg", onHandOz: 200, varianceOz: 0, censusAnchored: true }),
        member({ skuId: "baldor", onHandOz: null }),
      ],
      lots,
    });
    expect(r.totalOz).toBeNull();
    expect(r.knownOz).toBe(200);
    expect(r.unknownSkuIds).toEqual(["baldor"]);
    expect(r.remaining).toEqual([]); // no honest shelf to distribute
  });

  it("variance is CENSUS-ONLY: one non-census member nulls the whole product's variance", () => {
    const r = buildProductOnHandRow({
      productId: "P",
      productName: "HAM",
      members: [
        member({ skuId: "pfg", onHandOz: 200, varianceOz: 140, censusAnchored: true }),
        // an inferred / par_estimate anchor: carries oz but can never be a variance reference
        member({ skuId: "baldor", onHandOz: 100, varianceOz: null, censusAnchored: false }),
      ],
      lots,
    });
    expect(r.totalOz).toBe(300);
    expect(r.varianceOz).toBeNull();
    expect(r.varianceLots).toEqual([]);
  });

  it("lot remaining is the product's on-hand distributed NEWEST-BACK over its receipt lots", () => {
    // 400 oz received, 300 on hand → the oldest 100 oz is gone.
    const r = buildProductOnHandRow({
      productId: "P",
      productName: "HAM",
      members: [
        member({ skuId: "pfg", onHandOz: 200, varianceOz: 0, censusAnchored: true }),
        member({ skuId: "baldor", onHandOz: 100, varianceOz: 0, censusAnchored: true }),
      ],
      lots,
    });
    expect(r.remaining).toEqual([
      { lotId: "old", skuId: "pfg", oz: 100 },
      { lotId: "new", skuId: "baldor", oz: 200 },
    ]);
  });

  it("more on hand than the ledger ever received → nothing is 'consumed', never a negative shelf", () => {
    const r = buildProductOnHandRow({
      productId: "P",
      productName: "HAM",
      members: [member({ skuId: "pfg", onHandOz: 900, varianceOz: 0, censusAnchored: true })],
      lots: [lot({ lotId: "old", skuId: "pfg", oz: 200 })],
    });
    expect(r.remaining).toEqual([{ lotId: "old", skuId: "pfg", oz: 200 }]);
  });

  it("a NEGATIVE product variance is attributed OLDEST-FIRST for the reason-code trail", () => {
    const r = buildProductOnHandRow({
      productId: "P",
      productName: "HAM",
      members: [
        member({ skuId: "pfg", onHandOz: 200, varianceOz: -120, censusAnchored: true }),
        member({ skuId: "baldor", onHandOz: 100, varianceOz: 0, censusAnchored: true }),
      ],
      lots,
    });
    expect(r.varianceOz).toBe(-120);
    // remaining = [old pfg 100, new baldor 200]; the oldest absorbs first, capped.
    expect(r.varianceLots).toEqual([
      { lotId: "old", skuId: "pfg", oz: -100 },
      { lotId: "new", skuId: "baldor", oz: -20 },
    ]);
  });

  it("a NULL-oz receipt line taints the lot shelf: advisory-empty, never a split we know is short", () => {
    const r = buildProductOnHandRow({
      productId: "P",
      productName: "HAM",
      members: [
        member({ skuId: "pfg", onHandOz: 200, varianceOz: -50, censusAnchored: true }),
        member({ skuId: "baldor", onHandOz: 100, varianceOz: 0, censusAnchored: true }),
      ],
      lots,
      lotsTainted: true,
    });
    // The member ledgers are untouched — only the LOT view goes advisory.
    expect(r.totalOz).toBe(300);
    expect(r.varianceOz).toBe(-50);
    expect(r.remaining).toEqual([]);
    expect(r.varianceLots).toEqual([]);
  });

  it("a product with no members at all reads honestly null, not zero", () => {
    const r = buildProductOnHandRow({ productId: "P", productName: "HAM", members: [], lots });
    expect(r.totalOz).toBeNull();
    expect(r.knownOz).toBe(0);
    expect(r.varianceOz).toBeNull();
    expect(r.members).toEqual([]);
  });

  it("member order is TOTAL — same name, tie-broken on skuId, never on row order", () => {
    const build = (ids: string[]) =>
      buildProductOnHandRow({
        productId: "P",
        productName: "HAM",
        members: ids.map((id) => member({ skuId: id, skuName: "Ham", onHandOz: 1, varianceOz: 0, censusAnchored: true })),
        lots: [],
      }).members.map((m) => m.skuId);
    expect(build(["zeta", "alpha"])).toEqual(["alpha", "zeta"]);
    expect(build(["alpha", "zeta"])).toEqual(["alpha", "zeta"]);
  });
});
