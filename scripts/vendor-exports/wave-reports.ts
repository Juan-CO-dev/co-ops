/** Offline wave 2/3 reporting. Observations are evidence, never approved substitutions. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { EXPORT_ROOT, ROOT } from "./normalize";
import { descriptionCandidate, packEqual, uniqueItems, type CatalogRow, type Evidence, type GuideRow } from "./diff-core";
import type { ExportRow } from "./model";

const GUIDE = "docs/seed/source/order-guide-2026-09-13.json";
const CATALOG = "docs/seed/source/vendor-exports/context/readiness-list-prod-2026-09-16.json";
const REPORTS = join(EXPORT_ROOT, "reports");
const QUESTIONS = "[Merged floor questions (draft spec §9)](../../../../superpowers/specs/2026-09-18-vendor-ordering-v3c-import-design.md#9-open-questions-for-juan--floor-answers-only)";
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const cell = (v: unknown) => String(v ?? "unavailable").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
const table = (headers: string[], rows: unknown[][]) => [
  `| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`,
  ...rows.map(r => `| ${r.map(cell).join(" | ")} |`), "",
].join("\n");
const cite = (e: Evidence) => `[${basename(e.source_file)}:${e.source_line}](${relative(REPORTS, join(ROOT, e.source_file)).replaceAll("\\", "/")}#L${e.source_line})`;
const money = (c: number | null | undefined) => c == null ? "unavailable" : `$${(c / 100).toFixed(Number.isInteger(c) ? 2 : 5).replace(/(\.\d{2})0+$/, "$1")}`;
const quoted = (r: ExportRow) => r.price_per_lb_cents != null ? `${money(r.price_per_lb_cents)}/lb` : `${money(r.price_cents)} ${r.price_basis ?? r.uom}`;
const vendorKey = (v: string | null) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const candidate = (name: string, row: ExportRow) => descriptionCandidate(name, { ...row, description: row.description.replaceAll(",", "") });
function evidence(file: string, token: string): Evidence {
  const line = read(file).split(/\r?\n/).findIndex(l => l.includes(token));
  if (line < 0) throw new Error(`Missing citation ${file}: ${token}`);
  return { source_file: file, source_line: line + 1 };
}
function context() {
  const guide = JSON.parse(read(GUIDE)) as { sheets: Record<string, { item: string; vendor?: string; section: string; item_number?: string }[]> };
  const snapshot = JSON.parse(read(CATALOG)) as { skus: Omit<CatalogRow, keyof Evidence>[] };
  const guides: GuideRow[] = Object.values(guide.sheets).flat().map(g => ({ ...g, vendor: g.vendor ?? "", item_number: g.item_number ?? "", ...evidence(GUIDE, `"item": ${JSON.stringify(g.item)}`) }));
  const catalog = snapshot.skus.map(s => ({ ...s, ...evidence(CATALOG, `"id": ${JSON.stringify(s.id)}`) }));
  return { guides, catalog };
}

/** The undated Recently Purchased membership is a proxy, never a 60-day claim. */
export function purchaseProxyMetrics(rows: readonly ExportRow[]) {
  uniqueItems(rows); // refuse accidental mixed account/vendor scopes
  const proxy = new Set(rows.filter(r => r.list_name === "Recently Purchased").map(r => r.item_no));
  return [...new Set(rows.map(r => r.list_name))].filter(n => n !== "Recently Purchased").map(name => {
    const observations = rows.filter(r => r.list_name === name);
    const ids = new Set(observations.map(r => r.item_no));
    const overlap = [...ids].filter(id => proxy.has(id)).length;
    const union = new Set([...ids, ...proxy]).size;
    return { name, count: ids.size, overlap, proxyCount: proxy.size, coverage: proxy.size ? overlap / proxy.size : 0, jaccard: union ? overlap / union : 0, observations };
  }).sort((a, b) => b.jaccard - a.jaccard || a.name.localeCompare(b.name));
}

