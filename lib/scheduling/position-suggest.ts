/**
 * THE TOAST PRIMARY SUGGESTION — the read (Juan 2026-10-20). Server-only, service role, read-only; the caller gates.
 *
 * A person with a Toast link (the 0233 link trigger fills `toast_time_entries.user_id`) and no primary set gets a
 * SUGGESTED primary from their most-worked Toast job over the last 8 weeks (`TOAST_SUGGESTION_DAYS`, ending yesterday),
 * matched against the shop's ACTUAL position names by the pure `suggestPrimaryFromToast` (no confident match → none).
 * Only hours by job name per linked user are read: never a wage, never a name. It is a button, never saved on its own.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllRows } from "@/lib/supabase-paginate";
import { hasPositionRank, suggestPrimaryFromToast, TOAST_SUGGESTION_DAYS, type SuggestPosition, type ToastPrimarySuggestion } from "./position-rank-shared";
import type { RoleCode } from "@/lib/roles";
import { addDays } from "./time-shared";

export const TOAST_JOB_HOURS_COLUMNS = "time_entry_guid, user_id, job_name, hours";

/** Linked people's Toast hours by job name at one shop over [today − 56, today − 1]: userId → job → hours. */
export async function loadToastJobHours(service: SupabaseClient, locationId: string, today: string): Promise<Record<string, Record<string, number>>> {
  const rows = await selectAllRows<{ time_entry_guid: string; user_id: string | null; job_name: string | null; hours: number | string | null }>((from, to) => service
    .from("toast_time_entries").select(TOAST_JOB_HOURS_COLUMNS)
    .eq("location_id", locationId).eq("deleted", false).not("user_id", "is", null)
    .gte("business_date", addDays(today, -TOAST_SUGGESTION_DAYS)).lte("business_date", addDays(today, -1))
    .order("business_date", { ascending: true }).order("time_entry_guid", { ascending: true }).range(from, to));
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const job = (r.job_name ?? "").trim();
    const h = r.hours === null ? 0 : Number(r.hours);
    if (!r.user_id || job === "" || !Number.isFinite(h) || h <= 0) continue;
    const byJob = (out[r.user_id] ??= {});
    byJob[job] = Math.round(((byJob[job] ?? 0) + h) * 100) / 100;
  }
  return out;
}

/**
 * The suggestion per person who has a primary / secondary at all (not a manager) and NO primary yet; everyone else, and
 * anyone without a confident match, is absent.
 */
export function toastSuggestions(
  hours: Readonly<Record<string, Readonly<Record<string, number>>>>,
  people: ReadonlyArray<{ userId: string; role: RoleCode; coverPositions: readonly string[] }>,
  positions: readonly SuggestPosition[],
): Record<string, ToastPrimarySuggestion> {
  const out: Record<string, ToastPrimarySuggestion> = {};
  for (const p of people) {
    if (!hasPositionRank(p) || p.coverPositions.length > 0) continue;
    const s = suggestPrimaryFromToast(hours[p.userId] ?? {}, positions);
    if (s) out[p.userId] = s;
  }
  return out;
}
