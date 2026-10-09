/** 0234 consent: latest event wins (opt-out wins a tie), Toast CSV parsing, import idempotency key, chunking. */
import { describe, expect, it } from "vitest";
import {
  CONSENT_IMPORT_CHUNK, ConsentCsvError, canonicalImportPayload, chunkRows, latestConsent, mergeConsentFiles, parseConsentCsv, statusFromCell,
} from "@/lib/customers/consent-shared";

const ev = (id: string, status: "opted_in" | "opted_out", effectiveAt: string, recordedAt = effectiveAt) => ({ id, status, effectiveAt, recordedAt });

describe("latestConsent", () => {
  it("the latest effective event is the current status", () => {
    expect(latestConsent([ev("a", "opted_in", "2026-10-01T00:00:00Z"), ev("b", "opted_out", "2026-10-05T00:00:00Z")])!.status).toBe("opted_out");
    expect(latestConsent([ev("a", "opted_out", "2026-10-01T00:00:00Z"), ev("b", "opted_in", "2026-10-05T00:00:00Z")])!.status).toBe("opted_in");
  });
  it("an older export recorded later does not resurrect an unsubscribe", () => {
    const out = ev("a", "opted_out", "2026-10-06T00:00:00Z", "2026-10-06T00:00:00Z");
    const staleIn = ev("b", "opted_in", "2026-10-04T00:00:00Z", "2026-10-08T00:00:00Z");
    expect(latestConsent([out, staleIn])!.id).toBe("a");
  });
  it("on the same instant an opt-out wins", () => {
    expect(latestConsent([ev("z", "opted_in", "2026-10-05T00:00:00Z", "2026-10-09T00:00:00Z"), ev("a", "opted_out", "2026-10-05T00:00:00Z")])!.status).toBe("opted_out");
  });
  it("no events = no status", () => expect(latestConsent([])).toBeNull());
});

describe("parseConsentCsv (Toast Web Marketing export)", () => {
  it("finds the email column by header and keeps names/phone", () => {
    const f = parseConsentCsv("﻿First Name,Last Name,Email,Phone\r\nAna,Diaz,Ana@Example.com,(202) 555-0101\r\nBo,Li,bo@example.com,\r\n");
    expect(f.explicitStatus).toBe(false);
    expect(f.rows).toEqual([
      { email: "ana@example.com", phone: "+12025550101", first_name: "Ana", last_name: "Diaz" },
      { email: "bo@example.com", first_name: "Bo", last_name: "Li" },
    ]);
  });
  it("accepts a headerless list of emails", () => {
    const f = parseConsentCsv("ana@example.com\nbo@example.com\n");
    expect(f.rows.map((r) => r.email)).toEqual(["ana@example.com", "bo@example.com"]);
  });
  it("a status column makes the import explicit; unknown statuses refuse the file", () => {
    const f = parseConsentCsv('email,status\nana@example.com,Subscribed\nbo@example.com,"Unsubscribed"\n');
    expect(f.explicitStatus).toBe(true);
    expect(f.rows.map((r) => r.status)).toEqual(["opted_in", "opted_out"]);
    expect(() => parseConsentCsv("email,status\nana@example.com,maybe\n")).toThrow(ConsentCsvError);
  });
  it("duplicates collapse and an unsubscribe anywhere wins", () => {
    const f = parseConsentCsv("email,status\nana@example.com,subscribed\nANA@example.com,unsubscribed\n");
    expect(f.rows).toEqual([{ email: "ana@example.com", status: "opted_out" }]);
    expect(f.duplicates).toBe(1);
  });
  it("unreadable rows are counted, not imported", () => {
    const f = parseConsentCsv("email\nana@example.com\nnot-an-email\n");
    expect(f.rows).toHaveLength(1);
    expect(f.invalid).toBe(1);
  });
  it("quoted fields with commas parse", () => {
    expect(parseConsentCsv('email,first name\n"ana@example.com","Diaz, Ana"\n').rows[0]!.first_name).toBe("Diaz, Ana");
  });
  it("a file with no email column is refused", () => {
    expect(() => parseConsentCsv("name,phone\nAna,2025550101\n")).toThrow("csv_no_email_column");
  });
  it("status words", () => {
    expect(statusFromCell("Opted In")).toBe("opted_in");
    expect(statusFromCell("bounced")).toBe("opted_out");
    expect(statusFromCell("??")).toBeNull();
  });
});

describe("merging one export's files + the idempotency key", () => {
  it("files from one export become one list (Toast splits by shop)", () => {
    const m = mergeConsentFiles([parseConsentCsv("email\nana@example.com\n"), parseConsentCsv("email\nbo@example.com\nana@example.com\n")]);
    expect(m.rows.map((r) => r.email)).toEqual(["ana@example.com", "bo@example.com"]);
    expect(m.duplicates).toBe(1);
  });
  it("mixing a status file with a plain list is refused", () => {
    expect(() => mergeConsentFiles([parseConsentCsv("email\na@example.com\n"), parseConsentCsv("email,status\nb@example.com,subscribed\n")])).toThrow("csv_mixed_status");
  });
  it("the same rows in any order (and any file split) give the same key", () => {
    const a = mergeConsentFiles([parseConsentCsv("email\nbo@example.com\nana@example.com\n")]);
    const b = mergeConsentFiles([parseConsentCsv("email\nana@example.com\n"), parseConsentCsv("email\nbo@example.com\n")]);
    expect(canonicalImportPayload(a.rows, a.explicitStatus)).toBe(canonicalImportPayload(b.rows, b.explicitStatus));
  });
  it("a changed row changes the key", () => {
    const a = mergeConsentFiles([parseConsentCsv("email\nana@example.com\n")]);
    const b = mergeConsentFiles([parseConsentCsv("email\nana2@example.com\n")]);
    expect(canonicalImportPayload(a.rows, false)).not.toBe(canonicalImportPayload(b.rows, false));
  });
  it("chunks stay within the SQL's 1000-row bound", () => {
    const rows = Array.from({ length: 2501 }, (_, i) => i);
    const chunks = chunkRows(rows);
    expect(chunks.map((c) => c.length)).toEqual([1000, 1000, 501]);
    expect(CONSENT_IMPORT_CHUNK).toBe(1000);
  });
});
