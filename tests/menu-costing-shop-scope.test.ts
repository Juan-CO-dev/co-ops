/**
 * Catalog Phase 2a (lead decision) — the costing board follows the selected shop: its packs AND its
 * prices; "All shops" is the global view, labelled as global prices.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { buildRecipeGraph } from "@/lib/prep-consumption-graph";

const seen = vi.hoisted(() => ({ graph: [] as unknown[], prices: [] as unknown[] }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q, eq: () => q, not: () => q, is: () => q, in: () => q, order: () => q,
    returns: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  });
  return { from: () => q };
} }));
vi.mock("@/lib/prep-consumption", () => ({
  loadRecipeGraph: async (opts?: unknown) => { seen.graph.push(opts ?? null); return buildRecipeGraph([], new Map(), new Map()); },
}));
vi.mock("@/lib/admin/cost", () => ({
  COST_READ_MIN: 6,
  loadCurrentSkuPrices: async (_ids: string[], scope: unknown) => { seen.prices.push(scope); return new Map(); },
}));
vi.mock("@/lib/menu-item-shop", () => ({ loadLiveMenuItemShopSettings: async () => new Map() }));
import { loadMenuCostingBoard, MenuCostingError } from "@/lib/admin/menu-costing";

const A = "6f1d2c3e-0000-4000-8000-00000000000a";
const B = "6f1d2c3e-0000-4000-8000-00000000000b";
const actor = (role: string, locations: string[]) => ({ user: { id: "u", role }, role, locations }) as unknown as AuthContext;

beforeEach(() => { seen.graph = []; seen.prices = []; });

describe("loadMenuCostingBoard — the selected shop's packs AND prices", () => {
  it("All shops (the default, and the CSV export): the global graph and global prices, labelled", async () => {
    const board = await loadMenuCostingBoard(actor("owner", []));
    expect(seen.graph).toEqual([null]);
    expect(seen.prices).toEqual([null]);
    expect(board.scope).toBeNull();
  });
  it("a shop: that shop's graph (packs + product resolution) and that shop's prices", async () => {
    const board = await loadMenuCostingBoard(actor("gm", [A]), { scope: A });
    expect(seen.graph).toEqual([{ locationId: A }]);
    expect(seen.prices).toEqual([A]);
    expect(board.scope).toBe(A);
  });
  it("a GM cannot read another shop's board", async () => {
    await expect(loadMenuCostingBoard(actor("gm", [A]), { scope: B })).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(loadMenuCostingBoard(actor("gm", [A]), { scope: B })).rejects.toBeInstanceOf(MenuCostingError);
  });
});

describe("the page: switcher through the one shop resolver, labelled global view", () => {
  const src = readFileSync("app/admin/menu-costing/page.tsx", "utf8");
  it("resolves the shop through resolveShopId over the shops the viewer may read, and passes it on", () => {
    expect(src).toContain('shopParamFor("/admin/menu-costing", searchParamValues(sp))');
    expect(src).toContain("await resolveShopId(shops.map((s) => s.id), explicit ?? null)");
    expect(src).toContain("loadMenuCostingBoard(auth, { scope })");
    expect(src).toContain('"admin.menu_costing.scope_all"');
  });
});
