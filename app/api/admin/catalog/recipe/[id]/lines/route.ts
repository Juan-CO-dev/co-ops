/**
 * POST /api/admin/catalog/recipe/[id]/lines — ONE recipe-line edit (catalog Phase 3a).
 * Body: { locationId: uuid | null, expectedVersionId: uuid | null, basedOnVersionId: uuid | null,
 *         op: { kind: "add", line } | { kind: "update", lineId, line, expected } | { kind: "remove", lineId, expected } }
 * locationId null = the global default (MoO+); a shop = that shop's version (GM: its own shops; MoO+: any).
 * The lib (lib/admin/recipe-versions.ts) is the authority; this route is the outer layer: session, a
 * level-7 floor, Tier E (the 15-minute edit window), an explicit field list.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { saveRecipeLines, RecipeVersionError } from "@/lib/admin/recipe-versions";
import { parseRecipeLineOp, RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/recipe/${id}/lines`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < RECIPE_SHOP_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const locationId = optUuid(b.locationId);
  if (locationId === undefined) return jsonError(400, "invalid_payload", { field: "locationId" });
  const expected = optUuid(b.expectedVersionId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedVersionId" });
  const basedOn = optUuid(b.basedOnVersionId);
  if (basedOn === undefined) return jsonError(400, "invalid_payload", { field: "basedOnVersionId" });
  const op = parseRecipeLineOp(b.op);
  if (!op.ok) return jsonError(400, op.code, { field: "op" });

  try {
    const r = await saveRecipeLines(ctx, { recipeId: id, scope: locationId, expectedVersionId: expected, basedOnVersionId: basedOn, op: op.op });
    return jsonOk({ versionId: r.versionId, retiredVersionId: r.retiredVersionId, changed: r.changed }, r.changed ? 201 : 200);
  } catch (e) {
    if (e instanceof RecipeVersionError) return jsonError(e.status, e.code, { message: e.message, ...(e.line ? { line: e.line } : {}) });
    throw e;
  }
}
