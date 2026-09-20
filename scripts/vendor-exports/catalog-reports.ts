/** Wave 4: exact offline identity joins. No DB imports, writes or inferred substitutions. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { CATALOG_FILE, loadCatalog, sourceForId, type ProdExport } from "./catalog";
import { ROOT, EXPORT_ROOT } from "./normalize";
import { recent, uniqueItems, packEqual, listMetrics, type CatalogRow, type Evidence } from "./diff-core";
import { catalogMatchCandidates, crossVendorCandidates, purchaseProxyMetrics, receiptUnitCosts, receiptPurchaseDecisions } from "./wave-reports";
import { parsePack } from "./parsers";
import type { ExportRow } from "./model";

const dir = join(EXPORT_ROOT, "reports");
export const vendorKey = (v: string | null) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const key = (vendor: string | null, item: string) => `${vendorKey(vendor)}:${item}`;
const money = (v: number | null | undefined) => v == null ? "unavailable" : `$${(v / 100).toFixed(4).replace(/(\.\d{2})0+$/, "$1")}`;
const cite = (e: Evidence) => `[${basename(e.source_file)}:${e.source_line}](${relative(dir, join(ROOT, e.source_file)).replaceAll("\\", "/")}#L${e.source_line})`;
const table = (headers: string[], rows: unknown[][]) => [
  `| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`,
  ...rows.map(r => `| ${r.map(v => String(v ?? "unavailable").replaceAll("|", "\\|").replace(/\r?\n/g, " ")).join(" | ")} |`),
].join("\n");
const evidence = (s: CatalogRow) => [...new Set([s, ...(s.pack_evidence ?? []), ...(s.price_evidence ? [s.price_evidence] : [])].map(cite))].join("; ");

export interface SeedLine extends Evidence {
  id: string; vendor: string; label: string; sku_id: string | null;
  item_number: string | null; section: string; position: number;
}
export function seedLines(data: ProdExport, text: string): SeedLine[] {
  return data.order_guide_lines.map(l => {
    const section = data.order_guide_sections.find(s => s.id === l.section_id);
    const guide = data.vendor_order_guides.find(g => g.id === section?.guide_id);
    const vendor = data.vendors.find(v => v.id === guide?.vendor_id);
    if (!section || !guide || !vendor) throw new Error(`Broken guide ancestry: ${l.id}`);
    return { ...l, label: l.label ?? "", vendor: vendor.name, section: section.name, position: section.position * 1000 + l.position,
      ...sourceForId(text, CATALOG_FILE, l.id) };
  }).sort((a, b) => a.vendor.localeCompare(b.vendor) || a.position - b.position || a.id.localeCompare(b.id));
}

/** Join through SKU id; stale printed guide numbers never override current SKU identity. */
export function joinGuideLines(lines: SeedLine[], catalog: CatalogRow[], exports: ExportRow[], asOf: string) {
  const joined = lines.map(line => {
    const sku = catalog.find(s => s.id === line.sku_id);
    const observations = sku?.item_number && vendorKey(sku.vendor) === vendorKey(line.vendor)
      ? exports.filter(r => key(r.vendor, r.item_no) === key(sku.vendor, sku.item_number!)) : [];
    const status = !line.sku_id ? "unlinked guide line" : !sku ? "missing SKU" : vendorKey(sku.vendor) !== vendorKey(line.vendor)
      ? "vendor ownership mismatch" : !sku.item_number ? "SKU has no item_number" : observations.length ? "present in exports"
      : "item_number absent from supplied exports (possible discontinued/substituted; not proof)";
    return { line, sku, observations, status };
  });
  const placed = new Set(joined.filter(j => j.sku?.item_number && vendorKey(j.sku.vendor) === vendorKey(j.line.vendor))
    .map(j => key(j.sku!.vendor, j.sku!.item_number!)));
  const candidates = [...new Map(exports.filter(r => r.item_no && recent(r, asOf) && !placed.has(key(r.vendor, r.item_no)))
    .map(r => [key(r.vendor, r.item_no), r])).values()].sort((a, b) => key(a.vendor, a.item_no).localeCompare(key(b.vendor, b.item_no)));
  const unidentified = exports.filter(r => !r.item_no && recent(r, asOf));
  return { joined, candidates, unidentified };
}

