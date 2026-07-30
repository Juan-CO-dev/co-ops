/**
 * Admin-hub ops-health reads (Ops guardrails NOW #3). SERVER-ONLY, service-role.
 * Two derive-on-read signals over audit_log for the admin hub:
 *
 *   loadCronHealth   — the toast-sales-pull cron heartbeat. A LIVE cron failure is
 *                      otherwise silent (console only); the route now writes a fail-open
 *                      cron.failure / cron.success audit row and this reads them so the
 *                      hub can alert on a recent failure (and show "last run OK").
 *   loadAdoption     — the "Used this week" surface→count roll-up (a curated action→surface
 *                      map, ONE grouped read over the last 7 days). Answers "is anyone using
 *                      it?", not analytics.
 *
 * Read-only; the caller (app/admin/page.tsx) is already behind the admin role gate. Both
 * fail SOFT at the call site (try/catch → render without the card) — an ops signal must
 * never take down the admin hub.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  ADOPTION_SURFACES,
  bucketAdoptionCounts,
  type AdoptionSurfaceCount,
} from "@/lib/admin/ops-health-shared";

// ── Cron health ───────────────────────────────────────────────────────────────

/** How far back the hub looks for a cron failure (the alert window). */
const CRON_FAILURE_WINDOW_HOURS = 48;

export interface CronHealth {
  /** a cron.failure row landed within the last CRON_FAILURE_WINDOW_HOURS. */
  hasRecentFailure: boolean;
  /** ISO timestamp of the most recent failure in-window (null when none). */
  lastFailureAt: string | null;
  /** truncated error message of the most recent in-window failure (null when none). */
  lastFailureError: string | null;
  /** ISO timestamp of the most recent successful run EVER (null when never run). */
  lastSuccessAt: string | null;
}

/**
 * Read the toast-sales-pull cron heartbeat from audit_log. Two cheap reads:
 * the newest cron.failure in the 48h window, and the newest cron.success ever.
 * DORMANT-aware: pre-creds the cron 503s and writes NO row, so this returns the
 * all-null "never run" shape — the hub renders nothing (no false alarm).
 */
export async function loadCronHealth(): Promise<CronHealth> {
  const sb = getServiceRoleClient();
  const sinceTs = new Date(Date.now() - CRON_FAILURE_WINDOW_HOURS * 3600 * 1000).toISOString();

  const [failRes, okRes] = await Promise.all([
    sb
      .from("audit_log")
      .select("occurred_at, metadata")
      .eq("action", "cron.failure")
      .eq("resource_table", "cron")
      .gte("occurred_at", sinceTs)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ occurred_at: string; metadata: Record<string, unknown> | null }>(),
    sb
      .from("audit_log")
      .select("occurred_at")
      .eq("action", "cron.success")
      .eq("resource_table", "cron")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ occurred_at: string }>(),
  ]);
  if (failRes.error) throw new Error(`loadCronHealth failure read: ${failRes.error.message}`);
  if (okRes.error) throw new Error(`loadCronHealth success read: ${okRes.error.message}`);

  const failErr = failRes.data?.metadata?.["error"];
  return {
    hasRecentFailure: failRes.data != null,
    lastFailureAt: failRes.data?.occurred_at ?? null,
    lastFailureError: typeof failErr === "string" ? failErr : null,
    lastSuccessAt: okRes.data?.occurred_at ?? null,
  };
}

// ── Adoption ("Used this week") ─────────────────────────────────────────────────

/** The look-back window for the adoption card. */
const ADOPTION_WINDOW_DAYS = 7;

/**
 * Roll up audit_log action counts over the last 7 days into the curated adoption
 * surfaces (lib/admin/ops-health-shared ADOPTION_SURFACES). ONE read: every row in the
 * window whose action is one we map (an `.in()` on the union of mapped actions), grouped
 * in memory by the pure bucketing fn. Location-agnostic v1 (the whole business's usage).
 *
 * audit_log grows fast → paginate past the 1000-row cap so a busy week never truncates
 * (order by the stable `id`). Returns every surface (zero-count included; the card mutes
 * those), in the ADOPTION_SURFACES declaration order.
 */
export async function loadAdoption(): Promise<AdoptionSurfaceCount[]> {
  const sb = getServiceRoleClient();
  const sinceTs = new Date(Date.now() - ADOPTION_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const mappedActions = ADOPTION_SURFACES.flatMap((s) => s.actions);

  // Paginate: audit_log is the fastest-growing table; a busy week can exceed the 1000-row
  // PostgREST cap for these actions alone, which would silently under-count.
  const counts = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("audit_log")
      .select("action")
      .in("action", mappedActions)
      .gte("occurred_at", sinceTs)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
      .returns<Array<{ action: string }>>();
    if (error) throw new Error(`loadAdoption read: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
    if (rows.length < PAGE) break;
  }
  return bucketAdoptionCounts(counts);
}
