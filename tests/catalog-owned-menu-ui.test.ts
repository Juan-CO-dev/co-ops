import { beforeEach, expect, it, vi } from "vitest";
import type { MenuItemPageView } from "@/lib/catalog/recipe-item-shared";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown>, read: vi.fn(), post: vi.fn(), step: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial; return [h.slots[i], (value: unknown) => { h.slots[i] = value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i]; },
  useEffect: (fn: () => unknown) => { h.effects.push(fn); },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (key: string) => key, language: "en" }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: h.step }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => h.post }));
vi.mock("@/components/admin/vendors/shared", () => ({ postJson: h.read }));
import { OwnedSandwichClient } from "@/components/catalog/OwnedSandwichClient";
import { MenuPreviewPanel } from "@/components/catalog/MenuPreviewPanel";
import { ToastLinkSection } from "@/components/catalog/ToastLinkSection";
import { ShareWithEveryShop } from "@/components/catalog/ShareWithEveryShop";
type Node = { type: unknown; props: { [key: string]: unknown; children?: unknown; onClick: () => void; onSave: () => void; onChange: (event: { target: { value: string } }) => void } };
const view: MenuItemPageView = { owner: { locationId: "shop", name: "Shop" }, item: { id: "menu", name: "Sandwich", nameEs: null, menuPrice: 10, section: null }, shops: [], scope: "shop", scopeName: "Shop", can: { editShop: false, promote: false, editOwned: true, share: false, shopsToEdit: [] }, here: { settingId: null, price: null, soldHere: true, nameOverride: null, nameOverrideEs: null, name: "Sandwich", nameEs: null, typedPrice: 10 }, cost: 4, recipe: { id: "recipe", name: "Recipe" }, toastLinks: 0, history: [] };
function render(current = view) { h.cursor = 0; h.effects = []; return OwnedSandwichClient({ view: current }) as Node; }
function find(node: unknown, predicate: (n: Node) => boolean): Node | undefined {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, predicate); if (result) return result; } return; }
  const n = node as Node; return predicate(n) ? n : find(n.props?.children, predicate);
}
const button = (label: string) => (n: Node) => n.type === "button" && n.props.children === label;
const input = (n: Node) => n.type === "input";
const panel = (n: Node) => n.type === MenuPreviewPanel;
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
async function preview() {
  find(render(), input)!.props.onChange({ target: { value: "12" } });
  find(render(), button("catalog.menu.preview.title"))!.props.onClick(); await flush(); return render();
}
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; vi.clearAllMocks(); h.step.mockResolvedValue("ok");
  h.read.mockResolvedValue({ ok: true, data: { preview: { kind: "owned_price", menuItemId: "menu", shopId: "shop", token: "token" } } });
  h.post.mockResolvedValue({ ok: true, data: { ok: true } });
});
it("price preview retains original owner and baseline; save requests Tier E and exact preview token", async () => {
  const tree = await preview();
  const change = { kind: "owned_price", expectedOwner: "shop", expectedPrice: 10, price: 12 };
  expect(h.read).toHaveBeenCalledWith("/api/admin/catalog/menu-item/menu/preview", { change });
  find(tree, panel)!.props.onSave(); await flush();
  expect(h.step).toHaveBeenCalledExactlyOnceWith("E");
  expect(h.post).toHaveBeenCalledWith("/api/admin/catalog/menu-item/menu/apply", { change, previewToken: "token" });
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("cancelled password keeps draft and sends no write", async () => {
  h.step.mockResolvedValue("cancelled"); find(await preview(), panel)!.props.onSave(); await flush();
  expect(h.post).not.toHaveBeenCalled(); expect(find(render(), input)?.props.value).toBe("12");
});
it("refused write keeps draft, drops preview and names the refusal", async () => {
  h.post.mockResolvedValue({ ok: false, code: "ownership_changed" }); find(await preview(), panel)!.props.onSave(); await flush();
  expect(find(render(), input)?.props.value).toBe("12"); expect(find(render(), panel)).toBeUndefined();
  expect(find(render(), n => n.props.role === "alert")?.props.children).toBe("catalog.error.ownership_changed");
});
it("refresh keeps captured draft/baseline and hides save until explicit rebase", async () => {
  await preview(); const changed = { ...view, item: { ...view.item, menuPrice: 11 } };
  const tree = render(changed);
  expect(find(tree, input)?.props.value).toBe("12"); expect(find(tree, panel)).toBeUndefined();
  find(tree, button("catalog.menu.edit_rebase"))!.props.onClick();
  expect(find(render(changed), input)?.props.value).toBe("11");
  find(render(changed), button("catalog.menu.preview.title"))!.props.onClick(); await flush();
  expect(h.read).toHaveBeenLastCalledWith(expect.any(String), { change: { kind: "owned_price", expectedOwner: "shop", expectedPrice: 11, price: 11 } });
});
it("edit after preview invalidates save", async () => {
  const tree = await preview(); find(tree, input)!.props.onChange({ target: { value: "13" } });
  expect(find(render(), panel)).toBeUndefined();
});
it("late preview and late apply results are ignored after keyed unmount", async () => {
  let finish!: (value: unknown) => void;
  render(); const cleanup = h.effects[0]!() as () => void;
  h.read.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  find(render(), button("catalog.menu.preview.title"))!.props.onClick(); cleanup();
  finish({ ok: true, data: { preview: { kind: "owned_price", menuItemId: "menu", shopId: "shop", token: "late" } } }); await flush();
  expect(find(render(), panel)).toBeUndefined();
  h.slots = []; h.read.mockResolvedValue({ ok: true, data: { preview: { kind: "owned_price", menuItemId: "menu", shopId: "shop", token: "fresh" } } });
  const tree = await preview(); const unmount = h.effects[0]!() as () => void;
  h.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  find(tree, panel)!.props.onSave(); await flush(); unmount(); finish({ ok: true, data: { ok: true } }); await flush();
  expect(h.refresh).not.toHaveBeenCalled();
});
it("server capabilities gate price, Toast and Share and recipe links retain owner scope", () => {
  const tree = render({ ...view, can: { ...view.can, editOwned: false, share: false } });
  expect(find(tree, input)).toBeUndefined(); expect(find(tree, n => n.type === ToastLinkSection)).toBeUndefined();
  expect(find(tree, n => n.type === ShareWithEveryShop)?.props.canShare).toBe(false);
  expect(find(tree, n => n.props.href === "/admin/catalog/recipe/recipe?location=shop")).toBeDefined();
});

it("own successful save advances the baseline; a later external move still needs rebase", async () => {
  find(await preview(), panel)!.props.onSave(); await flush();
  const committed = { ...view, item: { ...view.item, menuPrice: 12 } };
  expect(find(render(committed), button("catalog.menu.edit_rebase"))).toBeUndefined();
  expect(find(render(committed), input)?.props.value).toBe("12");
  find(render(committed), button("catalog.menu.preview.title"))!.props.onClick(); await flush();
  expect(h.read).toHaveBeenLastCalledWith(expect.any(String), { change: { kind: "owned_price", expectedOwner: "shop", expectedPrice: 12, price: 12 } });
  expect(find(render({ ...committed, item: { ...committed.item, menuPrice: 13 } }), button("catalog.menu.edit_rebase"))).toBeDefined();
});
it("owned recipe link, preview and rebase controls centre their 44px targets", () => {
  for (const tree of [render(), render({ ...view, item: { ...view.item, menuPrice: 11 } })]) {
    for (const predicate of [(n: Node) => typeof n.props.href === "string", (n: Node) => n.type === "button"]) {
      const control = find(tree, predicate)!;
      expect(control.props.className).toContain("min-h-[44px]");
      expect(control.props.className).toContain("items-center");
      expect(control.props.className).toMatch(/(?:^| )inline-flex(?: |$)/);
    }
  }
});
