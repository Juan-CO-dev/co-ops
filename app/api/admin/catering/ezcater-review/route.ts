import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CateringPipelineError } from "@/lib/catering/pipeline";
import { decideEzcaterMapping } from "@/lib/admin/ezcater-review";

export async function POST(req: NextRequest) {
  const actor = await requireSession(req, "/api/admin/catering/ezcater-review");
  if (actor instanceof Response) return actor;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  if (typeof b.reviewId !== "string" || (b.decision !== "approve" && b.decision !== "ignore") ||
      (b.targetId !== null && typeof b.targetId !== "string")) return jsonError(400, "invalid_payload");
  try {
    return jsonOk({ ok: true, result: await decideEzcaterMapping(actor, b.reviewId, b.decision, b.targetId) });
  } catch (error) {
    if (!(error instanceof CateringPipelineError)) throw error;
    const response = jsonError(error.status, error.code);
    if (error.status === 503) response.headers.set("Retry-After", "60");
    return response;
  }
}
