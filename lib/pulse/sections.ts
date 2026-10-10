/**
 * Mid-shift Pulse v2 — the SERVER section loaders.
 *
 * Contract (spec "Data & freshness" + "Role scoping"):
 *   - SCOPE FIRST. Every section re-checks `canViewSection` before any I/O and strips its payload for
 *     crew (no other people's details) and below GM (no money). The API and the pages call the same
 *     function, so a drill link cannot widen scope.
 *   - ONE BOUNDED READ PER SOURCE, windowed by location + date first, never per row. Sources shared
 *     by several sections (the shift board, the report statuses, the fridges) are memoised PER
 *     REQUEST, so the pulse home pays for the board once however many cards use it.
 *   - ISOLATION. `loadPulseSections` settles every section independently; a failing one returns its
 *     own `error` state and never blanks the others. Each call races a 7 s deadline so a slow lane
 *     can never approach the 8 s statement timeout at the page level.
 *   - UNKNOWN IS NEVER ZERO. An unapplied 0240 → `not_installed`; a failed source inside Needs
 *     attention → listed in `partial`, never a silent clean list.
 *
 * Every dependency is injectable (`PulseDeps`) so the composition is unit-tested with fakes; the
 * real wiring (`defaultPulseDeps`) only names existing readers.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/session";
import { currentStation, taskHref, TASK_TYPES, type ShiftBoard, type TaskType } from "@/lib/assignments-shared";
import { loadShiftBoard } from "@/lib/assignments";
import { loadFridgesToday, type FridgeToday } from "@/lib/pulse/fridges";
import {
  computeOverdue, EXPECTED_BY, loadCateringDueToday, loadCateringTomorrow, loadReportStatuses, operationalNow,
  type CateringDueItem, type CateringTomorrow, type ReportKey, type ReportProgress, type ReportStatusRow,
} from "@/lib/midshift";
import { timeWindowMinutes } from "@/lib/midshift-shared";
import { readNotInToast } from "@/lib/catering/not-in-toast";
import { toastReadyAt, toastRingTiming, type NotInToastOrder } from "@/lib/catering/not-in-toast-shared";
import { loadRecentDeliveries, type DeliveryView } from "@/lib/receiving";
import { loadOrderingAttention, type OrderingCutoffAttention } from "@/lib/ordering";
import {
  SalesReportError,
  type BreakdownRow, type SalesSummaryDto,
} from "@/lib/sales-reports";
import { loadCaptureStamp, loadPulseSales } from "@/lib/pulse/sales";
import { loadHandoffRaw, projectHandoffNotes, PulseNotInstalledError, type HandoffRaw } from "@/lib/pulse/handoff";
import { loadStationLayout } from "@/lib/pulse/layout";
import { cachedSource, cachedStampedSource, sourceKey } from "@/lib/pulse/source-cache";
import { pulseReadActor } from "@/lib/pulse/read-actor";
import { attentionEvidence, attentionScore, crewAttention, rankAttention, severityOf, stripAttentionRows } from "@/lib/pulse/attention-shared";
import { baselineCumulative, cumulativeByHour, dowOf, hourCurve, paceDeltaPct, sameWeekdayCoverage } from "@/lib/pulse/baseline-shared";
import { floorStations, mergeLayout } from "@/lib/pulse/floor-shared";
import { canArrangeFloor, canAuthorHandoff, canReadPulseLocation, canViewSection, crewScoped, moneyVisible, type PulseSection } from "@/lib/pulse/scope-shared";
import type {
  AttentionData, AttentionRowScoped, CateringData, FloorData, FloorLayout, FoodSafetyData, HandoffData, InventoryData,
  InventoryLowRow, PeopleData, PersonRow, SalesData, SectionState, StationRow, StationsData, StationTaskRow,
} from "@/lib/pulse/types";

export const SECTION_DEADLINE_MS = 7_000;

export interface PulseCtx {
  auth: AuthContext;
  locationId: string;
  /** Operational (ET) date. */
  date: string;
  now: Date;
}

export interface ParPassFacts {
  at: string;
  byName: string | null;
  lines: Array<{ skuName: string; parQty: number | null; orderQty: number; unitLabel: string | null }>;
}

export interface SalesFacts {
  today: Pick<SalesSummaryDto, "totals" | "capturedAt">;
  items: BreakdownRow[];
  channels: BreakdownRow[];
  discounts: BreakdownRow[];
  servers: BreakdownRow[];
  hoursToday: BreakdownRow[];
  /** Trailing 28 days (yesterday back), hour × weekday. */
  heatTrailing: BreakdownRow[];
  trailing: { buckets: Array<{ from: string; coveredDays: number }> } | null;
}

