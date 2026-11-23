/**
 * Catering delivery D2 — the per-shop delivery settings (migration 0356 `delivery_settings`): on / off, the shop's
 * couriers (tenant data, never a literal in code) and the driver's share of the gratuity (RECORDED ONLY; its payroll
 * and legal treatment is unverified). Owner / CGS / MoO, by trusted ROLE.
 *
 * GET: every active shop's row — `{ settings: { state: "off" | "not_installed" | "ready", shops? } }`.
 * POST: save ONE shop's whole row through `set_delivery_settings`, the only writer of the table. Order: same-origin,
 * the session, the switch (503 `delivery_off`), the trusted role (before any I/O), Tier B (always prompted: this
 * switch turns delivery recording on for a shop), the strict parse, then the writer — which re-checks the role on the
 * locked users row and the row the person saw (`settings_moved`), and writes its own destructive
 * `delivery.settings_update` audit row in the same transaction. Under /api/admin, so this route's own requireSession
 * keeps the Tier B unlock the preceding POST /api/auth/step-up set. Sends nothing.
 */
import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession } from "@/lib/session";
import { canManageDeliverySettings } from "@/lib/delivery/access-shared";
import { deliveryOffResponse, deliveryRefusal } from "@/lib/delivery/http";
import { parseDeliverySettingsSave } from "@/lib/delivery/parse-shared";
import { loadDeliverySettings, saveDeliverySettings } from "@/lib/delivery/settings";

export const runtime = "nodejs";
const PATH = "/api/admin/catering/delivery";

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, PATH);
  if (ctx instanceof Response) return ctx;
  if (!canManageDeliverySettings(ctx.role)) return jsonError(403, "forbidden");
  try { return jsonOk({ settings: await loadDeliverySettings(ctx) }); }
  catch (error) { return deliveryRefusal(error); }
}

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, PATH);
  if (ctx instanceof Response) return ctx;
  const off = deliveryOffResponse();
  if (off) return off;
  if (!canManageDeliverySettings(ctx.role)) return jsonError(403, "forbidden");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const input = parseDeliverySettingsSave(body);
  if (!input) return jsonError(400, "invalid_settings");
  try { return jsonOk({ saved: await saveDeliverySettings(ctx, input) }); }
  catch (error) { return deliveryRefusal(error); }
}
