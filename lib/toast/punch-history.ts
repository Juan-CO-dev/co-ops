/**
 * PUNCH HISTORY — the Toast time entries of LINKED people at one shop over a date range (Scheduling Phase 2, Task 16).
 *
 * `toast_time_entries` (0224) rows with a `user_id` (the 0233 link trigger fills it) and `deleted = false`, business
 * dates in [from, to], paged in a stable order. Only the fields the assumed-availability pattern reads
 * (`people-input-shared` `PunchEntry`): never a wage, never a name. Service role; the caller gates.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PunchEntry } from "@/lib/scheduling/people-input-shared";
import { selectAllRows } from "@/lib/supabase-paginate";

export const PUNCH_HISTORY_COLUMNS = "time_entry_guid, user_id, business_date, in_at, out_at, hours, deleted";

export async function loadPunchHistory(service: SupabaseClient, args: { locationId: string; from: string; to: string }): Promise<PunchEntry[]> {
  const rows = await selectAllRows<{ time_entry_guid: string; user_id: string | null; business_date: string; in_at: string; out_at: string | null; hours: number | string | null; deleted: boolean }>(
    (from, to) => service.from("toast_time_entries").select(PUNCH_HISTORY_COLUMNS)
      .eq("location_id", args.locationId).eq("deleted", false).not("user_id", "is", null)
      .gte("business_date", args.from).lte("business_date", args.to)
      .order("business_date", { ascending: true }).order("time_entry_guid", { ascending: true }).range(from, to));
  return rows.map((r) => ({
    userId: r.user_id, businessDate: r.business_date, inAt: r.in_at, outAt: r.out_at,
    hours: r.hours === null ? 0 : Number(r.hours), deleted: r.deleted,
  }));
}
