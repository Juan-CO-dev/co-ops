/** Catalog Phase 1 — the picker renders as an accessible combobox with 44px rows, in en and es. */
import { readFileSync } from "node:fs";
import { type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import { IngredientPicker } from "@/components/admin/recipes/IngredientPicker";
import { buildIngredientOptions } from "@/lib/ingredient-picker-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));
const options = buildIngredientOptions({
  skus: [{ id: "s-ham", name: "Ham", vendorName: "Baldor" }],
  items: [{ id: "i-slaw", name: "Slaw" }],
  products: [{ id: "p-turkey", name: "Turkey" }],
});

describe("IngredientPicker", () => {
  it("with nothing chosen it is an open combobox listing name · vendor · kind in 44px rows", () => {
    const html = render(jsx(IngredientPicker, { options, value: null, onChange: () => {} }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="listbox"');
    expect(html.match(/role="option"/g)).toHaveLength(3);
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("Baldor");
    expect(html).toContain(en["recipes.picker.kind.item"]);
  });

  it("with a choice it shows the choice and a Change button, and no list", () => {
    const html = render(jsx(IngredientPicker, { options, value: options[0]!, onChange: () => {} }), "es");
    expect(html).not.toContain('role="listbox"');
    expect(html).toContain(es["recipes.picker.change"]);
  });

  it("keyboard: arrows use the clamp and the active option scrolls into view (P3-8)", () => {
    const src = readFileSync("components/admin/recipes/IngredientPicker.tsx", "utf8");
    expect(src).toContain("moveActive(i, 1, matches.length)");
    expect(src).toContain("moveActive(i, -1, matches.length)");
    expect(src).toContain('scrollIntoView({ block: "nearest" })');
  });
});

describe("every new string exists in en AND es", () => {
  const keys = [
    "recipes.builder.add_ingredient", "recipes.builder.add_ingredient_title",
    "recipes.picker.label", "recipes.picker.placeholder", "recipes.picker.results", "recipes.picker.no_matches",
    "recipes.picker.more", "recipes.picker.no_vendor", "recipes.picker.change", "recipes.picker.change_aria",
    "recipes.picker.kind.sku", "recipes.picker.kind.item", "recipes.picker.kind.product",
    "recipes.picker.keep_current", "recipes.input.legacy_unit", "recipes.input.legacy_unit_must_change",
    "recipes.input.sku_unit_unresolved",
    "recipes.row.edit", "recipes.row.edit_aria", "recipes.row.edit_title", "recipes.row.save_changes",
    "recipes.error.line_changed", "recipes.error.step_up_grant_required",
    "admin.skus.error.step_up_grant_required", "admin.products.error.step_up_grant_required",
  ];
  it.each(keys)("%s", (k) => {
    expect((en as Record<string, string>)[k]).toBeTruthy();
    expect((es as Record<string, string>)[k]).toBeTruthy();
  });
});

describe("RecipeLineEditor — every control is programmatically labelled", () => {
  it("quantity, unit and portioned point at their visible, translated labels", async () => {
    const { RecipeLineEditor } = await import("@/components/admin/recipes/RecipeLineEditor");
    const html = render(jsx(RecipeLineEditor, {
      title: "t", submitLabel: "s", options,
      skus: [{ id: "s-ham", name: "Ham", vendorName: "Baldor", packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null }],
      products: [], measures: new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]]),
      initial: { componentSkuId: "s-ham", componentItemId: null, componentProductId: null, quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false, componentName: "Ham" },
      busy: false, errorMsg: null, onSubmit: () => {}, onCancel: () => {},
    }), "es");
    const refs = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]!);
    expect(refs).toHaveLength(3);
    for (const id of refs) expect(html).toContain(`id="${id}"`);
    expect(html).toContain(es["recipes.input.quantity"]);
  });
});
