/**
 * Seed 21 — Angel harvest WAVE 4: the REFUSAL-RESOLUTION wave.
 *
 * Waves 1, 2 and 3 each ended with a ledger of things they would not write, and
 * each entry named the single fact that would unblock it. Juan supplied those facts
 * on 2026-08-20. This wave spends them.
 *
 * That makes it a different SHAPE of wave from its predecessors. There is no new
 * harvest behind it and almost no new discovery in it; its job is to convert
 * standing questions into writes, and — the half that is easy to skip — to keep
 * refusing the ones his rulings did not actually reach. Two of the five SKUs the
 * herb policy names turn out to be outside it on inspection, and finding that out
 * is worth more than the two rows it costs.
 *
 * ── DRY RUN IS THE DEFAULT, AND THE GATE IS A HUMAN ───────────────────────────
 * Running with no arguments WRITES NOTHING. It prints every would-write row with
 * its arithmetic, every refusal with its reason, and the decision tables, then
 * exits. Writing requires an explicit `--execute`, and per the arc's terms that
 * flag is not used until Juan has eyeballed this output. Waves 1-3 held the same
 * line and it is the reason this data is trustworthy.
 *
 * ── THE FOUR SECTIONS ─────────────────────────────────────────────────────────
 *  A. The four vendor bindings Juan approved (Beef Base -> PFG, Mortadella ->
 *     Boar's Head, Utz Ripples -> Country Snacks, Dried Chives -> US Foods), plus
 *     the ONE price among them that a verified pack can carry.
 *  B. The lettuce pair: both-active, Sysco primary (INFERRED — flagged), Baldor
 *     backup. Includes the attribution finding, which is that Angel's iceberg
 *     spend belongs to NEITHER twin.
 *  C. Juan's fresh-herb / variable-catch weight policy, applied: pack weight = the
 *     average of the derived invoice weights, stamped `weight_class:
 *     INVOICE_DERIVED`, plus the prices that become defensible once the pack is
 *     right.
 *  D. Report-only: the still-stuck ledger, including the 8 unadjudicated
 *     multi-vendor pairs — enumerated here for the first time.
 *
 * ── WHY §C WRITES A PACK AND A PRICE TOGETHER (OR NEITHER) ────────────────────
 * Wave 3's section C established the rule and wave 4 inherits it unchanged:
 * `unit_price` is the price of ONE OF OUR PACKS, so a pack correction and a price
 * correction are one fact seen twice. Here the direction is the reverse of wave
 * 3's — the pack gets BIGGER (a 16 oz nominal box really holds 23.2 oz), so
 * cost-per-ounce FALLS. Writing the pack without the price would leave a real
 * price against a stale denominator; writing neither leaves a 45% cost overstatement
 * standing. Both, or nothing.
 *
 * ── EVERY ROW IS RESOLVED AND RE-VERIFIED LIVE ────────────────────────────────
 * SKU and vendor ids are never hardcoded: each rule names a SKU and an expected
 * VENDOR, both asserted against live `vendor_items` / `vendors` before anything is
 * planned, and re-read immediately before each write. `sku_pack_levels` is the
 * source of truth for what a pack IS; the flat columns are a machine-derived
 * MIRROR. So chains are written the way seeds 16 and 20 write them —
 * supersede-as-a-SET, then flat fields through the same pure
 * `deriveFlatFieldsFromChain` the admin lib's sync uses — never hand-authored,
 * never an in-place row UPDATE, never a DELETE.
 *
 * Idempotent: every step asserts the live end-state first and writes only the
 * delta. A second `--execute` reports "already" on everything and writes nothing.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/21-angel-wave4.ts
 *        -> DRY RUN (default). Prints everything, writes nothing.
 *      ... 21-angel-wave4.ts --markdown   -> dry-run as markdown (authors the report doc)
 *      ... 21-angel-wave4.ts --execute    -> WRITES. Requires Juan's eyeball first.
 *
 * NOTE on --conditions=react-server: lib/supabase-server.ts carries `import
 * "server-only"`; under plain tsx that resolves to its throwing entry point and the
 * seed dies on import. The react-server condition resolves it to the empty stub.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import { ozForRecipeInput, type RecipeInputSku } from "@/lib/recipe-math";
import { firstLabelMeasureCollision, type PackChainLevel } from "@/lib/pack-chain-shared";
import { deriveFlatFieldsFromChain } from "@/lib/admin/catalog-shared";
import { parseAngelRollup, parseAngelDate, classifyWeightSource } from "@/lib/angel-wave2";
import { costPerOz } from "@/lib/angel-wave3";
import {
  parsePurchaseHistory, purchaseRowKey, invoiceAverageLbs, classifyPackPremise, lbsToPackOz,
  VENDOR_BINDINGS, DRIED_CHIVES_PACK, BEEF_BASE_CANDIDATES,
  LETTUCE_PAIR, PFG_LETTUCE_CANDIDATES,
  VARIABLE_CATCH_RULES, BASIL_DUPLICATE_CLUSTER,
  HERB_WEIGHT_POLICY, AVERAGE_DEFINITION, WEIGHT_CLASS_MEANING, CONSTANT_WEIGHT_SPREAD_CEILING,
  STILL_STUCK, WAVE4_REASONS,
  type Wave4Code, type WeightClass, type InvoiceAverage,
} from "@/lib/angel-wave4";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

/** Provenance key. Dated + named for WAVE 4, so its rows can never be confused with
 *  wave 3's `angel-harvest2-2026-08-20`, wave 2's `angel-harvest-2026-08-20` or
 *  wave 1's `angel-catalog-2026-08`. */
const SOURCE_KEY = "angel-wave4-2026-08-20";

const HISTORY_CSV = "docs/angel-purchase-history.csv";
const ROLLUP_CSV = "docs/angel-products-rollup.csv";
const RECHECK_CSV = "docs/angel-pack-recheck.csv";
const SOURCE_REPORTS = "docs/ANGEL-HARVEST-2-PIECES.md + docs/seed/source/angel-wave4-dryrun.md";
const SCRIPT = "scripts/seed/21-angel-wave4.ts";

const EXECUTE = process.argv.includes("--execute");
const MD = process.argv.includes("--markdown");

const money = (n: number) => `$${n.toFixed(2)}`;
/** Per-OUNCE money. Cents are far too coarse: parsley is $0.68/oz and the whole
 *  point of section C is a change in the fourth decimal place of that number. */
const money4 = (n: number) => `$${n.toFixed(4)}`;
const pct = (f: number) => `${f >= 0 ? "+" : ""}${(f * 100).toFixed(1)}%`;
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
    // pack descriptors legitimately contain one. Escaping here rather than at every
    // call site is the fix that cannot be forgotten.
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
  weekdayPar: number | null;
  weekendPar: number | null;
  chain: PackChainLevel[];
}

interface PinRow {
  id: string;
  recipeName: string;
  quantity: number;
  unit: string | null;
}

/** A chain level in the index-linked shape `deriveFlatFieldsFromChain` consumes and
 *  the write path resolves into `contains_level_id` pointers. */
interface StarterLevel {
  label: string;
  containsQty: number;
  containsIndex: number | null;
  containsMeasureUnit: string | null;
}

function oneLevelChain(label: string, qtyOz: number): StarterLevel[] {
  return [{ label, containsQty: qtyOz, containsIndex: null, containsMeasureUnit: "oz" }];
}