/** Physical totals are comparison units, not recipe ounce conversions (volume != mass). */
function packTotal(pack: string | null | undefined) {
  if (!pack) return null;
  const volume = / FL OZ$/i.test(pack);
  const p = parsePack(pack.replace(/ FL OZ$/i, " OZ").replace(/ COUNT$/i, " EA"));
  if (p.pack_unparsed || p.pack_catch_weight || typeof p.pack_size !== "number" || p.pack_qty == null) return null;
  const units: Record<string, [string, number]> = { LB: ["mass oz", 16], OZ: ["labeled oz", 1], GR: ["mass oz", 1 / 28.349523125],
    CT: ["each", 1], EA: ["each", 1], DZ: ["each", 12], GA: ["volume fl oz", 128], QT: ["volume fl oz", 32], LT: ["volume fl oz", 33.8140227], FT: ["feet", 1], RL: ["roll", 1] };
  const unit = units[p.pack_unit ?? ""];
  return unit ? { unit: volume ? "volume fl oz" : unit[0], total: p.pack_qty * (p.pack_inner_qty ?? 1) * p.pack_size * unit[1] } : null;
}

export function compareCatalog(row: ExportRow, sku: CatalogRow, asOf: string) {
  const exact = !!row.item_no && key(row.vendor, row.item_no) === key(sku.vendor, sku.item_number ?? "");
  const a = packTotal(sku.pack), b = packTotal(row.pack);
  const ratio = a && b && a.unit === b.unit ? b.total / a.total
    : b?.unit === "mass oz" && sku.content_oz && sku.cost_is_estimate === false ? b.total / sku.content_oz : null;
  let before: number | null = null, after: number | null = null, qty: number | null = null;
  let basis = "unavailable";
  if (exact && row.price_per_lb_cents != null) {
    before = sku.price_per_lb_cents ?? null; after = row.price_per_lb_cents; basis = "lb (catalog chain-derived; averages may apply)";
    qty = row.net_wt_lb ?? (row.last_purchase_uom === "LB" ? row.last_purchase_qty : null);
  } else if (exact && row.price_cents != null && sku.price_cents != null) {
    const same = sku.pack && packEqual(sku.pack, row.pack) === true && sku.uom === row.uom;
    const caseUnit = ["CS", "CA"].includes(row.uom) || row.price_basis === "per case";
    if (same) { before = sku.price_cents; after = row.price_cents; basis = row.uom; }
    else if (ratio != null && caseUnit) { before = sku.price_cents * ratio; after = row.price_cents; basis = "export pack equivalent (contents normalized)"; }
    else if (a?.unit === "each" && row.price_basis === "per dozen") { before = sku.price_cents / a.total * 12; after = row.price_cents; basis = "dozen"; }
    else if (a?.unit === "each" && row.price_basis === "per each") { before = sku.price_cents / a.total; after = row.price_cents; basis = "each"; }
    qty = row.last_purchase_uom === row.uom ? row.last_purchase_qty : null;
  }
  const delta = before != null && after != null ? after - before : null;
  const impact = delta != null && qty != null && recent(row, asOf) ? Math.abs(delta * qty) : null;
  const reason = !exact ? "identity unverified" : row.price_cents == null && row.price_per_lb_cents == null ? "export price absent"
    : sku.price_cents == null ? "catalog price absent" : delta == null ? "price denominator/pack conversion unproven" : basis;
  return { before, after, delta, impact, qty, basis, reason, ratio,
    percent: delta != null && before != null && before > 0 ? delta / before * 100 : null,
    pack: !sku.pack ? "catalog pack absent" : packEqual(sku.pack, row.pack) === true ? "same hierarchy" : ratio != null ? "different hierarchy" : "different/unknown hierarchy; conversion unproven" };
}

