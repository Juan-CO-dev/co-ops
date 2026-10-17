import { assertSameOrigin } from "@/lib/portal/csrf";
import { ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { consumeStepUpGrant } from "@/lib/admin/step-up-grants";
import { isUuid } from "@/lib/admin/step-up-shared";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updateRecipe, deactivateRecipe, RecipeError, RECIPE_WRITE_MIN, RECIPE_DELETE_MIN } from "@/lib/recipes";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/recipes/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  // Catalog Phase 1: a header edit rides the 15-minute edit window.
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if ("name" in b) patch.name = b.name;
  if ("nameEs" in b) patch.nameEs = b.nameEs;
  if ("batchYield" in b) patch.batchYield = Number(b.batchYield);
  if ("directions" in b) patch.directions = b.directions;
  if ("directionsEs" in b) patch.directionsEs = b.directionsEs;
  // 0215 batch vs bottle: both validated in updateRecipe before any write.
  if ("shelfLifeDays" in b) patch.shelfLifeDays = Number(b.shelfLifeDays);
  if ("batchMode" in b) patch.batchMode = b.batchMode;

  try {
    await updateRecipe(ctx, id, patch);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof ShopOwnedError) return jsonError(e.status, e.code, e.line ? { line: e.line } : undefined);
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/recipes/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_DELETE_MIN) return jsonError(403, "forbidden");
  // Deleting a recipe is an always-prompt act: a ONE-SHOT grant for exactly this recipe (catalog Phase 1).
  if (!isUuid(id)) return jsonError(400, "invalid_id");
  const grant = await consumeStepUpGrant(ctx, "recipe.delete", id);
  if (!grant.ok) return jsonError(403, grant.code);

  try {
    await deactivateRecipe(ctx, id);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof ShopOwnedError) return jsonError(e.status, e.code, e.line ? { line: e.line } : undefined);
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
