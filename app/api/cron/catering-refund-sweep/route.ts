// Vercel every 15 minutes (catering refunds Part B1.3 "Sweep"): the refund reconciler's scheduled pass.
// OFF, and INERT BEFORE ITS LEASE:
//   the secret -> CATERING_REFUNDS=1 (else nothing: no service client, no lease, no heartbeat) -> the schema admits
//   this build (else 503 `refunds_unavailable` + a cron.failure row: an operator-visible installation failure) ->
//   the epoch admits work (recovering / live / draining; else skipped by name with no lease, no heartbeat, no mail) -> the lease ->
//   one bounded sweep -> the heartbeat (cron.success / cron.failure, job catering-refund-sweep) -> watchSiblings.
// GETs ONLY: this path has no Stripe create capability (runRefundSweep performs reads; the one POST lives behind an
// authorized staff press in lib/catering/refunds.ts). Needs 0359 (it adds the 'catering-refund-sweep' lease).
// In JOBS_REGISTRY, watched CONDITIONALLY by lib/job-watch-run.ts (only while ON and the epoch admits work).
import { type NextRequest } from "next/server";
import { cronAuthStatus } from "@/lib/cron-auth";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { cateringRefundsOn } from "@/lib/catering/refunds-shared";
import { loadRefundEpoch, runRefundSweep, type RefundSweepResult } from "@/lib/catering/refund-reconcile";
import { watchSiblings } from "@/lib/job-watch-run";

export const runtime = "nodejs";
/** The route budget (plan B1.6): 120 s, of which 15 s are kept back for the heartbeat and the watch. */
export const maxDuration = 120;
const FINISH_RESERVE_MS = 15_000;

/** Counts only: never a payment, request or event id. */
function sweepCounts(r: RefundSweepResult) {
  return {
    epoch_state: r.epochState, seeded: r.seeded, passes: r.passes, applied: r.applied, incomplete: r.incomplete,
    held: r.held, deferred: r.deferred, cleanups: r.cleanups, left: r.left,
  };
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const auth = cronAuthStatus(req.headers);
  if (auth) return jsonError(auth, auth === 503 ? "cron_disabled" : "unauthorized");
  // OFF parity: answered before a service client, a lease or a heartbeat exists.
  if (!cateringRefundsOn(process.env)) return jsonOk({ skipped: true, reason: "catering_refunds_off" });
  try {
    const sb = getServiceRoleClient();
    const epoch = await loadRefundEpoch(sb);
    if (!epoch.installed || !epoch.callerOk) {
      // ON with the required schema missing or incompatible (plan Activation table): a NAMED, operator-visible
      // installation failure, never a silent skip. No lease is taken and nothing is swept.
      await audit({
        actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
        metadata: { job: "catering-refund-sweep", error: "refunds_unavailable", installed: epoch.installed }, ipAddress: null, userAgent: null,
      });
      return jsonError(503, "refunds_unavailable");
    }
    if (epoch.state !== "recovering" && epoch.state !== "live" && epoch.state !== "draining") {
      return jsonOk({ skipped: true, reason: "refunds_no_epoch" });
    }
    if (!await claimCronRoute("catering-refund-sweep")) return jsonOk({ skipped: true, reason: "cron_route_busy" });
    const result = await runRefundSweep(sb, { deadlineMs: startedAt + maxDuration * 1000 - FINISH_RESERVE_MS });
    // The epoch closed between the check and the sweep: nothing was admitted, so no heartbeat.
    if (!result.ran) return jsonOk({ skipped: true, reason: "refunds_no_epoch" });
    const counts = sweepCounts(result);
    await audit({
      actorId: null, actorRole: null, action: "cron.success", resourceTable: "cron", resourceId: null,
      metadata: { job: "catering-refund-sweep", ...counts },
      ipAddress: null, userAgent: null,
    });
    await watchSiblings("catering-refund-sweep");
    return jsonOk(counts);
  } catch {
    await audit({
      actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "catering-refund-sweep", error: "refund_sweep_failed" }, ipAddress: null, userAgent: null,
    });
    return jsonError(500, "refund_sweep_failed");
  }
}
