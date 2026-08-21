/**
 * Seed 28 — WAVE 5: Juan's shop-floor tub readings, 2026-08-21.
 *
 * Juan, from the shop: "Garlic powder tub is 6 LB, oregano tub is 6 LB, garlic tub
 * is 5 LB, crushed red pepper tub is 4 LB, whole black pepper is 5.75 LB — those
 * are all the tubs I see."
 *
 * ── WHY THIS RUN EXISTS ──────────────────────────────────────────────────────
 * Every Angel wave ended at the same wall: a pack string is not a weighing. Wave 3
 * §C wrote the oregano and onion-powder jugs at their NOMINAL 5 lb, cost-neutral
 * and explicitly pending a scale, and named the unblock in one line — "one tub on
 * a scale. The same 90 seconds settles all four members of the 1.20x cluster."
 * This is that 90 seconds arriving, three tubs wider than anyone asked for.
 *
 * ── WHAT IT DOES, IN ONE PARAGRAPH ───────────────────────────────────────────
 * Resolves each spoken tub to exactly one live SKU (ambiguity is a refusal, never
 * a guess), re-derives Angel's own figures from the purchase history at run time,
 * and routes each row through `disposeTub`. Two rows get a first pack. One row is
 * the scale gate closing. One row agrees with what we already have. One row —
 * garlic — CONTRADICTS a weight a scale produced, and is presented in full rather
 * than written, because an INVOICE_DERIVED average of seven deliveries is not
 * something a seed gets to overwrite on a reading whose provenance is still an
 * open question.
 *
 * ── THE EVIDENCE CLASS IS ONE CONSTANT ───────────────────────────────────────
 * Whether these readings are SPEC (he read the tubs' printed weights) or
 * OPERATIONAL (he weighed them) is unanswered at authoring time. It is a single
 * `--evidence-class` flag defaulting to the conservative SPEC, so his one-word
 * answer is a one-constant fill and never a re-derivation. See
 * `EVIDENCE_CLASS_QUESTION` in lib/tub-weights.ts.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
 *   - It writes no PRICES. Two SKUs become priceable the moment they have a
 *     denominator, and the arithmetic is done for both — but a tub reading is
 *     evidence about a WEIGHT, and binding a price is a separate approval. They
 *     go in a decision table, the wave-3 §E1 pattern.
 *   - It does not touch `avg_oz_per_each` or `vendor_items.weight_class` on any
 *     row. That column describes the EACH weight (garlic's 0.17 oz/clove), not a
 *     pack's contents; wave 4 stamped pack weight classes into AUDIT METADATA and
 *     this run does the same. Writing a pack's class into a column that answers a
 *     different question is how one column came to mean two things the first time.
 *   - It does not touch onion powder, which Juan did not name.
 *
 * ── DRY RUN IS THE DEFAULT ───────────────────────────────────────────────────
 * Running with no arguments WRITES NOTHING.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local \
 *        scripts/seed/28-tub-weights.ts                        -> DRY RUN
 *      ... 28-tub-weights.ts --markdown > docs/seed/source/tub-weights-dryrun.md
 *      ... 28-tub-weights.ts --evidence-class OPERATIONAL      -> DRY RUN, his answer applied
 *      ... 28-tub-weights.ts --execute                         -> WRITES (lead-gated)
 *
 * NOTE on --conditions=react-server: lib/supabase-server.ts carries `import
 * "server-only"`; under plain tsx that resolves to its throwing entry point and
 * the seed dies on import. The react-server condition resolves it to the stub.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { loadMeasures, loadSkuPackChains, loadRecipeGraph } from "@/lib/prep-consumption";
import { firstLabelMeasureCollision, type PackChainLevel } from "@/lib/pack-chain-shared";
import { deriveFlatFieldsFromChain } from "@/lib/admin/catalog-shared";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph } from "@/lib/admin/menu-costing";
import { composeMenuCostRows, type MenuCostInput } from "@/lib/menu-costing-shared";
import { parsePurchaseHistory, purchaseRowKey, invoiceAverageLbs } from "@/lib/angel-wave4";
import { costPerOz } from "@/lib/angel-wave3";
import {
  JUAN_TUB_READING,
  JUAN_CLARIFICATIONS,
  EVIDENCE_CLASS_QUESTION,
  EVIDENCE_CLASS_ANSWER,
  EVIDENCE_CLASS_BASIS,
  resolveEvidenceClass,
  classifyReadingAgainstPackString,
  READING_AGREEMENT_MEANING,
  measuredSpreadFraction,
  TUB_READINGS,
  STRAY_SHELF_OBSERVATIONS,
  GARLIC_REATTRIBUTION,
  BILLED_VS_NET_NOTE_CLASS,
  billedVsNetGapOz,
  ONION_POWDER_STILL_GATED,
  disposeTub,
  DISPOSITION_MEANING,
  tubPackOz,
  packRecostEffect,
  WAVE5_REASONS,
  type EvidenceClass,
  type TubDisposition,
  type TubReading,
  type Wave5Code,
} from "@/lib/tub-weights";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

/** Provenance key. Dated + named for WAVE 5, so its rows can never be confused
 *  with wave 4's `angel-wave4-2026-08-20` or wave 3's `angel-harvest2-2026-08-20`. */
const SOURCE_KEY = "juan-tub-readings-2026-08-21";
const HISTORY_CSV = "docs/angel-purchase-history.csv";
const SOURCE_REPORTS = "docs/seed/source/tub-weights-dryrun.md";
const SCRIPT = "scripts/seed/28-tub-weights.ts";
const PHASE = "angel_data_arc";

const EXECUTE = process.argv.includes("--execute");
const MD = process.argv.includes("--markdown");

/** `--evidence-class SPEC|OPERATIONAL`. Throws on anything else — never falls back. */
function readEvidenceClassFlag(): EvidenceClass {
  const i = process.argv.indexOf("--evidence-class");
  if (i === -1) return resolveEvidenceClass(null);
  return resolveEvidenceClass(process.argv[i + 1] ?? null);
}
const EVIDENCE_CLASS: EvidenceClass = readEvidenceClassFlag();
const EVIDENCE_CLASS_EXPLICIT = process.argv.includes("--evidence-class");

const money = (n: number) => `$${n.toFixed(2)}`;
/** Per-OUNCE money. Cents are far too coarse — the whole point of a pack move is
 *  a change in the fourth decimal place of this number. */
const money4 = (n: number) => `$${n.toFixed(4)}`;
const pct = (f: number) => `${f >= 0 ? "+" : ""}${(f * 100).toFixed(1)}%`;
const pct2 = (f: number) => `${f >= 0 ? "+" : ""}${(f * 100).toFixed(2)}%`;
const round = (v: number, dp = 4) => Number(v.toFixed(dp));

function h(level: number, text: string): void {
  console.log(
    MD
      ? `\n${"#".repeat(level)} ${text}\n`
      : `\n${"─".repeat(3)} ${text.toUpperCase()} ${"─".repeat(Math.max(3, 66 - text.length))}\n`,
  );
}
function p(text = ""): void {
  console.log(text);
}

