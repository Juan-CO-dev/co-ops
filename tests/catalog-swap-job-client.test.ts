import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SwapVendorJobView } from "@/lib/catalog/jobs-shared";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown>, fetch: vi.fn(), step: vi.fn(), forget: vi.fn(), push: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (v: unknown) => { h.slots[i] = typeof v === "function" ? v(h.slots[i]) : v; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i]; },
  useEffect: (fn: () => unknown) => { h.effects.push(fn); },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (k: string) => k, language: "en" }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: h.step, forgetStepUp: h.forget }) }));
import { SwapVendorJob } from "@/components/catalog/jobs/SwapVendorJob";
type Node = { type: unknown; props: { [key: string]: unknown; onChange: (event: { target: { value: string } }) => void; onClick: () => void; children?: unknown } };
const old = "10000000-0000-4000-8000-000000000001", replacement = "20000000-0000-4000-8000-000000000001", shop = "30000000-0000-4000-8000-000000000001";
const view = { scope: shop, shops: [{ id: shop, name: "Shop" }], allowGlobal: false, jobs: { skuId: old, name: "Original", canSwap: true, owner: { ownerLocationId: null, ownerShopName: null, writeScope: null, canEdit: true, canShare: false } }, replacements: [{ id: replacement, name: "Replacement", vendorName: "Vendor" }] } as SwapVendorJobView;
const preview = { request: { oldSkuId: old, newSkuId: replacement, scope: shop, mode: "for_now", productName: "normalized by server", productNameEs: null, note: null }, token: "hash", recipes: [], refused: [], costs: [], followsPrimary: [], untouchedShops: [], oldSku: {}, newSku: {}, product: {}, ordering: {} };
function render() { h.cursor = 0; h.effects = []; return SwapVendorJob({ view, replacementId: replacement }) as Node; }
function find(node: unknown, key: string): Node | undefined {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, key); if (result) return result; } return; }
  const n = node as Node; return n.props?.["data-testid"] === key ? n : find(n.props?.children, key);
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
beforeEach(() => { h.slots = []; h.cursor = 0; h.effects = []; vi.clearAllMocks(); h.step.mockResolvedValue("ok"); h.fetch.mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => url.endsWith("preview") ? { preview } : { swapId: old } })); vi.stubGlobal("fetch", h.fetch); });
afterEach(() => vi.unstubAllGlobals());
it("real handlers preview then confirm normalized request once under Tier E", async () => {
  find(render(), "preview")!.props.onClick(); await flush(); const tree = render();
  find(tree, "confirm")!.props.onClick(); find(tree, "confirm")!.props.onClick(); await flush();
  expect(h.step).toHaveBeenCalledExactlyOnceWith("E");
  expect(h.fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(h.fetch.mock.calls[1]![1].body)).toEqual({ ...preview.request, previewToken: preview.token });
});
it("editing invalidates the review; a delayed preview after scope navigation cannot return", async () => {
  find(render(), "preview")!.props.onClick(); await flush();
  find(render(), "mode")!.props.onChange({ target: { value: "for_good" } });
  expect(find(render(), "confirm")).toBeUndefined();
  let done!: (value: unknown) => void; h.fetch.mockReturnValue(new Promise(resolve => { done = resolve; }));
  find(render(), "preview")!.props.onClick(); await flush();
  find(render(), "scope")!.props.onChange({ target: { value: "global" } });
  done({ ok: true, status: 200, json: async () => ({ preview: { ...preview, request: { ...preview.request, mode: "for_good" } } }) }); await flush();
  expect(find(render(), "confirm")).toBeUndefined(); expect(h.push).toHaveBeenCalledOnce();
});
it("stale step-up clears review and expires the local grant without retrying", async () => {
  find(render(), "preview")!.props.onClick(); await flush();
  h.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: "step_up_stale" }) });
  find(render(), "confirm")!.props.onClick(); await flush();
  expect(h.forget).toHaveBeenCalledOnce(); expect(find(render(), "confirm")).toBeUndefined(); expect(h.fetch).toHaveBeenCalledTimes(2);
});
it("cancelling step-up leaves the reviewed preview and sends no write", async () => {
  find(render(), "preview")!.props.onClick(); await flush(); h.step.mockResolvedValue("cancelled");
  find(render(), "confirm")!.props.onClick(); await flush();
  expect(h.fetch).toHaveBeenCalledTimes(1); expect(find(render(), "confirm")).toBeDefined();
});

it("defaults a new product name, accepts bilingual edits and invalidates its preview", async () => {
  const created = { ...preview, product: { kind: "create", name: "Original", nameEs: null } };
  h.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ preview: created }) });
  find(render(), "preview")!.props.onClick(); await flush();
  expect(find(render(), "product-name")?.props.value).toBe("Original");
  find(render(), "product-name")!.props.onChange({ target: { value: "Tomatoes" } });
  expect(find(render(), "confirm")).toBeUndefined();
  find(render(), "product-name-es")!.props.onChange({ target: { value: "Tomates" } });
  find(render(), "preview")!.props.onClick(); await flush();
  expect(JSON.parse(h.fetch.mock.calls[1]![1].body)).toMatchObject({ productName: "Tomatoes", productNameEs: "Tomates" });
});
it("does not offer product naming when the preview uses an existing product", async () => {
  h.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ preview: { ...preview, product: { kind: "existing", id: "product", name: "Existing" } } }) });
  find(render(), "preview")!.props.onClick(); await flush();
  expect(find(render(), "product-name")).toBeUndefined();
});
