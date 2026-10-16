/**
 * TEAM SCORING, PERSON DETAIL, MY PERFORMANCE — the wrappers (gate → facts → pure).
 *
 * Scheduling Phase 1, Task 11. The exports, names and shapes are unchanged; the bodies moved:
 *   - the queries into ONE fact loader, `loadPeopleFacts` (lib/people/facts.ts), verbatim;
 *   - the materialization into pure rules (lib/people/performance-shared.ts): `teamWindow`,
 *     `withPreviousScores`, `personMetrics`, and the oversight location bind.
 * A compare loads the facts ONCE over the union of its two windows and computes twice. The people
 * equivalence pin (tests/people-layer-equivalence.test.ts) proves every number is byte-identical.
 *
 * `Viewer` carries the TRUSTED role from the session (r1 P2-8), so an AGM and a social media manager
 * (both level 6) are no longer the same viewer to this module.
 */
import { reportTimestampBounds, reportRangeParams } from "@/lib/report-range";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLES, type RoleCode } from "@/lib/roles";
import { healthFromCounts } from "@/lib/team-scoring";
import { personReadNarrative, myPerformanceRead, type NarrativeLine } from "@/lib/people-narrative";
import { resolveTrendRange, clippedBucketKeys, type TrendRange, bucketStart, type TrendGranularity } from "@/lib/reports-trends";
import { canOpenPeopleViews, canViewPeople, type PeopleActor } from "@/lib/people/access-shared";
import { loadPeopleFacts } from "@/lib/people/facts";
import { LEGACY_PERSON_FAMILIES, LEGACY_TEAM_FAMILIES, unionWindow } from "@/lib/people/facts-shared";
import {
  RANKED_MAX_LEVEL, emptyTeam, personMetrics, teamWindow, withPreviousScores,
  type PeopleWindow, type PersonMetrics, type PersonSignals, type PersonStreaks, type RosterMember, type TeamOperatingHealth,
} from "@/lib/people/performance-shared";
import type { CategoryCounts, Health } from "@/lib/team-scoring";

export {
  OVERSIGHT_ACTIONS, RANKED_MAX_LEVEL, oversightInstanceId, oversightRowAtLocation,
} from "@/lib/people/performance-shared";
export type {
  OversightAuditRow, PersonMetrics, PersonSignals, PersonStreaks, TeamMember, TeamOperatingHealth,
} from "@/lib/people/performance-shared";

/** The level floor of the people views (AGM+). The ROLE rule on top of it is `canViewPeople` (R7). */
export const TEAM_VIEW_LEVEL = 6;

/** Who is looking: the verified session's user, TRUSTED role, level and shops. */
export interface Viewer { userId: string; role: RoleCode; level: number; locations?: readonly string[] | "all"; }

/** The viewer as the people rules take it ("all" or no list = no shop list; MoO+ reads every shop anyway). */
function peopleActorOf(viewer: Viewer): PeopleActor {
  return { userId: viewer.userId, role: viewer.role, level: viewer.level, locations: Array.isArray(viewer.locations) ? viewer.locations : [] };
}

/**
 * Task 13: ONE access rule for people data about others — `canViewPeople`: GM or Op-6 at their own
 * shops, MoO+ any shop, the social media manager never (by ROLE). Decided before any read.
 */
function mayViewPeople(viewer: Viewer, locationId: string): boolean {
  return viewer.level >= TEAM_VIEW_LEVEL && canViewPeople(peopleActorOf(viewer), locationId);
}

/** One trend window as the pure rules take it. */
function peopleWindow(range: { from: string; to: string }, granularity: TrendGranularity): PeopleWindow {
  return {
    bounds: reportTimestampBounds(range.from, range.to),
    dates: { from: range.from, to: range.to },
    granularity,
    keys: clippedBucketKeys(range.from, range.to, granularity),
    bucketOf: (day) => bucketStart(day, granularity),
  };
}

type TeamArgs = { viewer: Viewer; locationId: string; granularity: TrendGranularity; compare: boolean; today: string; range?: TrendRange };
export async function loadTeamOperatingHealth(service: SupabaseClient, args: TeamArgs): Promise<TeamOperatingHealth | null> {
  if (!mayViewPeople(args.viewer, args.locationId)) return null;
  const range = args.range ? resolveTrendRange(Object.fromEntries(reportRangeParams(args.range)), args.today, args.granularity) : resolveTrendRange({ compare: args.compare ? "1" : "0" }, args.today, args.granularity);
  const current = peopleWindow(range, args.granularity);
  const previous = range.compare ? peopleWindow(range.previous, args.granularity) : null;

  const roster = await loadTeamRoster(service, args.locationId);
  if (roster.length === 0) return range.compare ? withPreviousScores(emptyTeam(args.granularity), emptyTeam(args.granularity)) : emptyTeam(args.granularity);

  const facts = await loadPeopleFacts(service, {
    locationId: args.locationId,
    subject: { kind: "team", memberIds: roster.map((m) => m.userId) },
    window: previous ? unionWindow(current, previous) : current,
    families: LEGACY_TEAM_FAMILIES,
  });
  const team = teamWindow(facts, roster, current);
  return previous ? withPreviousScores(team, teamWindow(facts, roster, previous)) : team;
}

