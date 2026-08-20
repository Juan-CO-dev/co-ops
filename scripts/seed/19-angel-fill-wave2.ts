/**
 * Seed 19 — Angel HARVEST wave 2 → vendor_price_history + one vendor binding.
 *
 * Wave 1 (seed 17) read Angel's product catalog: a pack STRING and a case price.
 * Wave 2 reads Claude Cowork's full harvest — 441 invoice lines, 159 products,
 * $61,579.22 reconciled to the penny — which adds the case WEIGHT and, crucially,
 * a `weight_source` saying whether that weight is real or fabricated.
 *
 * ── DRY RUN IS THE DEFAULT, AND THE GATE IS A HUMAN ───────────────────────────
 * Running with no arguments WRITES NOTHING. It prints every would-write row with
 * its arithmetic, every refusal with its reason, and the decision tables, then
 * exits. Writing requires an explicit `--execute`, and per the arc's terms that
 * flag is not used until Juan has eyeballed this output. Wave 1 held the same line
 * and it is the reason this data is trustworthy.
 *
 * ── THE FIVE SECTIONS ─────────────────────────────────────────────────────────
 *  1. Sub Roll -> Cardinal Bakery. Juan confirmed the vendor; Cowork found the
 *     product (`Large Hero Hearth`, $7.87/dozen). Binds the vendor AND prices the
 *     SKU. The only section that touches `vendor_items`.
 *  2. Delmar / Boar's Head catch-weight pricing, for the 8 products where Angel
 *     has a MEASURED weight. This was wave 1's single largest refusal ($20.6K).
 *  3. Re-sweep of wave 1's division table against the newly-derived weights.
 *  4. Price movement (report only, no writes).
 *  5. The remaining vendorless SKUs (report only, no writes).
 *
 * ── EVERY PACK IS RESOLVED LIVE, FROM THE CHAIN ───────────────────────────────
 * `sku_pack_levels` is the source of truth for what one of our packs IS; the flat
 * `units_per_pack` / `each_size` columns are a back-compat MIRROR that
 * `syncSkuFlatFieldsFromChain` writes. Reading the mirror instead of the chain is
 * how you get Sub Roll wrong: its flat columns say `units_per_pack=5,
 * each_size=6, each_measure=each`, which does not tell you a roll is 4 oz or that
 * a flat holds 30 of them. The chain does (`flat -> 5 Packs -> 6 Sub roll -> 4 oz`).
 * So this script walks the live chain with `walkChainToOz`, the same tested pure
 * resolver the app uses, and REFUSES any row whose pack it cannot resolve.
 *
 * Idempotency: `vendor_price_history` is APPEND-ONLY, so a second `--execute`
 * would append a second set of rows. The script checks for an existing
 * (vendor_item_id, source, effective_date) and skips. The Sub Roll vendor binding
 * re-reads the current vendor_id and skips when already correct.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/19-angel-fill-wave2.ts
 *        -> DRY RUN (default). Prints everything, writes nothing.
 *      ... 19-angel-fill-wave2.ts --markdown   -> dry-run as markdown (authors the report doc)
 *      ... 19-angel-fill-wave2.ts --execute    -> WRITES. Requires Juan's eyeball first.
 *
 * NOTE on --conditions=react-server: lib/supabase-server.ts carries `import
 * "server-only"`; under plain tsx that resolves to its throwing entry point and the
 * seed dies on import. The react-server condition resolves it to the empty stub.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import {
  parseAngelCatalog, classify, rowKey,
} from "@/lib/angel-price-fill";
import {
  parseAngelRollup, rollupKey, parseAngelDate, classifyWeightSource,
  scalePriceByCount, priceFromPerLb, parseCountPack,
  resweepAll, priceMovements, packVsActualRatio, isMaterialDisagreement,
  CARDINAL_SUB_ROLL, DELMAR_CATCH_WEIGHT_RULES, WAVE2_REASONS,
  type RollupRow, type ResweepFinding, type Wave2Code,
} from "@/lib/angel-wave2";
import {
  buildPackChain, chainRootLabel, walkChainToOz, formatChainDescriptor,
  type PackChainLevel,
} from "@/lib/pack-chain-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Provenance key. Dated + named for the harvest, so wave-2 rows can never be
 *  confused with wave 1's `angel-catalog-2026-08`. */
const SOURCE_KEY = "angel-harvest-2026-08-20";

/** Wave 1's provenance key — read (never written) here, to find out which of its
 *  rows are already live in prod. */
const WAVE1_SOURCE_KEY = "angel-catalog-2026-08";

const ROLLUP_CSV = "docs/angel-products-rollup.csv";
const WAVE1_CSV = "docs/seed/source/angel-product-catalog.csv";

const EXECUTE = process.argv.includes("--execute");
const MD = process.argv.includes("--markdown");

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (f: number) => `${f >= 0 ? "+" : ""}${(f * 100).toFixed(1)}%`;

/** Heading, in whichever dialect this run is printing. */
function h(level: number, text: string): void {
  console.log(MD ? `\n${"#".repeat(level)} ${text}\n` : `\n${"─".repeat(3)} ${text.toUpperCase()} ${"─".repeat(Math.max(3, 66 - text.length))}\n`);
}
function p(text = ""): void { console.log(text); }

/** Open/close a fenced block — markdown collapses hard-wrapped lines into one
 *  paragraph, which destroys any block whose ALIGNMENT carries meaning. */
function pre(open: boolean): void { if (MD) console.log(open ? "```" : "```"); }

