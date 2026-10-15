/** Catalog Phase 2b — the item page's routes: writes are Tier E; the preview is a read; explicit fields; the target is posted, never inferred. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WRITES = {
  "app/api/admin/catalog/sku/[id]/pack/apply/route.ts": "applyPackChange(",
  "app/api/admin/catalog/sku/[id]/price/apply/route.ts": "applyPriceChange(",
  "app/api/admin/catalog/sku/[id]/price-basis/route.ts": "setSkuPriceBasis(",
  "app/api/admin/catalog/sku/[id]/pack-requests/[requestId]/dismiss/route.ts": "dismissPackChangeRequest(",
} as const;

describe.each(Object.entries(WRITES))("%s", (file, call) => {
  const src = readFileSync(file, "utf8");
  it("Tier E after the session, then the lib", () => {
    expect(src).toContain('assertStepUp(ctx, "E")');
    expect(src.indexOf("requireSession(")).toBeLessThan(src.indexOf('assertStepUp(ctx, "E")'));
    expect(src).toContain(call);
  });
});

describe("the saves carry their target and the preview they were shown", () => {
  it("pack apply: target, conversions and the token through the strict parsers", () => {
    const src = readFileSync("app/api/admin/catalog/sku/[id]/pack/apply/route.ts", "utf8");
    for (const s of ["parseTarget(b.target)", "parseConversions(b.conversions)", "parseLevels(b.levels)", "previewToken"]) expect(src).toContain(s);
  });
  it("price apply: target and the token", () => {
    const src = readFileSync("app/api/admin/catalog/sku/[id]/price/apply/route.ts", "utf8");
    for (const s of ["parseTarget(b.target)", "previewToken"]) expect(src).toContain(s);
  });
  it("dismiss binds the SKU in its path", () => {
    expect(readFileSync("app/api/admin/catalog/sku/[id]/pack-requests/[requestId]/dismiss/route.ts", "utf8"))
      .toContain("dismissPackChangeRequest(ctx, { requestId, skuId: id })");
  });
});

describe("the preview is a read", () => {
  const src = readFileSync("app/api/admin/catalog/sku/[id]/preview/route.ts", "utf8");
  it("no step-up, no write, both kinds, the target and the level parsers", () => {
    expect(src).not.toContain("assertStepUp");
    expect(src).toContain("computePackPreview(");
    expect(src).toContain("computePricePreview(");
    expect(src).toContain("parseLevels(");
    expect(src).toContain("parseTarget(b.target)");
  });
});

describe("every route maps its lib's typed refusal to its own code (the client shows catalog.error.<code>)", () => {
  for (const file of [...Object.keys(WRITES), "app/api/admin/catalog/sku/[id]/preview/route.ts"]) {
    it(file, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toMatch(/if \(e instanceof (CatalogItemError|PackChangeRequestError)\) return jsonError\(e\.status, e\.code/);
      expect(src).toContain('if (!UUID_RE.test(id)');
    });
  }
});
