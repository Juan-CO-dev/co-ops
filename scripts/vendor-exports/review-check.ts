/** Offline: npx tsx scripts/vendor-exports/review-check.ts [review.csv] [catalog.json] */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProdExport } from "./catalog";
import { parseCsv } from "./parsers";

export const REVIEW_COLUMNS = ["row_id", "kind", "vendor", "sku_id", "sku_name", "item_number", "current", "proposed", "basis", "confidence", "evidence", "needs_juan", "note"] as const;
export const REVIEW_KINDS = ["dedupe_level", "price_conflict", "price_basis", "item_number", "vendor_merge", "guide_absent"] as const;
type Kind = typeof REVIEW_KINDS[number];
type ReviewRow = Record<typeof REVIEW_COLUMNS[number], string>;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const BASES = ["per_case", "per_each", "per_lb", "per_dozen", "per_bundle"];

/** Checks identifiers against this offline snapshot; does not authorize the proposed changes. */
export function checkReview(csv: string, catalog: ProdExport) {
  const records = parseCsv(csv);
  if (records.shift()?.cells.join(",") !== REVIEW_COLUMNS.join(",")) throw new Error("Review CSV header mismatch");
  if (!records.length) throw new Error("Review CSV is empty");
  const ids = new Set<string>();
  for (const value of Object.values(catalog)) if (Array.isArray(value)) {
    for (const row of value as { id?: string }[]) if (row.id) ids.add(row.id.toLowerCase());
  }
  const skus = new Map(catalog.vendor_items.map(s => [s.id, s]));
  const vendors = new Map(catalog.vendors.map(v => [v.id, v.name]));
  const levels = new Map(catalog.sku_pack_levels.map(l => [l.id, l]));
  const prices = new Map(catalog.vendor_price_history.map(p => [p.id, p]));
  const guideLines = new Map((catalog.order_guide_lines ?? []).map(l => [l.id, l]));
  const fieldIds: Record<string, Set<string>> = {
    sku_id: new Set(skus.keys()), vendor_item_id: new Set(skus.keys()),
    vendor_id: new Set(vendors.keys()), contains_level_id: new Set(levels.keys()),
    "sku_pack_levels.id": new Set(levels.keys()),
    guide_line_id: new Set(guideLines.keys()),
  };
  const counts = Object.fromEntries(REVIEW_KINDS.map(k => [k, 0])) as Record<Kind, number>;
  const rowIds = new Set<string>();
  let needsJuan = 0, lastKind = -1;
  for (const record of records) {
    const fail = (message: string): never => { throw new Error(`CSV line ${record.line}: ${message}`); };
    if (record.cells.length !== REVIEW_COLUMNS.length) fail("column count mismatch");
    const row = Object.fromEntries(REVIEW_COLUMNS.map((key, i) => [key, record.cells[i]!])) as ReviewRow;
    if (!row.row_id.trim() || rowIds.has(row.row_id)) fail("missing or duplicate row_id");
    rowIds.add(row.row_id);
    const kindIndex = REVIEW_KINDS.indexOf(row.kind as Kind);
    if (kindIndex < 0) fail(`unknown kind ${row.kind}`);
    if (kindIndex < lastKind) fail("kind sections out of order");
    lastKind = kindIndex;
    if (!["true", "false"].includes(row.needs_juan)) fail("needs_juan must be true or false");
    if (!["high", "medium", "low"].includes(row.confidence)) fail("invalid confidence");
    if (!row.evidence.trim()) fail("missing evidence");
    if (row.kind === "price_basis" && !BASES.includes(row.proposed)) fail("invalid proposed price basis");
    if (["dedupe_level", "price_conflict", "price_basis", "item_number"].includes(row.kind) && !row.sku_id) {
      // Juan's explicit amendment targets the existing unlinked Eggs guide line.
      let target: { guide_line_id?: string; sku_id?: string | null } = {};
      try { target = JSON.parse(row.current); } catch { fail("missing sku_id"); }
      const line = guideLines.get(target.guide_line_id ?? "");
      const section = catalog.order_guide_sections?.find(s => s.id === line?.section_id);
      const guide = catalog.vendor_order_guides?.find(g => g.id === section?.guide_id);
      if (row.kind !== "item_number" || !line || line.sku_id !== null || target.sku_id !== null
        || line.label?.trim() !== "Eggs" || row.proposed !== "517842"
        || !guide || vendors.get(guide.vendor_id) !== row.vendor) fail("missing sku_id or invalid unlinked Eggs amendment");
    }
    const sku = row.sku_id ? skus.get(row.sku_id) : undefined;
    if (row.sku_id && !sku) fail(`unknown sku_id ${row.sku_id}`);
    if (sku && (sku.vendor_id ? row.vendor !== vendors.get(sku.vendor_id) : !["", "unassigned"].includes(row.vendor))) fail("SKU/vendor mismatch");
    if (sku && row.sku_name !== sku.name) fail("SKU/name mismatch");
    for (const cell of record.cells) for (const id of cell.match(UUID) ?? []) {
      if (!ids.has(id.toLowerCase())) fail(`unknown identifier ${id}`);
    }
    for (const cell of [row.current, row.proposed]) {
      // A known pack/price identifier from another SKU is still an invalid target.
      if (sku) for (const id of cell.match(UUID) ?? []) {
        if (levels.has(id) && levels.get(id)!.sku_id !== sku.id) fail(`pack level belongs to another SKU: ${id}`);
        if (prices.has(id) && prices.get(id)!.vendor_item_id !== sku.id) fail(`price belongs to another SKU: ${id}`);
      }
      if (/^[\[{]/.test(cell.trim())) {
        let parsed: unknown;
        try { parsed = JSON.parse(cell); } catch { fail("malformed current/proposed JSON"); }
        const walk = (value: unknown): void => {
          if (Array.isArray(value)) { value.forEach(walk); return; }
          if (value == null || typeof value !== "object") return;
          for (const [key, child] of Object.entries(value)) {
            if (row.kind === "dedupe_level" && ["survivor_ids", "survivor_source_ids", "retire_ids"].includes(key)) {
              if (!Array.isArray(child) || child.some(id => typeof id !== "string" || !levels.has(id))) fail(`unknown pack level in ${key}`);
            }
            const rowIds = key === "id" && row.kind === "dedupe_level" ? new Set(levels.keys())
              : row.kind === "price_conflict" && ["id", "survivor_id", "latest_id", "latest_price_id"].includes(key) ? new Set(prices.keys()) : undefined;
            const allowed = fieldIds[key] ?? rowIds ?? (key === "id" || key.endsWith("_id") ? ids : undefined);
            if (allowed && child != null && (typeof child !== "string" || !allowed.has(child))) fail(`unknown ${key}: ${String(child)}`);
            if (sku && ["sku_id", "vendor_item_id"].includes(key) && child != null && child !== sku.id) fail(`${key} belongs to another SKU`);
            walk(child);
          }
        };
        walk(parsed);
      }
    }
    counts[row.kind as Kind]++;
    if (row.needs_juan === "true") needsJuan++;
  }
  return { counts, needsJuan, total: records.length };
}

export function formatReviewCounts(result: ReturnType<typeof checkReview>): string {
  return [...REVIEW_KINDS.map(kind => `${kind}: ${result.counts[kind]}`), `needs_juan: ${result.needsJuan}`, `total: ${result.total}`].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const csv = readFileSync(process.argv[2] ?? "docs/seed/source/vendor-exports/review/seed38-review.csv", "utf8");
    const catalog = JSON.parse(readFileSync(process.argv[3] ?? "docs/seed/source/vendor-exports/context/catalog-prod-2026-09-19.json", "utf8").replace(/^\uFEFF/, "")) as ProdExport;
    console.log(formatReviewCounts(checkReview(csv, catalog)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
