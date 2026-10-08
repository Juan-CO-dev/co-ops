import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { refreshTodaySalesIfStale, pullSalesSystemTrigger, pullSales } from "@/lib/catering/toast-sales";
import { captureToastDaySystem } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/capture", () => ({ captureToastDaySystem: vi.fn(), captureEnabled: vi.fn(() => true) }));
vi.mock("@/lib/toast/orders", () => ({ fetchToastOrders: vi.fn(async () => []) }));
vi.mock("@/lib/toast/menus", () => ({ fetchToastMenuItems: vi.fn(async () => []) }));
vi.mock("@/lib/toast/config", () => ({ fetchDiningOptionNames: vi.fn(async () => new Map()) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

let lastAttempt: unknown = null;
beforeEach(() => {
  vi.clearAllMocks();
  lastAttempt = null;
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "run", pages: 1, orders: 0, skipped: false });
  const from = (table: string) => {
    const query = {
      select: () => query, eq: () => query, in: () => query,
      order: () => query, limit: () => query, range: () => query,
      returns: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: table === "audit_log" ? lastAttempt : { id: "shop", toast_restaurant_guid: "toast-shop" }, error: null }),
    };
    return query;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>);
});

afterEach(() => vi.useRealTimers());

it.each(["pinger", "midshift_on_visit", "closing_confirm"] as const)("%s stays events-only even when order capture would fail", async (context) => {
  vi.mocked(captureToastDaySystem).mockRejectedValue(new Error("PRIVATE payload"));
  await expect(pullSalesSystemTrigger("shop", "2026-07-23", { context })).resolves.toBe(true);
  expect(captureToastDaySystem).not.toHaveBeenCalled();
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "toast_sales.pull", metadata: expect.objectContaining({ actor_context: context }) }));
  expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure" }));
});

it.each(["pinger", "midshift_on_visit"] as const)("%s freshness pulls only selections", async (context) => {
  await expect(refreshTodaySalesIfStale("shop", "2026-07-23", 60_000, context)).resolves.toBe("pulled");
  expect(captureToastDaySystem).not.toHaveBeenCalled();
});

it("a legacy capture_ok false does not turn a successful recent selection pull unhealthy", async () => {
  lastAttempt = { action: "toast_sales.pull", metadata: { business_date: "2026-07-23", capture_ok: false }, occurred_at: new Date().toISOString() };
  await expect(refreshTodaySalesIfStale("shop", "2026-07-23", 60_000, "pinger")).resolves.toBe("fresh");
  expect(captureToastDaySystem).not.toHaveBeenCalled();
});

it("debounces actual selection failures without reporting a healthy fresh cycle", async () => {
  lastAttempt = { action: "toast_sales.pull_failed", metadata: { business_date: "2026-07-23" }, occurred_at: new Date().toISOString() };
  await expect(refreshTodaySalesIfStale("shop", "2026-07-23", 60_000, "pinger")).resolves.toBe("error");
  expect(captureToastDaySystem).not.toHaveBeenCalled();
});

it("manual capture is bounded and cannot invalidate a successful bound selection pull", async () => {
  vi.useFakeTimers();
  vi.mocked(captureToastDaySystem).mockImplementation(() => new Promise(() => {}));
  const actor = { user: { id: "gm", role: "gm" }, locations: ["shop"] } as unknown as Parameters<typeof pullSales>[0];
  const pending = pullSales(actor, "shop", "2026-07-23");
  await vi.advanceTimersByTimeAsync(0);
  expect(captureToastDaySystem).toHaveBeenCalledWith("shop", "2026-07-23", { signal: expect.any(AbortSignal) });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await pending).toMatchObject({ selections: 0, appended: 0, capture: { failures: 1 } });
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: expect.objectContaining({ job: "toast-order-capture-manual" }) }));
  expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: expect.objectContaining({ job: "toast-order-capture" }) }));
});

it("manual pull refuses an unbound location before capture or database I/O", async () => {
  const actor = { user: { id: "gm", role: "gm" }, locations: ["other-shop"] } as unknown as Parameters<typeof pullSales>[0];
  await expect(pullSales(actor, "shop", "2026-07-23")).rejects.toMatchObject({ status: 403 });
  expect(captureToastDaySystem).not.toHaveBeenCalled();
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});
