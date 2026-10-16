/**
 * `loadSchedulingInputs` — THE ONE BATCH LOADER of scheduling (Scheduling Phase 2, Task 16). Server-only, service
 * role. It gathers, for ONE shop and a set of ISO weeks, every fact the generator, the validator, the budget and the
 * board read — every query paged (`selectAllRows`) and every id list chunked — and nothing else reads them:
 *
 *   shop settings (0274; no row = OFF) · the live structure (newest version, else seeded from the stations:
 *   `STRUCTURE_DEFAULTS_ID`) · active members + their membership date · the skill matrix (`computeSkillMatrixForShop`,
 *   the SAME matrix `loadSkillMatrix` serves) and the tunables' bands · person settings (latest per person) · budget
 *   entries + their per-date rows · day-type overrides · active pins · each week's head (revision, shifts, days, gaps,
 *   STORED reasons, its own context snapshot) and whether it carries manager edits · demand (`fetchSalesBaseline`,
 *   DISCRIMINATED: ok / unavailable(cause) / no_history) · booked catering (`loadBookedCateringEvents` + ezCater) ·
 *   8 weeks of linked Toast punches · the measured closing duration (people facts `closingLines` +
 *   `closingFinalization`) · 7shifts hourly wages and the weekly overtime line, ONLY when 7shifts is `ready` — reduced
 *   here to cents per user, never placed in a view-model.
 *
 * The CALLER gates (the schedules lib runs `access-shared` first; the cron is a system context). Before 0274 / 0275
 * (or 0270) are applied every read answers `inputs_unavailable` (503), never a 500. No email, no notification.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBookedCateringEvents } from "@/lib/catering/booked-events";
import { operationalNow } from "@/lib/midshift-shared";
import { etClockTime } from "@/lib/operational-day";
import { isMissingTable, loadPeopleFacts, SkillsUnavailableError } from "@/lib/people/facts";
import { computeSkillMatrixForShop, loadShopTunables } from "@/lib/people/skills";
import { fetchSalesBaseline } from "@/lib/pulse/sales";
import { ROLES, type RoleCode } from "@/lib/roles";
import { mergeBreakdown } from "@/lib/sales-reports-shared";
import { sevenShiftsStatus } from "@/lib/sevenshifts/config";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadPunchHistory } from "@/lib/toast/punch-history";
import type { BudgetDayRow, BudgetEntry } from "./budget-shared";
import { closingDuration } from "./closing-duration-shared";
import { ruleContextFromSnapshot } from "./context-shared";
import { forecastWeek, withCatering, type DayTypeOverride, type SalesBaselineResult } from "./demand-shared";
import { ScheduleError } from "./errors-shared";
import type { Pin } from "./generator/build-shared";
import {
  DEFAULT_SCHEDULE_SHOP_SETTINGS, STRUCTURE_DEFAULTS_ID, closingFacts, datesOfWeeks, toCateringEvents, tsStructureVersion,
  type DayTypeRow, type EzcaterOrderRow, type MemberRow, type ScheduleShopSettings, type SchedulingInputs, type StoredRevision, type StoredWeek,
} from "./inputs-shared";
import type { PersonSettingsRow } from "./people-input-shared";
import type { DayRecord, DeclaredGap, RuleProblem, Segment, Shift } from "./rules-shared";
import { SCHEDULE_STRUCTURE_DEFAULTS, structureFromStations, type ScheduleStructure } from "./structure-shared";
import { Q_MINUTES } from "./time-shared";
import { addDays, isoWeekStart } from "./time-shared";

const ID_CHUNK = 100;
const chunks = <T>(xs: readonly T[], n = ID_CHUNK): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** ONE row (a `.limit(1)` read), or null; an error throws (a missing table becomes inputs_unavailable upstream). */
async function firstRow<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data as T[] | null) ?? [])[0] ?? null;
}

/** A read of a scheduling (0274 / 0275) or people (0270) table: a missing table is `inputs_unavailable`. */
function unavailableOr(e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof SkillsUnavailableError || isMissingTable({ message })) throw new ScheduleError("inputs_unavailable");
  throw e;
}

