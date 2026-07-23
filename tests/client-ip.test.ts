/**
 * Unit spine — lib/client-ip.ts (A-M2 trusted client-IP extraction).
 * Pins the source-precedence order and the anti-spoof property: the
 * client-settable LEFTMOST x-forwarded-for token must never win. This is the
 * single extractor behind rate-limit keys, audit ip_address forensics, and
 * session pinning (lib/session.ts, lib/portal/session.ts, lib/api-helpers.ts
 * all delegate here as of Wave 1.5).
 */
import { describe, it, expect } from "vitest";
import { trustedClientIp, type HeaderReader } from "@/lib/client-ip";

function headersOf(entries: Record<string, string>): HeaderReader {
  const m = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => m.get(name.toLowerCase()) ?? null };
}

describe("trustedClientIp", () => {
  it("prefers x-vercel-forwarded-for over everything (platform-set, spoof-proof)", () => {
    const ip = trustedClientIp(headersOf({
      "x-vercel-forwarded-for": "198.51.100.7",
      "x-real-ip": "192.0.2.1",
      "x-forwarded-for": "6.6.6.6, 198.51.100.7",
    }));
    expect(ip).toBe("198.51.100.7");
  });

  it("falls back to x-real-ip when the vercel header is absent", () => {
    const ip = trustedClientIp(headersOf({
      "x-real-ip": "192.0.2.1",
      "x-forwarded-for": "6.6.6.6, 192.0.2.1",
    }));
    expect(ip).toBe("192.0.2.1");
  });

  it("uses the RIGHTMOST x-forwarded-for hop — a client-prepended token never wins", () => {
    // An attacker sends `X-Forwarded-For: 6.6.6.6`; the trusted proxy appends
    // the real connecting IP. Leftmost = the forgery, rightmost = the truth.
    const ip = trustedClientIp(headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("survives whitespace and empty XFF tokens", () => {
    expect(trustedClientIp(headersOf({ "x-forwarded-for": " 6.6.6.6 , , 203.0.113.9 , " })))
      .toBe("203.0.113.9");
    expect(trustedClientIp(headersOf({ "x-forwarded-for": " , , " }))).toBeNull();
  });

  it("returns null when no source header is present", () => {
    expect(trustedClientIp(headersOf({}))).toBeNull();
  });
});
