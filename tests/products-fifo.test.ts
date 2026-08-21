/**
 * FIFO lot attribution (spec 2026-08-20, "what actually got eaten").
 *
 * Juan: "we will FIFO operationally" — the model mirrors the kitchen. Lots are
 * receipt lines (vendor_delivery_items, already dated per delivery), pooled across
 * ALL members of a product at one location: oldest lot depletes first, regardless of
 * vendor. Deviation D5: this runs at READ time; the depletion ledgers are not
 * re-keyed and the double-count law is untouched.
 */
import { describe, it, expect } from "vitest";
import {
  attributeFifo,
  remainingByLot,
  allocateProductCount,
  allocateProductVariance,
  type ReceiptLot,
} from "@/lib/products-shared";

const lot = (lotId: string, skuId: string, receivedAt: string, oz: number): ReceiptLot => ({
  lotId, skuId, receivedAt, oz,
});

// Two vendors, interleaved in time — the whole point is that vendor does not order them.
const LOTS: ReceiptLot[] = [
  lot("L1", "pfg", "2026-08-10T09:00:00Z", 100),
  lot("L2", "baldor", "2026-08-12T09:00:00Z", 60),
  lot("L3", "pfg", "2026-08-15T09:00:00Z", 80),
];

describe("attributeFifo", () => {
  it("consumes the OLDEST lot first, across vendors", () => {
    const r = attributeFifo(LOTS, 130);
    expect(r.shares).toEqual([
      { lotId: "L1", skuId: "pfg", oz: 100 },
      { lotId: "L2", skuId: "baldor", oz: 30 },
    ]);
    expect(r.unattributedOz).toBe(0);
  });

  it("does not depend on input row order — it sorts by receivedAt", () => {
    const shuffled = [LOTS[2]!, LOTS[0]!, LOTS[1]!];
    expect(attributeFifo(shuffled, 130)).toEqual(attributeFifo(LOTS, 130));
  });

  it("breaks a receivedAt TIE on lotId so the answer is total, not mostly-stable", () => {
    const tied = [lot("B", "x", "2026-08-10T09:00:00Z", 10), lot("A", "y", "2026-08-10T09:00:00Z", 10)];
    expect(attributeFifo(tied, 10).shares).toEqual([{ lotId: "A", skuId: "y", oz: 10 }]);
  });

  it("reports UNATTRIBUTED oz rather than inventing a lot", () => {
    const r = attributeFifo(LOTS, 300);
    expect(r.shares.reduce((s, x) => s + x.oz, 0)).toBe(240);
    expect(r.unattributedOz).toBe(60);
  });

  it("zero consumption attributes nothing", () => {
    expect(attributeFifo(LOTS, 0)).toEqual({ shares: [], unattributedOz: 0 });
  });

  it("negative or non-finite consumption is refused, not clamped into a share", () => {
    expect(attributeFifo(LOTS, -5)).toEqual({ shares: [], unattributedOz: 0 });
    expect(attributeFifo(LOTS, Number.NaN)).toEqual({ shares: [], unattributedOz: 0 });
  });

  it("no lots at all -> everything is unattributed", () => {
    expect(attributeFifo([], 50)).toEqual({ shares: [], unattributedOz: 50 });
  });

  it("skips zero/negative-oz lots instead of emitting empty shares", () => {
    const r = attributeFifo([lot("Z", "x", "2026-08-01T00:00:00Z", 0), ...LOTS], 50);
    expect(r.shares).toEqual([{ lotId: "L1", skuId: "pfg", oz: 50 }]);
  });
});

