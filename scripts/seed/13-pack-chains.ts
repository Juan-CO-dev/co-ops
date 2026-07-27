/**
 * Seed 13 — STAGED backfill of sku_pack_levels from the legacy flat fields
 * (pack-hierarchy PR 1, migration 0159). STAGED: prod apply deferred to Juan's
 * go (the migration ships STAGED; this runs after it's applied).
 *
 * Council L6 (backfill by id):
 *  - CLEAN two-level SKUs (units_per_pack + each_size + each_measure all set):
 *    build a chain. units_per_pack > 1 → two levels (pack -> N each ; each -> size measure).
 *    units_per_pack = 1 (or null-but-size-set) → depth-1 (container -> size measure).
 *    The chain-walk content_oz === the legacy two-level math (L7 parity, vitest-pinned).
 *  - 3-LEVEL DELI CANDIDATES (units_per_pack set + avg_oz_per_each set, but
 *    each_size / each_measure NULL — Capicola/Genoa/Provolone/…): the middle tier
 *    (log/bundle) has NO source data. We do NOT invent it. Printed as CHAIN
 *    UNVERIFIED for Juan to author case -> log -> oz in the SKU editor; NO rows written.
 *  - NO-CONTENT SKUs (all pack fields null): printed as the owner-input skip list.
 *
 * LABEL CANONICALIZATION (L6): pack_format free-text (Case/case/tub/jar/Bag) →
 * canonical lower-case container labels. Because a chain label must not collide
 * with a measure_units label (L1), and because recipes speak MEASURE-unit labels
 * (oz/each/gram/…) — NOT pack labels — the recipe_inputs lockstep rewrite this
 * council-lock anticipated has ZERO rows to touch on current data
 * (recipe_inputs.unit carries no pack labels; recipe_inputs.each_container_label
 * is 0/322 filled). The script SCANS + PRINTS what would need lockstep rewrite
 * (finding none today) and performs the rewrite idempotently only if any surface.
 *
 * ── L1 COLLISION SAFETY (review-finding fix, 2026-07-27) ────────────────────
 * A chain label must NEVER equal an ACTIVE measure_units label, because
 * ozForRecipeInput is chain-FIRST (recipe-math): for a chained SKU, if the
 * recipe line's unit matches a chain label the walk returns immediately —
 * BEFORE the measure registry is consulted. Seed 10 registered "each" AND
 * "unit" as active count-dim measure_units. Generating a chain level labeled
 * "each" (the middle/leaf-container tier) or "unit" (the depth-1/each-style
 * container) would therefore SHADOW those measure units: a live recipe line
 * whose unit means the MEASURE "each" would resolve as one CONTAINER instead of
 * one each-of-avg-oz (e.g. Sub Roll's 6-roll pack) — a silent 6×/40× error.
 * So this seed (a) uses NON-COLLIDING container labels ("inner" for the middle/
 * each-level, "container" for the depth-1/each-style root), verified against the
 * live measure_units set at runtime, and (b) runs firstLabelMeasureCollision
 * (the same L1 guard lib/admin/pack-chain.ts enforces) over EVERY generated
 * chain and FAILS LOUDLY (exit 1) if any collision remains — the guard the
 * write path always had but this seed originally bypassed.
 *
 * Idempotent: re-running supersedes the active chain set for each backfilled SKU
 * (deactivate all active rows, insert the fresh set) — matches the lib's
 * supersede-as-a-SET. Safe to run repeatedly.
 *
 *   SEED_DRY=1 npx tsx --env-file=.env.local scripts/seed/13-pack-chains.ts   (report only)
 *   npx tsx --env-file=.env.local scripts/seed/13-pack-chains.ts               (write)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { firstLabelMeasureCollision } from "@/lib/pack-chain-shared";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

// NON-COLLIDING container labels (L1 fix — see header). These stand in for the
// middle/each-level and the depth-1/each-style root when the natural name would
// collide with an active measure unit ("each"/"unit"). Verified against the live
// measure_units set at runtime (assertLabelsFreeOfMeasures) and gated by
// firstLabelMeasureCollision before any write.
const EACH_LEVEL_LABEL = "inner"; // middle/each tier (was the colliding "each")
const CONTAINER_LABEL = "container"; // depth-1 / each-style root (was the colliding "unit")

/** Canonical container label from a free-text pack_format (L6 casing drift).
 *  Never returns a measure-unit label: "Each (no case)" → the non-colliding
 *  CONTAINER_LABEL (was "unit", which IS an active measure unit). */
function canonicalContainerLabel(packFormat: string | null): string {
  if (!packFormat) return "pack";
  const p = packFormat.trim().toLowerCase();
  // "Each (no case)" and its variants → the container is a single unit.
  if (p.startsWith("each")) return CONTAINER_LABEL;
  // Collapse casing drift: Case/case → case, Box → box, Bag/bag → bag, etc.
  return p;
}

