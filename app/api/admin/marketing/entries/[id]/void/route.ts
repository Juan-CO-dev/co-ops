import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, parseJsonBody } from "@/lib/api-helpers";
import { marketingRoleAllowed, marketingRpc, isBody, isId } from "@/lib/marketing/write";

/**
 * Remove a spend entry (W26-2 b, migration 0333). An append-only correction row marked voided —
 * nothing is deleted. Tier A like the correction it is; spend kinds only (the SQL refuses the rest).
 * Answers 503 marketing_unavailable until 0333 is applied (the function is missing).
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/marketing/entries");
  if (ctx instanceof Response) return ctx;
  if (!marketingRoleAllowed(ctx.user.role)) return jsonError(403, "role_not_allowed");
  if (process.env.MARKETING_SCORECARD !== "1") return jsonError(503, "marketing_unavailable");
  const step = assertStepUp(ctx, "A");
  if (!step.ok) return jsonError(403, step.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!isBody(body) || (body.reason != null && (typeof body.reason !== "string" || body.reason.length > 300))) return jsonError(400, "entry_invalid");
  const { id } = await context.params;
  if (!isId(id)) return jsonError(400, "entry_invalid");
  return marketingRpc(ctx, "void_marketing_manual_entry", { p_entry: id, p_reason: body.reason ?? null }, "marketing.manual_entry_void", "marketing_manual_entries");
}
