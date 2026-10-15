/**
 * POST /api/admin/catalog/sku/[id]/pack — save a pack chain version (catalog Phase 2a).
 * Body: { locationId: uuid | null, levels: [{ label, containsQty, containsIndex|null, containsMeasureUnit|null }],
 *         expectedLiveVersionId: uuid | null, basedOnVersionId?: uuid | null, note?: string | null }
 * locationId null = the global default (MoO+, or a GM's FIRST chain, decided under the SKU lock);
 * a shop = that shop's version (AGM/GM: their own shop; MoO+: any active shop). The lib
 * (lib/admin/sku-versions.ts) is the authority; this route is the outer layer: session, a level-6
 * floor, Tier E (the 15-minute edit window), an explicit field list.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { saveSkuPackVersion, SkuVersionError } from "@/lib/admin/sku-versions";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";
import type { PackChainLevelInput } from "@/lib/admin/pack-chain";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/pack`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const locationId = optUuid(b.locationId);
  if (locationId === undefined) return jsonError(400, "invalid_payload", { field: "locationId" });
  const expected = optUuid(b.expectedLiveVersionId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedLiveVersionId" });
  const basedOn = optUuid(b.basedOnVersionId);
  if (basedOn === undefined) return jsonError(400, "invalid_payload", { field: "basedOnVersionId" });
  if (b.note !== undefined && b.note !== null && (typeof b.note !== "string" || b.note.length > 500)) {
    return jsonError(400, "invalid_payload", { field: "note" });
  }
  if (!Array.isArray(b.levels) || b.levels.length > 8) return jsonError(400, "invalid_payload", { field: "levels" });
  const levels: PackChainLevelInput[] = [];
  for (const raw of b.levels) {
    if (typeof raw !== "object" || raw === null) return jsonError(400, "invalid_payload", { field: "levels" });
    const l = raw as Record<string, unknown>;
    if (typeof l.label !== "string" || l.label.length > 60) return jsonError(400, "invalid_payload", { field: "label" });
    if (typeof l.containsQty !== "number") return jsonError(400, "invalid_payload", { field: "containsQty" });
    const containsIndex = l.containsIndex === null || l.containsIndex === undefined ? null : l.containsIndex;
    if (containsIndex !== null && typeof containsIndex !== "number") return jsonError(400, "invalid_payload", { field: "containsIndex" });
    const unit = l.containsMeasureUnit === null || l.containsMeasureUnit === undefined ? null : l.containsMeasureUnit;
    if (unit !== null && typeof unit !== "string") return jsonError(400, "invalid_payload", { field: "containsMeasureUnit" });
    levels.push({ label: l.label, containsQty: l.containsQty, containsIndex: containsIndex as number | null, containsMeasureUnit: unit as string | null });
  }

  try {
    const r = await saveSkuPackVersion(ctx, {
      skuId: id, scope: locationId, levels, expectedLiveVersionId: expected,
      basedOnVersionId: basedOn, note: (b.note as string | null | undefined) ?? null,
    });
    return jsonOk({ versionId: r.versionId, retiredVersionId: r.retiredVersionId }, 201);
  } catch (e) {
    if (e instanceof SkuVersionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
