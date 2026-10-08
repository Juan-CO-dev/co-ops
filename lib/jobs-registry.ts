/** Closed heartbeat registry. Daily cadences follow vercel.json (UTC schedules).
 * Every successful scheduled route watches its siblings after its own heartbeat.
 * The 10-minute pinger catches up missing daily work after 90 minutes of Hobby grace;
 * the four daily Vercel routes provide independent chances to check a dead pinger
 * (alerts still require its active ET window; dormant parsing does not check).
 * Detection retains the 2x-cadence/window rules; checks run every pinger cycle in
 * 06:00-22:00 ET, not just the 17:00 UTC job-watch cron. No extra cron or secret.
 */
export interface DailyCatchUpEntry {
  job: "prune-sessions" | "toast-sales-pull" | "parse-receipts";
  dueUtc: string;
}

export interface RegisteredJob {
  job: string;
  cadenceMinutes: number;
  catchUp?: DailyCatchUpEntry;
  window?: { startHourET: number; endHourET: number };
  source: "vercel" | "pinger";
}

export const JOBS_REGISTRY = [
  { job: "toast-order-capture", cadenceMinutes: 1440, source: "vercel" },
  { job: "toast-sales-pull", cadenceMinutes: 1440, source: "vercel", catchUp: { job: "toast-sales-pull", dueUtc: "09:00" } }, // 09:00 UTC
  { job: "prune-sessions", cadenceMinutes: 1440, source: "vercel", catchUp: { job: "prune-sessions", dueUtc: "08:30" } }, // 08:30 UTC
  { job: "parse-receipts", cadenceMinutes: 1440, source: "vercel", catchUp: { job: "parse-receipts", dueUtc: "09:45" } }, // 09:45 UTC
  { job: "toast-catering-scan", cadenceMinutes: 10, window: { startHourET: 6, endHourET: 22 }, source: "pinger" },
  { job: "toast-sales-today", cadenceMinutes: 10, window: { startHourET: 6, endHourET: 22 }, source: "pinger" },
  { job: "job-watch", cadenceMinutes: 1440, source: "vercel" }, // 17:00 UTC
  // Report digests (0220). Wider window than the other pingers: it starts at 03:00 ET so the
  // unified digest's 03:00 fallback runs (Hobby: no extra Vercel cron). Must equal
  // DIGEST_TICK_WINDOW in lib/report-digests-shared.ts (pinned by tests/digest-routes.test.ts).
  { job: "digest-tick", cadenceMinutes: 10, window: { startHourET: 3, endHourET: 22 }, source: "pinger" },
] as const satisfies readonly RegisteredJob[];

export type JobName = (typeof JOBS_REGISTRY)[number]["job"];

/** Deployment config default: Juan's project identity, like DEFAULT_MAGIC_LINK_ALLOWLIST.
 * Override OPS_ALERT_EMAIL for another operator/tenant. Never a routing/matching key.
 */
export const DEFAULT_OPS_ALERT_EMAIL = "juan@complimentsonlysubs.com";
