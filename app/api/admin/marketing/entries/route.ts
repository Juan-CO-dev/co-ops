import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, parseJsonBody } from "@/lib/api-helpers";
import { marketingRoleAllowed, marketingRpc, isBody, validMarketingBody, validateMarketingSpendWeek } from "@/lib/marketing/write";

export async function POST(req: NextRequest) {
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
  if (!isBody(body) || !validMarketingBody(body, true)) return jsonError(400, "entry_invalid");
  const weekError = await validateMarketingSpendWeek(body);
  if (weekError) return weekError;
  return marketingRpc(ctx, "record_marketing_manual_entry", { p_kind: body.kind, p_location_id: body.locationId ?? null, p_platform: body.platform ?? null, p_from: body.from, p_to: body.to, p_amount_cents: body.amountCents ?? null, p_list_count: body.listCount ?? null, p_note: body.note ?? null, p_corrects: null, p_reason: body.reason ?? null }, "marketing.manual_entry_record", "marketing_manual_entries");
}
