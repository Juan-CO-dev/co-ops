import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { peopleActorFromAuth } from "@/lib/people/access-shared";
import { createCriterion, moveCriterion, PmCriteriaError, updateCriterion } from "@/lib/pm-criteria";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const FIELDS: Record<string, readonly string[]> = {
  create: ["action", "locationId", "positionId", "label", "labelEs"],
  update: ["action", "locationId", "criterionId", "label", "labelEs", "active"],
  move: ["action", "locationId", "criterionId", "direction"],
};

/**
 * Scheduling Phase 1, Task 22: the PM v2 criteria editor's writes. Tier E — the catalog's fixed 15-minute
 * edit window (R10): criteria shape how every manager grades. Rules in the lib, before any I/O: GM own shop,
 * MoO+ any; a usable position of THIS shop; labels en + es; deactivate, never delete. Audited. No email, no
 * notification.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/pm-criteria");
  if (ctx instanceof Response) return ctx;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  const allowed = typeof b.action === "string" ? FIELDS[b.action] : undefined;
  if (!allowed || Object.keys(b).some((k) => !allowed.includes(k))) return jsonError(400, "invalid_payload");
  const stepUp = assertStepUp(ctx, "E");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const actor = peopleActorFromAuth(ctx);
  const service = getServiceRoleClient();
  try {
    if (b.action === "create") {
      return jsonOk(await createCriterion(service, { actor, locationId: b.locationId, positionId: b.positionId ?? null, label: b.label, labelEs: b.labelEs ?? null }));
    }
    if (b.action === "update") {
      await updateCriterion(service, { actor, locationId: b.locationId, criterionId: b.criterionId, label: b.label, labelEs: b.labelEs, active: b.active });
      return jsonOk({});
    }
    await moveCriterion(service, { actor, locationId: b.locationId, criterionId: b.criterionId, direction: b.direction });
    return jsonOk({});
  } catch (error) {
    if (error instanceof PmCriteriaError) return jsonError(error.status, error.code);
    return jsonError(500, "internal_error");
  }
}
