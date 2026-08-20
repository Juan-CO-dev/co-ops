/**
 * Seed 14 — STAGED shallow (count-terminated) pack-chain backfill for NON-RAW
 * SKUs (council 2026-07-28, PR-A). STAGED: prod apply deferred to Juan's go.
 *
 * WHY: packaging / cleaning / misc SKUs have no meaningful ounces, so seed 13
 * (which needs each_size + each_measure to reach oz) skips them — yet ORDERS
 * need their pack counts ("case of 12"). Under the PR-A class-aware leaf law a
 * non-raw chain may terminate at a BARE COUNT leaf (no avg required); it is
 * COMPLETE BY DESIGN, never flagged unverified. This seed pre-fills those
 * shallow order chains from the existing legacy flat fields so the completion
 * campaign finishes for non-raw classes in one pass instead of a tap-a-thon.
 *
 * WHAT IT DOES: for every ACTIVE non-raw-class SKU that has NO active chain and
 * usable legacy pack data (pack_format + units_per_pack > 1), generate a
 * two-level count chain:
 *      root = canonicalContainerLabel(pack_format)  ->  units_per_pack × "inner"
 *      "inner"                                       ->  1 × the MEASURE "each"
 * i.e. "case → 12 inner ; inner → 1 each". The leaf is the count-dim measure
 * "each" (NOT an avg-requiring one) — the shallow order chain. SKUs with garbage
 * or missing legacy data (no pack_format, or units_per_pack null/≤1) are SKIPPED
 * and PRINTED — never guessed; they surface via the /admin/skus "No pack info"
 * lens for a human to author.
 *
 * ── L1 COLLISION SAFETY (identical to seed 13; the BC class caught twice) ─────
 * A chain label must NEVER equal an ACTIVE measure_units label, because
 * ozForRecipeInput is chain-FIRST: on a chained SKU a recipe line whose unit
 * matches a chain label walks the chain BEFORE the measure registry is consulted
 * → a container answer where a measure was meant (a silent N× error). Seed 10
 * registered "each" AND "unit" as active count-dim measure_units. So this seed
 * (a) uses the NON-COLLIDING container label "inner" for the leaf CONTAINER
 * (never "each"), and a canonicalized pack_format for the root (canonicalizer
 * maps the each-style "Each (no case)" to "container", never "unit"), and (b)
 * runs firstLabelMeasureCollision — the SAME guard lib/admin/pack-chain.ts
 * enforces on the write path — over EVERY generated chain and FAILS LOUDLY
 * (exit 1) on any collision. It also hard-stops up front if the chosen labels or
 * the "each" leaf measure have themselves drifted in the live registry.
 *
 * NOTE the leaf points at the MEASURE "each" while the leaf CONTAINER level is
 * labeled "inner" — the label ("inner") and the contains_measure_unit ("each")
 * are different columns, so this is NOT a collision (a level LABELED "each"
 * would be; a level labeled "inner" that CONTAINS the measure "each" is fine and
 * is exactly what a count chain is).
 *
 * Idempotent: re-running supersedes the active chain set for each backfilled SKU
 * (deactivate all active rows, insert the fresh set) — matches the lib's
 * supersede-as-a-SET. Safe to run repeatedly.
 *
 *   SEED_DRY=1 npx tsx --conditions=react-server --env-file=.env.local scripts/seed/14-shallow-pack-chains.ts   (report only)
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/seed/14-shallow-pack-chains.ts               (write)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { firstLabelMeasureCollision } from "@/lib/pack-chain-shared";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

// Reuse seed 13's non-colliding labels EXACTLY (L1 fix). "inner" = the leaf
// CONTAINER level (was the colliding "each"); "container" = the depth-1 /
// each-style root (was the colliding "unit"). Verified against the live
// measure_units set at runtime and gated by firstLabelMeasureCollision.
const EACH_LEVEL_LABEL = "inner";
const CONTAINER_LABEL = "container";
// The count-dim MEASURE the shallow chain terminates in (seed 10 registered it).
const COUNT_LEAF_MEASURE = "each";

// Non-raw classes: everything the shallow-chain campaign covers. Raw SKUs need
// oz-terminated chains (seed 13's job) and are excluded here.
const NON_RAW_CLASSES = new Set(["packaging", "cleaning", "misc"]);

/** Canonical container label from a free-text pack_format (L6 casing drift) —
 *  IDENTICAL to seed 13's canonicalizer. Never returns a measure-unit label:
 *  "Each (no case)" → the non-colliding CONTAINER_LABEL (not the measure "unit"). */
