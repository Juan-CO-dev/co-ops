// GET periodic receipt-parse sweep (Vercel Cron; every 30 min). Sweeps the OLDEST
// unparsed INBOUND receipts (parse_state='unparsed' AND source='inbound') and runs the
// LLM parse engine (lib/receipt-parse.ts) on each — classifying doc_kind, extracting
// fields into parsed_json, then re-running the Task-4 PO match+effects so a parsed
// poCode/shipTo can finally link its purchase order. Manual uploads are NOT swept here
// (they are parsed on demand via the KH+ "Parse now" affordance); only inbound rows.
//
// Auth: x-cron-secret header (or Vercel Cron's Authorization: Bearer CRON_SECRET) must
// match env CRON_SECRET via constant-time compare — the EXACT prune-sessions pattern.
// DORMANT-SAFE (spec §6): 503 no-op when CRON_SECRET is unset, AND 503 {reason:"parse_dormant"}
// when ANTHROPIC_API_KEY is unset (the parse leg wakes only once the key exists). Per-row
// try/catch (a throw on one row never aborts the sweep); fail-open cron.success/cron.failure
// heartbeat audit so the admin hub can show "last run OK" (mirrors toast-sales-pull).
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { parseReceipt } from "@/lib/receipt-parse";

/** Oldest-first batch cap per run — keep each invocation bounded (LLM calls are slow/costly). */
const SWEEP_LIMIT = 10;

// Runtime ceiling: worst case is SWEEP_LIMIT sequential vision calls, each bounded by the
// 60s per-call AbortSignal in lib/receipt-parse.ts. A sweep cut off at the ceiling is
// harmless — untouched rows stay 'unparsed' and the next half-hour run picks them up.
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
  // Parse leg is dormant until the Anthropic key exists (spec §6 dormancy matrix). 503 so the
  // platform doesn't treat a config gap as a failure, and no rows are touched.
  if (!process.env.ANTHROPIC_API_KEY) return jsonError(503, "parse_dormant");

  try {
    const sb = getServiceRoleClient();
    const { data: rows, error } = await sb
      .from("email_receipts")
      .select("id")
      .eq("parse_state", "unparsed")
      .eq("source", "inbound")
      .order("received_at", { ascending: true }) // oldest-first
      .limit(SWEEP_LIMIT)
      .returns<Array<{ id: string }>>();
    if (error) throw new Error(`parse-receipts sweep select: ${error.message}`);

    const list = rows ?? [];
    let parsed = 0;
    let failed = 0;
    for (const row of list) {
      try {
        const result = await parseReceipt(sb, row.id);
        if (result.ok) parsed += 1;
        else failed += 1; // ok:false = failed-write OR raced-away; either way, not a fresh parse.
      } catch (e) {
        // A THROW from parseReceipt (unexpected — it swallows the normal failure modes) still
        // counts as a failed row and never aborts the sweep. The row stays 'unparsed', so the
        // next run (or "Parse now") retries it. parseReceipt owns the guarded 'failed' write for
        // its own error paths; a throw here means we couldn't record one, so just log + count.
        failed += 1;
        console.error(`[cron parse-receipts] parse threw for receipt=${row.id}:`, truncateErr(e));
      }
    }

    // Heartbeat (fail-open): cron.success row lets the admin hub show "last run OK". audit()
    // never throws. Metadata style mirrors toast-sales-pull's per-item counts.
    void audit({
      actorId: null,
      actorRole: null,
      action: "cron.success",
      resourceTable: "cron",
      resourceId: null,
      metadata: { job: "parse-receipts", swept: list.length, parsed, failed },
      ipAddress: null,
      userAgent: null,
    });
    return jsonOk({ swept: list.length, parsed, failed });
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
