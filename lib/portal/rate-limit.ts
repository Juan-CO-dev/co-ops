/**
 * Portal in-DB fixed-window rate limiter — Portal-2 (D1; reused by Portal-3 submission).
 *
 * Service-role over catering_portal_rate_limits. Fixed-window counter keyed on an opaque
 * bucket_key (e.g. `magic_link:<ip>:<email>`). Approximate-but-safe: a read-then-increment
 * can under-count by a hair under high concurrency, which is fine for soft abuse throttling
 * (not a security-exact gate). Returns true when the action is ALLOWED, false when throttled.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";

export async function checkAndRecord(bucketKey: string, windowSeconds: number, max: number): Promise<boolean> {
  const sb = getServiceRoleClient();
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();

  const { data: existing } = await sb
    .from("catering_portal_rate_limits")
    .select("id, count")
    .eq("bucket_key", bucketKey)
    .eq("window_start", windowStart)
    .maybeSingle<{ id: string; count: number }>();

  if (!existing) {
    const { error } = await sb
      .from("catering_portal_rate_limits")
      .insert({ bucket_key: bucketKey, window_start: windowStart, count: 1 });
    // Raced another request to create this bucket — fall through to the increment path.
    if (error && error.code === "23505") return checkAndRecord(bucketKey, windowSeconds, max);
    return true;
  }

  if (existing.count >= max) return false;
  await sb.from("catering_portal_rate_limits").update({ count: existing.count + 1 }).eq("id", existing.id);
  return true;
}
