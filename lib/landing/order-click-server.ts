import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { parseOrderClick, type OrderClick } from "./order-click-shared";
import { boundedJson, emptyResponse, guardLandingRequest, type LandingServerEnv } from "./request-server";
import { landingRateLimit } from "./rate-limit";

async function incrementOrderClick(click: OrderClick): Promise<void> {
  const { error } = await getServiceRoleClient().rpc("increment_landing_order_click", { p_store_key: click.store, p_ad_code: click.ad }).abortSignal(AbortSignal.timeout(2000));
  if (error) throw new Error("counter_unavailable");
}
interface Dependencies { env?: LandingServerEnv; increment?: (click: OrderClick) => Promise<void> }
export async function handleOrderClick(request: Request, dependencies: Dependencies = {}): Promise<Response> {
  const env = dependencies.env ?? process.env;
  const refused = guardLandingRequest(request, env);
  if (refused) return refused;
  const body = await boundedJson(request, 512);
  if ("error" in body) return body.error;
  const click = parseOrderClick(body.value);
  if (!click) return emptyResponse(400);
  if (env.LANDING_COUNTER_ENABLED !== "true") return emptyResponse(204);
  const protection = landingRateLimit(env);
  if (protection === "refused") return emptyResponse(429);
  if (protection === "unavailable") return emptyResponse(503);
  // Unlike CAPI, lack of verified WAF does not gate this bounded approximate counter.
  try { await (dependencies.increment ?? incrementOrderClick)(click); return emptyResponse(204); }
  catch { return emptyResponse(503); }
}
