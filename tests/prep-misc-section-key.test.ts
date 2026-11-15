/**
 * W15/B088: every yes/no prep section rendered through MiscSection used the hard-coded
 * "Misc" key, so a second yes/no section showed Misc's title, Misc's progress and shared
 * Misc's collapse state. MiscSection now takes the section slug (default "Misc").
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { MiscSection } from "@/components/prep/sections/MiscSection";
import { AmPrepCollapseContext, type AmPrepCollapse } from "@/components/prep/collapse-context";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { ChecklistTemplateItem } from "@/lib/types";

function item(id: string, label: string, station: string | null): ChecklistTemplateItem {
  return {
    id,
    templateId: "t1",
    station,
    displayOrder: 1,
    label,
    description: null,
    minRoleLevel: 3,
    required: true,
    expectsCount: false,
    expectsPhoto: false,
    vendorItemId: null,
    active: true,
    translations: null,
    prepMeta: { section: "Safety", columns: ["yes_no"] },
  } as unknown as ChecklistTemplateItem;
}

function render(section: string | undefined, toggled: string[]) {
  const collapse: AmPrepCollapse = {
    formKey: "am-prep",
    isOpen: (s) => s === "Safety",
    toggle: (s) => { toggled.push(s); },
    progress: { Misc: { done: 9, total: 9 }, Safety: { done: 1, total: 2 } },
  };
  const props = {
    templateItems: [item("i1", "Floor mat down?", null), item("i2", "First aid kit stocked?", null)],
    rawValues: {},
    onChange: () => {},
    sectionLabels: { Misc: { en: "Misc", es: null }, Safety: { en: "Safety", es: null } },
    ...(section ? { section } : {}),
  };
  return renderToStaticMarkup(
    createElement(TranslationProvider, { initialLanguage: "en" },
      createElement(AmPrepCollapseContext.Provider, { value: collapse },
        createElement(MiscSection, props))),
  );
}

describe("W15/B088 yes/no sections keep their own key", () => {
  it("a non-Misc yes/no section renders its own title and progress", () => {
    const html = render("Safety", []);
    expect(html).toContain("am-prep:Safety");
    expect(html).toMatch(/>Safety</);
    expect(html).not.toMatch(/>Misc</);
    expect(html).toContain("1 of 2 done");
    expect(html).not.toContain("9 of 9 done");
  });

  it("without a section prop MiscSection still renders as Misc", () => {
    const html = render(undefined, []);
    expect(html).toMatch(/>Misc</);
    expect(html).toContain("9 of 9 done");
  });

  it("AmPrepForm passes the section slug to MiscSection", () => {
    const src = readFileSync("components/prep/AmPrepForm.tsx", "utf8");
    expect(src).toMatch(/<MiscSection\s+key=\{s\.slug\}\s+section=\{s\.slug\}/);
  });
});
