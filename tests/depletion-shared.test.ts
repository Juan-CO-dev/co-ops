import { describe, expect, it } from "vitest";
import { findNestedProductionDuplicates, selectSalesDepletion } from "@/lib/depletion-shared";

describe("selectSalesDepletion", () => {
  it("always counts direct sales and replaces a produced prep item's sales lane", () => {
    const got = selectSalesDepletion(
      [{ skuId: "bread", directOz: 3 }],
      [{ itemId: "sauce", itemPath: ["sauce"], skuId: "tomato", oz: 8 }, { itemId: "slaw", itemPath: ["slaw"], skuId: "cabbage", oz: 5 }],
      new Set(["sauce"]),
    );
    expect(Object.fromEntries(got)).toEqual({ bread: 3, cabbage: 5 });
  });

  it("keeps shared sku attribution independent by item", () => {
    const got = selectSalesDepletion([], [
      { itemId: "a", itemPath: ["a"], skuId: "shared", oz: 4 }, { itemId: "b", itemPath: ["b"], skuId: "shared", oz: 7 },
    ], new Set(["a"]));
    expect(got.get("shared")).toBe(7);
  });
});

it("stops an unlogged ancestor at a logged descendant boundary", () => {
  const got = selectSalesDepletion([], [
    { itemId: "a", itemPath: ["a", "b"], skuId: "raw", oz: 9 },
  ], new Set(["b"]));
  expect(got.size).toBe(0);
});

it("flags nested prep recorded at both boundaries", () => {
  expect(findNestedProductionDuplicates(new Set(["a", "b"]), new Map([["a", new Set(["b"])]])))
    .toEqual([{ ancestorItemId: "a", descendantItemId: "b" }]);
});
