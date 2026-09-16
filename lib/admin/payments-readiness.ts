/**
 * Payments (Stripe) READINESS for the admin integrations panel. SERVER-ONLY, service-role,
 * level-gated here the way lib/admin/ezcater-map.ts gates its own read.
 *
 * PRESENCE ONLY. This module answers "is a complete credential pair set for this shop?" and
 * returns booleans. No key, no prefix, no last-four, no length — nothing that narrows a
 * secret ever crosses this boundary, because the panel's job is to tell an operator whether
 * the errand is done, not to let them check the value.
 *
 * WHY IT LIVES BESIDE THE ezCATER READINESS. `EzcaterAdminState.webhookConfigured` /
 * `apiConfigured` already answer exactly this question for that integration, and the same
 * tab renders them. A separate module rather than an extra field on the ezCater state, so
 * the ezCater loader keeps meaning one integration.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { stripeReadiness, type StripeReadiness } from "@/lib/stripe/client";

/** AGM+ — the same floor lib/admin/ezcater-map.ts uses for integration visibility. */
export const PAYMENTS_READ_MIN = 6;

export interface PaymentsReadiness extends StripeReadiness {
  /** `locations.name` per row id, so the panel can name a shop without a second query. */
  locationNames: Record<string, string>;
  /**
   * The endpoint Juan registers in Stripe for the DEFAULT (one-account) deployment, or
   * null when NEXT_PUBLIC_APP_URL is unset. Per-location deployments register
   * `<this>/<code>` per shop; the panel shows the base and the codes it lists.
   */
  webhookUrl: string | null;
}

export async function loadPaymentsReadiness(actor: AuthContext): Promise<PaymentsReadiness> {
  if (getRoleLevel(actor.user.role) < PAYMENTS_READ_MIN) {
    // Not an error surface: the caller is a page that already gated. A starved shape keeps
    // this honest if that ever stops being true.
    return {
      defaultConfigured: false,
      defaultSecretKeyPresent: false,
      defaultWebhookSecretPresent: false,
      locations: [],
      locationNames: {},
      webhookUrl: null,
    };
  }

  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("locations")
    .select("id, name, code")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; code: string | null }>>();
  if (error) throw new Error(`loadPaymentsReadiness locations: ${error.message}`);

  const rows = (data ?? []).filter((l): l is { id: string; name: string; code: string } => typeof l.code === "string" && l.code.length > 0);
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || null;

  return {
    ...stripeReadiness(rows.map((l) => ({ id: l.id, code: l.code }))),
    locationNames: Object.fromEntries(rows.map((l) => [l.id, l.name])),
    webhookUrl: base ? `${base}/api/webhooks/stripe` : null,
  };
}