const familyRules: [string, RegExp][] = [
  ["Duke's mayonnaise", /mayonnaise.*dukes/i], ["Saratoga sparkling", /water.*sparkling.*saratoga/i],
  ["Saratoga still", /water(?!.*sparkling).*saratoga/i], ["Natalie's lemonade", /lemonade.*natali/i],
  ["Iceberg", /lettuce.*iceberg/i], ["Hard-cooked eggs", /egg.*hard.?cooked/i],
  ["Turkey", /turkey/i], ["Ham (not turkey)", /\bham\b/i],
  ["Capicola", /capicola|cappy/i], ["Genoa salami", /genoa/i], ["Pepperoni", /pepperoni/i],
  ["Fresh mozzarella", /cheese.*mozzarella.*(?:log|fresh)/i],
  ["Shredded mozzarella (blend requires review)", /cheese.*mozzarella.*shred/i],
  ["Cheddar", /cheese.*cheddar/i], ["Ricotta", /cheese.*ricotta/i],
  ["Parmesan", /cheese.*parmesan/i], ["Provolone", /cheese.*provolone(?!.*blend)/i],
  ["Fresh peeled garlic", /garlic.*(?:whole|clove).*peeled/i], ["Fresh basil", /basil.*fresh/i],
  ["Yellow onion", /onion.*yellow/i], ["Red onion", /onion.*red/i],
  ["Heavy cream", /cream.*(?:whipping.*heavy|heavy)/i], ["Sour cream", /sour cream/i],
  ["Butter", /^butter[, ]/i], ["Shell eggs", /egg.*shell|egg.*white.*(?:large|medium)/i],
  ["Fresh tomatoes", /tomato.*(?:fresh|[456]x[456])/i], ["Arugula", /arugula/i],
  ["Lemon juice (not lemonade)", /juice.*lemon(?!ade)/i], ["Cucumber", /cucumber/i],
  ["Gloves (size/material require review)", /glove/i], ["Foil sheets", /foil.*(?:sheet|interfold)/i],
];
const inFamily = (row: ExportRow, rule: RegExp) => rule.test(`${row.description} ${row.brand}`);
export function crossVendorCandidates(rows: readonly ExportRow[]) {
  const pfg = uniqueItems(rows.filter(r => r.vendor === "pfg"));
  const us = uniqueItems(rows.filter(r => r.vendor === "usfoods"));
  return familyRules.flatMap(([family, rule]) => {
    const left = pfg.filter(r => inFamily(r, rule)), right = us.filter(r => inFamily(r, rule));
    return left.length && right.length ? [{ family, pfg: left, usfoods: right }] : [];
  });
}

/** Derived unit costs; never infer catch weight from a nominal pack. */
export function receiptUnitCosts(row: ExportRow) {
  const lb = row.price_per_lb_cents;
  const each = row.price_basis === "per dozen" && row.price_cents != null ? row.price_cents / 12 :
    row.price_basis === "per each" ? row.price_cents : null;
  return { perOzCents: lb == null ? null : lb / 16, perEachCents: each,
    extendedCents: lb != null ? row.net_wt_lb == null ? null : Math.round(lb * row.net_wt_lb) :
      (row.billed_price_cents ?? row.price_cents) != null && row.last_purchase_qty != null ? Math.round((row.billed_price_cents ?? row.price_cents)! * row.last_purchase_qty) : null };
}

