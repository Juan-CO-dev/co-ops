/**
 * Pure-extraction tests for the inbound PO-matching key (Vendor Ordering V2 §4 —
 * lib/email-receipts.ts extractPoCodes). This regex is the DETERMINISTIC strongest match
 * key: a vendor document quoting a PO display code links to both the order AND the location.
 * It is also reused verbatim by the SMS leg (Task 7), so its boundaries are load-bearing in
 * two channels — exactly what the vitest spine exists to pin.
 *
 * Grammar (spec §5b.3 / lib/purchase-orders.ts baseDisplayCode):
 *   {1-8 alnum}-{exactly 8 digits}-{1-6 alnum}(-{digits})?
 * with non-alphanumeric boundaries on both sides (an embedded fragment must NOT match).
 */
import { describe, expect, it } from "vitest";

// The pure extractor lives in the client-safe leaf (lib/email-receipts.ts is server-only
// and re-exports it); the vitest spine imports the leaf directly.
import { extractPoCodes } from "@/lib/email-receipts-matching-shared";

describe("extractPoCodes", () => {
  it("extracts a plain code standing alone", () => {
    expect(extractPoCodes("Your order CH-20260806-SYSCO is confirmed.")).toEqual(["CH-20260806-SYSCO"]);
  });

  it("extracts a code with a -N collision suffix", () => {
    expect(extractPoCodes("re: PST-20260806-BALDOR-2 shipped")).toEqual(["PST-20260806-BALDOR-2"]);
  });

  it("uppercases lowercased input (codes store uppercase)", () => {
    expect(extractPoCodes("order ch-20260806-sysco received")).toEqual(["CH-20260806-SYSCO"]);
  });

  it("matches across boundaries: parens, colons, newlines, slashes", () => {
    const codes = extractPoCodes("(CH-20260806-SYSCO)\nInvoice for: PST-20260807-BH/thanks");
    expect(codes).toContain("CH-20260806-SYSCO");
    expect(codes).toContain("PST-20260807-BH");
  });

  it("REJECTS a code embedded inside a longer alphanumeric token (vendor-frag run > 6)", () => {
    // The maximal alnum run after the date is SYSCOXY (7 chars). The vendor fragment is
    // {1,6}; the trailing (?![A-Z0-9]) boundary then rejects EVERY greedy backtrack (SYSCOX
    // → sees Y; SYSCO → sees X; …) → no bounded code can be carved out of the embed.
    expect(extractPoCodes("XPST-20260806-SYSCOXY")).toEqual([]);
  });

  it("REJECTS an over-length location fragment (loc-frag run > 8)", () => {
    // ABCDEFGHI is a 9-char run before the date → no {1,8} loc fragment is boundary-bounded.
    expect(extractPoCodes("ABCDEFGHI-20260806-PFG")).toEqual([]);
  });

  it("accepts a legitimate 6-char vendor fragment (grammar cap is 6 — e.g. BALDOR)", () => {
    // DOCUMENTED LIMIT: a maximal 6-char run AT a boundary is grammatically a valid vendor
    // fragment (vendorCodeFragment slices to 6; BALDOR = 6). An exactly-6 embed like
    // `…-SYSCOX` (SYSCO + a spurious X, run = 6) is therefore INDISTINGUISHABLE from a real
    // 6-char code and DOES match — but it is harmless: matchReceiptToPo validates every code
    // against real POs, so a phantom 6-char code finds no PO and falls through to triage,
    // never a wrong link. Only 7+-char embeds are structurally rejectable (test above).
    expect(extractPoCodes("CH-20260806-BALDOR")).toEqual(["CH-20260806-BALDOR"]);
  });

  it("REJECTS a middle segment that is not exactly 8 digits (9-digit date)", () => {
    expect(extractPoCodes("CH-202608061-SYSCO")).toEqual([]);
  });

  it("REJECTS a date that is not exactly 8 digits", () => {
    expect(extractPoCodes("CH-2026086-SYSCO CH-202608067-BH")).toEqual([]);
  });

  it("REJECTS a vendor fragment longer than 6 alnum", () => {
    // SEVENCH is 7 chars → no bounded 1-6 fragment can be isolated (the 7th breaks the right
    // boundary and there's no non-alnum split inside the token).
    expect(extractPoCodes("CH-20260806-SEVENCH")).toEqual([]);
  });

  it("de-dupes repeated codes", () => {
    expect(extractPoCodes("CH-20260806-SYSCO ... again CH-20260806-SYSCO")).toEqual(["CH-20260806-SYSCO"]);
  });

  it("caps the number of distinct codes at 10", () => {
    // 12 distinct valid codes → only the first 10 are kept (bounds the `.in()` fan-out).
    const many = Array.from({ length: 12 }, (_, i) => `CH-2026080${i % 10}-V${i}`).join(" ");
    expect(extractPoCodes(many).length).toBe(10);
  });

  it("never throws on junk / empty / non-string", () => {
    expect(extractPoCodes("")).toEqual([]);
    expect(extractPoCodes("no codes here at all, just prose 123-abc")).toEqual([]);
    // @ts-expect-error — defensive against a non-string at a call boundary.
    expect(extractPoCodes(null)).toEqual([]);
    // @ts-expect-error — defensive against a non-string at a call boundary.
    expect(extractPoCodes(undefined)).toEqual([]);
  });

  it("finds multiple distinct codes in one document (multi-PO email)", () => {
    const codes = extractPoCodes("Two orders: CH-20260806-SYSCO and PST-20260806-BALDOR.");
    expect(new Set(codes)).toEqual(new Set(["CH-20260806-SYSCO", "PST-20260806-BALDOR"]));
  });
});
