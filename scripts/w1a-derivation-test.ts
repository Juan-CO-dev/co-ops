import assert from "node:assert/strict";
import {
  cateringUnitPriceCents,
  impliedRateBps,
  sumComponentsCents,
  resolveRateBps,
  type RateRule,
} from "@/lib/catering/pricing-derivation";

// Forward: whole sub $12.00 @ 85% → $10.20 / $5.10 / $2.55
assert.equal(cateringUnitPriceCents(1200, "whole", 8500), 1020);
assert.equal(cateringUnitPriceCents(1200, "half", 8500), 510);
assert.equal(cateringUnitPriceCents(1200, "quarter", 8500), 255);
// Raise: 110% whole → $13.20
assert.equal(cateringUnitPriceCents(1200, "whole", 11000), 1320);
// Rounding: 999¢ half @ 8500 = 424.575 → 425
assert.equal(cateringUnitPriceCents(999, "half", 8500), 425);

// Reverse
assert.equal(impliedRateBps(4500, 4900), 9184); // round(4500/4900*10000)
assert.equal(impliedRateBps(100, 0), null);      // baseline 0 → null

// Auto-sum
assert.equal(sumComponentsCents([{ unitCents: 510, qty: 2 }, { unitCents: 255, qty: 1 }]), 1275);

// Resolver: most-specific wins (menu_item > section > location > default 10000)
const rules: RateRule[] = [
  { scope: "location", scopeRef: null, rateBps: 9000 },
  { scope: "section", scopeRef: "Subs", rateBps: 8500 },
  { scope: "menu_item", scopeRef: "sub-1", rateBps: 8000 },
];
assert.equal(resolveRateBps(rules, { kind: "menu_item", entityId: "sub-1", section: "Subs" }), 8000);
assert.equal(resolveRateBps(rules, { kind: "menu_item", entityId: "sub-2", section: "Subs" }), 8500);
assert.equal(resolveRateBps(rules, { kind: "item", entityId: "x", section: "Drinks" }), 9000);
assert.equal(resolveRateBps([], { kind: "item", entityId: "x", section: null }), 10000);

console.log("w1a-derivation-test: all assertions passed");
