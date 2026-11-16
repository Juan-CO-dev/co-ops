import "server-only";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";
import { decideCatchUp } from "@/lib/daily-catchup-shared";
import { runPruneSessions } from "@/lib/prune-sessions-run";
import { runVaultScrub } from "@/lib/vault-scrub-run";
import { runToastSalesPull } from "@/lib/toast-sales-pull-run";
import { runParseReceipts } from "@/lib/parse-receipts-run";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";
import { receiptRunFits } from "@/lib/receipt-parse-budget-shared";

export { decideCatchUp } from "@/lib/daily-catchup-shared";

const auditBase = {
  actorId: null, actorRole: null, resourceTable: "cron", resourceId: null,
  ipAddress: null, userAgent: null,
} as const;
// This is the only route that runs catch-up; no secret or HTTP hop is needed.
const provenance = { via: "catch-up", caller: "toast-catering-scan" } as const;

/** The least route time a caught-up job needs to start (W27 / B225). The sales pull needs room for capture and its
 *  tail; the receipt run's minimum comes from the shared receipt budget (`receiptRunFits`), never a number of its
 *  own. Below it the job is skipped BEFORE its claim, so the next 10-minute tick can still run it. prune-sessions
 *  is quick and is not gated. */
export const CATCH_UP_MIN_JOB_MS: Readonly<Record<string, number>> = { "toast-sales-pull": 90_000 };

/** Fail open to the pinger, fail closed to work on lookup/claim errors.
 * A claim buys one attempt per UTC day, including failed attempts. It does not
 * lock out a late Vercel invocation; the existing jobs retain their retry semantics.
 *
 * `deadline` is when the HOST route must be done with its work (audit W20/B115). The receipt
 * catch-up runs after the scan and after the other catch-ups, so it cannot assume a full run of
 * its own: it parses only inside what is left, and when not even one whole parse fits it is left
 * for the next scan WITHOUT spending its one attempt for the day.
 */
export async function catchUpDailyJobs(opts: { now?: Date; deadline: number; signal?: AbortSignal }): Promise<{ ran: string[]; skipped: string[] }> {
  const ran: string[] = [];
  const skipped: string[] = [];
  for (const registered of JOBS_REGISTRY) {
    if (!("catchUp" in registered)) continue;
    const entry = registered.catchUp;
    let failureContext: Record<string, unknown> = {};
    try {
      const now = opts.now ?? new Date();
      if (!decideCatchUp(entry, now, null)) { skipped.push(entry.job); continue; }
      // Dormant means no work and no heartbeat, just like the route's 503.
      if (entry.job === "parse-receipts" && !process.env.ANTHROPIC_API_KEY
        && !(process.env.RESEND_INBOUND_SECRET && process.env.RESEND_API_KEY)) {
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
      // The caller's route has one budget; a job that cannot finish inside it must not spend the day's one claim.
      // Asked last, right before the claim, so the lookup's own time is already spent (W27 / B225 r1).
      const minMs = CATCH_UP_MIN_JOB_MS[entry.job];
      if (minMs !== undefined && opts.deadline - Date.now() < minMs) { skipped.push(entry.job); continue; }
      if (entry.job === "parse-receipts" && !receiptRunFits(Date.now(), opts.deadline, !!process.env.ANTHROPIC_API_KEY)) {
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
          // Retention is independent of pruning and of the vault UI switch.
          try {
            const vault = await runVaultScrub();
            await audit({ ...auditBase, action: "cron.success", metadata: { job: "vault-scrub", ...vault, ...provenance } });
          } catch {
            try {
              await audit({ ...auditBase, action: "cron.failure", metadata: { job: "vault-scrub", error: "vault_scrub_failed", ...provenance } });
            } catch { /* failure reporting must not prevent pruning */ }
          }
          const { revoked } = await runPruneSessions();
          metadata = { job: entry.job, revoked };
          break;
        }
        case "toast-sales-pull": {
          const businessDate = etYmdMinusDays(etCalendarDate(now.toISOString()), 1);
          failureContext = { business_date: businessDate };
          const result = await runToastSalesPull({ businessDate, deadlineAt: opts.deadline, signal: opts.signal });
          metadata = result.metadata;
          if (!result.healthy) {
            failureContext = metadata;
            throw new Error("toast_selection_pull_failed");
          }
          break;
        }
        case "parse-receipts": {
          const result = await runParseReceipts(opts.deadline);
          if (result.dormant) { skipped.push(entry.job); continue; }
          // Admission leaves the handoff plus one whole window, so this is the backstop (W27/B225 r2): a run that
          // started nothing while work was waiting did no work, and is never written down as a success. The claim
          // is already spent (0131's claim has no release); the 15-minute receipt cron still reads that mail.
          if (result.startedNothing) { skipped.push(entry.job); continue; }
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
