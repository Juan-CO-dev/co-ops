/**
 * Seed 16 — Angel data arc SKU fixes: duplicate-twin reconciliation + the Arugula
 * pack correction. Two independent, idempotent, append-only fixes.
 *
 * ── FIX 1: the Ham / Fresh Mozzarella duplicate pairs (report J1) ──────────────
 * The reconciliation report flags $3,531 of top-20 spend flowing through two
 * duplicated SKU identities, because "a price written to the wrong twin is
 * invisible" — the twin the recipes reference stays unpriced. This script asserts
 * the resolved end-state rather than assuming it: for each known twin it verifies
 * the orphan is inactive AND carries zero references (recipe_inputs, delivery
 * lines, PO lines, price history), and deactivates it only if it is still active.
 *
 * EXPECTED RESULT TODAY: no-op. Seed 11 (scripts/seed/11-data-cleanup.ts) already
 * deactivated both PFG orphans during the depletion-wiring arc, and the report's
 * own §B.2 describes them as INACTIVE. This script is the standing assertion that
 * they STAY that way, and the place the fix would live had it not already landed.
 * A no-op run that PROVES the invariant is the point; it is not dead code.
 *
 * Note what the report's "ambiguity" actually is now: not two live twins, but that
 * Angel's row is a PFG product while the surviving SKU sits under Baldor. That is a
 * vendor-attribution question (same family as J2/J9), not a dedupe, and it is NOT
 * resolved here — re-pointing a SKU's vendor is its own reviewed decision.
 *
 * ── FIX 2: PFG/Arugula pack 48 oz → 64 oz (report W3) ─────────────────────────
 * The single highest-value pack-data error in the dataset. Our chain models a
 * 48 oz case inherited from a legacy Baldor pack; Angel's PFG pack is `2/2 LB`
 * = 64 oz, corroborated by the US Foods row for the same product (also 2/2 LB).
 * At $1,468 combined spend the stale 48 silently understates arugula depletion by
 * 33% on every recipe that consumes it.
 *
 * MECHANISM — this is the part that is easy to get wrong. The flat pack columns
 * (each_size / each_measure / units_per_pack / pack_format) are MACHINE-DERIVED and
 * must never be hand-edited: lib/admin/pack-chain.ts syncs them from the chain on
 * every write. The chain in sku_pack_levels is the source of truth. So this fix
 * follows replaceSkuPackChain's exact semantics — supersede-as-a-SET (deactivate
 * the whole active set, insert a fresh set with a new effective_from; never an
 * in-place row UPDATE, never a DELETE) — and then derives the flat fields through
 * the same pure `deriveFlatFieldsFromChain` the lib's private sync uses, so the two
 * representations cannot drift. The lib function itself is not called directly: it
 * requires an AuthContext at role level 7+, and a seed has no actor. This mirrors
 * seed 13, which writes chains the same way for the same reason.
 *
 * L1 collision guard (seed 13's law): a chain label that equals an active
 * measure_units label is SHADOWED by the chain-first ozForRecipeInput walk, turning
 * a measure into a container silently. Every label written here is checked and the
 * script exits 1 on a collision rather than writing.
 *
 * Idempotent: re-running detects the already-correct chain and writes nothing.
 *
 * Run: SEED_DRY=1 npx tsx --conditions=react-server --env-file=.env.local scripts/seed/16-angel-sku-fixes.ts  (report only)
 *      npx tsx --conditions=react-server --env-file=.env.local scripts/seed/16-angel-sku-fixes.ts              (write)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { firstLabelMeasureCollision } from "@/lib/pack-chain-shared";
import { deriveFlatFieldsFromChain } from "@/lib/admin/catalog-shared";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

/** The orphan twins. Identified by id (not name) because both twins share a name —
 *  matching by name is exactly how a dedupe hits the wrong row. */
const ORPHAN_TWINS: Array<{ id: string; name: string; keeper: string; note: string }> = [
  {
    id: "804cb32d-ea68-4467-8479-b82f34a143a0",
    name: "Ham",
    keeper: "15944b2d-881b-419e-bcdb-8d8c5412de5a (Baldor/Ham — recipe-referenced, avg_oz_per_each set)",
    note: "PFG twin; auto-placeholder with no pack content and zero recipe uses",
  },
  {
    id: "27066f2a-8e5c-4c60-8a0f-a62980241998",
    name: "Fresh Mozzarella",
    keeper: "c35dfb4f-492a-43e9-8551-3a0558b695f7 (Baldor/Fresh Mozzarella — recipe-referenced, 72×1 each chain)",
    note: "PFG twin; auto-placeholder with no pack chain and zero recipe uses",
  },
];

