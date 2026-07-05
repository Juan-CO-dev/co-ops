import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { createRecipeFull, RecipeError, RECIPE_WRITE_MIN, type RecipeType } from "@/lib/recipes";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/recipes/full");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  try {
    const draft = {
      name: b.name as string,
      nameEs: b.nameEs != null ? (b.nameEs as string) : undefined,
      recipeType: b.recipeType as RecipeType,
      batchYield: Number(b.batchYield),
      directions: b.directions != null ? (b.directions as string) : undefined,
      directionsEs: b.directionsEs != null ? (b.directionsEs as string) : undefined,
      inputs: Array.isArray(b.inputs) ? (b.inputs as Array<Record<string, unknown>>).map((i) => ({
        componentSkuId: i.componentSkuId != null ? (i.componentSkuId as string) : null,
        componentItemId: i.componentItemId != null ? (i.componentItemId as string) : null,
        quantity: Number(i.quantity),
        unit: i.unit != null ? (i.unit as string) : null,
        eachContainerLabel: i.eachContainerLabel != null ? (i.eachContainerLabel as string) : null,
        portioned: i.portioned === true,
      })) : [],
      outputs: Array.isArray(b.outputs) ? (b.outputs as Array<Record<string, unknown>>).map((o) => ({
        outputItemId: o.outputItemId != null ? (o.outputItemId as string) : null,
        outputMenuItemId: o.outputMenuItemId != null ? (o.outputMenuItemId as string) : null,
        yield: Number(o.yield),
        outputContainerLabel: o.outputContainerLabel != null ? (o.outputContainerLabel as string) : null,
      })) : [],
    };
    const { id } = await createRecipeFull(ctx, draft);
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
