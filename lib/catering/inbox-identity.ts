import type { getServiceRoleClient } from "@/lib/supabase-server";
import { classifyEmail, normalizeEmail } from "@/lib/customers/identity-shared";
import { escapeLike } from "./inbox-identity-shared";
import type { InboxIdentity } from "./inbox-shared";

type Service = ReturnType<typeof getServiceRoleClient>;
type Lead = { id: string; customer_id: string | null; location_id: string; stage: string; assigned_to: string | null };
export interface InboxIdentityResult {
  identity: InboxIdentity; customerId: string | null; leadId: string | null; quoteId: string | null;
  locationId: string | null; artifact: "none" | "resolved" | "ambiguous"; artifactStage?: string;
}
export interface InboxIdentityInput { sender: string | null; threadKey: string | null; externalRef: string | null; messageId: string }
const LEAD_COLUMNS = "id,customer_id,location_id,stage,assigned_to";

/** Attach-only service reads. Neither customer store nor an operational artifact is mutated. */
export async function resolveCateringInboxIdentity(input: InboxIdentityInput, sb: Service): Promise<InboxIdentityResult> {
  const email = normalizeEmail(input.sender);
  const classified = classifyEmail(email);
  const domain = email?.split("@")[1] ?? "";
  const platform = (["ezcater", "tripleseat"] as const).find(p => domain === `${p}.com` || domain.endsWith(`.${p}.com`));
  const result: InboxIdentityResult = { identity: platform || classified.kind === "masked" ? "masked" : "missing",
    customerId: null, leadId: null, quoteId: null, locationId: null, artifact: "none" };
  if (!platform && classified.kind === "ok" && email) {
    // Include inactive matches in the ambiguity check; never revive one or choose
    // an active duplicate over its retired sibling (the SQL writer also refuses it).
    const { data, error } = await sb.from("catering_customers").select("id,active")
      .ilike("email", escapeLike(email)).limit(2).returns<Array<{ id: string; active: boolean }>>();
    if (error) throw new Error("inbox_identity_read_failed");
    result.identity = !data?.length ? "new_sender" : data.length === 1 && data[0]!.active ? "resolved" : "ambiguous";
    if (result.identity === "resolved") result.customerId = data![0]!.id;
  }
  let lead: Lead | undefined;
  if (result.customerId && input.threadKey) {
    const { data, error } = await sb.from("catering_inbound_messages").select("lead_id")
      .eq("thread_key", input.threadKey).eq("catering_customer_id", result.customerId)
      .neq("id", input.messageId).not("lead_id", "is", null).limit(100).returns<Array<{ lead_id: string }>>();
    if (error) throw new Error("inbox_thread_read_failed");
    const ids = [...new Set((data ?? []).map(row => row.lead_id))];
    if (ids.length > 1 || data?.length === 100) return { ...result, artifact: "ambiguous" };
    if (ids[0]) {
      const found = await sb.from("catering_pipeline").select(LEAD_COLUMNS).eq("id", ids[0])
        .eq("customer_id", result.customerId).in("stage", ["inquiry", "quote_sent", "confirmed", "out"])
        .limit(1).returns<Lead[]>();
      if (found.error) throw new Error("inbox_artifact_read_failed");
      lead = found.data?.[0];
      if (!lead) return { ...result, artifact: "ambiguous" };
    }
  }
  if (!lead && platform && input.externalRef) {
    const found = await sb.from("catering_pipeline").select(LEAD_COLUMNS)
      .eq("lead_source", platform).eq("external_ref", input.externalRef).limit(2).returns<Lead[]>();
    if (found.error) throw new Error("inbox_artifact_read_failed");
    if ((found.data?.length ?? 0) > 1) return { ...result, artifact: "ambiguous" };
    lead = found.data?.[0];
  }
  if (!lead && result.customerId) {
    const found = await sb.from("catering_pipeline").select(LEAD_COLUMNS).eq("customer_id", result.customerId)
      .in("stage", ["inquiry", "quote_sent", "confirmed", "out"]).limit(2).returns<Lead[]>();
    if (found.error) throw new Error("inbox_artifact_read_failed");
    if ((found.data?.length ?? 0) > 1) return { ...result, artifact: "ambiguous" };
    lead = found.data?.[0];
  }
  if (!lead) return result;
  let quoteQuery = sb.from("catering_quotes").select("id").eq("pipeline_id", lead.id)
    .eq("location_id", lead.location_id);
  quoteQuery = lead.customer_id === null ? quoteQuery.is("customer_id", null) : quoteQuery.eq("customer_id", lead.customer_id);
  const quotes = await quoteQuery
    .is("superseded_at", null).in("status", ["draft", "submitted", "sent", "accepted"])
    .limit(2).returns<Array<{ id: string }>>();
  if (quotes.error) throw new Error("inbox_quote_read_failed");
  if ((quotes.data?.length ?? 0) > 1) return { ...result, artifact: "ambiguous" };
  return { ...result, leadId: lead.id, quoteId: quotes.data?.[0]?.id ?? null,
    locationId: lead.location_id, artifact: "resolved", artifactStage: lead.stage };
}
