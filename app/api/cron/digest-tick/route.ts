// GET report digests tick (Reports hub v2 piece 2 + the catering morning digest, 2026-10-07).
// Vercel Pro calls this hourly all day; desktop callers remain supported. The unified
// digest's 03:00 ET fallback runs here. Each tick reconciles every digest that is due and not
// sent (GM per-shop for finalized closings, the unified digest, the catering morning digest at
// its setting), runs the fallback, and watches for misses. All scheduling is pure and lives in
// lib/report-digests-shared.ts; repeated ticks share the digest send claim.
//
// The switch (report_settings.digest_delivery_mode) ships OFF: the tick still heartbeats so
// job-watch knows the scheduler is alive, but composes and sends nothing.
//
// Auth: x-cron-secret must equal CATERING_SCAN_SECRET for the desktop pinger; Vercel's
// Authorization: Bearer must equal CRON_SECRET. CRON_SECRET never lives on the pinger machine.
// 503 when neither secret is configured.
import { cronAuthStatus } from "@/lib/cron-auth";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { watchSiblings } from "@/lib/job-watch-run";
import { audit } from "@/lib/audit";
import { runDigestTick } from "@/lib/report-digests";

export const runtime = "nodejs";
export const maxDuration = 300;

function truncateErr(e: unknown): string { const m = e instanceof Error ? e.message : String(e); return m.length > 500 ? `${m.slice(0, 500)}…` : m; }
export async function GET(req: NextRequest) {
  const auth = cronAuthStatus(req.headers);
  if (auth) return jsonError(auth, auth === 503 ? "cron_disabled" : "unauthorized");
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
