import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updateRecipe, deactivateRecipe, RecipeError, RECIPE_WRITE_MIN } from "@/lib/recipes";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/recipes/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if ("name" in b) patch.name = b.name;
  if ("nameEs" in b) patch.nameEs = b.nameEs;
  if ("batchYield" in b) patch.batchYield = Number(b.batchYield);
  if ("directions" in b) patch.directions = b.directions;
  if ("directionsEs" in b) patch.directionsEs = b.directionsEs;

  try {
    await updateRecipe(ctx, id, patch);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/recipes/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  try {
    await deactivateRecipe(ctx, id);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
