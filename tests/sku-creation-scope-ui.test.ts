import { describe, expect, it } from "vitest";
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

  it("never silently moves an existing SKU and sends only an authorized real move", () => {
    expect(skuLocationPayload({ isEdit: true, canMoveOwner: false, initialLocationId: A.id, choice: B.id })).toEqual({});
    expect(skuLocationPayload({ isEdit: true, canMoveOwner: true, initialLocationId: A.id, choice: A.id })).toEqual({});
    expect(skuLocationPayload({ isEdit: true, canMoveOwner: true, initialLocationId: A.id, choice: B.id })).toEqual({ locationId: B.id });
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