/** Source-specific unit reconciliation, computed afresh from normalized observations. */
export function receiptPurchaseDecisions(rows: readonly ExportRow[]): { label: string; text: string; row: ExportRow }[] {
  const results: { label: string; text: string; row: ExportRow }[] = [];
  for (const row of rows) {
    if (row.vendor === "Thompson Delivers" && row.price_cents != null && row.pack_qty != null) {
      const perBox = row.pack_qty * row.price_cents;
      const size = `${row.pack_size ?? "unknown"} ${row.pack_unit ?? "unit"}`;
      const discrepancy = row.billed_price_basis === "per 60-bag club pack" && row.billed_price_cents != null
        ? ` Rounded bag rate implies ${money(perBox)}/box versus billed ${money(row.billed_price_cents)}/box: ${money(perBox - row.billed_price_cents)} difference. Billed implied bag rate ${money(row.billed_price_cents / row.pack_qty)}. Printed ${row.last_purchase_qty} club packs; billed extension ${money(receiptUnitCosts(row).extendedCents)}.`
        : ` Printed ${row.last_purchase_qty} bags = ${row.last_purchase_qty == null ? "unknown" : row.last_purchase_qty / row.pack_qty} boxes.`;
      results.push({ label: `Thompson ${row.item_no}`, text: `${row.pack_qty} bags × ${money(row.price_cents)} = ${money(perBox)}/box; ${size}/bag.${discrepancy}`, row });
    }
    if (row.vendor === "Country Snacks" && row.price_basis === "per case" && row.price_cents != null && row.pack_qty != null && typeof row.pack_size === "number") {
      const bags = row.pack_qty * row.pack_size;
      results.push({ label: "Country Snacks mixed flavors", text: `${bags} bags × ${money(row.price_cents / bags)} = ${money(row.price_cents)}/case; ${row.last_purchase_qty} cases = ${row.last_purchase_qty == null ? "unknown" : row.last_purchase_qty * bags} bags = ${money(receiptUnitCosts(row).extendedCents)}. Purchase flavors untracked.`, row });
    }
    if (row.vendor === "Cardinal Bakery" && row.price_basis === "per dozen") {
      results.push({ label: `Cardinal ${row.item_no} / ${row.last_purchase_date}`, text: `${money(row.price_cents)}/dozen = ${money(receiptUnitCosts(row).perEachCents)}/roll; ${row.last_purchase_qty} dozen = ${row.last_purchase_qty == null ? "unknown" : row.last_purchase_qty * 12} rolls (${money(receiptUnitCosts(row).extendedCents)}).`, row });
    }
  }
  return results;
}

const receiptNames: Record<string, string> = {
  "278": "Turkey", "546": "Bacon", "137": "Capicola", "505": "Genoa", "558": "Pepperoni", "12011": "Roast Beef", "30": "Hot Peppers", "795": "Whole pickles", "1030": "Sub Roll",
};
function matches(row: ExportRow, catalog: CatalogRow[]) {
  const vendor = catalog.filter(s => vendorKey(s.vendor) === vendorKey(row.vendor));
  const exact = row.item_no ? vendor.filter(s => s.item_number === row.item_no) : [];
  if (exact.length) return exact;
  return vendor.filter(s => !s.item_number && (candidate(s.name, row) ||
    ((row.vendor === "Boar's Head" || row.vendor === "Cardinal Bakery") && receiptNames[row.item_no]?.toLowerCase() === s.name.toLowerCase())));
}

/** Catalog price_per_oz is dollars; input invoice rates are cents. Only exact identities produce deltas. */
export function receiptCatalogDelta(row: ExportRow, sku: CatalogRow & { price_per_oz?: number | null }) {
  if (!row.item_no || sku.item_number !== row.item_no || vendorKey(sku.vendor) !== vendorKey(row.vendor)) return { delta: null, reason: "identity unverified (name/family hypothesis only)" };
  if (row.price_per_lb_cents != null) {
    const before = sku.price_per_lb_cents ?? (sku.price_per_oz == null ? null : sku.price_per_oz * 100 * 16);
    return before == null ? { delta: null, reason: "catalog per-lb/per-oz price absent" } : { delta: row.price_per_lb_cents - before, reason: "cents/lb; catalog oz converted x16" };
  }
  if (sku.price_cents == null || row.price_cents == null || !sku.pack || sku.uom !== row.uom || packEqual(sku.pack, row.pack) !== true) return { delta: null, reason: "catalog price/pack/basis not proven comparable" };
  return { delta: row.price_cents - sku.price_cents, reason: `cents/${row.uom}` };
}

