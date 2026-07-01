import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addRecipeInput, RecipeError } from "@/lib/recipes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/recipes/${id}/inputs`);
  if (ctx instanceof Response) return ctx;

  const b = parsed as Record<string, unknown>;
  try {
    const result = await addRecipeInput(ctx, {
      recipeId: id,
      componentSkuId: b.componentSkuId != null ? (b.componentSkuId as string) : undefined,
      componentItemId: b.componentItemId != null ? (b.componentItemId as string) : undefined,
      quantity: Number(b.quantity),
      unit: b.unit != null ? (b.unit as string) : undefined,
      eachContainerLabel: b.eachContainerLabel != null ? (b.eachContainerLabel as string) : undefined,
      portioned: b.portioned != null ? (b.portioned as boolean) : undefined,
    });
    return jsonOk({ id: result.id }, 201);
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
