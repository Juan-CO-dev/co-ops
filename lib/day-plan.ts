/**
 * THE DAY LOADER (nav PR 6, plan r3): fills PR 5's `DayPlanInput` for one viewer at one shop. Server-only.
 *
 *  1. ONE clock read: `operationalNow(now)` gives the plan date and the minutes into it (C2). The loader reads no clock.
 *  2. The REAL role decides the lens first (`lensFor`): the social media manager gets `SmmFacts` from their own rows
 *     only, before any shop read (C1, section 7).
 *  3. Every needed fact starts AT ONCE, each in its own lane, and a lane that throws or times out fails ITS fact only.
 *     Two bounds per lane (ruling B2): every query runs on a client that is aborted at the deadline (`withAbort`, the
 *     Pulse pattern), AND every whole fact computation races a rejecting 6 s deadline, which bounds what an abort
 *     cannot: a dependency that ignores the signal, sequential reads that together pass 6 s, and the board promise.
 *  4. The PAGE owns the shared board promise and its cancellation. The loader calls `args.board` at most once, never
 *     aborts it, and only races it: on timeout the board facts (stations, assignments, myStation) fail.
 *  5. A fact the viewer may not see is sent as `{ kind: "failed" }` (ruling 2; section 6), never read.
 *
 * `DayFactDeps` holds one function per read (section 3), so the composition is tested with fakes.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOwnTaskAssignments, loadStationDayFlags } from "@/lib/assignments";
import { currentFloorStation, isFloorStation, type ShiftBoard, type Station, type StationDayFlags, type StationEvent, type TaskAssignment } from "@/lib/assignments-shared";
import { loadBookedCateringEvents } from "@/lib/catering/booked-events";
import { flaggedLineCounts, type PrepDemandRow } from "@/lib/catering/prep-demand-shared";
import { findDayInstance, findPrepDayInstances, pickDayInstance, type PrepDaySubtype } from "@/lib/checklist-day-instance";
import {
  lensFor, resolveMyStation, type AssignmentFacts, type CateringDay, type ChecklistDay, type DayPlanInput, type DayStation, type DayViewer, type Fact,
  type MidDayDay, type OrderingFacts, type ReceivingFacts, type ReportDay, type RhythmFacts, type ShopFacts, type ShopHours, type SmmFacts, type StationsFact,
} from "@/lib/day-plan-shared";
import {
  cashDay, cateringOrders, checklistDay, cutoffFact, dayAssignments, dayStations, factsNeeded, firstName, midDayDay, notPhaseSections, outTimes,
  pickEffectiveClosingTemplate, pmDay, poFact, rhythmRow, rhythmSkip, sectionsLeft, shopHoursFrom, smmChecklistTasks, smmStationRef, smmTaskState,
  vendorFact, type BookedRow, type ClassificationItem, type ClosingTemplateRow, type CutoffRow, type EzcaterRow, type InstanceRow, type NotPhaseRule,
  type PoRow, type RhythmDbRow, type SkipDbRow, type SmmTaskStatus, type VendorRow,
} from "@/lib/day-plan-load-shared";
import { loadItemDefns, loadItemOverrides } from "@/lib/items";
import { operationalNow } from "@/lib/midshift-shared";
import { withAbort } from "@/lib/pulse/abort";
import { etDayRange } from "@/lib/report-digests-shared";
import { loadEzcater, loadLiveStructure } from "@/lib/scheduling/inputs";
import { etWallQ, eventQFromWindow, ezcaterCancelled } from "@/lib/scheduling/inputs-shared";
import { selectAllRows } from "@/lib/supabase-paginate";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";

/** Per fact; under the 8 s statement timeout (ruling 11). */
export const DAY_FACT_DEADLINE_MS = 6_000;

class DayFactTimeout extends Error {
  constructor() { super("day fact deadline"); this.name = "DayFactTimeout"; }
}

export interface DayFactsArgs {
  /** REAL role, level, surfaces held at THIS shop, switches (PR 5 type). */
  readonly viewer: DayViewer;
  readonly shop: { readonly id: string; readonly code: string };
  /** The caller's one clock instant; the loader reads no clock. */
  readonly now: Date;
  /** The page's memoized shift-board load (the same promise its "My shift" block renders), or null when the viewer does
   *  not hold `ops` here. The loader calls it at most once, never aborts it, and never calls it for the social media manager. */
  readonly board: (() => Promise<ShiftBoard>) | null;
  /** The session's explicit shop memberships: the social media manager's own-task read binds the shop with them
   *  (loadOwnTaskAssignments → lockLocationContext). */
  readonly locations: readonly string[];
}

