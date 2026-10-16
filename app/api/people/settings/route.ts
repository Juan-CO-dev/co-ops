import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { peopleActorFromAuth } from "@/lib/people/access-shared";
import { savePeopleShopSettings } from "@/lib/people/settings";
import { PeopleSkillError } from "@/lib/people/skills";
import { saveSkillTunables } from "@/lib/people/tunables";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const FIELDS: Record<string, readonly string[]> = {
  shop: ["action", "locationId", "pmV2", "prepPositionId"],
  tunables: ["action", "locationId", "tunables"],
};

/**
 * Scheduling Phase 1, Task 16: the people settings writes. Both take the Tier E edit window (the catalog's
 * 15-minute password window): the skill tunables shape how EVERY shop's people are read (R11, J8), and the
 * shop settings decide where a shop's prep evidence counts. Rules in the lib, before any I/O: tunables MoO+
 * only (`locationId` null = the company set), shop settings GM own shop / MoO+ any; the per-shop PM v2 switch
 * (Task 23) turns ON only when the shop's data is ready (`pm_v2_not_ready`). Refusals by name; `invalid_tunables` names the
 * key. No email, no notification.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/people/settings");
  if (ctx instanceof Response) return ctx;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  const allowed = typeof b.action === "string" ? FIELDS[b.action] : undefined;
  if (!allowed || Object.keys(b).some((k) => !allowed.includes(k)) || allowed.some((k) => !(k in b))) return jsonError(400, "invalid_payload");
  if (b.locationId !== null && typeof b.locationId !== "string") return jsonError(400, "invalid_payload");
  const stepUp = assertStepUp(ctx, "E");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const actor = peopleActorFromAuth(ctx);
  try {
    const service = getServiceRoleClient();
    if (b.action === "tunables") {
      return jsonOk(await saveSkillTunables(service, { actor, locationId: b.locationId as string | null, tunables: b.tunables }));
    }
    if (typeof b.locationId !== "string") return jsonError(400, "invalid_payload");
    return jsonOk({ settings: await savePeopleShopSettings(service, { actor, locationId: b.locationId, pmV2: b.pmV2, prepPositionId: b.prepPositionId }) });
  } catch (error) {
    if (error instanceof PeopleSkillError) return jsonError(error.status, error.code, error.key ? { key: error.key } : {});
    return jsonError(500, "internal_error");
  }
}
