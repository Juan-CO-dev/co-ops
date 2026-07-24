// POST pull one location+business-date of Toast sales into the ledger (GM+ >= 7, Tier A step-up).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { pullSales, AdminToastSalesError, TOAST_SALES_WRITE_MIN } from "@/lib/catering/toast-sales";
import { ToastApiError } from "@/lib/toast/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/toast-sales/pull");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < TOAST_SALES_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.businessDate !== "string") return jsonError(400, "invalid_payload", { field: "businessDate" });
  try {
    return jsonOk({ ...(await pullSales(ctx, b.locationId, b.businessDate)) });
  } catch (e) {
    if (e instanceof AdminToastSalesError) return jsonError(e.status, e.code, { message: e.message });
    if (e instanceof ToastApiError) return jsonError(502, e.code, { message: e.message });
    throw e;
  }
}