const INSTANCE_COLUMNS = "id, template_id, status, created_at, confirmed_at, confirmed_by";
/** The digest's open-order statuses (`OPEN_ORDER`, lib/report-digests-v2-shared.ts, not exported; a test pins them equal). */
export const DAY_OPEN_ORDER = ["confirmed", "placed", "invoiced"] as const;
type Sb = SupabaseClient;

/** One function per read (plan r3, section 3). Each throws on a failed read; none swallows an error into an empty answer. */
export interface DayFactDeps {
  /** H1: the live structure → the shop day. */
  shopDay(sb: Sb, shopId: string): Promise<ShopHours>;
  /** S2: both station flags, or "not installed" before 0353. */
  stationFlags(sb: Sb, shopId: string): Promise<StationDayFlags>;
  /** S3a (only while S2 says not installed): the EFFECTIVE closing template's active items (classification). */
  closingClassification(sb: Sb, shopId: string, date: string): Promise<ClassificationItem[]>;
  /** S3b: a template's active items (progress, on the closing instance's own template). */
  templateItems(sb: Sb, templateId: string): Promise<Array<{ id: string; station: string | null; active: boolean }>>;
  /** K1, K3, K5: the day's opening / closing instance on any version. */
  dayInstance(sb: Sb, a: { shopId: string; type: "opening" | "closing"; date: string }): Promise<InstanceRow | null>;
  /** K2: the template item ids with a live completion on the instance. */
  completedItems(sb: Sb, instanceId: string): Promise<string[]>;
  /** K4: the first non-final submission (Phase 1's). */
  phase1At(sb: Sb, instanceId: string): Promise<string | null>;
  /** K6, K7: the prep instances of the day on any version. */
  prepInstances(sb: Sb, a: { shopId: string; subtype: PrepDaySubtype; date: string }): Promise<InstanceRow[]>;
  /** K8: user names (chunked). */
  userNames(sb: Sb, ids: readonly string[]): Promise<Map<string, string>>;
  /** P1, P2: the day's one live cash and PM report. */
  cashReport(sb: Sb, shopId: string, date: string): Promise<{ signed_at: string | null; signed_by: string | null } | null>;
  pmReport(sb: Sb, shopId: string, date: string): Promise<{ status: string; submitted_at: string | null; submitted_by: string | null } | null>;
  /** O1-O3: vendors, every weekday's cutoffs, POs around the plan date. */
  vendors(sb: Sb): Promise<VendorRow[]>;
  cutoffs(sb: Sb, shopId: string): Promise<CutoffRow[]>;
  recentPos(sb: Sb, shopId: string, sinceIso: string): Promise<PoRow[]>;
  /** Y1: the delivery rhythm and its skips. */
  rhythm(sb: Sb, shopId: string): Promise<{ rows: RhythmDbRow[]; skips: SkipDbRow[] }>;
  /** R1-R3: half-logged deliveries, open orders with no COMPLETE delivery, deliveries completed on the date. Uncapped. */
  halfLogged(sb: Sb, shopId: string): Promise<Array<{ id: string; vendor_id: string; created_at: string }>>;
  openOrders(sb: Sb, shopId: string): Promise<PoRow[]>;
  completedOn(sb: Sb, shopId: string, date: string): Promise<Array<{ id: string; vendor_id: string; created_at: string }>>;
  /** C1, C2: booked pipeline events (no name, address or money kept) and unlinked ezCater orders. C3: out times. */
  booked(sb: Sb, shopId: string, dates: readonly string[]): Promise<BookedRow[]>;
  ezcater(sb: Sb, shopId: string, dates: readonly string[]): Promise<EzcaterRow[]>;
  outEvents(sb: Sb, pipelineIds: readonly string[]): Promise<Array<{ pipeline_id: string; to_stage: string; created_at: string }>>;
  /** F1: flagged Prep demand lines per need date (the page's own rule). */
  flaggedLines(sb: Sb, shopId: string, dates: readonly string[]): Promise<Record<string, number>>;
  // ── The social media manager (section 7): own rows only ──
  ownTasks(sb: Sb, a: { viewer: DayViewer; shopId: string; locations: readonly string[]; date: string }): Promise<TaskAssignment[]>;
  stationBusinessDate(sb: Sb, shopId: string): Promise<string>;
  ownStationEvents(sb: Sb, a: { shopId: string; userId: string; businessDate: string }): Promise<StationEvent[]>;
  /** One station and its positions (the caller keeps it only if it is a floor station); by position for a closed release. */
  stationWithPositions(sb: Sb, a: { shopId: string; stationId?: string; positionId?: string }): Promise<Station | null>;
  /** The task-day reader (access plan PR 5). Absent in production: a tasks-only viewer gets `not_shown` (ruling 12). */
  taskDay?: never;
}

