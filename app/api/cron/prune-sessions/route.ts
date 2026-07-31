// GET nightly expired-session prune (Vercel Cron). Stamps revoked_at on sessions
// already past expires_at to bound unbounded sessions-table growth — pure
// housekeeping (the auth layer already rejects expired sessions; this only tidies
// the row set). Auth: x-cron-secret header (or Vercel Cron's
// Authorization: Bearer CRON_SECRET) must match env CRON_SECRET via constant-time
// compare. 503 no-op when unset (dormant-safe). Mirrors the toast-sales-pull cron
// auth + heartbeat pattern.
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { pruneExpiredSessions } from "@/lib/session";

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

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return jsonError(503, "cron_disabled");
  if (!secretOk(req)) return jsonError(401, "unauthorized");
  try {
    const { revoked } = await pruneExpiredSessions();
    // Heartbeat (fail-open): a cron.success row lets the admin hub show "last run OK".
    void audit({
      actorId: null,
      actorRole: null,
      action: "cron.success",
      resourceTable: "cron",
      resourceId: null,
      metadata: { job: "prune-sessions", revoked },
      ipAddress: null,
      userAgent: null,
    });
    return jsonOk({ revoked });
  } catch (e) {
    // A LIVE failure is otherwise silent (console only). Write a fail-open audit row
    // so the admin hub can surface it. audit() never throws.
    void audit({
      actorId: null,
      actorRole: null,
      action: "cron.failure",
      resourceTable: "cron",
      resourceId: null,
      metadata: { job: "prune-sessions", error: truncateErr(e) },
      ipAddress: null,
      userAgent: null,
    });
    return jsonError(500, "cron_failed", { message: e instanceof Error ? e.message : String(e) });
  }
}
