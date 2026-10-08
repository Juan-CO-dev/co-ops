import { recordCaptureReconciliation } from "@/lib/toast/capture-reconciliation";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureToastDaySystem } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { toastConfigured, toastGet, toastGetPage } from "@/lib/toast/client";

vi.mock("@/lib/toast/capture-reconciliation", () => ({ recordCaptureReconciliation: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/client", async (original) => ({ ...await original<typeof import("@/lib/toast/client")>(), toastConfigured: vi.fn(), toastGet: vi.fn(), toastGetPage: vi.fn() }));

let previous: { id: string; pages: number; orders: number } | null;
let rpc: ReturnType<typeof vi.fn>;
let writes: { table: string; data: unknown }[];
let filters: [string, string, unknown][];
let pageError: boolean;
let schemaMissing: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TOAST_ORDER_CAPTURE", "1");
  vi.stubEnv("TOAST_FIXTURES", "0");
  schemaMissing = false;
  previous = null; writes = []; filters = []; pageError = false;
  vi.mocked(toastConfigured).mockReturnValue(true);
  vi.mocked(toastGetPage).mockResolvedValue({ data: [], nextPageToken: null });
  vi.mocked(toastGet).mockResolvedValue([{ guid: "order", businessDate: 20260722, checks: [] }]);
  rpc = vi.fn((name: string) => ({ abortSignal: async () => ({ error: name === "toast_capture_page" && pageError ? { code: "P0001", message: "private" } : null }) }));
  const from = (table: string) => {
    const query = {
      select: () => query, lt: () => query, abortSignal: () => query,
      eq: (field: string, value: unknown) => { filters.push([table, field, value]); return query; },
      order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: table === "locations" ? { toast_restaurant_guid: "bound-restaurant" } : previous, error: null }),
      insert: (data: unknown) => { writes.push({ table, data }); return query; },
      upsert: (data: unknown) => { writes.push({ table, data }); return query; },
      update: (data: unknown) => { writes.push({ table, data }); return query; },
      then: (resolve: (value: unknown) => void) => resolve({ data: [{ id: "run" }], error: schemaMissing && table === "toast_capture_runs" ? { code: "42P01" } : null }),
    };
    return query;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
});

it("resume skips only a completed date scoped to the requested shop", async () => {
  previous = { id: "prior", pages: 3, orders: 202 };
  expect(await captureToastDaySystem("resume-shop", "2026-07-22", { resume: true })).toEqual({ runId: "prior", pages: 3, orders: 202, skipped: true });
  expect(filters).toEqual(expect.arrayContaining([
    ["toast_capture_runs", "location_id", "resume-shop"],
    ["toast_capture_runs", "business_date", "2026-07-22"],
    ["toast_capture_runs", "status", "completed"],
  ]));
  expect(writes).toEqual([{ table: "toast_capture_runs", data: expect.objectContaining({ error_code: "capture_stale" }) }]);
  expect(toastGet).not.toHaveBeenCalled();
});

it("a refused debounce claim never fetches orders or creates a second manifest", async () => {
  rpc.mockImplementation(() => ({ abortSignal: async () => ({ data: false, error: null }) }));
  expect(await captureToastDaySystem("debounced-shop", "2026-07-22", { debounce: true }))
    .toMatchObject({ skipped: true, reason: "capture_debounced" });
  expect(rpc.mock.calls.map((c) => c[0])).toEqual(["toast_capture_claim"]);
  expect(toastGet).not.toHaveBeenCalled();
  expect(writes.filter((w) => (w.data as { status?: string }).status === "running")).toEqual([]);
});

it("an accepted debounce claim uses its exact run identity for page and finish", async () => {
  rpc.mockImplementation((name: string) => ({ abortSignal: async () => ({ data: name === "toast_capture_claim" ? true : null, error: null }) }));
  const result = await captureToastDaySystem("claimed-shop", "2026-07-22", { debounce: true });
  expect(result.skipped).toBe(false);
  expect(rpc.mock.calls.map((c) => c[0])).toEqual(["toast_capture_claim", "toast_capture_page", "toast_capture_finish"]);
  expect(rpc.mock.calls.every((c) => (c[1] as { p_run_id: string }).p_run_id === result.runId)).toBe(true);
});

