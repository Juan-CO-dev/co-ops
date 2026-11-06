import "server-only";
import { checkRateLimit } from "@vercel/firewall";
import type { LandingServerEnv } from "./request-server";

export type LandingAggregateResult = "skipped" | "allowed" | "refused" | "unavailable";
interface Dependencies { check?: typeof checkRateLimit }

export type LandingAggregateKey = "landing-capi" | "landing-counter";

export function landingNonProduction(env: LandingServerEnv): boolean {
  return env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development" || (env.VERCEL_ENV === undefined && env.NODE_ENV !== "production");
}

/** Separate constant route keys; Vercel counters are scoped per region. */
export async function checkLandingAggregate(request: Request, env: LandingServerEnv, rateLimitKey: LandingAggregateKey, deps: Dependencies = {}): Promise<LandingAggregateResult> {
  if (env.LANDING_AGGREGATE_LIMIT === undefined || env.LANDING_AGGREGATE_LIMIT === "off") return "skipped";
  if (env.LANDING_AGGREGATE_LIMIT !== "sdk" || env.NODE_ENV !== "production" || !request.headers.get("host")) return "unavailable";
  try {
    const result = await (deps.check ?? checkRateLimit)("landing-aggregate", { request, rateLimitKey, timeout: 1000 });
    if (result.rateLimited) return "refused";
    // A missing SDK rule is an outage, never permission to send.
    return result.error ? "unavailable" : "allowed";
  } catch { return "unavailable"; }
}
