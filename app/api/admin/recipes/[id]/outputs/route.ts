import { ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addRecipeOutput, updateRecipeOutputYield, RecipeError, RECIPE_WRITE_MIN } from "@/lib/recipes";
import { assertSameOrigin } from "@/lib/portal/csrf";

/** Direct edit of the sole owned batch output; never remove/re-add that required output. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  if (!uuid(id)) return jsonError(404, "not_found");
  const ctx = await requireSession(req, `/api/admin/recipes/${id}/outputs`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonError(400, "invalid_payload");
  const b = parsed as Record<string, unknown>;
  if (!uuid(b.expectedOwner) || !uuid(b.outputItemId) || typeof b.yield !== "number") return jsonError(400, "invalid_payload");
  try {
    return jsonOk(await updateRecipeOutputYield(ctx, { recipeId: id, outputItemId: b.outputItemId, yield: b.yield,
      context: { source: "recipe_builder", expectedOwner: b.expectedOwner } }));
  } catch (e) {
    if (e instanceof ShopOwnedError || e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/recipes/${id}/outputs`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

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
    if (e instanceof ShopOwnedError) return jsonError(e.status, e.code, e.line ? { line: e.line } : undefined);
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
