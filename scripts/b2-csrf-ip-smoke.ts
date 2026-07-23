/**
 * B2 security-primitives smoke — CSRF guard (A-H5) + trusted client IP (A-M2).
 *
 * Unit-level proof that the new request-acceptance logic decides correctly. The atomic limiter
 * (A-M1) is proven separately via a direct RPC self-test. The end-to-end login + customer-order
 * smoke on the preview URL is a MANUAL check (allowlist-gated magic-link flow).
 *
 *   npx tsx scripts/b2-csrf-ip-smoke.ts
 */

import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { trustedClientIp } from "@/lib/client-ip";

const HOST = "app.example.com";

/** Minimal NextRequest stand-in: assertSameOrigin only touches headers + nextUrl.host. */
function mockReq(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers), nextUrl: { host: HOST } } as unknown as NextRequest;
}

/** trustedClientIp takes a headers-like reader directly (Wave 1.5 signature). */
function mockHeaders(headers: Record<string, string>): Headers {
  return new Headers(headers);
}

function main() {
  console.log("B2 CSRF + trusted-IP smoke\n");

  // ── A-H5: assertSameOrigin — null = allow, non-null (403) = deny ──────────────────
  assert.equal(assertSameOrigin(mockReq({ origin: `https://${HOST}` })), null, "same-origin allowed");
  assert.equal(assertSameOrigin(mockReq({ origin: `https://${HOST}`, "sec-fetch-site": "same-origin" })), null, "same-origin + sec-fetch-site allowed");
  assert.notEqual(assertSameOrigin(mockReq({})), null, "MISSING origin denied (the A-H5 hole)");
  assert.notEqual(assertSameOrigin(mockReq({ origin: "https://evil.example.net" })), null, "cross-site origin denied");
  assert.notEqual(assertSameOrigin(mockReq({ origin: `https://${HOST}`, "sec-fetch-site": "cross-site" })), null, "sec-fetch-site cross-site denied even with matching origin");
  assert.notEqual(assertSameOrigin(mockReq({ origin: "not-a-url" })), null, "malformed origin denied");
  console.log("  ✓ A-H5 CSRF: same-origin allowed; missing / cross-site / bad Origin + cross-site Sec-Fetch-Site all denied");

  // ── A-M2: trustedClientIp — platform header wins; leftmost XFF is NOT trusted ──────
  assert.equal(trustedClientIp(mockHeaders({ "x-vercel-forwarded-for": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 9.9.9.9" })), "9.9.9.9", "x-vercel-forwarded-for wins");
  assert.equal(trustedClientIp(mockHeaders({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1, 8.8.8.8" })), "8.8.8.8", "x-real-ip wins over XFF");
  assert.equal(trustedClientIp(mockHeaders({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" })), "3.3.3.3", "rightmost XFF hop used, NOT the spoofable leftmost");
  assert.equal(trustedClientIp(mockHeaders({ "x-forwarded-for": "1.1.1.1" })), "1.1.1.1", "single-hop XFF");
  assert.equal(trustedClientIp(mockHeaders({})), null, "no source → null");
  // The spoof: an attacker prepends a fake leftmost value — trustedClientIp must NOT return it.
  assert.notEqual(trustedClientIp(mockHeaders({ "x-forwarded-for": "6.6.6.6, 3.3.3.3" })), "6.6.6.6", "attacker-prepended leftmost is NOT trusted");
  console.log("  ✓ A-M2 trusted IP: vercel/real-ip preferred; rightmost XFF hop used; spoofable leftmost ignored");

  console.log("\nb2-csrf-ip-smoke: PASS");
  process.exit(0);
}

main();
