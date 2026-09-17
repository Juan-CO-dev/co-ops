/**
 * /api/admin/vendors/[id]/order-guide — the vendor order guide's admin surface (V3-A §6).
 *
 * TWO FLOORS, ON PURPOSE. Reading is key-holder+ (4): the PO panel deep-links here so the
 * person actually keying the order can see the vendor's own sheet order. Writing is
 * ORDER_GUIDE_EDIT_MIN (GM, 7) — reordering the guide changes what every future PO looks
 * like, so it sits with pars and templates, not with "append a contact".
 *
 * NO STEP-UP HERE (unlike the sibling rhythm/cutoffs routes). A guide edit is not a
 * money/identity act; the spec asks for the level gate + same-origin + the `updated_at`
 * precondition and nothing more. `assertSameOrigin` runs FIRST on POST so a cross-site
 * request never touches the session or the database.
 *
 * The whole model travels in the body. The client reduces edits locally with the pure
 * `applyGuideEdit` and POSTs the result together with the `updatedAt` it loaded;
 * `saveOrderGuide` refuses a stale token with 409 `guide_stale`, which the panel turns
 * into "reloaded — redo your change".
 */
import { type NextRequest } from "next/server";

import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  createEmptyGuide,
  loadOrderGuide,
  ORDER_GUIDE_EDIT_MIN,
  OrderGuideError,
  saveOrderGuide,
  type GuideModel,
} from "@/lib/order-guides";

const READ_MIN = 4; // key holder — the PO panel deep-links here

// GET — the guide (or null) plus the vendor's active SKUs that no line already carries.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/order-guide`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < READ_MIN) return jsonError(403, "forbidden");

  const guide = await loadOrderGuide(id);
  const placed = new Set<string>();
  for (const s of guide?.sections ?? []) for (const l of s.lines) if (l.skuId) placed.add(l.skuId);

  const sb = getServiceRoleClient();
  const { data: skus, error } = await sb
    .from("vendor_items")
    .select("id, name, item_number")
    .eq("vendor_id", id)
    .eq("active", true)
    .order("name")
    .returns<Array<{ id: string; name: string; item_number: string | null }>>();
  if (error) return jsonError(500, "internal_error");

  return jsonOk({
    guide,
    skusNotOnGuide: (skus ?? [])
      .filter((s) => !placed.has(s.id))
      .map((s) => ({ skuId: s.id, name: s.name, itemNumber: s.item_number })),
  });
}

// POST — { create: true } to start a guide, else { model, expectedUpdatedAt } to save one.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/order-guide`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ORDER_GUIDE_EDIT_MIN) return jsonError(403, "forbidden");

  const b = (parsed ?? {}) as Record<string, unknown>;
  try {
    if (b.create === true) return jsonOk({ guide: await createEmptyGuide(ctx, id) }, 201);
    const model = b.model as GuideModel | undefined;
    if (!model || typeof model !== "object" || !Array.isArray(model.sections) || typeof b.expectedUpdatedAt !== "string") {
      return jsonError(400, "invalid_payload");
    }
    return jsonOk({ guide: await saveOrderGuide(ctx, id, model, b.expectedUpdatedAt) });
  } catch (e) {
    if (e instanceof OrderGuideError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
