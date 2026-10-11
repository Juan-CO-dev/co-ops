import { describe, expect, it } from "vitest";
import { mapProductItemLinks, registryLinkHref, type LinkInput } from "@/lib/admin/product-item-links-shared";

function input(recipe: string, kind: "product" | "sku" | "item", id: string): LinkInput {
  return { recipe_id: recipe, component_product_id: null, component_sku_id: null, component_item_id: null,
    [`component_${kind}_id`]: id };
}
function fixture(): Parameters<typeof mapProductItemLinks>[0] {
  return {
    recipes: [{ id: "direct", active: true }, { id: "member", active: true }, { id: "singleton", active: true }],
    inputs: [input("direct", "product", "ham"), input("member", "sku", "vendor-ham"), input("singleton", "sku", "bacon")],
    outputs: [{ recipe_id: "direct", output_item_id: "prep-ham" }, { recipe_id: "member", output_item_id: "prep-ham" },
      { recipe_id: "singleton", output_item_id: "prep-bacon" }],
    products: [{ id: "ham", name: "Ham", name_es: "Jamón", active: true }],
    skus: [{ id: "vendor-ham", name: "Ham", active: true, product_id: "ham", vendor_id: "vendor" },
      { id: "bacon", name: "Bacon", active: true, product_id: null, vendor_id: "vendor" }],
    items: [{ id: "prep-ham", name: "Ham", name_es: "Jamón", active: true, location_id: null },
      { id: "prep-bacon", name: "Bacon", active: true, location_id: null }],
    vendors: [{ id: "vendor", name: "Supplier" }],
  };
}

describe("product/prep-item relationships", () => {
  it("maps direct product inputs and member SKUs, deduplicating outputs and repeated inputs", () => {
    const data = fixture();
    data.inputs.push(input("direct", "product", "ham"));
    data.outputs.push(data.outputs[0]!);
    const result = mapProductItemLinks(data);
    expect(result.madeFromByItem["prep-ham"]?.map(x => [x.kind, x.id, x.vendorName])).toEqual([
      ["product", "ham", null], ["sku", "vendor-ham", "Supplier"],
    ]);
    expect(result.usedInByProduct.ham?.map(x => x.id)).toEqual(["prep-ham"]);
  });
  it("finds product use through member SKUs even with no direct product pin", () => {
    const data = fixture();
    data.inputs = data.inputs.filter(i => i.component_product_id === null);
    expect(mapProductItemLinks(data).usedInByProduct.ham?.map(x => x.id)).toEqual(["prep-ham"]);
  });
  it("keeps a singleton SKU visible without inventing a product", () => {
    const result = mapProductItemLinks(fixture());
    const bacon = result.madeFromByItem["prep-bacon"]![0]!;
    expect(bacon).toMatchObject({ kind: "sku", id: "bacon", vendorName: "Supplier" });
    expect(registryLinkHref(bacon)).toBe("/admin/skus#bacon");
    expect(result.usedInByProduct.bacon).toBeUndefined();
  });
  it.each(["recipe", "product", "sku", "item"])("excludes inactive %s relationships", kind => {
    const data = fixture();
    if (kind === "recipe") data.recipes.forEach(r => { r.active = false; });
    if (kind === "product") data.products[0]!.active = false;
    if (kind === "sku") {
      data.skus[0]!.active = false;
      data.inputs = data.inputs.filter(i => !i.component_product_id);
    }
    if (kind === "item") data.items[0]!.active = false;
    const result = mapProductItemLinks(data);
    expect(result.usedInByProduct.ham).toBeUndefined();
    if (kind !== "product") expect(result.madeFromByItem["prep-ham"]).toBeUndefined();
    else expect(result.madeFromByItem["prep-ham"]?.every(x => x.kind !== "product")).toBe(true);
    if (kind === "recipe") expect(result.producingRecipeByItem).toEqual({});
  });
  it("lists active sub-preps without implying transitive product use", () => {
    const data = fixture();
    data.inputs = [input("singleton", "item", "prep-ham"), input("direct", "product", "ham")];
    const result = mapProductItemLinks(data);
    expect(result.madeFromByItem["prep-bacon"]?.map(x => x.kind)).toEqual(["item"]);
    expect(result.usedInByProduct.ham?.map(x => x.id)).toEqual(["prep-ham"]);
    data.items[0]!.active = false;
    expect(mapProductItemLinks(data).madeFromByItem["prep-bacon"]).toBeUndefined();
  });
  it("ignores missing references, menu outputs, and location-only items with no registry destination", () => {
    const data = fixture();
    data.items[0]!.location_id = "shop";
    data.inputs.push(input("singleton", "sku", "missing"));
    data.outputs.push({ recipe_id: "direct", output_item_id: null }, { recipe_id: "missing", output_item_id: "prep-bacon" });
    const result = mapProductItemLinks(data);
    expect(result.usedInByProduct).toEqual({});
    expect(result.madeFromByItem["prep-ham"]).toBeUndefined();
    expect(result.madeFromByItem["prep-bacon"]).toHaveLength(1);
  });
  it("maps multiple outputs and input rows beyond the first thousand without duplicate links", () => {
    const data = fixture();
    data.inputs = Array.from({ length: 1001 }, () => input("direct", "product", "ham"));
    data.outputs.push({ recipe_id: "direct", output_item_id: "prep-bacon" });
    expect(mapProductItemLinks(data).usedInByProduct.ham?.map(x => x.id)).toEqual(["prep-bacon", "prep-ham"]);
  });
});
