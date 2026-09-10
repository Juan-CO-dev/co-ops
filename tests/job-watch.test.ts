import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideJobWatch, easternBoundary, easternDay } from "@/lib/job-watch";
import { JOBS_REGISTRY, type RegisteredJob } from "@/lib/jobs-registry";

const JOB_WATCH_SCHEDULE = "0 17 * * *"; // 12:00 EST / 13:00 EDT — inside the 06–22 ET pinger window either side of DST
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

  it("keeps five closed registry entries and schedules its own daily check", () => {
    expect(JOBS_REGISTRY.map((j) => j.job)).toEqual([
      "toast-sales-pull", "prune-sessions", "parse-receipts", "toast-catering-scan", "toast-sales-today",
    ]);
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    // Vercel Hobby refuses any cron that runs more than once per day at DEPLOY time
    // (PR #352's first deployment failed on "0 * * * *"); an hourly watch needs the Pro plan.
    expect(config.crons).toContainEqual({ path: "/api/cron/job-watch", schedule: JOB_WATCH_SCHEDULE });
  });

  it("the daily check lands inside every pinger window on both sides of DST (Hobby precision is ±59 min)", () => {
    const [minute, hour] = JOB_WATCH_SCHEDULE.split(" ");
    for (const day of ["2026-01-15", "2026-07-15", "2026-03-08", "2026-11-01"]) {
      for (const skew of [-59, 0, 59]) {
        const at = new Date(Date.parse(`${day}T${hour!.padStart(2, "0")}:${minute!.padStart(2, "0")}:00Z`) + skew * 60_000);
        for (const job of JOBS_REGISTRY as readonly RegisteredJob[]) {
          if (!job.window) continue;
          expect(at >= easternBoundary(easternDay(at), job.window.startHourET)).toBe(true);
          expect(at < easternBoundary(easternDay(at), job.window.endHourET)).toBe(true);
        }
      }
    }
  });

  it("a pinger that died last night is caught by the next daily check; a dead daily cron by the check after its second miss", () => {
    // Pinger: last heartbeat 21:50 ET on the 9th; 20 active minutes of grace carry to 06:20 ET on the 10th.
    expect(decide("2026-09-10T17:00:00Z", "2026-09-10T01:50:00Z").silent).toBe(true);
    // Daily cron: last success 09:00 UTC on the 8th; the deadline is 48 h later, so the 9th's check is quiet and the 10th's alerts.
    expect(decideJobWatch(daily, new Date("2026-09-09T17:00:00Z"), "2026-09-08T09:00:00Z", null).silent).toBe(false);
    expect(decideJobWatch(daily, new Date("2026-09-10T17:00:00Z"), "2026-09-08T09:00:00Z", null).silent).toBe(true);
  });
});
