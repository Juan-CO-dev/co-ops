import { describe, expect, it } from "vitest";
import { receivedLineContribution, type ReceivedLineFacts } from "@/lib/admin/cost-shared";

/**
 * Audit W04/B043. Chain: case = 6 x bag, bag = 5 lb (80 oz), one root = 480 oz, case price $48.
 * Two bags received at level "bag" are 160 oz and a third of a case, never 2 cases (960 oz, $96).
 */
const base: ReceivedLineFacts = { qty: 2, levelLabel: "bag", resolvedOz: 160, linePrice: null, currentRootPrice: 48, contentOz: 480, rootLabel: "case", receivedRootOz: 480, receivedRootLabel: "case", priceIsPerLevel: false };

describe("W04/B043 receiving ledger reads inner-level lines at their real size", () => {
  it("an inner-level line counts its frozen resolved oz, not qty x case content", () => {
    expect(receivedLineContribution(base)).toEqual({ oz: 160, dollars: 16 });
  });

  it("a vendor root-pack line price is scaled by the root packs actually received", () => {
    expect(receivedLineContribution({ ...base, linePrice: 60 })).toEqual({ oz: 160, dollars: 20 });
  });

  it("a store-run line price is per received level", () => {
    expect(receivedLineContribution({ ...base, linePrice: 9, priceIsPerLevel: true })).toEqual({ oz: 160, dollars: 18 });
  });

  it("a later chain edit does not rewrite the historical oz", () => {
    expect(receivedLineContribution({ ...base, contentOz: 320 }).oz).toBe(160);
  });

  it("legacy rows (no level, no resolved oz) keep qty x content", () => {
    expect(receivedLineContribution({ ...base, levelLabel: null, resolvedOz: null, qty: 3 })).toEqual({ oz: 1440, dollars: 144 });
  });

  it("a root-level line counts whole packs", () => {
    expect(receivedLineContribution({ ...base, levelLabel: "case", resolvedOz: 960, linePrice: 50 })).toEqual({ oz: 960, dollars: 100 });
  });

  it("an inner-level line with no resolved oz is unknown, not guessed", () => {
    expect(receivedLineContribution({ ...base, resolvedOz: null })).toEqual({ oz: null, dollars: null });
  });
});
