import "server-only";
import { randomUUID } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { resolveOrCreatePortalCustomer } from "@/lib/portal/magic-link";
import { resolveCateringManager } from "@/lib/catering/system-intake-assignee";
import { escapeLike, normalizeEmail, resolveCompanyForEmail } from "@/lib/catering/companies";
import { metaLeadsTenantConfig } from "@/config/tenant/meta-leads";
import { fetchMetaLead } from "./graph";
import { composeMetaNotes, mapMetaLeadFields, META_MAPPING_VERSION } from "./intake-shared";
import { metaFormConfig, type MetaNotification } from "./notification-shared";
import { sendMetaContinuation } from "./continuation";

type Client = ReturnType<typeof getServiceRoleClient>;
type Failure = "configuration" | "graph_auth" | "graph_rate_limit" | "graph_timeout" | "graph_unavailable" | "graph_not_found" | "invalid_payload" | "database" | "invalid_location" | "consent_refused" | "identity_unresolved" | "invalid_assignee";
const transient = new Set<Failure>(["graph_rate_limit", "graph_timeout", "graph_unavailable", "database"]);
class WorkerFailure extends Error { constructor(readonly code: Failure) { super(code); } }
interface Claim { claimed: boolean; attempts: number; page_id: string; form_id: string; provider_created_at: string }
interface Shop { id: string; name: string }
/** How a delivery lead without a shop choice got its shop (the WHY lands on the lead as a notes line). */
interface Routing { shop: Shop; note: string }

/** SQL INSERT ON CONFLICT DO NOTHING never overwrites receipt evidence. */
export async function recordMetaLead(item: MetaNotification, enabled: boolean, client?: Client): Promise<boolean> {
  const { data, error } = await (client ?? getServiceRoleClient()).rpc("meta_lead_record", {
    p_leadgen_id: item.leadgenId, p_page_id: item.pageId, p_form_id: item.formId,
    p_created_at: item.createdAt, p_enabled: enabled,
  });
  if (error || typeof data?.inserted !== "boolean") throw new Error("meta_ledger_failed");
  return data.inserted;
}