function inventory(rows: ExportRow[]) {
  return table(["File", "Observations", "SHA-256", "Evidence"], [...new Set(rows.map(r => r.source_file))].map(file => {
    const group = rows.filter(r => r.source_file === file);
    return [file, group.length, createHash("sha256").update(read(file)).digest("hex"), cite(group[0]!)];
  }));
}
export function catalogPackComparison(row: ExportRow, sku: CatalogRow): string {
  if (!row.item_no || sku.item_number !== row.item_no || vendorKey(sku.vendor) !== vendorKey(row.vendor)) return "unavailable: identity unverified";
  if (!sku.pack) return "unavailable: catalog pack absent";
  const equal = packEqual(row.pack, sku.pack);
  return equal == null ? "unavailable: unparsed pack" : equal ? "same parsed hierarchy (not substitution approval)" : "different parsed hierarchy; review";
}
function packComparisons(rows: ExportRow[], catalog: CatalogRow[]) {
  return table(["Vendor / item", "Observed pack", "Catalog pack", "Comparison", "Evidence"], rows.flatMap(r => {
    const candidates = matches(r, catalog);
    return candidates.map(s => [ `${r.vendor} / ${r.item_no || "not printed"}`, r.pack || "not supplied", s.pack ?? "not supplied",
      candidates.length === 1 ? catalogPackComparison(r, s) : "unavailable: ambiguous catalog identity", `${cite(r)}; ${cite(s)}` ]);
  }));
}
function twins(rows: ExportRow[]) {
  const proxy = new Set(rows.filter(r => r.vendor === "usfoods" && r.list_name === "Recently Purchased").map(r => r.item_no));
  const show = (r: ExportRow) => `${r.item_no}: ${r.description}; ${r.pack}; ${quoted(r)}; ${r.vendor === "usfoods" ? proxy.has(r.item_no) ? "purchase proxy YES" : "list-only" : `last purchase ${r.last_purchase_date ?? "absent"}`} ${cite(r)}`;
  const bh = rows.find(r => r.vendor === "Boar's Head" && r.item_no === "278");
  const ham = rows.find(r => r.vendor === "usfoods" && r.item_no === "6497260");
  return ["## H. Cross-vendor twin candidates",
    "Separate SKU per vendor; a human selects the active twin at each shop. Family matches are review candidates, not approved equivalents or proof of simultaneous buying. Preserve PFG purchase dates and US Foods undated purchase-proxy membership. Missing US Foods prices prevent savings claims.",
    table(["Family", "PFG", "US Foods", "Review"], crossVendorCandidates(rows).map(f => [f.family, f.pfg.map(show).join("; "), f.usfoods.map(show).join("; "), "Confirm pack, grade and intended use before choosing the active vendor line"])),
    bh && ham ? `**Not twins:** Ovengold turkey ${show(bh)} is turkey; US Foods rectangle 4x6 ham ${show(ham)} is pork. Neither substitutes for the other. Saratoga still/sparkling and shell/hard-cooked eggs remain separate families.` : "Turkey is not ham; still/sparkling water and shell/cooked eggs remain distinct.",
    `Doctrine: ${cite(evidence("docs/superpowers/specs/2026-09-16-vendor-ordering-v3a-order-guides-design.md", "**Model limits"))}; per-shop activation: ${cite(evidence("lib/location-sku-shared.ts", "export function resolveActive"))}.`,
  ].join("\n\n");
}

