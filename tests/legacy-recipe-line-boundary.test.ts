/**
 * Catalog Phase 3b (plan Task 11) — the legacy builder's LINE writes are the global default's (MoO+); a GM is
 * told, in the lib and on the page, to edit its shop's version; outputs keep their floor; every way in
 * (the legacy page, its line list, the recipe and item readiness lists at a shop, the costing drawer) leads to
 * the new pages, and a shop-scoped warning opens THAT shop's view.
 */
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("no database expected"); } }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn(), requestStepUpGrant: vi.fn(), forgetStepUp: vi.fn(), noteStepUpConfirmed: vi.fn() }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => async () => ({ ok: true, data: {} }) }));
// Render the costing drawer's children (collapsed by default on the real page).
vi.mock("@/components/ui/SummaryRow", () => ({ SummaryRow: ({ summary, badges, children }: { summary: ReactNode; badges: ReactNode; children: ReactNode }) => createElement("div", null, summary, badges, children) }));

import { addRecipeInput, removeRecipeEdge, updateRecipeInput } from "@/lib/recipes";
import { readinessRecipeHref } from "@/lib/catalog/recipe-item-shared";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const { RecipeBuilder } = await import("@/components/admin/recipes/RecipeBuilder");
const { RecipesClient } = await import("@/components/admin/recipes/RecipesClient");
const { MenuCostingClient } = await import("@/components/admin/menu-costing/MenuCostingClient");
const { summarizeMenuCostRows, toMenuCostRow } = await import("@/lib/menu-costing-shared");

const gm = { user: { id: "u", role: "gm" } } as never;
const agm = { user: { id: "u", role: "agm" } } as never;
const smm = { user: { id: "u", role: "social_media_mgr" } } as never;
const line = { componentSkuId: "s", componentItemId: null, componentProductId: null, quantity: 1, unit: "oz", eachContainerLabel: null, portioned: false };

const RID = "7d0c1f2e-0000-4000-8000-000000000001";
const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const html_ = (s: string) => s.replace(/'/g, "&#x27;");
const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));

