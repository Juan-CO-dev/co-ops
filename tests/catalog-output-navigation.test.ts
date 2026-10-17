import { expect, it, vi } from "vitest";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => actual.useState(initial && typeof initial === "object" && "makes" in initial ? { ...initial, makes: true } : initial) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: async () => "ok" }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => vi.fn() }));
import { RecipeItemClient } from "@/components/catalog/RecipeItemClient";
import type { RecipeItemView as View } from "@/lib/catalog/recipe-item-shared";
const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const OTHER = "6f1d2c3e-0000-4000-8000-00000000000b";
const turkey = { componentSkuId: "sku-t", componentItemId: null, componentProductId: null, quantity: 5, unit: "oz", eachContainerLabel: null, portioned: false };
const mayo = { componentSkuId: null, componentItemId: null, componentProductId: "p-mayo", quantity: 1, unit: "each", eachContainerLabel: null, portioned: false };

const RECIPE = "7d0c1f2e-0000-4000-8000-000000000001";
const view: View = {
  recipe: { id: RECIPE, name: "Italian", nameEs: "Italiano", recipeType: "consumer", active: true },
  shops: [{ id: SHOP, name: "P Street" }, { id: OTHER, name: "Capitol Hill" }],
  scope: SHOP, scopeName: "P Street",
  can: { editShop: true, editGlobal: false, shopsToEdit: [{ id: SHOP, name: "P Street" }] },
  version: { scopeVersionId: "sv", globalVersionId: "gv", ridesDefault: false, adoptedFromShopName: null, validFrom: "2026-10-10T00:00:00Z" },
  lines: [
    { lineId: "l1", lineage: [], fields: turkey, name: "Turkey", kind: "sku", vendorName: "Baldor", changedHere: true, problem: null },
    { lineId: "l2", lineage: [], fields: mayo, name: "Mayo", kind: "product", vendorName: null, changedHere: false, problem: "product_line_needs_measure_unit" },
  ],
  differsFromDefault: [{ kind: "changed", key: "sku:sku-t", before: { ...turkey, quantity: 4 }, after: turkey }],
  makes: [{ kind: "menu_item", id: "m1", name: "Italian", nameEs: "Italiano", yield: 1, costHere: 2.5 }],
  usedIn: [],
  vendors: ["Baldor"],
  otherShopVersions: [{ versionId: "ov", shopId: OTHER, shopName: "Capitol Hill", validFrom: "2026-10-11T00:00:00Z", createdByName: "Luis", changes: [] }],
  notices: [{ kind: "new_default", recipeId: RECIPE, recipeName: "Italian", seenVersionId: "gv", fromShopName: "Capitol Hill", at: "2026-10-12T00:00:00Z" }],
  history: [
    { id: "sv", scope: "shop", shopId: SHOP, shopName: "P Street", active: true, validFrom: "2026-10-10T00:00:00Z", validTo: null, who: "Ana", note: null, lineCount: 2, promotedFromShopName: null, adoptedFromShopName: null, linkEndedFromShopName: null },
    { id: "sv0", scope: "shop", shopId: SHOP, shopName: "P Street", active: false, validFrom: "2026-10-05T00:00:00Z", validTo: "2026-10-10T00:00:00Z", who: "Ana", note: null, lineCount: 2, promotedFromShopName: null, adoptedFromShopName: null, linkEndedFromShopName: "Capitol Hill" },
    { id: "g0", scope: "global", shopId: null, shopName: null, active: false, validFrom: "2000-01-01T00:00:00Z", validTo: "2026-10-01T00:00:00Z", who: null, note: "0262 baseline", lineCount: 1, promotedFromShopName: null, adoptedFromShopName: null, linkEndedFromShopName: null },
  ],
  names: { "sku:sku-t": "Turkey", "product:p-mayo": "Mayo" },
  picker: { skus: [], items: [], products: [], measures: [{ label: "oz", dimension: "weight", toBaseFactor: 1 }], activeMeasureLabels: ["oz"] },
};

it.each(["en", "es"] as const)("outputs link only exists in a writable scope (%s)", language => {
  const render = (value: View) => renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: jsx(RecipeItemClient, { view: value }) }));
  expect(render(view)).toContain(`/admin/recipes/${RECIPE}?location=${SHOP}`);
  const foreign = render({ ...view, scope: OTHER, can: { ...view.can, editShop: false } });
  expect(foreign).not.toContain(`/admin/recipes/${RECIPE}`);
  const dict = language === "en" ? en : es;
  expect(foreign).toContain(dict["catalog.recipe.view_only"]);
  expect(render({ ...view, scope: null, can: { ...view.can, editShop: false, editGlobal: true } })).toContain(`/admin/recipes/${RECIPE}?location=global`);
});
