/**
 * Marketing consent — PURE half (client-safe, zero I/O). 0234.
 *
 * Juan 2026-10-07: "Those emails live in toast rn… this can also track when new people opt into the
 * emails". Consent is an APPEND-ONLY event stream; the current status of (person, channel) is the
 * latest event, and an opt-out wins a tie. SQL is the authority (customer_consent_current /
 * customer_consent_latest); `latestConsent` below is the same rule in TypeScript so the app's second
 * filter and the tests speak the same language.
 *
 * The Toast Web Marketing export ("Export Lists"): Toast documents it as a list of guest emails; the
 * exact columns are UNVERIFIED (see scratch/toast-marketing-access.md), so the parser finds the email
 * column by header, takes first/last name and phone when present, and treats a status column
 * (subscribed / unsubscribed …) as EXPLICIT. Without one, being listed = subscribed and the diff
 * against the previous import infers opt-outs (SQL, with a guard on large waves).
 */
import { normalizeEmail, normalizePhoneE164 } from "./identity-shared";

export type ConsentStatus = "opted_in" | "opted_out";
export type ConsentChannel = "email" | "sms";
export interface ConsentEventLike { status: ConsentStatus; effectiveAt: string; recordedAt: string; id: string }

/** Latest event wins; on the same effective instant an opt-out wins; then recorded order, then id. */
export function latestConsent<T extends ConsentEventLike>(events: readonly T[]): T | null {
  let best: T | null = null;
  for (const e of events) {
    if (!best) { best = e; continue; }
    const d = Date.parse(e.effectiveAt) - Date.parse(best.effectiveAt);
    if (d > 0) { best = e; continue; }
    if (d < 0) continue;
    const outE = e.status === "opted_out" ? 1 : 0;
    const outB = best.status === "opted_out" ? 1 : 0;
    if (outE !== outB) { if (outE > outB) best = e; continue; }
    const r = Date.parse(e.recordedAt) - Date.parse(best.recordedAt);
    if (r > 0 || (r === 0 && e.id > best.id)) best = e;
  }
  return best;
}

export interface ConsentImportRow { email: string; phone?: string; first_name?: string; last_name?: string; status?: ConsentStatus }
export interface ParsedConsentFile {
  rows: ConsentImportRow[];
  explicitStatus: boolean;
  invalid: number;
  duplicates: number;
  columns: { email: string; firstName: string | null; lastName: string | null; phone: string | null; status: string | null };
}
export class ConsentCsvError extends Error {
  constructor(public code: "csv_empty" | "csv_no_email_column" | "csv_unknown_status" | "csv_mixed_status" | "csv_too_large" | "csv_no_rows") {
    super(code);
    this.name = "ConsentCsvError";
  }
}

/** The import is capped so one request stays bounded (Toast's list is ~6,000 today). */
export const CONSENT_IMPORT_MAX_ROWS = 50_000;
export const CONSENT_IMPORT_CHUNK = 1000;

/** RFC 4180 rows (quoted fields, doubled quotes, CRLF/LF), BOM stripped. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, "");
const SUBSCRIBED = new Set(["subscribed", "optedin", "optin", "active", "yes", "true", "subscribe", "emailsubscribed"]);
const UNSUBSCRIBED = new Set(["unsubscribed", "optedout", "optout", "inactive", "no", "false", "unsubscribe", "bounced", "complained", "cleaned", "suppressed"]);

export function statusFromCell(cell: string): ConsentStatus | null {
  const v = norm(cell);
  if (SUBSCRIBED.has(v)) return "opted_in";
  if (UNSUBSCRIBED.has(v)) return "opted_out";
  return null;
}

/** One Toast export file → normalised rows. Headerless single-column files (just emails) are accepted. */
export function parseConsentCsv(text: string): ParsedConsentFile {
  const table = parseCsv(text);
  if (table.length === 0) throw new ConsentCsvError("csv_empty");
  const header = table[0]!;
  const keys = header.map(norm);
  let emailIdx = keys.findIndex((k) => k === "email" || k === "emailaddress" || k === "guestemail" || k === "e" || k.endsWith("email"));
  let body = table.slice(1);
  let cols: ParsedConsentFile["columns"];
  if (emailIdx < 0) {
    // Headerless: the first row is data when one of its cells is an address.
    const idx = header.findIndex((c) => normalizeEmail(c) !== null);
    if (idx < 0) throw new ConsentCsvError("csv_no_email_column");
    emailIdx = idx;
    body = table;
    cols = { email: `column ${idx + 1}`, firstName: null, lastName: null, phone: null, status: null };
  } else {
    const find = (pred: (k: string) => boolean) => { const i = keys.findIndex(pred); return i >= 0 ? i : null; };
    const fi = find((k) => k === "firstname" || k === "first" || k === "givenname");
    const li = find((k) => k === "lastname" || k === "last" || k === "surname" || k === "familyname");
    const pi = find((k) => k.includes("phone") || k === "mobile");
    const si = find((k) => k === "status" || k.includes("subscri") || k === "emailstatus" || k === "marketingstatus" || k === "optin" || k === "emailoptin");
    cols = { email: header[emailIdx]!, firstName: fi === null ? null : header[fi]!, lastName: li === null ? null : header[li]!,
      phone: pi === null ? null : header[pi]!, status: si === null ? null : header[si]! };
    return finish(body, emailIdx, fi, li, pi, si, cols);
  }
  return finish(body, emailIdx, null, null, null, null, cols);
}

