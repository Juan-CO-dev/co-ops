import { skuCostPerOz, componentPerUnitCost, foodCostPct, type MeasureUnitFactor } from "@/lib/recipe-math";

const measures = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["count", { dimension: "count", toBaseFactor: 1 }],
]);

function assert(label: string, got: unknown, want: unknown) {
  const ok = (got == null && want == null) || Math.abs(Number(got) - Number(want)) < 1e-6;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: got=${got} want=${want}`);
  if (!ok) process.exitCode = 1;
}

assert("cost/oz", skuCostPerOz(48, 512), 0.09375);
assert("cost/oz null price", skuCostPerOz(null, 512), null);
assert("cost/oz zero content", skuCostPerOz(48, 0), null);
assert("component cost weight", componentPerUnitCost(
  { quantity: 32, unit: "oz", batchYield: 4, skuAvgOzPerEach: null, skuCostPerOz: 0.09375 }, measures), 0.75);
assert("component cost count", componentPerUnitCost(
  { quantity: 2, unit: "count", batchYield: 1, skuAvgOzPerEach: 13, skuCostPerOz: 0.05 }, measures), 1.3);
assert("component cost null costPerOz", componentPerUnitCost(
  { quantity: 32, unit: "oz", batchYield: 4, skuAvgOzPerEach: null, skuCostPerOz: null }, measures), null);
assert("food cost pct", foodCostPct(0.75, 3), 0.25);
assert("food cost pct null sell", foodCostPct(0.75, null), null);
console.log(`typeof cost/oz = ${typeof skuCostPerOz(48, 512)}`);