const IN_CHUNK = 100;
async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...await read(ids.slice(i, i + IN_CHUNK)));
  return out;
}
function must<T>(r: { data: T | null; error: { message: string; code?: string } | null }, area: string): T | null {
  if (r.error) throw new Error(`${area}: ${r.error.code ?? "error"}`);
  return r.data;
}

/** The production reads (section 3). */
export const defaultDayFactDeps: DayFactDeps = {
  async shopDay(sb, shopId) {
    return shopHoursFrom(await loadLiveStructure(sb, shopId));
  },
  stationFlags: loadStationDayFlags,
  async closingClassification(sb, shopId, date) {
    const templates = await selectAllRows<ClosingTemplateRow>((from, to) => sb.from("checklist_templates")
      .select("id, type, active, effective_from, created_at").eq("location_id", shopId).eq("type", "closing").eq("active", true)
      .order("id", { ascending: true }).range(from, to));
    const effective = pickEffectiveClosingTemplate(templates, date);
    if (effective === null) return [];
    return selectAllRows<ClassificationItem>((from, to) => sb.from("checklist_template_items")
      .select("station, active, report_reference_type").eq("template_id", effective).eq("active", true)
      .order("id", { ascending: true }).range(from, to));
  },
  templateItems(sb, templateId) {
    return selectAllRows<{ id: string; station: string | null; active: boolean }>((from, to) => sb.from("checklist_template_items")
      .select("id, station, active").eq("template_id", templateId).eq("active", true).order("id", { ascending: true }).range(from, to));
  },
  dayInstance(sb, a) {
    return findDayInstance<InstanceRow>(sb, { locationId: a.shopId, type: a.type, date: a.date, columns: INSTANCE_COLUMNS });
  },
  async completedItems(sb, instanceId) {
    const rows = await selectAllRows<{ template_item_id: string }>((from, to) => sb.from("checklist_completions")
      .select("template_item_id").eq("instance_id", instanceId).is("revoked_at", null).is("superseded_at", null)
      .order("id", { ascending: true }).range(from, to));
    return rows.map((r) => r.template_item_id);
  },
  async phase1At(sb, instanceId) {
    // One row by design: the first non-final submission is Phase 1's (0055).
    const data = must(await sb.from("checklist_submissions").select("submitted_at").eq("instance_id", instanceId)
      .eq("is_final_confirmation", false).order("submitted_at", { ascending: true }).limit(1), "phase1At") as Array<{ submitted_at: string }> | null;
    return data?.[0]?.submitted_at ?? null;
  },
  prepInstances(sb, a) {
    return findPrepDayInstances<InstanceRow>(sb, { locationId: a.shopId, subtype: a.subtype, date: a.date, columns: INSTANCE_COLUMNS });
  },
  async userNames(sb, ids) {
    const rows = await inChunks([...new Set(ids)], async (chunk) => (must(await sb.from("users").select("id, name").in("id", chunk), "userNames") ?? []) as Array<{ id: string; name: string }>);
    return new Map(rows.map((r) => [r.id, r.name]));
  },
  async cashReport(sb, shopId, date) {
    return must(await sb.from("cash_reports").select("signed_at, signed_by").eq("location_id", shopId).eq("report_date", date)
      .is("superseded_at", null).maybeSingle<{ signed_at: string | null; signed_by: string | null }>(), "cash");
  },
  async pmReport(sb, shopId, date) {
    return must(await sb.from("pm_reports").select("status, submitted_at, submitted_by").eq("location_id", shopId).eq("report_date", date)
      .is("superseded_at", null).maybeSingle<{ status: string; submitted_at: string | null; submitted_by: string | null }>(), "pm");
  },
  vendors(sb) {
    return selectAllRows<VendorRow>((from, to) => sb.from("vendors").select("id, name, source_kind, active").order("id").range(from, to));
  },
  cutoffs(sb, shopId) {
    // Every weekday: the engine picks today's and tomorrow's (the digest's cutoffsTomorrow).
    return selectAllRows<CutoffRow>((from, to) => sb.from("vendor_cutoffs").select("vendor_id, location_id, order_day, cutoff_time").eq("active", true)
      .or(`location_id.is.null,location_id.eq.${shopId}`).order("id").range(from, to));
  },
  recentPos(sb, shopId, sinceIso) {
    return selectAllRows<PoRow>((from, to) => sb.from("purchase_orders").select("id, display_code, vendor_id, status, created_at, confirmed_at, placed_at")
      .eq("location_id", shopId).or(`created_at.gte.${sinceIso},confirmed_at.gte.${sinceIso},placed_at.gte.${sinceIso}`).order("id").range(from, to));
  },
  async rhythm(sb, shopId) {
    const [rows, skips] = await Promise.all([
      selectAllRows<RhythmDbRow>((from, to) => sb.from("vendor_delivery_rhythm").select("vendor_id, location_id, order_dow, lead_days")
        .eq("active", true).eq("location_id", shopId).order("id").range(from, to)),
      selectAllRows<SkipDbRow>((from, to) => sb.from("vendor_rhythm_skips").select("vendor_id, skip_from, skip_through")
        .eq("active", true).eq("location_id", shopId).order("id").range(from, to)),
    ]);
    return { rows, skips };
  },
  halfLogged(sb, shopId) {
    // Uncapped, no date window: a half-logged delivery from any day is still open work.
    return selectAllRows<{ id: string; vendor_id: string; created_at: string }>((from, to) => sb.from("vendor_deliveries").select("id, vendor_id, created_at")
      .eq("location_id", shopId).eq("delivery_status", "in_progress").order("id").range(from, to));
  },
  async openOrders(sb, shopId) {
    // Every open order (uncapped, no window); one with a COMPLETE delivery is dropped (a half-logged one never clears it).
    const orders = await selectAllRows<PoRow>((from, to) => sb.from("purchase_orders").select("id, display_code, vendor_id, status, created_at, confirmed_at, placed_at")
      .eq("location_id", shopId).in("status", [...DAY_OPEN_ORDER]).order("id").range(from, to));
    const done = new Set((await inChunks(orders.map((o) => o.id), (chunk) => selectAllRows<{ purchase_order_id: string }>((from, to) => sb.from("vendor_deliveries")
      .select("purchase_order_id").in("purchase_order_id", chunk).eq("delivery_status", "complete").order("id").range(from, to)))).map((d) => d.purchase_order_id));
    return orders.filter((o) => !done.has(o.id));
  },
  completedOn(sb, shopId, date) {
    return selectAllRows<{ id: string; vendor_id: string; created_at: string }>((from, to) => sb.from("vendor_deliveries").select("id, vendor_id, created_at")
      .eq("location_id", shopId).eq("delivery_date", date).eq("delivery_status", "complete").order("id").range(from, to));
  },
  async booked(sb, shopId, dates) {
    // The reused reader keeps its projection; only these fields cross into the loader (no name, address or money).
    return (await loadBookedCateringEvents(sb, { locationId: shopId, dates })).map((b) => ({ id: b.id, eventDate: b.eventDate, timeWindow: b.timeWindow, headcount: b.headcount, stage: b.stage }));
  },
  async ezcater(sb, shopId, dates) {
    return (await loadEzcater(sb, shopId, dates)).map((o) => ({ id: o.id, event_date: o.event_date, event_timestamp: o.event_timestamp, handoff_time: o.handoff_time, headcount: o.headcount, status: o.status }));
  },
  outEvents(sb, pipelineIds) {
    return inChunks([...pipelineIds], (chunk) => selectAllRows<{ pipeline_id: string; to_stage: string; created_at: string }>((from, to) => sb.from("catering_pipeline_events")
      .select("pipeline_id, to_stage, created_at").in("pipeline_id", chunk).in("to_stage", ["out", "completed"]).order("id").range(from, to)));
  },
  async flaggedLines(sb, shopId, dates) {
    const rows = await selectAllRows<PrepDemandRow>((from, to) => sb.from("catering_prep_demand")
      .select("pipeline_id, need_date, item_id, menu_item_id, choice_package_item_id, portion, qty")
      .eq("location_id", shopId).eq("status", "reserved").in("need_date", [...dates]).order("id", { ascending: true }).range(from, to));
    const ids = [...new Set(rows.flatMap((r) => (r.item_id ? [r.item_id] : [])))];
    if (ids.length === 0) return flaggedLineCounts(rows, { defaults: new Map(), overrides: new Map() });
    const [defaults, overrides] = [await loadItemDefns(sb, ids), await loadItemOverrides(sb, ids, shopId)];
    return flaggedLineCounts(rows, { defaults, overrides });
  },
  ownTasks(sb, a) {
    return loadOwnTaskAssignments(sb, { actor: { userId: a.viewer.userId, role: a.viewer.role, level: a.viewer.level, locations: [...a.locations] }, locationId: a.shopId, date: a.date });
  },
  async stationBusinessDate(sb, shopId) {
    const { data, error } = await sb.rpc("station_business_date", { p_location_id: shopId });
    if (error || typeof data !== "string") throw new Error(`station_business_date: ${error?.code ?? "no date"}`);
    return data;
  },
  async ownStationEvents(sb, a) {
    const rows = await selectAllRows<Record<string, unknown>>((from, to) => sb.from("station_events")
      .select("id, sequence::text, location_id, business_date, user_id, station_id, position_id, kind, at, source, reason_code, prior_position_id, effective_at")
      .eq("location_id", a.shopId).eq("business_date", a.businessDate).eq("user_id", a.userId).order("sequence").range(from, to));
    return rows.map((r): StationEvent => ({
      id: String(r.id), sequence: String(r.sequence), locationId: String(r.location_id), businessDate: String(r.business_date), userId: String(r.user_id),
      stationId: (r.station_id as string | null) ?? null, positionId: (r.position_id as string | null) ?? null, kind: r.kind as StationEvent["kind"],
      actorId: null, actorName: null, at: String(r.at), source: (r.source as StationEvent["source"]) ?? null,
      releaseReason: r.reason_code === "station_closed" ? "station_closed" : undefined,
      priorPositionId: (r.prior_position_id as string | null) ?? null, effectiveAt: (r.effective_at as string | null) ?? null,
    }));
  },
  async stationWithPositions(sb, a) {
    let stationId = a.stationId ?? null;
    if (!stationId && a.positionId) {
      const p = must(await sb.from("station_positions").select("station_id").eq("id", a.positionId).eq("location_id", a.shopId).maybeSingle<{ station_id: string }>(), "position");
      stationId = p?.station_id ?? null;
    }
    if (!stationId) return null;
    const s = must(await sb.from("stations").select("id, name, name_es, sort, active, staffed").eq("id", stationId).eq("location_id", a.shopId)
      .maybeSingle<{ id: string; name: string; name_es: string | null; sort: number; active: boolean; staffed: boolean }>(), "station");
    if (!s) return null;
    const positions = await selectAllRows<{ id: string; active: boolean }>((from, to) => sb.from("station_positions").select("id, active")
      .eq("station_id", s.id).eq("location_id", a.shopId).order("id").range(from, to));
    return { id: s.id, name: s.name, nameEs: s.name_es, sort: s.sort, active: s.active, staffed: s.staffed,
      positions: positions.map((p) => ({ id: p.id, stationId: s.id, name: "", nameEs: null, duty: null, dutyEs: null, sort: 0, active: p.active })) };
  },
};

