import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { runJobWatch } from "@/lib/job-watch-run";

export const runtime = "nodejs";

// Same authentication contract as prune-sessions, including the dormant-safe 503.
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

const auditBase = {
  actorId: null, actorRole: null, resourceTable: "cron", resourceId: null,
  ipAddress: null, userAgent: null,
} as const;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return jsonError(503, "cron_disabled");
  if (!secretOk(req)) return jsonError(401, "unauthorized");
  try {
    const { alerted } = await runJobWatch({ self: "job-watch" });
    await audit({ ...auditBase, action: "cron.success", metadata: { job: "job-watch", alerted } });
    return jsonOk({ alerted });
  } catch {
    await audit({ ...auditBase, action: "cron.failure", metadata: { job: "job-watch", error: "job_watch_failed" } });
    return jsonError(500, "cron_failed");
  }
}
