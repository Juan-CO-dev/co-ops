/**
 * PATCH /api/admin/recipes/[id]/inputs/[inputId] — edit ONE recipe line in place (catalog
 * redesign Phase 1, 2026-10-15). Body: { line, expected } — the WHOLE new line and the line the
 * client saw (raw). GM+ (RECIPE_WRITE_MIN) and the Tier E edit window; the lib re-checks the
 * level and every line rule and writes only if the row still equals `expected`
 * (lib/recipes.ts updateRecipeInput). 200 { ok, changed } · 409 line_changed · 404 edge_not_found.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updateRecipeInput, RecipeError, RECIPE_WRITE_MIN } from "@/lib/recipes";
import { parseRecipeLineEdit } from "@/lib/recipe-line-shared";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; inputId: string }> },
) {
  const { id, inputId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/recipes/${id}/inputs/${inputId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const edit = parseRecipeLineEdit(parsed);
  if (!edit.ok) return jsonError(400, edit.code);

  try {
    const result = await updateRecipeInput(ctx, { recipeId: id, inputId, line: edit.line, expected: edit.expected });
    return jsonOk({ ok: true, changed: result.changed });
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
