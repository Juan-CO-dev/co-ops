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
  // Cutover keeps scheduler identities stable: capture is the provider writer;
  // sales-pull now proves T-1..T-3 capture -> depletion -> shadow pars.
  // sales-today captures today/yesterday; catering-scan checks the persisted sink.
  // Its cron heartbeat is written by the capture inside the 09:00 UTC sales pull.
  { job: "toast-order-capture", cadenceMinutes: 1440, source: "vercel", dueUtc: "09:00" },
  { job: "toast-sales-pull", cadenceMinutes: 1440, source: "vercel", catchUp: { job: "toast-sales-pull", dueUtc: "09:00" } }, // 09:00 UTC
  // Labor (0224): a bounded, fail-soft pull at the end of the nightly; watched only while TOAST_LABOR_PULL=1.
  { job: "toast-labor-pull", cadenceMinutes: 1440, source: "vercel", dueUtc: "09:00" },
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