describe("remainingByLot", () => {
  it("what is LEFT is the newest-back tail — oldest was eaten first", () => {
    expect(remainingByLot(LOTS, 130)).toEqual([
      { lotId: "L2", skuId: "baldor", oz: 30 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
  });

  it("consumed >= received leaves nothing (never a negative remainder)", () => {
    expect(remainingByLot(LOTS, 999)).toEqual([]);
  });

  it("consumed 0 leaves every lot whole, oldest-first", () => {
    expect(remainingByLot(LOTS, 0)).toEqual([
      { lotId: "L1", skuId: "pfg", oz: 100 },
      { lotId: "L2", skuId: "baldor", oz: 60 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
  });

  it("INVARIANT: attributed + remaining === total received", () => {
    const total = LOTS.reduce((s, l) => s + l.oz, 0);
    for (const consumed of [0, 1, 99.5, 130, 240]) {
      const a = attributeFifo(LOTS, consumed).shares.reduce((s, x) => s + x.oz, 0);
      const r = remainingByLot(LOTS, consumed).reduce((s, x) => s + x.oz, 0);
      expect(a + r).toBeCloseTo(total, 9);
    }
  });
});

describe("allocateProductCount (deviation D8 — a product count becomes per-SKU lines)", () => {
  it("distributes NEWEST-BACK: what is on the shelf is the freshest stock", () => {
    // 90 oz counted against remaining lots L2(30 baldor) + L3(80 pfg) -> newest first.
    const r = allocateProductCount(90, [
      { lotId: "L2", skuId: "baldor", oz: 30 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
    expect(r.perSku).toEqual([{ skuId: "pfg", oz: 80 }, { skuId: "baldor", oz: 10 }]);
    expect(r.unallocatedOz).toBe(0);
  });

  it("MERGES lots of the same SKU into ONE line — sku_count_lines is per-SKU", () => {
    const r = allocateProductCount(120, [
      { lotId: "A", skuId: "pfg", oz: 50 },
      { lotId: "B", skuId: "pfg", oz: 40 },
      { lotId: "C", skuId: "baldor", oz: 60 },
    ]);
    // Newest-back over [C, B, A]: C 60 baldor, B 40 pfg, A 20 pfg -> pfg 60, baldor 60.
    expect(r.perSku).toEqual([{ skuId: "baldor", oz: 60 }, { skuId: "pfg", oz: 60 }]);
  });

  it("counting MORE than the lots explain leaves an honest unallocated remainder", () => {
    const r = allocateProductCount(200, [{ lotId: "A", skuId: "pfg", oz: 50 }]);
    expect(r.perSku).toEqual([{ skuId: "pfg", oz: 50 }]);
    expect(r.unallocatedOz).toBe(150);
  });

  it("no lots at all -> nothing allocated, everything reported unallocated", () => {
    expect(allocateProductCount(75, [])).toEqual({ perSku: [], unallocatedOz: 75 });
  });

  it("INVARIANT: allocated + unallocated === the counted number, exactly", () => {
    for (const counted of [1, 30, 89.5, 110]) {
      const r = allocateProductCount(counted, [
        { lotId: "L2", skuId: "baldor", oz: 30 },
        { lotId: "L3", skuId: "pfg", oz: 80 },
      ]);
      expect(r.perSku.reduce((s, x) => s + x.oz, 0) + r.unallocatedOz).toBeCloseTo(counted, 9);
    }
  });
});

describe("allocateProductVariance (spec: 'oldest lot absorbs')", () => {
  it("a SHORTAGE lands on the OLDEST remaining lot first", () => {
    const r = allocateProductVariance(-25, [
      { lotId: "L2", skuId: "baldor", oz: 30 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
    expect(r).toEqual([{ lotId: "L2", skuId: "baldor", oz: -25 }]);
  });

  it("a shortage larger than the oldest lot spills forward, still oldest-first", () => {
    const r = allocateProductVariance(-50, [
      { lotId: "L2", skuId: "baldor", oz: 30 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
    expect(r).toEqual([
      { lotId: "L2", skuId: "baldor", oz: -30 },
      { lotId: "L3", skuId: "pfg", oz: -20 },
    ]);
  });

  it("a SURPLUS (counted more than predicted) lands whole on the oldest lot — it is an uncounted receipt, not a spread", () => {
    const r = allocateProductVariance(15, [
      { lotId: "L2", skuId: "baldor", oz: 30 },
      { lotId: "L3", skuId: "pfg", oz: 80 },
    ]);
    expect(r).toEqual([{ lotId: "L2", skuId: "baldor", oz: 15 }]);
  });

  it("zero variance allocates nothing", () => {
    expect(allocateProductVariance(0, [{ lotId: "A", skuId: "x", oz: 10 }])).toEqual([]);
  });

  it("no lots -> nothing to absorb it; returns empty rather than inventing an owner", () => {
    expect(allocateProductVariance(-10, [])).toEqual([]);
  });
});
