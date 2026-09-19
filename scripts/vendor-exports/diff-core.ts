import type { ExportRow } from "./model";
import { parsePack } from "./parsers";

export interface Evidence { source_file: string; source_line: number }
export interface GuideRow extends Evidence { item: string; item_number: string; section: string; vendor: string }
export interface CatalogRow extends Evidence {
  id: string; name: string; vendor: string | null;
  // Optional enrichment contract. Missing properties are NOT evidence of a null database value.
  item_number?: string | null; pack?: string | null; uom?: string | null;
  price_cents?: number | null; price_per_lb_cents?: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Review-only semantic family suggestions, not approved SKU identities/substitutions. */
const families: Record<string, RegExp> = {
  "eggs": /egg white (large|medium).*loose/i,
  "eggs cooked": /egg hard cooked/i,
  "fresh mozzarella": /cheese mozzarella.*(log|fresh)/i,
  "shredded mozz": /cheese mozzarella.*shredded/i,
  "parmesan grated": /cheese parmesan grated/i,
  "garlic": /garlic whole peeled/i,
  "basil": /basil fresh/i,
  "oregano": /oregano leaves/i,
  "onion white": /onion yellow/i,
  "onion red": /onion red/i,
  "heavy cream": /cream heavy/i,
  "cheddar": /cheese cheddar/i,
  "iceberg": /lettuce.*iceberg/i,
  "tomatoes": /tomato [56]x[56]/i,
  "lemon juice": /juice lemon (all|frozen)/i,
  "employee water": /water purified drinking/i,
  "saratoga": /water sparkling.*saratoga/i,
  "tuna": /tuna chunk light/i,
  "duke s mayo": /mayonnaise.*dukes/i,
  "chili flake": /pepper red crushed/i,
  "balsamic vin": /vinegar balsamic/i,
  "balsamic glaze": /glaze balsamic/i,
  "black peppercorn": /pepper black whole/i,
  "confectioners sugar": /sugar powdered/i,
  "mustard whole": /mustard dijon grain/i,
  "mustard dijon": /mustard dijon(?! grain)/i,
  "old bay": /seasoning.*old bay/i,
  "panko japanese": /bread crumbs.*panko/i,
  "roasted red peppers": /peppers red fire roasted/i,
  "tomatoes crushed 10": /tomato crushed/i,
  "tomato paste": /paste tomato/i,
  "ground beef": /beef ground/i,
  "ground pork": /pork ground/i,
  "natalie s lemonade": /juice lemonade.*natalies/i,
  "foil pick up sheets": /foil sheet interfold/i,
  "foil roll": /foil standard.*roll/i,
  "beef base": /base beef/i,
  "gloves extra large": /glove.*extra.large/i,
  "gloves large": /glove.*(?<!extra.)large/i,
  "gloves medium": /glove.*medium/i,
  "plastic forks": /fork plastic/i,
  "plastic spoons": /spoon.*plastic/i,
  "plastic knives": /knife plastic/i,
  "paper deli sheets wax paper": /wrap.*paper.*(wax|deli)/i,
  "reciept paper thermal": /roll register.*thermal/i,
  "2 oz portion cup lids": /lid portion cup.*1.5-2.5/i,
  "2 oz portion cups": /cup portion.*two ounce/i,
  "half pint 8oz hard": /container.*(eight ounce|8 ounce)/i,
  "1 2 pint bottoms flexi": /container.*(eight ounce|8 ounce)/i,
  "1 2 pint top flexi": /lid container.*8-32/i,
  "quart large": /container.*32 ounce/i,
  "pint medium": /container.*16 ounce/i,
  "kraft 10x5x13 small bags": /bag paper.*bistro/i,
  "kraft 12x9x13 large bags": /bag paper.*regal/i,
  "c fold napkins": /napkin/i,
};

export function descriptionCandidate(label: string, row: ExportRow): boolean {
  const n = norm(label);
  if (n === "dried chives") return false; // Fresh is evidence for a question, never a dried match.
  const text = `${row.description} ${row.brand}`;
  if (families[n]) return families[n]!.test(text);
  const tokens = n.split(" ").filter(t => t.length > 1);
  const target = norm(text).split(" ");
  return tokens.length > 0 && tokens.every(t => target.includes(t));
}

/** Identity is vendor + account + item. Reject mixed scopes before any comparison. */
export function uniqueItems(rows: readonly ExportRow[]): ExportRow[] {
  const scopes = new Set(rows.map(r => `${r.vendor}:${r.account_id}`));
  if (scopes.size > 1) throw new Error("Diff requires exactly one vendor/account scope");
  const groups = new Map<string, ExportRow[]>();
  for (const row of rows) groups.set(row.item_no, [...(groups.get(row.item_no) ?? []), row]);
  return [...groups.values()].map(group => [...group].sort((a, b) =>
    b.exported_at.localeCompare(a.exported_at) ||
    (b.last_purchase_date ?? "").localeCompare(a.last_purchase_date ?? "") ||
    Number(b.list_name === "Purchase History") - Number(a.list_name === "Purchase History") ||
    a.source_file.localeCompare(b.source_file) || a.source_line - b.source_line,
  )[0]!).sort((a, b) => a.item_no.localeCompare(b.item_no));
}

export function recent(row: ExportRow, asOf: string): boolean {
  const day = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== asOf) throw new Error("Invalid as-of date");
  if (!row.last_purchase_date) return false;
  const date = Date.parse(`${row.last_purchase_date}T00:00:00Z`);
  // Exactly 60 calendar dates, inclusive of as-of (2026-07-21..2026-09-18).
  return date >= day - 59 * 86400000 && date <= day;
}

