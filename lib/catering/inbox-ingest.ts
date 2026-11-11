import { randomUUID } from "node:crypto";
import { isInboxSchemaMissing } from "./inbox-schema-shared";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { selectAllRows } from "@/lib/supabase-paginate";
import { TENANT_NAME } from "@/lib/tenant";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { inboxLatestText, inboxOwnAddresses, type InboxHeaders } from "./inbox-content-shared";
import { classifyCateringInbox, INBOX_RULE_VERSION } from "./inbox-classify-shared";
import { cateringInboxPlaybook, inboxReplyLanguage } from "./inbox-playbooks-shared";
import { resolveCateringInboxIdentity } from "./inbox-identity";
import type { InboxDisposition } from "./inbox-shared";

export interface StoredCateringInbound {
  id: string; inbound_message_id: string; revision: number; disposition: InboxDisposition; sender_address: string | null;
  subject: string; body_text: string; headers: InboxHeaders; external_ref: string | null; thread_key: string | null;
}

/** TODO: switch to portalOrigin() from lib/portal/origin-shared.ts when that PR merges. */
export function cateringInboxPortalUrl(): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!origin) throw new Error("inbox_portal_not_configured");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("inbox_portal_not_configured");
  return `${url.origin}/order/start`;
}

/** Resume solely from the immutable child evidence. No provider fetch or business writer. */
export async function finalizeCateringInbound(message: StoredCateringInbound, sb: ReturnType<typeof getServiceRoleClient>): Promise<void> {
  if (message.disposition !== "recorded") return;
  const [aliases, locations, identity, transport] = await Promise.all([
    selectAllRows<{ address: string; active: boolean }>((from, to) => sb.from("inbound_address_aliases")
      .select("address,active").eq("active", true).order("id").range(from, to)),
    selectAllRows<{ receipt_email_address: string | null }>((from, to) => sb.from("locations")
      .select("receipt_email_address").order("id").range(from, to)),
    resolveCateringInboxIdentity({ sender: message.sender_address, threadKey: message.thread_key,
      externalRef: message.external_ref, messageId: message.id }, sb),
    sb.from("inbound_messages").select("location_id").eq("id", message.inbound_message_id)
      .single<{ location_id: string | null }>(),
  ]);
  if (transport.error || !transport.data) throw new Error("inbox_transport_read_failed");
  const ownAddresses = inboxOwnAddresses({ aliases, receiptAddresses: locations.map(row => row.receipt_email_address),
    emailFrom: process.env.EMAIL_FROM, emailFromTeam: process.env.EMAIL_FROM_TEAM, legacyAddresses: process.env.CATERING_LEGACY_ADDRESSES });
  const decision = classifyCateringInbox({ sender: message.sender_address ?? "", subject: message.subject,
    body: message.body_text, headers: message.headers, ownAddresses, identity: identity.identity, artifact: identity.artifact });
  const language = inboxReplyLanguage({ subject: message.subject, latestText: inboxLatestText(message.body_text).text });
  const dictionary: Record<string, string> = language === "es" ? es : en;
  const draft = decision.disposition === "drafted" ? cateringInboxPlaybook({ decision, identity: identity.identity,
    language, portalUrl: cateringInboxPortalUrl(), tenantName: TENANT_NAME, artifactStage: identity.artifactStage,
    translate: (key, params) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match),
  }) : null;
  if (decision.disposition === "drafted" && !draft) throw new Error("inbox_draft_configuration");
  // 0296 snapshots the eligible lead assignee, then nullable-location A1.3, under
  // the finalization lock. Its closed result contract deliberately has no assignee override.
  const { data, error } = await sb.rpc("finalize_catering_inbound", {
    p_message_id: message.id, p_expected_revision: message.revision, p_request_id: randomUUID(),
    p_result: { classification: decision.classification, identity_status: identity.identity,
      catering_customer_id: identity.customerId, lead_id: identity.leadId, quote_id: identity.quoteId,
      location_id: identity.locationId ?? transport.data.location_id, disposition: decision.disposition, reason: decision.reason, rule_version: INBOX_RULE_VERSION },
    p_draft: draft,
  });
  if (isInboxSchemaMissing(error)) throw error;
  if (error) throw new Error("inbox_finalize_failed");
  if (data?.replayed) return;
  const base = { actorId: null, actorRole: null, resourceTable: "catering_inbound_messages", resourceId: message.id,
    metadata: { rule_version: INBOX_RULE_VERSION, classification: decision.classification, reason: decision.reason }, ipAddress: null, userAgent: null };
  await audit({ ...base, action: "catering.inbox.ingest" });
  if (draft) await audit({ ...base, action: "catering.inbox.draft", metadata: { ...base.metadata, template_version: draft.template_version } });
  if (decision.disposition === "needs_human") await audit({ ...base, action: "catering.inbox.escalate" });
}
