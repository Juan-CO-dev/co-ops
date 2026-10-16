import "server-only";
import type { LandingServerEnv } from "./request-server";
export type LandingRateLimitResult = "dormant" | "unverified" | "allowed" | "refused" | "unavailable";
/**
 * Deployment-owned WAF attestation adapter, NOT a process-local limiter. No incoming
 * request header is consulted. Real enforcement happens at Vercel before this route.
 * Evidence is recorded by the operator only after E4's multi-instance burst checks.
 */
export function landingRateLimit(env: LandingServerEnv): LandingRateLimitResult {
  const state = env.LANDING_WAF_STATE;
  if (!state || state === "dormant") return "dormant";
  if (state === "unavailable" || state === "refused") return state;
  if (state !== "active" || !env.LANDING_WAF_RULE_IDS || !/^\d{4}-\d{2}-\d{2}$/.test(env.LANDING_WAF_VERIFIED_AT ?? "") || !Number.isFinite(Date.parse(env.LANDING_WAF_VERIFIED_AT!))) return "unverified";
  return "allowed";
}
