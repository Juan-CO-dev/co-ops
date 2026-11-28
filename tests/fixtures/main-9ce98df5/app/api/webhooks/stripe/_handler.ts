// FROZEN COPY of main @ 9ce98df5 — never edit
/**
 * Shared handler for BOTH Stripe webhook endpoints (the `_`-prefixed file is not a route —
 * same idiom as app/api/opening/_helpers.ts).
 *
 *   POST /api/webhooks/stripe                 → single-account mode (locationCode = null)
 *   POST /api/webhooks/stripe/[locationCode]  → per-location mode (one connected account
 *                                               per shop; the code names which)
 *
 * The single-account endpoint is the one Juan registers in a default deployment. The
 * per-location endpoints exist for a business whose shops are separate Stripe accounts.
 *
 * MIRRORS app/api/webhooks/ezcater/route.ts exactly where the shapes agree, because the
 * rules are the same and a second spelling of them is how they drift apart:
 *   - secret unset            → 503 `webhook_disabled`, dormant-safe, NOTHING stored.
 *   - unauthenticated surface → per-IP rate limit BEFORE any DB work.
 *   - raw body via req.text() → the HMAC is over BYTES; a JSON round-trip breaks it.
 *   - bad signature           → 401, and the body is NOT stored (an unsigned body is an
 *                              attacker's choice of what goes in our ledger).
 *   - 200 on a recorded, FINISHED outcome — a provider reads non-2xx as "retry", and there
 *     is nothing to retry about an event we understood.
 *   - 500 when the ledger append (or the read of a previously-seen event's verdict) fails,
 *     when processing failed below the ledger (`processing_failed`), AND when a payment was
 *     recorded but its required follow-up work is unfinished (`settlement_incomplete`, review
 *     r7). Those are exactly the cases where we DO want the retry: the ledger treats an
 *     unfinished event as retryable, so the redelivery completes the work instead of
 *     answering "duplicate" (audit W02/B005 — a card payment taken must not stay `due`
 *     because one write hiccuped; and a checkout that could not be closed for a moment must
 *     not stay payable for good).
 *
 * ONE DELIBERATE DIFFERENCE from ezCater: an unknown/inactive `locationCode` is a 404, not
 * a 503. 503 means "this leg is asleep"; a URL naming a shop that does not exist is a
 * mis-registration, and answering it with "asleep" would let a typo'd endpoint sit silently
 * in Stripe's dashboard looking like a feature that had not been switched on yet.
 */
import { type NextRequest } from "next/server";

import { jsonError, jsonOk } from "@/lib/api-helpers";
import { trustedClientIp } from "@/lib/client-ip";
import { checkAndRecord } from "@/lib/portal/rate-limit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { stripeCredentialsFor } from "@/lib/stripe/client";
import { verifyStripeSignature } from "@/lib/stripe/shared";
import { isRetryableResult, processStripeEvent, resolveWebhookLocation } from "@/lib/stripe/webhook";

export async function handleStripeWebhook(req: NextRequest, locationCode: string | null) {
  // Unauthenticated surface: throttle before any DB read or write. 120/min/IP is far above
  // Stripe's real cadence even during a retry storm.
  const ip = trustedClientIp(req.headers) ?? "unknown";
  if (!(await checkAndRecord(`stripe_webhook:${ip}`, 60, 120))) return jsonError(429, "rate_limited");

  // Single-account mode resolves to (null, null) without a query; per-location mode must
  // name an active shop (see lib/stripe/webhook.ts `resolveWebhookLocation`).
  const location = await resolveWebhookLocation(getServiceRoleClient(), locationCode);
  if (!location.ok) {
    if (location.reason === "lookup_failed") {
      console.error("[/api/webhooks/stripe] location lookup failed");
      return jsonError(500, "location_lookup_failed");
    }
    return jsonError(404, "unknown_location");
  }
  const { locationId, locationCode: resolvedCode } = location;

  // Both halves of the pair are required (lib/stripe/client.ts): a shop that cannot create
  // a Checkout Session has no business receiving webhooks about one, and a half-configured
  // pair is the silent cross-account mis-wiring that resolution refuses to report as ready.
  const creds = stripeCredentialsFor(resolvedCode);
  if (!creds) return jsonError(503, "webhook_disabled");

  const rawBody = await req.text();
  // NEVER log the signature header or the secret.
  if (!verifyStripeSignature(creds.webhookSecret, req.headers.get("stripe-signature"), rawBody)) {
    return jsonError(401, "invalid_signature");
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    // Signed but not JSON — the holder of the secret sent us something malformed. Nothing
    // to ledger (no event id), so refuse rather than store a body under a made-up identity.
    return jsonError(400, "invalid_payload");
  }

  try {
    const { result } = await processStripeEvent(getServiceRoleClient(), event, {
      locationId,
      locationCode: resolvedCode,
    });
    if (result === "invalid_payload") return jsonError(400, "invalid_payload");
    // Recorded on the ledger as unfinished, and retryable there: non-2xx so Stripe sends the
    // SAME event again. `processing_failed` = something below the ledger threw.
    // `settlement_incomplete` (audit W02 review r7) = the money IS recorded, but the work
    // that has to follow it (closing the order's other checkouts, applying a refund Stripe
    // reported first, recording the cleanup as done) is not finished — a 200 here would be
    // the last time anything looked.
    if (isRetryableResult(result)) return jsonError(500, result);
    return jsonOk({ result });
  } catch (e) {
    console.error("[/api/webhooks/stripe] ledger failed:", e instanceof Error ? e.message : e);
    return jsonError(500, "ledger_failed");
  }
}
