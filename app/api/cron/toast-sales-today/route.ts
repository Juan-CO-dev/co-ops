// Existing pinger URL: full-day capture for today/yesterday, bounded and debounced.
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { watchSiblings } from "@/lib/job-watch-run";
import { audit } from "@/lib/audit";
import { etCalendarDate } from "@/lib/operational-day";
import { pullTodaySalesForAllLocations } from "@/lib/catering/toast-sales";
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
  const startedAt = Date.now();
  if (!process.env.CATERING_SCAN_SECRET) return jsonError(503, "cron_disabled");
  if (!secretOk(req)) return jsonError(401, "unauthorized");
  // No `?date=` override: this route exists to keep TODAY warm, and a backfill belongs to
  // the nightly cron, which is the only path allowed to touch the ledger.
  const today = etCalendarDate(new Date().toISOString());
  try {
    const captureMode = process.env.DEPLETION_SOURCE === "capture";
    const legacy = captureMode ? [] : await pullTodaySalesForAllLocations(today);
    const capture = await captureIntraday(today, req.signal, Math.max(0, maxDuration * 1000 - (Date.now() - startedAt) - 10_000));
    const results = captureMode ? capture.results : legacy;
    const n = (k: string) => legacy.filter((r) => r.result === k).length;
    const healthy = captureMode ? !capture.skipped && capture.failures === 0 : n("unknown") === 0 && n("error") === 0;
    await audit({
      actorId: null, actorRole: null, action: healthy ? "cron.success" : "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: {
        job: "toast-sales-today", date: today, source: captureMode ? "capture" : "legacy",
        pulled: n("pulled"), fresh: n("fresh"), no_toast: n("no_toast"), stale_check_failed: n("unknown"),
        capture_failures: capture.failures,
        captured: capture.results.filter((r) => !r.skipped && !r.error).length,
        skipped: capture.results.filter((r) => r.skipped).length,
        errors: captureMode ? capture.failures : n("error"), capture_disabled: capture.skipped,
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
