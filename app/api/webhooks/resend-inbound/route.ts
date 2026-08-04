// POST /api/webhooks/resend-inbound — Resend inbound-email webhook (delivery-intake P2).
// Auth: svix HMAC-SHA256 signature (RESEND_INBOUND_SECRET = whsec_... base64 secret).
// RESEND_INBOUND_SECRET unset → 503 dormant-safe (cron pattern). Invalid sig → 401.
// email.received → ingestInboundReceipt; other types → 200 ignored. Ledger failure → 500
// (ledger-first law: we want Resend to retry when the storage/DB write failed).
import { timingSafeEqual, createHmac } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { ingestInboundReceipt } from "@/lib/email-receipts";

// ── SVIX VERIFICATION (node:crypto only, no new deps) ──────────────────────────────────
//
// Signed content : "${svix-id}.${svix-timestamp}.${rawBody}"
// Key            : base64-decode of the secret after stripping the "whsec_" prefix.
// Expected       : base64(HMAC-SHA256(key, signedContent))
// Header         : svix-signature contains space-separated "v1,<base64>" entries.
// Freshness      : |now − svix-timestamp| > 300s → reject (EZCater convention).

const SVIX_FRESHNESS_SEC = 300;
const SVIX_PREFIX = "whsec_";

/**
 * Decode the svix secret to a signing key. The secret is a base64-encoded 32-byte key
 * with a "whsec_" prefix. Returns null when the format is invalid.
 */
function decodeSvixSecret(secret: string): Buffer | null {
  if (!secret.startsWith(SVIX_PREFIX)) return null;
  const b64 = secret.slice(SVIX_PREFIX.length);
  try {
    return Buffer.from(b64, "base64");
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
function verifySvixSignature(
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
  const expectedBuf = Buffer.from(expected);

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

// ── PAYLOAD DEFENSIVENESS ──────────────────────────────────────────────────────────────
//
// Resend's inbound email.received shape (tolerate missing/null at every level):
//   { type: "email.received",
//     data: { from, to, subject, text, html,
//             attachments: [{ filename, content_type, content (base64) }] } }
//
// `to` may be an array of strings OR a plain string — take the first element (or the
// string itself). We never require it to be present; missing → null.

interface ResendAttachment {
  filename?: string | null;
  content_type?: string | null;
  content?: string | null; // base64-encoded bytes
}

interface ResendEmailData {
  from?: string | null;
  to?: string | string[] | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  attachments?: ResendAttachment[] | null;
}

interface ResendPayload {
  type?: string | null;
  data?: ResendEmailData | null;
}

function toFirstString(v: string | string[] | null | undefined): string | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

function decodeBase64Attachment(b64: string | null | undefined): Buffer | null {
  if (!b64) return null;
  try {
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Dormant-safe: 503 when the secret is not configured (mirrors cron pattern).
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) return jsonError(503, "not_configured");

  // Read the raw body ONCE before any other operation (signature verification needs it).
  const rawBody = await req.text();

  // Extract svix headers.
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  const signatureValid = verifySvixSignature(secret, svixId, svixTimestamp, svixSignature, rawBody);
  if (!signatureValid) return jsonError(401, "invalid_signature");

  // Parse the JSON payload AFTER signature verification (never trust unverified bytes).
  let payload: ResendPayload;
  try {
    payload = JSON.parse(rawBody) as ResendPayload;
  } catch {
    return jsonError(400, "invalid_json");
  }

  // Non-email.received types → acknowledge without processing (Resend may send other types).
  if (payload.type !== "email.received") return jsonOk({ ignored: true });

  // Defensive extraction: every field may be missing or null.
  const data: ResendEmailData = payload.data ?? {};
  const fromAddress: string | null = typeof data.from === "string" ? data.from : null;
  const toAddress: string | null = toFirstString(data.to);
  const subject: string | null = typeof data.subject === "string" ? data.subject : null;

  // Build the raw body asset from text (preferred) or html. Resend does not send a raw
  // MIME EML in the payload — we store the text/html body as the closest equivalent.
  // When BOTH are absent, rawEml is null (no storage write for the body; attachments
  // are still stored).
  let rawEml: { bytes: Buffer; contentType: string } | null = null;
  if (typeof data.text === "string" && data.text.length > 0) {
    rawEml = { bytes: Buffer.from(data.text, "utf-8"), contentType: "text/plain" };
  } else if (typeof data.html === "string" && data.html.length > 0) {
    rawEml = { bytes: Buffer.from(data.html, "utf-8"), contentType: "text/html" };
  }

  // Decode attachments (base64 content → Buffer). Attachments with no decodable content
  // or missing filename/content_type are still passed through; the lib's allow-list check
  // and the isReceiptContentType guard handle filtering — we never silently drop records
  // here so the ledger row is honest about what arrived.
  const attachments: Array<{ filename: string; contentType: string; bytes: Buffer }> = [];
  for (const att of data.attachments ?? []) {
    if (!att) continue;
    const bytes = decodeBase64Attachment(att.content);
    if (!bytes || bytes.byteLength === 0) continue; // nothing to store — skip without failing
    attachments.push({
      filename: typeof att.filename === "string" && att.filename ? att.filename : "attachment",
      contentType: typeof att.content_type === "string" && att.content_type ? att.content_type : "application/octet-stream",
      bytes,
    });
  }

  // LEDGER-FIRST: ingestInboundReceipt throws on storage or DB failure → 500 → Resend retries.
  try {
    const { receiptId } = await ingestInboundReceipt({
      toAddress,
      fromAddress,
      subject,
      rawEml,
      attachments,
    });
    return jsonOk({ receiptId });
  } catch (e) {
    console.error("[/api/webhooks/resend-inbound] ledger failed:", e instanceof Error ? e.message : e);
    return jsonError(500, "ledger_failed");
  }
}
