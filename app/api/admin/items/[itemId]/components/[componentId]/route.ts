import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { removeItemComponent, AdminItemComponentError } from "@/lib/admin/item-components";

// DELETE — remove a BOM component edge from an item. GM+ (≥7), Tier A.
// (itemId is in the path for routing/clarity; the component id is the key.)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string; componentId: string }> },
) {
  const { itemId, componentId } = await params;
  const ctx = await requireSession(req, `/api/admin/items/${itemId}/components/${componentId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  try {
    await removeItemComponent(ctx, { id: componentId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminItemComponentError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
