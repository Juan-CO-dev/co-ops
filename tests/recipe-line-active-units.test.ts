/**
 * Astra full-branch review #4 — the line editor offers ACTIVE measure units only. A saved unit
 * that is a RETIRED (inactive) measure renders as the labelled legacy option and must be
 * replaced before saving, on any SKU or product line (a pack label keeps the product-only rule).
 */
import { readFileSync } from "node:fs";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { lineUnitOptions } from "@/lib/recipe-line-shared";
import { TranslationProvider } from "@/lib/i18n/provider";
import { RecipeLineEditor } from "@/components/admin/recipes/RecipeLineEditor";
import { buildIngredientOptions } from "@/lib/ingredient-picker-shared";
import en from "@/lib/i18n/en.json";

const active = ["each", "lb", "oz"];
const retired = new Set(["pt"]);
const pack = { packFormat: "case", eachContainerLabel: "bag", eachMeasure: "lb" };

describe("lineUnitOptions — active choices, the legacy unit, and whether it must change", () => {
  it("a SKU line whose saved unit is a RETIRED measure: not offered as a choice, shown as legacy, must change", () => {
    expect(lineUnitOptions("sku", pack, active, retired, "pt", "pt")).toEqual({
      choices: ["case", "bag", "lb", "each", "oz"],
      legacy: "pt",
      mustChange: true,
    });
  });

  it("a SKU line keeps a pack label or an active unit as its own first choice", () => {
    expect(lineUnitOptions("sku", pack, active, retired, "case", "case")).toEqual({ choices: ["case", "bag", "lb", "each", "oz"], legacy: null, mustChange: false });
    expect(lineUnitOptions("sku", null, active, retired, "log", "log")).toEqual({ choices: ["log", "each", "lb", "oz"], legacy: null, mustChange: false });
  });

  it("a PRODUCT line: a retired measure or a pack label is legacy and must change", () => {
    expect(lineUnitOptions("product", null, active, retired, "pt", "pt")).toEqual({ choices: ["each", "lb", "oz"], legacy: "pt", mustChange: true });
    expect(lineUnitOptions("product", null, active, retired, "case", "case")).toEqual({ choices: ["each", "lb", "oz"], legacy: "case", mustChange: true });
  });

  it("an item line keeps free text (no list, nothing legacy)", () => {
    expect(lineUnitOptions("item", null, active, retired, "pt", "pt")).toEqual({ choices: null, legacy: null, mustChange: false });
  });

  it("once the person picks an active unit, nothing is legacy", () => {
    expect(lineUnitOptions("sku", pack, active, retired, "pt", "oz")).toEqual({ choices: ["case", "bag", "lb", "each", "oz"], legacy: null, mustChange: false });
  });
});

describe("the loader and the editor carry the active list", () => {
  it("the recipe builder loader reads measure_units.active and hands the ACTIVE labels on", () => {
    const loader = readFileSync("lib/admin/recipe-builder-data.ts", "utf8");
    expect(loader).toContain('.select("label, dimension, to_base_factor, active")');
    expect(loader).toContain("activeMeasureLabels");
    for (const page of ["app/admin/recipes/[id]/page.tsx", "app/admin/recipes/new/page.tsx"]) {
      expect(readFileSync(page, "utf8"), page).toContain("activeMeasureLabels={catalog.activeMeasureLabels}");
    }
  });

  it("an editor opened on a SKU line saved in a retired unit shows it as the labelled legacy option and blocks Save", () => {
    const options = buildIngredientOptions({ skus: [{ id: "s-ham", name: "Ham", vendorName: null }], items: [], products: [] });
    const html = renderToStaticMarkup(jsx(TranslationProvider, {
      initialLanguage: "en",
      children: jsx(RecipeLineEditor, {
        title: "t", submitLabel: "Save", options,
        skus: [{ id: "s-ham", name: "Ham", vendorName: null, packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null }],
        products: [],
        measures: new Map([
          ["oz", { dimension: "weight", toBaseFactor: 1 }],
          ["pt", { dimension: "volume", toBaseFactor: 16 }],
        ]),
        activeMeasureLabels: ["oz"],
        initial: { componentSkuId: "s-ham", componentItemId: null, componentProductId: null, quantity: 2, unit: "pt", eachContainerLabel: null, portioned: false, componentName: "Ham" },
        busy: false, errorMsg: null, onSubmit: () => {}, onCancel: () => {},
      }),
    }));
    expect(html).toContain(en["recipes.input.legacy_unit"].replace("{unit}", "pt"));
    expect(html).toContain(en["recipes.input.legacy_unit_must_change"]);
    expect(html).toContain('<option value="oz">oz</option>');
    expect(html).not.toContain('<option value="pt">pt</option>');
  });
});
