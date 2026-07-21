import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { cancelLtoEvent, LtoError, LTO_MIN } from "@/lib/catering/lto";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/catering/lto/events/${id}/cancel`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < LTO_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);
  try {
    await cancelLtoEvent(ctx, id);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof LtoError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
