import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { canViewDemandSignals, demandSignalShops } from "@/lib/demand-signals/access-shared";
import { askForClaims } from "@/lib/demand-signals/ai-client";
import { DemandAiError, reserveAiCall, settleAiCall } from "@/lib/demand-signals/ai-store";
import { demandSignalsEnabled } from "@/lib/demand-signals/config-shared";
import { requestInsights } from "@/lib/demand-signals/insights";
import { aiConfig, buildInsightFacts } from "@/lib/demand-signals/insights-shared";
import { loadSignalsPage } from "@/lib/demand-signals/signals-page";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Item 4 PR 7: a person asks for today's AI insights for one shop. THE ONLY DOOR TO THE MODEL, and it opens only
 * when all of these hold, in this order: same-origin; a session; the trusted role (gm / moo / owner / cgs; a
 * level-6 role is refused); DEMAND_SIGNALS=1 AND DEMAND_AI=1; this feature's OWN key is set (DEMAND_AI_API_KEY;
 * without it 503 `demand_ai_not_configured` and nothing is read, reserved or sent); the model has a price in
 * code; the shop is one the actor may see. Then the facts are read the way the page reads them, the worst case
 * is reserved (0352: one attempt per shop per ET day, the month's cap), ONE bounded call is made, only validated
 * claims are kept, and the real cost is settled. Nothing here changes an order, a par or a schedule, and nothing
 * the model wrote is returned: the answer is claim types and the facts they cite.
 * NO STEP-UP: one capped request a day, by a manager, that writes only its own ledger rows.
 */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/demand-signals/insights");
  if (ctx instanceof Response) return ctx;
  if (!canViewDemandSignals(ctx.role)) return jsonError(403, "demand_ai_forbidden");
  if (!demandSignalsEnabled(process.env.DEMAND_SIGNALS)) return jsonError(503, "demand_signals_off");
  const config = aiConfig({ enabled: process.env.DEMAND_AI, apiKey: process.env.DEMAND_AI_API_KEY, model: process.env.DEMAND_AI_MODEL,
    monthlyCapCents: process.env.DEMAND_AI_MONTHLY_CAP_CENTS });
  if (config.status !== "ready") return jsonError(503, `demand_ai_${config.status}`);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const locationId = typeof body === "object" && body !== null ? (body as { locationId?: unknown }).locationId : null;
  if (typeof locationId !== "string" || !UUID.test(locationId)) return jsonError(400, "demand_ai_invalid");
  try {
    const sb = getServiceRoleClient();
    const { data, error } = await sb.from("locations").select("id,name").eq("active", true).eq("id", locationId);
    if (error) return jsonError(500, "generic");
    const shop = demandSignalShops(ctx.role, ctx.locations, (data ?? []) as { id: string; name: string }[])[0];
    if (!shop) return jsonError(403, "demand_ai_shop_forbidden");
    const page = await loadSignalsPage(sb, { actor: { role: ctx.role, locations: ctx.locations }, shop, nowIso: new Date().toISOString() });
    if (page.state !== "ok") return jsonError(503, page.state === "unavailable" ? "demand_signals_unavailable" : "demand_ai_facts_incomplete");
    const result = await requestInsights(
      { reserve: (a) => reserveAiCall(sb, a), settle: (id, s) => settleAiCall(sb, id, s), ask: askForClaims },
      { config, apiKey: process.env.DEMAND_AI_API_KEY, actorId: ctx.user.id, locationId: shop.id, today: page.today,
        facts: buildInsightFacts({ today: page.today, days: page.days, events: page.events }) });
    if (!result.ok) return jsonError(result.status, result.code);
    return jsonOk({ claims: result.claims.length, rejected: result.rejected });
  } catch (error) {
    if (error instanceof DemandAiError) return jsonError(error.status, error.code);
    return jsonError(500, "generic");
  }
}
