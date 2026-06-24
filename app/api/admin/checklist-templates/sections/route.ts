import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addPrepSection, AdminTemplateError } from "@/lib/admin/templates";
import type { PrepSectionShape } from "@/lib/types";

const SHAPES: readonly PrepSectionShape[] = ["on_hand", "portioned", "line", "yes_no"];

// Add a prep section to the registry. Global — affects every location. MoO+
// (≥8), Tier B. The slug (system key) is derived from the EN label by the lib.
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/checklist-templates/sections");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.labelEn !== "string" || !b.labelEn.trim()) return jsonError(400, "invalid_label", { field: "labelEn" });
  const labelEs = b.labelEs === null || typeof b.labelEs === "string" ? (b.labelEs as string | null) : null;
  if (typeof b.shape !== "string" || !(SHAPES as readonly string[]).includes(b.shape)) {
    return jsonError(400, "invalid_shape", { field: "shape" });
  }
  const includeNote = b.includeNote === true;
  try {
    const { slug } = await addPrepSection(ctx, {
      labelEn: b.labelEn,
      labelEs,
      shape: b.shape as PrepSectionShape,
      includeNote,
    });
    return jsonOk({ slug });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
