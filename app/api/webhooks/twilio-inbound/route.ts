// POST /api/webhooks/twilio-inbound — Twilio inbound-SMS webhook (Vendor Ordering V2 §5c / V2-D5).
// Auth: X-Twilio-Signature HMAC-SHA1 over (full URL + key-sorted form params), verified via the
// pure verifyTwilioSignature (lib/webhook-verify-shared.ts, unit-tested).
//
// DORMANT-SAFE (spec §6): 503 {reason:"sms_dormant"} when TWILIO_AUTH_TOKEN is unset — the SMS leg
// wakes only once the Twilio-number errand lands. Invalid signature → 401. Ledger failure → 500
// (Twilio retries on any non-2xx — mirrors the resend-inbound ledger-first choice; idempotency
// rides the MessageSid provider_sid at the ledger, so a retry never duplicates the row).
//
// TwiML RESPONSE: Twilio expects a TwiML document (text/xml). We return an EMPTY <Response/> —
// no auto-reply SMS goes back to the vendor (V1 of this leg is receive-only; the outbound seam
// stays dark until the number is provisioned, spec §8). A 200 with empty TwiML tells Twilio the
// message was accepted and to send nothing.
import { type NextRequest } from "next/server";
import { jsonError } from "@/lib/api-helpers";
import { verifyTwilioSignature } from "@/lib/webhook-verify-shared";
import { ingestInboundSms } from "@/lib/sms-messages";

/** Empty TwiML — accepted, no auto-reply. */
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Cap on MMS media URLs we record — Twilio caps NumMedia at 10; a crafted higher value must
 *  not fan out an unbounded loop. */
const MAX_MEDIA = 10;

function twimlOk(): Response {
  return new Response(EMPTY_TWIML, { status: 200, headers: { "content-type": "text/xml" } });
}

/**
 * Reconstruct the full URL Twilio signed. Twilio signs the URL it POSTed to; behind a proxy
 * (Vercel) the inbound req.url may differ from the public URL Twilio called (host rewrite,
 * scheme). So we prefer an explicit TWILIO_WEBHOOK_URL env (the exact configured webhook URL)
 * and fall back to req.url only when it is unset. PROXY CAVEAT: if signatures fail in prod,
 * the fix is to set TWILIO_WEBHOOK_URL to the exact string configured in the Twilio console
 * (including scheme + host + path, no query for a POST) — never to weaken verification.
 */
function signedUrl(req: NextRequest): string {
  return process.env.TWILIO_WEBHOOK_URL || req.url;
}

export async function POST(req: NextRequest) {
  // Dormant-safe: 503 when the Twilio auth token is not configured (mirrors the cron/resend pattern).
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return jsonError(503, "sms_dormant");

  // Read the raw body ONCE before anything else (signature verification needs the exact bytes).
  // Twilio posts application/x-www-form-urlencoded; parse with URLSearchParams.
  const rawBody = await req.text();
  const form = new URLSearchParams(rawBody);

  // Build the params map Twilio signed: EVERY posted field (flattened; last value wins for a
  // repeated key, which Twilio doesn't send anyway). X-Twilio-Signature is a HEADER, not a body
  // field, so it is correctly excluded here.
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = v;

  const signature = req.headers.get("x-twilio-signature");
  if (!verifyTwilioSignature(authToken, signedUrl(req), params, signature)) {
    // Observable breadcrumb for the documented proxy failure mode: if Vercel's request URL
    // diverges from what Twilio actually called, EVERY webhook lands here — the log names
    // the reconstructed host so the operator knows to set TWILIO_WEBHOOK_URL.
    console.warn(`twilio-inbound: signature rejected (verify URL host: ${new URL(signedUrl(req)).host})`);
    return jsonError(401, "invalid_signature");
  }

  // Extract the fields we ledger. Twilio inbound SMS/MMS carry From/To/Body/MessageSid + NumMedia
  // (+ MediaUrl0..N-1 for MMS). Every field is treated as optional/defensive.
  const fromNumber = form.get("From")?.trim() ?? "";
  const toNumber = form.get("To")?.trim() ?? "";
  const body = form.get("Body");
  const messageSid = form.get("MessageSid")?.trim() || null;

  // NumMedia → MediaUrl0..N-1 (capped). A non-numeric/oversized NumMedia is clamped to [0, MAX_MEDIA].
  const numMediaRaw = Number(form.get("NumMedia") ?? "0");
  const numMedia = Number.isFinite(numMediaRaw) ? Math.max(0, Math.min(MAX_MEDIA, Math.trunc(numMediaRaw))) : 0;
  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = form.get(`MediaUrl${i}`)?.trim();
    if (url) mediaUrls.push(url);
  }

  // A message with no from-number can't be attributed — but we still 200 (Twilio has nothing to
  // retry usefully). Guard the NOT-NULL from_number column: skip the ledger insert on empty from.
  if (!fromNumber) return twimlOk();

  // LEDGER-FIRST: ingestInboundSms throws on a DB failure → 500 → Twilio retries. The MessageSid
  // (provider_sid) dedupes retries via the 0175 partial-unique index (a replay returns the
  // existing row id, never a duplicate). occurred_at = receive-time now() (Twilio's inbound
  // webhook has no message-timestamp field).
  try {
    await ingestInboundSms({
      providerSid: messageSid,
      fromNumber,
      toNumber,
      body: typeof body === "string" ? body : null,
      mediaUrls,
      occurredAt: new Date().toISOString(),
    });
    return twimlOk();
  } catch (e) {
    console.error("[/api/webhooks/twilio-inbound] ledger failed:", e instanceof Error ? e.message : e);
    return jsonError(500, "ledger_failed");
  }
}
