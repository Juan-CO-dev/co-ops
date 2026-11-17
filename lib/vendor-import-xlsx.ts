import "server-only";

import { crc32, inflateRawSync } from "node:zlib";

/**
 * A deliberately small .xlsx reader for vendor price exports (Baldor SmartShop): the first worksheet's cell
 * TEXT, nothing else. No new dependency — node:zlib does the inflate. Everything is bounded: the upload is
 * already capped (MAX_IMPORT_BYTES), each entry we read is capped before AND during inflate (a lying size
 * header cannot expand past it), only stored/deflate entries, no encryption, no ZIP64, no DTD/entities.
 * Formulas are not evaluated: a formula cell yields its cached value, which is what the export wrote.
 */
export const XLSX_LIMITS = {
  maxEntries: 256,
  maxEntryBytes: 4 * 1024 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
  maxRows: 20_000,
  maxColumns: 64,
  maxCellChars: 4_000,
} as const;

export class XlsxError extends Error {
  constructor(reason: string) { super(`xlsx: ${reason}`); }
}

/** Content sniff, not the file name: every .xlsx is a ZIP whose first record is a local file header. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

interface Entry { method: number; compressed: number; size: number; crc: number; offset: number }

function directory(buf: Buffer): Map<string, Entry> {
  if (!isZip(buf)) throw new XlsxError("not a zip");
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new XlsxError("no central directory");
  const disk = buf.readUInt16LE(end + 4), cdDisk = buf.readUInt16LE(end + 6);
  const count = buf.readUInt16LE(end + 10), size = buf.readUInt32LE(end + 12), start = buf.readUInt32LE(end + 16);
  if (disk !== 0 || cdDisk !== 0 || count === 0xffff || start === 0xffffffff) throw new XlsxError("unsupported zip");
  if (count > XLSX_LIMITS.maxEntries || start + size > end) throw new XlsxError("bad central directory");
  const entries = new Map<string, Entry>();
  let at = start;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || buf.readUInt32LE(at) !== 0x02014b50) throw new XlsxError("bad central directory");
    const flags = buf.readUInt16LE(at + 8), method = buf.readUInt16LE(at + 10);
    const nameLength = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32);
    if (at + 46 + nameLength > end) throw new XlsxError("bad central directory");
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength);
    if (flags & 0x1) throw new XlsxError("encrypted entry");
    if (entries.has(name)) throw new XlsxError("duplicate entry");
    entries.set(name, { method, crc: buf.readUInt32LE(at + 16), compressed: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24), offset: buf.readUInt32LE(at + 42) });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

function reader(bytes: Uint8Array) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = directory(buf);
  let total = 0;
  return (name: string, required = true): string | null => {
    const entry = entries.get(name);
    if (!entry) { if (required) throw new XlsxError(`missing ${name}`); return null; }
    if (entry.method !== 0 && entry.method !== 8) throw new XlsxError("unsupported compression");
    if (entry.size > XLSX_LIMITS.maxEntryBytes || (total += entry.size) > XLSX_LIMITS.maxTotalBytes) throw new XlsxError("entry too large");
    const at = entry.offset;
    if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) throw new XlsxError("bad local header");
    const dataStart = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    if (dataStart + entry.compressed > buf.length) throw new XlsxError("truncated entry");
    const data = buf.subarray(dataStart, dataStart + entry.compressed);
    let out: Buffer;
    try { out = entry.method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) }); }
    catch { throw new XlsxError("corrupt entry"); }
    if (out.length !== entry.size || crc32(out) !== entry.crc) throw new XlsxError("corrupt entry");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(out); }
    catch { throw new XlsxError("not utf-8"); }
    // Never a DTD: no entity can expand, and nothing external is ever referenced.
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new XlsxError("dtd refused");
    return text;
  };
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]!] = decode(m[2] ?? m[3] ?? "");
  return out;
}
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]!;
  });
}
/** Text of every <t> run, skipping phonetic hints (<rPh>). */
function runs(xml: string): string {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/t>)/g)].map(m => decode(m[1] ?? "")).join("");
}
function sheetPath(target: string): string {
  const raw = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "..") { if (!parts.pop()) throw new XlsxError("bad sheet path"); }
    else if (part && part !== ".") parts.push(part);
  }
  if (parts[0] !== "xl" || parts.length < 2) throw new XlsxError("bad sheet path");
  return parts.join("/");
}
function columnIndex(ref: string): number {
  const letters = /^([A-Z]{1,3})\d+$/.exec(ref)?.[1];
  if (!letters) throw new XlsxError("bad cell reference");
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

/** Rows of the workbook's FIRST sheet; rows[i] is spreadsheet row i + 1, every row padded to the widest. */
export function readXlsxFirstSheet(bytes: Uint8Array): string[][] {
  try {
    const read = reader(bytes);
    const workbook = read("xl/workbook.xml")!;
    const sheetTag = /<sheet\b[^>]*>/.exec(workbook)?.[0];
    const relId = sheetTag ? Object.entries(attrs(sheetTag)).find(([k]) => /(^|:)id$/.test(k) && k !== "sheetId")?.[1] : undefined;
    if (!relId) throw new XlsxError("no sheet");
    const rels = read("xl/_rels/workbook.xml.rels")!;
    const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => attrs(m[0])).find(r => r.Id === relId)?.Target;
    if (!target) throw new XlsxError("no sheet");
    const shared = read("xl/sharedStrings.xml", false);
    const strings = shared ? [...shared.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map(m => runs(m[1] ?? "")) : [];
    const sheet = read(sheetPath(target))!;
    const rows: string[][] = [];
    let width = 0, rowNumber = 0;
    for (const row of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = attrs(row[1]!).r;
      rowNumber = r ? Number(r) : rowNumber + 1;
      if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > XLSX_LIMITS.maxRows || rows[rowNumber - 1]) throw new XlsxError("bad row");
      const cells: string[] = [];
      let col = -1;
      for (const cell of (row[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = attrs(cell[1]!);
        col = a.r ? columnIndex(a.r) : col + 1;
        if (col >= XLSX_LIMITS.maxColumns) throw new XlsxError("too many columns");
        const body = cell[2] ?? "";
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: string;
        if (a.t === "s") {
          const at = Number(v);
          if (!Number.isSafeInteger(at) || at < 0 || at >= strings.length) throw new XlsxError("bad shared string");
          value = strings[at]!;
        } else if (a.t === "inlineStr") value = runs(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
        else {
          value = decode(v ?? "");
          if ((!a.t || a.t === "n") && /^-?\d+(?:\.\d+)?e[+-]?\d+$/i.test(value)) value = String(Number(value));
        }
        if (value.length > XLSX_LIMITS.maxCellChars) throw new XlsxError("cell too long");
        cells[col] = value;
      }
      width = Math.max(width, cells.length);
      rows[rowNumber - 1] = cells;
    }
    return Array.from({ length: rows.length }, (_, i) => Array.from({ length: width }, (_, c) => rows[i]?.[c] ?? ""));
  } catch (error) {
    if (error instanceof XlsxError) throw error;
    throw new XlsxError("unreadable workbook");
  }
}
