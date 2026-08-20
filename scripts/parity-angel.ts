/**
 * parity-angel — re-cost the Angel Spend §6.1 prep recipes with OUR engine and
 * Angel's own prices, and print the deltas.
 *
 * WHY: docs/angel-spend-insights.md §6 offers a ready-made regression suite for
 * a costing engine — the same 30-ish recipes, entered by hand into Angel, with
 * Angel's batch cost and cost-per-lb for each. Running co-ops' flatten over the
 * same builds with the same prices tells us whether our engine agrees with a
 * product an operator pays for, and WHERE it doesn't.
 *
 * MANUAL RUN, NOT CI. It reads live prod, depends on hand-built name maps, and
 * its interesting output is FINDINGS, not pass/fail. It always exits 0 — a
 * delta is something to go look at, never a broken build.
 *
 * Run with the react-server condition so the lib's `server-only` guard resolves
 * (the house pattern — cf. scripts/backfill-toast-depletion.ts):
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/parity-angel.ts
 *
 * ── WHAT IS AND ISN'T A VALID ORACLE ────────────────────────────────────────
 *
 * §6.1 (RECIPE batch costs) is usable. §6.2 (MENU-ITEM costs) is NOT, and this
 * harness deliberately does not touch it: docs/seed/source/angel-reconciliation-
 * report.md §F.3 R4 rules it out as a parity oracle because those numbers bake
 * in the $35.95/lb pickles artifact, the uncosted sub roll, and uncosted
 * capicola. The reconciliation also corrects the pickles story itself (§C.3):
 * Angel's CSV export never emitted that $/lb — Angel's UI produced it by
 * dividing a case price by an assumed ~1 lb. So the number in §6.3's map is
 * known-bad, it is carried here as UNPRICED, and any recipe that touches that
 * SKU is excluded with the reason printed.
 *
 * Prices below are a hand-copied TEST FIXTURE from §6.3 — a frozen snapshot for
 * comparison arithmetic, never live price data, and nothing here writes to
 * vendor_price_history or anywhere else. This script is read-only.
 *
 * Where §6.3 names a SKU but states no usable number ("MISSING", a bare product
 * name, or "$22+"), the SKU is left UNPRICED rather than guessed. That makes
 * some recipes incomparable — which is the honest result and is reported as
 * such, exactly like the board's own `(N unpriced)` doctrine.
 */

import { pathToFileURL } from "node:url";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { perUnitSkuOzForItemFromGraph } from "@/lib/prep-consumption-graph";

/** Angel's published batch cost + cost-per-lb (docs/angel-spend-insights.md §6.1). */
interface AngelRecipe {
  /** Angel's label for the recipe. */
  angel: string;
  batchCost: number;
  /** Angel's cost per FINISHED lb; null where Angel printed "—". */
  perLb: number | null;
  /** The co-ops recipes.name that models it; null = we don't have this recipe. */
  coops: string | null;
  /** Non-null → excluded from delta comparison, with this printed reason. */
  excluded?: string;
}

const ZERO_PLACEHOLDER =
  "$0.00 placeholder in Angel — main ingredient absent from its catalog (§5)";
const PARTIAL_COST = "Angel row is a PARTIAL cost (<50% of mass costed) (§5)";

