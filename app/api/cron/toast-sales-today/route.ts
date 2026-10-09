// Existing pinger URL: full-day capture for today/yesterday, bounded and debounced.
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { watchSiblings } from "@/lib/job-watch-run";
import { audit } from "@/lib/audit";
import { etCalendarDate } from "@/lib/operational-day";
import { pullTodaySalesForAllLocations } from "@/lib/catering/toast-sales";
import { captureIntraday } from "@/lib/toast/capture-intraday";
import { captureModified } from "@/lib/toast/capture-modified";
import { modifiedRouteBudget } from "@/lib/toast/capture-modified-shared";
import { laborPullEnabled, runToastLaborPull } from "@/lib/toast/labor";
import { runWhosHereTick } from "@/lib/whos-here-tick";

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
    const availableMs = Math.max(0, maxDuration * 1000 - (Date.now() - startedAt) - 10_000);
    const laborReserveMs = laborPullEnabled() ? Math.min(30_000, availableMs) : 0;
    const capture = await captureIntraday(today, req.signal, Math.max(0, availableMs - laborReserveMs));
    const modified = await captureModified(req.signal, modifiedRouteBudget(startedAt, Date.now(), laborPullEnabled()));
    // Labor is additive and fail-soft. It shares this route's wall-clock budget, and its own single
    // deadline also covers 0230 reconciliation after the full today + corrections pull succeeds.
    const laborBudgetMs = Math.min(30_000, Math.max(0, maxDuration * 1000 - (Date.now() - startedAt) - 10_000));
    const labor = laborBudgetMs >= 1_000
      ? await runToastLaborPull([today], { deadlineMs: laborBudgetMs, context: "cron", reconcileDate: today })
      : { ran: false, results: [], modified: 0 };
    // Who's here (0233, WHOS_HERE=1): its OWN bounded step AFTER labor, never inside labor's budget
    // (r1 P2-6). Shop-closed reconcile + auto links; fail-soft, nothing it does can stall the route.
    const whosHereBudgetMs = Math.min(15_000, Math.max(0, maxDuration * 1000 - (Date.now() - startedAt) - 5_000));
    const whosHere = whosHereBudgetMs >= 2_000
      ? await runWhosHereTick({ deadlineMs: whosHereBudgetMs, autolink: laborPullEnabled() })
      : { ran: false, results: [] };
    const results = captureMode ? capture.results : legacy;
    const n = (k: string) => legacy.filter((r) => r.result === k).length;
    const healthy = captureMode ? !capture.skipped && capture.failures === 0 : n("unknown") === 0 && n("error") === 0;
    await audit({
      actorId: null, actorRole: null, action: healthy ? "cron.success" : "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: {
        job: "toast-sales-today", date: today, source: captureMode ? "capture" : "legacy",
        pulled: n("pulled"), fresh: n("fresh"), no_toast: n("no_toast"), stale_check_failed: n("unknown"),
        capture_failures: capture.failures,
        modified_failures: modified.failures,
        modified_changed: modified.results.reduce((sum, r) => sum + r.changed, 0),
        captured: capture.results.filter((r) => !r.skipped && !r.error).length,
        skipped: capture.results.filter((r) => r.skipped).length,
        errors: captureMode ? capture.failures : n("error"), capture_disabled: capture.skipped,
      },
      ipAddress: null, userAgent: null,
    });
    await watchSiblings("toast-sales-today");
    return jsonOk({ date: today, results, healthy, capture, modified, labor, whosHere });
  } catch (e) {
    void audit({
      actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "toast-sales-today", date: today, error: truncateErr(e) },
      ipAddress: null, userAgent: null,
    });
    return jsonError(500, "pull_failed");
  }
}