function usReport(all: ExportRow[], catalog: CatalogRow[], guides: GuideRow[], asOf: string) {
  const rows = all.filter(r => r.vendor === "usfoods"), items = uniqueItems(rows);
  const proxy = rows.filter(r => r.list_name === "Recently Purchased");
  const metrics = purchaseProxyMetrics(rows);
  const gaps = guides.filter(g => g.vendor === "PFG" && !items.some(r => candidate(g.item, r)));
  const unknown = proxy.filter(r => !matches(r, catalog).length);
  const families = familyRules.map(([name, rule]) => ({ name, rows: items.filter(r => inFamily(r, rule)) })).filter(f => f.rows.length > 1);
  const parts = [`# US Foods vendor-export diff — ${asOf}`,
    "Generated offline; no writes to the catalog. Account 71628390, P Street. US Foods exports contain NO prices and NO purchase dates or quantities. Recently Purchased is only an undated purchase proxy. Laminate order remains authoritative; list ordering never replaces it.",
    `Summary: ${rows.length} observations; ${items.length} unique item numbers; ${proxy.length} purchase-proxy rows; ${unknown.length} proxy rows without a vendor-scoped catalog name candidate. The readiness snapshot lacks item numbers, prices and packs; no definitive new-SKU or delta decision is possible.`,
    "## Input inventory", inventory(rows),
    `Rows / unique items: ${[...new Set(rows.map(r => r.list_name))].map(name => { const list = rows.filter(r => r.list_name === name); return `${name} ${list.length}/${new Set(list.map(r => r.item_no)).size}`; }).join("; ")}. Repeated rows never add purchase volume.`,
    "## A. Guide gaps", "There is no US Foods laminate sheet in the supplied guide. The following PFG laminate lines have no US Foods description candidate; these are cross-vendor coverage gaps, NOT missing US Foods order lines. Exact PFG numbers cannot identify US Foods products.",
    table(["Laminate item", "Section", "Evidence"], gaps.map(g => [g.item, g.section, cite(g)])),
    "## B. Bought-but-unknown candidates", "Recently Purchased proxy only; dates and quantities unavailable. Vendor aliases normalize punctuation/spaces, never another vendor. Catalog lacks item numbers: absence here is a review hypothesis.",
    table(["Item", "Description", "Pack", "Evidence"], unknown.map(r => [r.item_no, r.description, r.pack, cite(r)])),
    "## C. Item-number / description families across all five lists",
    "Each distinct item number stays separate. Same-family alternatives may differ by pack, formulation, brand or preparation. Lists below show all memberships; proxy membership is not a dated event.",
    table(["Family", "Item", "Description / brand", "Pack", "Memberships", "Evidence"], families.flatMap(f => f.rows.map(r => [f.name, r.item_no, `${r.description}; ${r.brand}`, r.pack, [...new Set(rows.filter(x => x.item_no === r.item_no).map(x => x.list_name))].join("; "), rows.filter(x => x.item_no === r.item_no).map(cite).join("; ")]))),
    "### C.1 Same-number disagreements", table(["Item", "Observations", "Evidence"], items.flatMap(r => {
      const observations = rows.filter(x => x.item_no === r.item_no);
      return new Set(observations.map(x => JSON.stringify([x.description.trim(), x.brand.trim(), x.pack.trim()]))).size > 1 ? [[r.item_no, observations.map(x => `${x.list_name}: ${x.description}; ${x.pack}`).join("; "), observations.map(cite).join("; ")]] : [];
    })),
    "## D. Price deltas", "Unavailable for every US Foods row: the exports supply no price. A missing price must never blank an existing catalog price. Obtain account-specific invoices/order detail before calculating any delta.",
    "## E. Pack mismatches", "A catalog comparison requires exact vendor/item identity and supplied parsable packs; otherwise it is unavailable. Different packs within C are alternatives, not catalog mismatches. LBA nominal/range packs cannot set invoice weight.", packComparisons(items, catalog),
    "## F. Which list is LIVE?", "Jaccard = intersection / union with Recently Purchased; coverage = intersection / proxy universe. Recently Purchased is excluded from the ranking to avoid a tautological winner. No 60-day claim is possible.",
    table(["List", "Unique", "Proxy overlap", "Coverage", "Jaccard", "Evidence"], metrics.map(m => [m.name, m.count, `${m.overlap}/${m.proxyCount}`, `${(m.coverage * 100).toFixed(2)}%`, m.jaccard.toFixed(4), cite(m.observations[0]!)])),
    `**[ASSUMPTION] ${metrics[0]?.name ?? "No list"} is the strongest live-list candidate by Jaccard.** A floor manager confirms which list they actually use. Discontinued badge totals cannot identify discontinued rows in these exports.`,
    "## G. Floor questions", `${QUESTIONS}. This is the shared question list for all waves; no list membership automatically activates a SKU.`, twins(all),
  ];
  return { text: parts.join("\n\n") + "\n", summary: [`US Foods: ${rows.length} observations / ${items.length} items / ${proxy.length} purchase-proxy rows`, `Live-list candidate: ${metrics[0]?.name}; ${gaps.length} cross-vendor guide coverage gaps`] };
}