/** The roster: location-assigned, active, level < 8, in the users query's order. */
async function loadTeamRoster(service: SupabaseClient, locationId: string): Promise<RosterMember[]> {
  const { data: ulRows } = await service
    .from("user_locations").select("user_id").eq("location_id", locationId).eq("active", true);
  const userIds = [...new Set((ulRows ?? []).map((r) => (r as { user_id: string }).user_id))];
  if (userIds.length === 0) return [];
  const { data: userRows } = await service
    .from("users").select("id, name, role, active").in("id", userIds).eq("active", true);
  const roster: RosterMember[] = [];
  for (const u of (userRows ?? []) as Array<{ id: string; name: string; role: RoleCode; active: boolean }>) {
    const level = ROLES[u.role]?.level ?? 0;
    if (level >= RANKED_MAX_LEVEL) continue;
    roster.push({ userId: u.id, name: u.name, role: u.role, level });
  }
  return roster;
}

// ─────────────────────────────────────────────────────────────────────────────
// loadPersonDetail — one member's full breakdown. Score is the TRUE role-scoped
// score (same 5-category model as the roster), so the detail header matches the
// roster rank exactly. Adds per-bucket series, our-data streaks, and signals.
// ─────────────────────────────────────────────────────────────────────────────

export interface PersonDetail {
  userId: string;
  name: string;
  role: RoleCode;
  level: number;
  score: number;
  previousScore: number | null;
  counts: CategoryCounts;
  health: Health;
  reasons: string[];
  read: NarrativeLine;
  aiInsight: string | null; // ALWAYS null this cycle (reserved slot)
  bucketKeys: string[];
  contribution: (number | null)[];
  onTime: (number | null)[];
  gradientTally: { great: number; good: number; needsWork: number };
  streaks: PersonStreaks;
  signals: PersonSignals;
}

/**
 * Core per-person metric computation over a window at one location: one fact load (over the
 * union of the two windows when comparing), then the pure `personMetrics`.
 */
async function computePersonMetrics(
  service: SupabaseClient,
  args: { personId: string; role: RoleCode; createdAt: string; locationId: string; granularity: TrendGranularity; compare: boolean; today: string; range?: TrendRange },
): Promise<PersonMetrics> {
  const range = args.range ?? resolveTrendRange({ compare: args.compare ? "1" : "0" }, args.today, args.granularity);
  const current = peopleWindow(range, args.granularity);
  const previous = range.compare ? peopleWindow(range.previous, args.granularity) : null;
  const facts = await loadPeopleFacts(service, {
    locationId: args.locationId,
    subject: { kind: "person", personId: args.personId },
    window: previous ? unionWindow(current, previous) : current,
    families: LEGACY_PERSON_FAMILIES,
  });
  return personMetrics(facts, { role: args.role, createdAt: args.createdAt }, current, args.today, previous);
}

/** Shops this person can actually be opened at, intersected with the viewer's scope. */
export async function loadPersonReportLocations(service: SupabaseClient, viewer: Viewer, personId: string): Promise<string[]> {
  if (viewer.level < TEAM_VIEW_LEVEL || !canOpenPeopleViews(peopleActorOf(viewer))) return [];
  const { data: memberships, error: membershipError } = await service.from("user_locations")
    .select("location_id").eq("user_id", personId).eq("active", true);
  if (membershipError) throw new Error(membershipError.message);
  const ids = (memberships ?? []).map(row => row.location_id as string).filter(id => mayViewPeople(viewer, id));
  if (!ids.length) return [];
  const { data: locations, error } = await service.from("locations").select("id").in("id", ids).eq("active", true).order("name");
  if (error) throw new Error(error.message);
  return (locations ?? []).map(row => row.id as string);
}

