import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { canManagePayrollShops, parsePayrollShopSave } from "@/lib/facts/labor-payroll-shared";
import { PayrollShopError, savePayrollShop } from "@/lib/facts/labor-payroll";

export const runtime = "nodejs";

/**
 * Item 2: set a 7shifts account's PAYROLL shop (0340 save_labor_payroll_shop). Same-origin first, then the
 * session, the trusted role (owner / CGS / MoO), Tier B (always prompted: it re-allocates salaried labor cost, and a
 * backdated row re-prices history), then the RPC, which re-checks the role on the locked users row and writes its
 * own audit row. The path is under /api/admin, so this route's own requireSession KEEPS the Tier B unlock the
 * preceding POST /api/auth/step-up set (Astra r2 P2 #2; tests/labor-payroll-shop-route.test.ts). No email.
 */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/labor/payroll-shop");
  if (ctx instanceof Response) return ctx;
  if (!canManagePayrollShops(ctx.role)) return jsonError(403, "forbidden");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const input = parsePayrollShopSave(body);
  if (!input) return jsonError(400, "invalid");
  try {
    return jsonOk(await savePayrollShop(getServiceRoleClient(), { userId: ctx.user.id, role: ctx.role }, input));
  } catch (error) {
    if (error instanceof PayrollShopError) return jsonError(error.status, error.code);
    return jsonError(500, "generic");
  }
}
