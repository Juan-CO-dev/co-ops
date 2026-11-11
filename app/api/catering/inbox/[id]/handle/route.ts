import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { handleCateringInbox, CateringInboxError } from "@/lib/catering/inbox";
import { assertSameOrigin } from "@/lib/portal/csrf";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/catering/inbox");
  if (ctx instanceof Response) return ctx;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  if (typeof b.expectedRevision !== "number" || typeof b.requestId !== "string" || b.assignedTo != null) return jsonError(400, "invalid_payload");
  try {
    return jsonOk({ result: await handleCateringInbox(ctx, (await params).id, { expectedRevision: b.expectedRevision, requestId: b.requestId }) });
  } catch (error) {
    if (error instanceof CateringInboxError) return jsonError(error.status, error.code);
    throw error;
  }
}
