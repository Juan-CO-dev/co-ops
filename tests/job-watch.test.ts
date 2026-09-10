import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideJobWatch, easternBoundary, easternDay } from "@/lib/job-watch";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";

const pinger = JOBS_REGISTRY[3];
const daily = JOBS_REGISTRY[0];
const decide = (now: string, last: string | null, alert: string | null = null) =>
  decideJobWatch(pinger, new Date(now), last, alert);

describe("LRA-228: cadence, Eastern windows, and once-per-day decisions", () => {
  it.each([
    ["2026-09-10T10:19:59Z", false],
    ["2026-09-10T10:20:00Z", false],
    ["2026-09-10T10:20:01Z", true],
    ["2026-09-10T12:00:00Z", true],
    ["2026-09-11T02:00:00Z", false], // 22:00 ET, window closed
    ["2026-09-11T07:00:00Z", false], // 03:00 ET
  ])("pinger at %s is silent=%s", (now, silent) => {
    expect(decide(now, "2026-09-10T10:00:00Z").silent).toBe(silent);
  });

  it.each([
    ["2026-09-10T09:59:59Z", false],
    ["2026-09-10T10:14:59Z", false],
    ["2026-09-10T10:15:00Z", false],
    ["2026-09-10T10:15:01Z", true],
  ])("carries five minutes before closing into the next opening at %s", (now, silent) => {
    const result = decide(now, "2026-09-10T01:55:00Z");
    expect(result.silent).toBe(silent);
    expect(result.expectedBy).toBe("2026-09-10T10:15:00.000Z");
  });

  it("an exact closing-time deadline is not older until time advances in the next window", () => {
    expect(decide("2026-09-10T10:00:00Z", "2026-09-10T01:40:00Z").silent).toBe(false);
    expect(decide("2026-09-10T10:00:01Z", "2026-09-10T01:40:00Z").silent).toBe(true);
  });

  it.each([
    ["2026-09-10T08:59:59Z", false],
    ["2026-09-10T09:00:00Z", false],
    ["2026-09-10T09:00:01Z", true],
    ["2026-09-11T07:00:00Z", true], // daily jobs remain monitored at 03:00 ET
  ])("daily 2x cadence at %s is silent=%s", (now, silent) => {
    expect(decideJobWatch(daily, new Date(now), "2026-09-08T09:00:00Z", null).silent).toBe(silent);
  });

  it("never-seen pingers get opening grace; never-seen daily jobs alert", () => {
    expect(decide("2026-09-10T10:20:00Z", null).shouldAlert).toBe(false);
    expect(decide("2026-09-10T10:20:01Z", null).shouldAlert).toBe(true);
    expect(decideJobWatch(daily, new Date("2026-09-10T12:00:00Z"), null, null).shouldAlert).toBe(true);
  });

  it("the five-day outage is caught in-window and never at 03:00 ET", () => {
    expect(decide("2026-09-10T12:00:00Z", "2026-09-05T23:06:00Z").shouldAlert).toBe(true);
    expect(decide("2026-09-10T07:00:00Z", "2026-09-05T23:06:00Z").shouldAlert).toBe(false);
  });

  it("dedupes on the Eastern date, including across UTC midnight, then permits tomorrow", () => {
    const last = "2026-09-05T23:06:00Z";
    expect(decide("2026-09-11T01:00:00Z", last, "2026-09-10T12:00:00Z").shouldAlert).toBe(false);
    expect(decide("2026-09-11T11:00:00Z", last, "2026-09-10T12:00:00Z").shouldAlert).toBe(true);
    expect(decide("2026-09-11T01:00:00Z", last, "2026-09-10T12:00:00Z").silent).toBe(true);
  });

  it.each([
    ["2026-03-08", "2026-03-08T05:00:00.000Z", "2026-03-08T10:00:00.000Z"],
    ["2026-11-01", "2026-11-01T04:00:00.000Z", "2026-11-01T11:00:00.000Z"],
  ])("uses the correct offset at midnight AND opening on DST day %s", (day, midnight, opening) => {
    expect(easternBoundary(day, 0).toISOString()).toBe(midnight);
    expect(easternBoundary(day, 6).toISOString()).toBe(opening);
    expect(easternDay(new Date(opening))).toBe(day);
    expect(decide(new Date(Date.parse(opening) + 21 * 60_000).toISOString(), null).silent).toBe(true);
  });

  it.each([
    ["2026-03-08T02:55:00Z", "2026-03-08T10:15:00.000Z"],
    ["2026-11-01T01:55:00Z", "2026-11-01T11:15:00.000Z"],
  ])("carries active grace through a DST night from %s", (last, expected) => {
    expect(decide(expected, last).expectedBy).toBe(expected);
    expect(decide(expected, last).silent).toBe(false);
  });

  it("future heartbeats are not silent", () => {
    expect(decide("2026-09-10T12:00:00Z", "2026-09-10T13:00:00Z").silent).toBe(false);
  });

  it("keeps five closed registry entries and schedules its own hourly check", () => {
    expect(JOBS_REGISTRY.map((j) => j.job)).toEqual([
      "toast-sales-pull", "prune-sessions", "parse-receipts", "toast-catering-scan", "toast-sales-today",
    ]);
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config.crons).toContainEqual({ path: "/api/cron/job-watch", schedule: "0 * * * *" });
  });
});
