import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const h = vi.hoisted(() => ({ owner: "10000000-0000-4000-8000-000000000001" as string | null, share: false, edit: true, level: 7, catalog: vi.fn(), readiness: vi.fn() }));
const id = "20000000-0000-4000-8000-000000000001";
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("404"); }, redirect: () => { throw Error("redirect"); } }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({ level: h.level, locations: [h.owner], user: { role: h.level === 8 ? "moo" : h.level === 6 ? "agm" : "gm", language: "en" } }) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { const q = { select: () => q, eq: () => q, order: () => q, returns: async () => ({ data: [{ id: h.owner }], error: null }) }; return { from: () => q }; } }));
vi.mock("@/lib/shop-context", () => ({ resolveShopId: async () => h.owner }));
vi.mock("@/lib/catalog/recipe-item", () => ({ loadRecipeItemView: async () => ({ recipe: { id, name: "Prep", recipeType: "production" }, owner: h.owner ? { locationId: h.owner, name: "Owner shop" } : null, scope: h.owner, can: { editOwned: h.edit, share: h.share }, makes: [{ id: "out", name: "Sauce", yield: 2, costHere: 3.25 }] }) }));
vi.mock("@/lib/recipes", () => ({ RECIPE_READ_MIN: 6, loadRecipe: async () => ({ id, ownerLocationId: h.owner, inputs: [], outputs: [] }) }));
vi.mock("@/lib/admin/recipe-builder-data", () => ({ loadRecipeBuilderCatalog: h.catalog, loadRecipePrepSections: async () => [], loadRecipeBuilderScope: async () => ({ scope: h.owner, shops: [], allowGlobal: false }) }));
vi.mock("@/lib/admin/readiness-load", () => ({ loadGraphReadiness: h.readiness }));
vi.mock("@/components/admin/recipes/RecipeBuilder", () => ({ RecipeBuilder: () => null }));
vi.mock("@/components/catalog/RecipeItemClient", () => ({ RecipeItemClient: () => null }));
vi.mock("@/components/catalog/ShareWithEveryShop", () => ({ ShareWithEveryShop: () => null }));
import CatalogPage from "@/app/admin/catalog/recipe/[id]/page";
import LegacyPage from "@/app/admin/recipes/[id]/page";
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";
import { RecipeItemClient } from "@/components/catalog/RecipeItemClient";
import { ShareWithEveryShop } from "@/components/catalog/ShareWithEveryShop";
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const el = tree as ReactElement<Record<string, unknown>>;
  return [el, ...nodes(el.props.children)];
}
beforeEach(() => { vi.clearAllMocks(); h.owner = "10000000-0000-4000-8000-000000000001"; h.share = false; h.edit = true; h.level = 7;
  h.catalog.mockResolvedValue({ skus: [{ id: "owned-input" }], items: [], outputItems: [{ id: "owned-output" }], products: [], unitOptions: [], measures: new Map(), activeMeasureLabels: [] });
  h.readiness.mockResolvedValue({ recipeReadiness: new Map([[id, { status: "incomplete", reasons: [] }]]) });
});
it.each(["catalog", "legacy"])("reopens owned inputs, outputs and readiness in owner scope through %s", async route => {
  const tree = await (route === "catalog" ? CatalogPage : LegacyPage)({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ location: "foreign" }) });
  const builder = nodes(tree).find(n => n.type === RecipeBuilder)!;
  expect(builder).toBeDefined();
  expect(builder.props.locationId).toBe(h.owner);
  expect(builder.props.outputItems).toEqual([{ id: "owned-output" }]);
  expect(builder.props.skus).toEqual([{ id: "owned-input" }]);
  expect(builder.props.readiness).toEqual({ status: "incomplete", reasons: [] });
  expect(h.catalog).toHaveBeenCalledWith(expect.anything(), h.owner, h.owner);
  expect(h.readiness).toHaveBeenCalledWith(expect.anything(), h.owner);
  if (route === "catalog") expect(nodes(tree).some(n => n.type === RecipeItemClient)).toBe(false);
  else expect(nodes(tree).some(n => n.props.href === `/admin/catalog/recipe/${id}?location=${h.owner}`)).toBe(true);
});
it("keeps shared 3b body and does not load owned editor data", async () => {
  h.owner = null;
  const tree = await CatalogPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ location: "global" }) });
  expect(nodes(tree).some(n => n.type === RecipeItemClient)).toBe(true);
  expect(nodes(tree).some(n => n.type === RecipeBuilder)).toBe(false);
  expect(h.catalog).not.toHaveBeenCalled();
});
it("uses server capability for editing and shares only the approved identity", async () => {
  h.level = 8; h.edit = false; h.share = true;
  const tree = await CatalogPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
  expect(nodes(tree).find(n => n.type === RecipeBuilder)!.props.canWrite).toBe(false);
  expect(nodes(tree).find(n => n.type === ShareWithEveryShop)!.props).toMatchObject({ kind: "recipe", id, canShare: true });
});
