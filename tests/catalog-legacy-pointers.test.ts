/** Catalog Phase 2b — a refused global change on /admin/skus points at the item page (the gate itself is 2a's). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { shopPackJobOffered } from "@/components/admin/skus/shared";

const E = en as Record<string, string>;
const S = es as Record<string, string>;

describe("the SKU screens point at the item page", () => {
  it("the cost panel links to the price job when the global price is refused", () => {
    const panel = readFileSync("components/admin/skus/SkuCostPanel.tsx", "utf8");
    expect(panel).toContain('errCode === "global_requires_moo"');
    expect(panel).toContain('skuItemHref(skuId, { job: "price" })');
  });
  it("the read-only pack line (2a's global boundary) links GMs/AGMs to the item page's pack job — this shop's version", () => {
    const builder = readFileSync("components/admin/skus/SkuBuilder.tsx", "utf8");
    expect(builder.match(/shopPackJobOffered\(globalPackLocked, canEditShopVersion\)/g)?.length).toBe(1);
    expect(builder.match(/<ShopPackJobLink skuId=\{initial!\.id\} \/>/g)?.length).toBe(2); // the chained and the unchained read-only lines
    expect(builder).toContain('skuItemHref(skuId, { job: "pack" })');
  });
  it("the pages decide who is offered it with THE catalog role rule (the social media manager never)", () => {
    expect(readFileSync("app/admin/skus/page.tsx", "utf8")).toContain("canEditShopVersion={catalogWriteRoleAllowed(auth.user.role, level)}");
    expect(readFileSync("app/admin/vendors/[id]/page.tsx", "utf8")).toContain("canEditShopVersion={catalogWriteRoleAllowed(auth.user.role, level)}");
  });
  it("offered only when the global pack is locked for this actor AND the actor may write a shop version", () => {
    expect(shopPackJobOffered(true, true)).toBe(true);
    expect(shopPackJobOffered(true, false)).toBe(false);
    expect(shopPackJobOffered(false, true)).toBe(false);
  });
  it("the refusal and the link name the item page, in both languages", () => {
    expect(E["admin.skus.error.global_requires_moo"]).toContain("item page");
    expect(S["admin.skus.error.global_requires_moo"]).toContain("página del artículo");
    for (const k of ["admin.skus.chain.use_item_page", "admin.skus.cost.use_item_page"]) {
      expect(E[k], k).toBeTruthy();
      expect(S[k], k).toBeTruthy();
    }
  });
});
