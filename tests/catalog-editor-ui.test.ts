/** Catalog Phase 2b — the sentence editor and "What this changes" render accessibly, at the 44px floor, in en and es. */
import { type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import { PackSentenceEditor } from "@/components/catalog/PackSentenceEditor";
import { ChangePreviewPanel } from "@/components/catalog/ChangePreviewPanel";
import type { PackPreview } from "@/lib/catalog/change-preview-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));
const units = [{ label: "oz", dimension: "weight" as const }, { label: "lb", dimension: "weight" as const }, { label: "each", dimension: "count" as const }];
const draft = { containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "4" }], leafQty: "10", leafUnit: "lb" };

describe("PackSentenceEditor", () => {
  it("reads as one sentence: 1 case · holds 4 bag · each bag weighs 10 lb — every control 44px", () => {
    const html = render(jsx(PackSentenceEditor, { draft, onChange: () => {}, units, skuClass: "raw", currentLeafUnit: "lb", avgOzPerEach: null, error: null, busy: false }));
    expect(html).toContain('role="group"');
    expect(html).toContain(en["catalog.pack.holds"]);
    expect(html).toContain("each bag weighs");
    expect(html).toContain('value="10"');
    expect(html).not.toContain(">each<"); // a raw item ends in a weight
    expect(html.match(/min-h-\[44px\]/g)!.length).toBeGreaterThanOrEqual(7);
  });
  it("names the problem in Spanish", () => {
    const html = render(jsx(PackSentenceEditor, { draft, onChange: () => {}, units, skuClass: "raw", currentLeafUnit: "lb", avgOzPerEach: null, error: { error: "duplicate_label", index: 1 }, busy: false }), "es");
    expect(html).toContain('role="alert"');
    expect(html).toContain(es["catalog.pack.error.duplicate_label"]);
  });
  it("names an unregistered leaf unit by the writer's own refusal (chunk-1 review P3c)", () => {
    const html = render(jsx(PackSentenceEditor, { draft, onChange: () => {}, units, skuClass: "raw", currentLeafUnit: "lb", avgOzPerEach: null, error: { error: "unknown_measure", index: 1 }, busy: false }));
    expect(html).toContain(en["catalog.pack.error.unknown_measure"].replace(/'/g, "&#x27;")); // React escapes the apostrophe
  });
});

const shopDelta = {
  shopId: "A", shopName: "P Street",
  orderUnit: { before: "case", after: "case" }, orderUnitOz: { before: 320, after: 640 },
  costPerOz: { before: 0.4, after: 0.2 },
  menuItems: [{ id: "m", name: "Italian", nameEs: "Italiano", before: 1.6, after: 0.8 }],
  brokenLines: [{ recipeId: "r", recipeName: "Bag sub", quantity: 1, unit: "bag" }],
  openOrders: [{ poId: "p", displayCode: "CH-1", status: "placed", orderQty: 2, orderUnitLabel: "case", shopId: "A", shopName: "P Street" }],
};
const shopPreview: PackPreview = {
  kind: "pack", target: { kind: "shop", shopId: "A" }, changed: true, liveVersionId: null, basedOnVersionId: "gv",
  shops: [shopDelta], unaffected: [],
  pars: [
    { locationId: "A", shops: ["P Street"], slot: "weekday", lane: "human", status: "convertible", inherited: false, current: 3, currentOz: 960, keepOz: 1920, convertTo: 2, perOrderUnit: null, fallbackPar: null, fallbackOz: null, fallbackIfConverted: null, unit: { before: "case", after: "case" } },
    { locationId: "A", shops: ["P Street"], slot: "weekend", lane: "global", status: "convertible", inherited: true, current: 4, currentOz: 1280, keepOz: 2560, convertTo: 2, perOrderUnit: null, fallbackPar: null, fallbackOz: null, fallbackIfConverted: null, unit: { before: "case", after: "case" } },
  ],
  conversions: [{ locationId: "A", slot: "weekday", expected: 3, to: 2 }, { locationId: "A", slot: "weekend", expected: 4, to: 2, inherited: true }],
  snapshot: null,
  token: "0000abcd",
};
const globalPreview: PackPreview = {
  ...shopPreview, target: { kind: "global" }, liveVersionId: "gv", basedOnVersionId: null,
  unaffected: [{ shopId: "B", shopName: "Cap Hill" }],
  pars: [{ locationId: null, shops: ["P Street", "Cap Hill"], slot: "weekday", lane: "global", status: "global_par_shared", inherited: false, current: 3, currentOz: 960, keepOz: 1920, convertTo: null, perOrderUnit: null, fallbackPar: null, fallbackOz: null, fallbackIfConverted: null, unit: { before: "case", after: "case" } }],
  conversions: [],
};
const props = { canSave: true, canEditPar: true, chosen: new Set<string>(), onToggleConversion: () => {}, onSave: () => {}, busy: false };

describe("ChangePreviewPanel", () => {
  it("a shop preview: every knock-on, the shop's own par as a keep-or-convert choice, the inherited par as keep-or-give-its-own, and ONE save — for that shop", () => {
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: shopPreview }));
    expect(html).toContain(en["catalog.preview.title"]);
    expect(html).toContain("Worked out for P Street only");
    expect(html).toContain("$0.4000/oz → $0.2000/oz");
    expect(html).toContain("Italian");
    expect(html).toContain("Keep 3 case");
    expect(html).toContain("Change to 2 case");
    expect(html).toContain('aria-pressed="true"'); // keep is the default
    expect(html).toContain("P Street uses the global weekend par");
    expect(html).toContain(en["catalog.preview.par_keep_inherited"]); // the opt-in: keep inheriting…
    expect(html).toContain("Give P Street its own par: 2 case"); // …or give the shop its own par (2b r2#3)
    expect(html).toContain("Bag sub");
    expect(html).toContain("CH-1");
    expect(html).toContain("Save for P Street");
    expect(html).not.toContain(en["catalog.preview.save_everyone"]);
  });
  it("a global preview: the untouched shops, a shared global par named (no conversion), and the save for everyone", () => {
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: globalPreview }));
    expect(html).toContain(en["catalog.preview.target_global"]);
    expect(html).toContain("Cap Hill");
    expect(html).not.toContain("Change to");
    expect(html).toContain(en["catalog.preview.save_everyone"]);
    expect(html).not.toContain("Save for P Street");
  });
  it("an AGM sees the par question without the convert choice; Spanish names the sandwich in Spanish", () => {
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: shopPreview, canEditPar: false }), "es");
    expect(html).toContain(es["catalog.preview.par_gm_only"]);
    expect(html).not.toContain("Cambiar a 2");
    expect(html).toContain("Italiano");
  });
  it("a chosen conversion shows as pressed; every button is 44px", () => {
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: shopPreview, chosen: new Set(["A|weekday|3|2"]) }));
    expect(html.match(/aria-pressed="true"/g)!.length).toBe(2); // the chosen convert + the inherited row's default keep
    expect(html).toMatch(/aria-pressed="true"[^>]*>Change to 2 case/);
    expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/);
    expect(html).not.toMatch(/<button(?![^>]*items-center)[^>]*>/);
  });
});

