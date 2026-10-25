/**
 * THE SCHEDULING RPC CONTRACT — every definer writer's NAME and its exact NAMED ARGUMENTS (Scheduling Phase 2,
 * Tasks 13–14; plan "Harness execution contract", r2 P3-13).
 *
 * The lib builds every `service.rpc(name, args)` call from these builders, and the PGlite harnesses
 * (scripts/sql-harness-0274.mjs, scripts/sql-harness-0275.mjs) import THIS file and call the real migrations with
 * the same objects (`select public.<name>(p_x => …, …)` as service_role). A renamed argument on either side breaks
 * the harness, never production. Pure and dependency-free: erasable TypeScript only (no enums, no namespaces, no
 * path aliases), so Node imports it directly.
 */
import type { UsualShift } from "./usual-shift-shared";
import type { PersonAvailability } from "./availability-shared";
import type { RuleContext } from "./context-shared";
import type { DayRecord, DeclaredGap, Shift } from "./rules-shared";

export const SCHEDULE_RPC = {
  saveShopSettings: "save_schedule_shop_settings",
  saveStructure: "save_schedule_structure",
  recordPersonSettings: "record_schedule_person_settings",
  // 0278 (Astra BC-007): the expected head and the changed-field merge INSIDE the per-person lock.
  savePersonSettings: "save_schedule_person_settings",
  mergePersonPositions: "merge_schedule_person_positions",
  recordBudgetEntry: "record_schedule_budget_entry",
  recordDayType: "record_schedule_day_type",
  recordPin: "record_schedule_pin",
  commitRevision: "commit_schedule_revision",
  approveWeek: "approve_schedule_week",
} as const;
export type ScheduleRpcName = (typeof SCHEDULE_RPC)[keyof typeof SCHEDULE_RPC];

export interface RpcCall<A extends Record<string, unknown>> { fn: ScheduleRpcName; args: A }

// ─── 0274 ────────────────────────────────────────────────────────────────────

export function saveShopSettingsCall(i: {
  actorId: string; locationId: string; enabled: boolean;
  estimatedHourlyCents: number | null; estimatedSalariedWeeklyCents: number | null; agmAccess: "read" | "edit";
}) {
  return {
    fn: SCHEDULE_RPC.saveShopSettings,
    args: {
      p_actor: i.actorId, p_location: i.locationId, p_enabled: i.enabled,
      p_estimated_hourly_cents: i.estimatedHourlyCents, p_estimated_salaried_weekly_cents: i.estimatedSalariedWeeklyCents,
      p_agm_access: i.agmAccess,
    },
  } as const;
}

export function saveStructureCall(i: { actorId: string; locationId: string; expectedId: string | null; structure: unknown }) {
  return { fn: SCHEDULE_RPC.saveStructure, args: { p_actor: i.actorId, p_location: i.locationId, p_expected: i.expectedId, p_structure: i.structure } } as const;
}

export function recordPersonSettingsCall(i: {
  actorId: string; locationId: string; userId: string;
  workType: "boh" | "foh" | "management" | null; alsoAllowed: Array<"boh" | "foh">; leaderSetting: "opens" | "closes" | "mix" | null;
  coverPositions: string[]; softMinH: number | null; softMaxH: number | null; fullTime: boolean; fullTimeMinH: number | null;
  /** Missing availability clears to null: this is a full-row writer guarded by expectedId, not a partial patch. */
  availability?: PersonAvailability | null;
  /** Full-row writes clear an omitted usual shift, just like availability. */
  usualShift?: UsualShift | null;
  rosterInclude: boolean | null; worksAs?: "employee" | "trainer" | "key_holder" | "shift_lead" | null;
}) {
  return {
    fn: SCHEDULE_RPC.recordPersonSettings,
    args: {
      p_actor: i.actorId, p_location: i.locationId, p_user: i.userId, p_work_type: i.workType, p_also_allowed: i.alsoAllowed,
      p_leader_setting: i.leaderSetting, p_cover_positions: i.coverPositions, p_soft_min_h: i.softMinH, p_soft_max_h: i.softMaxH,
      p_full_time: i.fullTime, p_full_time_min_h: i.fullTimeMinH, p_roster_include: i.rosterInclude, p_works_as: i.worksAs ?? null, p_availability: i.availability ?? null, p_usual_shift: i.usualShift ?? null,
    },
  } as const;
}

/** 0278: the FULL-ROW write with the expected head (the latest row id the card was based on; null = none yet). */
export function savePersonSettingsCall(i: Parameters<typeof recordPersonSettingsCall>[0] & { expectedId: string | null }) {
  const { args } = recordPersonSettingsCall(i);
  return { fn: SCHEDULE_RPC.savePersonSettings, args: { p_actor: args.p_actor, p_location: args.p_location, p_user: args.p_user, p_expected: i.expectedId,
    p_work_type: args.p_work_type, p_also_allowed: args.p_also_allowed, p_leader_setting: args.p_leader_setting, p_cover_positions: args.p_cover_positions,
    p_soft_min_h: args.p_soft_min_h, p_soft_max_h: args.p_soft_max_h, p_full_time: args.p_full_time, p_full_time_min_h: args.p_full_time_min_h,
    p_roster_include: args.p_roster_include, p_works_as: args.p_works_as, p_availability: args.p_availability, p_usual_shift: args.p_usual_shift } } as const;
}

/** 0278: the user screen's changes only (workType / primary / secondary) + the head they were based on, merged under the lock. */
export function mergePersonPositionsCall(i: { actorId: string; locationId: string; userId: string; expectedId: string | null; changes: Record<string, unknown> }) {
  return { fn: SCHEDULE_RPC.mergePersonPositions, args: { p_actor: i.actorId, p_location: i.locationId, p_user: i.userId, p_expected: i.expectedId, p_changes: i.changes } } as const;
}

