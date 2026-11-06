import "server-only";
import { checkRateLimit } from "@vercel/firewall";
import type { LandingServerEnv } from "./request-server";

export type LandingAggregateResult = "skipped" | "allowed" | "refused" | "unavailable";
interface Dependencies { check?: typeof checkRateLimit }

/** Shared constant key across both routes; Vercel counters are scoped per region. */
export async function checkLandingAggregate(request: Request, env: LandingServerEnv, deps: Dependencies = {}): Promise<LandingAggregateResult> {
  if (env.LANDING_AGGREGATE_LIMIT === undefined || env.LANDING_AGGREGATE_LIMIT === "off") return "skipped";
  if (env.LANDING_AGGREGATE_LIMIT !== "sdk") return "unavailable";
  try {
    const result = await (deps.check ?? checkRateLimit)("landing-aggregate", { request, rateLimitKey: "landing-all", timeout: 1000 });
    if (result.rateLimited) return "refused";
    // A missing SDK rule is an outage, never permission to send.
    return result.error ? "unavailable" : "allowed";
  } catch { return "unavailable"; }
}