function twoLevelChain(outer: string, outerQty: number, inner: string, innerOz: number): StarterLevel[] {
  return [
    { label: outer, containsQty: outerQty, containsIndex: 1, containsMeasureUnit: null },
    { label: inner, containsQty: innerOz, containsIndex: null, containsMeasureUnit: "oz" },
  ];
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

// ── Planned work ───────────────────────────────────────────────────────────────

type Section = "A" | "B" | "C";

interface BindWrite {
  section: Section;
  skuId: string;
  skuName: string;
  vendorId: string;
  vendorName: string;
  evidence: string;
  ruling: string;
  metadata: Record<string, unknown>;
}

interface ActivateWrite {
  section: Section;
  skuId: string;
  skuName: string;
  vendorName: string;
  role: "primary" | "backup";
  evidence: string;
  metadata: Record<string, unknown>;
}

interface ChainWrite {
  section: Section;
  skuId: string;
  skuName: string;
  vendorName: string;
  levels: StarterLevel[];
  /** Preserved when the live row already carries one — see the note at its use. */
  preservePackFormat: string | null;
  beforeDescriptor: string;
  afterDescriptor: string;
  weightClass: WeightClass;
  sourceNote: string;
  evidence: string;
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
  code: Wave4Code;
  detail: string;
}

const bindWrites: BindWrite[] = [];
const activateWrites: ActivateWrite[] = [];
const chainWrites: ChainWrite[] = [];
const priceWrites: PriceWrite[] = [];
const refusals: Refused[] = [];

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  if (!MD) {
    p(EXECUTE
      ? "══ EXECUTE MODE — this run WRITES to vendor_items / sku_pack_levels / vendor_price_history ══"
      : "══ DRY RUN (default) — no writes. Pass --execute after Juan's eyeball. ══");
  }

  // ── Sources ────────────────────────────────────────────────────────────────
  const history = parsePurchaseHistory(readFileSync(resolve(process.cwd(), HISTORY_CSV), "utf8"));
  if (history.length === 0) throw new Error(`FATAL: ${HISTORY_CSV} parsed empty — every average below would be a guess.`);
  const historyByKey = new Map<string, typeof history>();
  for (const r of history) {
    const k = purchaseRowKey(r);
    const list = historyByKey.get(k) ?? [];
    list.push(r);
    historyByKey.set(k, list);
  }
  const rollup = parseAngelRollup(readFileSync(resolve(process.cwd(), ROLLUP_CSV), "utf8"));
  const rollupByKey = new Map<string, (typeof rollup)[number]>();
  for (const r of rollup) {
    const k = purchaseRowKey({ product: r.product, brand: r.brand, vendor: r.vendor, packSize: r.packSize });
    if (!rollupByKey.has(k)) rollupByKey.set(k, r);
  }

  // ── Live universe ──────────────────────────────────────────────────────────
  const measures = await loadMeasures();
  if (measures.size === 0) throw new Error("FATAL: measure_units loaded empty — every oz derivation below would be a guess.");
  const measureLabels = new Set(measures.keys());

  const { data: vendorRows, error: vErr } = await sb
    .from("vendors").select("id, name, active")
    .returns<Array<{ id: string; name: string; active: boolean }>>();
  if (vErr) throw new Error(`load vendors: ${vErr.message}`);
  const vendorByName = new Map((vendorRows ?? []).map((v) => [v.name, v]));

  const { data: skuRows, error: sErr, count: skuCount } = await sb
    .from("vendor_items")
    .select("id, name, vendor_id, active, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each, weekday_par, weekend_par, vendors(name)", { count: "exact" })
    .is("location_id", null)
    .returns<Array<{
      id: string; name: string; vendor_id: string | null; active: boolean;
      pack_format: string | null; each_container_label: string | null; units_per_pack: number | null;
      each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null;
      weekday_par: number | string | null; weekend_par: number | string | null;
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
    avgOzPerEach: num(r.avg_oz_per_each), weekdayPar: num(r.weekday_par), weekendPar: num(r.weekend_par),
    chain: chains.get(r.id) ?? [],
  }));
  const byName = new Map<string, LiveSku[]>();
  for (const s of skus) {
    const list = byName.get(s.name) ?? [];
    list.push(s);
    byName.set(s.name, list);
  }

  /**
   * Resolve a (name, vendor) pair to exactly one live GLOBAL row.
   *
   * `activeOnly` is false for section B, which deliberately targets an INACTIVE
   * row — resolving only active rows there would report the backup as missing and
   * the section would silently do nothing.
   */
  function resolveSku(name: string, expectVendor: string, activeOnly = true): { sku: LiveSku } | { code: Wave4Code; error: string } {
    const all = (byName.get(name) ?? []).filter((s) => (activeOnly ? s.active : true));
    if (all.length === 0) return { code: "SKU_UNRESOLVED", error: `no ${activeOnly ? "ACTIVE " : ""}global SKU named "${name}"` };
    const hits = all.filter((s) => s.vendorName === expectVendor);
    if (hits.length === 1) return { sku: hits[0]! };
    if (hits.length === 0) {
      return { code: "VENDOR_DRIFT", error: `"${name}" exists (${all.length} row(s)) but none under vendor "${expectVendor}" — found: ${all.map((s) => s.vendorName).join(", ")}` };
    }
    return { code: "SKU_UNRESOLVED", error: `${hits.length} global SKUs named "${name}" under "${expectVendor}" — refusing to guess` };
  }

  async function loadPins(skuId: string): Promise<PinRow[]> {
    const { data, error } = await sb
      .from("recipe_inputs").select("id, quantity, unit, recipes(name)")
      .eq("component_sku_id", skuId)
      .returns<Array<{ id: string; quantity: number | string; unit: string | null; recipes: { name: string } | null }>>();
    if (error) throw new Error(`load pins for ${skuId}: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id, recipeName: r.recipes?.name ?? "(recipe)",
      quantity: num(r.quantity) ?? Number.NaN, unit: r.unit,
    }));
  }

  const describeChain = (s: LiveSku) =>
    s.chain.length === 0
      ? `(no chain) flat ${s.packFormat ?? "-"} ${s.unitsPerPack ?? "-"}x${s.eachSize ?? "-"}${s.eachMeasure ?? ""}`
      : s.chain.map((l) => `${l.label}=${l.containsQty}${l.containsMeasureUnit ?? "→level"}`).join(" / ");

  const describeLevels = (levels: StarterLevel[]) =>
    levels.map((l) => `${l.label}=${l.containsQty}${l.containsMeasureUnit ?? `→${levels[l.containsIndex!]?.label ?? "?"}`}`).join(" / ");

  // ══ HEADER ═══════════════════════════════════════════════════════════════════
  if (MD) {
    p("# Angel fill — WAVE 4 DRY RUN (the refusal resolutions)\n");
    p("**Status: NOTHING HAS BEEN WRITTEN.** This is the output of");
    p("`scripts/seed/21-angel-wave4.ts` in its default (dry-run) mode. The script writes only");
    p("under an explicit `--execute` flag, and that flag is not used until Juan has eyeballed");
    p("the tables below.");
    p("");
    p(`**Generated:** 2026-08-20, against \`${HISTORY_CSV}\`, \`${ROLLUP_CSV}\` and \`${RECHECK_CSV}\``);
    p("and live prod (`bgcvurheqzylyfehqgzh`). Every SKU id, vendor, pack chain, par and existing");
    p("price below was resolved live at run time.");
    p("");
    p("---");
    p("");
    p("## Read this first — the five things that matter\n");
    p("1. **Nothing in this wave changes what anything DEPLETES.** Every write here moves a");
    p("   pack CONTENT or a vendor attribution; not one touches `avg_oz_per_each`, which is the");
    p("   column a count-unit recipe line consumes. Wave 3 moved bacon by 64% and that was worth");
    p("   a callout — this wave's equivalent callout is that there is nothing to call out.");
    p("   Costing moves; depletion does not.");
    p("2. **Two of the five SKUs the herb policy names fall outside it on inspection.** Garlic");
    p("   is caught between Juan's own two rulings, and fresh chives breaks the policy's hidden");
    p("   premise (that one of our packs is one Angel unit). Both are reported with the");
    p("   arithmetic finished so approving either is one line. Finding this was worth more than");
    p("   the two rows it costs.");
    p("3. **Angel's lettuce belongs to neither twin.** Our registry says Sysco or Baldor; every");
    p("   head of iceberg in the window came from PFG or US Foods, for $3,230.74. The pair can");
    p("   be shaped correctly (section B) and cannot be priced at all. Section B names the four");
    p("   candidate rows; it creates no SKU.");
    p("4. **The 8 unadjudicated multi-vendor pairs are enumerated here for the first time.** The");
    p("   audit that found them recorded only the count; the list itself lived in a subagent");
    p("   transcript nobody filed. All 8 share one shape, so they are probably one decision");
    p("   rather than eight.");
    p("5. **`INVOICE_DERIVED` is a new weight class, not a relabelling.** Wave 3 split SPEC from");
    p("   OPERATIONAL. Fresh herbs are neither: nobody here weighs them and the label is");
    p("   fiction, so the honest number is what the grower actually delivered, averaged. The");
    p("   class rides into every audit row so the queued weight audit can tell the three apart.");
  }

  // ══ SECTION A — the four vendor bindings ═════════════════════════════════════
  h(2, "Section A — the four vendor bindings");
  p("All four SKUs below sat in wave 2's `vendor unknown` decision table. Juan ruled on");
  p("2026-08-20 and this section spends those rulings. Three confirm wave 2's guess; one");
  p("(Dried Chives) overrides a LOW-confidence guess with a found invoice, which is the");
  p("system working as designed.");
  p("");
  p("**A binding is not a price.** Two of these four SKUs have no pack of any kind and two");
  p("have no Angel row at all, so three of the four bind and stop. That is the intended");
  p("outcome, not a shortfall — binding an unpriceable SKU still makes it orderable, which is");
  p("what a vendor is FOR.");
  p("");

  const bindRows: string[][] = [];
  for (const b of VENDOR_BINDINGS) {
    const vendor = vendorByName.get(b.vendorName);
    if (!vendor) {
      refusals.push({ section: "A", skuName: b.skuName, subject: "vendor binding", code: "VENDOR_UNREGISTERED", detail: `vendor "${b.vendorName}" is not in the vendors registry — registration is the seed-15 (Delmar) path` });
      bindRows.push([b.skuName, b.vendorName, "**VENDOR NOT REGISTERED**", "—", "—"]);
      continue;
    }
    if (!vendor.active) {
      refusals.push({ section: "A", skuName: b.skuName, subject: "vendor binding", code: "VENDOR_UNREGISTERED", detail: `vendor "${b.vendorName}" exists but is INACTIVE — reactivating a vendor is a directory decision, not a side-effect of a binding` });
      bindRows.push([b.skuName, b.vendorName, "**VENDOR INACTIVE**", "—", "—"]);
      continue;
    }

    // The SKU is expected to be vendorLESS today — that is the whole premise. Resolve
    // by name only, then assert the vendor slot is empty rather than assuming it.
    const candidates = (byName.get(b.skuName) ?? []).filter((s) => s.active);
    if (candidates.length !== 1) {
      refusals.push({ section: "A", skuName: b.skuName, subject: "vendor binding", code: "SKU_UNRESOLVED", detail: `${candidates.length} ACTIVE global SKUs named "${b.skuName}" — refusing to guess` });
      bindRows.push([b.skuName, b.vendorName, `**${candidates.length} SKUs match**`, "—", "—"]);
      continue;
    }
    const sku = candidates[0]!;
    if (sku.vendorId === vendor.id) {
      refusals.push({ section: "A", skuName: b.skuName, subject: "vendor binding", code: "ALREADY_CORRECT", detail: `already bound to ${b.vendorName}` });
      bindRows.push([b.skuName, b.vendorName, "already bound", b.priceIntent === "PRICE_FROM_ANGEL" ? "see below" : "bind only", b.angelProduct ?? "_(no Angel row)_"]);
      continue;
    }
    if (sku.vendorId != null) {
      refusals.push({ section: "A", skuName: b.skuName, subject: "vendor binding", code: "VENDOR_DRIFT", detail: `already bound to "${sku.vendorName}" — this ruling would OVERWRITE an existing attribution, which is a different decision from filling an empty one` });
      bindRows.push([b.skuName, b.vendorName, `**already ${sku.vendorName}**`, "—", "—"]);
      continue;
    }

    bindWrites.push({
      section: "A", skuId: sku.id, skuName: sku.name, vendorId: vendor.id, vendorName: b.vendorName,
      evidence: b.evidence, ruling: b.ruling,
      metadata: {
        op: "vendor_bind",
        before_vendor_id: null, after_vendor_id: vendor.id, vendor_name: b.vendorName,
        angel_product: b.angelProduct, ruling: b.ruling, evidence: b.evidence,
        price_intent: b.priceIntent, why_bind_only: b.whyBindOnly,
      },
    });
    bindRows.push([
      sku.name, b.vendorName, "**BIND** (vendor was NULL)",
      b.priceIntent === "PRICE_FROM_ANGEL" ? "price follows (§A1)" : "bind only",
      b.angelProduct ? `\`${b.angelProduct}\`` : "_(no Angel row)_",
    ]);

    if (b.priceIntent === "BIND_ONLY" && b.whyBindOnly) {
      refusals.push({
        section: "A", skuName: b.skuName, subject: "price",
        code: b.angelProduct == null ? "NO_ANGEL_ROW" : "OUR_PACK_UNRESOLVABLE",
        detail: b.whyBindOnly,
      });
    }
  }
  table(["our SKU", "vendor (Juan)", "binding", "price", "Angel row"], bindRows);
  p("");
  p("Vendor registry checked live: every vendor Juan named is **already registered and active**,");
  p("so the seed-15 (Delmar) registration path is not needed by this wave. `Country Snacks` in");
  p("particular has been on the books with zero SKUs since before the Angel arc started — wave 2");
  p("noticed that and used it as the basis for its MEDIUM-confidence guess. This binding is the");
  p("first SKU it has ever held.");

  // ── A1: Dried Chives — the one binding that carries a pack and a price ──────
  h(3, "A1 — Dried Chives: the pack wave 3 tabled, now written");
  p("Wave 3 found this product completely — vendor, pack, case price, true $/lb — and still");
  p("refused, because OUR side had no pack: no vendor, no format, no units, no each_size, no");
  p("chain. It published the answer as a five-row decision table and said in terms: *approve");
  p("that pack and the vendor binding plus the price follow in one step.*");
  p("");
  p("**Juan approved the item, and this section reads that as approval of the tabled package.**");
  p("That is an INFERENCE and is flagged as one, exactly like section B's primary. If he meant");
  p("the vendor only, the pack and price come straight back out and the binding stands alone.");
  p("");
  const chivesHit = resolveSku(DRIED_CHIVES_PACK.skuName, "(no vendor)");
  const chivesSku = "error" in chivesHit
    ? ((byName.get(DRIED_CHIVES_PACK.skuName) ?? []).filter((s) => s.active)[0] ?? null)
    : chivesHit.sku;
  if (!chivesSku) {
    refusals.push({ section: "A1", skuName: DRIED_CHIVES_PACK.skuName, subject: "pack + price", code: "SKU_UNRESOLVED", detail: "no ACTIVE global SKU named Dried Chives" });
    p("REFUSED: no ACTIVE global SKU named `Dried Chives`.");
  } else if (chivesSku.chain.length > 0 || chivesSku.eachSize != null) {
    refusals.push({ section: "A1", skuName: DRIED_CHIVES_PACK.skuName, subject: "pack + price", code: "PACK_SHAPE_CHANGED", detail: `the SKU acquired pack data since wave 3: ${describeChain(chivesSku)} — re-derive rather than flatten` });
    p(`REFUSED: the SKU now carries pack data (\`${describeChain(chivesSku)}\`). Re-derive before writing.`);
  } else {
    const levels = twoLevelChain(
      DRIED_CHIVES_PACK.caseLabel, DRIED_CHIVES_PACK.shakersPerCase,
      DRIED_CHIVES_PACK.shakerLabel, DRIED_CHIVES_PACK.ozPerShaker,
    );
    const collision = firstLabelMeasureCollision(levels.map((l) => l.label), measureLabels);
    if (collision != null) {
      throw new Error(`FATAL: chain label "${collision}" IS an active measure_units label — it would shadow that measure in the chain-first ozForRecipeInput walk. Aborting (no writes).`);
    }
    const flat = deriveFlatFieldsFromChain(levels);
    if (flat.eachSize == null) throw new Error("FATAL: the Dried Chives chain did not derive flat fields — malformed levels.");
    const caseOz = DRIED_CHIVES_PACK.caseOz;
    const perLb = DRIED_CHIVES_PACK.truePricePerLb;
    const effectiveDate = parseAngelDate(DRIED_CHIVES_PACK.lastSeen);
    if (!effectiveDate) throw new Error(`could not parse last_seen "${DRIED_CHIVES_PACK.lastSeen}" for Dried Chives`);

    pre();
    p(`Angel row : ${DRIED_CHIVES_PACK.angelProduct}`);
    p(`            [${DRIED_CHIVES_PACK.brand}] · ${DRIED_CHIVES_PACK.expectVendor} · ${DRIED_CHIVES_PACK.packSizeRaw} · ${money(DRIED_CHIVES_PACK.casePriceUsd)}/case · 1 purchase (${DRIED_CHIVES_PACK.lastSeen})`);
    p(`Pack      : ${DRIED_CHIVES_PACK.shakersPerCase} x ${DRIED_CHIVES_PACK.ozPerShaker} oz = ${round(caseOz, 2)} oz = ${(caseOz / 16).toFixed(2)} lb per case`);
    p(`Price     : ${money(DRIED_CHIVES_PACK.casePriceUsd)} / ${(caseOz / 16).toFixed(2)} lb = $${perLb.toFixed(2)}/lb`);
    p(`            Angel prints ${money(DRIED_CHIVES_PACK.angelStatedPricePerLb)}/lb — exactly ${(DRIED_CHIVES_PACK.angelStatedPricePerLb / perLb).toFixed(1)}x too high, the dropped-x6 bug`);
    p(`            (Angel stored ONE 1.12 oz shaker's weight as the whole 6-pack case's).`);
    p(`Our SKU   : ${chivesSku.name} [${chivesSku.id}] vendor=${chivesSku.vendorName} chain_levels=${chivesSku.chain.length} each_size=${chivesSku.eachSize ?? "NULL"}`);
    pre();
    p("");

    chainWrites.push({
      section: "A", skuId: chivesSku.id, skuName: chivesSku.name, vendorName: DRIED_CHIVES_PACK.expectVendor,
      levels, preservePackFormat: chivesSku.packFormat,
      beforeDescriptor: describeChain(chivesSku),
      afterDescriptor: `${describeLevels(levels)} | flat ${flat.packFormat} ${flat.unitsPerPack}x${flat.eachSize}${flat.eachMeasure}`,
      weightClass: "SPEC",
      sourceNote: `Pack from Angel's own pack string \`${DRIED_CHIVES_PACK.packSizeRaw}\` on ${DRIED_CHIVES_PACK.angelProduct} [${DRIED_CHIVES_PACK.brand}]: ${DRIED_CHIVES_PACK.shakersPerCase} shakers x ${DRIED_CHIVES_PACK.ozPerShaker} oz = ${round(caseOz, 2)} oz. weight_class SPEC — this is a manufacturer's stated fill, not a weighing, and it is exactly the kind of number the 6x dropped-multiplier bug lives inside, so it is labelled as a label.`,
      evidence: `wave 3 §E1 decision table, approved by Juan's 2026-08-20 "Dried Chives -> US Foods" ruling (INFERRED: he approved the item, the table said the pack carries the binding and the price)`,
      metadata: {
        angel_product: DRIED_CHIVES_PACK.angelProduct, angel_brand: DRIED_CHIVES_PACK.brand,
        angel_pack_string: DRIED_CHIVES_PACK.packSizeRaw,
        shakers_per_case: DRIED_CHIVES_PACK.shakersPerCase, oz_per_shaker: DRIED_CHIVES_PACK.ozPerShaker,
        case_oz: caseOz, weight_class: "SPEC",
        pack_approval_is_inferred: true,
        pack_approval_basis: "wave 3 §E1 published this exact pack and framed the binding + price as following from it; Juan approved the item, not the table explicitly",
      },
    });

    priceWrites.push({
      section: "A", skuId: chivesSku.id, skuName: chivesSku.name, vendorName: DRIED_CHIVES_PACK.expectVendor,
      angelProduct: DRIED_CHIVES_PACK.angelProduct,
      unitPrice: DRIED_CHIVES_PACK.casePriceUsd, effectiveDate,
      arithmetic: `${money(DRIED_CHIVES_PACK.casePriceUsd)} per case / 1 (our pack IS the case: ${round(caseOz, 2)} oz) = ${money(DRIED_CHIVES_PACK.casePriceUsd)}  [= $${perLb.toFixed(2)}/lb]`,
      sourceNote:
        `${DRIED_CHIVES_PACK.angelProduct} [${DRIED_CHIVES_PACK.brand}] · US Foods · ${DRIED_CHIVES_PACK.packSizeRaw} · 1 purchase ${DRIED_CHIVES_PACK.lastSeen}. ` +
        `Our pack IS one Angel case (${DRIED_CHIVES_PACK.shakersPerCase} x ${DRIED_CHIVES_PACK.ozPerShaker} oz = ${round(caseOz, 2)} oz), so divisor = 1 and unit_price = the case price, ${money(DRIED_CHIVES_PACK.casePriceUsd)} = $${perLb.toFixed(2)}/lb. ` +
        `Angel's own $${DRIED_CHIVES_PACK.angelStatedPricePerLb.toFixed(2)}/lb is 6.0x too high — it stored ONE 1.12 oz shaker's weight as the whole case's (harvest 2 §2, confirmed from two independent fields on the same product page). ` +
        `Supersedes wave 3's OUR_PACK_UNRESOLVABLE refusal. The competing candidate is the 2024 costing sheet's "Dried Chives, b, $3.95 / 2 oz" (Baldor, $31.60/lb) — 37% higher, two years old, and on a lane we migrated away from.`,
      metadata: {
        angel_product: DRIED_CHIVES_PACK.angelProduct, angel_vendor: "US Foods", angel_brand: DRIED_CHIVES_PACK.brand,
        case_oz: caseOz, price_per_lb: round(perLb, 4), relation: "OUR_PACK_IS_THE_ANGEL_CASE",
        angel_stated_price_per_lb: DRIED_CHIVES_PACK.angelStatedPricePerLb,
        angel_bug: "dropped_multiplier_x6",
        supersedes: "wave 3 §E1 OUR_PACK_UNRESOLVABLE",
      },
    });
    p(`→ WOULD WRITE pack \`${describeLevels(levels)}\` and price **${money(DRIED_CHIVES_PACK.casePriceUsd)}** (eff ${effectiveDate}), giving **$${perLb.toFixed(2)}/lb**.`);
  }

  // ── A2: Beef Base — bound, and deliberately unpriced ────────────────────────
  h(3, "A2 — Beef Base: bound, and deliberately unpriced");
  p("The binding is written; the price is not, for two independent reasons and either would");
  p("be enough on its own.");
  p("");
  p("**Our side has no pack.** No chain, no `pack_format`, no `units_per_pack`, no `each_size`.");
  p("There is no denominator. This is the same shape as Dried Chives — with one difference that");
  p("decides the outcome: wave 3 put the chives pack in front of Juan and nobody has ever put");
  p("this one in front of him. So it goes in a table rather than into the database.");
  p("");
  p("**And PFG shows two competing rows.** They fail in opposite directions, which is why a");
  p("tie-break rule cannot settle it:");
  p("");
  table(
    ["Angel row", "brand", "pack", "case $", "Angel $/lb", "measured lb", "nominal lb", "lines", "last seen", "implied $/1 lb jar"],
    BEEF_BASE_CANDIDATES.map((c) => [
      `\`${c.product}\``, c.brand, c.packSizeRaw, money(c.casePriceUsd), money(c.angelPricePerLb),
      String(c.measuredLbsPerUnit), String(c.nominalLbs), String(c.purchaseLines), c.lastSeen,
      `**${money(c.impliedPerJarUsd)}**`,
    ]),
    ["", "", "", "r", "r", "r", "r", "r", "", "r"],
  );
  p("");
  for (const c of BEEF_BASE_CANDIDATES) p(`- \`${c.product}\` [${c.brand}] — ${c.reading}`);
  p("");
  p("**Why `$9.34/lb x our pack` is NOT the arithmetic to use here, even though Angel offers");
  p("that $/lb.** `priceFromPerLb` exists for CATCH-WEIGHT products, where the $/lb is the");
  p("contract term and the delivered weight is what varies — Delmar's deli meats. A Minor's");
  p("beef base is the opposite: a manufactured fixed pack where the CASE PRICE is the contract");
  p("term and the weight is incidental. Worse, Angel's 6.703 lb includes the glass, so its");
  p("$9.34/lb is case-price-over-GROSS-weight. Multiplying it back by a 6.0 lb nominal pack");
  p(`gives ${money(9.34 * 6)} against a true ${money(62.61)} — a 10.5% understatement, in a wave whose whole`);
  p("premise is that we stopped inventing denominators.");
  p("");
  p("**The reassuring part:** both candidate readings land within 7% of each other per 1 lb jar");
  p("($10.44 vs $9.72). Whichever row Juan picks, beef base costs about ten dollars a jar — so");
  p("this is a low-stakes question that nonetheless has to be asked, because writing the wrong");
  p("one of the two would be silently wrong rather than visibly uncertain.");
  p("");
  p("**Recommended, if he wants it in one word:** the MINORS row, pack `case = 6 x jar; jar =");
  p("16 oz`, `unit_price = $62.61`. It is the row with a coherent pack string, its 1.117x is a");
  p("named and understood tare pattern rather than an unexplained 7x, and its per-jar figure");
  p("brackets the other candidate from above.");

  // ══ SECTION B — the lettuce pair ═════════════════════════════════════════════
  h(2, "Section B — the lettuce pair: both-active, Sysco primary");
  p("Seed 18 listed Lettuce in `PENDING_PRODUCTS` and deliberately did not touch it: *\"nothing");
  p("is unorderable and nothing is mis-costed today, and it has not been decided.\"* Juan has now");
  p("decided the shape — both-active, primary + backup, like ham.");
  p("");
  p("**The route is not ham's route, and that decides which row gets written.** Ham had an");
  p("INACTIVE primary and an active backup, so seed 18 activates the PRIMARY (its step-1 write is");
  p("guarded `.eq(\"active\", false)` on the primary id). Lettuce is the mirror image: the primary");
  p("is already active and the BACKUP is the inactive one. Seed 18 has no branch for that — at");
  p("its line 430 it emits a warning and moves on, explicitly \"out of adjudicated scope\". So the");
  p("write below is one seed 18 cannot make, and it is the only structural write in this section.");
  p("");

  const lettucePrimary = resolveSku(LETTUCE_PAIR.primary.expectName, LETTUCE_PAIR.primary.expectVendor, false);
  const lettuceBackup = resolveSku(LETTUCE_PAIR.backup.expectName, LETTUCE_PAIR.backup.expectVendor, false);

  // Split rather than collapsed, so the report says WHICH side failed to resolve —
  // and so TypeScript can narrow both handles in the success branch.
  if ("error" in lettucePrimary) {
    refusals.push({ section: "B", skuName: "Lettuce", subject: "pair (primary side)", code: lettucePrimary.code, detail: lettucePrimary.error });
    p(`REFUSED (primary): ${lettucePrimary.error}`);
  } else if ("error" in lettuceBackup) {
    refusals.push({ section: "B", skuName: "Lettuce", subject: "pair (backup side)", code: lettuceBackup.code, detail: lettuceBackup.error });
    p(`REFUSED (backup): ${lettuceBackup.error}`);
  } else {
    const pri = lettucePrimary.sku;
    const bak = lettuceBackup.sku;
    const priPins = await loadPins(pri.id);
    const bakPins = await loadPins(bak.id);

    pre();
    p(`PRIMARY (inferred)  ${pri.vendorName}/${pri.name} [${pri.id}]`);
    p(`                    active=${pri.active} weekday_par=${pri.weekdayPar ?? "NULL"} weekend_par=${pri.weekendPar ?? "NULL"} pins=${priPins.length}`);
    p(`                    pack: ${describeChain(pri)}`);
    p(`BACKUP              ${bak.vendorName}/${bak.name} [${bak.id}]`);
    p(`                    active=${bak.active} weekday_par=${bak.weekdayPar ?? "NULL"} weekend_par=${bak.weekendPar ?? "NULL"} pins=${bakPins.length}`);
    p(`                    pack: ${describeChain(bak)}`);
    pre();
    p("");
    p(`**The primary is an INFERENCE and is veto-able in one word.** ${LETTUCE_PAIR.primaryInferenceBasis}`);
    p("");

    // The structural write: activate the BACKUP.
    if (bak.active) {
      refusals.push({ section: "B", skuName: "Lettuce", subject: "backup activation", code: "ALREADY_CORRECT", detail: `${bak.vendorName}/Lettuce is already active` });
      p(`- backup activation: **already active** — no write.`);
    } else {
      activateWrites.push({
        section: "B", skuId: bak.id, skuName: bak.name, vendorName: bak.vendorName, role: "backup",
        evidence: `Juan 2026-08-20: the Lettuce pair goes BOTH-ACTIVE, primary + backup like ham. The backup is the inactive side here, which is the mirror of the ham case seed 18 handles.`,
        metadata: {
          op: "twin_backup_activate",
          twin_primary_id: pri.id, twin_primary_vendor: pri.vendorName,
          primary_is_inferred: LETTUCE_PAIR.primaryIsInferred,
          primary_inference_basis: LETTUCE_PAIR.primaryInferenceBasis,
          backup_pars: { weekday: bak.weekdayPar, weekend: bak.weekendPar },
          ruling: "Juan 2026-08-20: Lettuce pair -> BOTH-ACTIVE, primary + backup like ham.",
          why_not_seed_18: "seed 18's step 1 activates the PRIMARY (guarded .eq('active', false) on the primary id); this pair's inactive side is the BACKUP, which that script explicitly leaves out of scope",
        },
      });
      p(`- backup activation: **WOULD WRITE** — ${bak.vendorName}/Lettuce \`active: false -> true\`.`);
    }

    // Pars: assert, never invent. Seed 18's rule, and here it bites harder.
    if (bak.weekdayPar != null || bak.weekendPar != null) {
      refusals.push({ section: "B", skuName: "Lettuce", subject: "backup pars", code: "PAR_ABSENT", detail: `the backup carries pars (weekday ${bak.weekdayPar ?? "NULL"}, weekend ${bak.weekendPar ?? "NULL"}) — a double-suggest risk, but clearing a par is Juan's call, not this script's` });
      p(`- backup pars: **NOT NULL** (weekday ${bak.weekdayPar ?? "NULL"}, weekend ${bak.weekendPar ?? "NULL"}) — double-suggest risk. NOT cleared here.`);
    } else {
      p(`- backup pars: already NULL, as the backup role requires. Nothing to do.`);
    }
    if (pri.weekdayPar == null && pri.weekendPar == null) {
      refusals.push({ section: "B", skuName: "Lettuce", subject: "primary par", code: "PAR_ABSENT", detail: "neither twin has ever carried a par, so both-active leaves the pair correctly shaped and still unorderable" });
      p("");
      p("**⚠ The one thing the ruling does not reach.** Ham's primary holds a par (weekday 3), which");
      p("is what makes that pair orderable. **Neither lettuce twin has ever had a par.** So after this");
      p("section runs, the pair is correctly shaped and still unorderable — the walker has nothing to");
      p("suggest. Seed 18's rule on this is exact and wave 4 keeps it: *\"Refusing to invent one.\"*");
      p("A par is a floor decision, and it is the one remaining thing standing between lettuce and a");
      p("working order line.");
    } else {
      p(`- primary par: weekday ${pri.weekdayPar ?? "NULL"}, weekend ${pri.weekendPar ?? "NULL"} — the pair is orderable once both sides are active.`);
    }

    // Pins: there should be none, and if that changed it matters.
    if (priPins.length + bakPins.length === 0) {
      p("");
      p("Both twins carry **zero recipe pins**, so no pin can move and none needs to — seed 18's");
      p("pin-preservation gate has nothing to gate. That is also why this pair was safe to leave");
      p("undecided for as long as it was: an un-adjudicated pair with no pins mis-costs nothing.");
    } else {
      p("");
      p(`⚠ Pins exist now (primary ${priPins.length}, backup ${bakPins.length}) where the seed-18 dry run recorded zero.`);
      p("Re-run seed 18's gate before moving anything — this section does NOT move pins.");
      for (const pin of bakPins) {
        const before = ozForRecipeInput(pin.quantity, pin.unit, shapeOf(bak), measures);
        const after = ozForRecipeInput(pin.quantity, pin.unit, shapeOf(pri), measures);
        p(`    backup pin "${pin.recipeName}" ${pin.quantity} ${pin.unit ?? "-"}: backup ${oz(before)} vs primary ${oz(after)}`);
      }
    }

    // The attribution finding.
    h(3, "B1 — the PFG-lettuce attribution finding");
    p("Our registry says lettuce comes from Sysco or Baldor. **Angel says every head of iceberg");
    p("bought in the five-week window came from PFG or US Foods.** Neither twin appears anywhere in");
    p("the purchase history — not once, under any spelling.");
    p("");
    p("Both statements can be true at once: the twins are the ORDERING lane and Angel is the");
    p("INVOICE lane, and a distributor change that never reached the SKU registry would look exactly");
    p("like this. But they cannot both be COMPLETE, and the gap is not small:");
    p("");
    const lettuceSpend = PFG_LETTUCE_CANDIDATES.reduce((a, c) => a + c.totalSpendUsd, 0);
    table(
      ["Angel row", "brand", "vendor", "pack", "lines", "spend", "unit price", "lb/unit"],
      PFG_LETTUCE_CANDIDATES.map((c) => [
        `\`${c.product}\``, c.brand, c.vendor, c.packSizeRaw, String(c.purchaseLines),
        `**${money(c.totalSpendUsd)}**`,
        c.unitPriceMinUsd === c.unitPriceMaxUsd ? money(c.unitPriceMinUsd) : `${money(c.unitPriceMinUsd)}–${money(c.unitPriceMaxUsd)}`,
        c.lbsPerUnitMin === c.lbsPerUnitMax ? `${c.lbsPerUnitMin}` : `${c.lbsPerUnitMin}–${c.lbsPerUnitMax}`,
      ]),
      ["", "", "", "", "r", "r", "r", "r"],
    );
    p("");
    for (const c of PFG_LETTUCE_CANDIDATES) p(`- \`${c.product}\` — ${c.note}`);
    p("");
    p(`**${money(lettuceSpend)} of iceberg across ${PFG_LETTUCE_CANDIDATES.reduce((a, c) => a + c.purchaseLines, 0)} invoice lines, attributable to no SKU we hold.** For scale, that is`);
    p("larger than any single line this arc HAS priced. It is also why wave 4 cannot price lettuce:");
    p("not \"declines to\" — cannot. There is no Angel row attributable to either twin, so any number");
    p("would be an attribution guess wearing arithmetic's clothes.");
    p("");
    p("**Decision, not a write: does a PFG/Lettuce SKU need to exist?** The candidate is");
    p("`LETTUCE ICEBERG LINER` — 5 lines, 61 units, the dominant row by a distance. Creating it is a");
    p("registry decision with knock-on effects (it would make lettuce a THREE-vendor product, and");
    p("the walker would then need to know which of three to suggest), so it is listed and **NOT");
    p("created**. If Juan says the lettuce lane moved to PFG, the cleaner answer may be re-pointing");
    p("the Sysco twin rather than adding a third row — but that is his call about the real world,");
    p("not an inference this script can make from a spend table.");
    refusals.push({
      section: "B1", skuName: "Lettuce", subject: "price",
      code: "ATTRIBUTION_UNRESOLVED",
      detail: `Angel's ${PFG_LETTUCE_CANDIDATES.length} iceberg rows (${money(lettuceSpend)}) are all PFG or US Foods; our twins are Sysco and Baldor. No Angel price is attributable to either twin.`,
    });
  }

  // ══ SECTION C — the herb weight policy ═══════════════════════════════════════
  h(2, "Section C — the fresh-herb / variable-catch weight policy");
  p(MD ? `> ${HERB_WEIGHT_POLICY}` : `  ${HERB_WEIGHT_POLICY}`);
  p("");
  p("**Why this is a third weight class rather than a variant of the two we have.** Wave 3 split");
  p("one column into SPEC (what the label says) and OPERATIONAL (what our line produces). A box of");
  p("basil is neither: nobody here weighs it, and its `1 LB` pack string is a unit size rather than");
  p("a content weight. The honest number is what the grower actually delivered — averaged, because");
  p("for a bunch product there is no single true value to measure, only a distribution to summarise.");
  p("");
  table(["class", "means"], (Object.keys(WEIGHT_CLASS_MEANING) as WeightClass[]).map((k) => [`\`${k}\``, WEIGHT_CLASS_MEANING[k]]));
  p("");
  p(`**Average, defined:** ${AVERAGE_DEFINITION}. Two readings of "average" exist and they are`);
  p("different computations; this one is the average weight of a box we actually RECEIVED (a line");
  p("covering four boxes counts four times) and it divides raw totals rather than figures the CSV");
  p("has already rounded. On today's data the two agree to better than 0.01% everywhere, which is");
  p("exactly why it is worth pinning now — while nothing depends on the choice.");
  p("");
  p("**The exclusion that makes this safe.** Lines whose `weight_source` is not");
  p("`invoice_catch_weight` are dropped before any arithmetic. That is not hygiene, it is the whole");
  p("safety property — and section C1 shows it earning its keep on basil.");
  p("");

  interface HerbPlan {
    skuName: string;
    sku: LiveSku | null;
    avg: InvoiceAverage | null;
    newPackOz: number | null;
    ourPackOz: number | null;
    premise: ReturnType<typeof classifyPackPremise>;
    latestCasePrice: number | null;
    effectiveDate: string | null;
    livePrice: number | null;
    verdict: string;
  }
  const herbPlans: HerbPlan[] = [];
  const cRows: string[][] = [];

  for (const rule of VARIABLE_CATCH_RULES) {
    const hit = resolveSku(rule.skuName, rule.expectVendor);
    if ("error" in hit) {
      refusals.push({ section: "C", skuName: rule.skuName, subject: "pack weight", code: hit.code, detail: hit.error });
      herbPlans.push({ skuName: rule.skuName, sku: null, avg: null, newPackOz: null, ourPackOz: null, premise: "PREMISE_BROKEN", latestCasePrice: null, effectiveDate: null, livePrice: null, verdict: `UNRESOLVED — ${hit.error}` });
      continue;
    }
    const sku = hit.sku;
    const key = purchaseRowKey({ product: rule.product, brand: rule.brand, vendor: rule.vendor, packSize: rule.packSizeRaw });
    const lines = historyByKey.get(key) ?? [];
    const avg = invoiceAverageLbs(lines);

    // Our pack's ounces, read from the CHAIN (source of truth), never the flat mirror.
    const ourPackOz = sku.chain.length === 1 && sku.chain[0]!.containsMeasureUnit === "oz"
      ? Number(sku.chain[0]!.containsQty)
      : sku.eachSize != null && sku.eachMeasure === "oz" && (sku.unitsPerPack ?? 1) === 1
        ? sku.eachSize
        : null;

    const premise = classifyPackPremise(ourPackOz, rule.angelNominalOz);

    // Latest case price, DERIVED from the history rather than trusted from the constant.
    const dated = lines
      .map((l) => ({ iso: parseAngelDate(l.date), price: l.unitPricePerCase, ws: l.weightSource }))
      .filter((d): d is { iso: string; price: number; ws: string } => d.iso != null && d.price != null && classifyWeightSource(d.ws) === "MEASURED")
      .sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));
    const latest = dated[0] ?? null;
    const roll = rollupByKey.get(key) ?? null;

    const { data: phRows, error: phErr } = await sb
      .from("vendor_price_history").select("unit_price, effective_date, source")
      .eq("vendor_item_id", sku.id).order("effective_date", { ascending: false })
      .returns<Array<{ unit_price: number | string; effective_date: string; source: string | null }>>();
    if (phErr) throw new Error(`load price history for ${sku.name}: ${phErr.message}`);
    const livePrice = num((phRows ?? [])[0]?.unit_price ?? null);

    const plan: HerbPlan = {
      skuName: rule.skuName, sku, avg,
      newPackOz: avg ? lbsToPackOz(avg.meanLbs) : null,
      ourPackOz, premise,
      latestCasePrice: latest?.price ?? null,
      effectiveDate: latest?.iso ?? null,
      livePrice,
      verdict: "",
    };

    // ── The refusal ladder, in the order the reasons actually bite ────────────
    if (avg == null) {
      plan.verdict = "**REFUSED — no measured invoice weight**";
      refusals.push({ section: "C", skuName: rule.skuName, subject: "pack weight", code: "NO_MEASURED_INVOICE_WEIGHT", detail: `${lines.length} invoice line(s) for \`${rule.product}\` [${rule.brand}], none with weight_source = invoice_catch_weight` });
    } else if (rule.scaleGated) {
      plan.verdict = "**HELD — scale-gated**";
      refusals.push({
        section: "C", skuName: rule.skuName, subject: "pack weight", code: "SCALE_GATED",
        detail: `invoice average ${round(avg.meanLbs, 4)} lb (${lbsToPackOz(avg.meanLbs)} oz) over ${avg.lines} line(s) / ${avg.units} units, range ${round(avg.minLbs, 4)}–${round(avg.maxLbs, 4)} lb — but ${rule.note}`,
      });
    } else if (premise !== "OUR_PACK_IS_THE_ANGEL_UNIT") {
      plan.verdict = `**REFUSED — ${premise}**`;
      refusals.push({
        section: "C", skuName: rule.skuName, subject: "pack weight", code: "PACK_PREMISE_BROKEN",
        detail: `our pack is ${ourPackOz ?? "UNREADABLE"} oz against an Angel nominal of ${rule.angelNominalOz} oz (${premise}). ${rule.note}`,
      });
    } else if (ourPackOz != null && avg != null && Math.abs(ourPackOz - lbsToPackOz(avg.meanLbs)) < 1e-9) {
      plan.verdict = "no-op (already correct)";
      refusals.push({ section: "C", skuName: rule.skuName, subject: "pack weight", code: "ALREADY_CORRECT", detail: `pack is already ${ourPackOz} oz` });
    } else if (ourPackOz == null || Math.abs(ourPackOz - rule.ourPackOzExpected) > 1e-9) {
      plan.verdict = "**REFUSED — pack shape changed**";
      refusals.push({
        section: "C", skuName: rule.skuName, subject: "pack weight", code: "PACK_SHAPE_CHANGED",
        detail: `expected a single oz-terminated pack of ${rule.ourPackOzExpected} oz, found ${describeChain(sku)} — re-derive rather than flatten`,
      });
    } else if (latest == null || roll == null) {
      plan.verdict = "**REFUSED — no dated case price**";
      refusals.push({ section: "C", skuName: rule.skuName, subject: "pack weight", code: "NO_MEASURED_INVOICE_WEIGHT", detail: `no dated, measured invoice line to take a case price and an effective_date from` });
    } else if (Math.abs(latest.price - rule.latestCasePriceUsd) > 1e-9) {
      // The constant is an ASSERTION, not an input. If the CSV has moved under it, stop.
      plan.verdict = "**REFUSED — case price drifted**";
      refusals.push({
        section: "C", skuName: rule.skuName, subject: "price", code: "PACK_SHAPE_CHANGED",
        detail: `the rule asserts a latest case price of ${money(rule.latestCasePriceUsd)}; the history's latest measured line (${latest.iso}) says ${money(latest.price)} — the CSV moved under the rule`,
      });
    } else {
      // ── WRITE: pack, and the price that must move with it ──────────────────
      const newPackOz = lbsToPackOz(avg.meanLbs);
      const label = sku.chain.length === 1 ? sku.chain[0]!.label : (sku.packFormat ?? "case");
      const levels = oneLevelChain(label, newPackOz);
      const collision = firstLabelMeasureCollision(levels.map((l) => l.label), measureLabels);
      if (collision != null) {
        throw new Error(`FATAL: chain label "${collision}" IS an active measure_units label — it would shadow that measure in the chain-first ozForRecipeInput walk. Aborting (no writes).`);
      }
      const flat = deriveFlatFieldsFromChain(levels);

      /** One invoice line is a legitimate average and a thin one. Marked, not blocked. */
      const thin = avg.lines < 2 ? " ⚠ n=1" : "";
      const before = costPerOz(livePrice, ourPackOz);
      const after = costPerOz(latest.price, newPackOz);
      const sourceNote =
        `INVOICE_DERIVED pack weight per Juan's 2026-08-20 fresh-herb / variable-catch policy. ` +
        `Angel row \`${rule.product}\` [${rule.brand}] ${rule.packSizeRaw}: ${avg.lines} invoice line(s), ${avg.units} unit(s), ${round(avg.totalLbs, 3)} lb total. ` +
        `Average = ${AVERAGE_DEFINITION} = ${round(avg.meanLbs, 4)} lb = ${newPackOz} oz (range ${round(avg.minLbs, 4)}–${round(avg.maxLbs, 4)} lb, spread ${pct(avg.spreadFraction)}; unweighted mean ${round(avg.meanUnweightedLbs, 4)} lb agrees to ${pct(avg.meanUnweightedLbs / avg.meanLbs - 1)}). ` +
        `${avg.excludedNonMeasured > 0 ? `${avg.excludedNonMeasured} line(s) excluded for a non-measured weight_source. ` : ""}` +
        `Supersedes the pack string's nominal ${rule.angelNominalOz} oz, which is a unit SIZE and not a content weight for a bunch product. ` +
        `Policy: ${HERB_WEIGHT_POLICY}`;

      chainWrites.push({
        section: "C", skuId: sku.id, skuName: sku.name, vendorName: sku.vendorName,
        levels, preservePackFormat: sku.packFormat,
        beforeDescriptor: describeChain(sku),
        afterDescriptor: `${describeLevels(levels)} | flat ${flat.packFormat} ${flat.unitsPerPack}x${flat.eachSize}${flat.eachMeasure}`,
        weightClass: "INVOICE_DERIVED",
        sourceNote,
        evidence: `${avg.lines} invoice line(s) over ${avg.units} unit(s), ${round(avg.minLbs, 4)}–${round(avg.maxLbs, 4)} lb/unit`,
        metadata: {
          angel_product: rule.product, angel_brand: rule.brand, angel_pack_string: rule.packSizeRaw,
          weight_class: "INVOICE_DERIVED",
          average_definition: AVERAGE_DEFINITION,
          invoice_lines: avg.lines, invoice_units: avg.units, invoice_total_lbs: round(avg.totalLbs, 4),
          mean_lbs: round(avg.meanLbs, 6), mean_unweighted_lbs: round(avg.meanUnweightedLbs, 6),
          min_lbs: avg.minLbs, max_lbs: avg.maxLbs, spread_fraction: round(avg.spreadFraction, 6),
          excluded_non_measured_lines: avg.excludedNonMeasured,
          nominal_oz: rule.angelNominalOz, before_pack_oz: ourPackOz, after_pack_oz: newPackOz,
          ratio_measured_over_nominal: round((avg.meanLbs * 16) / rule.angelNominalOz, 4),
          policy: HERB_WEIGHT_POLICY,
          refresh_note: "recompute from docs/angel-purchase-history.csv as new invoices land; this is an average, not a constant",
        },
      });

      // The price. Where one already exists at this value, say so and skip.
      if (livePrice != null && Math.abs(livePrice - latest.price) < 1e-9) {
        refusals.push({ section: "C", skuName: rule.skuName, subject: "price", code: "ALREADY_CORRECT", detail: `live price is already ${money(latest.price)} — only the pack moves, and cost/oz moves with it` });
        plan.verdict = `**WRITE pack ${ourPackOz} -> ${newPackOz} oz** (price already correct)${thin}`;
      } else {
        priceWrites.push({
          section: "C", skuId: sku.id, skuName: sku.name, vendorName: sku.vendorName,
          angelProduct: rule.product, unitPrice: latest.price, effectiveDate: latest.iso,
          arithmetic: `${money(latest.price)} per ${rule.packSizeRaw} unit / 1 (our pack IS one Angel unit) = ${money(latest.price)}  [= ${money4(after ?? 0)}/oz at the corrected ${newPackOz} oz]`,
          sourceNote:
            `${rule.product} [${rule.brand}] · ${rule.vendor} · ${rule.packSizeRaw}. Our pack IS one Angel unit (divisor 1), so unit_price = the invoice's unit price, ${money(latest.price)}, observed ${latest.iso}. ` +
            `Written TOGETHER with the INVOICE_DERIVED pack correction to ${newPackOz} oz — unit_price is the price of one of OUR packs, so a price against the old ${rule.angelNominalOz} oz nominal would read ${money4(costPerOz(latest.price, rule.angelNominalOz) ?? 0)}/oz against a true ${money4(after ?? 0)}/oz. ` +
            `Pack and price are one fact seen twice; wave 3 §C established the rule and this is the same rule in the opposite direction.`,
          metadata: {
            angel_product: rule.product, angel_brand: rule.brand, angel_vendor: rule.vendor,
            relation: "OUR_PACK_IS_THE_ANGEL_UNIT", pack_oz: newPackOz,
            cost_per_oz: round(after ?? 0, 6),
            cost_per_oz_if_nominal: round(costPerOz(latest.price, rule.angelNominalOz) ?? 0, 6),
            paired_with_pack_write: true,
          },
        });
        plan.verdict = `**WRITE pack ${ourPackOz} -> ${newPackOz} oz + price ${money(latest.price)}**${thin}`;
      }

      cRows.push([
        sku.name, `\`${rule.product}\` [${rule.brand}]`,
        `${avg.lines} / ${avg.units}`,
        `${round(avg.meanLbs, 4)} lb`,
        `${round(avg.minLbs, 4)}–${round(avg.maxLbs, 4)}`,
        `${round((avg.meanLbs * 16) / rule.angelNominalOz, 3)}x`,
        `${ourPackOz} -> **${newPackOz} oz**`,
        livePrice != null ? money(livePrice) : "—",
        money(latest.price),
        before != null ? money4(before) : "—",
        after != null ? `**${money4(after)}**` : "—",
        before != null && after != null ? `**${pct(after / before - 1)}**` : "_(was unpriced)_",
      ]);
    }
    herbPlans.push(plan);
  }

  p("── WOULD WRITE: pack weight + the price that moves with it ──");
  table(
    ["our SKU", "Angel row", "lines / units", "avg lb", "range", "vs nominal", "pack oz", "price before", "price after", "$/oz before", "$/oz after", "$/oz change"],
    cRows,
    ["", "", "r", "r", "r", "r", "r", "r", "r", "r", "r", "r"],
  );
  p("");
  p("**Read the `$/oz change` column as the whole point of section C.** These are all corrections");
  p("in the SAFE direction — the pack gets bigger, so cost per ounce falls. A 16 oz nominal box of");
  p("basil that really holds 23.2 oz was making every basil-bearing recipe look 45% more expensive");
  p("than it is. Nothing here makes anything cheaper to BUY; it makes the cost we record match");
  p("what we actually received.");
  p("");
  p("**And nothing here changes depletion.** `avg_oz_per_each` is the column a count-unit recipe");
  p("line consumes, and section C does not touch it on any SKU. Basil's `6 leaf` pin still resolves");
  p("through its 0.017 oz/leaf; thyme's `12 sprig` still resolves through 0.02 oz/sprig. Only the");
  p("cost side moves.");

  // ── Every row's disposition, including the ones held ────────────────────────
  p("");
  p("── EVERY SKU THE POLICY NAMES, AND WHAT HAPPENED TO IT ──");
  table(
    ["our SKU", "our pack", "Angel nominal", "premise", "invoice avg", "spread", "verdict"],
    herbPlans.map((pl) => [
      pl.skuName,
      pl.ourPackOz != null ? `${pl.ourPackOz} oz` : "unreadable",
      `${VARIABLE_CATCH_RULES.find((r) => r.skuName === pl.skuName)?.angelNominalOz ?? "—"} oz`,
      pl.premise === "OUR_PACK_IS_THE_ANGEL_UNIT" ? "✓ our pack = 1 Angel unit" : `⚠ ${pl.premise}`,
      pl.avg ? `${round(pl.avg.meanLbs, 4)} lb (n=${pl.avg.lines})` : "—",
      pl.avg == null ? "—"
        : pl.avg.lines < 2 ? "_(n=1 — no spread)_"
        : pl.avg.spreadFraction <= CONSTANT_WEIGHT_SPREAD_CEILING ? "**0 — never moved**"
        : `${round(pl.avg.spreadFraction, 5)}`,
      pl.verdict,
    ]),
    ["", "r", "r", "", "r", "r", ""],
  );
  p("");
  p("**The `spread` column is the column to read twice.** It answers one binary question —");
  p("*did this number ever move?* — and it is the only thing in this table that distinguishes a");
  p("weight somebody weighed from a weight somebody stored. The ratio column cannot: garlic and");
  p("oregano both sit at 1.20x nominal, and one of them varies per delivery while the other is");
  p("byte-identical on every invoice for three months.");
  p("");
  p("Two rows deserve a second look before approval:");
  p("");
  p("- **Thyme rests on ONE invoice line.** An average of one is that one. The policy still");
  p("  applies — Juan's ruling is about which SOURCE to trust, not about sample size — and 0.47 lb");
  p("  against a 0.25 lb nominal is the largest gap in the set (1.88x), so leaving it at 4 oz is");
  p("  certainly wrong. But this is the row most likely to move when the next thyme invoice lands,");
  p("  and it is the one to re-run the policy over first.");
  p("- **Fresh chives never moved across 7 lines** (0.81 lb every time). That is a second,");
  p("  independent reason for caution beyond the pack-premise refusal that already stops it: a");
  p("  bunch product whose weight is identical seven times running does not behave like the bunch");
  p("  products this policy was written for.");

  // ── C1: the basil duplicate ────────────────────────────────────────────────
  h(3, "C1 — the basil duplicate, resolved by a filter rather than a judgement");
  p("Three Angel rows answer to our one `Basil` SKU, and wave 1's own division table carries all");
  p("three. The trap harvest 2 §2(c) names is that **because the pack string genuinely IS `1 LB`,");
  p("a fabricated 1.0 lb is indistinguishable from a correct 1.0 lb by inspection.** The only");
  p("reason the fabrication was ever caught is that a sibling with the identical pack string");
  p("measured 1.45 lb.");
  p("");
  p("`weight_source` catches it with no sibling needed, which is why the resolution below is a");
  p("filter the code applies rather than a call someone makes:");
  p("");
  table(
    ["Angel row", "brand", "vendor", "case $", "weight_source", "verdict"],
    BASIL_DUPLICATE_CLUSTER.map((c) => [
      `\`${c.product}\``, c.brand, c.vendor, money(c.casePriceUsd), `\`${c.weightSource}\``,
      c.verdict === "USE" ? "**USE**" : "REJECT",
    ]),
    ["", "", "", "r", "", ""],
  );
  p("");
  for (const c of BASIL_DUPLICATE_CLUSTER) p(`- \`${c.product}\` [${c.brand}] — ${c.why}`);
  p("");
  p("Note what the rejection costs and what it saves. The FRSH ADV row is the CHEAPEST basil on");
  p("the invoice at $10.34 a box, so rejecting it looks like leaving money on the table. It is the");
  p("opposite: its $10.34/lb is a case price wearing a $/lb label, and harvest 2's estimate is that");
  p("the box really weighs ~1.45 lb like its sibling, making its true cost **$7.13/lb** — the");
  p("cheapest of the three by a distance, where Angel ranks it in the middle. We reject it as a");
  p("PRICING SOURCE while noting it may well be the better BUY. Those are different questions and");
  p("this wave only answers the first.");

  // ══ SECTION D — the still-stuck ledger ═══════════════════════════════════════
  h(2, "Section D — the still-stuck ledger (report only)");
  p("Everything wave 4 leaves exactly where it found it, with the one fact that would move each.");
  p("");
  p("**The categories matter more than the rows.** `SUPPLY_RUN` is not a backlog — no future");
  p("harvest resolves it, because Angel can only cost what arrives on an integrated vendor's");
  p("invoice. `SCALE_GATED` is ninety seconds of Juan's time for a whole cluster.");
  p("`UNADJUDICATED_PAIR` is a decision, not a lookup. `POLICY_PREMISE` is a ruling that turned");
  p("out not to reach a row it named. Filing them all as \"TODO\" would lose exactly the");
  p("distinction that tells you which to do first.");
  p("");
  const byCategory = new Map<string, typeof STILL_STUCK[number][]>();
  for (const s of STILL_STUCK) {
    const list = byCategory.get(s.category) ?? [];
    list.push(s);
    byCategory.set(s.category, list);
  }
  for (const [cat, list] of byCategory) {
    p(MD ? `\n**${cat}** — ${list.length}\n` : `\n  ${cat} — ${list.length}`);
    table(["item", "stuck on", "unblock"], list.map((s) => [s.item, s.stuckOn, s.unblock]));
  }

  // D1 — the 8 pairs, enumerated live.
  h(3, "D1 — the 8 unadjudicated multi-vendor pairs, enumerated");
  p("The multi-vendor audit of 2026-08-20 recorded that *\"11 products have SKUs from 2+ vendors\"*");
  p("and that *\"Lettuce and the other 8 multi-vendor products were NOT adjudicated\"*. It recorded");
  p("the COUNT. **The list itself lived in a subagent transcript that was never filed** — so no");
  p("artifact in the repo has ever said which 8. Below they are, derived live from");
  p("`vendor_items` rather than copied from anywhere, which is also a check that the count is");
  p("still 11.");
  p("");
  const multi: Array<{ name: string; rows: LiveSku[] }> = [];
  for (const [name, list] of byName) {
    const vendors = new Set(list.map((s) => s.vendorName));
    if (vendors.size >= 2) multi.push({ name, rows: list });
  }
  multi.sort((a, b) => a.name.localeCompare(b.name));
  const ADJUDICATED = new Set(["Ham", "Fresh Mozzarella"]);
  const pairRows = multi.map((m) => {
    const active = m.rows.filter((r) => r.active);
    const inactive = m.rows.filter((r) => !r.active);
    const parHolder = m.rows.find((r) => r.weekdayPar != null || r.weekendPar != null);
    const status = ADJUDICATED.has(m.name) ? "seed 18 (wave 3)" : m.name === LETTUCE_PAIR.product ? "**§B, this wave**" : "**UNADJUDICATED**";
    return [
      m.name,
      m.rows.map((r) => `${r.vendorName}${r.active ? "" : " _(inactive)_"}`).join(" · "),
      `${active.length} active / ${inactive.length} inactive`,
      parHolder ? `${parHolder.vendorName} ${parHolder.weekdayPar ?? "–"}/${parHolder.weekendPar ?? "–"}` : "**none**",
      status,
    ];
  });
  table(["product", "vendors", "state", "par held by (wkday/wkend)", "adjudication"], pairRows);
  p("");
  const stillOpen = multi.filter((m) => !ADJUDICATED.has(m.name) && m.name !== LETTUCE_PAIR.product);
  p(`**${multi.length} multi-vendor products live; ${ADJUDICATED.size} settled by seed 18, 1 settled by §B above, ${stillOpen.length} still open.**`);
  p("");
  p("**They share one shape, and that is the useful finding.** Every one of the open 8 is");
  p("Boar's Head ACTIVE and holding the par, against a Baldor row that is inactive, parless,");
  p("priceless and pinless. Not one of them looks like Ham (where both twins were live and the pins");
  p("sat on the wrong one) or like Lettuce (where the active side has no par). So these are");
  p("probably **one decision applied eight times** — most likely \"the Baldor rows are dead history,");
  p("deactivate-and-forget\" — rather than eight separate adjudications. Worth one question to Juan");
  p("rather than eight, and worth NOT guessing, because deactivating a row is the kind of thing");
  p("that is only obviously right until someone needs the second lane back.");

  // ══ SUMMARY ══════════════════════════════════════════════════════════════════
  h(2, "Summary");
  const bySection = (s: Section) => ({
    binds: bindWrites.filter((w) => w.section === s).length,
    activations: activateWrites.filter((w) => w.section === s).length,
    chains: chainWrites.filter((w) => w.section === s).length,
    prices: priceWrites.filter((w) => w.section === s).length,
  });
  const a = bySection("A"), b = bySection("B"), c = bySection("C");
  table(["", "vendor binds", "activations", "pack chains", "prices"], [
    ["**Section A — vendor bindings**", `**${a.binds}**`, `**${a.activations}**`, `**${a.chains}**`, `**${a.prices}**`],
    ["**Section B — the lettuce pair**", `**${b.binds}**`, `**${b.activations}**`, `**${b.chains}**`, `**${b.prices}**`],
    ["**Section C — herb weight policy**", `**${c.binds}**`, `**${c.activations}**`, `**${c.chains}**`, `**${c.prices}**`],
    ["Section D — report only", "0", "0", "0", "0"],
    ["**TOTAL would-write rows**", `**${bindWrites.length}**`, `**${activateWrites.length}**`, `**${chainWrites.length}**`, `**${priceWrites.length}**`],
  ], ["", "r", "r", "r", "r"]);
  p("");
  p(`\`source\` stamped on every written price row: \`${SOURCE_KEY}\``);
  p("`effective_date`: the observed invoice date, never today.");
  p("");
  p(`**Weight classes written this wave:** ${[...new Set(chainWrites.map((w) => w.weightClass))].map((k) => `\`${k}\``).join(", ") || "_(none)_"}. No \`avg_oz_per_each\` is touched anywhere in this wave, so nothing depletes differently.`);
  p("");

  p(`── REFUSALS / NO-OPS: ${refusals.length} ──`);
  const refByCode = new Map<Wave4Code, Refused[]>();
  for (const r of refusals) {
    const list = refByCode.get(r.code) ?? [];
    list.push(r);
    refByCode.set(r.code, list);
  }
  for (const [code, list] of refByCode) {
    p(MD ? `\n**${code}** — ${list.length}\n` : `\n  ${code} — ${list.length}`);
    p(MD ? `> ${WAVE4_REASONS[code]}\n` : `    ${WAVE4_REASONS[code]}`);
    for (const r of list) p(MD ? `- §${r.section} **${r.skuName}** (${r.subject}): ${r.detail}` : `      · §${r.section} ${r.skuName} (${r.subject}): ${r.detail}`);
  }

  p("");
  p("── EVERY WOULD-WRITE ROW, IN FULL ──");
  p("");
  p(`**Vendor bindings (${bindWrites.length})** — \`vendor_items.vendor_id\`, filling a NULL. Never an overwrite:`);
  p("a SKU that already carries a vendor is refused as `VENDOR_DRIFT`, because re-attributing is a");
  p("different decision from attributing.");
  p("");
  table(["§", "SKU", "vendor", "ruling"], bindWrites.map((w) => [w.section, w.skuName, w.vendorName, w.ruling]));
  p("");
  p(`**Activations (${activateWrites.length})** — \`vendor_items.active\`, false -> true, guarded on the row still reading inactive.`);
  p("");
  table(["§", "SKU", "vendor", "role", "why"], activateWrites.map((w) => [w.section, w.skuName, w.vendorName, w.role, w.evidence]));
  p("");
  p(`**Pack chains (${chainWrites.length})** — supersede-as-a-SET, then flat fields derived through the same`);
  p("pure function the admin lib's sync-on-save uses. Never an in-place UPDATE, never a DELETE.");
  p("");
  table(["§", "SKU", "vendor", "class", "before", "after"],
    chainWrites.map((w) => [w.section, w.skuName, w.vendorName, `\`${w.weightClass}\``, `\`${w.beforeDescriptor}\``, `\`${w.afterDescriptor}\``]));
  p("");
  p("⚠ **One deliberate non-change inside the chain sync.** `deriveFlatFieldsFromChain` derives");
  p("`pack_format` from the chain's ROOT LABEL, and on three of these SKUs the stored `pack_format`");
  p("already disagrees with that label (`Parsley` stores `Each (no case)` against a `container`");
  p("root; `Basil` and `Thyme` store `Case` against a lower-case `case`). Letting the sync run");
  p("would silently rename a display field this wave was not asked to touch, so the stored value is");
  p("**preserved** where one exists. The pre-existing desync is flagged rather than fixed — it");
  p("belongs to whoever owns that mirror, not to a weight-policy wave.");
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
    p("Seed 21 done (dry run).");
    return;
  }

  await execute(sb);
}

