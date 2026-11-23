/**
 * THE DAY LOADER'S PURE HALF (nav PR 6, plan r3; lib/day-plan.ts is the server half). Zero I/O, no clock, client-safe:
 * the row → fact mappers, the B1 "not a phase station" rule in code (`notPhaseSections`, the 0353 backfill's own rule),
 * the effective closing template pick, the "sections left" count, which facts a viewer needs, the first-name rule and
 * the social media manager's task state. A purity scan (tests/day-plan-pure.test.ts) holds it to the engine's rules, and
 * it never reads "works as" (tests/day-plan-works-as.test.ts).
 */
import { CHECKLIST_TASKS, type CateringOrder, type ChecklistDay, type DayAssignment, type DayStation, type DayViewer, type MidDayDay, type ReportDay, type ShopHours } from "@/lib/day-plan-shared";
import { currentStation, isFloorStation, type Station, type StationDayFlags, type StationEvent, type TaskAssignment, type TaskType } from "@/lib/assignments-shared";
import { deriveCloseState } from "@/lib/dashboard-status-shared";
import { DELIVERY_UNKNOWN, deliveryAlerts, deliveryRowStateOf, type DeliveryAlert, type DeliveryDayLead, type DeliveryDayResult, type DeliveryRowState } from "@/lib/delivery/day-shared";
import type { PoFact, VendorCutoff, VendorFact } from "@/lib/report-digests-v2-shared";
import { dayPrepStartFor, type DayPrepStart } from "@/lib/scheduling/opening-shared";
import type { ScheduleStructure } from "@/lib/scheduling/structure-shared";
import type { RhythmRow, RhythmSkip } from "@/lib/vendor-rhythm-shared";

// ── Names ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The board's first-name rule (lib/assignments.ts: the first word of the trimmed name); null for no name. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

// ── Shop day (H1) ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The base-hours read's half of `hours` (the saved shop day and catering setting); the per-date starts come from SCH's own read. */
export type BaseShopHours = Omit<ShopHours, "dayPrepStartQ">;

/** The `hours` fact's base from the live structure. A non-finite quarter value throws (the fact fails, never a guess). */
export function shopHoursFrom(live: { structure: ScheduleStructure; source: "saved" | "defaults" }): BaseShopHours {
  const { shopDay, catering } = live.structure;
  const quarters = [shopDay.prepStartQ, shopDay.serviceStartQ, catering.minHeadcount, catering.leadMinutes, catering.defaultStartQ,
    catering.defaultEndQ, catering.extraPrepDishHeads];
  if (!quarters.every((v) => typeof v === "number" && Number.isFinite(v))) throw new Error("shop day: non-finite value");
  return {
    source: live.source,
    shopDay: { prepStartQ: shopDay.prepStartQ, serviceStartQ: shopDay.serviceStartQ },
    catering: { minHeadcount: catering.minHeadcount, leadMinutes: catering.leadMinutes, defaultStartQ: catering.defaultStartQ,
      defaultEndQ: catering.defaultEndQ, extraPrepDishHeads: catering.extraPrepDishHeads },
  };
}

// ── The schedule's start per date (PR SCH, plan r5 22.3; rulings D5, F3, G) ─────────────────────────────────────────

