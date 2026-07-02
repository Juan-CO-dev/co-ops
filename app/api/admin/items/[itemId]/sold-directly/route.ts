import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setItemSoldDirectly, RecipeError, RECIPE_WRITE_MIN } from "@/lib/recipes";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/items/${itemId}/sold-directly`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  try {
    await setItemSoldDirectly(ctx, {
      itemId,
      soldDirectly: b.soldDirectly === true,
      sellPortion: b.sellPortion == null ? null : Number(b.sellPortion),
      sellPortionUnit: b.sellPortionUnit != null ? (b.sellPortionUnit as string) : null,
      menuPrice: b.menuPrice === undefined ? undefined : (b.menuPrice == null ? null : Number(b.menuPrice)),
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
