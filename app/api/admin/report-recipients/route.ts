// POST /api/admin/report-recipients — create or update one override / external recipient row
// (0220). Level 9+ with a fresh Tier-B step-up; the location bind is inside the lib writer.
import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { RecipientError, saveReportRecipient } from "@/lib/report-recipients";
import { RECIPIENTS_MANAGE_MIN, validateRecipientInput } from "@/lib/report-recipients-shared";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/report-recipients");
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPIENTS_MANAGE_MIN) return jsonError(403, "role_insufficient");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const parsed = validateRecipientInput(body);
  if (!parsed.ok) return jsonError(400, parsed.code);
  try {
    return jsonOk(await saveReportRecipient(getServiceRoleClient(), {
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level, locations: ctx.locations },
      input: parsed.value, ipAddress: extractIp(req), userAgent: req.headers.get("user-agent"),
    }));
  } catch (error) {
    if (error instanceof RecipientError) return jsonError(error.status, error.code);
    console.error("[/api/admin/report-recipients POST]", error instanceof Error ? error.message : String(error));
    return jsonError(500, "internal_error");
  }
}
