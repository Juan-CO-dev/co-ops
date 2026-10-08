import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { refreshTodaySalesIfStale, pullSalesSystemTrigger, pullSales } from "@/lib/catering/toast-sales";
import { captureToastDaySystem } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/capture", () => ({ captureToastDaySystem: vi.fn(), captureEnabled: vi.fn(() => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.clearAllMocks();
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

it("manual captures even while depletion readers retain their legacy default", async () => {
  vi.stubEnv("DEPLETION_SOURCE", "legacy");
  const actor = { user: { id: "gm", role: "gm" }, locations: ["shop"] } as unknown as Parameters<typeof pullSales>[0];
  await expect(pullSales(actor, "shop", "2026-07-23")).resolves.toMatchObject({
    selections: 0, appended: 0, unchanged: 0, voids: 0, capture: { failures: 0, skipped: false },
  });
  expect(captureToastDaySystem).toHaveBeenCalledTimes(1);
});

it("manual pull refuses an unbound location before capture or database I/O", async () => {
  const actor = { user: { id: "gm", role: "gm" }, locations: ["other-shop"] } as unknown as Parameters<typeof pullSales>[0];
  await expect(pullSales(actor, "shop", "2026-07-23")).rejects.toMatchObject({ status: 403 });
  expect(captureToastDaySystem).not.toHaveBeenCalled();
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});

it("retires the legacy writer while preserving its paged evidence reader", () => {
  const source = readFileSync("lib/catering/toast-sales.ts", "utf8");
  expect(source).not.toContain("fetchToastOrders");
  expect(source).not.toContain("selectionChanged");
  expect(source).toContain("async function loadLatestVersions");
});
