import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dailyDueUtc, decideJobWatch, easternBoundary, easternDay } from "@/lib/job-watch";
import { JOBS_REGISTRY, type RegisteredJob } from "@/lib/jobs-registry";

const JOB_WATCH_SCHEDULE = "0 17 * * *"; // 12:00 EST / 13:00 EDT — inside the 06–22 ET pinger window either side of DST
const pinger = JOBS_REGISTRY.find((job) => job.job === "toast-catering-scan")!;
const daily = JOBS_REGISTRY.find((job) => job.job === "toast-sales-pull")!;
const digest = JOBS_REGISTRY.find((job) => job.job === "digest-tick")!;
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

  it("keeps eleven closed registry entries and schedules its own daily check", () => {
    expect(JOBS_REGISTRY.map((j) => j.job)).toEqual([
      "ezcater-refresh", "toast-order-capture", "toast-sales-pull", "toast-labor-pull", "prune-sessions", "vault-scrub", "parse-receipts", "toast-catering-scan", "toast-sales-today", "job-watch", "digest-tick",
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

describe("digest polish item 13: a daily job with no history is expected after its first scheduled run", () => {
  const capture = JOBS_REGISTRY.find((job) => job.job === "toast-order-capture")!;

  it("toast-order-capture is scheduled like the nightly (09:00 UTC) it rides inside", () => {
    expect(dailyDueUtc(capture)).toBe("09:00");
    expect(dailyDueUtc(daily)).toBe("09:00");
  });

  it("01:46 ET before the first nightly is NOT silent (the 10-08 false alarm)", () => {
    const d = decideJobWatch(capture, new Date("2026-10-08T05:46:00Z"), null, null);
    expect(d.silent).toBe(false);
    expect(d.expectedBy).toBe("2026-10-08T10:30:00.000Z");
  });

  it("past 09:00 UTC + 90 min with still no heartbeat, it alerts", () => {
    expect(decideJobWatch(capture, new Date("2026-10-08T10:30:01Z"), null, null).shouldAlert).toBe(true);
  });

  it("once the nightly has written a heartbeat, the 2x-cadence rule applies as before", () => {
    expect(decideJobWatch(capture, new Date("2026-10-09T17:00:00Z"), "2026-10-08T09:02:00Z", null).silent).toBe(false);
    expect(decideJobWatch(capture, new Date("2026-10-10T09:03:00Z"), "2026-10-08T09:02:00Z", null).silent).toBe(true);
  });
});

describe("overnight digest cron watch", () => {
  it.each([
    ["2026-01-15", "2026-01-15T07:00:00.000Z"],
    ["2026-07-15", "2026-07-15T06:00:00.000Z"],
    ["2026-03-08", "2026-03-08T07:00:00.000Z"],
    ["2026-11-01", "2026-11-01T06:00:00.000Z"],
  ])("expects the first digest heartbeat after two hourly slots on %s", (day, expected) => {
    const at = easternBoundary(day, 0);
    expect(decideJobWatch(digest, at, null, null).expectedBy).toBe(expected);
    expect(decideJobWatch(digest, new Date(expected), null, null).silent).toBe(false);
    expect(decideJobWatch(digest, new Date(Date.parse(expected) + 1), null, null).silent).toBe(true);
  });

  it("a 03:00 cron heartbeat resets expected_by to 05:00 ET", () => {
    expect(decideJobWatch(digest, new Date("2026-10-08T08:00:00Z"), "2026-10-08T07:00:00Z", null).expectedBy)
      .toBe("2026-10-08T09:00:00.000Z");
  });
});


it("vault scrub shares the nightly schedule and allows first-run grace", () => {
  const scrub = JOBS_REGISTRY.find((j) => j.job === "vault-scrub")!;
  expect(scrub).toEqual({ job: "vault-scrub", cadenceMinutes: 1440, source: "vercel", dueUtc: "08:30" });
  expect(decideJobWatch(scrub, new Date("2026-10-10T10:00:00Z"), null, null).shouldAlert).toBe(false);
  expect(decideJobWatch(scrub, new Date("2026-10-10T10:00:01Z"), null, null).shouldAlert).toBe(true);
});
