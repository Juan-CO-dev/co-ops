import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updateRegistryItemDefinition, AdminTemplateError } from "@/lib/admin/templates";

// Edit a registry item's GLOBAL definition (name / name_es / recommended par) by
// item id — the Global tab. Affects every location. MoO+ (≥8), Tier B.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/registry/${itemId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const patch: { name?: string; nameEs?: string | null; recommendedPar?: number | null; recommendedParUnit?: string | null } = {};
  if (typeof b.name === "string") patch.name = b.name;
  if (b.nameEs === null || typeof b.nameEs === "string") patch.nameEs = b.nameEs as string | null;
  if (b.recommendedPar === null || typeof b.recommendedPar === "number") patch.recommendedPar = b.recommendedPar as number | null;
  if (b.recommendedParUnit === null || typeof b.recommendedParUnit === "string") patch.recommendedParUnit = b.recommendedParUnit as string | null;

  if (Object.keys(patch).length === 0) return jsonError(400, "invalid_payload", { message: "no editable fields" });
  try {
    await updateRegistryItemDefinition(ctx, { itemId, ...patch });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
