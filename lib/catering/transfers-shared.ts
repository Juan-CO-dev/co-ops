import { getRoleLevel, type RoleCode } from "@/lib/roles";

export const TRANSFER_REASONS = ["capacity", "customer_pickup_preference", "closer_delivery", "other"] as const;
export type TransferReason = typeof TRANSFER_REASONS[number];
export function canTransferCatering(role: RoleCode): boolean {
  return role === "catering_mgr" || getRoleLevel(role) >= 8;
}
export function validTransferReason(reason: unknown, note: unknown): reason is TransferReason {
  return TRANSFER_REASONS.some((value) => value === reason)
    && (note == null || typeof note === "string" && note.trim().length <= 1000)
    && (reason !== "other" || typeof note === "string" && note.trim().length > 0);
}

/** A refresh of unchanged provider identity is not a new reassignment. */
export function shouldKeepManualLocation(manualAt: string | null, evidenceAt: string | null): boolean {
  return manualAt !== null && (evidenceAt === null || Date.parse(manualAt) >= Date.parse(evidenceAt));
}
