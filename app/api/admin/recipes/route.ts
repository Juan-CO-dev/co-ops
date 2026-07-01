import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { createRecipe, RecipeError } from "@/lib/recipes";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/recipes");
  if (ctx instanceof Response) return ctx;

  const b = parsed as Record<string, unknown>;
  try {
    const { id } = await createRecipe(ctx, {
      name: b.name as string,
      nameEs: b.nameEs != null ? (b.nameEs as string) : undefined,
      recipeType: b.recipeType as import("@/lib/recipes").RecipeType,
      batchYield: Number(b.batchYield),
      directions: b.directions != null ? (b.directions as string) : undefined,
      directionsEs: b.directionsEs != null ? (b.directionsEs as string) : undefined,
    });
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
