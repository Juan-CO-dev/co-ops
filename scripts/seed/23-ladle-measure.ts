/**
 * Seed 23 — register `ladle` in the `measure_units` registry (Juan 2026-08-20:
 * "a ladle is 4 oz"), WITH the pre-flight refusal that stops it landing early.
 *
 * ── Why this is a seed and not a migration ───────────────────────────────────
 * `measure_units` is a DATA registry, not schema. Migration 0096 created the
 * table and seeded nine labels; every label since (`each`, `handful`, `quart`,
 * `unit`, `clove`, …) arrived through the live MoO+ admin path
 * (`addMeasureUnit`, lib/admin/skus.ts). This script writes the same row the
 * same way — idempotent on the unique label, reactivating rather than
 * duplicating — so the house pattern is honoured and no migration is owed.
 *
 * ── Why `weight`, not `volume` ───────────────────────────────────────────────
 * A ladle is a scoop, but Juan's ruling is a statement about how much PRODUCT it
 * delivers, and lib/recipe-math.ts deliberately refuses to convert volume to
 * weight without a density we do not store (a `volume` row would make every
 * ladle line permanently unresolvable, which is the opposite of the ruling).
 * `weight`/4 encodes exactly what he said: one ladle puts 4 ounces on the plate.
 *
 * ── THE GATE, and why this cannot simply be written ──────────────────────────
 * PR #271 §4 REFUSED the Our French Dip jus line for arithmetic reasons and this
 * script inherits that refusal. `1 ladle` of Jus resolves through
 * itemRefParUnits: a WEIGHT unit converts oz ÷ oz-per-par-unit of the sub-item,
 * and `Jus.oz_per_par_unit` is NULL, so it falls back to the sub's per-par-unit
 * INPUT mass (~2.25 oz — the recipe adds water it never records). Registering
 * the ladle today would therefore move that line from 1 par-unit to ~1.78 —
 * a WORSE number than the one it replaces, arrived at more confidently.
 *
 * So the script computes, per consuming line, through the real production
 * function, what registering the unit WOULD do, and refuses to write while any
 * line would land on the input-mass fallback. Fill `items.oz_per_par_unit` for
 * the affected preps (weigh a finished quart) and re-run: the gate releases per
 * row, exactly like #271's did.
 *
 * Until then the unit stays unregistered — and since the 2026-08-20 cleanup an
 * unregistered unit REFUSES loudly (lib/prep-consumption-graph.ts,
 * itemRefParUnits) instead of silently meaning par-units, so the state this
 * script declines to leave is honest rather than merely unchanged.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/23-ladle-measure.ts
 *        → DRY RUN (default). Prints the plan, the gate and the arithmetic; writes nothing.
 *      npx tsx --conditions=react-server --env-file=.env.local scripts/seed/23-ladle-measure.ts --execute
 *        → WRITES, and only if the gate passes.
 */
import { pathToFileURL } from "node:url";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import {
  itemRefParUnits,
  perUnitSkuOzForItemFromGraph,
  type GraphInput,
} from "@/lib/prep-consumption-graph";

const EXECUTE = process.argv.includes("--execute");

/** The unit being registered, exactly as recipe lines already spell it. */
const LABEL = "ladle";
const DIMENSION = "weight" as const;
const TO_BASE_FACTOR = 4; // ounces

const RULING =
  "Juan 2026-08-20: a ladle is 4 oz. Registered as a WEIGHT measure because the ruling is about how much product one ladle delivers, not about fluid volume (lib/recipe-math.ts refuses volume→weight without a density).";

const SOURCE =
  "PR #271 §4 (NO_PAR_WEIGHT_FALLBACK refusal) · docs/audits/2026-08-20-multivendor-semantics-audit.md";

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

interface ConsumerLine {
  recipe: string;
  subItem: string;
  subItemId: string;
  quantity: number;
  /** items.oz_per_par_unit of the sub-item — the honest denominator. */
  declaredParOz: number | null;
  /** Σ of the sub's flattened per-par-unit SKU oz — the FALLBACK denominator. */
  inputMassOz: number;
  parUnitsToday: number | null;
  parUnitsAfter: number | null;
  /** True when the conversion would run on the input-mass fallback → refuse. */
  refused: boolean;
}

