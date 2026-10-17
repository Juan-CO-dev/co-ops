import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { adminSectionsFor } from "@/lib/admin/sections";
import { RecipesClient } from "@/components/admin/recipes/RecipesClient";
import { MenuCostingClient } from "@/components/admin/menu-costing/MenuCostingClient";
import { CatalogClient } from "@/components/admin/catalog/CatalogClient";
import AdminItemsPage from "@/app/admin/items/page";
import AdminMenuCostingPage from "@/app/admin/menu-costing/page";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import type { RoleCode } from "@/lib/roles";
vi.mock("@/lib/admin/items", () => ({ ITEMS_READ_MIN: 6, loadItemsAdminView: async () => ({}) }));
vi.mock("@/lib/admin/catalog", () => ({ loadCatalogView: async () => [] }));
vi.mock("@/lib/admin/readiness-load", () => ({ loadActiveShopsForReadiness: async () => [{ id: "shop-a", name: "Shop A" }], loadGraphReadiness: async () => ({ itemReadiness: new Map() }) }));
vi.mock("@/components/admin/items/ItemsClient", () => ({ ItemsClient: () => null }));
const pageActor = vi.hoisted(() => ({ role: "gm" as RoleCode, language: "en" as "en" | "es" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), redirect: vi.fn() }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ noteStepUpConfirmed: vi.fn(), forgetStepUp: vi.fn() }) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({ user: pageActor, locations: ["shop-a"] }) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ returns: async () => ({ data: [{ id: "shop-a", name: "Shop A" }] }) }) }) }) }) }) }));
vi.mock("@/lib/shop-context", () => ({ resolveShopId: async (_shops: string[], explicit?: string) => explicit ?? "shop-a" }));
vi.mock("@/lib/admin/menu-costing", () => ({ MENU_COSTING_READ_MIN: 6, loadMenuCostingBoard: async () => ({ rows: [], totals: {}, skuNames: {}, itemNames: {}, productNames: {}, notSoldHere: [] }) }));
vi.mock("@/components/reports-export/ExportLinks", () => ({ ExportLinks: () => null }));
vi.mock("@/lib/i18n/server", async () => {
  const { default: english } = await import("@/lib/i18n/en.json");
  const { default: spanish } = await import("@/lib/i18n/es.json");
  return { serverT: (language: string, key: keyof typeof english) => (language === "es" ? spanish : english)[key] };
});
vi.mock("@/components/ui/SummaryRow", () => ({ SummaryRow: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/admin/menu-costing/MenuPriceEditor", () => ({ MenuPriceEditor: () => null }));

describe("catalog job entries", () => {
  it.each([[7, "gm", true], [8, "moo", true], [6, "agm", false], [6, "social_media_mgr", false], [9, "social_media_mgr", false]] as const)("hub gate %s %s", (level, role, allowed) => {
    const jobs = adminSectionsFor(level, role).filter(s => s.id === "new-item" || s.id === "new-sandwich");
    expect(jobs.map(s => s.href)).toEqual(allowed ? ["/admin/catalog/new/item", "/admin/catalog/new/sandwich"] : []);
  });
  for (const language of ["en", "es"] as const) {
    for (const [shopScope, level, role] of [["shop-a", 7, "gm"], [null, 8, "moo"], [null, 7, "gm"]] as const) {
      it(`recipe entries preserve ${shopScope} for ${role} in ${language}`, () => {
        const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: createElement(RecipesClient, { recipes: [], readiness: {}, level, role: role as RoleCode, shopScope }) }));
        expect(html).toContain(`/admin/recipes/new?${shopScope === null && level < 8 ? "" : `location=${shopScope ?? "global"}&amp;`}type=production`);
        expect(html).toContain(`/admin/catalog/new/sandwich${shopScope === null && level < 8 ? "" : `?location=${shopScope ?? "global"}`}`);
        if (shopScope === null && level < 8) expect(html).not.toContain("/admin/catalog/new/sandwich?");
        expect(html).toContain("flex-wrap");
        expect(html).not.toMatch(/<a(?![^>]*min-h-\[44px\])[^>]*>/);
      });
    }
    it.each([true, false])(`costing repair respects item-page access %s in ${language}`, (canOpenSkuItem) => {
      const props = { canOpenSkuItem, scope: "shop-a", rows: [{ id: "menu", name: "Sandwich", rollup: { status: "unpriced", unpricedSkuIds: ["sku-a"], pricedLineCount: 0 }, canEditPrice: false }], totals: {}, skuNames: { "sku-a": "Item" }, itemNames: {}, productNames: {} } as unknown as Parameters<typeof MenuCostingClient>[0];
      const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: createElement(MenuCostingClient, props) }));
      expect(html).toContain(canOpenSkuItem ? '/admin/catalog/sku/sku-a?location=shop-a&amp;job=price' : '/admin/skus?sku=sku-a#sku-a');
      expect(html).not.toContain(canOpenSkuItem ? '/admin/skus?sku=' : '/admin/catalog/sku/');
    });
  }
  it("excludes SMM even with an elevated supplied level", () => {
    const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: "en", children: createElement(RecipesClient, { recipes: [], readiness: {}, level: 9, role: "social_media_mgr" }) }));
    expect(html).not.toContain('/admin/recipes/new');
    expect(html).not.toContain('/admin/catalog/new/sandwich');
  });
  for (const language of ["en", "es"] as const) {
    it.each(["inconsistent", "unweighed"] as const)(`%s repair preserves shop and item anchor (${language})`, status => {
      const props = { scope: "shop-a", rows: [{ id: "menu", name: "Sandwich", rollup: { status, inconsistentItemIds: ["prep-a"], unweighedItemIds: ["prep-a"], unpricedSkuIds: [] }, canEditPrice: false }], totals: {}, skuNames: {}, itemNames: { "prep-a": { en: "Prep", es: "Prep ES" } }, productNames: {} } as unknown as Parameters<typeof MenuCostingClient>[0];
      const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: createElement(MenuCostingClient, props) }));
      expect(html).toContain('/admin/items?view=registry&amp;location=shop-a#prep-a');
    });
    it.each([true, false])(`catalog SKU edge respects item-page access %s (${language})`, (canOpenSkuItem) => {
      const entity = { key: "item:a", id: "a", kind: "item", name: "Prep", issues: [], flags: {}, edges: { producedBy: [], skus: [{ id: "sku-a", name: "Ingredient" }], componentItems: [], usedInMenuItems: [], usedInItems: [], packages: [], checklists: [] } } as unknown as Parameters<typeof CatalogClient>[0]["entities"][number];
      const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: createElement(CatalogClient, { entities: [entity], canOpenSkuItem, actorLevel: 6, shopScope: "shop-a" }) }));
      expect(html).toContain(canOpenSkuItem ? '/admin/catalog/sku/sku-a?location=shop-a' : '/admin/skus?sku=sku-a#sku-a');
      expect(html).not.toContain(canOpenSkuItem ? '/admin/skus?sku=' : '/admin/catalog/sku/');
    });
    it.each([["gm", "global", "/admin/catalog/new/sandwich"], ["gm", "shop-a", "/admin/catalog/new/sandwich?location=shop-a"], ["moo", "global", "/admin/catalog/new/sandwich?location=global"], ["agm", "shop-a", null], ["social_media_mgr", "shop-a", null]] as const)(`costing page entry %s at %s (${language})`, async (role, location, expected) => {
      pageActor.role = role; pageActor.language = language;
      const page = await AdminMenuCostingPage({ searchParams: Promise.resolve({ location }) });
      const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: page }));
      if (expected) {
        expect(html).toContain(`href="${expected}"`);
        if (role === "gm" && location === "global") expect(html).not.toContain("/admin/catalog/new/sandwich?");
        expect(html).toContain(`+ ${(language === "es" ? es : en)["catalog.jobs.sandwich.title"]}`);
      }
      else expect(html).not.toContain('/admin/catalog/new/sandwich');
    });
  }
});

