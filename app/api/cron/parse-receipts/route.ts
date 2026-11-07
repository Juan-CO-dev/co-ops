// GET receipt fetch/parse sweep every 15 minutes, all day. The existing cron
// handles both retryable inbound fetches and the oldest unparsed inbound receipts.
// Fetch and parse batches are bounded by the route budget. Sweeps the OLDEST
// unparsed INBOUND receipts (parse_state='unparsed' AND source='inbound') and runs the
// LLM parse engine (lib/receipt-parse.ts) on each — classifying doc_kind, extracting
// fields into parsed_json, then re-running the Task-4 PO match+effects so a parsed
// poCode/shipTo can finally link its purchase order. Manual uploads are NOT swept here
// (they are parsed on demand via the KH+ "Parse now" affordance); only inbound rows.
//
// Auth: x-cron-secret header (or Vercel Cron's Authorization: Bearer CRON_SECRET) must
// match env CRON_SECRET via constant-time compare — the EXACT prune-sessions pattern.
// DORMANT-SAFE: no work without CRON_SECRET. With that secret, work is enabled
// by either ANTHROPIC_API_KEY (parse) or both inbound Resend keys (fetch).
// Successful fetch-only runs still emit the existing heartbeat and sibling watch.
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { runParseReceipts } from "@/lib/parse-receipts-run";
import { audit } from "@/lib/audit";
import { watchSiblings } from "@/lib/job-watch-run";

// Leave untouched rows for the next 15-minute run when the work budget is spent.
export const maxDuration = 300;

/** Truncate a caught error message so a giant stack never bloats the audit row. */
function truncateErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

function secretOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-cron-secret")
    ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return jsonError(503, "cron_disabled");
  if (!secretOk(req)) return jsonError(401, "unauthorized");
  // Parsing and fetching have independent configuration; only both dormant is a no-op.
  if (!process.env.ANTHROPIC_API_KEY && !(process.env.RESEND_INBOUND_SECRET && process.env.RESEND_API_KEY)) return jsonError(503, "parse_dormant");

  try {
    const result = await runParseReceipts();
    if (result.dormant) return jsonError(503, "parse_dormant");
    const { swept, parsed, failed, metadata } = result;
    await audit({
      actorId: null,
      actorRole: null,
      action: "cron.success",
      resourceTable: "cron",
      resourceId: null,
      metadata,
      ipAddress: null,
      userAgent: null,
    });
    await watchSiblings("parse-receipts");
    return jsonOk({ swept, parsed, failed });
  } catch (e) {
    // A LIVE failure is otherwise silent (console only). Write a fail-open audit row so the
    // admin hub can surface it. audit() never throws.
    void audit({
      actorId: null,
      actorRole: null,
      action: "cron.failure",
      resourceTable: "cron",
      resourceId: null,
      metadata: { job: "parse-receipts", error: truncateErr(e) },
      ipAddress: null,
      userAgent: null,
    });
    return jsonError(500, "cron_failed", { message: e instanceof Error ? e.message : String(e) });
  }
}
