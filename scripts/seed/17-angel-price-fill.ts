/**
 * Seed 17 — Angel catalog → vendor_price_history price fill (reports W1 + W2).
 *
 * The price spine currently holds ONE row (Banana Peppers $20.00), and the report
 * shows even that one is smoke-test residue two independent sources put nearer $8.
 * So this is not a correction pass — it is the first real price data the system
 * would ever hold, and every number it writes is a DERIVED estimate from a
 * third-party catalog rather than an invoice fact. That is exactly why migration
 * 0177 added `source` / `source_note`: each row carries the Angel row it came from
 * and the arithmetic that produced it.
 *
 * ── DRY RUN IS THE DEFAULT, AND THE GATE IS A HUMAN ───────────────────────────
 * Running this script with no arguments WRITES NOTHING. It prints the full
 * would-write table and exits. Writing requires the explicit `--execute` flag, and
 * per the arc's terms that flag is not to be used until Juan has eyeballed the
 * dry-run output. The report's W2 says it plainly: every divided fill must be
 * eyeballed, because the divisor encodes an assumption about what our pack IS.
 *
 * All arithmetic and classification live in lib/angel-price-fill.ts (pure, unit
 * tested). This file is the I/O shell: read the CSV, resolve SKU names to live ids,
 * print, and — only under --execute — append.
 *
 * ── WHAT IT REFUSES ───────────────────────────────────────────────────────────
 * Delmar's entire lane (no pack denominator anywhere), the exporter's own
 * HIGH_PPL_REVIEW rows, US Foods historical rows, one unresolved product identity,
 * and any SKU quoted by two surviving rows at different prices. Reasons are printed
 * per row — a refusal is a finding, not a silence. See the module header for why
 * each one matters.
 *
 * Idempotency: `vendor_price_history` is APPEND-ONLY, so a second --execute run
 * would append a SECOND set of rows rather than update. To keep re-runs safe the
 * script checks for an existing row with the same (vendor_item_id, source,
 * effective_date) and skips it. History stays sacred; duplicates are not created.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/17-angel-price-fill.ts
 *        → DRY RUN (default). Prints the table, writes nothing.
 *      npx tsx --conditions=react-server --env-file=.env.local scripts/seed/17-angel-price-fill.ts --execute
 *        → WRITES. Requires Juan's eyeball on the dry-run first.
 *      …--dry-run --markdown   → dry-run table as markdown (used to author the report doc)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import {
  parseAngelCatalog, classify, buildSourceNote,
  type FillCandidate, type Refusal, type RefusalCode,
} from "@/lib/angel-price-fill";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The provenance key written to vendor_price_history.source. Dated: a later export
 *  gets its own key so the two can never be confused for one another. */
const SOURCE_KEY = "angel-catalog-2026-08";

/** effective_date for every filled row = the date of the Angel export these prices
 *  were observed in. NOT today's date — the price was true as of the export, and
 *  post-dating it would overstate how fresh the number is. */
const ANGEL_EXPORT_DATE = "2026-08-14";

const CSV_PATH = "docs/seed/source/angel-product-catalog.csv";

const EXECUTE = process.argv.includes("--execute");
const MARKDOWN = process.argv.includes("--markdown");

function money(n: number): string { return `$${n.toFixed(2)}`; }

interface ResolvedFill extends FillCandidate { skuId: string }