export async function loadPersonDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; personId: string; locationId: string; granularity: TrendGranularity; compare: boolean; today: string; range?: TrendRange },
): Promise<PersonDetail | null> {
  if (args.range) args = { ...args, range: resolveTrendRange(Object.fromEntries(reportRangeParams(args.range)), args.today, args.granularity) };
  if (!mayViewPeople(args.viewer, args.locationId)) return null;

  // IDOR: person must be assigned to this location, active, and rankable (< MoO).
  const { data: ul } = await service
    .from("user_locations").select("user_id").eq("location_id", args.locationId).eq("user_id", args.personId).eq("active", true).maybeSingle();
  if (!ul) return null;
  const { data: u } = await service
    .from("users").select("id, name, role, active, created_at").eq("id", args.personId)
    .maybeSingle<{ id: string; name: string; role: RoleCode; active: boolean; created_at: string }>();
  if (!u || !u.active) return null;
  const level = ROLES[u.role]?.level ?? 0;
  if (level >= RANKED_MAX_LEVEL) return null;

  const m = await computePersonMetrics(service, {
    personId: u.id, role: u.role, createdAt: u.created_at,
    locationId: args.locationId, granularity: args.granularity, compare: args.compare, today: args.today, range: args.range,
  });
  const { health, reasons } = healthFromCounts(u.role, m.counts, m.score, m.previousScore);
  const read = personReadNarrative({ rank: 0, role: u.role, health, reasons, scoreDeltaPct: m.scoreDeltaPct, onTimePct: m.overallOnTime });

  return {
    userId: u.id, name: u.name, role: u.role, level,
    score: m.score, previousScore: m.previousScore, counts: m.counts, health, reasons,
    read, aiInsight: null, bucketKeys: m.bucketKeys, contribution: m.contribution, onTime: m.onTime,
    gradientTally: m.gradientTally, streaks: m.streaks, signals: m.signals,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// loadMyPerformance — the employee self-view. Own data only (personId is ALWAYS
// the session user; the loader never accepts an arbitrary id). Positive framing:
// returns score + a positive read + wins, but NO health/reasons/rank fields.
// ─────────────────────────────────────────────────────────────────────────────

export interface MyWins {
  activeDayStreak: number;
  mvpAwards: number;
  personalBest: number;
  onTimePct: number | null;
}

export interface MyPerformanceData {
  userId: string;
  name: string;
  role: RoleCode;
  score: number;
  previousScore: number | null;
  scoreDeltaPct: number | null;
  read: NarrativeLine;
  wins: MyWins;
  bucketKeys: string[];
  contribution: (number | null)[];
  onTime: (number | null)[];
  gradientTally: { great: number; good: number; needsWork: number };
  streaks: PersonStreaks;
  signals: PersonSignals;
  // NOTE: deliberately NO health / reasons / rank — this is the positive self-view.
}

export async function loadMyPerformance(
  service: SupabaseClient,
  args: { viewer: Viewer; locationId: string; granularity: TrendGranularity; compare: boolean; today: string; range?: TrendRange },
): Promise<MyPerformanceData | null> {
  if (args.range) args = { ...args, range: resolveTrendRange(Object.fromEntries(reportRangeParams(args.range)), args.today, args.granularity) };
  // SECURITY: self only — person is ALWAYS the session user, never a param.
  // IDOR: the viewer must be assigned to the location they're viewing.
  const { data: ul } = await service
    .from("user_locations").select("user_id").eq("location_id", args.locationId).eq("user_id", args.viewer.userId).eq("active", true).maybeSingle();
  if (!ul) return null;
  const { data: u } = await service
    .from("users").select("id, name, role, active, created_at").eq("id", args.viewer.userId)
    .maybeSingle<{ id: string; name: string; role: RoleCode; active: boolean; created_at: string }>();
  if (!u || !u.active) return null;

  const m = await computePersonMetrics(service, {
    personId: u.id, role: u.role, createdAt: u.created_at,
    locationId: args.locationId, granularity: args.granularity, compare: args.compare, today: args.today, range: args.range,
  });

  const read = myPerformanceRead({
    role: u.role, scoreDeltaPct: m.scoreDeltaPct, onTimePct: m.overallOnTime,
    activeDayStreak: m.streaks.activeDays, mvpAwards: m.signals.mvpAwards, gradient: m.gradientTally,
  });
  const wins: MyWins = {
    activeDayStreak: m.streaks.activeDays, mvpAwards: m.signals.mvpAwards,
    personalBest: m.streaks.personalBest, onTimePct: m.overallOnTime,
  };

  return {
    userId: u.id, name: u.name, role: u.role,
    score: m.score, previousScore: m.previousScore, scoreDeltaPct: m.scoreDeltaPct,
    read, wins, bucketKeys: m.bucketKeys, contribution: m.contribution, onTime: m.onTime,
    gradientTally: m.gradientTally, streaks: m.streaks, signals: m.signals,
  };
}