describe("a GM never edits the global recipe's lines (lib, before any I/O)", () => {
  it("add, update and remove of a LINE refuse a GM by name", async () => {
    await expect(addRecipeInput(gm, { recipeId: "r", componentSkuId: "s", quantity: 1, unit: "oz" })).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
    await expect(updateRecipeInput(gm, { recipeId: "r", inputId: "i", line: { ...line, quantity: 2 }, expected: line })).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
    await expect(removeRecipeEdge(gm, { table: "recipe_inputs", id: "i" })).rejects.toMatchObject({ status: 403, code: "global_requires_moo" });
  });
  it("below GM it stays the plain forbidden (the social media manager included)", async () => {
    await expect(addRecipeInput(agm, { recipeId: "r", componentSkuId: "s", quantity: 1, unit: "oz" })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(removeRecipeEdge(smm, { table: "recipe_inputs", id: "i" })).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
  it("an OUTPUT removal keeps its GM floor (it reaches the database)", async () => {
    await expect(removeRecipeEdge(gm, { table: "recipe_outputs", id: "o" })).rejects.toThrow("no database expected");
  });
  it("the builder names the reason, en + es", () => {
    expect(readFileSync("components/admin/recipes/shared.ts", "utf8")).toContain('"global_requires_moo"');
    expect(en["recipes.error.global_requires_moo"]).toMatch(/Director of Operations/);
    expect(es["recipes.error.global_requires_moo"]).toMatch(/Director de Operaciones/);
  });
});

// ── The legacy builder: lines read-only for a GM, with the way forward ───────────────────────────────────────
const recipe = {
  id: RID, name: "Italian", nameEs: null, recipeType: "consumer" as const, batchYield: 1, directions: null, directionsEs: null,
  active: true, batchMode: false, shelfLifeDays: 5, outputs: [],
  inputs: [{ id: "ri-1", componentSkuId: "sku-ham", componentItemId: null, componentProductId: null, componentName: "Ham", kind: "sku", componentRetired: false, quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false }],
} as never;
const builder = (level: number, language: Language = "en", r: unknown = recipe) => render(createElement(RecipeBuilder, {
  recipe: r as never, skus: [], items: [], products: [], unitOptions: [], measures: new Map(), activeMeasureLabels: [], level,
}), language);

describe("the legacy builder — a GM's way to change the lines is its shop's version", () => {
  it("a GM sees the lines read-only, the plain sentence and a link to the shop-version page", () => {
    const html = builder(7);
    expect(html).toContain("Ham");
    expect(html).not.toContain(en["recipes.builder.add_ingredient"]);
    expect(html).not.toContain(html_(en["recipes.row.edit"]));
    expect(html).toContain(html_(en["recipes.builder.lines_global_only"]));
    expect(html).toContain(`href="/admin/catalog/recipe/${RID}"`);
    expect(html).toContain(html_(en["recipes.builder.lines_change_shop"]));
  });
  it("in Spanish too", () => {
    const html = builder(7, "es");
    expect(html).toContain(html_(es["recipes.builder.lines_global_only"]));
    expect(html).toContain(html_(es["recipes.builder.lines_change_shop"]));
  });
  it("the Director of Operations still edits the global lines here, with no redirect sentence", () => {
    const html = builder(8);
    expect(html).toContain(en["recipes.builder.add_ingredient"]);
    expect(html).not.toContain(html_(en["recipes.builder.lines_global_only"]));
  });
  it("creating a NEW recipe keeps its GM floor: a GM adds lines to the draft", () => {
    const html = builder(7, "en", null);
    expect(html).toContain(en["recipes.builder.add_ingredient"]);
    expect(html).not.toContain(html_(en["recipes.builder.lines_global_only"]));
  });
  it("the sentence's link carries the 44px floor", () => {
    const html = builder(7);
    const link = html.match(/<a [^>]*href="\/admin\/catalog\/recipe\/[^"]*"[^>]*>/g) ?? [];
    expect(link.length).toBeGreaterThan(0);
    for (const a of link) { expect(a).toContain("min-h-[44px]"); expect(a).toContain("items-center"); }
  });
});

describe("the legacy recipe page points at the shop-version page", () => {
  it("a banner with the catalog link, en + es", () => {
    const page = readFileSync("app/admin/recipes/[id]/page.tsx", "utf8");
    expect(page).toContain("recipeItemHref(recipe.id)");
    expect(page).toContain('serverT(lang, "recipes.catalog_link")');
    expect(page).toContain('serverT(lang, "recipes.catalog_link_hint")');
    expect(page).not.toMatch(/"EM"|"MEP"/);
  });
});

// ── Shop item warnings deep-link to the shop's view ─────────────────────────────────────────────────────────────
describe("a readiness warning at a shop opens that shop's view", () => {
  it("readinessRecipeHref: a shop scope → the catalog page for that shop; the default → the builder", () => {
    expect(readinessRecipeHref(RID, SHOP)).toBe(`/admin/catalog/recipe/${RID}?location=${SHOP}`);
    expect(readinessRecipeHref(RID, null)).toBe(`/admin/recipes/${RID}`);
  });
  const rows = [{ id: RID, name: "Italian", recipeType: "consumer" as const, active: true, outputNames: [], hasInputs: true, hasOutputs: true, batchYield: 1, batchMode: false }];
  const readiness = { [RID]: { status: "incomplete", reasons: [] } } as never;
  it("/admin/recipes?location=<shop>: each row opens the shop's version", () => {
    const html = render(createElement(RecipesClient, { recipes: rows, level: 7, readiness, shopScope: SHOP }));
    expect(html).toContain(`href="/admin/catalog/recipe/${RID}?location=${SHOP}"`);
    expect(html).not.toContain(`href="/admin/recipes/${RID}"`);
  });
  it("/admin/recipes (the default): rows keep the builder", () => {
    const html = render(createElement(RecipesClient, { recipes: rows, level: 7, readiness, shopScope: null }));
    expect(html).toContain(`href="/admin/recipes/${RID}"`);
  });
  it("/admin/items?location=<shop>: a flagged item's recipe link opens that shop's version; the default keeps the builder", async () => {
    const { ItemRow } = await import("@/components/admin/items/ItemRow");
    const item = {
      itemId: "prep-ham", name: "Ham", nameEs: "Jamón", section: null, recommendedPar: null, recommendedParUnit: null, isDefault: false,
      specialInstruction: null, specialInstructionEs: null, required: false, minRoleLevel: null, openingVerify: true, trackingType: "portioned",
      batchYield: 1, ozPerParUnit: null, menuPrice: null, soldDirectly: false, sellPortion: null, sellPortionUnit: null,
    } as never;
    const props = { item, actorLevel: 7, sections: [], units: [], language: "en", itemQuestions: [], readiness: { status: "incomplete", reasons: [] } as never, producingRecipeId: RID, madeFrom: [] };
    expect(render(createElement(ItemRow, { ...props, shopScope: SHOP }))).toContain(`href="/admin/catalog/recipe/${RID}?location=${SHOP}"`);
    expect(render(createElement(ItemRow, { ...props, shopScope: null }))).toContain(`href="/admin/recipes/${RID}"`);
  });
  it("the pages pass the scope they resolved through the shop-context getter", () => {
    expect(readFileSync("app/admin/recipes/page.tsx", "utf8")).toContain("shopScope={scope}");
    expect(readFileSync("app/admin/items/page.tsx", "utf8")).toContain("shopScope={scope}");
    expect(readFileSync("components/admin/items/ItemsClient.tsx", "utf8")).toContain("shopScope={shopScope}");
    const row = readFileSync("components/admin/items/ItemRow.tsx", "utf8");
    expect(row).toContain("href={readinessRecipeHref(producingRecipeId, shopScope)}");
    expect(row).not.toContain("href={`/admin/recipes/${producingRecipeId}`}");
  });
});

// ── The costing board opens the sandwich page for the board's shop ──────────────────────────────────────────────
describe("the costing drawer opens the menu item page", () => {
  const row = toMenuCostRow({ id: "m1", name: "Italian", nameEs: "Italiano", section: "Subs", menuPrice: 12, typedPrice: null, priceSource: "toast", toastPriceCents: 1200 },
    { status: "costed", cost: 3, pricedCost: 3, pricedLineCount: 1, unpricedLineCount: 0, unpricedSkuIds: [], inconsistentItemIds: [], unweighedItemIds: [], retiredProductIds: [] });
  const board = (scope: string | null, language: Language = "en") => render(createElement(MenuCostingClient, {
    rows: [row], totals: summarizeMenuCostRows([row]), skuNames: {}, itemNames: {}, productNames: {}, scope,
  }), language);
  it("a shop's board → that shop's view of the item", () => {
    const html = board(SHOP);
    expect(html).toContain(`href="/admin/catalog/menu-item/m1?location=${SHOP}"`);
    expect(html).toContain(en["catalog.menu.open_page"]);
  });
  it("the all-shops board → the global menu", () => {
    expect(board(null)).toContain(`href="/admin/catalog/menu-item/m1?location=global"`);
    expect(board(null, "es")).toContain(es["catalog.menu.open_page"]);
  });
  it("the page passes its scope", () => {
    expect(readFileSync("app/admin/menu-costing/page.tsx", "utf8")).toContain("scope={scope}");
  });
});

// ── The manager guide sends a GM to the shop-version pages (Task 12; Astra full-branch P3) ─────────────────────
describe("the manager guide matches what was built, en + es", () => {
  const guide = readFileSync("docs/guides/manager-guide.md", "utf8");
  it("no longer sends a GM to the legacy line editor", () => {
    expect(guide).not.toContain("In **Consumes (inputs)**, tap **Edit**");
    expect(guide).not.toContain("En **Consume (entradas)**, toca **Editar**");
  });
  it("names the real buttons, in both languages", () => {
    const named = (s: string) => `**${s.replace(/\{[a-z]+\}/g, "").trim()}`;
    for (const k of ["recipes.catalog_link", "recipes.builder.lines_change_shop", "catalog.recipe.see_changes", "catalog.recipe.back_to_default",
      "catalog.recipe.section.others", "catalog.recipe.edit_rebase", "catalog.recipe.preview_again", "catalog.recipe.notice.take_update",
      "catalog.recipe.notice.keep_mine", "catalog.recipe.notice.got_it", "catalog.recipe.notice.open", "catalog.menu.open_page", "catalog.menu.back_to_default",
      "catalog.changes.promote", "catalog.changes.leave", "catalog.menu.promote.name_es_field", "admin.section.shop-changes", "admin.section.recipe-notices"] as const) {
      expect(guide, k).toContain(named(en[k]));
      expect(guide, `${k} (es)`).toContain(named(es[k]));
    }
  });
});
