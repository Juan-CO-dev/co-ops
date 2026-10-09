import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CateringPipelineError } from "@/lib/catering/pipeline";
import { decideEzcaterCustomization, decideEzcaterMapping, decideEzcaterMappingDirect, dismissEzcaterToastReview } from "@/lib/admin/ezcater-review";
import { parseCustomizationDecision } from "@/lib/ezcater/customization-validation-shared";

export async function POST(req: NextRequest) {
  const actor = await requireSession(req, "/api/admin/catering/ezcater-review");
  if (actor instanceof Response) return actor;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  if (typeof b.reviewId !== "string") return jsonError(400, "invalid_payload");
  try {
    let result: unknown;
    if (b.kind === "customization") {
      const decision = parseCustomizationDecision(b);
      if (!decision) return jsonError(400, "invalid_payload");
      result = await decideEzcaterCustomization(actor, b.reviewId, decision.decision, decision.effects, decision.pickMenuItemId);
    } else if (b.decision === "approve_direct") {
      if ((b.entityKind !== "menu_item" && b.entityKind !== "item" && b.entityKind !== "package") ||
          typeof b.entityId !== "string") return jsonError(400, "invalid_payload");
      result = await decideEzcaterMappingDirect(actor, b.reviewId, b.entityKind, b.entityId);
    } else if (b.decision === "dismiss") {
      if ((b.reason !== "not_ezcater" && b.reason !== "duplicate" && b.reason !== "test" && b.reason !== "other") ||
          (b.note !== null && typeof b.note !== "string")) return jsonError(400, "invalid_payload");
      result = await dismissEzcaterToastReview(actor, b.reviewId, b.reason, b.note);
    } else {
      if ((b.decision !== "approve" && b.decision !== "ignore") ||
          (b.targetId !== null && typeof b.targetId !== "string")) return jsonError(400, "invalid_payload");
      result = await decideEzcaterMapping(actor, b.reviewId, b.decision, b.targetId);
    }
    return jsonOk({ ok: true, result });
  } catch (error) {
    if (!(error instanceof CateringPipelineError)) throw error;
    const response = jsonError(error.status, error.code);
    if (error.status === 503) response.headers.set("Retry-After", "60");
    return response;
  }
}
