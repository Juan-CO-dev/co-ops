import { beforeEach, describe, expect, it, vi } from "vitest";
import { materializeEzcaterReconciliation } from "@/lib/ezcater/reconcile";
import { materializeEzcaterShadow } from "@/lib/ezcater/pass2";
import { loadReconciledSalesWindow } from "@/lib/ezcater/depletion";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/ezcater/pass2", () => ({ materializeEzcaterShadow: vi.fn() }));
vi.mock("@/lib/ezcater/depletion", () => ({ loadReconciledSalesWindow: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(materializeEzcaterShadow).mockResolvedValue({ processed: 2, failed: 0, deferred: false });
  vi.mocked(loadReconciledSalesWindow).mockResolvedValue({ rows: [{ location_id: "shop", business_date: "2026-10-08", sku_id: "sku", direct_oz: 12, flattened_oz: 0 }],
    coverage: { source: "capture", hasGaps: false, degraded: false, byLocation: {} } });
  rpc.mockReturnValue({ abortSignal: async () => ({ error: null }) });
  vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
});
describe("reconciliation shadow orchestration", () => {
  it("publishes code evidence before reconciliation and records a full reconciled comparison", async () => {
    expect(await materializeEzcaterReconciliation("2026-10-08", "2026-10-08")).toMatchObject({ processed: 2, failed: 0 });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["reconcile_ezcater_toast", "record_ezcater_reconciled_comparison"]);
    expect(rpc.mock.calls[1]![1].p_rows[0].direct_oz).toBe(12);
    expect(loadReconciledSalesWindow).toHaveBeenCalledWith(expect.anything(), { fromDate: "2026-10-08", untilDateExclusive: "2026-10-09" });
  });
  it("does not publish an incomplete shadow generation", async () => {
    vi.mocked(materializeEzcaterShadow).mockResolvedValue({ processed: 1, failed: 1, deferred: false });
    expect((await materializeEzcaterReconciliation("2026-10-08", "2026-10-08")).failed).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports missing capture as deferred and never records zero comparison", async () => {
    vi.mocked(loadReconciledSalesWindow).mockResolvedValue({ rows: [], coverage: { source: "capture", hasGaps: true, degraded: false, byLocation: {} } });
    expect((await materializeEzcaterReconciliation("2026-10-08", "2026-10-08")).deferred).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("refuses failed reconciliation before comparison reads", async () => {
    rpc.mockReturnValue({ abortSignal: async () => ({ error: { message: "failure" } }) });
    await expect(materializeEzcaterReconciliation("2026-10-08", "2026-10-08")).rejects.toThrow("ezcater_reconcile_failed");
    expect(loadReconciledSalesWindow).not.toHaveBeenCalled();
  });
});
