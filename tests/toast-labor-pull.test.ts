import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runToastLaborPull } from "@/lib/toast/labor";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

const upserts: Array<{ rows: Array<Record<string, unknown>>; onConflict: string }> = [];
let failWrite = false;
beforeEach(() => {
  vi.clearAllMocks();
  upserts.length = 0; failWrite = false;
  // Fixture mode: no Toast credentials on this machine, and none are ever needed by the tests.
  vi.stubEnv("TOAST_CLIENT_ID", ""); vi.stubEnv("TOAST_CLIENT_SECRET", ""); vi.stubEnv("TOAST_FIXTURES", "1");
  vi.mocked(getServiceRoleClient).mockReturnValue({
    from(table: string) {
      if (table === "locations") {
        const q = { select: () => q, eq: () => q, not: () => q, returns: async () => ({ data: [{ id: "loc-1", toast_restaurant_guid: "r-1" }], error: null }) };
        return q;
      }
      return {
        upsert: (rows: Array<Record<string, unknown>>, opts: { onConflict: string }) => {
          upserts.push({ rows, onConflict: opts.onConflict });
          return { abortSignal: async () => ({ error: failWrite ? { message: "relation does not exist" } : null }) };
        },
      };
    },
  } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => vi.unstubAllEnvs());

it("does nothing (no reads, no heartbeat) until TOAST_LABOR_PULL=1", async () => {
  vi.stubEnv("TOAST_LABOR_PULL", "");
  expect(await runToastLaborPull(["2026-10-07"], { deadlineMs: 10_000, context: "cron" })).toEqual({ ran: false, results: [] });
  expect(getServiceRoleClient).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

it("upserts the minimal rows by (location, entry guid) and writes one success heartbeat", async () => {
  vi.stubEnv("TOAST_LABOR_PULL", "1");
  const res = await runToastLaborPull(["2026-10-07"], { deadlineMs: 10_000, context: "cron" });
  expect(res.results).toEqual([{ locationId: "loc-1", businessDate: "2026-10-07", ok: true, rows: 4, skipped: 1 }]);
  expect(upserts[0]!.onConflict).toBe("location_id,time_entry_guid");
  expect(JSON.stringify(upserts[0]!.rows)).not.toMatch(/hourlyWage|Tips|Sales|López/);
  expect(audit).toHaveBeenCalledTimes(1);
  expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.success", metadata: expect.objectContaining({ job: "toast-labor-pull", rows: 4 }) });
});

it("a failed write fails soft: the run returns, the heartbeat is a failure with a fixed code (no provider text)", async () => {
  vi.stubEnv("TOAST_LABOR_PULL", "1");
  failWrite = true;
  const res = await runToastLaborPull(["2026-10-07"], { deadlineMs: 10_000, context: "cron" });
  expect(res.results[0]).toMatchObject({ ok: false, error: "toast_labor_write_failed" });
  const call = vi.mocked(audit).mock.calls[0]![0];
  expect(call).toMatchObject({ action: "cron.failure", metadata: expect.objectContaining({ job: "toast-labor-pull", per_location_failures: 1 }) });
  expect(JSON.stringify(call)).not.toContain("relation does not exist");
});
