// POST deactivate an ingest exclusion (GM+ >= 7, Tier A step-up). Append-only active-flag.
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { deactivateExclusion, AdminToastSalesError, TOAST_SALES_WRITE_MIN } from "@/lib/catering/toast-sales";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/toast-sales/exclusions/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < TOAST_SALES_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);
  if ((parsed as Record<string, unknown>).action !== "deactivate") return jsonError(400, "invalid_payload", { field: "action" });
  try {
    await deactivateExclusion(ctx, id);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminToastSalesError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
