import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { createMenuItem, RecipeError, RECIPE_WRITE_MIN } from "@/lib/recipes";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/menu-items");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  try {
    const { id } = await createMenuItem(ctx, {
      name: b.name as string,
      nameEs: b.nameEs != null ? (b.nameEs as string) : undefined,
      menuPrice: b.menuPrice == null ? null : Number(b.menuPrice),
    });
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
