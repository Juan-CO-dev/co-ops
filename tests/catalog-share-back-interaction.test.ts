import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown>, post: vi.fn(), step: vi.fn(), fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (v: unknown) => { h.slots[i] = typeof v === "function" ? v(h.slots[i]) : v; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i]; },
  useEffect: (effect: () => unknown) => { h.effects.push(effect); },
}));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: h.step }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => h.post }));
import { ShareWithEveryShop } from "@/components/catalog/ShareWithEveryShop";
import { ItemJobsStrip } from "@/components/catalog/ItemJobsStrip";
type Node = { type: unknown; props: { children?: unknown; type?: string; role?: string; disabled?: boolean; value?: string; onClick?: () => unknown; onChange?: (event: { target: { checked: boolean } }) => unknown } };
function find(tree: unknown, test: (node: Node) => boolean): Node | undefined {
  if (!tree || typeof tree !== "object") return;
  if (Array.isArray(tree)) { for (const child of tree) { const result = find(child, test); if (result) return result; } return; }
  const node = tree as Node;
  if (typeof node.type === "function") return find(node.type(node.props), test);
  return test(node) ? node : find(node.props?.children, test);
}
function body(element: ReturnType<typeof ShareWithEveryShop>) { return element && typeof element.type === "function" ? element.type(element.props) : element; }
function share(kind: "sku" | "recipe" | "menu-item" = "recipe") { h.cursor = 0; h.effects = []; return body(ShareWithEveryShop({ kind, id: "recipe", canShare: true })); }
const view = { skuId: "old", name: "Original", scope: "shop", owner: { ownerLocationId: null, ownerShopName: null, writeScope: "shop", canEdit: true, canShare: false }, canSwap: true, liveSwaps: [{ swapId: "swap", oldSkuId: "old", newSkuId: "new", startedAt: "2026-10-16" }] };
function strip() { h.cursor = 0; h.effects = []; return body(ItemJobsStrip({ view })); }
const button = (tree: unknown, key: string) => find(tree, node => node.type === "button" && node.props.children === key)!;
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
const preview = { name: "Prep", recipeId: "recipe", ownerShopId: "shop", ownerShopName: "Shop", token: "token", shopOnlyItems: [{ id: "item", name: "Output" }], shopOnlySkus: [{ id: "sku", name: "Input" }], makesSandwich: null, blockedBy: [] };
const back = { swapId: "swap", oldSku: { id: "old", name: "Original" }, newSku: { id: "new", name: "Replacement" }, shopId: "shop", shopName: "Shop", startedAt: "2026-10-16", goingBack: [{ recipeId: "recipe", recipeName: "Recipe", how: "restore" }], kept: [], primary: "restore", token: "back-token" };
beforeEach(() => { h.slots = []; h.cursor = 0; h.effects = []; vi.clearAllMocks(); h.step.mockResolvedValue("ok"); h.post.mockResolvedValue({ ok: true, data: { itemIds: ["item"], skuIds: ["sku"] } }); h.fetch.mockResolvedValue({ ok: true, json: async () => ({ preview }) }); vi.stubGlobal("fetch", h.fetch); });
afterEach(() => vi.unstubAllGlobals());
async function reviewShare() {
  button(share(), "catalog.jobs.share.preview").props.onClick!(); await flush();
  for (const id of ["sku", "item"]) find(share(), n => n.type === "input" && n.props.value === id)!.props.onChange!({ target: { checked: true } });
}
it("reviews dependencies and sends only the preview owner/token plus selected IDs at E", async () => {
  await reviewShare();
  const confirm = button(share(), "catalog.jobs.share.confirm"); expect(confirm.props.disabled).toBe(false);
  confirm.props.onClick!(); confirm.props.onClick!(); await flush();
  expect(h.step).toHaveBeenCalledWith("E"); expect(h.post).toHaveBeenCalledOnce();
  expect(h.post).toHaveBeenCalledWith("/api/admin/catalog/recipe/recipe/share", { expectedOwner: "shop", previewToken: "token", shareSkuIds: ["sku"], shareItemIds: ["item"] });
});
it("a stale or ownership refusal discards the reviewed share and requires another preview", async () => {
  await reviewShare(); h.post.mockResolvedValue({ ok: false, code: "ownership_changed" });
  button(share(), "catalog.jobs.share.confirm").props.onClick!(); await flush();
  expect(find(share(), n => n.type === "button" && n.props.children === "catalog.jobs.share.confirm")).toBeUndefined();
  expect(find(share(), n => n.props?.role === "alert")?.props.children).toBe("catalog.error.ownership_changed");
});
it("step-up cancellation retains reviewed selection without a write", async () => {
  await reviewShare(); h.step.mockResolvedValue("cancelled"); button(share(), "catalog.jobs.share.confirm").props.onClick!(); await flush();
  expect(h.post).not.toHaveBeenCalled(); expect(button(share(), "catalog.jobs.share.confirm").props.disabled).toBe(false);
});
it("an old identity's delayed preview cannot populate a remounted job", async () => {
  let finish!: (value: unknown) => void; h.fetch.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const tree = share(); const cleanup = h.effects[0]!() as () => void;
  button(tree, "catalog.jobs.share.preview").props.onClick!(); cleanup(); h.slots = []; share();
  finish({ ok: true, json: async () => ({ preview }) }); await flush();
  expect(find(share(), n => n.type === "button" && n.props.children === "catalog.jobs.share.confirm")).toBeUndefined();
});
it("Back applies its token, shows actual retained edits, and reloads the scoped journal", async () => {
  h.fetch.mockImplementation(async (_url: string, options: { method?: string }) => ({ ok: true, json: async () => options.method === "POST" ? { preview: back } : { swaps: [] } }));
  h.post.mockResolvedValue({ ok: true, data: { back: [], kept: ["recipe"], primary: "changed_since", grouping: "kept" } });
  button(strip(), "catalog.jobs.back.preview").props.onClick!(); await flush();
  button(strip(), "catalog.jobs.back.confirm").props.onClick!(); await flush();
  expect(h.step).toHaveBeenCalledWith("E");
  expect(h.post).toHaveBeenCalledWith("/api/admin/catalog/swaps/swap/back-to-normal", { previewToken: "back-token" });
  expect(h.fetch).toHaveBeenCalledWith("/api/admin/catalog/sku/old/swap?shopId=shop", { cache: "no-store", redirect: "manual" });
  expect(find(strip(), n => n.props?.role === "status")).toBeDefined();
  expect(find(strip(), n => n.type === "button" && n.props.children === "catalog.jobs.back.confirm")).toBeUndefined();
});
it("an uncertain Back write requires journal reload before another review", async () => {
  h.fetch.mockResolvedValue({ ok: true, json: async () => ({ preview: back }) });
  h.post.mockResolvedValue({ ok: false, code: "generic" });
  button(strip(), "catalog.jobs.back.preview").props.onClick!(); await flush();
  button(strip(), "catalog.jobs.back.confirm").props.onClick!(); await flush();
  expect(button(strip(), "catalog.jobs.back.preview").props.disabled).toBe(true);
  h.fetch.mockResolvedValue({ ok: true, json: async () => ({ swaps: [] }) });
  button(strip(), "catalog.jobs.back.reload").props.onClick!(); await flush();
  expect(find(strip(), n => n.type === "button" && n.props.children === "catalog.jobs.back.preview")).toBeUndefined();
});

