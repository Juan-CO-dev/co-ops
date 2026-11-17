import type { Adapter, ExportRow } from "../model";
import { parseCsv, parseDate, parsePack, parsePrice } from "../parsers";

/** Baldor SmartShop "Purchase History" Excel export (one sheet). Reaches this adapter only as an xlsx upload. */
export const SMARTSHOP_COLUMNS = ["ID", "Title", "Size", "Quantity", "Current Price"] as const;
export const SMARTSHOP_LIST = "SmartShop purchase history";
const UNITS: Record<string, string> = { LB: "LB", OZ: "OZ", CT: "CT", EA: "EA", DZ: "DZ", QT: "QT", LT: "LT", GAL: "GA", GA: "GA" };
const decimal = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

/** SmartShop writes "3 LB", "3 X 2 LB", "6 X #10". Only those shapes are read; anything else (a fraction like
 *  "1/2 GAL", prose) is honestly unparsed — a "/" here is a fraction, never the vendor's count separator. */
export function smartshopPack(size: string): ReturnType<typeof parsePack> {
  const unknown = { pack: size, pack_qty: null, pack_size: null, pack_unit: null, pack_unparsed: true as const };
  const m = /^(?:(\d+)\s+X\s+)?(#\d+|\d+(?:\.\d+)?|\.\d+)(?:\s+([A-Z]+))?$/i.exec(size.trim());
  if (!m) return unknown;
  const count = m[1], amount = m[2]!, unit = m[3]?.toUpperCase();
  let normalized: string;
  if (amount.startsWith("#")) {
    if (unit !== undefined && unit !== "CN") return unknown;
    normalized = `${count ?? "1"}/${amount} CN`;
  } else {
    if (!decimal.test(amount) || !unit || !UNITS[unit]) return unknown;
    normalized = `${count ? `${count}/` : ""}${amount} ${UNITS[unit]}`;
  }
  const parsed = parsePack(normalized);
  return parsed.pack_unparsed ? unknown : { ...parsed, pack: size };
}

/** "smartshop_export_<from>_<to>.xlsx" (a browser may add " (1)"): the range END dates the prices. */
function exportRange(sourceFile: string): { from: string; to: string } {
  const m = /^smartshop_export_(\d{4})-(\d{2})-(\d{2})_(\d{4})-(\d{2})-(\d{2})(?: \(\d+\))?\.xlsx$/i.exec(sourceFile.split(/[\/]/).at(-1) ?? "");
  if (!m) throw new Error(`${sourceFile}: missing SmartShop export range in the file name`);
  const from = parseDate(`${m[2]}/${m[3]}/${m[1]}`), to = parseDate(`${m[5]}/${m[6]}/${m[4]}`);
  if (from > to) throw new Error(`${sourceFile}: invalid SmartShop export range`);
  return { from, to };
}

function money(raw: string): Pick<ExportRow, "price_cents" | "price_per_lb_cents"> {
  if (!raw) return { price_cents: null, price_per_lb_cents: null };
  if (!decimal.test(raw)) throw new Error(`Unrecognized price: ${raw}`);
  const value = Number(raw);
  // Spreadsheet doubles carry float noise (12.990000000000002); four decimals is the importer's precision.
  return value > 0 ? parsePrice(value.toFixed(4)) : { price_cents: null, price_per_lb_cents: null };
}

export const baldorSmartshop: Adapter = {
  id: "baldor-smartshop-xlsx", vendor: "baldor", format: "xlsx",
  detects(text) {
    try { const first = parseCsv(text)[0]; return !!first && first.line === 1 && first.cells.join("\u0000") === SMARTSHOP_COLUMNS.join("\u0000"); }
    catch { return false; }
  },
  parse(text, sourceFile) {
    const range = exportRange(sourceFile);
    const rows = parseCsv(text);
    if (!baldorSmartshop.detects(text)) throw new Error(`${sourceFile}: not a SmartShop purchase history`);
    return rows.slice(1).filter(r => r.cells.some(c => c.trim())).map(({ cells, line }): ExportRow => {
      const c = cells.map(v => v.trim());
      if (c.length > SMARTSHOP_COLUMNS.length || !c[0] || !c[1]) throw new Error(`${sourceFile}:${line}: invalid SmartShop row`);
      try {
        const quantity = c[3] ?? "";
        if (quantity && !decimal.test(quantity)) throw new Error(`Invalid quantity: ${quantity}`);
        // A size that is only a weight unit ("LB") is a catch-weight item: the price is a case estimate of
        // unknown weight, so no fixed pack is claimed and the matcher holds it for a person.
        const byWeight = /^(?:LB|OZ)$/i.test(c[2] ?? "");
        const notes = [`Quantity is the total bought ${range.from} to ${range.to}, not one order.`];
        if (byWeight) notes.push("Sold by weight: the price is SmartShop's estimate for a case of varying weight.");
        return {
          vendor: "baldor", source_file: sourceFile, source_line: line, account_id: "", list_name: SMARTSHOP_LIST, category: "",
          item_no: c[0], description: c[1], brand: "", ...smartshopPack(c[2] ?? ""), ...(byWeight ? { pack_catch_weight: true as const } : {}),
          // SmartShop sells by the listed size; a basis that does not fit the catalog root holds the row for a person.
          uom: "CS", price_basis: "per case", ...money(c[4] ?? ""),
          last_purchase_qty: quantity ? Number(quantity) : null, last_purchase_uom: quantity ? "CS" : null, last_purchase_date: null,
          exported_at: range.to, notes,
        };
      } catch (error) { throw new Error(`${sourceFile}:${line}: ${String(error)}`); }
    });
  },
};
