import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLES, type RoleCode } from "@/lib/roles";
import {
  type ActionCategory, type CategoryCounts, emptyCounts,
  scoreFromCounts, healthFromCounts, type Health,
} from "@/lib/team-scoring";
import { personCardLine, teamBannerNarrative, type NarrativeLine } from "@/lib/people-narrative";
import { computeWindows, bucketStart, type TrendGranularity } from "@/lib/reports-trends";

export const TEAM_VIEW_LEVEL = 6; // AGM+
export const RANKED_MAX_LEVEL = 8; // roster excludes level >= 8 (MoO+)

export const OVERSIGHT_ACTIONS = [
  "checklist_completion.revoke",
  "checklist_completion.revoke_by_authority",
  "checklist_completion.tag_actual_completer",
  "report.update",
  "report.drop",
];

const OPERATIONAL_TZ = "America/New_York";
/** timestamptz → operational YYYY-MM-DD (matches the rest of the app's bucketing). */
function opDate(tstz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(tstz));
}

export interface Viewer { userId: string; level: number; }

export interface TeamMember {
  userId: string;
  name: string;
  role: RoleCode;
  level: number;
  score: number;
  previousScore: number | null;
  counts: CategoryCounts;
  health: Health;
  reasons: string[];
  sparkline: number[];
  cardLine: NarrativeLine;
}

export interface TeamOperatingHealth {
  granularity: TrendGranularity;
  members: TeamMember[];
  summary: { onTrack: number; needsAttention: number };
  banner: NarrativeLine;
}

interface MemberAcc {
  current: CategoryCounts;
  previous: CategoryCounts;
  byBucketScoreActions: Map<string, number>;
}

