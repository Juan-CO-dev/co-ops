import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), swap: vi.fn(), back: vi.fn(), sku: vi.fn(), recipe: vi.fn(), menu: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/catalog/swap-vendor", () => ({ previewSkuSwap: mocks.swap, previewBackToNormal: mocks.back }));
vi.mock("@/lib/catalog/share", () => ({ previewShareSku: mocks.sku, previewShareRecipe: mocks.recipe, previewShareMenuItem: mocks.menu }));
const id = "11111111-1111-4111-8111-111111111111", shop = "22222222-2222-4222-8222-222222222222";
const named = { id, name: "Visible name" };
const request = { oldSkuId: id, newSkuId: shop, scope: shop, mode: "for_now", productName: "Normalized", productNameEs: null, note: null };
const line = { componentSkuId: id, componentItemId: null, componentProductId: null, quantity: 2, unit: "oz", eachContainerLabel: null, portioned: false };
const swap = { request, oldSku: { ...named, vendorName: "Vendor" }, newSku: { ...named, id: shop, vendorName: null }, scopeName: "Shop", product: { kind: "existing", ...named }, recipes: [{ recipeId: id, recipeName: "Recipe", changes: [{ position: 1, before: line, after: { ...line, componentSkuId: shop }, converted: true }] }], refused: [{ recipeId: id, recipeName: "Other", position: 2, reason: "unit_unknown" }], followsPrimary: [named], untouchedShops: [named], ordering: { scope: shop, primarySkuId: shop, parsChanged: false, messageKey: "catalog.swap.ordering_consequence" }, costs: [{ menuItemId: id, name: "Menu", nameEs: null, before: 2, after: 3 }], token: "full-evidence-token" };
const common = { name: "Visible name", ownerShopId: shop, ownerShopName: "Shop", token: "full-evidence-token" };
const sku = { ...common, skuId: id, usedIn: [named], ownerKeepsOwnPack: true, ownerKeepsOwnPrice: true };
const recipe = { ...common, recipeId: id, shopOnlyItems: [named], shopOnlySkus: [named], makesSandwich: named, blockedBy: [{ ...named, shopName: "Other shop", kind: "item", producers: [{ ...named, ownerLocationId: shop }] }] };
const menu = { ...common, menuItemId: id, nameEs: "Nombre", price: 10, recipes: [named], shopOnlyItems: [named], shopOnlySkus: [named], blockedBy: recipe.blockedBy };
const back = { swapId: id, oldSku: named, newSku: named, shopId: shop, shopName: "Shop", startedAt: "2026-10-16", goingBack: [{ recipeId: id, recipeName: "Recipe", how: "retire" }], kept: [{ recipeId: shop, recipeName: "Edited recipe" }], primary: "changed_since", token: "full-evidence-token" };
// Unknown fields at every depth must never ride along with future engine additions.
function withEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withEvidence);
  if (value && typeof value === "object") return { ...Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withEvidence(v)])), internalEvidence: "PRIVATE" };
  return value;
}
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ level: 8, locations: [shop], user: { id, role: "moo", language: "en" } }); });
const cases = [
  { name: "swap", fixture: swap, mock: mocks.swap, load: () => import("../app/api/admin/catalog/sku/[id]/swap/preview/route") },
  { name: "sku share", fixture: sku, mock: mocks.sku, load: () => import("../app/api/admin/catalog/sku/[id]/share/preview/route") },
  { name: "recipe share", fixture: recipe, mock: mocks.recipe, load: () => import("../app/api/admin/catalog/recipe/[id]/share/preview/route") },
  { name: "menu share", fixture: menu, mock: mocks.menu, load: () => import("../app/api/admin/catalog/menu-item/[id]/share/preview/route") },
  { name: "back", fixture: back, mock: mocks.back, load: () => import("../app/api/admin/catalog/swaps/[swapId]/back-to-normal/preview/route") },
];
it.each(cases)("$name serializes only public consequences, retaining request and evidence token", async ({ name, fixture, mock, load }) => {
  mock.mockResolvedValue({ ...(withEvidence(fixture) as object), snapshot: { private: true }, productSnapshot: { private: true }, recipeSnapshots: [{ private: true }] });
  const { POST } = await load();
  const response = await POST(new NextRequest("http://localhost/api/admin/catalog/preview", { method: "POST", body: JSON.stringify(request) }), { params: Promise.resolve({ id, swapId: id }) });
  expect(response.status).toBe(200);
  const { preview } = await response.json();
  if (name === "swap") {
    expect(preview.ordering.message).toEqual(expect.any(String));
    delete preview.ordering.message;
    expect(preview.request).toEqual(request);
  }
  expect(preview).toEqual(fixture);
  expect(preview.token).toBe("full-evidence-token");
});