/** The three batched schedule reads for the plan date and tomorrow, as rows (lib/day-plan.ts `scheduleStarts`). */
export interface ScheduleStartRows {
  /** schedule_weeks of the shop for the dates' weeks. */
  weeks: ReadonlyArray<{ week_start: string; head_revision_id: string | null }>;
  /** schedule_revision_days of those heads on the dates. */
  days: ReadonlyArray<{ revision_id: string; business_date: string; origin_revision_id: string | null }>;
  /** revision id → date → the stored `days.<date>.structure.shopDay.prepStartQ` of that revision's context (absent = not read). */
  starts: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * The pure mapping: per date, its week's head → the date's row on the head → the context of the row's origin revision (else
 * the head's) → `dayPrepStartFor` (no week / no head = absent; a missing row or start = unknown; else scheduled).
 */
export function dayPrepStarts(rows: ScheduleStartRows, dates: readonly string[], weekOf: (date: string) => string): Record<string, DayPrepStart> {
  const out: Record<string, DayPrepStart> = {};
  for (const date of dates) {
    const head = rows.weeks.find((w) => w.week_start === weekOf(date))?.head_revision_id ?? null;
    const row = head ? rows.days.find((d) => d.revision_id === head && d.business_date === date) : undefined;
    const holder = row ? row.origin_revision_id ?? head! : null;
    const read = holder && Object.hasOwn(rows.starts, holder) ? { kind: "ok" as const, prepStartQ: rows.starts[holder]![date] } : { kind: "failed" as const };
    const start = dayPrepStartFor({ week: head ? "present" : "none", dayRow: row ? { originRevisionId: row.origin_revision_id } : "none", context: read });
    if (start) out[date] = start;
  }
  return out;
}

// ── Stations (S1-S3) ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A closing template version as the effective pick reads it. */
export interface ClosingTemplateRow { id: string; effective_from: string | null; created_at: string; active: boolean; type?: string }

/**
 * The shop's EFFECTIVE closing template on `date`, picked exactly as the closing-station sync (lib/closing-stations.ts)
 * and the 0353 backfill pick it: type closing, active, effective_from null or ≤ date; newest effective_from (nulls
 * last), then newest created_at. null = the shop has no active closing template.
 */
export function pickEffectiveClosingTemplate(rows: readonly ClosingTemplateRow[], date: string): string | null {
  return [...rows]
    .filter((t) => (t.type === undefined || t.type === "closing") && t.active && (t.effective_from === null || t.effective_from <= date))
    .sort((a, b) => (b.effective_from ?? "").localeCompare(a.effective_from ?? "") || b.created_at.localeCompare(a.created_at))[0]?.id ?? null;
}

/** A closing template item as the classification read returns it. */
export interface ClassificationItem { station: string | null; active: boolean; report_reference_type: string | null }

/**
 * B1 IN CODE (rulings 1b / 1c): the trimmed section names whose ACTIVE items include AT LEAST ONE report reference.
 * The 0353 backfill's rule, used only while 0353 is not applied; a twin test pins the two equal.
 */
export function notPhaseSections(items: readonly ClassificationItem[]): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    const name = item.station?.trim();
    if (name && item.active && item.report_reference_type !== null && item.report_reference_type !== undefined) out.add(name);
  }
  return out;
}

/** "Not a phase station" for one station: the column once 0353 is installed, else the code rule over S3a's items. */
export type NotPhaseRule = { readonly installed: true; readonly ids: ReadonlySet<string> } | { readonly installed: false; readonly sections: ReadonlySet<string> };

/** The stations fact's rows: every ACTIVE board station, floor = isFloorStation and not "not a phase station". */
export function dayStations(stations: readonly Station[], flags: StationDayFlags, notPhase: NotPhaseRule): DayStation[] {
  return stations.filter((s) => s.active).map((s) => {
    const off = notPhase.installed ? notPhase.ids.has(s.id) : notPhase.sections.has(s.name);
    return {
      id: s.id, name: s.name, nameEs: s.nameEs, sort: s.sort,
      floor: isFloorStation(s) && !off,
      startsMidDay: flags.installed && flags.midDayStationId === s.id,
      // Copied raw (C4): never parsed, never compared here.
      usuallyClosesAt: s.usuallyClosesAt ?? null,
      closedAt: s.closedAt ?? null,
    };
  });
}

/** The assignments fact's rows, from the board's tasks. */
export function dayAssignments(tasks: readonly TaskAssignment[]): DayAssignment[] {
  return tasks.map((t) => ({ id: t.id, task: t.task, assigneeId: t.assigneeId, firstName: firstName(t.assigneeName),
    available: t.available !== false, source: t.source ?? null }));
}

// ── Checklists and reports (K1-K8, P1, P2) ───────────────────────────────────────────────────────────────────────────

/** A day instance as the loader reads it (findDayInstance / findPrepDayInstances columns). */
export interface InstanceRow { id: string; template_id: string; status: string; created_at: string | null; confirmed_at: string | null; confirmed_by: string | null }