/** The shop switch and estimates (no row = OFF, money blank, AGM read-only). Before 0274: inputs_unavailable. */
export async function loadScheduleShopSettings(service: SupabaseClient, locationId: string): Promise<ScheduleShopSettings> {
  const { data, error } = await service.from("schedule_shop_settings")
    .select("enabled, estimated_hourly_cents, estimated_salaried_weekly_cents, agm_access").eq("location_id", locationId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new ScheduleError("inputs_unavailable");
    throw new Error(`loadScheduleShopSettings: ${error.message}`);
  }
  const r = data as { enabled: boolean; estimated_hourly_cents: number | null; estimated_salaried_weekly_cents: number | null; agm_access: "read" | "edit" } | null;
  return r ? { enabled: r.enabled === true, estimatedHourlyCents: r.estimated_hourly_cents, estimatedSalariedWeeklyCents: r.estimated_salaried_weekly_cents, agmAccess: r.agm_access === "edit" ? "edit" : "read" }
    : DEFAULT_SCHEDULE_SHOP_SETTINGS;
}

/** The live structure: the newest saved version, else seeded from the stations (roles unmapped = line_other). */
export async function loadLiveStructure(service: SupabaseClient, locationId: string): Promise<SchedulingInputs["structure"]> {
  const saved = await firstRow<{ id: string; structure: ScheduleStructure; created_at: string }>(service.from("schedule_structures")
    .select("id, structure, created_at").eq("location_id", locationId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1));
  if (saved) return { id: saved.id, structure: saved.structure, source: "saved" };
  const stations = await selectAllRows<{ id: string; active: boolean; usually_closes_at: string | null; trims: Array<{ at: string; to_count: number }> | null }>((from, to) => service
    .from("stations").select("id, active, usually_closes_at, trims").eq("location_id", locationId).order("id", { ascending: true }).range(from, to));
  const positions = await selectAllRows<{ id: string; station_id: string; active: boolean; usually_trims_at: string | null }>((from, to) => service
    .from("station_positions").select("id, station_id, active, usually_trims_at").eq("location_id", locationId).order("id", { ascending: true }).range(from, to));
  const seeded = structureFromStations(
    stations.map((s) => ({ id: s.id, active: s.active, usuallyClosesAt: s.usually_closes_at, trims: s.trims })),
    positions.map((p) => ({ id: p.id, stationId: p.station_id, active: p.active, usuallyTrimsAt: p.usually_trims_at })), {});
  return { id: STRUCTURE_DEFAULTS_ID, structure: seeded.ok ? seeded.structure : SCHEDULE_STRUCTURE_DEFAULTS, source: "defaults" };
}

async function loadMembersWithSince(service: SupabaseClient, locationId: string): Promise<MemberRow[]> {
  const ul = await selectAllRows<{ user_id: string; assigned_at: string | null }>((from, to) => service
    .from("user_locations").select("user_id, assigned_at").eq("location_id", locationId).eq("active", true)
    .order("user_id", { ascending: true }).range(from, to));
  const since = new Map(ul.map((r) => [r.user_id, r.assigned_at ? r.assigned_at.slice(0, 10) : null]));
  const out: MemberRow[] = [];
  for (const ids of chunks([...since.keys()])) {
    for (const r of await selectAllRows<{ id: string; name: string; role: RoleCode }>((from, to) => service
      .from("users").select("id, name, role").in("id", ids).eq("active", true).order("id", { ascending: true }).range(from, to))) {
      if (Object.hasOwn(ROLES, r.role)) out.push({ userId: r.id, name: r.name, role: r.role, memberSince: since.get(r.id) ?? null });
    }
  }
  return out.sort((a, b) => (a.userId < b.userId ? -1 : 1));
}

