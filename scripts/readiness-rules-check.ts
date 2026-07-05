// scripts/readiness-rules-check.ts
// Pure-rule checks for lib/readiness.ts. No env, no network.
// Run: npx tsx scripts/readiness-rules-check.ts   (exit 0 = all pass)
import {
  skuPackComplete, skuReadiness, recipeOwnReadiness,
  composeRecipeReadiness, itemReadiness, KNOWN_REASONS,
} from "../lib/readiness";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures += 1; console.error(`FAIL ${name}`); }
  else console.log(`ok   ${name}`);
}

// ── SKU ──
check("pack complete", skuPackComplete({ unitsPerPack: 6, eachSize: 32, eachMeasure: "oz" }));
check("pack incomplete: no measure", !skuPackComplete({ unitsPerPack: 6, eachSize: 32, eachMeasure: null }));
check("pack incomplete: zero size", !skuPackComplete({ unitsPerPack: 6, eachSize: 0, eachMeasure: "oz" }));

const readySku = skuReadiness({ active: true, packComplete: true, hasPrice: true, deliveryCount: 3 });
check("sku ready", readySku !== null && readySku.status === "ready" && readySku.reasons.length === 0);
const gapSku = skuReadiness({ active: true, packComplete: false, hasPrice: false, deliveryCount: 0 });
check("sku all gaps", gapSku !== null && gapSku.status === "incomplete"
  && gapSku.reasons.map((r) => r.code).join(",") === "missing_pack,missing_price,no_delivery");
check("inactive sku → null (no badge)", skuReadiness({ active: false, packComplete: true, hasPrice: true, deliveryCount: 1 }) === null);
const noDel = skuReadiness({ active: true, packComplete: true, hasPrice: true, deliveryCount: 0 });
check("sku missing only delivery", noDel !== null && noDel.status === "incomplete"
  && noDel.reasons.length === 1 && noDel.reasons[0]?.code === "no_delivery");

// ── Recipe ──
const rOk = recipeOwnReadiness({ hasInputs: true, hasOutputs: true, batchYield: 4 });
check("recipe own ready", rOk.status === "ready");
const rBad = recipeOwnReadiness({ hasInputs: false, hasOutputs: true, batchYield: null });
check("recipe own gaps", rBad.status === "incomplete"
  && rBad.reasons.map((r) => r.code).join(",") === "no_inputs,no_batch_yield");
check("recipe zero yield is a gap", recipeOwnReadiness({ hasInputs: true, hasOutputs: true, batchYield: 0 }).status === "incomplete");

const upstream = composeRecipeReadiness(rOk, ["incomplete", "ready"], []);
check("recipe upstream amber", upstream.status === "upstream_gaps"
  && upstream.reasons[0]?.code === "not_ready_skus" && upstream.reasons[0]?.count === 1);
const redWins = composeRecipeReadiness(rBad, ["incomplete"], ["upstream_gaps"]);
check("red wins over amber", redWins.status === "incomplete");
check("red carries upstream reasons too", redWins.reasons.some((r) => r.code === "not_ready_skus")
  && redWins.reasons.some((r) => r.code === "not_ready_subitems"));
check("all ready inputs → ready", composeRecipeReadiness(rOk, ["ready"], ["ready"]).status === "ready");

// ── Item ──
const iOk = itemReadiness({ hasProducingRecipe: true, ozPerParUnit: 32, soldDirectly: false, sellPortionComplete: true }, "ready");
check("item ready", iOk.status === "ready");
const iNoRecipe = itemReadiness({ hasProducingRecipe: false, ozPerParUnit: null, soldDirectly: true, sellPortionComplete: false }, null);
check("item all gaps", iNoRecipe.status === "incomplete"
  && iNoRecipe.reasons.map((r) => r.code).join(",") === "no_recipe,no_oz_per_par_unit,sell_incomplete");
const iUp = itemReadiness({ hasProducingRecipe: true, ozPerParUnit: 32, soldDirectly: false, sellPortionComplete: true }, "incomplete");
check("item upstream via recipe", iUp.status === "upstream_gaps" && iUp.reasons[0]?.code === "upstream_recipe");
check("item upstream via amber recipe", itemReadiness({ hasProducingRecipe: true, ozPerParUnit: 1, soldDirectly: false, sellPortionComplete: true }, "upstream_gaps").status === "upstream_gaps");
check("non-sold item ignores sell fields", itemReadiness({ hasProducingRecipe: true, ozPerParUnit: 1, soldDirectly: false, sellPortionComplete: false }, "ready").status === "ready");

// ── Vocabulary closed set ──
check("KNOWN_REASONS has 12 codes", KNOWN_REASONS.length === 12);

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll readiness rule checks passed.");
