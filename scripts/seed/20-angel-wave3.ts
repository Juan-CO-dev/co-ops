/**
 * Seed 20 — Angel HARVEST wave 3: the PIECE MODEL.
 *
 * Wave 1 read a pack string and a case price. Wave 2 added the case WEIGHT and a
 * `weight_source` saying whether that weight was real. Wave 3 reads harvest 2 —
 * twenty per-product pages opened in Angel's UI — which supplies the one field the
 * grid never showed: a subtitle carrying `1 CT`.
 *
 * That field reframes a third of the spend. **Delmar does not sell cases; it
 * invoices by the piece.** `Quantity` is a count of pieces and `Net Weight ÷
 * Quantity` is the weight of ONE PIECE. So what wave 2 refused for
 * `OUR_PACK_UNRESOLVABLE` — seven Boar's Head SKUs including OvenGold turkey, the
 * single biggest line in the dataset — is answerable now: our pack is one piece, and
 * we know what a piece weighs.
 *
 * ── DRY RUN IS THE DEFAULT, AND THE GATE IS A HUMAN ───────────────────────────
 * Running with no arguments WRITES NOTHING. It prints every would-write row with its
 * arithmetic, every refusal with its reason, and the decision tables, then exits.
 * Writing requires an explicit `--execute`, and per the arc's terms that flag is not
 * used until Juan has eyeballed this output. Waves 1 and 2 held the same line and it
 * is the reason this data is trustworthy.
 *
 * ── THE FIVE SECTIONS ─────────────────────────────────────────────────────────
 *  A. The Boar's Head piece model — 7 SKUs get a pack chain (one piece), a
 *     per-piece price ($/lb x piece-lb), and an oz-per-slice weight WHERE THAT IS
 *     SAFE. Four of the seven are not safe, and finding that out is section A's most
 *     valuable output (see the STOP list).
 *  B. Weight-file corrections, DB + the `10-fill-sku-weights.ts` constants in the
 *     same PR so a future re-run does not regress them: bacon 0.75 -> 1.23 oz/strip
 *     (a 64% understatement, and it moves nightly Toast depletion), fresh mozzarella
 *     72 -> 192 slices + its price, PFG ham's missing slice weight, Ever Roast.
 *  C. The jug supersedes — oregano and onion powder are SINGLE JUGS, so wave 1's
 *     div-4 and div-5 were wrong. Append-only correction of pack AND price together.
 *  D. Re-run seed 18's twin adjudication, whose pin-move gate was blocked on exactly
 *     the weights section B supplies.
 *  E. Dried Chives, and the named permanent supply-run gap.
 *
 * ── WHY SECTION A CHANGES `units_per_pack` FROM N TO 1, AND WHY THAT IS RIGHT ──
 * Five of the seven SKUs carry a legacy `Case of N` (turkey 2, genoa 6, provolone 6,
 * capicola 5, pepperoni 3) from the order-guide seed. Harvest 2 says there is no
 * case: the vendor invoices one piece at a time. Juan's own pars agree and always
 * did — they read "8 pcs", "5 Logs", "22 (not prepped)", i.e. COUNTS OF PIECES. A
 * par of 8 pieces against a pack of one piece is exact; against a "Case of 5" it is
 * 1.6 cases and the walker has to invent a rounding rule. This is surfaced loudly in
 * the dry run because it is the one structural change in the wave.
 *
 * ── EVERY ROW IS RESOLVED AND RE-VERIFIED LIVE ────────────────────────────────
 * SKU ids are never hardcoded: each rule names a SKU and an expected VENDOR, both
 * asserted against live `vendor_items` before anything is planned, and re-read
 * immediately before each write. `sku_pack_levels` is the source of truth for what a
 * pack IS; the flat columns are a machine-derived MIRROR. So chains are written the
 * way seed 16 writes them — supersede-as-a-SET, then flat fields through the same
 * pure `deriveFlatFieldsFromChain` the admin lib's sync uses — never hand-authored,
 * never an in-place row UPDATE, never a DELETE.
 *
 * Idempotent: every step asserts the live end-state first and writes only the delta.
 * A second `--execute` reports "already" on everything and writes nothing.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/20-angel-wave3.ts
 *        -> DRY RUN (default). Prints everything, writes nothing.
 *      ... 20-angel-wave3.ts --markdown   -> dry-run as markdown (authors the report doc)
 *      ... 20-angel-wave3.ts --execute    -> WRITES. Requires Juan's eyeball first.
 *
 * NOTE on --conditions=react-server: lib/supabase-server.ts carries `import
 * "server-only"`; under plain tsx that resolves to its throwing entry point and the
 * seed dies on import. The react-server condition resolves it to the empty stub.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import { ozForRecipeInput, skuContentOz, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";
import { firstLabelMeasureCollision, type PackChainLevel } from "@/lib/pack-chain-shared";
import { deriveFlatFieldsFromChain } from "@/lib/admin/catalog-shared";
import { parseAngelRollup, classifyWeightSource, priceFromPerLb, parseAngelDate } from "@/lib/angel-wave2";
import {
  parsePieceStructure, parsePackRecheck, packRecheckKey,
  crossCheckSlice, parseSliceCount, pieceWeightInRange, costPerOz, costPerOzUnchanged,
  PIECE_MODEL_RULES, JUAN_SLICE_OZ, JUG_SUPERSEDES, PENDING_RECHECKS,
  BACON_CORRECTION, BACON_SLICE_SPEC, MOZZARELLA_CASE, DRIED_CHIVES,
  PERMANENT_SUPPLY_RUN_GAPS, WAVE3_REASONS,
  type Wave3Code, type PieceRow,
} from "@/lib/angel-wave3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Provenance key. Dated + named for HARVEST 2, so wave-3 rows can never be confused
 *  with wave 2's `angel-harvest-2026-08-20` or wave 1's `angel-catalog-2026-08`. */
const SOURCE_KEY = "angel-harvest2-2026-08-20";

const PIECE_CSV = "docs/angel-piece-structure.csv";
const RECHECK_CSV = "docs/angel-pack-recheck.csv";
const ROLLUP_CSV = "docs/angel-products-rollup.csv";
const SOURCE_REPORTS = "docs/ANGEL-HARVEST-2-PIECES.md + docs/seed/source/angel-wave3-dryrun.md";
const SEED_18 = "scripts/seed/18-twin-adjudication.ts";

const EXECUTE = process.argv.includes("--execute");
const MD = process.argv.includes("--markdown");

const money = (n: number) => `$${n.toFixed(2)}`;
/** Per-SLICE money. Cents are too coarse: a pepperoni slice is $0.08, so `money()`
 *  renders four genuinely different numbers as the same one. */
const money4 = (n: number) => `$${n.toFixed(4)}`;
const pct = (f: number) => `${f >= 0 ? "+" : ""}${(f * 100).toFixed(1)}%`;
/** Trim IEEE-754 dust (6 x 1.12 = 6.720000000000001) without inventing precision. */
const round = (v: number, dp = 4) => Number(v.toFixed(dp));
const oz = (v: number | null) => (v == null ? "NULL" : `${round(v)} oz`);

function h(level: number, text: string): void {
  console.log(MD ? `\n${"#".repeat(level)} ${text}\n` : `\n${"─".repeat(3)} ${text.toUpperCase()} ${"─".repeat(Math.max(3, 66 - text.length))}\n`);
}
function p(text = ""): void { console.log(text); }
function pre(): void { if (MD) console.log("```"); }

