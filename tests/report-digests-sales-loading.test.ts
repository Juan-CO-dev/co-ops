import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCapturedToastDay, type CapturedToastDay } from "@/lib/toast/captured-day";
import { loadSales } from "@/lib/report-digests-v2";
import { salesDeltaPct } from "@/lib/report-digests-v2-shared";

vi.mock("@/lib/toast/captured-day", () => ({ loadCapturedToastDay: vi.fn() }));

const captured = (net: number): CapturedToastDay => ({
  coverage: { runId: "run", finishedAt: "2026-10-11T22:00:00Z", orderCount: 1,
    missingPointerCount: 0, absenceRemovalApplied: false, configDegraded: false },
  orders: [{ snapshotId: "snapshot", orderGuid: "order", modifiedAt: null,
    diningOptionGuid: null, diningOption: null, salesChannel: "dine_in",
    deleted: false, voided: false, excessFood: false, selections: [], checks: [
      { checkGuid: "linked", amountCents: 99999, deleted: false, voided: false },
      { checkGuid: "sale", amountCents: net, deleted: false, voided: false },
    ] }],
});

function client(failLinks = false) {
  const queries: Array<{ table: string; filters: Record<string, unknown>; range: number[] }> = [];
  const sb = { from: (table: string) => {
    const call = { table, filters: {} as Record<string, unknown>, range: [] as number[] };
    queries.push(call);
    const q = {
      select: () => q, order: () => q,
      eq: (key: string, value: unknown) => { call.filters[key] = value; return q; },
      in: (key: string, value: unknown) => { call.filters[key] = value; return q; },
      range: async (from: number, to: number) => {
        call.range = [from, to];
        return { data: table === "ezcater_current_toast_links" ? [
          { toast_snapshot_id: "snapshot", check_guid: "linked" },
          // Same check GUID on an old snapshot must not exclude the current sale.
          { toast_snapshot_id: "old-snapshot", check_guid: "sale" },
        ] : [], error: failLinks && table === "ezcater_current_toast_links" ? { message: "unavailable" } : null };
      },
    };
    return q;
  } } as unknown as SupabaseClient;
  return { sb, queries };
}

beforeEach(() => vi.resetAllMocks());
describe("digest classified capture loading", () => {
  it("uses shop/day scoped, paged links for both today and last week", async () => {
    vi.mocked(loadCapturedToastDay).mockImplementation(async (_loc, day) => captured(day === "2026-10-11" ? 1200 : 1000));
    const { sb, queries } = client();
    const result = await loadSales(sb, "shop", "2026-10-11");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.value.today).toMatchObject({ netCents: 1200, checks: 1 });
    expect(result.value.lastWeek).toMatchObject({ netCents: 1000, checks: 1 });
    expect(salesDeltaPct(result.value.today, result.value.lastWeek)).toBe(20);
    expect(queries.filter((q) => q.table === "ezcater_current_toast_links")).toEqual([
      { table: "ezcater_current_toast_links", filters: { location_id: "shop", business_date: "2026-10-11" }, range: [0, 999] },
      { table: "ezcater_current_toast_links", filters: { location_id: "shop", business_date: "2026-10-04" }, range: [0, 999] },
    ]);
  });
  it("refuses a failed link read instead of reporting inflated sales", async () => {
    vi.mocked(loadCapturedToastDay).mockResolvedValue(captured(1200));
    await expect(loadSales(client(true).sb, "shop", "2026-10-11")).rejects.toThrow("unavailable");
  });
  it("keeps no completed capture unavailable", async () => {
    vi.mocked(loadCapturedToastDay).mockResolvedValue(null);
    const { sb, queries } = client();
    expect(await loadSales(sb, "shop", "2026-10-11")).toEqual({ kind: "unavailable", reason: "no_capture" });
    expect(queries).toEqual([]);
  });
});
