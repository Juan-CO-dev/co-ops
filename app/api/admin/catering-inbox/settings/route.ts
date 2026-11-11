import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { CateringInboxError, canChangeCateringInboxMode } from "@/lib/catering/inbox";
import { INBOX_MODES, type InboxMode } from "@/lib/catering/inbox-delivery-shared";
import { setCateringInboxMode } from "@/lib/catering/inbox-settings";

/** POST — the catering inbox delivery mode (off | shadow | live). Owner / CGS, Tier B, same-origin; 0298 re-checks the role. */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/catering-inbox/settings");
  if (ctx instanceof Response) return ctx;
  if (!canChangeCateringInboxMode(ctx.user.role)) return jsonError(403, "forbidden");
  const step = assertStepUp(ctx, "B");
  if (!step.ok) return jsonError(403, step.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  if (typeof b.mode !== "string" || !(INBOX_MODES as readonly string[]).includes(b.mode) || typeof b.expectedRevision !== "number") return jsonError(400, "invalid_payload");
  try {
    return jsonOk({ settings: await setCateringInboxMode(ctx, { mode: b.mode as InboxMode, expectedRevision: b.expectedRevision }) });
  } catch (error) {
    if (error instanceof CateringInboxError) return jsonError(error.status, error.code);
    throw error;
  }
}
