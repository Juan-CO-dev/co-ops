import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runToastLaborPull, toastModifiedParam, withDeadline } from "@/lib/toast/labor";
import { summarizeLabor, type LaborEntryRow } from "@/lib/toast/labor-shared";
import { laborForDigest } from "@/lib/report-digests-v2";
import { ok } from "@/lib/report-digests-v2-shared";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { toastGet } from "@/lib/toast/client";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/client", () => ({ toastGet: vi.fn() }));

const LOC = "loc-1";
/** A tiny in-memory toast_time_entries keyed like the table (location, entry guid). */
const table = new Map<string, LaborEntryRow>();
let stallLocations = false;

function client() {
  return {
    from(name: string) {
      if (name === "locations") {
        const q = {
          select: () => q, eq: () => q, not: () => q, in: () => q, returns: () => q,
          abortSignal: (signal: AbortSignal) => {
            q.signal = signal; return q;
          },
          signal: null as AbortSignal | null,
          then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
            if (!stallLocations) return resolve({ data: [{ id: LOC, toast_restaurant_guid: "r-1" }], error: null });
            // A stalled query that even IGNORES its abort signal: only withDeadline can end it.
            void reject;
          },
        };
        return q;
      }
      return {
        upsert: (rows: LaborEntryRow[]) => {
          for (const r of rows) table.set(`${r.location_id}|${r.time_entry_guid}`, r);
          return { abortSignal: async () => ({ error: null }) };
        },
      };
    },
  } as unknown as ReturnType<typeof getServiceRoleClient>;
}

