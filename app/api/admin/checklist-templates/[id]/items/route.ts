import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addPrepItem, AdminTemplateError, type AddPrepItemInput } from "@/lib/admin/templates";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  // Shape guard only; addPrepItem validates the slug against the active
  // prep_sections set and throws invalid_section (slug list is runtime now).
  if (typeof b.section !== "string") return jsonError(400, "invalid_section", { field: "section" });
  if (typeof b.label !== "string") return jsonError(400, "invalid_payload", { field: "label" });
  if (typeof b.minRoleLevel !== "number") return jsonError(400, "invalid_payload", { field: "minRoleLevel" });

  const input: AddPrepItemInput = {
    section: b.section,
    parValue: b.parValue === null || typeof b.parValue === "number" ? (b.parValue as number | null) : null,
    parUnit: typeof b.parUnit === "string" ? b.parUnit : null,
    label: b.label,
    labelEs: typeof b.labelEs === "string" ? b.labelEs : null,
    description: typeof b.description === "string" ? b.description : null,
    descriptionEs: typeof b.descriptionEs === "string" ? b.descriptionEs : null,
    specialInstruction: typeof b.specialInstruction === "string" ? b.specialInstruction : null,
    specialInstructionEs: typeof b.specialInstructionEs === "string" ? b.specialInstructionEs : null,
    minRoleLevel: b.minRoleLevel,
    required: b.required !== false,
    includeNote: b.includeNote === true,
    createOpeningMirror: b.createOpeningMirror !== false,
  };
  try {
    const result = await addPrepItem(ctx, { templateId: id, input });
    return jsonOk(result, 201);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
