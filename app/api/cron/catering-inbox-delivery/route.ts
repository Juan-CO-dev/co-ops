// Vercel every ten minutes at :05 (catering inbox phase 1b): the delivery worker for NEW eligible arrivals. Inert BEFORE
// its lease: secret → the two OFF switches (CATERING_INBOX_DELIVERY_ENABLED=1 and settings mode live) → only then the
// 'catering-inbox-delivery' lease (0298). Off or shadow: a clean 200 skip, no heartbeat, no lease claim, no send.
// Not in JOBS_REGISTRY: no email on a missed heartbeat; the heartbeat is the cron.success / cron.failure row.
// Activation never bulk-sends old shadow drafts (0298 `not_new`); this route sends ONLY through lib/catering/inbox-delivery.ts.
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { cronAuthStatus } from "@/lib/cron-auth";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { CateringInboxError, readCateringInboxSettings } from "@/lib/catering/inbox";
import { runCateringInboxDelivery } from "@/lib/catering/inbox-delivery";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const auth = cronAuthStatus(req.headers);
  if (auth) return jsonError(auth, auth === 503 ? "cron_disabled" : "unauthorized");
  if (process.env.CATERING_INBOX_DELIVERY_ENABLED !== "1") return jsonOk({ skipped: true, reason: "delivery_off" });
  try {
    let mode: string;
    try { mode = (await readCateringInboxSettings(getServiceRoleClient())).mode; }
    catch (error) {
      if (error instanceof CateringInboxError && error.status === 503) return jsonOk({ skipped: true, reason: "inbox_unavailable" });
      throw error;
    }
    if (mode !== "live") return jsonOk({ skipped: true, reason: "delivery_off" });
    if (!await claimCronRoute("catering-inbox-delivery")) return jsonOk({ skipped: true, reason: "cron_route_busy" });
    const deadlineMs = Math.max(1_000, maxDuration * 1000 - 15_000 - (Date.now() - startedAt));
    const run = await runCateringInboxDelivery({ now: new Date(), deadlineMs });
    if (!run.ran) return jsonOk({ skipped: true, reason: run.reason });
    await audit({ actorId: null, actorRole: null, action: "cron.success", resourceTable: "cron", resourceId: null,
      metadata: { job: "catering-inbox-delivery", replies: run.replies, escalations: run.escalations }, ipAddress: null, userAgent: null });
    return jsonOk({ replies: run.replies, escalations: run.escalations });
  } catch {
    // Counts and fixed codes only: never an address, a provider message or a body.
    await audit({ actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "catering-inbox-delivery", error: "delivery_route_failed" }, ipAddress: null, userAgent: null });
    return jsonError(500, "delivery_failed");
  }
}
