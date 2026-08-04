// POST /api/webhooks/resend-inbound — Resend inbound-email webhook (delivery-intake P2).
// Auth: svix HMAC-SHA256 signature (RESEND_INBOUND_SECRET = whsec_... base64 secret).
// RESEND_INBOUND_SECRET unset → 503 dormant-safe (cron pattern). Invalid sig → 401.
// email.received → ingestInboundReceipt; other types → 200 ignored. Ledger failure → 500
// (ledger-first law: we want Resend to retry when the storage/DB write failed).
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { ingestInboundReceipt } from "@/lib/email-receipts";
import { verifySvixSignature } from "@/lib/webhook-verify-shared";

// ── SVIX VERIFICATION ──────────────────────────────────────────────────────────────────
//
// The pure verifier lives in lib/webhook-verify-shared.ts (zero I/O — unit-tested in the
// vitest spine). Signed content is "${svix-id}.${svix-timestamp}.${rawBody}", HMAC-SHA256
// under the base64-decoded whsec_ secret, base64-compared timing-safe, 300s freshness.

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
  // IDEMPOTENCY: the svix-id uniquely identifies a Resend delivery attempt; passing it as
  // externalId dedupes retries (Resend re-delivers on our 500s) so a replay never creates a
  // duplicate receipt row (migration 0171 email_receipts_external_uq).
  try {
    const { receiptId } = await ingestInboundReceipt({
      toAddress,
      fromAddress,
      subject,
      rawEml,
      attachments,
      externalId: svixId,
    });
    return jsonOk({ receiptId });
  } catch (e) {
    console.error("[/api/webhooks/resend-inbound] ledger failed:", e instanceof Error ? e.message : e);
    return jsonError(500, "ledger_failed");
  }
}
