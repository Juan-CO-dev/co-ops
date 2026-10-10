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
import { watchSiblings } from "@/lib/job-watch-run";
import { audit } from "@/lib/audit";
import { runPruneSessions } from "@/lib/prune-sessions-run";
import { runVaultScrub } from "@/lib/vault-scrub-run";

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
  const auditBase = { actorId: null, actorRole: null, resourceTable: "cron", resourceId: null, ipAddress: null, userAgent: null };
  let vault: Awaited<ReturnType<typeof runVaultScrub>> | undefined;
  let revoked: number | undefined;
  let failed = false;
  try {
    vault = await runVaultScrub();
    await audit({ ...auditBase, action: "cron.success", metadata: { job: "vault-scrub", ...vault } });
  } catch {
    failed = true;
    await audit({ ...auditBase, action: "cron.failure", metadata: { job: "vault-scrub", error: "vault_scrub_failed" } });
  }
  try {
    ({ revoked } = await runPruneSessions());
    await audit({ ...auditBase, action: "cron.success", metadata: { job: "prune-sessions", revoked } });
  } catch {
    failed = true;
    await audit({ ...auditBase, action: "cron.failure", metadata: { job: "prune-sessions", error: "session_prune_failed" } });
  }
  await watchSiblings("prune-sessions");
  if (failed) return jsonError(500, "cron_failed");
  return jsonOk({ revoked, vault });
}