function table(head: string[], rows: string[][], align: string[] = []): void {
  if (rows.length === 0) {
    p(MD ? "_(none)_" : "  (none)");
    return;
  }
  if (MD) {
    // A bare `|` inside a cell silently shears the row into the wrong columns, and
    // pack descriptors legitimately contain one.
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
  vendorName: string;
  active: boolean;
  packFormat: string | null;
  unitsPerPack: number | null;
  eachSize: number | null;
  eachMeasure: string | null;
  avgOzPerEach: number | null;
  weightClass: string | null;
  productId: string | null;
  /** Denominated in OUR PACKS — which is why the pack GRAIN is load-bearing. */
  weekdayPar: number | null;
  weekendPar: number | null;
  chain: PackChainLevel[];
}

/** A chain level in the index-linked shape `deriveFlatFieldsFromChain` consumes. */
interface StarterLevel {
  label: string;
  containsQty: number;
  containsIndex: number | null;
  containsMeasureUnit: string | null;
}

const oneLevelChain = (label: string, qtyOz: number): StarterLevel[] => [
  { label, containsQty: qtyOz, containsIndex: null, containsMeasureUnit: "oz" },
];

interface ChainWrite {
  skuId: string;
  skuName: string;
  vendorName: string;
  levels: StarterLevel[];
  preservePackFormat: string | null;
  beforeDescriptor: string;
  afterDescriptor: string;
  contentOz: number;
  sourceNote: string;
  metadata: Record<string, unknown>;
}

interface PriceDecision {
  skuName: string;
  vendorName: string;
  angelRow: string;
  packOz: number;
  /** Angel's purchase-unit price, before any divisor. */
  casePriceUsd: number;
  /** Angel units per OUR pack — 1 where our pack IS the Angel unit. */
  divisor: number;
  unitPriceUsd: number;
  effectiveDate: string;
  costPerOzUsd: number;
  arithmetic: string;
  caveat: string;
}

interface Refused {
  skuName: string;
  subject: string;
  code: Wave5Code;
  detail: string;
}

const chainWrites: ChainWrite[] = [];
const priceDecisions: PriceDecision[] = [];
const refusals: Refused[] = [];

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  if (!MD) {
    p(
      EXECUTE
        ? "══ EXECUTE MODE — this run WRITES to vendor_items / sku_pack_levels ══"
        : "══ DRY RUN (default) — no writes. Pass --execute only on the lead's word. ══",
    );
  }

  // ── Sources ────────────────────────────────────────────────────────────────
  const history = parsePurchaseHistory(readFileSync(resolve(process.cwd(), HISTORY_CSV), "utf8"));
  if (history.length === 0) {
    throw new Error(`FATAL: ${HISTORY_CSV} parsed empty — every Angel figure below would be an assertion with nothing behind it.`);
  }
  const historyByKey = new Map<string, typeof history>();
  for (const r of history) {
    const k = purchaseRowKey(r);
    const list = historyByKey.get(k) ?? [];
    list.push(r);
    historyByKey.set(k, list);
  }

  const measures = await loadMeasures();
  const measureLabels = new Set(measures.keys());

  const { data: skuRows, error: sErr, count: skuCount } = await sb
    .from("vendor_items")
    .select(
      "id, name, active, pack_format, units_per_pack, each_size, each_measure, avg_oz_per_each, weight_class, product_id, weekday_par, weekend_par, vendors(name)",
      { count: "exact" },
    )
    .is("location_id", null)
    .returns<Array<{
      id: string; name: string; active: boolean;
      pack_format: string | null; units_per_pack: number | null;
      each_size: number | string | null; each_measure: string | null;
      avg_oz_per_each: number | string | null; weight_class: string | null;
      product_id: string | null;
      weekday_par: number | string | null; weekend_par: number | string | null;
      vendors: { name: string } | null;
    }>>();
  if (sErr) throw new Error(`load vendor_items: ${sErr.message}`);
  if (skuCount != null && (skuRows?.length ?? 0) < skuCount) {
    throw new Error(`vendor_items truncated: got ${skuRows?.length} of ${skuCount} — raise the page size before trusting this run`);
  }

  const chains = await loadSkuPackChains((skuRows ?? []).map((r) => r.id));
  const skus: LiveSku[] = (skuRows ?? []).map((r) => ({
    id: r.id, name: r.name, vendorName: r.vendors?.name ?? "(no vendor)", active: r.active,
    packFormat: r.pack_format, unitsPerPack: r.units_per_pack,
    eachSize: num(r.each_size), eachMeasure: r.each_measure,
    avgOzPerEach: num(r.avg_oz_per_each), weightClass: r.weight_class,
    productId: r.product_id,
    weekdayPar: num(r.weekday_par), weekendPar: num(r.weekend_par),
    chain: chains.get(r.id) ?? [],
  }));
  const byName = new Map<string, LiveSku[]>();
  for (const s of skus) {
    const list = byName.get(s.name) ?? [];
    list.push(s);
    byName.set(s.name, list);
  }

  /** Exactly one live ACTIVE global row, or a refusal. Never a guess between twins. */
  function resolveSku(name: string, expectVendor: string): { sku: LiveSku } | { code: Wave5Code; error: string } {
    const all = (byName.get(name) ?? []).filter((s) => s.active);
    if (all.length === 0) return { code: "SKU_UNRESOLVED", error: `no ACTIVE global SKU named "${name}"` };
    const hits = all.filter((s) => s.vendorName === expectVendor);
    if (hits.length === 1) return { sku: hits[0]! };
    if (hits.length === 0) {
      return { code: "VENDOR_DRIFT", error: `"${name}" exists (${all.length} active row(s)) but none under vendor "${expectVendor}" — found: ${all.map((s) => s.vendorName).join(", ")}` };
    }
    return { code: "SKU_UNRESOLVED", error: `${hits.length} active global SKUs named "${name}" under "${expectVendor}" — refusing to guess which tub he meant` };
  }

  /** Total ounces a single-terminal chain resolves to, or null when it does not. */
  function chainContentOz(chain: PackChainLevel[]): number | null {
    if (chain.length === 0) return null;
    let total = 1;
    for (const lvl of chain) {
      const qty = num(lvl.containsQty);
      if (qty == null) return null;
      total *= qty;
      if (lvl.containsMeasureUnit != null) {
        return lvl.containsMeasureUnit === "oz" ? total : null;
      }
    }
    return null;
  }

  const describeChain = (s: LiveSku) =>
    s.chain.length === 0
      ? `(no chain) flat ${s.packFormat ?? "-"} ${s.unitsPerPack ?? "-"}x${s.eachSize ?? "-"}${s.eachMeasure ?? ""}`
      : s.chain.map((l) => `${l.label}=${l.containsQty}${l.containsMeasureUnit ?? "→level"}`).join(" / ");

  const describeLevels = (levels: StarterLevel[]) =>
    levels.map((l) => `${l.label}=${l.containsQty}${l.containsMeasureUnit ?? `→${levels[l.containsIndex!]?.label ?? "?"}`}`).join(" / ");

  /** The newest pack-chain audit row's weight_class — the pack's PROVENANCE, which
   *  is what decides WRITE versus CONFLICT. Read live, never assumed. */
  async function livePackClass(skuId: string): Promise<string | null> {
    const { data, error } = await sb
      .from("audit_log")
      .select("occurred_at, metadata")
      .eq("action", "sku.pack_chain_update")
      .eq("resource_id", skuId)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .returns<Array<{ occurred_at: string; metadata: Record<string, unknown> | null }>>();
    if (error) throw new Error(`pack provenance for ${skuId}: ${error.message}`);
    const cls = data?.[0]?.metadata?.weight_class;
    return typeof cls === "string" ? cls : null;
  }

  async function loadPins(skuId: string): Promise<Array<{ recipeName: string; quantity: number; unit: string | null }>> {
    const { data, error } = await sb
      .from("recipe_inputs")
      .select("quantity, unit, recipes(name, active)")
      .eq("component_sku_id", skuId)
      .returns<Array<{ quantity: number | string; unit: string | null; recipes: { name: string; active: boolean } | null }>>();
    if (error) throw new Error(`load pins for ${skuId}: ${error.message}`);
    return (data ?? [])
      .filter((r) => r.recipes?.active !== false)
      .map((r) => ({ recipeName: r.recipes?.name ?? "(recipe)", quantity: num(r.quantity) ?? Number.NaN, unit: r.unit }))
      .sort((a, b) => a.recipeName.localeCompare(b.recipeName));
  }

  // ══ HEADER ═══════════════════════════════════════════════════════════════════
  if (MD) {
    p("# Wave 5 — Juan's tub readings (DRY RUN)\n");
    p("**Status: NOTHING HAS BEEN WRITTEN.** This is the output of");
    p("`scripts/seed/28-tub-weights.ts` in its default (dry-run) mode. The script writes only");
    p("under an explicit `--execute` flag, and that flag is not used until the lead says so.");
    p("");
    p(`**Generated:** 2026-08-21, against \`${HISTORY_CSV}\` and live prod (\`bgcvurheqzylyfehqgzh\`).`);
    p("Every SKU id, vendor, pack chain, recipe pin, price and audit provenance below was");
    p("resolved live at run time; every Angel figure was re-derived from the purchase history");
    p("rather than quoted from a previous wave's document.");
    p("");
    p("---");
  }

  h(2, "The reading, and the two answers that followed it");
  p(`> ${JUAN_TUB_READING}`);
  p("");
  p("Two follow-up questions went back to him, and both are answered:");
  p("");
  p(`> ${JUAN_CLARIFICATIONS.evidenceClass}`);
  p("");
  p(`> ${JUAN_CLARIFICATIONS.garlicReattribution}`);
  p("");
  p(
    `**Evidence class: \`${EVIDENCE_CLASS}\`** ` +
      (EVIDENCE_CLASS_EXPLICIT ? "(set explicitly via `--evidence-class`)." : "(the default, which is now also the RULING)."),
  );
  p("");
  p(`_The question, as it was asked:_ ${EVIDENCE_CLASS_QUESTION}`);
  p("");
  p(`**The answer:** ${EVIDENCE_CLASS_ANSWER}`);
  p("");
  p(`Basis stamped on every row this run writes: _${EVIDENCE_CLASS_BASIS[EVIDENCE_CLASS]}_`);
  p("");
  p(
    "**The class stayed ONE CONSTANT and that is why the answer cost nothing.** The first dry run " +
      "defaulted to the conservative side, he said \"it's the label\", and SPEC is what the " +
      "conservative side already was — so not one row's class moved. Had he said \"scale\", the same " +
      "single flag would have moved all of them. That is what the parameter bought.",
  );

  // ══ READ THIS FIRST ══════════════════════════════════════════════════════════
  h(2, "Read this first — the four things that matter");
  p(
    "1. **The scale gate closes on oregano.** Wave 3 wrote the jug at its catalog string's " +
      "nominal 5 lb and waited for a scale. The tub's own label says 6 LB — agreeing with " +
      "Angel's MEASURED 6.001 and contradicting PFG's CATALOG, which are two different " +
      "documents. The jug really is a 6 lb jug and the catalog is the stale side.",
  );
  p(
    "2. **THE GARLIC CONFLICT DISSOLVED — it was a garlic POWDER tub.** The first dry run built " +
      "a tare hypothesis, a beef-base precedent and a drain-and-weigh test around \"garlic tub " +
      "is 5 LB\" contradicting wave 4's 95.94 oz. None of it was needed: Juan was looking at " +
      "garlic powder. `Garlic` keeps 95.94 oz, INVOICE_DERIVED, untouched — nothing was " +
      "overturned, because there was never a reading about it. Section C.",
  );
  p(
    "3. **Two SKUs get their first denominator ever.** `Garlic Powder` and `Black peppercorn` " +
      "have carried no pack of any kind, which is why neither has ever had a price and why " +
      "black pepper blocks menu items it appears in. Section B counts exactly how many, computed " +
      "through the production costing engine rather than asserted.",
  );
  p(
    "4. **Two suspicions the brief raised are answered by the data, both negative.** The 5.75 is " +
      "NOT a scale tell — McCormick's pack string is literally `1/5.75LB`. And oregano's " +
      "agreement with the invoice was NOT evidence of a scale — the first dry run inferred that " +
      "and Juan's \"it's the label\" retracted it. Every row here is SPEC.",
  );

  // ══ SECTION A — the five tubs ════════════════════════════════════════════════
  h(2, "Section A — the five tubs, resolved live");

  interface Row {
    reading: TubReading;
    sku: LiveSku | null;
    liveOz: number | null;
    liveClass: string | null;
    readingOz: number;
    disposition: TubDisposition;
    livePrice: number | null;
    pins: Array<{ recipeName: string; quantity: number; unit: string | null }>;
  }
  const rows: Row[] = [];

  for (const reading of TUB_READINGS) {
    const readingOz = tubPackOz(reading.lbs);
    const res = resolveSku(reading.skuName, reading.vendor);
    if ("code" in res) {
      refusals.push({ skuName: reading.skuName, subject: "pack", code: res.code, detail: res.error });
      rows.push({ reading, sku: null, liveOz: null, liveClass: null, readingOz, disposition: "NO_MATCHING_SKU", livePrice: null, pins: [] });
      continue;
    }
    const sku = res.sku;
    const liveOz = chainContentOz(sku.chain);
    const liveClass = await livePackClass(sku.id);
    const prices = await loadCurrentSkuPrices([sku.id]);
    rows.push({
      reading, sku, liveOz, liveClass, readingOz,
      disposition: disposeTub({ skuFound: true, readingOz, livePackOz: liveOz, livePackClass: liveClass }),
      livePrice: prices.get(sku.id) ?? null,
      pins: await loadPins(sku.id),
    });
  }

  p("Each spoken tub, the SKU it resolves to, and what happens to it. `agreement` answers one");
  p("question — which documented number does the reading equal — and only `measurement` is");
  p("informative; see the note under the table.");
  p("");
  table(
    ["Juan said", "our SKU", "vendor", "match", "reading", "live pack", "pack provenance", "agreement", "disposition"],
    rows.map((r) => [
      `"${r.reading.spoken}"`,
      r.sku ? `\`${r.sku.name}\`` : `\`${r.reading.skuName}\` **(unresolved)**`,
      r.sku?.vendorName ?? "—",
      r.reading.nameMatch === "VERBATIM" ? "verbatim" : "**synonym**",
      `**${r.readingOz} oz**`,
      r.liveOz == null ? "**(none)**" : `${r.liveOz} oz`,
      r.liveClass ?? "_(unclassed)_",
      classifyReadingAgainstPackString(r.reading.lbs, r.reading.angel).toLowerCase().replace(/_/g, " "),
      `**${r.disposition.replace(/_/g, " ").toLowerCase()}**`,
    ]),
    ["", "", "", "", "r", "r", "", "", ""],
  );
  p("");
  p(
    "**Read the `agreement` column asymmetrically.** A reading that equals the vendor's pack " +
      "string is consistent with a label read AND with a scale that confirmed the label, so it " +
      "distinguishes nothing. A reading that equals the MEASUREMENT while contradicting the pack " +
      "string could not have come from that pack string. Exactly one row does that:",
  );
  p("");
  table(
    ["our SKU", "reading", "Angel pack string", "Angel measured", "n", "spread", "agreement"],
    rows
      .filter((r) => r.reading.angel != null)
      .map((r) => {
        const a = r.reading.angel!;
        const perInner = a.measured.meanLbs / Math.max(1, a.unitsPerAngelUnit);
        return [
          `\`${r.reading.skuName}\``,
          `${r.reading.lbs} lb`,
          `\`${a.packString}\` → ${a.packStringLbs} lb`,
          `${round(perInner, 4)} lb`,
          String(a.measured.lines),
          a.measured.lines < 2 ? "_(n=1)_" : pct2(measuredSpreadFraction(a)),
          classifyReadingAgainstPackString(r.reading.lbs, a).toLowerCase().replace(/_/g, " "),
        ];
      }),
    ["", "r", "", "r", "r", "r", ""],
  );
  p("");
  p(
    `_${READING_AGREEMENT_MEANING.MATCHES_MEASUREMENT}_ Oregano is that row: 6 against a measured ` +
      "6.001 lb, and against a pack string that says 5.",
  );
  p("");
  p("Chili Flake has no Angel row at all, in the catalog or in 441 invoice lines, so it is absent");
  p("from the table above by construction rather than by omission.");

  // ── A1: matching, stated rather than assumed ───────────────────────────────
  h(3, "A1 — how each tub was matched, including the two that are not verbatim");
  table(
    ["Juan's phrase", "our SKU", "basis"],
    TUB_READINGS.map((t) => [
      `"${t.spoken}"`,
      `\`${t.skuName}\``,
      t.nameMatch === "VERBATIM" ? "his phrase IS the SKU name" : t.matchEvidence,
    ]),
  );
  p("");
  p(
    "**Ambiguity is a refusal.** `resolveSku` requires exactly one ACTIVE global row under the " +
      "named vendor; zero rows, a vendor mismatch or two twins all stop the row rather than " +
      "picking. Every one of the five resolved cleanly this run.",
  );

  // ══ SECTION B — the writes ═══════════════════════════════════════════════════
  h(2, "Section B — what would be written");

  for (const r of rows) {
    if (r.sku == null) continue;
    const { reading, sku, liveOz, readingOz } = r;

    // The pack SHAPE we asserted must still be what is live. A drift stops the row
    // rather than flattening whatever is there — wave 4's discipline.
    const expected = reading.expectedLivePackOz;
    if ((expected == null) !== (liveOz == null) || (expected != null && liveOz != null && Math.abs(expected - liveOz) > 1e-9)) {
      refusals.push({
        skuName: sku.name, subject: "pack", code: "PACK_SHAPE_CHANGED",
        detail: `the plan asserts a live pack of ${expected == null ? "(none)" : `${expected} oz`}; production carries ${liveOz == null ? "(none)" : `${liveOz} oz`} (${describeChain(sku)}) — re-derive rather than flatten`,
      });
      continue;
    }
    if ((reading.expectedLivePackClass ?? null) !== (r.liveClass ?? null)) {
      refusals.push({
        skuName: sku.name, subject: "pack", code: "PACK_CLASS_DRIFT",
        detail: `the plan asserts the live pack's provenance is ${reading.expectedLivePackClass ?? "(unclassed)"}; the newest sku.pack_chain_update audit row says ${r.liveClass ?? "(unclassed)"} — the WRITE-versus-CONFLICT decision was made against the wrong evidence`,
      });
      continue;
    }

    if (r.disposition === "CONFIRMS_LIVE") {
      refusals.push({
        skuName: sku.name, subject: "pack", code: "ALREADY_CORRECT",
        detail: `live pack is already ${liveOz} oz and the reading is ${readingOz} oz — a corroboration, and there is nothing to write`,
      });
      continue;
    }
    if (r.disposition === "CONFLICT_PRESENT_ONLY") {
      refusals.push({
        skuName: sku.name, subject: "pack", code: "MEASURED_CONFLICT",
        detail: `reading ${readingOz} oz against a live ${liveOz} oz whose class is ${r.liveClass} (a scale produced it) — see section C`,
      });
      continue;
    }

    // ── The write ────────────────────────────────────────────────────────────
    const angel = reading.angel;
    /**
     * ONE LEVEL, AT THE TUB, ON EVERY ROW — INCLUDING THE ONE ANGEL SELLS BY THE CASE.
     *
     * Garlic powder is `3/6 LB`, so a case-grain chain (3 x 96 oz = 288 oz) was
     * the tempting shape: it would let the $210.84 case price in with no divisor.
     * It is the wrong shape, and the reason is a column this script does not
     * write: **`weekday_par`.**
     *
     * A par is denominated in OUR PACKS, and this SKU already carries 0.25. Every
     * sibling in the spice family is packed at ONE TUB — oregano's 0.25 is a
     * quarter jug, chili flake's 1.00 is one tub, garlic's 0.75 is one tub — so
     * 0.25 here plainly means a quarter tub. Writing a case-grain pack would
     * silently redefine that existing number as three quarters of a tub, a 3x
     * change to an ordering quantity, without touching the column or leaving an
     * audit row that mentions it. Pars are SUPPRESSED but never MUTATED
     * (AGENTS.md); re-denominating one underneath is worse than mutating it,
     * because the number still reads the same.
     *
     * The cost of choosing the tub is that a case price needs a divisor of 3 —
     * and that divisor is exactly what section D's decision table exists to get
     * one approval for, rather than something this run performs silently.
     */
    const levels = oneLevelChain(sku.chain[0]?.label ?? sku.packFormat ?? "tub", readingOz);

    const collision = firstLabelMeasureCollision(levels.map((l) => l.label), measureLabels);
    if (collision != null) {
      throw new Error(
        `FATAL: chain label "${collision}" IS an active measure_units label — it would shadow that ` +
          "measure in the chain-first ozForRecipeInput walk. Aborting (no writes).",
      );
    }
    const flat = deriveFlatFieldsFromChain(levels);
    const contentOz = readingOz;

    // Angel's own measured weight, re-derived HERE from the purchase history rather
    // than quoted, so a CSV that moved under the plan fails loudly.
    let angelLive = "";
    let billedGapOz: number | null = null;
    if (angel != null) {
      const key = purchaseRowKey({ product: angel.product, brand: angel.brand, vendor: angel.vendor, packSize: angel.packString });
      const lines = historyByKey.get(key) ?? [];
      const avg = invoiceAverageLbs(lines);
      if (avg == null) {
        refusals.push({
          skuName: sku.name, subject: "pack", code: "PACK_SHAPE_CHANGED",
          detail: `no measured invoice lines for \`${angel.product}\` [${angel.brand}] ${angel.packString} in ${HISTORY_CSV} — the plan's Angel figures cannot be re-derived`,
        });
        continue;
      }
      if (Math.abs(avg.meanLbs - angel.measured.meanLbs) > 0.01) {
        refusals.push({
          skuName: sku.name, subject: "pack", code: "PACK_SHAPE_CHANGED",
          detail: `the plan asserts an Angel mean of ${angel.measured.meanLbs} lb; the history now computes ${round(avg.meanLbs, 4)} lb over ${avg.lines} line(s) — the CSV moved under the plan`,
        });
        continue;
      }
      // Per INNER unit, so a `3/6 LB` case's 19.872 lb is compared against our TUB
      // rather than against a case. Comparing across grains would manufacture a
      // 3x "gap" and report a units mismatch as a tare finding.
      const measuredPerInnerOz = round((avg.meanLbs / Math.max(1, angel.unitsPerAngelUnit)) * 16, 2);
      billedGapOz = billedVsNetGapOz(measuredPerInnerOz, contentOz);
      angelLive =
        `Angel's own \`${angel.product}\` [${angel.brand}] ${angel.packString}: ${avg.lines} invoice line(s), ` +
        `mean ${round(avg.meanLbs, 4)} lb per purchase unit` +
        (angel.unitsPerAngelUnit > 1 ? ` (= ${round(avg.meanLbs / angel.unitsPerAngelUnit, 4)} lb per ${angel.unitsPerAngelUnit}-to-the-case inner unit)` : "") +
        ` = ${measuredPerInnerOz} oz against this pack's ${contentOz} oz (${pct((measuredPerInnerOz - contentOz) / contentOz)}). ` +
        (billedGapOz != null && Math.abs(billedGapOz) > 0.01
          ? `That excess is REPORTED, not used: ${BILLED_VS_NET_NOTE_CLASS} `
          : "");
    }

    const effect = packRecostEffect({ packOzBefore: liveOz, packOzAfter: contentOz, unitPriceUsd: r.livePrice });
    const sourceNote =
      `${EVIDENCE_CLASS} pack weight from Juan's 2026-08-21 shop-floor tub reading. ${JUAN_TUB_READING} ` +
      `This row: "${reading.spoken}" = ${reading.lbs} lb = ${readingOz} oz` +
      (angel != null && angel.unitsPerAngelUnit > 1
        ? ` per TUB, which is the pack grain written here even though Angel sells ${angel.unitsPerAngelUnit} tubs to the case: this SKU already carries a par of ${sku.weekdayPar ?? "?"} denominated in OUR packs, every sibling spice is packed at one tub, and a case-grain pack would silently re-read that par as ${angel.unitsPerAngelUnit}x what it says. The consequence is that a case price needs a divisor of ${angel.unitsPerAngelUnit}, which is deliberately left to a separate approval rather than performed here.`
        : ".") +
      ` Evidence class basis: ${EVIDENCE_CLASS_BASIS[EVIDENCE_CLASS]} ` +
      (angelLive ? angelLive : "Angel carries no row for this product at all, so this reading is the ONLY evidence that exists for the pack. ") +
      (liveOz == null
        ? "The SKU carried NO pack of any kind before this — no pack_format, no units, no each_size — which is why it has never been priceable. "
        : `Supersedes the live ${liveOz} oz. `) +
      `avg_oz_per_each and vendor_items.weight_class are NOT touched: that column describes the EACH weight, not a pack's contents.`;

    chainWrites.push({
      skuId: sku.id, skuName: sku.name, vendorName: sku.vendorName,
      levels, preservePackFormat: sku.packFormat,
      beforeDescriptor: describeChain(sku),
      afterDescriptor: `${describeLevels(levels)} | flat ${flat.packFormat} ${flat.unitsPerPack}x${flat.eachSize}${flat.eachMeasure}`,
      contentOz,
      sourceNote,
      metadata: {
        weight_class: EVIDENCE_CLASS,
        evidence_class_explicit: EVIDENCE_CLASS_EXPLICIT,
        evidence_class_basis: EVIDENCE_CLASS_BASIS[EVIDENCE_CLASS],
        evidence_class_question: EVIDENCE_CLASS_QUESTION,
        reading_verbatim: reading.spoken,
        reading_lbs: reading.lbs,
        reading_oz: readingOz,
        ruling: JUAN_TUB_READING,
        disposition: r.disposition,
        name_match: reading.nameMatch,
        name_match_evidence: reading.matchEvidence || null,
        angel_product: angel?.product ?? null,
        angel_pack_string: angel?.packString ?? null,
        angel_measured_lbs_per_unit: angel?.measured.meanLbs ?? null,
        reading_agreement: classifyReadingAgainstPackString(reading.lbs, angel),
        billed_vs_net_gap_oz: billedGapOz,
        billed_vs_net_note_class: billedGapOz != null && Math.abs(billedGapOz) > 0.01 ? BILLED_VS_NET_NOTE_CLASS : null,
        before_pack_oz: liveOz,
        after_pack_oz: contentOz,
        unit_price_unchanged: true,
        cost_per_oz_before: effect.costPerOzBefore == null ? null : round(effect.costPerOzBefore, 6),
        cost_per_oz_after: effect.costPerOzAfter == null ? null : round(effect.costPerOzAfter, 6),
        source: SOURCE_KEY,
      },
    });
  }

  // ── B1 — the pack table ────────────────────────────────────────────────────
  h(3, "B1 — pack chains");
  p("── WOULD WRITE ──");
  table(
    ["our SKU", "vendor", "before", "after", "chain", "par (packs)", "unit price", "$/oz before", "$/oz after", "$/oz change"],
    chainWrites.map((w) => {
      const r = rows.find((x) => x.sku?.id === w.skuId)!;
      const e = packRecostEffect({ packOzBefore: r.liveOz, packOzAfter: w.contentOz, unitPriceUsd: r.livePrice });
      return [
        `\`${w.skuName}\``, w.vendorName,
        r.liveOz == null ? "**(no pack)**" : `${r.liveOz} oz`,
        `**${w.contentOz} oz**`,
        `\`${describeLevels(w.levels)}\``,
        r.sku?.weekdayPar == null ? "—" : String(r.sku.weekdayPar),
        r.livePrice == null ? "_(unpriced)_" : money(r.livePrice),
        e.costPerOzBefore == null ? "—" : money4(e.costPerOzBefore),
        e.costPerOzAfter == null ? "—" : `**${money4(e.costPerOzAfter)}**`,
        e.costPerOzChange == null ? "_(no basis)_" : `**${pct(e.costPerOzChange)}**`,
      ];
    }),
    ["", "", "r", "r", "", "r", "r", "r", "r", "r"],
  );
  p("");
  p(
    "**Every pack is written at the TUB, and on garlic powder that is a deliberate choice with a " +
      "reason in the `par` column.** Angel sells garlic powder `3/6 LB`, so a case-grain chain " +
      "(3 x 96 = 288 oz) was available and would have let its $210.84 case price in with no " +
      "divisor. It is the wrong grain: a par is denominated in OUR PACKS, this SKU already " +
      "carries **0.25**, and every sibling in the spice family is packed at one tub — oregano's " +
      "0.25 is a quarter jug, chili flake's 1.00 is one tub, garlic's 0.75 is one tub. A " +
      "case-grain pack would silently re-read that existing 0.25 as three quarters of a tub — a " +
      "3x change to an ordering quantity, with the column untouched and nothing in the audit row " +
      "mentioning it. Pars are suppressed but never mutated (AGENTS.md); re-denominating one " +
      "underneath is worse, because the number still reads the same. The cost is that garlic " +
      "powder's case price now needs a divisor of 3, which is exactly what section D asks one " +
      "approval for.",
  );
  p("");
  p(
    "**No price row is written on any of these, and on oregano that is a deliberate departure " +
      "from wave 3.** Wave 3 §C moved a DIVISOR — our pack went from a quarter of a jug to a " +
      "whole jug — so the price of one of OUR packs genuinely changed and a superseding price " +
      "row was mandatory. Wave 5 changes what a pack CONTAINS while the pack stays the same " +
      "physical object: one oregano jug cost $55.27 before and one costs $55.27 after. " +
      "`unit_price` is the price of one of our packs, so it does not move; only the derived " +
      "$/oz does. Appending a price row here would assert a change nobody made.",
  );

  // ── B2 — recipes that re-cost ──────────────────────────────────────────────
  h(3, "B2 — what re-costs, read live");
  const recostRows: string[][] = [];
  for (const w of chainWrites) {
    const r = rows.find((x) => x.sku?.id === w.skuId)!;
    const e = packRecostEffect({ packOzBefore: r.liveOz, packOzAfter: w.contentOz, unitPriceUsd: r.livePrice });
    recostRows.push([
      `\`${w.skuName}\``,
      String(r.pins.length),
      e.costPerOzChange == null ? "**nothing re-costs** (unpriced — the pack is the denominator it has been waiting for)" : `**${pct(e.costPerOzChange)}** on every line below`,
      r.pins.length === 0 ? "_(no active recipe pins)_" : r.pins.map((x) => x.recipeName).join(" · "),
    ]);
  }
  table(["SKU", "pins", "cost effect", "recipes"], recostRows, ["", "r", "", ""]);
  p("");
  p(
    "**Nothing here changes depletion.** `avg_oz_per_each` is the column a COUNT-unit recipe " +
      "line consumes, and no row in this wave touches it on any SKU — garlic's 0.17 oz/clove, " +
      "which Marinara's `4 clove` pin resolves through, is untouched even in the conflict row. " +
      "Only the cost side moves.",
  );

  // ── B3 — the menu-costing effect, computed not asserted ────────────────────
  h(3, "B3 — the menu items a missing denominator is blocking");
  const graph = await loadRecipeGraph();
  const { data: menuRows, error: mErr } = await sb
    .from("menu_items")
    .select("id, name, name_es, section, menu_price")
    .eq("active", true)
    .order("name")
    .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null }>>();
  if (mErr) throw new Error(`load menu_items: ${mErr.message}`);
  const menuInputs: MenuCostInput[] = (menuRows ?? []).map((m) => ({
    id: m.id, name: m.name, nameEs: m.name_es, section: m.section, menuPrice: num(m.menu_price),
  }));
  const graphPrices = await loadCurrentSkuPrices([...graph.skuPack.keys()]);
  const boardRows = composeMenuCostRows(menuInputs, graph, costPerOzFromGraph(graph, graphPrices));

  const watched = rows.filter((r) => r.sku != null).map((r) => r.sku!);
  const blockRows: string[][] = [];
  for (const s of watched) {
    const blocked = boardRows.filter((br) => br.rollup.unpricedSkuIds.includes(s.id));
    blockRows.push([
      `\`${s.name}\``,
      s.chain.length === 0 ? "**no pack**" : `${chainContentOz(s.chain) ?? "?"} oz`,
      (graphPrices.get(s.id) ?? null) == null ? "**no price**" : money(graphPrices.get(s.id)!),
      String(blocked.length),
      blocked.length === 0 ? "—" : blocked.map((b) => b.name).join(" · "),
    ]);
  }
  p("Computed HERE through the production costing engine — `loadRecipeGraph` +");
  p("`costPerOzFromGraph` + `composeMenuCostRows`, the same three calls `loadMenuCostingBoard`");
  p("makes — against live prices. A count, not a claim.");
  p("");
  table(["SKU", "pack today", "price today", "menu items blocked", "which"], blockRows, ["", "r", "r", "r", ""]);
  p("");
  p(
    "**A pack is the denominator, not the price.** `costPerOzFromGraph` returns null when a SKU " +
      "has no price OR no resolvable content ounces, and the board cannot tell the two apart — " +
      "so writing a pack does NOT clear a row on its own. What it does is remove the reason the " +
      "price could never be written: a price against a SKU with no pack is exactly how " +
      "`PICKLES CHIPS` became $35.95/lb. Section D does that arithmetic and stops short of the " +
      "write.",
  );

  // ══ SECTION C — the reattribution ════════════════════════════════════════════
  h(2, "Section C — the garlic conflict DISSOLVED (reattribution)");
  p(`> ${GARLIC_REATTRIBUTION.clarification}`);
  p("");
  p(
    "The first dry run presented a CONFLICT here: \"garlic tub is 5 LB\" against wave 4's " +
      "INVOICE_DERIVED 95.94 oz, with a brine-tare hypothesis, a beef-base precedent and a " +
      "drain-and-weigh test to settle it. **None of it was needed. He was looking at a garlic " +
      "POWDER tub.**",
  );
  p("");
  p(`**${GARLIC_REATTRIBUTION.dissolvedNotResolved}**`);
  p("");

  // Read the peeled-garlic row back live, so "untouched" is a verified claim.
  const { data: garlicLive, error: gErr } = await sb
    .from("vendor_items")
    .select("id, name, each_size, each_measure, vendors(name)")
    .eq("name", GARLIC_REATTRIBUTION.reattributedFrom)
    .eq("active", true)
    .returns<Array<{ id: string; name: string; each_size: number | string | null; each_measure: string | null; vendors: { name: string } | null }>>();
  if (gErr) throw new Error(`garlic read-back: ${gErr.message}`);
  const garlicPfg = (garlicLive ?? []).find((g) => g.vendors?.name === "PFG");
  const garlicOz = num(garlicPfg?.each_size ?? null);

  table(
    ["", "value"],
    [
      ["reattributed FROM", `\`${GARLIC_REATTRIBUTION.reattributedFrom}\` (peeled garlic, PFG)`],
      ["reattributed TO", `\`${GARLIC_REATTRIBUTION.reattributedTo}\``],
      ["`Garlic` pack, live in prod right now", garlicOz == null ? "?" : `**${garlicOz} oz** — unchanged`],
      ["`Garlic` class", `${GARLIC_REATTRIBUTION.garlicLiveClass} — unchanged`],
      ["rows this wave writes against `Garlic`", "**0**"],
    ],
  );
  p("");
  p(
    "Note what did NOT happen: no ruling was overturned, no evidence was re-weighed, and wave 4's " +
      "§C reasoning is exactly as sound today as it was yesterday. A conflict that dissolves is " +
      "not a conflict that was decided.",
  );
  p("");
  h(3, "C1 — what survives, and it is worth more than the conflict was");
  p(
    "**The note class.** `BILLED_VS_NET` was minted to describe this conflict and it outlives it — " +
      "a real phenomenon with a real precedent already in the repo, waiting for the next brine- " +
      "or ice-packed row:",
  );
  p("");
  p(`> ${BILLED_VS_NET_NOTE_CLASS}`);
  p("");
  p(
    "**And an OPEN QUESTION that never depended on the reading in the first place.** " +
      `${GARLIC_REATTRIBUTION.openQuestionSurviving}`,
  );
  p("");
  p(
    "It is recorded rather than closed because this wave has no evidence bearing on it in either " +
      "direction. It is not a wave-5 finding; it is a wave-4 tension wave 5 happened to walk past.",
  );
  p("");
  h(3, "C2 — the lesson");
  p(
    "The first dry run built a careful argument — two hypotheses, a repo precedent, a cheap " +
      "decisive test — on top of one unverified assumption: that \"garlic\" meant the `Garlic` " +
      "SKU. Every step above that assumption was sound and every one of them was irrelevant. " +
      "**That is exactly why the row was PRESENTED rather than written**, and it is the argument " +
      "for the `CONFLICT_PRESENT_ONLY` disposition surviving in the code even though nothing " +
      "exercises it this run.",
  );

  // ══ SECTION D — decision tables ══════════════════════════════════════════════
  h(2, "Section D — decisions this script will not make");

  // D1 — prices now derivable
  for (const w of chainWrites) {
    const reading = TUB_READINGS.find((t) => t.skuName === w.skuName)!;
    const r = rows.find((x) => x.sku?.id === w.skuId)!;
    if (reading.angel == null || r.livePrice != null) continue;
    // Our pack is the TUB. Where Angel sells N tubs to the case, the case price
    // divides by N — and that divisor is the reason this is a decision and not a
    // write. It comes from the pack string, corroborated by Juan's own reading of
    // the inner unit, which is a stronger position than wave 2's divisors ever
    // had — but it is still a divisor, and wave 2's lesson was that a divisor
    // nobody has approved is how a price lands 3x wrong and looks fine.
    const divisor = reading.angel.unitsPerAngelUnit;
    const unitPrice = Number((reading.angel.latestUnitPriceUsd / divisor).toFixed(2));
    const cpo = costPerOz(unitPrice, w.contentOz);
    if (cpo == null) continue;
    const thin = reading.angel.measured.lines < 2;
    priceDecisions.push({
      skuName: w.skuName,
      vendorName: w.vendorName,
      angelRow: `\`${reading.angel.product}\` [${reading.angel.brand}] ${reading.angel.packString}`,
      packOz: w.contentOz,
      casePriceUsd: reading.angel.latestUnitPriceUsd,
      divisor,
      unitPriceUsd: unitPrice,
      effectiveDate: reading.angel.latestSeen,
      costPerOzUsd: cpo,
      arithmetic:
        divisor === 1
          ? `${money(reading.angel.latestUnitPriceUsd)} per \`${reading.angel.packString}\` unit / 1 (our pack IS one Angel unit) = ${money(unitPrice)} → ${money4(cpo)}/oz at ${w.contentOz} oz`
          : `${money(reading.angel.latestUnitPriceUsd)} per case / **${divisor}** tubs to the case = ${money(unitPrice)} per tub → ${money4(cpo)}/oz at ${w.contentOz} oz`,
      caveat:
        (divisor > 1
          ? `⚠ NEEDS A DIVISOR of ${divisor}, taken from the pack string \`${reading.angel.packString}\` — whose inner unit Juan's own reading independently confirms. `
          : "") +
        (thin
          ? "⚠ ONE invoice line. A price of record from a single observation is thin, and this one has never been seen twice."
          : `${reading.angel.measured.lines} invoice lines, latest ${reading.angel.latestSeen}.`),
    });
    refusals.push({
      skuName: w.skuName, subject: "price", code: "PRICE_NEEDS_APPROVAL",
      detail: `${money(reading.angel.latestUnitPriceUsd)} per Angel unit${divisor > 1 ? ` / ${divisor}` : ""} / our ${w.contentOz} oz pack = ${money4(cpo)}/oz — derivable now, but a tub reading is evidence about a WEIGHT`,
    });
  }

  h(3, "D1 — two SKUs become priceable the moment they have a pack");
  p("Both have carried no price ever, because neither had a denominator to hang one on. The");
  p("arithmetic is done; the write is not, because binding a price is a different approval from");
  p("recording a weight. This is wave 3 §E1's pattern: approve the row and the price follows in");
  p("one step.");
  p("");
  table(
    ["our SKU", "Angel row", "our pack", "arithmetic", "unit_price to write", "effective", "→ $/oz", "caveat"],
    priceDecisions.map((d) => [
      `\`${d.skuName}\``, d.angelRow, `${d.packOz} oz`, d.arithmetic,
      `**${money(d.unitPriceUsd)}**`, d.effectiveDate,
      `**${money4(d.costPerOzUsd)}**`, d.caveat,
    ]),
    ["", "", "r", "", "r", "", "r", ""],
  );
  p("");
  p(
    "**A note on the census.** `docs/seed/source/angel-reconciliation-report.md` §E.2 lists " +
      "`Garlic Powder` among nine PFG SKUs \"absent from the Angel export\". That is true of the " +
      "CATALOG export and false of the purchase history, which carries a `GARLIC PWDR` invoice " +
      "line. The two are different harvest artifacts and the census only ever read the first. " +
      "`Chili Flake` IS genuinely absent from both — no crushed-red-pepper row exists anywhere in " +
      "Angel — so its half of that list stands.",
  );

  // D2 — the stray shelf observation the reattribution created
  h(3, "D2 — the second garlic powder tub (unresolved, recorded, not written)");
  p(
    "The reattribution left `Garlic Powder` with TWO sighted tubs. Only one can be the pack, and " +
      "6 lb is the one with two documents behind it — the tub's own label and Angel's `3/6 LB` " +
      "catalog string agree. The 5 lb sighting matches neither that string nor the invoice's " +
      "6.624 lb per tub.",
  );
  p("");
  table(
    ["Juan said", "SKU", "reading", "agreement", "status"],
    STRAY_SHELF_OBSERVATIONS.map((s) => {
      const reading = TUB_READINGS.find((t) => t.skuName === s.skuName);
      return [
        `"${s.spoken}"`,
        `\`${s.skuName}\``,
        `${s.lbs} lb (${tubPackOz(s.lbs)} oz)`,
        classifyReadingAgainstPackString(s.lbs, reading?.angel ?? null).toLowerCase().replace(/_/g, " "),
        "**UNRESOLVED — not written**",
      ];
    }),
    ["", "", "r", "", ""],
  );
  p("");
  for (const s of STRAY_SHELF_OBSERVATIONS) {
    p(`**Why it is not written:** ${s.whyNotWritten}`);
    p("");
    p(`**Unblock:** ${s.unblock}`);
    p("");
  }
  p(
    "**The third option is the honest one.** Inventing a second pack level from one ambiguous " +
      "sighting would put a number under every garlic-powder recipe on the strength of a glance; " +
      "discarding it would lose the only evidence anyone has that a second tub exists. A named " +
      "unresolved observation keeps the fact without spending it.",
  );
  refusals.push({
    skuName: "Garlic Powder", subject: "second pack", code: "UNRESOLVED_SIGHTING",
    detail: `a second tub was sighted at 5 lb; the 6 lb tub is written because label and catalog string agree on it, and 5 lb matches neither`,
  });

  // D3 — onion powder
  h(3, "D3 — onion powder: the half of the gate that stays shut");
  refusals.push({
    skuName: ONION_POWDER_STILL_GATED.skuName, subject: "pack", code: "NOT_IN_READING",
    detail: `Juan named five tubs and onion powder was not one of them; its live ${ONION_POWDER_STILL_GATED.livePackOz} oz stands`,
  });
  table(
    ["field", "value"],
    [
      ["live pack", `${ONION_POWDER_STILL_GATED.livePackOz} oz (wave 3 §C nominal)`],
      ["would be", `${ONION_POWDER_STILL_GATED.wouldBeOz} oz, if the cluster argument were acted on`],
      ["Angel pack string", `\`${ONION_POWDER_STILL_GATED.angelPackString}\``],
      ["Angel measured", `${ONION_POWDER_STILL_GATED.angelMeasuredLbs} lb (n=1, Jul 31)`],
      ["unblock", ONION_POWDER_STILL_GATED.unblock],
    ],
  );
  p("");
  p(`**Why it is not inferred:** ${ONION_POWDER_STILL_GATED.whyNotInferred}`);
  p("");
  p(
    "**And a question to put back to Juan.** His \"those are all the tubs I see\" is a " +
      "completeness claim about what was VISIBLE on the floor, not an inventory. Onion powder's " +
      "absence from the list reads as *not observed*, never as *does not exist* — and its single " +
      "invoice line is from Jul 31, which is consistent with a tub that has since been used up. " +
      "One question closes both halves of the gate: **is there an onion powder tub out there, " +
      "and what does it say?**",
  );

  // D3 — tubs with no SKU
  h(3, "D4 — tubs with no matching SKU");
  const unmatched = rows.filter((r) => r.sku == null);
  table(
    ["Juan said", "asserted SKU", "why it did not resolve"],
    unmatched.map((r) => [
      `"${r.reading.spoken}"`,
      `\`${r.reading.skuName}\` @ ${r.reading.vendor}`,
      refusals.find((x) => x.skuName === r.reading.skuName)?.detail ?? "—",
    ]),
  );
  if (unmatched.length === 0) {
    p("");
    p(`All ${rows.length} readings resolved to exactly one active PFG SKU each. The table is empty, and`);
    p("that is the finding: nothing Juan is looking at is missing from our catalog.");
  }

  // ══ REFUSALS ═════════════════════════════════════════════════════════════════
  h(2, "Everything this run did NOT do, and why");
  table(
    ["our SKU", "subject", "code", "detail"],
    refusals.map((r) => [`\`${r.skuName}\``, r.subject, `\`${r.code}\``, r.detail]),
  );
  p("");
  table(
    ["code", "what it means"],
    [...new Set(refusals.map((r) => r.code))].map((c) => [`\`${c}\``, WAVE5_REASONS[c]]),
  );

  // ══ SUMMARY ══════════════════════════════════════════════════════════════════
  h(2, "Summary");
  table(
    ["", "pack chains", "weights", "prices"],
    [
      ["**Section B — first packs + the oregano resolution**", `**${chainWrites.length}**`, "0", "0"],
      ["Section C — garlic reattribution", "0 _(conflict dissolved)_", "0", "0"],
      ["Section D — decision tables only", "0", "0", `0 _(${priceDecisions.length} proposed)_`],
      ["**TOTAL would-write rows**", `**${chainWrites.length}**`, "**0**", "**0**"],
    ],
    ["", "r", "r", "r"],
  );
  p("");
  p(`\`source\` stamped in the audit metadata of every written row: \`${SOURCE_KEY}\``);
  p(
    `\`weight_class\` stamped in that same metadata: \`${EVIDENCE_CLASS}\`` +
      (EVIDENCE_CLASS_EXPLICIT ? " (set explicitly)" : " — Juan's ruling (\"it's the label\"), which the default already matched"),
  );
  p("");
  p(
    "**Where the weight class does and does not go.** It rides in the `sku.pack_chain_update` " +
      "audit metadata, exactly as wave 4 wrote it, and `vendor_items.weight_class` is NOT " +
      "touched on any row. That column describes the EACH weight — garlic's 0.17 oz/clove, " +
      "classed `ESTIMATE` by seed 26 — and a pack's contents are a different number. Writing " +
      "one into the other is how a single column came to mean two things the first time, which " +
      "is the defect wave 3's spec-versus-operational split exists to repair.",
  );
  p("");
  table(
    ["disposition", "what it means", "rows"],
    (Object.keys(DISPOSITION_MEANING) as TubDisposition[]).map((d) => [
      `\`${d}\``, DISPOSITION_MEANING[d], String(rows.filter((r) => r.disposition === d).length),
    ]),
    ["", "", "r"],
  );

  if (!EXECUTE) {
    p("");
    p("**NOTHING HAS BEEN WRITTEN.** Re-run with `--execute` only on the lead's word.");
    return;
  }

  // ══ WRITE ════════════════════════════════════════════════════════════════════
  h(2, "EXECUTING");
  for (const w of chainWrites) {
    // Re-read at write time: the same invariant seeds 26 and 27 hold. A row that
    // moved between the dry run and now stops the write rather than taking it.
    const { data: cur, error: cErr } = await sb
      .from("vendor_items").select("id, name, active, pack_format").eq("id", w.skuId)
      .maybeSingle<{ id: string; name: string; active: boolean; pack_format: string | null }>();
    if (cErr) throw new Error(`re-read ${w.skuName}: ${cErr.message}`);
    if (!cur) throw new Error(`FATAL: ${w.skuName} [${w.skuId}] disappeared between the dry run and the write`);
    if (cur.name !== w.skuName) {
      throw new Error(`FATAL: ${w.skuId} is now named "${cur.name}", expected "${w.skuName}" — refusing to rewrite the wrong SKU's pack chain`);
    }

    const { error: deErr } = await sb.from("sku_pack_levels").update({ active: false }).eq("sku_id", w.skuId).eq("active", true);
    if (deErr) throw new Error(`deactivate ${w.skuName} chain: ${deErr.message}`);

    const now = new Date().toISOString();
    const ids = w.levels.map(() => randomUUID());
    const levelRows = w.levels.map((lvl, i) => ({
      id: ids[i]!, sku_id: w.skuId, label: lvl.label, contains_qty: lvl.containsQty,
      contains_level_id: lvl.containsIndex != null ? ids[lvl.containsIndex]! : null,
      contains_measure_unit: lvl.containsIndex != null ? null : lvl.containsMeasureUnit,
      display_ordinal: i, effective_from: now, active: true, created_by: null,
    }));
    const { error: insErr } = await sb.from("sku_pack_levels").insert(levelRows);
    if (insErr) throw new Error(`insert ${w.skuName} chain: ${insErr.message}`);

    const flat = deriveFlatFieldsFromChain(w.levels);
    // pack_format is PRESERVED where the row already carries one — the derived value
    // comes from the root label and would silently rename a display field this wave
    // was not asked to change.
    const { error: fErr } = await sb.from("vendor_items").update({
      pack_format: w.preservePackFormat ?? flat.packFormat ?? "Each (no case)",
      units_per_pack: flat.unitsPerPack, each_size: flat.eachSize, each_measure: flat.eachMeasure,
      updated_at: now, updated_by: null,
    }).eq("id", w.skuId);
    if (fErr) throw new Error(`sync ${w.skuName} flat fields: ${fErr.message}`);

    p(`  + chain ${w.vendorName}/${w.skuName}: ${w.beforeDescriptor}  ->  ${w.afterDescriptor}`);
    await audit({
      actorId: null, actorRole: null,
      action: "sku.pack_chain_update", resourceTable: "sku_pack_levels", resourceId: w.skuId,
      metadata: {
        name: w.skuName, vendor: w.vendorName, level_count: levelRows.length,
        labels: levelRows.map((r) => r.label),
        before: w.beforeDescriptor, after: w.afterDescriptor,
        flat_synced: { ...flat, packFormat: w.preservePackFormat ?? flat.packFormat },
        pack_format_preserved: w.preservePackFormat != null && w.preservePackFormat !== flat.packFormat,
        source_note: w.sourceNote,
        phase: PHASE, reason: "wave5_tub_reading_pack",
        script: SCRIPT, source_report: SOURCE_REPORTS,
        actor_context: "seed",
        ...w.metadata,
      },
      ipAddress: null, userAgent: null,
    });
  }
  p(`\n  ✓ ${chainWrites.length} chain(s) written. 0 weights, 0 prices — by design.`);

  // Read the post-state back FROM THE DESTINATION.
  p("\n── post-state (read back from the destination) ──");
  const touched = chainWrites.map((w) => w.skuId);
  const { data: after, error: aErr } = await sb
    .from("vendor_items")
    .select("id, name, pack_format, units_per_pack, each_size, each_measure, avg_oz_per_each, weight_class, vendors(name)")
    .in("id", touched)
    .returns<Array<{
      id: string; name: string; pack_format: string | null; units_per_pack: number | null;
      each_size: number | string | null; each_measure: string | null;
      avg_oz_per_each: number | string | null; weight_class: string | null; vendors: { name: string } | null;
    }>>();
  if (aErr) throw new Error(`read back: ${aErr.message}`);
  const chainsAfter = await loadSkuPackChains(touched);
  for (const r of after ?? []) {
    const ch = chainsAfter.get(r.id) ?? [];
    p(
      `  ${r.vendors?.name ?? "(no vendor)"}/${r.name}: pack=${r.pack_format ?? "-"} ` +
        `${r.units_per_pack ?? "-"}x${r.each_size ?? "-"}${r.each_measure ?? ""} ` +
        `avg_oz=${r.avg_oz_per_each ?? "NULL"} weight_class=${r.weight_class ?? "NULL"} ` +
        `chain=[${ch.map((l) => `${l.label}=${l.containsQty}${l.containsMeasureUnit ?? "→level"}`).join(" / ")}]`,
    );
  }

  p("\nSeed 28 done (execute).");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
