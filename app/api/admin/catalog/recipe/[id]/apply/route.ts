/**
 * POST /api/admin/catalog/recipe/[id]/apply — save EXACTLY the previewed recipe act (catalog Phase 3b).
 * Body: { change: RecipeChangeRequest, previewToken: string }. Tier E (the 15-minute catalog edit window);
 * no one-shot grant (every act keeps every row). The lib recomputes the preview, refuses preview_stale on any
 * difference, then calls 3a's gated writer (which binds the shop and refuses the social media manager by role).
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { applyRecipeChange } from "@/lib/catalog/recipe-item";
import { parseRecipeChange } from "@/lib/catalog/recipe-item-shared";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/apply`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  const change = parseRecipeChange(b.change);
  if (!change.ok) return jsonError(400, change.code, { field: "change" });
  if (typeof b.previewToken !== "string" || b.previewToken.length === 0 || b.previewToken.length > 64) {
    return jsonError(400, "invalid_payload", { field: "previewToken" });
  }
  try {
    const r = await applyRecipeChange(ctx, id, change.change, b.previewToken);
    return jsonOk({ versionId: r.versionId }, 201);
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message, ...(e.line ? { line: e.line } : {}) });
    throw e;
  }
}