const entry = (over: Record<string, unknown> = {}) => ({
  guid: "te-1", deleted: false, businessDate: "20261007", employeeReference: { guid: "emp-ana" }, jobReference: { guid: "job-line" },
  inDate: "2026-10-07T12:00:00.000+0000", outDate: "2026-10-07T20:00:00.000+0000", regularHours: 8, overtimeHours: 0, breaks: [], ...over,
});
/** Toast as the contract describes it: businessDate queries NEVER return archived entries. */
let toast: Array<Record<string, unknown>> = [];
beforeEach(() => {
  vi.clearAllMocks();
  table.clear(); stallLocations = false; toast = [];
  vi.stubEnv("TOAST_LABOR_PULL", "1");
  vi.mocked(getServiceRoleClient).mockReturnValue(client());
  vi.mocked(toastGet).mockImplementation(async (path: string) => {
    if (path.startsWith("/labor/v1/jobs")) return [{ guid: "job-line", title: "Line Cook" }];
    if (path.startsWith("/labor/v1/employees")) return [{ guid: "emp-ana", firstName: "Ana" }];
    if (path.includes("businessDate=")) return toast.filter((e) => e.deleted !== true);
    if (path.includes("modifiedStartDate=") && path.includes("includeArchived=true")) return toast;
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("archived shifts (Astra r2 P2): import → archive → refresh", () => {
  it("an entry archived after import is marked deleted through the modification window", async () => {
    toast = [entry()];
    await runToastLaborPull(["2026-10-07"], { deadlineMs: 10_000, context: "cron" });
    expect(table.get(`${LOC}|te-1`)).toMatchObject({ deleted: false, hours: 8 });
    // Archived in Toast: the business-date query no longer returns it at all.
    toast = [entry({ deleted: true, modifiedDate: "2026-10-08T15:00:00.000+0000" })];
    const res = await runToastLaborPull(["2026-10-07"], { deadlineMs: 10_000, context: "cron" });
    expect(table.get(`${LOC}|te-1`)).toMatchObject({ deleted: true });
    expect(res.modified).toBe(1);
    // The digest reads deleted=false only: the archived shift no longer counts.
    const live = [...table.values()].filter((r) => !r.deleted);
    expect(summarizeLabor("2026-10-07", live.map((r) => ({ employeeGuid: r.employee_guid, firstName: r.employee_first_name, jobName: r.job_name, businessDate: r.business_date, hours: r.hours, overtimeHours: r.overtime_hours, open: r.out_at === null })), null).totalHours).toBe(0);
  });

  it("asks Toast for the modification window with archived entries included", async () => {
    await runToastLaborPull(["2026-10-07"], { deadlineMs: 10_000, context: "cron", now: new Date("2026-10-08T09:00:00.000Z") });
    const paths = vi.mocked(toastGet).mock.calls.map((c) => c[0]);
    expect(paths).toContain(`/labor/v1/timeEntries?modifiedStartDate=${toastModifiedParam(new Date("2026-10-06T09:00:00.000Z"))}&modifiedEndDate=${toastModifiedParam(new Date("2026-10-08T09:00:00.000Z"))}&includeArchived=true`);
    expect(toastModifiedParam(new Date("2026-10-08T09:00:00.000Z"))).toBe("2026-10-08T09%3A00%3A00.000%2B0000");
  });
});

describe("deadline covers the initial locations read (Astra r2 P2)", () => {
  it("a stalled locations query ends at the deadline with a failure heartbeat, even if the driver ignores the signal", async () => {
    stallLocations = true;
    const started = Date.now();
    const res = await runToastLaborPull(["2026-10-07"], { deadlineMs: 1_000, context: "cron" });
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(res.results).toEqual([{ locationId: "*", businessDate: "2026-10-07", ok: false, rows: 0, skipped: 0, error: "toast_labor_deadline" }]);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.failure" });
  });

  it("the heartbeat itself is bounded: a hung audit cannot hold the run", async () => {
    vi.mocked(audit).mockImplementationOnce(() => new Promise(() => {}));
    toast = [entry()];
    const started = Date.now();
    const res = await runToastLaborPull(["2026-10-07"], { deadlineMs: 10_000, context: "cron" });
    expect(res.results[0]).toMatchObject({ ok: true });
    expect(Date.now() - started).toBeLessThan(8_000);
    await expect(withDeadline(new Promise(() => {}), AbortSignal.timeout(50))).rejects.toThrow("toast_labor_deadline");
  }, 15_000);
});

describe("labor timing (Astra r2 P1): the digest pulls day D itself, before composing", () => {
  // Business day D = Wed 2026-10-07. Closing digest ~22:30 ET, the 03:00 ET fallback on D+1, the
  // nightly at 09:00 UTC (05:00 ET) on D+1. Only the nightly existed before: both digests composed
  // with no labor for D.
  const read = async () => ok(summarizeLabor("2026-10-07", [...table.values()].filter((r) => !r.deleted).map((r) => ({
    employeeGuid: r.employee_guid, firstName: r.employee_first_name, jobName: r.job_name, businessDate: r.business_date,
    hours: r.hours, overtimeHours: r.overtime_hours, open: r.out_at === null,
  })), 80_000));
  const pull = async (day: string, loc: string) => {
    const r = await runToastLaborPull([day], { deadlineMs: 10_000, context: "digest", locationIds: [loc] });
    return { ok: r.ran && r.results.length > 0 && r.results.every((x) => x.ok) };
  };
  const deps = { enabled: () => true, pull, read };

  it("closing → fallback → nightly: each step sees D's labor at that moment; the nightly is a backstop", async () => {
    // Closing (22:30 ET): Ana is done, Kim still clocked in.
    toast = [entry(), entry({ guid: "te-2", employeeReference: { guid: "emp-kim" }, inDate: "2026-10-07T22:00:00.000+0000", outDate: null, regularHours: null })];
    const closing = await laborForDigest(LOC, "2026-10-07", deps);
    expect(closing).toMatchObject({ kind: "ok", value: { totalHours: 8, openEntries: 1, salesPerLaborHourCents: 10000 } });
    // 03:00 ET fallback: Kim clocked out at 02:30 (with a 0.5 h unpaid break, regularHours not yet set).
    toast = [entry(), entry({ guid: "te-2", employeeReference: { guid: "emp-kim" }, inDate: "2026-10-07T22:00:00.000+0000", outDate: "2026-10-08T06:30:00.000+0000", regularHours: null,
      breaks: [{ paid: false, missed: false, inDate: "2026-10-08T02:00:00.000+0000", outDate: "2026-10-08T02:30:00.000+0000" }] })];
    const fallback = await laborForDigest(LOC, "2026-10-07", deps);
    expect(fallback).toMatchObject({ kind: "ok", value: { totalHours: 16, openEntries: 0 } });
    // 09:00 UTC nightly backstop: same rows, upserted idempotently (same keys, no double count).
    await runToastLaborPull(["2026-10-07"], { deadlineMs: 10_000, context: "cron" });
    expect(table.size).toBe(2);
    expect(await read()).toMatchObject({ kind: "ok", value: { totalHours: 16 } });
  });

  it("a failed or disabled digest-time pull says labor not available yet — never zero, never stale rows", async () => {
    table.set(`${LOC}|stale`, { location_id: LOC, time_entry_guid: "stale", business_date: "2026-10-07", employee_guid: "e", employee_first_name: "Old", job_guid: null, job_name: null, in_at: "2026-10-07T12:00:00.000Z", out_at: "2026-10-07T14:00:00.000Z", hours: 2, overtime_hours: 0, auto_clocked_out: false, deleted: false, source_modified_at: null });
    vi.mocked(toastGet).mockRejectedValue(Object.assign(new Error("boom"), { name: "ToastApiError", code: "http_500" }));
    expect(await laborForDigest(LOC, "2026-10-07", deps)).toEqual({ kind: "unavailable", reason: "labor_pull_failed" });
    expect(await laborForDigest(LOC, "2026-10-07", { ...deps, enabled: () => false })).toEqual({ kind: "unavailable", reason: "labor_off" });
  });
});
