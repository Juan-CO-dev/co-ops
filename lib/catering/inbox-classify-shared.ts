import { normalizeInboundAddress } from "@/lib/inbound-router-shared";
import { inboxLatestText, inboxThreadInitial, type InboxHeaders } from "./inbox-content-shared";
import type { InboxChannel, InboxDecision, InboxIdentity, InboxReason } from "./inbox-shared";

export const INBOX_RULE_VERSION = "1";
/** Auto-replies, bounces, list and bulk mail, daemons: never answered. One rule for the classifier and the sender. */
export function inboxAutomatedMessage(headers: InboxHeaders, sender: string | null): boolean {
  return (!!headers["auto-submitted"] && headers["auto-submitted"].toLowerCase() !== "no") ||
    /\b(bulk|list|junk)\b/i.test(headers.precedence ?? "") || !!headers["list-id"] || !!headers["list-unsubscribe"] ||
    headers["return-path"] === "<>" || /delivery-status/i.test(headers["content-type"] ?? "") ||
    /^(mailer-daemon|postmaster)@/i.test(sender ?? "");
}
export interface InboxClassifyInput {
  sender: string; subject: string; body: string; headers: InboxHeaders;
  ownAddresses: ReadonlySet<string>; identity: InboxIdentity;
  artifact: "none" | "resolved" | "ambiguous";
}
export function classifyCateringInbox(input: InboxClassifyInput): InboxDecision {
  const sender = normalizeInboundAddress(input.sender);
  const domain = sender?.split("@")[1] ?? "";
  const platform = (["ezcater", "tripleseat"] as const).find(p => domain === `${p}.com` || domain.endsWith(`.${p}.com`));
  const latest = inboxLatestText(input.body);
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const text = fold(`${input.subject}\n${latest.text}`);
  const channel: InboxChannel = platform ?? (/\bezcater\b/.test(text) ? "ezcater" : /\btripleseat\b/.test(text) ? "tripleseat" : /\btoast\b/.test(text) ? "toast" : "email");
  const threadInitial = inboxThreadInitial(input.subject, input.headers);
  const result = (classification: InboxDecision["classification"], disposition: InboxDecision["disposition"], reason: InboxReason | null): InboxDecision =>
    ({ classification, disposition, reason, channel, threadInitial });
  // Followups only demote otherwise draftable decisions.
  const decide = (): InboxDecision => {
    if (sender && input.ownAddresses.has(sender)) return result("noise", "noise", "own_address");
    const urgent = /\b(urgent\w*|asap|today|angry|unacceptable|complaint|allerg\w*|alerg\w*|reclamo|charged twice|cuanto antes|hoy|enojad\w*|inaceptable|queja|cobro doble)\b/.test(text);
    const platformUrgent = urgent || /\b(payment|charged|refund\w*|disput\w*|reembolso|cobro|pag(o|ar))\b/.test(text);
    if (platform) return result("platform_notification", platformUrgent ? "needs_human" : "notification", platformUrgent ? "urgent" : null);
    if (inboxAutomatedMessage(input.headers, sender)) return result("noise", "noise", "automated_message");
    if (urgent) return result("unclassified", "needs_human", "urgent");
    if (latest.uncertainQuote) return result("unclassified", "needs_human", "quoted_history");
    const intake = /\bcatering\b/.test(text) && /\b(need\w*|request\w*|looking for|headcount|event\w*|necesit\w*|busc\w*|solicit\w*|cotiz\w*|personas|fecha|evento\w*|\d{1,4}[/-]\d{1,2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|jueves|viernes|sabado|domingo|(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}|\d{1,2} (?:de )?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\b/.test(text);
    const links = (text.match(/(?:https?:\/\/|www\.)[^\s]+/g) ?? []).length;
    const solicitation = /\b(software|platform|restaurants like yours|your restaurant|book a (call|meeting|demo)|schedule a (call|meeting)|free trial|case study|we help|increase .{0,40}(orders|sales|revenue)|su restaurante|plataforma|agendar una llamada|aumentar (sus )?ventas|we offer|our services|demo|partner\w*|seo|unsubscribe|ofrecemos|nuestros servicios|cancelar suscripcion)\b/.test(text) ||
      (input.identity !== "resolved" && links >= 3);
    const negative = /\b(?:no longer|ya no|not (?:looking for|requesting|seeking)|do not need|don't need|no (?:necesit\w*|busc\w*|quier\w*))\b/.test(text);
    if ((solicitation || negative) && intake) return result("unclassified", "needs_human", "conflicting_intent");
    if (solicitation || negative) return result("noise", "noise", "solicitation");
    if (/\b(chang\w*|modif\w*|reschedul\w*|postpon\w*|add \d+ more|update (our|my|the) order|cancel\w*|refund\w*|payment|charged|cambi\w*|reprogram\w*|aplaz\w*|agregar|reembolso|pag(o|ar))\b/.test(text))
      return result("unclassified", "needs_human", "payment_or_edit");
    if (input.artifact === "ambiguous") return result("unclassified", "needs_human", "ambiguous_artifact");
    if (!["resolved", "new_sender"].includes(input.identity) || !sender) return result("unclassified", "needs_human", "identity_unresolved");
    const help = /\b(status|help|missing|late|ayuda|retras\w*|demora\w*|no ha llegado|no lleg\w*|estado del pedido)\b/.test(text);
    if (help && input.identity === "resolved" && input.artifact === "resolved" && channel === "email")
      return result("troubleshoot_ours", "drafted", null);
    if (help && ["ezcater", "tripleseat", "toast"].includes(channel)) return result("troubleshoot_third_party", "drafted", null);
    if (intake) return result("intake", "drafted", null);
    return result("unclassified", "needs_human", "insufficient_content");
  };
  const decision = decide();
  return threadInitial || decision.disposition !== "drafted" ? decision : { ...decision, disposition: "needs_human", reason: "thread_followup" };
}
