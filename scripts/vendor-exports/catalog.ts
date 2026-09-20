import { readFileSync } from "node:fs";
import { contentOzForSku } from "../../lib/admin/cost-shared";
import { deriveFlatFieldsFromChain } from "../../lib/admin/catalog-shared";
import { buildPackChain, chainRootLabel, formatChainDescriptor, validateChainStructure, type PackChainLevel } from "../../lib/pack-chain-shared";
import { skuCostPerOz, type MeasureUnitFactor } from "../../lib/recipe-math";
import type { CatalogRow, Evidence } from "./diff-core";

export const CATALOG_FILE = "docs/seed/source/vendor-exports/context/catalog-prod-2026-09-19.json";
type Numeric = number | string | null;
export interface ProdSku {
  id: string; vendor_id: string | null; location_id: string | null; name: string;
  item_number: string | null; active: boolean; sku_class: string | null;
  pack_format: string | null; units_per_pack: Numeric; each_size: Numeric;
  each_measure: string | null; avg_oz_per_each: Numeric;
}
export interface ProdPrice { id: string; vendor_item_id: string; unit_price: Numeric; effective_date: string; recorded_at: string | null }
export interface ProdExport {
  exported_at: string;
  locations: { id: string; code: string; name: string }[];
  vendors: { id: string; name: string; active: boolean }[];
  vendor_items: ProdSku[];
  sku_pack_levels: { id: string; sku_id: string; label: string; contains_qty: Numeric; contains_level_id: string | null; contains_measure_unit: string | null; display_ordinal: number; active: boolean }[];
  measure_units: { label: string; dimension: "weight" | "volume" | "count"; to_base_factor: Numeric; active: boolean }[];
  vendor_price_history: ProdPrice[];
  location_sku_settings: unknown[];
  vendor_order_guides: { id: string; vendor_id: string; name: string; updated_at: string }[];
  order_guide_sections: { id: string; guide_id: string; name: string; position: number }[];
  order_guide_lines: { id: string; section_id: string; position: number; sku_id: string | null; label: string | null; item_number: string | null; note: string | null }[];
  counts: Record<string, number>;
}

const num = (value: Numeric): number | null => value == null || !Number.isFinite(Number(value)) ? null : Number(value);

