/** Closed heartbeat registry. Vercel owns all scheduled jobs.
 * Intraday routes watch siblings after their heartbeat and catch up missing daily work.
 * ET business windows keep overnight pauses out of the ten-minute jobs' deadlines.
 */
export interface DailyCatchUpEntry {
  job: "prune-sessions" | "toast-sales-pull" | "parse-receipts";
  dueUtc: string;
}

export interface RegisteredJob {
  job: string;
  cadenceMinutes: number;
  catchUp?: DailyCatchUpEntry;
  /**
   * A daily job's scheduled UTC run ("HH:MM") when it has NO catch-up entry of its own. With no
   * heartbeat on record the watch expects the first one by this time + the 90-minute Hobby grace
   * (the catch-up grace), not by Eastern midnight (digest polish item 13: toast-order-capture
   * alerted at 01:46 ET before its first 09:00 UTC nightly had run).
   */
  dueUtc?: string;
  window?: { startHourET: number; endHourET: number };
  source: "vercel" | "pinger";
}

/** The Hobby grace after a daily job's scheduled time (shared by catch-up and the watch). */
export const DAILY_DUE_GRACE_MINUTES = 90;

export const JOBS_REGISTRY = [
  { job: "ezcater-refresh", cadenceMinutes: 1440, source: "vercel" },
  // Cutover keeps scheduler identities stable: capture is the provider writer;
  // sales-pull now proves T-1..T-3 capture -> depletion -> shadow pars.
  // sales-today captures today/yesterday; catering-scan checks the persisted sink.
  // Its cron heartbeat is written by the capture inside the 09:00 UTC sales pull.
  { job: "toast-order-capture", cadenceMinutes: 1440, source: "vercel", dueUtc: "09:00" },
  { job: "toast-sales-pull", cadenceMinutes: 1440, source: "vercel", catchUp: { job: "toast-sales-pull", dueUtc: "09:00" } }, // 09:00 UTC
  // Labor (0224/0230): today's bounded, fail-soft pull rides the 10-minute Vercel cron; nightly remains a backstop.
  { job: "toast-labor-pull", cadenceMinutes: 10, window: { startHourET: 6, endHourET: 22 }, source: "vercel" },
  { job: "prune-sessions", cadenceMinutes: 1440, source: "vercel", catchUp: { job: "prune-sessions", dueUtc: "08:30" } }, // 08:30 UTC
  // Shares the prune route and its catch-up attempt, but has its own heartbeat.
  { job: "vault-scrub", cadenceMinutes: 1440, source: "vercel", dueUtc: "08:30" },
  { job: "parse-receipts", cadenceMinutes: 1440, source: "vercel", catchUp: { job: "parse-receipts", dueUtc: "09:45" } }, // 09:45 UTC
  { job: "toast-catering-scan", cadenceMinutes: 10, window: { startHourET: 6, endHourET: 22 }, source: "vercel" },
  { job: "toast-sales-today", cadenceMinutes: 10, window: { startHourET: 6, endHourET: 22 }, source: "vercel" },
  { job: "job-watch", cadenceMinutes: 1440, source: "vercel" }, // 17:00 UTC
  // Hourly all day, including the 03:00 ET fallback in both DST states.
  // Window matches DIGEST_TICK_WINDOW; two hours of grace for the first heartbeat.
  { job: "digest-tick", cadenceMinutes: 60, window: { startHourET: 0, endHourET: 24 }, source: "vercel" },
] as const satisfies readonly RegisteredJob[];

export type JobName = (typeof JOBS_REGISTRY)[number]["job"];

/** Deployment config default: Juan's project identity, like DEFAULT_MAGIC_LINK_ALLOWLIST.
 * Override OPS_ALERT_EMAIL for another operator/tenant. Never a routing/matching key.
 */
export const DEFAULT_OPS_ALERT_EMAIL = "juan@complimentsonlysubs.com";
