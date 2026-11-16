import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { parseReceipt } from "@/lib/receipt-parse";
import { sweepInboundMessages } from "@/lib/inbound-router";
import { parseFits } from "@/lib/receipt-parse-budget-shared";

function truncateErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

const SWEEP_LIMIT = 10;

/**
 * One sweep: fetch retryable inbound mail, then parse the oldest unparsed inbound receipts.
 *
 * `deadline` is the instant the CALLER's function must be done with this work, and it is the
 * caller's to give (W20/B115): the 15-minute cron passes its own route limit, the daily catch-up
 * passes what is left of the route it rides in. This run never assumes a budget of its own. A
 * row is started only while a whole parse still fits (`parseFits`: the full model call plus
 * downloads, the write and matching), so a long invoice can use its whole call and the run still
 * ends inside the function's limit. With the longer call a sweep reads fewer rows; the 15-minute
 * cadence works through a backlog oldest-first.
 */
export async function runParseReceipts(deadline: number) {
  const inboundEnabled = !!process.env.RESEND_INBOUND_SECRET && !!process.env.RESEND_API_KEY;
  if (!process.env.ANTHROPIC_API_KEY && !inboundEnabled) return { dormant: true as const };
  const sb = getServiceRoleClient();
  const fetchDeadline = Date.now() + (deadline - Date.now()) / 2;
  const inbound = inboundEnabled ? await sweepInboundMessages(sb, fetchDeadline) : { swept: 0, failed: 0 };
  if (!process.env.ANTHROPIC_API_KEY) return { dormant: false as const, swept: 0, parsed: 0, failed: 0,
    metadata: { job: "parse-receipts", swept: 0, parsed: 0, failed: 0, inbound } };
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
  let swept = 0;
  let parsed = 0;
  let failed = 0;
  for (const row of list) {
    if (!parseFits(Date.now(), deadline)) break; // a whole parse no longer fits: leave it for the next sweep
    swept++;
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
  const metadata = { job: "parse-receipts", swept, parsed, failed, inbound };
  return { dormant: false as const, swept, parsed, failed, metadata };
}
