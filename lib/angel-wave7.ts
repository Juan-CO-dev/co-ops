/** Angel mapping wave: reviewed identities, physical units and immutable intents. Zero I/O. */
import { parsePurchaseHistory, invoiceAverageLbs, VARIABLE_CATCH_RULES, type PurchaseRow } from "@/lib/angel-wave4";
import { parseAngelDate } from "@/lib/angel-wave2";
import { buildPackChain, chainRootLabel, validateChainStructure, firstLabelMeasureCollision, type PackChainLevel } from "@/lib/pack-chain-shared";
import { skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";
import { deriveFlatFieldsFromChain, type StarterChainLevel } from "@/lib/admin/catalog-shared";

export const SOURCE = "angel-wave7-2026-09-10";
export const STALE_DAYS = 30;
export type RawRow = Record<string, unknown>;
export interface Snapshot { sku: RawRow; vendor: RawRow | null; chain: RawRow[]; price: RawRow | null }
export interface ManifestRow {
  revision: string;
  owner_pack?: { pack: string; source: string };
  angel: { product: string; brand: string; manufacturer: string; vendor: string; pack_size: string; source_file: string; source_line: number; weight_source: string; [key: string]: unknown };
  selected_sku: { id: string; name: string; vendor: string; pack_format: string | null; active: boolean; item_number: string } | null;
  decision: "selected" | "pending" | "rejected";
  vendor_binding: "vendor-match" | "VENDOR_DRIFT" | "pending" | "n/a";
  confidence: string; evidence: string; meaning: string; owner_question: string; owner_answer: string; row_n: number;
}
export interface Manifest { wave: string; built_by: string; rows: ManifestRow[] }
export const REFUSAL_TEMPLATES = {
  MAPPING_UNCONFIRMED: "REFUSED {row}: MEDIUM mapping has no Juan confirmation; select the SKU before importing.",
  NO_MATCH: "EXCLUDED {row}: confidence NONE; wave 7 writes nothing for this row.",
  AMBIGUOUS_PRODUCT_IDENTITY: "REFUSED {row}: {Angel product} conflicts with {SKU identity}; confirm the actual product.",
  SKU_UNRESOLVED: "REFUSED {row}: expected one active SKU in scope; found {n}.",
  VENDOR_DRIFT: "REFUSED {row}: Angel vendor {A} is not SKU vendor {B}; no explicit binding evidence exists.",
  VENDOR_UNREGISTERED: "REFUSED {row}: selected vendor is absent or inactive.",
  DUPLICATE_CLUSTER: "REFUSED {SKU}: competing Angel rows produce {prices}; select the row of record.",
  LATEST_INVOICE_AMBIGUOUS: "REFUSED {row}: latest date {date} contains conflicting prices without an invoice ordering key.",
  SOURCE_JOIN_FAILED: "REFUSED {row}: no unique product/brand/vendor/pack join to purchase history.",
  INVALID_SOURCE_DATA: "REFUSED {row}: invalid {field}, inconsistent totals, duplicate observations, or unsupported date.",
  OUR_PACK_UNRESOLVABLE: "REFUSED {SKU}: one priced pack is undefined; supply its physical contents.",
  PACK_PREMISE_BROKEN: "REFUSED {SKU}: Angel {pack} and our {pack} have no proven relationship.",
  UNSUPPORTED_PACK_SYNTAX: "REFUSED {row}: pack \"{text}\" cannot be parsed without inventing a quantity.",
  NO_MEASURED_INVOICE_WEIGHT: "REFUSED weight {row}: no valid net invoice weight; {source} is not evidence.",
  WEIGHT_GRAIN_MISMATCH: "REFUSED weight {SKU}: invoice measures {unit A}; this field measures {unit B}.",
  OPERATIONAL_KEEP_LIVE: "KEEP weight {SKU}: OPERATIONAL {value}; invoice import cannot overwrite it.",
  WEIGHT_EVIDENCE_UNCLASSIFIED: "REFUSED weight {SKU}: existing value has no recognized evidence class.",
  SCALE_GATED: "REFUSED weight {row}: known tare, multiplier, or constant-weight anomaly needs net-weight confirmation.",
  STALE_ANGEL_PRICE: "REFUSED price {SKU}: Angel {date} is {age} days old; newer app price {date} already exists; N=30.",
  NEWER_PRICE_EXISTS: "REFUSED {SKU}: newer price evidence wins; the proposed bundle would regress its basis.",
  PACK_SHAPE_CHANGED: "REFUSED {SKU}: pack, weight, vendor, or price head changed after review; rerun dry-run.",
  INVALID_CHAIN: "REFUSED chain {SKU}: {collision/cycle/multiple roots/dangling pointer/invalid quantity}.",
  SOURCE_PAYLOAD_DRIFT: "REFUSED {SKU}: this wave/revision already exists with different content; create an explicit correction.",
  ALREADY_CORRECT: "ALREADY {SKU}: price, chain and provenance match this approved operation; zero writes.",
} as const;
export type RefusalCode = keyof typeof REFUSAL_TEMPLATES;
export interface Refusal { code: RefusalCode; message: string; operation: string; missingFact: string }
export function refusal(code: RefusalCode, context: Record<string, string | number | (string | number)[]>, operation = "bundle", missingFact = "Resolve the fact named above."): Refusal {
  const used: Record<string, number> = {};
  const message = REFUSAL_TEMPLATES[code].replace(/\{([^}]+)\}/g, (_, key: string) => {
    const val = context[key];
    if (val == null) throw new Error(`Missing refusal placeholder: ${code}/${key}`);
    if (!Array.isArray(val)) return String(val);
    const index = used[key] ?? 0; used[key] = index + 1;
    if (val[index] == null) throw new Error(`Missing repeated refusal placeholder: ${code}/${key}`);
    return String(val[index]);
  });
  return { code, message, operation, missingFact };
}
export function canonical(value: unknown): string {
  if (value === undefined) throw new Error("Undefined cannot enter an operation payload");
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}
const positive = (v: number | null): v is number => v != null && v > 0 && Number.isFinite(v);
const round = (v: number, digits = 4) => Math.round((v + Number.EPSILON) * 10 ** digits) / 10 ** digits;
const clean = (s: string) => ["", "-", "—"].includes(s.trim()) ? "" : s.trim();
export function identityKey(product: string, brand: string, vendor: string, pack: string): string {
  return JSON.stringify([product, brand, vendor, pack].map(clean));
}
export function isoDate(text: string): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : parseAngelDate(text);
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
export const dateAge = (date: string, asOf: string) => Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
export function readManifest(text: string): Manifest {
  const data = JSON.parse(text) as Manifest;
  if (data.wave !== SOURCE || !Array.isArray(data.rows) || !data.built_by) throw new Error("Invalid wave-7 manifest header");
  const seen = new Set<number>();
  for (const r of data.rows) {
    if (!Number.isInteger(r.row_n) || r.row_n <= 0 || seen.has(r.row_n) || !r.revision || !r.angel || !["selected", "pending", "rejected"].includes(r.decision) || !["vendor-match", "VENDOR_DRIFT", "pending", "n/a"].includes(r.vendor_binding)) throw new Error("Invalid wave-7 reviewed row");
    for (const key of ["product", "brand", "manufacturer", "vendor", "pack_size", "source_file", "weight_source"] as const) if (typeof r.angel[key] !== "string") throw new Error("Invalid Angel identity");
    if (r.owner_pack !== undefined && (!r.owner_pack || typeof r.owner_pack.pack !== "string" || !r.owner_pack.pack.trim() || typeof r.owner_pack.source !== "string" || !r.owner_pack.source.trim() || !parsePack(r.owner_pack.pack) || parsePack(r.angel.pack_size))) throw new Error("Invalid wave-7 reviewed row");
    if (!Number.isInteger(r.angel.source_line) || r.angel.source_line < 2 || typeof r.evidence !== "string") throw new Error("Missing mapping evidence");
    if (r.decision === "selected" && (!r.selected_sku || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(r.selected_sku.id) || !r.evidence.trim())) throw new Error("Selected mapping lacks exact SKU/evidence");
    seen.add(r.row_n);
  }
  return data;
}
export const parseHistory = parsePurchaseHistory;
export interface InvoiceSelection { rows: PurchaseRow[]; latest: PurchaseRow; date: string; average: ReturnType<typeof invoiceAverageLbs> }
export function selectInvoices(row: ManifestRow, history: readonly PurchaseRow[], asOf: string): InvoiceSelection | Refusal {
  const a = row.angel, context = { row: `${a.source_file}:${a.source_line} ${a.product}` };
  const rows = history.filter(h => identityKey(h.product, h.brand, h.vendor, h.packSize) === identityKey(a.product, a.brand, a.vendor, a.pack_size));
  if (!rows.length) return refusal("SOURCE_JOIN_FAILED", context);
  const seen = new Set<string>();
  for (const h of rows) {
    const date = isoDate(h.date), key = canonical(h);
    if (!date || date > asOf || !positive(h.quantity) || !positive(h.unitPricePerCase) || !positive(h.lineTotal) || Math.abs(h.quantity * h.unitPricePerCase - h.lineTotal) > Math.max(0.025, h.quantity * 0.0001) || seen.has(key)) return refusal("INVALID_SOURCE_DATA", { ...context, field: "date/quantity/price/line_total" });
    if (h.weightSource === "invoice_catch_weight" && (!positive(h.netWeightLbs) || !positive(h.lbsPerUnit) || Math.abs(h.netWeightLbs / h.quantity - h.lbsPerUnit) > 0.001)) return refusal("INVALID_SOURCE_DATA", { ...context, field: "net_weight_lbs/lbs_per_unit" });
    seen.add(key);
  }
  const ordered = [...rows].sort((a, b) => isoDate(b.date)!.localeCompare(isoDate(a.date)!));
  const latest = ordered[0]!, date = isoDate(latest.date)!;
  const sameDay = ordered.filter(h => isoDate(h.date) === date);
  // Pieces are priced by pound; manufactured packs are priced by case. Variation
  // in the OTHER rounded figure does not create conflicting contractual prices.
  const rates = sameDay.map(h => PIECES[a.product] ? h.pricePerLb : h.unitPricePerCase);
  if (new Set(rates).size > 1) return refusal("LATEST_INVOICE_AMBIGUOUS", { ...context, date });
  return { rows, latest, date, average: invoiceAverageLbs(rows) };
}
export interface ParsedPack { groups: number; size: number; dimension: "weight" | "volume" | "count" | "can" | "roll"; total: number; unit: string }
/** Anchored pack text only: never harvest quantities from the product's name. */
export function parsePack(text: string): ParsedPack | null {
  const t = clean(text).toUpperCase().replace(/\s+/g, " ");
  const m = /^(?:(\d+)\s*\/\s*)?(\d+(?:\.\d+)?)\s*(CT|EA|LB|OZ|FL OZ|GA|GAL|QT|PT|LT|L|ML|RL)$/.exec(t);
  if (m) {
    const groups = Number(m[1] ?? 1), size = Number(m[2]), unit = m[3]!;
    if (!positive(groups) || !positive(size) || groups > 100000 || size > 100000) return null;
    const dimension = /^(CT|EA)$/.test(unit) ? "count" : unit === "RL" ? "roll" : /^(LB|OZ)$/.test(unit) ? "weight" : "volume";
    if ((dimension === "count" || dimension === "roll") && (!Number.isInteger(size) || (dimension === "roll" && (size !== 1 || groups !== 1)))) return null;
    const factor = ({ LB: 16, OZ: 1, "FL OZ": 1, GA: 128, GAL: 128, QT: 32, PT: 16, LT: 33.8140227, L: 33.8140227, ML: 0.0338140227 } as Record<string, number>)[unit] ?? 1;
    return { groups, size, dimension, total: groups * size * factor, unit };
  }
  const can = /^(\d+)\s*\/\s*#10\s*CN$/.exec(t);
  return can && Number(can[1]) > 0 ? { groups: Number(can[1]), size: 1, dimension: "can", total: Number(can[1]), unit: "can" } : null;
}
export function chainLevels(rows: readonly RawRow[]): PackChainLevel[] {
  return rows.map(r => ({ id: String(r.id), label: String(r.label), containsQty: num(r.contains_qty) ?? NaN, containsLevelId: r.contains_level_id == null ? null : String(r.contains_level_id), containsMeasureUnit: r.contains_measure_unit == null ? null : String(r.contains_measure_unit), displayOrdinal: num(r.display_ordinal) ?? 0 }));
}
export function packOz(snapshot: Snapshot, measures: Map<string, MeasureUnitFactor>): number | null {
  const s = snapshot.sku;
  return skuContentOz({ unitsPerPack: num(s.units_per_pack), eachSize: num(s.each_size), eachMeasure: s.each_measure == null ? null : String(s.each_measure), avgOzPerEach: num(s.avg_oz_per_each), packChain: chainLevels(snapshot.chain) }, measures);
}
export function starterLevels(snapshot: Snapshot): StarterChainLevel[] {
  return snapshot.chain.map(r => ({ label: String(r.label), containsQty: num(r.contains_qty) ?? NaN, containsIndex: r.contains_level_id == null ? null : snapshot.chain.findIndex(l => l.id === r.contains_level_id), containsMeasureUnit: r.contains_measure_unit == null ? null : String(r.contains_measure_unit) }));
}
function physicalContents(snapshot: Snapshot, measures: Map<string, MeasureUnitFactor>): { total: number; dimension: string; leaf: string; root: string } | null {
  const s = snapshot.sku;
  const levels = snapshot.chain.length ? starterLevels(snapshot) : [{ label: String(s.pack_format ?? ""), containsQty: num(s.each_size) ?? NaN, containsIndex: null, containsMeasureUnit: s.each_measure == null ? null : String(s.each_measure) }];
  const flat = deriveFlatFieldsFromChain(levels);
  const unit = flat.eachMeasure && measures.get(flat.eachMeasure);
  if (!unit || !flat.eachSize || !flat.unitsPerPack) return null;
  const multiplier = snapshot.chain.length ? flat.unitsPerPack : num(s.units_per_pack);
  if (!positive(multiplier)) return null;
  return { total: multiplier * flat.eachSize * unit.toBaseFactor, dimension: unit.dimension, leaf: flat.eachMeasure!, root: snapshot.chain.length ? flat.packFormat! : String(s.pack_format ?? "") };
}
const PIECES: Readonly<Record<string, string>> = {
  "OVENGOLD TURKEY": "Turkey", "LONDON BROIL": "Roast Beef", "MILD PROVOLONE": "Provolone", "DILANDRI GENOA SALAME": "Genoa", "HOT BUTT CAPPY": "Capicola", "EVERROAST CHICKEN": "Ever Roast Chicken", "Pepperoni Slicing": "Pepperoni",
};
export interface Intent {
  source: typeof SOURCE; revision: string;
  owner_pack?: ManifestRow["owner_pack"];
  duplicate_decision?: { row_n: number; rejected_row_ns: number[] };
  price: { unit_price: number; effective_date: string; source_note: string };
  chain: StarterChainLevel[] | null;
  weight: { avg_oz_per_each: number; weight_source_note: string; weight_established_at: string } | null;
  previous_price_id: string | null;
  evidence: { manifest: ManifestRow; observations: PurchaseRow[]; arithmetic: string; grain: string; average: ReturnType<typeof invoiceAverageLbs>; beforeOz: number | null; afterOz: number | null; packWeightClass: "INVOICE_DERIVED" | null };
}
export interface Decision { row: ManifestRow; snapshot: Snapshot | null; refusals: Refusal[]; intent: Intent | null; packRatio?: number; selection?: string; rejected?: boolean; warnings?: string[] }
export function ownerPackNote(row: ManifestRow): string {
  return row.owner_pack ? ` (owner pack: ${row.owner_pack.pack} — ${row.owner_pack.source})` : "";
}
/** Decorate all exit paths, including invoice-selection failures and price no-ops. */
export function planRow(row: ManifestRow, snapshot: Snapshot | null, history: readonly PurchaseRow[], measures: Map<string, MeasureUnitFactor>, asOf: string, deferPricePolicy = false, replay = false): Decision {
  const result = planRowInner(row, snapshot, history, measures, asOf, deferPricePolicy, replay);
  for (const entry of result.refusals) entry.message += ownerPackNote(row);
  return result;
}
function planRowInner(row: ManifestRow, snapshot: Snapshot | null, history: readonly PurchaseRow[], measures: Map<string, MeasureUnitFactor>, asOf: string, deferPricePolicy = false, replay = false): Decision {
  const result: Decision = { row, snapshot, refusals: [], intent: null };
  const a = row.angel, selected = row.selected_sku;
  const ctx = { row: `${a.source_file}:${a.source_line} ${a.product}`, SKU: selected?.name ?? a.product };
  const hold = (code: RefusalCode, extra: Record<string, string | number | (string | number)[]> = {}, operation = "bundle", fact = row.owner_question || "Resolve the fact named above.") => { result.refusals.push(refusal(code, { ...ctx, ...extra }, operation, fact)); return result; };
  if (row.decision === "rejected") return hold("NO_MATCH");
  if (row.decision !== "selected") return hold("MAPPING_UNCONFIRMED");
  if (row.vendor_binding === "VENDOR_DRIFT") return hold("VENDOR_DRIFT", { A: a.vendor, B: selected?.vendor ?? "unselected" });
  if (row.vendor_binding !== "vendor-match") return hold("MAPPING_UNCONFIRMED");
  if (!selected || !snapshot || snapshot.sku.id !== selected.id || snapshot.sku.active !== true || !selected.active) return hold("SKU_UNRESOLVED", { n: 0 });
  const s = snapshot.sku;
  if (s.name !== selected.name || clean(String(s.item_number ?? "")) !== clean(selected.item_number)) return hold("AMBIGUOUS_PRODUCT_IDENTITY", { "Angel product": a.product, "SKU identity": String(s.name) });
  if (!snapshot.vendor || snapshot.vendor.active !== true || snapshot.vendor.id !== s.vendor_id) return hold("VENDOR_UNREGISTERED");
  // vendor-match is the reviewed supplier binding (including Delmar -> Boar's Head).
  if (snapshot.vendor.name !== selected.vendor) return hold("VENDOR_DRIFT", { A: a.vendor, B: String(snapshot.vendor.name) });
  if (clean(String(s.pack_format ?? "")) !== clean(selected.pack_format ?? "")) return hold("PACK_SHAPE_CHANGED");
  if (snapshot.chain.length) {
    const levels = chainLevels(snapshot.chain), chain = buildPackChain(levels);
    const collision = firstLabelMeasureCollision(levels.map(l => l.label), new Set(measures.keys()));
    const valid = validateChainStructure(chain, measures);
    if (collision || !valid.ok || levels.some(l => !positive(l.containsQty)) || new Set(levels.map(l => l.label)).size !== levels.length) return hold("INVALID_CHAIN", { "collision/cycle/multiple roots/dangling pointer/invalid quantity": collision ? "collision" : !valid.ok ? valid.reason : "invalid quantity" });
  }
  const source = selectInvoices(row, history, asOf);
  if ("code" in source) { result.refusals.push(source); return result; }
  const currentDate = snapshot.price && String(snapshot.price.effective_date);
  const appPrice = snapshot.price != null && (snapshot.price.recorded_by != null || !String(snapshot.price.source ?? "").startsWith("angel-"));
  const parsed = parsePack(a.pack_size) ?? (row.owner_pack ? parsePack(row.owner_pack.pack) : null), ours = physicalContents(snapshot, measures);
  const beforeOz = packOz(snapshot, measures);
  let afterOz = beforeOz, chain: StarterChainLevel[] | null = null, weight: Intent["weight"] = null;
  let ratio: number | null = null, grain = "invoice purchase pack", arithmetic = "";
  let price = source.latest.unitPricePerCase!;
  const piece = PIECES[a.product];
  const root = snapshot.chain.length ? chainRootLabel(buildPackChain(chainLevels(snapshot.chain))) : String(s.pack_format ?? "");
  const undefinedPack = !snapshot.chain.length && s.each_size == null && s.units_per_pack == null && s.sku_class === "raw" && s.inventory_only !== true
    && !piece && a.product !== "IMP LAYER BACON 12/14" && a.product !== "CHEESE MOZZ 1OZ SLCD LOG 32 CT";
  if (undefinedPack && parsed) {
    const average = source.average;
    if (a.weight_source !== "invoice_catch_weight" || source.latest.weightSource !== "invoice_catch_weight" || !average || average.spreadFraction > 0.05 + 1e-12 || (average.lines < 2 && parsed.dimension !== "weight")) return hold("SCALE_GATED", {}, "bundle", "Supply measured net weights with at most 5% spread across two lines, or one fixed-weight invoice line.");
    afterOz = round(average.meanLbs * 16, 2);
    if (!positive(afterOz) || measures.get("oz")?.dimension !== "weight" || measures.get("oz")?.toBaseFactor !== 1) return hold("INVALID_CHAIN", { "collision/cycle/multiple roots/dangling pointer/invalid quantity": "invalid measured ounces or unregistered ounce leaf" });
    // The entire purchase unit is now our pack. Do not invent inner-container names.
    const purchaseRoot = parsed.dimension === "roll" ? "roll" : parsed.groups > 1 ? "case" : "pack";
    chain = [{ label: purchaseRoot, containsQty: afterOz, containsIndex: null, containsMeasureUnit: "oz" }];
    ratio = 1; grain = "measured invoice purchase pack; portion weight is separate";
    arithmetic = `case $${price.toFixed(4)} = ${average.totalLbs} net lb / ${average.units} invoice units × 16 = our ${afterOz} oz pack → $${round(price, 2).toFixed(2)} per pack`;
  } else if (piece) {
    if (piece !== selected.name) return hold("AMBIGUOUS_PRODUCT_IDENTITY", { "Angel product": a.product, "SKU identity": selected.name });
    if (!source.average || !positive(source.latest.pricePerLb)) return hold("NO_MEASURED_INVOICE_WEIGHT", { source: a.weight_source }, "weight");
    if (!root || !/^(piece|log)$/i.test(root)) return hold("OUR_PACK_UNRESOLVABLE");
    afterOz = round(source.average.meanLbs * 16, 2);
    if (beforeOz !== afterOz) chain = [{ label: root, containsQty: afterOz, containsIndex: null, containsMeasureUnit: "oz" }];
    price = source.latest.pricePerLb * (afterOz / 16); ratio = 1;
    grain = "whole deli piece; slice weight is separate";
    arithmetic = `$${source.latest.pricePerLb}/lb × ${afterOz / 16} piece lb = $${round(price, 2).toFixed(2)} per pack`;
  } else if (a.product === "IMP LAYER BACON 12/14" && selected.name === "Bacon") {
    // Piece file: one invoice unit is the 15 lb BOX, not 180–210 strips.
    if (!root || !/^(case|box)$/i.test(root) || !beforeOz || Math.abs(beforeOz - 240) > 0.02) return hold("PACK_PREMISE_BROKEN", { pack: ["15 lb bacon box", `${beforeOz ?? "unknown"} oz`] });
    ratio = 1; grain = "15 lb bacon box; operational strip is separate";
    arithmetic = `case $${price.toFixed(4)} = 240 oz ÷ 1 = our 240 oz pack → $${round(price, 2).toFixed(2)} per pack`;
  } else if (a.product === "CHEESE MOZZ 1OZ SLCD LOG 32 CT" && selected.name === "Fresh Mozzarella") {
    // Six 32-slice logs = 192 slices. Invoice gross/case mass cannot relabel a slice.
    if (!root || !/^case$/i.test(root) || !ours || !((ours.dimension === "count" && ours.total === 192) || (ours.dimension === "weight" && ours.total === 192))) return hold("PACK_PREMISE_BROKEN", { pack: ["six logs / 192 nominal 1 oz slices", `${ours?.total ?? "unknown"} ${ours?.leaf ?? "units"}`] });
    ratio = 1; grain = "mozzarella invoice case; operational slice is separate";
    arithmetic = `case $${price.toFixed(4)} = 192 nominal oz ÷ 1 = our 192 nominal oz pack → $${round(price, 2).toFixed(2)} per pack`;
  } else {
    if (!parsed) return hold("UNSUPPORTED_PACK_SYNTAX", { text: a.pack_size });
    const variable = VARIABLE_CATCH_RULES.find(v => identityKey(v.product, v.brand, v.vendor, v.packSizeRaw) === identityKey(a.product, a.brand, a.vendor, a.pack_size));
    if (variable) {
      // Wave 8's 8 oz correction does not resolve the 12.96 oz invoice-weight
      // anomaly documented in angel-wave4; retain the net-weight refusal.
      if (variable.skuName === "Chives") return hold("PACK_PREMISE_BROKEN", { pack: [a.pack_size, `${beforeOz ?? "unknown"} oz`] });
      if (!source.average) return hold("NO_MEASURED_INVOICE_WEIGHT", { source: a.weight_source }, "weight");
      const invoiceOz = round(source.average.meanLbs * 16, 2);
      if (!root || !beforeOz || (Math.abs(beforeOz - variable.ourPackOzExpected) > 0.02 && Math.abs(beforeOz - invoiceOz) > 0.02)) return hold("PACK_PREMISE_BROKEN", { pack: [a.pack_size, `${beforeOz ?? "unknown"} oz`] });
      ratio = 1; afterOz = invoiceOz;
      if (beforeOz !== afterOz) chain = [{ label: root, containsQty: afterOz, containsIndex: null, containsMeasureUnit: "oz" }];
    } else if ((["packaging", "cleaning", "misc"].includes(String(s.sku_class)) || s.inventory_only === true) && !snapshot.chain.length) {
      // A single count group (1/N, N/1, or N CT/EA) proves a case of items,
      // without inventing inner sleeves. Preserve any explicit order-root premise.
      const countCase = (s.sku_class === "packaging" || s.inventory_only === true)
        && parsed.dimension === "count" && (parsed.groups === 1 || parsed.size === 1);
      const supplyRoot = root || (countCase ? "Case" : "");
      if (!supplyRoot || !/^(case|box|pack|roll)$/i.test(supplyRoot)) return hold("OUR_PACK_UNRESOLVABLE");
      const count: number | null = parsed.dimension === "count" || parsed.dimension === "roll" ? parsed.total : s.sku_class === "cleaning" && parsed.dimension === "weight" ? parsed.groups : null;
      if (!count) return hold("UNSUPPORTED_PACK_SYNTAX", { text: a.pack_size });
      if (ours && (ours.dimension !== "count" || ours.total !== count)) return hold("PACK_PREMISE_BROKEN", { pack: [a.pack_size, `${ours.total} ${ours.leaf}`] });
      const leaf = ["each", "count"].find(label => measures.get(label)?.dimension === "count" && measures.get(label)?.toBaseFactor === 1);
      if (!leaf) return hold("INVALID_CHAIN", { "collision/cycle/multiple roots/dangling pointer/invalid quantity": "unregistered count leaf" });
      // Flatten to actual items; pack text alone does not name sleeves or inner boxes.
      chain = [{ label: supplyRoot, containsQty: count, containsIndex: null, containsMeasureUnit: leaf }];
      ratio = 1; grain = "supply items (no ounce claim)";
    } else if (ours && ours.dimension === parsed.dimension) {
      ratio = ours.total / parsed.total;
      // Same inner containers precede approximate mass ratios (66.6 vs 66.5 oz tuna).
      const inner = parsed.total / parsed.groups;
      if (parsed.groups > 1 && Math.abs(ours.total / inner - Math.round(ours.total / inner)) < 0.002 && Math.round(ours.total / inner) > 0) ratio = Math.round(ours.total / inner) / parsed.groups;
    } else if (parsed.dimension === "can" && ours?.dimension === "count" && /can/i.test(String(s.each_container_label ?? ours.root))) ratio = ours.total / parsed.total;
    if (!ratio || !positive(ratio)) return hold(ours ? "PACK_PREMISE_BROKEN" : "OUR_PACK_UNRESOLVABLE", ours ? { pack: [a.pack_size, `${ours.total} ${ours.leaf}`] } : {});
    price *= ratio;
    const unit = parsed.dimension === "weight" ? "oz" : parsed.dimension === "volume" ? "fl oz" : "items";
    arithmetic = `case $${source.latest.unitPricePerCase!.toFixed(4)} = ${parsed.total} ${unit} ÷ ${1 / ratio} = our ${parsed.total * ratio} ${unit} pack → $${round(price, 2).toFixed(2)} per pack`;
  }
  // Weight evidence belongs to the physical unit of avg_oz_per_each, never merely the pack.
  const average = source.average, currentWeight = num(s.avg_oz_per_each), cls = s.weight_class;
  const scaleGated = /OREGANO|ONION PWDR|CHIVE.*DR|CHIVES.*DEHYD/i.test(a.product) || (!piece && !VARIABLE_CATCH_RULES.some(v => v.skuName === selected.name) && parsed?.dimension !== "count");
  if (cls === "OPERATIONAL") hold("OPERATIONAL_KEEP_LIVE", { value: currentWeight ?? "missing" }, "weight");
  else if (currentWeight != null && !["SPEC", "ESTIMATE", "INVOICE_DERIVED"].includes(String(cls))) hold("WEIGHT_EVIDENCE_UNCLASSIFIED", {}, "weight");
  else if (!average) hold("NO_MEASURED_INVOICE_WEIGHT", { source: a.weight_source }, "weight");
  else if (scaleGated) hold("SCALE_GATED", {}, "weight");
  else {
    // Only a documented whole-item count matches the unit field. Slices, herbs,
    // cloves, bacon strips and mozzarella case/slice models cannot earn that claim.
    const wholeProduce = /^(CUCUMBER|LETTUCE|EGG|LEMON |LIME )/.test(a.product) && parsed?.dimension === "count";
    if (wholeProduce && ours?.dimension === "count" && ["each", "count"].includes(ours.leaf) && measures.get(ours.leaf)?.toBaseFactor === 1 && !piece) {
      const proposed = round(average.meanLbs * 16 / parsed.total);
      if (cls === "INVOICE_DERIVED" && currentWeight !== proposed) hold("SOURCE_PAYLOAD_DRIFT", {}, "weight", "Approve an explicit weight correction revision.");
      else if (cls !== "INVOICE_DERIVED" && positive(proposed)) weight = { avg_oz_per_each: proposed, weight_source_note: `${a.product} [${a.brand}]: ${average.totalLbs} net lb / ${average.units} invoice units / ${parsed.total} whole items × 16; INVOICE_DERIVED; ${row.revision}`, weight_established_at: `${source.date}T00:00:00.000Z` };
    } else hold("WEIGHT_GRAIN_MISMATCH", { "unit A": grain, "unit B": String(s.each_measure ?? "unresolved portion") }, "weight");
  }
  if (chain) {
    const collision = firstLabelMeasureCollision(chain.map(l => l.label), new Set(measures.keys()));
    if (collision) return hold("INVALID_CHAIN", { "collision/cycle/multiple roots/dangling pointer/invalid quantity": "collision" });
  }
  if (weight) afterOz = packOz({ ...snapshot, sku: { ...s, avg_oz_per_each: weight.avg_oz_per_each } }, measures);
  if (!positive(price) || round(price, 2) <= 0) return hold("INVALID_SOURCE_DATA", { field: "computed price" });
  result.packRatio = ratio!;
  if (!deferPricePolicy) {
    const currentPrice = num(snapshot.price?.unit_price);
    if (!replay && String(snapshot.price?.source ?? "").startsWith("angel-") && currentPrice != null && Math.abs(round(price, 2) - currentPrice) <= 0.01 + 1e-9) {
      result.refusals = [refusal("ALREADY_CORRECT", ctx, "price", "None: Angel price is within one cent; re-derivation is not new evidence.")];
      result.refusals[0]!.message = `ALREADY_CORRECT ${selected.name}: Angel head $${currentPrice.toFixed(2)} and proposed $${round(price, 2).toFixed(2)} differ by at most one cent; zero writes.`;
      return result;
    }
    if (currentDate && (currentDate > source.date || (currentDate === source.date && appPrice))) {
      result.refusals = [];
      return currentDate > source.date && dateAge(source.date, asOf) > STALE_DAYS && appPrice
        ? hold("STALE_ANGEL_PRICE", { date: [source.date, currentDate], age: dateAge(source.date, asOf) }, "price") : hold("NEWER_PRICE_EXISTS", {}, "price");
    }
  }
  const previous = snapshot.price?.source === SOURCE ? String(snapshot.price.id) : null;
  arithmetic += ownerPackNote(row);
  const note = `${a.product} [${a.brand}] ${a.pack_size} | ${arithmetic} | vendor ${a.vendor}; invoice ${source.date}; decision ${row.revision}; preceding price ${snapshot.price?.id ?? "none"}`;
  result.intent = { source: SOURCE, revision: row.revision, price: { unit_price: round(price, 2), effective_date: source.date, source_note: note }, chain, weight, previous_price_id: previous, evidence: { manifest: row, observations: source.rows, arithmetic, grain, average, beforeOz, afterOz, packWeightClass: chain && s.sku_class === "raw" && average ? "INVOICE_DERIVED" : null } };
  if (row.owner_pack) result.intent.owner_pack = { ...row.owner_pack };
  return result;
}
export function planWave7(manifest: Manifest, snapshots: ReadonlyMap<string, Snapshot>, history: readonly PurchaseRow[], measures: Map<string, MeasureUnitFactor>, asOf: string, replaySkus: ReadonlySet<string> = new Set()): Decision[] {
  if (isoDate(asOf) !== asOf) throw new Error("Invalid as-of date");
  const clusters = new Map<string, ManifestRow[]>();
  for (const row of manifest.rows) if (row.decision === "selected" && row.vendor_binding === "vendor-match" && row.selected_sku) clusters.set(row.selected_sku.id, [...(clusters.get(row.selected_sku.id) ?? []), row]);
  const decisions = manifest.rows.map(row => {
    const id = row.selected_sku?.id;
    return planRow(row, id ? snapshots.get(id) ?? null : null, history, measures, asOf, false, !!id && replaySkus.has(id));
  });
  for (const [id, cluster] of clusters) {
    if (cluster.length < 2) continue;
    // Resolve the physical relationship before considering the current price head.
    // A newer app price must not cause fallback to an older competing product.
    const candidates = cluster.map(row => planRow(row, snapshots.get(id) ?? null, history, measures, asOf, true));
    const eligible = candidates.filter(d => d.intent && d.packRatio != null && Math.abs(1 / d.packRatio - Math.round(1 / d.packRatio)) < 1e-9 && 1 / d.packRatio >= 1);
    eligible.sort((a, b) => b.intent!.price.effective_date.localeCompare(a.intent!.price.effective_date)
      || b.intent!.evidence.observations.length - a.intent!.evidence.observations.length || a.row.row_n - b.row.row_n);
    const chosen = eligible[0];
    if (!chosen) {
      for (const candidate of candidates) {
        const d = decisions.find(d => d.row.row_n === candidate.row.row_n)!;
        d.intent = null;
        d.refusals = d.refusals.filter(r => r.code !== "ALREADY_CORRECT");
        if (!d.refusals.some(r => r.code === "PACK_PREMISE_BROKEN")) d.refusals.push(refusal("PACK_PREMISE_BROKEN", { SKU: d.row.selected_sku!.name, pack: [d.row.angel.pack_size, "no exact or integer-divisor competitor"] }));
        d.selection = "no row of record: no eligible exact or integer-divisor pack relationship";
      }
      continue;
    }
    const winner = decisions.find(d => d.row.row_n === chosen.row.row_n)!;
    winner.selection = `row of record #${chosen.row.row_n}: latest invoice ${chosen.intent!.price.effective_date}; purchase_lines ${chosen.intent!.evidence.observations.length}; exact/integer-divisor pack relationship`;
    const rejected = candidates.filter(d => d !== chosen);
    if (winner.intent) winner.intent.duplicate_decision = { row_n: chosen.row.row_n, rejected_row_ns: rejected.map(d => d.row.row_n).sort((a, b) => a - b) };
    for (const candidate of rejected) {
      const d = decisions.find(d => d.row.row_n === candidate.row.row_n)!;
      const reason = !candidate.intent ? candidate.refusals.map(r => r.code).join(", ") : !eligible.includes(candidate) ? "pack relationship is not exact or an integer divisor" : candidate.intent.price.effective_date !== chosen.intent!.price.effective_date ? "older latest invoice" : candidate.intent.evidence.observations.length !== chosen.intent!.evidence.observations.length ? "fewer purchase_lines" : "equal date and purchase_lines; stable row_n tie-break";
      d.intent = null; d.refusals = []; d.rejected = true;
      d.selection = `rejected: ${reason}; row of record #${chosen.row.row_n}`;
      if (candidate.intent) {
        const selectedPrice = chosen.intent!.price.unit_price, competingPrice = candidate.intent!.price.unit_price;
        if (Math.abs(selectedPrice - competingPrice) / competingPrice > 0.15 + 1e-12) {
          (winner.warnings ??= []).push(`WARN ${winner.row.selected_sku!.name}: ${chosen.row.angel.product} [${chosen.row.angel.brand}] (#${chosen.row.row_n}) $${selectedPrice.toFixed(2)} versus ${candidate.row.angel.product} [${candidate.row.angel.brand}] (#${candidate.row.row_n}) $${competingPrice.toFixed(2)} per our pack differs by more than 15%; writing row of record when price policy permits.`);
        }
      }
    }
  }
  for (const d of decisions) for (const entry of d.refusals) {
    const note = ownerPackNote(d.row);
    if (note && !entry.message.endsWith(note)) entry.message += note;
  }
  return decisions;
}