/** The Arugula correction. `skuId` is pinned so a name match can never redirect it. */
const ARUGULA = {
  skuId: "fa14310e-aaa0-4376-be09-09a39f49ddab",
  name: "Arugula",
  fromOz: 48,
  toOz: 64,
  label: "case",
  measure: "oz",
  evidence: "Angel PFG row `ARUGULA BABY` pack_size_raw `2/2 LB` (est_case_weight_lb 4.0), corroborated by US Foods `Arugula, Baby ...` also `2/2 LB`",
};

interface TwinRefs { recipe: number; delivery: number; po: number; price: number }

async function countTwinRefs(sb: ReturnType<typeof getServiceRoleClient>, skuId: string): Promise<TwinRefs> {
  const [r, d, p, h] = await Promise.all([
    sb.from("recipe_inputs").select("id", { count: "exact", head: true }).eq("component_sku_id", skuId),
    sb.from("vendor_delivery_items").select("id", { count: "exact", head: true }).eq("vendor_item_id", skuId),
    sb.from("po_lines").select("id", { count: "exact", head: true }).eq("sku_id", skuId),
    sb.from("vendor_price_history").select("id", { count: "exact", head: true }).eq("vendor_item_id", skuId),
  ]);
  return { recipe: r.count ?? 0, delivery: d.count ?? 0, po: p.count ?? 0, price: h.count ?? 0 };
}

async function fixTwins(sb: ReturnType<typeof getServiceRoleClient>): Promise<void> {
  console.log("── FIX 1: duplicate-twin reconciliation (report J1) ──");
  let deactivated = 0, alreadyInactive = 0, blocked = 0;

  for (const t of ORPHAN_TWINS) {
    const { data: row, error } = await sb
      .from("vendor_items").select("id, name, active").eq("id", t.id)
      .maybeSingle<{ id: string; name: string; active: boolean }>();
    if (error) throw new Error(`load twin ${t.name}: ${error.message}`);
    if (!row) { console.log(`  ! ${t.name} orphan ${t.id} NOT FOUND — skipping`); continue; }

    const refs = await countTwinRefs(sb, t.id);
    const refTotal = refs.recipe + refs.delivery + refs.po + refs.price;
    const refStr = `recipes=${refs.recipe} deliveries=${refs.delivery} po_lines=${refs.po} prices=${refs.price}`;

    if (!row.active) {
      alreadyInactive++;
      console.log(`  = ${t.name} orphan already INACTIVE (${refStr}) — no write. Keeper: ${t.keeper}`);
      if (refTotal > 0) console.warn(`    ! orphan still carries ${refTotal} reference(s) — worth a look, but NOT re-pointed here`);
      continue;
    }

    // Still active. Refuse to deactivate anything that is actually referenced —
    // deactivating a referenced SKU strands the reference instead of fixing it.
    if (refTotal > 0) {
      blocked++;
      console.warn(`  ! ${t.name} orphan ${t.id} is ACTIVE and REFERENCED (${refStr}) — REFUSING to deactivate. Re-point the references first (J1).`);
      continue;
    }

    deactivated++;
    console.log(`  ${DRY ? "would deactivate" : "- deactivating"} ${t.name} orphan ${t.id} (${refStr})`);
    if (!DRY) {
      const { error: uErr } = await sb
        .from("vendor_items")
        .update({ active: false, updated_at: new Date().toISOString(), updated_by: null })
        .eq("id", t.id);
      if (uErr) throw new Error(`deactivate ${t.name}: ${uErr.message}`);
      void audit({
        actorId: null, actorRole: null,
        action: "sku.deduplicate", resourceTable: "vendor_items", resourceId: t.id,
        metadata: {
          name: t.name, note: t.note, keeper: t.keeper, references_at_deactivation: refs,
          phase: "angel_data_arc", reason: "angel_reconciliation_j1_duplicate_twin",
          source_report: "docs/seed/source/angel-reconciliation-report.md §B.2 / J1",
        },
        ipAddress: null, userAgent: null,
      });
    }
  }

  console.log(`  → ${deactivated} deactivated, ${alreadyInactive} already inactive, ${blocked} blocked.`);
  if (deactivated === 0 && blocked === 0) {
    console.log("  ✓ INVARIANT HOLDS: both duplicate pairs already resolved (seed 11); recipes point at the surviving twin.\n");
  } else {
    console.log("");
  }
}

