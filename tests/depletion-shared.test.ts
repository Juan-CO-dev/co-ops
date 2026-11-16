import { describe, expect, it } from "vitest";
import { CARRY_CAP_DAYS, carryDaysFor, findNestedProductionDuplicates, producedItemsForDay, selectSalesDepletion } from "@/lib/depletion-shared";

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

describe("W16/B092: producedItemsForDay (a batch covers its carry window)", () => {
  const days = new Map([["tuna", ["2026-10-05"]], ["slaw", ["2026-10-09"]]]);
  const five = () => 5;
  it("a production on D-1 with a 5-day carry covers D; D itself counts", () => {
    expect([...producedItemsForDay(days, "2026-10-06", five)]).toEqual(["tuna"]);
    expect(producedItemsForDay(days, "2026-10-05", five).has("tuna")).toBe(true);
  });
  it("D-5 is still covered, D-6 is not", () => {
    expect(producedItemsForDay(days, "2026-10-10", five).has("tuna")).toBe(true);
    expect(producedItemsForDay(days, "2026-10-11", five).has("tuna")).toBe(false);
  });
  it("a production on D+1 never covers D, and another item is unaffected", () => {
    expect(producedItemsForDay(days, "2026-10-08", five).has("slaw")).toBe(false);
    expect(producedItemsForDay(days, "2026-10-04", five).size).toBe(0);
  });
  it("the carry is per item", () => {
    const carry = (id: string) => (id === "tuna" ? 1 : 5);
    expect(producedItemsForDay(days, "2026-10-07", carry).has("tuna")).toBe(false);
  });
  it("carryDaysFor: the longest shelf life, else 5, capped", () => {
    expect(carryDaysFor(undefined)).toBe(5);
    expect(carryDaysFor([3, 7])).toBe(7);
    expect(carryDaysFor([40])).toBe(CARRY_CAP_DAYS);
    expect(carryDaysFor([0, -1])).toBe(5);
  });
});
