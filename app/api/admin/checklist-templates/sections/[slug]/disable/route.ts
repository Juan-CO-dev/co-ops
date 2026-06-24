import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { disablePrepSection, AdminTemplateError } from "@/lib/admin/templates";

// Disable a prep section — cascades its active prep lines to Misc, then flips
// the section inactive (append-only). Global. MoO+ (≥8), Tier B. Misc cannot be
// disabled (the cascade sink — the lib rejects it).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/sections/${slug}/disable`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  try {
    const { movedCount } = await disablePrepSection(ctx, { slug });
    return jsonOk({ movedCount });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