it("unfinished date creates a new run at page one and binds each RPC to that location/date", async () => {
  const result = await captureToastDaySystem("new-shop", "2026-07-22", { resume: true });
  expect(result).toMatchObject({ pages: 1, orders: 1, skipped: false });
  expect(toastGet).toHaveBeenCalledWith(expect.stringContaining("page=1&pageSize=100"), "bound-restaurant", expect.any(AbortSignal));
  expect(rpc.mock.calls.map(c => c[0])).toEqual(["toast_capture_page", "toast_capture_finish"]);
  expect(rpc).toHaveBeenCalledWith("toast_capture_page", expect.objectContaining({ p_run_id: result.runId, p_location_id: "new-shop", p_business_date: "2026-07-22", p_page: 1 }));
  expect(writes[1]).toMatchObject({ table: "toast_capture_runs", data: { status: "running", location_id: "new-shop" } });
});

it("write failure leaves a failed manifest and never calls finish", async () => {
  pageError = true;
  await expect(captureToastDaySystem("failed-shop", "2026-07-22")).rejects.toThrow("capture_page_write_failed");
  expect(rpc.mock.calls.map(c => c[0])).toEqual(["toast_capture_page"]);
  expect(writes.at(-1)).toMatchObject({ table: "toast_capture_runs", data: { status: "failed", error_code: "capture_page_write_failed" } });
  expect(JSON.stringify(writes)).not.toContain("private");
});

it("skips fixture fallback before any database work", async () => {
  vi.mocked(toastConfigured).mockReturnValue(false);
  await expect(captureToastDaySystem("shop", "2026-07-22")).resolves.toMatchObject({ skipped: true });
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});

afterEach(() => vi.unstubAllEnvs());

it("kill switch defaults off and explicit fixture mode is neutral", async () => {
  vi.stubEnv("TOAST_ORDER_CAPTURE", "");
  await expect(captureToastDaySystem("shop", "2026-07-22")).resolves.toMatchObject({ skipped: true });
  vi.stubEnv("TOAST_ORDER_CAPTURE", "1"); vi.stubEnv("TOAST_FIXTURES", "1");
  await expect(captureToastDaySystem("shop", "2026-07-22")).resolves.toMatchObject({ skipped: true });
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});

it("missing schema is skipped instead of rejecting the sales pull", async () => {
  schemaMissing = true;
  await expect(captureToastDaySystem("shop", "2026-07-22")).resolves.toMatchObject({ skipped: true, reason: "capture_schema_missing" });
  expect(toastGet).not.toHaveBeenCalled();
});

it("optional config errors do not fail order publication", async () => {
  vi.mocked(toastGetPage).mockRejectedValue(new Error("optional names unavailable"));
  await expect(captureToastDaySystem("config-failure-shop", "2026-07-22")).resolves.toMatchObject({ orders: 1, skipped: false });
  expect(rpc).toHaveBeenCalledWith("toast_capture_finish", expect.anything());
});

