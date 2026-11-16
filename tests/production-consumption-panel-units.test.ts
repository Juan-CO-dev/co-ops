// @vitest-environment jsdom
/**
 * W16/B097 — a Case⇄Each switch is a VIEW change: the saved ounces never come back from a rounded display
 * number. Before the fix a 200-oz case turned 1 oz into 0.005 case → 0.01 → 2 oz saved.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { jsx } from "react/jsx-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { ProductionConsumptionPanel } from "@/components/production/ProductionConsumptionPanel";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { ConfirmedInput, DerivedSku } from "@/lib/prep-consumption";
import en from "@/lib/i18n/en.json";

const derived: DerivedSku[] = [{ skuId: "s", skuName: "Sauce", perUnitOz: 1, unitsPerPack: 200, contentOz: 200 }];

function mount(outputQty: number) {
  const emitted: ConfirmedInput[][] = [];
  function Harness() {
    const [value, setValue] = useState<ConfirmedInput[] | null>(null);
    return jsx(ProductionConsumptionPanel, {
      derived, outputQty, value, canEdit: true,
      onChange: (rows: ConfirmedInput[]) => { emitted.push(rows); setValue(rows); },
    });
  }
  render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(Harness, {}) }));
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  return emitted;
}
const unitButton = (key: "production.panel.unit_case" | "production.panel.unit_each") =>
  screen.getByRole("button", { name: (en as Record<string, string>)[key] });

afterEach(() => cleanup());

describe("ProductionConsumptionPanel unit switch (W16/B097)", () => {
  it("switching Each → Case keeps the ounces the prepper typed", () => {
    const emitted = mount(3);
    fireEvent.click(unitButton("production.panel.unit_each"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Sauce" }), { target: { value: "1" } });
    expect(emitted.at(-1)![0]!.qtyOz).toBe(1);
    fireEvent.click(unitButton("production.panel.unit_case"));
    const last = emitted.at(-1)![0]!;
    expect(last.qtyOz).toBe(1);
    expect(last.unitEntered).toBe("case");
    expect(last.qtyEntered).toBeCloseTo(0.005, 6);
  });

  it("switching an untouched row keeps the derived ounces", () => {
    const emitted = mount(3);
    fireEvent.click(unitButton("production.panel.unit_case"));
    expect(emitted.at(-1)![0]!.qtyOz).toBe(3);
    fireEvent.click(unitButton("production.panel.unit_each"));
    expect(emitted.at(-1)![0]!.qtyOz).toBe(3);
    fireEvent.click(unitButton("production.panel.unit_case"));
    expect(emitted.at(-1)![0]!.qtyOz).toBe(3);
  });
});
