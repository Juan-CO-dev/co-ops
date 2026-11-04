// @vitest-environment jsdom
import { act } from "react";
import { SkuLocationOverlay } from "@/components/admin/skus/SkuLocationOverlay";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { jsx } from "react/jsx-runtime";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ParsClient } from "@/components/admin/pars/ParsClient";
import { TranslationProvider } from "@/lib/i18n/provider";
import { EMPTY_PAR_SILENCE, type WalkerParSuggestion } from "@/lib/dynamic-pars-shared";
import type { ParsRow, ParsView } from "@/lib/admin/pars-shared";

const h = vi.hoisted(() => ({ refresh: vi.fn(), unlock: vi.fn(), forget: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: h.unlock, forgetStepUp: h.forget }) }));
const suggestion: WalkerParSuggestion = { currentPar: 2, suggestedPar: 4, generationId: "generation", tier: "suggestion", reasonCode: "ok",
  coverThroughDate: "2026-11-05", coveredDayCount: 2, cushionPct: 0.1, flooredByPeak: false, velocityApplied: false, slotCreation: false, canAct: true };
const row = (): ParsRow => ({ skuId: "sku", name: "Fixture SKU", vendorId: "vendor", vendorName: "Fixture vendor", unit: "case", position: 1, section: null,
  weekday: { value: 2, pounds: 10, lane: "global" }, weekend: { value: 3, pounds: 15, lane: "human" }, weekendFallback: false,
  suggestion, reroutedFromName: null, edit: { activeOverride: true, weekdayPar: null, weekendPar: 3, packEpoch: 2, poundsPerUnit: 5 } });