export async function loadTeamOperatingHealth(
  service: SupabaseClient,
  args: { viewer: Viewer; locationId: string; granularity: TrendGranularity; compare: boolean; today: string },
): Promise<TeamOperatingHealth | null> {
  if (args.viewer.level < TEAM_VIEW_LEVEL) return null;

  const { currentKeys, previousKeys, loadFrom } = computeWindows(args.today, args.granularity, args.compare);
  const curSet = new Set(currentKeys);
  const prevSet = new Set(previousKeys ?? []);
  const loadToInclusive = args.today;

  const emptyResult = (): TeamOperatingHealth => ({
    granularity: args.granularity, members: [], summary: { onTrack: 0, needsAttention: 0 },
    banner: teamBannerNarrative({ onTrack: 0, needsAttention: 0, attentionNames: [] }),
  });

  // ── Roster: location-assigned, active, level < 8 ──
  const { data: ulRows } = await service
    .from("user_locations").select("user_id").eq("location_id", args.locationId);
  const userIds = [...new Set((ulRows ?? []).map((r) => (r as { user_id: string }).user_id))];
  if (userIds.length === 0) return emptyResult();

  const { data: userRows } = await service
    .from("users").select("id, name, role, active").in("id", userIds).eq("active", true);
  const members = new Map<string, { name: string; role: RoleCode; level: number; acc: MemberAcc }>();
  for (const u of (userRows ?? []) as Array<{ id: string; name: string; role: RoleCode; active: boolean }>) {
    const level = ROLES[u.role]?.level ?? 0;
    if (level >= RANKED_MAX_LEVEL) continue;
    members.set(u.id, { name: u.name, role: u.role, level, acc: { current: emptyCounts(), previous: emptyCounts(), byBucketScoreActions: new Map() } });
  }
  if (members.size === 0) return emptyResult();
  const memberIds = [...members.keys()];

  const place = (uid: string, tstz: string, category: ActionCategory) => {
    const m = members.get(uid);
    if (!m) return;
    const bs = bucketStart(opDate(tstz), args.granularity);
    if (curSet.has(bs)) {
      m.acc.current[category]++;
      m.acc.byBucketScoreActions.set(bs, (m.acc.byBucketScoreActions.get(bs) ?? 0) + scoreRelevant(m.role, category));
    } else if (prevSet.has(bs)) {
      m.acc.previous[category]++;
    }
  };

  // location instance ids (for completion attribution + finalizations)
  const { data: instRows } = await service
    .from("checklist_instances").select("id, confirmed_by, confirmed_at").eq("location_id", args.locationId);
  const locInstanceIds = new Set((instRows ?? []).map((r) => (r as { id: string }).id));

  // 1. TASKS + NOTES (completions: completed_at in span, live, instance at location)
  if (locInstanceIds.size) {
    const { data: comps } = await service
      .from("checklist_completions")
      .select("instance_id, completed_by, completed_at, notes")
      .in("instance_id", [...locInstanceIds])
      .gte("completed_at", `${loadFrom}T00:00:00Z`).lte("completed_at", `${loadToInclusive}T23:59:59Z`)
      .is("superseded_at", null).is("revoked_at", null);
    for (const c of (comps ?? []) as Array<{ completed_by: string | null; completed_at: string; notes: string | null }>) {
      if (!c.completed_by) continue;
      place(c.completed_by, c.completed_at, "tasks");
      if (c.notes && c.notes.trim()) place(c.completed_by, c.completed_at, "notes");
    }
  }

  // 2. FINALIZATIONS
  for (const i of (instRows ?? []) as Array<{ confirmed_by: string | null; confirmed_at: string | null }>) {
    if (i.confirmed_by && i.confirmed_at) place(i.confirmed_by, i.confirmed_at, "finalizations");
  }
  const { data: cashRows } = await service
    .from("cash_reports").select("signed_by, signed_at, over_short_note")
    .eq("location_id", args.locationId).is("superseded_at", null)
    .gte("signed_at", `${loadFrom}T00:00:00Z`).lte("signed_at", `${loadToInclusive}T23:59:59Z`);
  for (const c of (cashRows ?? []) as Array<{ signed_by: string | null; signed_at: string | null; over_short_note: string | null }>) {
    if (c.signed_by && c.signed_at) {
      place(c.signed_by, c.signed_at, "finalizations");
      if (c.over_short_note && c.over_short_note.trim()) place(c.signed_by, c.signed_at, "notes");
    }
  }
  const { data: pmRows } = await service
    .from("pm_reports").select("id, submitted_by, submitted_at")
    .eq("location_id", args.locationId).is("superseded_at", null)
    .gte("submitted_at", `${loadFrom}T00:00:00Z`).lte("submitted_at", `${loadToInclusive}T23:59:59Z`);
  for (const r of (pmRows ?? []) as Array<{ submitted_by: string | null; submitted_at: string | null }>) {
    if (r.submitted_by && r.submitted_at) {
      place(r.submitted_by, r.submitted_at, "finalizations");
      place(r.submitted_by, r.submitted_at, "peopleMgmt");
    }
  }

  // 3. NOTES from pm evals (authored by report submitter)
  const pmReportById = new Map((pmRows ?? []).map((r) => {
    const row = r as { id: string; submitted_by: string | null; submitted_at: string | null };
    return [row.id, row] as const;
  }));
  if (pmReportById.size) {
    const { data: evalRows } = await service
      .from("pm_employee_evals").select("pm_report_id, area_to_improve, note")
      .in("pm_report_id", [...pmReportById.keys()]).is("superseded_at", null);
    for (const e of (evalRows ?? []) as Array<{ pm_report_id: string; area_to_improve: string | null; note: string | null }>) {
      const rep = pmReportById.get(e.pm_report_id);
      if (rep?.submitted_by && rep.submitted_at && ((e.area_to_improve && e.area_to_improve.trim()) || (e.note && e.note.trim()))) {
        place(rep.submitted_by, rep.submitted_at, "notes");
      }
    }
  }

  // 4. OVERSIGHT (audit_log by actor_id — window-global)
  const { data: auditRows } = await service
    .from("audit_log").select("actor_id, action, occurred_at")
    .in("actor_id", memberIds).in("action", OVERSIGHT_ACTIONS)
    .gte("occurred_at", `${loadFrom}T00:00:00Z`).lte("occurred_at", `${loadToInclusive}T23:59:59Z`);
  for (const a of (auditRows ?? []) as Array<{ actor_id: string | null; occurred_at: string }>) {
    if (a.actor_id) place(a.actor_id, a.occurred_at, "oversight");
  }

  // ── materialize ──
  const out: TeamMember[] = [];
  let onTrack = 0, needsAttention = 0;
  const attentionNames: string[] = [];
  for (const [uid, m] of members) {
    const score = scoreFromCounts(m.role, m.acc.current);
    const previousScore = args.compare ? scoreFromCounts(m.role, m.acc.previous) : null;
    const { health, reasons } = healthFromCounts(m.role, m.acc.current, score, previousScore);
    const sparkline = currentKeys.map((k) => m.acc.byBucketScoreActions.get(k) ?? 0);
    const scoreDeltaPct = previousScore && previousScore > 0 ? Math.round(((score - previousScore) / previousScore) * 100) : null;
    if (health === "needs_attention") { needsAttention++; attentionNames.push(m.name); } else onTrack++;
    out.push({
      userId: uid, name: m.name, role: m.role, level: m.level,
      score, previousScore, counts: m.acc.current, health, reasons, sparkline,
      cardLine: personCardLine({ rank: 0, role: m.role, health, reasons, scoreDeltaPct, onTimePct: null }),
    });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    granularity: args.granularity,
    members: out,
    summary: { onTrack, needsAttention },
    banner: teamBannerNarrative({ onTrack, needsAttention, attentionNames: attentionNames.slice(0, 3) }),
  };
}

/** 1 when the category is expected for the role (counts toward score/sparkline), else 0. */
function scoreRelevant(role: RoleCode, category: ActionCategory): number {
  return scoreFromCounts(role, { ...emptyCounts(), [category]: 1 }) > 0 ? 1 : 0;
}
