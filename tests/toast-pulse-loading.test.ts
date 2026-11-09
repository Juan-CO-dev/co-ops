import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSalesPulse } from "@/lib/midshift-sales";
import { loadCapturedToastDay } from "@/lib/toast/depletion";
vi.mock("@/lib/toast/depletion", () => ({ loadCapturedToastDay: vi.fn() }));
// React supplies this memo store per server render; exercise primitive cache keys.
vi.mock("react", () => ({ cache: (fn: (...args: unknown[]) => unknown) => {
  const entries: { args: unknown[]; result: unknown }[] = [];
  return (...args: unknown[]) => {
    const hit = entries.find(entry => entry.args.every((arg, i) => arg === args[i]));
    if (hit) return hit.result;
    const result = fn(...args); entries.push({ args, result }); return result;
  };
} }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());
const coveredDay = (amountCents: number | null = 1700) => ({
  coverage: { runId: "successful-retry", finishedAt: "2026-10-07T18:00:00Z", orderCount: 1,
    missingPointerCount: 0, absenceRemovalApplied: false, configDegraded: false },
  orders: [{ snapshotId: "snapshot", orderGuid: "order", modifiedAt: null,
    diningOptionGuid: null, diningOption: null, salesChannel: null, deleted: false, voided: false, excessFood: false,
    selections: [], checks: [{ checkGuid: "check", amountCents, deleted: false, voided: false }] }],
});
it("uses successful capture numbers and keeps uncovered days unknown", async () => {
  vi.mocked(loadCapturedToastDay).mockImplementation(async (_shop, date) => date === "2026-10-07" ? coveredDay() : null);
  const service = { from: vi.fn() } as unknown as SupabaseClient;
  const result = await loadSalesPulse(service, { locationId: "shop", todayYmd: "2026-10-07" });
  expect(result).toMatchObject({ source: "capture", today: { netCents: 1700, checks: 1 }, yesterday: null,
    baselineAvgCents: null, baselineWeeks: 0, coverageDegraded: true, lastPulledAt: "2026-10-07T18:00:00Z" });
  expect(service.from).not.toHaveBeenCalled();
});
it("distinguishes a covered empty day from missing money", async () => {
  vi.mocked(loadCapturedToastDay).mockResolvedValue({ ...coveredDay(), orders: [] });
  const zero = await loadSalesPulse({} as SupabaseClient, { locationId: "shop", todayYmd: "2026-10-07" });
  expect(zero).toMatchObject({ today: { netCents: 0, checks: 0 }, coverageDegraded: false, baselineWeeks: 4 });
  vi.mocked(loadCapturedToastDay).mockResolvedValue(coveredDay(null));
  const unknown = await loadSalesPulse({} as SupabaseClient, { locationId: "shop", todayYmd: "2026-10-07" });
  expect(unknown).toMatchObject({ today: null, coverageDegraded: true, baselineWeeks: 0 });
});
it("reuses capture day reads across panels within a render", async () => {
  vi.mocked(loadCapturedToastDay).mockResolvedValue(null);
  const service = {} as SupabaseClient;
  await Promise.all([
    loadSalesPulse(service, { locationId: "shop", todayYmd: "2026-10-07" }),
    loadSalesPulse(service, { locationId: "shop", todayYmd: "2026-10-07" }),
  ]);
  expect(loadCapturedToastDay).toHaveBeenCalledTimes(7);
});
