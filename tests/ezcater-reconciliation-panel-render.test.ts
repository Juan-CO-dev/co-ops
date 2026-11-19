/**
 * Item 21 PR 3, fix round 2 (review PORTAL3-r2 P2 #2): the ezCater reconciliation panel as people see it, en + es.
 * A failed house-conflict read is UNKNOWN, never zero: the panel says "could not load house conflicts" and stays on
 * screen even when every other count is empty. A missing 0347 (not_installed) and a verified zero show nothing.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { EzcaterReconciliationView } from "@/components/catering/pipeline/EzcaterReconciliationPanel";
import type { EzcaterReconciliationDetail } from "@/lib/catering/ezcater-reconciliation-shared";

const base: EzcaterReconciliationDetail = { available: true, locationConflict: false, manualLocation: null, reviews: [], linkCount: 0, shadowRows: 0, truncated: false };
// eslint-disable-next-line react/no-children-prop -- TranslationProvider requires children in its props type.
const render = (data: EzcaterReconciliationDetail, language: "en" | "es" = "en") => renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language,
  children: createElement(EzcaterReconciliationView, { data, panelId: "p", open: false, onToggle: () => {} }) }))
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the reconciliation panel's house conflicts", () => {
  it("a failed conflict read is said, in en and es, even when nothing else is on the panel", () => {
    const failed = { ...base, houseConflicts: { state: "unavailable" as const } };
    const en = render(failed);
    expect(en).toContain("Could not load house conflicts for this order.");
    expect(en).not.toContain("also carry a house ring code. A manager decides");
    expect(render(failed, "es")).toContain("No se pudieron cargar los conflictos con pedidos propios de este pedido.");
  });
  it("a failed conflict read beside other facts is still said", () => {
    const en = render({ ...base, linkCount: 2, houseConflicts: { state: "unavailable" } });
    expect(en).toContain("Could not load house conflicts for this order.");
  });
  it("a known count is shown; a verified zero, a missing 0347 or no ezCater order show nothing", () => {
    expect(render({ ...base, houseConflicts: { state: "known", count: 2 } })).toContain("2 Toast checks for this order also carry a house ring code.");
    expect(render({ ...base, houseConflicts: { state: "known", count: 0 } })).toBe("");
    expect(render({ ...base, houseConflicts: { state: "not_installed" } })).toBe("");
    expect(render(base)).toBe("");
  });
});
