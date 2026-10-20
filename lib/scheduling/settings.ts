/**
 * THE SCHEDULING SETTINGS WRITERS — structure, shop switch + wage estimates, person settings, budgets (set / accept /
 * keep the suggestion), day-type overrides, pins (Scheduling Phase 2, Task 17). Server-only, service role, every write
 * through a 0274 definer RPC built by `rpc-args-shared`; the RPC re-checks actor, shop and subject under its lock.
 *
 * Rules first, before any I/O (`access-shared` via the schedules lib's `gate`): the structure GM own / MoO+ (Tier E at
 * the route); the shop switch and wage estimates MoO+ only (Tier E); budgets, day types, pins and person settings GM
 * own / MoO+ (an AGM only with `agm_access = 'edit'`), no step-up. The social media manager is refused by ROLE.
 * Every write is audited with before / after (or its payload). No email, no notification.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit-actions";
import { operationalNow } from "@/lib/midshift-shared";
import type { PeopleActor } from "@/lib/people/access-shared";
import { summarizeSales, type DailyRaw } from "@/lib/sales-reports-shared";
import { canManageShopSwitch } from "./access-shared";
import {
  acceptSuggestion, apportion, budgetForDates, entryDates, minCrewHours, referenceStructureOf, structureDeltaHours, suggestBudget, type BudgetEntry, type BudgetSuggestion,
} from "./budget-shared";
import { forecastWeek } from "./demand-shared";
import { ScheduleError } from "./errors-shared";
import { buildWeek } from "./generator/build-shared";
import { loadLiveStructure, loadSchedulingDemand, loadWeekHeads } from "./inputs";
import { STRUCTURE_DEFAULTS_ID, generatorInputFor, type SchedulingInputs } from "./inputs-shared";
import { defaultWorkType } from "./people-input-shared";
import { positionListProblems } from "./position-rank-shared";
import {
  recordBudgetEntryCall, recordDayTypeCall, recordPersonSettingsCall, recordPinCall, saveShopSettingsCall, saveStructureCall,
} from "./rpc-args-shared";
import { MOD } from "./rules-shared";
import { gate, rpcRefusal, type ScheduleDeps } from "./schedules";
import { validScheduleStructure, type PositionRole } from "./structure-shared";
import { addDays, isYmd, isoWeekStart, weekDays } from "./time-shared";
import { ROLES, type RoleCode } from "@/lib/roles";
import { loadSchedulingInputs } from "./inputs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = (d: ScheduleDeps) => operationalNow(d.now ?? new Date()).date;

async function rpc(service: SupabaseClient, call: { fn: string; args: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const { data, error } = await service.rpc(call.fn, call.args);
  if (error) rpcRefusal(error);
  return (data ?? {}) as Record<string, unknown>;
}
async function log(actor: PeopleActor, action: AuditAction, table: string, locationId: string, metadata: Record<string, unknown>): Promise<void> {
  await audit({ actorId: actor.userId, actorRole: actor.role, action, resourceTable: table, resourceId: locationId, metadata: { location_id: locationId, ...metadata }, ipAddress: null, userAgent: null });
}

// ─── Structure (Tier E at the route) ─────────────────────────────────────────

export async function saveStructure(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; expectedId: string | null; structure: unknown }): Promise<{ beforeId: string | null; afterId: string }> {
  await gate(deps.service, args.actor, args.locationId, "structure");
  const v = validScheduleStructure(args.structure);
  if (!v.ok) throw new ScheduleError("structure_invalid", { key: v.key });
  const expected = args.expectedId === STRUCTURE_DEFAULTS_ID ? null : args.expectedId;
  const r = await rpc(deps.service, saveStructureCall({ actorId: args.actor.userId, locationId: args.locationId, expectedId: expected, structure: args.structure }));
  const out = { beforeId: (r.before_id as string | null) ?? null, afterId: String(r.after_id) };
  await log(args.actor, "schedule.structure_update", "schedule_structures", args.locationId, { before_id: out.beforeId, after_id: out.afterId });
  return out;
}

// ─── The shop switch + wage estimates (MoO+, Tier E) ─────────────────────────

const validCents = (v: unknown, max: number) => v === null || (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= max);

export async function saveShopSettings(deps: ScheduleDeps, args: {
  actor: PeopleActor; locationId: string; enabled: unknown; estimatedHourlyCents: unknown; estimatedSalariedWeeklyCents: unknown; agmAccess: unknown;
}): Promise<Record<string, unknown>> {
  await gate(deps.service, args.actor, args.locationId, "shop_switch");
  if (!canManageShopSwitch(args.actor)) throw new ScheduleError("schedule_forbidden");
  if (typeof args.enabled !== "boolean" || (args.agmAccess !== "read" && args.agmAccess !== "edit")) throw new ScheduleError("invalid_payload");
  if (!validCents(args.estimatedHourlyCents, 100000) || !validCents(args.estimatedSalariedWeeklyCents, 10000000)) throw new ScheduleError("wage_estimate_invalid");
  const r = await rpc(deps.service, saveShopSettingsCall({
    actorId: args.actor.userId, locationId: args.locationId, enabled: args.enabled, estimatedHourlyCents: args.estimatedHourlyCents as number | null,
    estimatedSalariedWeeklyCents: args.estimatedSalariedWeeklyCents as number | null, agmAccess: args.agmAccess,
  }));
  await log(args.actor, "schedule.shop_settings_update", "schedule_shop_settings", args.locationId, { before: r.before ?? null, after: r.after ?? null });
  return r;
}

// ─── Person settings ─────────────────────────────────────────────────────────

export interface PersonSettingsInput {
  userId: string; workType: "boh" | "foh" | "management" | null; alsoAllowed: Array<"boh" | "foh">; leaderSetting: "opens" | "closes" | "mix" | null;
  coverPositions: string[]; softMinH: number | null; softMaxH: number | null; fullTime: boolean; fullTimeMinH: number | null; rosterInclude: boolean | null;
}
export async function recordPersonSettings(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; settings: PersonSettingsInput }): Promise<Record<string, unknown>> {
  await gate(deps.service, args.actor, args.locationId, "person_settings");
  const s = args.settings;
  if (!s || typeof s.userId !== "string" || !UUID.test(s.userId) || !Array.isArray(s.coverPositions) || !Array.isArray(s.alsoAllowed)) throw new ScheduleError("invalid_payload");
  await refusePositionRank(deps.service, args.locationId, s);
  const r = await rpc(deps.service, recordPersonSettingsCall({ actorId: args.actor.userId, locationId: args.locationId, ...s }));
  await log(args.actor, "schedule.person_settings_update", "schedule_person_settings", args.locationId, { user_id: s.userId, before: r.before ?? null, after: r.after ?? null });
  return r;
}

/**
 * Juan 2026-10-20 (primary / secondary): the ordered list's first two entries must be positions the person may hold —
 * their EFFECTIVE work type (the setting, else the role default) with "also allowed", and never a manager on the
 * dish-and-prep position (`positionListProblems`, the same rule the staff settings card shows before it posts). Judged
 * only once the shop's structure is SAVED (before that every position reads as a line position, so the roles are not
 * known); an unknown subject is left to the RPC (`person_not_at_shop`). Refusal: `position_rank_not_allowed`.
 */
