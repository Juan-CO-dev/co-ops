import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as refresh from "@/lib/ezcater/refresh";
import { syncEzcaterOrder } from "@/lib/ezcater/sync";
import { ezcaterConfigured } from "@/lib/ezcater/client";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { runToastSalesPull } from "@/lib/toast-sales-pull-run";
import { completeElapsedCateringEvents } from "@/lib/catering/system-intake";
import { runOrderCapture } from "@/lib/toast/capture-job";
import { pullSalesForAllLocations } from "@/lib/catering/toast-sales";

vi.mock("@/lib/ezcater/sync", () => ({ syncEzcaterOrder: vi.fn() }));
vi.mock("@/lib/ezcater/client", () => ({ ezcaterConfigured: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/catering/system-intake", () => ({ completeElapsedCateringEvents: vi.fn() }));
vi.mock("@/lib/toast/capture-job", () => ({ runOrderCapture: vi.fn() }));
vi.mock("@/lib/toast/depletion", () => ({ materializeCapturedDepletion: vi.fn() }));
vi.mock("@/lib/catering/toast-sales", () => ({ pullSalesForAllLocations: vi.fn(), materializeDailyDepletion: vi.fn() }));
vi.mock("@/lib/counts", () => ({ loadDepletionWatermark: vi.fn() }));
vi.mock("@/lib/dynamic-pars", () => ({ runParShadowForLocation: vi.fn(), recordParRunSkipped: vi.fn() }));

const row = (id: string) => ({ provider_uuid: id, caterer_uuid: "shop-provider", pending_event_key: null });
let rows: ReturnType<typeof row>[];
let sequence: string[];
const filter = vi.fn();
const ordering = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  vi.stubEnv("EZCATER_FIXTURES", "0");
  vi.stubEnv("DEPLETION_SOURCE", "legacy");
  vi.mocked(ezcaterConfigured).mockReturnValue(true);
  vi.mocked(audit).mockResolvedValue(undefined);
  rows = [row("known-uuid")];
  sequence = [];
  const query = {
    select: () => query,
    or: (value: string) => { filter(value); return query; },
    order: (key: string, options?: unknown) => { ordering(key, options); return query; },
    limit: () => query,
    abortSignal: async () => ({ data: rows, error: null }),
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => query } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(syncEzcaterOrder).mockImplementation(async () => {
    sequence.push("refresh"); return { lead_id: "lead", result: "applied" };
  });
  vi.mocked(completeElapsedCateringEvents).mockImplementation(async () => {
    sequence.push("complete"); return { completed: ["lead"], failed: [], stageChanged: 0 };
  });
  vi.mocked(pullSalesForAllLocations).mockResolvedValue([]);
  vi.mocked(runOrderCapture).mockResolvedValue({ failures: 0, skipped: true, results: [] });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("bounded nightly ezCater refresh", () => {
  it("selects errors independently of the T-2..T+14 horizon and emits its own heartbeat", async () => {
    rows = [row("retry-outside-horizon")];
    const result = await refresh.refreshKnownEzcaterOrders("2026-10-08");
    expect(filter).toHaveBeenCalledWith("last_sync_error.not.is.null,and(event_date.gte.2026-10-06,event_date.lte.2026-10-22)");
    expect(ordering).toHaveBeenCalledWith("last_attempt_at", { ascending: true });
    expect(syncEzcaterOrder).toHaveBeenCalledWith("retry-outside-horizon", "shop-provider", expect.any(Object));
    expect(result).toEqual({ attempted: 1, failed: 0, deferred: false, disabled: false });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: expect.objectContaining({ job: "ezcater-refresh", business_date: "2026-10-08", attempted: 1 }) }));
  });

  it("stops a hung provider at its deadline and leaves the remaining UUIDs deferred", async () => {
    rows.push(row("later"));
    vi.mocked(syncEzcaterOrder).mockImplementation(() => new Promise(() => {}));
    const deadline = Date.now() + 50;
    const pending = refresh.refreshKnownEzcaterOrders("2026-10-08", deadline);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual({ attempted: 1, failed: 1, deferred: true, disabled: false });
    expect(syncEzcaterOrder).toHaveBeenCalledTimes(1);
    const options = vi.mocked(syncEzcaterOrder).mock.calls[0]?.[2];
    expect(options?.deadlineMs).toBe(deadline);
    expect(options?.signal?.aborted).toBe(true);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: expect.objectContaining({ job: "ezcater-refresh" }) }));
  });

  it.each(["no-token", "fixtures"])("does no database/provider work in %s mode", async (mode) => {
    if (mode === "no-token") vi.mocked(ezcaterConfigured).mockReturnValue(false);
    else vi.stubEnv("EZCATER_FIXTURES", "1");
    expect(await refresh.refreshKnownEzcaterOrders("2026-10-08")).toMatchObject({ disabled: true, attempted: 0 });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
    expect(syncEzcaterOrder).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ job: "ezcater-refresh", disabled: true }) }));
  });

  it("continues after one failed sync without writing contact values into its heartbeat", async () => {
    rows.push(row("later"));
    vi.mocked(syncEzcaterOrder).mockRejectedValueOnce(new Error("private@example.test"));
    expect(await refresh.refreshKnownEzcaterOrders("2026-10-08")).toMatchObject({ attempted: 2, failed: 1 });
    expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain("private@example.test");
  });
});

describe("sales pull keeps generic completion after best-effort refresh", () => {
  it("refreshes provider state before running the existing completion loop", async () => {
    const result = await runToastSalesPull({ businessDate: "2026-10-07" });
    expect(sequence).toEqual(["refresh", "complete"]);
    expect(result.metadata.elapsed_completed).toBe(1);
    expect(completeElapsedCateringEvents).toHaveBeenCalledWith("2026-10-08");
  });

  it("a thrown refresh still runs completion", async () => {
    vi.spyOn(refresh, "refreshKnownEzcaterOrders").mockRejectedValueOnce(new Error("refresh failed"));
    const result = await runToastSalesPull({ businessDate: "2026-10-07" });
    expect(completeElapsedCateringEvents).toHaveBeenCalledOnce();
    expect(result.metadata.elapsed_completed).toBe(1);
  });

  it("completion proceeds when the provider hangs past its allotted refresh deadline", async () => {
    vi.mocked(syncEzcaterOrder).mockImplementation(() => new Promise(() => {}));
    // Sales pull reserves 10 seconds for its remaining work.
    const pending = runToastSalesPull({ businessDate: "2026-10-07", deadlineAt: Date.now() + 10_050 });
    await vi.advanceTimersByTimeAsync(49);
    expect(completeElapsedCateringEvents).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(completeElapsedCateringEvents).toHaveBeenCalledOnce();
    expect(result.metadata.elapsed_completed).toBe(1);
  });
});
