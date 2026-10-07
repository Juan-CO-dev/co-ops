import { beforeEach, expect, it, vi } from "vitest";
import { refreshTodaySalesIfStale, pullSalesSystemTrigger, pullSales } from "@/lib/catering/toast-sales";
import { captureToastDaySystem } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/capture", () => ({ captureToastDaySystem: vi.fn() }));
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

it("system capture failure returns false and a failed attempt marker", async () => {
  vi.mocked(captureToastDaySystem).mockRejectedValue(new Error("PRIVATE payload"));
  await expect(pullSalesSystemTrigger("shop", "2026-07-23", { context: "pinger" })).resolves.toBe(false);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "toast_sales.pull_failed", metadata: expect.objectContaining({ error: "order_capture_failed" }) }));
  expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain("PRIVATE");
});

it("freshness exposes an attempted capture failure to the pinger", async () => {
  vi.mocked(captureToastDaySystem).mockRejectedValue(new Error("unavailable"));
  await expect(refreshTodaySalesIfStale("shop", "2026-07-23", 60_000, "pinger")).resolves.toBe("error");
});

it.each([
  { action: "toast_sales.pull_failed", metadata: { business_date: "2026-07-23" } },
  { action: "toast_sales.pull", metadata: { business_date: "2026-07-23", capture_ok: false } },
])("debounces failed attempts without reporting a healthy fresh cycle", async (row) => {
  lastAttempt = { ...row, occurred_at: new Date().toISOString() };
  await expect(refreshTodaySalesIfStale("shop", "2026-07-23", 60_000, "pinger")).resolves.toBe("error");
  expect(captureToastDaySystem).not.toHaveBeenCalled();
});

it("a healthy recent capture is fresh", async () => {
  lastAttempt = { action: "toast_sales.pull", metadata: { business_date: "2026-07-23", capture_ok: true }, occurred_at: new Date().toISOString() };
  await expect(refreshTodaySalesIfStale("shop", "2026-07-23", 60_000, "pinger")).resolves.toBe("fresh");
});

it("manual pull refuses an unbound location before capture or database I/O", async () => {
  const actor = { user: { id: "gm", role: "gm" }, locations: ["other-shop"] } as unknown as Parameters<typeof pullSales>[0];
  await expect(pullSales(actor, "shop", "2026-07-23")).rejects.toMatchObject({ status: 403 });
  expect(captureToastDaySystem).not.toHaveBeenCalled();
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});