export function checklistDay(forDate: string, row: InstanceRow | null, extra: { phase1At?: string | null; finishedByName?: string | null; sectionsLeft?: number | null } = {}): ChecklistDay {
  return {
    forDate,
    status: row?.status ?? null,
    phase1At: extra.phase1At ?? null,
    finishedAt: row?.confirmed_at ?? null,
    finishedByName: extra.finishedByName ?? null,
    sectionsLeft: extra.sectionsLeft ?? null,
    finishedById: row?.confirmed_by ?? null,
  };
}

export function midDayDay(forDate: string, rows: readonly InstanceRow[], names: ReadonlyMap<string, string>): MidDayDay {
  return { forDate, instances: rows.map((r) => ({ status: r.status, finishedAt: r.confirmed_at, finishedByName: firstName(r.confirmed_by ? names.get(r.confirmed_by) : null) })) };
}

/** P1: the one live cash report of the day. */
export function cashDay(forDate: string, row: { signed_at: string | null; signed_by: string | null } | null, names: ReadonlyMap<string, string>): ReportDay {
  if (!row) return { forDate, state: "none", at: null, byName: null };
  return { forDate, state: "submitted", at: row.signed_at, byName: firstName(row.signed_by ? names.get(row.signed_by) : null) };
}

/** P2: the one live PM report of the day. `auto_finalized` is submitted AND autoFinalized (ruling 7), never "confirmed". */
export function pmDay(forDate: string, row: { status: string; submitted_at: string | null; submitted_by: string | null } | null, names: ReadonlyMap<string, string>): ReportDay {
  if (!row) return { forDate, state: "none", at: null, byName: null };
  if (row.status === "open") return { forDate, state: "draft", at: null, byName: null };
  if (row.status === "submitted" || row.status === "incomplete_confirmed" || row.status === "auto_finalized") {
    return { forDate, state: "submitted", at: row.submitted_at, byName: firstName(row.submitted_by ? names.get(row.submitted_by) : null),
      ...(row.status === "auto_finalized" ? { autoFinalized: true } : {}) };
  }
  throw new Error("pm report: unknown status");
}

/**
 * Closing progress (as 0230's station_closures defines a section): the instance template's ACTIVE items grouped by
 * `btrim(station)` (a blank station is one section); a section is left while any of its items has no live completion.
 */
export function sectionsLeft(items: readonly { id: string; station: string | null; active: boolean }[], completed: ReadonlySet<string>): number {
  const open = new Map<string, boolean>();
  for (const item of items) {
    if (!item.active) continue;
    const key = item.station?.trim() ?? "";
    open.set(key, (open.get(key) ?? false) || !completed.has(item.id));
  }
  return [...open.values()].filter(Boolean).length;
}

// ── Ordering, rhythm, receiving (O1-O3, Y1, R1-R3) ──────────────────────────────────────────────────────────────────

export type VendorRow = { id: string; name: string; source_kind: "vendor" | "store"; active: boolean };
export const vendorFact = (v: VendorRow): VendorFact => ({ id: v.id, name: v.name, sourceKind: v.source_kind, active: v.active });
export type CutoffRow = { vendor_id: string; location_id: string | null; order_day: number; cutoff_time: string };
export const cutoffFact = (c: CutoffRow): VendorCutoff => ({ vendorId: c.vendor_id, locationId: c.location_id, orderDay: c.order_day, cutoffTime: c.cutoff_time });
export type PoRow = { id: string; display_code: string; vendor_id: string; status: string; created_at: string; confirmed_at: string | null; placed_at: string | null };
/** No money is read: the digest's money fields are filled null / 0 / null (the engine never reads them; a source test pins it). */
export const poFact = (r: PoRow): PoFact => ({ id: r.id, displayCode: r.display_code, vendorId: r.vendor_id, status: r.status, createdAt: r.created_at,
  confirmedAt: r.confirmed_at, placedAt: r.placed_at, placedByName: null, totalCents: null, unpricedLines: 0 });
