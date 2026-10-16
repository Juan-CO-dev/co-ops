/**
 * Scheduling Phase 1 — THE PEOPLE-LAYER EQUIVALENCE PIN's engine (plan Task 1, Step 2).
 *
 * One function computes every people number a screen or an export shows today, through a small
 * PeopleApi, so the SAME computation runs over today's loaders (Task 1 froze the golden with
 * them) and over the refactored ones (Tasks 11–13 keep the export names; Task 23 adds inputs
 * behind a per-shop switch that is OFF here).
 *
 * Every viewer object ALREADY carries its trusted `role` — a field today's loaders ignore — so
 * Task 11 making `role` required is a type change, never a golden change. The social media
 * manager is deliberately NOT a viewer here: its refusal is a deliberate change (Task 13),
 * pinned separately.
 *
 * Calls (today = TODAY):
 *   · loadTeamOperatingHealth — each viewer × both shops × day|week|month × compare on/off, plus
 *     an explicit custom range (with and without compare);
 *   · loadPersonDetail — every person × both shops × compare on/off (MoO viewer, day + week),
 *     plus the AGM and GM viewers at both shops (their gates);
 *   · loadMyPerformance — every person × both shops (the person is the viewer);
 *   · loadPersonReportLocations — each viewer × every person;
 *   · loadPublicProfile — every person from a one-shop viewer at each shop and an "all" viewer;
 *   · loadProfileDirectory — one-shop viewers, an "all" viewer and a viewer with no shop;
 *   · loadMyFeedback — every person;
 *   · the export's TEAM section — report-export's exact call (loadTeamOperatingHealth with the
 *     export's arguments, then the pure `teamRows`), since the builder is not exported.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMyPerformance, loadPersonDetail, loadPersonReportLocations, loadTeamOperatingHealth } from "@/lib/team-metrics";
import { loadProfileDirectory, loadPublicProfile } from "@/lib/profiles";
import { loadMyFeedback } from "@/lib/pm-report";
import { teamRows, type ShopRef } from "@/lib/report-export-shared";
import { resolveTrendRange, type TrendGranularity } from "@/lib/reports-trends";
import type { RoleCode } from "@/lib/roles";
import { ALL_USERS, LOC_A, LOC_B, TODAY, U, type Tables } from "./people-layer-fixture";

/** The loader surface the pin exercises. Task 1: today's functions. */
export interface PeopleApi {
  loadTeamOperatingHealth: typeof loadTeamOperatingHealth;
  loadPersonDetail: typeof loadPersonDetail;
  loadMyPerformance: typeof loadMyPerformance;
  loadPersonReportLocations: typeof loadPersonReportLocations;
  loadPublicProfile: typeof loadPublicProfile;
  loadProfileDirectory: typeof loadProfileDirectory;
  loadMyFeedback: typeof loadMyFeedback;
}

export const liveApi: PeopleApi = {
  loadTeamOperatingHealth, loadPersonDetail, loadMyPerformance, loadPersonReportLocations,
  loadPublicProfile, loadProfileDirectory, loadMyFeedback,
};

/** A viewer as a session would build it: id, TRUSTED role, level, shops. */
interface HarnessViewer { userId: string; role: RoleCode; level: number; locations: string[] }

export const VIEWERS: Record<"agm" | "gm" | "moo", HarnessViewer> = {
  agm: { userId: U.agm, role: "agm", level: 6, locations: [LOC_A] },
  gm: { userId: U.gm, role: "gm", level: 7, locations: [LOC_A] },
  moo: { userId: U.moo, role: "moo", level: 8, locations: [LOC_A, LOC_B] },
};

const LEVEL: Record<string, number> = {
  employee: 3, trainer: 4, key_holder: 4, shift_lead: 5, agm: 6, social_media_mgr: 6, gm: 7, moo: 8, owner: 9,
};

export type PeopleOutputs = Record<string, unknown>;

/** JSON round trip: the golden is JSON, so `undefined` fields compare as absent, as stored. */
const plain = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

