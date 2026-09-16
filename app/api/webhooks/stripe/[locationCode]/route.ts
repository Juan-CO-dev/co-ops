/**
 * POST /api/webhooks/stripe/[locationCode] — PER-LOCATION mode, for a business whose shops
 * are separate Stripe (connected) accounts. One endpoint per shop, each registered in that
 * shop's own Stripe account, each verified with that shop's own endpoint secret.
 *
 * `locationCode` is a `locations.code` value validated against the table at request time —
 * there are no shop codes in this codebase (AGENTS.md tenant-vocabulary law). An unknown or
 * inactive code is a 404; see ../_handler.ts for why that is not a 503.
 *
 * Next 16: `params` is a Promise.
 */
import { type NextRequest } from "next/server";

import { handleStripeWebhook } from "../_handler";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ locationCode: string }> }) {
  const { locationCode } = await ctx.params;
  return handleStripeWebhook(req, locationCode);
}
