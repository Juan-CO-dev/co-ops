import type { SupabaseClient } from "@supabase/supabase-js";

import type { RoleCode } from "@/lib/roles";
import { activeDayStreak, longestStreak, personalBest } from "@/lib/team-scoring";
import { selectAllRows } from "@/lib/supabase-paginate";

const OPERATIONAL_TZ = "America/New_York";
/** timestamptz → operational YYYY-MM-DD. */
function opDate(tstz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(tstz));
}
function addDays(yyyymmdd: string, n: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const VELOCITY_DAYS = 30;

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
}

export interface DirectoryEntry {
  userId: string;
  name: string;
  role: RoleCode;
  mvpWins: number;
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
      .in("location_id", viewerLocations).order("user_id", { ascending: true }).range(from, to),
  );
  const ids = [...new Set(ulRows.map((r) => r.user_id))];
  if (ids.length === 0) return [];
  const { data: users } = await service.from("users").select("id").in("id", ids).eq("active", true);
  return (users ?? []).map((r) => (r as { id: string }).id);
}

export async function loadProfileDirectory(
  service: SupabaseClient,
  args: { viewer: { userId: string; locations: string[] | "all" } },
): Promise<DirectoryEntry[]> {
  const ids = await viewableUserIds(service, args.viewer.locations);
  if (ids.length === 0) return [];
  const { data: users } = await service.from("users").select("id, name, role").in("id", ids);
  const userRows = (users ?? []) as Array<{ id: string; name: string; role: RoleCode }>;

  const mvpByUser = new Map<string, number>();
  const mvp = await selectAllRows<{ mvp_user_id: string | null }>(
    (from, to) => service.from("pm_reports").select("mvp_user_id")
      .in("mvp_user_id", ids).is("superseded_at", null)
      .order("mvp_user_id", { ascending: true }).range(from, to),
  );
  for (const r of mvp) if (r.mvp_user_id) mvpByUser.set(r.mvp_user_id, (mvpByUser.get(r.mvp_user_id) ?? 0) + 1);

  return userRows
    .map((u) => ({ userId: u.id, name: u.name, role: u.role, mvpWins: mvpByUser.get(u.id) ?? 0 }))
    .sort((a, b) => b.mvpWins - a.mvpWins || a.name.localeCompare(b.name));
}

export async function loadPublicProfile(
  service: SupabaseClient,
  args: { viewerUserId: string; viewerLocations: string[] | "all"; targetUserId: string; today: string },
): Promise<PublicProfile | null> {
  const { data: u } = await service
    .from("users").select("id, name, role, created_at, active").eq("id", args.targetUserId)
    .maybeSingle<{ id: string; name: string; role: RoleCode; created_at: string; active: boolean }>();
  if (!u || !u.active) return null;

  // Visibility gate: viewer shares ≥1 location with target (unless all-locations).
  const { data: tul } = await service.from("user_locations").select("location_id").eq("user_id", args.targetUserId);
  const targetLocationIds = (tul ?? []).map((r) => (r as { location_id: string }).location_id);
  if (args.viewerLocations !== "all") {
    const shared = targetLocationIds.some((l) => args.viewerLocations.includes(l));
    if (!shared) return null;
  }

  let locationCodes: string[] = [];
  if (targetLocationIds.length) {
    const { data: locs } = await service.from("locations").select("code").in("id", targetLocationIds);
    locationCodes = (locs ?? []).map((r) => (r as { code: string }).code);
  }

  const comps = await selectAllRows<{ completed_at: string }>(
    (from, to) => service.from("checklist_completions").select("completed_at")
      .eq("completed_by", args.targetUserId).is("superseded_at", null).is("revoked_at", null)
      .order("completed_at", { ascending: true }).range(from, to),
  );
  const tasksAllTime = comps.length;
  const dayCounts = new Map<string, number>();
  for (const c of comps) {
    const d = opDate(c.completed_at);
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  }
  const activeDates = [...dayCounts.keys()];
  const streaks = {
    current: activeDayStreak(activeDates, args.today),
    longest: longestStreak(activeDates),
    personalBest: personalBest([...dayCounts.values()]),
  };
  const velocity: number[] = [];
  for (let i = VELOCITY_DAYS - 1; i >= 0; i--) {
    velocity.push(dayCounts.get(addDays(args.today, -i)) ?? 0);
  }

  const { count: mvpCount } = await service
    .from("pm_reports").select("id", { count: "exact", head: true })
    .eq("mvp_user_id", args.targetUserId).is("superseded_at", null);
  const mvpWins = mvpCount ?? 0;

  const evals = await selectAllRows<{ arrived_ready: string; attitude: string; production: string; team_player: string }>(
    (from, to) => service.from("pm_employee_evals").select("arrived_ready, attitude, production, team_player")
      .eq("employee_id", args.targetUserId).is("superseded_at", null)
      .order("pm_report_id", { ascending: true }).range(from, to),
  );
  let great = 0, good = 0; // needsWork intentionally not tracked/returned
  for (const e of evals) {
    for (const g of [e.arrived_ready, e.attitude, e.production, e.team_player]) {
      if (g === "great") great++; else if (g === "good") good++;
    }
  }

  const tenureDays = Math.max(0, Math.round((Date.parse(`${args.today}T00:00:00Z`) - Date.parse(u.created_at)) / 86400000));

  return {
    userId: u.id, name: u.name, role: u.role, locationCodes, tenureDays,
    mvpWins, tasksAllTime, gradient: { great, good }, streaks, velocity,
  };
}