function selected(rows: ExportRow[]) {
  const lists = rows.filter(r => !r.receipt_doc);
  const groups = [...new Set(lists.map(r => `${r.vendor}:${r.account_id}`))];
  return [...groups.flatMap(g => uniqueItems(lists.filter(r => `${r.vendor}:${r.account_id}` === g))), ...rows.filter(r => r.receipt_doc)];
}
function exactSkus(row: ExportRow, catalog: CatalogRow[]) {
  return row.item_no ? catalog.filter(s => key(s.vendor, s.item_number ?? "") === key(row.vendor, row.item_no)) : [];
}
function comparisons(rows: ExportRow[], catalog: CatalogRow[], asOf: string) {
  return rows.flatMap(row => {
    const skus = exactSkus(row, catalog);
    return skus.length === 1 ? [{ row, sku: skus[0]!, result: compareCatalog(row, skus[0]!, asOf) }] : [];
  }).sort((a, b) => (b.result.impact ?? -1) - (a.result.impact ?? -1) || key(a.row.vendor, a.row.item_no).localeCompare(key(b.row.vendor, b.row.item_no)));
}
function priceTable(rows: ExportRow[], catalog: CatalogRow[], asOf: string, includeUnobserved = false) {
  const output = rows.map(r => {
    const skus = exactSkus(r, catalog), s = skus.length === 1 ? skus[0]! : null;
    const c = s ? compareCatalog(r, s, asOf) : null;
    const suggestions = s ? [] : catalogMatchCandidates(r, catalog);
    return [`${r.vendor} / ${r.item_no || "not printed"} / ${r.last_purchase_date ?? "undated"}`, `${s?.pack ?? "unknown"} → ${r.pack || "unknown"}`, s ? `${money(s.price_cents)} / ${s.price_basis} / ${s.price_date}` : `${skus.length} exact matches; hypotheses ONLY: ${suggestions.map(x => `${x.name}, ${x.pack ?? "unknown pack"}, ${money(x.price_cents)} / ${x.price_basis} / ${x.price_date} ${evidence(x)}`).join("; ") || "none"}`,
      `${money(r.price_per_lb_cents ?? r.price_cents)} / ${r.price_basis ?? r.uom}`, c ? `${money(c.before)} → ${money(c.after)}; ${c.reason}` : "identity unresolved",
      c ? `${money(c.delta)} / ${c.percent == null ? "unavailable" : c.percent.toFixed(2) + "%"}` : "unavailable", money(c?.impact), `${cite(r)}${s ? "; " + evidence(s) : ""}`];
  });
  if (includeUnobserved) for (const s of catalog.filter(s => vendorKey(s.vendor) === vendorKey(rows[0]?.vendor ?? "") && !rows.some(r => exactSkus(r, [s]).length))) {
    output.push([`${s.vendor} / ${s.item_number ?? "null"} / ${s.name}`, `${s.pack ?? "unknown"} → absent`, `${money(s.price_cents)} / ${s.price_basis} / ${s.price_date}`, "no exact export identity", "unavailable", "unavailable", "unavailable", evidence(s)]);
  }
  return table(["Vendor / item / date", "Catalog pack → export pack", "Catalog pack price / basis / date", "Export rate", "Comparable catalog → export", "Delta / %", "Absolute last-event impact", "Evidence"], output);
}
function packTable(rows: ExportRow[], catalog: CatalogRow[], asOf: string) {
  return table(["Vendor / item", "Catalog pack (flat mirror)", "Export pack", "Export/catalog content ratio", "Result", "Evidence"], rows.map(r => {
    const skus = exactSkus(r, catalog), s = skus.length === 1 ? skus[0]! : null, c = s ? compareCatalog(r, s, asOf) : null;
    return [`${r.vendor} / ${r.item_no || "not printed"}`, s ? `${s.pack ?? "unknown"} (${s.flat_pack ?? "unknown"})` : `${skus.length} exact matches`, r.pack || "not supplied", c?.ratio?.toFixed(4), c?.pack ?? "identity unresolved", `${cite(r)}${s ? "; " + evidence(s) : ""}`];
  }));
}
export function guideSection(lines: SeedLine[], catalog: CatalogRow[], rows: ExportRow[], asOf: string) {
  const j = joinGuideLines(lines, catalog, rows, asOf);
  return ["## I. order_guide_lines vs exports",
    `All ${j.joined.length} lines: ${j.joined.filter(x => x.status === "present in exports").length} present; ${j.joined.filter(x => x.status === "SKU has no item_number").length} linked SKUs without item_number; ${j.joined.filter(x => x.status === "unlinked guide line").length} unlinked; ${j.joined.filter(x => x.status.startsWith("item_number absent")).length} numbered SKUs absent. ${j.candidates.length} distinct dated recent vendor/items on NO guide; ${j.unidentified.length} recent receipt lines without item numbers remain unresolved. US Foods undated proxy excluded. Absence means absent from this supplied export corpus, including vendors with no export coverage, never proven discontinuation.`,
    table(["Vendor / section / position / line", "SKU / active / location", "Guide printed no. → SKU no.", "Status", "Export observations", "Evidence"], j.joined.map(x => [
      `${x.line.vendor} / ${x.line.section} / ${x.line.position} / ${x.line.label}`, x.sku ? `${x.sku.name} / ${x.sku.active} / ${x.sku.location_code ?? "global"}` : x.line.sku_id ?? "unlinked",
      `${x.line.item_number ?? "null"} → ${x.sku?.item_number ?? "null"}`, x.status, x.observations.length,
      [cite(x.line), ...(x.sku ? [cite(x.sku)] : []), ...x.observations.map(cite)].join("; ") ])),
    "### I.1 Dated recent purchases on no guide — candidates to add",
    table(["Vendor / item", "Description", "Last purchase", "Catalog matches", "Evidence"], j.candidates.map(r => [r.vendor + " / " + r.item_no, r.description, `${r.last_purchase_date}: ${r.last_purchase_qty} ${r.last_purchase_uom}`, exactSkus(r, catalog).map(s => `${s.name} (${s.active ? "active" : "inactive"}) ${cite(s)}`).join("; ") || "none", cite(r)])),
    "### I.2 Recent unidentified receipt lines — placement cannot be determined",
    table(["Vendor / document / line", "Description", "Date", "Evidence"], j.unidentified.map(r => [`${r.vendor} / ${r.receipt_doc} / ${r.receipt_line}`, r.description, r.last_purchase_date, cite(r)])),
  ].join("\n\n");
}

