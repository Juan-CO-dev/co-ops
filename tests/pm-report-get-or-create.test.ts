import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/assignments", () => ({
  hasTaskAccess: vi.fn(async () => true),
  auditTaskOverride: vi.fn(async () => undefined),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ enqueueNotification: vi.fn(), NOTIFICATION_TYPES: {} }));
vi.mock("@/lib/people/settings", () => ({
  PM_V2_SWITCH_AVAILABLE: true,
  loadPeopleShopSettings: vi.fn(),
}));

import { audit } from "@/lib/audit";
import { auditTaskOverride } from "@/lib/assignments";
import { loadPeopleShopSettings } from "@/lib/people/settings";
import { getOrCreatePmReport, type PmActor } from "@/lib/pm-report";

const args = {
  locationId: "shop-a", date: "2026-11-01",
  actor: { userId: "manager-a", role: "key_holder", level: 4 } satisfies PmActor,
};
type Result = {
  data: { id: string; format?: string | null } | null;
  error: { code: string; message: string } | null;
};
const miss: Result = { data: null, error: null };
const conflict: Result = { data: null, error: { code: "23505", message: "duplicate live day" } };

// Script each database response while recording the actual read scope.
function client(readResults: Result[], insertResults: Result[]) {
  const reads: Array<Array<unknown[]>> = [];
  const insert = vi.fn();
  const from = vi.fn((table: string) => {
    expect(table).toBe("pm_reports");
    const scope: Array<unknown[]> = [];
    const query = {
      select: (columns: string) => { scope.push(["select", columns]); return query; },
      eq: (column: string, value: unknown) => { scope.push(["eq", column, value]); return query; },
      is: (column: string, value: unknown) => { scope.push(["is", column, value]); return query; },
      insert: (row: unknown) => { insert(row); return query; },
      maybeSingle: async () => {
        reads.push(scope);
        const result = readResults.shift();
        if (!result) throw new Error("Unexpected read");
        return result;
      },
      single: async () => {
        const result = insertResults.shift();
        if (!result) throw new Error("Unexpected insert");
        return result;
      },
    };
    return query;
  });
  return { service: { from } as unknown as SupabaseClient, reads, insert };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPeopleShopSettings).mockResolvedValue({ pmV2: false, prepPositionId: null });
});

describe("getOrCreatePmReport race recovery", () => {
  it("two initial misses return the same day; only the successful insert audits", async () => {
    const winner = { id: "stored-day", format: "v1" };
    const db = client([miss, miss, { data: winner, error: null }], [
      { data: { id: winner.id }, error: null }, conflict,
    ]);
    const results = await Promise.all([
      getOrCreatePmReport(db.service, args), getOrCreatePmReport(db.service, args),
    ]);
    expect(results).toEqual([winner, winner]);
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(auditTaskOverride).toHaveBeenCalledTimes(1);
    expect(auditTaskOverride).toHaveBeenCalledWith(db.service, expect.objectContaining({ operation: "pm_report.create" }));
    expect(audit).not.toHaveBeenCalled();
    expect(db.reads).toEqual(Array.from({ length: 3 }, () => [
      ["select", "*"], ["eq", "location_id", args.locationId],
      ["eq", "report_date", args.date], ["is", "superseded_at", null],
    ]));
  });

  it.each(["v1", "v2"] as const)("loser returns stored %s despite the opposite shop setting, without auditing", async (format) => {
    vi.mocked(loadPeopleShopSettings).mockResolvedValue({ pmV2: format === "v1", prepPositionId: null });
    const winner = { id: "stored-day", format };
    const db = client([miss, { data: winner, error: null }], [conflict]);
    await expect(getOrCreatePmReport(db.service, args)).resolves.toEqual(winner);
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining(
      format === "v1" ? { format: "v2" } : { status: "open" },
    ));
    if (format === "v2") expect(db.insert.mock.calls[0]![0]).not.toHaveProperty("format");
    expect(auditTaskOverride).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("initial SELECT failure never inserts or reads settings", async () => {
    const db = client([{ data: null, error: { code: "08006", message: "initial read failed" } }], []);
    await expect(getOrCreatePmReport(db.service, args)).rejects.toThrow("initial read failed");
    expect(db.insert).not.toHaveBeenCalled();
    expect(loadPeopleShopSettings).not.toHaveBeenCalled();
    expect(auditTaskOverride).not.toHaveBeenCalled();
  });

  it.each([
    [{ data: null, error: { code: "08006", message: "winner read failed" } }, "winner read failed"],
    [miss, "no row visible on re-read"],
  ] satisfies Array<[Result, string]>)("failed or empty winner read remains a failure: %j", async (result, message) => {
    const db = client([miss, result], [conflict]);
    await expect(getOrCreatePmReport(db.service, args)).rejects.toThrow(message);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.reads).toHaveLength(2);
    expect(auditTaskOverride).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("non-23505 insert errors propagate without a re-read or audit", async () => {
    const db = client([miss], [{ data: null, error: { code: "42501", message: "insert denied" } }]);
    await expect(getOrCreatePmReport(db.service, args)).rejects.toThrow("getOrCreatePmReport: insert denied");
    expect(db.reads).toHaveLength(1);
    expect(auditTaskOverride).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