function finish(body: string[][], ei: number, fi: number | null, li: number | null, pi: number | null, si: number | null, columns: ParsedConsentFile["columns"]): ParsedConsentFile {
  if (body.length > CONSENT_IMPORT_MAX_ROWS) throw new ConsentCsvError("csv_too_large");
  const byEmail = new Map<string, ConsentImportRow>();
  let invalid = 0;
  let duplicates = 0;
  for (const r of body) {
    const email = normalizeEmail(r[ei] ?? "");
    if (!email) { invalid++; continue; }
    const row: ConsentImportRow = { email };
    const phone = pi === null ? null : normalizePhoneE164(r[pi] ?? "");
    if (phone) row.phone = phone;
    const first = fi === null ? "" : (r[fi] ?? "").trim();
    const last = li === null ? "" : (r[li] ?? "").trim();
    if (first) row.first_name = first.slice(0, 100);
    if (last) row.last_name = last.slice(0, 100);
    if (si !== null) {
      const st = statusFromCell(r[si] ?? "");
      if (!st) throw new ConsentCsvError("csv_unknown_status");
      row.status = st;
    }
    const prev = byEmail.get(email);
    if (prev) {
      duplicates++;
      // Two lines for one address: an unsubscribe anywhere wins.
      if (row.status === "opted_out") prev.status = "opted_out";
      continue;
    }
    byEmail.set(email, row);
  }
  return { rows: [...byEmail.values()], explicitStatus: si !== null, invalid, duplicates, columns };
}

/** Several files of ONE export (Toast splits multi-shop lists per shop) become one list. */
export function mergeConsentFiles(files: readonly ParsedConsentFile[]): { rows: ConsentImportRow[]; explicitStatus: boolean; invalid: number; duplicates: number } {
  if (files.length === 0) throw new ConsentCsvError("csv_empty");
  const explicit = files[0]!.explicitStatus;
  if (files.some((f) => f.explicitStatus !== explicit)) throw new ConsentCsvError("csv_mixed_status");
  const byEmail = new Map<string, ConsentImportRow>();
  let invalid = 0;
  let duplicates = 0;
  for (const f of files) {
    invalid += f.invalid;
    duplicates += f.duplicates;
    for (const r of f.rows) {
      const prev = byEmail.get(r.email);
      if (!prev) { byEmail.set(r.email, { ...r }); continue; }
      duplicates++;
      if (r.status === "opted_out") prev.status = "opted_out";
      prev.phone ??= r.phone;
      prev.first_name ??= r.first_name;
      prev.last_name ??= r.last_name;
    }
  }
  const rows = [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
  if (rows.length === 0) throw new ConsentCsvError("csv_no_rows");
  if (rows.length > CONSENT_IMPORT_MAX_ROWS) throw new ConsentCsvError("csv_too_large");
  return { rows, explicitStatus: explicit, invalid, duplicates };
}

/** The idempotency key's input: sorted rows + the status mode, in one canonical spelling. */
export function canonicalImportPayload(rows: readonly ConsentImportRow[], explicitStatus: boolean): string {
  const sorted = [...rows].sort((a, b) => a.email.localeCompare(b.email))
    .map((r) => [r.email, r.phone ?? "", r.first_name ?? "", r.last_name ?? "", explicitStatus ? r.status ?? "" : ""]);
  return JSON.stringify({ v: 1, explicitStatus, rows: sorted });
}

export function chunkRows<T>(rows: readonly T[], size = CONSENT_IMPORT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out.length ? out : [[]];
}

export interface ConsentImportSummary {
  importId: string;
  replay: boolean;
  baseline: boolean;
  rowsTotal: number;
  newOptIns: number;
  optOuts: number;
  unchanged: number;
  stale: number;
  suppressed: number;
  newCustomers: number;
}

export function summaryFromRpc(r: Record<string, unknown>): ConsentImportSummary {
  const n = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : Number(r[k] ?? 0)) || 0;
  return { importId: String(r.import_id ?? ""), replay: r.replay === true, baseline: r.baseline === true, rowsTotal: n("rows_total"),
    newOptIns: n("new_opt_ins"), optOuts: n("opt_outs"), unchanged: n("unchanged"), stale: n("stale"), suppressed: n("suppressed"),
    newCustomers: n("new_customers") };
}
