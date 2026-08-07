/**
 * Shared webhook signature verification — PURE (zero I/O, no server imports), so it can
 * be unit-tested in the vitest spine and imported by the inbound-webhook routes.
 *
 * Two schemes live here, one per provider we receive from:
 *   - svix/Resend  (verifySvixSignature)   — HMAC-SHA256, base64 (inbound email, P2).
 *   - Twilio       (verifyTwilioSignature) — HMAC-SHA1,   base64 (inbound SMS,  V2 §5c).
 *
 * SVIX VERIFICATION (node:crypto only, no new deps):
 *   Signed content : "${svix-id}.${svix-timestamp}.${rawBody}"
 *   Key            : base64-decode of the secret after stripping the "whsec_" prefix.
 *   Expected       : base64(HMAC-SHA256(key, signedContent))
 *   Header         : svix-signature contains space-separated "v1,<base64>" entries.
 *   Freshness      : |now − svix-timestamp| > 300s → reject (EZCater convention).
 *
 * NOTE (the bug this file fixes): the expected digest is base64 — both the expected
 * and the candidate MUST be base64-decoded before the timing-safe compare. Decoding
 * the base64 STRING as UTF-8 yields the wrong byte length (44 vs 32) → the length
 * guard rejects every valid signature. Both sides decode with `Buffer.from(x, "base64")`.
 * The Twilio verifier below inherits this same lesson (base64 SHA-1 = 20 bytes / 28 chars).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SVIX_FRESHNESS_SEC = 300;
const SVIX_PREFIX = "whsec_";

/**
 * Decode the svix secret to a signing key. The secret is a base64-encoded 32-byte key
 * with a "whsec_" prefix. Returns null when the format is invalid (missing prefix or
 * undecodable base64), so a malformed secret fails closed.
 */
function decodeSvixSecret(secret: string): Buffer | null {
  if (!secret.startsWith(SVIX_PREFIX)) return null;
  const b64 = secret.slice(SVIX_PREFIX.length);
  try {
    const buf = Buffer.from(b64, "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Verify a Resend/Svix webhook signature.
 *
 * Returns true iff at least one "v1,<base64>" entry in svix-signature is a valid
 * HMAC-SHA256 of "${svixId}.${svixTimestamp}.${rawBody}" under the decoded secret key,
 * AND the timestamp is within the freshness window.
 *
 * Each candidate is compared with timingSafeEqual to prevent timing attacks. When
 * multiple candidates are present (key rotation), any match passes.
 */
export function verifySvixSignature(
  secret: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
  rawBody: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Freshness — numeric timestamp in seconds.
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  if (Math.abs(nowSec - ts) > SVIX_FRESHNESS_SEC) return false;

  const key = decodeSvixSecret(secret);
  if (!key) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");
  // BASE64-decode the expected digest so it compares against the candidate's decoded
  // bytes (32 bytes for HMAC-SHA256), NOT the 44-char base64 string as UTF-8.
  const expectedBuf = Buffer.from(expected, "base64");

  // svix-signature is space-separated "v1,<base64>" entries (key rotation support).
  const candidates = svixSignature.split(" ").filter(Boolean);
  for (const entry of candidates) {
    // Strip the "v1," prefix (version tag). Unknown version prefixes are skipped.
    if (!entry.startsWith("v1,")) continue;
    const candidateB64 = entry.slice(3); // after "v1,"
    let candidateBuf: Buffer;
    try {
      candidateBuf = Buffer.from(candidateB64, "base64");
    } catch {
      continue;
    }
    // Timing-safe compare: buffers must be the same length (base64 encodes to a fixed
    // length for a given HMAC size, so a length mismatch means a different algorithm —
    // not a timing oracle, just a short-circuit skip).
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

/**
 * Verify a Twilio inbound-webhook signature (X-Twilio-Signature) — PURE (node:crypto only).
 *
 * TWILIO SCHEME (per Twilio "Validating Signatures from Twilio" docs):
 *   data     = the full request URL, then EVERY POST param appended (after the URL) as
 *              `key + value` — the params sorted lexicographically BY KEY. No separators.
 *   expected = base64(HMAC-SHA1(authToken as utf-8, data)).
 *   header   = X-Twilio-Signature carries that base64 string directly (no version prefix,
 *              unlike svix's "v1,").
 *
 * TIMING-SAFE + BASE64 lesson (mirrors verifySvixSignature): base64-DECODE both the expected
 * and the provided signature (SHA-1 → 20 bytes) and compare the DECODED BYTES with
 * timingSafeEqual, length-checked first. Comparing the 28-char base64 STRINGS as UTF-8 would
 * still work numerically but the decoded-bytes compare keeps ONE compare idiom across both
 * verifiers and dodges the whitespace/padding pitfalls of string equality.
 *
 * NO FRESHNESS WINDOW: Twilio's scheme has no timestamp; idempotency + replay protection ride
 * the provider_sid (MessageSid) partial-unique index at the ledger, not here (documented in
 * the twilio-inbound route). Returns false on any missing input or undecodable signature —
 * fail-closed. `params` are the RAW form fields (do NOT include X-Twilio-Signature itself).
 */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!authToken || !url || !signature) return false;

  // data = url + concat over keys sorted ascending of (key + value). Twilio sorts by the
  // param KEY (default string sort); the value is appended verbatim right after its key.
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  // params[k] is `string | undefined` under noUncheckedIndexedAccess; k came from Object.keys
  // so it's always present — coalesce to "" defensively (Twilio never sends a keyless value).
  for (const k of sortedKeys) data += k + (params[k] ?? "");

  const expectedB64 = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expectedB64, "base64"); // 20 bytes (SHA-1) — decoded, not UTF-8.

  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  // Length-check first (a mismatch means a different digest algorithm, not a timing oracle),
  // then constant-time compare the decoded bytes.
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}
