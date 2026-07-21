import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { createLtoEvent, LtoError, LTO_MIN, type CreateLtoEventInput, type LtoEventItemInput } from "@/lib/catering/lto";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catering/lto/events");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < LTO_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string" || (b.kind !== "lto" && b.kind !== "discount") || typeof b.name !== "string" || typeof b.startsOn !== "string" || typeof b.endsOn !== "string") {
    return jsonError(400, "invalid_payload", { message: "locationId, kind, name, startsOn, endsOn required" });
  }
  if (!Array.isArray(b.items)) return jsonError(400, "invalid_payload", { message: "items[] required" });
  const items: LtoEventItemInput[] = (b.items as unknown[]).map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      itemId: typeof o.itemId === "string" ? o.itemId : null,
      menuItemId: typeof o.menuItemId === "string" ? o.menuItemId : null,
      nameSnapshot: typeof o.nameSnapshot === "string" ? o.nameSnapshot : "",
      qty: typeof o.qty === "number" ? o.qty : Number(o.qty),
      sourcePipelineId: typeof o.sourcePipelineId === "string" ? o.sourcePipelineId : null,
    };
  });
  const input: CreateLtoEventInput = {
    locationId: b.locationId,
    kind: b.kind,
    name: b.name,
    discountBps: typeof b.discountBps === "number" ? b.discountBps : null,
    promoPriceCents: typeof b.promoPriceCents === "number" ? b.promoPriceCents : null,
    startsOn: b.startsOn,
    endsOn: b.endsOn,
    note: typeof b.note === "string" ? b.note : null,
    items,
  };
  try {
    const { id } = await createLtoEvent(ctx, input);
    return jsonOk({ id });
  } catch (e) {
    if (e instanceof LtoError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
