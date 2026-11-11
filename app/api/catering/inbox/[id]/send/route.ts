import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { CateringInboxError } from "@/lib/catering/inbox";
import { sendCateringInboxDraft } from "@/lib/catering/inbox-delivery";

/**
 * POST — the human "Send draft" (catering inbox phase 1b). Same-origin, then the session on the step-up SURFACE
 * `/api/catering/inbox/<id>/send` (lib/session.ts isCateringInboxSendPath keeps the unlock the preceding
 * POST /api/auth/step-up set), then Tier B (fresh password), then the library: fresh role / membership, the two OFF
 * switches, and 0298's claim — server-selected recipient, no editable body or address in this payload.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/inbox/${id}/send`);
  if (ctx instanceof Response) return ctx;
  const step = assertStepUp(ctx, "B");
  if (!step.ok) return jsonError(403, step.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  if (typeof b.expectedRevision !== "number" || typeof b.requestId !== "string" || Object.keys(b).some(key => key !== "expectedRevision" && key !== "requestId")) return jsonError(400, "invalid_payload");
  try {
    return jsonOk({ result: await sendCateringInboxDraft(ctx, id, { expectedRevision: b.expectedRevision, requestId: b.requestId }) });
  } catch (error) {
    if (error instanceof CateringInboxError) return jsonError(error.status, error.code);
    throw error;
  }
}
