/** Catalog Phase 1 — deep links land on the exact item, never a whole list. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prepItemHref, productHref, readFocusParam, skuCatalogHref } from "@/lib/admin/product-item-links-shared";

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
