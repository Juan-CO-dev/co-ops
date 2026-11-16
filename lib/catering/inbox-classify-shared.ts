import { normalizeInboundAddress } from "@/lib/inbound-router-shared";
import { inboxLatestText, inboxThreadInitial, type InboxHeaders } from "./inbox-content-shared";
import type { InboxChannel, InboxDecision, InboxIdentity, InboxReason } from "./inbox-shared";

/** "2" (audit W11/B018): cancel/edit before solicitation; noise only on strong evidence from a sender who is not a known customer. */
export const INBOX_RULE_VERSION = "2";
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
    const solicitationPhrases = /\b(software|platform|restaurants like yours|your restaurant|book a (call|meeting|demo)|schedule a (call|meeting)|free trial|case study|we help|increase .{0,40}(orders|sales|revenue)|su restaurante|plataforma|agendar una llamada|aumentar (sus )?ventas|we offer|our services|demo|partner\w*|seo|unsubscribe|ofrecemos|nuestros servicios|cancelar suscripcion)\b/g;
    const pitchHits = new Set([...text.matchAll(solicitationPhrases)].map(match => match[0].toLowerCase())).size;
    // Noise needs STRONG evidence (several distinct pitch phrases, or a link farm) from a sender who is not a known customer;
    // one phrase ("your restaurant", a "Partner" signature) only asks a person (audit W11/B018).
    const strongPitch = input.identity !== "resolved" && (pitchHits >= 2 || links >= 3);
    const weakPitch = pitchHits >= 1 || (input.identity !== "resolved" && links >= 3);
    const negative = /\b(?:no longer|ya no|not (?:looking for|requesting|seeking)|do not need|don't need|no (?:necesit\w*|busc\w*|quier\w*))\b/.test(text);
    const edit = /\b(chang\w*|modif\w*|reschedul\w*|postpon\w*|add \d+ more|update (our|my|the) order|cancel\w*|refund\w*|payment|charged|cambi\w*|reprogram\w*|aplaz\w*|agregar|reembolso|pag(o|ar))\b/.test(text);
    // A cancel / change / payment about a known customer or an open order always reaches a person, before any pitch rule.
    if (edit && (input.identity === "resolved" || input.artifact !== "none")) return result("unclassified", "needs_human", "payment_or_edit");
    if (strongPitch) return intake ? result("unclassified", "needs_human", "conflicting_intent") : result("noise", "noise", "solicitation");
    if (edit) return result("unclassified", "needs_human", "payment_or_edit");
    if ((weakPitch || negative) && intake) return result("unclassified", "needs_human", "conflicting_intent");
    // "We no longer need ..." is a customer talking, never noise.
    if (negative) return result("unclassified", "needs_human", "conflicting_intent");
    if (weakPitch) return result("unclassified", "needs_human", "solicitation");
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
