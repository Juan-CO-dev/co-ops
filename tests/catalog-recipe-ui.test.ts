/** Catalog Phase 3b — the recipe page: "What this changes" and the page body (version, connections, lines, notices, other shops, history), en + es, 44px, 375px. */
import { type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import type { RecipePreview } from "@/lib/catalog/recipe-preview-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: async () => "ok", forgetStepUp: () => {} }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => async () => ({ ok: true, data: {} }) }));
const { RecipePreviewPanel } = await import("@/components/catalog/RecipePreviewPanel");

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const OTHER = "6f1d2c3e-0000-4000-8000-00000000000b";
const turkey = { componentSkuId: "sku-t", componentItemId: null, componentProductId: null, quantity: 5, unit: "oz", eachContainerLabel: null, portioned: false };
const mayo = { componentSkuId: null, componentItemId: null, componentProductId: "p-mayo", quantity: 1, unit: "each", eachContainerLabel: null, portioned: false };

/** React's static markup escapes an apostrophe; compare a translated string the way it is rendered. */
const html_ = (s: string) => s.replace(/'/g, "&#x27;");
const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));
/** Every <button> and <a> carries the 44px floor with items-center (AGENTS.md). */
const expect44 = (html: string) => {
  expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/);
  expect(html).not.toMatch(/<button(?![^>]*items-center)[^>]*>/);
  expect(html).not.toMatch(/<a(?![^>]*min-h-\[44px\])[^>]*>/);
};

const preview: RecipePreview = {
  kind: "restore",
  recipeId: "7d0c1f2e-0000-4000-8000-000000000001",
  target: { kind: "shop", shopId: SHOP },
  changes: [{ kind: "changed", key: "sku:sku-t", before: { ...turkey, quantity: 4 }, after: turkey }],
  names: { "sku:sku-t": "Turkey", "product:p-mayo": "Mayo" },
  reached: [{ scope: SHOP, scopeName: "P Street", menu: [{ menuItemId: "m1", name: "Italian", nameEs: "Italiano", before: 2.5, after: 2.75, statusBefore: "costed", statusAfter: "costed" }], items: [] }],
  untouched: [{ shopId: OTHER, shopName: "Capitol Hill" }],
  returnedShop: null,
  dropsLinkTo: "Capitol Hill",
  flagged: [{ position: 2, name: "Mayo", reason: "product_line_needs_measure_unit" }],
  expectedVersionId: "sv", basedOnVersionId: "g0",
  snapshot: {},
  token: "tok",
};

describe("RecipePreviewPanel — what this changes", () => {
  it("names the change, the cost moves per shop, the shops left untouched, and the save", () => {
    const html = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Restore this version", busy: false, onSave: () => {}, onDiscard: () => {} }));
    expect(html).toContain(en["catalog.recipe.preview.title"]);
    expect(html).toContain("Turkey 4 oz");
    expect(html).toContain("Turkey 5 oz");
    expect(html).toContain("P Street");
    expect(html).toContain("Italian");
    expect(html).toContain("Capitol Hill");
    expect(html).toContain("Restore this version");
    expect(html).toContain(en["catalog.recipe.preview.discard"]);
    expect44(html);
  });
  it("lead decision: restoring pre-adoption history says, BEFORE saving, that it drops the link to that shop's recipe", () => {
    const html = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {} }));
    expect(html).toContain(html_("This drops the link to Capitol Hill's recipe — you'll stop getting its updates."));
    const keeps = render(jsx(RecipePreviewPanel, { preview: { ...preview, dropsLinkTo: null }, saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {} }));
    expect(keeps).not.toContain("This drops the link");
  });
  it("lead decision (b): a CARRIED broken line is flagged by position, name and reason — not refused", () => {
    const html = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {} }));
    expect(html).toContain(en["catalog.recipe.preview.flagged_title"].replace(/'/g, "&#x27;"));
    expect(html).toContain(html_(`Line 2 (Mayo) needs fixing: ${en["catalog.recipe.error.product_line_needs_measure_unit"]}`));
  });
  it("a promote names the shop that goes back to the default", () => {
    const html = render(jsx(RecipePreviewPanel, {
      preview: { ...preview, kind: "promote", target: { kind: "global" }, dropsLinkTo: null, returnedShop: { shopId: OTHER, shopName: "Capitol Hill" } },
      saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {},
    }));
    expect(html).toContain("Capitol Hill goes back to the default. Its food stays the same.");
  });
  it("Spanish (tú), Spanish sandwich names, and the drop-link sentence", () => {
    const html = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Guardar", busy: false, onSave: () => {}, onDiscard: () => {} }), "es");
    expect(html).toContain(es["catalog.recipe.preview.title"]);
    expect(html).toContain("Italiano");
    expect(html).toContain("Esto quita el vínculo con la receta de Capitol Hill — dejarás de recibir sus actualizaciones.");
  });
  it("375px: nothing in the panel scrolls sideways or clips — its rows and buttons wrap", () => {
    const html = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {} }));
    expect(html).not.toMatch(/overflow-x-auto|whitespace-nowrap|\btruncate\b/);
    expect(html).toContain("flex-wrap");
    expect(html).toContain("break-words");
  });
});
