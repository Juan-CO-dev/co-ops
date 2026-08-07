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
import { verifySvixSignature, verifyTwilioSignature, SVIX_FRESHNESS_SEC } from "@/lib/webhook-verify-shared";

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

/**
 * Unit spine — verifyTwilioSignature (Vendor Ordering V2 §5c, SMS inbound webhook).
 * Twilio scheme: signature = base64(HMAC-SHA1(authToken, url + concat(sortedKeys.map(k =>
 * k + params[k])))). Vectors are computed IN-TEST with node:crypto the way Twilio's sender
 * computes them, so the suite is self-consistent (no external fixtures) and the
 * regression guard is `(a) verifies a correctly signed request`.
 */
const TW_TOKEN = randomBytes(16).toString("hex"); // Twilio auth tokens are 32 hex chars; any string works.
const TW_URL = "https://co-ops.example.com/api/webhooks/twilio-inbound";
const TW_PARAMS: Record<string, string> = {
  From: "+13015550142",
  To: "+18445550100",
  Body: "Order XPST-20260806-SYSCO confirmed, out for delivery",
  MessageSid: "SM0123456789abcdef0123456789abcdef",
  NumMedia: "0",
};

/** Compute a valid X-Twilio-Signature the way Twilio's sender does. */
function twSign(url: string, params: Record<string, string>, token: string = TW_TOKEN): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + (params[k] ?? ""), url);
  return createHmac("sha1", token).update(data, "utf8").digest("base64");
}

describe("verifyTwilioSignature", () => {
  it("(a) verifies a correctly signed request (regression: base64 SHA-1 decode + key-sorted concat)", () => {
    expect(verifyTwilioSignature(TW_TOKEN, TW_URL, TW_PARAMS, twSign(TW_URL, TW_PARAMS))).toBe(true);
  });

  it("(b) rejects a wrong auth token", () => {
    const otherToken = randomBytes(16).toString("hex");
    // Signed under the real token, verified under a different one.
    expect(verifyTwilioSignature(otherToken, TW_URL, TW_PARAMS, twSign(TW_URL, TW_PARAMS))).toBe(false);
    // A signature computed under the wrong token also fails against the real token.
    expect(verifyTwilioSignature(TW_TOKEN, TW_URL, TW_PARAMS, twSign(TW_URL, TW_PARAMS, otherToken))).toBe(false);
  });

  it("(c) rejects a wrong URL (the URL is part of the signed data — proxy/host tampering)", () => {
    const otherUrl = "https://evil.example.com/api/webhooks/twilio-inbound";
    expect(verifyTwilioSignature(TW_TOKEN, otherUrl, TW_PARAMS, twSign(TW_URL, TW_PARAMS))).toBe(false);
    // A trailing-path or scheme change also breaks the signature.
    expect(verifyTwilioSignature(TW_TOKEN, TW_URL + "/", TW_PARAMS, twSign(TW_URL, TW_PARAMS))).toBe(false);
  });

  it("(d) is invariant to param INSERTION ORDER (Twilio sorts by key — object key order must not matter)", () => {
    // Build a differently-ordered object with the SAME key/value pairs; the sort inside the
    // verifier + signer must produce the identical digest.
    const reordered: Record<string, string> = {
      NumMedia: TW_PARAMS.NumMedia!,
      MessageSid: TW_PARAMS.MessageSid!,
      Body: TW_PARAMS.Body!,
      To: TW_PARAMS.To!,
      From: TW_PARAMS.From!,
    };
    // Sign over the canonical order, verify against the reordered object → still valid.
    expect(verifyTwilioSignature(TW_TOKEN, TW_URL, reordered, twSign(TW_URL, TW_PARAMS))).toBe(true);
    // And the signature computed FROM the reordered object equals the canonical one.
    expect(twSign(TW_URL, reordered)).toBe(twSign(TW_URL, TW_PARAMS));
  });

  it("(e) rejects a MISSING param (a dropped/added field changes the signed data)", () => {
    const missingBody = { ...TW_PARAMS };
    delete missingBody.Body;
    // Signature was over the full param set; verifying with a param dropped fails.
    expect(verifyTwilioSignature(TW_TOKEN, TW_URL, missingBody, twSign(TW_URL, TW_PARAMS))).toBe(false);
    // An EXTRA param (tamper-injected) also fails.
    const extra = { ...TW_PARAMS, Injected: "1" };
    expect(verifyTwilioSignature(TW_TOKEN, TW_URL, extra, twSign(TW_URL, TW_PARAMS))).toBe(false);
  });

  it("(f) verifies with EMPTY params (a bare GET-style URL sig; data = url only)", () => {
    const empty: Record<string, string> = {};
    expect(verifyTwilioSignature(TW_TOKEN, TW_URL, empty, twSign(TW_URL, empty))).toBe(true);
    // But an empty-params signature must NOT validate a request that actually carried params.
    expect(verifyTwilioSignature(TW_TOKEN, TW_URL, TW_PARAMS, twSign(TW_URL, empty))).toBe(false);
  });

  it("(g) fails closed on missing token / url / signature", () => {
    expect(verifyTwilioSignature("", TW_URL, TW_PARAMS, twSign(TW_URL, TW_PARAMS))).toBe(false);
    expect(verifyTwilioSignature(TW_TOKEN, "", TW_PARAMS, twSign(TW_URL, TW_PARAMS))).toBe(false);
    expect(verifyTwilioSignature(TW_TOKEN, TW_URL, TW_PARAMS, null)).toBe(false);
    expect(verifyTwilioSignature(TW_TOKEN, TW_URL, TW_PARAMS, "")).toBe(false);
    // Garbage signature (still base64-decodable but wrong length/bytes) → false, no throw.
    expect(verifyTwilioSignature(TW_TOKEN, TW_URL, TW_PARAMS, "garbage")).toBe(false);
  });
});
