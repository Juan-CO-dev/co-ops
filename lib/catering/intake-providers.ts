/**
 * Platform-intake provider seam (spec #2b). SERVER-ONLY. STUB until a platform
 * API lands — mirrors the lib/catering/lto-pos-push.ts dormant pattern: this
 * one function becomes real per provider (EZCater first — Juan confirms an API
 * exists) and the punch-in flow it automates stays as the manual fallback.
 *
 * Activation path (documented, not built): provider credentials land in env →
 * fetchPlatformOrders(provider) pulls that platform's orders → each becomes a
 * createLead punch-in with lead_source = the provider code and the platform
 * order id in notes/metadata — flowing through W4a reserve like any lead.
 * Never throws; the caller reads `status`.
 */
import "server-only";

export type IntakeProvider = "ezcater";

export interface PlatformOrder {
  externalId: string;
  contactName: string;
  eventDate: string | null;
  headcount: number | null;
  totalCents: number | null;
}

export interface PlatformFetchResult {
  status: "not_configured" | "fetched" | "failed";
  provider: IntakeProvider;
  orders: PlatformOrder[];
  reason?: string;
}

export async function fetchPlatformOrders(provider: IntakeProvider): Promise<PlatformFetchResult> {
  // Platform integrations pending — no-op seam. Intentionally never throws.
  return { status: "not_configured", provider, orders: [], reason: "platform_integration_pending" };
}
