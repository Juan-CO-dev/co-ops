import type { SendEmailResult } from "@/lib/email";
import type { InboxHeaders } from "./inbox-content-shared";
import type { InboxReason } from "./inbox-shared";

/** Phase 1b delivery — the CLIENT-SAFE pure surface: switches, outcome mapping, threading and rendering.
 *  No I/O, no env reads (the env is a parameter), no sender import. The only sender is lib/catering/inbox-delivery.ts. */
export const INBOX_DELIVERY_STATES = ["draft", "claimed", "sent", "failed", "ambiguous", "cancelled"] as const;
export type InboxDeliveryState = typeof INBOX_DELIVERY_STATES[number];
export type InboxMode = "off" | "shadow" | "live";
export const INBOX_MODES: readonly InboxMode[] = ["off", "shadow", "live"];
/** Every refusal a send can answer with; each has an en + es `catering.inbox.send_error.<code>` message. */
export const INBOX_SEND_ERRORS = ["delivery_off", "not_configured", "delivery_busy", "already_sent", "needs_review", "thread_cap",
  "revalidation_failed", "quote_revalidation_failed", "invalid_recipient", "invalid_state", "no_draft", "stale_revision", "request_conflict", "attempts_exhausted",
  "not_new", "send_failed", "send_ambiguous", "inbox_unavailable"] as const;
export type InboxSendError = typeof INBOX_SEND_ERRORS[number];
export const INBOX_DELIVERY_ERROR_CODES = ["provider_rejected", "provider_uncertain", "idempotency_conflict", "lease_expired", "not_configured", "invalid_recipient", "send_failed"] as const;
export type InboxDeliveryErrorCode = typeof INBOX_DELIVERY_ERROR_CODES[number];
/** The cron gives a failed attempt up after this many; a human may still retry. Mirrors 0298. */
export const INBOX_MAX_CRON_ATTEMPTS = 3;
/** A failed attempt is not retried by the cron before this much time has passed. */
export const INBOX_RETRY_BACKOFF_MS = 10 * 60 * 1000;

const ADDRESS = /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/;
/** `addr` or `Name <addr>`; returns the bare address (lower-cased) or null. */
export function senderAddress(raw: string | undefined | null): string | null {
  const value = raw?.trim() ?? "";
  if (!value || /[\r\n\0]/.test(value)) return null;
  const named = /^([^<>\r\n]{1,100}?)\s*<([^<>\s]+)>$/.exec(value);
  const address = (named ? named[2] : value) ?? "";
  return ADDRESS.test(address) ? address.toLowerCase() : null;
}

export interface InboxDeliveryEnv { CATERING_INBOX_DELIVERY_ENABLED?: string; CATERING_INBOX_FROM?: string; EMAIL_FROM_TEAM?: string; RESEND_API_KEY?: string }
export type InboxDeliveryConfig =
  | { ok: true; replyFrom: string; replyAddress: string; teamFrom: string; teamAddress: string }
  | { ok: false; code: "delivery_off" | "not_configured" };

/** ALL of: settings mode live, the env flag exactly "1", an explicit reply sender, an explicit team sender, a provider key.
 *  Missing or malformed configuration fails closed; nothing falls back to EMAIL_FROM. */
export function inboxDeliveryConfig(mode: InboxMode | null | undefined, env: InboxDeliveryEnv): InboxDeliveryConfig {
  if (mode !== "live" || env.CATERING_INBOX_DELIVERY_ENABLED !== "1") return { ok: false, code: "delivery_off" };
  const replyAddress = senderAddress(env.CATERING_INBOX_FROM);
  const teamAddress = senderAddress(env.EMAIL_FROM_TEAM);
  if (!replyAddress || !teamAddress || !env.RESEND_API_KEY?.trim()) return { ok: false, code: "not_configured" };
  return { ok: true, replyFrom: env.CATERING_INBOX_FROM!.trim(), replyAddress, teamFrom: env.EMAIL_FROM_TEAM!.trim(), teamAddress };
}

export type InboxDeliveryOutcome =
  | { outcome: "sent"; providerId: string }
  | { outcome: "failed"; code: "provider_rejected" | "send_failed" }
  | { outcome: "ambiguous"; code: "provider_uncertain" | "idempotency_conflict" };
/** Resend error names that mean the request was REFUSED before processing (a definite 4xx). Only these may ever lead to
 *  a new idempotency key on a later attempt. Everything else named is unknown-until-proven. */
export const PROVIDER_DEFINITE_REJECTIONS: ReadonlySet<string> = new Set(["validation_error", "missing_required_field", "invalid_parameter",
  "invalid_from_address", "invalid_attachment", "invalid_access", "invalid_api_Key", "invalid_api_key", "missing_api_key", "restricted_api_key",
  "invalid_scope", "invalid_region", "not_found", "method_not_allowed", "rate_limit_exceeded", "daily_quota_exceeded", "security_error",
  "invalid_idempotency_key"]);
/** "Still processing / unknown": a timeout, a network error, a 5xx, a 200 with no id, or Resend's
 *  `concurrent_idempotent_requests` (the same key is still being processed). */
export const PROVIDER_UNCERTAIN: ReadonlySet<string> = new Set(["concurrent_idempotent_requests", "internal_server_error", "application_error"]);
/** Classify one provider answer. Uncertainty is preserved: it becomes `ambiguous` for a human and is never resent under a
 *  new key. `invalid_idempotent_request` (same key, different payload) is a conflict a person must look at, not a resend. */
