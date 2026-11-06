// @vitest-environment jsdom
import { LocationChecklistTab } from "@/components/admin/templates/LocationChecklistTab";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { jsx } from "react/jsx-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrepParsClient } from "@/components/admin/pars/PrepParsClient";
import { ParsTabs } from "@/components/admin/pars/ParsTabs";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { PrepParsView } from "@/components/admin/pars/PrepParsClient";
import { rowToTemplateItem, type TemplateItemRow } from "@/lib/template-items";

const h = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), unlock: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: h.push }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: h.unlock }) }));
const view: PrepParsView = { canEditPars: true, subtype: "am_prep", locationId: "shop-a", name: "A", code: "A", templateId: "template-a", enabledItemIds: ["item"],
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
  expect(vendor?.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel").id);
  expect(prep?.hasAttribute("aria-controls")).toBe(false);
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

it("renders a shared item once with both list chips and sends one PATCH per save", async () => {
  const midday: PrepParsView = { ...view, subtype: "mid_day_prep", templateId: "template-mid",
    items: [{ ...view.items[0]!, id: "line-mid" }], parContext: { "line-mid": view.parContext["line-a"]! } };
  render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(PrepParsClient, { views: [view, midday], canEdit: true }) }));
  expect(screen.getAllByText("Prep item")).toHaveLength(1);
  expect(screen.getByText("AM Prep")).toBeTruthy(); expect(screen.getByText("Mid-day Prep")).toBeTruthy();
  fireEvent.click(screen.getByRole("button"));
  fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
  await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.fetch.mock.calls[0]![1].method).toBe("PATCH");
});

it("keeps unlinked lines separate with floor fallback values and Spanish labels, read-only", () => {
  const unlinked = (subtype: PrepParsView["subtype"], id: string, parValue: number): PrepParsView => ({ ...view, subtype,
    items: [rowToTemplateItem({ id, item_id: null, label: "Unlinked", translations: { es: { label: "Sin enlace" } },
      prep_meta: { parValue, parUnit: "pan" } } as TemplateItemRow)],
    parContext: { [id]: { ...view.parContext["line-a"]!, itemId: null, itemName: null, itemNameEs: null, recommendedPar: null, recommendedParUnit: null, overrides: [] } },
  });
  render(jsx(TranslationProvider, { initialLanguage: "es", children: jsx(PrepParsClient, {
    views: [unlinked("am_prep", "unlinked-am", 4), unlinked("mid_day_prep", "unlinked-mid", 6)], canEdit: true,
  }) }));
  expect(screen.getAllByText("Sin enlace")).toHaveLength(2);
  const buttons = screen.getAllByRole("button");
  expect(buttons[0]!.textContent).toContain("4 pan"); expect(buttons[1]!.textContent).toContain("6 pan");
  buttons.forEach((button) => fireEvent.click(button));
  expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getAllByText("4 pan")).toHaveLength(7); expect(screen.getAllByText("6 pan")).toHaveLength(7);
});

it.each([true, false])("checklist location passes canEditPars=%s to the real grid", canEditPars => {
  render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(LocationChecklistTab, {
    view: { ...view, canEditPars }, subtype: "am_prep", registry: [], sections: [], units: [], actorLevel: 6,
  }) }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const grid = screen.getByText("Par by day (this location)").closest("section")!;
  expect(within(grid).queryAllByRole("button", { name: "Save" })).toHaveLength(canEditPars ? 8 : 0);
  expect(within(grid).getAllByRole("combobox").every(el => (el as HTMLSelectElement).disabled)).toBe(!canEditPars);
  if (!canEditPars) expect(within(grid).getAllByRole("textbox").every(el => (el as HTMLInputElement).disabled)).toBe(true);
  expect(h.fetch).not.toHaveBeenCalled();
});
