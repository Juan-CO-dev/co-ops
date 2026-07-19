/**
 * Portal in-DB fixed-window rate limiter — Portal-2 (D1; reused by Portal-3 + auth throttles).
 *
 * Service-role over catering_portal_rate_limits. Fixed-window counter keyed on an opaque
 * bucket_key (e.g. `magic_link:<ip>:<email>`). The increment is ATOMIC (A-M1): it delegates to the
 * `portal_rate_limit_hit` RPC, whose single `INSERT … ON CONFLICT DO UPDATE … RETURNING count`
 * Postgres serializes on the (bucket_key, window_start) unique index — so a concurrent burst can no
 * longer read-then-write past the cap. Returns true when the action is ALLOWED, false when throttled.
 *
 * Fail-open: if the limiter RPC errors, allow the action (this is a soft secondary abuse throttle —
 * the primary brakes are per-account lockout, allowlist, and ownership checks; breaking legit users
 * on a limiter hiccup is worse than a momentarily-missed throttle). The error is logged.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";

export async function checkAndRecord(bucketKey: string, windowSeconds: number, max: number): Promise<boolean> {
  const sb = getServiceRoleClient();
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();

  const { data, error } = await sb.rpc("portal_rate_limit_hit", {
    p_bucket_key: bucketKey,
    p_window_start: windowStart,
    p_max: max,
  });
  if (error) {
    console.error("[rate-limit] portal_rate_limit_hit failed (fail-open):", error.message);
    return true;
  }
  return data === true;
}
