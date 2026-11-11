import { inboxDraftEligible, type InboxDecision, type InboxIdentity } from "./inbox-shared";

export const INBOX_TEMPLATE_VERSION = "1";
export const INBOX_CUSTOMER_STATUSES = ["received", "reviewing", "scheduled", "on_the_way", "closed"] as const;
export type InboxCustomerStatus = typeof INBOX_CUSTOMER_STATUSES[number];
/** Dedicated customer vocabulary: never interpolate an internal pipeline status. */
export function inboxCustomerStatus(stage: string): InboxCustomerStatus {
  switch (stage) {
    case "inquiry": return "received";
    case "quote_sent": return "reviewing";
    case "confirmed": return "scheduled";
    case "out": return "on_the_way";
    default: return "closed";
  }
}
export interface InboxReplyDraft {
  language: "en" | "es"; template_key: "intake" | "ours" | "third_party"; template_version: string;
  params: { portalUrl: string; tenantName: string; channel: string; status: InboxCustomerStatus };
  preview_text: string;
}
export interface InboxPlaybookInput {
  decision: InboxDecision; identity: InboxIdentity; language: "en" | "es";
  portalUrl: string; tenantName: string; artifactStage?: string;
  /** Translation is injected; this module performs no I/O and imports no dictionaries. */
  translate: (key: string, params?: Record<string, string>) => string;
}
export function cateringInboxPlaybook(input: InboxPlaybookInput): InboxReplyDraft | null {
  if (!inboxDraftEligible(input.decision, input.identity)) return null;
  let url: URL;
  try { url = new URL(input.portalUrl); } catch { return null; }
  // Only the plain, configured portal entry point. No token, credentials or fragment.
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !/^\/order(?:\/start)?\/?$/.test(url.pathname)) return null;
  const tenantName = input.tenantName.replace(/[\r\n\0]/g, " ").trim().slice(0, 120);
  if (!tenantName) return null;
  const { decision } = input;
  const template = decision.classification === "intake" ? "intake" : decision.classification === "troubleshoot_ours" ? "ours" : "third_party";
  const channel = decision.channel === "ezcater" ? "ezCater" : decision.channel === "tripleseat" ? "Tripleseat" : decision.channel === "toast" ? "Toast" : "provider";
  const status = inboxCustomerStatus(input.artifactStage ?? "inquiry");
  const t = (suffix: string, params?: Record<string, string>) => input.translate(`catering.inbox.mail.${suffix}`, params);
  const lines = [t("greeting_unknown")];
  if (template === "intake") lines.push(t("intake.body"), t("intake.cta"), url.href);
  else if (template === "ours") lines.push(t("ours.status", { status: input.translate(`catering.inbox.customer_status.${status}`) }), t("ours.body"), t("ours.cta"), url.href);
  else lines.push(t(`third_party.${["ezcater", "toast", "tripleseat"].includes(decision.channel) ? decision.channel : "unknown"}`), t("third_party.boundary"));
  if (template !== "ours") lines.push(t(decision.channel === "ezcater" ? "pull.ezcater" : "pull.direct"));
  lines.push(t("signoff", { tenantName }));
  return { language: input.language, template_key: template, template_version: INBOX_TEMPLATE_VERSION,
    params: { portalUrl: url.href, tenantName, channel, status }, preview_text: lines.join("\n\n") };
}
