// GET same-day Toast sales pinger (catering-truth arc 2026-09-05). Toast has no push for
// sales, so the mid-shift Sales panel was only ever as fresh as the last manager to open the
// page; an external pinger (the CO desktop Task Scheduler, same job that calls the catering
// scan) calls this every 10 minutes in business hours so today's numbers are already warm.
//
// EVENTS-ONLY: this route pulls toast_sales_events for TODAY and NEVER materializes the
// depletion ledger — the nightly T-1 cron stays the sole ledger materializer, so a ledger row
// can only ever describe a CLOSED business day (toast-sales.ts, review C1). Each location is
// debounced on its own last pull ATTEMPT (success or failure) — a Toast outage cannot storm
// the API, and a doubled pinger cycle is a no-op.
//
// Auth: x-cron-secret header (or Authorization: Bearer) must equal env CATERING_SCAN_SECRET —
// the same DEDICATED, low-blast secret the catering scan uses (it can only trigger an
// idempotent, read-only-to-us ingest), so it may live on the pinger machine without exposing
// CRON_SECRET. 503 no-op when unset (dormant-safe).
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { watchSiblings } from "@/lib/job-watch-run";
import { audit } from "@/lib/audit";
import { pullTodaySalesForAllLocations } from "@/lib/catering/toast-sales";
import { etCalendarDate } from "@/lib/operational-day";

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
    const results = await pullTodaySalesForAllLocations(today);
    const n = (k: string) => results.filter((r) => r.result === k).length;
    await audit({
      actorId: null, actorRole: null, action: "cron.success", resourceTable: "cron", resourceId: null,
      metadata: {
        job: "toast-sales-today", date: today,
        pulled: n("pulled"), fresh: n("fresh"), no_toast: n("no_toast"),
        // `unknown` = the debounce/location read failed, so nothing was pulled. Counted
        // separately from `error` so a silent skip can never read as a healthy cycle.
        stale_check_failed: n("unknown"), errors: n("error"),
      },
      ipAddress: null, userAgent: null,
    });
    await watchSiblings("toast-sales-today");
    return jsonOk({ date: today, results });
  } catch (e) {
    void audit({
      actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "toast-sales-today", date: today, error: truncateErr(e) },
      ipAddress: null, userAgent: null,
    });
    return jsonError(500, "pull_failed");
  }
}