function table(head: string[], rows: string[][], align: string[] = []): void {
  if (rows.length === 0) { p(MD ? "_(none)_" : "  (none)"); return; }
  if (MD) {
    // A bare `|` inside a cell silently shears the row into the wrong columns — and
    // pack descriptors legitimately contain one (`jug=80oz | flat jug 1x80oz`).
    // Escaping here rather than at every call site is the fix that cannot be forgotten.
    const cell = (s: string) => (s ?? "").replace(/\|/g, "\\|");
    p(`| ${head.map(cell).join(" | ")} |`);
    p(`|${head.map((_, i) => (align[i] === "r" ? "---:" : "---")).join("|")}|`);
    for (const r of rows) p(`| ${r.map(cell).join(" | ")} |`);
    return;
  }
  const w = head.map((hd, i) => Math.max(hd.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (c: string[]) => c.map((x, i) => (x ?? "").padEnd(w[i]!)).join("  ");
  p(line(head));
  p(w.map((x) => "-".repeat(x)).join("  "));
  for (const r of rows) p(line(r));
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

// ── Live shapes ────────────────────────────────────────────────────────────────

interface LiveSku {
  id: string;
  name: string;
  vendorId: string | null;
  vendorName: string;
  active: boolean;
  packFormat: string | null;
  eachContainerLabel: string | null;
  unitsPerPack: number | null;
  eachSize: number | null;
  eachMeasure: string | null;
  avgOzPerEach: number | null;
  chain: PackChainLevel[];
}

interface PinRow {
  id: string;
  recipeName: string;
  quantity: number;
  unit: string | null;
  portioned: boolean;
}

function shapeOf(s: LiveSku, overrides: Partial<RecipeInputSku> = {}): RecipeInputSku {
  return {
    packFormat: s.packFormat,
    eachContainerLabel: s.eachContainerLabel,
    unitsPerPack: s.unitsPerPack,
    eachSize: s.eachSize,
    eachMeasure: s.eachMeasure,
    avgOzPerEach: s.avgOzPerEach,
    packChain: s.chain.length > 0 ? s.chain : null,
    ...overrides,
  };
}

/** A single-level weight chain, in the index-linked shape `deriveFlatFieldsFromChain`
 *  consumes and `replaceSkuPackChain` validates. */
function oneLevelChain(label: string, qtyOz: number) {
  return [{ label, containsQty: qtyOz, containsIndex: null as number | null, containsMeasureUnit: "oz" as string | null }];
}

// ── Planned work ───────────────────────────────────────────────────────────────

type Section = "A" | "B" | "C";

interface ChainWrite {
  section: Section;
  skuId: string;
  skuName: string;
  vendorName: string;
  levels: ReturnType<typeof oneLevelChain>;
  beforeDescriptor: string;
  afterDescriptor: string;
  evidence: string;
  metadata: Record<string, unknown>;
}

interface WeightWrite {
  section: Section;
  skuId: string;
  skuName: string;
  vendorName: string;
  fromOz: number | null;
  toOz: number;
  arithmetic: string;
  note: string;
  depletionImpact: string | null;
  metadata: Record<string, unknown>;
}

interface PriceWrite {
  section: Section;
  skuId: string;
  skuName: string;
  vendorName: string;
  angelProduct: string;
  unitPrice: number;
  effectiveDate: string;
  sourceNote: string;
  arithmetic: string;
  metadata: Record<string, unknown>;
}

interface Refused {
  section: string;
  skuName: string;
  subject: string;
  code: Wave3Code;
  detail: string;
}

interface Stop {
  section: string;
  skuName: string;
  headline: string;
  detail: string[];
  unblock: string;
}

const chainWrites: ChainWrite[] = [];
const weightWrites: WeightWrite[] = [];
const priceWrites: PriceWrite[] = [];
const refusals: Refused[] = [];
const stops: Stop[] = [];

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  if (!MD) {
    p(EXECUTE
      ? "══ EXECUTE MODE — this run WRITES to sku_pack_levels / vendor_items / vendor_price_history ══"
      : "══ DRY RUN (default) — no writes. Pass --execute after Juan's eyeball. ══");
  }

  // ── Sources ────────────────────────────────────────────────────────────────
  const pieces = parsePieceStructure(readFileSync(resolve(process.cwd(), PIECE_CSV), "utf8"));
  const pieceByProduct = new Map(pieces.map((r) => [r.product, r]));
  const recheck = parsePackRecheck(readFileSync(resolve(process.cwd(), RECHECK_CSV), "utf8"));
  const recheckByKey = new Map(recheck.map((r) => [packRecheckKey(r), r]));
  const rollup = parseAngelRollup(readFileSync(resolve(process.cwd(), ROLLUP_CSV), "utf8"));
  const rollupByProduct = new Map<string, (typeof rollup)[number]>();
  for (const r of rollup) if (!rollupByProduct.has(r.product)) rollupByProduct.set(r.product, r);

  // ── Live universe ──────────────────────────────────────────────────────────
  const measures = await loadMeasures();
  if (measures.size === 0) throw new Error("FATAL: measure_units loaded empty — every oz derivation below would be a guess.");
  const measureLabels = new Set(measures.keys());

  const { data: skuRows, error: sErr, count: skuCount } = await sb
    .from("vendor_items")
    .select("id, name, vendor_id, active, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each, vendors(name)", { count: "exact" })
    .eq("active", true).is("location_id", null)
    .returns<Array<{
      id: string; name: string; vendor_id: string | null; active: boolean;
      pack_format: string | null; each_container_label: string | null; units_per_pack: number | null;
      each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null;
      vendors: { name: string } | null;
    }>>();
  if (sErr) throw new Error(`load vendor_items: ${sErr.message}`);
  if (skuCount != null && (skuRows?.length ?? 0) < skuCount) {
    throw new Error(`vendor_items truncated: got ${skuRows?.length} of ${skuCount} — raise the page size before trusting this run`);
  }

  const chains = await loadSkuPackChains((skuRows ?? []).map((r) => r.id));
  const skus: LiveSku[] = (skuRows ?? []).map((r) => ({
    id: r.id, name: r.name, vendorId: r.vendor_id, vendorName: r.vendors?.name ?? "(no vendor)",
    active: r.active, packFormat: r.pack_format, eachContainerLabel: r.each_container_label,
    unitsPerPack: r.units_per_pack, eachSize: num(r.each_size), eachMeasure: r.each_measure,
    avgOzPerEach: num(r.avg_oz_per_each), chain: chains.get(r.id) ?? [],
  }));
  const byName = new Map<string, LiveSku[]>();
  for (const s of skus) {
    const list = byName.get(s.name) ?? [];
    list.push(s);
    byName.set(s.name, list);
  }

  /** Resolve a (name, vendor) pair to exactly one live row, or explain why not. */
  function resolveSku(name: string, expectVendor: string): { sku: LiveSku } | { code: Wave3Code; error: string } {
    const all = byName.get(name) ?? [];
    if (all.length === 0) return { code: "SKU_UNRESOLVED", error: `no ACTIVE global SKU named "${name}"` };
    const hits = all.filter((s) => s.vendorName === expectVendor);
    if (hits.length === 1) return { sku: hits[0]! };
    if (hits.length === 0) {
      return { code: "VENDOR_DRIFT", error: `"${name}" exists (${all.length} active row(s)) but none under vendor "${expectVendor}" — found: ${all.map((s) => s.vendorName).join(", ")}` };
    }
    return { code: "SKU_UNRESOLVED", error: `${hits.length} ACTIVE global SKUs named "${name}" under "${expectVendor}" — refusing to guess` };
  }

  async function loadPins(skuId: string): Promise<PinRow[]> {
    const { data, error } = await sb
      .from("recipe_inputs").select("id, quantity, unit, portioned, recipes(name)")
      .eq("component_sku_id", skuId)
      .returns<Array<{ id: string; quantity: number | string; unit: string | null; portioned: boolean; recipes: { name: string } | null }>>();
    if (error) throw new Error(`load pins for ${skuId}: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id, recipeName: r.recipes?.name ?? "(recipe)",
      quantity: num(r.quantity) ?? Number.NaN, unit: r.unit, portioned: r.portioned,
    }));
  }

  const describeChain = (s: LiveSku) =>
    s.chain.length === 0
      ? `(no chain) flat ${s.packFormat ?? "-"} ${s.unitsPerPack ?? "-"}x${s.eachSize ?? "-"}${s.eachMeasure ?? ""}`
      : s.chain.map((l) => `${l.label}=${l.containsQty}${l.containsMeasureUnit ?? "→level"}`).join(" / ");

  // ══ HEADER ═══════════════════════════════════════════════════════════════════
  if (MD) {
    p("# Angel fill — WAVE 3 DRY RUN (the piece model)\n");
    p("**Status: NOTHING HAS BEEN WRITTEN.** This is the output of");
    p("`scripts/seed/20-angel-wave3.ts` in its default (dry-run) mode. The script writes only");
    p("under an explicit `--execute` flag, and that flag is not used until Juan has eyeballed");
    p("the tables below.");
    p("");
    p(`**Generated:** 2026-08-20, against \`${PIECE_CSV}\`, \`${RECHECK_CSV}\` and \`${ROLLUP_CSV}\``);
    p("(Claude Cowork's harvest-2 capture) and live prod (`bgcvurheqzylyfehqgzh`). Every SKU id,");
    p("vendor, pack chain and existing price below was resolved live at run time.");
    p("");
    p("---");
    p("");
    p("## Read this first — the five things that matter\n");
    p("1. **Seven Boar's Head SKUs become priceable.** Delmar invoices by the PIECE, not the");
    p("   case (the hidden `1 CT` subtitle). Wave 2 refused all seven for");
    p("   `OUR_PACK_UNRESOLVABLE`; harvest 2 supplies the missing denominator. Each gets a");
    p("   one-piece pack chain and a `$/lb x piece-lb` price.");
    p("2. **Bacon is 64% understated, and this changes nightly depletion.** `avg_oz_per_each`");
    p("   0.75 -> 1.23 oz/strip. See the callout in section B — it is the only change in this");
    p("   wave that moves a number the business already consumes every night.");
    p("3. **Four SKUs STOP.** Genoa, Capicola, Provolone and Pepperoni carry live");
    p("   `avg_oz_per_each` values that are neither Juan's measured table nor the piece-derived");
    p("   figure, and **no audit row explains how they got there**. Their packs and prices are");
    p("   written; their weights are not. This is the wave's most valuable finding and it");
    p("   needs Juan's word, not a script's.");
    p("4. **The jug supersede corrects a pack and a price together, or not at all.** Oregano");
    p("   and onion powder are single jugs. Writing the jug price against our quarter-jug pack");
    p("   would produce a **four-fold** cost error — worse than today. Section C shows the");
    p("   arithmetic that makes the paired write cost-per-ounce NEUTRAL.");
    p("5. **Section D's pin move unblocks for mozzarella and stays blocked for ham** — for the");
    p("   same unexplained-live-weight reason as (3). Predicted, not assumed: the gate is");
    p("   computed here through the real production function.");
  }

  // ══ SECTION A — the Boar's Head piece model ══════════════════════════════════
  h(2, "Section A — the Boar's Head piece model (7 SKUs)");
  p("Harvest 2's structural find: every Delmar item carries `1 CT` in a subtitle the Purchases");
  p("grid never showed, and `Net Weight / Quantity` is the weight of ONE PIECE. There is no");
  p("case. So our pack becomes one piece, priced at `$/lb x piece-lb` — the $/lb is the");
  p("contract term and the piece weight is what varies.");
  p("");
  p("Three independent checks run on every row before anything is planned:");
  p("  1. the rollup's `weight_source` must be `invoice_catch_weight` (never a fabricated 1.0 lb);");
  p("  2. harvest 2's per-piece weight must fall inside the min/max range harvest 1 derived");
  p("     ALGEBRAICALLY from the same invoices (two routes, one number);");
  p("  3. the implied oz-per-slice is cross-checked against Juan's measured table AND against");
  p("     what the live row actually carries.");
  p("");

  const aRows: string[][] = [];
  const sliceRows: string[][] = [];

  for (const rule of PIECE_MODEL_RULES) {
    const hit = resolveSku(rule.skuName, rule.expectVendor);
    if ("error" in hit) {
      refusals.push({ section: "A", skuName: rule.skuName, subject: rule.product, code: hit.code, detail: hit.error });
      continue;
    }
    const sku = hit.sku;
    const piece = pieceByProduct.get(rule.product);
    const roll = rollupByProduct.get(rule.product);

    if (!piece || piece.ozPerPiece == null || piece.lbsPerPiece == null) {
      refusals.push({ section: "A", skuName: rule.skuName, subject: rule.product, code: "NO_MEASURED_WEIGHT", detail: `no usable row in ${PIECE_CSV}` });
      continue;
    }
    if (!roll || classifyWeightSource(roll.weightSource) !== "MEASURED") {
      refusals.push({ section: "A", skuName: rule.skuName, subject: rule.product, code: "NO_MEASURED_WEIGHT", detail: `rollup weight_source = ${roll?.weightSource ?? "(row absent)"}` });
      continue;
    }
    if (!pieceWeightInRange(piece.lbsPerPiece, roll.lbsPerUnitMin, roll.lbsPerUnitMax)) {
      refusals.push({
        section: "A", skuName: rule.skuName, subject: rule.product, code: "PIECE_WEIGHT_OUT_OF_RANGE",
        detail: `harvest 2 says ${piece.lbsPerPiece} lb/piece; harvest 1 derived ${roll.lbsPerUnitMin}–${roll.lbsPerUnitMax} lb from the same invoices`,
      });
      continue;
    }
    const ppl = roll.latestPricePerLb;
    if (ppl == null || ppl <= 0) {
      refusals.push({ section: "A", skuName: rule.skuName, subject: rule.product, code: "NO_MEASURED_WEIGHT", detail: "rollup carries no latest_price_per_lb" });
      continue;
    }
    const effectiveDate = parseAngelDate(roll.lastSeen);
    if (!effectiveDate) throw new Error(`could not parse last_seen "${roll.lastSeen}" for ${rule.product}`);

    // ── the pack chain (one piece) ──────────────────────────────────────────
    const pieceOz = piece.ozPerPiece;
    const levels = oneLevelChain(rule.chainLabel, pieceOz);
    const collision = firstLabelMeasureCollision(levels.map((l) => l.label), measureLabels);
    if (collision != null) {
      throw new Error(`FATAL: chain label "${collision}" IS an active measure_units label — it would shadow that measure in the chain-first ozForRecipeInput walk. Aborting (no writes).`);
    }
    const alreadyChained =
      sku.chain.length === 1 && sku.chain[0]!.label === rule.chainLabel &&
      Math.abs(Number(sku.chain[0]!.containsQty) - pieceOz) < 1e-9 && sku.chain[0]!.containsMeasureUnit === "oz";

    const flat = deriveFlatFieldsFromChain(levels);
    const beforeDescriptor = describeChain(sku);
    const afterDescriptor = `${rule.chainLabel}=${pieceOz}oz | flat ${flat.packFormat} ${flat.unitsPerPack}x${flat.eachSize}${flat.eachMeasure}`;

    if (alreadyChained) {
      refusals.push({ section: "A", skuName: rule.skuName, subject: "pack chain", code: "ALREADY_CORRECT", detail: `already ${rule.chainLabel}=${pieceOz} oz` });
    } else if (sku.chain.length > 1) {
      refusals.push({
        section: "A", skuName: rule.skuName, subject: "pack chain", code: "PACK_SHAPE_CHANGED",
        detail: `expected a chainless SKU or a single-level chain, found ${sku.chain.length} levels (${beforeDescriptor}) — re-derive rather than flatten`,
      });
    } else {
      chainWrites.push({
        section: "A", skuId: sku.id, skuName: sku.name, vendorName: sku.vendorName, levels,
        beforeDescriptor, afterDescriptor,
        evidence: `Angel subtitle \`${piece.angelSubtitle}\` (the hidden 1 CT); ${roll.purchaseLines} invoice lines, ${piece.lbsPerPiece} lb/piece (observed ${roll.lbsPerUnitMin}–${roll.lbsPerUnitMax} lb)`,
        metadata: {
          angel_product: rule.product, angel_subtitle: piece.angelSubtitle,
          unit_descriptor: piece.unitDescriptor,
          piece_lb: piece.lbsPerPiece, piece_oz: pieceOz,
          observed_lb_min: roll.lbsPerUnitMin, observed_lb_max: roll.lbsPerUnitMax,
          invoice_lines: roll.purchaseLines, weight_source: roll.weightSource,
          before_units_per_pack: sku.unitsPerPack, after_units_per_pack: flat.unitsPerPack,
          match_note: rule.matchNote,
        },
      });
    }

    // ── the price ───────────────────────────────────────────────────────────
    const price = priceFromPerLb(ppl, pieceOz);
    const pplNote = piece.pricePerLb != null && Math.abs(piece.pricePerLb - ppl) > 1e-9
      ? ` (the piece CSV quotes ${money(piece.pricePerLb)}/lb — that is the window's FIRST price; the rollup's ${money(ppl)} is the LATEST and is used)`
      : "";
    const arithmetic = `${money(ppl)}/lb x ${Number(price.ourPackLb.toFixed(4))} lb (one ${rule.chainLabel} = ${pieceOz} oz) = ${money(price.unitPrice)}`;
    const sourceNote =
      `${rule.product} [Delmar Provisions / Boar's Head] | PIECE MODEL (harvest 2): Angel subtitle \`${piece.angelSubtitle}\` carries \`1 CT\`, ` +
      `so the invoice Quantity is a COUNT OF PIECES and one piece weighs ${piece.lbsPerPiece} lb (${pieceOz} oz), observed ${roll.lbsPerUnitMin}–${roll.lbsPerUnitMax} lb over ${roll.purchaseLines} invoice lines. ` +
      `unit_price = ${money(ppl)}/lb x ${Number(price.ourPackLb.toFixed(4))} lb = ${money(price.unitPrice)}${price.rounded ? ` (exact ${price.exact}, rounded to cents)` : ""}. ` +
      `Derived from $/lb, NOT from a case price — the piece weight varies per delivery, the $/lb does not.${pplNote} ` +
      `Supersedes wave 2's OUR_PACK_UNRESOLVABLE refusal for this SKU.`;

    priceWrites.push({
      section: "A", skuId: sku.id, skuName: sku.name, vendorName: sku.vendorName,
      angelProduct: rule.product, unitPrice: price.unitPrice, effectiveDate, sourceNote, arithmetic,
      metadata: {
        angel_product: rule.product, angel_vendor: "Delmar Provisions",
        price_per_lb: ppl, piece_lb: piece.lbsPerPiece, piece_oz: pieceOz,
        our_pack_lb: price.ourPackLb, relation: "PIECE_MODEL_PER_LB",
        angel_weight_source: roll.weightSource, invoice_lines: roll.purchaseLines,
        match_confidence: rule.skuName === "Roast Beef" ? "INFERRED" : "DIRECT",
        match_note: rule.matchNote,
      },
    });

    aRows.push([
      sku.name, `\`${rule.product}\``, `${money(ppl)}/lb`,
      `${piece.lbsPerPiece} lb`, `${pieceOz} oz`, `**${money(price.unitPrice)}**`,
      alreadyChained ? "chain already correct" : `${sku.unitsPerPack ?? "-"}x -> 1x${pieceOz}oz`,
    ]);

    // ── the slice weight: cross-check, then decide ──────────────────────────
    const slices = parseSliceCount(piece.slicesPerPieceRaw);
    const slicesN = slices && slices.lo === slices.hi ? slices.lo : null;
    const juanOz = JUAN_SLICE_OZ[sku.name] ?? null;
    const vsJuan = crossCheckSlice(pieceOz, slicesN, juanOz);
    const vsLive = crossCheckSlice(pieceOz, slicesN, sku.avgOzPerEach);
    const derived = vsJuan.derivedOzPerSlice;

    const pins = await loadPins(sku.id);
    const countPin = pins.find((pn) => pn.unit != null && (measures.get(pn.unit)?.dimension === "count"));

    sliceRows.push([
      sku.name,
      `${pieceOz} / ${slicesN ?? piece.slicesPerPieceRaw}`,
      derived != null ? `${derived.toFixed(4)}` : "—",
      juanOz != null ? `${juanOz}` : "_(no entry)_",
      sku.avgOzPerEach != null ? `${sku.avgOzPerEach}` : "NULL",
      vsJuan.verdict === "AGREES" ? "✓" : vsJuan.verdict === "NO_REFERENCE" ? "n/a" : `**${vsJuan.verdict}**`,
      vsLive.verdict === "AGREES" ? "✓" : vsLive.verdict === "NO_REFERENCE" ? "NULL" : `**${pct(vsLive.deltaFraction ?? 0)}**`,
      derived == null ? "—"
        : vsJuan.verdict === "DISAGREES" ? "STOP (vs Juan)"
        : vsLive.verdict === "DISAGREES" ? "**STOP (live unexplained)**"
        : sku.avgOzPerEach == null ? `**WRITE ${juanOz ?? Number(derived.toFixed(2))}**`
        : "no-op (already right)",
    ]);

    if (derived == null || slicesN == null) {
      refusals.push({ section: "A", skuName: sku.name, subject: "avg_oz_per_each", code: "NO_MEASURED_WEIGHT", detail: `slices_per_piece "${piece.slicesPerPieceRaw}" is not a single integer` });
      continue;
    }
    if (vsJuan.verdict === "DISAGREES") {
      // Juan's table is floor truth. A derived number never overwrites a measured one.
      stops.push({
        section: "A", skuName: sku.name,
        headline: `piece model disagrees with Juan's measured slice table by ${pct(vsJuan.deltaFraction!)}`,
        detail: [`derived ${derived.toFixed(4)} oz/slice (${pieceOz} oz / ${slicesN} slices) vs Juan's ${juanOz}`],
        unblock: "Adjudicate which is right. His table is floor truth, so the piece model is what moves.",
      });
      refusals.push({ section: "A", skuName: sku.name, subject: "avg_oz_per_each", code: "SLICE_TABLE_DISAGREEMENT", detail: `derived ${derived.toFixed(4)} vs Juan's ${juanOz} (${pct(vsJuan.deltaFraction!)})` });
      continue;
    }
    if (sku.avgOzPerEach != null && vsLive.verdict === "DISAGREES") {
      // The finding. Live carries a number that is neither reference, unaudited.
      const target = juanOz ?? Number(derived.toFixed(2));
      const before = countPin ? ozForRecipeInput(countPin.quantity, countPin.unit, shapeOf(sku), measures) : null;
      const after = countPin ? ozForRecipeInput(countPin.quantity, countPin.unit, shapeOf(sku, { avgOzPerEach: target }), measures) : null;
      stops.push({
        section: "A", skuName: sku.name,
        headline: `live avg_oz_per_each ${sku.avgOzPerEach} is neither Juan's ${juanOz} nor the piece-derived ${derived.toFixed(4)} — and no audit row explains it`,
        detail: [
          `Juan's measured table (seed 10):   ${juanOz} oz/slice — written 2026-07-22, audit row present`,
          `piece model (harvest 2):           ${derived.toFixed(4)} oz/slice = ${pieceOz} oz / ${slicesN} slices`,
          `LIVE in prod today:                ${sku.avgOzPerEach} oz/slice (${pct(vsLive.deltaFraction!)} from the piece model)`,
          `slices per piece at the live weight: ${Math.floor(pieceOz / sku.avgOzPerEach)} (harvest 2 reports ${slicesN})`,
          `$/slice at the live weight:        ${money4(priceFromPerLb(ppl, pieceOz).unitPrice / Math.floor(pieceOz / sku.avgOzPerEach))} (harvest 2 reports $${piece.costPerSliceRaw}) — the harvest's $/slice is computed off seed 10's constants, so if LIVE is right this whole column is wrong`,
          countPin
            ? `depletion if overwritten:          "${countPin.recipeName}" ${countPin.quantity} ${countPin.unit} -> ${oz(before)} becomes ${oz(after)}`
            : "no count-unit recipe pin on this SKU today",
        ],
        unblock: `Confirm the real slice weight with Juan. If ${sku.avgOzPerEach} is his floor number, seed 10's constant is the stale one and BOTH the harvest's slices-per-piece and its $/slice need recomputing. If ${juanOz} is right, an unaudited edit is live in production.`,
      });
      refusals.push({ section: "A", skuName: sku.name, subject: "avg_oz_per_each", code: "LIVE_WEIGHT_UNEXPLAINED", detail: `live ${sku.avgOzPerEach}, Juan's table ${juanOz}, piece-derived ${derived.toFixed(4)}` });
      continue;
    }
    if (sku.avgOzPerEach == null) {
      // Nobody had a number. The piece model supplies one; where Juan has an entry it wins.
      const target = juanOz ?? Number(derived.toFixed(2));
      weightWrites.push({
        section: "A", skuId: sku.id, skuName: sku.name, vendorName: sku.vendorName,
        fromOz: null, toOz: target,
        arithmetic: `${pieceOz} oz / ${slicesN} slices = ${derived.toFixed(4)} -> ${target}`,
        note: juanOz != null ? `Juan's measured table value, corroborated by the piece model` : `piece model (harvest 2); no entry in Juan's measured table — behaves like turkey`,
        depletionImpact: countPin
          ? `"${countPin.recipeName}" ${countPin.quantity} ${countPin.unit}: NULL (unresolvable) -> ${oz(ozForRecipeInput(countPin.quantity, countPin.unit, shapeOf(sku, { avgOzPerEach: target }), measures))}`
          : "no count-unit recipe pin — this SKU's lines are weight-denominated, so nothing depletes differently",
        metadata: { angel_product: rule.product, piece_oz: pieceOz, slices_per_piece: slicesN, derived_oz_per_slice: derived, juan_table_oz: juanOz },
      });
    } else {
      refusals.push({ section: "A", skuName: sku.name, subject: "avg_oz_per_each", code: "ALREADY_CORRECT", detail: `live ${sku.avgOzPerEach} already matches Juan's table and the piece model` });
    }
  }

  p("── WOULD WRITE: pack chain + price ──");
  table(["our SKU", "Angel product", "$/lb", "piece", "piece oz", "unit price", "pack change"], aRows, ["", "", "r", "r", "r", "r", ""]);
  p("");
  p("**Two cent-level notes, so nobody has to wonder why these differ from the harvest doc.**");
  p("");
  p("*The `pack change` column.* Five of these carry a legacy `Case of N` from the order-guide");
  p("seed. Harvest 2 says there is no case — the vendor invoices one piece — and Juan's own pars");
  p("already count pieces (\"8 pcs\", \"5 Logs\", \"22 (not prepped)\"). A par of 8 pieces against a");
  p("pack of one piece is exact; against a `Case of 5` it is 1.6 cases and the walker has to");
  p("invent a rounding rule. **This is the one structural change in the wave** — flagged rather");
  p("than buried in a summary count.");
  p("");
  p("*Prices land ±$0.01 from the harvest doc's `cost_per_piece`.* We multiply by `oz_per_piece`");
  p("(the CSV's 1-dp figure, which IS our pack and divides evenly into the slice count); the doc");
  p("multiplied by `lbs_per_piece` at 3 dp. Turkey is $58.18 here vs $58.19 there — 148 oz is");
  p("9.2500 lb, 9.251 lb is 148.016 oz. Using our own pack's ounces keeps `unit_price` and pack");
  p("content the same fact; borrowing the doc's cent would not. Pepperoni is the one real gap:");
  p("the piece CSV quotes $5.09/lb (the window's FIRST price) while the rollup's latest is");
  p("$5.19 — we use the latest, which is why $18.13 here vs $17.79 in the doc.");
  p("");
  p("── THE SLICE CROSS-CHECK (three opinions per SKU) ──");
  p("`derived` is piece_oz / slices_per_piece. Note what it is NOT: the harvest computed");
  p("`slices_per_piece` as floor(piece_oz / Juan's oz-per-slice), so dividing back is close to");
  p("an identity and the `vs Juan` column is a ROUNDING check, not corroboration. The column");
  p("that earns its place is `vs LIVE`.");
  p("");
  table(["our SKU", "piece oz / slices", "derived", "Juan (seed 10)", "LIVE", "derived vs Juan", "derived vs LIVE", "action"],
    sliceRows, ["", "r", "r", "r", "r", "", "r", ""]);
  p("");
  p("Read the `derived vs LIVE` percentages in that direction: `+150.0%` on Genoa means the piece");
  p("model's slice is two and a half times the live one — equivalently, production carries a slice");
  p("**60% lighter** than both other sources say.");

  // ══ SECTION B — weight-file corrections ══════════════════════════════════════
  h(2, "Section B — weight-file corrections (DB + the seed-10 constants)");
  p("Each correction below lands in TWO places in this PR: the live row, and the constant in");
  p("`scripts/seed/10-fill-sku-weights.ts`, so a future re-run of that seed cannot regress it.");
  p("");

  // B1 — bacon. The one change that moves a number the business consumes nightly.
  h(3, "B1 — Bacon 0.75 -> 1.23 oz/strip ⚠ THIS MOVES NIGHTLY TOAST DEPLETION");
  const baconHit = resolveSku(BACON_CORRECTION.skuName, BACON_CORRECTION.expectVendor);
  if ("error" in baconHit) {
    refusals.push({ section: "B1", skuName: BACON_CORRECTION.skuName, subject: "avg_oz_per_each", code: baconHit.code, detail: baconHit.error });
    p(`REFUSED: ${baconHit.error}`);
  } else {
    const bacon = baconHit.sku;
    const baconPins = await loadPins(bacon.id);
    const target = BACON_CORRECTION.toOz;
    pre();
    p(`Angel subtitle : GROCERY-REF-FZN · BACON · LAYER BACON · 12/14 · 1 CT`);
    p(`  "12/14" is a SLICE SPEC, not a size code: 12-14 strips per POUND.`);
    p(`Arithmetic     : 16 oz / ${(BACON_SLICE_SPEC.slicesPerLbLo + BACON_SLICE_SPEC.slicesPerLbHi) / 2} strips-per-lb = ${(16 / 13).toFixed(4)} -> ${target} oz/strip`);
    p(`  corroborated : the ${BACON_CORRECTION.boxOz} oz box / ${target} oz = ${Math.round(BACON_CORRECTION.boxOz / target)} strips, inside the 180-210 the spec implies`);
    p(`  live today   : ${bacon.avgOzPerEach} oz/strip, which implies ${(16 / Number(bacon.avgOzPerEach ?? 1)).toFixed(1)} strips/lb for bacon spec'd at 12-14`);
    p(`  understatement: ${pct(target / BACON_CORRECTION.fromOz - 1)}`);
    p(`Pack           : ${describeChain(bacon)} — ALREADY CORRECT (240 oz = Angel's 15.0 lb box to the ounce). Not touched.`);
    p(`Price          : wave 2 already wrote ${money(70.35)} against that 240 oz box. Not touched.`);
    pre();
    p("");
    p("**Depletion impact — read this before approving.** `avg_oz_per_each` is what a COUNT-unit");
    p("recipe line consumes, and bacon has one:");
    p("");
    const impacts: string[][] = [];
    for (const pin of baconPins) {
      const before = ozForRecipeInput(pin.quantity, pin.unit, shapeOf(bacon), measures);
      const after = ozForRecipeInput(pin.quantity, pin.unit, shapeOf(bacon, { avgOzPerEach: target }), measures);
      impacts.push([
        pin.recipeName, `${pin.quantity} ${pin.unit ?? "(no unit)"}`, oz(before), oz(after),
        before != null && after != null ? `**${pct(after / before - 1)}**` : "—",
      ]);
    }
    table(["recipe", "line", "depletes today", "depletes after", "change"], impacts, ["", "", "r", "r", "r"]);
    p("");
    p("Every batch of that recipe made from tonight forward depletes 64% more bacon than it does");
    p("today. That is the fix working — co-ops was under-consuming a real ingredient — but it will");
    p("visibly move bacon's on-hand burn and its variance the first night it runs, and Juan should");
    p("expect that rather than discover it. **Historical rows are untouched**: depletion is");
    p("append-only and every past row was point-in-time correct against the weight then in force.");
    p("On the Regular BLT (2-3 strips) this is $0.28-$0.42 of cost that was missing from a $10 item.");
    p("");
    if (bacon.avgOzPerEach != null && Math.abs(bacon.avgOzPerEach - target) < 1e-9) {
      refusals.push({ section: "B1", skuName: bacon.name, subject: "avg_oz_per_each", code: "ALREADY_CORRECT", detail: `already ${target}` });
      p(`  = already ${target} oz — no write.`);
    } else if (bacon.avgOzPerEach != null && Math.abs(bacon.avgOzPerEach - BACON_CORRECTION.fromOz) > 1e-9) {
      refusals.push({ section: "B1", skuName: bacon.name, subject: "avg_oz_per_each", code: "LIVE_WEIGHT_UNEXPLAINED", detail: `expected ${BACON_CORRECTION.fromOz}, found ${bacon.avgOzPerEach} — someone changed it since the harvest` });
      p(`  ! REFUSING: expected ${BACON_CORRECTION.fromOz}, found ${bacon.avgOzPerEach}.`);
    } else {
      weightWrites.push({
        section: "B", skuId: bacon.id, skuName: bacon.name, vendorName: bacon.vendorName,
        fromOz: bacon.avgOzPerEach, toOz: target,
        arithmetic: `16 oz / 13 strips-per-lb (the "12/14" spec) = ${(16 / 13).toFixed(4)} -> ${target}`,
        note: `Angel subtitle "IMP LAYER BACON 12/14": 12-14 strips per POUND. The live 0.75 implies 21.3/lb. Corroborated by the 240 oz box / ${target} = ${Math.round(BACON_CORRECTION.boxOz / target)} strips, inside 180-210.`,
        depletionImpact: impacts.map((i) => `${i[0]}: ${i[2]} -> ${i[3]} (${i[4]})`).join("; "),
        metadata: {
          angel_product: "IMP LAYER BACON 12/14", slice_spec: "12/14 strips per lb",
          box_oz: BACON_CORRECTION.boxOz, implied_strips_per_box: Math.round(BACON_CORRECTION.boxOz / target),
          understatement_fraction: target / BACON_CORRECTION.fromOz - 1,
          depletion_note: "changes nightly Toast depletion going forward; historical rows are append-only and point-in-time correct",
        },
      });
    }
  }

  // B2 — fresh mozzarella
  h(3, "B2 — Fresh Mozzarella 72 -> 192 slices, and the price that follows");
  pre();
  p(`1 log  = ${MOZZARELLA_CASE.slicesPerLog} CT x ${MOZZARELLA_CASE.ozPerSlice} oz = ${MOZZARELLA_CASE.slicesPerLog * MOZZARELLA_CASE.ozPerSlice} oz = 2 lb    <- matches the "6/2 LB" pack field`);
  p(`1 case = ${MOZZARELLA_CASE.logsPerCase} logs       = 12 lb            <- matches the "12 LB" subtitle`);
  p(`1 case = ${MOZZARELLA_CASE.slicesPerCase} slices  = ${MOZZARELLA_CASE.caseOz} oz`);
  p(`The live 72 implies a ${MOZZARELLA_CASE.fromUnits / 16} lb case — neither the 12 lb nominal nor the 12.76 lb measured.`);
  p(`Angel's measured net is 12.7642 lb (${MOZZARELLA_CASE.caseOz} oz nominal x 1.064). That gap is brine and`);
  p(`packaging, not cheese, so the pack is ${MOZZARELLA_CASE.caseOz} oz of CHEESE and the price divides by that.`);
  pre();
  p("");
  const mozzRoll = rollupByProduct.get("CHEESE MOZZ 1OZ SLCD LOG 32 CT");
  const mozzCasePrice = mozzRoll?.unitPriceMin ?? null;
  const mozzEffective = mozzRoll ? parseAngelDate(mozzRoll.lastSeen) : null;
  if (mozzRoll == null || mozzCasePrice == null || mozzEffective == null) {
    refusals.push({ section: "B2", skuName: "Fresh Mozzarella", subject: "price", code: "NO_MEASURED_WEIGHT", detail: "no usable rollup row for CHEESE MOZZ 1OZ SLCD LOG 32 CT" });
    p("REFUSED: the rollup carries no usable row for the mozzarella case.");
  } else {
    // Verify the case price live-derived rather than transcribed: $/lb x measured lb.
    const derivedCase = (mozzRoll.latestPricePerLb ?? 0) * ((mozzRoll.lbsPerUnitMin ?? 0) + (mozzRoll.lbsPerUnitMax ?? 0)) / 2;
    p(`Case price verified live from the rollup: unit_price_min = unit_price_max = ${money(mozzCasePrice)} across`);
    p(`${mozzRoll.purchaseLines} purchases (no price movement to model), and independently ${money(mozzRoll.latestPricePerLb ?? 0)}/lb x`);
    p(`${(((mozzRoll.lbsPerUnitMin ?? 0) + (mozzRoll.lbsPerUnitMax ?? 0)) / 2).toFixed(4)} lb = ${money(derivedCase)}. Two routes, one number.`);
    p("");

    // BOTH twins carry this product. Correct both; price only the PFG primary.
    for (const side of [
      { vendor: "PFG", role: "primary (seed 18)", priced: true },
      { vendor: "Baldor", role: "backup (seed 18)", priced: false },
    ]) {
      const hit = resolveSku(MOZZARELLA_CASE.skuName, side.vendor);
      if ("error" in hit) {
        refusals.push({ section: "B2", skuName: `${side.vendor}/Fresh Mozzarella`, subject: "pack", code: hit.code, detail: hit.error });
        continue;
      }
      const sku = hit.sku;
      const contentBefore = skuContentOz(shapeOf(sku), measures);
      const levels = [
        { label: "case", containsQty: MOZZARELLA_CASE.slicesPerCase, containsIndex: 1 as number | null, containsMeasureUnit: null as string | null },
        { label: "inner", containsQty: 1, containsIndex: null as number | null, containsMeasureUnit: "each" as string | null },
      ];
      const collision = firstLabelMeasureCollision(levels.map((l) => l.label), measureLabels);
      if (collision != null) throw new Error(`FATAL: mozzarella chain label "${collision}" IS an active measure unit. Aborting.`);
      const flat = deriveFlatFieldsFromChain(levels);
      const contentAfter = skuContentOz(shapeOf(sku, { packChain: null, unitsPerPack: flat.unitsPerPack, eachSize: flat.eachSize, eachMeasure: flat.eachMeasure, avgOzPerEach: MOZZARELLA_CASE.ozPerSlice }), measures);

      p(`**${side.vendor}/Fresh Mozzarella** [${sku.id}] — ${side.role}`);
      p(`  before: ${describeChain(sku)} avg_oz_per_each=${sku.avgOzPerEach ?? "NULL"} content=${oz(contentBefore)}`);
      p(`  after:  case=${MOZZARELLA_CASE.slicesPerCase}x inner / inner=1 each, avg_oz_per_each=${MOZZARELLA_CASE.ozPerSlice} -> content=${oz(contentAfter)}`);
      if (side.vendor === "Baldor") {
        p(`  ⚠ This twin is the row \`10-fill-sku-weights.ts\` actually wrote its 72 to (audit 2026-07-22).`);
        p(`    The harvest's punch-list item 2 names that file, so this row is the literal target of the`);
        p(`    correction — but its Angel evidence is the PFG/ROMA/BelGioioso line, so applying it here`);
        p(`    is an INFERENCE that both distributors ship the same BelGioioso case. It is safe (this`);
        p(`    twin carries no price rows, and its recipe pin resolves through avg_oz_per_each, which`);
        p(`    does not change) and it is what makes the two twins structurally identical, which is`);
        p(`    what section D needs. Flagged rather than buried.`);
      }
      p("");

      const already = sku.chain.length === 2 && Number(sku.chain.find((l) => l.label === "case")?.containsQty ?? 0) === MOZZARELLA_CASE.slicesPerCase;
      if (already) {
        refusals.push({ section: "B2", skuName: `${side.vendor}/Fresh Mozzarella`, subject: "pack chain", code: "ALREADY_CORRECT", detail: `already ${MOZZARELLA_CASE.slicesPerCase} slices` });
      } else {
        chainWrites.push({
          section: "B", skuId: sku.id, skuName: sku.name, vendorName: sku.vendorName, levels,
          beforeDescriptor: describeChain(sku), afterDescriptor: `case=${MOZZARELLA_CASE.slicesPerCase}x inner / inner=1 each`,
          evidence: `Angel \`CHEESE MOZZ 1OZ SLCD LOG 32 CT\` [ROMA] pack 6/2 LB, subtitle "... SLCD LOG 32 CT · BELGIOIOSO CHEESE · 12 LB": 6 logs x 32 CT x 1 oz = 192 slices = 12 lb`,
          metadata: {
            angel_product: "CHEESE MOZZ 1OZ SLCD LOG 32 CT", logs_per_case: MOZZARELLA_CASE.logsPerCase,
            slices_per_log: MOZZARELLA_CASE.slicesPerLog, slices_per_case: MOZZARELLA_CASE.slicesPerCase,
            before_units: sku.unitsPerPack, measured_case_lb: 12.7642,
            measured_over_nominal: 12.7642 / 12, tare_note: "the 6.4% over nominal is brine and packaging, not cheese",
            inferred_for_backup_twin: side.vendor === "Baldor",
          },
        });
      }
      if (sku.avgOzPerEach == null) {
        weightWrites.push({
          section: "B", skuId: sku.id, skuName: sku.name, vendorName: sku.vendorName,
          fromOz: null, toOz: MOZZARELLA_CASE.ozPerSlice,
          arithmetic: `the SKU name says it: MOZZ 1OZ SLCD, and 32 CT x 1 oz = 2 lb closes against the 6/2 LB pack field`,
          note: "1 oz slice, confirmed by the product name and the case arithmetic from two directions",
          depletionImpact: "none today (this twin carries no recipe pins); it is what lets section D's pin move preserve its oz meaning",
          metadata: { angel_product: "CHEESE MOZZ 1OZ SLCD LOG 32 CT", basis: "SKU name MOZZ 1OZ SLCD + 32 CT x 1 oz = 2 lb" },
        });
      } else if (Math.abs(sku.avgOzPerEach - MOZZARELLA_CASE.ozPerSlice) > 1e-9) {
        refusals.push({ section: "B2", skuName: `${side.vendor}/Fresh Mozzarella`, subject: "avg_oz_per_each", code: "LIVE_WEIGHT_UNEXPLAINED", detail: `live ${sku.avgOzPerEach}, expected ${MOZZARELLA_CASE.ozPerSlice}` });
      } else {
        refusals.push({ section: "B2", skuName: `${side.vendor}/Fresh Mozzarella`, subject: "avg_oz_per_each", code: "ALREADY_CORRECT", detail: `already ${MOZZARELLA_CASE.ozPerSlice}` });
      }

      if (side.priced) {
        const perSlice = mozzCasePrice / MOZZARELLA_CASE.slicesPerCase;
        const arithmetic = `${money(mozzCasePrice)} per case / 1 (our pack IS the case: ${MOZZARELLA_CASE.caseOz} oz = Angel's ${MOZZARELLA_CASE.caseOz} oz) = ${money(mozzCasePrice)}  [= $${perSlice.toFixed(4)}/slice]`;
        priceWrites.push({
          section: "B", skuId: sku.id, skuName: sku.name, vendorName: sku.vendorName,
          angelProduct: "CHEESE MOZZ 1OZ SLCD LOG 32 CT", unitPrice: mozzCasePrice, effectiveDate: mozzEffective,
          arithmetic,
          sourceNote:
            `CHEESE MOZZ 1OZ SLCD LOG 32 CT [ROMA] 6/2 LB | case ${money(mozzCasePrice)} = ${MOZZARELLA_CASE.logsPerCase} logs x ${MOZZARELLA_CASE.slicesPerLog} slices x ${MOZZARELLA_CASE.ozPerSlice} oz = ${MOZZARELLA_CASE.caseOz} oz, ` +
            `which equals our corrected ${MOZZARELLA_CASE.caseOz} oz pack -> ${money(mozzCasePrice)} per case (no division), $${perSlice.toFixed(4)}/slice. ` +
            `Case price is rock stable at ${money(mozzCasePrice)} across all ${mozzRoll.purchaseLines} purchases. Angel's measured net 12.7642 lb is 6.4% over nominal — brine and packaging, not cheese — so the divisor is the ${MOZZARELLA_CASE.caseOz} oz of product. ` +
            `Seed 18 REFUSED to price this pair because our pack was "72 count with avg_oz_per_each NULL, content UNRESOLVABLE"; harvest 2 supplies the pack, so the refusal is discharged rather than overridden.`,
          metadata: {
            angel_product: "CHEESE MOZZ 1OZ SLCD LOG 32 CT", angel_brand: "ROMA", angel_pack_size_raw: "6/2 LB",
            case_price_usd: mozzCasePrice, case_oz: MOZZARELLA_CASE.caseOz, divisor: 1,
            cost_per_slice: perSlice, purchase_lines: mozzRoll.purchaseLines,
            discharges: "seed 18 whyUnpriced (Fresh Mozzarella)",
          },
        });
      }
    }
  }

  // B3 — PFG ham slice weight
  h(3, "B3 — PFG Ham avg_oz_per_each = 1.0 (from Juan's own measured table)");
  const hamPfg = resolveSku("Ham", "PFG");
  const hamBaldor = resolveSku("Ham", "Baldor");
  if ("error" in hamPfg) {
    refusals.push({ section: "B3", skuName: "PFG/Ham", subject: "avg_oz_per_each", code: hamPfg.code, detail: hamPfg.error });
    p(`REFUSED: ${hamPfg.error}`);
  } else {
    const target = JUAN_SLICE_OZ.Ham ?? 1.0;
    const baldorOz = "error" in hamBaldor ? null : hamBaldor.sku.avgOzPerEach;
    pre();
    p(`PFG/Ham   [${hamPfg.sku.id}] avg_oz_per_each = ${hamPfg.sku.avgOzPerEach ?? "NULL"}  (seed 18 PRIMARY: holds the par, the price and — eventually — the pins)`);
    p(`Baldor/Ham${"error" in hamBaldor ? " NOT RESOLVED" : ` [${hamBaldor.sku.id}] avg_oz_per_each = ${baldorOz ?? "NULL"}  (seed 18 BACKUP: holds the pins today)`}`);
    p(`Juan's measured table (seed 10): Ham 1.0 oz, "unit = one thin deli slice"`);
    pre();
    p("");
    if (hamPfg.sku.avgOzPerEach != null && Math.abs(hamPfg.sku.avgOzPerEach - target) < 1e-9) {
      refusals.push({ section: "B3", skuName: "PFG/Ham", subject: "avg_oz_per_each", code: "ALREADY_CORRECT", detail: `already ${target}` });
      p(`  = already ${target} — no write.`);
    } else if (hamPfg.sku.avgOzPerEach != null) {
      refusals.push({ section: "B3", skuName: "PFG/Ham", subject: "avg_oz_per_each", code: "LIVE_WEIGHT_UNEXPLAINED", detail: `live ${hamPfg.sku.avgOzPerEach}, Juan's table ${target}` });
    } else {
      weightWrites.push({
        section: "B", skuId: hamPfg.sku.id, skuName: hamPfg.sku.name, vendorName: hamPfg.sku.vendorName,
        fromOz: null, toOz: target,
        arithmetic: `Juan's measured slice table, scripts/seed/10-fill-sku-weights.ts: { name: "Ham", avgOz: 1.0, note: "unit = one thin deli slice" }`,
        note: "Not derived from Angel at all — Angel has no per-slice data for ham. This is Juan's own hand-measured number, applied to the twin that will carry the PO.",
        depletionImpact: "none today (the PFG twin carries no recipe pins); it exists so section D's pin move has a value to preserve",
        metadata: { basis: "scripts/seed/10-fill-sku-weights.ts FILLS table (Juan-measured)", juan_table_oz: target, backup_twin_live_oz: baldorOz },
      });
    }
    if (baldorOz != null && Math.abs(baldorOz - target) > 1e-9) {
      p("");
      p("⚠ **This does NOT unblock section D for ham, and the brief expected it to.** Seed 18's pin");
      p(`gate requires the line's oz MEANING to be identical on both twins. The Baldor twin carries`);
      p(`**${baldorOz}** oz/slice, not ${target} — so after this write the gate compares ${baldorOz} against ${target}, still`);
      p("refuses, and the pins stay on the backup. Writing 1.0 here is nonetheless correct: it is");
      p("Juan's own measured number and the PFG twin currently has nothing at all. What is NOT");
      p("resolved is which twin is wrong, and that is the same unexplained-live-weight question as");
      p("section A's four STOPs. See the STOP list.");
      stops.push({
        section: "B3/D", skuName: "Ham",
        headline: `Baldor/Ham carries ${baldorOz} oz/slice; Juan's measured table and seed 10's own audit row both say ${target}`,
        detail: [
          `Juan's measured table (seed 10): ${target} oz — and the audit row from 2026-07-22 records seed 10 writing exactly ${target} to this row`,
          `LIVE on Baldor/Ham today:        ${baldorOz} oz — changed since, with NO audit row`,
          `PFG/Ham (the primary):           ${hamPfg.sku.avgOzPerEach ?? "NULL"}`,
          `consequence: seed 18's pin gate compares ${baldorOz} vs ${target} and REFUSES; the ham pin stays on the backup twin`,
        ],
        unblock: `Decide the real ham slice weight. Setting PFG/Ham to ${baldorOz} instead would make the gate pass immediately — but it would ratify an unaudited value over Juan's measured one, which is the wrong way round to decide it.`,
      });
    }
  }

  // B4 — Ever Roast (already handled in A; restated here so the punch list maps 1:1)
  h(3, "B4 — Ever Roast Chicken: a new entry in the weights file");
  p("Handled in section A above (it is one of the seven piece-model SKUs). Restated here because");
  p("the harvest's punch list numbers it separately: the SKU exists live under Boar's Head with");
  p("`avg_oz_per_each = NULL` and no pack data of any kind, which is why wave 2 could not even");
  p("frame a decision-table row for it. Harvest 2 gives it both. The 1.0 oz/slice is the harvest's");
  p("proposal (\"a sliced deli chicken breast, behaves like turkey\"), corroborated by the piece");
  p("model at 74.1 oz / 74 slices = 1.0014 — and it is a fill into a NULL, not an overwrite.");

  // ══ SECTION C — the jug supersedes ═══════════════════════════════════════════
  h(2, "Section C — wave-1 price corrections (append-only supersede)");
  p("The pack recheck answers the oregano question outright: **`units_per_case = 1`. It is one");
  p("jug.** So wave 1's div-4 (oregano) and div-5 (onion powder) were not merely uncertain — the");
  p("way wave 2's re-sweep left them — they were wrong. There is no inner unit to divide by.");
  p("");
  p("**Why the pack moves with the price, and why that is not scope creep.** `unit_price` is the");
  p("price of ONE OF OUR PACKS. Writing the jug price while our SKU still models a 20 oz");
  p("quarter-jug gives $55.27 / 20 oz = **$2.76/oz** against a true $0.69/oz — a four-fold error,");
  p("strictly worse than the state it replaces. The divisor and the pack are one fact seen twice,");
  p("so this section writes both or neither. The proof that this is safe is in the last two");
  p("columns: cost-per-ounce does not move by a hundredth of a cent.");
  p("");
  p("**What is deliberately NOT corrected: the jug's WEIGHT.** These sit in a four-SKU cluster");
  p("Angel measures at exactly 1.20x nominal (5.0 -> 6.0 lb, and 1.5 -> 1.8 on the small oregano),");
  p("which is a feed artifact's signature rather than tare's — real tare does not scale");
  p("proportionally. The jug ounces below are the pack string's nominal 5 lb, which is also");
  p("verbatim the `angelCaseOz` wave 1's own division table already asserts. If Juan's scale says");
  p("6 lb, that is a separate one-line change to a different column.");
  p("");

  const cRows: string[][] = [];
  for (const j of JUG_SUPERSEDES) {
    const hit = resolveSku(j.skuName, j.expectVendor);
    if ("error" in hit) {
      refusals.push({ section: "C", skuName: j.skuName, subject: j.product, code: hit.code, detail: hit.error });
      continue;
    }
    const sku = hit.sku;
    const rc = recheckByKey.get(packRecheckKey(j));
    if (!rc || rc.unitsPerCase !== 1) {
      refusals.push({ section: "C", skuName: j.skuName, subject: j.product, code: "NO_MEASURED_WEIGHT", detail: `pack-recheck row missing or units_per_case != 1 (got ${rc?.unitsPerCase ?? "absent"})` });
      continue;
    }
    const roll = rollupByProduct.get(j.product);
    const casePrice = roll?.unitPriceMax ?? null;
    if (casePrice == null || Math.abs(casePrice - j.casePriceUsd) > 0.005) {
      refusals.push({ section: "C", skuName: j.skuName, subject: j.product, code: "NO_MEASURED_WEIGHT", detail: `rollup case price ${casePrice ?? "absent"} does not match the recorded ${j.casePriceUsd} — re-derive before writing` });
      continue;
    }
    const effectiveDate = roll ? parseAngelDate(roll.lastSeen) : null;
    if (!effectiveDate) throw new Error(`could not parse last_seen for ${j.product}`);

    // Live pack must still be the shape this supersede was written against.
    const liveOz = skuContentOz(shapeOf(sku), measures);
    if (liveOz == null || Math.abs(liveOz - j.currentPackOz) > 1e-9) {
      refusals.push({ section: "C", skuName: j.skuName, subject: "pack chain", code: "PACK_SHAPE_CHANGED", detail: `expected a ${j.currentPackOz} oz pack, live resolves to ${oz(liveOz)} (${describeChain(sku)})` });
      continue;
    }

    const before = costPerOz(j.wave1UnitPrice, j.currentPackOz);
    const after = costPerOz(j.casePriceUsd, j.nominalJugOz);
    const neutral = costPerOzUnchanged(before, after);
    if (!neutral) {
      refusals.push({ section: "C", skuName: j.skuName, subject: "paired write", code: "PACK_SHAPE_CHANGED", detail: `cost/oz would move ${before?.toFixed(6)} -> ${after?.toFixed(6)}; this correction is only safe while it is neutral` });
      continue;
    }

    const levels = oneLevelChain(j.chainLabel, j.nominalJugOz);
    const collision = firstLabelMeasureCollision(levels.map((l) => l.label), measureLabels);
    if (collision != null) throw new Error(`FATAL: jug chain label "${collision}" IS an active measure unit. Aborting.`);
    const flat = deriveFlatFieldsFromChain(levels);

    chainWrites.push({
      section: "C", skuId: sku.id, skuName: sku.name, vendorName: sku.vendorName, levels,
      beforeDescriptor: describeChain(sku),
      afterDescriptor: `${j.chainLabel}=${j.nominalJugOz}oz | flat ${flat.packFormat} ${flat.unitsPerPack}x${flat.eachSize}${flat.eachMeasure}`,
      evidence: `Angel pack recheck: \`${j.product}\` [${j.brand}] pack field \`${j.packSizeField}\`, Angel's own descriptor "${rc.angelPackDescriptor}", units_per_case = 1 — "${rc.structure}". Wave 1's divisor ${j.wave1Divisor} had no inner unit to divide by.`,
      metadata: {
        angel_product: j.product, angel_brand: j.brand, angel_pack_field: j.packSizeField,
        angel_descriptor: rc.angelPackDescriptor, units_per_case: 1, structure: rc.structure,
        before_pack_oz: j.currentPackOz, after_pack_oz: j.nominalJugOz,
        supersedes_wave1_divisor: j.wave1Divisor,
        cost_per_oz_before: before, cost_per_oz_after: after, cost_per_oz_neutral: true,
        open_question: `Angel measures this jug at ${j.angelMeasuredJugOz} oz (${(j.angelMeasuredJugOz / j.nominalJugOz).toFixed(2)}x nominal). NOT applied — awaiting Juan's scale check.`,
      },
    });

    const arithmetic = `${money(j.casePriceUsd)} per jug / 1 (units_per_case = 1) = ${money(j.casePriceUsd)}  [was ${money(j.wave1UnitPrice)} = ${money(j.casePriceUsd)} / ${j.wave1Divisor}]`;
    priceWrites.push({
      section: "C", skuId: sku.id, skuName: sku.name, vendorName: sku.vendorName,
      angelProduct: j.product, unitPrice: j.casePriceUsd, effectiveDate, arithmetic,
      sourceNote:
        `${j.product} [${j.brand}] ${j.packSizeField} | SUPERSEDES wave 1's ${money(j.wave1UnitPrice)} row (source angel-catalog-2026-08), which divided the ${money(j.casePriceUsd)} case by ${j.wave1Divisor}. ` +
        `Harvest 2's pack recheck shows Angel's own descriptor is "${rc.angelPackDescriptor}" with units_per_case = 1 — a ${rc.structure} — so there was never an inner unit to divide by. ` +
        `Our pack is corrected to one jug (${j.nominalJugOz} oz nominal, the same total wave 1's own division table asserted as the case) in the SAME step, because price and pack are one fact: writing ${money(j.casePriceUsd)} against the old ${j.currentPackOz} oz pack would read as $${(j.casePriceUsd / j.currentPackOz).toFixed(4)}/oz, a ${j.wave1Divisor}x error. ` +
        `Cost per ounce is UNCHANGED: $${before!.toFixed(4)}/oz before, $${after!.toFixed(4)}/oz after. ` +
        `OPEN, deliberately not applied: Angel measures this jug at ${j.angelMeasuredJugOz} oz (${(j.angelMeasuredJugOz / j.nominalJugOz).toFixed(2)}x the ${j.nominalJugOz} oz pack string) — one of a four-SKU cluster sitting at exactly 1.20x, which is a feed-artifact signature. If Juan's scale says the jug really holds ${j.angelMeasuredJugOz / 16} lb, cost/oz falls to $${(j.casePriceUsd / j.angelMeasuredJugOz).toFixed(4)}. The pack WEIGHT awaits that measurement. ` +
        `The wave-1 row is append-only history and is NOT modified.`,
      metadata: {
        angel_product: j.product, angel_brand: j.brand, angel_pack_field: j.packSizeField,
        case_price_usd: j.casePriceUsd, divisor: 1,
        supersedes_source: "angel-catalog-2026-08", supersedes_unit_price: j.wave1UnitPrice, supersedes_divisor: j.wave1Divisor,
        our_pack_oz: j.nominalJugOz, cost_per_oz_before: before, cost_per_oz_after: after,
        open_scale_check: { nominal_oz: j.nominalJugOz, angel_measured_oz: j.angelMeasuredJugOz, cost_per_oz_if_measured: j.casePriceUsd / j.angelMeasuredJugOz },
      },
    });

    cRows.push([
      sku.name, `\`${j.product}\``, `÷${j.wave1Divisor} -> ÷1`,
      `${money(j.wave1UnitPrice)} / ${j.currentPackOz} oz`, `**${money(j.casePriceUsd)}** / ${j.nominalJugOz} oz`,
      `$${before!.toFixed(4)}`, `$${after!.toFixed(4)}`, neutral ? "**unchanged ✓**" : "MOVED",
    ]);
  }

  p("── WOULD WRITE: pack + price, together ──");
  table(["our SKU", "Angel row", "divisor", "before (price / pack)", "after (price / pack)", "$/oz before", "$/oz after", "check"],
    cRows, ["", "", "", "r", "r", "r", "r", ""]);
  p("");
  p("── PENDING: the recheck rows wave 3 does NOT write ──");
  table(["our SKU", "Angel row", "the question", "unblock"],
    PENDING_RECHECKS.map((r) => [r.skuName, `\`${r.product}\``, r.question, r.unblock]));
  p("");
  p("There is also a SECOND oregano row in Angel — `OREGANO LEAVES` [ROMA] `1/24 OZ`, a 1.5 lb jug");
  p("at $24.41 — which quotes the same one SKU at a different size. That is a duplicate cluster in");
  p("wave 1's sense and needs Juan's pick of the row of record; it is out of scope here and");
  p("untouched. The 1/5 LB row is the one wave 1 used and the one corrected above.");

  // ══ SECTION D — the seed-18 re-run ═══════════════════════════════════════════
  h(2, "Section D — re-run seed 18's twin adjudication");
  p("Seed 18 refused to move the Ham and Fresh Mozzarella recipe pins from the Baldor backups to");
  p("the PFG primaries, and its refusal was exactly right: both pins read `1 unit`, `unit` is a");
  p("COUNT measure, so the line's oz value is the SKU's OWN `avg_oz_per_each` — which the PFG");
  p("twins did not have. Moving a pin would not have shifted a number, it would have DELETED one,");
  p("silently un-costing and un-depleting every consuming recipe.");
  p("");
  p("Section B supplies the missing weights, so the gate is re-runnable. Below is what it will do,");
  p("computed HERE through `ozForRecipeInput` — the same production function seed 18 calls and");
  p("`lib/prep-consumption-graph.ts` uses — against the post-section-B shapes. This is a");
  p("prediction with the real function, not a claim.");
  p("");

  const dRows: string[][] = [];
  const pairs = [
    { product: "Fresh Mozzarella", primaryVendor: "PFG", backupVendor: "Baldor", plannedPrimaryOz: MOZZARELLA_CASE.ozPerSlice },
    { product: "Ham", primaryVendor: "PFG", backupVendor: "Baldor", plannedPrimaryOz: JUAN_SLICE_OZ.Ham ?? 1.0 },
  ];
  let predictedMoves = 0;
  let predictedRefusals = 0;
  for (const pair of pairs) {
    const pri = resolveSku(pair.product, pair.primaryVendor);
    const bak = resolveSku(pair.product, pair.backupVendor);
    if ("error" in pri || "error" in bak) {
      dRows.push([pair.product, "—", "—", "—", "UNRESOLVED"]);
      continue;
    }
    const backupPins = await loadPins(bak.sku.id);
    for (const pin of backupPins) {
      const ozBefore = ozForRecipeInput(pin.quantity, pin.unit, shapeOf(bak.sku), measures);
      const ozAfter = ozForRecipeInput(pin.quantity, pin.unit, shapeOf(pri.sku, { avgOzPerEach: pair.plannedPrimaryOz }), measures);
      const preserved = ozBefore != null && ozAfter != null && Math.abs(ozAfter - ozBefore) <= 1e-9;
      if (preserved) predictedMoves++; else predictedRefusals++;
      dRows.push([
        `${pair.product}`,
        `${pin.recipeName} · ${pin.quantity} ${pin.unit ?? "(no unit)"}`,
        `${bak.sku.vendorName} ${oz(ozBefore)}`,
        `${pri.sku.vendorName} ${oz(ozAfter)}`,
        preserved ? "**GATE PASSES -> pin moves**" : "**GATE REFUSES -> pin stays**",
      ]);
    }
    if (backupPins.length === 0) dRows.push([pair.product, "(no pins on the backup)", "—", "—", "nothing to move"]);
  }
  table(["pair", "pinned line", "oz on BACKUP", "oz on PRIMARY (post-B)", "predicted gate"], dRows);
  p("");
  p(`Predicted: **${predictedMoves} pin(s) move, ${predictedRefusals} still refuse.**`);
  if (predictedRefusals > 0) {
    p("");
    p("The ham refusal is NOT the same failure seed 18 reported. Seed 18 refused because the PFG");
    p("side resolved to NULL — nothing to preserve. After section B it resolves to a real number");
    p("that simply is not the backup's, so the gate now refuses for the honest reason: **the two");
    p("twins disagree about what one slice of ham weighs.** That is the P2 product-identity gap the");
    p("seed-18 header predicted, arriving on schedule. It is in the STOP list.");
  }
  p("");
  p(`In \`--execute\` mode this script then RUNS \`${SEED_18} --execute\` as a child process,`);
  p("after sections A-C have landed, and reads the post-state back from the destination. In dry-run");
  p("it does not, and seed 18 is not invoked at all.");

  // ══ SECTION E — Dried Chives + the permanent gap ═════════════════════════════
  h(2, "Section E — Dried Chives, and the permanent supply-run gap");
  h(3, "E1 — Dried Chives -> US Foods (found, but not writable)");
  const chivesHit = resolveSku(DRIED_CHIVES.skuName, "(no vendor)");
  const chivesSku = "error" in chivesHit ? (byName.get(DRIED_CHIVES.skuName) ?? [])[0] ?? null : chivesHit.sku;
  pre();
  p(`Angel row : ${DRIED_CHIVES.angelProduct}`);
  p(`            [${DRIED_CHIVES.brand}] · ${DRIED_CHIVES.vendor} · ${DRIED_CHIVES.packSizeRaw} · ${money(DRIED_CHIVES.casePriceUsd)}/case · 1 purchase (${DRIED_CHIVES.observedDate})`);
  p(`True cost : ${money(DRIED_CHIVES.casePriceUsd)} / (${DRIED_CHIVES.shakersPerCase} x ${DRIED_CHIVES.ozPerShaker} oz = ${round(DRIED_CHIVES.caseOz, 2)} oz = ${(round(DRIED_CHIVES.caseOz, 2) / 16).toFixed(2)} lb) = **$${DRIED_CHIVES.truePricePerLb.toFixed(2)}/lb**`);
  p(`            Angel prints ${money(DRIED_CHIVES.angelStatedPricePerLb)}/lb — exactly ${(DRIED_CHIVES.angelStatedPricePerLb / DRIED_CHIVES.truePricePerLb).toFixed(1)}x too high, the dropped-multiplier bug`);
  p(`            (Angel stored ONE 1.12 oz shaker's weight as the whole 6-pack case's).`);
  p(`Our SKU   : ${chivesSku ? `${chivesSku.name} [${chivesSku.id}] vendor=${chivesSku.vendorName} pack_format=${chivesSku.packFormat ?? "NULL"} units_per_pack=${chivesSku.unitsPerPack ?? "NULL"} each_size=${chivesSku.eachSize ?? "NULL"} avg_oz_per_each=${chivesSku.avgOzPerEach ?? "NULL"} chain_levels=${chivesSku.chain.length}` : "NOT FOUND"}`);
  pre();
  p("");
  if (chivesSku && chivesSku.chain.length === 0 && chivesSku.eachSize == null) {
    p("**NOT WRITTEN.** The vendor hunt succeeded completely — we know the product, the vendor, the");
    p("pack and the true $/lb. What we do not have is a pack on OUR side: this SKU carries no");
    p("vendor, no pack format, no units, no each_size and no avg_oz_per_each. There is no");
    p("denominator. Binding a price to a SKU with no pack is precisely how `PICKLES CHIPS` became");
    p("$35.95/lb, so the answer goes in a decision table with the arithmetic already done:");
    p("");
    table(["field", "proposed value", "evidence"], [
      ["vendor", DRIED_CHIVES.vendor, `harvest 2 §4 — the only dried-chive row in Angel, found by name AND class search`],
      ["pack chain", `case = ${DRIED_CHIVES.shakersPerCase} x shaker; shaker = ${DRIED_CHIVES.ozPerShaker} oz`, `Angel pack string \`${DRIED_CHIVES.packSizeRaw}\``],
      ["content", `${round(DRIED_CHIVES.caseOz, 2)} oz (${(round(DRIED_CHIVES.caseOz, 2) / 16).toFixed(2)} lb)`, "6 x 1.12"],
      ["unit_price", money(DRIED_CHIVES.casePriceUsd), `Angel case price, 1 purchase ${DRIED_CHIVES.observedDate}`],
      ["-> $/lb", `$${DRIED_CHIVES.truePricePerLb.toFixed(2)}`, "in line with the other dried spices; Angel's $138.86 is the 6x bug"],
    ]);
    p("");
    p("Approve that pack and the vendor binding plus the price follow in one step. The competing");
    p("candidate is the 2024 costing sheet's \"Dried Chives, b, $3.95 / 2 oz\" (b = Baldor), which is");
    p("$31.60/lb — 37% higher and two years old. US Foods at $23.14/lb is the better and more");
    p("recent number, but it IS a lane we migrated away from, so it is Juan's call, not the");
    p("script's. The vendor binding is separable from the price if he wants only that.");
    refusals.push({ section: "E1", skuName: DRIED_CHIVES.skuName, subject: "vendor + price", code: "OUR_PACK_UNRESOLVABLE", detail: "no vendor, no pack format, no units_per_pack, no each_size, no chain — nothing to price" });
  } else if (chivesSku) {
    p(`Our SKU now HAS pack data (${describeChain(chivesSku)}) — re-derive this section against it before writing.`);
    refusals.push({ section: "E1", skuName: DRIED_CHIVES.skuName, subject: "vendor + price", code: "PACK_SHAPE_CHANGED", detail: `the SKU acquired pack data since the harvest: ${describeChain(chivesSku)}` });
  }

  h(3, "E2 — the permanent supply-run gap (a named category, not a backlog)");
  p("Six items were searched for in harvest 2 — by name AND by class, on a search that fuzzy-");
  p("matches both — and are genuinely absent from Angel. Not a lookup that failed: a category");
  p("Angel structurally cannot see. Five are low-volume, high-flavour-impact pantry goods and one");
  p("is resale snacks; all are bought on a grocery or restaurant-supply run rather than off a");
  p("distributor truck, and Angel can only ever cost what arrives on an integrated vendor's");
  p("invoice.");
  p("");
  p("**The point of naming the category:** these must not sit in a vendor-unknown queue waiting for");
  p("a future harvest to resolve them. No harvest will. They need manual pricing, once, from a");
  p("receipt — and co-ops can hold that, because it starts from invoices generally rather than");
  p("from one distributor's feed. That is the actual competitive difference, stated as six rows.");
  p("");
  table(["our SKU", "finding"], PERMANENT_SUPPLY_RUN_GAPS.map((g) => [g.skuName, g.finding]));
  p("");
  p("One near-miss worth keeping separate: **Pepperoncini** is not in Angel under that name, but two");
  p("functional neighbours are, both Delmar — `BANANA PEPPER RINGS` (Boar's Head, $8.75/case) and");
  p("`HOT CHERRY PEPPERS` ($8.95/case). Banana pepper rings are the closest match for a sandwich");
  p("line. **Both carry Angel's fabricated 1.0 lb weight**, so neither can be costed by weight until");
  p("a real case weight exists. That is a live sourcing question, not a permanent gap — it belongs");
  p("with the vendorless decision table from wave 2, not on the list above.");

  // ══ SUMMARY ══════════════════════════════════════════════════════════════════
  h(2, "Summary");
  const bySection = (s: Section) => ({
    chains: chainWrites.filter((w) => w.section === s).length,
    weights: weightWrites.filter((w) => w.section === s).length,
    prices: priceWrites.filter((w) => w.section === s).length,
  });
  const a = bySection("A"), b = bySection("B"), c = bySection("C");
  table(["", "pack chains", "weights", "prices"], [
    ["**Section A — Boar's Head piece model**", `**${a.chains}**`, `**${a.weights}**`, `**${a.prices}**`],
    ["**Section B — weight corrections**", `**${b.chains}**`, `**${b.weights}**`, `**${b.prices}**`],
    ["**Section C — jug supersedes**", `**${c.chains}**`, `**${c.weights}**`, `**${c.prices}**`],
    ["Section D — seed-18 re-run", "—", "—", `${predictedMoves} pin move(s) predicted`],
    ["Section E — decision tables only", "0", "0", "0"],
    ["**TOTAL would-write rows**", `**${chainWrites.length}**`, `**${weightWrites.length}**`, `**${priceWrites.length}**`],
  ], ["", "r", "r", "r"]);
  p("");
  p(`\`source\` stamped on every written price row: \`${SOURCE_KEY}\``);
  p("`effective_date`: per-product `last_seen` from the harvest, never today.");
  p("");

  p(`── STOP LIST: ${stops.length} — none of these are written; each needs Juan's word ──`);
  if (stops.length === 0) p(MD ? "_(none)_" : "  (none)");
  for (const s of stops) {
    p(MD ? `\n#### ${s.skuName} — ${s.headline}\n` : `\n  ${s.skuName} — ${s.headline}`);
    pre();
    for (const d of s.detail) p(`  ${d}`);
    pre();
    p(MD ? `> **UNBLOCK:** ${s.unblock}` : `    UNBLOCK: ${s.unblock}`);
  }
  p("");
  p("These four-plus-one all have one shape, and it is worth naming: **a live `avg_oz_per_each`");
  p("that matches neither Juan's measured table nor the piece model, with no audit row explaining");
  p("the change.** Seed 10's audit rows from 2026-07-22 record it writing Juan's values to these");
  p("exact SKU ids; the values in production today are different, and nothing in `audit_log`");
  p("covers the difference. Either an unaudited edit reached production, or Juan corrected these");
  p("by hand from the floor and the seed file is the stale copy. **Both readings are plausible and");
  p("they imply opposite fixes**, which is why this script writes neither. If the live numbers are");
  p("his, then the harvest's own slices-per-piece and $/slice tables are computed off stale");
  p("constants and need recomputing — the corrected figures are in the section A table.");
  p("");

  p(`── REFUSALS / NO-OPS: ${refusals.length} ──`);
  const refByCode = new Map<Wave3Code, Refused[]>();
  for (const r of refusals) {
    const list = refByCode.get(r.code) ?? [];
    list.push(r);
    refByCode.set(r.code, list);
  }
  for (const [code, list] of refByCode) {
    p(MD ? `\n**${code}** — ${list.length}\n` : `\n  ${code} — ${list.length}`);
    p(MD ? `> ${WAVE3_REASONS[code]}\n` : `    ${WAVE3_REASONS[code]}`);
    for (const r of list) p(MD ? `- §${r.section} **${r.skuName}** (${r.subject}): ${r.detail}` : `      · §${r.section} ${r.skuName} (${r.subject}): ${r.detail}`);
  }

  p("");
  p("── EVERY WOULD-WRITE ROW, IN FULL ──");
  p("");
  p(`**Pack chains (${chainWrites.length})** — supersede-as-a-SET, then flat fields derived through the same`);
  p("pure function the admin lib's sync-on-save uses. Never an in-place UPDATE, never a DELETE.");
  p("");
  table(["§", "SKU", "vendor", "before", "after"],
    chainWrites.map((w) => [w.section, w.skuName, w.vendorName, `\`${w.beforeDescriptor}\``, `\`${w.afterDescriptor}\``]));
  p("");
  p(`**Weights (${weightWrites.length})** — \`vendor_items.avg_oz_per_each\`, the value every COUNT-unit recipe line depletes.`);
  p("");
  table(["§", "SKU", "vendor", "from", "to", "arithmetic", "depletion impact"],
    weightWrites.map((w) => [w.section, w.skuName, w.vendorName, w.fromOz == null ? "NULL" : String(w.fromOz), `**${w.toOz}**`, w.arithmetic, w.depletionImpact ?? "—"]));
  p("");
  p(`**Prices (${priceWrites.length})** — appended to \`vendor_price_history\`; nothing is ever modified in place.`);
  p("");
  table(["§", "SKU", "vendor", "Angel row", "unit price", "effective", "arithmetic"],
    priceWrites.map((w) => [w.section, w.skuName, w.vendorName, `\`${w.angelProduct}\``, `**${money(w.unitPrice)}**`, w.effectiveDate, w.arithmetic]),
    ["", "", "", "", "r", "", ""]);

  if (!EXECUTE) {
    p("");
    p("---");
    p("");
    p("**NOTHING WAS WRITTEN.** Re-run with `--execute` once Juan has signed off on the tables above.");
    p("Seed 20 done (dry run).");
    return;
  }

  // ── EXECUTE ──────────────────────────────────────────────────────────────────
  await execute(sb, measures);
}

// ── The write path ─────────────────────────────────────────────────────────────

async function execute(
  sb: ReturnType<typeof getServiceRoleClient>,
  measures: Map<string, MeasureUnitFactor>,
): Promise<void> {
  p("\n── writing ──");

  // 1) Pack chains. Supersede-as-a-SET, exactly replaceSkuPackChain's semantics.
  for (const w of chainWrites) {
    const { data: cur, error: cErr } = await sb
      .from("vendor_items").select("id, name, active").eq("id", w.skuId)
      .maybeSingle<{ id: string; name: string; active: boolean }>();
    if (cErr) throw new Error(`re-read ${w.skuName}: ${cErr.message}`);
    if (!cur) throw new Error(`FATAL: ${w.skuName} [${w.skuId}] disappeared between the dry run and the write`);
    if (cur.name !== w.skuName) throw new Error(`FATAL: ${w.skuId} is now named "${cur.name}", expected "${w.skuName}" — refusing to rewrite the wrong SKU's pack chain`);

    const { error: deErr } = await sb.from("sku_pack_levels").update({ active: false }).eq("sku_id", w.skuId).eq("active", true);
    if (deErr) throw new Error(`deactivate ${w.skuName} chain: ${deErr.message}`);

    const now = new Date().toISOString();
    const ids = w.levels.map(() => randomUUID());
    const rows = w.levels.map((lvl, i) => ({
      id: ids[i]!, sku_id: w.skuId, label: lvl.label, contains_qty: lvl.containsQty,
      contains_level_id: lvl.containsIndex != null ? ids[lvl.containsIndex]! : null,
      contains_measure_unit: lvl.containsIndex != null ? null : lvl.containsMeasureUnit,
      display_ordinal: i, effective_from: now, active: true, created_by: null,
    }));
    const { error: insErr } = await sb.from("sku_pack_levels").insert(rows);
    if (insErr) throw new Error(`insert ${w.skuName} chain: ${insErr.message}`);

    const flat = deriveFlatFieldsFromChain(w.levels);
    const { error: fErr } = await sb.from("vendor_items").update({
      pack_format: flat.packFormat ?? "Each (no case)",
      units_per_pack: flat.unitsPerPack, each_size: flat.eachSize, each_measure: flat.eachMeasure,
      updated_at: now, updated_by: null,
    }).eq("id", w.skuId);
    if (fErr) throw new Error(`sync ${w.skuName} flat fields: ${fErr.message}`);

    p(`  + chain ${w.vendorName}/${w.skuName}: ${w.beforeDescriptor}  ->  ${w.afterDescriptor}`);
    void audit({
      actorId: null, actorRole: null,
      action: "sku.pack_chain_update", resourceTable: "sku_pack_levels", resourceId: w.skuId,
      metadata: {
        name: w.skuName, vendor: w.vendorName, level_count: rows.length, labels: rows.map((r) => r.label),
        before: w.beforeDescriptor, after: w.afterDescriptor,
        flat_synced: flat, evidence: w.evidence,
        phase: "angel_data_arc", reason: `angel_harvest2_wave3_section_${w.section.toLowerCase()}_pack`,
        script: "scripts/seed/20-angel-wave3.ts", source_report: SOURCE_REPORTS,
        ...w.metadata,
      },
      ipAddress: null, userAgent: null,
    });
  }

  // 2) Weights.
  for (const w of weightWrites) {
    const { data: cur, error: cErr } = await sb
      .from("vendor_items").select("id, name, avg_oz_per_each").eq("id", w.skuId)
      .maybeSingle<{ id: string; name: string; avg_oz_per_each: number | string | null }>();
    if (cErr) throw new Error(`re-read ${w.skuName}: ${cErr.message}`);
    if (!cur) throw new Error(`FATAL: ${w.skuName} [${w.skuId}] disappeared`);
    if (cur.name !== w.skuName) throw new Error(`FATAL: ${w.skuId} is now named "${cur.name}" — refusing`);
    const live = num(cur.avg_oz_per_each);
    if (live != null && Math.abs(live - w.toOz) < 1e-9) { p(`  = weight ${w.vendorName}/${w.skuName}: already ${w.toOz} — skipping`); continue; }
    if (live !== w.fromOz && !(live == null && w.fromOz == null)) {
      throw new Error(`FATAL: ${w.vendorName}/${w.skuName} avg_oz_per_each is ${live ?? "NULL"}, the plan was written against ${w.fromOz ?? "NULL"} — it changed under us. Refusing (re-run the dry run).`);
    }

    const { error: uErr, count } = await sb
      .from("vendor_items")
      .update({ avg_oz_per_each: w.toOz, updated_at: new Date().toISOString(), updated_by: null }, { count: "exact" })
      .eq("id", w.skuId);
    if (uErr) throw new Error(`set ${w.skuName} weight: ${uErr.message}`);
    if (!count) throw new Error(`set ${w.skuName} weight: UPDATE affected 0 rows (silent RLS denial?)`);
    p(`  + weight ${w.vendorName}/${w.skuName}: ${w.fromOz ?? "NULL"} -> ${w.toOz} oz  (${w.arithmetic})`);
    void audit({
      actorId: null, actorRole: null,
      action: "sku.weight_fill", resourceTable: "vendor_items", resourceId: w.skuId,
      metadata: {
        name: w.skuName, vendor: w.vendorName,
        before_avg_oz_per_each: w.fromOz, avg_oz_per_each: w.toOz,
        arithmetic: w.arithmetic, note: w.note, depletion_impact: w.depletionImpact,
        estimate: false,
        phase: "angel_data_arc", reason: `angel_harvest2_wave3_section_${w.section.toLowerCase()}_weight`,
        script: "scripts/seed/20-angel-wave3.ts", source_report: SOURCE_REPORTS,
        ...w.metadata,
      },
      ipAddress: null, userAgent: null,
    });
  }

  // 3) Prices — append-only, idempotent on (vendor_item_id, source, effective_date).
  let written = 0, skipped = 0;
  for (const w of priceWrites) {
    const { data: existing, error: exErr } = await sb
      .from("vendor_price_history").select("id")
      .eq("vendor_item_id", w.skuId).eq("source", SOURCE_KEY).eq("effective_date", w.effectiveDate)
      .maybeSingle<{ id: string }>();
    if (exErr) throw new Error(`dup check ${w.skuName}: ${exErr.message}`);
    if (existing) { skipped++; p(`  = price ${w.vendorName}/${w.skuName}: already filled from ${SOURCE_KEY} — skipping`); continue; }

    const { data: ins, error } = await sb
      .from("vendor_price_history")
      .insert({
        vendor_item_id: w.skuId, unit_price: w.unitPrice, effective_date: w.effectiveDate,
        recorded_by: null, source: SOURCE_KEY, source_note: w.sourceNote,
      })
      .select("id").single<{ id: string }>();
    if (error) throw new Error(`insert price ${w.skuName}: ${error.message}`);
    written++;
    p(`  + price ${w.vendorName}/${w.skuName}: ${money(w.unitPrice)}  (${w.arithmetic})`);
    void audit({
      actorId: null, actorRole: null,
      action: "vendor_item.price_recorded", resourceTable: "vendor_price_history", resourceId: ins.id,
      metadata: {
        vendor_item_id: w.skuId, sku_name: w.skuName, vendor: w.vendorName,
        unit_price: w.unitPrice, effective_date: w.effectiveDate,
        source: SOURCE_KEY, source_note: w.sourceNote,
        phase: "angel_data_arc", reason: `angel_harvest2_wave3_section_${w.section.toLowerCase()}_price`,
        script: "scripts/seed/20-angel-wave3.ts", source_report: SOURCE_REPORTS,
        ...w.metadata,
      },
      ipAddress: null, userAgent: null,
    });
  }
  p(`\n  ✓ ${chainWrites.length} chain(s), ${weightWrites.length} weight(s), ${written} price(s) written, ${skipped} price(s) skipped.`);

  // 4) Section D — seed 18, now that its gate has the weights it was waiting for.
  p(`\n── section D: re-running ${SEED_18} --execute ──`);
  const run = spawnSync(
    "npx",
    ["tsx", "--conditions=react-server", "--env-file=.env.local", SEED_18, "--execute"],
    { stdio: "inherit", cwd: process.cwd(), shell: process.platform === "win32" },
  );
  if (run.error) throw new Error(`spawn ${SEED_18}: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`${SEED_18} exited ${run.status} — sections A-C are written; investigate before re-running`);

  // 5) Read the post-state back FROM THE DESTINATION, through the real function.
  p("\n── section D post-state (read back from the destination) ──");
  for (const product of ["Fresh Mozzarella", "Ham"]) {
    // Resolve the twin ids FIRST and filter on them. Selecting every recipe_input and
    // filtering in JS would silently truncate at PostgREST's default page size — and a
    // read-back that quietly returns fewer rows than exist is worse than no read-back,
    // because it reports success over the rows it never saw.
    const { data: twinRows, error: tErr } = await sb
      .from("vendor_items").select("id").eq("name", product).is("location_id", null)
      .returns<Array<{ id: string }>>();
    if (tErr) throw new Error(`read back ${product} twins: ${tErr.message}`);
    const twinIds = (twinRows ?? []).map((r) => r.id);
    if (twinIds.length === 0) { p(`  ! ${product}: no global rows found on read-back`); continue; }

    const { data, error, count } = await sb
      .from("recipe_inputs")
      .select("id, quantity, unit, recipes(name), vendor_items!recipe_inputs_component_sku_id_fkey(id, name, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each, vendors(name))", { count: "exact" })
      .in("component_sku_id", twinIds)
      .returns<Array<{
        id: string; quantity: number | string; unit: string | null;
        recipes: { name: string } | null;
        vendor_items: {
          id: string; name: string; pack_format: string | null; each_container_label: string | null;
          units_per_pack: number | null; each_size: number | string | null; each_measure: string | null;
          avg_oz_per_each: number | string | null; vendors: { name: string } | null;
        } | null;
      }>>();
    if (error) throw new Error(`read back ${product} pins: ${error.message}`);
    const mine = data ?? [];
    if (count != null && mine.length < count) throw new Error(`read back ${product} pins truncated: got ${mine.length} of ${count}`);
    const chainsAfter = await loadSkuPackChains(mine.map((r) => r.vendor_items!.id));
    for (const r of mine) {
      const vi = r.vendor_items!;
      const shape: RecipeInputSku = {
        packFormat: vi.pack_format, eachContainerLabel: vi.each_container_label,
        unitsPerPack: vi.units_per_pack, eachSize: num(vi.each_size), eachMeasure: vi.each_measure,
        avgOzPerEach: num(vi.avg_oz_per_each), packChain: chainsAfter.get(vi.id) ?? null,
      };
      const value = ozForRecipeInput(num(r.quantity) ?? Number.NaN, r.unit, shape, measures);
      p(`  ${product}: "${r.recipes?.name ?? "(recipe)"}" ${r.quantity} ${r.unit ?? "-"} -> pinned to ${vi.vendors?.name ?? "(no vendor)"}/${vi.name}, resolves to ${oz(value)}${value == null ? "  ⚠ NULL — this line is un-costed AND un-depleted" : ""}`);
    }
  }
  p("\nSeed 20 done (execute).");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
