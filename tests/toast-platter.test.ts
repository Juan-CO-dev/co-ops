/**
 * Unit spine — lib/toast/platter-shared.ts (platter/assortment depletion
 * doctrine). Pins the halves-doctrine portion constant and the classics-
 * fallback rule: a mis-flagged pool degrades to full-pool depletion, never to
 * zero.
 */
import { describe, it, expect } from "vitest";
import {
  selectAssortmentPool,
  evenMixPerOption,
  MENU_ITEM_MODIFIER_PORTION_WHOLE_SUBS,
} from "@/lib/toast/platter-shared";

const pool = [
  { id: "a", classic: true },
  { id: "b", classic: false },
  { id: "c", classic: true },
];

describe("selectAssortmentPool", () => {
  it("full takes every option", () => {
    expect(selectAssortmentPool(pool, "full").map((o) => o.id)).toEqual(["a", "b", "c"]);
  });
  it("classics takes the flagged subset", () => {
    expect(selectAssortmentPool(pool, "classics").map((o) => o.id)).toEqual(["a", "c"]);
  });
  it("classics with NO flagged options falls back to the full pool", () => {
    const unflagged = pool.map((o) => ({ ...o, classic: false }));
    expect(selectAssortmentPool(unflagged, "classics")).toHaveLength(3);
  });
  it("empty pool stays empty (advisory is the caller's job)", () => {
    expect(selectAssortmentPool([], "classics")).toHaveLength(0);
    expect(selectAssortmentPool([], "full")).toHaveLength(0);
  });
});

describe("evenMixPerOption", () => {
  it("splits whole subs evenly across the pool", () => {
    // 16 pc platter = 8 whole subs over a 5-option pool
    expect(evenMixPerOption(8, 5)).toBeCloseTo(1.6);
  });
  it("guards zero/invalid pools to 0", () => {
    expect(evenMixPerOption(8, 0)).toBe(0);
    expect(evenMixPerOption(Number.NaN, 5)).toBe(0);
  });
});

describe("doctrine constants", () => {
  it("one platter piece = half a sub", () => {
    expect(MENU_ITEM_MODIFIER_PORTION_WHOLE_SUBS).toBe(0.5);
  });
});
