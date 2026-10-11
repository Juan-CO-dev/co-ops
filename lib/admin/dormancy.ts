import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllRows } from "@/lib/supabase-paginate";

export interface LastClockIn {
  location_id: string; employee_guid: string; user_id: string | null; last_in_at: string;
}

/** Aggregate first; page the much smaller result too, so roster growth cannot hide clock-ins. */
export async function lastClockIns(service: SupabaseClient, since: string, filter?: { locationId?: string; userId?: string }): Promise<LastClockIn[]> {
  try {
    return await selectAllRows<LastClockIn>((from, to) => {
      let q = service.rpc("admin_last_clock_ins", { p_since: since });
      if (filter?.locationId) q = q.eq("location_id", filter.locationId);
      if (filter?.userId) q = q.eq("user_id", filter.userId);
      return q.order("location_id").order("employee_guid").order("user_id").range(from, to);
    });
  } catch { throw new Error("admin_clock_ins_failed"); }
}

export function clockInsByUser(rows: LastClockIn[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of rows) {
    if (row.user_id && Date.parse(row.last_in_at) > Date.parse(result.get(row.user_id) ?? "0001-01-01")) {
      result.set(row.user_id, row.last_in_at);
    }
  }
  return result;
}
