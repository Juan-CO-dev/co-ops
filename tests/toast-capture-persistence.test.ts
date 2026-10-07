import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureToastDaySystem } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { toastConfigured, toastGet, toastGetPage } from "@/lib/toast/client";

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
  rpc = vi.fn((name: string) => ({ abortSignal: async () => ({ error: name === "toast_capture_page" && pageError ? { message: "private" } : null }) }));
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
