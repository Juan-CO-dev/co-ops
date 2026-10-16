/**
 * 7shifts configuration — the ONLY reader of the 7shifts env vars (Scheduling Phase 1, Task 6).
 *
 *   SEVENSHIFTS_ACCESS_TOKEN  Juan only (Vercel). The company access token. Absent ⇒ dormant: no call, no write.
 *   SEVENSHIFTS_SYNC          CC sets `1` after 0268 + 0269 are applied. The cron and Sync now run only then.
 *
 * `sevenShiftsStatus()` NEVER returns the token, its length or a prefix: it is rendered on screens.
 * `sevenShiftsToken()` hands the token to the client and the sync only.
 */
import "server-only";

export type SevenShiftsState = "not_connected" | "sync_off" | "ready";
export type SevenShiftsStatusReason = "token_missing" | "sync_off" | null;
export interface SevenShiftsStatus { state: SevenShiftsState; reason: SevenShiftsStatusReason }

type Env = Readonly<Record<string, string | undefined>>;

/** The token, or null when absent or blank. Never log, print or return it to a client. */
export function sevenShiftsToken(env: Env = process.env): string | null {
  const t = env.SEVENSHIFTS_ACCESS_TOKEN;
  return typeof t === "string" && t.trim() !== "" ? t.trim() : null;
}

export function sevenShiftsStatus(env: Env = process.env): SevenShiftsStatus {
  if (sevenShiftsToken(env) === null) return { state: "not_connected", reason: "token_missing" };
  if (env.SEVENSHIFTS_SYNC !== "1") return { state: "sync_off", reason: "sync_off" };
  return { state: "ready", reason: null };
}

/** True only with a token AND the switch on. */
export function syncEnabled(env: Env = process.env): boolean {
  return sevenShiftsStatus(env).state === "ready";
}
