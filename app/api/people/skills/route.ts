import type { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { canViewPeople, peopleActorFromAuth } from "@/lib/people/access-shared";
import { adjustSkill, PeopleSkillError, rateNewHire } from "@/lib/people/skills";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const FIELDS: Record<string, { required: readonly string[]; optional: readonly string[] }> = {
  adjust: { required: ["action", "locationId", "userId", "positionId", "delta", "reasonCode"], optional: ["reasonNote"] },
  rate: { required: ["action", "locationId", "userId", "positionId", "rating", "reasonCode"], optional: ["reasonNote"] },
};

/**
 * Scheduling Phase 1, Task 16: a manager's skill adjustment and the new-hire starting rating.
 * Outer layer here (the session, the people-view bind on the shop); every rule again in the lib
 * (lib/people/skills.ts: GM own shop / MoO+ any, strictly outranking the subject, the 0.05 step and the
 * reason), and again in the 0270 RPCs. No step-up (an operational manager act, the Dynamic Pars
 * precedent; plan J8). No email, no notification.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/people/skills");
  if (ctx instanceof Response) return ctx;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  const spec = typeof b.action === "string" ? FIELDS[b.action] : undefined;
  if (!spec || Object.keys(b).some((k) => !spec.required.includes(k) && !spec.optional.includes(k)) || spec.required.some((k) => !(k in b))) {
    return jsonError(400, "invalid_payload");
  }
  for (const k of ["locationId", "userId", "positionId", "reasonCode"]) if (typeof b[k] !== "string") return jsonError(400, "invalid_payload");
  if (b.reasonNote !== undefined && b.reasonNote !== null && typeof b.reasonNote !== "string") return jsonError(400, "invalid_payload");
  const actor = peopleActorFromAuth(ctx);
  const locationId = b.locationId as string;
  if (!canViewPeople(actor, locationId)) return jsonError(403, "forbidden");
  const common = {
    actor, locationId, userId: b.userId as string, positionId: b.positionId as string,
    reasonCode: b.reasonCode as string, reasonNote: (b.reasonNote as string | null | undefined) ?? null,
  };
  try {
    const service = getServiceRoleClient();
    if (b.action === "adjust") return jsonOk(await adjustSkill(service, { ...common, delta: b.delta }));
    return jsonOk(await rateNewHire(service, { ...common, rating: b.rating }));
  } catch (error) {
    if (error instanceof PeopleSkillError) return jsonError(error.status, error.code);
    return jsonError(500, "internal_error");
  }
}
