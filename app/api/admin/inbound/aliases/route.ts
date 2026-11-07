import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { InboundSettingsError, saveInboundAlias } from "@/lib/admin/inbound-settings";

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/inbound");
  if (ctx instanceof Response) return ctx;
  const step = assertStepUp(ctx, "A");
  if (!step.ok) return jsonError(403, step.code);
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonError(400, "invalid_payload");
  const body = parsed as Record<string, unknown>;
  try {
    await saveInboundAlias(ctx, body);
    return jsonOk({ saved: true });
  } catch (error) {
    if (error instanceof InboundSettingsError) return jsonError(error.status, error.code);
    throw error;
  }
}
