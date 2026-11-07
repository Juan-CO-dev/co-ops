import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { InboundSettingsError } from "@/lib/admin/inbound-settings";
import { redriveInbound } from "@/lib/admin/ops-health";

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/inbound");
  if (ctx instanceof Response) return ctx;
  const step = assertStepUp(ctx, "A");
  if (!step.ok) return jsonError(403, step.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") return jsonError(400, "invalid_payload");
  try {
    await redriveInbound(ctx, body.id);
    return jsonOk({ saved: true });
  } catch (error) {
    if (error instanceof InboundSettingsError) return jsonError(error.status, error.code);
    throw error;
  }
}