function twins(rows: ExportRow[], catalog: CatalogRow[]) {
  const show = (r: ExportRow) => `${r.item_no} ${r.description}; export ${r.pack}, ${money(r.price_per_lb_cents ?? r.price_cents)} / ${r.price_basis ?? r.uom} ${cite(r)}; catalog: ` +
    (catalogMatchCandidates(r, catalog).map(s => `${s.item_number === r.item_no ? "exact" : "NAME HYPOTHESIS only"}: ${s.name}; ${s.pack ?? "unknown pack"}; ${money(s.price_cents)} / ${s.price_basis}; ${s.price_date}; active ${s.active}, ${s.location_code ?? "global"}; ${evidence(s)}`).join("; ") || "no catalog identity/candidate");
  return ["## H. Cross-vendor twin candidates — real catalog packs and prices",
    "Family suggestions require a human choice. Separate vendor SKUs remain separate. Catalog prices are dated internal pack prices, not current account quotes. Turkey is not ham; still/sparkling and shell/cooked remain separate. Null prices do not support savings claims.",
    table(["Family", "PFG evidence + catalog", "US Foods evidence + catalog"], crossVendorCandidates(rows).map(t => [t.family, t.pfg.map(show).join("; "), t.usfoods.map(show).join("; ")]))].join("\n\n");
}

