import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, save: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial; return [h.slots[i], (v: unknown) => { h.slots[i] = typeof v === "function" ? v(h.slots[i]) : v; }]; } }));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { RecipeOutputRow } from "@/components/admin/recipes/RecipeOutputRow";
type Node = { type: unknown; props: { children?: unknown; onClick: () => void; onChange: (e: { target: { value: string } }) => void; value: unknown; role?: string } };
function nodes(tree: unknown): Node[] { if (Array.isArray(tree)) return tree.flatMap(nodes); if (!tree || typeof tree !== "object" || !("props" in tree)) return []; const n = tree as Node; return [n, ...nodes(n.props.children)]; }
function render(canEdit = true) { h.cursor = 0; return RecipeOutputRow({ output: { id: "out", outputItemId: "item", outputMenuItemId: null, outputName: "Sauce", yield: 2, outputContainerLabel: "bottle", ozAllocShare: null, displayOrder: 0 }, canEdit, onRemove: vi.fn(), onSaveYield: h.save }); }
function click(label: string) { nodes(render()).find(n => n.type === "button" && n.props.children === label)!.props.onClick(); }
function change(value: string) { nodes(render()).find(n => n.type === "input")!.props.onChange({ target: { value } }); }
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
beforeEach(() => { h.slots = []; h.cursor = 0; vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true }); });
it("changes a batch output yield in place without removing the output", async () => {
  click("recipes.output.edit_yield"); change("4"); click("recipes.builder.save"); await flush();
  expect(h.save).toHaveBeenCalledExactlyOnceWith(4);
  expect(nodes(render()).some(n => n.type === "input")).toBe(false);
});
it("refused or cancelled yield save retains the typed yield and names refusal", async () => {
  h.save.mockResolvedValue({ ok: false, error: "catalog.error.ownership_changed" });
  click("recipes.output.edit_yield"); change("4"); click("recipes.builder.save"); await flush();
  expect(nodes(render()).find(n => n.type === "input")!.props.value).toBe("4");
  expect(nodes(render()).find(n => n.props.role === "alert")!.props.children).toBe("catalog.error.ownership_changed");
});
it("invalid yield never calls the writer; read-only rows offer no edit", async () => {
  click("recipes.output.edit_yield"); change("0"); click("recipes.builder.save"); await flush();
  expect(h.save).not.toHaveBeenCalled();
  expect(nodes(render()).find(n => n.props.role === "alert")!.props.children).toBe("recipes.error.invalid_yield");
  expect(nodes(render(false)).some(n => n.type === "button")).toBe(false);
});
