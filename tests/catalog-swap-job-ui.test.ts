import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { PublicSwapPreview } from "@/lib/catalog/job-preview-shared";
import type { SwapVendorJobView } from "@/lib/catalog/jobs-shared";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn(), forgetStepUp: vi.fn() }) }));
const { SwapVendorJob, SwapConsequences } = await import("@/components/catalog/jobs/SwapVendorJob");
const view = { scope: null, shops: [{ id: "shop", name: "Shop one" }], allowGlobal: true, jobs: { skuId: "old", name: "Original", canSwap: true, owner: { ownerLocationId: null, ownerShopName: null, writeScope: null, canEdit: true, canShare: false } }, replacements: [{ id: "new", name: "Replacement", vendorName: "Vendor" }] } as SwapVendorJobView;
const preview = { request: { mode: "for_good" }, oldSku: { name: "Original" }, newSku: { name: "Replacement" }, scopeName: "Shop one", product: { kind: "create", name: "Tomatoes" },
  recipes: [{ recipeId: "r", recipeName: "Sauce", changes: [{ position: 2, before: { quantity: 1, unit: "jar" }, after: { quantity: 32, unit: "oz" }, converted: true }] }],
  refused: [{ recipeId: "r2", recipeName: "Dressing", position: 3, reason: "unit_unknown" }], followsPrimary: [{ id: "r3", name: "Primary follower" }], untouchedShops: [{ id: "s2", name: "Other shop" }],
  ordering: { messageKey: "catalog.swap.ordering_consequence" }, costs: [{ menuItemId: "m", name: "Sandwich", nameEs: "Sándwich", before: 1.25, after: 2.5 }], token: "hash" } as PublicSwapPreview;
describe("swap render", () => {
  for (const language of ["en", "es"] as const) {
    it(`renders all review consequences (${language})`, () => {
      const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: jsx(SwapConsequences, { preview }) }));
      for (const text of ["Sauce", "Dressing", "Primary follower", "Other shop", "1 jar", "32 oz", "1.25", "2.50", "Tomatoes"]) expect(html).toContain(text);
      expect(html).not.toContain("catalog.jobs.swap."); expect(html).not.toContain("catalog.swap.ordering_consequence");
      expect(html).toContain("break-words");
    });
    it(`global creation has permanent only and scope-preserving new item link (${language})`, () => {
      const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: jsx(SwapVendorJob, { view, replacementId: "new" }) }));
      expect(html).not.toContain('value="for_now"'); expect(html).toContain('value="for_good"');
      expect(html).toContain('/admin/catalog/new/item?location=global&amp;swapFrom=old');
      expect(html).not.toMatch(/<(?:button|input|select)(?![^>]*min-h-\[44px\])[^>]*>/);
      expect(html).toContain("flex-col"); expect(html).not.toContain("catalog.jobs.swap.");
    });
    it(`an owned source only offers its owner scope (${language})`, () => {
      const owned = { ...view, scope: "shop", shops: [{ id: "shop", name: "Owner shop" }, { id: "other", name: "Other shop" }], jobs: { ...view.jobs, owner: { ownerLocationId: "shop", ownerShopName: "Owner shop", writeScope: null, canEdit: true, canShare: true } } };
      const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: jsx(SwapVendorJob, { view: owned }) }));
      const select = html.match(/<select[^>]*data-testid="scope"[^>]*>(.*?)<\/select>/)?.[1];
      expect(select).toBeDefined();
      expect(select).toContain('value="shop"');
      expect(select).not.toContain('value="other"');
      expect(select).not.toContain('value="global"');
    });
    it(`offers the temporary choice only at a shop (${language})`, () => {
      const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: jsx(SwapVendorJob, { view: { ...view, scope: "shop", allowGlobal: false } }) }));
      expect(html).toContain('value="for_now"'); expect(html).toContain('value="for_good"');
      expect(html).not.toContain('<option value="global"');
    });
  }
});
