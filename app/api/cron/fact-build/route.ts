// Vercel hourly at :40 (item 2 PR 2b): the ORDER fact build. Clear of the :00 digest, the :20 7shifts
// read and the */10 capture ticks. OFF unless FACT_LAYER=1 (no lease claim, no read, no write).
// Needs migration 0337 applied BEFORE FACT_LAYER is set: 0337 adds 'fact-build' to claim_cron_route.
// Not in JOBS_REGISTRY: nothing emails. One bounded pass per call; whatever is still stale is found by the next.
// Heartbeat: cron.success / cron.failure (job fact-build) on every pass that ran.
import { type NextRequest } from "next/server";
import { cronAuthStatus } from "@/lib/cron-auth";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { etCalendarDate } from "@/lib/operational-day";
import { factFloor, factLayerEnabled, FACT_PASS_BUDGET_MS } from "@/lib/facts/config-shared";
import { runFactBuildPass } from "@/lib/facts/order-facts";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const auth = cronAuthStatus(req.headers);
  if (auth) return jsonError(auth, auth === 503 ? "cron_disabled" : "unauthorized");
  if (!factLayerEnabled(process.env.FACT_LAYER)) return jsonOk({ skipped: true, reason: "fact_layer_off" });
  try {
    if (!await claimCronRoute("fact-build")) return jsonOk({ skipped: true, reason: "cron_route_busy" });
    const floor = factFloor(process.env.FACT_CAPTURE_FLOOR, etCalendarDate(new Date(startedAt).toISOString()));
    const result = await runFactBuildPass({ floor, deadlineAt: startedAt + FACT_PASS_BUDGET_MS });
    // The heartbeat (review r1 #2, BC-033): every pass writes cron.success or cron.failure (job fact-build),
    // like the sibling crons. A pass with ANY failed day (timeouts included) is cron.failure, naming up
    // to FACT_FAILURE_SAMPLE days by fixed code; a database message never reaches the row or the body.
    const healthy = result.failed === 0;
    await audit({
      actorId: null, actorRole: null, action: healthy ? "cron.success" : "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: {
        job: "fact-build", floor, ...(healthy ? {} : { error: "fact_days_failed" }),
        stale: result.stale, built: result.built, raced: result.raced, failed: result.failed, timed_out: result.timedOut,
        left_for_next_pass: result.leftForNextPass,
        failures: result.failures.map((f) => ({ location_id: f.locationId, business_date: f.businessDate, error: f.error })),
      },
      ipAddress: null, userAgent: null,
    });
    return jsonOk({ floor, healthy, ...result });
  } catch {
    await audit({
      actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "fact-build", error: "fact_build_failed" }, ipAddress: null, userAgent: null,
    });
    return jsonError(500, "fact_build_failed");
  }
}