const ANGEL_RECIPES: AngelRecipe[] = [
  { angel: "Garlic Aioli (fixed)", batchCost: 41.02, perLb: 2.34, coops: "Garlic Mayo (Aioli)" },
  { angel: "Cholula Mayo", batchCost: 6.75, perLb: 2.60, coops: "Cholula Mayo" },
  { angel: "Russian Dressing", batchCost: 16.58, perLb: 4.28, coops: null },
  { angel: "Honey Chili Aioli", batchCost: 9.97, perLb: 2.23, coops: "Honey Chili Aioli" },
  { angel: "Caesar Dressing", batchCost: 4.85, perLb: 2.35, coops: "Cesear Dressing" },
  { angel: "Mustard Aioli", batchCost: 6.51, perLb: 2.16, coops: "Mustard Aioli" },
  { angel: "Green Goddess", batchCost: 3.34, perLb: 1.43, coops: "Green Goddess" },
  { angel: "Cannoli Cream", batchCost: 9.74, perLb: 2.97, coops: "Cannoli Cream" },
  { angel: "Garlic Bread Compound Butter", batchCost: 5.35, perLb: 2.26, coops: "Garlic Bread / Compound Butter" },
  { angel: "Egg Salad", batchCost: 9.85, perLb: 2.36, coops: "Egg Salad" },
  { angel: "Tuna Salad", batchCost: 29.70, perLb: 2.50, coops: "Tuna Salad" },
  { angel: "Chicken Salad", batchCost: 34.08, perLb: 5.24, coops: "Chicken Salad" },
  { angel: "Coleslaw", batchCost: 3.64, perLb: 0.57, coops: null, excluded: PARTIAL_COST },
  { angel: "French Onion Dip", batchCost: 13.39, perLb: 1.27, coops: "French Onion Dip" },
  { angel: "Caramelized Onions", batchCost: 4.79, perLb: 2.18, coops: "Caramelized Onions" },
  { angel: "Marinara", batchCost: 11.45, perLb: 0.83, coops: "Marinara" },
  { angel: "Vodka Sauce", batchCost: 10.36, perLb: 1.53, coops: "Vodka Sauce" },
  { angel: "Meatballs", batchCost: 34.79, perLb: 3.08, coops: "Meatballs" },
  { angel: "Meatball Spice Mix", batchCost: 0.77, perLb: 4.54, coops: "Meatball Spice Mix" },
  { angel: "Turkey Jus", batchCost: 0.00, perLb: null, coops: null, excluded: ZERO_PLACEHOLDER },
  { angel: "Beef Jus", batchCost: 4.12, perLb: 0.32, coops: "Beef Jus" },
  { angel: "Italian Salsa Verde", batchCost: 11.95, perLb: 9.96, coops: "Italian Salsa Verde" },
  { angel: "Cranberry Sauce", batchCost: 0.00, perLb: null, coops: null, excluded: ZERO_PLACEHOLDER },
  { angel: "Cornbread Mayo", batchCost: 4.57, perLb: 1.00, coops: null, excluded: PARTIAL_COST },
  { angel: "Vegan SDT Aioli", batchCost: 0.42, perLb: 0.16, coops: null, excluded: PARTIAL_COST },
  { angel: "House MSG", batchCost: 1.27, perLb: 3.33, coops: null },
  { angel: "House Quickle", batchCost: 4.56, perLb: 0.52, coops: null },
  { angel: "Toasted Red Chili Flakes", batchCost: 0.00, perLb: null, coops: null, excluded: ZERO_PLACEHOLDER },
  { angel: "Roasted Mushrooms", batchCost: 0.50, perLb: 0.25, coops: null, excluded: PARTIAL_COST },
  { angel: "Corn Esquite", batchCost: 2.52, perLb: 0.66, coops: null, excluded: PARTIAL_COST },
  { angel: "Strata Base", batchCost: 1.33, perLb: 0.34, coops: null },
  { angel: "Breakfast Strata", batchCost: 2.47, perLb: 1.07, coops: null },
  { angel: "Strata Supreme", batchCost: 3.17, perLb: 1.33, coops: null },
  { angel: "Blackforest Breadpudding", batchCost: 1.30, perLb: 0.25, coops: null, excluded: PARTIAL_COST },
  { angel: "Pesto", batchCost: 6.70, perLb: 5.36, coops: null },
  { angel: "Chicken Cutlet (APPROX)", batchCost: 17.44, perLb: 1.45, coops: "Chicken Cutlet (approximate)" },
];

/**
 * Angel's derived $/lb per co-ops SKU name (docs/angel-spend-insights.md §6.3).
 * A SKU absent from this map is UNPRICED for the run — §6.3 either marks it
 * MISSING or names an Angel product without stating a number. Never guessed.
 */
