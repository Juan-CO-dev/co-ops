import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { NewSandwichJobView } from "@/lib/catalog/jobs-shared";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown>, fetch: vi.fn(), step: vi.fn(), forget: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (v: unknown) => { h.slots[i] = typeof v === "function" ? v(h.slots[i]) : v; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i]; },
  useEffect: (fn: () => unknown) => { h.effects.push(fn); },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (k: string) => k, language: "en" }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: h.step, forgetStepUp: h.forget }) }));
import { NewSandwichJob } from "@/components/catalog/jobs/NewSandwichJob";
type Node = { type: unknown; props: { [key: string]: unknown; onChange: (e: { target: { value?: string; checked?: boolean } }) => void; onClick: () => void; onSubmit: (line: import("@/lib/recipe-line-shared").RecipeLineDraft) => void; children?: unknown } };
const shop = "10000000-0000-4000-8000-000000000001", menu = "20000000-0000-4000-8000-000000000001";
const view: NewSandwichJobView = { scope: shop, shops: [{ id: shop, name: "Shop" }], allowGlobal: false, catalog: { skus: [], items: [], products: [], outputItems: [], prices: [], unitOptions: [], measures: [], activeMeasureLabels: [] } };
function render() { h.cursor = 0; h.effects = []; return NewSandwichJob({ view }) as Node; }
function find(node: unknown, pred: (n: Node) => boolean): Node | undefined {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, pred); if (result) return result; } return; }
  const n = node as Node; return pred(n) ? n : find(n.props?.children, pred);
}
const by = (key: string) => (n: Node) => n.props?.["data-testid"] === key;
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
async function prepare() {
  let tree = render(); find(tree, by("name"))!.props.onChange({ target: { value: "Ham & cheese" } });
  tree = render(); find(tree, by("price"))!.props.onChange({ target: { value: "12" } });
  tree = render(); find(tree, by("add-line"))!.props.onClick();
  tree = render(); find(tree, n => typeof n.type === "function" && !!n.props.onSubmit)!.props.onSubmit({ componentSkuId: shop, componentItemId: null, componentProductId: null, componentName: "Ham", quantity: 1, unit: "oz", eachContainerLabel: null, portioned: false });
  await vi.runAllTimersAsync(); await flush(); tree = render(); find(tree, by("confirm"))!.props.onChange({ target: { checked: true } }); return render();
}
beforeEach(() => { h.slots = []; h.cursor = 0; h.effects = []; vi.clearAllMocks(); vi.useFakeTimers(); h.step.mockResolvedValue("ok");
  h.fetch.mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => url.endsWith("preview") ? { preview: { cost: { status: "costed", cost: 2, pricedCost: 2 } } } : { recipeId: shop, menuItemId: menu } })); vi.stubGlobal("fetch", h.fetch); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("requires reviewed summary, Tier E and prevents duplicate pending creation", async () => {
  expect(find(render(), by("create"))!.props.disabled).toBe(true);
  const tree = await prepare(); let done!: (v: unknown) => void;
  h.step.mockReturnValue(new Promise(r => { done = r; })); find(tree, by("create"))!.props.onClick(); find(tree, by("create"))!.props.onClick();
  expect(h.step).toHaveBeenCalledExactlyOnceWith("E"); done("ok"); await flush();
  expect(h.fetch.mock.calls.filter(c => c[0] === "/api/admin/catalog/jobs/new-sandwich")).toHaveLength(1);
  expect(find(render(), by("open"))!.props.href).toContain(menu);
});
it.each(["lost", "name_taken", "missing identity"])("reconciles %s without another automatic creation", async mode => {
  const tree = await prepare(); h.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith("reconcile")) return { ok: true, status: 200, json: async () => ({ matched: true, menuItemId: menu }) };
    if (mode === "lost") throw Error("offline");
    return { ok: mode !== "name_taken", status: mode === "name_taken" ? 409 : 201, json: async () => mode === "name_taken" ? { code: "name_taken" } : {} };
  }); find(tree, by("create"))!.props.onClick(); await flush();
  expect(find(render(), by("created-notice"))!.props.children).toBe("catalog.jobs.sandwich.already_created");
  expect(h.fetch.mock.calls.filter(c => c[0].endsWith("reconcile"))).toHaveLength(1);
});
it("keeps a frozen recovery link on unmatched reconciliation and re-read on read failure", async () => {
  const tree = await prepare(); h.fetch.mockImplementation(async (url: string) => { if (!url.endsWith("reconcile")) throw Error(); return { ok: false, status: 409, json: async () => ({ code: "name_taken" }) }; });
  find(tree, by("create"))!.props.onClick(); await flush();
  expect(find(render(), by("recovery"))!.props.href).toBe("/admin/items?view=catalog&q=Ham%20%26%20cheese");
  h.fetch.mockRejectedValue(Error()); find(render(), by("reread"))!.props.onClick(); await flush();
  expect(find(render(), by("uncertain"))).toBeDefined();
});
it("expired step-up and named line refusal preserve draft and never announce creation", async () => {
  const tree = await prepare(); h.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: "step_up_stale" }) });
  find(tree, by("create"))!.props.onClick(); await flush(); expect(h.forget).toHaveBeenCalledOnce(); expect(find(render(), by("open"))).toBeUndefined();
  h.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: "line_other_shop" }) });
  find(render(), by("create"))!.props.onClick(); await flush(); expect(find(render(), n => n.props.role === "alert")!.props.children).toBe("catalog.error.line_other_shop");
});

it("cancelled password preserves draft and sends no create", async () => {
  const tree = await prepare(); h.step.mockResolvedValue("cancelled"); find(tree, by("create"))!.props.onClick(); await flush();
  expect(find(render(), by("name"))!.props.value).toBe("Ham & cheese");
  expect(h.fetch.mock.calls.filter(c => c[0] === "/api/admin/catalog/jobs/new-sandwich")).toHaveLength(0);
});
it("a departed keyed scope ignores a late create response", async () => {
  const tree = await prepare(); const cleanup = h.effects[0]!() as () => void;
  let done!: (v: unknown) => void; h.fetch.mockReturnValue(new Promise(r => { done = r; }));
  find(tree, by("create"))!.props.onClick(); await flush(); cleanup();
  done({ ok: true, status: 201, json: async () => ({ menuItemId: menu, recipeId: shop }) }); await flush();
  expect(find(render(), by("open"))).toBeUndefined();
});
it("editing a displayed draft immediately clears cost and reviewed confirmation", async () => {
  const tree = await prepare(); expect(find(tree, by("create"))!.props.disabled).toBe(false);
  find(tree, by("name"))!.props.onChange({ target: { value: "Changed" } });
  const next = render(); expect(find(next, by("create"))!.props.disabled).toBe(true);
  expect(find(next, by("confirm"))!.props.checked).toBe(false);
  expect(find(next, n => n.type === "p" && n.props.children === "catalog.jobs.sandwich.cost_pending")).toBeDefined();
});
