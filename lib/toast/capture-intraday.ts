import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { etYmdMinusDays } from "@/lib/operational-day";
import { captureEnabled, captureToastDaySystem } from "./capture";
import { captureBudget, captureErrorCode } from "./capture-runner";

/** Additive best-effort capture. One deadline includes location reads and both dates. */
export async function captureIntraday(today: string, signal?: AbortSignal) {
  if (!captureEnabled()) return { failures: 0, results: [], skipped: true };
  const budget = captureBudget(45_000, signal);
  const results: { locationId: string; date: string; error: string | null; skipped?: boolean }[] = [];
  try {
    const locations = await budget.wait(() => getServiceRoleClient().from("locations")
      .select("id").eq("active", true).not("toast_restaurant_guid", "is", null).abortSignal(budget.signal));
    if (locations.error) throw new Error("capture_location_unavailable");
    for (const date of [today, etYmdMinusDays(today, 1)]) {
      const day = await Promise.all((locations.data ?? []).map(async (location: { id: string }) => {
        try {
          const result = await budget.wait(() => captureToastDaySystem(location.id, date, { debounce: true, signal: budget.signal }));
          return { locationId: location.id, date, skipped: result.skipped,
            error: result.reason === "capture_schema_missing" ? result.reason : null };
        } catch (error) { return { locationId: location.id, date, error: captureErrorCode(error) }; }
      }));
      results.push(...day);
      if (budget.signal.aborted) break;
    }
    return { failures: results.filter((r) => r.error).length, results, skipped: false };
  } catch (error) {
    return { failures: 1, results, skipped: false, error: captureErrorCode(error) };
  } finally { budget.close(); }
}
