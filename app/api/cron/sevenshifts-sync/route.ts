// Vercel hourly at :20 (Scheduling Phase 1, Task 8): the 7shifts READ sync. Clear of the :00 digest
// and the */10 ticks. Dormant without SEVENSHIFTS_ACCESS_TOKEN or SEVENSHIFTS_SYNC=1 (no lease claim,
// no request, no write). Not in JOBS_REGISTRY: sync health is shown in the app only (R6), never emailed.
import { type NextRequest } from "next/server";
import { cronAuthStatus } from "@/lib/cron-auth";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { sevenShiftsStatus } from "@/lib/sevenshifts/config";
import { runSevenShiftsSync } from "@/lib/sevenshifts/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const auth = cronAuthStatus(req.headers);
  if (auth) return jsonError(auth, auth === 503 ? "cron_disabled" : "unauthorized");
  const status = sevenShiftsStatus();
  if (status.reason === "token_missing" || status.reason === "sync_off") return jsonOk({ skipped: true, reason: status.reason });
  try {
    if (!await claimCronRoute("sevenshifts-sync")) return jsonOk({ skipped: true, reason: "cron_route_busy" });
    const deadlineMs = Math.max(1_000, maxDuration * 1000 - 10_000 - (Date.now() - startedAt));
    // The run writes its own ledger row and its own heartbeat (cron.success | cron.failure, job sevenshifts-sync).
    const outcome = await runSevenShiftsSync({ trigger: "cron", deadlineMs });
    if (!outcome.ran) return jsonOk({ skipped: true, reason: outcome.reason });
    return jsonOk({ runId: outcome.runId, status: outcome.status, requests: outcome.requests, results: outcome.results });
  } catch {
    // Counts and fixed codes only: never a provider message, URL or token.
    void audit({
      actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "sevenshifts-sync", error: "sync_route_failed" }, ipAddress: null, userAgent: null,
    });
    return jsonError(500, "sync_failed");
  }
}