export interface PulseDeps {
  board(ctx: PulseCtx): Promise<ShiftBoard>;
  reports(ctx: PulseCtx): Promise<{ rows: Array<Omit<ReportStatusRow, "overdue">>; closingDone: boolean; midDayDoneCount: number }>;
  /** Astra #3: ONE batched, location/day-scoped read (3 queries for any number of fridges). */
  fridges(ctx: PulseCtx): Promise<FridgeToday[]>;
  cateringToday(ctx: PulseCtx): Promise<CateringDueItem[]>;
  cateringTomorrow(ctx: PulseCtx): Promise<CateringTomorrow>;
  notRung(ctx: PulseCtx): Promise<NotInToastOrder[]>;
  unlinkedClockIns(ctx: PulseCtx): Promise<{ count: number; names: string[] }>;
  lastParPass(ctx: PulseCtx): Promise<ParPassFacts | null>;
  deliveries(ctx: PulseCtx): Promise<DeliveryView[]>;
  cutoffs(ctx: PulseCtx): Promise<{ count: number; vendors: OrderingCutoffAttention[] }>;
  sales(ctx: PulseCtx): Promise<SalesFacts>;
  /**
   * The freshness STAMP of today's sales: `finished_at` of the latest COMPLETED full-day Toast capture
   * for this shop/day (null before the first). One indexed single-row read. `cachedPulseDeps` keys the
   * sales cache by it so every warm instance serves the same, newest completed capture (Juan,
   * 2026-10-10: the card "needed 2-4 refreshes, and went BACKWARDS"). Optional: without it (or when it
   * fails) the sales source falls back to the plain per-instance TTL cache.
   */
  salesStamp?(ctx: PulseCtx): Promise<string | null>;
  /** The shop's raw notes (every audience); the section projects per viewer. */
  handoff(ctx: PulseCtx): Promise<HandoffRaw>;
  layout(ctx: PulseCtx): Promise<FloorLayout | null>;
}

/**
 * The SCOPE part of a source's cache key (Astra #2, scope-safe sharing). Most sources are shop facts
 * every viewer of the shop may share. Two are not: report statuses below KH depend on the viewer's
 * assignments (keyed per viewer), and the board carries viewer fields (patched on read, see
 * `cachedPulseDeps`). Handoff is cached RAW (all audiences) and projected per viewer in the section.
 */
export function sourceScope(source: keyof PulseDeps, ctx: PulseCtx): string {
  if (source === "reports") return ctx.auth.level >= 4 ? "full" : `user:${ctx.auth.user.id}`;
  // The ordering reader formats cutoff times in the viewer's language before caching.
  if (source === "cutoffs") return `language:${ctx.auth.user.language}`;
  return "shop";
}

/**
 * Share each source across viewers and refreshes for SOURCE_TTL_MS (just under the 60 s poll): one
 * load per source per shop per poll, however many people are watching. Sits UNDER memoDeps (which
 * dedupes within one request).
 */
export function cachedPulseDeps(deps: PulseDeps, opts: { ttlMs?: number; now?: () => number } = {}): PulseDeps {
  const wrap = <K extends keyof PulseDeps>(key: K): PulseDeps[K] => (async (ctx: PulseCtx) => {
    // Authorization must run on cache hits too; a member warming a shop cannot grant access.
    if (!canReadPulseLocation(ctx.auth, ctx.locationId)) throw new Error("location_access_denied");
    return cachedSource(sourceKey({ source: key, locationId: ctx.locationId, date: ctx.date, scope: sourceScope(key, ctx) }),
      () => (deps[key] as (c: PulseCtx) => Promise<unknown>)(ctx), { ttlMs: opts.ttlMs, now: opts.now?.() });
  }) as PulseDeps[K];
  const board = wrap("board");
  // Today's sales are keyed by the latest COMPLETED capture (the stamp), not just by the clock: a warm
  // instance that still holds the pre-capture snapshot learns the new stamp on its next poll and
  // reloads, instead of serving the lower, older number for up to a TTL (the 4:40 → 4:41 PM "went
  // backwards"). A failed stamp read degrades to the plain TTL cache; it never fails the section.
  const sales: PulseDeps["sales"] = async (ctx) => {
    if (!canReadPulseLocation(ctx.auth, ctx.locationId)) throw new Error("location_access_denied");
    const stamp = deps.salesStamp
      ? await deps.salesStamp(ctx).catch((err: unknown) => { console.error("pulse sales stamp failed", err); return null; })
      : null;
    const scope = sourceScope("sales", ctx);
    const prefix = sourceKey({ source: "sales", locationId: ctx.locationId, date: ctx.date, scope: "" });
    const key = sourceKey({ source: "sales", locationId: ctx.locationId, date: ctx.date, scope: stamp ? `${scope}|captured:${stamp}` : scope });
    return cachedStampedSource(prefix, key, () => deps.sales(ctx), { ttlMs: opts.ttlMs, now: opts.now?.() });
  };
  return {
    // The board is a shop fact; only its viewer fields differ, so patch them for the asking viewer.
    board: async (ctx) => ({ ...(await board(ctx)), viewerId: ctx.auth.user.id, viewerLevel: ctx.auth.level }),
    reports: wrap("reports"), fridges: wrap("fridges"), cateringToday: wrap("cateringToday"),
    cateringTomorrow: wrap("cateringTomorrow"), notRung: wrap("notRung"), unlinkedClockIns: wrap("unlinkedClockIns"),
    lastParPass: wrap("lastParPass"), deliveries: wrap("deliveries"), cutoffs: wrap("cutoffs"), sales,
    handoff: wrap("handoff"), layout: wrap("layout"),
  };
}

export class PulseScopeError extends Error {
  constructor(public section: PulseSection) { super(`forbidden:${section}`); this.name = "PulseScopeError"; }
}
class PulseTimeoutError extends Error {
  constructor() { super("timeout"); this.name = "PulseTimeoutError"; }
}

export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PulseTimeoutError()), ms); });
  return Promise.race([p, deadline]).finally(() => { if (timer) clearTimeout(timer); }) as Promise<T>;
}

