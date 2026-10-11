import { describe, expect, it } from "vitest";
import { DORMANT_WINDOW_MS, employeeNotSeen, userDormancy } from "@/lib/admin/dormancy-shared";
import { laborBackfillDates } from "../scripts/backfill-toast-labor";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";

const now = Date.parse("2026-10-11T16:00:00Z");
const boundary = new Date(now - DORMANT_WINDOW_MS).toISOString();
const old = new Date(now - DORMANT_WINDOW_MS - 1).toISOString();
const base = { level: 5, active: true, createdAt: old, dormantAt: null, lastClockInAt: null, now };
describe("display-only user dormancy", () => {
  it("deactivation wins over a later clock-in and a manual marker", () => {
    expect(userDormancy({ ...base, active: false, dormantAt: old, lastClockInAt: boundary }))
      .toEqual({ dormant: true, reason: "deactivated", since: null });
  });
  it("manual applies at any level; only a STRICTLY later clock-in clears it", () => {
    for (const level of [3, 6, 10]) {
      for (const lastClockInAt of [null, old]) expect(userDormancy({ ...base, level, dormantAt: old, lastClockInAt }))
        .toEqual({ dormant: true, reason: "manual", since: old });
      expect(userDormancy({ ...base, level, dormantAt: old, lastClockInAt: boundary })).toEqual({ dormant: false });
    }
  });
  it("auto ends at level 5 and requires older than 182 days", () => {
    expect(userDormancy(base)).toEqual({ dormant: true, reason: "never_clocked_in", since: old });
    expect(userDormancy({ ...base, createdAt: "2025-01-01", lastClockInAt: old })).toEqual({ dormant: true, reason: "no_clock_in", since: old });
    expect(userDormancy({ ...base, level: 6 })).toEqual({ dormant: false });
    expect(userDormancy({ ...base, createdAt: boundary })).toEqual({ dormant: false });
    expect(userDormancy({ ...base, lastClockInAt: boundary })).toEqual({ dormant: false });
  });
  it("uses the later of hire and clock-in, never infers age from missing data", () => {
    expect(userDormancy({ ...base, createdAt: boundary, lastClockInAt: old })).toEqual({ dormant: false });
    expect(userDormancy({ ...base, createdAt: null })).toEqual({ dormant: false });
    expect(userDormancy({ ...base, createdAt: null, lastClockInAt: old })).toEqual({ dormant: true, reason: "no_clock_in", since: old });
    expect(userDormancy({ ...base, createdAt: "invalid" })).toEqual({ dormant: false });
  });
  it("unknown clock history never auto-hides anyone, but deactivated and manual still apply", () => {
    expect(userDormancy({ ...base, clockHistoryKnown: false })).toEqual({ dormant: false });
    expect(userDormancy({ ...base, dormantAt: old, clockHistoryKnown: false })).toEqual({ dormant: true, reason: "manual", since: old });
    expect(userDormancy({ ...base, active: false, clockHistoryKnown: false }).dormant).toBe(true);
  });
  it("old wake evidence clears manual but does not override automatic inactivity", () => {
    expect(userDormancy({ ...base, dormantAt: "2025-01-01", lastClockInAt: old }).dormant).toBe(true);
    expect(userDormancy({ ...base, level: 6, dormantAt: "2025-01-01", lastClockInAt: old })).toEqual({ dormant: false });
  });
});
it("employee missing/old/archived clock-ins are not seen; boundary is seen", () => {
  for (const lastClockInAt of [null, old, "invalid"]) expect(employeeNotSeen({ deleted: false, lastClockInAt, now })).toBe(true);
  expect(employeeNotSeen({ deleted: false, lastClockInAt: boundary, now })).toBe(false);
  expect(employeeNotSeen({ deleted: true, lastClockInAt: boundary, now })).toBe(true);
});
describe("operator backfill date boundary", () => {
  it("accepts inclusive dates through T-2 ET", () => {
    expect(laborBackfillDates(["--from", "2026-10-08", "--through", "2026-10-09"], new Date(now)))
      .toEqual(["2026-10-08", "2026-10-09"]);
  });
  it.each([
    [], ["--from", "2026-02-30", "--through", "2026-10-09"],
    ["--from", "2026-10-09", "--through", "2026-10-10"],
    ["--from", "2026-10-11", "--through", "2026-10-11"],
    ["--from", "2026-10-09", "--through", "2026-10-08"],
    ["--from", "2026-10-08", "--from", "2026-10-09"], ["--oops", "2026-10-08"],
  ])("rejects invalid flags/windows: %j", (...args) => {
    expect(() => laborBackfillDates(args as string[], new Date(now))).toThrow();
  });
  it("uses Eastern date near midnight UTC and excludes the one-off job from monitoring", () => {
    expect(() => laborBackfillDates(["--from", "2026-10-09", "--through", "2026-10-09"], new Date("2026-10-11T01:00:00Z"))).toThrow();
    expect(JOBS_REGISTRY.some((r) => (r.job as string) === "toast-labor-pull-backfill")).toBe(false);
  });
});
