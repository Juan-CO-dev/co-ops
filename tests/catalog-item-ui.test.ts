/** Catalog Phase 2b — the item page body: identity, version, connections, what's missing, sections, jobs, history (en + es). */
import { type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import type { SkuItemView } from "@/lib/catalog/sku-item-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: async () => "ok", forgetStepUp: () => {} }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => async () => ({ ok: true, data: {} }) }));
const { SkuItemClient } = await import("@/components/catalog/SkuItemClient");

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const view: SkuItemView = {
  sku: { id: "7d0c1f2e-0000-4000-8000-000000000001", name: "Turkey", itemNumber: "TK-9", active: true, skuClass: "raw", priceBasis: "per_case", avgOzPerEach: null, packFormat: "case" },
  vendor: { id: "v", name: "Baldor", active: true },
  product: null,
  shops: [{ id: SHOP, name: "P Street" }],
  scope: SHOP, scopeName: "P Street",
  can: { editShop: true, editGlobal: false, editPar: true, editBasis: false },
  pack: {
    levels: [
      { id: "c", label: "case", containsQty: 4, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "b", label: "bag", containsQty: 10, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
    ],
    versionId: "sv", isShopVersion: true, effectiveFrom: "2026-10-10T00:00:00Z", globalVersionId: "gv",
    orderUnit: "case", orderUnitOz: 640, descriptor: "case → 4 bag → 10 lb",
  },
  price: { value: 150, effectiveDate: "2026-10-10", isShopLane: true, globalValue: 128, costPerOz: 0.234375, history: [{ id: "p", unitPrice: 150, effectiveDate: "2026-10-10", shop: true }] },
  ordering: { slots: [{ slot: "weekday", value: 3, lane: "human" }, { slot: "weekend", value: null, lane: "none" }], orderDays: [1, 4], offHere: false },
  counting: { unit: "case" },
  barcodes: [],
  connections: { uses: [{ id: "r", name: "Italian build" }], menuItems: [{ id: "m", name: "Italian", nameEs: "Italiano", cost: 2.1 }] },
  missing: [{ code: "no_rhythm", blocks: [], degrades: ["order"] }],
  history: [
    { id: "sv", scope: "shop", active: true, effectiveFrom: "2026-10-10T00:00:00Z", retiredAt: null, who: "Ana", labels: ["case", "bag"] },
    { id: "gv-old", scope: "global", active: false, effectiveFrom: "2026-08-01T00:00:00Z", retiredAt: "2026-09-01T00:00:00Z", who: null, labels: ["case", "bag"] },
  ],
  openRequests: [{ id: "req", filedBy: "Luis", filedAt: "2026-10-14T13:00:00Z", note: "Bags are bigger", proposal: { innerCount: 4, eachWeight: 10, eachUnit: "lb" } }],
  measures: [{ label: "oz", dimension: "weight", toBaseFactor: 1 }, { label: "lb", dimension: "weight", toBaseFactor: 16 }],
};
/** React's static markup escapes an apostrophe; compare a translated string the way it is rendered. */
const html_ = (s: string) => s.replace(/'/g, "&#x27;");
const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));

describe("SkuItemClient", () => {
  it("says which version it is showing, how it connects, and what is missing — always visible", () => {
    const html = render(jsx(SkuItemClient, { view, job: null, requestId: null }));
    expect(html).toContain("P Street&#x27;s version");
    expect(html).toContain(en["catalog.item.connections"]);
    expect(html).toContain("Comes from Baldor");
    expect(html).toContain("Italian build");
    expect(html).toContain(html_(en["catalog.item.missing"]));
    expect(html).toContain(html_(en["admin.skus.data.errand.no_rhythm"]));
    expect(html).toContain(en["catalog.requests.title"]);
    expect(html).toContain("Bags are bigger");
  });
  it("sections are collapsed with their summary in the header; every control is 44px", () => {
    const html = render(jsx(SkuItemClient, { view, job: null, requestId: null }));
    for (const k of ["catalog.item.section.arrives", "catalog.item.section.price", "catalog.item.section.ordering", "catalog.item.section.counting", "catalog.item.section.barcodes", "catalog.item.section.history"] as const) {
      expect(html).toContain(en[k]);
    }
    expect(html).toContain("case → 4 bag → 10 lb");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/);
  });
  it("job=pack opens the sentence editor, prefilled from the door report", () => {
    const html = render(jsx(SkuItemClient, { view, job: "pack", requestId: "req" }));
    expect(html).toContain(en["catalog.pack.sentence_aria"]);
    expect(html).toContain('value="4"');
    expect(html).toContain(en["catalog.item.see_changes"]);
  });
  it("the preview for everyone is offered only to those who may save for everyone", () => {
    expect(render(jsx(SkuItemClient, { view, job: "pack", requestId: null }))).not.toContain(en["catalog.item.see_changes_everyone"]);
    const moo = { ...view, can: { ...view.can, editGlobal: true } };
    expect(render(jsx(SkuItemClient, { view: moo, job: "pack", requestId: null }))).toContain(en["catalog.item.see_changes_everyone"]);
  });
  it("job=price opens the price editor; Spanish throughout", () => {
    const html = render(jsx(SkuItemClient, { view, job: "price", requestId: null }), "es");
    expect(html).toContain(es["catalog.price.new"]);
    expect(html).toContain("Versión de P Street");
    expect(html).toContain(es["catalog.item.connections"]);
  });
  it("a reader who may not write sees no job, no save and no door-report actions — the page offers only what its writers allow", () => {
    const readOnly = { ...view, can: { editShop: false, editGlobal: false, editPar: false, editBasis: false } };
    const html = render(jsx(SkuItemClient, { view: readOnly, job: null, requestId: null }));
    expect(html).not.toContain(html_(en["catalog.item.job_pack"]));
    expect(html).not.toContain(en["catalog.item.job_price"]);
    expect(html).not.toContain(en["catalog.requests.review"]);
    expect(html).not.toContain(en["catalog.requests.dismiss"]);
    expect(html).not.toContain(en["catalog.history.restore"]);
  });
});
