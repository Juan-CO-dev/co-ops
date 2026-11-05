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
const rows: SandwichRow[] = [{ ...base, soldHere: true, toastStatus: "not_linked", marginPct: 75 },
  { ...base, id: "two", name: "Other", nameEs: "Otro", soldHere: false, toastStatus: "not_linked", marginPct: 75 }];
function mount(language: "en" | "es" = "en", canEditShop = false, canEditPrice = false, overrides: Partial<typeof rows[number]> = {}, disconnected = false) {
  const view = { rows: rows.map(row => ({ ...row, canEditPrice, ...overrides })), scope: "shop-a", totals: summarizeMenuCostRows(rows),
    globalPrices: { one: 10, two: 10 }, toastLinkedIds: ["one"], toastLinksKnown: true, notSoldHere: [], skuNames: {}, itemNames: {}, productNames: {}, toastFetchedAt: null, toastDisconnected: disconnected, toastUnavailable: disconnected, toastNotices: [] };
  return render(jsx(TranslationProvider, { initialLanguage: language, children: jsx(SandwichesClient, { view, scope: "shop-a", canEditShop }) }));
}
afterEach(cleanup);
it("hides zero-problem causes and has only one polite live count and a label-named select", () => {
  const { container } = mount("en", false, false, { toastStatus: "linked" });
  expect(screen.queryByRole("button", { name: /See causes/ })).toBeNull();
  expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(screen.getByRole("combobox", { name: "Show" }).hasAttribute("aria-label")).toBe(false);
});
it.each(["en", "es"] as const)("shop-owned copy points to the supported item page in %s", language => {
  const copy = language === "en" ? en : es;
  mount(language, true, true, { ownerLocationId: "shop-a" });
  fireEvent.click(screen.getByRole("button", { name: copy["admin.sandwiches.details"].replace("{name}", language === "en" ? "Sub" : "Sub ES") }));
  expect(screen.queryByRole("link", { name: copy["admin.sandwiches.edit_shop"] })).toBeNull();
  expect(screen.getByRole("link", { name: copy["catalog.menu.open_page"] }).getAttribute("href")).toContain("/admin/catalog/menu-item/one?location=shop-a");
  fireEvent.click(screen.getByRole("button", { name: copy["admin.sandwiches.owned_price"] }));
  expect(screen.getByText(copy["admin.sandwiches.owned_help"])).toBeTruthy();
  expect(screen.queryByText(copy["admin.sandwiches.global_help"])).toBeNull();
});
it("disconnected shop has one notice and no row missing-link problem", () => {
  mount("en", false, false, { toastStatus: "unavailable" }, true);
  expect(screen.getAllByText(en["admin.sandwiches.toast_disconnected"])).toHaveLength(1);
  expect(screen.queryByText(en["admin.menu_costing.price.unavailable"])).toBeNull();
  expect(screen.queryByRole("button", { name: /See causes/ })).toBeNull();
});
it("discloses over-target food cost, Toast amount and range inside details", () => {
  mount("en", false, false, { overThreshold: true, foodCostPct: 50, priceFlag: true, toastStatus: "price_differs", toastPriceCents: 1300, toastPriceVaries: { min: 1300, max: 1400 } });
  expect(screen.queryByText("Toast: $13.00")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Details for Sub" }));
  expect(screen.getByText("Toast: $13.00")).toBeTruthy();
  expect(screen.getByText(/Toast varies: \$13.00/).textContent).toContain("$14.00");
  expect(screen.getByText(/Food cost is 50%/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /See causes/ }));
  expect(screen.getByText("Food cost above target: 1")).toBeTruthy();
});
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