describe("ChangePreviewPanel — what really happens to a machine par and a count (chunk-1 review P2-1 / P2-2)", () => {
  const machine = (fallbackPar: number | null): PackPreview => ({
    ...shopPreview,
    pars: [{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "auto", status: "machine_par", inherited: true, current: 5, currentOz: 1600,
      keepOz: 3200, convertTo: 3, perOrderUnit: null, fallbackPar, fallbackOz: fallbackPar == null ? null : fallbackPar * 640, fallbackIfConverted: null, unit: { before: "case", after: "case" } }],
    conversions: [{ locationId: "A", slot: "weekday", expected: 5, to: 3, inherited: true, from: "auto" }],
  });
  it("the machine par restarts: the default par is shown in the new case, and 'give this shop its own par' is offered prefilled", () => {
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: machine(3), chosen: new Set([`A|weekday|5|3|inherited:auto`]) }));
    expect(html).toContain("Until it recomputes, P Street uses the default par: 3 case (1,920 oz).");
    expect(html).toContain("Give this shop its own par: 3 case");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Give this shop its own par: 3 case/);
    expect(html).toContain(en["catalog.preview.par_let_restart"]);
  });
  it("with no default par it says so plainly", () => {
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: machine(null) }));
    expect(html).toContain("there is no default par to fall back to");
    const es_ = render(jsx(ChangePreviewPanel, { ...props, preview: machine(null) }), "es");
    expect(es_).toContain("no hay un par por defecto");
  });
  it("a count-ending case with no weight: the par now means a different count", () => {
    const p: PackPreview = { ...shopPreview, conversions: [], pars: [{ locationId: "A", shops: ["P Street"], slot: "weekday", lane: "human", status: "no_weight", inherited: false,
      current: 3, currentOz: null, keepOz: null, convertTo: null, perOrderUnit: { before: { qty: 1000, unit: "each" }, after: { qty: 500, unit: "each" } }, fallbackPar: null, fallbackOz: null, fallbackIfConverted: null, unit: { before: "case", after: "case" } }] };
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: p }));
    expect(html).toContain("one order unit held 1,000 each, now it holds 500 each");
    expect(html).toContain(en["catalog.preview.par_cant_convert"]);
  });
});

