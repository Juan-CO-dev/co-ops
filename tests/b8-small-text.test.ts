import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { markSkuNameClashes, skuOptionName } from "@/lib/production-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

// B8 #12 (sim walk 2026-10-14).

describe("B8 #12a mid-day Phase 2 'Prepped' placeholder fits", () => {
  const src = readFileSync("components/MidDayPhase2Form.tsx", "utf8");
  it("the prepped input is w-32, not the w-20 that clipped 'Prepped' to 'Preppec'", () => {
    const input = /placeholder=\{it\.batch \? t\("prep\.batch\.bottled_short"\) : t\("mid_day_prep\.phase2\.prepped"\)\}\s*className="\s*min-h-\[44px\] w-32 shrink-0/.exec(src);
    expect(input).not.toBeNull();
  });
  it("the batch placeholder is the short word; the aria-label keeps the full phrase", () => {
    expect(src).toContain('t("prep.batch.bottled_label" as TranslationKey) : t("mid_day_prep.phase2.prepped")}`}');
    expect(en["prep.batch.bottled_short"]).toBe("Bottled");
    expect(es["prep.batch.bottled_short"]).toBe("Embotellado");
    // A w-32 box (~100px of text at 16px) holds ~11 characters.
    for (const s of [en["prep.batch.bottled_short"], es["prep.batch.bottled_short"], en["mid_day_prep.phase2.prepped"], es["mid_day_prep.phase2.prepped"]]) {
      expect(s.length).toBeLessThanOrEqual(11);
    }
  });
});

describe("B8 #12b Production SKU picker: same-name SKUs stay distinct and say whose", () => {
  const rows = [
    { id: "a", name: "1/2 pint bottoms (flexi)", vendorName: "Vendor A", inStockPacks: 0 },
    { id: "b", name: "1/2 Pint Bottoms (flexi) ", vendorName: "Vendor B", inStockPacks: 0 },
    { id: "c", name: "Ham", vendorName: "Vendor A", inStockPacks: 3 },
    { id: "d", name: "Ham", vendorName: null, inStockPacks: 1 },
    { id: "e", name: "Turkey", vendorName: "Vendor A", inStockPacks: 2 },
  ];
  const marked = markSkuNameClashes(rows);
  it("keeps every SKU id (nothing dropped, order kept)", () => {
    expect(marked.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("flags only colliding names (trimmed, case-insensitive)", () => {
    expect(marked.map((r) => r.nameClash)).toEqual([true, true, true, true, false]);
  });
  it("labels collisions with the vendor, the rest bare", () => {
    expect(marked.map((r) => skuOptionName(r, "no vendor"))).toEqual([
      "1/2 pint bottoms (flexi) — Vendor A", "1/2 Pint Bottoms (flexi) — Vendor B", "Ham — Vendor A", "Ham — no vendor", "Turkey",
    ]);
  });
  it("the form and loader use it", () => {
    expect(readFileSync("components/production/ProductionForm.tsx", "utf8")).toContain('skuOptionName(s, t("production.form.no_vendor"))');
    expect(readFileSync("lib/production.ts", "utf8")).toContain("skus: markSkuNameClashes(");
    expect(en["production.form.no_vendor"]).toBeTruthy();
    expect(es["production.form.no_vendor"]).toBeTruthy();
  });
});