async function refusePositionRank(service: SupabaseClient, locationId: string, s: PersonSettingsInput): Promise<void> {
  if (s.coverPositions.length === 0) return;
  const live = await loadLiveStructure(service, locationId);
  if (live.source !== "saved") return;
  const { data, error } = await service.from("users").select("role").eq("id", s.userId).maybeSingle();
  if (error) throw new Error(`refusePositionRank: ${error.message}`);
  const role = (data as { role?: string } | null)?.role;
  if (!role || !Object.hasOwn(ROLES, role)) return;
  const roles: Record<string, PositionRole> = Object.fromEntries(Object.entries(live.structure.positions).map(([id, p]) => [id, p.role]));
  const problems = positionListProblems({ role: role as RoleCode, workType: s.workType ?? defaultWorkType(role as RoleCode), alsoAllowed: s.alsoAllowed }, s.coverPositions, roles);
  const first = problems[0];
  if (first) throw new ScheduleError("position_rank_not_allowed", { params: { slot: first.slot, positionId: first.positionId, reason: first.code } });
}

// ─── Day types and pins ──────────────────────────────────────────────────────

export async function setDayType(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; date: string; dayType: "auto" | "slow" | "normal" | "busy" }): Promise<{ id: string }> {
  await gate(deps.service, args.actor, args.locationId, "day_type");
  if (!isYmd(args.date) || !["auto", "slow", "normal", "busy"].includes(args.dayType)) throw new ScheduleError("invalid_payload");
  if (args.date < today(deps)) throw new ScheduleError("day_locked", { params: { date: args.date } });
  const r = await rpc(deps.service, recordDayTypeCall({ actorId: args.actor.userId, locationId: args.locationId, date: args.date, dayType: args.dayType }));
  await log(args.actor, "schedule.day_type_set", "schedule_day_types", args.locationId, { date: args.date, day_type: args.dayType, id: r.id });
  return { id: String(r.id) };
}