/** A markdown table, or an aligned plain one. */
function table(head: string[], rows: string[][], align: string[] = []): void {
  if (rows.length === 0) { p("_(none)_"); return; }
  if (MD) {
    p(`| ${head.join(" | ")} |`);
    p(`|${head.map((_, i) => (align[i] === "r" ? "---:" : "---")).join("|")}|`);
    for (const r of rows) p(`| ${r.join(" | ")} |`);
    return;
  }
  const w = head.map((hd, i) => Math.max(hd.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (c: string[]) => c.map((x, i) => (x ?? "").padEnd(w[i]!)).join("  ");
  p(line(head));
  p(w.map((x) => "-".repeat(x)).join("  "));
  for (const r of rows) p(line(r));
}

// ── Live SKU + pack resolution ─────────────────────────────────────────────────

interface LiveSku {
  id: string;
  name: string;
  vendorId: string | null;
  vendorName: string | null;
  avgOzPerEach: number | null;
  packFormat: string | null;
  unitsPerPack: number | null;
  eachSize: number | null;
  eachMeasure: string | null;
}

interface OurPack {
  /** oz in ONE root container (= one of our packs). Null when unresolvable. */
  packOz: number | null;
  /** Leaf containers in one pack (rolls per flat). Null when not count-anchored. */
  countPerPack: number | null;
  /** The leaf container's own label ("Sub roll"). */
  leafLabel: string | null;
  descriptor: string | null;
  rootLabel: string | null;
  hasChain: boolean;
  /** Set when packOz could not be resolved — printed verbatim in the refusal. */
  whyUnresolved: string | null;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve what ONE of our packs is, from the live chain first and the flat mirror
 * only as a fallback for chainless SKUs.
 *
 * Returns a `whyUnresolved` string rather than a silent null so that every refusal
 * downstream can say exactly what our own data failed to provide — which is the
 * actionable half of the finding (it tells Juan which SKU needs a pack chain).
 */
function resolveOurPack(
  sku: LiveSku,
  levels: PackChainLevel[],
  measures: Map<string, MeasureUnitFactor>,
): OurPack {
  if (levels.length > 0) {
    const chain = buildPackChain(levels);
    const rootLabel = chainRootLabel(chain);
    if (!rootLabel) {
      return { packOz: null, countPerPack: null, leafLabel: null, descriptor: null, rootLabel: null, hasChain: true, whyUnresolved: "pack chain has no unique root (malformed)" };
    }
    const walk = walkChainToOz(chain, rootLabel, measures, sku.avgOzPerEach);
    const descriptor = formatChainDescriptor(chain);
    if (!walk.ok) {
      return { packOz: null, countPerPack: null, leafLabel: null, descriptor, rootLabel, hasChain: true, whyUnresolved: `pack chain does not resolve to ounces (${walk.reason})` };
    }
    // The leaf container is the level that contains a raw measure. Ounces in ONE
    // of those, divided into the pack, gives the count of them per pack — which is
    // the anchor for a count-space relation (Angel's "12 ct" vs our 30 rolls).
    const leaf = levels.find((l) => l.containsLevelId == null) ?? null;
    let countPerPack: number | null = null;
    if (leaf) {
      const leafWalk = walkChainToOz(chain, leaf.label, measures, sku.avgOzPerEach);
      if (leafWalk.ok && leafWalk.oz > 0) {
        const raw = walk.oz / leafWalk.oz;
        // Only an (near-)integer count is usable; a fractional one means the leaf
        // is not a countable container and count-space does not apply.
        countPerPack = Math.abs(raw - Math.round(raw)) < 1e-6 ? Math.round(raw) : null;
      }
    }
    return { packOz: walk.oz, countPerPack, leafLabel: leaf?.label ?? null, descriptor, rootLabel, hasChain: true, whyUnresolved: null };
  }

  // No chain. The flat mirror can still describe a pack IF it carries an each_size
  // and a measure; for the Delmar deli SKUs it does not (each_size is NULL), which
  // is exactly the gap this branch reports.
  const { unitsPerPack, eachSize, eachMeasure } = sku;
  if (unitsPerPack == null || eachSize == null || eachMeasure == null) {
    const missing = [
      unitsPerPack == null ? "units_per_pack" : null,
      eachSize == null ? "each_size" : null,
      eachMeasure == null ? "each_measure" : null,
    ].filter(Boolean).join(", ");
    return { packOz: null, countPerPack: null, leafLabel: null, descriptor: null, rootLabel: sku.packFormat, hasChain: false, whyUnresolved: `no pack chain, and the flat columns are missing ${missing}` };
  }
  const measure = measures.get(eachMeasure);
  if (!measure) {
    return { packOz: null, countPerPack: null, leafLabel: null, descriptor: null, rootLabel: sku.packFormat, hasChain: false, whyUnresolved: `no pack chain, and each_measure "${eachMeasure}" is not a registered measure unit` };
  }
  const perEach = measure.dimension === "weight" ? measure.toBaseFactor : sku.avgOzPerEach;
  if (perEach == null) {
    return { packOz: null, countPerPack: null, leafLabel: null, descriptor: null, rootLabel: sku.packFormat, hasChain: false, whyUnresolved: `no pack chain; each_measure "${eachMeasure}" is a ${measure.dimension} unit and the SKU has no avg_oz_per_each to convert it` };
  }
  return {
    packOz: unitsPerPack * eachSize * perEach,
    countPerPack: measure.dimension === "count" ? unitsPerPack * eachSize : null,
    leafLabel: eachMeasure, descriptor: `${sku.packFormat ?? "pack"} → ${unitsPerPack} × ${eachSize} ${eachMeasure} (flat columns, no chain)`,
    rootLabel: sku.packFormat, hasChain: false, whyUnresolved: null,
  };
}

// ── A would-write row ──────────────────────────────────────────────────────────

interface PlannedWrite {
  section: "SUB_ROLL" | "DELMAR";
  skuId: string;
  skuName: string;
  angelProduct: string;
  unitPrice: number;
  effectiveDate: string;
  sourceNote: string;
  /** Human-readable arithmetic, for the dry-run table. */
  arithmetic: string;
  flag: string;
  metadata: Record<string, unknown>;
}

interface Refused {
  section: string;
  skuName: string;
  angelProduct: string;
  code: Wave2Code;
  detail: string;
}

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  p(MD ? "" : EXECUTE
    ? "══ EXECUTE MODE — this run WRITES ══"
    : "══ DRY RUN (default) — no writes. Pass --execute after Juan's eyeball. ══");

  // ── Load sources ─────────────────────────────────────────────────────────────
  const rollup = parseAngelRollup(readFileSync(resolve(process.cwd(), ROLLUP_CSV), "utf8"));
  const rollupByKey = new Map(rollup.map((r) => [rollupKey(r), r]));
  const rollupByProduct = new Map<string, RollupRow>();
  for (const r of rollup) if (!rollupByProduct.has(r.product)) rollupByProduct.set(r.product, r);

  const wave1Rows = parseAngelCatalog(readFileSync(resolve(process.cwd(), WAVE1_CSV), "utf8"));
  const wave1 = classify(wave1Rows);
  const wave1FillKeys = new Set(wave1.fills.map((f) => rowKey(f.row)));

  // Wave 1's `--execute` has already RUN. That is not an assumption — the live
  // price rows are read below and counted, because it changes what a section-3
  // conflict MEANS: not "do not write this", but "this number is already in
  // production and feeding plate costs today".
  const { data: w1Live, error: w1Err } = await sb
    .from("vendor_price_history").select("vendor_item_id, unit_price").eq("source", WAVE1_SOURCE_KEY)
    .returns<Array<{ vendor_item_id: string; unit_price: number | string }>>();
  if (w1Err) throw new Error(`load wave-1 live prices: ${w1Err.message}`);
  const wave1LivePriceBySkuId = new Map((w1Live ?? []).map((r) => [r.vendor_item_id, num(r.unit_price)]));

  // ── Load live ────────────────────────────────────────────────────────────────
  const { data: measureRows, error: mErr } = await sb
    .from("measure_units").select("label, dimension, to_base_factor").eq("active", true)
    .returns<Array<{ label: string; dimension: "weight" | "volume" | "count"; to_base_factor: number | string }>>();
  if (mErr) throw new Error(`load measure_units: ${mErr.message}`);
  const measures = new Map<string, MeasureUnitFactor>(
    (measureRows ?? []).map((m) => [m.label, { dimension: m.dimension, toBaseFactor: num(m.to_base_factor) ?? 0 }]),
  );

  const { data: vendorRows, error: vErr } = await sb
    .from("vendors").select("id, name, active").returns<Array<{ id: string; name: string; active: boolean }>>();
  if (vErr) throw new Error(`load vendors: ${vErr.message}`);
  const vendorById = new Map((vendorRows ?? []).map((v) => [v.id, v]));
  const vendorByName = new Map((vendorRows ?? []).map((v) => [v.name, v]));

  // ACTIVE + GLOBAL only, matching wave 1: recordSkuPrice rejects an inactive SKU
  // and a location-scoped row would price only one store.
  const { data: skuRows, error: sErr, count: skuCount } = await sb
    .from("vendor_items")
    .select("id, name, vendor_id, avg_oz_per_each, pack_format, units_per_pack, each_size, each_measure", { count: "exact" })
    .eq("active", true).is("location_id", null)
    .returns<Array<{ id: string; name: string; vendor_id: string | null; avg_oz_per_each: number | string | null; pack_format: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null }>>();
  if (sErr) throw new Error(`load vendor_items: ${sErr.message}`);
  if (skuCount != null && (skuRows?.length ?? 0) < skuCount) {
    throw new Error(`vendor_items truncated: got ${skuRows?.length} of ${skuCount} — raise the page size before trusting this run`);
  }
  const skus: LiveSku[] = (skuRows ?? []).map((r) => ({
    id: r.id, name: r.name, vendorId: r.vendor_id,
    vendorName: r.vendor_id ? (vendorById.get(r.vendor_id)?.name ?? null) : null,
    avgOzPerEach: num(r.avg_oz_per_each), packFormat: r.pack_format,
    unitsPerPack: r.units_per_pack, eachSize: num(r.each_size), eachMeasure: r.each_measure,
  }));
  const skusByName = new Map<string, LiveSku[]>();
  for (const s of skus) {
    const list = skusByName.get(s.name) ?? [];
    list.push(s);
    skusByName.set(s.name, list);
  }

  const { data: levelRows, error: lErr, count: levelCount } = await sb
    .from("sku_pack_levels")
    .select("id, sku_id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal", { count: "exact" })
    .eq("active", true)
    .returns<Array<{ id: string; sku_id: string; label: string; contains_qty: number | string; contains_level_id: string | null; contains_measure_unit: string | null; display_ordinal: number }>>();
  if (lErr) throw new Error(`load sku_pack_levels: ${lErr.message}`);
  if (levelCount != null && (levelRows?.length ?? 0) < levelCount) {
    throw new Error(`sku_pack_levels truncated: got ${levelRows?.length} of ${levelCount}`);
  }
  const levelsBySku = new Map<string, PackChainLevel[]>();
  for (const r of levelRows ?? []) {
    const list = levelsBySku.get(r.sku_id) ?? [];
    list.push({
      id: r.id, label: r.label, containsQty: num(r.contains_qty) ?? 0,
      containsLevelId: r.contains_level_id, containsMeasureUnit: r.contains_measure_unit,
      displayOrdinal: r.display_ordinal,
    });
    levelsBySku.set(r.sku_id, list);
  }
  const packOf = (s: LiveSku) => resolveOurPack(s, levelsBySku.get(s.id) ?? [], measures);

  /** Resolve a SKU name to exactly one live row, or explain why not. */
  function oneSku(name: string): { sku: LiveSku } | { error: string } {
    const hits = skusByName.get(name) ?? [];
    if (hits.length === 1) return { sku: hits[0]! };
    return { error: hits.length === 0 ? `no ACTIVE global SKU named "${name}"` : `${hits.length} ACTIVE global SKUs share the name "${name}" — refusing to guess` };
  }

  const writes: PlannedWrite[] = [];
  const refusals: Refused[] = [];

  p(MD ? `# Angel fill — WAVE 2 DRY RUN\n` : "");
  if (MD) {
    p("**Status: NOTHING HAS BEEN WRITTEN.** This is the output of");
    p("`scripts/seed/19-angel-fill-wave2.ts` in its default (dry-run) mode. The script writes");
    p("only under an explicit `--execute` flag, and that flag is not used until Juan has");
    p("eyeballed the tables below.");
    p("");
    p(`**Generated:** 2026-08-20, against \`${ROLLUP_CSV}\` (${rollup.length} products, ${WAVE1_CSV.split("/").pop()} for the wave-1 join)`);
    p("and live prod (`bgcvurheqzylyfehqgzh`). Every SKU id, vendor id and pack chain below was");
    p("resolved live at run time, not read from a report.");
    p("");
    p("---");
    p("");
    p("## The four things worth your minute");
    p("");
    p("Wave 2 writes very little on purpose. The harvest's own §5 is the reason: Angel's");
    p("measured weight and our pack chain disagree on 18 of 81 parseable rows, and the");
    p("harvest's instruction is to **defer to neither blindly** — the disagreement is the");
    p("signal. So a measured weight is a second opinion here, not a licence to fill. Most of");
    p("the value below is in the questions, not the two prices.");
    p("");
    p("1. **Is our `flat` of Sub Roll really 30 rolls?** The whole §1 price hangs on it. Our");
    p("   pack chain says `flat → 5 Packs → 6 Sub roll`, and Angel sells a 12-count. If a");
    p("   flat is not 30 rolls, $19.68 is wrong by exactly that ratio.");
    p("2. **Is our Boar's Head `Case of 2` the same case Delmar ships?** (§2 decision table.)");
    p("   We know what Delmar's case weighs; we do not know what our pack is. Answering this");
    p("   once unlocks 7 SKUs including OvenGold turkey — the single biggest line in the");
    p("   dataset — and fills in their missing pack chains at the same time.");
    p("3. **Four wave-1 prices are now in question** (§3 conflicts). Angel's measured weight");
    p("   contradicts the pack string wave 1 divided by. Two of them (Oregano, Onion Powder)");
    p("   have a divisor in doubt, so the PRICE is suspect; two (Garlic, Parsley) have the");
    p("   right price but an understated pack weight, so their cost-per-OUNCE is ~20–40% high.");
    p("4. **The Basil tie-break from wave 1 is answered** (§3). The $10.34 option was never a");
    p("   real per-pound price — Angel fabricated its weight. Wave 1's \"exact match to the");
    p("   2024 sheet\" was a coincidence between two case prices.");
  }

  // ══ SECTION 1 — Sub Roll → Cardinal Bakery ═══════════════════════════════════
  h(2, "Section 1 — Sub Roll → Cardinal Bakery");

  const cardinal = vendorByName.get(CARDINAL_SUB_ROLL.vendor);
  const subRollHit = oneSku(CARDINAL_SUB_ROLL.ourSkuName);

  if (!cardinal) {
    refusals.push({ section: "1", skuName: CARDINAL_SUB_ROLL.ourSkuName, angelProduct: CARDINAL_SUB_ROLL.product, code: "SKU_UNRESOLVED", detail: `vendor "${CARDINAL_SUB_ROLL.vendor}" is not registered in vendors` });
    p(`REFUSED: vendor "${CARDINAL_SUB_ROLL.vendor}" is not registered.`);
  } else if ("error" in subRollHit) {
    refusals.push({ section: "1", skuName: CARDINAL_SUB_ROLL.ourSkuName, angelProduct: CARDINAL_SUB_ROLL.product, code: "SKU_UNRESOLVED", detail: subRollHit.error });
    p(`REFUSED: ${subRollHit.error}`);
  } else {
    const sku = subRollHit.sku;
    const pack = packOf(sku);
    const angelCount = parseCountPack(CARDINAL_SUB_ROLL.packSize);

    pre(true);
    p(`Vendor      : ${cardinal.name}  (id ${cardinal.id}, active=${cardinal.active}) — VERIFIED LIVE`);
    p(`Our SKU     : ${sku.name}  (id ${sku.id}) — VERIFIED LIVE`);
    p(`  current vendor_id : ${sku.vendorId ?? "NULL (vendorless)"}${sku.vendorName ? ` (${sku.vendorName})` : ""}`);
    p(`  pack chain        : ${pack.descriptor ?? "(none)"}`);
    p(`  → one ${pack.rootLabel ?? "pack"} = ${pack.packOz ?? "?"} oz = ${pack.countPerPack ?? "?"} × ${pack.leafLabel ?? "?"}`);
    p(`Angel row   : ${CARDINAL_SUB_ROLL.product} [${CARDINAL_SUB_ROLL.vendor}] pack "${CARDINAL_SUB_ROLL.packSize}" @ ${money(CARDINAL_SUB_ROLL.unitPriceUsd)}`);
    p(`  observed ${CARDINAL_SUB_ROLL.observedDate}; ${CARDINAL_SUB_ROLL.qtyPurchased} × ${money(CARDINAL_SUB_ROLL.unitPriceUsd)} = ${money(CARDINAL_SUB_ROLL.lineTotalUsd)}`);
    p(`  Angel shows NO $/lb for this row (Cardinal's feed sends no weight, and Angel`);
    p(`  correctly prints "—" rather than fabricating 1.0 lb). The relation is COUNT-only.`);
    pre(false);
    p("");

    if (angelCount == null || angelCount !== CARDINAL_SUB_ROLL.countPerAngelPack) {
      refusals.push({ section: "1", skuName: sku.name, angelProduct: CARDINAL_SUB_ROLL.product, code: "NO_MEASURED_WEIGHT", detail: `pack string "${CARDINAL_SUB_ROLL.packSize}" did not parse to the expected count of ${CARDINAL_SUB_ROLL.countPerAngelPack}` });
      p(`REFUSED: pack string "${CARDINAL_SUB_ROLL.packSize}" did not parse to a usable count.`);
    } else if (pack.countPerPack == null) {
      refusals.push({ section: "1", skuName: sku.name, angelProduct: CARDINAL_SUB_ROLL.product, code: "OUR_PACK_UNRESOLVABLE", detail: pack.whyUnresolved ?? "our pack does not resolve to a whole number of rolls" });
      p(`REFUSED: ${pack.whyUnresolved ?? "our pack does not resolve to a whole number of rolls"}`);
    } else {
      const r = scalePriceByCount(CARDINAL_SUB_ROLL.unitPriceUsd, angelCount, pack.countPerPack);
      const perRoll = CARDINAL_SUB_ROLL.unitPriceUsd / angelCount;
      const effectiveDate = parseAngelDate(CARDINAL_SUB_ROLL.observedDate);
      if (!effectiveDate) throw new Error(`could not parse the Cardinal observation date "${CARDINAL_SUB_ROLL.observedDate}"`);

      const arithmetic =
        `${money(CARDINAL_SUB_ROLL.unitPriceUsd)} ÷ ${angelCount} rolls = $${perRoll.toFixed(4)}/roll` +
        ` × ${pack.countPerPack} rolls per ${pack.rootLabel} = ${money(r.unitPrice)}`;
      const sourceNote =
        `${CARDINAL_SUB_ROLL.product} [${CARDINAL_SUB_ROLL.vendor}] pack "${CARDINAL_SUB_ROLL.packSize}" ` +
        `| ${money(CARDINAL_SUB_ROLL.unitPriceUsd)} per ${angelCount} rolls = $${perRoll.toFixed(4)}/roll; ` +
        `our ${pack.rootLabel} = ${pack.countPerPack} rolls (chain: ${pack.descriptor}) ` +
        `→ ${money(r.unitPrice)} per ${pack.rootLabel}${r.rounded ? ` (exact ${r.exactCents} cents, rounded half-up)` : ""}. ` +
        `COUNT-anchored: Angel supplies no weight for the Cardinal lane, so no weight is used.`;

      pre(true);
      p("Arithmetic  :");
      p(`  ${arithmetic}`);
      p(`  exact = ${r.exactCents} cents${r.rounded ? " → rounded half-up to cents" : " (exact)"}`);
      p("");
      p("Cross-check :");
      p(`  2024 costing sheet: "Sub Roll, Cardinal, $0.70, 1, ea" — an INDEPENDENT source,`);
      p(`  hand-collected two years earlier, naming the same vendor. Our derived $${perRoll.toFixed(4)}/roll`);
      p(`  is ${pct(perRoll / 0.7 - 1)} against it. Same order, same vendor — strong corroboration.`);
      pre(false);
      p("");

      writes.push({
        section: "SUB_ROLL", skuId: sku.id, skuName: sku.name, angelProduct: CARDINAL_SUB_ROLL.product,
        unitPrice: r.unitPrice, effectiveDate, sourceNote, arithmetic,
        flag: `COUNT-MULTIPLE ×${pack.countPerPack}/${angelCount}${r.rounded ? " · rounded" : ""}`,
        metadata: {
          angel_product: CARDINAL_SUB_ROLL.product, angel_vendor: CARDINAL_SUB_ROLL.vendor,
          angel_pack_size: CARDINAL_SUB_ROLL.packSize, angel_unit_price_usd: CARDINAL_SUB_ROLL.unitPriceUsd,
          angel_count_per_pack: angelCount, our_count_per_pack: pack.countPerPack,
          our_pack_oz: pack.packOz, our_pack_chain: pack.descriptor,
          relation: "COUNT_MULTIPLE", exact_cents: r.exactCents,
        },
      });

      p("── the vendor binding (the only vendor_items write in this script) ──");
      table(
        ["our SKU", "current vendor", "→ new vendor", "evidence"],
        [[sku.name, sku.vendorId ?? "NULL", `${cardinal.name} (${cardinal.id})`, "Juan-confirmed + 2024 costing sheet + Angel Aug-13 invoice line"]],
      );
      if (sku.vendorId === cardinal.id) p("\n  (already bound — the write would be a no-op and is skipped.)");
    }
  }

  // ══ SECTION 2 — Delmar / Boar's Head catch weights ═══════════════════════════
  h(2, "Section 2 — Delmar / Boar's Head catch-weight pricing");
  p("Angel prices these per POUND against a VARIABLE case weight, so $/lb is the stable");
  p("term and the case price is noise. Every fill below is $/lb × OUR pack's weight.");
  p("Our pack weight comes from the live pack chain; where the chain cannot say what one");
  p("pack weighs, the row is REFUSED rather than related to a pack we cannot measure.");
  p("");

  const delmarRows: string[][] = [];
  const delmarDecisions: string[][] = [];

  for (const rule of DELMAR_CATCH_WEIGHT_RULES) {
    const roll = rollupByProduct.get(rule.product);
    const hit = oneSku(rule.skuName);
    if ("error" in hit) {
      refusals.push({ section: "2", skuName: rule.skuName, angelProduct: rule.product, code: "SKU_UNRESOLVED", detail: hit.error });
      continue;
    }
    const sku = hit.sku;
    const pack = packOf(sku);

    if (!roll) {
      refusals.push({ section: "2", skuName: rule.skuName, angelProduct: rule.product, code: "NO_MEASURED_WEIGHT", detail: "product not found in the rollup" });
      continue;
    }
    const trust = classifyWeightSource(roll.weightSource);
    const ppl = roll.latestPricePerLb;
    const lo = roll.lbsPerUnitMin, hi = roll.lbsPerUnitMax;
    const angelCaseLb = lo != null && hi != null ? (lo + hi) / 2 : null;

    if (trust !== "MEASURED" || ppl == null || angelCaseLb == null) {
      refusals.push({ section: "2", skuName: rule.skuName, angelProduct: rule.product, code: "ASSUMED_WEIGHT", detail: `weight_source = ${roll.weightSource}` });
      continue;
    }

    if (pack.packOz == null) {
      // The load-bearing refusal. We KNOW what Angel's case weighs; we do not know
      // what OUR pack weighs, so there is nothing to multiply. But we can still
      // frame the answerable question, which is worth more than a bare refusal:
      // if our "Case of N units" IS Delmar's case, then a unit weighs caseLb / N.
      refusals.push({ section: "2", skuName: rule.skuName, angelProduct: rule.product, code: "OUR_PACK_UNRESOLVABLE", detail: pack.whyUnresolved ?? "unresolvable" });
      const n = sku.unitsPerPack;
      const impliedLb = n != null && n > 0 ? angelCaseLb / n : null;
      delmarDecisions.push([
        sku.name,
        `\`${rule.product}\``,
        `${money(ppl)}/lb`,
        `${angelCaseLb.toFixed(2)} lb`,
        n != null ? `${sku.packFormat ?? "Case"} of ${n}` : "_(no pack data at all)_",
        impliedLb != null ? `**${impliedLb.toFixed(2)} lb** each → ${money(ppl * angelCaseLb)}/case` : "—",
      ]);
      continue;
    }

    const price = priceFromPerLb(ppl, pack.packOz);
    const ratio = packVsActualRatio(angelCaseLb * 16, pack.packOz);
    const disagrees = isMaterialDisagreement(ratio);

    if (disagrees) {
      refusals.push({ section: "2", skuName: rule.skuName, angelProduct: rule.product, code: "MATERIAL_DISAGREEMENT", detail: `our pack ${pack.packOz} oz vs Angel's measured case ${(angelCaseLb * 16).toFixed(1)} oz (ratio ${ratio!.toFixed(3)})` });
      continue;
    }

    const effectiveDate = parseAngelDate(roll.lastSeen);
    if (!effectiveDate) throw new Error(`could not parse last_seen "${roll.lastSeen}" for ${rule.product}`);

    const arithmetic = `${money(ppl)}/lb × ${price.ourPackLb} lb (our ${pack.rootLabel ?? "pack"} = ${pack.packOz} oz) = ${money(price.unitPrice)}`;
    const sourceNote =
      `${rule.product} [Delmar Provisions / Boar's Head] | CATCH WEIGHT: priced per pound at ${money(ppl)}/lb; ` +
      `Angel's measured case ${angelCaseLb.toFixed(2)} lb (weight_source=invoice_catch_weight, ${roll.purchaseLines} invoice lines). ` +
      `unit_price = ${money(ppl)}/lb × our ${price.ourPackLb} lb pack (chain: ${pack.descriptor}) = ${money(price.unitPrice)}. ` +
      `Derived from $/lb, NOT from a case price — the case weight varies per delivery, the $/lb does not.`;

    delmarRows.push([
      sku.name, `\`${rule.product}\``, `${money(ppl)}/lb`, `${price.ourPackLb} lb`,
      `**${money(price.unitPrice)}**`, `agree ${ratio != null ? ratio.toFixed(3) : "—"}× · ${rule.confidence}`,
    ]);

    writes.push({
      section: "DELMAR", skuId: sku.id, skuName: sku.name, angelProduct: rule.product,
      unitPrice: price.unitPrice, effectiveDate, sourceNote, arithmetic,
      flag: `CATCH-WEIGHT · $/lb × ${price.ourPackLb} lb`,
      metadata: {
        angel_product: rule.product, angel_vendor: "Delmar Provisions",
        price_per_lb: ppl, angel_case_lb: angelCaseLb, angel_weight_source: roll.weightSource,
        our_pack_oz: pack.packOz, our_pack_lb: price.ourPackLb, our_pack_chain: pack.descriptor,
        pack_vs_actual_ratio: ratio, relation: "CATCH_WEIGHT_PER_LB",
        match_confidence: rule.confidence, match_note: rule.matchNote,
      },
    });
  }

  p("── WOULD WRITE ──");
  table(["our SKU", "Angel product", "$/lb", "our pack", "unit price", "check"],
    delmarRows, ["", "", "r", "r", "r", ""]);

  p("");
  p("── DECISION TABLE: measured case weight, but OUR pack cannot be measured ──");
  p("Angel knows what its case weighs; our SKU has no pack chain and no `each_size`, so");
  p("there is nothing to multiply. These are NOT refusals to be re-run — they are one");
  p("question each. If our `Case of N` is the same physical case Delmar ships, the");
  p("implied per-unit weight in the last column is the answer, and it also fills in the");
  p("SKU's missing pack chain.");
  p("");
  table(["our SKU", "Angel product", "$/lb", "Angel case wt", "our pack says", "if same case → implied"],
    delmarDecisions, ["", "", "r", "r", "", "r"]);

  // ══ SECTION 3 — re-sweep ═════════════════════════════════════════════════════
  h(2, "Section 3 — re-sweep of wave 1 against the measured weights");
  p("Wave 1's divisors came from Angel's PACK STRING. The harvest supplies an independent");
  p("MEASURED weight for the same rows. Where they agree, wave 1 is corroborated; where");
  p("they disagree by >15%, neither side wins automatically and the row becomes a question.");
  p("");
  p("The distinction that matters, and it is easy to get backwards:");
  p("  · PACK-AGREES rows (divisor 1) — our pack IS one whole Angel case, so we pay the");
  p("    case price for it. A weight disagreement does NOT move the price by a penny; what");
  p("    is wrong is our SKU's recorded pack WEIGHT, and so every derived cost-PER-OUNCE.");
  p("  · CASE-MULTIPLE rows (divisor N>1) — the divisor N came from the same pack string");
  p("    the weight just contradicted, so the DIVISOR is in doubt, and the price with it.");
  p("");

  const findings = resweepAll(rollupByKey, wave1FillKeys);
  const agreed = findings.filter((f) => f.code === null);
  const conflicts = findings.filter((f) => f.code === "MATERIAL_DISAGREEMENT" || f.code === "DROPPED_MULTIPLIER");
  const assumed = findings.filter((f) => f.code === "ASSUMED_WEIGHT");
  const noWeight = findings.filter((f) => f.code === "NO_MEASURED_WEIGHT");

  /** The wave-1 price this SKU carries in prod RIGHT NOW, or null. Read live, so
   *  the report states what is true rather than what wave 1 planned. */
  const livePriceFor = (skuName: string): number | null => {
    for (const s of skusByName.get(skuName) ?? []) {
      const price = wave1LivePriceBySkuId.get(s.id);
      if (price != null) return price;
    }
    return null;
  };

  const fmtFinding = (f: ResweepFinding) => {
    const live = livePriceFor(f.rule.skuName);
    return [
      f.rule.skuName,
      `\`${f.rule.product}\` [${f.rule.brand || "—"}]`,
      f.rule.relation === "PACK_AGREES" ? "÷1" : `÷${f.rule.divisor}`,
      `${f.rule.angelCaseOz} oz`,
      f.measuredCaseOz != null ? `${f.measuredCaseOz.toFixed(1)} oz` : "—",
      f.ratio != null ? `${f.ratio.toFixed(3)}×` : "—",
      f.wasWave1Fill && live != null ? `**LIVE ${money(live)}**` : f.wasWave1Fill ? "planned" : "no",
      f.impact === "PRICE_IN_DOUBT" ? "**PRICE IN DOUBT**" : f.impact === "PACK_WEIGHT_ONLY" ? "pack weight only" : "—",
    ];
  };

  p(`Wave 1's \`--execute\` has already run: ${wave1LivePriceBySkuId.size} of its price rows are LIVE in`);
  p(`prod under \`source = '${WAVE1_SOURCE_KEY}'\` (read live by this script, not assumed). So a`);
  p("conflict below is not a veto on a pending write — it is a number already feeding plate");
  p("costs today that the harvest says to look at again.");
  p("");
  p(`── CONFLICTS: ${conflicts.length} rows (wave 2 writes none of them; question for Juan) ──`);
  table(["our SKU", "Angel row", "w1 ÷", "pack-string oz", "measured oz", "ratio", "wave-1 price", "impact"],
    conflicts.map(fmtFinding), ["", "", "r", "r", "r", "r", "r", ""]);

  p("");
  p(`── CORROBORATED: ${agreed.length} wave-1 rows whose measured weight AGREES ──`);
  table(["our SKU", "Angel row", "w1 ÷", "pack-string oz", "measured oz", "ratio", "wave-1 price", "impact"],
    agreed.map(fmtFinding), ["", "", "r", "r", "r", "r", "r", ""]);

  // Not every "agrees" agrees equally. Rows sitting just under the 15% line are
  // passing a threshold, not matching — and saying so is the difference between a
  // report and a rubber stamp.
  const borderline = agreed.filter((f) => f.ratio != null && Math.abs(f.ratio - 1) > 0.10);
  if (borderline.length > 0) {
    p("");
    p(`  ⚠ ${borderline.length} of those clear the 15% bar only narrowly (>10% apart). They are`);
    p("  passing a threshold, not matching. The harvest explains the cluster: on a packaged");
    p("  LIQUID, Angel's \"net weight\" includes carton and bottle tare, so it reads 10–20%");
    p("  heavy and any $/lb on it is a $/lb-OF-PACKAGE. That does not touch these prices —");
    p("  cream and tuna relate to our pack by VOLUME and COUNT, not weight — but it does mean");
    p("  the measured weight is not independent evidence for them either way:");
    for (const f of borderline) {
      p(`    · ${f.rule.skuName} ← \`${f.rule.product}\` — ${f.ratio!.toFixed(3)}× (${f.rule.relation === "PACK_AGREES" ? "÷1" : `÷${f.rule.divisor}`}, ${f.wasWave1Fill ? "wave-1 fill" : "not filled"})`);
    }
  }

  p("");
  p(`── EXCLUDED BY RULE: ${assumed.length} assumed-weight + ${noWeight.length} no-measured-weight ──`);
  for (const f of assumed) p(`  · ${f.rule.skuName} ← \`${f.rule.product}\` [${f.rule.brand || "—"}] — weight_source = assumed_default_1lb (the basil trap)`);
  for (const f of noWeight) p(`  · ${f.rule.skuName} ← \`${f.rule.product}\` [${f.rule.brand || "—"}] — no measured weight in the rollup`);

  p("");
  p("── the chive shaker, excluded by name ──");
  const shaker = rollup.find((r) => r.product.startsWith("Spice, Chive Chopped"));
  if (shaker) {
    p(`  \`${shaker.product}\` (${shaker.vendor}) — Angel reports ${shaker.latestPricePerLb != null ? money(shaker.latestPricePerLb) : "?"}/lb.`);
    p(`  Angel recorded ONE 1.12-oz shaker's weight as the whole 6-pack case's: the ratio is`);
    p(`  exactly 1/6, so its $/lb is 6× high. True cost is $9.72 ÷ 0.42 lb = $23.14/lb, which`);
    p(`  lands in line with the other dried spices. NOT WRITTEN — the Angel record is corrupt,`);
    p(`  and the corrected figure is recorded here for Juan rather than propagated as data.`);
  }

  p("");
  p("── wave-1 refusals the harvest does NOT change ──");
  const unchanged = wave1.refusals.filter((r) => r.code === "US_FOODS_HISTORICAL" || r.code === "AMBIGUOUS_PRODUCT_IDENTITY" || r.code === "DUPLICATE_CLUSTER");
  p(`  ${unchanged.length} rows: ${WAVE2_REASONS.WAVE1_RULE_UNCHANGED}`);
  const byCode = new Map<string, number>();
  for (const r of unchanged) byCode.set(r.code, (byCode.get(r.code) ?? 0) + 1);
  for (const [code, n] of byCode) p(`    · ${code}: ${n}`);
  p("");
  p("  One of them IS resolved in substance, even though it still needs Juan's word:");
  p("  the Basil duplicate cluster. Wave 1 could not choose between `BASIL FRSH` [FRSH ADV]");
  p("  at $10.34 and [PEAK FRS] at $19.55, and noted that $10.34 matched the 2024 sheet");
  p("  exactly. The harvest shows FRSH ADV's weight is the FABRICATED 1.0 lb while Peak");
  p("  Fresh's 1.4505 lb is measured — so the $10.34/lb was never a real per-pound price,");
  p("  and the exact match to the 2024 sheet is a coincidence between two numbers that are");
  p("  both case prices. Neither row may be written; the cluster is now a documented");
  p("  question rather than a coin flip.");

  // ══ SECTION 4 — price movement ═══════════════════════════════════════════════
  h(2, "Section 4 — price movement (report only, no writes)");
  const movements = priceMovements(rollup);
  p(`${movements.length} of ${rollup.length} products changed price per pound across the capture`);
  p(`window (Jul 10 – Aug 14, 2026 — about five weeks, NOT a year; read these as recent`);
  p("movement, not an annual trend). Rows whose weight is assumed or unknown are excluded:");
  p("their \"$/lb\" is a case price in disguise, so movement in it is not a per-pound signal.");
  p("");
  p("For a catch-weight product the $/lb is the contract term and the case price wobbles");
  p("with the actual weight — so $/lb is the only honest lens here.");
  p("");
  table(
    ["spend", "product", "vendor", "$/lb low → high", "move"],
    movements.map((m) => [
      money(m.spend), `\`${m.row.product}\``, m.row.vendor,
      `${money(m.pplMin)} → ${money(m.pplMax)}`, `**${pct(m.changeFraction)}**`,
    ]),
    ["r", "", "", "r", "r"],
  );
  p("");
  const biggest = [...movements].sort((a, b) => b.changeFraction - a.changeFraction).slice(0, 5);
  p("Biggest movers by percentage (the same list re-sorted — these are where the money is");
  p("actually moving, as distinct from where the money is):");
  for (const m of biggest) p(`  · ${m.row.product} — ${pct(m.changeFraction)} (${money(m.pplMin)} → ${money(m.pplMax)}/lb, ${money(m.spend)} spend)`);

  // ══ SECTION 5 — remaining vendorless SKUs ════════════════════════════════════
  h(2, "Section 5 — the remaining vendorless SKUs (report only, no writes)");

  /** Evidence for each vendorless SKU, gathered from the three sources we have.
   *  A guess is labelled a guess; "none" is a legitimate and useful answer. */
  const VENDORLESS_EVIDENCE: Record<string, { guess: string; confidence: string; evidence: string }> = {
    "Beef Base": { guess: "PFG", confidence: "HIGH", evidence: "Angel carries `BASE BEEF NO MSG JAR` (PFG, 1/1 LB, $9.72). Note the pack string is wrong — measured 6.97 lb, i.e. it is a 6-pack, not one jar." },
    "Dried Chives": { guess: "Baldor (or PFG)", confidence: "LOW", evidence: "2024 sheet: \"Dried Chives, b, $3.95 / 2 oz\" (b = Baldor). Angel's only dried-chive row is the US Foods shaker — the corrupt 1/6 record. PFG's `CHIVES FRSH` is a different (fresh) product." },
    "Lemon Oil": { guess: "— none", confidence: "NONE", evidence: "Appears in the sandwich build sheet (0.1 oz) but in no order guide, no 2024 sheet row, and no Angel row. Floor question." },
    "Mixed Herbs": { guess: "— none (likely house blend)", confidence: "NONE", evidence: "No purchase evidence anywhere. avg_oz_per_each = 4 was flagged \"very unsure\" in the weigh checklist. May be a house mix rather than a purchased SKU." },
    Mortadella: { guess: "Boar's Head / Delmar", confidence: "HIGH", evidence: "2024 sheet: \"Mortadella, BH, $4.29 / 16 oz\". BH = the Boar's Head lane. Absent from Angel's 5-week window, so we buy it rarely — not that we don't buy it." },
    Pepperoncini: { guess: "Boar's Head / Delmar", confidence: "MEDIUM", evidence: "No direct row. The whole jarred-pepper family (hot cherry, sweet, banana) sits on the Delmar/BH lane, and pepperoncini is on the Chicken Parm build." },
    "Utz Ripples": { guess: "Country Snacks", confidence: "MEDIUM", evidence: "`Country Snacks` is registered with ZERO SKUs and is the only snack-shaped vendor on the books. 2024 sheet has \"Utz Chips $3.60 / 7.75 oz\" with no vendor. Inference from vendor purpose, not from a document." },
    "Vanilla Bean Paste": { guess: "— none", confidence: "NONE", evidence: "2024 sheet: \"$54.80 / 32 oz\", vendor blank. Not in Angel. Amazon is plausible (it carries the sundries lane) but nothing supports it." },
    "White Wine": { guess: "— none", confidence: "NONE", evidence: "No row in any guide, sheet or export. Alcohol is very likely a separate purchasing lane we have never modelled." },
    Worcestershire: { guess: "Baldor", confidence: "MEDIUM", evidence: "2024 sheet: \"Worcestershire, b, $31.79 / 128 oz\" (b = Baldor). Baldor is a legacy lane (6 active SKUs) so this may want re-sourcing to PFG rather than binding to Baldor." },
  };

  const vendorless = skus.filter((s) => s.vendorId == null).sort((a, b) => a.name.localeCompare(b.name));
  const stillVendorless = vendorless.filter((s) => s.name !== CARDINAL_SUB_ROLL.ourSkuName);
  p(`${vendorless.length} active global SKUs carry no vendor. Section 1 binds Sub Roll, leaving ${stillVendorless.length}.`);
  p("Nothing below is written — this is a decision table. Where the evidence is thin the");
  p("row says so; a labelled \"none\" is more useful than a confident guess.");
  p("");
  table(
    ["our SKU", "best-guess vendor", "confidence", "evidence"],
    stillVendorless.map((s) => {
      const e = VENDORLESS_EVIDENCE[s.name];
      return [s.name, e?.guess ?? "— none", e?.confidence ?? "NONE", e?.evidence ?? "No evidence in any order guide, the 2024 costing sheet, or the Angel export."];
    }),
  );
  const unknownNames = stillVendorless.filter((s) => !VENDORLESS_EVIDENCE[s.name]).map((s) => s.name);
  if (unknownNames.length > 0) p(`\n  (no evidence entry authored for: ${unknownNames.join(", ")} — these appeared live but not in the report's list.)`);

  // ══ Summary ══════════════════════════════════════════════════════════════════
  h(2, "Summary");
  const subRollWrites = writes.filter((w) => w.section === "SUB_ROLL");
  const delmarWrites = writes.filter((w) => w.section === "DELMAR");
  table(["", ""], [
    ["rollup products parsed", String(rollup.length)],
    ["**would write — section 1 (Sub Roll)**", `**${subRollWrites.length}** price + ${subRollWrites.length > 0 ? 1 : 0} vendor binding`],
    ["**would write — section 2 (Boar's Head)**", `**${delmarWrites.length}**`],
    ["**would write — section 3 (re-sweep)**", "**0**"],
    ["would write — TOTAL price rows", String(writes.length)],
    ["refused (with reason)", String(refusals.length)],
    ["conflicts for Juan (section 3)", String(conflicts.length)],
    ["wave-1 rows corroborated", String(agreed.length)],
    ["price-movement rows (report only)", String(movements.length)],
    ["vendorless decision rows (report only)", String(stillVendorless.length)],
    ["`source` stamped on every written row", `\`${SOURCE_KEY}\``],
    ["`effective_date`", "per-product `last_seen` from the harvest"],
  ], ["", "r"]);

  p("");
  p(`── REFUSALS: ${refusals.length} ──`);
  const refByCode = new Map<Wave2Code, Refused[]>();
  for (const r of refusals) {
    const list = refByCode.get(r.code) ?? [];
    list.push(r);
    refByCode.set(r.code, list);
  }
  for (const [code, list] of refByCode) {
    p(MD ? `\n**${code}** — ${list.length} row(s)\n` : `\n  ${code} — ${list.length} row(s)`);
    p(MD ? `> ${WAVE2_REASONS[code]}\n` : `    ${WAVE2_REASONS[code]}`);
    for (const r of list) p(MD ? `- **${r.skuName}** ← \`${r.angelProduct}\`: ${r.detail}` : `      · ${r.skuName} ← \`${r.angelProduct}\`: ${r.detail}`);
  }

  if (!EXECUTE) {
    p("");
    p("NOTHING WAS WRITTEN. Re-run with --execute once Juan has signed off on the tables above.");
    p("Seed 19 done (dry run).");
    return;
  }

  // ── EXECUTE ──────────────────────────────────────────────────────────────────
  p("\n── writing ──");

  // 1) The Sub Roll vendor binding, re-verified against live state at write time.
  if (subRollWrites.length > 0 && cardinal) {
    const w = subRollWrites[0]!;
    const { data: cur, error: curErr } = await sb
      .from("vendor_items").select("id, vendor_id").eq("id", w.skuId)
      .maybeSingle<{ id: string; vendor_id: string | null }>();
    if (curErr) throw new Error(`re-read Sub Roll: ${curErr.message}`);
    if (!cur) throw new Error("Sub Roll disappeared between the dry run and the write");
    if (cur.vendor_id === cardinal.id) {
      p(`  = ${w.skuName}: vendor already ${cardinal.name} — skipping`);
    } else {
      const { error: upErr, count } = await sb
        .from("vendor_items").update({ vendor_id: cardinal.id }, { count: "exact" }).eq("id", w.skuId);
      if (upErr) throw new Error(`bind Sub Roll vendor: ${upErr.message}`);
      if (!count) throw new Error("bind Sub Roll vendor: UPDATE affected 0 rows (silent RLS denial?)");
      p(`  + ${w.skuName}: vendor ${cur.vendor_id ?? "NULL"} → ${cardinal.name}`);
      void audit({
        actorId: null, actorRole: null,
        action: "vendor_item.update", resourceTable: "vendor_items", resourceId: w.skuId,
        metadata: {
          sku_name: w.skuName, field: "vendor_id",
          previous_vendor_id: cur.vendor_id, new_vendor_id: cardinal.id, new_vendor_name: cardinal.name,
          phase: "angel_data_arc", reason: "angel_harvest_wave2_sub_roll_vendor_binding",
          evidence: "Juan-confirmed; Angel invoice line Aug 13 2026 (Large Hero Hearth, Cardinal Bakery); 2024 costing sheet row 'Sub Roll, Cardinal, $0.70/ea'",
          source_report: "docs/seed/source/angel-wave2-dryrun.md §1",
        },
        ipAddress: null, userAgent: null,
      });
    }
  }

  // 2) Price rows.
  let written = 0, skipped = 0;
  for (const w of writes) {
    const { data: existing, error: exErr } = await sb
      .from("vendor_price_history").select("id")
      .eq("vendor_item_id", w.skuId).eq("source", SOURCE_KEY).eq("effective_date", w.effectiveDate)
      .maybeSingle<{ id: string }>();
    if (exErr) throw new Error(`dup check ${w.skuName}: ${exErr.message}`);
    if (existing) { skipped++; p(`  = ${w.skuName}: already filled from ${SOURCE_KEY} — skipping`); continue; }

    const { data: ins, error } = await sb
      .from("vendor_price_history")
      .insert({
        vendor_item_id: w.skuId, unit_price: w.unitPrice, effective_date: w.effectiveDate,
        recorded_by: null, source: SOURCE_KEY, source_note: w.sourceNote,
      })
      .select("id").single<{ id: string }>();
    if (error) throw new Error(`insert price ${w.skuName}: ${error.message}`);
    written++;
    p(`  + ${w.skuName}: ${money(w.unitPrice)}  (${w.arithmetic})`);

    void audit({
      actorId: null, actorRole: null,
      action: "vendor_item.price_recorded", resourceTable: "vendor_price_history", resourceId: ins.id,
      metadata: {
        vendor_item_id: w.skuId, sku_name: w.skuName,
        unit_price: w.unitPrice, effective_date: w.effectiveDate,
        source: SOURCE_KEY, source_note: w.sourceNote,
        phase: "angel_data_arc", reason: "angel_harvest_wave2_price_fill",
        source_report: "docs/ANGEL-DATA-HARVEST.md + docs/seed/source/angel-wave2-dryrun.md",
        ...w.metadata,
      },
      ipAddress: null, userAgent: null,
    });
  }

  const { count: total } = await sb.from("vendor_price_history").select("id", { count: "exact", head: true });
  p(`\n  ✓ ${written} written, ${skipped} skipped. vendor_price_history now holds ${total} row(s).`);
  p("Seed 19 done (execute).");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