it.each(["sku", "recipe", "menu-item"] as const)("acknowledges the real %s share response and refreshes", async kind => {
  const p = kind === "sku" ? { skuId: "recipe", name: "SKU", ownerShopId: "shop", token: "token", usedIn: [] }
    : { ...preview, recipeId: kind === "recipe" ? "recipe" : undefined, menuItemId: kind === "menu-item" ? "recipe" : undefined, shopOnlySkus: [], shopOnlyItems: [], ...(kind === "menu-item" ? { recipes: [], price: null } : {}) };
  h.fetch.mockResolvedValue({ ok: true, json: async () => ({ preview: p }) });
  h.post.mockResolvedValue({ ok: true, data: kind === "sku" ? { shared: true } : kind === "recipe" ? { itemIds: [], skuIds: [] } : { recipeIds: [], skuIds: [], itemIds: [] } });
  button(share(kind), "catalog.jobs.share.preview").props.onClick!(); await flush();
  button(share(kind), "catalog.jobs.share.confirm").props.onClick!(); await flush();
  expect(find(share(kind), n => n.props?.role === "status")?.props.children).toBe("catalog.jobs.share.success");
  expect(find(share(kind), n => n.props?.role === "alert")).toBeUndefined();
  expect(h.refresh).toHaveBeenCalledOnce();
});
