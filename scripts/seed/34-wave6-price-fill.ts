/**
 * Seed 34 — Angel WAVE 6: the full price fill. 2026-08-30.
 *
 * Juan's order, 2026-08-29, verbatim:
 *   "why haven't we added the prices to the SKUs if we have all the pricing already…
 *    pricing should update from what we are receiving. But we can and should seed it
 *    since we have it basically on tap with angel spend."
 *
 * Two halves, and this file is only the first. The SEED half is below. The
 * "pricing should update from what we are receiving" half is a RECON, written up in
 * `docs/seed/source/angel-wave6-dryrun.md` § WIRING NOTE — it changes no code here,
 * because what it found is a capture-affordance gap, not a plumbing bug, and the fix
 * is a UI decision that deserves its own PR.
 *
 * ── LIVE STATE THIS WAVE ANSWERS TO (re-verified against prod at run time) ────
 * `vendor_price_history` holds 32 rows over 30 distinct SKUs, every one written by a
 * seed. **140 of 169 active SKUs have ZERO price rows.** Waves 1–4 priced the
 * high-spend core; this wave sweeps the tail and — just as importantly — NAMES the
 * errand for every row it cannot price.
 *
 * ── DRY RUN IS THE DEFAULT, AND THE GATE IS A HUMAN ──────────────────────────
 * Running this script with no arguments WRITES NOTHING. It prints the full
 * disposition and exits. Writing requires the explicit `--execute` flag, and per the
 * arc's standing terms that flag is LEAD-GATED and not used until Juan has eyeballed
 * the dry run. The divisor encodes an assumption about what our pack IS; that is
 * exactly the assumption a human has to confirm.
 *
 * ── THE FRESH-AUTHORING GUARD ────────────────────────────────────────────────
 * This seed writes a FIRST price and nothing else. Any SKU that already holds ANY
 * `vendor_price_history` row is skipped, loudly, even if it is in the rule table —
 * superseding an existing price is a different act with different authority
 * (receiving's own insert, or `recordSkuPrice` at AGM+), and a seed quietly
 * outranking a price a human recorded at the door is not a behaviour this series
 * should have. The guard is re-evaluated at run time, so a price recorded between
 * authoring and execute is respected.
 *
 * Idempotency rides on top of that: `vendor_price_history` is APPEND-ONLY, so a
 * second `--execute` would otherwise append a second set. The guard makes a re-run a
 * no-op by construction (every SKU written by run 1 now has a row), and the
 * (vendor_item_id, source, effective_date) check stays as a belt-and-braces second
 * gate for the case where the guard is ever relaxed.
 *
 * ── THE LIVE PACK CHECK IS NOT OPTIONAL ──────────────────────────────────────
 * Every rule is verified against the LIVE chain-aware `contentOzForSku` before it may
 * be written — the same derivation the cost board and the receiving ledger ride,
 * never the raw flat columns (they are a MIRROR, and a stale one is silent). A SKU
 * whose pack moved under its transcribed divisor is REFUSED at run time, because the
 * price would no longer mean what the source_note says it means.
 *
 * All arithmetic, the rule table and the refusal adjudications live in
 * lib/angel-wave6.ts (pure, unit-tested). This file is the I/O shell: read the CSV,
 * resolve names to live ids, verify packs, print, and — only under --execute — append.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local \
 *        scripts/seed/34-wave6-price-fill.ts               -> DRY RUN (default)
 *      ... --execute                                        -> WRITES (lead-gated)
 *      ... --markdown                                       -> tables as markdown (authors the report)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { loadSkuPackChains } from "@/lib/prep-consumption";
import { contentOzForSku } from "@/lib/admin/cost-shared";
import { parseAngelCatalog } from "@/lib/angel-price-fill";
import {
  resolveWave6, buildWave6SourceNote, packMatchesLive,
  wave1SkuOverlap, duplicateFillSkus, fillRefusalCollisions,
  WAVE6_REFUSALS, WAVE6_REASONS,
  type Wave6Fill, type Wave6RefusalCode,
} from "@/lib/angel-wave6";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The provenance key written to `vendor_price_history.source`. Dated, so a later
 *  export gets its own key and the two can never be confused for one another. */
