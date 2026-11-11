import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { parseReceipt } from "@/lib/receipt-parse";

/** Parse immediately if a full model-call window remains; the frequent sweep is the fallback. */
export async function parseFetchedInboundMessage(id: string, deadline: number, sb = getServiceRoleClient()) {
  if (!process.env.ANTHROPIC_API_KEY || Date.now() + 80_000 > deadline) return;
  const { data, error } = await sb.from("inbound_messages").select("email_receipt_id")
    .eq("id", id).eq("lane", "vendor_receipt").eq("content_state", "fetched").maybeSingle<{ email_receipt_id: string | null }>();
  if (error) throw new Error("inbound_parse_lookup_failed");
  if (data?.email_receipt_id && Date.now() + 80_000 <= deadline) await parseReceipt(sb, data.email_receipt_id);
}
