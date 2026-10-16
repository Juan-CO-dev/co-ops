/**
 * POST /api/admin/catalog/recipe/[id]/preview — "What this changes" for ONE recipe act (catalog Phase
 * 3b). Body: { change: RecipeChangeRequest }. A read: no step-up. Offered to who may save the act's
 * target — the lib (computeRecipePreview) is the authority: role rule, shop bind, GM vs everyone — so a
 * preview never shows a choice the save would refuse. This route is the outer layer (session, GM floor).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { computeRecipePreview } from "@/lib/catalog/recipe-item";
import { parseRecipeChange } from "@/lib/catalog/recipe-item-shared";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/preview`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const change = parseRecipeChange((parsed as Record<string, unknown> | null)?.change);
  if (!change.ok) return jsonError(400, change.code, { field: "change" });
  try {
    return jsonOk({ preview: await computeRecipePreview(ctx, id, change.change) });
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message, ...(e.line ? { line: e.line } : {}) });
    throw e;
  }
}
