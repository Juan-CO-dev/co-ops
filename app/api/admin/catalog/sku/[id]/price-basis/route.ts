/** POST /api/admin/catalog/sku/[id]/price-basis — { basis: "per_case" | … | null } (catalog Phase 2b). Tier E. */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CatalogItemError, setSkuPriceBasis } from "@/lib/catalog/sku-item";
import { PRICE_BASES, type PriceBasis } from "@/lib/catalog/sku-item-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/price-basis`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  const b = (parsed ?? {}) as Record<string, unknown>;
  const basis = b.basis === null
    ? null
    : typeof b.basis === "string" && (PRICE_BASES as readonly string[]).includes(b.basis) ? (b.basis as PriceBasis) : undefined;
  if (basis === undefined) return jsonError(400, "invalid_basis", { field: "basis" });
  try {
    await setSkuPriceBasis(ctx, id, basis);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof CatalogItemError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
