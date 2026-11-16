import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeElapsedCateringEvents } from "@/lib/catering/system-intake";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const leads = [
  { id: "provider-lead", stage: "confirmed", location_id: "shop", lead_source: "ezcater" },
  { id: "house-lead", stage: "out", location_id: "shop", lead_source: "toast" },
];
let pendingKey: string | null;
let pendingFailure: "error" | "throw" | null;
const updatedIds: string[] = [];
const pendingFilter = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  pendingKey = null;
  pendingFailure = null;
  updatedIds.length = 0;
  vi.mocked(getServiceRoleClient).mockReturnValue({
    from(table: string) {
      let updating = false;
      const query = {
        select: () => query,
        update: () => { updating = true; return query; },
        insert: () => query,
        eq: (key: string, value: string) => {
          if (updating && key === "id") updatedIds.push(value);
          return query;
        },
        in: (key: string, values: string[]) => {
          if (table === "ezcater_orders") pendingFilter(key, values);
          return query;
        },
        lt: () => query,
        returns: async () => {
          if (table === "catering_pipeline") return { data: leads, error: null };
          if (pendingFailure === "throw") throw new Error("unavailable");
          if (pendingFailure === "error") return { data: null, error: { code: "42P01" } };
          return { data: pendingKey ? [{ lead_id: "provider-lead" }] : [], error: null };
        },
        abortSignal: async () => ({ error: null, count: 1 }),
      };
      return query;
    },
  } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => vi.restoreAllMocks());

describe("elapsed catering completion lifecycle backstop", () => {
  it.each(["cancelled", "rejected", "failed"])("does not complete a lead pending %s after provider fetch failure", async (key) => {
    pendingKey = key;
    expect(await completeElapsedCateringEvents("2026-10-08")).toEqual({ completed: ["house-lead"], stageChanged: 0, failed: [] });
    expect(updatedIds).toEqual(["house-lead"]);
    expect(pendingFilter).toHaveBeenCalledWith("pending_event_key", ["cancelled", "rejected", "failed"]);
  });

  it("completes provider and house leads without a pending cancellation", async () => {
    expect(await completeElapsedCateringEvents("2026-10-08")).toMatchObject({ completed: ["provider-lead", "house-lead"], failed: [] });
    expect(updatedIds).toEqual(["provider-lead", "house-lead"]);
  });

  it.each(["error", "throw"] as const)("defers unknown ezCater markers on lookup %s while completing other sources", async (failure) => {
    pendingFailure = failure;
    expect(await completeElapsedCateringEvents("2026-10-08")).toEqual({
      completed: ["house-lead"], stageChanged: 0,
      failed: [{ id: "provider-lead", result: "pending_lifecycle_unavailable" }],
    });
    expect(updatedIds).toEqual(["house-lead"]);
  });
});

// Audit W11/B172: a lead rescheduled into the future between the select and the update was completed anyway.
it("the guarded completion re-checks the date, so a lead rescheduled after the select is left alone", async () => {
  const updateLt: Array<[string, string]> = [];
  vi.mocked(getServiceRoleClient).mockReturnValue({
    from(table: string) {
      let updating = false;
      let dateGuard = false;
      const query = {
        select: () => query,
        update: () => { updating = true; return query; },
        insert: () => query,
        eq: () => query,
        in: () => query,
        lt: (key: string, value: string) => { if (updating) { updateLt.push([key, value]); dateGuard = key === "event_date" && value === "2026-11-14"; } return query; },
        returns: async () => table === "catering_pipeline" ? { data: [{ id: "moved-lead", stage: "confirmed", location_id: "shop", lead_source: "toast" }], error: null } : { data: [], error: null },
        // The manager's reschedule committed after the select: the date predicate now matches nothing.
        abortSignal: async () => ({ error: null, count: updating && dateGuard ? 0 : 1 }),
      };
      return query;
    },
  } as unknown as ReturnType<typeof getServiceRoleClient>);
  expect(await completeElapsedCateringEvents("2026-11-14")).toEqual({ completed: [], stageChanged: 1, failed: [] });
  expect(updateLt).toEqual([["event_date", "2026-11-14"]]);
});
