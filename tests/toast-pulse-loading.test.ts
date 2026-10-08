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
it("loads all seven legacy dates in a single paged query and reuses the render result", async () => {
  vi.stubEnv("DEPLETION_SOURCE", "");
  const dates: string[][] = [];
  const from = vi.fn(() => query);
  const query = { select: () => query, eq: () => query,
    in: (_column: string, values: string[]) => { dates.push(values); return query; },
    order: () => query, range: () => query,
    returns: async () => ({ data: [{ business_date: "2026-10-07", check_guid: "c", selection_guid: "s", parent_selection_guid: null,
      item_name: "Sub", quantity: "2", price_cents: 1000, voided: false, snapshot_version: 1, pulled_at: "2026-10-07T18:00:00Z" }], error: null }) };
  const service = { from } as unknown as SupabaseClient;
  const first = await loadSalesPulse(service, { locationId: "shop", todayYmd: "2026-10-07" });
  const second = await loadSalesPulse(service, { locationId: "shop", todayYmd: "2026-10-07" });
  expect(first).toBe(second);
  expect(from).toHaveBeenCalledTimes(1);
  expect(dates[0]).toHaveLength(7);
  expect(first.today).not.toBeNull();
  expect(first.yesterday).toBeNull();
});
it("reuses capture day reads across panels within a render", async () => {
  vi.stubEnv("DEPLETION_SOURCE", "capture");
  vi.mocked(loadCapturedToastDay).mockResolvedValue(null);
  const service = {} as SupabaseClient;
  await Promise.all([
    loadSalesPulse(service, { locationId: "shop", todayYmd: "2026-10-07" }),
    loadSalesPulse(service, { locationId: "shop", todayYmd: "2026-10-07" }),
  ]);
  expect(loadCapturedToastDay).toHaveBeenCalledTimes(7);
});
