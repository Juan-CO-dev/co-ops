import type { Adapter, ExportRow } from "../model";
import { parseDate, parsePack, parsePrice } from "../parsers";

type Obj = Record<string, unknown>;
function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected receipt object");
  return value as Obj;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing receipt text");
  return value.trim();
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid receipt number");
  return value;
}
function date(value: unknown): string {
  const v = string(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) throw new Error("Invalid receipt date");
  return parseDate(`${m[2]}/${m[3]}/${m[1]}`);
}

export const receipts: Adapter = {
  id: "receipts-json", vendor: "receipts",
  detects(text) { try { return Array.isArray(object(JSON.parse(text)).receipts); } catch { return false; } },
  parse(text, sourceFile) {
    const source = object(JSON.parse(text));
    const capture = /receipts-(\d{4}-\d{2}-\d{2})-batch\d+\.json$/.exec(sourceFile)?.[1];
    if (!capture) throw new Error(`${sourceFile}: missing capture date`);
    const exportedAt = date(capture);
    // Traverse descriptions in source order; duplicate descriptions still cite their own physical occurrence.
    let cursor = 0;
    return (source.receipts as unknown[]).flatMap(value => {
      const receipt = object(value);
      const vendor = string(receipt.vendor), doc = string(receipt.doc), purchased = date(receipt.date);
      if (!Array.isArray(receipt.lines)) throw new Error(`${doc}: missing lines`);
      return receipt.lines.map((value, index): ExportRow => {
        const line = object(value), description = string(line.description), unit = string(line.unit);
        const token = JSON.stringify(line.description);
        const offset = text.indexOf(token, cursor);
        if (offset < 0) throw new Error(`${doc}: source citation missing`);
        cursor = offset + token.length;
        const sourceLine = text.slice(0, offset).split(/\r?\n/).length;
        const qty = number(line.qty), catchWeight = unit === "LB";
        let priceValue = number(line.unit_net ?? line.price_per_case ?? line.price);
        let uom = unit, basis: ExportRow["price_basis"] = null, pack = "";
        const notes: string[] = [];
        if (catchWeight) { basis = "per lb"; uom = "LB"; }
        else if (/case|^CTN$/i.test(unit)) { basis = "per case"; uom = "CS"; }
        else if (/^EA/i.test(unit)) { basis = "per each"; uom = "EA"; }
        else if (unit === "DZ") { basis = "per dozen"; uom = "DZ"; pack = "1/1 DZ"; }
        else if (/^BNDL/i.test(unit)) { basis = "per bundle"; uom = "BNDL"; }
        const count = /\((\d+)(?: bags| sheets)?\)/i.exec(unit);
        if (count) pack = `1/${count[1]} EA`;
        if (!pack) pack = /\b(\d+(?:\.\d+)?\s+(?:LB|OZ|QT|CT|GA))\b/i.exec(description)?.[1] ?? "";
        let billed: Partial<ExportRow> = { billed_unit: unit, billed_price_cents: parsePrice(String(priceValue)).price_cents!, billed_price_basis: basis ?? unit };
        if (vendor === "Thompson Delivers" && receipt.juan_2026_09_18 != null && ["27149", "00602"].includes(String(line.item_no))) {
          const corrections = object(receipt.juan_2026_09_18);
          const correction = object(corrections[line.item_no === "27149" ? "utz_ripples_12_5oz" : "mini_chips_1oz"]);
          const bags = number(correction.per_box);
          const bagPrice = number(correction.price_per_bag);
          pack = `${bags}/${line.item_no === "27149" ? "12.5" : "1"} OZ`;
          billed = { billed_unit: unit, billed_price_cents: parsePrice(String(priceValue)).price_cents!,
            billed_price_basis: line.item_no === "00602" ? "per 60-bag club pack" : "per bag" };
          notes.push(`Juan clarification: ${bags} bags/box; $${bagPrice.toFixed(2)}/bag. Printed quantity retained.`);
          if (line.item_no === "00602") notes.push("Ticket $23.35/club pack differs from clarified 60 × $0.39 = $23.40; do not rewrite the billed total or interpret qty 2 as two individual bags.");
          priceValue = bagPrice; basis = "per each"; uom = "EA";
        }
        const itemNo = line.item_no == null ? "" : string(line.item_no);
        if (!itemNo) notes.push("No printed item number; unresolved identity, not a generated SKU key.");
        if (vendor === "Country Snacks") notes.push("Mixed flavors untracked at purchase: one case SKU; 14 bags/case, $1.80/bag; no flavor allocation.");
        return {
          vendor, source_file: sourceFile, source_line: sourceLine,
          account_id: typeof receipt.customer_no === "string" ? receipt.customer_no
            : /\baccount (\w+)\b/i.exec(typeof receipt.vendor_note === "string" ? receipt.vendor_note : "")?.[1] ?? "",
          list_name: doc, category: "Receipt", item_no: itemNo, description, brand: "",
          ...parsePack(pack), ...(catchWeight ? { pack_catch_weight: true, net_wt_lb: number(line.net_wt_lb) } : {}),
          uom, price_basis: basis, ...parsePrice(`${priceValue}${catchWeight ? "/lb" : ""}`),
          last_purchase_qty: qty, last_purchase_uom: catchWeight ? "PIECE" : unit,
          last_purchase_date: purchased, exported_at: exportedAt,
          receipt_doc: doc, receipt_line: index + 1, ...billed, notes,
        };
      });
    });
  },
};