const ANGEL_PRICE_PER_LB: Record<string, number> = {
  // Deli / protein
  "Ham": 2.77,
  "Genoa": 4.39,
  "Pepperoni": 5.09,
  "Prosciutto": 12.95,
  "Turkey": 6.28,
  "Roast Beef": 8.69,               // proxy: LONDON BROIL
  "Chicken Breast": 1.59,
  "Ground Beef": 4.56,
  "Ground Pork": 2.24,
  "Tuna": 2.34,
  // Dairy
  "Provolone": 3.47,
  "Fresh Mozzarella": 3.69,
  "Shredded Mozz": 2.72,
  "Heavy Cream": 1.68,
  "Butter": 2.16,
  "Parmesan (Grated)": 3.46,
  // Produce
  "Tomatoes": 1.50,
  "Iceberg": 0.74,
  "Arugula": 4.13,
  "Basil": 10.34,
  "Parsley": 10.86,
  "Thyme": 35.19,                   // HIGH_PPL_REVIEW (reconciliation §C.2)
  "Onion (White)": 0.61,
  "Onion (red)": 0.67,
  "Garlic": 3.29,
  "Celery": 3.71,
  "Cucumber": 3.62,
  "Sweet Peppers": 10.25,           // §6.3 flags this one "suspicious, cross-check"
  "Hot Peppers": 8.95,
  "Banana Peppers": 8.75,
  "Roasted Red Peppers": 1.13,
  "Watermelon Radish": 2.88,
  // Pantry
  "Tomatoes Crushed (10#)": 0.80,
  "Tomato Paste": 1.50,
  "Duke's Mayo": 2.28,
  "Lemon Juice": 2.34,
  "Olive Oil": 4.69,
  "Balsamic Vin": 1.35,
  "Panko (Japanese)": 1.06,
  "Salt": 2.26,
  "Black peppercorn": 8.42,
  "Oregano": 12.80,
  "Onion Powder": 5.54,
  "Beef Base": 9.34,
};

/**
 * SKUs whose Angel figure is known-bad and must never be propagated. Present in
 * §6.3, deliberately absent from the price map above, and any recipe reaching
 * one is excluded from the deltas with this reason printed.
 */
const POISONED_SKUS: Record<string, string> = {
  "Pickle slices": "PICKLES CHIPS 1/4 — $35.95/lb is a case price mis-read as ~1 lb (insights §3.3, corrected in reconciliation §C.3)",
};

/** Prices whose arithmetic is right but whose propagation is misleading. */
const FLAGGED_PRICES: Record<string, string> = {
  "Thyme": "HIGH_PPL_REVIEW — $66.16/lb in the CSV vs $24.00/lb in the 2024 sheet; tiny herb packs (reconciliation §C.2)",
  "Sweet Peppers": "§6.3 annotates $10.25/lb as suspicious — cross-check before trusting",
  "Basil": "duplicate Angel rows disagree 89% ($10.34 vs $19.55/lb) — the picked row changes the answer (reconciliation §B.3)",
  "Oregano": "duplicate Angel rows disagree ($11.05 vs $16.27/lb) (reconciliation §B.3)",
};

const DELTA_FINDING_PCT = 10;

interface Row {
  angel: AngelRecipe;
  /** null = not comparable; the reason is in `note`. */
  coopsBatch: number | null;
  coopsPerLb: number | null;
  perLbBasis: "declared" | "inputs" | null;
  unpriced: string[];
  flagged: string[];
  note: string;
}