async function main(): Promise<void> {
  const sb = getServiceRoleClient();
  console.log(`\n=== Seed 23 — register "${LABEL}" = ${TO_BASE_FACTOR} oz (${DIMENSION}) ===`);
  console.log(`Mode: ${EXECUTE ? "EXECUTE" : "DRY RUN"}\n`);
  console.log(`Ruling: ${RULING}\n`);

  // ── The live row, if any ────────────────────────────────────────────────────
  const { data: existing, error: exErr } = await sb
    .from("measure_units")
    .select("id, label, dimension, to_base_factor, active")
    .eq("label", LABEL)
    .maybeSingle<{ id: string; label: string; dimension: string; to_base_factor: number | string; active: boolean | null }>();
  if (exErr) throw new Error(`measure_units lookup failed: ${exErr.message}`);

  if (existing && existing.active !== false
    && existing.dimension === DIMENSION && num(existing.to_base_factor) === TO_BASE_FACTOR) {
    console.log(`ALREADY CORRECT — "${LABEL}" is registered as ${DIMENSION} ×${TO_BASE_FACTOR}. Nothing to do.`);
    console.log("\nSeed 23 done (no-op).");
    return;
  }

  // ── Who consumes it, and what would change ──────────────────────────────────
  // The graph is loaded BEFORE the write, so every line below is measured
  // against the world as it stands today.
  const graph = await loadRecipeGraph();

  const { data: lines, error: lErr } = await sb
    .from("recipe_inputs")
    .select("id, quantity, unit, component_item_id, component_sku_id, recipes!inner(name, active), items(name, oz_per_par_unit)")
    .eq("unit", LABEL)
    .returns<Array<{
      id: string; quantity: number | string; unit: string;
      component_item_id: string | null; component_sku_id: string | null;
      recipes: { name: string; active: boolean };
      items: { name: string; oz_per_par_unit: number | string | null } | null;
    }>>();
  if (lErr) throw new Error(`recipe_inputs lookup failed: ${lErr.message}`);

  const active = (lines ?? []).filter((l) => l.recipes.active);
  const skuLines = active.filter((l) => l.component_sku_id != null);
  const itemLines = active.filter((l) => l.component_item_id != null);

  const consumers: ConsumerLine[] = [];
  for (const l of itemLines) {
    const subItemId = l.component_item_id!;
    const quantity = num(l.quantity) ?? 0;
    const subPerUnit = perUnitSkuOzForItemFromGraph(graph, subItemId);
    let inputMassOz = 0;
    for (const oz of subPerUnit.values()) inputMassOz += oz;
    const declaredParOz = num(l.items?.oz_per_par_unit ?? null);

    // TODAY: `ladle` is unregistered, so itemRefParUnits refuses (post-cleanup).
    const today: GraphInput = { quantity, unit: LABEL, componentSkuId: null, componentItemId: subItemId };
    const parUnitsToday = itemRefParUnits(graph, today, subPerUnit);

    // AFTER: the same production function against a graph that knows the unit.
    const afterGraph = {
      ...graph,
      measures: new Map(graph.measures).set(LABEL, { dimension: DIMENSION, toBaseFactor: TO_BASE_FACTOR }),
    };
    const parUnitsAfter = itemRefParUnits(afterGraph, today, subPerUnit);

    consumers.push({
      recipe: l.recipes.name,
      subItem: l.items?.name ?? "(unnamed)",
      subItemId,
      quantity,
      declaredParOz,
      inputMassOz,
      parUnitsToday,
      parUnitsAfter,
      // The refusal condition, stated positively: the sub-item must declare its
      // own finished par-unit weight, or the conversion silently rides the
      // input-mass fallback and understates the denominator.
      refused: !(declaredParOz != null && declaredParOz > 0),
    });
  }

  console.log(`Consuming lines on ACTIVE recipes: ${active.length} (${itemLines.length} item-ref, ${skuLines.length} SKU-ref)\n`);

  if (skuLines.length > 0) {
    console.log("  NOTE — SKU-ref lines convert through the SKU's own pack/measure resolution,");
    console.log("  not through itemRefParUnits, so this gate does not judge them:");
    for (const l of skuLines) console.log(`    ${l.recipes.name}: ${l.quantity} ${LABEL} (SKU ref)`);
    console.log("");
  }

  if (consumers.length > 0) {
    console.log("── Item-ref lines: what registering the unit would do ──");
    console.log(
      "  recipe".padEnd(34) + "sub-item".padEnd(16) + "qty".padStart(6) +
      "  declared oz/par".padStart(18) + "  input mass".padStart(13) +
      "  today".padStart(9) + "  after".padStart(9) + "  verdict",
    );
    for (const c of consumers) {
      console.log(
        `  ${c.recipe}`.padEnd(34) + c.subItem.padEnd(16) + String(c.quantity).padStart(6) +
        (c.declaredParOz != null ? `${c.declaredParOz} oz` : "NULL").padStart(18) +
        `${c.inputMassOz.toFixed(3)} oz`.padStart(13) +
        (c.parUnitsToday != null ? c.parUnitsToday.toFixed(4) : "refused").padStart(9) +
        (c.parUnitsAfter != null ? c.parUnitsAfter.toFixed(4) : "refused").padStart(9) +
        (c.refused ? "  ⛔ NO_PAR_WEIGHT_FALLBACK" : "  ✓ honest denominator"),
      );
    }
    console.log("");
  }

  const blockers = consumers.filter((c) => c.refused);
  if (blockers.length > 0) {
    console.log("── GATE: CLOSED ──");
    console.log(`  ${blockers.length} line(s) would convert through the sub-item's INPUT MASS rather than a`);
    console.log("  declared finished weight. That is PR #271 §4's refusal, and it has not moved:");
    for (const b of blockers) {
      const worse = b.parUnitsAfter != null && b.parUnitsAfter > 1
        ? ` — ${b.parUnitsAfter.toFixed(2)} par-units of ${b.subItem} for ONE ${LABEL}`
        : "";
      console.log(`    · ${b.recipe}: ${b.quantity} ${LABEL} of ${b.subItem}, which declares no oz_per_par_unit${worse}`);
      console.log(`      UNBLOCK: weigh a finished ${b.subItem} par-unit, set items.oz_per_par_unit (id ${b.subItemId}), re-run.`);
    }
    console.log("");
    console.log("  Be aware, per #271: declaring those weights also exposes the missing-water");
    console.log("  recipes to the mass-balance guard. That is a real finding and its own arc.");
    console.log("");
    console.log("NOTHING WAS WRITTEN. Seed 23 done (gate closed).");
    return;
  }

  console.log("── GATE: OPEN ──");
  console.log(consumers.length === 0
    ? "  No item-ref line consumes this unit, so nothing can be re-denominated by registering it."
    : "  Every consuming line converts through a declared finished weight.");
  console.log("");

  if (!EXECUTE) {
    const verb = existing ? (existing.active === false ? "REACTIVATE + correct" : "correct") : "INSERT";
    console.log(`WOULD ${verb}: measure_units{ label="${LABEL}", dimension="${DIMENSION}", to_base_factor=${TO_BASE_FACTOR} }`);
    console.log("\nNOTHING WAS WRITTEN. Re-run with --execute. Seed 23 done (dry run).");
    return;
  }

  // ── Write, mirroring addMeasureUnit's shape exactly ─────────────────────────
  const now = new Date().toISOString();
  if (existing) {
    const { error } = await sb.from("measure_units")
      .update({ active: true, dimension: DIMENSION, to_base_factor: TO_BASE_FACTOR, updated_at: now })
      .eq("id", existing.id);
    if (error) throw new Error(`measure_units update failed: ${error.message}`);
  } else {
    const { data: maxRow } = await sb.from("measure_units")
      .select("display_order").order("display_order", { ascending: false }).limit(1)
      .maybeSingle<{ display_order: number }>();
    const { error } = await sb.from("measure_units").insert({
      label: LABEL, dimension: DIMENSION, to_base_factor: TO_BASE_FACTOR,
      display_order: (maxRow?.display_order ?? 0) + 1,
    });
    if (error) throw new Error(`measure_units insert failed: ${error.message}`);
  }

  // Read back from the destination (AGENTS.md discipline zero).
  const { data: after, error: afterErr } = await sb.from("measure_units")
    .select("id, label, dimension, to_base_factor, active").eq("label", LABEL)
    .maybeSingle<{ id: string; label: string; dimension: string; to_base_factor: number | string; active: boolean }>();
  if (afterErr || !after) throw new Error(`measure_units read-back failed: ${afterErr?.message ?? "no row"}`);
  console.log(`WROTE: ${after.label} = ${after.dimension} x${num(after.to_base_factor)} (active=${after.active})`);

  await audit({
    actorId: null,
    actorRole: null,
    action: "measure_unit.create",
    resourceTable: "measure_units",
    resourceId: after.id,
    ipAddress: null,
    userAgent: null,
    metadata: {
      phase: "2026-08-20 costing cleanup — seed 23",
      reason: RULING,
      source: SOURCE,
      label: LABEL,
      dimension: DIMENSION,
      to_base_factor: TO_BASE_FACTOR,
      consuming_lines: consumers.map((c) => ({
        recipe: c.recipe, sub_item: c.subItem, quantity: c.quantity,
        par_units_before: c.parUnitsToday, par_units_after: c.parUnitsAfter,
      })),
      actor_context: "seed_script",
    },
  });

  console.log("\nSeed 23 done (execute).");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
