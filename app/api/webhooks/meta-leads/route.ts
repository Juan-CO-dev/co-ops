import { timingSafeEqual } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { verifyMetaSignature } from "@/lib/meta-leads/signature-shared";
import { readBoundedBytes } from "@/lib/meta-leads/request";
import { parseMetaNotifications } from "@/lib/meta-leads/notification-shared";
import { recordMetaLead, processMetaLead } from "@/lib/meta-leads/worker";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function GET(req: NextRequest) {
  const secret = process.env.META_LEADS_VERIFY_TOKEN;
  if (!secret) return jsonError(503, "not_configured");
  const params = req.nextUrl.searchParams;
  const provided = Buffer.from(params.get("hub.verify_token") ?? "");
  const expected = Buffer.from(secret);
  const challenge = params.get("hub.challenge");
  if (params.get("hub.mode") !== "subscribe" || provided.length !== expected.length || !timingSafeEqual(provided, expected)
    || !challenge || !/^\d{1,200}$/.test(challenge)) return jsonError(403, "verification_refused");
  return new Response(challenge, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}
export async function POST(req: NextRequest) {
  const secret = process.env.META_LEADS_APP_SECRET;
  if (!secret) return jsonError(503, "not_configured");
  const raw = await readBoundedBytes(req);
  if (!raw.ok) return jsonError(raw.status, "invalid_body");
  // Authenticate the original bytes BEFORE decoding, parsing, rate-limit storage or ledger I/O.
  if (!verifyMetaSignature(raw.bytes, req.headers.get("x-hub-signature-256"), secret)) return jsonError(401, "invalid_signature");
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes)); }
  catch { return jsonError(400, "invalid_json"); }
  const notifications = parseMetaNotifications(payload);
  if (!notifications) return jsonError(400, "invalid_payload");
  const enabled = process.env.META_LEADS_ENABLED === "1";
  const ids: string[] = [];
  try {
    for (const item of notifications) if (await recordMetaLead(item, enabled)) ids.push(item.leadgenId);
  } catch { return jsonError(500, "ledger_failed"); }
  if (enabled && ids.length) after(async () => {
    const deadline = Date.now() + 150_000;
    for (const id of ids) {
      if (Date.now() > deadline) break;
      try { await processMetaLead(id); }
      catch { console.error("[meta-leads] processing deferred to sweep"); }
    }
  });
  return jsonOk({ recorded: ids.length, duplicate: ids.length === 0 });
}
