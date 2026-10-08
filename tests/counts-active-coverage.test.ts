import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadSalesGapDates, loadDepletionWatermark, sumSalesDirectOzWindow } from "@/lib/counts";
import { loadSalesCoverageDisclosure } from "@/lib/toast/effective-depletion";
import { loadReconciledSalesWindow } from "@/lib/ezcater/depletion";
import type { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/ezcater/depletion", () => ({ loadReconciledSalesWindow: vi.fn() }));
const client = {} as ReturnType<typeof getServiceRoleClient>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEPLETION_SOURCE", "capture");
  vi.stubEnv("EZCATER_DEPLETION_ENABLED", "1");
  vi.mocked(loadReconciledSalesWindow).mockResolvedValue({ rows: [], coverage: {
    source: "capture", hasGaps: false, degraded: false,
    byLocation: { shop: { hasGaps: false, degraded: false, missingDates: [], degradedDates: [] } },
  } });
});
afterEach(() => vi.unstubAllEnvs());

it("counts accepts reconciled coverage even without a raw Toast manifest", async () => {
  expect([...(await loadSalesGapDates(client, "shop", "2026-10-06", "2026-10-07"))]).toEqual([]);
  expect(loadReconciledSalesWindow).toHaveBeenCalledWith(client, {
    locationId: "shop", fromDate: "2026-10-06", untilDateExclusive: "2026-10-07",
  });
});

it("counts preserves active-source gaps and degradation disclosure", async () => {
  vi.mocked(loadReconciledSalesWindow).mockResolvedValue({ rows: [], coverage: {
    source: "capture", hasGaps: true, degraded: true,
    byLocation: { shop: { hasGaps: true, degraded: true, missingDates: ["2026-10-06"], degradedDates: ["2026-10-05"] } },
  } });
  expect([...(await loadSalesGapDates(client, "shop", "2026-10-05", "2026-10-07"))]).toEqual(["2026-10-06"]);
  expect(await loadSalesCoverageDisclosure(client, { locationId: "shop", fromDate: "2026-10-05" })).toMatchObject({ degraded: true });
});

it("shares one reconciled window across anchor groups and filters exclusive dates and SKUs in memory", async () => {
  const result = await vi.mocked(loadReconciledSalesWindow).getMockImplementation()!(client, { fromDate: "2026-10-01" });
  result.rows = [
    { location_id: "shop", business_date: "2026-10-01", sku_id: "a", direct_oz: 2, flattened_oz: 0 },
    { location_id: "shop", business_date: "2026-10-02", sku_id: "a", direct_oz: 3, flattened_oz: 0 },
    { location_id: "shop", business_date: "2026-10-02", sku_id: "b", direct_oz: 9, flattened_oz: 0 },
  ];
  vi.mocked(loadReconciledSalesWindow).mockResolvedValue(result);
  const gaps = await loadSalesGapDates(client, "shop", "2026-10-01", "2026-10-07");
  expect(await sumSalesDirectOzWindow(client, ["a"], "shop", "2026-10-01", "2026-10-02", gaps)).toEqual(new Map([["a", 2]]));
  expect(await sumSalesDirectOzWindow(client, ["a"], "shop", "2026-10-02", "2026-10-07", gaps)).toEqual(new Map([["a", 3]]));
  expect(loadReconciledSalesWindow).toHaveBeenCalledTimes(1);
});

it("a new gap in the amount read returns unknown instead of zero", async () => {
  vi.mocked(loadReconciledSalesWindow).mockResolvedValue({ rows: [], coverage: {
    source: "capture", hasGaps: true, degraded: false,
    byLocation: { shop: { hasGaps: true, degraded: false, missingDates: ["2026-10-06"], degradedDates: [] } },
  } });
  expect(await sumSalesDirectOzWindow(client, ["a"], "shop", "2026-10-06", "2026-10-07", new Set()))
    .toEqual(new Map([["a", null]]));
});

it("watermark validates only the newest closed captured day against the active source", async () => {
  const lt = vi.fn(() => query);
  const query = { select: () => query, eq: () => query, lt, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: { business_date: "2026-10-06" }, error: null }) };
  const sb = { from: vi.fn(() => query) } as unknown as ReturnType<typeof getServiceRoleClient>;
  expect(await loadDepletionWatermark("shop", sb)).toBe("2026-10-06");
  expect(loadReconciledSalesWindow).toHaveBeenCalledWith(sb, {
    locationId: "shop", fromDate: "2026-10-06", untilDateExclusive: "2026-10-07",
  });
  expect(lt).toHaveBeenCalledWith("business_date", expect.any(String));
});
