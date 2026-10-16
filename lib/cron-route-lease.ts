import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";

/** Database lease spans independent Vercel instances and UTC slot boundaries.
 * Held for 330s (longer than every route runtime), even after failure. No release:
 * a delayed duplicate cannot start work immediately after the first response.
 * A crashed invocation recovers automatically before the next ten-minute tick.
 * `sevenshifts-sync` (0268) is the hourly 7shifts read; Sync now shares its lease.
 */
export type CronRouteJob = "toast-sales-today" | "toast-catering-scan" | "sevenshifts-sync";
export async function claimCronRoute(job: CronRouteJob): Promise<boolean> {
  const { data, error } = await getServiceRoleClient().rpc("claim_cron_route", { p_job: job })
    .abortSignal(AbortSignal.timeout(5_000));
  if (error || typeof data !== "boolean") throw new Error("cron_route_claim_failed");
  return data;
}