function canonicalContainerLabel(packFormat: string | null): string {
  if (!packFormat) return "pack";
  const p = packFormat.trim().toLowerCase();
  if (p.startsWith("each")) return CONTAINER_LABEL;
  return p;
}

interface SkuRow {
  id: string;
  name: string;
  sku_class: string | null;
  pack_format: string | null;
  units_per_pack: number | null;
}

interface LevelRow {
  id: string;
  sku_id: string;
  label: string;
  contains_qty: number;
  contains_level_id: string | null;
  contains_measure_unit: string | null;
  display_ordinal: number;
  effective_from: string;
  active: boolean;
  created_by: null;
}

/**
 * Build the shallow count chain for one non-raw SKU, or null if the legacy data
 * is unusable (no pack_format, or units_per_pack null/≤1 → nothing to count).
 * "case → upp inner ; inner → 1 each".
 */
function buildShallowLevels(sku: SkuRow, now: string): LevelRow[] | null {
  const upp = sku.units_per_pack;
  if (upp == null || !Number.isFinite(upp) || upp <= 1) return null; // nothing countable → skip
  const packLabel = canonicalContainerLabel(sku.pack_format);
  // Never let the root label equal the leaf container label (defensive).
  const rootLabel = packLabel === EACH_LEVEL_LABEL ? "pack" : packLabel;

  const innerId = randomUUID();
  const packId = randomUUID();
  return [
    {
      id: packId, sku_id: sku.id, label: rootLabel, contains_qty: upp,
      contains_level_id: innerId, contains_measure_unit: null,
      display_ordinal: 0, effective_from: now, active: true, created_by: null,
    },
    {
      id: innerId, sku_id: sku.id, label: EACH_LEVEL_LABEL, contains_qty: 1,
      contains_level_id: null, contains_measure_unit: COUNT_LEAF_MEASURE,
      display_ordinal: 1, effective_from: now, active: true, created_by: null,
    },
  ];
}

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");
  const now = new Date().toISOString();

  // L1 collision safety: load the ACTIVE measure_units labels once (same guard
  // the write path enforces). Every generated chain label is checked against it.
  const { data: measureRows, error: muErr } = await sb
    .from("measure_units").select("label").eq("active", true)
    .returns<Array<{ label: string }>>();
  if (muErr) throw new Error(`load measure_units: ${muErr.message}`);
  const measureLabels = new Set((measureRows ?? []).map((m) => m.label));

  // Hard-stop up front if the chosen non-colliding container labels have
  // themselves become active measure units (someone could register "inner"/
  // "container" later) — a silent-shadow regression becomes a loud stop.
  for (const lbl of [EACH_LEVEL_LABEL, CONTAINER_LABEL]) {
    if (measureLabels.has(lbl)) {
      console.error(`FATAL: the non-colliding container label "${lbl}" is now an ACTIVE measure_units label — pick a different container label (seed 14 L1 guard).`);
      process.exit(1);
    }
  }
  // The shallow chain MUST terminate in the count-dim measure "each"; if that
  // measure isn't registered/active, the chain would be structurally invalid.
  if (!measureLabels.has(COUNT_LEAF_MEASURE)) {
    console.error(`FATAL: the count leaf measure "${COUNT_LEAF_MEASURE}" is not an ACTIVE measure_units label — cannot terminate a shallow chain (seed 14). Register it (seed 10) first.`);
    process.exit(1);
  }

  // Non-raw SKUs only. sku_class rides the 0157 STAGED migration.
  const { data: skus, error } = await sb
    .from("vendor_items")
    .select("id, name, sku_class, pack_format, units_per_pack")
    .eq("active", true)
    .returns<SkuRow[]>();
  if (error) throw new Error(`load skus: ${error.message}`);

  // Which SKUs already have an active chain? (Skip those — this seed only fills
  // the currently-chainless non-raw SKUs; it never overwrites an authored chain.)
  const { data: chainRows, error: chErr } = await sb
    .from("sku_pack_levels").select("sku_id").eq("active", true)
    .returns<Array<{ sku_id: string }>>();
  if (chErr) throw new Error(`load existing chains: ${chErr.message}`);
  const alreadyChained = new Set((chainRows ?? []).map((r) => r.sku_id));

  const backfilled: string[] = [];
  const skippedGarbage: string[] = []; // non-raw, chainless, but no usable pack data
  let levelsWritten = 0;

  for (const sku of skus ?? []) {
    const klass = (sku.sku_class ?? "raw");
    if (!NON_RAW_CLASSES.has(klass)) continue; // raw = seed 13's territory
    if (alreadyChained.has(sku.id)) continue; // never overwrite an authored chain

    const levels = buildShallowLevels(sku, now);
    if (!levels) {
      skippedGarbage.push(`${sku.name}  (class=${klass}, pack_format=${sku.pack_format ?? "—"}, units_per_pack=${sku.units_per_pack ?? "—"})`);
      continue;
    }

    // L1 GATE (the guard the write path always enforces; the BC class was caught
    // twice). Fail LOUDLY — never write a shadowing chain.
    const collision = firstLabelMeasureCollision(levels.map((l) => l.label), measureLabels);
    if (collision != null) {
      console.error(`FATAL: SKU "${sku.name}" would get chain label "${collision}", which IS an active measure_units label — it would shadow that measure unit in the chain-first ozForRecipeInput. Aborting (no writes past this point). Fix the label generator (seed 14 L1 guard).`);
      process.exit(1);
    }

    if (!DRY) {
      const { error: deErr } = await sb.from("sku_pack_levels").update({ active: false }).eq("sku_id", sku.id).eq("active", true);
      if (deErr) throw new Error(`deactivate ${sku.name}: ${deErr.message}`);
      const { error: insErr } = await sb.from("sku_pack_levels").insert(levels);
      if (insErr) throw new Error(`insert ${sku.name}: ${insErr.message}`);
      void audit({ actorId: null, actorRole: null, action: "sku.pack_chain_update", resourceTable: "sku_pack_levels", resourceId: sku.id, metadata: { name: sku.name, sku_class: klass, level_count: levels.length, labels: levels.map((l) => l.label), leaf_measure: COUNT_LEAF_MEASURE, phase: "shallow_pack_chain_backfill", source: "seed_14" }, ipAddress: null, userAgent: null });
    }
    levelsWritten += levels.length;
    backfilled.push(`${sku.name}  (${klass}: ${canonicalContainerLabel(sku.pack_format)} → ${sku.units_per_pack} inner → each)`);
  }

  console.log(`\nBackfilled (shallow count chains, non-raw): ${backfilled.length} SKUs → ${levelsWritten} chain levels${DRY ? " (would write)" : ""}.`);
  for (const n of backfilled.sort()) console.log(`  ✓ ${n}`);
  console.log(`\nSKIPPED — non-raw + no usable legacy pack data (surface via the "No pack info" lens; NOT guessed): ${skippedGarbage.length}`);
  for (const n of skippedGarbage.sort()) console.log(`  · ${n}`);
  console.log("\nSeed 14 done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