for (const [language, copy] of [["en", en], ["es", es]] as const) {
  it(`manager guide quotes shipped job labels (${language})`, () => {
    const guide = readFileSync("docs/guides/manager-guide.md", "utf8");
    for (const key of ["catalog.jobs.swap.for_now", "catalog.jobs.swap.for_good", "catalog.jobs.share.title", "catalog.jobs.back.preview", "catalog.jobs.back.confirm"] as const) {
      expect(guide).toContain(`**${copy[key]}**`);
    }
  });
}

function clientProps(node: unknown, target: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(n => clientProps(n, target)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (node.type === target) return node.props;
  return clientProps(node.props.children, target) ?? clientProps(node.props.catalog, target);
}
for (const role of ["social_media_mgr", "agm", "gm", "moo"] as const) {
  it(`server pages derive item-page capability for ${role}`, async () => {
    pageActor.role = role;
    const items = await AdminItemsPage({ searchParams: Promise.resolve({}) });
    const costing = await AdminMenuCostingPage({ searchParams: Promise.resolve({}) });
    expect(clientProps(items, CatalogClient)?.canOpenSkuItem).toBe(role !== "social_media_mgr");
    expect(clientProps(costing, MenuCostingClient)?.canOpenSkuItem).toBe(role !== "social_media_mgr");
  });
}
