import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { whatsLeft } from "@/lib/whats-left-shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TranslationProvider } from "@/lib/i18n/provider";
import { WhatsLeft } from "@/components/ui/WhatsLeft";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

describe("what's left", () => {
  it("keeps template order and separates required work above the actor's role", () => {
    const template = [
      { id: "a", sectionId: "one", label: "A", required: true, minRoleLevel: 3, targetField: "primary" },
      { id: "optional", sectionId: "one", label: "Optional", required: false, minRoleLevel: 3, targetField: "primary" },
      { id: "b", sectionId: "two", label: "B", required: true, minRoleLevel: 4, targetField: "primary" },
      { id: "c", sectionId: "two", label: "C", required: true, minRoleLevel: 3, targetField: "primary" },
    ];
    expect(whatsLeft(template, { c: true }, 3)).toEqual({
      left: [{ itemId: "a", sectionId: "one", label: "A", targetField: "primary" }],
      needsHigherRole: [{ itemId: "b", sectionId: "two", label: "B", targetField: "primary" }],
    });
    expect(whatsLeft(template, { a: true, b: true, c: true }, 3)).toEqual({ left: [], needsHigherRole: [] });
  });
  it("reads each phase's own completion rule", () => {
    const midDay1 = readFileSync("components/MidDayPhase1Form.tsx", "utf8");
    expect(midDay1).toContain("batchBoxesComplete(it)]))");
    const midDay2 = readFileSync("components/MidDayPhase2Form.tsx", "utf8");
    expect(midDay2).toContain('(states[it.id] ?? EMPTY).status === "saved"');
    const opening = readFileSync("app/(authed)/operations/opening/opening-client.tsx", "utf8");
    expect(opening).toContain("const phase1Left = whatsLeft(phase1Items");
    const opening2 = readFileSync("components/opening/OpeningPrepEntry.tsx", "utf8");
    expect(opening2).toContain('saveStates.get(item.id)?.status === "saved"');
  });
  it("starts collapsed and disappears when the active phase has nothing left", () => {
    for (const language of ["en", "es"] as const) {
      const render = (result: ReturnType<typeof whatsLeft>) => renderToStaticMarkup(createElement(TranslationProvider,
        { initialLanguage: language, children: null }, createElement(WhatsLeft, { result, onJump: () => {} })));
      const item = { id: "one", sectionId: "prep", label: "One", required: true, minRoleLevel: 3, targetField: "primary" };
      const html = render(whatsLeft([item], {}, 3));
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain(language === "en" ? "1 left" : "1 pendientes");
      expect(html).not.toContain("One</button>");
      expect(render(whatsLeft([item], { one: true }, 3))).toBe("");
    }
  });
  it("pins all four surfaces, role projections, jump order and 44px control", () => {
    for (const path of ["app/(authed)/operations/opening/opening-client.tsx", "components/opening/OpeningPrepEntry.tsx",
      "components/MidDayPhase1Form.tsx", "components/MidDayPhase2Form.tsx",
      "components/prep/AmPrepForm.tsx", "app/(authed)/operations/closing/closing-client.tsx"]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("whatsLeft(");
      expect(source).toContain("<WhatsLeft result={");
      expect(source).toContain("setOpenTransient(id, true)");
    }
    for (const path of ["components/opening/OpeningChecklistItem.tsx", "components/opening/OpeningPrepEntry.tsx",
      "components/MidDayPhase1Form.tsx", "components/MidDayPhase2Form.tsx", "components/prep/PrepRow.tsx",
      "components/prep/sections/MiscSection.tsx", "components/prep/sections/MixedPrepSection.tsx",
      "components/ChecklistItem.tsx", "app/(authed)/operations/closing/closing-client.tsx"]) {
      expect(readFileSync(path, "utf8")).toContain("data-whats-left-item={");
    }
    const summary = readFileSync("components/ui/WhatsLeft.tsx", "utf8");
    expect(summary).toContain("openSection(entry.sectionId);");
    expect(summary.indexOf("openSection(entry.sectionId);")).toBeLessThan(summary.indexOf("requestAnimationFrame("));
    expect(summary).toContain("min-h-[44px]");
    expect(summary).toContain("if (total === 0) return null");
    for (const key of ["whats_left.count", "whats_left.higher_role", "whats_left.key_holder"] as const) {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
    }
  });
});
