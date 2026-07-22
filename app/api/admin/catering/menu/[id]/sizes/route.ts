// POST a new catering size to item [id] (GM+ >= 7, Tier A step-up).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { AdminCateringMenuError, MENU_ADMIN_MIN } from "@/lib/admin/catering/menu";
import { addItemSize } from "@/lib/admin/catering/item-sizes";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catering/menu/${id}/sizes`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MENU_ADMIN_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);
  const b = parsed as Record<string, unknown>;
  try {
    const size = await addItemSize(ctx, id, { label: b.label, priceCents: b.priceCents, serves: b.serves ?? null });
    return jsonOk({ size });
  } catch (e) {
    if (e instanceof AdminCateringMenuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
