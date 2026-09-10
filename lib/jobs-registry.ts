/** Closed heartbeat registry. Daily cadences follow vercel.json (UTC schedules).
 * The watcher itself runs ONCE A DAY (17:00 UTC, vercel.json): Vercel Hobby refuses sub-daily crons at deploy time,
 * so a dead pinger is caught by the next day's check (~15 h worst case) and a dead daily cron after its second miss.
 * Moving to Pro allows "0 * * * *" — change the schedule and tests/job-watch.test.ts together.
 */
export interface RegisteredJob {
  job: string;
  cadenceMinutes: number;
  window?: { startHourET: number; endHourET: number };
  source: "vercel" | "pinger";
}

export const JOBS_REGISTRY = [
  { job: "toast-sales-pull", cadenceMinutes: 1440, source: "vercel" }, // 09:00 UTC
  { job: "prune-sessions", cadenceMinutes: 1440, source: "vercel" }, // 08:30 UTC
  { job: "parse-receipts", cadenceMinutes: 1440, source: "vercel" }, // 09:45 UTC
  { job: "toast-catering-scan", cadenceMinutes: 10, window: { startHourET: 6, endHourET: 22 }, source: "pinger" },
  { job: "toast-sales-today", cadenceMinutes: 10, window: { startHourET: 6, endHourET: 22 }, source: "pinger" },
] as const satisfies readonly RegisteredJob[];

export type JobName = (typeof JOBS_REGISTRY)[number]["job"];

/** Deployment config default: Juan's project identity, like DEFAULT_MAGIC_LINK_ALLOWLIST.
 * Override OPS_ALERT_EMAIL for another operator/tenant. Never a routing/matching key.
 */
export const DEFAULT_OPS_ALERT_EMAIL = "juan@complimentsonlysubs.com";
