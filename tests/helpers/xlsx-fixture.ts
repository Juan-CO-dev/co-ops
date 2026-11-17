/** Test-only: builds a minimal, synthetic .xlsx (a stored/deflated ZIP) in memory. No real vendor data. */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry { name: string; data: string | Uint8Array; store?: boolean; flags?: number }

export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : Buffer.from(entry.data);
    const body = entry.store ? raw : deflateRawSync(raw);
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(raw);
    const method = entry.store ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#039;");
const column = (index: number) => String.fromCharCode(65 + index);

/** One-sheet workbook. Strings go to sharedStrings (as SmartShop does); numbers are numeric cells. */
export function buildXlsx(rows: ReadonlyArray<ReadonlyArray<string | number | null>>, options: { sheetPath?: string; extraSheets?: number } = {}): Uint8Array {
  const strings: string[] = [];
  const index = (value: string) => { const at = strings.indexOf(value); if (at >= 0) return at; strings.push(value); return strings.length - 1; };
  const sheetRows = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
    const ref = `${column(c)}${r + 1}`;
    if (cell === null) return "";
    return typeof cell === "number" ? `<c r="${ref}"><v>${cell}</v></c>` : `<c r="${ref}" t="s"><v>${index(cell)}</v></c>`;
  }).join("")}</row>`).join("");
  const sheetPath = options.sheetPath ?? "worksheets/sheet1.xml";
  const sheets = [`<sheet name="Worksheet" sheetId="1" r:id="rId4"/>`];
  const rels = [`<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${sheetPath}"/>`];
  for (let i = 0; i < (options.extraSheets ?? 0); i++) {
    sheets.push(`<sheet name="Other${i}" sheetId="${i + 2}" r:id="rId${i + 10}"/>`);
    rels.push(`<Relationship Id="rId${i + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/other${i}.xml"/>`);
  }
  return buildZip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>` },
    { name: "xl/sharedStrings.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" uniqueCount="${strings.length}">${strings.map(s => `<si><t>${escape(s)}</t></si>`).join("")}</sst>` },
    { name: `xl/${sheetPath}`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` },
  ]);
}

/** SmartShop "Purchase History" shape: ID, Title, Size, Quantity, Current Price. Synthetic items. */
export const SMARTSHOP_HEADER = ["ID", "Title", "Size", "Quantity", "Current Price"] as const;
