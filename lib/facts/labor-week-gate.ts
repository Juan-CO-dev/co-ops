/** Board two views PR 1: the ONE read behind `currentWeekCoverage` (lib/business-report-shared.ts), used by the
 * business report's loader and the schedule board's projection loader alike. For each payroll week it asks
 * 0340's `fact_labor_week_fingerprint(week, LABOR_BUILDER_VERSION)`: the fingerprint of the week's CURRENT
 * source. It never throws and never guesses: a week whose read errored, was aborted or answered anything but a
 * fingerprint is `null`, which the gate reads as `rebuilding` (fail closed). No new SQL. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LABOR_BUILDER_VERSION } from "./labor-config-shared";

/** At most this many fingerprint reads in flight (a 92-day report asks for up to 14 weeks). */
export const WEEK_FINGERPRINT_CONCURRENCY = 4;

export async function readCurrentWeekFingerprints(sb: Pick<SupabaseClient, "rpc">, weekStarts: readonly string[]): Promise<Map<string, string | null>> {
  const weeks = [...new Set(weekStarts.map((w) => String(w).slice(0, 10)))].sort();
  const out = new Map<string, string | null>();
  for (let i = 0; i < weeks.length; i += WEEK_FINGERPRINT_CONCURRENCY) {
    await Promise.all(weeks.slice(i, i + WEEK_FINGERPRINT_CONCURRENCY).map(async (w) => {
      try {
        const { data, error } = await sb.rpc("fact_labor_week_fingerprint", { p_week_start: w, p_builder_version: LABOR_BUILDER_VERSION });
        out.set(w, !error && typeof data === "string" && data.length > 0 ? data : null);
      } catch {
        out.set(w, null);
      }
    }));
  }
  return out;
}
