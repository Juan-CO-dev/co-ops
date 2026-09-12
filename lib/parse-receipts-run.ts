import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { parseReceipt } from "@/lib/receipt-parse";

function truncateErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

const SWEEP_LIMIT = 10;

export async function runParseReceipts() {
  if (!process.env.ANTHROPIC_API_KEY) return { dormant: true as const };
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
  const metadata = { job: "parse-receipts", swept: list.length, parsed, failed };
  return { dormant: false as const, swept: list.length, parsed, failed, metadata };
}
