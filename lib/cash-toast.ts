import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeToastCashProjected, type CashToastFacts, type ToastProjected } from "@/lib/cash-toast-shared";

export { computeToastCashProjected, type ToastProjected } from "@/lib/cash-toast-shared";

/**
 * B10 — the server's read of the day's Toast CASH figure for one shop (see
 * lib/cash-toast-shared.ts for the rule, migration 0253 for the SQL).
 *
 * Callers bind the location FIRST (the cash page and /api/cash run lockLocationContext + the
 * cash_report task gate before calling); this function does not widen or re-decide access.
 * Pass the service-role client — `cash_toast_projected_facts` is executable by service_role only.
 *
 * FAIL-SOFT: Toast is an aid to the deposit, never a precondition of it. Any read failure
 * (including the function not yet installed) logs and returns null — the page shows "Toast has
 * no figure yet" and the key holder types it; the save stores null for the Toast figure.
 */
export async function loadToastCashProjected(
  service: SupabaseClient, args: { locationId: string; businessDate: string },
): Promise<ToastProjected | null> {
  try {
    const { data, error } = await service.rpc("cash_toast_projected_facts", {
      p_location_id: args.locationId, p_business_date: args.businessDate,
    });
    if (error) {
      console.error(`[cash-toast] cash_toast_projected_facts failed (${error.code ?? "?"}): ${error.message}`);
      return null;
    }
    return computeToastCashProjected((data ?? null) as CashToastFacts | null);
  } catch (err) {
    console.error("[cash-toast] read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
