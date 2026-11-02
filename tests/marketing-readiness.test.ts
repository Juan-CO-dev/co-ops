import { describe, expect, it } from "vitest";
import { marketingReadiness, type MarketingReadinessInput } from "../lib/marketing/readiness-shared";

const ready: MarketingReadinessInput = {
  rulesRecorded: true, burstPhasesPassed: true, evidenceReviewedByCc: true, evidenceApprovedByJuan: true,
  rateLimitAllowed: true, pixelIdsMatch: true, tokenPresent: true, graphVersionCorrect: true,
  noTestCodeInProduction: true, uaApproved: true, previewDedupAllThree: true, productionBrowserAndServer: true,
  consentSuppressionProven: true, staffIsolationProven: true, rollbackTested: true,
};
describe("CAPI readiness is a complete launch gate", () => {
  it("requires all fourteen evidence items", () => {
    expect(marketingReadiness(ready)).toMatchObject({ readyCount: 14, total: 14, ready: true });
  });
  it.each(Object.keys(ready) as (keyof MarketingReadinessInput)[])("refuses readiness when %s fails", key => {
    expect(marketingReadiness({ ...ready, [key]: false })).toMatchObject({ readyCount: 13, total: 14, ready: false });
  });
  it("exposes boolean checks only, not deployment values or credentials", () => {
    const result = marketingReadiness(ready);
    expect(Object.values(result.checks).every(value => typeof value === "boolean")).toBe(true);
    expect(Object.keys(result)).toEqual(["checks", "readyCount", "total", "ready"]);
  });
});
