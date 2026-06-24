import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setPrepSectionShape, AdminTemplateError } from "@/lib/admin/templates";
import type { PrepSectionShape } from "@/lib/types";

const SHAPES: readonly PrepSectionShape[] = ["on_hand", "portioned", "line", "yes_no"];

// Change a prep section's input type (shape) — re-derives columns on every line
// in the section. Global. MoO+ (≥8), Tier B.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/sections/${slug}/shape`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.shape !== "string" || !(SHAPES as readonly string[]).includes(b.shape)) {
    return jsonError(400, "invalid_shape", { field: "shape" });
  }
  const includeNote = b.includeNote === true;
  try {
    const { reshapedCount } = await setPrepSectionShape(ctx, {
      slug,
      shape: b.shape as PrepSectionShape,
      includeNote,
    });
    return jsonOk({ reshapedCount });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
