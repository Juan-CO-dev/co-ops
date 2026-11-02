import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, parseJsonBody } from "@/lib/api-helpers";
import { marketingRoleAllowed, marketingRpc, isBody, isId, marketingWriteError } from "@/lib/marketing/write";
import { buildMarketingBaseline } from "@/lib/marketing/scorecard";

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/marketing/baseline-snapshot");
  if (ctx instanceof Response) return ctx;
  if (!marketingRoleAllowed(ctx.user.role)) return jsonError(403, "role_not_allowed");
  if (process.env.MARKETING_SCORECARD !== "1") return jsonError(503, "marketing_unavailable");
  const step = assertStepUp(ctx, "B");
  if (!step.ok) return jsonError(403, step.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!isBody(body) || (body.correctsId != null && !isId(body.correctsId)) || (body.reason != null && (typeof body.reason !== "string" || body.reason.length > 300))) return jsonError(400, "entry_invalid");
  let baseline;
  try {
    baseline = await buildMarketingBaseline(ctx);
  } catch (error) {
    if (error instanceof Error && error.message === "no_first_ad_spend") return jsonError(409, "no_first_ad_spend");
    return marketingWriteError(error && typeof error === "object" ? error : {});
  }
  if (!baseline) return jsonError(503, "marketing_unavailable");
  return marketingRpc(ctx, "record_marketing_baseline_snapshot", {
    p_milestone_id: baseline.milestoneId, p_from: baseline.from, p_to: baseline.to, p_kpi_version: baseline.kpiVersion,
    p_payload: baseline.payload, p_coverage: baseline.coverage, p_corrects: body.correctsId ?? null, p_reason: body.reason ?? null,
  }, "marketing.baseline_snapshot", "marketing_baseline_snapshots");
}
