import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (key: string, params?: { shop?: string }) => key === "catalog.only_at_shop" ? `Only at ${params?.shop}` : key }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => vi.fn() }));
import { SkuCatalogClient } from "@/components/admin/skus/SkuCatalogClient";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { initialSkuLocationChoice, skuLocationPayload } from "@/components/admin/skus/SkuBuilder";

const A = { id: "shop-a", name: "Shop A" };
const B = { id: "shop-b", name: "Shop B" };

describe("SKU ownership choices", () => {
  it("defaults a GM with one membership to that shop and requires a choice with several", () => {
    expect(initialSkuLocationChoice({ creationScopes: [A], canCreateGlobal: false })).toBe(A.id);
    expect(initialSkuLocationChoice({ creationScopes: [A, B], canCreateGlobal: false })).toBe("");
  });

  it("offers the explicit global lane only to MoO+", () => {
    expect(initialSkuLocationChoice({ creationScopes: [A, B], canCreateGlobal: true })).toBe("__global__");
    expect(skuLocationPayload({ isEdit: false, canMoveOwner: false, choice: "__global__" })).toEqual({ locationId: null });
  });

  it("never moves an existing SKU and sends only an authorized share", () => {
    expect(skuLocationPayload({ isEdit: true, canMoveOwner: false, initialLocationId: A.id, choice: B.id })).toEqual({});
    expect(skuLocationPayload({ isEdit: true, canMoveOwner: true, initialLocationId: A.id, choice: A.id })).toEqual({});
    expect(skuLocationPayload({ isEdit: true, canMoveOwner: true, initialLocationId: A.id, choice: B.id })).toEqual({});
    expect(skuLocationPayload({ isEdit: true, canMoveOwner: true, initialLocationId: A.id, choice: "__global__" })).toEqual({ locationId: null });
  });

  it("keeps full list locations separate from authorized creation scopes", () => {
    const page = readFileSync("app/admin/skus/page.tsx", "utf8");
    expect(page).toContain("locations={locations}");
    expect(page).toContain("creationScopes={creationScopes}");
    expect(page).toContain("locations.filter((location) => auth.locations.includes(location.id))");
  });

  it("lets a GM edit the pack only for a SKU owned by one of their authorized shops", () => {
    const builder = readFileSync("components/admin/skus/SkuBuilder.tsx", "utf8");
    expect(builder).toContain("creationScopes.some((scope) => scope.id === initial.locationId)");
    expect(builder).toContain("!canEditOwnedPack && !canChangeGlobalPack");
  });
});

it("offers no edit owner selector and names the share action", () => {
  const builder = readFileSync("components/admin/skus/SkuBuilder.tsx", "utf8");
  expect(builder).toContain("{isEdit ? (");
  expect(builder).not.toContain("isEdit && !canMoveOwner ?");
  expect(builder).toContain('t("admin.skus.share_all_shops")');
});

it("renders the owning shop even when an org-wide row has no readiness badge", () => {
  const html = renderToStaticMarkup(createElement(SkuCatalogClient, {
    skus: [{ id: "owned", name: "Owned SKU", active: true, locationId: A.id, locationName: A.name, skuClass: "raw" }],
    vendors: [], locations: [A, B], creationScopes: [], packFormats: [], measureUnits: [], skuCost: {}, skuLedger: {},
    skuConsumption: {}, skuReadiness: {}, skuDataShops: [], chainsBySku: {}, chainVersionBySku: {}, chainUnverifiedBySku: {},
    overlaysBySku: {}, products: [], productIdBySku: {}, parsFieldsReady: false, actorLevel: 9, canManage: false,
  } as unknown as Parameters<typeof SkuCatalogClient>[0]));
  expect(html).toContain("Only at Shop A");
});