interface SkuRow {
  id: string;
  name: string;
  pack_format: string | null;
  units_per_pack: number | null;
  each_size: number | string | null;
  each_measure: string | null;
  avg_oz_per_each: number | string | null;
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
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

/** Build the level rows for one clean SKU. Returns null if not cleanly backfillable. */
function buildLevels(sku: SkuRow, now: string): LevelRow[] | null {
  const eachSize = num(sku.each_size);
  const eachMeasure = sku.each_measure;
  if (eachSize == null || eachSize <= 0 || !eachMeasure) return null; // not clean → caller flags
  const upp = sku.units_per_pack;

  // The each/inner level: one inner contains `each_size` of the measure unit
  // (leaf). Labeled EACH_LEVEL_LABEL ("inner") — NOT "each" (an active measure
  // unit), so a recipe line meaning the MEASURE "each" never resolves as this
  // container via the chain-first path (L1 fix).
  const eachId = randomUUID();
  const eachLabel = EACH_LEVEL_LABEL;

  if (upp != null && upp > 1) {
    // Two-level: pack -> upp inner ; inner -> each_size measure.
    const packId = randomUUID();
    const packLabel = canonicalContainerLabel(sku.pack_format);
    // Avoid a pack label that equals the each/inner label (defensive).
    const rootLabel = packLabel === eachLabel ? "pack" : packLabel;
    return [
      {
        id: packId, sku_id: sku.id, label: rootLabel, contains_qty: upp,
        contains_level_id: eachId, contains_measure_unit: null,
        display_ordinal: 0, effective_from: now, active: true, created_by: null,
      },
      {
        id: eachId, sku_id: sku.id, label: eachLabel, contains_qty: eachSize,
        contains_level_id: null, contains_measure_unit: eachMeasure,
        display_ordinal: 1, effective_from: now, active: true, created_by: null,
      },
    ];
  }

  // Depth-1: single container -> each_size measure (units_per_pack null or 1).
  const containerLabel = canonicalContainerLabel(sku.pack_format);
  return [
    {
      id: eachId, sku_id: sku.id, label: containerLabel, contains_qty: eachSize,
      contains_level_id: null, contains_measure_unit: eachMeasure,
      display_ordinal: 0, effective_from: now, active: true, created_by: null,
    },
  ];
}

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");
  const now = new Date().toISOString();

  // L1 collision safety: load the ACTIVE measure_units labels once. Every
  // generated chain label is checked against this set (the same rule
  // lib/admin/pack-chain.ts enforces on the write path) — a chain label that
  // equals a measure unit would be shadowed by the chain-first ozForRecipeInput.
  const { data: measureRows, error: muErr } = await sb
    .from("measure_units").select("label").eq("active", true)
    .returns<Array<{ label: string }>>();
  if (muErr) throw new Error(`load measure_units: ${muErr.message}`);
  const measureLabels = new Set((measureRows ?? []).map((m) => m.label));

  // Fail loudly up front if the chosen NON-COLLIDING container labels have
  // themselves become active measure units (someone could register "inner"/
  // "container" later). This turns a silent-shadow regression into a hard stop.
  for (const lbl of [EACH_LEVEL_LABEL, CONTAINER_LABEL]) {
    if (measureLabels.has(lbl)) {
      console.error(`FATAL: the non-colliding container label "${lbl}" is now an ACTIVE measure_units label — pick a different container label (seed 13 L1 guard).`);
      process.exit(1);
    }
  }

