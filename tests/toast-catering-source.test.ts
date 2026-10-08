import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scanToastCateringForAllLocations } from "@/lib/catering/toast-catering-scan";
import { scanToastCateringForAllLocations as legacyScan } from "@/lib/catering/toast-catering-scan-legacy";
import { getServiceRoleClient } from "@/lib/supabase-server";
vi.mock("@/lib/catering/toast-catering-scan-legacy", () => ({ scanToastCateringForAllLocations: vi.fn(async () => []) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => vi.unstubAllEnvs());
it("flag OFF retains the original provider-backed catering scanner", async () => {
  vi.stubEnv("DEPLETION_SOURCE", "");
  await scanToastCateringForAllLocations(["2026-10-06"]);
  expect(legacyScan).toHaveBeenCalledWith(["2026-10-06"]);
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});
it("flag ON reads capture health without invoking the legacy scanner", async () => {
  vi.stubEnv("DEPLETION_SOURCE", "capture");
  const query = { select: () => query, eq: () => query, not: () => query, returns: async () => ({ data: [], error: null }) };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => query } as unknown as ReturnType<typeof getServiceRoleClient>);
  expect(await scanToastCateringForAllLocations(["2026-10-06"])).toEqual([]);
  expect(legacyScan).not.toHaveBeenCalled();
});

// Digest polish item 12 (CC 10-08): "no completed capture for that date yet" is pending, not a failure.
function captureClient(runsByDate: Record<string, unknown>, ledger: Array<{ classification: string; processing_result: string }> = []) {
  return {
    from(table: string) {
      const f: Record<string, unknown> = {};
      const q = {
        select: () => q, not: () => q, order: () => q, limit: () => q, range: () => q,
        eq: (col: string, v: unknown) => { f[col] = v; return q; },
        returns: async () => ({ data: [{ id: "loc-1" }], error: null }),
        maybeSingle: async () => ({ data: runsByDate[f.business_date as string] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: table === "toast_catering_orders" ? ledger : [], error: null }),
      };
      return q;
    },
  } as unknown as ReturnType<typeof getServiceRoleClient>;
}

it("a date with no completed capture run yet is pending and the location stays healthy", async () => {
  vi.stubEnv("DEPLETION_SOURCE", "capture");
  vi.mocked(getServiceRoleClient).mockReturnValue(captureClient({}));
  const [r] = await scanToastCateringForAllLocations(["2026-10-08"]);
  expect(r!.ok).toBe(true);
  expect(r!.pendingDates).toEqual(["2026-10-08"]);
  expect(r!.error).toBeUndefined();
});

it("a pre-flip run whose catering pass is still pending (no named error) is pending, not a failure", async () => {
  vi.stubEnv("DEPLETION_SOURCE", "capture");
  vi.mocked(getServiceRoleClient).mockReturnValue(captureClient({
    "2026-10-07": { finished_at: new Date().toISOString(), catering_status: "pending", catering_error_code: null },
  }));
  const [r] = await scanToastCateringForAllLocations(["2026-10-07"]);
  expect(r!.ok).toBe(true);
  expect(r!.pendingDates).toEqual(["2026-10-07"]);
});

it("a NAMED catering error is still a failure (pending never hides a real fault)", async () => {
  vi.stubEnv("DEPLETION_SOURCE", "capture");
  vi.mocked(getServiceRoleClient).mockReturnValue(captureClient({
    "2026-10-07": { finished_at: new Date().toISOString(), catering_status: "degraded", catering_error_code: "capture_catering_config_stale" },
  }));
  const [r] = await scanToastCateringForAllLocations(["2026-10-07"]);
  expect(r!.ok).toBe(false);
  expect(r!.error).toBe("capture_catering_config_stale");
});