export function matchGuide(guide: GuideRow, rows: readonly ExportRow[]) {
  const direct = rows.filter(r => r.item_no === guide.item_number);
  const candidates = rows.filter(r => descriptionCandidate(guide.item, r));
  return { guide, direct, candidates, gap: !direct.length && !candidates.length };
}

export function catalogCandidates(row: ExportRow, catalog: readonly CatalogRow[], guides: readonly GuideRow[]) {
  const sameVendor = catalog.filter(s => s.vendor?.toLowerCase() === row.vendor.toLowerCase());
  const exact = sameVendor.filter(s => s.item_number === row.item_no);
  if (exact.length) return { method: "item number", skus: exact };
  const skus = sameVendor.filter(s => {
    if (s.item_number) return false; // A known different item number is never silently substituted.
    if (descriptionCandidate(s.name, row)) return true;
    // Borrow the laminate number only through the same named catalog SKU, never through an ambiguous egg mapping.
    return !/^eggs(?: cooked)?$/.test(norm(s.name)) && guides.some(g => norm(g.item) === norm(s.name) && g.item_number === row.item_no);
  });
  return { method: "[ASSUMPTION] name/family; item number absent in snapshot", skus };
}

export function packEqual(a: string, b: string): boolean | null {
  const x = parsePack(a), y = parsePack(b);
  if (x.pack_unparsed || y.pack_unparsed) return null;
  return x.pack_qty === y.pack_qty && x.pack_size === y.pack_size && x.pack_unit === y.pack_unit;
}

export function priceDelta(sku: CatalogRow, row: ExportRow, asOf: string) {
  const lb = row.price_per_lb_cents != null;
  const before = lb ? sku.price_per_lb_cents : sku.price_cents;
  const after = lb ? row.price_per_lb_cents : row.price_cents;
  let reason: string | null = null;
  if (before == null || after == null) reason = "catalog price/basis unavailable";
  else if (!sku.pack || packEqual(sku.pack, row.pack) !== true || sku.uom !== row.uom) reason = "pack/UOM not proven comparable";
  const delta = reason ? null : after! - before!;
  const weight = !recent(row, asOf) ? 0 : row.last_purchase_uom === (lb ? "LB" : row.uom) ? row.last_purchase_qty : null;
  return { delta, percent: delta != null && before! > 0 ? delta / before! * 100 : null,
    impact: delta != null && weight != null ? Math.abs(delta * weight) : null, weight, reason };
}

export function listMetrics(rows: readonly ExportRow[], asOf: string) {
  const purchased = new Set(uniqueItems(rows).filter(r => recent(r, asOf)).map(r => r.item_no));
  const history = new Set(rows.filter(r => r.list_name === "Purchase History").map(r => r.item_no));
  const lists = [...new Set(rows.filter(r => r.list_name !== "Purchase History").map(r => r.list_name))];
  return lists.map(name => {
    const observations = rows.filter(r => r.list_name === name);
    const ids = new Set(observations.map(r => r.item_no));
    const overlap = [...ids].filter(id => purchased.has(id)).length;
    const historyOverlap = [...ids].filter(id => history.has(id)).length;
    return { name, observations, count: ids.size, overlap, recentCount: purchased.size,
      coverage: purchased.size ? overlap / purchased.size : 0,
      jaccard: new Set([...ids, ...purchased]).size ? overlap / new Set([...ids, ...purchased]).size : 0,
      historyJaccard: new Set([...ids, ...history]).size ? historyOverlap / new Set([...ids, ...history]).size : 0 };
  }).sort((a, b) => b.jaccard - a.jaccard || a.name.localeCompare(b.name));
}

export function buildDiff(rows: readonly ExportRow[], guides: readonly GuideRow[], catalog: readonly CatalogRow[], asOf: string) {
  const items = uniqueItems(rows);
  const guideMatches = guides.map(g => matchGuide(g, items));
  const matches = items.map(row => ({ row, ...catalogCandidates(row, catalog, guides) }));
  const comparisons = matches.flatMap(m => m.skus.length === 1 ? [{ row: m.row, sku: m.skus[0]!, method: m.method, price: priceDelta(m.skus[0]!, m.row, asOf) }] : [])
    .sort((a, b) => (b.price.impact ?? -1) - (a.price.impact ?? -1) || a.sku.name.localeCompare(b.sku.name) || a.row.item_no.localeCompare(b.row.item_no));
  return { items, guideMatches, matches, comparisons,
    gaps: guideMatches.filter(m => m.gap),
    unmatchedPurchases: matches.filter(m => recent(m.row, asOf) && !m.skus.length),
    conflicts: guideMatches.filter(m => new Set([...m.direct, ...m.candidates].map(r => r.item_no)).size > 1),
    lists: listMetrics(rows, asOf) };
}
