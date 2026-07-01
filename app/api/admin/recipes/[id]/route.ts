import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updateRecipe, deactivateRecipe, RecipeError } from "@/lib/recipes";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/recipes/${id}`);
  if (ctx instanceof Response) return ctx;

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

  try {
    await deactivateRecipe(ctx, id);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
