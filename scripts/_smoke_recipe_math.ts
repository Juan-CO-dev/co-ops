import { skuContentOz, componentPerUnitOz, packYieldForComponent, type MeasureUnitFactor } from "@/lib/recipe-math";

const measures = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
  ["count", { dimension: "count", toBaseFactor: 1 }],
  ["gallon", { dimension: "volume", toBaseFactor: 128 }],
]);

function assert(label: string, got: unknown, want: unknown) {
  const ok = Math.abs(Number(got) - Number(want)) < 1e-6 || got === want;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: got=${got} want=${want}`);
  if (!ok) process.exitCode = 1;
}

assert("mayo oz", skuContentOz({ unitsPerPack: 4, eachSize: 128, eachMeasure: "oz", avgOzPerEach: null }, measures), 512);
assert("mayo lb", skuContentOz({ unitsPerPack: 4, eachSize: 8, eachMeasure: "lb", avgOzPerEach: null }, measures), 512);
assert("lettuce count", skuContentOz({ unitsPerPack: 24, eachSize: 1, eachMeasure: "count", avgOzPerEach: 13 }, measures), 312);
assert("oil gallon", skuContentOz({ unitsPerPack: 4, eachSize: 1, eachMeasure: "gallon", avgOzPerEach: 120 }, measures), 480);
assert("count no avg → null", skuContentOz({ unitsPerPack: 24, eachSize: 1, eachMeasure: "count", avgOzPerEach: null }, measures), null);
assert("no eachSize → null", skuContentOz({ unitsPerPack: 4, eachSize: null, eachMeasure: "oz", avgOzPerEach: null }, measures), null);
assert("unknown measure → null", skuContentOz({ unitsPerPack: 4, eachSize: 1, eachMeasure: "qt", avgOzPerEach: null }, measures), null);
assert("perUnitOz weight", componentPerUnitOz({ quantity: 32, unit: "oz", batchYield: 4, skuAvgOzPerEach: null }, measures), 8);
assert("perUnitOz count", componentPerUnitOz({ quantity: 2, unit: "count", batchYield: 1, skuAvgOzPerEach: 13 }, measures), 26);
assert("packYield", packYieldForComponent(512, 8), 64);
assert("packYield null perUnit", packYieldForComponent(512, 0), null);

const typed = skuContentOz({ unitsPerPack: 4, eachSize: 128, eachMeasure: "oz", avgOzPerEach: null }, measures);
console.log(`typeof content_oz = ${typeof typed}`);
