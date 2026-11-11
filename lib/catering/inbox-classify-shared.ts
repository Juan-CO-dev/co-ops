import { normalizeInboundAddress } from "@/lib/inbound-router-shared";
import { inboxLatestText, inboxThreadInitial, type InboxHeaders } from "./inbox-content-shared";
import type { InboxChannel, InboxDecision, InboxIdentity, InboxReason } from "./inbox-shared";

export const INBOX_RULE_VERSION = "1";
export interface InboxClassifyInput {
  sender: string; subject: string; body: string; headers: InboxHeaders;
  ownAddresses: ReadonlySet<string>; identity: InboxIdentity;
  artifact: "none" | "resolved" | "ambiguous";
  /** Both dictionaries' frozen template lines, excluding arbitrary customer content. */
  ownTemplateLines?: readonly string[];
}
export function classifyCateringInbox(input: InboxClassifyInput): InboxDecision {
  const sender = normalizeInboundAddress(input.sender);
  const domain = sender?.split("@")[1] ?? "";
  const platform = (["ezcater", "tripleseat"] as const).find(p => domain === `${p}.com` || domain.endsWith(`.${p}.com`));
  const latest = inboxLatestText(input.body, input.ownTemplateLines);
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const text = fold(`${input.subject}\n${latest.text}`);
  const channel: InboxChannel = platform ?? (/\bezcater\b/.test(text) ? "ezcater" : /\btripleseat\b/.test(text) ? "tripleseat" : /\btoast\b/.test(text) ? "toast" : "email");
  const threadInitial = inboxThreadInitial(input.subject, input.headers);
  const result = (classification: InboxDecision["classification"], disposition: InboxDecision["disposition"], reason: InboxReason | null): InboxDecision =>
    ({ classification, disposition, reason, channel, threadInitial });
  // Determine the classification first; thread-followup always wins disposition below.
  const decide = (): InboxDecision => {
    if (sender && input.ownAddresses.has(sender)) return result("noise", "noise", "own_address");
    if (platform) return result("platform_notification", "notification", null);
    const urgent = /\b(urgent\w*|asap|today|angry|unacceptable|complaint|allerg\w*|charged twice|cuanto antes|hoy|enojad\w*|inaceptable|queja|cobro doble)\b/.test(text);
    if (urgent) return result("unclassified", "needs_human", "urgent");
    if (latest.uncertainQuote) return result("unclassified", "needs_human", "quoted_history");
    const headers = input.headers;
    const automated = (!!headers["auto-submitted"] && headers["auto-submitted"].toLowerCase() !== "no") ||
      /\b(bulk|list|junk)\b/i.test(headers.precedence ?? "") || !!headers["list-id"] || !!headers["list-unsubscribe"] ||
      headers["return-path"] === "<>" || /delivery-status/i.test(headers["content-type"] ?? "") ||
      /^(mailer-daemon|postmaster)@/i.test(sender ?? "");
    const intake = /\bcatering\b/.test(text) && /\b(need\w*|request\w*|looking for|headcount|event\w*|necesit\w*|busc\w*|solicit\w*|cotiz\w*|personas|fecha|evento\w*|\d{1,4}[/-]\d{1,2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|jueves|viernes|sabado|domingo|(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}|\d{1,2} (?:de )?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\b/.test(text);
    const links = (text.match(/(?:https?:\/\/|www\.)[^\s]+/g) ?? []).length;
    const solicitation = /\b(we offer|our services|demo|partner\w*|seo|unsubscribe|ofrecemos|nuestros servicios|cancelar suscripcion)\b/.test(text) ||
      (input.identity !== "resolved" && links >= 3);
    const negative = /\b(?:not (?:looking for|requesting|seeking)|do not need|don't need|no (?:necesit\w*|busc\w*|quier\w*))\b/.test(text);
    if ((solicitation || negative || automated) && intake) return result("unclassified", "needs_human", "conflicting_intent");
    if (solicitation || negative) return result("noise", "noise", "solicitation");
    if (automated) return result("noise", "noise", "automated_message");
    if (/\b(change\w*|modify|cancel\w*|refund\w*|payment|charged|cambi\w*|modific\w*|reembolso|pago)\b/.test(text))
      return result("unclassified", "needs_human", "payment_or_edit");
    if (input.artifact === "ambiguous") return result("unclassified", "needs_human", "ambiguous_artifact");
    if (!["resolved", "new_sender"].includes(input.identity) || !sender) return result("unclassified", "needs_human", "identity_unresolved");
    const help = /\b(status|help|missing|late|estado|ayuda|falta|tarde)\b/.test(text);
    if (help && input.identity === "resolved" && input.artifact === "resolved" && channel === "email")
      return result("troubleshoot_ours", "drafted", null);
    if (help && ["ezcater", "tripleseat", "toast"].includes(channel)) return result("troubleshoot_third_party", "drafted", null);
    if (intake) return result("intake", "drafted", null);
    return result("unclassified", "needs_human", "insufficient_content");
  };
  const decision = decide();
  return threadInitial ? decision : { ...decision, disposition: "needs_human", reason: "thread_followup" };
}