function printPlainTable(fills: ResolvedFill[]): void {
  const head = ["our SKU", "Angel product", "case $", "÷", "unit price", "flag"];
  const rows = fills.map((f) => [
    f.rule.skuName,
    `${f.rule.product} [${f.rule.brand || "—"}] ${f.rule.packSizeRaw}`,
    money(f.casePriceUsd),
    String(f.rule.divisor),
    money(f.unitPrice),
    f.rule.relation === "PACK_AGREES" ? "PACK-AGREES" : `CASE-MULTIPLE${f.rounded ? " · rounded" : ""}`,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(line(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}

function printMarkdownTable(fills: ResolvedFill[]): void {
  console.log("| our SKU | Angel product | case $ | ÷ | unit price | flag |");
  console.log("|---|---|---:|---:|---:|---|");
  for (const f of fills) {
    const flag = f.rule.relation === "PACK_AGREES" ? "PACK-AGREES" : `CASE-MULTIPLE${f.rounded ? " · rounded" : ""}`;
    console.log(`| ${f.rule.skuName} | \`${f.rule.product}\` [${f.rule.brand || "—"}] ${f.rule.packSizeRaw} | ${money(f.casePriceUsd)} | ÷${f.rule.divisor} | **${money(f.unitPrice)}** | ${flag} |`);
  }
}

function summariseRefusals(refusals: Refusal[]): Map<RefusalCode, Refusal[]> {
  const m = new Map<RefusalCode, Refusal[]>();
  for (const r of refusals) {
    const list = m.get(r.code) ?? [];
    list.push(r);
    m.set(r.code, list);
  }
  return m;
}

async function main() {
  const sb = getServiceRoleClient();

  console.log(EXECUTE
    ? "══ EXECUTE MODE — this run WRITES to vendor_price_history ══\n"
    : "══ DRY RUN (default) — no writes. Pass --execute to write (after Juan's eyeball). ══\n");

  const csvText = readFileSync(resolve(process.cwd(), CSV_PATH), "utf8");
  const rows = parseAngelCatalog(csvText);
  console.log(`Parsed ${rows.length} rows from ${CSV_PATH}.\n`);

  const { fills, refusals, notCandidates } = classify(rows);

  // Resolve SKU names → live ids. ACTIVE + GLOBAL only: recordSkuPrice's own
  // contract rejects an inactive SKU, and a location-scoped row would price only
  // one store. A name that resolves to zero or multiple SKUs is NOT guessed at —
  // it is reported and dropped, because a price on the wrong twin is invisible.
  const names = [...new Set(fills.map((f) => f.rule.skuName))];
  const { data: skuRows, error: sErr } = await sb
    .from("vendor_items").select("id, name, active, location_id, vendor_id")
    .in("name", names).eq("active", true).is("location_id", null)
    .returns<Array<{ id: string; name: string; active: boolean; location_id: string | null; vendor_id: string | null }>>();
  if (sErr) throw new Error(`resolve SKUs: ${sErr.message}`);

  const byName = new Map<string, Array<{ id: string }>>();
  for (const r of skuRows ?? []) {
    const list = byName.get(r.name) ?? [];
    list.push({ id: r.id });
    byName.set(r.name, list);
  }

  const resolved: ResolvedFill[] = [];
  const unresolved: Array<{ f: FillCandidate; why: string }> = [];
  for (const f of fills) {
    const hits = byName.get(f.rule.skuName) ?? [];
    if (hits.length === 1) resolved.push({ ...f, skuId: hits[0]!.id });
    else unresolved.push({ f, why: hits.length === 0 ? "no ACTIVE global SKU with this name" : `${hits.length} ACTIVE global SKUs share this name — ambiguous, refusing to guess` });
  }

  // ── The would-write table ────────────────────────────────────────────────────
  console.log(`── WOULD WRITE: ${resolved.length} price rows ──\n`);
  if (MARKDOWN) printMarkdownTable(resolved); else printPlainTable(resolved);
  console.log("");

  if (unresolved.length > 0) {
    console.log(`── UNRESOLVED SKU NAMES (dropped): ${unresolved.length} ──`);
    for (const u of unresolved) console.log(`  ! ${u.f.rule.skuName} ← ${u.f.rule.product}: ${u.why}`);
    console.log("");
  }

  // ── Refusals ─────────────────────────────────────────────────────────────────
  const grouped = summariseRefusals(refusals);
  console.log(`── REFUSED: ${refusals.length} rows ──`);
  for (const [code, list] of grouped) {
    const spend = list.reduce((a, r) => a + (r.row.totalSpendUsd ?? 0), 0);
    console.log(`\n  ${code} — ${list.length} row(s), ${money(spend)} spend`);
    console.log(`    ${list[0]!.reason}`);
    for (const r of list) {
      const price = r.row.casePriceUsd != null ? money(r.row.casePriceUsd) : "—";
      const target = r.rule ? ` → ${r.rule.skuName}` : "";
      console.log(`      · ${r.row.product} [${r.row.brand || "—"}] (${r.row.vendor}) case ${price}${target}`);
    }
  }

  // The report tiers 23 matched Delmar rows + 3 HIGH_PPL_REVIEW rows as
  // UNTRUSTWORTHY — the "26 refused rows". Restate that count explicitly so the
  // dry-run can be checked against the report without arithmetic.
  const delmarRefused = grouped.get("DELMAR_NO_PACK_SIZE")?.length ?? 0;
  const highPpl = grouped.get("HIGH_PPL_REVIEW")?.length ?? 0;
  console.log(`\n  (report Tier-3 cross-check: ${delmarRefused} Delmar NO_PACK_SIZE rows + ${highPpl} HIGH_PPL_REVIEW rows refused outright.)`);

  console.log(`\n── NOT CANDIDATES: ${notCandidates.length} rows ──`);
  console.log("  No entry in the report's §D.2 pack-relation tables: count/volume parse, non-food,");
  console.log("  new-SKU candidate, or a genuine pack CONFLICT awaiting adjudication (report J4).");
  console.log("  No divisor is ever inferred for these — absence means not fillable.\n");

  const fillSpend = resolved.reduce((a, f) => a + (f.row.totalSpendUsd ?? 0), 0);
  console.log("── SUMMARY ──");
  console.log(`  rows parsed:      ${rows.length}`);
  console.log(`  WOULD WRITE:      ${resolved.length}  (${money(fillSpend)} of annual spend)`);
  console.log(`  refused:          ${refusals.length}`);
  console.log(`  unresolved SKU:   ${unresolved.length}`);
  console.log(`  not candidates:   ${notCandidates.length}`);
  console.log(`  source:           ${SOURCE_KEY}`);
  console.log(`  effective_date:   ${ANGEL_EXPORT_DATE}`);

  if (!EXECUTE) {
    console.log("\n  NOTHING WAS WRITTEN. Re-run with --execute once Juan has signed off on the table above.");
    console.log("Seed 17 done (dry run).");
    return;
  }

  // ── EXECUTE ──────────────────────────────────────────────────────────────────
  console.log("\n── writing ──");
  let written = 0, skipped = 0;
  for (const f of resolved) {
    const { data: existing, error: exErr } = await sb
      .from("vendor_price_history").select("id")
      .eq("vendor_item_id", f.skuId).eq("source", SOURCE_KEY).eq("effective_date", ANGEL_EXPORT_DATE)
      .maybeSingle<{ id: string }>();
    if (exErr) throw new Error(`dup check ${f.rule.skuName}: ${exErr.message}`);
    if (existing) { skipped++; console.log(`  = ${f.rule.skuName}: already filled from ${SOURCE_KEY} — skipping`); continue; }

    const sourceNote = buildSourceNote(f);
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
        phase: "angel_data_arc", reason: "angel_reconciliation_w1_w2_price_fill",
        source_report: "docs/seed/source/angel-reconciliation-report.md §D.2 / W1 / W2",
      },
      ipAddress: null, userAgent: null,
    });
  }

  const { count: total } = await sb.from("vendor_price_history").select("id", { count: "exact", head: true });
  console.log(`\n  ✓ ${written} written, ${skipped} skipped. vendor_price_history now holds ${total} row(s).`);
  console.log("Seed 17 done (execute).");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
