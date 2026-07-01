import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addRecipeOutput, RecipeError } from "@/lib/recipes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/recipes/${id}/outputs`);
  if (ctx instanceof Response) return ctx;

  const b = parsed as Record<string, unknown>;
  try {
    const result = await addRecipeOutput(ctx, {
      recipeId: id,
      outputItemId: b.outputItemId != null ? (b.outputItemId as string) : undefined,
      outputMenuItemId: b.outputMenuItemId != null ? (b.outputMenuItemId as string) : undefined,
      yield: Number(b.yield),
      outputContainerLabel: b.outputContainerLabel != null ? (b.outputContainerLabel as string) : undefined,
    });
    return jsonOk({ id: result.id }, 201);
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