export async function setPin(deps: ScheduleDeps, args: {
  actor: PeopleActor; locationId: string;
  pin: { date: string; userId: string; startQ: number; endQ: number; positions: string[]; kind: "presence" | "added" } | { retiresId: string };
}): Promise<{ id: string }> {
  await gate(deps.service, args.actor, args.locationId, "presence");
  const p = args.pin;
  const call = "retiresId" in p
    ? recordPinCall({ actorId: args.actor.userId, locationId: args.locationId, date: null, userId: null, startQ: null, endQ: null, positions: null, kind: null, retiresId: p.retiresId })
    : (() => {
      if (!isYmd(p.date) || !Number.isInteger(p.startQ) || !Number.isInteger(p.endQ) || p.startQ < 0 || p.endQ > 96 || p.startQ >= p.endQ) throw new ScheduleError("pin_invalid");
      if (p.date < today(deps)) throw new ScheduleError("day_locked", { params: { date: p.date } });
      return recordPinCall({ actorId: args.actor.userId, locationId: args.locationId, date: p.date, userId: p.userId, startQ: p.startQ, endQ: p.endQ, positions: p.positions, kind: p.kind, retiresId: null });
    })();
  const r = await rpc(deps.service, call);
  await log(args.actor, "schedule.pin_set", "schedule_pins", args.locationId, { pin: p, id: r.id });
  return { id: String(r.id) };
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

/** A manager's week / month budget, apportioned to its dates by forecast share (even without one) and written as ONE entry. */
export async function setBudget(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; scope: "week" | "month"; weekStart: string | null; month: string | null; hours: number }): Promise<{ id: string; days: number }> {
  await gate(deps.service, args.actor, args.locationId, "budget");
  const entry: BudgetEntry = { id: "new", scope: args.scope, weekStart: args.scope === "week" ? args.weekStart : null, month: args.scope === "month" ? args.month : null,
    hours: args.hours, source: "manager", suggestionDigest: null, apportionedBy: "forecast", createdAt: "" };
  const dates = entryDates(entry); // budget_invalid on a bad scope / date / quarter-hour
  const asOf = today(deps);
  const { baseline } = await loadSchedulingDemand(deps.service, args.locationId, dates, asOf);
  const demand = forecastWeek(baseline, dates, asOf);
  const centsByDate = demand.kind === "ok" ? Object.fromEntries(demand.days.map((d) => [d.date, d.kind === "ok" ? d.dayCents : 0])) : null;
  const byForecast = !!centsByDate && Object.values(centsByDate).some((c) => c > 0);
  const rows = apportion(entry, { forecastCentsByDate: byForecast ? centsByDate : null });
  const r = await rpc(deps.service, recordBudgetEntryCall({
    actorId: args.actor.userId, locationId: args.locationId, scope: args.scope, weekStart: entry.weekStart, month: entry.month, hours: args.hours,
    days: rows.map((x) => ({ date: x.date, hours: x.hours })), source: "manager", suggestionDigest: null, apportionedBy: byForecast ? "forecast" : "even",
  }));
  await log(args.actor, "schedule.budget_set", "schedule_budget_entries", args.locationId, { scope: args.scope, week_start: entry.weekStart, month: entry.month, hours: args.hours, id: r.id, apportioned_by: byForecast ? "forecast" : "even" });
  return { id: String(r.id), days: Number(r.dates ?? rows.length) };
}