export async function computePeopleOutputs(api: PeopleApi, fixture: Tables, service: SupabaseClient): Promise<PeopleOutputs> {
  const out: PeopleOutputs = {};
  const users = new Map(fixture.users!.map((u) => [u.id as string, u]));
  const shops = [LOC_A, LOC_B] as const;
  const grains: TrendGranularity[] = ["day", "week", "month"];
  const shopRef = (id: string): ShopRef => {
    const l = fixture.locations!.find((x) => x.id === id)!;
    return { id, code: l.code as string, name: l.name as string };
  };

  // ── team scoring ──
  for (const [vName, viewer] of Object.entries(VIEWERS)) {
    for (const loc of shops) {
      for (const g of grains) {
        for (const compare of [false, true]) {
          out[`team|${vName}|${loc}|${g}|cmp=${compare}`] = plain(await api.loadTeamOperatingHealth(service, { viewer, locationId: loc, granularity: g, compare, today: TODAY }));
        }
      }
      for (const compare of [false, true]) {
        const range = resolveTrendRange({ range: "custom", from: "2026-09-14", to: "2026-10-03", compare: compare ? "1" : "0" }, TODAY, "week");
        out[`team|${vName}|${loc}|custom|cmp=${compare}`] = plain(await api.loadTeamOperatingHealth(service, { viewer, locationId: loc, granularity: "week", compare, today: TODAY, range }));
      }
    }
  }

  // ── person detail ──
  for (const personId of ALL_USERS) {
    for (const loc of shops) {
      for (const g of ["day", "week"] as const) {
        for (const compare of [false, true]) {
          out[`detail|moo|${personId}|${loc}|${g}|cmp=${compare}`] = plain(await api.loadPersonDetail(service, { viewer: VIEWERS.moo, personId, locationId: loc, granularity: g, compare, today: TODAY }));
        }
      }
      for (const vName of ["agm", "gm"] as const) {
        out[`detail|${vName}|${personId}|${loc}|week|cmp=true`] = plain(await api.loadPersonDetail(service, { viewer: VIEWERS[vName], personId, locationId: loc, granularity: "week", compare: true, today: TODAY }));
      }
    }
    const range = resolveTrendRange({ range: "custom", from: "2026-09-01", to: "2026-09-30", compare: "1" }, TODAY, "day");
    out[`detail|moo|${personId}|${LOC_A}|custom`] = plain(await api.loadPersonDetail(service, { viewer: VIEWERS.moo, personId, locationId: LOC_A, granularity: "day", compare: true, today: TODAY, range }));
  }

  // ── My Performance (self) ──
  for (const personId of ALL_USERS) {
    const u = users.get(personId)!;
    const role = u.role as RoleCode;
    const self = { userId: personId, role, level: LEVEL[role] ?? 0, locations: [LOC_A, LOC_B] };
    for (const loc of shops) {
      for (const compare of [false, true]) {
        out[`mine|${personId}|${loc}|week|cmp=${compare}`] = plain(await api.loadMyPerformance(service, { viewer: self, locationId: loc, granularity: "week", compare, today: TODAY }));
      }
      out[`mine|${personId}|${loc}|month|cmp=true`] = plain(await api.loadMyPerformance(service, { viewer: self, locationId: loc, granularity: "month", compare: true, today: TODAY }));
    }
  }

  // ── person report locations ──
  for (const [vName, viewer] of Object.entries(VIEWERS)) {
    for (const personId of ALL_USERS) {
      out[`reportLocations|${vName}|${personId}`] = plain(await api.loadPersonReportLocations(service, viewer, personId));
    }
  }

  // ── public profile ──
  const profileViewers: Array<[string, string, string[] | "all"]> = [
    ["oneShopA", U.emp, [LOC_A]],
    ["oneShopB", U.empB, [LOC_B]],
    ["all", U.moo, "all"],
  ];
  for (const [vName, viewerUserId, viewerLocations] of profileViewers) {
    for (const targetUserId of ALL_USERS) {
      out[`profile|${vName}|${targetUserId}`] = plain(await api.loadPublicProfile(service, { viewerUserId, viewerLocations, targetUserId, today: TODAY }));
    }
  }

  // ── directory ──
  const directoryViewers: Array<[string, string, string[] | "all"]> = [
    ["oneShopA", U.emp, [LOC_A]], ["oneShopB", U.empB, [LOC_B]], ["all", U.moo, "all"], ["none", U.owner, []],
  ];
  for (const [vName, userId, locations] of directoryViewers) {
    out[`directory|${vName}`] = plain(await api.loadProfileDirectory(service, { viewer: { userId, locations } }));
  }

  // ── my feedback ──
  for (const userId of ALL_USERS) {
    out[`myFeedback|${userId}`] = plain(await api.loadMyFeedback(service, { userId }));
  }

  // ── the export's team section (lib/report-export.ts case "team", verbatim arguments) ──
  const exportParams: Array<[string, Record<string, string | undefined>]> = [
    ["week-default", { g: "week" }],
    ["day-last30", { g: "day", range: "last30" }],
    ["month-custom", { g: "month", range: "custom", from: "2026-08-10", to: "2026-10-10" }],
  ];
  for (const [vName, viewer] of [["gm", VIEWERS.gm], ["moo", VIEWERS.moo]] as const) {
    for (const loc of shops) {
      for (const [pName, params] of exportParams) {
        const g = (params.g === "day" || params.g === "month" ? params.g : "week") as TrendGranularity;
        const trendRange = resolveTrendRange(params, TODAY, g);
        const team = await api.loadTeamOperatingHealth(service, { viewer, locationId: loc, granularity: g, compare: false, today: TODAY, range: { ...trendRange, compare: false } });
        out[`export.team|${vName}|${loc}|${pName}`] = plain(team ? { from: trendRange.from, to: trendRange.to, rows: teamRows(team, shopRef(loc), trendRange) } : null);
      }
    }
  }

  return out;
}