/** The citation addresses the physical id property, not an inferred row ordinal. */
export function sourceForId(text: string, sourceFile: string, id: string): Evidence {
  const pattern = new RegExp(`"id"\\s*:\\s*${JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const match = pattern.exec(text);
  if (!match) throw new Error(`Missing physical id citation: ${id}`);
  return { source_file: sourceFile, source_line: text.slice(0, match.index).split("\n").length };
}

/** Offline mirror of lib/admin/cost.ts:87–110 loadCurrentSkuPrices (DB-only loader).
 * Same effective_date DESC, recorded_at DESC, id DESC; pure costing is imported above. */
export function latestPrices(prices: readonly ProdPrice[]): Map<string, ProdPrice> {
  const instant = (value: string): bigint => BigInt(Date.parse(value)) * BigInt(1000) + BigInt((/\.(\d+)/.exec(value)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
  const recordedOrder = (a: string | null, b: string | null): number => {
    if (a == null) return b == null ? 0 : -1;
    if (b == null) return 1;
    const x = instant(a), y = instant(b);
    return x < y ? 1 : x > y ? -1 : 0;
  };
  const ordered = [...prices].sort((a, b) => b.effective_date.localeCompare(a.effective_date)
    // PostgreSQL DESC puts NULL first unless NULLS LAST was requested.
    || recordedOrder(a.recorded_at, b.recorded_at)
    || b.id.localeCompare(a.id));
  const result = new Map<string, ProdPrice>();
  for (const price of ordered) if (!result.has(price.vendor_item_id) && num(price.unit_price) != null) result.set(price.vendor_item_id, price);
  return result;
}

/** Display spelling only; the production pure functions own all cost conversion. */
export function derivePack(sku: Pick<ProdSku, "pack_format" | "units_per_pack" | "each_size" | "each_measure">): string | null {
  const qty = num(sku.units_per_pack), size = num(sku.each_size);
  if (qty == null || size == null || !sku.each_measure) return null;
  const units: Record<string, string> = { oz: "OZ", lb: "LB", each: "EA", can: "CN", gram: "GR", gallon: "GA", quart: "QT", liter: "LT", dozen: "DZ", foot: "FT", roll: "RL" };
  return `${qty}/${size} ${units[sku.each_measure] ?? sku.each_measure.toUpperCase()}`;
}

function purchaseUom(basis: string | null): string | null {
  if (!basis) return null;
  const aliases: Record<string, string> = { case: "CS", "each (no case)": "EA", each: "EA", piece: "EA", pack: "PK", box: "BX", bag: "BG", tub: "TB", jug: "JG", jar: "JR", flat: "FL" };
  return aliases[basis.toLowerCase()] ?? basis.toUpperCase();
}

export function parseCatalog(text: string, sourceFile: string): { catalog: CatalogRow[]; data: ProdExport } {
  const data = JSON.parse(text.replace(/^\uFEFF/, "")) as ProdExport;
  for (const [table, expected] of Object.entries(data.counts)) {
    const rows = data[table as keyof ProdExport];
    if (!Array.isArray(rows) || rows.length !== expected) throw new Error(`Export count mismatch: ${table}, expected ${expected}`);
  }
  const vendors = new Map(data.vendors.map(v => [v.id, v.name]));
  const locations = new Map(data.locations.map(l => [l.id, l.code]));
  const measures = new Map<string, MeasureUnitFactor>(data.measure_units.filter(m => m.active).map(m => [m.label, { dimension: m.dimension, toBaseFactor: num(m.to_base_factor) ?? 0 }]));
  const prices = latestPrices(data.vendor_price_history);
  const catalog = data.vendor_items.map((sku): CatalogRow => {
    if (sku.vendor_id && !vendors.has(sku.vendor_id)) throw new Error(`Unknown vendor for SKU ${sku.id}`);
    if (sku.location_id && !locations.has(sku.location_id)) throw new Error(`Unknown location for SKU ${sku.id}`);
    const rows = data.sku_pack_levels.filter(p => p.sku_id === sku.id && p.active).sort((a, b) => a.display_ordinal - b.display_ordinal);
    const levels: PackChainLevel[] = rows.map(p => ({ id: p.id, label: p.label, containsQty: num(p.contains_qty) ?? 0, containsLevelId: p.contains_level_id, containsMeasureUnit: p.contains_measure_unit, displayOrdinal: p.display_ordinal }));
    const chain = buildPackChain(levels);
    const flat = deriveFlatFieldsFromChain(levels.map(p => ({ label: p.label, containsQty: p.containsQty, containsIndex: p.containsLevelId == null ? null : levels.findIndex(other => other.id === p.containsLevelId), containsMeasureUnit: p.containsMeasureUnit })));
    const basis = levels.length ? chainRootLabel(chain) : sku.pack_format;
    let pack = derivePack(sku);
    if (levels.length) {
      pack = null;
      if (validateChainStructure(chain, measures).ok) {
        const quantities: number[] = [];
        let level = chain.byLabel.get(basis!);
        while (level) {
          quantities.push(level.containsQty);
          if (level.containsLevelId == null) {
            const leaf = derivePack({ pack_format: basis, units_per_pack: 1, each_size: level.containsQty, each_measure: level.containsMeasureUnit });
            if (leaf) pack = `${quantities.length === 1 ? "1/" : ""}${quantities.join("/")} ${leaf.slice(leaf.indexOf(" ") + 1)}`;
            break;
          }
          level = chain.byId.get(level.containsLevelId);
        }
      }
    }
    const content = contentOzForSku({ unitsPerPack: num(sku.units_per_pack), eachSize: num(sku.each_size), eachMeasure: sku.each_measure, avgOzPerEach: num(sku.avg_oz_per_each) }, levels, measures);
    const price = prices.get(sku.id), dollars = price ? num(price.unit_price) : null;
    const cpo = skuCostPerOz(dollars, content);
    const evidence = sourceForId(text, sourceFile, sku.id);
    const packEvidence = [evidence, ...rows.map(row => sourceForId(text, sourceFile, row.id))];
    for (const label of new Set([...levels.map(p => p.containsMeasureUnit), sku.each_measure])) {
      if (!label || !measures.has(label)) continue;
      // Restrict search to the registry: chain labels can equal other SKU labels.
      const start = text.indexOf('"measure_units"');
      const match = new RegExp(`"label"\\s*:\\s*${JSON.stringify(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(text.slice(start));
      if (match) packEvidence.push({ source_file: sourceFile, source_line: text.slice(0, start + match.index).split("\n").length });
    }
    return { ...evidence, id: sku.id, name: sku.name, vendor_id: sku.vendor_id, vendor: sku.vendor_id ? vendors.get(sku.vendor_id) ?? null : null,
      active: sku.active, location_code: sku.location_id ? locations.get(sku.location_id) ?? null : null, sku_class: sku.sku_class,
      item_number: sku.item_number, pack, flat_pack: derivePack(sku), chain_descriptor: formatChainDescriptor(chain), uom: purchaseUom(basis),
      pack_format: sku.pack_format, units_per_pack: num(sku.units_per_pack), each_size: num(sku.each_size), each_measure: sku.each_measure,
      price_cents: dollars == null ? null : Math.round(dollars * 10000) / 100, price_per_oz: cpo,
      price_per_lb_cents: cpo == null ? null : cpo * 1600, price_basis: basis, price_date: price?.effective_date ?? null,
      ...(price ? { price_evidence: sourceForId(text, sourceFile, price.id) } : {}), pack_evidence: packEvidence, content_oz: content,
      cost_is_estimate: content != null && measures.get(levels.length ? flat.eachMeasure ?? "" : sku.each_measure ?? "")?.dimension !== "weight" };
  });
  return { catalog, data };
}

export function loadCatalog(): { catalog: CatalogRow[]; data: ProdExport } {
  return parseCatalog(readFileSync(CATALOG_FILE, "utf8"), CATALOG_FILE);
}
