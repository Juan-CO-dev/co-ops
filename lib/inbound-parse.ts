import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { parseReceipt } from "@/lib/receipt-parse";
import { parseFits } from "@/lib/receipt-parse-budget-shared";

/**
 * Parse right after the webhook fetched the message, but only when a WHOLE parse still fits
 * before the caller's deadline (audit W20/B115): the model call may use its full bound, and a
 * parse the function cannot finish is paid for and lost. Otherwise the receipt stays 'unparsed'
 * and the 15-minute sweep reads it. The rule is the shared one (lib/receipt-parse-budget-shared.ts).
 */
export async function parseFetchedInboundMessage(id: string, deadline: number, sb = getServiceRoleClient()) {
  if (!process.env.ANTHROPIC_API_KEY || !parseFits(Date.now(), deadline)) return;
  const { data, error } = await sb.from("inbound_messages").select("email_receipt_id")
    .eq("id", id).eq("lane", "vendor_receipt").eq("content_state", "fetched").maybeSingle<{ email_receipt_id: string | null }>();
  if (error) throw new Error("inbound_parse_lookup_failed");
  // Asked again after the lookup: the time it took counts too.
  if (data?.email_receipt_id && parseFits(Date.now(), deadline)) await parseReceipt(sb, data.email_receipt_id);
}
