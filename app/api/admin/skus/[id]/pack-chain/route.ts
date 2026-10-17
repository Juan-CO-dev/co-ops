import { assertSameOrigin } from "@/lib/portal/csrf";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadSkuPackChain,
  replaceSkuPackChain,
  PackChainError,
  PACK_CHAIN_READ_MIN,
  PACK_CHAIN_WRITE_MIN,
  type PackChainLevelInput,
} from "@/lib/admin/pack-chain";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET — the SKU's active pack chain + an "unverified" flag (AGM+ ≥6, no step-up
// for a read, mirroring the SKU catalog read).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/skus/${id}/pack-chain`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PACK_CHAIN_READ_MIN) return jsonError(403, "forbidden");
  try {
    const view = await loadSkuPackChain(ctx, id);
    return jsonOk({ skuId: view.skuId, levels: view.levels, unverified: view.unverified });
  } catch (e) {
    if (e instanceof PackChainError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

// POST — replace the whole chain (supersede-as-a-SET). GM+ (≥7), Tier E (mirrors
// SKU edit). Body: { levels: [{ label, containsQty, containsIndex|null,
// containsMeasureUnit|null }, ...] } — exactly one of containsIndex / containsMeasureUnit.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/skus/${id}/pack-chain`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PACK_CHAIN_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (!Array.isArray(b.levels)) return jsonError(400, "invalid_payload", { field: "levels" });
  // CATALOG PHASE 2a (chunk-4 review P3c): the GLOBAL live version the form was LOADED with. A form
  // that does not say what it saw cannot be checked for a concurrent save, so it is told to reload.
  if (!("expectedLiveVersionId" in b)) return jsonError(409, "version_changed");
  const expectedLiveVersionId = b.expectedLiveVersionId;
  if (expectedLiveVersionId !== null && (typeof expectedLiveVersionId !== "string" || !UUID_RE.test(expectedLiveVersionId))) {
    return jsonError(400, "invalid_payload", { field: "expectedLiveVersionId" });
  }

  const levels: PackChainLevelInput[] = [];
  for (const raw of b.levels) {
    if (typeof raw !== "object" || raw === null) return jsonError(400, "invalid_payload", { field: "levels" });
    const l = raw as Record<string, unknown>;
    if (typeof l.label !== "string") return jsonError(400, "invalid_payload", { field: "label" });
    if (typeof l.containsQty !== "number") return jsonError(400, "invalid_payload", { field: "containsQty" });
    const containsIndex = l.containsIndex === null || l.containsIndex === undefined ? null : l.containsIndex;
    if (containsIndex !== null && typeof containsIndex !== "number") {
      return jsonError(400, "invalid_payload", { field: "containsIndex" });
    }
    const containsMeasureUnit =
      l.containsMeasureUnit === null || l.containsMeasureUnit === undefined ? null : l.containsMeasureUnit;
    if (containsMeasureUnit !== null && typeof containsMeasureUnit !== "string") {
      return jsonError(400, "invalid_payload", { field: "containsMeasureUnit" });
    }
    levels.push({
      label: l.label,
      containsQty: l.containsQty,
      containsIndex: containsIndex as number | null,
      containsMeasureUnit: containsMeasureUnit as string | null,
    });
  }

  try {
    const res = await replaceSkuPackChain(ctx, { skuId: id, levels, expectedLiveVersionId });
    return jsonOk({ ok: true, levelCount: res.levelCount });
  } catch (e) {
    if (e instanceof PackChainError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