async function loadPersonSettings(service: SupabaseClient, locationId: string): Promise<PersonSettingsRow[]> {
  const rows = await selectAllRows<{ id: string; user_id: string; work_type: PersonSettingsRow["workType"]; also_allowed: Array<"boh" | "foh">; leader_setting: PersonSettingsRow["leaderSetting"];
    cover_positions: string[]; soft_min_h: number | string | null; soft_max_h: number | string | null; full_time: boolean; full_time_min_h: number | string | null; roster_include: boolean | null; created_at: string }>(
    (from, to) => service.from("schedule_person_settings")
      .select("id, user_id, work_type, also_allowed, leader_setting, cover_positions, soft_min_h, soft_max_h, full_time, full_time_min_h, roster_include, created_at")
      .eq("location_id", locationId).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(r.user_id, r); // ascending: the last one wins
  return [...latest.values()].map((r) => ({
    userId: r.user_id, workType: r.work_type, alsoAllowed: r.also_allowed ?? [], leaderSetting: r.leader_setting, coverPositions: r.cover_positions ?? [],
    softMinH: num(r.soft_min_h), softMaxH: num(r.soft_max_h), fullTime: r.full_time === true, fullTimeMinH: num(r.full_time_min_h), rosterInclude: r.roster_include,
  })).sort((a, b) => (a.userId < b.userId ? -1 : 1));
}

async function loadBudget(service: SupabaseClient, locationId: string, from: string, to: string): Promise<{ entries: BudgetEntry[]; rows: BudgetDayRow[] }> {
  const days = await selectAllRows<{ entry_id: string; business_date: string; hours: number | string }>((f, t) => service.from("schedule_budget_days")
    .select("entry_id, business_date, hours").eq("location_id", locationId).gte("business_date", from).lte("business_date", to)
    .order("business_date", { ascending: true }).order("entry_id", { ascending: true }).range(f, t));
  const ids = [...new Set(days.map((d) => d.entry_id))].sort();
  const entries: BudgetEntry[] = [];
  for (const part of chunks(ids)) {
    for (const e of await selectAllRows<{ id: string; scope: "week" | "month"; week_start: string | null; month: string | null; hours: number | string; source: BudgetEntry["source"];
      suggestion_digest: string | null; apportioned_by: BudgetEntry["apportionedBy"]; created_at: string }>((f, t) => service.from("schedule_budget_entries")
      .select("id, scope, week_start, month, hours, source, suggestion_digest, apportioned_by, created_at").in("id", part).order("id", { ascending: true }).range(f, t))) {
      entries.push({ id: e.id, scope: e.scope, weekStart: e.week_start, month: e.month, hours: Number(e.hours), source: e.source, suggestionDigest: e.suggestion_digest,
        apportionedBy: e.apportioned_by, createdAt: e.created_at });
    }
  }
  return { entries, rows: days.map((d) => ({ entryId: d.entry_id, date: d.business_date, hours: Number(d.hours) })) };
}

async function loadDayTypes(service: SupabaseClient, locationId: string, from: string, to: string): Promise<DayTypeRow[]> {
  return (await selectAllRows<{ id: string; business_date: string; day_type: DayTypeOverride; created_at: string }>((f, t) => service.from("schedule_day_types")
    .select("id, business_date, day_type, created_at").eq("location_id", locationId).gte("business_date", from).lte("business_date", to)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).range(f, t)))
    .map((r) => ({ id: r.id, date: r.business_date, dayType: r.day_type, createdAt: r.created_at }));
}

/** Active pins on the dates: a pin is live unless a later row retires it (`retires_id`). */
async function loadPins(service: SupabaseClient, locationId: string, from: string, to: string): Promise<Pin[]> {
  const rows = await selectAllRows<{ id: string; business_date: string; user_id: string; start_q: number; end_q: number; positions: string[]; kind: "presence" | "added"; active: boolean; retires_id: string | null }>(
    (f, t) => service.from("schedule_pins").select("id, business_date, user_id, start_q, end_q, positions, kind, active, retires_id")
      .eq("location_id", locationId).gte("business_date", from).lte("business_date", to).order("id", { ascending: true }).range(f, t));
  const retired = new Set(rows.filter((r) => !r.active && r.retires_id).map((r) => r.retires_id!));
  return rows.filter((r) => r.active && !retired.has(r.id))
    .map((r) => ({ id: r.id, date: r.business_date, userId: r.user_id, startQ: r.start_q, endQ: r.end_q, positions: r.positions ?? [], kind: r.kind }));
}

