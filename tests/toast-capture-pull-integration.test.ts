import { beforeEach, expect, it, vi } from "vitest";
import { runToastSalesPull } from "@/lib/toast-sales-pull-run";
import { materializeDailyDepletion, pullSalesForAllLocations } from "@/lib/catering/toast-sales";
import { runParShadowForLocation } from "@/lib/dynamic-pars";

vi.mock("@/lib/catering/toast-sales", () => ({ pullSalesForAllLocations: vi.fn(), materializeDailyDepletion: vi.fn() }));
vi.mock("@/lib/catering/system-intake", () => ({ completeElapsedCateringEvents: vi.fn(async () => ({ completed: [], failed: [] })) }));
vi.mock("@/lib/counts", () => ({ loadDepletionWatermark: vi.fn(async () => null) }));
vi.mock("@/lib/dynamic-pars", () => ({ runParShadowForLocation: vi.fn(), recordParRunSkipped: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(materializeDailyDepletion).mockResolvedValue({ rows: 2 });
  vi.mocked(runParShadowForLocation).mockResolvedValue({ rows: 1 } as Awaited<ReturnType<typeof runParShadowForLocation>>);
});

it("capture failure leaves selection depletion intact but denies the successful heartbeat", async () => {
  vi.mocked(pullSalesForAllLocations).mockResolvedValue([{ locationId: "shop", ok: true,
    result: { selections: 3, appended: 2, unchanged: 1, voids: 0, capture: { ok: false, error: "order_capture_failed" } },
  }]);
  const result = await runToastSalesPull({ businessDate: "2026-07-23" });
  expect(materializeDailyDepletion).toHaveBeenCalledWith("shop", "2026-07-23");
  expect(runParShadowForLocation).toHaveBeenCalledWith("shop", "2026-07-23");
  expect(result).toMatchObject({ healthy: false, metadata: { capture_failures: 1, per_location_failures: 0, depletion_rows: { shop: 2 } } });
});

it("successful capture permits a healthy heartbeat", async () => {
  vi.mocked(pullSalesForAllLocations).mockResolvedValue([{ locationId: "shop", ok: true,
    result: { selections: 0, appended: 0, unchanged: 0, voids: 0, capture: { ok: true, runId: "run", pages: 1, orders: 0 } },
  }]);
  expect(await runToastSalesPull({ businessDate: "2026-07-23" })).toMatchObject({ healthy: true, metadata: { capture_failures: 0 } });
});

it("selection failures remain unhealthy and do not materialize", async () => {
  vi.mocked(pullSalesForAllLocations).mockResolvedValue([{ locationId: "shop", ok: false, error: "selection_failed" }]);
  expect(await runToastSalesPull({ businessDate: "2026-07-23" })).toMatchObject({ healthy: false, metadata: { per_location_failures: 1 } });
  expect(materializeDailyDepletion).not.toHaveBeenCalled();
});
