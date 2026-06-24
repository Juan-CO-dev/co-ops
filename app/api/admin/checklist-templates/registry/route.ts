import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addRegistryItem, AdminTemplateError, type AddRegistryItemInput } from "@/lib/admin/templates";
import { isPrepSectionName } from "@/lib/prep-sections";

// Add a NEW item to the GLOBAL registry (location_id NULL). When isDefault, it
// propagates an enabled line to every location. GM+ (≥7), Tier B.
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/checklist-templates/registry");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim()) return jsonError(400, "invalid_label", { field: "name" });
  if (typeof b.section !== "string" || !isPrepSectionName(b.section)) return jsonError(400, "invalid_section", { field: "section" });
  const input: AddRegistryItemInput = {
    name: b.name,
    nameEs: b.nameEs === null || typeof b.nameEs === "string" ? (b.nameEs as string | null) : null,
    section: b.section,
    recommendedPar: b.recommendedPar === null || typeof b.recommendedPar === "number" ? (b.recommendedPar as number | null) : null,
    recommendedParUnit: b.recommendedParUnit === null || typeof b.recommendedParUnit === "string" ? (b.recommendedParUnit as string | null) : null,
    isDefault: b.isDefault === true,
    specialInstruction: b.specialInstruction === null || typeof b.specialInstruction === "string" ? (b.specialInstruction as string | null) : null,
    specialInstructionEs: b.specialInstructionEs === null || typeof b.specialInstructionEs === "string" ? (b.specialInstructionEs as string | null) : null,
    required: b.required === true,
    minRoleLevel: typeof b.minRoleLevel === "number" ? b.minRoleLevel : undefined,
  };
  try {
    const result = await addRegistryItem(ctx, input);
    return jsonOk(result);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