/** The weeks' heads, complete: revision, shifts, days, gaps, the stored reasons, the head's own context; the edited flag. */
export async function loadWeekHeads(service: SupabaseClient, locationId: string, weekStarts: readonly string[]): Promise<Record<string, StoredWeek>> {
  const out: Record<string, StoredWeek> = {};
  for (const w of weekStarts) out[w] = { weekStart: w, weekId: null, headRevisionId: null, approvedRevisionId: null, head: null, edited: false };
  if (weekStarts.length === 0) return out;
  const weeks = await selectAllRows<{ id: string; week_start: string; head_revision_id: string | null; approved_revision_id: string | null }>((f, t) => service
    .from("schedule_weeks").select("id, week_start, head_revision_id, approved_revision_id").eq("location_id", locationId).in("week_start", [...weekStarts])
    .order("week_start", { ascending: true }).range(f, t));
  for (const wk of weeks) {
    const sw = out[wk.week_start];
    if (!sw) continue;
    sw.weekId = wk.id; sw.headRevisionId = wk.head_revision_id; sw.approvedRevisionId = wk.approved_revision_id;
    const revs = await selectAllRows<{ id: string; kind: StoredRevision["kind"]; based_on_revision_id: string | null; structure_version_id: string | null; inputs_digest: string;
      generator_version: string; created_by: string | null; actor_context: "user" | "cron"; created_at: string }>((f, t) => service.from("schedule_revisions")
      .select("id, kind, based_on_revision_id, structure_version_id, inputs_digest, generator_version, created_by, actor_context, created_at")
      .eq("week_id", wk.id).eq("location_id", locationId).order("created_at", { ascending: true }).order("id", { ascending: true }).range(f, t));
    const lastBuilt = [...revs].reverse().find((r) => r.kind !== "edited");
    sw.edited = revs.some((r) => r.kind === "edited" && (!lastBuilt || r.created_at > lastBuilt.created_at));
    const h = revs.find((r) => r.id === wk.head_revision_id);
    if (!h) continue;
    const shifts = await selectAllRows<{ user_id: string; business_date: string; start_q: number; end_q: number; segments: Segment[]; closing_manager: boolean; flex: boolean; pinned: boolean; reasons: unknown }>(
      (f, t) => service.from("schedule_revision_shifts").select("user_id, business_date, start_q, end_q, segments, closing_manager, flex, pinned, reasons")
        .eq("revision_id", h.id).order("business_date", { ascending: true }).order("user_id", { ascending: true }).order("start_q", { ascending: true }).range(f, t));
    const days = await selectAllRows<{ business_date: string; origin_revision_id: string | null; structure_version_id: string | null; inherited: boolean; problems: RuleProblem[] }>(
      (f, t) => service.from("schedule_revision_days").select("business_date, origin_revision_id, structure_version_id, inherited, problems")
        .eq("revision_id", h.id).order("business_date", { ascending: true }).range(f, t));
    const gaps = await selectAllRows<{ business_date: string; code: DeclaredGap["code"]; position_id: string | null; from_q: number; to_q: number; cause: DeclaredGap["cause"]; certificate: unknown }>(
      (f, t) => service.from("schedule_revision_gaps").select("business_date, code, position_id, from_q, to_q, cause, certificate")
        .eq("revision_id", h.id).order("business_date", { ascending: true }).order("code", { ascending: true }).order("from_q", { ascending: true }).range(f, t));
    const ctx = await firstRow<{ context: unknown }>(service.from("schedule_revision_contexts").select("context").eq("revision_id", h.id).limit(1));
    if (!ctx) throw new Error(`loadWeekHeads: revision ${h.id} has no context`);
    const reasons: Record<string, unknown> = {};
    const shiftRows: Shift[] = shifts.map((s) => {
      if (s.reasons !== null && s.reasons !== undefined) reasons[`${s.business_date}|${s.user_id}|${s.start_q}`] = s.reasons;
      return { userId: s.user_id, date: s.business_date, startQ: s.start_q, endQ: s.end_q, segments: s.segments, closingManager: s.closing_manager, flex: s.flex, pinned: s.pinned };
    });
    const dayRows: DayRecord[] = days.map((d) => ({ date: d.business_date, originRevisionId: d.origin_revision_id, structureVersionId: tsStructureVersion(d.structure_version_id),
      inherited: d.inherited, problems: d.problems }));
    sw.head = {
      revision: { id: h.id, kind: h.kind, basedOnRevisionId: h.based_on_revision_id, structureVersionId: tsStructureVersion(h.structure_version_id), createdAt: h.created_at,
        createdBy: h.created_by, actorContext: h.actor_context, generatorVersion: h.generator_version, inputsDigest: h.inputs_digest },
      shifts: shiftRows, days: dayRows,
      gaps: gaps.map((g) => ({ date: g.business_date, code: g.code, positionId: g.position_id, fromQ: g.from_q, toQ: g.to_q, cause: g.cause, certificate: g.certificate } as DeclaredGap)),
      reasons, context: ruleContextFromSnapshot(ctx.context),
    };
  }
  return out;
}

