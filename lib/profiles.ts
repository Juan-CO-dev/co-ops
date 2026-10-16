/**
 * THE PUBLIC PROFILE AND THE DIRECTORY.
 *
 * Scheduling Phase 1, Task 12: the card's numbers come from the ONE people layer — the company-wide
 * facts through `loadProfileFacts` (lib/people/facts.ts) and the pure `publicProfileNumbers`
 * (lib/people/performance-shared.ts). The visibility gate (a shared shop, or "all"), the leadership
 * contact rule and the blurb rule stay HERE, in the wrapper. The directory keeps its two queries.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLES, type RoleCode } from "@/lib/roles";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadProfileFacts } from "@/lib/people/facts";
import { publicProfileNumbers } from "@/lib/people/performance-shared";

export interface PublicProfile {
  userId: string;
  name: string;
  role: RoleCode;
  locationCodes: string[];
  tenureDays: number;
  mvpWins: number;
  tasksAllTime: number;
  /** Positive ratings only — needs-work is computed but deliberately NOT returned. */
  gradient: { great: number; good: number };
  streaks: { current: number; longest: number; personalBest: number };
  /** Recent daily task counts, oldest→newest, length VELOCITY_DAYS. */
  velocity: number[];
  cardKind: "staff" | "leadership";
  contact?: { email: string | null; phone: string | null };
  locationScope?: "all" | string[];
  /** AGM+ "about me" blurb. Null unless the OWNER is level >= 6 (gated at the loader). */
  blurb: string | null;
}

export interface DirectoryEntry {
  userId: string;
  name: string;
  role: RoleCode;
  mvpWins: number;
}

export interface LeadershipDirectoryEntry {
  userId: string;
  name: string;
  role: RoleCode;
}

export interface ProfileDirectoryResult {
  staff: DirectoryEntry[];
  leadership: LeadershipDirectoryEntry[];
}

/** Active user ids the viewer may see: shares ≥1 location, or all (viewerLocations === "all"). */
async function viewableUserIds(
  service: SupabaseClient,
  viewerLocations: string[] | "all",
): Promise<string[]> {
  if (viewerLocations === "all") {
    const { data } = await service.from("users").select("id").eq("active", true);
    return (data ?? []).map((r) => (r as { id: string }).id);
  }
  if (viewerLocations.length === 0) return [];
  const ulRows = await selectAllRows<{ user_id: string }>(
    (from, to) => service.from("user_locations").select("user_id")
      .in("location_id", viewerLocations).eq("active", true).order("user_id", { ascending: true }).range(from, to),
  );
  const ids = [...new Set(ulRows.map((r) => r.user_id))];
  if (ids.length === 0) return [];
  const { data: users } = await service.from("users").select("id").in("id", ids).eq("active", true);
  return (users ?? []).map((r) => (r as { id: string }).id);
}

export async function loadProfileDirectory(
  service: SupabaseClient,
  args: { viewer: { userId: string; locations: string[] | "all" } },
): Promise<ProfileDirectoryResult> {
  // Staff: shared-location, active, excluding leadership (level >= 8). May be empty
  // (no viewable ids) — leadership is location-independent and still computed below.
  const ids = await viewableUserIds(service, args.viewer.locations);
  let staff: DirectoryEntry[] = [];
  if (ids.length > 0) {
    const { data: users } = await service.from("users").select("id, name, role").in("id", ids);
    const userRows = (users ?? []) as Array<{ id: string; name: string; role: RoleCode }>;

    const mvpByUser = new Map<string, number>();
    const mvp = await selectAllRows<{ mvp_user_id: string | null }>(
      (from, to) => service.from("pm_reports").select("mvp_user_id")
        .in("mvp_user_id", ids).is("superseded_at", null)
        .order("mvp_user_id", { ascending: true }).range(from, to),
    );
    for (const r of mvp) if (r.mvp_user_id) mvpByUser.set(r.mvp_user_id, (mvpByUser.get(r.mvp_user_id) ?? 0) + 1);

    staff = userRows
      .filter((u) => (ROLES[u.role]?.level ?? 0) < 8)
      .map((u) => ({ userId: u.id, name: u.name, role: u.role, mvpWins: mvpByUser.get(u.id) ?? 0 }))
      .sort((a, b) => b.mvpWins - a.mvpWins || a.name.localeCompare(b.name));
  }

  // Leadership: all active leadership-role users company-wide (location-independent).
  const LEADERSHIP_ROLES = (Object.keys(ROLES) as RoleCode[]).filter((r) => (ROLES[r]?.level ?? 0) >= 8);
  const { data: leaders } = await service.from("users").select("id, name, role").eq("active", true).in("role", LEADERSHIP_ROLES);
  const leadership: LeadershipDirectoryEntry[] = ((leaders ?? []) as Array<{ id: string; name: string; role: RoleCode }>)
    .map((u) => ({ userId: u.id, name: u.name, role: u.role }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { staff, leadership };
}

export async function loadPublicProfile(
  service: SupabaseClient,
  args: { viewerUserId: string; viewerLocations: string[] | "all"; targetUserId: string; today: string },
): Promise<PublicProfile | null> {
  const { data: u } = await service
    .from("users").select("id, name, role, created_at, active, email, phone, profile_blurb").eq("id", args.targetUserId)
    .maybeSingle<{ id: string; name: string; role: RoleCode; created_at: string; active: boolean; email: string | null; phone: string | null; profile_blurb: string | null }>();
  if (!u || !u.active) return null;

  const level = ROLES[u.role]?.level ?? 0;
  const cardKind: "staff" | "leadership" = level >= 8 ? "leadership" : "staff";

  // Visibility gate: viewer shares ≥1 location with target (unless all-locations).
  const { data: tul } = await service.from("user_locations").select("location_id").eq("user_id", args.targetUserId).eq("active", true);
  const targetLocationIds = (tul ?? []).map((r) => (r as { location_id: string }).location_id);
  if (cardKind === "staff" && args.viewerLocations !== "all") {
    const shared = targetLocationIds.some((l) => args.viewerLocations.includes(l));
    if (!shared) return null;
  }

  let locationCodes: string[] = [];
  if (targetLocationIds.length) {
    const { data: locs } = await service.from("locations").select("code").in("id", targetLocationIds);
    locationCodes = (locs ?? []).map((r) => (r as { code: string }).code);
  }

  const contact = cardKind === "leadership" ? { email: u.email ?? null, phone: u.phone ?? null } : undefined;
  const locationScope: "all" | string[] | undefined =
    cardKind === "leadership" ? (level >= 9 || targetLocationIds.length === 0 ? "all" : locationCodes) : undefined;

  const { tenureDays, mvpWins, tasksAllTime, gradient, streaks, velocity } = publicProfileNumbers(
    await loadProfileFacts(service, args.targetUserId), { createdAt: u.created_at, today: args.today },
  );

  return {
    userId: u.id, name: u.name, role: u.role, locationCodes, tenureDays,
    mvpWins, tasksAllTime, gradient, streaks, velocity,
    cardKind, contact, locationScope,
    blurb: level >= 6 ? (u.profile_blurb ?? null) : null,
  };
}
