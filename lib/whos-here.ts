/**
 * Who's actually here — SERVER-ONLY presence facts for one shop/day (0233). The pure rule lives in
 * lib/presence-shared.ts; this module only READS (service role) the facts it needs:
 *   - toast_time_entries (linked user_id, not deleted) on the station day and the ET day,
 *   - shift_ends (each person's last "End my shift", the shop's close marker),
 *   - sessions active today, counted as "signed in at this shop" ONLY for single-shop members
 *     (a session carries no shop; a multi-shop manager is placed by a station or a task instead).
 * Gated by WHOS_HERE=1 so the app can deploy before 0233 is applied.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { operationalDayUtcRange } from "@/lib/operational-day";
import { selectAllRows } from "@/lib/supabase-paginate";

export function whosHereEnabled(): boolean {
  return process.env.WHOS_HERE === "1";
}

export interface PresenceFacts {
  toast: Map<string, Array<{ inAt: string; outAt: string | null }>>;
  /** Each person's last End my shift (also their departure for the board's "Left open" trail). */
  endedAt: Map<string, string>;
  shopClosedAt: string | null;
}

const later = (a: string | undefined, b: string) => (!a || Date.parse(b) > Date.parse(a) ? b : a);

export async function loadPresenceFacts(service: SupabaseClient, args: {
  locationId: string; stationDate: string; date: string; now?: Date;
}): Promise<PresenceFacts> {
  const days = [...new Set([args.stationDate, args.date])];
  const now = (args.now ?? new Date()).getTime();
  const entries = await selectAllRows<{ user_id: string; in_at: string; out_at: string | null }>((from, to) =>
    service.from("toast_time_entries").select("user_id,in_at,out_at").eq("location_id", args.locationId)
      .in("business_date", days).eq("deleted", false).not("user_id", "is", null)
      .order("in_at").order("time_entry_guid").range(from, to));
  const toast = new Map<string, Array<{ inAt: string; outAt: string | null }>>();
  // A future-dated entry is not evidence yet (0230's station_clocked_out ignores it too).
  for (const e of entries) if (Date.parse(e.in_at) <= now) toast.set(e.user_id, [...(toast.get(e.user_id) ?? []), { inAt: e.in_at, outAt: e.out_at }]);

  const ends = await selectAllRows<{ user_id: string | null; kind: string; at: string }>((from, to) =>
    service.from("shift_ends").select("user_id,kind,at").eq("location_id", args.locationId)
      .in("business_date", days).order("sequence").range(from, to));
  const endedAt = new Map<string, string>();
  let shopClosedAt: string | null = null;
  for (const e of ends) {
    if (e.kind === "shop_closed") shopClosedAt = later(shopClosedAt ?? undefined, e.at);
    else if (e.kind === "ended_shift" && e.user_id) endedAt.set(e.user_id, later(endedAt.get(e.user_id), e.at));
  }

  return { toast, endedAt, shopClosedAt };
}

/** Sign-ins whose activity reached today, for single-shop members of THIS shop only. */
export async function loadSignedInAt(service: SupabaseClient, args: {
  locationId: string; stationDate: string; date: string; userIds: readonly string[];
}): Promise<Map<string, string>> {
  const days = [...new Set([args.stationDate, args.date])];
  const signedInAt = new Map<string, string>();
  const ids = [...new Set(args.userIds)];
  if (ids.length > 0) {
    const memberships: Array<{ user_id: string; location_id: string }> = [];
    for (let i = 0; i < ids.length; i += 100) {
      const r = await service.from("user_locations").select("user_id,location_id").eq("active", true).in("user_id", ids.slice(i, i + 100));
      if (r.error) throw new Error("presence: memberships read failed");
      memberships.push(...(r.data ?? []));
    }
    const shops = new Map<string, Set<string>>();
    for (const m of memberships) shops.set(m.user_id, (shops.get(m.user_id) ?? new Set()).add(m.location_id));
    const single = ids.filter((id) => { const s = shops.get(id); return !!s && s.size === 1 && s.has(args.locationId); });
    const dayStart = operationalDayUtcRange([...days].sort()[0]!).startIso;
    for (let i = 0; i < single.length; i += 100) {
      const r = await service.from("sessions").select("user_id,created_at").in("user_id", single.slice(i, i + 100))
        .gte("last_activity_at", dayStart);
      if (r.error) throw new Error("presence: sessions read failed");
      for (const s of (r.data ?? []) as Array<{ user_id: string; created_at: string | null }>) {
        if (s.created_at) signedInAt.set(s.user_id, later(signedInAt.get(s.user_id), s.created_at));
      }
    }
  }
  return signedInAt;
}