/** Demand for the dates: ONE RPC; a successful empty history is `no_history`, never `unavailable`. */
export async function loadSchedulingDemand(service: SupabaseClient, locationId: string, dates: readonly string[], asOf: string): Promise<{ baseline: SalesBaselineResult }> {
  const r = await fetchSalesBaseline(service, { locationId, asOf });
  if (r.kind === "unavailable") return { baseline: r };
  const heat = mergeBreakdown("hour_weekday", [r.raw.hours]).map((row) => ({ dow: row.dow ?? 0, hour: row.hour ?? -1, cents: row.cents }));
  void dates;
  return { baseline: { kind: "ok", raw: { hours: heat, capturedDays: [...new Set(r.raw.captured_days)] } } };
}

async function loadEzcater(service: SupabaseClient, locationId: string, dates: readonly string[]): Promise<EzcaterOrderRow[]> {
  if (dates.length === 0) return [];
  return selectAllRows<EzcaterOrderRow>((f, t) => service.from("ezcater_orders").select("id, event_date, event_timestamp, handoff_time, headcount, total_cents, status")
    .eq("location_id", locationId).in("event_date", [...dates]).is("lead_id", null).order("id", { ascending: true }).range(f, t));
}

/** 7shifts hourly wages per linked user + the weekly overtime line — only when 7shifts is `ready`. */
async function loadWages(service: SupabaseClient, memberIds: readonly string[]): Promise<{ wages: SchedulingInputs["wages"]; overtimeH: number | null }> {
  if (sevenShiftsStatus().state !== "ready" || memberIds.length === 0) return { wages: { byUserCents: {}, source: "none" }, overtimeH: null };
  const links: Array<{ sevenshifts_user_id: string; user_id: string }> = [];
  for (const ids of chunks(memberIds)) {
    links.push(...await selectAllRows<{ sevenshifts_user_id: string; user_id: string }>((f, t) => service.from("sevenshifts_user_links")
      .select("sevenshifts_user_id, user_id").in("user_id", ids).eq("active", true).order("user_id", { ascending: true }).range(f, t)));
  }
  const byRemote = new Map(links.map((l) => [String(l.sevenshifts_user_id), l.user_id]));
  const byUserCents: Record<string, number> = {};
  for (const ids of chunks([...byRemote.keys()])) {
    for (const w of await selectAllRows<{ user_id: string; wage_type: string; wage_cents: number; upcoming: boolean; effective_date: string | null }>((f, t) => service
      .from("sevenshifts_wages").select("user_id, wage_type, wage_cents, upcoming, effective_date").in("user_id", ids).eq("active", true).eq("upcoming", false)
      .order("user_id", { ascending: true }).order("effective_date", { ascending: true }).range(f, t))) {
      const u = byRemote.get(String(w.user_id));
      if (u && w.wage_type === "hourly") byUserCents[u] = w.wage_cents; // ascending effective date: the latest current wage wins
    }
  }
  const ls = await firstRow<{ weekly_ot_threshold: number | string | null }>(service.from("sevenshifts_labor_settings").select("weekly_ot_threshold")
    .order("company_id", { ascending: true }).limit(1));
  return { wages: { byUserCents, source: "sevenshifts" }, overtimeH: num(ls?.weekly_ot_threshold ?? null) };
}