// ── Lanes ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ok = <T>(value: T): Fact<T> => ({ kind: "ok", value });
const FAILED = { kind: "failed" } as const;
function logArea(area: string, e: unknown): void {
  // The area and the error's kind only: never row content.
  console.error(`day-plan: ${area} failed (${e instanceof DayFactTimeout ? "deadline" : e instanceof Error ? e.name : "error"})`);
}

interface Deadline { race<T>(p: Promise<T>): Promise<T>; clear(): void }
/** ONE deadline for the load: a rejecting race every lane runs against, and the abort of every lane's queries. */
function startDeadline(ms: number, controller: AbortController): Deadline {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new DayFactTimeout()); }, ms);
  });
  fired.catch(() => undefined);
  return {
    race: <T>(p: Promise<T>) => Promise.race([p, fired]),
    clear: () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; },
  };
}

/** Run one lane: a value, or (thrown or timed out) the area logged and the error rethrown for `fact()`. */
function lane<T>(d: Deadline, area: string, run: () => Promise<T>): Promise<T> {
  const p = d.race(Promise.resolve().then(run));
  p.catch((e: unknown) => logArea(area, e));
  return p;
}
async function fact<T>(p: Promise<T>): Promise<Fact<T>> {
  try { return ok(await p); } catch { return FAILED; }
}
/** A "Degrades" read: its failure only blanks a display field. */
async function degrade<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

