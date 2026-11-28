import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";

/** Database lease spans independent Vercel instances and UTC slot boundaries.
 * Held for 330s (longer than every route runtime), even after failure. No release:
 * a delayed duplicate cannot start work immediately after the first response.
 * A crashed invocation recovers automatically before the next ten-minute tick.
 * `sevenshifts-sync` (0268) is the hourly 7shifts read; Sync now shares its lease.
 * `schedule-draft` (0275) is the Wednesday schedule draft (Scheduling Phase 2, Task 19).
 * `catering-inbox-delivery` (0298) is the catering inbox delivery worker (phase 1b), inert unless live.
 * `fact-build` (0337) is the hourly ORDER fact build (item 2), inert unless FACT_LAYER=1.
 * `demand-signals` (0343) is the demand-signal collection (item 4 PR 2), inert unless DEMAND_SIGNALS=1 AND its source is verified.
 * `catering-refund-sweep` (0359) is the 15-minute refund sweep (catering refunds B1), inert unless CATERING_REFUNDS=1 AND an epoch admits work.
 */
export type CronRouteJob = "toast-sales-today" | "toast-catering-scan" | "sevenshifts-sync" | "schedule-draft" | "catering-inbox-delivery" | "meta-leads" | "fact-build" | "demand-signals" | "catering-refund-sweep";
export async function claimCronRoute(job: CronRouteJob): Promise<boolean> {
  const { data, error } = await getServiceRoleClient().rpc("claim_cron_route", { p_job: job })
    .abortSignal(AbortSignal.timeout(5_000));
  if (error || typeof data !== "boolean") throw new Error("cron_route_claim_failed");
  return data;
}
