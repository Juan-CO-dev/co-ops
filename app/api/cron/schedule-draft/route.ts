// Vercel Wednesdays at 10:15 and 11:15 UTC (Scheduling Phase 2, Task 19; R3, J13): the Wednesday schedule draft. Both
// slots arrive; the one at or after 6 AM ET acts (EDT and EST alike), the other finds the week built. The shared lease
// 'schedule-draft' (0275) keeps duplicates out. Not in JOBS_REGISTRY: no email on a missed heartbeat; the heartbeat is
// the cron.success / cron.failure row with job 'schedule-draft'. Nothing here sends an email or a notification.
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { cronAuthStatus } from "@/lib/cron-auth";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { runWednesdayDraft } from "@/lib/scheduling/draft";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const auth = cronAuthStatus(req.headers);
  if (auth) return jsonError(auth, auth === 503 ? "cron_disabled" : "unauthorized");
  try {
    if (!await claimCronRoute("schedule-draft")) return jsonOk({ skipped: true, reason: "cron_route_busy" });
    const run = await runWednesdayDraft({ service: getServiceRoleClient(), now: new Date() });
    if (!run.ran) return jsonOk({ skipped: true, reason: run.reason });
    const built = run.shops.filter((s) => s.outcome === "built").length;
    await audit({
      actorId: null, actorRole: null, action: "cron.success", resourceTable: "cron", resourceId: null,
      metadata: { job: "schedule-draft", week_start: run.weekStart, shops: run.shops.length, built, skipped: run.shops.length - built,
        outcomes: run.shops.map((s) => ({ location_id: s.locationId, outcome: s.outcome, ...(s.outcome === "skipped" ? { reason: s.reason } : {}) })) },
      ipAddress: null, userAgent: null,
    });
    return jsonOk({ weekStart: run.weekStart, shops: run.shops });
  } catch {
    // Fixed codes only.
    await audit({ actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "schedule-draft", error: "draft_route_failed" }, ipAddress: null, userAgent: null });
    return jsonError(500, "draft_failed");
  }
}