/** The `schedule.budget_kept` digests of the shop (a kept suggestion stays quiet). */
async function loadKeptDigests(service: SupabaseClient, locationId: string): Promise<string[]> {
  const rows = await selectAllRows<{ metadata: { digest?: unknown } | null }>((f, t) => service.from("audit_log").select("metadata")
    .eq("action", "schedule.budget_kept").eq("resource_id", locationId).order("id", { ascending: true }).range(f, t));
  return [...new Set(rows.map((r) => r.metadata?.digest).filter((d): d is string => typeof d === "string"))].sort();
}

export interface LoadSchedulingArgs { locationId: string; weekStarts: readonly string[]; now: Date }

export async function loadSchedulingInputs(service: SupabaseClient, args: LoadSchedulingArgs): Promise<SchedulingInputs> {
  const { locationId } = args;
  const asOf = operationalNow(args.now).date;
  const weekStarts = [...new Set(args.weekStarts.map(isoWeekStart))].sort();
  const dates = datesOfWeeks(weekStarts);
  const from = dates[0] ?? asOf;
  const to = dates[dates.length - 1] ?? asOf;
  try {
    const shopSettings = await loadScheduleShopSettings(service, locationId);
    const structure = await loadLiveStructure(service, locationId);
    const members = await loadMembersWithSince(service, locationId);
    const skills = await computeSkillMatrixForShop(service, locationId, args.now);
    const tunables = await loadShopTunables(service, locationId);
    const personSettings = await loadPersonSettings(service, locationId);
    const budget = await loadBudget(service, locationId, from, to);
    const dayTypes = await loadDayTypes(service, locationId, from, to);
    const pins = await loadPins(service, locationId, from, to);
    const weeks = await loadWeekHeads(service, locationId, weekStarts);
    const structuresById: Record<string, ScheduleStructure> = { [structure.id]: structure.structure };
    const svIds = [...new Set(Object.values(weeks).flatMap((w) => (w.head ? [w.head.revision.structureVersionId] : [])).filter((id) => id !== STRUCTURE_DEFAULTS_ID && !structuresById[id]))];
    for (const ids of chunks(svIds)) {
      for (const r of await selectAllRows<{ id: string; structure: ScheduleStructure }>((f, t) => service.from("schedule_structures").select("id, structure")
        .eq("location_id", locationId).in("id", ids).order("id", { ascending: true }).range(f, t))) structuresById[r.id] = r.structure;
    }
    const { baseline } = await loadSchedulingDemand(service, locationId, dates, asOf);
    const booked = await loadBookedCateringEvents(service, { locationId, dates });
    const ez = await loadEzcater(service, locationId, dates);
    const catering = toCateringEvents(booked, ez, (iso) => { const [h, m] = etClockTime(iso).split(":").map(Number); return Math.floor((h! * 60 + m!) / Q_MINUTES); });
    const demand = withCatering(forecastWeek(baseline, dates, asOf), catering);
    const punchFrom = addDays(isoWeekStart(asOf), -56);
    const punches = await loadPunchHistory(service, { locationId, from: punchFrom, to: addDays(isoWeekStart(asOf), -1) });
    const facts = await loadPeopleFacts(service, {
      locationId, subject: { kind: "team", memberIds: members.map((m) => m.userId) },
      window: { bounds: { start: `${addDays(asOf, -35)}T00:00:00Z`, end: `${asOf}T00:00:00Z` }, dates: { from: addDays(asOf, -35), to: addDays(asOf, -1) } },
      families: ["closingLines", "closingFinalization"],
    });
    const closing = closingDuration(closingFacts(facts.skills), structure.structure.shopDay.serviceCloseQ);
    const { wages, overtimeH } = await loadWages(service, members.map((m) => m.userId));
    const keptBudgetDigests = await loadKeptDigests(service, locationId);
    return {
      locationId, asOf, shopSettings, structure, structuresById, members, skills, skillBands: { building: tunables.bands.building, strong: tunables.bands.strong },
      personSettings, budget, dayTypes, pins, weeks, demand, catering, punches, closing, wages, overtimeH, keptBudgetDigests,
    };
  } catch (e) {
    if (e instanceof ScheduleError) throw e;
    return unavailableOr(e);
  }
}