/** The reference revision's hourly hours and catering-rule hours per date, from its STORED snapshot and reasons. */
function referenceFacts(w: NonNullable<Awaited<ReturnType<typeof loadWeekHeads>>[string]["head"]>) {
  const hoursByDate: Record<string, number> = {};
  const cateringHoursByDate: Record<string, number> = {};
  for (const sh of w.shifts) {
    const p = w.context.people[sh.userId];
    if (!p || (!p.salaried && !p.presenceOnly)) hoursByDate[sh.date] = (hoursByDate[sh.date] ?? 0) + (sh.endQ - sh.startQ) / 4;
    const stored = w.reasons[`${sh.date}|${sh.userId}|${sh.startQ}`] as { segments?: Array<Array<{ key: string }>> } | undefined;
    sh.segments.forEach((g, i) => {
      if (g.positionId !== MOD && (stored?.segments?.[i] ?? []).some((r) => r.key === "catering_prep")) cateringHoursByDate[sh.date] = (cateringHoursByDate[sh.date] ?? 0) + (g.endQ - g.startQ) / 4;
    });
  }
  return { hoursByDate, cateringHoursByDate };
}

/**
 * The budget suggestion for a target week (r2 P2-8, r3, r4): the most recent fully ended week whose head covers all 7
 * days is the reference; its actual sales per captured date (one `sales_report_daily` call); the ratio touches only the
 * matched dates; catering and structure deltas per date; matched dates clamp at their minimum crew hours.
 */
