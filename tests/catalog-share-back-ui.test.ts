import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { SharePreviewPanel } from "@/components/catalog/ShareWithEveryShop";
import { BackResultPanel, BackPreviewPanel, ItemJobsStrip } from "@/components/catalog/ItemJobsStrip";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn(), forgetStepUp: vi.fn() }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => vi.fn() }));
const preview = { name: "House prep", recipeId: "consumer", ownerShopId: "shop", ownerShopName: "Shop", token: "t", shopOnlyItems: [{ id: "output", name: "Output" }], shopOnlySkus: [{ id: "sku", name: "Bought input" }], makesSandwich: null, blockedBy: [{ id: "prep", name: "Pickles", kind: "item" as const, shopName: "Shop", producers: [{ id: "producer", name: "Make pickles", ownerLocationId: "shop" }] }] };
const back = { swapId: "swap", oldSku: { id: "old", name: "Original" }, newSku: { id: "new", name: "Replacement" }, shopId: "shop", shopName: "Shop", startedAt: "2026-10-16", goingBack: [{ recipeId: "recipe", recipeName: "Recipe", how: "restore" as const }], kept: [{ recipeId: "edit", recipeName: "Edited" }], primary: "changed_since" as const, token: "t" };
for (const language of ["en", "es"] as const) {
  const render = (children: ReturnType<typeof jsx>) => renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));
  const dict = language === "en" ? en : es;
  it(`renders reviewed dependencies and producing-recipe links (${language})`, () => {
    const html = render(jsx(SharePreviewPanel, { preview, selectedSkus: [], selectedItems: [], onSku: vi.fn(), onItem: vi.fn(), disabled: false }));
    expect(html).toContain("/admin/catalog/recipe/producer?location=shop");
    expect(html).toContain("Make pickles");
    expect(html).toContain(dict["catalog.jobs.share.dependencies"]);
    expect(html).not.toMatch(/<label(?![^>]*min-h-\[44px\])[^>]*>/);
    expect(html).not.toContain("catalog.jobs.");
  });
  it(`separates Back predictions from actual retained results (${language})`, () => {
    const before = render(jsx(BackPreviewPanel, { preview: back }));
    expect(before).toContain("Recipe"); expect(before).toContain("Edited");
    const after = render(jsx(BackResultPanel, { preview: back, result: { back: [], kept: ["recipe", "edit"], primary: "changed_since", grouping: "kept" } }));
    expect(after).toContain(dict["catalog.jobs.back.kept"]);
    expect(after).toContain(dict["catalog.jobs.back.outcome_changed_since"]);
    expect(after).not.toContain("changed_since");
    expect(after).toContain('role="status"');
  });
  it(`reviews the sandwich producers, both names and menu price (${language})`, () => {
    const html = render(jsx(SharePreviewPanel, { preview: { name: "Sandwich", nameEs: "Sándwich", menuItemId: "menu", price: 12,
      ownerShopId: "shop", ownerShopName: "Shop", token: "t", recipes: [{ id: "recipe", name: "Sandwich producer" }], shopOnlyItems: [], shopOnlySkus: [], blockedBy: [] },
      selectedSkus: [], selectedItems: [], onSku: vi.fn(), onItem: vi.fn(), disabled: false }));
    expect(html).toContain("Sandwich producer"); expect(html).toContain("Sándwich"); expect(html).toContain("12");
  });
  it(`shows read-only swap banner without actions for AGM (${language})`, () => {
    const html = render(jsx(ItemJobsStrip, { view: { skuId: "old", name: "Original", scope: "shop", owner: { ownerLocationId: "shop", ownerShopName: "Shop", writeScope: null, canEdit: false, canShare: false }, canSwap: false, liveSwaps: [{ swapId: "swap", oldSkuId: "old", newSkuId: "new", startedAt: "2026-10-16" }] } }));
    expect(html).toContain(dict["catalog.jobs.back.title"]);
    expect(html).not.toContain(dict["catalog.jobs.back.confirm"]);
    expect(html).not.toContain(dict["catalog.jobs.share.title"]);
    expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/);
  });
}
