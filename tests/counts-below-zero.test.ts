/**
 * D-60 (Juan 2026-10-13): a negative theoretical on-hand on Counts shows CLAMPED at 0 with a
 * "below zero — count it" pill; the real number stays in the row's detail / the product drawer.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { displayOnHand, onHandBelowZero } from "@/lib/counts-shared";
import { OnHandPanel } from "@/components/counts/OnHandPanel";
import { ProductOnHandCard } from "@/components/counts/ProductOnHandCard";
import type { OnHandCountRow, OnHandView, OnHandWeightRow } from "@/lib/counts";
import type { ProductOnHandRow } from "@/lib/products-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

describe("onHandBelowZero / displayOnHand", () => {
  it("flags a negative on-hand at the displayed precision; null and zero are not flagged", () => {
    expect(onHandBelowZero(-433)).toBe(true);
    expect(onHandBelowZero(-0.06)).toBe(true);
    expect(onHandBelowZero(-0.04)).toBe(false); // rounds to 0.0 — no pill, no "-0.0"
    expect(onHandBelowZero(0)).toBe(false);
    expect(onHandBelowZero(12)).toBe(false);
    expect(onHandBelowZero(null)).toBe(false);
    expect(onHandBelowZero(Number.NaN)).toBe(false);
  });
  it("clamps the shown value at 0 and keeps null as null (advisory is never a fabricated 0)", () => {
    expect(displayOnHand(-189)).toBe(0);
    expect(displayOnHand(230)).toBe(230);
    expect(displayOnHand(null)).toBeNull();
  });
});

const weight = (over: Partial<OnHandWeightRow>): OnHandWeightRow => ({
  dimension: "weight", skuId: "cap", skuName: "Capicola", anchorOz: 100, anchorAt: "2026-10-10T12:00:00Z", anchorAgeDays: 3,
  driftOz: -289, onHandOz: -189, anchorStale: false, anchorSource: "census", varianceOz: null, looseLineCount: 0, partialLineCount: 0, ...over,
});
const count = (over: Partial<OnHandCountRow>): OnHandCountRow => ({
  dimension: "count", skuId: "cups", skuName: "Cups", unitLabel: "each", anchorUnits: 10, anchorAt: "2026-10-10T12:00:00Z", anchorAgeDays: 3,
  onHandUnits: -4, anchorStale: false, usedOrLostUnits: null, looseLineCount: 0, partialLineCount: 0, ...over,
});
const view = (rows: OnHandView["rows"]): OnHandView => ({ locationId: "shop", anchorAt: null, salesThrough: null, rows, products: [] });
const panel = (rows: OnHandView["rows"], lang: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(OnHandPanel, { view: view(rows), lang, twinVendorBySkuId: new Map() }));

describe("Counts on-hand list", () => {
  it("a negative weight row shows 0.0 oz + the pill, and the real number in the detail line", () => {
    const html = panel([weight({})]);
    expect(html).toContain("below zero — count it");
    expect(html).toContain("0.0 oz on hand");
    expect(html).not.toContain("-189.0 oz on hand");
    expect(html).toContain("theoretical -189.0 oz");
  });
  it("a positive row is unchanged (no pill, no theoretical line)", () => {
    const html = panel([weight({ onHandOz: 230 })]);
    expect(html).toContain("230.0 oz on hand");
    expect(html).not.toContain("below zero");
    expect(html).not.toContain("theoretical");
  });
  it("count rows clamp the same way", () => {
    const html = panel([count({})]);
    expect(html).toContain("0 each on hand");
    expect(html).toContain("below zero — count it");
    expect(html).toContain("theoretical -4 each");
  });
  it("Spanish renders the pill too", () => {
    expect(panel([weight({})], "es")).toContain("bajo cero — cuéntalo");
  });
});

describe("Product on-hand row", () => {
  const product = (totalOz: number | null): ProductOnHandRow => ({
    productId: "ham", productName: "Ham", totalOz, knownOz: totalOz ?? 0, unknownSkuIds: [],
    members: [{ skuId: "a", skuName: "Ham", vendorName: "PFG", onHandOz: totalOz }], varianceOz: null, varianceLots: [], remaining: [],
  });
  const card = (row: ProductOnHandRow) => renderToStaticMarkup(createElement(TranslationProvider, {
    initialLanguage: "en", children: createElement(ProductOnHandCard, { row }),
  }));
  it("a negative product total headlines 0.0 oz with the pill (the number lives in the drawer)", () => {
    const html = card(product(-433));
    expect(html).toContain("below zero — count it");
    expect(html).toContain("0.0 oz on hand");
    expect(html).not.toContain("-433.0 oz on hand");
  });
  it("a positive total keeps its headline", () => {
    const html = card(product(40));
    expect(html).toContain("40.0 oz on hand");
    expect(html).not.toContain("below zero");
  });
});

describe("i18n", () => {
  it.each(["counts.onhand.below_zero", "counts.onhand.theoretical"])("%s exists in en and es with the same placeholders", (key) => {
    const a = (en as Record<string, string>)[key]!;
    const b = (es as Record<string, string>)[key]!;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(b.match(/\{\w+\}/g) ?? []).toEqual(a.match(/\{\w+\}/g) ?? []);
  });
});