export async function budgetSuggestion(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; weekStart: string; inputs?: SchedulingInputs }): Promise<BudgetSuggestion> {
  await gate(deps.service, args.actor, args.locationId, "budget");
  const asOf = today(deps);
  const inputs = args.inputs ?? await (deps.loadInputs ?? loadSchedulingInputs)(deps.service, { locationId: args.locationId, weekStarts: [args.weekStart], now: deps.now ?? new Date() });
  const thisWeek = isoWeekStart(asOf);
  const candidates = [1, 2, 3, 4].map((n) => addDays(thisWeek, -7 * n));
  const heads = await loadWeekHeads(deps.service, args.locationId, candidates);
  const refStart = candidates.find((w) => heads[w]?.head && heads[w]!.head!.days.length === 7) ?? null;
  const refHead = refStart ? heads[refStart]!.head! : null;
  let reference: Parameters<typeof suggestBudget>[0]["reference"] = null;
  if (refStart && refHead) {
    const { data, error } = await deps.service.rpc("sales_report_daily", { p_location_id: args.locationId, p_from: refStart, p_to: addDays(refStart, 6) });
    if (error) rpcRefusal(error);
    const buckets = summarizeSales(data ? [data as DailyRaw] : [], refStart, addDays(refStart, 6), "day").buckets;
    const salesCentsByDate: Record<string, number> = {};
    for (const b of buckets) if (b.coveredDays > 0) salesCentsByDate[b.from] = b.toastChecksCents;
    const f = referenceFacts(refHead);
    reference = { weekStart: refStart, complete: true, hoursByDate: f.hoursByDate, salesCentsByDate, cateringHoursByDate: f.cateringHoursByDate, budgetTotal: null };
  }
  const gi = generatorInputFor(inputs, args.weekStart, { today: weekDays(args.weekStart)[0]! < asOf ? asOf : weekDays(args.weekStart)[0]! });
  const ctx = buildWeek(gi).context;
  const live = inputs.structure.structure;
  // Astra chunk E P2-3: the reference week's ACTUAL structure (stored with its revision); never the live one. Unknown →
  // the delta is not applied and the suggestion says so.
  const ref = refHead ? referenceStructureOf(refHead, inputs.structuresById) : live;
  const structureDeltaUnknown = ref === null;
  const cateringHoursByDate: Record<string, number> = {};
  const structureDeltaByDate: Record<string, number> = {};
  const minCrewHoursByDate: Record<string, number> = {};
  for (const d of gi.days) {
    const need = ctx.days[d.date]?.need;
    cateringHoursByDate[d.date] = (need?.sources ?? []).filter((r) => r.source === "catering").reduce((n, r) => n + (r.heads * (r.toQ - r.fromQ)) / 4, 0);
    structureDeltaByDate[d.date] = ref === null ? 0 : structureDeltaHours({ live, ref, day: { dayType: d.dayType, scheduledOutQ: d.scheduledOutQ, hourlyCents: d.hourlyCents, demandKind: d.demandKind, catering: d.catering } });
    minCrewHoursByDate[d.date] = minCrewHours(live, d.dayType, d.scheduledOutQ);
  }
  const current = budgetForDates(inputs.budget.entries, inputs.budget.rows, weekDays(args.weekStart));
  return suggestBudget({
    asOf, targetWeekStart: args.weekStart, reference, demand: inputs.demand, cateringHoursByDate, structureDeltaByDate, minCrewHoursByDate,
    currentBudgetTotal: current.unbudgetedDates.length === 7 ? null : current.total, deadbandH: live.labor.budgetDeadbandH, structureDeltaUnknown,
  });
}

/** Accept the suggestion the person SAW (by digest): recomputed server-side; a different suggestion is `preview_stale`. */
export async function acceptBudgetSuggestion(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; weekStart: string; digest: string }): Promise<{ id: string }> {
  const s = await budgetSuggestion(deps, args);
  if (s.kind === "unavailable") throw new ScheduleError("suggestion_unavailable", { params: { cause: s.cause } });
  if (s.kind !== "suggestion" || s.digest !== args.digest) throw new ScheduleError("preview_stale");
  const { entry, rows } = acceptSuggestion(s, { id: "new", createdAt: "" });
  const r = await rpc(deps.service, recordBudgetEntryCall({
    actorId: args.actor.userId, locationId: args.locationId, scope: "week", weekStart: entry.weekStart, month: null, hours: entry.hours,
    days: rows.map((x) => ({ date: x.date, hours: x.hours })), source: "accepted_suggestion", suggestionDigest: s.digest, apportionedBy: "explicit",
  }));
  await log(args.actor, "schedule.budget_set", "schedule_budget_entries", args.locationId, { scope: "week", week_start: args.weekStart, hours: entry.hours, digest: s.digest, source: "accepted_suggestion", id: r.id });
  return { id: String(r.id) };
}

/** Keep the current budget: the suggestion's digest is recorded (`schedule.budget_kept`) so it stays quiet. No RPC. */
export async function keepBudget(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; weekStart: string; digest: string }): Promise<{ kept: string }> {
  const s = await budgetSuggestion(deps, args);
  if (s.kind === "unavailable" || s.digest !== args.digest) throw new ScheduleError("preview_stale");
  await log(args.actor, "schedule.budget_kept", "schedule_budget_entries", args.locationId, { week_start: args.weekStart, digest: s.digest });
  return { kept: s.digest };
}

