/** Catalog Phase 1 — the searchable ingredient picker, pure half. */
import { describe, expect, it } from "vitest";
import {
  buildIngredientOptions,
  filterIngredientOptions,
  ingredientKey,
  lineTargetKey,
  moveActive,
  normalizeSearch,
  optionForLine,
} from "@/lib/ingredient-picker-shared";

const options = buildIngredientOptions({
  skus: [
    { id: "s-ham-b", name: "Ham", vendorName: "Baldor" },
    { id: "s-ham-p", name: "Ham", vendorName: "PFG" },
    { id: "s-honey", name: "Honey Ham", vendorName: "Baldor" },
    { id: "s-graham", name: "Graham Crackers", vendorName: null },
    { id: "s-jal", name: "Jalapeño Slices", vendorName: "Sysco" },
  ],
  items: [{ id: "i-ham-salad", name: "Ham Salad" }],
  products: [{ id: "p-ham", name: "Ham" }],
});

describe("buildIngredientOptions", () => {
  it("merges all three kinds, sorted by name then kind (product, SKU, item), with stable keys", () => {
    expect(options.map((o) => o.key)).toEqual([
      "sku:s-graham", "product:p-ham", "sku:s-ham-b", "sku:s-ham-p", "item:i-ham-salad", "sku:s-honey", "sku:s-jal",
    ]);
    expect(options.find((o) => o.key === "sku:s-ham-b")).toEqual({ key: "sku:s-ham-b", kind: "sku", id: "s-ham-b", name: "Ham", vendorName: "Baldor" });
    expect(options.find((o) => o.key === "item:i-ham-salad")?.vendorName).toBeNull();
  });
});

describe("filterIngredientOptions", () => {
  it("an empty query lists everything, capped, with the true total", () => {
    expect(filterIngredientOptions(options, "  ", 3)).toEqual({ matches: options.slice(0, 3), total: options.length });
  });

  it("ignores case and accents", () => {
    expect(normalizeSearch("  JalapeÑo   SLICES ")).toBe("jalapeno slices");
    expect(filterIngredientOptions(options, "jalapeno").matches.map((o) => o.id)).toEqual(["s-jal"]);
  });

  it("matches the vendor name, and every word must match somewhere", () => {
    expect(filterIngredientOptions(options, "pfg").matches.map((o) => o.id)).toEqual(["s-ham-p"]);
    expect(filterIngredientOptions(options, "ham baldor").matches.map((o) => o.id)).toEqual(["s-ham-b", "s-honey"]);
  });

  it("ranks a name that STARTS with the query first, then a word start, then anywhere", () => {
    expect(filterIngredientOptions(options, "ham").matches.map((o) => o.id)).toEqual([
      "p-ham", "s-ham-b", "s-ham-p", "i-ham-salad", "s-honey", "s-graham",
    ]);
  });

  it("caps the list but reports how many matched", () => {
    const many = buildIngredientOptions({
      skus: Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, name: `Salt ${String(i).padStart(2, "0")}`, vendorName: null })),
      items: [], products: [],
    });
    const r = filterIngredientOptions(many, "salt", 50);
    expect(r.matches).toHaveLength(50);
    expect(r.total).toBe(60);
  });
});

describe("moveActive — arrow keys clamp to the list (P3-8)", () => {
  it("moves within bounds and never past either end", () => {
    expect(moveActive(0, 1, 3)).toBe(1);
    expect(moveActive(2, 1, 3)).toBe(2);
    expect(moveActive(0, -1, 3)).toBe(0);
    expect(moveActive(5, -1, 0)).toBe(0);
  });
});

describe("a line's target as a picker option", () => {
  it("finds the offered option for a line", () => {
    const line = { componentSkuId: "s-ham-p", componentItemId: null, componentProductId: null, componentName: "Ham" };
    expect(lineTargetKey(line)).toBe("sku:s-ham-p");
    expect(optionForLine(line, options)).toBe(options.find((o) => o.key === "sku:s-ham-p"));
  });

  it("synthesises an option for a target the picker no longer offers (a retired product keeps its name)", () => {
    const line = { componentSkuId: null, componentItemId: null, componentProductId: "p-gone", componentName: "Old Ham" };
    expect(optionForLine(line, options)).toEqual({ key: ingredientKey("product", "p-gone"), kind: "product", id: "p-gone", name: "Old Ham", vendorName: null });
  });
});
