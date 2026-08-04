/**
 * Unit spine — lib/webhook-verify-shared.ts. Pins the Resend/svix webhook
 * signature contract (HMAC-SHA256 over "svixId.svixTimestamp.rawBody",
 * base64-encoded, timing-safe, 300s freshness, multi-candidate v1 header).
 *
 * This is a SECURITY-CRITICAL path that shipped BROKEN (the expected digest was
 * decoded as UTF-8 not base64 → a 44-byte vs 32-byte length mismatch rejected
 * EVERY valid signature) because it had no test. The regression guard here is the
 * `verifies a correctly signed body` case: it MUST pass against a signature
 * computed the same way the sender computes it.
 */
import { describe, it, expect } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { verifySvixSignature, SVIX_FRESHNESS_SEC } from "@/lib/webhook-verify-shared";

// A well-formed whsec_ secret: base64 of a random 32-byte key (the real svix shape).
const KEY = randomBytes(32);
const SECRET = "whsec_" + KEY.toString("base64");
const SVIX_ID = "msg_2abc";
const TS = 1784900000; // fixed instant; tests pin `now` explicitly.
const BODY = JSON.stringify({ type: "email.received", data: { from: "vendor@x.com", subject: "invoice" } });

/** Compute a valid v1 svix signature the way the sender does: base64(HMAC-SHA256). */
function sign(body: string, ts: number = TS, id: string = SVIX_ID, key: Buffer = KEY): string {
  const digest = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return `v1,${digest}`;
}

describe("verifySvixSignature", () => {
  it("(a) verifies a correctly signed, fresh body (regression: base64-decode of expected)", () => {
    expect(verifySvixSignature(SECRET, SVIX_ID, String(TS), sign(BODY), BODY, TS)).toBe(true);
    // Within the freshness window at either edge.
    expect(verifySvixSignature(SECRET, SVIX_ID, String(TS), sign(BODY), BODY, TS + SVIX_FRESHNESS_SEC)).toBe(true);
  });

  it("(b) rejects a tampered body", () => {
    const tampered = BODY.replace("invoice", "not-an-invoice");
    expect(verifySvixSignature(SECRET, SVIX_ID, String(TS), sign(BODY), tampered, TS)).toBe(false);
  });

  it("(c) rejects a tampered signature", () => {
    const good = sign(BODY);
    // Flip a character in the base64 body of the signature (keep the v1, prefix + length).
    const flipped = "v1," + good.slice(3).replace(/^./, (c) => (c === "A" ? "B" : "A"));
    expect(verifySvixSignature(SECRET, SVIX_ID, String(TS), flipped, BODY, TS)).toBe(false);
    // Also rejects an outright garbage signature and a signature over a different id.
    expect(verifySvixSignature(SECRET, SVIX_ID, String(TS), "v1,garbage", BODY, TS)).toBe(false);
    expect(verifySvixSignature(SECRET, SVIX_ID, String(TS), sign(BODY, TS, "other_id"), BODY, TS)).toBe(false);
  });

  it("(d) rejects a stale timestamp (> 300s in either direction — replay-append vector)", () => {
    expect(verifySvixSignature(SECRET, SVIX_ID, String(TS), sign(BODY), BODY, TS + SVIX_FRESHNESS_SEC + 1)).toBe(false);
    expect(verifySvixSignature(SECRET, SVIX_ID, String(TS), sign(BODY), BODY, TS - SVIX_FRESHNESS_SEC - 1)).toBe(false);
    // A signature valid for an old timestamp does not verify when replayed "now".
    const old = TS - 10_000;
    expect(verifySvixSignature(SECRET, SVIX_ID, String(old), sign(BODY, old), BODY, TS)).toBe(false);
  });

  it("(e) passes a multi-candidate header when ANY candidate is valid (key rotation)", () => {
    // Build "v0,<junk> v1,<valid>" — the brief's rotation vector: an unknown/other-version
    // entry precedes a valid v1 entry. Unknown prefixes are skipped; the valid one passes.
    const multi = `v0,${"A".repeat(44)} ${sign(BODY)}`;
    expect(verifySvixSignature(SECRET, SVIX_ID, String(TS), multi, BODY, TS)).toBe(true);
    // Two v1 candidates where only the second is valid also passes.
    const twoV1 = `v1,${"A".repeat(44)} ${sign(BODY)}`;
    expect(verifySvixSignature(SECRET, SVIX_ID, String(TS), twoV1, BODY, TS)).toBe(true);
  });

  it("(f) fails closed on a malformed secret (missing whsec_ prefix / undecodable)", () => {
    expect(verifySvixSignature("no-prefix-secret", SVIX_ID, String(TS), sign(BODY), BODY, TS)).toBe(false);
    expect(verifySvixSignature("whsec_", SVIX_ID, String(TS), sign(BODY), BODY, TS)).toBe(false);
    // A well-formed-but-WRONG key must also fail (signed under KEY, verified under a different key).
    const otherSecret = "whsec_" + randomBytes(32).toString("base64");
    expect(verifySvixSignature(otherSecret, SVIX_ID, String(TS), sign(BODY), BODY, TS)).toBe(false);
  });

  it("rejects missing headers (id / timestamp / signature)", () => {
    expect(verifySvixSignature(SECRET, null, String(TS), sign(BODY), BODY, TS)).toBe(false);
    expect(verifySvixSignature(SECRET, SVIX_ID, null, sign(BODY), BODY, TS)).toBe(false);
    expect(verifySvixSignature(SECRET, SVIX_ID, String(TS), null, BODY, TS)).toBe(false);
    // Non-numeric / non-positive timestamps.
    expect(verifySvixSignature(SECRET, SVIX_ID, "not-a-number", sign(BODY), BODY, TS)).toBe(false);
    expect(verifySvixSignature(SECRET, SVIX_ID, "0", sign(BODY, 0), BODY, TS)).toBe(false);
  });
});
