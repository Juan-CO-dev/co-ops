/**
 * POST /api/admin/catalog/recipe/[id]/restore — Restore from History (catalog Phase 3a).
 * Body: { locationId: uuid | null, fromVersionId: uuid, expectedVersionId: uuid | null, basedOnVersionId: uuid | null }.
 * Restore makes a NEW version holding the old version's lines (copied in SQL) — never a delete, never a revive.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { restoreRecipeVersion, RecipeVersionError } from "@/lib/admin/recipe-versions";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/restore`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const locationId = optUuid(b.locationId);
  if (locationId === undefined) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.fromVersionId !== "string" || !UUID_RE.test(b.fromVersionId)) return jsonError(400, "invalid_payload", { field: "fromVersionId" });
  const expected = optUuid(b.expectedVersionId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedVersionId" });
  const basedOn = optUuid(b.basedOnVersionId);
  if (basedOn === undefined) return jsonError(400, "invalid_payload", { field: "basedOnVersionId" });

  try {
    const r = await restoreRecipeVersion(ctx, { recipeId: id, scope: locationId, fromVersionId: b.fromVersionId, expectedVersionId: expected, basedOnVersionId: basedOn });
    return jsonOk({ versionId: r.versionId, retiredVersionId: r.retiredVersionId }, 201);
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message, ...(e.line ? { line: e.line } : {}) });
    throw e;
  }
}