async function fixArugula(sb: ReturnType<typeof getServiceRoleClient>): Promise<void> {
  console.log("── FIX 2: PFG/Arugula pack 48 oz → 64 oz (report W3) ──");

  const { data: sku, error: sErr } = await sb
    .from("vendor_items").select("id, name, each_size, each_measure, units_per_pack, pack_format, sku_class")
    .eq("id", ARUGULA.skuId)
    .maybeSingle<{ id: string; name: string; each_size: number | string | null; each_measure: string | null; units_per_pack: number | null; pack_format: string | null; sku_class: string }>();
  if (sErr) throw new Error(`load Arugula: ${sErr.message}`);
  if (!sku) { console.log(`  ! Arugula SKU ${ARUGULA.skuId} NOT FOUND — skipping`); return; }
  if (sku.name !== ARUGULA.name) {
    throw new Error(`FATAL: SKU ${ARUGULA.skuId} is named "${sku.name}", expected "${ARUGULA.name}" — refusing to rewrite the wrong SKU's pack chain.`);
  }

  const { data: levels, error: lErr } = await sb
    .from("sku_pack_levels")
    .select("id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal")
    .eq("sku_id", ARUGULA.skuId).eq("active", true)
    .order("display_ordinal", { ascending: true })
    .returns<Array<{ id: string; label: string; contains_qty: number | string; contains_level_id: string | null; contains_measure_unit: string | null; display_ordinal: number }>>();
  if (lErr) throw new Error(`load Arugula chain: ${lErr.message}`);

  const before = (levels ?? []).map((l) => `${l.label}=${Number(l.contains_qty)}${l.contains_measure_unit ?? "→level"}`).join(" / ") || "(no active chain)";
  console.log(`  before: chain [${before}] | flat each_size=${sku.each_size ?? "-"}${sku.each_measure ?? ""} units_per_pack=${sku.units_per_pack ?? "-"} pack_format=${sku.pack_format ?? "-"}`);

  // Guard: this fix only understands the depth-1 `case → N oz` shape it was written
  // for. If the chain has grown levels since the report, stop rather than flatten it.
  if ((levels ?? []).length !== 1) {
    console.warn(`  ! expected a single-level chain, found ${(levels ?? []).length} — REFUSING to rewrite (shape changed since the report; re-derive the fix).`);
    return;
  }
  const cur = levels![0]!;
  if (cur.contains_measure_unit !== ARUGULA.measure || cur.contains_level_id !== null) {
    console.warn(`  ! expected a leaf level in '${ARUGULA.measure}', found measure=${cur.contains_measure_unit ?? "null"} pointer=${cur.contains_level_id ?? "null"} — REFUSING to rewrite.`);
    return;
  }
  const curQty = Number(cur.contains_qty);
  if (curQty === ARUGULA.toOz) {
    console.log(`  = already ${ARUGULA.toOz} ${ARUGULA.measure} — no write.\n`);
    return;
  }
  if (curQty !== ARUGULA.fromOz) {
    console.warn(`  ! expected ${ARUGULA.fromOz} ${ARUGULA.measure}, found ${curQty} — REFUSING to rewrite (someone else changed it; re-adjudicate).`);
    return;
  }

  // The new chain: same depth-1 shape, corrected quantity. Index-linked, exactly
  // the PackChainLevelInput shape replaceSkuPackChain validates and the pure
  // deriveFlatFieldsFromChain consumes.
  const newLevels = [{
    label: ARUGULA.label,
    containsQty: ARUGULA.toOz,
    containsIndex: null as number | null,
    containsMeasureUnit: ARUGULA.measure as string | null,
  }];

  // L1 GATE — no chain label may equal an active measure_units label.
  const { data: measureRows, error: muErr } = await sb.from("measure_units").select("label").eq("active", true).returns<Array<{ label: string }>>();
  if (muErr) throw new Error(`load measure_units: ${muErr.message}`);
  const measureLabels = new Set((measureRows ?? []).map((m) => m.label));
  const collision = firstLabelMeasureCollision(newLevels.map((l) => l.label), measureLabels);
  if (collision != null) {
    console.error(`FATAL: chain label "${collision}" IS an active measure_units label — it would shadow that measure unit in the chain-first ozForRecipeInput. Aborting (no writes).`);
    process.exit(1);
  }
  if (!measureLabels.has(ARUGULA.measure)) {
    console.error(`FATAL: "${ARUGULA.measure}" is not a registered active measure unit. Aborting (no writes).`);
    process.exit(1);
  }

  // Flat fields come from the SAME pure derive the lib's sync-on-save uses —
  // never hand-authored.
  const flat = deriveFlatFieldsFromChain(newLevels);
  console.log(`  after:  chain [${ARUGULA.label}=${ARUGULA.toOz}${ARUGULA.measure}] | flat each_size=${flat.eachSize}${flat.eachMeasure} units_per_pack=${flat.unitsPerPack} pack_format=${flat.packFormat}`);
  console.log(`  evidence: ${ARUGULA.evidence}`);

  if (DRY) { console.log("  (dry run — no write)\n"); return; }

  // Supersede-as-a-SET: deactivate the whole active set, then insert the new one.
  const { error: deErr } = await sb.from("sku_pack_levels").update({ active: false }).eq("sku_id", ARUGULA.skuId).eq("active", true);
  if (deErr) throw new Error(`deactivate Arugula chain: ${deErr.message}`);

  const now = new Date().toISOString();
  const ids = newLevels.map(() => randomUUID());
  const rows = newLevels.map((lvl, i) => ({
    id: ids[i]!,
    sku_id: ARUGULA.skuId,
    label: lvl.label,
    contains_qty: lvl.containsQty,
    contains_level_id: lvl.containsIndex != null ? ids[lvl.containsIndex]! : null,
    contains_measure_unit: lvl.containsIndex != null ? null : lvl.containsMeasureUnit,
    display_ordinal: i,
    effective_from: now,
    active: true,
    created_by: null,
  }));
  const { error: insErr } = await sb.from("sku_pack_levels").insert(rows);
  if (insErr) throw new Error(`insert Arugula chain: ${insErr.message}`);

  const { error: fErr } = await sb.from("vendor_items").update({
    pack_format: flat.packFormat ?? "Each (no case)",
    units_per_pack: flat.unitsPerPack,
    each_size: flat.eachSize,
    each_measure: flat.eachMeasure,
    updated_at: now,
    updated_by: null,
  }).eq("id", ARUGULA.skuId);
  if (fErr) throw new Error(`sync Arugula flat fields: ${fErr.message}`);

  void audit({
    actorId: null, actorRole: null,
    action: "sku.pack_chain_update", resourceTable: "sku_pack_levels", resourceId: ARUGULA.skuId,
    metadata: {
      name: ARUGULA.name, level_count: rows.length, labels: rows.map((r) => r.label),
      before_oz: ARUGULA.fromOz, after_oz: ARUGULA.toOz,
      flat_synced: { pack_format: flat.packFormat, units_per_pack: flat.unitsPerPack, each_size: flat.eachSize, each_measure: flat.eachMeasure },
      evidence: ARUGULA.evidence,
      impact: "stale 48 oz understated arugula depletion by 33% on every consuming recipe",
      phase: "angel_data_arc", reason: "angel_reconciliation_w3_arugula_pack_correction",
      source: "docs/seed/source/angel-product-catalog.csv",
      source_report: "docs/seed/source/angel-reconciliation-report.md §D.2 / W3",
    },
    ipAddress: null, userAgent: null,
  });

  // Read back from the destination.
  const { data: rb } = await sb.from("vendor_items").select("each_size, each_measure, units_per_pack, pack_format").eq("id", ARUGULA.skuId).maybeSingle<{ each_size: number | string | null; each_measure: string | null; units_per_pack: number | null; pack_format: string | null }>();
  const { count: activeLevels } = await sb.from("sku_pack_levels").select("id", { count: "exact", head: true }).eq("sku_id", ARUGULA.skuId).eq("active", true);
  console.log(`  ✓ read-back: each_size=${rb?.each_size}${rb?.each_measure} units_per_pack=${rb?.units_per_pack} pack_format=${rb?.pack_format} | active chain levels=${activeLevels}\n`);
}

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");
  await fixTwins(sb);
  await fixArugula(sb);
  console.log("Seed 16 done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
