import { createElement, type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import { RegistryRelationships } from "@/components/admin/RegistryRelationships";
import { ItemRow } from "@/components/admin/items/ItemRow";
import { ProductsClient } from "@/components/admin/products/ProductsClient";
import { ItemsPageTabs } from "@/components/admin/catalog/ItemsPageTabs";
import type { ProductView } from "@/lib/products";
import type { ChecklistRegistryItem } from "@/lib/admin/templates";
import type { RegistryLink } from "@/lib/admin/product-item-links-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));
function render(children: ReactNode, language: Language = "en") {
  return renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));
}
const productLink: RegistryLink = { kind: "product", id: "ham", name: "Ham", nameEs: "Jamón", vendorName: null };
const itemLink: RegistryLink = { ...productLink, kind: "item", id: "prep-ham" };
const skuLink: RegistryLink = { kind: "sku", id: "bacon", name: "Bacon", nameEs: null, vendorName: "Supplier" };
const product: ProductView = {
  id: "ham", name: "Ham", nameEs: "Jamón", notes: null, unitOz: 16, unitOzClass: null,
  unitOzSourceNote: null, unitOzEstablishedAt: null, unitOzEstablishedBy: null,
  active: true, members: [], primaries: [], globalPrimarySkuId: null,
  unresolved: false, membersDisagree: false, pinnedRecipes: [],
};
const item: ChecklistRegistryItem = {
  itemId: "prep-ham", name: "Ham", nameEs: "Jamón", section: null, recommendedPar: null,
  recommendedParUnit: null, isDefault: false, specialInstruction: null, specialInstructionEs: null,
  required: false, minRoleLevel: null, openingVerify: true, trackingType: "portioned",
  batchYield: 1, ozPerParUnit: null, menuPrice: null, soldDirectly: false, sellPortion: null, sellPortionUnit: null,
};

describe("registry relationship rendering", () => {
  it("shows the prep kind and made-from links on the closed item row with its stable anchor", () => {
    const html = render(createElement(ItemRow, { item, actorLevel: 6, sections: [], units: [], language: "en",
      itemQuestions: [], readiness: null, producingRecipeId: "recipe", madeFrom: [productLink, skuLink, itemLink] }));
    expect(html).toContain('id="prep-ham"');
    expect(html).toContain("Prep item");
    expect(html).toContain("Made from:");
    expect(html).toContain('href="/admin/products?product=ham#ham"');
    expect(html).toContain('href="/admin/skus#bacon"');
    expect(html).toContain("Bacon · Supplier");
    expect(html).toContain("(sub-prep)");
    expect(html).toContain('href="/admin/recipes/recipe"');
    for (const anchor of html.matchAll(/<a\b[^>]*href="\/admin\/(?:products|skus|items)[^"]*"[^>]*>/g)) {
      expect(anchor[0]).toContain("min-h-[44px]");
      expect(anchor[0]).toContain("items-center");
    }
  });
  it("reveals a linked product even when the attention group normally collapses the rest", () => {
    const props = { products: [{ ...product, id: "attention", unresolved: true }, product], skus: [], locations: [],
      actorLevel: 6, usedInByProduct: { ham: [itemLink] } };
    expect(render(createElement(ProductsClient, props))).not.toContain('id="ham"');
    const html = render(createElement(ProductsClient, { ...props, targetProductId: "ham" }));
    expect(html).toContain('id="ham"');
    expect(html).toContain("Purchased product");
    expect(html).toContain("Used in:");
    expect(html).toContain('href="/admin/items?view=registry#prep-ham"');
  });
  it("server-renders the registry tab on linked arrivals, retaining the catalog default", () => {
    const props = { catalog: "CATALOG_CONTENT", registry: createElement("div", { id: "prep-ham" }, "REGISTRY_CONTENT") };
    expect(render(createElement(ItemsPageTabs, props))).not.toContain('id="prep-ham"');
    expect(render(createElement(ItemsPageTabs, { ...props, initialView: "registry" }))).toContain('id="prep-ham"');
  });
  it("omits empty relationship lines while retaining the kind label", () => {
    const html = render(createElement(RegistryRelationships, { kind: "item", links: [] }));
    expect(html).toContain("Prep item");
    expect(html).not.toContain("Made from:");
    expect(html).not.toContain("<a ");
  });
  it("renders Spanish labels and names with an English name fallback", () => {
    const html = render(createElement(RegistryRelationships, { kind: "item", links: [productLink, skuLink] }), "es");
    expect(html).toContain("Artículo de preparación");
    expect(html).toContain("Se prepara con:");
    expect(html).toContain("Jamón");
    expect(html).toContain("Bacon · Supplier");
    const used = render(createElement(RegistryRelationships, { kind: "product", links: [itemLink] }), "es");
    expect(used).toContain("Producto comprado");
    expect(used).toContain("Se usa en:");
  });
  it("keeps all added copy in both dictionaries", () => {
    const keys = Object.keys(en).filter(k => k.startsWith("admin.relationships.") || k === "admin.products.explainer");
    expect(keys).toHaveLength(6);
    for (const key of keys) {
      expect(en[key as keyof typeof en]).toBeTruthy();
      expect(es[key as keyof typeof es]).toBeTruthy();
    }
  });
});