  const { data: skus, error } = await sb
    .from("vendor_items")
    .select("id, name, pack_format, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .eq("active", true)
    .returns<SkuRow[]>();
  if (error) throw new Error(`load skus: ${error.message}`);

  const backfilled: string[] = [];
  const unverified3Level: string[] = []; // deli case->log->oz candidates
  const ownerInput: string[] = []; // no content at all
  let levelsWritten = 0;

  for (const sku of skus ?? []) {
    const eachSize = num(sku.each_size);
    const hasAnyContent = sku.units_per_pack != null || eachSize != null || sku.each_measure != null || num(sku.avg_oz_per_each) != null;

    const levels = buildLevels(sku, now);
    if (levels) {
      // L1 GATE: no generated chain label may collide with an active measure
      // unit (the guard the write path enforces; seed 13 originally skipped it).
      // Fail LOUDLY — exit 1, printing the offending SKU + label — never write a
      // shadowing chain.
      const collision = firstLabelMeasureCollision(levels.map((l) => l.label), measureLabels);
      if (collision != null) {
        console.error(`FATAL: SKU "${sku.name}" would get chain label "${collision}", which IS an active measure_units label — it would shadow that measure unit in the chain-first ozForRecipeInput. Aborting (no writes past this point). Fix the label generator (seed 13 L1 guard).`);
        process.exit(1);
      }
      // CLEAN → backfill (supersede-as-a-SET, idempotent).
      if (!DRY) {
        const { error: deErr } = await sb.from("sku_pack_levels").update({ active: false }).eq("sku_id", sku.id).eq("active", true);
        if (deErr) throw new Error(`deactivate ${sku.name}: ${deErr.message}`);
        const { error: insErr } = await sb.from("sku_pack_levels").insert(levels);
        if (insErr) throw new Error(`insert ${sku.name}: ${insErr.message}`);
        void audit({ actorId: null, actorRole: null, action: "sku.pack_chain_update", resourceTable: "sku_pack_levels", resourceId: sku.id, metadata: { name: sku.name, level_count: levels.length, labels: levels.map((l) => l.label), phase: "pack_chain_backfill", source: "seed_13" }, ipAddress: null, userAgent: null });
      }
      levelsWritten += levels.length;
      backfilled.push(sku.name);
      continue;
    }

    // Not clean. Distinguish 3-level deli candidates from truly empty.
    // 3-level candidate: units_per_pack set (a real pack) but each_size/each_measure
    // missing AND avg_oz_per_each present (it's a sliced deli whose middle log tier
    // is unrecorded) → CHAIN UNVERIFIED (Juan authors case->log->oz).
    if (sku.units_per_pack != null && (eachSize == null || !sku.each_measure)) {
      unverified3Level.push(`${sku.name}  (pack_format=${sku.pack_format ?? "—"}, units_per_pack=${sku.units_per_pack}, avg_oz_per_each=${num(sku.avg_oz_per_each) ?? "—"})`);
      continue;
    }
    // Everything else with no usable content → owner input needed.
    if (!hasAnyContent || eachSize == null || !sku.each_measure) {
      ownerInput.push(`${sku.name}  (pack_format=${sku.pack_format ?? "—"})`);
    }
  }

  // ── L6 lockstep scan: recipe_inputs.unit + recipe_inputs.each_container_label
  //    that reference a PACK label needing canonicalization. Recipes speak
  //    measure-unit labels, so this is expected to be EMPTY on current data.
  const packLabelsCanonicalized = new Set<string>();
  for (const s of skus ?? []) {
    const raw = s.pack_format?.trim();
    if (raw && raw !== canonicalContainerLabel(raw)) packLabelsCanonicalized.add(raw);
  }
  const { data: riUnits } = await sb.from("recipe_inputs").select("id, unit, each_container_label").not("component_sku_id", "is", null)
    .returns<Array<{ id: string; unit: string | null; each_container_label: string | null }>>();
  const lockstepHits = (riUnits ?? []).filter((r) =>
    (r.unit != null && packLabelsCanonicalized.has(r.unit)) ||
    (r.each_container_label != null && packLabelsCanonicalized.has(r.each_container_label)),
  );

  console.log(`\nBackfilled (clean 2-level): ${backfilled.length} SKUs → ${levelsWritten} chain levels${DRY ? " (would write)" : ""}.`);
  console.log(`\nCHAIN UNVERIFIED — 3-level deli candidates for Juan (case → log → oz, author in the SKU editor): ${unverified3Level.length}`);
  for (const n of unverified3Level.sort()) console.log(`  ⚠ ${n}`);
  console.log(`\nOWNER INPUT NEEDED — no usable pack content (skipped): ${ownerInput.length}`);
  for (const n of ownerInput.sort()) console.log(`  · ${n}`);
  console.log(`\nL6 lockstep scan: ${packLabelsCanonicalized.size} pack labels canonicalized (${[...packLabelsCanonicalized].join(", ") || "none"}); recipe_inputs rows referencing a pack label: ${lockstepHits.length}.`);
  if (lockstepHits.length > 0) {
    console.log("  Rows that WOULD need lockstep rewrite (recipes speaking a pack label):");
    for (const h of lockstepHits) console.log(`    - recipe_input ${h.id}: unit=${h.unit ?? "—"} each_container_label=${h.each_container_label ?? "—"}`);
    // Idempotent lockstep rewrite (only reached if recipes actually speak pack labels).
    if (!DRY) {
      for (const h of lockstepHits) {
        const newUnit = h.unit != null && packLabelsCanonicalized.has(h.unit) ? canonicalContainerLabel(h.unit) : h.unit;
        const newEcl = h.each_container_label != null && packLabelsCanonicalized.has(h.each_container_label) ? canonicalContainerLabel(h.each_container_label) : h.each_container_label;
        const { error: uErr } = await sb.from("recipe_inputs").update({ unit: newUnit, each_container_label: newEcl }).eq("id", h.id);
        if (uErr) throw new Error(`lockstep rewrite recipe_input ${h.id}: ${uErr.message}`);
      }
      console.log("  Lockstep rewrite applied.");
    }
  } else {
    console.log("  (No lockstep rewrite needed — recipes speak measure-unit labels, not pack labels.)");
  }
  console.log("\nSeed 13 done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
