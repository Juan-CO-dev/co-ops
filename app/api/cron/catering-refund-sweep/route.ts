// Vercel every 15 minutes at :03 / :18 / :33 / :48 (catering refunds Part B1 v2, plan section 6): the refund MIRROR
// sweep. GETs only: this path has no create capability (it imports no sender). OFF unless CATERING_REFUNDS_OBSERVE=1:
// then it answers `{ skipped }` before any service client is created, any claim is made or any heartbeat is written.
//
// THE ROUTE NEVER CLAIMS [R1]: `runRefundSweep` makes the ONE claim (0359 F13 `catering_refund_sweep_begin`, on B1's
// own observation row). Not `claimCronRoute`, not in `cron_route_leases` (DR13), not in JOBS_REGISTRY and never seen
// by the mailing job watch (DR12): a sweep that stops is seen as `paused` on every refund panel within the hour and
// on the inventory page (claim and finished pass [T6]), fails safe (no figure, no button) and resumes dirty.
// Nothing here sends mail or notifies anyone.
//
// Not claimed (`busy`, `observe_not_recorded`): `{ skipped: reason }`, no heartbeat (the house norm for a skip).
// Schema missing (0359 not applied): 503 + `cron.failure`. Any other failure of the claim itself: 500 + `cron.failure`.
// Otherwise one `cron.success` heartbeat (job `catering-refund-sweep`) with COUNTS ONLY: never a payment, request,
// refund, charge or PaymentIntent id. The heartbeat goes through the house `audit()` helper, which keys the job by
// `metadata.job` and needs no registry entry (as fact-build's does).
import { type NextRequest } from "next/server";
import { cronAuthStatus } from "@/lib/cron-auth";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { cateringRefundsObserveOn } from "@/lib/catering/refunds-shared";
import { RefundsUnavailableError, runRefundSweep, type RefundSweepCounts } from "@/lib/catering/refund-observe";

export const runtime = "nodejs";
export const maxDuration = 120;

/** The worker's whole budget: the route's 120 s less a 20 s reserve for the pass-end stamp and the heartbeat. */
const SWEEP_BUDGET_MS = 100_000;
const JOB = "catering-refund-sweep";

/** The heartbeat's metadata: counts and one instant, never an id (`notComplete` is keyed by REASON name). */
function heartbeat(c: RefundSweepCounts) {
  return {
    job: JOB,
    resumed: c.resumed, resumed_rows: c.resumedRows, transitions: c.transitions,
    passes: c.passes, complete: c.complete, not_complete: c.notComplete, replaced: c.replaced, ineligible: c.ineligible,
    record_failed: c.recordFailed, begin_failed: c.beginFailed, bound: c.bound, cancelled_unarmed: c.cancelledUnarmed,
    left_a: c.leftA, left_c: c.leftC, left_stale_unarmed: c.leftStaleUnarmed,
    never_read: c.neverRead, dirty: c.dirty, unconfirmed: c.unconfirmed, ledger_rows_read: c.ledgerRowsRead,
    oldest_unchecked_at: c.oldestUncheckedAt, pass_end_stamped: c.passEndStamped, gets: c.gets,
  };
}

const failure = (error: "refunds_unavailable" | "sweep_failed") => audit({
  actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
  metadata: { job: JOB, error }, ipAddress: null, userAgent: null,
});

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const auth = cronAuthStatus(req.headers);
  if (auth) return jsonError(auth, auth === 503 ? "cron_disabled" : "unauthorized");
  if (!cateringRefundsObserveOn(process.env)) return jsonOk({ skipped: "observe_off" });
  let counts: RefundSweepCounts;
  try {
    counts = await runRefundSweep(getServiceRoleClient(), { deadlineMs: startedAt + SWEEP_BUDGET_MS });
  } catch (e) {
    if (e instanceof RefundsUnavailableError) {
      await failure("refunds_unavailable");
      return jsonError(503, "refunds_unavailable");
    }
    await failure("sweep_failed");
    return jsonError(500, "sweep_failed");
  }
  if (!counts.claimed) return jsonOk({ skipped: counts.reason ?? "not_claimed" });
  const metadata = heartbeat(counts);
  await audit({
    actorId: null, actorRole: null, action: "cron.success", resourceTable: "cron", resourceId: null,
    metadata, ipAddress: null, userAgent: null,
  });
  return jsonOk({ ok: true, counts: metadata });
}
