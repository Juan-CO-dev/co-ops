import { type NextRequest } from "next/server";
import { cronAuthStatus } from "@/lib/cron-auth";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { sweepMetaLeads } from "@/lib/meta-leads/worker";
export const runtime = "nodejs";
export const maxDuration = 180;
/** Retry backstop only; deliberately absent from JOBS_REGISTRY. */
export async function GET(req: NextRequest) {
  const auth = cronAuthStatus(req.headers);
  if (auth) return jsonError(auth, auth === 503 ? "cron_disabled" : "unauthorized");
  if (process.env.META_LEADS_ENABLED !== "1") return jsonOk({ disabled: true });
  try {
    if (!await claimCronRoute("meta-leads")) return jsonOk({ skipped: true });
    return jsonOk(await sweepMetaLeads());
  } catch { return jsonError(500, "meta_leads_sweep_failed"); }
}
