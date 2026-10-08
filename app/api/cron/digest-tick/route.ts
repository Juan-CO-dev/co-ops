// GET report digests tick (Reports hub v2 piece 2 + the catering morning digest, 2026-10-07).
// Vercel is on Hobby, so there is NO dedicated cron: the CO desktop pinger (Task Scheduler) calls
// this every 10 minutes from 03:00 to 22:00 ET — the window starts at 03:00 so the unified
// digest's 03:00 ET fallback runs here. Each tick reconciles every digest that is due and not
// sent (GM per-shop for finalized closings, the unified digest, the catering morning digest at
// its setting), runs the fallback, and watches for misses. All scheduling is pure and lives in
// lib/report-digests-shared.ts; a dedicated cron later is one vercel.json line pointing here.
//
// The switch (report_settings.digest_delivery_mode) ships OFF: the tick still heartbeats so
// job-watch knows the pinger is alive, but composes and sends nothing.
//
// Auth: x-cron-secret header (or Authorization: Bearer) must equal env CATERING_SCAN_SECRET —
// the same DEDICATED, low-blast pinger secret the catering scan uses (it can only trigger
// idempotent digest sends), so CRON_SECRET never lives on the pinger machine. 503 when unset.
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { watchSiblings } from "@/lib/job-watch-run";
import { audit } from "@/lib/audit";
import { runDigestTick } from "@/lib/report-digests";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  try {
    const summary = await runDigestTick();
    await audit({
      actorId: null, actorRole: null, action: "cron.success", resourceTable: "cron", resourceId: null,
      metadata: { job: "digest-tick", mode: summary?.mode ?? "off", counts: summary?.counts ?? null, alerts: summary?.alerts ?? 0, stale_claims: summary?.staleClaims ?? 0 },
      ipAddress: null, userAgent: null,
    });
    await watchSiblings("digest-tick");
    return jsonOk({ mode: summary?.mode ?? "off", counts: summary?.counts ?? null });
  } catch (e) {
    void audit({
      actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "digest-tick", error: truncateErr(e) },
      ipAddress: null, userAgent: null,
    });
    return jsonError(500, "digest_tick_failed");
  }
}
