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

export const SCHEDULE_RPC = {
  saveShopSettings: "save_schedule_shop_settings",
  saveStructure: "save_schedule_structure",
  recordPersonSettings: "record_schedule_person_settings",
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
  rosterInclude: boolean | null;
}) {
  return {
    fn: SCHEDULE_RPC.recordPersonSettings,
    args: {
      p_actor: i.actorId, p_location: i.locationId, p_user: i.userId, p_work_type: i.workType, p_also_allowed: i.alsoAllowed,
      p_leader_setting: i.leaderSetting, p_cover_positions: i.coverPositions, p_soft_min_h: i.softMinH, p_soft_max_h: i.softMaxH,
      p_full_time: i.fullTime, p_full_time_min_h: i.fullTimeMinH, p_roster_include: i.rosterInclude,
    },
  } as const;
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