// ── The entry ────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function loadDayFacts(service: SupabaseClient, args: DayFactsArgs, deps: DayFactDeps = defaultDayFactDeps): Promise<DayPlanInput> {
  const { date: planDate, minutesOfDay: nowMin } = operationalNow(args.now);
  if (lensFor(args.viewer.role) === "smm") return { planDate, nowMin, viewer: args.viewer, facts: await loadSmmFacts(service, args, planDate, deps) };
  const controller = new AbortController();
  const deadline = startDeadline(DAY_FACT_DEADLINE_MS, controller);
  try {
    return { planDate, nowMin, viewer: args.viewer, facts: await loadShopFacts(withAbort(service, controller.signal), args, planDate, deps, deadline) };
  } finally {
    deadline.clear();
  }
}

async function loadShopFacts(sb: Sb, args: DayFactsArgs, planDate: string, deps: DayFactDeps, d: Deadline): Promise<ShopFacts> {
  const shopId = args.shop.id;
  const yesterday = addDaysEt(planDate, -1);
  const tomorrow = addDaysEt(planDate, 1);
  const need = factsNeeded(args.viewer);
  const L = <T>(area: string, run: () => Promise<T>) => lane(d, area, run);

  // ── Start every lane at once ──
  const hoursP = L("hours", () => deps.shopDay(sb, shopId));
  // The board: the page's promise, raced, never aborted (ruling B2).
  const boardP: Promise<ShiftBoard> | null = need.board && args.board ? L("board", () => args.board!()) : null;
  // The stations' classification (S2, and S3a while 0353 is not applied): only when there is a board to classify.
  const classificationP: Promise<{ flags: StationDayFlags; notPhase: NotPhaseRule }> | null = boardP ? L("stations", async () => {
    const flags = await deps.stationFlags(sb, shopId);
    if (flags.installed) return { flags, notPhase: { installed: true, ids: flags.notPhaseIds } };
    return { flags, notPhase: { installed: false, sections: notPhaseSections(await deps.closingClassification(sb, shopId, planDate)) } };
  }) : null;
  const closingP = L("closing", () => deps.dayInstance(sb, { shopId, type: "closing", date: planDate }));
  const openingP = L("opening", () => deps.dayInstance(sb, { shopId, type: "opening", date: planDate }));
  const yesterdayP = L("yesterdayClosing", () => deps.dayInstance(sb, { shopId, type: "closing", date: yesterday }));
  const amPrepP = L("amPrep", async () => pickDayInstance(await deps.prepInstances(sb, { shopId, subtype: "am_prep", date: planDate })));
  const midDayP = L("midDay", () => deps.prepInstances(sb, { shopId, subtype: "mid_day_prep", date: planDate }));
  const cashP = need.ops ? L("cash", () => deps.cashReport(sb, shopId, planDate)) : null;
  const pmP = need.ops ? L("pm", () => deps.pmReport(sb, shopId, planDate)) : null;
  const vendorsP = need.ops ? L("vendors", () => deps.vendors(sb)) : null;
  const orderingP = need.ops ? L("ordering", async () => {
    const [vendors, cutoffs, pos] = await Promise.all([vendorsP!, deps.cutoffs(sb, shopId), deps.recentPos(sb, shopId, etDayRange(addDaysEt(planDate, -2)).startIso)]);
    return { forDate: planDate, vendors: vendors.map(vendorFact), cutoffs: cutoffs.map(cutoffFact), pos: pos.map(poFact) } satisfies OrderingFacts;
  }) : null;
  const rhythmP = need.ops ? L("rhythm", async () => {
    const r = await deps.rhythm(sb, shopId);
    return { rows: r.rows.map(rhythmRow), skips: r.skips.map(rhythmSkip) } satisfies RhythmFacts;
  }) : null;
  const receivingP = need.ops ? L("receiving", async () => {
    const [vendors, half, open, done] = await Promise.all([vendorsP!, deps.halfLogged(sb, shopId), deps.openOrders(sb, shopId), deps.completedOn(sb, shopId, planDate)]);
    return {
      forDate: planDate, vendors: vendors.map(vendorFact), openOrders: open.map(poFact),
      halfLogged: half.map((h) => ({ id: h.id, vendorId: h.vendor_id, startedAt: h.created_at })),
      completedToday: done.map((c) => ({ id: c.id, vendorId: c.vendor_id, at: c.created_at })),
    } satisfies ReceivingFacts;
  }) : null;
  const cateringP = L("catering", async () => {
    const [booked, ez] = await Promise.all([deps.booked(sb, shopId, [planDate, tomorrow]), deps.ezcater(sb, shopId, [planDate, tomorrow])]);
    return { booked, ez };
  });
  const flaggedP = need.flaggedLines ? L("flaggedLines", async () => {
    const counts = await deps.flaggedLines(sb, shopId, [planDate, tomorrow]);
    return { today: counts[planDate] ?? 0, tomorrow: counts[tomorrow] ?? 0 };
  }) : null;

  // ── Degrades: display fields only ──
  const sectionsLeftP = degrade(L("closing.sectionsLeft", async () => {
    const inst = await closingP;
    if (!inst) return null;
    const [items, done] = await Promise.all([deps.templateItems(sb, inst.template_id), deps.completedItems(sb, inst.id)]);
    return sectionsLeft(items, new Set(done));
  }), null);
  const phase1P = degrade(L("opening.phase1At", async () => {
    const inst = await openingP;
    return inst && inst.status !== "open" ? deps.phase1At(sb, inst.id) : null;
  }), null);
  const namesP = degrade(L("names", async () => {
    const settled = await Promise.allSettled([closingP, openingP, amPrepP, midDayP, cashP ?? Promise.resolve(null), pmP ?? Promise.resolve(null)]);
    const value = <T>(i: number) => (settled[i]!.status === "fulfilled" ? (settled[i] as PromiseFulfilledResult<T>).value : null);
    const ids = [value<InstanceRow | null>(0)?.confirmed_by, value<InstanceRow | null>(1)?.confirmed_by, value<InstanceRow | null>(2)?.confirmed_by,
      ...(value<InstanceRow[]>(3) ?? []).map((r) => r.confirmed_by),
      value<{ signed_by: string | null } | null>(4)?.signed_by, value<{ submitted_by: string | null } | null>(5)?.submitted_by]
      .filter((x): x is string => typeof x === "string" && x !== "");
    return ids.length === 0 ? new Map<string, string>() : deps.userNames(sb, ids);
  }), new Map<string, string>());
  const outP = degrade(L("catering.outAt", async () => {
    const { booked } = await cateringP;
    const ids = booked.filter((b) => b.eventDate === planDate && (b.stage === "out" || b.stage === "completed")).map((b) => b.id);
    return ids.length === 0 ? new Map<string, string>() : outTimes(await deps.outEvents(sb, ids));
  }), new Map<string, string>());

  // ── Build the facts ──
  const names = await namesP;
  const nameOf = (id: string | null | undefined) => firstName(id ? names.get(id) : null);
  const instanceDay = async (p: Promise<InstanceRow | null>, forDate: string, extra: () => Promise<Partial<ChecklistDay>>): Promise<Fact<ChecklistDay>> => {
    const f = await fact(p);
    if (f.kind === "failed") return f;
    return ok(checklistDay(forDate, f.value, { ...(await extra()), finishedByName: nameOf(f.value?.confirmed_by) }));
  };
  const reportFact = async <R>(p: Promise<R> | null, map: (r: R) => ReportDay): Promise<Fact<ReportDay>> => {
    if (!p) return FAILED;
    const f = await fact(p);
    if (f.kind === "failed") return f;
    try { return ok(map(f.value)); } catch (e) { logArea("report", e); return FAILED; }
  };
  const optional = async <T>(p: Promise<T> | null): Promise<Fact<T>> => (p ? fact(p) : FAILED);

  const catering = await fact(cateringP);
  const outAt = await outP;
  const rules = { eventQFromWindow, etWallQ, ezcaterCancelled };
  const cateringFact = (date: string): Fact<CateringDay> => (catering.kind === "failed" ? FAILED
    : ok({ forDate: date, orders: cateringOrders(date, catering.value.booked, catering.value.ez, outAt, rules) }));

  const board = boardP ? await fact(boardP) : null;
  const boardFacts = await buildBoardFacts(args, planDate, need.board, board, classificationP ? await fact(classificationP) : null);

  return {
    kind: "shop",
    shop: { id: args.shop.id, code: args.shop.code },
    hours: await fact(hoursP),
    stations: boardFacts.stations,
    opening: await instanceDay(openingP, planDate, async () => ({ phase1At: await phase1P })),
    closing: await instanceDay(closingP, planDate, async () => ({ sectionsLeft: await sectionsLeftP })),
    amPrep: await instanceDay(amPrepP, planDate, async () => ({})),
    midDay: await (async (): Promise<Fact<MidDayDay>> => { const f = await fact(midDayP); return f.kind === "failed" ? f : ok(midDayDay(planDate, f.value, names)); })(),
    cash: await reportFact(cashP, (r) => cashDay(planDate, r, names)),
    pm: await reportFact(pmP, (r) => pmDay(planDate, r, names)),
    ordering: await optional(orderingP),
    rhythm: await optional(rhythmP),
    receiving: await optional(receivingP),
    cateringToday: cateringFact(planDate),
    cateringTomorrow: cateringFact(tomorrow),
    flaggedLines: await optional(flaggedP),
    assignments: boardFacts.assignments,
    myStation: boardFacts.myStation,
    // A constant: the database has no "count in progress" (ruling 3); excluded from the all-failed predicate (B5).
    counts: ok({ inProgress: false }),
    yesterdayClosing: await instanceDay(yesterdayP, yesterday, async () => ({})),
    holdsStationOnStationDay: boardFacts.holdsStationOnStationDay,
  };
}

