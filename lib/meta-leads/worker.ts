import "server-only";
import { randomUUID } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveOrCreatePortalCustomer } from "@/lib/portal/magic-link";
import { resolveCateringManager } from "@/lib/catering/system-intake-assignee";
import { fetchMetaLead } from "./graph";
import { mapMetaLeadFields } from "./intake-shared";
import { metaFormConfig, type MetaNotification } from "./notification-shared";

type Client = ReturnType<typeof getServiceRoleClient>;
type Failure = "configuration" | "graph_auth" | "graph_rate_limit" | "graph_timeout" | "graph_unavailable" | "graph_not_found" | "invalid_payload" | "database" | "invalid_location" | "consent_refused";
const transient = new Set<Failure>(["graph_rate_limit", "graph_timeout", "graph_unavailable", "database"]);
class WorkerFailure extends Error { constructor(readonly code: Failure) { super(code); } }
interface Claim { claimed: boolean; attempts: number; page_id: string; form_id: string; provider_created_at: string }

/** SQL INSERT ON CONFLICT DO NOTHING never overwrites receipt evidence. */
export async function recordMetaLead(item: MetaNotification, enabled: boolean, client?: Client): Promise<boolean> {
  const { data, error } = await (client ?? getServiceRoleClient()).rpc("meta_lead_record", {
    p_leadgen_id: item.leadgenId, p_page_id: item.pageId, p_form_id: item.formId,
    p_created_at: item.createdAt, p_enabled: enabled,
  });
  if (error || typeof data?.inserted !== "boolean") throw new Error("meta_ledger_failed");
  return data.inserted;
}

/** No tokens, drafts or email in Build 1. Every completion is fenced by the SQL lease. */
export async function processMetaLead(leadgenId: string, client?: Client): Promise<string> {
  if (process.env.META_LEADS_ENABLED !== "1") return "disabled";
  const sb = client ?? getServiceRoleClient();
  const leaseId = randomUUID();
  const claim = await sb.rpc("meta_lead_claim", { p_leadgen_id: leadgenId, p_lease_id: leaseId });
  if (claim.error || typeof claim.data?.claimed !== "boolean") throw new Error("meta_claim_failed");
  const row = claim.data as Claim;
  if (!row.claimed) return "busy";
  let rawKeys: string[] = [];
  try {
    const form = metaFormConfig(process.env.META_LEADS_FORMS, row.page_id, row.form_id);
    if (!form || !process.env.META_LEADS_PAGE_TOKEN || !process.env.META_LEADS_APP_SECRET) throw new WorkerFailure("configuration");
    const fetched = await fetchMetaLead({ leadgenId, formId: row.form_id }, {
      pageToken: process.env.META_LEADS_PAGE_TOKEN, appSecret: process.env.META_LEADS_APP_SECRET,
    });
    if (!fetched.ok) throw new WorkerFailure(fetched.error);
    const mapped = mapMetaLeadFields(fetched.lead.field_data, fetched.lead.custom_disclaimer_responses);
    rawKeys = mapped.rawKeys;
    if (!mapped.ok) throw new WorkerFailure(mapped.error);
    const intake = mapped.intake;
    const shop = await sb.from("locations").select("id").eq("code", intake.shopCode).eq("active", true).maybeSingle<{ id: string }>();
    if (shop.error) throw new WorkerFailure("database");
    if (!shop.data) throw new WorkerFailure("invalid_location");
    // Recheck the kill switch after provider I/O and before any identity/business creation.
    if (process.env.META_LEADS_ENABLED !== "1") return "disabled";
    if (mapped.consent.optedIn && process.env.CUSTOMER_PROFILES === "1") {
      const consent = await sb.rpc("customer_consent_record_explicit", {
        p_email: intake.contactEmail, p_channel: "email", p_source: "meta_lead_form",
        p_effective_at: fetched.lead.created_time ?? row.provider_created_at,
        p_evidence_ref: `${leadgenId}:${mapped.consent.questionKey}`, p_text_version: mapped.consent.textVersion,
      });
      if (consent.error) {
        const refused = ["consent_invalid", "consent_relay", "consent_suppressed", "consent_evidence_conflict"].includes(consent.error.message);
        throw new WorkerFailure(refused ? "consent_refused" : "database");
      }
      if (!consent.data?.event_id) throw new WorkerFailure("database");
    }
    const customerId = await resolveOrCreatePortalCustomer(intake.contactEmail, intake.contactName, "meta_lead_form");
    const assignedTo = await resolveCateringManager(sb, shop.data.id);
    const applied = await sb.rpc("meta_lead_intake_apply", {
      p_leadgen_id: leadgenId, p_lease_id: leaseId, p_customer_id: customerId,
      p_location_id: shop.data.id, p_assigned_to: assignedTo, p_raw_keys: rawKeys,
      p_intake: { contact_name: intake.contactName, email: intake.contactEmail, contact_phone: intake.contactPhone,
        company: intake.company, event_date: intake.eventDate, headcount: intake.headcount, notes: intake.notes,
        fulfillment: intake.isDelivery ? "delivery" : "pickup", language: form.language,
        location_id: shop.data.id, mapping_version: "meta-leads-v1", consent: mapped.consent },
    });
    if (applied.error || !["created", "attached", "needs_human"].includes(applied.data?.state)) throw new WorkerFailure("database");
    return applied.data.state;
  } catch (error) {
    // Never persist provider/database exception text: these may contain PII or credentials.
    const code: Failure = error instanceof WorkerFailure ? error.code : "database";
    const failed = await sb.rpc("meta_lead_fail", { p_leadgen_id: leadgenId, p_lease_id: leaseId,
      p_error_code: code, p_retryable: transient.has(code), p_raw_keys: rawKeys });
    if (failed.error || failed.data !== true) throw new Error("meta_state_write_failed");
    return transient.has(code) && row.attempts < 5 ? "retry" : "needs_human";
  }
}

/** Bounded oldest-first retry sweep. Disabled and terminal receipts are never backfilled. */
export async function sweepMetaLeads(client?: Client): Promise<{ processed: number }> {
  if (process.env.META_LEADS_ENABLED !== "1") return { processed: 0 };
  const sb = client ?? getServiceRoleClient();
  const now = new Date().toISOString();
  const rows = await sb.from("meta_lead_events").select("leadgen_id").in("state", ["received", "retry", "processing"])
    .lte("next_attempt_at", now).or(`lease_until.is.null,lease_until.lte.${now}`)
    .order("next_attempt_at").limit(20).returns<Array<{ leadgen_id: string }>>();
  if (rows.error) throw new Error("meta_sweep_read_failed");
  const deadline = Date.now() + 140_000;
  let processed = 0;
  for (const row of rows.data ?? []) {
    if (Date.now() > deadline) break;
    await processMetaLead(row.leadgen_id, sb);
    processed++;
  }
  return { processed };
}
