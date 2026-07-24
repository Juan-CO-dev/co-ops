/**
 * Unit spine — lib/ezcater/webhook-shared.ts. Pins the X-Ezcater-Signature
 * contract (timestamp.hmac over "timestamp.body", HMAC-SHA256, timing-safe)
 * and notification-parse poisoning. Shape source: ezCater Public API User
 * Guide May 2024 v5 (fixture-fiction rule).
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { parseEzcaterSignature, verifyEzcaterSignature, parseEzcaterNotification, SIGNATURE_FRESHNESS_SEC } from "@/lib/ezcater/webhook-shared";

const SECRET = "test-webhook-secret";
const BODY = JSON.stringify({ id: "n-1", parent_type: "Caterer", parent_id: "cat-1", entity_type: "Order", entity_id: "ord-1", key: "accepted", occurred_at: "2026-07-24T09:00:00Z" });
function sign(body: string, secret = SECRET, ts = 1784900000): string {
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `${ts}.${sig}`;
}

describe("parseEzcaterSignature", () => {
  it("splits timestamp.signature", () => {
    expect(parseEzcaterSignature("1784900000.abc123")).toEqual({ timestampSec: 1784900000, signature: "abc123" });
  });
  it("rejects malformed headers", () => {
    for (const h of [null, "", "nodot", ".sigonly", "123.", "notanumber.sig"]) {
      expect(parseEzcaterSignature(h)).toBeNull();
    }
  });
});

describe("verifyEzcaterSignature", () => {
  const NOW = 1784900000; // matches sign()'s default ts — tests pin freshness explicitly
  it("accepts a correctly signed, fresh body", () => {
    expect(verifyEzcaterSignature(SECRET, sign(BODY), BODY, NOW)).toBe(true);
    expect(verifyEzcaterSignature(SECRET, sign(BODY), BODY, NOW + SIGNATURE_FRESHNESS_SEC)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyEzcaterSignature(SECRET, sign(BODY), BODY.replace("accepted", "cancelled"), NOW)).toBe(false);
  });
  it("rejects the wrong secret and malformed headers", () => {
    expect(verifyEzcaterSignature("other-secret", sign(BODY), BODY, NOW)).toBe(false);
    expect(verifyEzcaterSignature(SECRET, "garbage", BODY, NOW)).toBe(false);
  });
  it("rejects stale signatures beyond the freshness window (replay-append vector)", () => {
    expect(verifyEzcaterSignature(SECRET, sign(BODY), BODY, NOW + SIGNATURE_FRESHNESS_SEC + 1)).toBe(false);
    expect(verifyEzcaterSignature(SECRET, sign(BODY), BODY, NOW - SIGNATURE_FRESHNESS_SEC - 1)).toBe(false);
  });
});

describe("parseEzcaterNotification", () => {
  it("parses the documented payload shape", () => {
    const n = parseEzcaterNotification(JSON.parse(BODY));
    expect(n).toEqual({
      notificationId: "n-1", parentId: "cat-1", entityType: "Order",
      entityId: "ord-1", key: "accepted", occurredAt: "2026-07-24T09:00:00Z",
    });
  });
  it("poisons on missing load-bearing fields", () => {
    expect(() => parseEzcaterNotification({})).toThrow(/parent_id/);
    expect(() => parseEzcaterNotification({ parent_id: "c", key: "accepted" })).toThrow(/entity_id/);
    expect(() => parseEzcaterNotification({ parent_id: "c", entity_id: "o" })).toThrow(/key/);
    expect(() => parseEzcaterNotification("nope")).toThrow();
  });
});