/** One request = one read per source, however many sections ask (cachedPulseDeps shares across requests). */
export function memoDeps(deps: PulseDeps): PulseDeps {
  const cache = new Map<string, Promise<unknown>>();
  const wrap = <K extends keyof PulseDeps>(key: K): PulseDeps[K] => ((ctx: PulseCtx) => {
    const id = `${key}:${ctx.locationId}:${ctx.date}:${ctx.auth.user.id}`;
    let p = cache.get(id);
    if (!p) { p = (deps[key] as (c: PulseCtx) => Promise<unknown>)(ctx); cache.set(id, p); }
    return p;
  }) as PulseDeps[K];
  return {
    board: wrap("board"), reports: wrap("reports"), fridges: wrap("fridges"), cateringToday: wrap("cateringToday"),
    cateringTomorrow: wrap("cateringTomorrow"), notRung: wrap("notRung"), unlinkedClockIns: wrap("unlinkedClockIns"),
    lastParPass: wrap("lastParPass"), deliveries: wrap("deliveries"), cutoffs: wrap("cutoffs"), sales: wrap("sales"),
    handoff: wrap("handoff"), layout: wrap("layout"),
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || "?";
const REPORT_FOR_TASK: Partial<Record<TaskType, ReportKey>> = { am_prep: "am_prep", mid_day_prep: "mid_day", cash_report: "cash", opening_report: "opening" };
const TASK_FOR_REPORT: Record<ReportKey, TaskType | null> = { opening: "opening_report", am_prep: "am_prep", mid_day: "mid_day_prep", cash: "cash_report", closing: null };

function reportHref(key: ReportKey, locationId: string): string {
  const task = TASK_FOR_REPORT[key];
  return task ? taskHref(task, locationId) : `/operations/closing?location=${encodeURIComponent(locationId)}`;
}

function overdueRows(reports: Awaited<ReturnType<PulseDeps["reports"]>>, minutesOfDay: number): ReportStatusRow[] {
  return reports.rows.map((r) => ({
    ...r,
    overdue: computeOverdue({ key: r.key, done: r.progress === "done", minutesOfDay, closingDone: reports.closingDone, midDayDoneCount: reports.midDayDoneCount }),
  }));
}

function peopleAtStations(board: ShiftBoard): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of board.people) {
    const head = currentStation(board.events, p.id);
    if (head?.stationId) out.set(head.stationId, [...(out.get(head.stationId) ?? []), p.id]);
  }
  return out;
}

function stationLabel(board: ShiftBoard, stationId: string | null | undefined): { station: string | null; position: string | null; stationEs: string | null } {
  if (!stationId) return { station: null, position: null, stationEs: null };
  const s = board.stations.find((x) => x.id === stationId);
  return { station: s?.name ?? null, stationEs: s?.nameEs ?? null, position: null };
}

// ── Needs attention ─────────────────────────────────────────────────────────────────────────

