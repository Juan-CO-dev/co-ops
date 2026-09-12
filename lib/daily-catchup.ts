import "server-only";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";
import { decideCatchUp } from "@/lib/daily-catchup-shared";
import { runPruneSessions } from "@/lib/prune-sessions-run";
import { runToastSalesPull } from "@/lib/toast-sales-pull-run";
import { runParseReceipts } from "@/lib/parse-receipts-run";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";

export { decideCatchUp } from "@/lib/daily-catchup-shared";

const auditBase = {
  actorId: null, actorRole: null, resourceTable: "cron", resourceId: null,
  ipAddress: null, userAgent: null,
} as const;
// This is the only route that runs catch-up; no secret or HTTP hop is needed.
const provenance = { via: "catch-up", caller: "toast-catering-scan" } as const;

/** Fail open to the pinger, fail closed to work on lookup/claim errors.
 * A claim buys one attempt per UTC day, including failed attempts. It does not
 * lock out a late Vercel invocation; the existing jobs retain their retry semantics.
 */
export async function catchUpDailyJobs(opts?: { now?: Date }): Promise<{ ran: string[]; skipped: string[] }> {
  const ran: string[] = [];
  const skipped: string[] = [];
  for (const registered of JOBS_REGISTRY) {
    if (!("catchUp" in registered)) continue;
    const entry = registered.catchUp;
    let failureContext: Record<string, unknown> = {};
    try {
      const now = opts?.now ?? new Date();
      if (!decideCatchUp(entry, now, null)) { skipped.push(entry.job); continue; }
      // Dormant means no work and no heartbeat, just like the route's 503.
      if (entry.job === "parse-receipts" && !process.env.ANTHROPIC_API_KEY) {
        skipped.push(entry.job); continue;
      }
      const day = now.toISOString().slice(0, 10);
      const midnight = `${day}T00:00:00.000Z`;
      const sb = getServiceRoleClient();
      const success = await sb.from("audit_log").select("occurred_at")
        .eq("action", "cron.success").eq("metadata->>job", entry.job)
        .gte("occurred_at", midnight).order("occurred_at", { ascending: false })
        .limit(1).maybeSingle<{ occurred_at: string }>();
      if (success.error) throw new Error("Catch-up heartbeat lookup failed");
      if (!decideCatchUp(entry, now, success.data?.occurred_at ?? null)) {
        skipped.push(entry.job); continue;
      }
      const claim = await sb.rpc("portal_rate_limit_hit", {
        p_bucket_key: `catchup:${entry.job}:${day}`, p_window_start: midnight, p_max: 1,
      });
      if (claim.error) throw new Error("Catch-up claim failed");
      if (claim.data !== true) { skipped.push(entry.job); continue; }

      let metadata: Record<string, unknown>;
      switch (entry.job) {
        case "prune-sessions": {
          const { revoked } = await runPruneSessions();
          metadata = { job: entry.job, revoked };
          break;
        }
        case "toast-sales-pull": {
          const businessDate = etYmdMinusDays(etCalendarDate(now.toISOString()), 1);
          failureContext = { business_date: businessDate };
          ({ metadata } = await runToastSalesPull({ businessDate }));
          break;
        }
        case "parse-receipts": {
          const result = await runParseReceipts();
          if (result.dormant) { skipped.push(entry.job); continue; }
          metadata = result.metadata;
          break;
        }
      }
      await audit({ ...auditBase, action: "cron.success", metadata: { ...metadata, ...provenance } });
      ran.push(entry.job);
    } catch (error) {
      skipped.push(entry.job);
      // Even failure reporting must not prevent the next sibling or the scan response.
      try {
        const msg = error instanceof Error ? error.message : String(error);
        await audit({ ...auditBase, action: "cron.failure", metadata: {
          job: entry.job, ...failureContext, ...provenance,
          error: msg.length > 500 ? `${msg.slice(0, 500)}…` : msg,
        } });
      } catch { /* fail open */ }
    }
  }
  return { ran, skipped };
}
