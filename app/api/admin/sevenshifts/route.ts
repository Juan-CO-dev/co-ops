import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { peopleActorFromAuth } from "@/lib/people/access-shared";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { linkShop, linkUser, SevenShiftsLinkError, unlinkShop, unlinkUser } from "@/lib/sevenshifts/links";
import { requestSyncNow, SyncNowError } from "@/lib/sevenshifts/sync-now";

/** Sync now runs one 7shifts read inside this budget (lib/sevenshifts/sync-now.ts). */
export const runtime = "nodejs";
export const maxDuration = 120;

const ACTIONS: Record<string, readonly string[]> = {
  link_shop: ["action", "locationId", "remoteLocationId"],
  unlink_shop: ["action", "linkId"],
  link_user: ["action", "locationId", "remoteUserId", "userId"],
  unlink_user: ["action", "locationId", "linkId"],
  sync_now: ["action"],
};

/**
 * Scheduling Phase 1, Task 10: /admin/sevenshifts writes. Shop links MoO+, person links GM own shop / MoO+
 * any, Sync now MoO+ — every rule decided in the lib (lib/people/access-shared.ts) before any I/O, and
 * again by the 0269 RPCs. Link acts take Tier B (the /admin/toast-employees precedent); Sync now takes no
 * step-up (it changes no config, and the lease bounds it). Dormant without the token or the switch (409).
 * No email, no notification.
 */
export async function POST(req: NextRequest) {
  // Sync now's ONE absolute deadline starts here, before the session check (chunk C review, Astra P2).
  const routeStartedAt = Date.now();
  const ctx = await requireSession(req, "/api/admin/sevenshifts");
  if (ctx instanceof Response) return ctx;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  const allowed = typeof b.action === "string" ? ACTIONS[b.action] : undefined;
  if (!allowed || Object.keys(b).some((k) => !allowed.includes(k)) || allowed.some((k) => typeof b[k] !== "string")) {
    return jsonError(400, "invalid_payload");
  }
  const s = (k: string) => b[k] as string;
  const actor = peopleActorFromAuth(ctx);
  try {
    if (b.action === "sync_now") return jsonOk({ ...(await requestSyncNow(actor, { routeStartedAt })) });
    const stepUp = assertStepUp(ctx, "B");
    if (!stepUp.ok) return jsonError(403, stepUp.code);
    const service = getServiceRoleClient();
    if (b.action === "link_shop") return jsonOk(await linkShop(service, { actor, locationId: s("locationId"), remoteLocationId: s("remoteLocationId") }));
    if (b.action === "unlink_shop") return jsonOk(await unlinkShop(service, { actor, linkId: s("linkId") }));
    if (b.action === "link_user") return jsonOk(await linkUser(service, { actor, locationId: s("locationId"), remoteUserId: s("remoteUserId"), userId: s("userId") }));
    return jsonOk(await unlinkUser(service, { actor, locationId: s("locationId"), linkId: s("linkId") }));
  } catch (error) {
    if (error instanceof SevenShiftsLinkError || error instanceof SyncNowError) return jsonError(error.status, error.code);
    return jsonError(500, "internal_error");
  }
}