export function recordBudgetEntryCall(i: {
  actorId: string; locationId: string; scope: "week" | "month"; weekStart: string | null; month: string | null; hours: number;
  /** One row per date the entry covers (budget-shared `apportion`). */
  days: Array<{ date: string; hours: number }>;
  source: "manager" | "accepted_suggestion"; suggestionDigest: string | null; apportionedBy: "forecast" | "even" | "explicit";
}) {
  return {
    fn: SCHEDULE_RPC.recordBudgetEntry,
    args: {
      p_actor: i.actorId, p_location: i.locationId, p_scope: i.scope, p_week_start: i.weekStart, p_month: i.month, p_hours: i.hours,
      p_days: i.days.map((d) => ({ date: d.date, hours: d.hours })), p_source: i.source, p_digest: i.suggestionDigest,
      p_apportioned_by: i.apportionedBy,
    },
  } as const;
}

export function recordDayTypeCall(i: { actorId: string; locationId: string; date: string; dayType: "auto" | "slow" | "normal" | "busy" }) {
  return { fn: SCHEDULE_RPC.recordDayType, args: { p_actor: i.actorId, p_location: i.locationId, p_date: i.date, p_day_type: i.dayType } } as const;
}

/** A new pin (presence / added), or — with `retiresId` — the retirement of one (the other fields are then ignored). */
export function recordPinCall(i: {
  actorId: string; locationId: string; date: string | null; userId: string | null; startQ: number | null; endQ: number | null;
  positions: string[] | null; kind: "presence" | "added" | null; retiresId: string | null;
}) {
  return {
    fn: SCHEDULE_RPC.recordPin,
    args: {
      p_actor: i.actorId, p_location: i.locationId, p_date: i.date, p_user: i.userId, p_start_q: i.startQ, p_end_q: i.endQ,
      p_positions: i.positions, p_kind: i.kind, p_retires: i.retiresId,
    },
  } as const;
}

// ─── 0275 ────────────────────────────────────────────────────────────────────

/** The meta envelope of a revision (the display summary, the digests, the confirmation, the actor context). */
export interface CommitMeta {
  actorContext: "user" | "cron";
  /** J12: true only after the person confirmed each edited week by id (Tier B at the route — SQL sees only this flag). */
  confirmedOverwrite?: boolean;
  inputsDigest: string;
  generatorVersion: string;
  horizonRunId?: string | null;
  /** DISPLAY ONLY: counts per code + the first 50 (the complete lists are the day rows and the gap rows). */
  problemsSummary: Record<string, unknown>;
  /** A revision id chosen by the lib (an edit's `newRevisionId`); omitted → SQL mints one. */
  revisionId?: string;
  /** context-shared `toContextSnapshot(...).digest`. */
  contextDigest: string;
}

/**
 * One week's COMPLETE snapshot. `days` = the 7 DayRecords (a built day's `originRevisionId` is null or the new
 * revision's id — SQL stamps it); `gaps` = the complete DeclaredGap[]; `context` = the RuleContext snapshot;
 * `reasons` = the generator's reason index (`date|user|start`), when there is one. A structure version of null means
 * the seeded defaults (no saved structure).
 */
export function commitRevisionCall(i: {
  actorId: string | null; locationId: string; weekStart: string; expectedHead: string | null; kind: "generated" | "regenerated" | "edited";
  structureVersionId: string | null; shifts: readonly Shift[]; days: readonly DayRecord[]; gaps: readonly DeclaredGap[]; context: RuleContext | Record<string, unknown>;
  reasons?: Readonly<Record<string, unknown>>; meta: CommitMeta;
}) {
  const meta: Record<string, unknown> = {
    actor_context: i.meta.actorContext, inputs_digest: i.meta.inputsDigest, generator_version: i.meta.generatorVersion,
    problems_summary: i.meta.problemsSummary, context_digest: i.meta.contextDigest,
  };
  if (i.meta.confirmedOverwrite !== undefined) meta.confirmed_overwrite = i.meta.confirmedOverwrite;
  if (i.meta.horizonRunId !== undefined) meta.horizon_run_id = i.meta.horizonRunId;
  if (i.meta.revisionId !== undefined) meta.revision_id = i.meta.revisionId;
  return {
    fn: SCHEDULE_RPC.commitRevision,
    args: {
      p_actor: i.actorId, p_location: i.locationId, p_week_start: i.weekStart, p_expected_head: i.expectedHead, p_kind: i.kind,
      p_structure_version: i.structureVersionId,
      p_shifts: i.shifts.map((s) => ({
        userId: s.userId, date: s.date, startQ: s.startQ, endQ: s.endQ, segments: s.segments, closingManager: s.closingManager, flex: s.flex, pinned: s.pinned,
        reasons: i.reasons?.[`${s.date}|${s.userId}|${s.startQ}`] ?? null,
      })),
      p_days: i.days.map((d) => ({ date: d.date, originRevisionId: d.originRevisionId, structureVersionId: d.structureVersionId, inherited: d.inherited, problems: d.problems })),
      p_gaps: i.gaps.map((g) => ({ date: g.date, code: g.code, positionId: g.positionId, fromQ: g.fromQ, toQ: g.toQ, cause: g.cause, certificate: g.certificate })),
      p_context: i.context, p_meta: meta,
    },
  } as const;
}

export function approveWeekCall(i: { actorId: string; locationId: string; weekStart: string; expectedHead: string }) {
  return { fn: SCHEDULE_RPC.approveWeek, args: { p_actor: i.actorId, p_location: i.locationId, p_week_start: i.weekStart, p_expected_head: i.expectedHead } } as const;
}
