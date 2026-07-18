/**
 * Active catering rate rules for a location — SERVER-ONLY, service-role, UN-GATED read
 * (mirrors lib/portal/menu.ts: the portal has no staff AuthContext; authority is the customer
 * session at the route + strict server-side price authority). Staff loaders reuse this too.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { RateRule } from "@/lib/catering/pricing-derivation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All ACTIVE rate rules for a location, shaped for resolveRateBps. Empty array if none. */
export async function loadActiveRateRules(locationId: string): Promise<RateRule[]> {
  if (!UUID_RE.test(locationId)) throw new Error("catering rate-rules: locationId must be a UUID");
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_rate_rules")
    .select("scope, scope_ref, rate_bps")
    .eq("location_id", locationId)
    .eq("active", true)
    .returns<Array<{ scope: RateRule["scope"]; scope_ref: string | null; rate_bps: number }>>();
  if (error) throw new Error(`loadActiveRateRules: ${error.message}`);
  return (data ?? []).map((r) => ({ scope: r.scope, scopeRef: r.scope_ref, rateBps: r.rate_bps }));
}
