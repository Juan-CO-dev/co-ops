// GET Toast catering scan (catering inbox A1.2). Toast order webhooks are partner-only, so an
// external pinger (CO desktop Task Scheduler) calls this every 10 minutes in business hours.
// Auth: x-cron-secret header (or Authorization: Bearer) must equal env CATERING_SCAN_SECRET —
// a DEDICATED, low-blast secret (it can only trigger an idempotent scan), so it may live on the
// pinger machine without exposing CRON_SECRET. 503 no-op when unset (dormant-safe).
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { scanToastCateringForAllLocations } from "@/lib/catering/toast-catering-scan";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_DATE_SKEW_DAYS = 14;

function truncateErr(e: unknown): string { const m = e instanceof Error ? e.message : String(e); return m.length > 500 ? `${m.slice(0, 500)}…` : m; }
function secretOk(req: NextRequest): boolean {
  const secret = process.env.CATERING_SCAN_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(provided); const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!process.env.CATERING_SCAN_SECRET) return jsonError(503, "cron_disabled");
  if (!secretOk(req)) return jsonError(401, "unauthorized");
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
    const results = await scanToastCateringForAllLocations(dates);
    const sum = (k: "seen" | "catering" | "attributed" | "createdLeads" | "lostLeads" | "refreshed" | "skipped" | "errors") => results.reduce((n, r) => n + r[k], 0);
    void audit({ actorId: null, actorRole: null, action: "cron.success", resourceTable: "cron", resourceId: null,
      metadata: { job: "toast-catering-scan", dates, seen: sum("seen"), catering: sum("catering"), attributed: sum("attributed"), created_leads: sum("createdLeads"), lost_leads: sum("lostLeads"), refreshed: sum("refreshed"), skipped: sum("skipped"), errors: sum("errors"), per_location_failures: results.filter((r) => !r.ok).length },
      ipAddress: null, userAgent: null });
    return jsonOk({ dates, results });
  } catch (e) {
    void audit({ actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null, metadata: { job: "toast-catering-scan", dates, error: truncateErr(e) }, ipAddress: null, userAgent: null });
    return jsonError(500, "scan_failed");
  }
}
