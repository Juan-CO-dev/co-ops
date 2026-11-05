// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jsx } from "react/jsx-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrepParsClient } from "@/components/admin/pars/PrepParsClient";
import { ParsTabs } from "@/components/admin/pars/ParsTabs";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { ChecklistLocationView } from "@/lib/admin/templates";
import { rowToTemplateItem, type TemplateItemRow } from "@/lib/template-items";

const h = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), unlock: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: h.push }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: h.unlock }) }));
const view: ChecklistLocationView = { locationId: "shop-a", name: "A", code: "A", templateId: "template-a", enabledItemIds: ["item"],
  items: [rowToTemplateItem({ id: "line-a", item_id: "item", label: "Fallback", prep_meta: null } as TemplateItemRow)],
  parContext: { "line-a": { itemId: "item", itemGlobal: true, itemName: "Prep item", itemNameEs: "Preparado", recommendedPar: 5, recommendedParUnit: "pan",
    overrides: [{ dayOfWeek: null, parValue: 7, parUnit: null, parMode: "manual" }, { dayOfWeek: 1, parValue: 9, parUnit: null, parMode: "manual" }] } },
};
const tree = (canEdit: boolean) => jsx(TranslationProvider, { initialLanguage: "en", children: jsx(PrepParsClient, { views: [view], canEdit }) });
beforeEach(() => { vi.clearAllMocks(); h.unlock.mockResolvedValue("ok"); h.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }); vi.stubGlobal("fetch", h.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("summarizes base/day/unit and mounts the real ParGrid writer only inside the drawer", async () => {
  render(tree(true));
  expect(screen.getByRole("button").textContent).toContain("7 pan");
  expect(screen.getByRole("button").textContent).toContain("9");
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button"));
  fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
  await waitFor(() => expect(h.fetch).toHaveBeenCalled());
  expect(h.fetch.mock.calls[0]![0]).toBe("/api/admin/checklist-templates/template-a/items/line-a/par");
  expect(h.fetch.mock.calls[0]![1].method).toBe("PATCH");
  expect(JSON.parse(h.fetch.mock.calls[0]![1].body)).toMatchObject({ locationId: "shop-a", parValue: 7 });
  expect(h.unlock).toHaveBeenCalledWith("A");
  expect(h.refresh).toHaveBeenCalled();
});
it("offers no edit controls to a below-floor viewer", () => {
  render(tree(false)); fireEvent.click(screen.getByRole("button"));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});
it("uses URL selection and supports arrow/Home/End keyboard navigation", () => {
  render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(ParsTabs, { tab: "vendor", locationId: "shop-a", children: "panel" }) }));
  const [vendor, prep] = screen.getAllByRole("tab");
  expect(vendor?.getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(vendor!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(prep);
  expect(h.push).toHaveBeenLastCalledWith("/admin/pars?location=shop-a&tab=prep", { scroll: false });
  fireEvent.keyDown(prep!, { key: "Home" });
  expect(h.push).toHaveBeenLastCalledWith("/admin/pars?location=shop-a", { scroll: false });
  fireEvent.click(prep!);
  expect(h.push).toHaveBeenLastCalledWith("/admin/pars?location=shop-a&tab=prep", { scroll: false });
});

it("an explicit per-day inherit uses the recommendation instead of the manual base", () => {
  const ctx = view.parContext["line-a"]!;
  const overridden = { ...view, parContext: { "line-a": { ...ctx, overrides: [...ctx.overrides, { dayOfWeek: 2, parMode: "inherit" as const, parValue: null, parUnit: null }] } } };
  render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(PrepParsClient, { views: [overridden], canEdit: false }) }));
  fireEvent.click(screen.getByRole("button"));
  const tuesday = screen.getByText("Tue");
  expect(tuesday.parentElement?.textContent).toContain("5 pan");
});
