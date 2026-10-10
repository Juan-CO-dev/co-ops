// Vercel runs every ten minutes; desktop credentials remain supported during cutover.
// Padding outside 06-22 ET safely scans the same dated orders and catches up due jobs.
import { cronAuthStatus } from "@/lib/cron-auth";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { catchUpDailyJobs } from "@/lib/daily-catchup";
import { watchSiblings } from "@/lib/job-watch-run";
import { audit } from "@/lib/audit";
import { scanToastCateringForAllLocations } from "@/lib/catering/toast-catering-scan";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_DATE_SKEW_DAYS = 14;

function truncateErr(e: unknown): string { const m = e instanceof Error ? e.message : String(e); return m.length > 500 ? `${m.slice(0, 500)}…` : m; }
export async function GET(req: NextRequest) {
  const auth = cronAuthStatus(req.headers);
  if (auth) return jsonError(auth, auth === 503 ? "cron_disabled" : "unauthorized");
  const today = etCalendarDate(new Date().toISOString());
  const param = req.nextUrl.searchParams.get("date");
  if (param && !/^\d{4}-\d{2}-\d{2}$/.test(param)) return jsonError(400, "invalid_date");
  if (param) {
    const earliest = etYmdMinusDays(today, MAX_DATE_SKEW_DAYS);
    const latest = etYmdMinusDays(today, -MAX_DATE_SKEW_DAYS);
    if (param < earliest || param > latest) return jsonError(400, "date_out_of_range");
  }
  const dates = param ? [param] : [today, etYmdMinusDays(today, 1)];
  try {
    if (!await claimCronRoute("toast-catering-scan")) return jsonOk({ skipped: true, reason: "cron_route_busy" });
    const results = await scanToastCateringForAllLocations(dates);
    const sum = (k: "seen" | "catering" | "attributed" | "createdLeads" | "lostLeads" | "refreshed" | "skipped" | "errors" | "unparsedAmounts") => results.reduce((n, r) => n + r[k], 0);
    const healthy = results.every((result) => result.ok);
    await audit({ actorId: null, actorRole: null, action: healthy ? "cron.success" : "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "toast-catering-scan", dates, seen: sum("seen"), catering: sum("catering"), attributed: sum("attributed"), created_leads: sum("createdLeads"), lost_leads: sum("lostLeads"), refreshed: sum("refreshed"), skipped: sum("skipped"), errors: sum("errors"), unparsed_amounts: sum("unparsedAmounts"), per_location_failures: results.filter((r) => !r.ok).length, pending_dates: results.flatMap((r) => (r.pendingDates ?? []).map((d) => r.locationId + ":" + d)) },
      ipAddress: null, userAgent: null });
    await catchUpDailyJobs();
    await watchSiblings("toast-catering-scan");
    return jsonOk({ dates, results, healthy });
  } catch (e) {
    void audit({ actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null, metadata: { job: "toast-catering-scan", dates, error: truncateErr(e) }, ipAddress: null, userAgent: null });
    return jsonError(500, "scan_failed");
  }
}
