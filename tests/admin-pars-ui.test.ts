// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { jsx } from "react/jsx-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParsClient } from "@/components/admin/pars/ParsClient";
import { TranslationProvider } from "@/lib/i18n/provider";
import { EMPTY_PAR_SILENCE } from "@/lib/dynamic-pars-shared";
import type { ParsRow, ParsView } from "@/lib/admin/pars-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const row = (id: string, extra: Partial<ParsRow> = {}): ParsRow => ({
  skuId: id, name: `SKU ${id}`, vendorId: "a", vendorName: "Vendor A", unit: "case", position: 1, section: "Cold",
  weekday: { value: 2, pounds: null, lane: "human" }, weekend: { value: 2, pounds: null, lane: "human" },
  weekendFallback: true, suggestion: null, reroutedFromName: null, ...extra,
});
const mount = (rows: ParsRow[], language: "en" | "es" = "en", key = "shop-a") => {
  const view: ParsView = { rows, silence: EMPTY_PAR_SILENCE };
  return render(jsx(TranslationProvider, { initialLanguage: language,
    children: jsx(ParsClient, { view }, key) }));
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Pars read-only UI", () => {
  it("filters by vendor/guide section, resets section on vendor change, and preserves guide order", () => {
    mount([row("2", { position: 2 }), row("1"), row("3", { vendorId: "b", vendorName: "Vendor B", section: "Dry" })]);
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["SKU 1", "SKU 2", "SKU 3"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Guide section" }), { target: { value: "Cold" } });
    expect(screen.queryByText("SKU 3")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Vendor" }), { target: { value: "b" } });
    expect((screen.getByRole("combobox", { name: "Guide section" }) as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("SKU 3")).toBeTruthy();
    expect(screen.queryByText("SKU 1")).toBeNull();
  });

  it("keeps details unmounted until opened, exposes suggestions without writes, and collapses again", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    mount([row("1", { reroutedFromName: "Primary SKU", suggestion: {
      currentPar: 2, suggestedPar: 3, generationId: "g", tier: "suggestion", reasonCode: "below_band_resolution",
      coverThroughDate: "2026-11-03", coveredDayCount: 2, cushionPct: 0.1, flooredByPeak: true,
      velocityApplied: true, slotCreation: false, canAct: true,
    } })]);
    const toggle = screen.getByRole("button", { name: "Details for SKU 1" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Par 2 → suggested 3")).toBeTruthy();
    expect(screen.queryByText(en["ordering.suggestion.reason_velocity"])).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Par 2 → suggested 3")).toBeTruthy();
    expect(screen.getByText("Demand routed from Primary SKU.")).toBeTruthy();
    expect(screen.getByText(en["ordering.suggestion.reason_velocity"])).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(toggle);
    expect(screen.getByText("Par 2 → suggested 3")).toBeTruthy();
    expect(screen.queryByText(en["ordering.suggestion.reason_velocity"])).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("distinguishes missing pars, zero, unknown weight and weekend fallback", () => {
    mount([row("1", { weekday: { value: null, pounds: null, lane: "none" }, weekend: { value: 0, pounds: null, lane: "global" }, weekendFallback: false }), row("2")]);
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText("0 case")).toBeTruthy();
    expect(screen.getAllByText("Weight unknown")).toHaveLength(3);
    expect(screen.queryByText("0 lb")).toBeNull();
    expect(screen.getByText("Weekend uses the weekday par.")).toBeTruthy();
  });

  it("renders translated labels and has complete paired new keys", () => {
    mount([row("1")], "es");
    expect(screen.getByRole("combobox", { name: "Proveedor" })).toBeTruthy();
    expect(screen.getAllByText("Peso desconocido")).toHaveLength(2);
    for (const key of Object.keys(en).filter((k) => k.startsWith("admin.pars.") && !k.includes(".ph."))) {
      expect((es as Record<string, string>)[key]).toBeTruthy();
    }
  });

  it("uses wrapping containers and 44px controls; jsdom does not prove browser overflow at 375px", () => {
    const { container } = mount([row("1", { name: "LongSKU".repeat(30) })]);
    expect(container.firstElementChild?.className).toContain("[overflow-wrap:anywhere]");
    for (const control of screen.getAllByRole("combobox").concat(screen.getAllByRole("button"))) {
      expect(control.className).toContain("min-h-[44px]");
    }
  });
});
