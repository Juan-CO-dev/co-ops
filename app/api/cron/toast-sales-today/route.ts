// Existing pinger URL: full-day capture for today/yesterday, bounded and debounced.
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { watchSiblings } from "@/lib/job-watch-run";
import { audit } from "@/lib/audit";
import { etCalendarDate } from "@/lib/operational-day";
import { captureIntraday } from "@/lib/toast/capture-intraday";

export const runtime = "nodejs";
export const maxDuration = 120;

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
  // No `?date=` override: this route exists to keep TODAY warm, and a backfill belongs to
  // the nightly cron, which is the only path allowed to touch the ledger.
  const today = etCalendarDate(new Date().toISOString());
  try {
    const capture = await captureIntraday(today, req.signal);
    const results = capture.results;
    const healthy = !capture.skipped && capture.failures === 0;
    await audit({
      actorId: null, actorRole: null, action: healthy ? "cron.success" : "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: {
        job: "toast-sales-today", date: today,
        capture_failures: capture.failures,
        captured: results.filter((r) => !r.skipped && !r.error).length,
        skipped: results.filter((r) => r.skipped).length,
        errors: capture.failures, capture_disabled: capture.skipped,
      },
      ipAddress: null, userAgent: null,
    });
    await watchSiblings("toast-sales-today");
    return jsonOk({ date: today, results, healthy, capture });
  } catch (e) {
    void audit({
      actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "toast-sales-today", date: today, error: truncateErr(e) },
      ipAddress: null, userAgent: null,
    });
    return jsonError(500, "pull_failed");
  }
}
