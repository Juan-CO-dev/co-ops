import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { MenuCostingClient } from "@/components/admin/menu-costing/MenuCostingClient";
import { summarizeMenuCostRows, toMenuCostRow, type MenuCostRow } from "@/lib/menu-costing-shared";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));
// Render the drawer's children to exercise the parent authorization boundary.
vi.mock("@/components/ui/SummaryRow", () => ({ SummaryRow: ({ summary, badges, children }: { summary: ReactNode; badges: ReactNode; children: ReactNode }) => createElement("div", null, summary, badges, children) }));
const row = toMenuCostRow({ id: "one", name: "Sub", nameEs: "Sub ES", section: "Subs", menuPrice: 12, typedPrice: null, priceSource: "toast", toastPriceCents: 1200 },
  { status: "costed", cost: 3, pricedCost: 3, pricedLineCount: 1, unpricedLineCount: 0, unpricedSkuIds: [], inconsistentItemIds: [], unweighedItemIds: [], retiredProductIds: [] });
function render(canEditPrice: boolean, override: Partial<MenuCostRow> = {}, language: "en" | "es" = "en") {
  const rows = [{ ...row, ...override }];
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children:
    createElement(MenuCostingClient, { rows, totals: summarizeMenuCostRows(rows), skuNames: {}, itemNames: {}, productNames: {}, canEditPrice,
      toastFetchedAt: "2026-10-01T12:00:00Z" }) }));
}
it("shows source, effective math, and cache date; lower levels have no editor", () => {
  const html = render(false);
  expect(html).toContain("from Toast"); expect(html).toContain("25.0%"); expect(html).toContain("$9.00");
  expect(html).toContain("Toast prices as of"); expect(html).not.toContain("<input");
});
it("level 8+ gets labeled money input, save and clear controls even without a recipe", () => {
  const html = render(true, { typedPrice: 15, rollup: { ...row.rollup, status: "no_recipe" } });
  expect(html).toContain('type="number"'); expect(html).toContain("Selling price"); expect(html).toContain("Use Toast price");
  expect(html).toContain("min-h-[44px]");
});
it("shows the typed mismatch badge and variation disclosure", () => {
  const html = render(false, { priceSource: "typed", priceFlag: true, toastPriceVaries: { min: 1200, max: 1300 } });
  expect(html).toContain("Toast: $12.00"); expect(html).toContain("Toast varies: $12.00"); expect(html).not.toContain("from Toast");
});
it("shows inherited names and Spanish copy", () => {
  expect(render(false, { priceSource: "same_as", sameAsName: "Sub", sameAsNameEs: "Sub ES" }, "es")).toContain("igual que Sub ES");
  expect(render(true, { typedPrice: 15 }, "es")).toContain("Usar precio de Toast");
});
it("explains included modifiers without printing a zero selling price", () => {
  const html = render(false, { menuPrice: null, includedInSubPrice: true, priceSource: null });
  expect(html).toContain("Included in the sub’s price");
});

it("offers Toast reset only for a typed non-catering price with Toast available", () => {
  expect(render(true)).not.toContain("Use Toast price");
  expect(render(true, { typedPrice: 15, cateringAvailable: true })).not.toContain("Use Toast price");
  expect(render(true, { typedPrice: 15, toastPriceCents: null })).not.toContain("Use Toast price");
  expect(render(true, { typedPrice: 15, cateringAvailable: false })).toContain("Use Toast price");
  expect(render(true, { cateringAvailable: true })).toContain("Catering uses this price");
});
it("renders muted shop notices using location names", () => {
  const html = renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children:
    createElement(MenuCostingClient, { rows: [row], totals: summarizeMenuCostRows([row]), skuNames: {}, itemNames: {}, productNames: {},
      toastNotices: [{ locationName: "Shop A", reason: "menu_missing" }, { locationName: "Shop B", reason: "unavailable" }] }) }));
  expect(html).toContain("Shop A: in-store menu not found");
  expect(html).toContain("Shop B: Toast prices unavailable");
  expect(html).toContain("text-co-text-muted");
});
