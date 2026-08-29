/**
 * VENDOR SCHEMA PROBES — migration probes over the `vendors` table, and nothing else.
 *
 * ── WHY THIS IS ITS OWN LEAF MODULE ────────────────────────────────────────────
 * The house idiom is that a probe lives in the module that OWNS the data
 * (`parsColumnsReady` in lib/admin/skus.ts, `rhythmSchemaReady` in lib/vendor-rhythm.ts,
 * `countProductAllocationReady` in lib/counts.ts). This one has TWO owners at different
 * layers: the admin data layer (lib/admin/vendors.ts, which selects the column and edits
 * it) and the operational ordering layer (lib/ordering.ts, which renders it on a draft
 * order). Hosting it in the admin module would make the 6 AM par-pass path import the
 * 1500-line admin console module for one boolean; hosting it in lib/ordering.ts would
 * point the admin console at the walker. A leaf with no imports of its own belongs to
 * neither layer and cannot participate in a cycle — the same reasoning
 * lib/dynamic-pars-probes.ts records for its four probes.
 *
 * ── THE PATTERN (0180 precedent, unchanged) ────────────────────────────────────
 * One `select(<the exact column the writer touches>).limit(1)`. Cache ONLY the TRUE
 * answer; re-probe while false, so the surface lights itself the moment the migration
 * lands — no redeploy, no flag, and no stale `false` stranded in a warm serverless
 * process. Log the pending state exactly once per process.
 */
import type { getServiceRoleClient } from "@/lib/supabase-server";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

let orderMinimumReady = false;
let orderMinimumPendingLogged = false;

/**
 * 0184: `vendors.order_minimum` — the display-only order-minimum advisory.
 *
 * PostgREST rejects the WHOLE select when one named column is missing, so both readers
 * build their column list through this: pre-apply the field is simply absent (the admin
 * card says so; the draft-order line does not render), and the write path refuses with a
 * named 503 rather than silently dropping an operator's entry.
 */
export async function vendorOrderMinimumReady(sb: ServiceClient): Promise<boolean> {
  if (orderMinimumReady) return true;
  const { error } = await sb.from("vendors").select("order_minimum").limit(1);
  if (error) {
    if (!orderMinimumPendingLogged) {
      orderMinimumPendingLogged = true;
      console.warn(
        `[vendors] order_minimum is DORMANT — migration 0184 is not applied yet: ${error.message}`,
      );
    }
    return false;
  }
  orderMinimumReady = true;
  return true;
}
