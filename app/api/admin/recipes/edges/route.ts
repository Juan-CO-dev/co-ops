import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { removeRecipeEdge, RecipeError, RECIPE_WRITE_MIN } from "@/lib/recipes";

export async function DELETE(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/recipes/edges");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (b.table !== "recipe_inputs" && b.table !== "recipe_outputs") {
    return jsonError(400, "invalid_table");
  }

  try {
    await removeRecipeEdge(ctx, {
      table: b.table as "recipe_inputs" | "recipe_outputs",
      id: b.id as string,
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
