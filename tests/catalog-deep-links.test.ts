/** Catalog Phase 1 — deep links land on the exact item, never a whole list. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prepItemHref, productHref, readFocusParam, skuCatalogHref } from "@/lib/admin/product-item-links-shared";
import { SKU_FILTER_ALL, skuFocusPatch } from "@/lib/admin/sku-focus-shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");

describe("the href builders", () => {
  it("a SKU link opens the row (?sku=) AND scrolls to it (#id)", () => {
    expect(skuCatalogHref("7d0c1f2e-0000-4000-8000-000000000001"))
      .toBe("/admin/skus?sku=7d0c1f2e-0000-4000-8000-000000000001#7d0c1f2e-0000-4000-8000-000000000001");
  });

  it("product and prep-item links keep the shapes their pages already read", () => {
    expect(productHref("ham")).toBe("/admin/products?product=ham#ham");
    expect(prepItemHref("slaw")).toBe("/admin/items?view=registry#slaw");
  });

  it("ids are URL-encoded", () => {
    expect(skuCatalogHref("a b")).toBe("/admin/skus?sku=a%20b#a%20b");
  });
});

describe("readFocusParam — a deep-link param as one plain id, or nothing", () => {
  it("accepts a uuid and a plain slug, trimmed", () => {
    expect(readFocusParam(" 7d0c1f2e-0000-4000-8000-000000000001 ")).toBe("7d0c1f2e-0000-4000-8000-000000000001");
    expect(readFocusParam("bacon_2")).toBe("bacon_2");
  });

  it("ignores arrays, absences, blanks and anything that is not a plain id", () => {
    expect(readFocusParam(undefined)).toBeNull();
    expect(readFocusParam(["a", "b"])).toBeNull();
    expect(readFocusParam("")).toBeNull();
    expect(readFocusParam("x\"><script>")).toBeNull();
    expect(readFocusParam("a".repeat(65))).toBeNull();
  });
});

describe("skuFocusPatch — how a param change patches the catalog's state (Astra r1 P2-6)", () => {
  const vendors = new Set(["v-baldor", "v-pfg"]);
  const none = { focusSkuId: null, vendorParam: null };

  it("first load with ?sku= expands that row and clears every filter that could hide it", () => {
    expect(skuFocusPatch(none, { focusSkuId: "A", vendorParam: null }, vendors))
      .toEqual({ expand: "A", vendorFilter: SKU_FILTER_ALL, resetOtherFilters: true });
  });

  it("sequential client navigation ?sku=A → ?sku=B patches again; the same params patch nothing", () => {
    const a = { focusSkuId: "A", vendorParam: null };
    expect(skuFocusPatch(a, { focusSkuId: "B", vendorParam: null }, vendors))
      .toEqual({ expand: "B", vendorFilter: SKU_FILTER_ALL, resetOtherFilters: true });
    expect(skuFocusPatch(a, a, vendors)).toBeNull();
  });

  it("a retained vendor filter that would hide the target clears itself", () => {
    expect(skuFocusPatch({ focusSkuId: null, vendorParam: "v-pfg" }, { focusSkuId: "B", vendorParam: "v-pfg" }, vendors))
      .toEqual({ expand: "B", vendorFilter: SKU_FILTER_ALL, resetOtherFilters: true });
  });

  it("?vendor= alone preselects a KNOWN vendor and ignores an unknown one", () => {
    expect(skuFocusPatch(none, { focusSkuId: null, vendorParam: "v-baldor" }, vendors))
      .toEqual({ expand: null, vendorFilter: "v-baldor", resetOtherFilters: false });
    expect(skuFocusPatch(none, { focusSkuId: null, vendorParam: "v-gone" }, vendors)).toBeNull();
  });
});

describe("the SKU catalog honours the deep link", () => {
  it("the page reads ?sku= and ?vendor= and only focuses a SKU it actually loaded", () => {
    const page = read("app/admin/skus/page.tsx");
    expect(page).toContain("readFocusParam(sp.sku)");
    expect(page).toContain("readFocusParam(sp.vendor)");
    expect(page).toContain("skus.some((s) => s.id === focusParam)");
    expect(page).toContain("focusSkuId={focusSkuId}");
    expect(page).toContain("initialVendorFilter={vendorParam}");
  });

  it("the client syncs params with the during-render prev-compare (never an effect), rings and scrolls", () => {
    const client = read("components/admin/skus/SkuCatalogClient.tsx");
    expect(client).toContain("if (seenParams.focusSkuId !== focusSkuId || seenParams.vendorParam !== initialVendorFilter)");
    expect(client).toContain("skuFocusPatch(seenParams,");
    expect(client).toContain("scrollIntoView");
    expect(client).toContain('s.id === focusSkuId ? " rounded-lg ring-4 ring-co-gold/60" : ""');
  });
});

describe("no catalog deep link lands on a whole list any more", () => {
  it("the items catalog links each SKU to its own row", () => {
    const src = read("components/admin/catalog/CatalogClient.tsx");
    expect(src).not.toContain('href="/admin/skus"');
    expect(src).toContain("href={skuCatalogHref(r.id)}");
    expect(read("lib/admin/catalog-shared.ts")).toContain("skus: CatalogEdgeRef[];");
  });

  it("vendor import's needs-a-person links name the matched SKU", () => {
    expect(read("lib/vendor-import.ts")).toContain("href: o.match.sku_id ? skuCatalogHref(o.match.sku_id) :");
    expect(read("components/admin/vendors/VendorImportPanel.tsx")).toContain("o.match.sku_id ? skuCatalogHref(o.match.sku_id) :");
  });

  it("the costing drawer links every name it blames", () => {
    const src = read("components/admin/menu-costing/MenuCostingClient.tsx");
    expect(src).toContain("href={skuCatalogHref(id)}");
    expect(src).toContain("prepItemHref)");
    expect(src).toContain("productHref,");
  });
});