// ── The write path ─────────────────────────────────────────────────────────────

async function execute(sb: ReturnType<typeof getServiceRoleClient>): Promise<void> {
  p("\n── writing ──");

  // 1) Vendor bindings. Fill a NULL; never overwrite.
  for (const w of bindWrites) {
    const { data: cur, error: cErr } = await sb
      .from("vendor_items").select("id, name, vendor_id, active").eq("id", w.skuId)
      .maybeSingle<{ id: string; name: string; vendor_id: string | null; active: boolean }>();
    if (cErr) throw new Error(`re-read ${w.skuName}: ${cErr.message}`);
    if (!cur) throw new Error(`FATAL: ${w.skuName} [${w.skuId}] disappeared between the dry run and the write`);
    if (cur.name !== w.skuName) throw new Error(`FATAL: ${w.skuId} is now named "${cur.name}", expected "${w.skuName}" — refusing to bind the wrong SKU`);
    if (cur.vendor_id === w.vendorId) { p(`  = bind ${w.skuName}: already ${w.vendorName} — skipping`); continue; }
    if (cur.vendor_id != null) {
      throw new Error(`FATAL: ${w.skuName} now carries vendor ${cur.vendor_id}; the plan was written against a NULL vendor. Refusing (re-run the dry run).`);
    }

    const { error: uErr, count } = await sb
      .from("vendor_items")
      .update({ vendor_id: w.vendorId, updated_at: new Date().toISOString(), updated_by: null }, { count: "exact" })
      .eq("id", w.skuId).is("vendor_id", null);
    if (uErr) throw new Error(`bind ${w.skuName}: ${uErr.message}`);
    if (!count) throw new Error(`bind ${w.skuName}: UPDATE affected 0 rows (silent RLS denial, or the vendor slot filled under us?)`);
    p(`  + bind ${w.skuName} -> ${w.vendorName}`);
    void audit({
      actorId: null, actorRole: null,
      action: "vendor_item.update", resourceTable: "vendor_items", resourceId: w.skuId,
      metadata: {
        name: w.skuName, vendor: w.vendorName,
        phase: "angel_data_arc", reason: `angel_wave4_section_${w.section.toLowerCase()}_vendor_bind`,
        script: SCRIPT, source_report: SOURCE_REPORTS,
        ...w.metadata,
      },
      ipAddress: null, userAgent: null,
    });
  }

  // 2) Activations. Guarded on the row still reading inactive (seed 18's shape).
  for (const w of activateWrites) {
    const { data: cur, error: cErr } = await sb
      .from("vendor_items").select("id, name, active").eq("id", w.skuId)
      .maybeSingle<{ id: string; name: string; active: boolean }>();
    if (cErr) throw new Error(`re-read ${w.skuName}: ${cErr.message}`);
    if (!cur) throw new Error(`FATAL: ${w.skuName} [${w.skuId}] disappeared`);
    if (cur.name !== w.skuName) throw new Error(`FATAL: ${w.skuId} is now named "${cur.name}" — refusing`);
    if (cur.active) { p(`  = activate ${w.vendorName}/${w.skuName}: already active — skipping`); continue; }

    const { error: uErr, count } = await sb
      .from("vendor_items")
      .update({ active: true, updated_at: new Date().toISOString(), updated_by: null }, { count: "exact" })
      .eq("id", w.skuId).eq("active", false);
    if (uErr) throw new Error(`activate ${w.skuName}: ${uErr.message}`);
    if (!count) throw new Error(`activate ${w.skuName}: UPDATE affected 0 rows (silent RLS denial?)`);
    p(`  + activate ${w.vendorName}/${w.skuName} (${w.role})`);
    void audit({
      actorId: null, actorRole: null,
      action: "vendor_item.activate", resourceTable: "vendor_items", resourceId: w.skuId,
      metadata: {
        name: w.skuName, vendor: w.vendorName, role: w.role, evidence: w.evidence,
        phase: "angel_data_arc", reason: `angel_wave4_section_${w.section.toLowerCase()}_twin_backup_activate`,
        script: SCRIPT, source_report: SOURCE_REPORTS,
        ...w.metadata,
      },
      ipAddress: null, userAgent: null,
    });
  }

  // 3) Pack chains. Supersede-as-a-SET, exactly replaceSkuPackChain's semantics.
  for (const w of chainWrites) {
    const { data: cur, error: cErr } = await sb
      .from("vendor_items").select("id, name, active, pack_format").eq("id", w.skuId)
      .maybeSingle<{ id: string; name: string; active: boolean; pack_format: string | null }>();
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
    // pack_format is PRESERVED where the row already carries one — see the dry-run
    // note. The derived value comes from the root label and would silently rename a
    // display field this wave was not asked to change.
    const { error: fErr } = await sb.from("vendor_items").update({
      pack_format: w.preservePackFormat ?? flat.packFormat ?? "Each (no case)",
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
        flat_synced: { ...flat, packFormat: w.preservePackFormat ?? flat.packFormat },
        pack_format_preserved: w.preservePackFormat != null && w.preservePackFormat !== flat.packFormat,
        weight_class: w.weightClass, source_note: w.sourceNote, evidence: w.evidence,
        phase: "angel_data_arc", reason: `angel_wave4_section_${w.section.toLowerCase()}_pack`,
        script: SCRIPT, source_report: SOURCE_REPORTS,
        ...w.metadata,
      },
      ipAddress: null, userAgent: null,
    });
  }

  // 4) Prices — append-only, idempotent on (vendor_item_id, source, effective_date).
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
        phase: "angel_data_arc", reason: `angel_wave4_section_${w.section.toLowerCase()}_price`,
        script: SCRIPT, source_report: SOURCE_REPORTS,
        ...w.metadata,
      },
      ipAddress: null, userAgent: null,
    });
  }
  p(`\n  ✓ ${bindWrites.length} bind(s), ${activateWrites.length} activation(s), ${chainWrites.length} chain(s), ${written} price(s) written, ${skipped} price(s) skipped.`);

  // 5) Read the post-state back FROM THE DESTINATION.
  p("\n── post-state (read back from the destination) ──");
  const touched = [...new Set([...bindWrites, ...activateWrites, ...chainWrites, ...priceWrites].map((w) => w.skuId))];
  const { data: after, error: aErr } = await sb
    .from("vendor_items")
    .select("id, name, active, pack_format, units_per_pack, each_size, each_measure, avg_oz_per_each, vendors(name)")
    .in("id", touched)
    .returns<Array<{
      id: string; name: string; active: boolean; pack_format: string | null;
      units_per_pack: number | null; each_size: number | string | null; each_measure: string | null;
      avg_oz_per_each: number | string | null; vendors: { name: string } | null;
    }>>();
  if (aErr) throw new Error(`read back: ${aErr.message}`);
  const chainsAfter = await loadSkuPackChains(touched);
  for (const r of after ?? []) {
    const ch = chainsAfter.get(r.id) ?? [];
    p(`  ${r.vendors?.name ?? "(no vendor)"}/${r.name}: active=${r.active} pack=${r.pack_format ?? "-"} ${r.units_per_pack ?? "-"}x${r.each_size ?? "-"}${r.each_measure ?? ""} avg_oz=${r.avg_oz_per_each ?? "NULL"} chain=[${ch.map((l) => `${l.label}=${l.containsQty}${l.containsMeasureUnit ?? "→level"}`).join(" / ")}]`);
  }

  p("\nSeed 21 done (execute).");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
