import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  CUSTOMER_STATS_MIN, CustomerError, customerProfilesEnabled, dismissMerge, linkCateringOrders, lookupByContact, revealContact,
} from "@/lib/customers/customers";
import { requireSession } from "@/lib/session";

/**
 * 0234 customer profiles — the Tier A lane: reveal a profile's raw contact (9+, audited), look a person
 * up by contact for a delete request (9+, audited), dismiss a "likely same person" (GM+ bound), link
 * catering/ezCater orders (9+). The irreversible acts live on /api/admin/customers/confirm (Tier B).
 */
export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/customers");
  if (ctx instanceof Response) return ctx;
  if (!customerProfilesEnabled()) return jsonError(404, "not_enabled");
  if (ctx.level < CUSTOMER_STATS_MIN) return jsonError(403, "role_insufficient");
  const stepUp = assertStepUp(ctx, "A");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  const only = (...keys: string[]) => Object.keys(b).every((k) => ["operation", ...keys].includes(k));
  const actor = { userId: ctx.user.id, role: ctx.role, level: ctx.level, locations: ctx.locations };
  const meta = { ipAddress: extractIp(req), userAgent: req.headers.get("user-agent") };
  try {
    if (b.operation === "reveal" && typeof b.customerId === "string" && only("customerId")) {
      return jsonOk({ contact: await revealContact(actor, b.customerId, meta) });
    }
    if (b.operation === "lookup" && typeof b.query === "string" && b.query.length <= 254 && only("query")) {
      return jsonOk(await lookupByContact(actor, b.query, meta));
    }
    if (b.operation === "dismiss" && typeof b.suggestionId === "string" && only("suggestionId")) {
      return jsonOk(await dismissMerge(actor, { suggestionId: b.suggestionId }, meta));
    }
    if (b.operation === "link_catering" && only()) {
      return jsonOk(await linkCateringOrders(actor, meta));
    }
    return jsonError(400, "invalid_payload");
  } catch (error) {
    if (error instanceof CustomerError) return jsonError(error.status, error.code);
    console.error("[/api/admin/customers]", error instanceof Error ? error.message : String(error));
    return jsonError(500, "internal_error");
  }
}