async function shopByCode(sb: Client, code: string): Promise<Shop | null> {
  const shop = await sb.from("locations").select("id, name").eq("code", code).eq("active", true).maybeSingle<Shop>();
  if (shop.error) throw new WorkerFailure("database");
  return shop.data ?? null;
}
async function shopById(sb: Client, id: string): Promise<Shop | null> {
  const shop = await sb.from("locations").select("id, name").eq("id", id).eq("active", true).maybeSingle<Shop>();
  if (shop.error) throw new WorkerFailure("database");
  return shop.data ?? null;
}
/** The location of the most recent catering pipeline lead among these customers (read-only). */
async function lastLeadLocation(sb: Client, customerIds: string[]): Promise<string | null> {
  if (customerIds.length === 0) return null;
  const lead = await sb.from("catering_pipeline").select("location_id").in("customer_id", customerIds).not("location_id", "is", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle<{ location_id: string }>();
  if (lead.error) throw new WorkerFailure("database");
  return lead.data?.location_id ?? null;
}

/**
 * Delivery routing (Juan's rulings, 2026-11-11) for a lead whose customer made NO shop choice, in order:
 *   (a) a returning customer (the ORDER email) or a known company (the domain auto-attach) → the shop of
 *       their MOST RECENT catering pipeline lead — read-only lookups, nothing is created here;
 *   (b) the Meta ad set → shop table in the tenant config;
 *   (c) the tenant's default shop.
 * Every outcome names its reason in a notes line. Keith can still move the lead (existing feature).
 */
async function routeDeliveryLead(sb: Client, orderEmail: string, adsetId: string | undefined): Promise<Routing> {
  const config = metaLeadsTenantConfig;
  const email = normalizeEmail(orderEmail);
  const customer = await sb.from("catering_customers").select("id, company_id").eq("active", true).ilike("email", escapeLike(email))
    .maybeSingle<{ id: string; company_id: string | null }>();
  if (customer.error) throw new WorkerFailure("database");
  let locationId = customer.data ? await lastLeadLocation(sb, [customer.data.id]) : null;
  if (!locationId) {
    const companyId = customer.data?.company_id ?? await resolveCompanyForEmail(email);
    if (companyId) {
      const members = await sb.from("catering_customers").select("id").eq("company_id", companyId).limit(500).returns<Array<{ id: string }>>();
      if (members.error) throw new WorkerFailure("database");
      locationId = await lastLeadLocation(sb, (members.data ?? []).map(row => row.id));
    }
  }
  if (locationId) {
    const shop = await shopById(sb, locationId);
    if (shop) return { shop, note: `Routed: last order at ${shop.name}` };
  }
  const adsetCode = adsetId ? config.adSetShop[adsetId] : undefined;
  if (adsetCode) {
    const shop = await shopByCode(sb, adsetCode);
    if (shop) return { shop, note: `Routed: ad set ${adsetId}` };
  }
  const shop = await shopByCode(sb, config.defaultShopCode);
  if (!shop) throw new WorkerFailure("invalid_location");
  return { shop, note: "Routed: default shop — please confirm (delivery, no shop chosen)" };
}

/**
 * Every completion is fenced by the SQL lease. Build 2: a CREATED lead gets exactly one portal
 * continuation email (lib/meta-leads/continuation.ts) after the lease-fenced apply; attached and
 * needs_human leads get none. The email step runs outside the lease (the ledger's email_state is its
 * own compare-and-set), so its failure can never re-run or fail the intake.
 */
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
    // The shop: the customer's choice (a label resolved to a code by the mapper), or — delivery with no
    // choice — routed by history → ad set → tenant default. Pickup without a choice never reaches here.
    let shop: Shop | null;
    let routed: string | null = null;
    if (mapped.intake.shopCode) shop = await shopByCode(sb, mapped.intake.shopCode);
    else if (!mapped.intake.isDelivery) throw new WorkerFailure("invalid_payload");
    else { const routing = await routeDeliveryLead(sb, mapped.intake.contactEmail, fetched.lead.adset_id); shop = routing.shop; routed = routing.note; }
    if (!shop) throw new WorkerFailure("invalid_location");
    const intake = { ...mapped.intake, notes: composeMetaNotes(mapped.noteParts, routed) };
    // Recheck the kill switch after provider I/O and before any identity/business creation.
    if (process.env.META_LEADS_ENABLED !== "1") return "disabled";
    // Double capture (Juan 2026-11-11): the opt-in applies ONLY to the Meta pre-filled (marketing)
    // email. The order email (a work email when given) is never passed to the consent writer.
    if (mapped.consent.optedIn && process.env.CUSTOMER_PROFILES === "1") {
      const consent = await sb.rpc("customer_consent_record_explicit", {
        p_email: intake.marketingEmail, p_channel: "email", p_source: "meta_lead_form",
        p_effective_at: row.provider_created_at,
        p_evidence_ref: `${leadgenId}:${mapped.consent.questionKey}`, p_text_version: mapped.consent.textVersion,
      });
      if (consent.error) {
        const refused = ["consent_invalid", "consent_relay", "consent_suppressed", "consent_evidence_conflict"].includes(consent.error.message);
        throw new WorkerFailure(refused ? "consent_refused" : "database");
      }
      if (!consent.data?.event_id) throw new WorkerFailure("database");
    }
    // The ORDER email is the identity: the catering_customers contact, the portal account, the
    // continuation recipient and the company-domain match.
    const customerId = await resolveOrCreatePortalCustomer(intake.contactEmail, intake.contactName, "meta_lead_form");
    const assignedTo = await resolveCateringManager(sb, shop.id);
    const applied = await sb.rpc("meta_lead_intake_apply", {
      p_leadgen_id: leadgenId, p_lease_id: leaseId, p_customer_id: customerId,
      p_location_id: shop.id, p_assigned_to: assignedTo, p_raw_keys: rawKeys,
      p_intake: { contact_name: intake.contactName, email: intake.contactEmail, secondary_email: intake.secondaryEmail,
        contact_phone: intake.contactPhone, company: intake.company, event_date: intake.eventDate, headcount: intake.headcount,
        notes: intake.notes, fulfillment: intake.isDelivery ? "delivery" : "pickup", language: form.language,
        location_id: shop.id, mapping_version: META_MAPPING_VERSION, consent: mapped.consent },
    });
    // A stale worker no longer owns the receipt; leave completion to its new holder.
    if (applied.error?.message === "stale_lease") return "busy";
    if (applied.error) {
      const refusals = new Map<string, Failure>([["invalid_customer", "identity_unresolved"], ["invalid_location", "invalid_location"], ["invalid_assignee", "invalid_assignee"], ["invalid_intake", "invalid_payload"]]);
      throw new WorkerFailure(refusals.get(applied.error.message) ?? "database");
    }
    const state: unknown = applied.data?.state;
    if (state !== "created" && state !== "attached" && state !== "needs_human") throw new WorkerFailure("database");
    if (state === "created" && typeof applied.data?.pipeline_id === "string") {
      // Outside the lease and outside this try's failure path by design: the lead exists; the email
      // ledger carries its own state. A thrown claim/result write is logged by code only (no PII).
      try {
        await sendMetaContinuation(sb, { leadgenId, pipelineId: applied.data.pipeline_id, locationId: shop.id, language: form.language, intake });
      } catch {
        console.error("[meta-leads] continuation ledger write failed; see runbook (email_state)");
      }
    }
    return state;
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
