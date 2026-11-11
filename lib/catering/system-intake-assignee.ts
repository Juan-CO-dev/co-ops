import type { getServiceRoleClient } from "@/lib/supabase-server";

/**
 * A1.3: the active catering manager scoped to the lead's location, else any active one,
 * else null. Two-query form — no embed: `user_locations` carries THREE FKs
 * (`user_locations_user_id_fkey`, `user_locations_assigned_by_fkey`,
 * `user_locations_location_id_fkey`), two of them to `users`, so a bare `users!inner`
 * embed fails PGRST201 (PostgREST cannot pick which FK to join on). In prod there is
 * currently NO active catering_mgr, so this resolving to null is the expected live
 * outcome today — leads land unassigned until Keith's account exists (Task 4 errand).
 *
 * Honesty (I3/M2/M3): a query error returns null (unassigned) — it NEVER falls through
 * to the broader lookup, because a DB error is not "no scoped manager found". Bounded
 * order: (1) every active catering_mgr, small set, ordered by creation; if none, null.
 * (2) which of them are scoped to this location; first match in (1)'s creation order.
 * (3) else the first from (1) — the spec'd (A1.3) cross-location fallback, deliberately
 * reached ONLY when the scoped lookup returned zero rows without error.
 */
export async function resolveCateringManager(sb: ReturnType<typeof getServiceRoleClient>, locationId: string | null, signal: AbortSignal = new AbortController().signal): Promise<string | null> {
  const { data: activeMgrs, error: mgrErr } = await sb.from("users").select("id")
    .eq("role", "catering_mgr").eq("active", true)
    .order("created_at", { ascending: true }).returns<Array<{ id: string }>>().abortSignal(signal);
  if (mgrErr) return null;
  if (!activeMgrs || activeMgrs.length === 0) return null;

  if (locationId === null) return activeMgrs[0]?.id ?? null;

  const mgrIds = activeMgrs.map((m) => m.id);
  const { data: scoped, error: scopedErr } = await sb.from("user_locations")
    .select("user_id").eq("location_id", locationId).eq("active", true)
    .in("user_id", mgrIds).returns<Array<{ user_id: string }>>().abortSignal(signal);
  if (scopedErr) return null;
  if (scoped && scoped.length > 0) {
    const scopedIds = new Set(scoped.map((r) => r.user_id));
    const first = activeMgrs.find((m) => scopedIds.has(m.id));
    if (first) return first.id;
  }

  // Deliberate cross-location fallback (spec A1.3) — reached only because the scoped
  // lookup above returned zero rows, not because it errored.
  return activeMgrs[0]?.id ?? null;
}

