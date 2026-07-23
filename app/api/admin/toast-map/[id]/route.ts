// POST confirm / reject / unmap one crosswalk row (GM+ >= 7, Tier A step-up).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { confirmMapping, rejectMapping, unmapConfirmed, AdminToastMapError, TOAST_MAP_MIN } from "@/lib/admin/toast-map";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/toast-map/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < TOAST_MAP_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const action = (parsed as Record<string, unknown>).action;
  if (action !== "confirm" && action !== "reject" && action !== "unmap") {
    return jsonError(400, "invalid_payload", { field: "action" });
  }
  try {
    if (action === "confirm") await confirmMapping(ctx, id);
    else if (action === "reject") await rejectMapping(ctx, id);
    else await unmapConfirmed(ctx, id);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminToastMapError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
