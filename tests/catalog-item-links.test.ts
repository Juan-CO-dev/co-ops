/** Catalog Phase 2b — every way in lands on the item page (spec §5 "Deep links always land on the item, never a list"). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(f, "utf8");

describe("ways in", () => {
  it("each /admin/skus row links to its item page", () => {
    expect(read("components/admin/skus/SkuCatalogClient.tsx")).toContain("href={skuItemHref(s.id, { shopId: itemShopId ?? undefined })}");
  });
  it("/admin/skus lists the open door reports, each opening the job on the item — only for a reviewer role", () => {
    const page = read("app/admin/skus/page.tsx");
    expect(page).toContain("<PackChangeRequestsList");
    expect(page).toContain("packRequestReviewAllowed(auth) ? await loadOpenPackChangeRequests(auth,");
    expect(read("components/catalog/PackChangeRequestsList.tsx")).toContain('skuItemHref(r.skuId, { shopId: r.locationId, job: "pack", requestId: r.id })');
  });
  it("the vendor import's 'needs a person' opens 'It arrives differently now' on the matched SKU", () => {
    expect(read("lib/vendor-import.ts")).toContain('href: o.match.sku_id ? skuItemHref(o.match.sku_id, { shopId: null, job: "pack" }) :');
    expect(read("components/admin/vendors/VendorImportPanel.tsx")).toContain('o.match.sku_id ? skuItemHref(o.match.sku_id, { shopId: null, job: "pack" }) :');
  });
});
