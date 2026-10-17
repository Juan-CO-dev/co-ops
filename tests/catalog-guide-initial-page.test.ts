import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { requireSessionFromHeaders } from "@/lib/session";
import Page from "@/app/admin/vendors/[id]/page";
import { OrderGuidePanel, type OrderGuideInitial } from "@/components/admin/vendors/OrderGuidePanel";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); }, notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/lib/shop-context", () => ({ resolveShopId: async () => "a" }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/ordering-sources", () => ({ loadStoreVendorIds: async () => new Set() }));
vi.mock("@/lib/admin/vendors", () => ({ getVendor: async () => ({ id: "v", name: "Vendor" }), loadCategories: async () => [], loadOrderTypes: async () => [], loadVendorCutoffs: async () => [] }));
vi.mock("@/lib/vendor-rhythm", () => ({ loadVendorRhythmPairs: async () => [], loadVendorRhythmSkips: async () => [], rhythmSchemaReady: async () => false }));
vi.mock("@/lib/credits", () => ({ loadVendorOutstandingCredits: async () => null }));
vi.mock("@/lib/admin/skus", () => ({ loadSkus: async () => [], loadPackFormats: async () => [], loadMeasureUnits: async () => [], loadLocationSkuSettings: async () => new Map(), parsColumnsReady: async () => false }));
vi.mock("@/lib/products", () => ({ listProducts: async () => [], ProductError: class extends Error {} }));
vi.mock("@/lib/admin/cost", () => ({ loadCurrentSkuPrices: async () => new Map(), computeSkuCostPerOz: () => new Map(), loadSkuUsageMap: async () => new Map(), loadSkuReceivingLedger: async () => new Map(), loadSkuConsumption: async () => new Map() }));
vi.mock("@/lib/prep-consumption", () => ({ loadSkuPackResolution: async () => new Map() }));
vi.mock("@/components/admin/vendors/VendorDetailClient", () => ({ VendorDetailClient: () => null }));
vi.mock("@/components/admin/vendors/OrderGuidePanel", () => ({ OrderGuidePanel: () => null }));
vi.mock("@/components/admin/vendors/VendorImportPanel", () => ({ VendorImportPanel: () => null }));
type Node = { type: unknown; props: { children?: unknown; initial: OrderGuideInitial; canEdit: boolean } };
function findPanel(tree: unknown): Node | undefined {
  if (!tree || typeof tree !== "object") return;
  if (Array.isArray(tree)) return tree.map(findPanel).find(Boolean);
  const node = tree as Node;
  return node.type === OrderGuidePanel ? node : findPanel(node.props?.children);
}
function setup(role = "gm", legacy = false) {
  vi.mocked(requireSessionFromHeaders).mockResolvedValue({ user: { id: "user", role, language: "en" }, level: role === "gm" ? 7 : 6, locations: ["a"] } as unknown as Awaited<ReturnType<typeof requireSessionFromHeaders>>);
  const db = createFakeDb({
    locations: [{ id: "a", name: "North", active: true }, { id: "b", name: "South", active: false }],
    vendor_order_guides: [{ id: "g", vendor_id: "v", name: "Guide", updated_at: "token" }],
    order_guide_sections: [{ id: "s", guide_id: "g", name: "Section", position: 1 }],
    order_guide_lines: ["placed-a", "placed-b"].map((sku_id, i) => ({ id: `line-${i}`, section_id: "s", position: i + 1, sku_id, label: sku_id, item_number: null, note: null })),
    vendor_items: ["placed-a", "placed-b", "bucket"].map((id, i) => ({ id, name: id, vendor_id: "v", item_number: null, active: true, ...(!legacy ? { location_id: i === 0 ? "a" : "b" } : {}) })),
  });
  vi.mocked(getServiceRoleClient).mockReturnValue(db.client);
  return db;
}
beforeEach(() => vi.clearAllMocks());
it.each(["gm", "agm"])("initial %s render preserves other-shop lines and names placed and unplaced owners", async role => {
  setup(role);
  const panel = findPanel(await Page({ params: Promise.resolve({ id: "v" }) }))!;
  expect(panel.props.initial.onlyAt).toEqual({ "placed-a": "North", "placed-b": "South", bucket: "South" });
  expect(panel.props.initial.guide!.sections[0]!.lines.map(l => l.skuId)).toEqual(["placed-a", "placed-b"]);
  expect(panel.props.initial.skusNotOnGuide).toEqual([{ skuId: "bucket", name: "bucket", itemNumber: null }]);
  expect(panel.props.canEdit).toBe(role === "gm");
});
it("initial render tolerates missing ownership metadata without dropping guide rows", async () => {
  setup("gm", true);
  const panel = findPanel(await Page({ params: Promise.resolve({ id: "v" }) }))!;
  expect(panel.props.initial.onlyAt).toEqual({});
  expect(panel.props.initial.guide!.sections[0]!.lines).toHaveLength(2);
});
it("a key holder cannot reach the admin vendor page or its ownership read", async () => {
  setup("key_holder");
  await expect(Page({ params: Promise.resolve({ id: "v" }) })).rejects.toThrow("redirect:/dashboard");
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});