export function writeCatalogReports(all: ExportRow[], asOf: string) {
  // Validate date, including impossible calendar dates, even if there are no purchases.
  recent({ last_purchase_date: null } as ExportRow, asOf);
  const { catalog, data } = loadCatalog();
  const lines = seedLines(data, readFileSync(join(ROOT, CATALOG_FILE), "utf8"));
  const items = selected(all), fullJoin = joinGuideLines(lines, catalog, all, asOf);
  const headline = `Catalog: prod export 2026-09-19\n\n${catalog.length} SKUs (including inactive); ${data.vendor_price_history.length} price-history rows; ${lines.length} seeded guide lines. Window ${new Date(Date.parse(asOf) - 59 * 86400000).toISOString().slice(0, 10)}–${asOf}, inclusive. Quotes and dated receipts are account observations; catalog prices are internal purchase-pack prices. Absolute dollar impact is a last-event proxy, not cumulative 60-day spend. Pack-normalized comparisons are estimates of equivalent contents; no substitution is approved. Catalog ounce costs follow existing chain/average semantics, not measured invoice weights.`;
  const questions = "## G. Remaining decisions\n\nSee [draft §9](../../../../superpowers/specs/2026-09-18-vendor-ordering-v3c-import-design.md#9-open-questions-for-juan--floor-answers-only). The join resolves stored facts, not floor policy.";
  const artifacts: { name: string; text: string }[] = [];
  for (const name of ["pfg", "usfoods", "receipts"]) {
    const rows = items.filter(r => name === "receipts" ? !!r.receipt_doc : r.vendor === name);
    const vendors = new Set(rows.map(r => vendorKey(r.vendor)));
    const scopedLines = lines.filter(l => vendors.has(vendorKey(l.vendor)));
    const j = joinGuideLines(scopedLines, catalog, all, asOf);
    const unknown = rows.filter(r => (recent(r, asOf) || name === "usfoods" && all.some(o => o.vendor === r.vendor && o.item_no === r.item_no && o.list_name === "Recently Purchased")) && exactSkus(r, catalog).length === 0);
    const parts = [`# ${name} vendor-export diff — ${asOf}`, headline,
      `Summary: ${all.filter(r => name === "receipts" ? !!r.receipt_doc : r.vendor === name).length} observations; ${rows.length} comparison rows; ${unknown.length} bought/proxy rows without exact catalog identity. US Foods Recently Purchased is undated; receipts retain separate document lines.`,
      "## A. Seeded guide gaps against supplied exports", "Current SKU item_number governs the join. Null links/numbers are unresolved, not silently filled from descriptions. Partial receipt coverage cannot prove discontinuation.",
      table(["Guide line", "SKU item number", "Finding", "Evidence"], j.joined.filter(x => x.status !== "present in exports").map(x => [x.line.label, x.sku?.item_number, x.status, `${cite(x.line)}${x.sku ? "; " + cite(x.sku) : ""}`])),
      "## B. Bought-but-unknown — exact vendor/item identity", "PFG/receipts use the dated window; US Foods uses explicitly undated purchase-proxy membership. Missing item numbers remain unresolved.",
      table(["Vendor / item", "Description", "Purchase evidence", "Evidence"], unknown.map(r => [r.vendor + " / " + (r.item_no || "not printed"), r.description, r.last_purchase_date ?? "undated Recently Purchased proxy", cite(r)])),
      "## C. Ambiguous or conflicting identity", table(["Vendor / item", "Catalog candidates", "Evidence"], rows.filter(r => exactSkus(r, catalog).length > 1).map(r => [r.vendor + " / " + r.item_no, exactSkus(r, catalog).map(s => s.name).join("; "), [cite(r), ...exactSkus(r, catalog).map(cite)].join("; ")])),
      "## D. Price deltas", "Every export item/receipt line is accounted for, including missing prices and identities. US Foods exports have no quoted prices; catalog prices are displayed without inventing a delta.", priceTable(rows, catalog, asOf),
      "## E. Pack mismatches", "Ratios compare numerical contents within proven matching dimensions; hierarchy differences remain visible even at ratio 1. Raw OZ labels are not silently treated as LB or volume.", packTable(rows, catalog, asOf),
      "## F. Purchase/list evidence"];
    if (name === "pfg") parts.push(table(["List", "Unique", "Recent overlap", "Jaccard", "Evidence"], listMetrics(all.filter(r => r.vendor === "pfg"), asOf).map(m => [m.name, m.count, m.overlap, m.jaccard.toFixed(4), cite(m.observations[0]!)])));
    else if (name === "usfoods") parts.push(table(["List", "Unique", "Undated proxy overlap", "Jaccard", "Evidence"], purchaseProxyMetrics(all.filter(r => r.vendor === "usfoods")).map(m => [m.name, m.count, m.overlap, m.jaccard.toFixed(4), cite(m.observations[0]!)])));
    else parts.push("Receipts are partial deliveries. Last-event quantities are not cumulative spend; measured net pounds extend catch-weight rates.");
    if (name === "receipts") parts.push("### F.1 Invoice unit calculations (independent of unresolved catalog identity)",
      table(["Vendor / item / date", "Cents/oz", "Cents/each", "Billed extension", "Evidence"], rows.map(r => {
        const c = receiptUnitCosts(r); return [`${r.vendor} / ${r.item_no || "not printed"} / ${r.last_purchase_date}`, c.perOzCents, c.perEachCents, money(c.extendedCents), cite(r)];
      })), table(["Purchase-unit decision", "Calculation", "Evidence"], receiptPurchaseDecisions(rows).map(d => [d.label, d.text, cite(d.row)])));
    parts.push(questions, twins(all, catalog), guideSection(scopedLines, catalog, all.filter(r => vendors.has(vendorKey(r.vendor))), asOf));
    artifacts.push({ name: `${asOf}-${name}-diff.md`, text: parts.join("\n\n") + "\n" });
  }
  const ranked = comparisons(items, catalog, asOf).filter(c => c.result.impact != null && c.result.impact > 0);
  const master = [`# Real catalog join — ${asOf}`, headline,
    `Section I headline: ${fullJoin.joined.length} lines; ${fullJoin.candidates.length} dated recent vendor/items on no guide; ${fullJoin.unidentified.length} recent unidentified receipt lines.`,
    "## Most consequential comparable deltas", table(["Vendor / item", "Catalog → export equivalent", "Delta", "Absolute last-event impact", "Pack", "Evidence"], ranked.slice(0, 5).map(c => [c.row.vendor + " / " + c.row.item_no, `${money(c.result.before)} → ${money(c.result.after)} / ${c.result.basis}`, money(c.result.delta), money(c.result.impact), `${c.sku.pack} → ${c.row.pack}`, `${cite(c.row)}; ${evidence(c.sku)}`]))];
  for (const vendor of [...new Set([...catalog.map(s => s.vendor ?? "unassigned"), ...items.map(r => r.vendor)])].filter((v, i, a) => a.findIndex(x => vendorKey(x) === vendorKey(v)) === i).sort()) {
    const rows = items.filter(r => vendorKey(r.vendor) === vendorKey(vendor));
    master.push(`## Vendor: ${vendor}`, rows.length ? priceTable(rows, catalog, asOf, true) : table(["Catalog SKU", "Item", "Pack / price / date", "State / location", "Evidence"], catalog.filter(s => (s.vendor ?? "unassigned") === vendor).map(s => [s.name, s.item_number, `${s.pack ?? "unknown"} / ${money(s.price_cents)} / ${s.price_date}`, `${s.active} / ${s.location_code ?? "global"}`, evidence(s)])));
  }
  master.push(twins(all, catalog), guideSection(lines, catalog, all, asOf), questions);
  artifacts.push({ name: `${asOf}-catalog-join.md`, text: master.join("\n\n") + "\n" });
  mkdirSync(dir, { recursive: true });
  return artifacts.map(a => {
    const path = join(dir, a.name); writeFileSync(path, a.text);
    if (readFileSync(path, "utf8") !== a.text) throw new Error(`Readback failed: ${path}`);
    return { path, summary: ["Catalog: prod export 2026-09-19", `${catalog.length} SKUs; ${lines.length} guide lines; ${fullJoin.candidates.length} dated recent off-guide items`] };
  });
}
