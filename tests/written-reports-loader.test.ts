import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

import { listWrittenReports, parseWrittenReportCursor } from "@/lib/written-reports";

function emptyService(orFilters: string[]): SupabaseClient {
  return {
    from: () => {
      const query = {
        select: () => query,
        not: () => query,
        lte: () => query,
        gte: () => query,
        lt: () => query,
        eq: () => query,
        is: () => query,
        order: () => query,
        limit: () => query,
        or: (filter: string) => { orFilters.push(filter); return query; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe("written report loader scope and cursor", () => {
  it("rejects below the reports floor before reading data", async () => {
    const service = { from: () => { throw new Error("DATA read"); } } as unknown as SupabaseClient;
    await expect(listWrittenReports(service, {
      viewer: { userId: "trainee", level: 1, locations: ["shop-a"] },
      now: new Date("2026-10-07T16:00:00Z"),
    })).rejects.toThrow("written_report_scope_forbidden");
  });

  it("ANDs the location and tuple cursor OR groups in one PostgREST expression", async () => {
    const orFilters: string[] = [];
    const context = JSON.stringify({ from: "2026-10-01", to: "2026-10-07", userId: "employee", level: 3, locations: ["shop-a"], ownOnly: false, locationId: null });
    const cursor = Buffer.from(JSON.stringify({
      submittedAt: "2026-10-07T12:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000001",
      context,
    })).toString("base64url");
    const result = await listWrittenReports(emptyService(orFilters), {
      viewer: { userId: "employee", level: 3, locations: ["shop-a"] },
      from: "2026-10-01",
      to: "2026-10-07",
      cursor,
      now: new Date("2026-10-07T16:00:00Z"),
    });
    expect(result.reports).toEqual([]);
    expect(orFilters).toEqual([
      "and(or(submitted_by.eq.employee,visibility_min_level.lte.3),or(location_id.is.null,location_id.in.(shop-a)),or(submitted_at.lt.2026-10-07T12:00:00.000Z,and(submitted_at.eq.2026-10-07T12:00:00.000Z,id.gt.00000000-0000-4000-8000-000000000001)))",
    ]);
  });

  it("accepts only UTC-Z tuple cursors", () => {
    const encode = (submittedAt: string) => Buffer.from(JSON.stringify({
      submittedAt,
      id: "00000000-0000-4000-8000-000000000001",
      context: "scope",
    })).toString("base64url");
    expect(parseWrittenReportCursor(encode("2026-10-07T12:00:00.000Z")))
      .toEqual({ submittedAt: "2026-10-07T12:00:00.000Z", id: "00000000-0000-4000-8000-000000000001", context: "scope" });
    expect(parseWrittenReportCursor(encode("2026-10-07T08:00:00-04:00"))).toBeNull();
  });

  it("resets a cursor when its range or authorization context is stale", async () => {
    const orFilters: string[] = [];
    const cursor = Buffer.from(JSON.stringify({
      submittedAt: "2026-10-07T12:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000001",
      context: "old scope",
    })).toString("base64url");
    await listWrittenReports(emptyService(orFilters), {
      viewer: { userId: "employee", level: 3, locations: ["shop-a"] },
      from: "2026-10-01", to: "2026-10-07", cursor,
      now: new Date("2026-10-07T16:00:00Z"),
    });
    expect(orFilters[0]).not.toContain("submitted_at.lt");
  });

  it("honors a selected shop for an all-shop viewer", async () => {
    const orFilters: string[] = [];
    await listWrittenReports(emptyService(orFilters), {
      viewer: { userId: "owner", level: 9, locations: "all" },
      locationId: "shop-a",
      from: "2026-10-01", to: "2026-10-07",
      now: new Date("2026-10-07T16:00:00Z"),
    });
    expect(orFilters[0]).toContain("or(location_id.is.null,location_id.eq.shop-a)");
  });

  it("serializes visibility, location, and keyset alternatives under one AND", async () => {
    let requested = "";
    const service = createClient("http://localhost", "test-key", {
      global: { fetch: async (input) => {
        requested = String(input);
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      } },
    });
    const context = JSON.stringify({ from: "2026-10-01", to: "2026-10-07", userId: "employee", level: 3, locations: ["shop-a"], ownOnly: false, locationId: null });
    const cursor = Buffer.from(JSON.stringify({ submittedAt: "2026-10-07T12:00:00.000Z", id: "00000000-0000-4000-8000-000000000001", context })).toString("base64url");
    await listWrittenReports(service, {
      viewer: { userId: "employee", level: 3, locations: ["shop-a"] },
      from: "2026-10-01", to: "2026-10-07", cursor,
      now: new Date("2026-10-07T16:00:00Z"),
    });
    const url = new URL(requested);
    expect(url.searchParams.getAll("or")).toEqual([
      "(and(or(submitted_by.eq.employee,visibility_min_level.lte.3),or(location_id.is.null,location_id.in.(shop-a)),or(submitted_at.lt.2026-10-07T12:00:00.000Z,and(submitted_at.eq.2026-10-07T12:00:00.000Z,id.gt.00000000-0000-4000-8000-000000000001))))",
    ]);
  });
});
