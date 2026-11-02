import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, parseJsonBody } from "@/lib/api-helpers";
import { marketingRoleAllowed, marketingRpc, isBody, isId, validMarketingBody } from "@/lib/marketing/write";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/marketing/milestones");
  if (ctx instanceof Response) return ctx;
  if (!marketingRoleAllowed(ctx.user.role)) return jsonError(403, "role_not_allowed");
  if (process.env.MARKETING_SCORECARD !== "1") return jsonError(503, "marketing_unavailable");
  const step = assertStepUp(ctx, "B");
  if (!step.ok) return jsonError(403, step.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!isBody(body) || !validMarketingBody(body, false)) return jsonError(400, "entry_invalid");
  const { id } = await context.params;
  if (!isId(id)) return jsonError(400, "entry_invalid");
  return marketingRpc(ctx, "record_marketing_milestone", { p_kind: body.kind, p_date: body.date, p_corrects: id, p_reason: body.reason ?? null }, "marketing.milestone_correct", "marketing_milestones");
}
