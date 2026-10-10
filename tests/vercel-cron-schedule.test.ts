import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";
import { decideJobWatch, easternBoundary, easternDay } from "@/lib/job-watch";
import { etClock } from "@/lib/report-digests-shared";
import { maxDuration as salesDuration } from "@/app/api/cron/toast-sales-today/route";
import { maxDuration as cateringDuration } from "@/app/api/cron/toast-catering-scan/route";
import { maxDuration as digestDuration } from "@/app/api/cron/digest-tick/route";

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
function matches(field: string, value: number): boolean {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    if (part.startsWith("*/")) return value % Number(part.slice(2)) === 0;
    const [start, end] = part.split("-").map(Number);
    return end === undefined ? value === start : value >= start! && value <= end;
  });
}
function scheduled(job: string, at: Date): boolean {
  const entries = config.crons.filter((c) => c.path === `/api/cron/${job}`);
  expect(entries).toHaveLength(1);
  const [minute, hour, ...days] = entries[0]!.schedule.split(" ");
  expect(days).toEqual(["*", "*", "*"]);
  return matches(minute!, at.getUTCMinutes()) && matches(hour!, at.getUTCHours());
}

describe.each(["2026-01-15", "2026-07-15", "2026-03-08", "2026-11-01"])("cron coverage %s", (day) => {
  it("covers every ten-minute ET tick from 06:00 through 22:00, including UTC midnight", () => {
    const start = easternBoundary(day, 6).getTime(), end = easternBoundary(day, 22).getTime();
    for (let time = start; time <= end; time += 600_000) {
      for (const job of ["toast-sales-today", "toast-catering-scan"]) expect(scheduled(job, new Date(time))).toBe(true);
    }
  });
  it("runs digest hourly throughout the actual ET day, including repeated/missing DST hours", () => {
    const start = easternBoundary(day, 0).getTime(), end = easternBoundary(day, 24).getTime();
    let fallback = false;
    for (let time = start; time < end; time += 60_000) {
      const at = new Date(time);
      expect(scheduled("digest-tick", at)).toBe(at.getUTCMinutes() === 0);
      if (etClock(at).minutes === 180) fallback = scheduled("digest-tick", at);
    }
    expect(fallback).toBe(true);
  });
  it("has no false watcher alerts on healthy scheduled heartbeats across either DST transition", () => {
    for (const name of ["toast-sales-today", "toast-catering-scan", "toast-labor-pull", "digest-tick"]) {
      const job = JOBS_REGISTRY.find((j) => j.job === name)!;
      expect(job.source).toBe("vercel");
      expect(job.cadenceMinutes).toBe(name === "digest-tick" ? 60 : 10);
      const start = easternBoundary(day, 0).getTime(), end = easternBoundary(day, 24).getTime();
      let last = new Date(start - 60 * 60_000).toISOString();
      for (let time = start; time < end; time += 60_000) {
        const at = new Date(time);
        if (scheduled(name === "toast-labor-pull" ? "toast-sales-today" : name, at)) last = at.toISOString();
        expect(decideJobWatch(job, at, last, null).silent).toBe(false);
      }
    }
  });
});

it("monitors digest overnight and alerts after two missed hours", () => {
  const digest = JOBS_REGISTRY.find((j) => j.job === "digest-tick")!;
  const last = "2026-10-10T02:00:00Z";
  const now = new Date("2026-10-10T04:00:01Z");
  expect(easternDay(now)).toBe("2026-10-10");
  expect(decideJobWatch(digest, now, last, null).shouldAlert).toBe(true);
});

it("preserves internal budgets and keeps route limits below the lease and Pro limit", () => {
  expect([salesDuration, cateringDuration, digestDuration]).toEqual([120, 300, 300]);
  for (const duration of [salesDuration, cateringDuration]) expect(duration).toBeLessThan(330);
  expect(Math.max(salesDuration, cateringDuration, digestDuration)).toBeLessThanOrEqual(300);
});