function receiptsReport(all: ExportRow[], catalog: CatalogRow[], guides: GuideRow[], asOf: string) {
  const rows = all.filter(r => r.receipt_doc != null);
  const vendors = [...new Set(rows.map(r => r.vendor))].sort();
  const parts = [`# Receipts vendor-export diff — ${asOf}`,
    "Generated offline from CC photo transcriptions. All receipts belong to P Street per source notes; account IDs remain source-specific. One observation per printed line, including repeated items on different receipts. Receipt date is purchase evidence, not current price entitlement. Baldor 2026-07-01 is old pricing. Freight, tax and surcharges are not silently allocated into item prices.",
    `Summary: ${rows.length} lines; ${new Set(rows.map(r => `${r.vendor}|${r.receipt_doc}`)).size} receipts; ${vendors.length} vendors. Catalog identity/price/pack fields are absent in the supplied readiness snapshot; all name matches are hypotheses.`,
    "## Input inventory", inventory(rows),
    "## A. Guide gaps", `Receipts are partial dated deliveries, not complete order guides; an unbought line is not a missing SKU. The laminate still defines order ${cite({ source_file: GUIDE, source_line: 1 })}. Boar's Head Version A pack notes are evidence about pieces/case, never fixed catch weight ${cite({ source_file: "docs/seed/source/boars-head-order-guide-vA.md", source_line: 13 })}.`,
    table(["Boar's Head laminate line absent from these receipts", "Interpretation", "Evidence"], guides.filter(g => g.section === "Boar's Head" && !rows.some(r => r.vendor === "Boar's Head" && (candidate(g.item, r) || receiptNames[r.item_no]?.toLowerCase() === g.item.toLowerCase()))).map(g => [g.item, "No purchase observation in this batch; not proof of inactivity", cite(g)])),
    "## B. Bought-but-unknown candidates",
  ];
  for (const vendor of vendors) parts.push(`### ${vendor}`, table(["Item", "Description", "Purchase", "Catalog name candidates", "Evidence"], rows.filter(r => r.vendor === vendor).map(r => [r.item_no || "not printed", r.description, `${r.last_purchase_date}: ${r.last_purchase_qty} ${r.last_purchase_uom}`, matches(r, catalog).map(s => `${s.name} ${cite(s)}`).join("; ") || "None; candidate gap only", cite(r)])));
  parts.push("## C. Item-number / description families", "Repeated receipt observations are not collapsed into one purchase. Country Snacks has no printed product number or flavor breakdown: one mixed-flavor purchase SKU, priced per case; do not create per-flavor purchase history. Thompson Delivers is a different Utz distributor and pack regime; a shared brand does not merge vendor identity.",
    "## D. Receipt prices, unit conversions and catalog deltas",
    "Catch-weight qty is printed pieces; invoice extension uses Net Wgt in pounds. Decimal cents are retained for /oz and per-roll comparisons. Catalog /oz, if supplied in dollars on an exact vendor/item identity, converts ×16 to dollars/lb; nominal pack weight never replaces measured weight. Name-only matches do not produce numeric deltas.");
  for (const vendor of vendors) parts.push(`### ${vendor}`, table(["Item / date", "Billed unit rate", "Net lb / printed qty", "Comparable unit costs", "Catalog comparison", "Evidence"], rows.filter(r => r.vendor === vendor).map(r => {
    const costs = receiptUnitCosts(r), candidates = matches(r, catalog);
    const conversion = costs.perOzCents != null ? `${money(costs.perOzCents)}/oz; weight extension ${money(costs.extendedCents)}` : costs.perEachCents != null ? `${money(costs.perEachCents)}/each` : "No unsupported unit conversion";
    const delta = candidates.length === 1 ? receiptCatalogDelta(r, candidates[0]!) : null;
    return [`${r.item_no || "not printed"} / ${r.last_purchase_date}`, `${quoted(r)}; printed ${money(r.billed_price_cents)} ${r.billed_price_basis ?? r.billed_unit ?? "basis unavailable"}`, `${r.net_wt_lb ?? "n/a"} lb / ${r.last_purchase_qty} ${r.last_purchase_uom}`, conversion, delta ? `${money(delta.delta)} delta: ${delta.reason}; ${cite(candidates[0]!)}` : "unavailable; missing or ambiguous identity/basis", cite(r)];
  })));
  const cardinal = rows.find(r => r.vendor === "Cardinal Bakery");
  parts.push("### D.1 Purchase-unit decisions", table(["Line", "Observed / calculated basis", "Evidence"], receiptPurchaseDecisions(rows).map(d => [d.label, d.text, cite(d.row)])),
    cardinal ? `Cardinal delivery Mon/Wed/Thu/Fri/Sat; order before 3 pm. ${cite(evidence(cardinal.source_file, "delivery days Mon/Wed/Thu/Fri/Sat"))}` : "No Cardinal schedule source supplied.",
    "## E. Pack mismatches", "Missing catalog packs/identity prevent a proven mismatch. Receipt quantity, pieces/case and pounds are distinct. Soda/water billed EA (case) stays per case. Country Snacks flavor names cannot reconstruct the mixed case's flavors.", packComparisons(rows, catalog),
    "## F. Purchase evidence and liveness", table(["Vendor", "Lines", "Dates", "Evidence"], vendors.map(v => { const group = rows.filter(r => r.vendor === v); return [v, group.length, [...new Set(group.map(r => r.last_purchase_date))].sort().join(", "), group.map(cite).join("; ")]; })),
    "There is no receipt-based full LIVE list. Two Cardinal and two Boar's Head deliveries demonstrate dated buying; a missing item in ten photos does not prove inactivity.",
    "## G. Floor questions", `${QUESTIONS}. Cardinal schedule and mini-chip size are answered by these sources.`, twins(all));
  return { text: parts.join("\n\n") + "\n", summary: [`Receipts: ${rows.length} observations / ${new Set(rows.map(r => `${r.vendor}|${r.receipt_doc}`)).size} receipts / ${vendors.length} vendors`, "Catalog deltas unavailable until item-number/price/basis export; invoice unit conversions retained"] };
}

export function writeWaveReports(allRows: ExportRow[], asOf: string): { path: string; summary: string[] }[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) throw new Error("Invalid as-of date");
  const { guides, catalog } = context();
  const reports = [["usfoods", usReport(allRows, catalog, guides, asOf)], ["receipts", receiptsReport(allRows, catalog, guides, asOf)]] as const;
  mkdirSync(REPORTS, { recursive: true });
  return reports.map(([name, report]) => {
    const path = join(REPORTS, `${asOf}-${name}-diff.md`);
    writeFileSync(path, report.text);
    if (readFileSync(path, "utf8") !== report.text) throw new Error(`Report readback failed: ${path}`);
    return { path, summary: report.summary };
  });
}
