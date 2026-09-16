/**
 * POST /api/webhooks/stripe — SINGLE-ACCOUNT mode, and the endpoint Juan registers in a
 * default deployment (one Stripe account serving every shop).
 *
 * No location segment, so the shop is not known when the signature is verified: the
 * fallback `STRIPE_WEBHOOK_SECRET` verifies it, and the shop is LEARNED afterwards from the
 * payment row's quote. All the logic — and the reasoning behind it — lives in ./_handler.ts,
 * shared with the per-location endpoint so the two can never drift.
 */
import { type NextRequest } from "next/server";

import { handleStripeWebhook } from "./_handler";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleStripeWebhook(req, null);
}
