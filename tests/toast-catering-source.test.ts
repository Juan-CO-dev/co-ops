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
