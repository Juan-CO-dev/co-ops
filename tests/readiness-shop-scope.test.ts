/**
 * Catalog Phase 3a — SKU readiness is resolved per scope through 2a's resolver: a SKU priced ONLY in a shop's lane
 * is priced at that shop and unpriced in the default. The SKU list and the pack predicate are stubbed (this test is
 * about which prices and packs are asked for, at which scope); prices answer per scope like 2a's lane resolver.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC } from "./fixtures/recipe-versions-fixture";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
const askedScopes: Array<string | null> = [];
vi.mock("@/lib/admin/skus", () => ({
  loadSkus: async () => [{ id: "s-turkey", active: true, skuClass: null }],
  loadMeasureUnits: async () => [],
}));
vi.mock("@/lib/readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/readiness")>()),
  skuPackComplete: () => true,
}));
vi.mock("@/lib/admin/cost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/cost")>()),
  loadCurrentSkuPrices: async (_ids: string[], scope: string | null) => {
    askedScopes.push(scope);
    return scope === LOC ? new Map([["s-turkey", 80]]) : new Map<string, number>();
  },
}));
afterEach(() => { current = null; askedScopes.length = 0; });

const owner = { user: { id: "u-owner", role: "owner" }, role: "owner", level: 9, locations: [] } as unknown as AuthContext;

describe("SKU readiness per scope", () => {
  it("a shop-lane-only price is a price at that shop and missing in the default", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const { loadSkuReadinessMap } = await import("@/lib/admin/readiness-load");
    const global = JSON.stringify(await loadSkuReadinessMap(owner, null).then((m) => m.get("s-turkey") ?? null));
    const shop = JSON.stringify(await loadSkuReadinessMap(owner, LOC).then((m) => m.get("s-turkey") ?? null));
    expect(askedScopes).toEqual([null, LOC]);
    expect(global).toContain("missing_price");
    expect(shop).not.toContain("missing_price");
  });
});
