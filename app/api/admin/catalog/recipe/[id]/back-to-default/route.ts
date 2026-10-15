/**
 * POST /api/admin/catalog/recipe/[id]/back-to-default — a shop drops its own recipe version and the
 * global default answers for it again (catalog Phase 3a). Body: { locationId: uuid, versionId: uuid }.
 * The version row is retired (valid_to stamped), never deleted. Tier E; the lib binds the shop.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { retireShopRecipeVersion, RecipeVersionError } from "@/lib/admin/recipe-versions";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/back-to-default`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.versionId !== "string" || !UUID_RE.test(b.versionId)) return jsonError(400, "invalid_payload", { field: "versionId" });
  try {
    await retireShopRecipeVersion(ctx, { recipeId: id, versionId: b.versionId, locationId: b.locationId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message, ...(e.line ? { line: e.line } : {}) });
    throw e;
  }
}