/** Stations, assignments, my station (C1, C3, C4): from the board, the flags and (before 0353) the classification. */
async function buildBoardFacts(
  args: DayFactsArgs, planDate: string, needBoard: boolean, board: Fact<ShiftBoard> | null,
  classification: Fact<{ flags: StationDayFlags; notPhase: NotPhaseRule }> | null,
): Promise<Pick<ShopFacts, "stations" | "assignments" | "myStation" | "holdsStationOnStationDay">> {
  if (!needBoard) {
    // The tasks-only viewer (section 6): the task-day reader has not shipped, so nothing station-shaped is shown.
    return { stations: { kind: "not_shown" }, assignments: { kind: "not_shown" }, myStation: ok(null), holdsStationOnStationDay: false };
  }
  if (!board || board.kind === "failed") return { stations: FAILED, assignments: FAILED, myStation: FAILED, holdsStationOnStationDay: false };
  const b = board.value;
  const userId = args.viewer.userId;
  let stations: StationsFact;
  if (!b.stationDate) stations = FAILED;
  else if (b.stationDate !== planDate) stations = { kind: "another_day", stationDate: b.stationDate };
  else if (!classification || classification.kind === "failed") stations = FAILED;
  else {
    const rows: DayStation[] = dayStations(b.stations, classification.value.flags, classification.value.notPhase);
    stations = { kind: "ok", value: { stationDate: b.stationDate, stations: rows } };
  }
  const assignments: Fact<AssignmentFacts> = ok({ forDate: b.date, scope: "all_tasks", rows: dayAssignments(b.tasks) });
  return {
    stations,
    assignments,
    myStation: ok(resolveMyStation(b, userId)),
    holdsStationOnStationDay: !!currentFloorStation(b, userId)?.stationId,
  };
}