const SOURCE_KEY = "angel-wave6-2026-08-29";

/** `effective_date` for every filled row = the date of the Angel export these prices
 *  were observed in — NOT today. Post-dating overstates how fresh the number is.
 *  Same date wave 1 stamped, because it is the same export file. */
const ANGEL_EXPORT_DATE = "2026-08-14";

const CSV_PATH = "docs/seed/source/angel-product-catalog.csv";

const EXECUTE = process.argv.includes("--execute");
const MARKDOWN = process.argv.includes("--markdown");

function money(n: number): string { return `$${n.toFixed(2)}`; }

interface ResolvedFill extends Wave6Fill {
  skuId: string;
  liveContentOz: number | null;
  liveUnitsPerPack: number | null;
}

async function main() {
  const sb = getServiceRoleClient();

  console.log(EXECUTE
    ? "══ EXECUTE MODE — this run WRITES to vendor_price_history ══\n"
    : "══ DRY RUN (default) — no writes. Pass --execute to write (after Juan's eyeball). ══\n");

  // ── Table integrity, before anything touches the database ──────────────────
  // These are hand-edited tables; a collision means an unresolved adjudication,
  // and finding out at INSERT time would be finding out too late.
  const overlap = wave1SkuOverlap();
  const dupes = duplicateFillSkus();
  const collisions = fillRefusalCollisions();
  if (overlap.length || dupes.length || collisions.length) {
    console.error("REFUSING TO RUN — the wave-6 tables are internally inconsistent:");
    if (overlap.length) console.error(`  · also in wave 1's DIVISION_RULES (two divisors of record): ${overlap.join(", ")}`);
    if (dupes.length) console.error(`  · listed twice in WAVE6_FILL_RULES: ${dupes.join(", ")}`);
    if (collisions.length) console.error(`  · both filled AND refused: ${collisions.join(", ")}`);
    process.exit(1);
  }

  const csvText = readFileSync(resolve(process.cwd(), CSV_PATH), "utf8");
  const rows = parseAngelCatalog(csvText);
  console.log(`Parsed ${rows.length} rows from ${CSV_PATH}.\n`);

  const { fills, unmatchedRules } = resolveWave6(rows);

  // ── Live SKU resolution ─────────────────────────────────────────────────────
  // ACTIVE + GLOBAL only, exactly as wave 1: `recordSkuPrice`'s own contract
  // rejects an inactive SKU, and a location-scoped row would price only one store.
  // A name resolving to zero or several SKUs is NOT guessed at — a price on the
  // wrong twin is invisible. (This is live-load-bearing: "Banana Peppers" exists
  // twice, an inactive Baldor row and the active Boar's Head one.)
  const names = [...new Set(fills.map((f) => f.rule.skuName))];
  const { data: skuRows, error: sErr } = await sb
    .from("vendor_items")
    .select("id, name, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("name", names).eq("active", true).is("location_id", null)
    .returns<Array<{ id: string; name: string; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  if (sErr) throw new Error(`resolve SKUs: ${sErr.message}`);

  const byName = new Map<string, typeof skuRows>();
  for (const r of skuRows ?? []) {
    const list = byName.get(r.name) ?? [];
    list.push(r);
    byName.set(r.name, list);
  }

  const { data: measures, error: mErr } = await sb.from("measure_units").select("label, dimension, to_base_factor")
    .returns<Array<{ label: string; dimension: string; to_base_factor: number | string }>>();
  if (mErr) throw new Error(`load measures: ${mErr.message}`);
  const measureMap = new Map<string, MeasureUnitFactor>(
    (measures ?? []).map((m) => [m.label, { dimension: m.dimension as MeasureUnitFactor["dimension"], toBaseFactor: Number(m.to_base_factor) }]),
  );

  const chains = await loadSkuPackChains((skuRows ?? []).map((s) => s.id));
  const num = (v: number | string | null): number | null => {
    if (v === null) return null;
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : null;
  };

  // ── Existing-price census (the fresh-authoring guard's input) ───────────────
  const { data: pricedRows, error: pErr0 } = await sb.from("vendor_price_history")
    .select("vendor_item_id").returns<Array<{ vendor_item_id: string }>>();
  if (pErr0) throw new Error(`price census: ${pErr0.message}`);
  const alreadyPriced = new Set((pricedRows ?? []).map((p) => p.vendor_item_id));

  const resolved: ResolvedFill[] = [];
  const blocked: Array<{ skuName: string; why: string }> = [];

  for (const f of fills) {
    const hits = byName.get(f.rule.skuName) ?? [];
    if (hits.length !== 1) {
      blocked.push({
        skuName: f.rule.skuName,
        why: hits.length === 0 ? "no ACTIVE global SKU with this name" : `${hits.length} ACTIVE global SKUs share this name — ambiguous, refusing to guess`,
      });
      continue;
    }
    const sku = hits[0]!;

    if (alreadyPriced.has(sku.id)) {
      blocked.push({ skuName: f.rule.skuName, why: "already holds a price row — this seed authors a FIRST price only; supersede belongs to receiving/admin" });
      continue;
    }

    const liveContentOz = contentOzForSku(
      { unitsPerPack: sku.units_per_pack, eachSize: num(sku.each_size), eachMeasure: sku.each_measure, avgOzPerEach: num(sku.avg_oz_per_each) },
      chains.get(sku.id) ?? null,
      measureMap,
    );
    const check = packMatchesLive(f.rule, { contentOz: liveContentOz, unitsPerPack: sku.units_per_pack });
    if (!check.ok) {
      blocked.push({ skuName: f.rule.skuName, why: `LIVE PACK CHECK FAILED — ${check.why}` });
      continue;
    }

    resolved.push({ ...f, skuId: sku.id, liveContentOz, liveUnitsPerPack: sku.units_per_pack });
  }

  // ── The would-write table ───────────────────────────────────────────────────
  console.log(`── WOULD WRITE: ${resolved.length} price rows ──\n`);
  if (MARKDOWN) {
    console.log("| our SKU | Angel row | case $ | ÷ | unit price | relation | 2024 cross-check |");
    console.log("|---|---|---:|---:|---:|---|---|");
    for (const f of resolved) {
      const rel = f.rule.relation + (f.rounded ? " · rounded" : "");
      console.log(`| ${f.rule.skuName} | \`${f.rule.product}\` [${f.rule.brand || "—"}] ${f.rule.packSizeRaw} | ${money(f.casePriceUsd)} | ÷${f.rule.divisor} | **${money(f.unitPrice)}** | ${rel} | ${f.rule.crossCheck2024 ?? "— none"} |`);
    }
  } else {
    for (const f of resolved) {
      console.log(`  + ${f.rule.skuName.padEnd(20)} ${money(f.unitPrice).padStart(8)}  ← ${f.rule.product} [${f.rule.brand || "—"}] ${f.rule.packSizeRaw} ${money(f.casePriceUsd)} ÷${f.rule.divisor}  [${f.rule.relation}${f.rounded ? " · rounded" : ""}]`);
      console.log(`      live pack: ${f.liveContentOz ?? `${f.liveUnitsPerPack} count`}  · ${f.rule.evidence}`);
      if (f.rule.crossCheck2024) console.log(`      2024 cross-check: ${f.rule.crossCheck2024}`);
    }
  }
  console.log("");

  if (unmatchedRules.length > 0) {
    console.log(`── RULES WITH NO CATALOG ROW: ${unmatchedRules.length} ──`);
    for (const u of unmatchedRules) console.log(`  ! ${u.rule.skuName}: ${u.why}`);
    console.log("");
  }

  if (blocked.length > 0) {
    console.log(`── BLOCKED AT RUN TIME: ${blocked.length} ──`);
    for (const b of blocked) console.log(`  ! ${b.skuName}: ${b.why}`);
    console.log("");
  }

  // ── Adjudicated refusals ────────────────────────────────────────────────────
  const grouped = new Map<Wave6RefusalCode, typeof WAVE6_REFUSALS>();
  for (const r of WAVE6_REFUSALS) {
    grouped.set(r.code, [...(grouped.get(r.code) ?? []), r]);
  }
  console.log(`── REFUSED (adjudicated, with finished arithmetic): ${WAVE6_REFUSALS.length} SKUs ──`);
  for (const [code, list] of grouped) {
    console.log(`\n  ${code} — ${list.length} SKU(s)`);
    console.log(`    ${WAVE6_REASONS[code]}`);
    for (const r of list) {
      console.log(`      · ${r.skuName}`);
      for (const c of r.candidates) console.log(`          candidate: ${c}`);
      if (r.presented) console.log(`          would be:  ${r.presented}`);
      console.log(`          open:      ${r.note}`);
    }
  }

  // ── The rest: no candidate in either source ────────────────────────────────
  const { data: allPriceless, error: apErr } = await sb
    .from("vendor_items").select("id, name, inventory_only")
    .eq("active", true).is("location_id", null)
    .returns<Array<{ id: string; name: string; inventory_only: boolean }>>();
  if (apErr) throw new Error(`priceless census: ${apErr.message}`);

  const accountedFor = new Set<string>([
    ...resolved.map((f) => f.rule.skuName),
    ...WAVE6_REFUSALS.map((r) => r.skuName),
    ...blocked.map((b) => b.skuName),
  ]);
  const priceless = (allPriceless ?? []).filter((s) => !alreadyPriced.has(s.id));
  const noSource = priceless.filter((s) => !accountedFor.has(s.name));
  const noSourceSupplyRun = noSource.filter((s) => s.inventory_only);
  const noSourceOther = noSource.filter((s) => !s.inventory_only);

  console.log(`\n── NO SOURCE: ${noSource.length} SKUs ──`);
  console.log(`  ${noSourceSupplyRun.length} SUPPLY-RUN class (inventory_only: packaging, chemicals, smallwares, office).`);
  console.log("  Angel Spend is a menu-costing service: its vendor set is PFG, US Foods, Delmar,");
  console.log("  Cardinal and Baldor. Trimark, Webstaurant, Amazon, Vistaprint and Continental Tape");
  console.log("  do not appear in it at all, and most of these SKUs carry no pack fields either, so");
  console.log("  they are blocked twice over. This is not a gap this data source can ever close.");
  console.log(`  ${noSourceOther.length} other SKUs with no row in either source.`);
  for (const s of noSourceOther) console.log(`      · ${s.name}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalActive = (allPriceless ?? []).length;
  const pricedNow = totalActive - priceless.length;

  // EVERY priceless SKU must land in exactly one bucket. If the three do not sum,
  // a refusal names a SKU that is not priceless (or not a SKU at all) and the
  // report's coverage claim would be quietly wrong — the one number Juan reads.
  const bucketed = resolved.length + WAVE6_REFUSALS.length + blocked.length + noSource.length;
  if (bucketed !== priceless.length) {
    console.error(`\nACCOUNTING FAILED: ${resolved.length} write + ${WAVE6_REFUSALS.length} refused + ${blocked.length} blocked + ${noSource.length} no-source = ${bucketed}, but ${priceless.length} SKUs are priceless.`);
    console.error("A refusal probably names a SKU that is already priced, inactive, or misspelled. Fix the table before trusting any count above.");
    process.exit(1);
  }
  console.log("\n── SUMMARY ──");
  console.log(`  active global SKUs:     ${totalActive}`);
  console.log(`  priced BEFORE this run: ${pricedNow}`);
  console.log(`  WOULD WRITE:            ${resolved.length}`);
  console.log(`  priced AFTER:           ${pricedNow + resolved.length}  (${(((pricedNow + resolved.length) / totalActive) * 100).toFixed(1)}% coverage)`);
  console.log(`  refused (adjudicated):  ${WAVE6_REFUSALS.length}`);
  console.log(`  blocked at run time:    ${blocked.length}`);
  console.log(`  no source at all:       ${noSource.length}  (${noSourceSupplyRun.length} supply-run)`);
  console.log(`  still priceless after:  ${priceless.length - resolved.length}`);
  console.log(`  source:                 ${SOURCE_KEY}`);
  console.log(`  effective_date:         ${ANGEL_EXPORT_DATE}`);

  if (!EXECUTE) {
    console.log("\n  NOTHING WAS WRITTEN. Re-run with --execute once Juan has signed off on the table above.");
    console.log("Seed 34 done (dry run).");
    return;
  }

  // ── EXECUTE ────────────────────────────────────────────────────────────────
  console.log("\n── writing ──");
  let written = 0, skipped = 0;
  for (const f of resolved) {
    const { data: existing, error: exErr } = await sb
      .from("vendor_price_history").select("id")
      .eq("vendor_item_id", f.skuId).eq("source", SOURCE_KEY).eq("effective_date", ANGEL_EXPORT_DATE)
      .maybeSingle<{ id: string }>();
    if (exErr) throw new Error(`dup check ${f.rule.skuName}: ${exErr.message}`);
    if (existing) { skipped++; console.log(`  = ${f.rule.skuName}: already filled from ${SOURCE_KEY} — skipping`); continue; }

    const sourceNote = buildWave6SourceNote(f);
    const { data: ins, error } = await sb
      .from("vendor_price_history")
      .insert({
        vendor_item_id: f.skuId,
        unit_price: f.unitPrice,
        effective_date: ANGEL_EXPORT_DATE,
        recorded_by: null,
        source: SOURCE_KEY,
        source_note: sourceNote,
      })
      .select("id").single<{ id: string }>();
    if (error) throw new Error(`insert price ${f.rule.skuName}: ${error.message}`);
    written++;
    console.log(`  + ${f.rule.skuName}: ${money(f.unitPrice)}`);

    void audit({
      actorId: null, actorRole: null,
      action: "vendor_item.price_recorded", resourceTable: "vendor_price_history", resourceId: ins.id,
      metadata: {
        vendor_item_id: f.skuId, sku_name: f.rule.skuName,
        unit_price: f.unitPrice, effective_date: ANGEL_EXPORT_DATE,
        source: SOURCE_KEY, source_note: sourceNote,
        angel_product: f.rule.product, angel_brand: f.rule.brand, angel_pack_size_raw: f.rule.packSizeRaw,
        case_price_usd: f.casePriceUsd, divisor: f.rule.divisor, relation: f.rule.relation,
        our_pack_oz: f.rule.ourPackOz, angel_case_oz: f.rule.angelCaseOz,
        our_pack_count: f.rule.ourPackCount, angel_case_count: f.rule.angelCaseCount,
        live_content_oz: f.liveContentOz, evidence: f.rule.evidence,
        cross_check_2024: f.rule.crossCheck2024,
        phase: "angel_data_arc", reason: "angel_wave6_full_price_fill",
        source_report: "docs/seed/source/angel-wave6-dryrun.md",
      },
      ipAddress: null, userAgent: null,
    });
  }

  const { count: total } = await sb.from("vendor_price_history").select("id", { count: "exact", head: true });
  console.log(`\n  ✓ ${written} written, ${skipped} skipped. vendor_price_history now holds ${total} row(s).`);
  console.log("Seed 34 done (execute).");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
