/**
 * Vendor-ordering OUTBOUND SMS adapter — SEAM ONLY (Vendor Ordering V2 §5c / §8, V2-D5).
 * SERVER-ONLY. This is intentionally a stub: it always returns {error: "sms_dormant"}.
 *
 * WHY A SEAM, NOT AN IMPLEMENTATION: outbound SMS needs a provisioned Twilio number (the
 * FROM) + live account creds in a request path. That number is a pending Juan errand; until
 * it lands there is NO UI send button (spec §8 non-goal: "outbound SMS UI/send button —
 * needs the Twilio number — seam only"). Landing the real adapter is a one-function swap here
 * (build the Twilio Messages API POST, record an outbound sms_messages row with the returned
 * MessageSid as provider_sid, wire a Send-via-text affordance) with zero call-site churn —
 * every caller already handles the {error} shape.
 *
 * The inbound leg (lib/sms-messages.ts + app/api/webhooks/twilio-inbound) is the live half of
 * V2-D5; this outbound half stays dark by design.
 */
import "server-only";

/**
 * Send an order to a vendor by SMS. DORMANT: always {error: "sms_dormant"} until the Twilio
 * number is provisioned (spec §8). Signature is intentionally minimal — the real adapter will
 * widen it (poId, actor) when the leg wakes; keeping it tiny avoids a speculative contract.
 */
export function sendOrderSms(): { error: "sms_dormant" } {
  return { error: "sms_dormant" };
}
