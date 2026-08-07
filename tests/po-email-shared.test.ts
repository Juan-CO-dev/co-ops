/**
 * Pure-gate tests for the auto-email dormancy check + validators (Vendor Ordering V2
 * §3/§6 — lib/po-email-shared.ts). These three functions are the SINGLE agreement
 * point between the send gate (po-email.ts), the panel flag (loadPoDetail), and the
 * admin tier availability (lib/admin/vendors.ts) — edge cases here are edge cases
 * everywhere, which is exactly what the vitest spine exists to pin.
 */
import { describe, expect, it } from "vitest";

import {
  RESEND_DEFAULT_DOMAIN,
  emailFromDomain,
  emailOrderingAvailable,
  isPlausibleEmail,
} from "@/lib/po-email-shared";

describe("emailFromDomain", () => {
  it("extracts the domain after the last @, lowercased", () => {
    expect(emailFromDomain("orders@ComplimentsOnlySubs.com")).toBe("complimentsonlysubs.com");
  });
  it("uses the LAST @ (display-name forms)", () => {
    expect(emailFromDomain("CO Orders <orders@shop.com>")).toBe("shop.com>"); // raw parse — callers pass bare addresses
  });
  it("null on missing @ / empty after @ / non-string", () => {
    expect(emailFromDomain("not-an-email")).toBeNull();
    expect(emailFromDomain("dangling@")).toBeNull();
    expect(emailFromDomain("dangling@   ")).toBeNull();
    expect(emailFromDomain(null)).toBeNull();
    expect(emailFromDomain(undefined)).toBeNull();
  });
});

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isPlausibleEmail("rep@vendor.com")).toBe(true);
    expect(isPlausibleEmail("  desk@orders.vendor.co  ")).toBe(true); // trimmed
  });
  it("rejects whitespace, multi-@, empty local, undotted/edge-dot domains", () => {
    expect(isPlausibleEmail("two words@vendor.com")).toBe(false);
    expect(isPlausibleEmail("a@b@c.com")).toBe(false);
    expect(isPlausibleEmail("@vendor.com")).toBe(false);
    expect(isPlausibleEmail("rep@vendor")).toBe(false);
    expect(isPlausibleEmail("rep@.vendor.com")).toBe(false);
    expect(isPlausibleEmail("rep@vendor.com.")).toBe(false);
  });
  it("never throws on junk", () => {
    expect(isPlausibleEmail("")).toBe(false);
    expect(isPlausibleEmail("   ")).toBe(false);
    expect(isPlausibleEmail(null)).toBe(false);
    expect(isPlausibleEmail(undefined)).toBe(false);
  });
});

describe("emailOrderingAvailable (the §6 dormancy gate)", () => {
  const verifiedFrom = "orders@complimentsonlysubs.com";

  it("awake: plausible alias + verified (non-resend.dev) EMAIL_FROM domain", () => {
    expect(emailOrderingAvailable("pstreet@complimentsonlysubs.com", verifiedFrom)).toBe(true);
  });
  it("dormant while EMAIL_FROM is still the Resend default domain", () => {
    expect(emailOrderingAvailable("pstreet@complimentsonlysubs.com", `onboarding@${RESEND_DEFAULT_DOMAIN}`)).toBe(false);
  });
  it("dormant with a missing or malformed alias (misconfigured ≠ awake)", () => {
    expect(emailOrderingAvailable(null, verifiedFrom)).toBe(false);
    expect(emailOrderingAvailable("", verifiedFrom)).toBe(false);
    expect(emailOrderingAvailable("   ", verifiedFrom)).toBe(false);
    expect(emailOrderingAvailable("not-an-email", verifiedFrom)).toBe(false);
    expect(emailOrderingAvailable("bad alias@shop.com", verifiedFrom)).toBe(false);
  });
  it("dormant with a missing or malformed EMAIL_FROM", () => {
    expect(emailOrderingAvailable("pstreet@complimentsonlysubs.com", null)).toBe(false);
    expect(emailOrderingAvailable("pstreet@complimentsonlysubs.com", "")).toBe(false);
    expect(emailOrderingAvailable("pstreet@complimentsonlysubs.com", "no-at-sign")).toBe(false);
  });
});
