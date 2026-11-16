import type { SendEmailResult } from "@/lib/email";

/**
 * lib/email-outcome-shared.ts — PURE, client-safe. The ONE reading of a provider's answer to a send, shared by
 * every sender that retries under an idempotency key: the catering inbox (lib/catering/inbox-delivery-shared.ts
 * re-exports it as `inboxDeliveryOutcome`) and the vendor order email (lib/po-email.ts, W19/B108). Moved here from
 * the catering module unchanged so ordering code does not import from catering.
 */
export type ProviderSendOutcome =
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
export function providerSendOutcome(result: SendEmailResult): ProviderSendOutcome {
  if ("id" in result) return { outcome: "sent", providerId: result.id.slice(0, 200) };
  if (result.code === "invalid_threading") return { outcome: "failed", code: "send_failed" };
  if (result.code === "invalid_idempotent_request") return { outcome: "ambiguous", code: "idempotency_conflict" };
  if (result.code && PROVIDER_DEFINITE_REJECTIONS.has(result.code)) return { outcome: "failed", code: "provider_rejected" };
  return { outcome: "ambiguous", code: "provider_uncertain" };
}
