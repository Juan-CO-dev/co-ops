/**
 * POST /api/admin/catalog/recipe/[id]/notices/dismiss — a GM's "Keep mine" / "Got it" (catalog Phase 3b).
 * Body: { locationId: uuid, kind: "source_changed" | "source_retired" | "new_default", seenVersionId: uuid }.
 * It changes no food, so no password (judgment call 10): same-origin FIRST, the GM floor, and the lib binds
 * the shop and refuses the social media manager by role (dismissRecipeNotice).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { dismissRecipeNotice, RECIPE_NOTICE_DISMISS_KINDS, RecipeVersionError, type RecipeNoticeDismissKind } from "@/lib/admin/recipe-versions";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/notices/dismiss`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.kind !== "string" || !(RECIPE_NOTICE_DISMISS_KINDS as readonly string[]).includes(b.kind)) return jsonError(400, "invalid_payload", { field: "kind" });
  if (typeof b.seenVersionId !== "string" || !UUID_RE.test(b.seenVersionId)) return jsonError(400, "invalid_payload", { field: "seenVersionId" });
  try {
    await dismissRecipeNotice(ctx, { locationId: b.locationId, recipeId: id, kind: b.kind as RecipeNoticeDismissKind, seenVersionId: b.seenVersionId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
