import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchToastOrders } from "@/lib/toast/orders";
import { runOrderCapture } from "@/lib/toast/capture-job";
import { refreshTodaySalesIfStale, pullSalesSystemTrigger, pullSales } from "@/lib/catering/toast-sales";
import { captureToastDaySystem } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

vi.mock("@/lib/toast/orders", () => ({ fetchToastOrders: vi.fn(async () => []) }));
vi.mock("@/lib/toast/menus", () => ({ fetchToastMenuItems: vi.fn(async () => []) }));
vi.mock("@/lib/toast/config", () => ({ fetchDiningOptionNames: vi.fn(async () => new Map()) }));
vi.mock("@/lib/toast/capture-job", () => ({ runOrderCapture: vi.fn(async () => ({ failures: 0, skipped: false, results: [] })) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/capture", () => ({ captureToastDaySystem: vi.fn(), captureEnabled: vi.fn(() => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEPLETION_SOURCE", "capture");
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "run", pages: 1, orders: 0, skipped: false });
  const from = (table: string) => {
    if (table !== "locations") throw new Error(`Unexpected I/O: ${table}`);
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: { id: "shop", toast_restaurant_guid: "toast-shop" }, error: null }) };
    return query;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it.each(["pinger", "midshift_on_visit", "closing_confirm"] as const)("%s captures a full day with the atomic debounce", async (context) => {
  await expect(pullSalesSystemTrigger("shop", "2026-07-23", { context })).resolves.toBe(true);
  expect(captureToastDaySystem).toHaveBeenCalledExactlyOnceWith("shop", "2026-07-23", {
    debounce: true, signal: expect.any(AbortSignal),
  });
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "toast_sales.pull",
    metadata: expect.objectContaining({ actor_context: context, source: "capture" }) }));
});

it("reports upstream failures without leaking provider payloads or reading the legacy ledger", async () => {
  vi.mocked(captureToastDaySystem).mockRejectedValue(new Error("PRIVATE provider payload"));
  await expect(pullSalesSystemTrigger("shop", "2026-07-23", { context: "closing_confirm" })).resolves.toBe(false);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "toast_sales.pull_failed",
    metadata: expect.objectContaining({ error: "capture_failed" }) }));
  expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain("PRIVATE");
});

it.each([
  ["capture_debounced", "fresh"], ["capture_running", "unknown"],
  ["capture_recent_failure", "error"], ["capture_disabled", "error"], ["capture_schema_missing", "error"],
] as const)("%s remains %s instead of inventing a completed capture", async (reason, expected) => {
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "", pages: 0, orders: 0, skipped: true, reason });
  await expect(refreshTodaySalesIfStale("shop", "2026-07-23", 60_000, "pinger")).resolves.toBe(expected);
});

it("bounds a hung transport and aborts the signal at 45 seconds", async () => {
  vi.useFakeTimers();
  vi.mocked(captureToastDaySystem).mockImplementation(() => new Promise(() => {}));
  const pending = pullSalesSystemTrigger("shop", "2026-07-23", { context: "midshift_on_visit" });
  await vi.advanceTimersByTimeAsync(0);
  const signal = vi.mocked(captureToastDaySystem).mock.calls[0]![2]!.signal!;
  await vi.advanceTimersByTimeAsync(45_000);
  await expect(pending).resolves.toBe(false);
  expect(signal.aborted).toBe(true);
});

it("manual flag-OFF pull appends legacy selections and runs additive capture", async () => {
  vi.stubEnv("DEPLETION_SOURCE", undefined);
  const insert = vi.fn(async () => ({ error: null }));
  const tables: string[] = [];
  const from = (table: string) => {
    tables.push(table);
    const query = { select: () => query, eq: () => query, order: () => query, range: () => query, insert,
      returns: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: { id: "shop", toast_restaurant_guid: "toast-shop" }, error: null }) };
    return query;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(fetchToastOrders).mockResolvedValueOnce([{ checkGuid: "check", selectionGuid: "selection", parentSelectionGuid: null,
    itemGuid: "item", displayName: "Item", quantity: 2, priceCents: 1000, voided: false, diningOptionGuid: null }] as Awaited<ReturnType<typeof fetchToastOrders>>);
  const actor = { user: { id: "gm", role: "gm" }, locations: ["shop"] } as unknown as Parameters<typeof pullSales>[0];
  await expect(pullSales(actor, "shop", "2026-07-23")).resolves.toMatchObject({ selections: 1, appended: 1, capture: { failures: 0 } });
  expect(tables).toContain("toast_sales_events");
  expect(insert).toHaveBeenCalledWith([expect.objectContaining({ location_id: "shop", selection_guid: "selection", snapshot_version: 1 })]);
  expect(captureToastDaySystem).not.toHaveBeenCalled();
  expect(runOrderCapture).toHaveBeenCalledExactlyOnceWith(["shop"], "2026-07-23", "manual");
});

it("manual pull refuses an unbound location before capture or database I/O", async () => {
  const actor = { user: { id: "gm", role: "gm" }, locations: ["other-shop"] } as unknown as Parameters<typeof pullSales>[0];
  await expect(pullSales(actor, "shop", "2026-07-23")).rejects.toMatchObject({ status: 403 });
  expect(captureToastDaySystem).not.toHaveBeenCalled();
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});

it("flag-OFF refresh honors legacy attempt debounce without pulling or capturing", async () => {
  vi.stubEnv("DEPLETION_SOURCE", undefined);
  const query = { select: () => query, in: () => query, eq: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: { occurred_at: new Date().toISOString(), action: "toast_sales.pull", metadata: { business_date: "2026-07-23" } }, error: null }) };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => query } as unknown as ReturnType<typeof getServiceRoleClient>);
  await expect(refreshTodaySalesIfStale("shop", "2026-07-23", 60_000, "pinger")).resolves.toBe("fresh");
  expect(fetchToastOrders).not.toHaveBeenCalled();
  expect(captureToastDaySystem).not.toHaveBeenCalled();
});
