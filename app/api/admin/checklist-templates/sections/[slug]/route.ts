import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setSectionLabel, AdminTemplateError } from "@/lib/admin/templates";

// Rename a prep section's display label (+ optional reorder). Global — affects
// every location. MoO+ (≥8), Tier B. The slug (system key) is never touched.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/sections/${slug}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.labelEn !== "string" || !b.labelEn.trim()) return jsonError(400, "invalid_label", { field: "labelEn" });
  const labelEs = b.labelEs === null || typeof b.labelEs === "string" ? (b.labelEs as string | null) : null;
  const displayOrder = typeof b.displayOrder === "number" ? b.displayOrder : undefined;
  try {
    await setSectionLabel(ctx, { slug, labelEn: b.labelEn, labelEs, displayOrder });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