const view = (r = row(), shadowMode = true): ParsView => ({ rows: [r], dayClass: "weekday", locationId: "shop-a", silence: { ...EMPTY_PAR_SILENCE, shadowMode } });
const tree = (v: ParsView, language: "en" | "es" = "en") => jsx(TranslationProvider, { initialLanguage: language, children: jsx(ParsClient, { view: v }) });
const open = () => fireEvent.click(screen.getByRole("button", { name: "Details for Fixture SKU" }));
const reply = (code?: string) => ({ ok: !code, json: async () => code ? { code } : { ok: true } });
beforeEach(() => { vi.clearAllMocks(); h.unlock.mockResolvedValue("ok"); h.fetch.mockResolvedValue(reply()); vi.stubGlobal("fetch", h.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("mounts controls only in the drawer, previews weight, and sends raw human expected values and the shop/pack snapshot", async () => {
  render(tree(view())); expect(screen.queryByRole("spinbutton")).toBeNull(); open();
  const weekday = screen.getByRole("spinbutton", { name: /Weekday/ });
  expect((weekday as HTMLInputElement).value).toBe("");
  fireEvent.change(weekday, { target: { value: "4" } }); expect(screen.getByText("20 lb")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
  expect(h.unlock).toHaveBeenCalledExactlyOnceWith("E");
  expect(h.fetch.mock.calls[0]![0]).toBe("/api/admin/skus/sku/location-settings");
  expect(h.fetch.mock.calls[0]![1].method).toBe("PUT");
  expect(JSON.parse(h.fetch.mock.calls[0]![1].body)).toEqual({ locationId: "shop-a", activeOverride: true, weekdayPar: 4, weekendPar: 3,
    expected: { activeOverride: true, weekdayPar: null, weekendPar: 3 }, expectedPackEpoch: 2 });
  expect(screen.getByText("Saved. Refreshing the current values.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
});

it("refreshes a conflict, replaces the stale draft with the new values, and uses the new baseline for retry", async () => {
  const mounted = render(tree(view())); open();
  fireEvent.change(screen.getByRole("spinbutton", { name: /Weekday/ }), { target: { value: "9" } });
  h.fetch.mockResolvedValueOnce(reply("overlay_changed"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("alert").textContent).toContain("Someone changed this");
  const fresh = row(); fresh.edit!.weekdayPar = 7; fresh.edit!.packEpoch = 3; fresh.weekday.value = 7;
  mounted.rerender(tree(view(fresh)));
  expect((screen.getByRole("spinbutton", { name: /Weekday/ }) as HTMLInputElement).value).toBe("7");
  fireEvent.change(screen.getByRole("spinbutton", { name: /Weekday/ }), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(h.fetch.mock.calls[1]![1].body)).toMatchObject({ weekdayPar: 8, expected: { weekdayPar: 7 }, expectedPackEpoch: 3 });
});

it("handles a canceled password prompt and forgets an expired server window", async () => {
  render(tree(view())); open(); h.unlock.mockResolvedValueOnce("cancel");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(h.unlock).toHaveBeenCalledTimes(1)); expect(h.fetch).not.toHaveBeenCalled();
  h.fetch.mockResolvedValueOnce(reply("step_up_stale")); fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(h.forget).toHaveBeenCalledTimes(1)); expect(screen.getByRole("alert")).toBeTruthy();
});

it.each(["accept", "dismiss"] as const)("%s uses the existing walk endpoint without a password, then refreshes", async (action) => {
  const r = row(); r.suggestion = { ...suggestion, tier: "auto" };
  render(tree(view(r, false))); open();
  const name = action === "accept" ? /Set the par/ : action === "dismiss" ? /Keep the par/ : /Undo|Restore|Revert/i;
  fireEvent.click(screen.getByRole("button", { name }));
  await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1)); expect(h.unlock).not.toHaveBeenCalled();
  expect(screen.getByText(action === "accept" ? "Par set to 4." : "Left at 2.")).toBeTruthy();
  expect(h.fetch.mock.calls[0]![0]).toBe("/api/operations/ordering/suggestion");
  expect(JSON.parse(h.fetch.mock.calls[0]![1].body)).toEqual({ locationId: "shop-a", skuId: "sku", dayClass: "weekday", generationId: "generation", action });
});

it("keeps shadow revert disabled and below-floor viewers completely read-only", () => {
  const r = row(); r.suggestion = { ...suggestion, tier: "auto" }; const mounted = render(tree(view(r))); open();
  expect((screen.getByRole("button", { name: /Undo|Restore|Revert/i }) as HTMLButtonElement).disabled).toBe(true);
  delete r.edit; mounted.rerender(tree(view(r)));
  expect(screen.queryByRole("spinbutton")).toBeNull(); expect(screen.queryByRole("button", { name: /Set the par/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

it("shows errors without claiming success and prevents duplicate taps while pending", async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  h.fetch.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  render(tree(view())); open(); const accept = screen.getByRole("button", { name: /Set the par/ });
  fireEvent.click(accept); fireEvent.click(accept); expect(h.fetch).toHaveBeenCalledTimes(1);
  expect((accept as HTMLButtonElement).disabled).toBe(true); resolve(reply("generic"));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy()); expect(h.refresh).not.toHaveBeenCalled();
  expect(screen.queryByText("Saved. Refreshing the current values.")).toBeNull();
});


it.each([true, false])("keeps revert disabled without applied-move evidence (shadow=%s)", (shadow) => {
  const r = row(); r.suggestion = { ...suggestion, tier: "auto" };
  render(tree(view(r, shadow))); open();
  const button = screen.getByRole("button", { name: /Undo|Restore|Revert/i });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button); expect(h.fetch).not.toHaveBeenCalled();
});

it.each(["en", "es"] as const)("uses distinct nothing-to-revert copy in %s", async (language) => {
  const dictionary = language === "en" ? en : es;
  render(tree(view(), language));
  fireEvent.click(screen.getByRole("button", { name: dictionary["admin.pars.details"].replace("{name}", "Fixture SKU") }));
  h.fetch.mockResolvedValueOnce(reply("nothing_to_revert"));
  fireEvent.click(screen.getByRole("button", { name: dictionary["admin.skus.save"] }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(dictionary["ordering.error.nothing_to_revert"]));
  expect(h.refresh).not.toHaveBeenCalled();
});

it("preserves row B typing when saving A refreshes both row objects", async () => {
  const a = row(); const b = { ...row(), skuId: "sku-b", name: "SKU B" };
  const mounted = render(tree({ ...view(a), rows: [a, b] })); open();
  fireEvent.click(screen.getByRole("button", { name: "Details for SKU B" }));
  fireEvent.change(screen.getAllByRole("spinbutton", { name: /Weekday/ })[1]!, { target: { value: "19" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
  await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
  mounted.rerender(tree({ ...view(), rows: [{ ...a, edit: { ...a.edit!, weekdayPar: 4 } }, { ...b, edit: { ...b.edit! } }] }));
  expect((screen.getAllByRole("spinbutton", { name: /Weekday/ })[1] as HTMLInputElement).value).toBe("19");
});

it("rebaselines a changed pack even when the stored par values are unchanged", () => {
  const mounted = render(tree(view())); open();
  fireEvent.change(screen.getByRole("spinbutton", { name: /Weekday/ }), { target: { value: "19" } });
  const fresh = row(); fresh.edit!.packEpoch++;
  mounted.rerender(tree(view(fresh)));
  expect((screen.getByRole("spinbutton", { name: /Weekday/ }) as HTMLInputElement).value).toBe("");
});

it.each(["save", "accept", "dismiss"] as const)("latches same-frame double %s before React commits state", async (action) => {
  render(tree(view())); open();
  const button = screen.getByRole("button", { name: action === "save" ? "Save" : action === "accept" ? /Set the par/ : /Keep the par/ });
  act(() => { button.click(); button.click(); });
  await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.unlock).toHaveBeenCalledTimes(action === "save" ? 1 : 0);
});

it.each([null, "shop-a"])("limits SKU overlay rows to the persisted owner %s", (ownerLocationId) => {
  render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(SkuLocationOverlay, {
    skuId: "sku", ownerLocationId, locations: [{ id: "shop-a", name: "Shop A" }, { id: "shop-b", name: "Shop B" }], overlays: [],
  }) }));
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("Shop A")).toBeTruthy();
  expect(screen.queryByText("Shop B") !== null).toBe(ownerLocationId === null);
  expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(ownerLocationId === null ? 2 : 1);
});
