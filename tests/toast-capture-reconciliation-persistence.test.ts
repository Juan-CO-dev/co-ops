import { beforeEach, expect, it, vi } from "vitest";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadCapturedToastDay, type CapturedToastDay } from "@/lib/toast/captured-day";
import { recordCaptureReconciliation } from "@/lib/toast/capture-reconciliation";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/captured-day", () => ({ loadCapturedToastDay: vi.fn() }));
let failWrite: boolean;
let saved: Record<string, unknown>[];
beforeEach(() => {
  vi.clearAllMocks(); failWrite = false; saved = [];
  vi.mocked(loadCapturedToastDay).mockResolvedValue({ coverage: { runId: "run" }, orders: [] } as unknown as CapturedToastDay);
  vi.mocked(getServiceRoleClient).mockReturnValue({ from(table: string) {
    expect(table).toBe("toast_capture_reconciliations");
    return { insert(row: Record<string, unknown>) { saved.push(row); return {
      abortSignal: async () => ({ error: failWrite ? { message: "PRIVATE DB MESSAGE" } : null }),
    }; } };
  } } as unknown as ReturnType<typeof getServiceRoleClient>);
});
const run = () => recordCaptureReconciliation("shop", "2026-10-06", "run", [], new AbortController().signal);
it("uses completed capture coverage for the exact shop/day; a covered empty day is zero", async () => {
  expect(await run()).toEqual({ status: "match", error: null });
  expect(loadCapturedToastDay).toHaveBeenCalledExactlyOnceWith("shop", "2026-10-06");
  expect(saved).toMatchObject([{ location_id: "shop", business_date: "2026-10-06", run_id: "run", old_units: 0, new_units: 0 }]);
});
it("missing coverage is skipped, never evidence of zero sales", async () => {
  vi.mocked(loadCapturedToastDay).mockResolvedValue(null);
  expect(await run()).toEqual({ status: "skipped", error: "capture_reconciliation_skipped" });
  expect(saved[0]).toMatchObject({ old_units: null, mismatched_items: [] });
});
it("compares published capture quantities with the submitted capture", async () => {
  vi.mocked(loadCapturedToastDay).mockResolvedValue({ coverage: { runId: "retry-success" }, orders: [{
    deleted: false, checks: [], selections: [{ check_guid: "check", selection_guid: "s", item_guid: "item",
      name: "Item", parent_selection_guid: null, quantity: 3, voided: false, deleted: false }],
  }] } as unknown as CapturedToastDay);
  expect(await run()).toEqual({ status: "mismatch", error: "capture_reconciliation_mismatch" });
  expect(saved[0]).toMatchObject({ old_units: 3, new_units: 0 });
});
it("read failure stores skipped, never partial totals or provider errors", async () => {
  vi.mocked(loadCapturedToastDay).mockRejectedValue(new Error("PRIVATE DB MESSAGE"));
  expect(await run()).toEqual({ status: "skipped", error: "capture_reconciliation_read_failed" });
  expect(saved).toMatchObject([{ status: "skipped", old_units: null, new_units: null, mismatched_items: [] }]);
  expect(JSON.stringify(saved)).not.toContain("PRIVATE");
});
it("a denied insert cannot report successful reconciliation", async () => {
  failWrite = true;
  await expect(run()).rejects.toThrow("capture_reconciliation_write_failed");
});