describe("ChangePreviewPanel — chunk-2 review: the row's own units, the server's conversions, the converted fallback", () => {
  it("P3a: a converted number is labelled with the NEW order unit; the global row with the global pack's unit", () => {
    const p: PackPreview = { ...shopPreview, target: { kind: "global" },
      shops: [{ ...shopDelta, orderUnit: { before: "tub", after: "tub" } }],
      pars: [{ locationId: null, shops: ["P Street"], slot: "weekday", lane: "global", status: "convertible", inherited: false, current: 3, currentOz: 960, keepOz: 1920,
        convertTo: 2, perOrderUnit: null, fallbackPar: null, fallbackOz: null, fallbackIfConverted: null, unit: { before: "case", after: "box" } }],
      conversions: [{ locationId: null, slot: "weekday", expected: 3, to: 2 }] };
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: p }));
    expect(html).toContain("Keep 3 case");
    expect(html).toContain("Change to 2 box");
    expect(html).not.toContain("3 tub");
  });
  it("P3d: a row the server offered no conversion for renders no choice (nothing is recomputed client-side)", () => {
    const p: PackPreview = { ...shopPreview, conversions: [] };
    const html = render(jsx(ChangePreviewPanel, { ...props, preview: p }));
    expect(html).not.toContain("Change to");
    expect(html).not.toContain("Give P Street its own par");
  });
  it("P3b: a restarting machine par on a global save shows the CONVERTED global par once that conversion is chosen", () => {
    const p: PackPreview = { ...shopPreview, target: { kind: "global" },
      pars: [
        { locationId: null, shops: ["P Street", "Cap Hill"], slot: "weekday", lane: "global", status: "convertible", inherited: false, current: 3, currentOz: 960, keepOz: 1920,
          convertTo: 2, perOrderUnit: null, fallbackPar: null, fallbackOz: null, fallbackIfConverted: null, unit: { before: "case", after: "case" } },
        { locationId: "A", shops: ["P Street"], slot: "weekday", lane: "auto", status: "machine_par", inherited: false, current: 5, currentOz: 1600, keepOz: 3200,
          convertTo: null, perOrderUnit: null, fallbackPar: 3, fallbackOz: 1920, fallbackIfConverted: { par: 2, oz: 1280 }, unit: { before: "case", after: "case" } },
      ],
      conversions: [{ locationId: null, slot: "weekday", expected: 3, to: 2 }] };
    expect(render(jsx(ChangePreviewPanel, { ...props, preview: p }))).toContain("uses the default par: 3 case (1,920 oz)");
    expect(render(jsx(ChangePreviewPanel, { ...props, preview: p, chosen: new Set(["global|weekday|3|2"]) }))).toContain("uses the default par: 2 case (1,280 oz)");
  });
});
