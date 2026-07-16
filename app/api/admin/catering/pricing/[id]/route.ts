import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  updatePricingRule,
  deactivatePricingRule,
  AdminCateringError,
  PRICING_MIN,
  type PricingRuleInput,
} from "@/lib/admin/catering/pricing";

// PATCH — one concern per call, both MoO+ (>=8) + Tier B (financial):
//   rates  {taxRateBps,gratuityBps,serviceChargeBps,depositPctBps,taxOnDelivery,taxOnGratuity,locationId}
//          → edit the location's single active rule in place.
//   active {active:false, locationId}  → deactivate the location's active rule (never true here).

const RATE_KEYS = [
  "taxRateBps",
  "gratuityBps",
  "serviceChargeBps",
  "depositPctBps",
  "taxOnDelivery",
  "taxOnGratuity",
] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catering/pricing/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PRICING_MIN) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const hasRates = RATE_KEYS.some((k) => k in b);
  const hasActive = "active" in b;

  // Exactly one concern per PATCH.
  const concerns = [hasRates, hasActive].filter(Boolean).length;
  if (concerns === 0) return jsonError(400, "invalid_payload", { message: "No recognized fields to update" });
  if (concerns > 1) {
    return jsonError(400, "mixed_concerns", { message: "One concern per PATCH: rates or active" });
  }

  if (typeof b.locationId !== "string") return jsonError(400, "invalid_payload", { field: "locationId" });
  const locationId = b.locationId;

  try {
    if (hasActive) {
      if (typeof b.active !== "boolean" || b.active !== false) {
        return jsonError(400, "invalid_payload", { field: "active" });
      }
      await deactivatePricingRule(ctx, { ruleId: id, locationId });
      return jsonOk({ ok: true });
    }

    // hasRates — all rate fields required together (atomic save of the rule).
    if (typeof b.taxRateBps !== "number") return jsonError(400, "invalid_rate", { field: "taxRateBps" });
    if (typeof b.gratuityBps !== "number") return jsonError(400, "invalid_rate", { field: "gratuityBps" });
    if (typeof b.serviceChargeBps !== "number") return jsonError(400, "invalid_rate", { field: "serviceChargeBps" });
    if (typeof b.depositPctBps !== "number") return jsonError(400, "invalid_rate", { field: "depositPctBps" });
    if (typeof b.taxOnDelivery !== "boolean") return jsonError(400, "invalid_presence", { field: "taxOnDelivery" });
    if (typeof b.taxOnGratuity !== "boolean") return jsonError(400, "invalid_presence", { field: "taxOnGratuity" });

    const input: PricingRuleInput = {
      locationId,
      taxRateBps: b.taxRateBps,
      gratuityBps: b.gratuityBps,
      serviceChargeBps: b.serviceChargeBps,
      depositPctBps: b.depositPctBps,
      taxOnDelivery: b.taxOnDelivery,
      taxOnGratuity: b.taxOnGratuity,
    };
    await updatePricingRule(ctx, { ruleId: id, input });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
