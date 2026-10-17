import { beforeEach, expect, it, vi } from "vitest";
import type { RecipeView } from "@/lib/recipes-shared";
const h = vi.hoisted(() => ({ state: new Map<string, unknown[]>(), component: "builder", cursor: 0, push: vi.fn(), refresh: vi.fn(), send: vi.fn(), step: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => { const key = h.component; const i = h.cursor++; const slots = h.state.get(key) ?? []; h.state.set(key, slots); if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (v: unknown) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (key: string) => key, language: "en" }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: h.step, requestStepUpGrant: h.step }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => h.send }));
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";
type Node = { type: unknown; props: Record<string, unknown> & { children?: unknown; onClick: () => void; onChange: (e: {target: {value: string}}) => void } };
const shop = "10000000-0000-4000-8000-000000000001";
const recipeId = "20000000-0000-4000-8000-000000000001";
const base = { skus: [], items: [], outputItems: [], unitOptions: [], measures: new Map(), level: 7, locationId: shop, prepSections: [{ slug: "prep", label: "Prep" }] };
function nodes(tree: unknown): Node[] { if (Array.isArray(tree)) return tree.flatMap(nodes); if (!tree || typeof tree !== "object" || !("props" in tree)) return []; const node = tree as Node; return [node, ...nodes(node.props.children)]; }
function render(recipe: RecipeView | null = null, canWrite = true, level = 7) { h.component = "builder"; h.cursor = 0; return RecipeBuilder({ ...base, recipe, canWrite, level }); }
function child(tree: unknown, name: string) { return nodes(tree).find(n => typeof n.type === "function" && n.type.name === name)!; }
function outputs() { const n = child(render(), "ProducesSection"); h.component = "outputs"; h.cursor = 0; return (n.type as (p: unknown) => unknown)(n.props); }
function field(tree: unknown, label: string) { const wrapper = nodes(tree).find(n => n.type === "label" && nodes(n.props.children).some(c => c.props.children === label))!; return nodes(wrapper).find(n => n.type === "input" || n.type === "select")!; }
function button(tree: unknown, label: string) { return nodes(tree).find(n => n.type === "button" && n.props.children === label)!; }
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
async function prepare() {
  field(render(), "recipes.builder.name_en").props.onChange({ target: { value: "  Sauce  " } });
  const consumes = child(render(), "ConsumesSection");
  (consumes.props.onAddDraftInput as (v: unknown) => void)({ kind: "sku", componentSkuId: "input", componentItemId: null, componentProductId: null, componentName: "Salt", quantity: 1, unit: "oz", eachContainerLabel: null, portioned: false });
  expect(field(outputs(), "recipes.output.pick_item").props.value).toBe("__new__");
  field(outputs(), "recipes.output.new_name").props.onChange({ target: { value: "Sauce bottle" } });
  field(outputs(), "recipes.output.new_name_es").props.onChange({ target: { value: "Botella de salsa" } });
  field(outputs(), "recipes.output.yield").props.onChange({ target: { value: "2" } });
  button(outputs(), "recipes.builder.save").props.onClick(); await flush();
  expect(h.send).not.toHaveBeenCalled(); // inline output is committed atomically with the recipe
  return render();
}
beforeEach(() => { vi.clearAllMocks(); h.state.clear(); h.step.mockResolvedValue("ok"); h.send.mockResolvedValue({ ok: true, data: { id: recipeId, outputItemIds: ["output"] } }); });
it("creates an inline output from empty inventory and navigates the returned identity with committed shop", async () => {
  const tree = await prepare(); button(tree, "recipes.draft.save").props.onClick(); await flush();
  expect(h.send).toHaveBeenCalledExactlyOnceWith("/api/admin/recipes/full", expect.objectContaining({ locationId: shop, name: "Sauce", outputs: [expect.objectContaining({ newItem: { name: "Sauce bottle", nameEs: "Botella de salsa", section: "prep", recommendedPar: null, recommendedParUnit: null }, yield: 2 })] }));
  expect(h.push).toHaveBeenCalledExactlyOnceWith(`/admin/catalog/recipe/${recipeId}?location=${shop}`);
});
it("failed save keeps the inline output and never redirects", async () => {
  const tree = await prepare(); h.send.mockResolvedValue({ ok: false, code: "name_taken" }); button(tree, "recipes.draft.save").props.onClick(); await flush();
  expect(h.push).not.toHaveBeenCalled();
  expect(field(render(), "recipes.builder.name_en").props.value).toBe("  Sauce  ");
  expect(child(render(), "ProducesSection").props.draftOutputs).toEqual([expect.objectContaining({ outputName: "Sauce bottle", yield: 2 })]);
});
const saved: RecipeView = { id: recipeId, ownerLocationId: shop, name: "Sauce", nameEs: null, recipeType: "production", batchYield: 1, directions: null, directionsEs: null, active: true, inputs: [], outputs: [], batchMode: false, shelfLifeDays: 5 };
it("owning GM edits inputs/output/yield; shared global inputs remain restricted and explicit capability denies all writes", () => {
  expect(child(render(saved), "ConsumesSection").props.canEdit).toBe(true);
  expect(child(render(saved), "ProducesSection").props.canEdit).toBe(true);
  expect(child(render({ ...saved, ownerLocationId: null }), "ConsumesSection").props.canEdit).toBe(false);
  expect(child(render(saved, false, 8), "ConsumesSection").props.canEdit).toBe(false);
  expect(child(render(saved, false, 8), "ProducesSection").props.canEdit).toBe(false);
});
it("batch output yield uses Tier E and the captured owner, refreshes after save, and locks disclosure while editing", async () => {
  const batch = { ...saved, batchMode: true, outputs: [{ id: "edge", outputItemId: "item", outputMenuItemId: null, outputName: "Sauce", yield: 2, outputContainerLabel: null, ozAllocShare: null, displayOrder: 0 }] };
  const section = () => { const n = child(render(batch), "ProducesSection"); h.component = "outputs"; h.cursor = 0; return (n.type as (p: unknown) => unknown)(n.props); };
  let row = child(section(), "RecipeOutputRow");
  (row.props.onEditingChange as (v: boolean) => void)(true);
  const disclosure = child(section(), "CollapsibleSection");
  (disclosure.props.onToggle as () => void)();
  expect(child(section(), "CollapsibleSection").props.open).toBe(true);
  row = child(section(), "RecipeOutputRow");
  await (row.props.onSaveYield as (v: number) => Promise<unknown>)(4);
  expect(h.step).toHaveBeenCalledExactlyOnceWith("E");
  expect(h.send).toHaveBeenCalledExactlyOnceWith(`/api/admin/recipes/${recipeId}/outputs`, { outputItemId: "item", yield: 4, expectedOwner: shop }, "PATCH");
  expect(h.refresh).toHaveBeenCalledOnce();
  h.step.mockResolvedValue("cancelled"); h.send.mockClear();
  expect(await (row.props.onSaveYield as (v: number) => Promise<unknown>)(5)).toEqual({ ok: false });
  expect(h.send).not.toHaveBeenCalled();
});
