import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runToastLaborPull } from "@/lib/toast/labor";
import { runAutoLinks } from "@/lib/toast/employee-links";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/employee-links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toast/employee-links")>()),
  runAutoLinks: vi.fn(async () => ({ linked: 1, skipped: 0 })),
}));

const order: string[] = [];
beforeEach(() => {
  vi.clearAllMocks(); order.length = 0;
  vi.stubEnv("TOAST_CLIENT_ID", ""); vi.stubEnv("TOAST_CLIENT_SECRET", ""); vi.stubEnv("TOAST_FIXTURES", "1");
  vi.stubEnv("TOAST_LABOR_PULL", "1");
  vi.mocked(runAutoLinks).mockImplementation(async () => { order.push("autolink"); return { linked: 1, skipped: 0 }; });
  vi.mocked(getServiceRoleClient).mockReturnValue({
    from(table: string) {
      if (table === "locations") {
        const q = { select: () => q, eq: () => q, not: () => q, in: () => q, abortSignal: () => q, returns: async () => ({ data: [{ id: "loc-1", toast_restaurant_guid: "r-1" }], error: null }) };
        return q;
      }
      return { upsert: () => { order.push("upsert"); return { abortSignal: async () => ({ error: null }) }; } };
    },
  } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => vi.unstubAllEnvs());

it("WHOS_HERE off: the labor pull never auto-links (deploy-safe before 0233)", async () => {
  await runToastLaborPull(["2026-10-07"], { deadlineMs: 10_000, context: "cron" });
  expect(runAutoLinks).not.toHaveBeenCalled();
});

it("WHOS_HERE on: auto-links ONCE per shop from the same employees payload, BEFORE any entry is written", async () => {
  vi.stubEnv("WHOS_HERE", "1");
  const res = await runToastLaborPull(["2026-10-07"], { deadlineMs: 10_000, context: "cron" });
  expect(runAutoLinks).toHaveBeenCalledTimes(1);
  const args = vi.mocked(runAutoLinks).mock.calls[0]![1];
  expect(args.locationId).toBe("loc-1");
  expect(JSON.stringify(args.rawEmployees)).toContain("emp-ana");
  expect(order[0]).toBe("autolink");
  expect(res.results.every((r) => r.ok)).toBe(true);
});

it("an auto-link failure is reported with a fixed code and never blocks the labor rows", async () => {
  vi.stubEnv("WHOS_HERE", "1");
  vi.mocked(runAutoLinks).mockRejectedValueOnce(new Error("toast_labor_autolink_failed"));
  const res = await runToastLaborPull(["2026-10-07"], { deadlineMs: 10_000, context: "cron" });
  expect(res.results).toContainEqual({ locationId: "loc-1", businessDate: "autolink", ok: false, rows: 0, skipped: 0, error: "toast_labor_autolink_failed" });
  expect(res.results).toContainEqual(expect.objectContaining({ businessDate: "2026-10-07", ok: true }));
  expect(order).toContain("upsert");
});
