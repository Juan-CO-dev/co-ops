import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { parseReceipt } from "@/lib/receipt-parse";
import { sweepInboundMessages } from "@/lib/inbound-router";
import { fetchShareDeadline, parseFits } from "@/lib/receipt-parse-budget-shared";

function truncateErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

const SWEEP_LIMIT = 10;

/** Wait for `work`, but no later than the instant `at`. The work itself is not stopped. */
async function settledBy<T>(work: Promise<T>, at: number): Promise<{ inTime: true; value: T } | { inTime: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const shareEnded = new Promise<{ inTime: false }>(resolve => {
    timer = setTimeout(() => resolve({ inTime: false }), Math.max(0, at - Date.now()));
  });
  try {
    return await Promise.race([work.then(value => ({ inTime: true as const, value })), shareEnded]);
  } finally {
    clearTimeout(timer);
  }
}

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
 *
 * PARSING HAS A SHARE OF THE RUN THAT FETCHING CANNOT USE (review r3). Fetching goes first, so
 * mail recovered by this sweep is read in the same run, but it stops at `fetchShareDeadline`: one
 * whole parse and the handoff to it are always left. Before this, fetching could take half the
 * run while a parse needed more than the other half, so a stretch of slow fetching read no
 * receipt at all, sweep after sweep. The share is held two ways: the fetch sweep is given that
 * instant as its own deadline (it starts no message without a full fetch window before it), and this run stops
 * WAITING for it at that instant even if a storage write hangs past it. A message still in flight
 * then keeps its lease and finishes on its own, or a later sweep retries it. When the run has
 * room for one parse and no more, the parse is kept and fetching waits for the next run. With no
 * parse key there is nothing to keep time for, and fetching has the whole run.
 */
export async function runParseReceipts(deadline: number) {
  const inboundEnabled = !!process.env.RESEND_INBOUND_SECRET && !!process.env.RESEND_API_KEY;
  const parseEnabled = !!process.env.ANTHROPIC_API_KEY;
  if (!parseEnabled && !inboundEnabled) return { dormant: true as const };
  const sb = getServiceRoleClient();
  const fetchDeadline = parseEnabled ? fetchShareDeadline(deadline) : deadline;
  let inbound: { swept: number; failed: number; deferred?: number; overran?: true } = { swept: 0, failed: 0 };
  if (inboundEnabled && Date.now() < fetchDeadline) {
    const fetching = sweepInboundMessages(sb, fetchDeadline);
    const leg = await settledBy(fetching, fetchDeadline);
    if (leg.inTime) inbound = leg.value;
    else {
      // Its counts are unknown here; the inbound ledger has each message's own outcome.
      inbound = { swept: 0, failed: 0, overran: true };
      console.error("[cron parse-receipts] inbound fetch overran its share of the run; parsing goes ahead");
      void fetching.catch(e => console.error("[cron parse-receipts] inbound fetch failed after its share:", truncateErr(e)));
    }
  }
  if (!parseEnabled) return { dormant: false as const, swept: 0, parsed: 0, failed: 0,
    startedNothing: deferredOnly(inbound, 0, 0),
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
  return { dormant: false as const, swept, parsed, failed,
    startedNothing: deferredOnly(inbound, list.length - swept, swept), metadata };
}

/**
 * Work was waiting and the run started none of it (W27/B225 r2): due mail the sweep deferred for want of a fetch
 * window, or unparsed receipts no whole parse fitted for, with no message and no receipt started. A run like this
 * did no work, so its caller must not report it as a success. An overrun fetch leg had a message in flight: that
 * is work started.
 */
function deferredOnly(inbound: { swept: number; deferred?: number; overran?: true }, parseDeferred: number, parseStarted: number): boolean {
  if (inbound.overran || inbound.swept > 0 || parseStarted > 0) return false;
  return (inbound.deferred ?? 0) > 0 || parseDeferred > 0;
}
