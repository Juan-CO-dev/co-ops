// Metadata-only webhook: commit the routing ledger before scheduling content work.
import { after, type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { recordInboundMessage, processInboundMessage } from "@/lib/inbound-router";
import { verifySvixSignature } from "@/lib/webhook-verify-shared";
import { parseFetchedInboundMessage } from "@/lib/inbound-parse";
export const maxDuration = 180;
export async function POST(req: NextRequest) {
  const deadline = Date.now() + 160_000;
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) return jsonError(503, "not_configured");
  const rawBody = await req.text();
  if (!verifySvixSignature(secret, req.headers.get("svix-id"), req.headers.get("svix-timestamp"), req.headers.get("svix-signature"), rawBody)) return jsonError(401, "invalid_signature");
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return jsonError(400, "invalid_json"); }
  if (!payload || typeof payload !== "object") return jsonError(400, "invalid_payload");
  const event = payload as Record<string, unknown>;
  if (event.type !== "email.received") return jsonOk({ ignored: true });
  if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) return jsonError(400, "invalid_payload");
  const data = event.data as Record<string, unknown>;
  if (typeof data.email_id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(data.email_id)) return jsonError(400, "invalid_email_id");
  try {
    const result = await recordInboundMessage(data);
    if (result.duplicate) return jsonOk({ duplicate: true });
    after(async () => {
      try {
        if (await processInboundMessage(result.id) === "fetched") {
          await parseFetchedInboundMessage(result.id, deadline);
        }
      }
      catch { console.error("[resend-inbound] processing deferred to sweep"); }
    });
    return jsonOk({ inboundMessageId: result.id });
  } catch { return jsonError(500, "ledger_failed"); }
}
