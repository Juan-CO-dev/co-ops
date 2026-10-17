import { createElement } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { TranslationProvider } from "@/lib/i18n/provider";
import Page from "@/app/admin/vendors/[id]/page";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const state = vi.hoisted(() => ({ language: "en" as "en" | "es" }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({ user: { role: "gm", language: state.language }, locations: ["shop"] }) }));
vi.mock("@/lib/shop-context", () => ({ resolveShopId: async () => "shop" }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/ordering-sources", () => ({ loadStoreVendorIds: async () => new Set() }));
vi.mock("@/lib/admin/vendors", () => ({ getVendor: async () => ({ id: "vendor", name: "Vendor" }), loadCategories: async () => [], loadOrderTypes: async () => [], loadVendorCutoffs: async () => [] }));
vi.mock("@/lib/vendor-rhythm", () => ({ loadVendorRhythmPairs: async () => [], loadVendorRhythmSkips: async () => [], rhythmSchemaReady: async () => false }));
vi.mock("@/lib/credits", () => ({ loadVendorOutstandingCredits: async () => null }));
vi.mock("@/lib/admin/skus", () => ({ loadSkus: async () => [], loadPackFormats: async () => [], loadMeasureUnits: async () => [], loadLocationSkuSettings: async () => new Map(), parsColumnsReady: async () => false }));
vi.mock("@/lib/products", () => ({ listProducts: async () => [], ProductError: class extends Error {} }));
vi.mock("@/lib/admin/cost", () => ({ loadCurrentSkuPrices: async () => new Map(), computeSkuCostPerOz: () => new Map(), loadSkuUsageMap: async () => new Map(), loadSkuReceivingLedger: async () => new Map(), loadSkuConsumption: async () => new Map() }));
vi.mock("@/lib/prep-consumption", () => ({ loadSkuPackResolution: async () => new Map() }));
vi.mock("@/components/admin/vendors/VendorDetailClient", () => ({ VendorDetailClient: () => "Vendor editor" }));
vi.mock("@/components/admin/vendors/VendorImportPanel", () => ({ VendorImportPanel: () => null }));
vi.mock("@/components/admin/vendors/OrderGuidePanel", () => ({ OrderGuidePanel: ({ initial }: { initial: { onlyAt: Record<string, string>; skusNotOnGuide: Array<{ name: string }> } }) => createElement("div", null, JSON.stringify(initial.onlyAt), initial.skusNotOnGuide.map(s => s.name).join(",")) }));
vi.mock("@/lib/i18n/server", () => ({ serverT: (lang: "en" | "es", key: keyof typeof en) => (lang === "es" ? es : en)[key] }));

beforeEach(() => vi.clearAllMocks());
for (const language of ["en", "es"] as const) {
  it.each([false, true])(`vendor page retains guide when owner labels fail: %s (${language})`, async (fail) => {
    state.language = language;
    const db = createFakeDb({ vendor_order_guides: [], locations: [{ id: "shop", name: "North", active: true }], vendor_items: [{ id: "sku", vendor_id: "vendor", name: "Ingredient", location_id: "shop", active: true }] });
    const from = db.client.from.bind(db.client);
    vi.spyOn(db.client, "from").mockImplementation((table: string) => {
      const query = from(table);
      // Fail the actual owner-name lookup, leaving other location reads available.
      if (fail && table === "locations") {
        // Narrow the fake query seam; avoid instantiating Supabase's recursive generic builder in a spy.
        const filter = query as unknown as { in: (...args: unknown[]) => unknown };
        vi.spyOn(filter, "in").mockImplementation(() => ({ returns: async () => ({ data: null, error: { message: "offline" } }) }));
      }
      return query;
    });
    vi.mocked(getServiceRoleClient).mockReturnValue(db.client);
    const page = await Page({ params: Promise.resolve({ id: "vendor" }) });
    const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: page }));
    expect(html).toContain("Vendor editor");
    expect(html).toContain("Ingredient");
    if (fail) {
      expect(html).not.toContain("North");
      expect(html).toContain(language === "es" ? "No se pudieron cargar las etiquetas de tienda." : "Shop labels could not be loaded.");
    } else {
      expect(html).toContain("North");
      expect(html).not.toContain("Shop labels could not be loaded.");
      expect(html).not.toContain("No se pudieron cargar las etiquetas de tienda.");
    }
  });
}