it("aborts in-flight orders at 60s and cannot publish after a late response", async () => {
  vi.useFakeTimers();
  let release: (value: unknown) => void = () => {};
  vi.mocked(toastGet).mockImplementation(() => new Promise(resolve => { release = resolve; }));
  try {
    const run = captureToastDaySystem("hung-shop", "2026-07-22");
    const rejected = expect(run).rejects.toThrow("capture_deadline");
    await vi.advanceTimersByTimeAsync(1000);
    const signal = vi.mocked(toastGet).mock.calls[0]?.[2];
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(59_000);
    await rejected;
    expect(signal?.aborted).toBe(true);
    release([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(rpc).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it("reconciles only after publication using the exact normalized quantities saved for this run", async () => {
  vi.mocked(toastGet).mockResolvedValue([{ guid: "order", businessDate: 20260722,
    checks: [{ guid: "check", selections: [{ guid: "selection", item: { guid: "item" }, quantity: 2 }] }] }]);
  vi.mocked(recordCaptureReconciliation).mockImplementation(async () => {
    expect(rpc.mock.calls.at(-1)?.[0]).toBe("toast_capture_finish");
    return { status: "mismatch", error: "capture_reconciliation_mismatch" };
  });
  const result = await captureToastDaySystem("shadow-shop", "2026-07-22", { reconcile: true });
  expect(result).toMatchObject({ skipped: false, reconciliation: { status: "mismatch" } });
  expect(recordCaptureReconciliation).toHaveBeenCalledWith("shadow-shop", "2026-07-22", result.runId,
    [expect.objectContaining({ order: expect.objectContaining({ selection_units: [expect.objectContaining({ item_guid: "item", quantity: 2 })] }) })], expect.any(AbortSignal));
  expect(rpc.mock.calls[0]?.[1].p_orders[0].order.selection_units).toMatchObject([{ item_guid: "item", quantity: 2 }]);
});
it("a reconciliation write failure preserves the completed capture and returns a safe error", async () => {
  vi.mocked(recordCaptureReconciliation).mockRejectedValue(new Error("capture_reconciliation_write_failed"));
  const result = await captureToastDaySystem("shadow-write-failure", "2026-07-22", { reconcile: true });
  expect(result).toMatchObject({ skipped: false, reconciliation: { status: "skipped", error: "capture_reconciliation_write_failed" } });
  expect(writes.slice(1)).not.toEqual(expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })]));
});
it("does not reconcile an unpublished failed capture", async () => {
  pageError = true;
  await expect(captureToastDaySystem("shadow-failed", "2026-07-22", { reconcile: true })).rejects.toThrow("capture_page_write_failed");
  expect(recordCaptureReconciliation).not.toHaveBeenCalled();
});

it.each(["returned", "thrown"])("replays the identical page once after a %s transport error", async (kind) => {
  let pages = 0;
  rpc.mockImplementation((name: string) => ({ abortSignal: async () => {
    if (name === "toast_capture_page" && ++pages === 1) {
      if (kind === "thrown") throw new TypeError("private socket detail");
      return { status: 0, error: { code: "", message: "private socket detail" } };
    }
    return { status: 200, error: null };
  } }));
  expect(await captureToastDaySystem("retry-shop", "2026-07-22")).toMatchObject({ orders: 1 });
  const calls = rpc.mock.calls.filter((c) => c[0] === "toast_capture_page");
  expect(calls).toHaveLength(2);
  expect(calls[0]![1]).toEqual(calls[1]![1]);
  expect(rpc.mock.calls.at(-1)![0]).toBe("toast_capture_finish");
});
it("classifies persistent transport failure after exactly one retry without publishing", async () => {
  rpc.mockImplementation(() => ({ abortSignal: async () => ({ status: 0, error: { code: "", message: "private" } }) }));
  await expect(captureToastDaySystem("transport-fail-shop", "2026-07-22")).rejects.toThrow("capture_page_transport_failed");
  expect(rpc.mock.calls.map((c) => c[0])).toEqual(["toast_capture_page", "toast_capture_page"]);
  expect(writes.at(-1)).toMatchObject({ data: { status: "failed", error_code: "capture_page_transport_failed" } });
  expect(JSON.stringify(writes)).not.toContain("private");
});
it("does not retry a status-bearing HTTP failure", async () => {
  rpc.mockImplementation(() => ({ abortSignal: async () => ({ status: 503, error: { code: "", message: "private" } }) }));
  await expect(captureToastDaySystem("http-fail-shop", "2026-07-22")).rejects.toThrow("capture_page_write_failed");
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("passes the hourly interval to the claim RPC", async () => {
  rpc.mockImplementation(() => ({ abortSignal: async () => ({ data: false, error: null }) }));
  await captureToastDaySystem("hourly-shop", "2026-07-22", { debounce: true, minInterval: "1 hour" });
  expect(rpc).toHaveBeenCalledWith("toast_capture_claim", expect.objectContaining({ p_min_interval: "1 hour" }));
});

it("does not replay a transport failure once the parent deadline is aborted", async () => {
  const parent = new AbortController();
  rpc.mockImplementation(() => ({ abortSignal: async () => {
    parent.abort();
    return { status: 0, error: { code: "", message: "private" } };
  } }));
  await expect(captureToastDaySystem("aborted-retry-shop", "2026-07-22", { signal: parent.signal }))
    .rejects.toThrow("capture_deadline");
  expect(rpc.mock.calls.map((c) => c[0])).toEqual(["toast_capture_page"]);
});
