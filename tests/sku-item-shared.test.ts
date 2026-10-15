/** Catalog Phase 2b — the item page's pure surface. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATA_ERRAND_CODES } from "@/lib/sku-data-readiness";
import { fixItSection, PRICE_BASES, readJobParam, skuItemHref, sundayAnchoredDate, versionLabelKind } from "@/lib/catalog/sku-item-shared";
import { shopParamNames } from "@/lib/shop-context-shared";

const SKU = "7d0c1f2e-0000-4000-8000-000000000001";
const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";

describe("skuItemHref — lands on the item, optionally in a job", () => {
  it("plain, per shop, global, and with a job and a door request", () => {
    expect(skuItemHref(SKU)).toBe(`/admin/catalog/sku/${SKU}`);
    expect(skuItemHref(SKU, { shopId: SHOP })).toBe(`/admin/catalog/sku/${SKU}?location=${SHOP}`);
    expect(skuItemHref(SKU, { shopId: null })).toBe(`/admin/catalog/sku/${SKU}?location=global`);
    expect(skuItemHref(SKU, { shopId: SHOP, job: "pack", requestId: "r1" })).toBe(`/admin/catalog/sku/${SKU}?location=${SHOP}&job=pack&request=r1`);
    expect(skuItemHref(SKU, { job: "price" })).toBe(`/admin/catalog/sku/${SKU}?job=price`);
    expect(skuItemHref("a/b", { requestId: "x&y" })).toBe("/admin/catalog/sku/a%2Fb?request=x%26y");
  });
  it("readJobParam takes only the two jobs", () => {
    expect(readJobParam("pack")).toBe("pack");
    expect(readJobParam("price")).toBe("price");
    expect(readJobParam(["pack"])).toBeNull();
    expect(readJobParam("delete")).toBeNull();
  });
  it("the shop switcher's param is declared for the route (the one shop resolver reads it)", () => {
    expect(shopParamNames(`/admin/catalog/sku/${SKU}`)).toEqual(["location"]);
    expect(shopParamNames("/admin/catalog/sku/")).toEqual([]);
  });
});

describe("what the page says it is showing", () => {
  it("global view, a shop riding the default, a shop with its own pack and/or price", () => {
    expect(versionLabelKind(null, false, false)).toBe("global");
    expect(versionLabelKind(SHOP, false, false)).toBe("shop_default");
    expect(versionLabelKind(SHOP, true, false)).toBe("shop_own");
    expect(versionLabelKind(SHOP, false, true)).toBe("shop_own");
  });
});

describe("fix-it routing for every readiness errand", () => {
  it("each errand opens the section that fixes it", () => {
    expect(fixItSection("no_price")).toBe("price");
    expect(fixItSection("price_stale")).toBe("price");
    expect(fixItSection("raw_pack_contents_missing")).toBe("arrives");
    expect(fixItSection("no_countable_chain")).toBe("arrives");
    expect(fixItSection("no_order_unit")).toBe("arrives");
    expect(fixItSection("no_par")).toBe("ordering");
    expect(fixItSection("no_rhythm")).toBe("ordering");
    expect(fixItSection("no_vendor")).toBe("ordering");
    expect(fixItSection("weight_estimate")).toBe("arrives");
    expect(fixItSection("recipe_unresolved")).toBe("connections");
  });
  it("covers the WHOLE closed errand list — a new errand code must be given a section", () => {
    for (const code of DATA_ERRAND_CODES) expect(["price", "arrives", "ordering", "connections"]).toContain(fixItSection(code));
  });
});

describe("helpers", () => {
  it("the five price bases, and a Sunday-anchored date per day of week for formatWeekday", () => {
    expect(PRICE_BASES).toEqual(["per_case", "per_each", "per_lb", "per_dozen", "per_bundle"]);
    expect(sundayAnchoredDate(0)).toBe("2026-10-18");
    expect(sundayAnchoredDate(6)).toBe("2026-10-24");
    for (let dow = 0; dow < 7; dow++) expect(new Date(`${sundayAnchoredDate(dow)}T12:00:00Z`).getUTCDay()).toBe(dow);
  });
  it("PRICE_BASES is exactly the vendor_items.price_basis CHECK (0210)", () => {
    const src = readFileSync("supabase/migrations/0210_vendor_items_price_basis.sql", "utf8");
    const listed = /CHECK \(price_basis IN\s*\(([^)]*)\)\)/.exec(src)![1]!.split(",").map((v) => v.trim().replace(/'/g, ""));
    expect([...PRICE_BASES]).toEqual(listed);
  });
});
