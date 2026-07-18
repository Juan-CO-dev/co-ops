import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadRateRules,
  upsertRateRule,
  AdminCateringRateError,
  RATE_MIN,
  type RateRuleInput,
} from "@/lib/admin/catering/rate-rules";

// GET  — list a managed location's active rate rules. MoO+ (>=8), no step-up (read).
// POST — upsert a location's active rate rule for (scope, scopeRef). MoO+ (>=8), Tier B (financial).

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/catering/rate-rules");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RATE_MIN) return jsonError(403, "forbidden");

  const locationId = req.nextUrl.searchParams.get("locationId");
  if (!locationId) return jsonError(400, "invalid_payload", { field: "locationId" });

  try {
    const rules = await loadRateRules(ctx, locationId);
    return jsonOk({ rules });
  } catch (e) {
    if (e instanceof AdminCateringRateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catering/rate-rules");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RATE_MIN) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string") return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.scope !== "string") return jsonError(400, "invalid_payload", { field: "scope" });
  if (b.scopeRef !== null && typeof b.scopeRef !== "string") return jsonError(400, "invalid_payload", { field: "scopeRef" });
  if (typeof b.rateBps !== "number") return jsonError(400, "invalid_rate", { field: "rateBps" });

  const input: RateRuleInput = {
    locationId: b.locationId,
    scope: b.scope as RateRuleInput["scope"],
    scopeRef: (b.scopeRef ?? null) as string | null,
    rateBps: b.rateBps,
  };

  try {
    const { id } = await upsertRateRule(ctx, input);
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof AdminCateringRateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