function fmt(v: number | null, dp = 2): string {
  return v == null ? "—" : v.toFixed(dp);
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}
function padL(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : " ".repeat(w - s.length) + s;
}

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  console.log("");
  console.log("ANGEL PARITY HARNESS — co-ops engine vs Angel Spend §6.1");
  console.log("Prices: docs/angel-spend-insights.md §6.3 (hand-copied FIXTURE, not live data).");
  console.log("Oracle: §6.1 recipe batch costs. §6.2 menu-item costs are NOT used (bad oracle,");
  console.log("        reconciliation §F.3 R4). Read-only; nothing is written. Exit is always 0.");
  console.log("");

  // ── Resolve co-ops recipes → their output item + that output's yield ───────
  const { data: recRows, error: recErr } = await sb
    .from("recipes")
    .select("id, name")
    .returns<Array<{ id: string; name: string }>>();
  if (recErr) throw new Error(`recipes read failed: ${recErr.message}`);

  const { data: outRows, error: outErr } = await sb
    .from("recipe_outputs")
    .select("recipe_id, output_item_id, yield")
    .not("output_item_id", "is", null)
    .returns<Array<{ recipe_id: string; output_item_id: string; yield: number | string }>>();
  if (outErr) throw new Error(`recipe_outputs read failed: ${outErr.message}`);

  const { data: itemRows, error: itemErr } = await sb
    .from("items")
    .select("id, name, oz_per_par_unit")
    .returns<Array<{ id: string; name: string; oz_per_par_unit: number | string | null }>>();
  if (itemErr) throw new Error(`items read failed: ${itemErr.message}`);

  const recipeIdByName = new Map(recRows?.map((r) => [r.name, r.id]) ?? []);
  const outputOfRecipe = new Map<string, { itemId: string; yield: number }>();
  for (const o of outRows ?? []) {
    if (outputOfRecipe.has(o.recipe_id)) continue; // first-wins, mirroring the graph index
    outputOfRecipe.set(o.recipe_id, { itemId: o.output_item_id, yield: Number(o.yield) });
  }
  const ozPerParUnitByItem = new Map(
    (itemRows ?? []).map((i) => [i.id, i.oz_per_par_unit == null ? null : Number(i.oz_per_par_unit)]),
  );

  // ── SKU name → id, so the fixture's per-lb prices can key by SKU id ────────
  const { data: skuRows, error: skuErr } = await sb
    .from("vendor_items")
    .select("id, name")
    .returns<Array<{ id: string; name: string }>>();
  if (skuErr) throw new Error(`vendor_items read failed: ${skuErr.message}`);

  const skuNameById = new Map((skuRows ?? []).map((s) => [s.id, s.name]));
  const costPerOzBySku = new Map<string, number | null>();
  for (const s of skuRows ?? []) {
    const perLb = ANGEL_PRICE_PER_LB[s.name];
    costPerOzBySku.set(s.id, perLb == null ? null : perLb / 16);
  }

  const graph = await loadRecipeGraph();

  // ── Re-cost every mapped recipe ───────────────────────────────────────────
  const rows: Row[] = [];
  for (const angel of ANGEL_RECIPES) {
    const base: Row = {
      angel, coopsBatch: null, coopsPerLb: null, perLbBasis: null,
      unpriced: [], flagged: [], note: "",
    };

    if (angel.excluded) {
      rows.push({ ...base, note: `EXCLUDED — ${angel.excluded}` });
      continue;
    }
    if (angel.coops == null) {
      rows.push({ ...base, note: "not modelled in co-ops" });
      continue;
    }
    const recipeId = recipeIdByName.get(angel.coops);
    if (!recipeId) {
      rows.push({ ...base, note: `co-ops recipe "${angel.coops}" NOT FOUND` });
      continue;
    }
    const out = outputOfRecipe.get(recipeId);
    if (!out) {
      rows.push({ ...base, note: "co-ops recipe has no item output" });
      continue;
    }

    const perUnitOz = perUnitSkuOzForItemFromGraph(graph, out.itemId);
    if (perUnitOz.size === 0) {
      rows.push({ ...base, note: "UNRESOLVED — the oz flatten poisons (engine gap or SKU data gap)" });
      continue;
    }

    const poisoned: string[] = [];
    const unpriced: string[] = [];
    const flagged: string[] = [];
    let perUnitCost = 0;
    let perUnitInputOz = 0;

    for (const [skuId, oz] of perUnitOz) {
      const name = skuNameById.get(skuId) ?? skuId;
      perUnitInputOz += oz;
      if (POISONED_SKUS[name]) { poisoned.push(name); continue; }
      const costPerOz = costPerOzBySku.get(skuId) ?? null;
      if (costPerOz == null) { unpriced.push(name); continue; }
      if (FLAGGED_PRICES[name]) flagged.push(name);
      perUnitCost += oz * costPerOz;
    }

    if (poisoned.length > 0) {
      rows.push({
        ...base, unpriced, flagged,
        note: `EXCLUDED — pickle-contaminated: ${poisoned.map((p) => POISONED_SKUS[p]).join("; ")}`,
      });
      continue;
    }
    if (unpriced.length > 0) {
      rows.push({
        ...base, unpriced, flagged,
        note: `INCOMPARABLE — ${unpriced.length} unpriced: ${unpriced.sort().join(", ")}`,
      });
      continue;
    }

    // batchOz = perUnitOz x output yield (single-output recipes: share = 1).
    const batchCost = perUnitCost * out.yield;
    const declaredOzPerPar = ozPerParUnitByItem.get(out.itemId) ?? null;
    const finishedBatchOz =
      declaredOzPerPar != null && declaredOzPerPar > 0
        ? declaredOzPerPar * out.yield
        : perUnitInputOz * out.yield;
    rows.push({
      ...base,
      coopsBatch: batchCost,
      coopsPerLb: finishedBatchOz > 0 ? batchCost / (finishedBatchOz / 16) : null,
      perLbBasis: declaredOzPerPar != null && declaredOzPerPar > 0 ? "declared" : "inputs",
      unpriced, flagged,
      note: flagged.length > 0 ? `flagged price: ${[...new Set(flagged)].sort().join(", ")}` : "",
    });
  }

  // ── Print ─────────────────────────────────────────────────────────────────
  const W = { name: 30, num: 10, delta: 9 };
  console.log("COMPARABLE ROWS");
  console.log(
    pad("Recipe", W.name) + padL("Angel $", W.num) + padL("co-ops $", W.num) +
    padL("Δ$", W.num) + padL("Δ%", W.delta) + padL("Angel $/lb", 12) + padL("ours $/lb", 11) + "  basis",
  );
  console.log("-".repeat(30 + 10 * 3 + 9 + 12 + 11 + 10));

  const comparable = rows.filter((r) => r.coopsBatch != null);
  const findings: string[] = [];
  for (const r of comparable) {
    const ours = r.coopsBatch!;
    const theirs = r.angel.batchCost;
    const d = ours - theirs;
    const dp = theirs !== 0 ? (d / theirs) * 100 : NaN;
    console.log(
      pad(r.angel.angel, W.name) + padL(fmt(theirs), W.num) + padL(fmt(ours), W.num) +
      padL((d >= 0 ? "+" : "") + fmt(d), W.num) +
      padL(Number.isFinite(dp) ? (dp >= 0 ? "+" : "") + dp.toFixed(1) + "%" : "—", W.delta) +
      padL(fmt(r.angel.perLb), 12) + padL(fmt(r.coopsPerLb), 11) + "  " + (r.perLbBasis ?? "—") +
      (r.note ? "  · " + r.note : ""),
    );
    if (Number.isFinite(dp) && Math.abs(dp) > DELTA_FINDING_PCT) {
      findings.push(`${r.angel.angel}: ${dp >= 0 ? "+" : ""}${dp.toFixed(1)}% (Angel $${fmt(theirs)} vs ours $${fmt(ours)})`);
    }
  }
  if (comparable.length === 0) console.log("  (none)");

  const incomparable = rows.filter((r) => r.coopsBatch == null && r.note.startsWith("INCOMPARABLE"));
  const excluded = rows.filter((r) => r.note.startsWith("EXCLUDED"));
  const unresolved = rows.filter((r) => r.note.startsWith("UNRESOLVED"));
  const absent = rows.filter((r) => r.coopsBatch == null && !r.note.startsWith("INCOMPARABLE") && !r.note.startsWith("EXCLUDED") && !r.note.startsWith("UNRESOLVED"));

  const section = (title: string, list: Row[]) => {
    console.log("");
    console.log(`${title} (${list.length})`);
    if (list.length === 0) { console.log("  (none)"); return; }
    for (const r of list) console.log("  " + pad(r.angel.angel, W.name) + " " + r.note);
  };

  section("EXCLUDED — documented bad Angel rows", excluded);
  section("UNRESOLVED — our flatten could not produce ounces", unresolved);
  section("INCOMPARABLE — our engine resolved, but the fixture has no price for some line", incomparable);
  section("NOT MODELLED in co-ops", absent);

  console.log("");
  console.log(`FINDINGS — deltas over ${DELTA_FINDING_PCT}% on clean rows (${findings.length})`);
  if (findings.length === 0) console.log("  (none)");
  for (const f of findings) console.log("  · " + f);

  console.log("");
  console.log("SUMMARY");
  console.log(`  ${ANGEL_RECIPES.length} Angel §6.1 rows · ${comparable.length} compared · ${findings.length} over-threshold`);
  console.log(`  ${excluded.length} excluded · ${unresolved.length} unresolved · ${incomparable.length} incomparable · ${absent.length} not modelled`);
  console.log("");
  console.log("NOTE ON $/lb BASIS: 'declared' uses items.oz_per_par_unit (a FINISHED weight,");
  console.log("  co-ops' equivalent of Angel's Weight per Unit — this is how cook-down is");
  console.log("  expressed). 'inputs' means that field is unset, so finished weight falls back");
  console.log("  to the raw input sum, which UNDERSTATES $/lb for anything that cooks down.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
