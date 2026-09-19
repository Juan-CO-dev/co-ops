import type { ExportRow } from "./model";

export function parsePack(pack: string): Pick<ExportRow, "pack" | "pack_qty" | "pack_size" | "pack_unit" | "pack_unparsed"> {
  const m = /^(\d+)\/(#\d+|\d+(?:\.\d+)?)\s+(CT|LB|CN|OZ|FT|LT|EA|DZ|GA)$/i.exec(pack.trim());
  if (!m || Number(m[1]) <= 0 || (m[2]!.startsWith("#") ? m[3]!.toUpperCase() !== "CN" : Number(m[2]) <= 0)) {
    return { pack, pack_qty: null, pack_size: null, pack_unit: null, pack_unparsed: true };
  }
  return { pack, pack_qty: Number(m[1]), pack_size: m[2]!.startsWith("#") ? m[2]! : Number(m[2]), pack_unit: m[3]!.toUpperCase() };
}

export function parsePrice(raw: string): Pick<ExportRow, "price_cents" | "price_per_lb_cents"> {
  if (!raw.trim()) return { price_cents: null, price_per_lb_cents: null };
  const m = /^\$?(\d+(?:\.\d{1,4})?)(\/lb)?$/i.exec(raw.trim());
  if (!m) throw new Error(`Unrecognized price: ${raw}`);
  // Round floating point noise, NOT sub-cent vendor precision (2.7263 dollars = 272.63 cents).
  const cents = Math.round(Number(m[1]) * 10000) / 100;
  if (!Number.isFinite(cents)) throw new Error("Price overflow");
  return m[2] ? { price_cents: null, price_per_lb_cents: cents } : { price_cents: cents, price_per_lb_cents: null };
}

export function parseDate(raw: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!m) throw new Error(`Invalid date: ${raw}`);
  const iso = `${m[3]}-${m[1]}-${m[2]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new Error(`Invalid date: ${raw}`);
  return iso;
}

export function parsePurchase(raw: string): Pick<ExportRow, "last_purchase_qty" | "last_purchase_uom" | "last_purchase_date"> {
  if (!raw.trim()) return { last_purchase_qty: null, last_purchase_uom: null, last_purchase_date: null };
  const m = /^(\d+(?:\.\d+)?)\s+([A-Z]+)\s+(\d{2}\/\d{2}\/\d{4})$/.exec(raw.trim());
  if (!m) throw new Error(`Unrecognized last purchase: ${raw}`);
  return { last_purchase_qty: Number(m[1]), last_purchase_uom: m[2]!, last_purchase_date: parseDate(m[3]!) };
}

/** RFC-style CSV records with physical starting lines, including multiline quoted cells. */
export function parseCsv(text: string): { cells: string[]; line: number }[] {
  const records: { cells: string[]; line: number }[] = [];
  let cells: string[] = [], field = "", quoted = false, closed = false, line = 1, start = 1;
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else { field += c; if (c === "\n") line++; }
    } else if (c === ",") { cells.push(field); field = ""; closed = false; }
    else if (c === "\n") { cells.push(field); records.push({ cells, line: start }); cells = []; field = ""; closed = false; line++; start = line; }
    else if (c === '"' && !field && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error(`Malformed CSV at line ${line}`);
      field += c;
    }
  }
  if (quoted) throw new Error(`Unclosed CSV quote at line ${start}`);
  if (field || cells.length || closed) records.push({ cells: [...cells, field], line: start });
  return records;
}
