/**
 * The pure rule behind the 7shifts heartbeat (2026-11-17): which resource outcome is a WARNING
 * (the run still counts as healthy, with the evidence attached) and which is a real failure.
 */
import { describe, expect, it } from "vitest";
import { classifyResource, NON_CRITICAL_RESOURCES, summarizeHealth } from "@/lib/sevenshifts/health-shared";

const r = (rows: number, skipped: number, error_code: string | null, reasons?: Record<string, number>) => ({ rows, skipped, pages: 1, error_code, ...(reasons ? { reasons } : {}) });

describe("classifyResource", () => {
  it("the non-critical resources are exactly availabilities and time_off (nothing reads them yet)", () => {
    expect([...NON_CRITICAL_RESOURCES]).toEqual(["availabilities", "time_off"]);
  });
  it("no error is ok; rejected rows on a non-critical resource are a warning only while they are the minority", () => {
    expect(classifyResource("availabilities", r(5, 0, null))).toBe("ok");
    expect(classifyResource("availabilities", r(5, 1, "rejected_rows"))).toBe("warning");
    expect(classifyResource("time_off", r(3, 3, "rejected_rows"))).toBe("warning");
    expect(classifyResource("time_off", r(3, 4, "rejected_rows"))).toBe("failed");
    expect(classifyResource("availabilities", r(0, 6, "rejected_rows"))).toBe("failed");
  });
  it("a critical resource, or any other code, is always a failure", () => {
    for (const res of ["shifts", "time_punches", "users", "locations", "departments", "roles", "labor_settings", "assignments", "wages"]) {
      expect(classifyResource(res, r(500, 1, "rejected_rows")), res).toBe("failed");
    }
    for (const code of ["bad_pagination", "plan_forbidden", "deadline", "server_error", "write_failed", "incomplete_snapshot", "failed"]) {
      expect(classifyResource("availabilities", r(500, 1, code)), code).toBe("failed");
    }
  });
});

describe("summarizeHealth", () => {
  const order = ["users", "availabilities", "time_off", "shifts"];
  it("splits errors from warnings and counts every rejected row, in run order", () => {
    const h = summarizeHealth(order, {
      users: r(10, 0, null), availabilities: r(4, 2, "rejected_rows", { bad_date: 2 }),
      time_off: r(0, 0, "plan_forbidden"), shifts: r(9, 1, "rejected_rows", { bad_instant: 1 }),
    }, { whoamiError: null, persistenceErrors: [] });
    expect(h).toEqual({
      outcome: "failed", healthy: false,
      errors: ["time_off:plan_forbidden", "shifts:rejected_rows"], warnings: ["availabilities:rejected_rows"],
      rejectedRows: { availabilities: 2, shifts: 1 }, rejectedReasons: { availabilities: { bad_date: 2 }, shifts: { bad_instant: 1 } },
    });
  });
  it("only warnings → ok_with_warnings and healthy; nothing at all → ok", () => {
    const warn = summarizeHealth(order, { users: r(1, 0, null), availabilities: r(4, 1, "rejected_rows", { bad_time: 1 }), time_off: r(1, 0, null), shifts: r(1, 0, null) },
      { whoamiError: null, persistenceErrors: [] });
    expect(warn).toMatchObject({ outcome: "ok_with_warnings", healthy: true, errors: [], warnings: ["availabilities:rejected_rows"], rejectedRows: { availabilities: 1 } });
    const clean = summarizeHealth(order, Object.fromEntries(order.map((o) => [o, r(1, 0, null)])), { whoamiError: null, persistenceErrors: [] });
    expect(clean).toEqual({ outcome: "ok", healthy: true, errors: [], warnings: [], rejectedRows: {}, rejectedReasons: {} });
  });
  it("whoami and persistence failures are errors, first and last", () => {
    const h = summarizeHealth(order, Object.fromEntries(order.map((o) => [o, r(0, 0, "not_run")])), { whoamiError: "auth_failed", persistenceErrors: ["ledger_write_failed"] });
    expect(h.errors[0]).toBe("whoami:auth_failed");
    expect(h.errors.at(-1)).toBe("persistence:ledger_write_failed");
    expect(h).toMatchObject({ outcome: "failed", healthy: false });
    expect(summarizeHealth(order, Object.fromEntries(order.map((o) => [o, r(1, 0, null)])), { whoamiError: null, persistenceErrors: ["state_write_failed"] }))
      .toMatchObject({ outcome: "failed", healthy: false, errors: ["persistence:state_write_failed"] });
  });
  it("a reasons blob is copied only as reason → positive integer over the closed vocabulary", () => {
    const h = summarizeHealth(["availabilities"], { availabilities: { rows: 4, skipped: 1, error_code: "rejected_rows", reasons: { bad_date: 1, PLANTED: 9, bad_time: "x" } as never } },
      { whoamiError: null, persistenceErrors: [] });
    expect(h.rejectedReasons).toEqual({ availabilities: { bad_date: 1 } });
  });
});
