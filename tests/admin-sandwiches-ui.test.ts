// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { jsx } from "react/jsx-runtime";
import { afterEach, expect, it, vi } from "vitest";
import { SandwichesClient } from "@/components/admin/sandwiches/SandwichesClient";
import { TranslationProvider } from "@/lib/i18n/provider";
import { summarizeMenuCostRows, toMenuCostRow } from "@/lib/menu-costing-shared";
import type { SandwichRow } from "@/lib/admin/sandwiches-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn(), forgetStepUp: vi.fn() }) }));
const base = toMenuCostRow({ id: "one", name: "Sub", nameEs: "Sub ES", section: null, menuPrice: 12, typedPrice: 12 },
  { status: "costed", cost: 3, pricedCost: 3, pricedLineCount: 1, unpricedLineCount: 0, unpricedSkuIds: [], inconsistentItemIds: [], unweighedItemIds: [], retiredProductIds: [] });
const rows: SandwichRow[] = [{ ...base, soldHere: true, toastStatus: "linked", marginPct: 75 },
  { ...base, id: "two", name: "Other", nameEs: "Otro", soldHere: false, toastStatus: "not_linked", marginPct: 75 }];
function mount(language: "en" | "es" = "en", canEditShop = false, canEditPrice = false) {
  const view = { rows: rows.map(row => ({ ...row, canEditPrice })), scope: "shop-a", totals: summarizeMenuCostRows(rows),
    globalPrices: { one: 10, two: 10 }, toastLinkedIds: ["one"], toastLinksKnown: true, notSoldHere: [], skuNames: {}, itemNames: {}, productNames: {}, toastFetchedAt: null, toastUnavailable: false, toastNotices: [] };
  return render(jsx(TranslationProvider, { initialLanguage: language, children: jsx(SandwichesClient, { view, scope: "shop-a", canEditShop }) }));
}
afterEach(cleanup);
it.each(["en", "es"] as const)("renders numbers, filters, and collapsed causes/details in %s", language => {
  const copy = language === "en" ? en : es;
  mount(language);
  expect(screen.getByText("$12.00")).toBeTruthy();
  expect(screen.getByText("$3.00")).toBeTruthy();
  expect(screen.getByText("$9.00")).toBeTruthy();
  expect(screen.getByText(/75\s*%/)).toBeTruthy();
  const causes = screen.getByRole("button", { name: new RegExp(copy["admin.sandwiches.causes"]) });
  expect(causes.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText(copy["admin.sandwiches.problem.not_linked"].replace("{n}", "1"))).toBeNull();
  fireEvent.click(causes);
  expect(screen.getByText(copy["admin.sandwiches.problem.not_linked"].replace("{n}", "1"))).toBeTruthy();
  fireEvent.click(causes);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "off" } });
  expect(screen.getByRole("heading").textContent).toBe(language === "en" ? "Other" : "Otro");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "all" } });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sub es" } });
  expect(screen.getAllByRole("heading")).toHaveLength(1);
  const details = screen.getByRole("button", { name: copy["admin.sandwiches.details"].replace("{name}", language === "en" ? "Sub" : "Sub ES") });
  expect(details.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(details);
  expect(screen.getByRole("link", { name: copy["catalog.menu.open_page"] }).getAttribute("href")).toBe("/admin/catalog/menu-item/one?location=shop-a");
  expect(screen.queryByRole("spinbutton")).toBeNull();
});
it("links shop edits and mounts unchanged global editor with the STORED global baseline, not shop price", () => {
  mount("en", true, true);
  fireEvent.click(screen.getByRole("button", { name: "Details for Sub" }));
  expect(screen.getByRole("link", { name: en["admin.sandwiches.edit_shop"] }).getAttribute("href")).toContain("location=shop-a");
  expect(screen.queryByRole("spinbutton")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en["admin.sandwiches.global_price"] }));
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("10.00");
});
it("has paired translation keys/placeholders and 44px wrapping controls (not a browser overflow proof)", () => {
  const keys = (dict: Record<string, string>) => Object.keys(dict).filter(key => key.startsWith("admin.sandwiches.")).sort();
  expect(keys(en)).toEqual(keys(es));
  for (const key of keys(en)) {
    const params = (dict: Record<string, string>) => [...dict[key]!.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    expect(params(en)).toEqual(params(es));
    expect((es as Record<string, string>)[key]).not.toContain("?");
  }
  const { container } = mount();
  expect(container.firstElementChild?.className).toContain("[overflow-wrap:anywhere]");
  for (const control of [screen.getByRole("combobox"), screen.getByRole("searchbox"), ...screen.getAllByRole("button")]) expect(control.className).toContain("min-h-[44px]");
});
