import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadPricingRules,
  createPricingRule,
  AdminCateringError,
  PRICING_MIN,
  type PricingRuleInput,
} from "@/lib/admin/catering/pricing";

// GET  — list per-location active pricing rules the actor manages. MoO+ (>=8), no step-up (read).
// POST — create a location's active pricing rule. MoO+ (>=8), Tier B (financial).

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/catering/pricing");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PRICING_MIN) return jsonError(403, "forbidden");

  try {
    const rules = await loadPricingRules(ctx);
    return jsonOk({ rules });
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catering/pricing");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PRICING_MIN) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string") return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.taxRateBps !== "number") return jsonError(400, "invalid_rate", { field: "taxRateBps" });
  if (typeof b.gratuityBps !== "number") return jsonError(400, "invalid_rate", { field: "gratuityBps" });
  if (typeof b.serviceChargeBps !== "number") return jsonError(400, "invalid_rate", { field: "serviceChargeBps" });
  if (typeof b.depositPctBps !== "number") return jsonError(400, "invalid_rate", { field: "depositPctBps" });
  if (typeof b.taxOnDelivery !== "boolean") return jsonError(400, "invalid_presence", { field: "taxOnDelivery" });
  if (typeof b.taxOnGratuity !== "boolean") return jsonError(400, "invalid_presence", { field: "taxOnGratuity" });

  const input: PricingRuleInput = {
    locationId: b.locationId,
    taxRateBps: b.taxRateBps,
    gratuityBps: b.gratuityBps,
    serviceChargeBps: b.serviceChargeBps,
    depositPctBps: b.depositPctBps,
    taxOnDelivery: b.taxOnDelivery,
    taxOnGratuity: b.taxOnGratuity,
  };

  try {
    const { id } = await createPricingRule(ctx, input);
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
