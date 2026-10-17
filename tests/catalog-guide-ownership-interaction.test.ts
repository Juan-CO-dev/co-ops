import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, post: vi.fn(), fetch: vi.fn(), lang: "en" }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial; return [h.slots[i], (v: unknown) => { h.slots[i] = typeof v === "function" ? v(h.slots[i]) : v; }]; },
  useMemo: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (key: string, params?: Record<string, string>) => {
  const value = ((h.lang === "es" ? es : en) as Record<string, string>)[key];
  let result = typeof value === "string" ? value : key;
  for (const [k, v] of Object.entries(params ?? {})) result = result.replaceAll(`{${k}}`, v);
  return result;
} }) }));
vi.mock("@/components/admin/vendors/shared", () => ({ postJson: h.post, resolveErrorKey: (key: string) => key }));
import { OrderGuidePanel, type OrderGuideInitial } from "@/components/admin/vendors/OrderGuidePanel";
type Node = { type: unknown; props: { children?: unknown; label?: string; onClick?: () => unknown; onChange?: (event: { target: { value: string } }) => unknown; value?: string } };
function nodes(tree: unknown): Node[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  const node = tree as Node;
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...nodes(node.props?.children)];
}
function text(tree: unknown): string {
  if (typeof tree === "string") return tree;
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (!tree || typeof tree !== "object") return "";
  return text((tree as Node).props?.children);
}
const initial = { guide: { guideId: "g", vendorId: "v", name: "Guide", updatedAt: "token", sections: [{ id: "s", name: "Section", position: 1, lines: ["a", "b"].map((skuId, i) => ({ id: `line-${skuId}`, position: i + 1, skuId, label: skuId, itemNumber: null, note: null })) }] }, skusNotOnGuide: [{ skuId: "c", name: "Unplaced", itemNumber: null }], onlyAt: { a: "North", b: "South", c: "West" } };
function render(data: OrderGuideInitial = initial, canEdit = true) { h.cursor = 0; return OrderGuidePanel({ vendorId: "v", vendorName: "Vendor", initial: data, canEdit }); }
beforeEach(() => { h.slots = []; h.cursor = 0; h.lang = "en"; h.post.mockReset(); h.fetch.mockReset(); vi.stubGlobal("fetch", h.fetch); });
afterEach(() => vi.unstubAllGlobals());
it.each(["en", "es"])("renders translated initial placed and bucket owners in %s", lang => {
  h.lang = lang;
  const content = text(render());
  for (const shop of ["North", "South", "West"]) expect(content).toContain(`${lang === "es" ? "Solo en" : "Only at"} ${shop}`);
});
it("omits labels when metadata is absent and keeps every line", () => {
  const content = text(render({ guide: initial.guide, skusNotOnGuide: initial.skusNotOnGuide }));
  expect(content).not.toContain("Only at");
  expect(content).toContain("Unplaced");
  expect(nodes(render({ guide: initial.guide, skusNotOnGuide: initial.skusNotOnGuide })).filter(n => n.type === "li")).toHaveLength(3);
});
it.each(["en", "es"])("saves the whole guide across shops and reloads placed and unplaced labels in %s", async lang => {
  h.lang = lang;
  let tree = render();
  const select = nodes(tree).find(n => n.type === "select")!;
  select.props.onChange!({ target: { value: "s" } });
  tree = render();
  h.post.mockResolvedValue({ ok: true });
  h.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...initial, onlyAt: { a: "Updated North", b: "Updated South", c: "Updated West" } }) });
  const saveLabel = (lang === "es" ? es : en)["admin.order_guide.save"];
  const save = nodes(tree).find(n => n.type === "button" && text(n).includes(saveLabel))!;
  await save.props.onClick!();
  const submitted = h.post.mock.calls[0]![1];
  expect(submitted.model.sections[0].lines.map((l: { skuId: string }) => l.skuId)).toEqual(["a", "b", "c"]);
  expect(submitted.expectedUpdatedAt).toBe("token");
  expect(h.fetch).toHaveBeenCalledWith("/api/admin/vendors/v/order-guide", expect.any(Object));
  for (const shop of ["Updated North", "Updated South", "Updated West"]) expect(text(render())).toContain(`${lang === "es" ? "Solo en" : "Only at"} ${shop}`);
});
it("read-only view shows owner labels without write controls", () => {
  const tree = render(initial, false);
  expect(text(tree)).toContain("Only at South");
  expect(nodes(tree).some(n => n.type === "button" || n.type === "select" || n.type === "input")).toBe(false);
});