export function inboxDeliveryOutcome(result: SendEmailResult): InboxDeliveryOutcome {
  if ("id" in result) return { outcome: "sent", providerId: result.id.slice(0, 200) };
  if (result.code === "invalid_threading") return { outcome: "failed", code: "send_failed" };
  if (result.code === "invalid_idempotent_request") return { outcome: "ambiguous", code: "idempotency_conflict" };
  if (result.code && PROVIDER_DEFINITE_REJECTIONS.has(result.code)) return { outcome: "failed", code: "provider_rejected" };
  return { outcome: "ambiguous", code: "provider_uncertain" };
}

const MSG_ID = /^<[!-=?-~]{1,200}@[!-=?-~]{1,250}>$/;
/** In-Reply-To = the inbound Message-ID; References = its chain plus that id. Malformed evidence is simply omitted. */
export function inboxReplyThreading(headers: Pick<InboxHeaders, "message-id" | "references">): { inReplyTo?: string; references?: string[] } {
  const messageId = headers["message-id"]?.trim();
  const chain = (headers.references ?? "").split(/\s+/).map(id => id.trim()).filter(id => MSG_ID.test(id));
  const out: { inReplyTo?: string; references?: string[] } = {};
  if (messageId && MSG_ID.test(messageId)) { out.inReplyTo = messageId; chain.push(messageId); }
  if (chain.length) out.references = [...new Set(chain)];
  return out;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
/** Plain paragraphs only: no markup from the stored text ever reaches the HTML part unescaped. */
export function textToHtml(text: string): string {
  return text.split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("\n");
}

export type Translate = (key: string, params?: Record<string, string>) => string;
export interface RenderedMail { subject: string; text: string; html: string }

/** The customer reply: the frozen preview is the body; the subject is the reviewed template subject. */
export function renderInboxReply(input: { templateKey: string; params: Record<string, string>; previewText: string; translate: Translate }): RenderedMail {
  const subject = input.translate(`catering.inbox.mail.${input.templateKey}.subject`, { channel: input.params.channel ?? "" }).replace(/[\r\n]/g, " ").slice(0, 200);
  return { subject, text: input.previewText, html: textToHtml(input.previewText) };
}

export interface EscalationEnvelope { language: "en" | "es"; params: { tenantName: string; reason: InboxReason; inboxUrl?: string }; preview_text: string }
/** The staff escalation body, frozen by the claim on its first attempt. Never a token, never a customer link. */
export function buildInboxEscalation(input: { language: "en" | "es"; tenantName: string; inboxUrl: string | null; reason: InboxReason;
  sender: string | null; subject: string; translate: Translate }): EscalationEnvelope {
  const t = (suffix: string, params?: Record<string, string>) => input.translate(`catering.inbox.escalation.${suffix}`, params);
  const tenantName = input.tenantName.replace(/[\r\n\0]/g, " ").trim().slice(0, 120) || "-";
  const clean = (value: string) => value.replace(/[\s\0]+/g, " ").trim().slice(0, 300);
  const lines = [t("intro"), t("from", { sender: clean(input.sender ?? t("no_sender")) }), t("subject", { subject: clean(input.subject) || t("no_subject") }),
    t("reason", { reason: input.translate(`catering.inbox.reason.${input.reason}`) })];
  if (input.inboxUrl) lines.push(t("open"), input.inboxUrl);
  lines.push(t("signoff", { tenantName }));
  const params: EscalationEnvelope["params"] = { tenantName, reason: input.reason, ...(input.inboxUrl ? { inboxUrl: input.inboxUrl } : {}) };
  return { language: input.language, params, preview_text: lines.join("\n\n") };
}
export function renderInboxEscalation(input: { previewText: string; translate: Translate }): RenderedMail {
  return { subject: input.translate("catering.inbox.escalation.email_subject").replace(/[\r\n]/g, " ").slice(0, 200), text: input.previewText, html: textToHtml(input.previewText) };
}

/** The staff inbox link an escalation may carry: an https origin plus the plain inbox path, else nothing. */
export function inboxStaffUrl(origin: string | undefined | null): string | null {
  if (!origin || !/^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?\/?$/.test(origin.trim())) return null;
  return `${origin.trim().replace(/\/$/, "")}/catering/inbox`;
}

/** Which failed/unsent reply drafts the cron may attempt now (the SQL re-checks everything again at claim time). */
export function inboxCronEligible(row: { delivery_state: InboxDeliveryState | null | undefined; delivery_attempt: number | null | undefined; delivery_attempted_at: string | null | undefined }, now: number): boolean {
  const state = row.delivery_state ?? "draft";
  if (state === "draft") return true;
  if (state !== "failed") return false;
  if ((row.delivery_attempt ?? 0) >= INBOX_MAX_CRON_ATTEMPTS) return false;
  const last = row.delivery_attempted_at ? Date.parse(row.delivery_attempted_at) : NaN;
  return Number.isNaN(last) || now - last >= INBOX_RETRY_BACKOFF_MS;
}

/** May the pane offer "Send draft"? Live mode, a drafted message, an unsent or failed reply draft. */
export function inboxSendable(input: { mode: InboxMode; disposition: string; hasDraft: boolean; deliveryState: InboxDeliveryState | null }): boolean {
  return input.mode === "live" && input.disposition === "drafted" && input.hasDraft && (input.deliveryState === null || input.deliveryState === "draft" || input.deliveryState === "failed");
}
