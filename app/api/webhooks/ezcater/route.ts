// POST /api/webhooks/ezcater — ezCater event notifications (the codebase's
// FIRST inbound webhook). No session: the caller is ezCater; authenticity =
// the X-Ezcater-Signature HMAC (mandatory in our build even though ezCater
// documents it as optional). EZCATER_WEBHOOK_SECRET unset → 503 dormant-safe,
// nothing stored. Invalid signature → recorded on the ledger + 401. Valid →
// processed; ALWAYS 200 on recorded outcomes (providers retry non-2xx; a
// duplicate/skip is a success from their perspective). 500 only when the
// ledger append itself fails — that's when we WANT their retry.
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { verifyEzcaterSignature } from "@/lib/ezcater/webhook-shared";
import { processEzcaterDelivery } from "@/lib/catering/ezcater-intake";

export async function POST(req: NextRequest) {
  const secret = process.env.EZCATER_WEBHOOK_SECRET;
  if (!secret) return jsonError(503, "webhook_disabled");

  const rawBody = await req.text();
  const signatureValid = verifyEzcaterSignature(secret, req.headers.get("x-ezcater-signature"), rawBody);

  try {
    const { result } = await processEzcaterDelivery(rawBody, signatureValid);
    if (result === "invalid_signature") return jsonError(401, "invalid_signature");
    return jsonOk({ result });
  } catch (e) {
    console.error("[/api/webhooks/ezcater] ledger append failed:", e instanceof Error ? e.message : e);
    return jsonError(500, "ledger_failed");
  }
}
