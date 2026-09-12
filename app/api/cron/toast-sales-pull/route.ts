// GET nightly Toast sales pull for all Toast-connected locations (Vercel Cron).
// Auth: x-cron-secret header (or Vercel Cron's Authorization: Bearer CRON_SECRET)
// must match env CRON_SECRET via constant-time compare. 503 no-op when unset
// (dormant-safe); locations without a Toast GUID are skipped by the lib.
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { runToastSalesPull } from "@/lib/toast-sales-pull-run";
import { watchSiblings } from "@/lib/job-watch-run";
import { audit } from "@/lib/audit";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";

/** Truncate a caught error message so a giant stack never bloats the audit row. */
function truncateErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

function secretOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-cron-secret")
    ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Yesterday in the operational timezone (business dates close overnight).
 *  DST-safe: ET calendar date first, then pure grid math — the previous
 *  toLocaleString round-trip computed D-2 all winter on UTC servers. */
function todayYmd(): string {
  return etCalendarDate(new Date().toISOString());
}

function yesterdayYmd(): string {
  return etYmdMinusDays(todayYmd(), 1);
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return jsonError(503, "cron_disabled");
  if (!secretOk(req)) return jsonError(401, "unauthorized");
  const businessDate = req.nextUrl.searchParams.get("date") ?? yesterdayYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return jsonError(400, "invalid_date");
  try {
    const { results, metadata } = await runToastSalesPull({ businessDate });
    await audit({
      actorId: null,
      actorRole: null,
      action: "cron.success",
      resourceTable: "cron",
      resourceId: null,
      metadata,
      ipAddress: null,
      userAgent: null,
    });
    await watchSiblings("toast-sales-pull");
    return jsonOk({ businessDate, results });
  } catch (e) {
    // A LIVE failure is otherwise silent (console only). Write a fail-open audit row
    // so the admin hub can surface it (Ops guardrails NOW #3). audit() never throws.
    void audit({
      actorId: null,
      actorRole: null,
      action: "cron.failure",
      resourceTable: "cron",
      resourceId: null,
      metadata: { job: "toast-sales-pull", business_date: businessDate, error: truncateErr(e) },
      ipAddress: null,
      userAgent: null,
    });
    // Spec contract: never throw to the platform — surface as a structured 500.
    return jsonError(500, "cron_failed", { message: e instanceof Error ? e.message : String(e) });
  }
}
