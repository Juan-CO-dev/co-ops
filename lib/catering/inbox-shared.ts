import { getRoleLevel, type RoleCode } from "@/lib/roles";
import { canReadCateringContact } from "./ezcater-detail-shared";

export const INBOX_CLASSIFICATIONS = ["intake", "troubleshoot_ours", "troubleshoot_third_party", "platform_notification", "noise", "unclassified"] as const;
export type InboxClassification = typeof INBOX_CLASSIFICATIONS[number];
export const INBOX_IDENTITIES = ["resolved", "new_sender", "ambiguous", "masked", "missing"] as const;
export type InboxIdentity = typeof INBOX_IDENTITIES[number];
export const INBOX_DISPOSITIONS = ["recorded", "drafted", "needs_human", "notification", "noise", "handled"] as const;
export type InboxDisposition = typeof INBOX_DISPOSITIONS[number];
export const INBOX_REASONS = ["thread_followup", "identity_unresolved", "ambiguous_artifact", "urgent", "payment_or_edit", "conflicting_intent", "insufficient_content", "quoted_history", "own_address", "automated_message", "solicitation"] as const;
export type InboxReason = typeof INBOX_REASONS[number];
export const INBOX_CHANNELS = ["email", "ezcater", "tripleseat", "toast", "portal"] as const;
export type InboxChannel = typeof INBOX_CHANNELS[number];
export const INBOX_GROUPS = ["needs_reply", "drafted", "handled", "notifications", "noise"] as const;
export type InboxGroup = typeof INBOX_GROUPS[number];
export interface InboxReader { role: RoleCode; active: boolean; locations: string[] }

/** Fresh role/memberships must be supplied by the caller; assignment grants no access. */
export function canReadCateringInbox(actor: InboxReader, locationId: string | null): boolean {
  const global = actor.role === "catering_mgr" || getRoleLevel(actor.role) >= 8;
  return actor.active && (global || (actor.role === "gm" && locationId !== null && actor.locations.includes(locationId))) &&
    canReadCateringContact(actor, locationId);
}
export const canAssignCateringInbox = canReadCateringInbox;
export function inboxGroup(disposition: InboxDisposition): InboxGroup {
  switch (disposition) {
    case "drafted": return "drafted";
    case "handled": return "handled";
    case "notification": return "notifications";
    case "noise": return "noise";
    default: return "needs_reply";
  }
}
export interface InboxDecision {
  classification: InboxClassification;
  disposition: InboxDisposition;
  reason: InboxReason | null;
  channel: InboxChannel;
  threadInitial: boolean;
}
export function inboxDraftEligible(decision: InboxDecision, identity: InboxIdentity): boolean {
  return decision.threadInitial && decision.disposition === "drafted" && decision.reason === null &&
    (identity === "resolved" || identity === "new_sender") &&
    (decision.classification === "intake" || decision.classification === "troubleshoot_third_party" ||
      (decision.classification === "troubleshoot_ours" && identity === "resolved"));
}