export type RhythmDbRow = { vendor_id: string; location_id: string; order_dow: number; lead_days: number };
export const rhythmRow = (r: RhythmDbRow): RhythmRow => ({ vendorId: r.vendor_id, locationId: r.location_id, orderDow: r.order_dow, leadDays: r.lead_days });
export type SkipDbRow = { vendor_id: string; skip_from: string; skip_through: string };
export const rhythmSkip = (s: SkipDbRow): RhythmSkip => ({ vendorId: s.vendor_id, skipFrom: s.skip_from, skipThrough: s.skip_through });

// ── Catering (C1-C3) ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A booked pipeline event, as the loader keeps it (no name, address or money crosses into the fact). */
export interface BookedRow { id: string; eventDate: string; timeWindow: string | null; headcount: number | null; stage: string }
export interface EzcaterRow { id: string; event_date: string | null; event_timestamp: string | null; handoff_time: string | null; headcount: number | null; status: string | null }

const PIPELINE_STATE: Record<string, CateringOrder["state"]> = { confirmed: "to_go_out", out: "out", completed: "completed" };

/**
 * The schedule's own time and cancel rules (lib/scheduling/inputs-shared.ts: eventQFromWindow, etWallQ,
 * ezcaterCancelled), passed in by the server half: that module's import closure reaches modules this pure file must not.
 */
export interface CateringRules {
  eventQFromWindow(text: string | null): number | null;
  etWallQ(iso: string): number;
  ezcaterCancelled(status: string | null): boolean;
}

/**
 * Catering delivery D3: the day's delivery read as the loader hands it to `cateringOrders`. `ok` = the fact's leads;
 * `failed` = the read failed (every pipeline order reads "Couldn't load delivery", never "to book").
 */
export type CateringDeliveryInput = { readonly kind: "ok"; readonly leads: readonly DeliveryDayLead[] } | { readonly kind: "failed" };

/** The day's delivery lane as facts: nothing when it is off, a failure when it failed or timed out. */
export function deliveryInput(result: DeliveryDayResult | null): CateringDeliveryInput | undefined {
  if (result === null) return { kind: "failed" };
  if ("off" in result) return undefined;
  return result.ok ? { kind: "ok", leads: result.leads } : { kind: "failed" };
}

/** The leads of the delivery fact with NO order row among `orders` that still need a person (D3's alerts). */
export function cateringDeliveryAlerts(orders: readonly CateringOrder[], delivery: Extract<CateringDeliveryInput, { kind: "ok" }>): DeliveryAlert[] {
  return deliveryAlerts(delivery.leads, new Set(orders.filter((o) => o.source === "pipeline").map((o) => o.id)));
}

/**
 * One day's orders: the pipeline's booked events and the unlinked ezCater orders on `date`.
 * D3: with `delivery` (the plan date's own lane; never passed for another day), each PIPELINE order carries its lead's
 * delivery state, attached by lead id (a pipeline order's id IS its lead's). An ezCater order here is by definition not
 * linked to a lead (the read filters `lead_id is null`), so it carries none; a linked one arrives as its lead.
 * Without `delivery` the orders are exactly what they were before D3 (no key added).
 */
export function cateringOrders(date: string, booked: readonly BookedRow[], ezcater: readonly EzcaterRow[], outAt: ReadonlyMap<string, string>, rules: CateringRules,
  delivery?: CateringDeliveryInput): CateringOrder[] {
  const { eventQFromWindow, etWallQ, ezcaterCancelled } = rules;
  const out: CateringOrder[] = [];
  const byLead = delivery?.kind === "ok" ? new Map(delivery.leads.map((l) => [l.leadId, l])) : null;
  const deliveryOf = (leadId: string): { delivery: DeliveryRowState | null } | Record<string, never> => {
    if (!delivery) return {};
    if (!byLead) return { delivery: DELIVERY_UNKNOWN };
    const lead = byLead.get(leadId);
    return { delivery: lead ? deliveryRowStateOf(lead) : null };
  };
  for (const b of booked) {
    if (b.eventDate !== date) continue;
    const state = PIPELINE_STATE[b.stage];
    if (!state) continue;
    out.push({ id: b.id, source: "pipeline", eventQ: eventQFromWindow(b.timeWindow), headcount: b.headcount, state, outAt: state === "to_go_out" ? null : outAt.get(b.id) ?? null,
      ...deliveryOf(b.id) });
  }
  for (const o of ezcater) {
    if (o.event_date !== date) continue;
    out.push({ id: o.id, source: "ezcater", eventQ: o.event_timestamp ? etWallQ(o.event_timestamp) : eventQFromWindow(o.handoff_time), headcount: o.headcount,
      state: ezcaterCancelled(o.status) ? "cancelled" : "not_tracked", outAt: null });
  }
  return out;
}

