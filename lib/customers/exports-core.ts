/**
 * Marketing + Meta export cores — pure functions over rows (node:crypto for SHA-256; no I/O). 0234.
 *
 * THE LAW (Juan 2026-10-07): contact data is usable for marketing ONLY where the person opted in. No
 * workarounds. Every marketing file — the email list and the Meta Custom Audience file — is built from
 * `customer_marketing_export` (SQL returns opted-in subjects only) AND passes `optedInOnly` here: a
 * second, independent filter. Neither function takes a parameter that could widen the set; there is
 * no override, by construction (pinned by tests/customer-exports.test.ts).
 *
 * Meta (Pete's OK pending): the file is built and downloadable only while META_AUDIENCE_EXPORT=1, by
 * level 9+, audited. Nothing is uploaded or synced anywhere: there is no Meta client in this codebase.
 * Normalisation follows Meta's customer-file guidance: email trimmed + lowercased; phone digits only
 * with country code, no "+"; each hashed SHA-256, lowercase hex.
 */
import { createHash } from "node:crypto";
import { CSV_BOM, csvField } from "@/lib/report-export-shared";
import { normalizeEmail } from "./identity-shared";

export interface MarketingSourceRow {
  customer_id: string;
  value: string;
  first_name: string | null;
  last_name: string | null;
  opted_in_at: string;
  source: string;
  /** Present when the caller re-checks; the SQL read only returns opted_in rows. */
  status?: string;
}

/** The second filter. A row without an explicit opted_in status from the SQL read is dropped too. */
export function optedInOnly<T extends { status?: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.status === "opted_in");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function metaEmailHash(email: string): string | null {
  const v = normalizeEmail(email);
  return v ? sha256Hex(v) : null;
}

/** E.164 in, Meta's spelling (country code + number, digits only) hashed. */
export function metaPhoneHash(e164: string): string | null {
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  return sha256Hex(e164.slice(1));
}

export function metaAudienceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.META_AUDIENCE_EXPORT === "1";
}

const line = (cells: readonly string[]) => cells.map(csvField).join(",");

/** The email marketing list (level 9+): opted-in addresses with the consent evidence beside them. */
export function marketingCsv(rows: readonly MarketingSourceRow[]): { csv: string; count: number } {
  const kept = optedInOnly(rows);
  const lines = [line(["email", "first_name", "last_name", "opted_in_at", "consent_source"])];
  for (const r of kept) lines.push(line([r.value, r.first_name ?? "", r.last_name ?? "", r.opted_in_at, r.source]));
  return { csv: `${CSV_BOM}${lines.join("\r\n")}\r\n`, count: kept.length };
}

/**
 * The Meta Custom Audience customer file: hashed identifiers only, one row per person. An email row
 * comes from EMAIL consent, a phone from SMS consent; a person never contributes a channel they did not
 * opt into. No names, no raw contact.
 */
export function metaAudienceCsv(emailRows: readonly MarketingSourceRow[], smsRows: readonly MarketingSourceRow[]): { csv: string; count: number } {
  const people = new Map<string, { email: string | null; phone: string | null }>();
  for (const r of optedInOnly(emailRows)) {
    const h = metaEmailHash(r.value);
    if (!h) continue;
    const p = people.get(r.customer_id) ?? { email: null, phone: null };
    p.email ??= h;
    people.set(r.customer_id, p);
  }
  for (const r of optedInOnly(smsRows)) {
    const h = metaPhoneHash(r.value);
    if (!h) continue;
    const p = people.get(r.customer_id) ?? { email: null, phone: null };
    p.phone ??= h;
    people.set(r.customer_id, p);
  }
  const lines = [line(["email", "phone"])];
  const sorted = [...people.values()].sort((a, b) => `${a.email}${a.phone}`.localeCompare(`${b.email}${b.phone}`));
  for (const p of sorted) lines.push(line([p.email ?? "", p.phone ?? ""]));
  return { csv: `${lines.join("\r\n")}\r\n`, count: sorted.length };
}
