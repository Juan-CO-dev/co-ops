import "server-only";
import { createAdCodeResolver } from "./ad-codes-server";
import { loadLandingConfig } from "./config";
import { boundedJson, emptyResponse, guardLandingRequest, type LandingServerEnv } from "./request-server";
import { landingRateLimit } from "./rate-limit";
import { parseLandingEvent } from "./tracking-schema-shared";

interface Dependencies { env?: LandingServerEnv; now?: () => number; send?: typeof fetch; resolveAd?: (candidate: unknown) => Promise<string> }
/** Registry read only; no audit call, event log, customer record, or automatic retry. */
export async function handleMetaEvent(request: Request, dependencies: Dependencies = {}): Promise<Response> {
  const env = dependencies.env ?? process.env;
  const refused = guardLandingRequest(request, env);
  if (refused) return refused;
  const body = await boundedJson(request);
  if ("error" in body) return body.error;
  const event = parseLandingEvent(body.value, loadLandingConfig(env).siteOrigin!, (dependencies.now ?? Date.now)());
  if (!event) return emptyResponse(400);
  if (env.LANDING_CAPI_ENABLED !== "true" || !/^\d{1,30}$/.test(env.META_PIXEL_ID ?? "") || !env.META_CAPI_ACCESS_TOKEN || env.META_GRAPH_API_VERSION !== "v25.0") return emptyResponse(204);
  if (env.NEXT_PUBLIC_META_PIXEL_ID && env.NEXT_PUBLIC_META_PIXEL_ID !== env.META_PIXEL_ID) return emptyResponse(503);
  if (env.NODE_ENV === "production" && env.META_TEST_EVENT_CODE) return emptyResponse(503);
  const protection = landingRateLimit(env);
  if (protection === "refused") return emptyResponse(429);
  if (protection === "unavailable") return emptyResponse(503);
  if (protection !== "allowed") return emptyResponse(204);
  const userAgent = request.headers.get("user-agent");
  // Current Meta website event contract requires UA. Its use needs approved disclosure.
  // No IP is collected. A real consented fbc/fbp is additionally required for matching.
  if (env.LANDING_META_UA_APPROVED !== "true" || !userAgent || userAgent.length > 512 || (!event.fbc && !event.fbp)) return emptyResponse(204);
  const ad = await (dependencies.resolveAd ?? createAdCodeResolver())(event.ad).catch(() => "unattributed");
  const data = {
    event_name: event.event_name, event_time: event.event_time, event_id: event.event_id,
    event_source_url: event.source_url, action_source: "website",
    user_data: { client_user_agent: userAgent, ...(event.fbc ? { fbc: event.fbc } : {}), ...(event.fbp ? { fbp: event.fbp } : {}) },
    custom_data: { ad: ad === event.ad ? ad : "unattributed", placement: event.placement, ...(event.store ? { store: event.store } : {}), ...(event.vendor ? { vendor: event.vendor } : {}), ...(event.item ? { item: event.item } : {}) },
  };
  try {
    const response = await (dependencies.send ?? fetch)(`https://graph.facebook.com/v25.0/${env.META_PIXEL_ID}/events`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.META_CAPI_ACCESS_TOKEN}` },
      body: JSON.stringify({ data: [data], ...(env.META_TEST_EVENT_CODE ? { test_event_code: env.META_TEST_EVENT_CODE } : {}) }),
      signal: AbortSignal.timeout(2000), redirect: "error", cache: "no-store",
    });
    // Never reflect or log Meta response bodies (may contain identifiers or credentials).
    void response.body?.cancel().catch(() => {});
    return emptyResponse(response.ok ? 204 : 503);
  } catch { return emptyResponse(503); }
}