async function attention(deps: PulseDeps, ctx: PulseCtx): Promise<AttentionData> {
  const level = ctx.auth.level;
  const crew = crewScoped(level);
  const { minutesOfDay } = operationalNow(ctx.now);
  const loc = encodeURIComponent(ctx.locationId);
  const rows: AttentionRowScoped[] = [];
  const partial: string[] = [];

  // Crew may only pull the sources whose libs admit them (catering timing is theirs — Astra #11);
  // the rest are not theirs to see anyway and are not attempted, so they never count as "failed".
  const sources = {
    board: deps.board(ctx),
    reports: deps.reports(ctx),
    fridges: deps.fridges(ctx),
    cateringToday: deps.cateringToday(ctx),
    notRung: crew ? null : deps.notRung(ctx),
    parPass: crew ? null : deps.lastParPass(ctx),
    unlinked: crew ? null : deps.unlinkedClockIns(ctx),
  };
  const names = (Object.keys(sources) as Array<keyof typeof sources>).filter((k) => sources[k] !== null);
  const settled = await Promise.allSettled(names.map((k) => sources[k] as Promise<unknown>));
  const got = <K extends keyof typeof sources>(key: K): Awaited<NonNullable<(typeof sources)[K]>> | null => {
    const i = names.indexOf(key);
    if (i < 0) return null;
    const r = settled[i]!;
    if (r.status === "fulfilled") return r.value as Awaited<NonNullable<(typeof sources)[K]>>;
    partial.push(key);
    console.error(`pulse attention ${key} failed`, r.reason);
    return null;
  };

  const board = got("board");
  const reports = got("reports");
  let overdue: ReportStatusRow[] = [];
  if (reports) overdue = overdueRows(reports, minutesOfDay);

  if (board) {
    const at = peopleAtStations(board);
    for (const s of floorStations(board, { nowMinutes: minutesOfDay, viewerId: ctx.auth.user.id, showNames: !crew })) {
      const subjects = at.get(s.id) ?? [];
      const params = { station: s.name, stationEs: s.nameEs ?? s.name };
      if (s.status === "uncovered") rows.push({ key: `station_uncovered:${s.id}`, kind: "station_uncovered", severity: severityOf("station_uncovered"), params, href: `/assignments?loc=${loc}`, action: "assign", subjectUserIds: subjects });
      if (s.trimDue && s.trimAt) rows.push({ key: `station_trim_due:${s.id}`, kind: "station_trim_due", severity: severityOf("station_trim_due"), params: { ...params, time: s.trimAt, to: s.trimTo ?? 0 }, href: `/assignments?loc=${loc}`, action: "trim", subjectUserIds: subjects });
      else if ((s.status === "closing_soon" || s.closeDue) && s.closesAt) rows.push({ key: `station_closing_soon:${s.id}`, kind: "station_closing_soon", severity: severityOf("station_closing_soon"), params: { ...params, time: s.closesAt }, href: `/operations/closing?location=${loc}`, action: "close", subjectUserIds: subjects });
    }
    // Late tasks: an assigned task whose report is overdue (or due now).
    const late = new Set(overdue.filter((r) => r.overdue === "overdue" || r.overdue === "due_now").map((r) => r.key));
    for (const t of board.tasks) {
      const report = REPORT_FOR_TASK[t.task];
      if (!report || !late.has(report) || t.available === false) continue;
      rows.push({
        key: `task_late:${t.task}:${t.assigneeId}`, kind: "task_late", severity: severityOf("task_late"),
        params: { task: t.task, ...(crew ? {} : { name: t.assigneeName ?? "" }) },
        href: taskHref(t.task, ctx.locationId), action: "open", subjectUserIds: [t.assigneeId],
      });
    }
  }
  for (const r of overdue) {
    if (r.overdue !== "overdue") continue;
    rows.push({ key: `checklist_missed:${r.key}`, kind: "checklist_missed", severity: severityOf("checklist_missed"), params: { report: r.key }, href: reportHref(r.key, ctx.locationId), action: "open", shopWide: !crew });
  }
  const fridges = got("fridges");
  if (fridges) {
    for (const f of fridges) if (f.status === "out_of_range") rows.push({ key: `fridge_out_of_range:${f.id}`, kind: "fridge_out_of_range", severity: severityOf("fridge_out_of_range"), params: { fridge: f.name, temp: f.latestF ?? "" }, href: `/maintenance?location=${loc}`, action: "check", shopWide: true });
    const unchecked = fridges.filter((f) => f.status === "no_reading_today").length;
    if (unchecked > 0 && minutesOfDay > EXPECTED_BY.openingOverdueAfter) rows.push({ key: "fridge_unchecked", kind: "fridge_unchecked", severity: severityOf("fridge_unchecked"), params: { count: unchecked }, href: `/maintenance?location=${loc}`, action: "check", shopWide: true });
  }
  const parPass = got("parPass");
  if (parPass) {
    const low = parPassLow(parPass).filter((l) => l.risk86 || (l.pctOfPar !== null && l.pctOfPar <= 0.5));
    if (low.length > 0) rows.push({ key: "item_low", kind: "item_low", severity: severityOf("item_low"), params: { count: low.length, items: low.slice(0, 3).map((l) => l.skuName).join(" · ") }, href: `/ordering?location=${loc}`, action: "order" });
  }
  const notRung = got("notRung");
  if (notRung) {
    for (const o of notRung) {
      const timing = toastRingTiming(o, ctx.now, null);
      if (timing === "upcoming") continue;
      rows.push({ key: `catering_not_rung:${o.order_id}`, kind: "catering_not_rung", severity: severityOf("catering_not_rung"), params: { order: o.order_number ?? "—", time: toastReadyAt(o) ?? "" }, href: `/catering/pipeline`, action: "ring" });
    }
  }
  const cateringToday = got("cateringToday");
  if (cateringToday && reports) {
    const amPrepDone = reports.rows.find((r) => r.key === "am_prep")?.progress === "done";
    if (!amPrepDone) {
      for (const e of cateringToday) {
        if (e.stage !== "confirmed") continue;
        const due = timeWindowMinutes(e.timeWindow);
        if (due !== Infinity && due - minutesOfDay > 180) continue;
        // Crew see the shop-level timing only (no event / customer name) — the row is shop-wide for them.
        rows.push({ key: `catering_unprepped:${e.id}`, kind: "catering_unprepped", severity: severityOf("catering_unprepped"), params: crew ? { time: e.timeWindow ?? "" } : { event: e.name, time: e.timeWindow ?? "" }, href: taskHref("am_prep", ctx.locationId), action: "prep", shopWide: true });
      }
    }
  }
  const unlinked = got("unlinked");
  if (unlinked && unlinked.count > 0) rows.push({ key: "clockin_unlinked", kind: "clockin_unlinked", severity: severityOf("clockin_unlinked"), params: { count: unlinked.count, names: unlinked.names.join(", ") }, href: `/admin/toast-employees?location=${loc}`, action: "link" });

  const ranked = rankAttention(crew ? crewAttention(rows, ctx.auth.user.id) : rows);
  const evidence = attentionEvidence(names.length, partial.length);
  // Astra #4: authorization-only metadata (subject ids, shop-wide flags) never leaves the server.
  const items = stripAttentionRows(ranked);
  return { items, score: attentionScore(items, evidence), evidence, partial };
}

// ── Floor ───────────────────────────────────────────────────────────────────────────────────

async function floor(deps: PulseDeps, ctx: PulseCtx): Promise<FloorData> {
  const crew = crewScoped(ctx.auth.level);
  const { minutesOfDay } = operationalNow(ctx.now);
  const [board, layout] = await Promise.all([
    deps.board(ctx),
    deps.layout(ctx).catch((err) => { console.error("pulse floor layout failed", err); return null; }),
  ]);
  const stations = floorStations(board, { nowMinutes: minutesOfDay, viewerId: ctx.auth.user.id, showNames: !crew });
  const mine = currentStation(board.events, ctx.auth.user.id)?.stationId ?? null;
  return {
    stations,
    layout: mergeLayout(stations.map((s) => s.id), layout),
    canArrange: canArrangeFloor(ctx.auth.level),
    showNames: !crew,
    viewerStationId: mine,
    locationId: ctx.locationId,
  };
}