// ── The social media manager (section 7): own rows only, never a shop read, never the board ─────────────────────────

async function loadSmmFacts(service: SupabaseClient, args: DayFactsArgs, planDate: string, deps: DayFactDeps): Promise<SmmFacts> {
  const controller = new AbortController();
  const d = startDeadline(DAY_FACT_DEADLINE_MS, controller);
  const sb = withAbort(service, controller.signal);
  const shopId = args.shop.id;
  const userId = args.viewer.userId;
  try {
    const tasksP = lane(d, "smm.ownTasks", async () => {
      const own = smmChecklistTasks(await deps.ownTasks(sb, { viewer: args.viewer, shopId, locations: args.locations, date: planDate }));
      const state = async (task: (typeof own)[number]): Promise<SmmTaskStatus> => {
        if (task === "opening_report") return smmTaskState([(await deps.dayInstance(sb, { shopId, type: "opening", date: planDate }))?.status ?? null]);
        const rows = await deps.prepInstances(sb, { shopId, subtype: task === "am_prep" ? "am_prep" : "mid_day_prep", date: planDate });
        return smmTaskState(task === "am_prep" ? [pickDayInstance(rows)?.status ?? null] : rows.map((r) => r.status));
      };
      return Promise.all(own.map(async (task) => ({ task, status: await state(task) })));
    });
    const stationP = lane(d, "smm.ownStation", async () => {
      const businessDate = await deps.stationBusinessDate(sb, shopId);
      const ref = smmStationRef(await deps.ownStationEvents(sb, { shopId, userId, businessDate }), userId);
      if (!ref) return null;
      const station = await deps.stationWithPositions(sb, "stationId" in ref ? { shopId, stationId: ref.stationId } : { shopId, positionId: ref.priorPositionId });
      return station && isFloorStation(station) ? { name: station.name, nameEs: station.nameEs } : null;
    });
    return { kind: "smm", ownTasks: await fact(tasksP), ownStation: await fact(stationP) };
  } finally {
    d.clear();
  }
}
