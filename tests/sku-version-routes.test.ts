/** Catalog Phase 2a — the version routes: Tier E, a 6 floor outside, the lib inside, explicit fields. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// W18/B107: the pack's Back to default goes through the previewed atomic apply (lib/catalog/sku-item.ts,
// typed CatalogItemError), and /pack/restore refuses preview_required (Restore saves through /pack/apply).
const ROUTES = {
  "app/api/admin/catalog/sku/[id]/pack/route.ts": ["saveSkuPackVersion(", "SkuVersionError"],
  "app/api/admin/catalog/sku/[id]/pack/back-to-default/route.ts": ["applyPackBackToDefault(", "CatalogItemError"],
  "app/api/admin/catalog/sku/[id]/pack/restore/route.ts": ['jsonError(409, "preview_required")', null],
  "app/api/admin/catalog/sku/[id]/price/route.ts": ["saveSkuPrice(", "SkuVersionError"],
  "app/api/admin/catalog/sku/[id]/price/back-to-default/route.ts": ["retireShopPriceLane(", "SkuVersionError"],
} as const;

describe.each(Object.entries(ROUTES))("%s", (file, [call, errorClass]) => {
  const src = readFileSync(file, "utf8");
  it("asserts Tier E after the session and a level-6 outer floor", () => {
    expect(src).toContain('assertStepUp(ctx, "E")');
    expect(src).toContain("ctx.level < SHOP_VERSION_WRITE_MIN");
    expect(src.indexOf("requireSession(")).toBeLessThan(src.indexOf('assertStepUp(ctx, "E")'));
  });
  it("delegates the real gate to the lib (no shop bind of its own — D2 lives in the lib) and maps its typed error", () => {
    expect(src).toContain(call);
    if (errorClass) expect(src).toContain(`instanceof ${errorClass}`);
    expect(src).not.toContain("lockLocationContext");
  });
  it("accepts a uuid shop or null, nothing else", () => {
    expect(src).toContain("UUID_RE");
  });
});