// ── People (KH+) ────────────────────────────────────────────────────────────────────────────

async function people(deps: PulseDeps, ctx: PulseCtx): Promise<PeopleData> {
  const [board, unlinked] = await Promise.all([
    deps.board(ctx),
    // A failed clock-in read is UNAVAILABLE (null), never "0 unlinked" (Astra #7).
    deps.unlinkedClockIns(ctx).catch((err) => { console.error("pulse unlinked clock-ins failed", err); return null; }),
  ]);
  const positionName = new Map(board.stations.flatMap((s) => s.positions.map((p) => [p.id, p.name] as const)));
  const rows: PersonRow[] = board.people.map((p) => {
    const head = currentStation(board.events, p.id);
    const label = stationLabel(board, head?.stationId);
    return {
      id: p.id, name: p.name,
      onShift: p.presence?.onShift ?? (p.hasWork || head?.stationId != null),
      source: p.presence?.source ?? null,
      since: p.presence?.since ?? null,
      onBreak: p.onBreak === true,
      stationName: label.station,
      positionName: head?.positionId ? positionName.get(head.positionId) ?? null : null,
      tasks: board.tasks.filter((t) => t.assigneeId === p.id && t.available !== false).map((t) => t.task),
      off: p.presence?.off ?? null,
    };
  });
  const here = rows.filter((r) => r.onShift).sort((a, b) => a.name.localeCompare(b.name));
  const seenToday = rows.filter((r) => !r.onShift && (r.off || r.tasks.length > 0 || r.stationName)).sort((a, b) => a.name.localeCompare(b.name));
  // The SAME floor rows the Stations card counts (one predicate, one status word), so the two cards
  // can never disagree again ("0 covered · 6 open" beside "4 covered", 2026-10-10). Covered = someone
  // is covering it (covered / short / closing soon / to close now); open = uncovered; closed is neither.
  const { minutesOfDay } = operationalNow(ctx.now);
  const floorRows = floorStations(board, { nowMinutes: minutesOfDay, viewerId: ctx.auth.user.id, showNames: false });
  const stationsCovered = floorRows.filter((s) => s.status !== "closed" && s.status !== "inactive" && s.status !== "uncovered").length;
  const stationsOpen = floorRows.filter((s) => s.status === "uncovered").length;
  const freed = [
    ...(board.positionVacancies ?? []).map((v) => {
      const sid = board.stations.find((s) => s.positions.some((p) => p.id === v.positionId))?.id ?? null;
      return { name: v.name, stationName: stationLabel(board, sid).station, at: v.at, reason: v.reason };
    }),
    ...(board.taskVacancies ?? []).map((v) => ({ name: v.name, stationName: null, at: v.at, reason: v.reason ?? "clocked_out" })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const nameOf = new Map(board.people.map((p) => [p.id, p.name]));
  const timeline: PeopleData["timeline"] = [];
  for (const p of board.people) {
    if (p.presence?.source === "toast_clock" && p.presence.since) timeline.push({ at: p.presence.since, kind: "clock_in", name: p.name, detail: null });
    if (p.presence?.off) timeline.push({ at: p.presence.off.at, kind: p.presence.off.reason === "ended_shift" ? "end_shift" : "clock_out", name: p.name, detail: p.presence.off.reason });
  }
  for (const e of board.events) {
    const label = stationLabel(board, e.stationId);
    timeline.push({ at: e.at, kind: e.stationId ? "station" : "release", name: nameOf.get(e.userId) ?? "—", detail: e.stationId ? label.station : (e.releaseReason ?? null) });
  }
  timeline.sort((a, b) => b.at.localeCompare(a.at));
  return {
    whosHere: board.whosHere === true,
    here, seenToday,
    onBreak: rows.filter((r) => r.onBreak).length,
    stationsCovered,
    stationsOpen,
    freed, unlinked,
    timeline: timeline.slice(0, 200),
  };
}

// ── Stations & tasks ────────────────────────────────────────────────────────────────────────

function taskRows(board: ShiftBoard, overdue: ReportStatusRow[], locationId: string, forUser: string | null, withNames: boolean): StationTaskRow[] {
  const done = new Map(overdue.map((r) => [r.key, r.progress === "done"]));
  return board.tasks
    .filter((t) => t.available !== false && (forUser === null || t.assigneeId === forUser))
    .filter((t) => (TASK_TYPES as readonly string[]).includes(t.task))
    .map((t) => {
      const report = REPORT_FOR_TASK[t.task];
      return { task: t.task, href: taskHref(t.task, locationId), done: report ? done.get(report) ?? null : null, ...(withNames ? { assigneeName: t.assigneeName ?? null } : {}) };
    });
}

async function stations(deps: PulseDeps, ctx: PulseCtx): Promise<StationsData> {
  const crew = crewScoped(ctx.auth.level);
  const { minutesOfDay } = operationalNow(ctx.now);
  const [board, reports] = await Promise.all([deps.board(ctx), deps.reports(ctx)]);
  const overdue = overdueRows(reports, minutesOfDay);
  const floorRows = floorStations(board, { nowMinutes: minutesOfDay, viewerId: ctx.auth.user.id, showNames: !crew });
  const heads = new Map(board.people.map((p) => [p.id, currentStation(board.events, p.id)] as const));
  const rows: StationRow[] = floorRows.map((f) => {
    const station = board.stations.find((s) => s.id === f.id)!;
    return {
      id: f.id, name: f.name, nameEs: f.nameEs, status: f.status, people: f.people,
      positions: station.positions.filter((p) => p.active).map((p) => {
        const holder = board.people.find((person) => heads.get(person.id)?.positionId === p.id);
        const show = holder && (!crew || holder.id === ctx.auth.user.id);
        return { id: p.id, name: p.name, nameEs: p.nameEs, filledBy: show ? firstName(holder.name) : holder ? "•" : null };
      }),
      closesAt: f.closesAt, trimAt: f.trimAt, closedAt: f.closedAt,
    };
  });
  const counts = { covered: 0, short: 0, closingSoon: 0, closeDue: 0, uncovered: 0, closed: 0 };
  for (const r of rows) {
    if (r.status === "covered") counts.covered++;
    else if (r.status === "short") counts.short++;
    else if (r.status === "closing_soon") counts.closingSoon++;
    else if (r.status === "close_due") counts.closeDue++;
    else if (r.status === "uncovered") counts.uncovered++;
    else if (r.status === "closed") counts.closed++;
  }
  const all = taskRows(board, overdue, ctx.locationId, null, !crew);
  const tasksDone = all.filter((t) => t.done === true).length;
  const tasksLeft = all.filter((t) => t.done === false).length;
  if (!crew) return { counts, stations: rows, tasks: all, tasksDone, tasksLeft, mine: null };
  const myHead = heads.get(ctx.auth.user.id) ?? null;
  const myStation = board.stations.find((s) => s.id === myHead?.stationId);
  return {
    counts, stations: rows, tasks: [], tasksDone, tasksLeft,
    mine: {
      stationName: myStation?.name ?? null,
      positionName: myStation?.positions.find((p) => p.id === myHead?.positionId)?.name ?? null,
      tasks: taskRows(board, overdue, ctx.locationId, ctx.auth.user.id, false),
    },
  };
}

// ── Sales (GM+) ─────────────────────────────────────────────────────────────────────────────

async function sales(deps: PulseDeps, ctx: PulseCtx): Promise<SalesData> {
  if (!moneyVisible(ctx.auth.level)) throw new PulseScopeError("sales");
  const f = await deps.sales(ctx);
  const t = f.today.totals;
  const { minutesOfDay } = operationalNow(ctx.now);
  const currentHour = Math.min(23, Math.floor(minutesOfDay / 60));
  const dow = dowOf(ctx.date);
  const todayCurve = hourCurve(f.hoursToday.filter((r) => r.dow === dow || r.dow === undefined).map((r) => ({ hour: r.hour ?? -1, cents: r.cents })));
  const todayCumulative = cumulativeByHour(todayCurve, currentHour);
  const weeks = sameWeekdayCoverage(f.trailing?.buckets ?? [], dow);
  const heat = f.heatTrailing.filter((r) => r.dow !== undefined && r.hour !== undefined).map((r) => ({ dow: r.dow!, hour: r.hour!, cents: r.cents }));
  const baseline = baselineCumulative(heat, dow, weeks);
  const hasData = t.coveredDays > 0 || t.checks > 0;
  return {
    capturedAt: f.today.capturedAt,
    coverage: t.coverage,
    net: hasData ? { cents: t.toastChecksCents, checks: t.checks, avgCheckCents: t.avgCheckCents } : null,
    discounts: { cents: t.discountCents, count: t.discountCount },
    refunds: { cents: t.refundCents, count: t.refundCount },
    pace: { baselineUnavailable: f.trailing === null, todayCumulative, baselineCumulative: baseline, baselineWeeks: weeks, weekday: dow, pctOfNormal: paceDeltaPct(todayCumulative, baseline, currentHour), currentHour },
    topItems: f.items.slice(0, 5).map((r) => ({ name: r.label ?? r.key, units: r.units })),
    channels: f.channels.filter((r) => (r.saleClass ?? "sale") === "sale").map((r) => ({ channel: r.channel ?? r.key, cents: r.cents, checks: r.checks })),
    discountsByName: f.discounts.slice(0, 8).map((r) => ({ name: r.label ?? r.key, cents: r.cents, count: r.count })),
    servers: f.servers.slice(0, 8).map((r) => ({ name: r.label ?? r.key, cents: r.cents, checks: r.checks })),
    heat,
  };
}

// ── Catering (KH+) ──────────────────────────────────────────────────────────────────────────

async function catering(deps: PulseDeps, ctx: PulseCtx): Promise<CateringData> {
  const money = moneyVisible(ctx.auth.level);
  const crew = crewScoped(ctx.auth.level);
  // Crew (Astra #11): shop-level TIMING only — the not-rung orders (order numbers, money) are not read for them.
  const [today, tomorrow, notRung, reports] = await Promise.all([
    deps.cateringToday(ctx), deps.cateringTomorrow(ctx), crew ? Promise.resolve<NotInToastOrder[]>([]) : deps.notRung(ctx), deps.reports(ctx),
  ]);
  const progress = (key: ReportKey): ReportProgress => reports.rows.find((r) => r.key === key)?.progress ?? "not_started";
  return {
    redacted: crew,
    today: today.map((e) => ({
      id: e.id, name: crew ? null : e.name, timeWindow: e.timeWindow, headcount: e.headcount, isDelivery: e.isDelivery, stage: e.stage, source: crew ? null : e.source,
    })),
    tomorrow,
    notRung: notRung.map((o) => ({
      orderId: o.order_id, orderNumber: o.order_number, readyAt: toastReadyAt(o), headcount: o.headcount,
      timing: toastRingTiming(o, ctx.now, null), ...(money ? { totalCents: o.total_cents } : {}),
    })),
    prep: { amPrep: progress("am_prep"), midDay: progress("mid_day") },
  };
}

// ── Inventory (KH+) ─────────────────────────────────────────────────────────────────────────

/** Order-up-to-par: orderQty ≈ par − on hand, so on hand / par ≈ 1 − orderQty / par (stated as an estimate). */
export function parPassLow(facts: ParPassFacts): InventoryLowRow[] {
  return facts.lines
    .filter((l) => l.orderQty > 0)
    .map((l) => {
      const pct = l.parQty && l.parQty > 0 ? Math.max(0, Math.min(1, 1 - l.orderQty / l.parQty)) : null;
      return { skuName: l.skuName, parQty: l.parQty, orderQty: l.orderQty, unitLabel: l.unitLabel, pctOfPar: pct, risk86: pct !== null ? pct <= 0.15 : false };
    })
    .sort((a, b) => (a.pctOfPar ?? 1) - (b.pctOfPar ?? 1) || a.skuName.localeCompare(b.skuName));
}

async function inventory(deps: PulseDeps, ctx: PulseCtx): Promise<InventoryData> {
  // Secondary reads that fail are UNAVAILABLE (null), never an empty "nothing recorded" (Astra #7).
  const [parPass, deliveries, cutoffs] = await Promise.all([
    deps.lastParPass(ctx),
    deps.deliveries(ctx).catch((err): DeliveryView[] | null => { console.error("pulse deliveries failed", err); return null; }),
    deps.cutoffs(ctx).catch((err): { count: number; vendors: OrderingCutoffAttention[] } | null => { console.error("pulse cutoffs failed", err); return null; }),
  ]);
  const low = parPass ? parPassLow(parPass) : [];
  return {
    lastWalk: parPass ? { at: parPass.at, byName: parPass.byName, lineCount: parPass.lines.length } : null,
    low,
    risk86: low.filter((l) => l.risk86).length,
    receiving: deliveries ? deliveries.slice(0, 5).map((d) => ({ id: d.id, vendorName: d.vendorName, at: d.createdAt, matchState: d.matchState, status: d.deliveryStatus })) : null,
    cutoffs: cutoffs ? cutoffs.vendors.map((v) => ({ vendorName: v.vendorName, time: v.cutoffTime, hasDraft: v.hasDraft })) : null,
  };
}

// ── Food safety ─────────────────────────────────────────────────────────────────────────────

async function foodSafety(deps: PulseDeps, ctx: PulseCtx): Promise<FoodSafetyData> {
  const crew = crewScoped(ctx.auth.level);
  const { minutesOfDay } = operationalNow(ctx.now);
  const fridges = await deps.fridges(ctx);
  const counts = {
    ok: fridges.filter((f) => f.status === "ok").length,
    outOfRange: fridges.filter((f) => f.status === "out_of_range").length,
    unchecked: fridges.filter((f) => f.status === "no_reading_today").length,
    total: fridges.length,
  };
  return {
    counts,
    fridges: crew ? [] : fridges.map((f) => ({ id: f.id, name: f.name, latestF: f.status === "no_reading_today" ? null : f.latestF, status: f.status, spark: f.readings })),
    reminder: counts.unchecked > 0 && minutesOfDay > EXPECTED_BY.openingOverdueAfter,
  };
}

// ── Handoff ─────────────────────────────────────────────────────────────────────────────────

async function handoff(deps: PulseDeps, ctx: PulseCtx): Promise<HandoffData> {
  const [raw, reports] = await Promise.all([deps.handoff(ctx), deps.reports(ctx)]);
  const rows = reports.rows.map((r) => ({ key: r.key, progress: r.progress }));
  return {
    // Audience filter + crew stripping + ackedByMe happen HERE, per viewer, over the shop-shared raw set.
    notes: projectHandoffNotes(raw, { userId: ctx.auth.user.id, level: ctx.auth.level }),
    canAuthor: canAuthorHandoff(ctx.auth.level),
    reports: rows,
    done: rows.filter((r) => r.progress === "done").length,
    left: rows.filter((r) => r.progress !== "done").length,
  };
}

// ── Dispatcher ──────────────────────────────────────────────────────────────────────────────

const LOADERS: Record<PulseSection, (deps: PulseDeps, ctx: PulseCtx) => Promise<unknown>> = {
  attention, floor, people, stations, sales, catering, inventory, food_safety: foodSafety, handoff,
};

export async function loadPulseSection(deps: PulseDeps, ctx: PulseCtx, section: PulseSection): Promise<SectionState<unknown>> {
  const asOf = ctx.now.toISOString();
  if (!canViewSection(ctx.auth.level, section) || !canReadPulseLocation(ctx.auth, ctx.locationId)) return { state: "error", asOf, code: "forbidden" };
  try {
    const data = await withDeadline(LOADERS[section](deps, ctx), SECTION_DEADLINE_MS);
    return { state: "ok", asOf, data };
  } catch (err) {
    if (err instanceof PulseNotInstalledError) return { state: "not_installed", asOf };
    if (err instanceof SalesReportError && err.code === "sales_reads_not_installed") return { state: "not_installed", asOf };
    if (err instanceof PulseScopeError) return { state: "error", asOf, code: "forbidden" };
    if (err instanceof PulseTimeoutError) return { state: "error", asOf, code: "timeout" };
    console.error(`pulse section ${section} failed`, err);
    return { state: "error", asOf, code: "failed" };
  }
}

/** Every section settles on its own; one failure never blanks another. */
export async function loadPulseSections(deps: PulseDeps, ctx: PulseCtx, sections: readonly PulseSection[]): Promise<Partial<Record<PulseSection, SectionState<unknown>>>> {
  const memo = memoDeps(deps);
  const results = await Promise.all(sections.map((s) => loadPulseSection(memo, ctx, s)));
  const out: Partial<Record<PulseSection, SectionState<unknown>>> = {};
  sections.forEach((s, i) => { out[s] = results[i]!; });
  return out;
}

// ── Real wiring ─────────────────────────────────────────────────────────────────────────────

const UNLINKED_LIMIT = 20;

export function defaultPulseDeps(service: SupabaseClient): PulseDeps {
  const actorOf = (ctx: PulseCtx) => pulseReadActor(ctx.auth, ctx.locationId);
  return {
    board: (ctx) => loadShiftBoard(service, { actor: actorOf(ctx), locationId: ctx.locationId, date: ctx.date }),
    reports: (ctx) => loadReportStatuses(service, { locationId: ctx.locationId, date: ctx.date, actor: { userId: ctx.auth.user.id, role: ctx.auth.role, level: ctx.auth.level } }),
    fridges: (ctx) => loadFridgesToday(service, { locationId: ctx.locationId, date: ctx.date }),
    cateringToday: (ctx) => loadCateringDueToday(service, { locationId: ctx.locationId, date: ctx.date }),
    cateringTomorrow: (ctx) => loadCateringTomorrow(service, { locationId: ctx.locationId, date: ctx.date }),
    notRung: (ctx) => readNotInToast(service, [ctx.locationId], { through: ctx.date }),
    unlinkedClockIns: async (ctx) => {
      const { data, error } = await service.from("toast_time_entries").select("employee_first_name")
        .eq("location_id", ctx.locationId).eq("business_date", ctx.date).eq("deleted", false).is("user_id", null).is("out_at", null)
        .order("in_at", { ascending: true }).limit(UNLINKED_LIMIT)
        .returns<Array<{ employee_first_name: string | null }>>();
      if (error) throw new Error(`pulse unlinked clock-ins: ${error.message}`);
      const rows = data ?? [];
      return { count: rows.length, names: rows.map((r) => r.employee_first_name).filter((n): n is string => !!n) };
    },
    lastParPass: async (ctx) => {
      const { data: ev, error } = await service.from("par_pass_events").select("id, walked_at, walked_by")
        .eq("location_id", ctx.locationId).order("walked_at", { ascending: false }).limit(1)
        .maybeSingle<{ id: string; walked_at: string; walked_by: string }>();
      if (error) throw new Error(`pulse par pass: ${error.message}`);
      if (!ev) return null;
      const [{ data: lines, error: lErr }, { data: walker }] = await Promise.all([
        service.from("par_pass_lines").select("sku_id, par_qty, order_qty, order_unit_label").eq("event_id", ev.id)
          .returns<Array<{ sku_id: string; par_qty: number | string | null; order_qty: number | string; order_unit_label: string | null }>>(),
        service.from("users").select("name").eq("id", ev.walked_by).maybeSingle<{ name: string }>(),
      ]);
      if (lErr) throw new Error(`pulse par pass lines: ${lErr.message}`);
      const rows = lines ?? [];
      const skuIds = [...new Set(rows.map((r) => r.sku_id))];
      const names = new Map<string, string>();
      for (let i = 0; i < skuIds.length; i += 100) {
        const { data: skus, error: sErr } = await service.from("vendor_items").select("id, name").in("id", skuIds.slice(i, i + 100)).returns<Array<{ id: string; name: string }>>();
        if (sErr) throw new Error(`pulse par pass skus: ${sErr.message}`);
        for (const s of skus ?? []) names.set(s.id, s.name);
      }
      const num = (v: number | string | null) => (v === null ? null : Number(v));
      return {
        at: ev.walked_at, byName: walker?.name ?? null,
        lines: rows.map((r) => ({ skuName: names.get(r.sku_id) ?? "(sku)", parQty: num(r.par_qty), orderQty: num(r.order_qty) ?? 0, unitLabel: r.order_unit_label })),
      };
    },
    deliveries: (ctx) => loadRecentDeliveries(actorOf(ctx), ctx.locationId, 10),
    cutoffs: (ctx) => loadOrderingAttention(actorOf(ctx), ctx.locationId),
    sales: (ctx) => loadPulseSales(service, ctx),
    salesStamp: (ctx) => loadCaptureStamp(service, ctx.locationId, ctx.date),
    handoff: (ctx) => loadHandoffRaw(service, { locationId: ctx.locationId, date: ctx.date }),
    layout: (ctx) => loadStationLayout(service, ctx.locationId),
  };
}

/** The production wiring: real readers, shared across polls (cachedPulseDeps). Pass a `withAbort` client so every query carries the deadline. */
export function pulseDeps(service: SupabaseClient): PulseDeps {
  return cachedPulseDeps(defaultPulseDeps(service));
}
