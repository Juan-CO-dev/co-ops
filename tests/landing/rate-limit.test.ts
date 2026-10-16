import { describe, expect, it } from "vitest";
import { landingRateLimit } from "@/lib/landing/rate-limit";

describe("landing WAF activation adapter", () => {
  it("defaults to dormant and requires independently recorded verification", () => {
    expect(landingRateLimit({})).toBe("dormant");
    expect(landingRateLimit({ LANDING_WAF_STATE: "active" })).toBe("unverified");
    expect(landingRateLimit({ LANDING_WAF_STATE: "active", LANDING_WAF_VERIFIED_AT: "not-a-date", LANDING_WAF_RULE_IDS: "rule" })).toBe("unverified");
  });
  it("fails closed on active outage and preserves refusals", () => {
    expect(landingRateLimit({ LANDING_WAF_STATE: "unavailable" })).toBe("unavailable");
    expect(landingRateLimit({ LANDING_WAF_STATE: "refused" })).toBe("refused");
    expect(landingRateLimit({ LANDING_WAF_STATE: "active", LANDING_WAF_VERIFIED_AT: "2026-10-16", LANDING_WAF_RULE_IDS: "per-ip,aggregate" })).toBe("allowed");
  });
});