/** C3: when each order went out: its latest `out` transition, else its latest `completed` one. */
export function outTimes(events: readonly { pipeline_id: string; to_stage: string; created_at: string }[]): Map<string, string> {
  const latest = (stage: string) => {
    const m = new Map<string, string>();
    for (const e of events) if (e.to_stage === stage && (!m.has(e.pipeline_id) || m.get(e.pipeline_id)! < e.created_at)) m.set(e.pipeline_id, e.created_at);
    return m;
  };
  const out = latest("out");
  for (const [id, at] of latest("completed")) if (!out.has(id)) out.set(id, at);
  return out;
}

// ── Which facts a viewer needs (section 6) ──────────────────────────────────────────────────────────────────────────

/** The facts a viewer may be spared; each is sent as `{ kind: "failed" }` (ruling 2), which the lens never shows. */
type SkippableFact = "cash" | "pm" | "ordering" | "rhythm" | "receiving" | "flaggedLines";
export interface FactsNeeded {
  /** cash, pm, ordering, rhythm, receiving: `ops` held and level 4+ (every one has floor 4, TASK_MIN_LEVEL). */
  readonly ops: boolean;
  /** flaggedLines: `catering` held (the lens strips heavy lines without it). */
  readonly flaggedLines: boolean;
  /** The board facts (stations, assignments, myStation): `ops` held. Otherwise the tasks-only path (not_shown). */
  readonly board: boolean;
  readonly skipped: readonly SkippableFact[];
}
export function factsNeeded(viewer: Pick<DayViewer, "level" | "surfaces">): FactsNeeded {
  const ops = viewer.surfaces.has("ops") && viewer.level >= 4;
  const flaggedLines = viewer.surfaces.has("catering");
  const skipped: SkippableFact[] = [...(ops ? [] : (["cash", "pm", "ordering", "rhythm", "receiving"] as const)), ...(flaggedLines ? [] : (["flaggedLines"] as const))];
  return { ops, flaggedLines, board: viewer.surfaces.has("ops"), skipped };
}

// ── The social media manager (section 7) ────────────────────────────────────────────────────────────────────────────

export type SmmTaskStatus = "not_started" | "in_progress" | "done";
/** One checklist's state from its day instance status(es): done when any is finished, in progress when any exists. */
export function smmTaskState(statuses: readonly (string | null)[]): SmmTaskStatus {
  const states = statuses.map((s) => deriveCloseState(s).status);
  if (states.some((s) => s === "closed" || s === "auto_finalized")) return "done";
  if (states.some((s) => s === "in_progress")) return "in_progress";
  return "not_started";
}
/** The person's own CHECKLIST tasks only (the other types are dropped here, as the engine drops them). */
export function smmChecklistTasks(tasks: readonly TaskAssignment[]): (typeof CHECKLIST_TASKS)[number][] {
  const checklist = new Set<TaskType>(CHECKLIST_TASKS);
  return [...new Set(tasks.map((t) => t.task).filter((t): t is (typeof CHECKLIST_TASKS)[number] => checklist.has(t)))];
}
/**
 * Where the person's own station comes from, given their own station events: the head's station, or after a
 * `station_closed` release the station of `priorPositionId` (the release itself says the station closed, so no closure
 * read is needed). null = no station. The caller reads that one station and keeps it only if it is a floor station.
 */
export function smmStationRef(events: readonly StationEvent[], userId: string): { stationId: string } | { priorPositionId: string } | null {
  const head = currentStation(events, userId);
  if (!head) return null;
  if (head.stationId) return { stationId: head.stationId };
  if (head.kind === "release" && head.releaseReason === "station_closed" && head.priorPositionId) return { priorPositionId: head.priorPositionId };
  return null;
}
