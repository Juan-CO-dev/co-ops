/**
 * THE DAY ENGINE — pure, client-safe, zero I/O (nav spec r5 3.3; nav PR 5 plan r4).
 *
 * It turns a plan date, the minutes into it, a viewer and the shop's facts into the current PHASE (with how it was decided
 * and since when) and an ORDERED LIST of items (band, state, time, holder, actions, reason keys with typed parameters).
 * It reads no clock (the time is an input), does no I/O, has no language, imports nothing server-side, and never reads
 * "works as" (a guard test pins each).
 *
 * Stations close by the first of two things (Juan, 2026-11-21): a real close EVENT, or the station's usual close time
 * passing. A station closed only by the clock is PAST DUE, which prompts the crew until the real event arrives. The usual
 * close time meets the clock in exactly ONE function, `effectiveClose`: it enters the engine only as an opaque
 * `UsualClose` (normalizeStations is the one boundary that reads the raw `usuallyClosesAt`), and only `usualMinutes`,
 * called only by `effectiveClose`, turns it into minutes (tests/day-plan-pure.test.ts, rules U1-U6).
 *
 * The clock moves the phase, Mid-day prep and the past-due prompts. It never makes the closing checklist, the AM prep list,
 * the cash deposit or the PM report urgent (S2 sizing Q4).
 */
import { closedStationFor, currentFloorStation, taskVisible, type ShiftBoard, type TaskAssignment, type TaskType } from "@/lib/assignments-shared";
import { deriveCloseState } from "@/lib/dashboard-status-shared";
import { etDayFromDate } from "@/lib/et-day-shared";
import type { TranslationKey } from "@/lib/i18n/types";
import { operationalNow } from "@/lib/midshift-shared";
import { byId } from "@/lib/nav/destinations";
import { canSee } from "@/lib/nav/resolve";
import type { Destination, Switches } from "@/lib/nav/types";
import { cutoffsTomorrow, etDayOf, type PoFact, type VendorCutoff, type VendorFact } from "@/lib/report-digests-v2-shared";
import type { RoleCode } from "@/lib/roles";
import { cateringDayLoad, cateringPrepWindowQ, type CateringDayLoad } from "@/lib/scheduling/catering-day-shared";
import { SCHEDULE_STRUCTURE_DEFAULTS, type ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { addDaysEt, cutoffMinutes, type RhythmRow, type RhythmSkip } from "@/lib/vendor-rhythm-shared";

// ═══ 2.1 Input: what PR 6's loader supplies ═══════════════════════════════════════════════════════════════════════════

/** The access plan's surfaces as the destination list already names them (lib/nav/types.ts keeps its own unexported). */
export type Surface = NonNullable<Destination["surface"]>;

/** A fact is a value or "could not load". Nothing else. */
export type Fact<T> = { readonly kind: "ok"; readonly value: T } | { readonly kind: "failed" };

/** Every day-keyed value says which day it describes. A value for another day is treated as "could not load" (8.3). */
interface ForDate { readonly forDate: string }

/** Stations: four states (value, could not load, another station day, not shown to a tasks-only viewer). */
export type StationsFact =
  | { readonly kind: "ok"; readonly value: StationDay }
  | { readonly kind: "failed" }
  | { readonly kind: "another_day"; readonly stationDate: string }
  | { readonly kind: "not_shown" };
export interface StationDay {
  readonly stationDate: string;
  readonly stations: readonly DayStation[];
}
export interface DayStation {
  readonly id: string; readonly name: string; readonly nameEs: string | null; readonly sort: number;
  /** isFloorStation(row) (lib/assignments-shared.ts), evaluated by the LOADER on the full row. */
  readonly floor: boolean;
  /** "Closing this station starts mid-day prep". False until PR 6's migration exists. */
  readonly startsMidDay: boolean;
  /** stations.usually_closes_at, "HH:MM[:SS]" or null, exactly as read. Guidance, and the CLOCK FALLBACK for the close.
   *  Read ONLY by normalizeStations (the input boundary); only effectiveClose may turn it into minutes. Never shifted. */
  readonly usuallyClosesAt: string | null;
  /** The instant of the station's real close EVENT today, or null. Source-agnostic. */
  readonly closedAt: string | null;
}

/** The shop's day settings (one read: the schedule structure). */
export interface ShopHours {
  readonly source: "saved" | "defaults";
  readonly shopDay: Pick<ScheduleStructure["shopDay"], "prepStartQ" | "serviceStartQ">;
  readonly catering: Pick<ScheduleStructure["catering"], "minHeadcount" | "leadMinutes" | "defaultStartQ" | "defaultEndQ" | "extraPrepDishHeads">;
  /** The day's EFFECTIVE prep start (quarter of the day). PR 6 fills it with the normal prep start; SCH reads an accepted
   *  or applied earlier opening into it (nav-SCH-LEAD-RULINGS-r1 A4). The engine does not read it until SCH. */
  readonly dayPrepStartQ: number;
}

export interface ChecklistDay extends ForDate {
  /** The raw checklist_instances.status of the day's instance on ANY template version; null = no instance yet.
   *  Deliberately no template id: the engine cannot look anything up by an "effective" template. */
  readonly status: string | null;
  readonly phase1At: string | null;
  readonly finishedAt: string | null;
  readonly finishedByName: string | null;
  readonly sectionsLeft: number | null;
}
export interface MidDayDay extends ForDate {
  readonly instances: readonly { readonly status: string; readonly finishedAt: string | null; readonly finishedByName: string | null }[];
}
export interface ReportDay extends ForDate {
  readonly state: "none" | "draft" | "submitted";
  readonly at: string | null; readonly byName: string | null;
  /** The report was finalized by the system (PM `auto_finalized`), never "confirmed". Absent = false. */
  readonly autoFinalized?: boolean;
}

export interface OrderingFacts extends ForDate {
  readonly vendors: readonly VendorFact[];
  readonly cutoffs: readonly VendorCutoff[];
  readonly pos: readonly PoFact[];
}
export interface RhythmFacts { readonly rows: readonly RhythmRow[]; readonly skips: readonly RhythmSkip[] }
export interface ReceivingFacts extends ForDate {
  readonly vendors: readonly VendorFact[];
  /** Read (b): EVERY open order (confirmed/placed/invoiced) with no COMPLETE delivery. Uncapped, unwindowed. */
  readonly openOrders: readonly PoFact[];
  /** Read (a): every half-logged delivery at the shop, any day, uncapped. */
  readonly halfLogged: readonly { readonly id: string; readonly vendorId: string; readonly startedAt: string }[];
  /** Read (c): deliveries completed on the plan date. */
  readonly completedToday: readonly { readonly id: string; readonly vendorId: string; readonly at: string }[];
}

export type FulfillmentState = "to_go_out" | "out" | "completed" | "not_tracked" | "cancelled";
export interface CateringOrder {
  readonly id: string;
  readonly source: "pipeline" | "ezcater";
  readonly eventQ: number | null;
  readonly headcount: number | null;
  readonly state: FulfillmentState;
  readonly outAt: string | null;
}
export interface CateringDay extends ForDate { readonly orders: readonly CateringOrder[] }

export interface DayAssignment {
  readonly id: string; readonly task: TaskType; readonly assigneeId: string;
  readonly firstName: string | null;
  readonly available: boolean;
  readonly source: "assigned" | "taken" | null;
}
export interface AssignmentFacts extends ForDate {
  /** "all_tasks": the shift board. "checklist_tasks": the task-day reader (Opening, AM prep, Mid-day prep only). */
  readonly scope: "all_tasks" | "checklist_tasks";
  readonly rows: readonly DayAssignment[];
}

export interface ShopFacts {
  readonly kind: "shop";
  readonly shop: { readonly id: string; readonly code: string };
  readonly hours: Fact<ShopHours>;
  readonly stations: StationsFact;
  readonly opening: Fact<ChecklistDay>;
  readonly closing: Fact<ChecklistDay>;
  readonly amPrep: Fact<ChecklistDay>;
  readonly midDay: Fact<MidDayDay>;
  readonly cash: Fact<ReportDay>;
  readonly pm: Fact<ReportDay>;
  readonly ordering: Fact<OrderingFacts>;
  readonly rhythm: Fact<RhythmFacts>;
  readonly receiving: Fact<ReceivingFacts>;
  readonly cateringToday: Fact<CateringDay>;
  readonly cateringTomorrow: Fact<CateringDay>;
  readonly flaggedLines: Fact<{ readonly today: number; readonly tomorrow: number }>;
  readonly assignments: Fact<AssignmentFacts> | { readonly kind: "not_shown" };
  /** resolveMyStation: currentFloorStation, else closedStationFor. */
  readonly myStation: Fact<{ readonly stationId: string } | null>;
  readonly counts: Fact<{ readonly inProgress: boolean }>;
  /** forDate = planDate − 1 */
  readonly yesterdayClosing: Fact<ChecklistDay>;
  /** The viewer still holds a station on the station day (a closer past midnight). */
  readonly holdsStationOnStationDay: boolean;
}

/** The brand. A real symbol, so the one boundary (brandUsual) can make a UsualClose without a type assertion (U4). */
const usualBrand: unique symbol = Symbol("UsualClose");
/** The usual close time as the engine carries it. OPAQUE: no code but usualMinutes (called only by effectiveClose) and
 *  brandUsual (called only by normalizeStations) may read `wall`. PR 7 formats `wall` for display. */
export interface UsualClose { readonly wall: string; readonly [usualBrand]: true }

/** A station after the input boundary. `usualRank` orders stations by usual time (0 = earliest; null = none), an
 *  ordinal, never minutes. */
export interface NormalStation extends Omit<DayStation, "usuallyClosesAt"> {
  readonly usual: UsualClose | null;
  readonly usualRank: number | null;
}

/** The social media manager's ONLY facts: their own checklist tasks and their own station. */
export interface SmmFacts {
  readonly kind: "smm";
  readonly ownTasks: Fact<readonly { readonly task: TaskType; readonly status: "not_started" | "in_progress" | "done" }[]>;
  readonly ownStation: Fact<{ readonly name: string; readonly nameEs: string | null } | null>;
}

/** Everything the engine reads about the person. Closed: no "works as" field (a type test pins the keys). */
export interface DayViewer {
  readonly userId: string;
  readonly role: RoleCode;
  readonly level: number;
  readonly surfaces: ReadonlySet<Surface>;
  readonly switches: Switches;
}

export interface DayPlanInput {
  readonly planDate: string;
  readonly nowMin: number;
  readonly viewer: DayViewer;
  readonly facts: ShopFacts | SmmFacts;
}

// ═══ 2.2 Output ═══════════════════════════════════════════════════════════════════════════════════════════════════════

export type PhaseId = "before_opening" | "opening_check" | "morning_prep" | "service" | "midday" | "night" | "closed";
export type Band = "urgent" | "now" | "upcoming" | "done" | "tool";
export type ItemState = "not_started" | "in_progress" | "done" | "unknown";
export type ItemId = "station" | "opening" | "mid_day_prep" | "catering_today" | "ordering" | "receiving"
  | "am_prep" | "cash" | "pm_report" | "closing" | "counts";

export type ReasonParam =
  | { readonly t: "name"; readonly en: string; readonly es: string | null }
  | { readonly t: "names"; readonly v: readonly { readonly en: string; readonly es: string | null }[] }
  | { readonly t: "usual"; readonly v: UsualClose }
  | { readonly t: "count"; readonly v: number }
  | { readonly t: "wall"; readonly min: number }
  | { readonly t: "instant"; readonly iso: string }
  | { readonly t: "day"; readonly ymd: string }
  | { readonly t: "key"; readonly key: TranslationKey };
export interface Reason { readonly key: TranslationKey; readonly params: Readonly<Record<string, ReasonParam>> }

export type Holder =
  | { readonly kind: "none" }
  | { readonly kind: "mine" }
  | { readonly kind: "named"; readonly firstName: string }
  | { readonly kind: "nobody" }
  | { readonly kind: "not_shown" }
  | { readonly kind: "unknown" };

export interface DayItem {
  readonly id: ItemId;
  readonly destId: string;
  readonly section?: string;
  readonly task?: TaskType;
  readonly surface: Surface;
  readonly band: Band;
  readonly state: ItemState;
  readonly at: number | null;
  readonly pin?: "compact" | "full";
  readonly mine: boolean;
  readonly holder: Holder;
  readonly actions: readonly ("do" | "assign")[];
  readonly reasons: readonly Reason[];
  readonly done?: { readonly at: string | null; readonly byName: string | null; readonly autoFinalized: boolean };
  readonly heavy: boolean;
  readonly placement: "list" | "block";
}

/** How one station counts as closed now. null = open. */
export interface EffectiveClose {
  readonly min: number;
  readonly iso: string | null;
  readonly by: "event" | "clock";
}
export interface StationState {
  readonly id: string; readonly name: string; readonly nameEs: string | null; readonly floor: boolean;
  readonly close: EffectiveClose | null;
  readonly pastDue: boolean;
}

interface DayPhase {
  readonly id: PhaseId;
  readonly decidedBy: "event" | "clock" | "default";
  readonly since: Reason | null;
  readonly heavy: boolean;
}
type DayNote = { readonly reason: Reason; readonly minLevel?: number };
type LateCloseAlert = { readonly kind: "late_close"; readonly date: string; readonly shopCode: string };

export interface DayPlan {
  readonly kind: "shop";
  readonly planDate: string;
  readonly phase: DayPhase;
  readonly stations: readonly StationState[];
  readonly items: readonly DayItem[];
  readonly nextUp: { readonly kind: "item"; readonly index: number }
    | { readonly kind: "nothing_due"; readonly nextIndex: number | null }
    | { readonly kind: "closed" };
  readonly headsUp: Reason | null;
  readonly notes: readonly DayNote[];
  readonly alerts: readonly LateCloseAlert[];
  readonly empty: Reason | null;
}

export interface SmmPlan {
  readonly kind: "smm";
  readonly planDate: string;
  readonly tasks: readonly { readonly task: TaskType; readonly destId: string; readonly state: ItemState; readonly reason: Reason }[] | "unavailable";
  readonly station: { readonly name: string; readonly nameEs: string | null } | null | "unavailable";
  readonly closingDestId: "closing";
  readonly notes: readonly ("day.fail.assignments" | "day.fail.own_station")[];
}

/** The viewer-independent day (buildDay's output). Exported as a type for tests. Beyond the plan's fields it carries what
 *  the lens needs to finish the page: the station states, each floor station's card, the closing checklist held out of
 *  the sort, whether the mid-day trigger has fired, and the plan date (to check the assignment fact's day). */
export interface DayModel {
  readonly planDate: string;
  readonly phase: DayPhase;
  /** Unpinned, sorted, holders unset. The closing checklist and the station cards are held out. */
  readonly items: readonly DayItem[];
  readonly headsUp: Reason | null;
  readonly notes: readonly DayNote[];
  readonly alerts: readonly LateCloseAlert[];
  readonly heavy: { readonly today: CateringDayLoad | null; readonly tomorrow: CateringDayLoad | null };
  readonly stations: readonly StationState[];
  /** Station id → that floor station's card. Empty unless station facts are ok. */
  readonly stationCards: Readonly<Record<string, DayItem>>;
  /** True when the stations could not be read for the plan date (the card then shows its state as unknown). */
  readonly stationsUnknown: boolean;
  readonly closing: DayItem;
  /** The effective trigger has fired (phase midday or night): the closing checklist is the full pin. */
  readonly triggered: boolean;
}

// ═══ 3. Tunables and fixed orders ═════════════════════════════════════════════════════════════════════════════════════

export const SOON_MIN = 120;
export const URGENT_MIN = 30;
export const MIDDAY_WINDOW_MIN = 120;
export const EARLY_CUTOFF_GRACE_MIN = 60;
export const BAND_ORDER: readonly Band[] = ["urgent", "now", "upcoming", "done", "tool"];
export const PHASE_ORDER: readonly PhaseId[] = ["before_opening", "opening_check", "morning_prep", "service", "midday", "night", "closed"];
export const DAY_ORDER: readonly ItemId[] = ["station", "opening", "mid_day_prep", "catering_today", "ordering", "receiving",
  "am_prep", "cash", "pm_report", "counts"];
export const CHECKLIST_TASKS = ["opening_report", "am_prep", "mid_day_prep"] as const satisfies readonly TaskType[];

/**
 * Every key the engine can emit, with exactly the placeholders its payload carries (the i18n test pins each list equal to
 * the key's {params} in en and es). The reason builder below is typed by this table, so a payload with a missing or an
 * extra parameter does not compile.
 */
export const EMITTED_KEYS = {
  "day.phase.since.day_start": ["time"],
  "day.phase.since.check_done": ["time"],
  "day.phase.since.opening_done": ["time"],
  "day.phase.since.service_start": ["time"],
  "day.phase.since.station_closed": ["station", "time"],
  "day.phase.since.last_station": ["time"],
  "day.phase.since.closing_done": ["time"],
  "day.phase.since.station_usual": ["station", "time"],
  "day.phase.since.last_station_usual": ["station", "time"],
  "day.phase.since.last_station_mixed_one": ["time"],
  "day.phase.since.last_station_mixed_other": ["n", "time"],
  "day.reason.station.open": [],
  "day.reason.station.closed": ["station", "time"],
  "day.reason.station.past_due": ["station", "time"],
  "day.reason.opening.upcoming": ["time"],
  "day.reason.opening.start": [],
  "day.reason.opening.step2": [],
  "day.reason.opening.urgent": ["time"],
  "day.reason.opening.late": ["time"],
  "day.reason.opening.urgent_heavy": ["time"],
  "day.reason.opening.late_heavy": ["time"],
  "day.reason.midday.waiting": ["station", "time"],
  "day.reason.midday.waiting_no_time": ["station"],
  "day.reason.midday.waiting_first": [],
  "day.reason.midday.event": ["station", "time"],
  "day.reason.midday.late": ["station", "time"],
  "day.reason.midday.clock": ["station", "time"],
  "day.reason.midday.late_usual": ["station", "time"],
  "day.reason.closing.next": ["station", "time"],
  "day.reason.closing.next_no_time": ["station"],
  "day.reason.closing.sections_one": [],
  "day.reason.closing.sections_other": ["n"],
  "day.reason.closing.wrap_up": [],
  "day.reason.closing.past_due_one": ["names"],
  "day.reason.closing.past_due_other": ["n", "names"],
  "day.reason.night.waiting": [],
  "day.reason.amprep.now": [],
  "day.reason.cash.now": [],
  "day.reason.pm.now": [],
  "day.reason.ordering.upcoming_one": ["vendor", "time"],
  "day.reason.ordering.upcoming_other": ["n", "vendor", "time"],
  "day.reason.ordering.left_one": ["vendor", "time"],
  "day.reason.ordering.left_other": ["n", "vendor", "time"],
  "day.reason.ordering.soon": ["vendor", "time", "day"],
  "day.reason.ordering.soon_no_day": ["vendor", "time"],
  "day.reason.ordering.urgent_one": ["vendor", "time"],
  "day.reason.ordering.urgent_other": ["vendor", "time", "minutes"],
  "day.reason.ordering.missed": ["vendor", "time"],
  "day.reason.ordering.none": [],
  "day.reason.ordering.tonight_one": ["vendor", "time"],
  "day.reason.ordering.tonight_other": ["n", "vendor", "time"],
  "day.reason.ordering.done": [],
  "day.reason.receiving.expected_one": ["vendors"],
  "day.reason.receiving.expected_other": ["n", "vendors"],
  "day.reason.receiving.half_logged": ["vendor"],
  "day.reason.receiving.overdue": ["vendor", "day"],
  "day.reason.receiving.undated": ["vendor"],
  "day.reason.receiving.none": [],
  "day.reason.receiving.done_one": [],
  "day.reason.receiving.done_other": ["n"],
  "day.reason.catering.upcoming_one": ["guests", "time", "start"],
  "day.reason.catering.upcoming_other": ["n", "guests", "time", "start"],
  "day.reason.catering.prep_now": ["time", "guests"],
  "day.reason.catering.urgent": ["time", "guests"],
  "day.reason.catering.late": ["time", "guests"],
  "day.reason.catering.done": [],
  "day.reason.catering.done_mixed_one": [],
  "day.reason.catering.done_mixed_other": ["n"],
  "day.reason.catering.done_untracked_one": [],
  "day.reason.catering.done_untracked_other": ["n"],
  "day.reason.catering.none": [],
  "day.reason.catering.untracked_one": [],
  "day.reason.catering.untracked_other": ["n"],
  "day.reason.catering.no_count_one": ["guests"],
  "day.reason.catering.no_count_other": ["guests", "n"],
  "day.reason.catering.no_time_one": [],
  "day.reason.catering.no_time_other": ["n"],
  "day.reason.catering.unavailable": [],
  "day.reason.heavy.today": ["guests", "time", "start"],
  "day.reason.heavy.today_no_time": ["guests", "start"],
  "day.reason.heavy.flagged_one": [],
  "day.reason.heavy.flagged_other": ["n"],
  "day.reason.heavy.tomorrow_one": ["guests", "start"],
  "day.reason.heavy.tomorrow_other": ["orders", "guests", "start"],
  "day.reason.count.tool": [],
  "day.reason.count.in_progress": [],
  "day.reason.own.assigned": [],
  "day.empty.crew": [],
  "day.fail.stations": [],
  "day.fail.shop_day": [],
  "day.fail.all": [],
  "day.fail.assignments": [],
  "day.fail.own_station": [],
  "day.note.stations_not_shown": [],
  "day.note.no_floor_stations": [],
  "day.note.default_hours": [],
} as const satisfies { readonly [K in TranslationKey]?: readonly string[] };
type EmittedKey = keyof typeof EMITTED_KEYS;
type ParamsOf<K extends EmittedKey> = { readonly [P in (typeof EMITTED_KEYS)[K][number]]: ReasonParam };

function reason<K extends EmittedKey>(key: K, params: ParamsOf<K>): Reason {
  return { key, params };
}

// ── parameter builders ──
const nameOf = (s: { readonly name: string; readonly nameEs: string | null }): ReasonParam => ({ t: "name", en: s.name, es: s.nameEs });
const vendorParam = (name: string): ReasonParam => ({ t: "name", en: name, es: null });
const usualParam = (u: UsualClose): ReasonParam => ({ t: "usual", v: u });
const countParam = (v: number): ReasonParam => ({ t: "count", v });
const wallParam = (min: number): ReasonParam => ({ t: "wall", min });
const instantParam = (iso: string): ReasonParam => ({ t: "instant", iso });
const dayParam = (ymd: string): ReasonParam => ({ t: "day", ymd });

// ═══ 2.3 Functions ════════════════════════════════════════════════════════════════════════════════════════════════════

/** Decided by the REAL role before any shop fact is loaded (PR 6 calls this first). */
export function lensFor(role: RoleCode): "smm" | "shop" {
  return role === "social_media_mgr" ? "smm" : "shop";
}

/** The only maker of a UsualClose. Called only by normalizeStations. */
function brandUsual(wall: string): UsualClose {
  return { wall, [usualBrand]: true };
}

/** The ONE unbranding helper: the house parser of a bare "HH:MM[:SS]". Called only by effectiveClose. */
function usualMinutes(u: UsualClose): number | null {
  return cutoffMinutes(u.wall);
}

/**
 * The input boundary. The ONLY reader of DayStation.usuallyClosesAt: it brands the value and ranks the stations by it
 * (lexical order of the zero-padded "HH:MM[:SS]" time render, ties by sort). No parse to minutes.
 */
export function normalizeStations(raw: readonly DayStation[]): NormalStation[] {
  const timed = raw.filter((s) => s.usuallyClosesAt !== null)
    .sort((a, b) => (a.usuallyClosesAt! < b.usuallyClosesAt! ? -1 : a.usuallyClosesAt! > b.usuallyClosesAt! ? 1 : a.sort - b.sort));
  const rank = new Map(timed.map((s, i) => [s.id, i]));
  return raw.map((s) => {
    const { usuallyClosesAt, ...rest } = s;
    return { ...rest, usual: usuallyClosesAt === null ? null : brandUsual(usuallyClosesAt), usualRank: rank.get(s.id) ?? null };
  });
}

/** An instant as minutes on the plan date (an instant on an earlier day is 0, on a later day 1439). */
function minutesOn(planDate: string, iso: string): number {
  const o = operationalNow(new Date(iso));
  return o.date === planDate ? o.minutesOfDay : o.date < planDate ? 0 : 1439;
}

/**
 * The ONE place the usual close time meets the clock (Juan, r2). A real event always wins, even when it is later than the
 * usual time; else the usual time once now reaches it; else open. A station with no usual time closes by event only.
 */
export function effectiveClose(s: NormalStation, nowMin: number, planDate: string): EffectiveClose | null {
  if (s.closedAt !== null) return { min: minutesOn(planDate, s.closedAt), iso: s.closedAt, by: "event" };
  const usual = s.usual === null ? null : usualMinutes(s.usual);
  return usual !== null && nowMin >= usual ? { min: usual, iso: null, by: "clock" } : null;
}

/**
 * The viewer's station for the card, from a shift board: their current floor station, else (after a release with
 * releaseReason "station_closed", whose head has no station) the station they were released from, else null.
 */
export function resolveMyStation(board: Pick<ShiftBoard, "events" | "stations" | "people">, userId: string): { stationId: string } | null {
  const current = currentFloorStation(board, userId)?.stationId;
  if (current) return { stationId: current };
  const closed = closedStationFor(board, userId);
  return closed ? { stationId: closed.station.id } : null;
}

// ═══ helpers over facts ═══════════════════════════════════════════════════════════════════════════════════════════════

function okValue<T>(f: Fact<T>): T | null {
  return f.kind === "ok" ? f.value : null;
}
/** A day-keyed fact is usable only for the day it says it describes (8.3). */
function dayValue<T extends ForDate>(f: Fact<T>, date: string): T | null {
  return f.kind === "ok" && f.value.forDate === date ? f.value : null;
}
const isFinished = (status: string | null): boolean => {
  const s = deriveCloseState(status).status;
  return s === "closed" || s === "auto_finalized";
};
const checklistState = (c: ChecklistDay | null): ItemState =>
  c === null ? "unknown" : isFinished(c.status) ? "done" : c.status === null ? "not_started" : "in_progress";
const reportState = (r: ReportDay | null): ItemState =>
  r === null ? "unknown" : r.state === "submitted" ? "done" : r.state === "draft" ? "in_progress" : "not_started";

/** The one boundary convention: urgent when the deadline is URGENT_MIN away or passed, now when SOON_MIN away. */
function deadlineBand(deadline: number, nowMin: number): "urgent" | "now" | "upcoming" {
  const left = deadline - nowMin;
  return left <= URGENT_MIN ? "urgent" : left <= SOON_MIN ? "now" : "upcoming";
}

const ITEM_DEST: Record<ItemId, { readonly destId: string; readonly task?: TaskType }> = {
  station: { destId: "closing" },
  opening: { destId: "opening", task: "opening_report" },
  mid_day_prep: { destId: "mid-day", task: "mid_day_prep" },
  catering_today: { destId: "catering-workspace" },
  ordering: { destId: "ordering", task: "ordering" },
  receiving: { destId: "receiving", task: "receiving" },
  am_prep: { destId: "am-prep", task: "am_prep" },
  cash: { destId: "cash", task: "cash_report" },
  pm_report: { destId: "pm-report", task: "pm_report" },
  closing: { destId: "closing" },
  counts: { destId: "counts", task: "counts" },
};

type ItemCore = Pick<DayItem, "band" | "state" | "at" | "reasons"> & Partial<Pick<DayItem, "done" | "heavy" | "section">>;
function makeItem(id: ItemId, core: ItemCore): DayItem {
  const dest = ITEM_DEST[id];
  const surface: Surface = id === "catering_today" ? "catering" : (byId(dest.destId).surface ?? "tasks");
  return {
    id, destId: dest.destId, ...(dest.task ? { task: dest.task } : {}), ...(core.section ? { section: core.section } : {}),
    surface, band: core.band, state: core.state, at: core.at, mine: false, holder: { kind: "none" }, actions: [],
    reasons: core.reasons, ...(core.done ? { done: core.done } : {}), heavy: core.heavy ?? false, placement: "list",
  };
}

/** "Empty" rows (nothing due) sit at the bottom of their band. (Plain comparisons: a Set typed by the whole key union
 *  sends the type checker into a quadratic inference over ~10k keys.) */
const isBottomKey = (k: TranslationKey): boolean =>
  k === "day.reason.ordering.none" || k === "day.reason.receiving.none" || k === "day.reason.catering.none";

/** 5.4: bands; inside a band by time (done by finish time), untimed after timed; the empty rows last; then DAY_ORDER;
 *  "mine" only as the final tie-break. On a heavy day Opening is first in its band until both steps are in. */
function sortItems(items: readonly DayItem[], heavyOpeningFirst: boolean, planDate: string): DayItem[] {
  const timeOf = (i: DayItem): number | null => (i.band === "done" ? (i.done?.at ? minutesOn(planDate, i.done.at) : i.at) : i.at);
  const key = (i: DayItem) => ({
    band: BAND_ORDER.indexOf(i.band),
    first: heavyOpeningFirst && i.id === "opening" && i.state !== "done" ? 0 : 1,
    bottom: i.reasons[0] && isBottomKey(i.reasons[0].key) ? 1 : 0,
    time: timeOf(i),
    order: DAY_ORDER.indexOf(i.id),
    mine: i.mine ? 0 : 1,
  });
  return items.map((item) => ({ item, k: key(item) })).sort(({ k: x }, { k: y }) => {
    if (x.band !== y.band) return x.band - y.band;
    if (x.first !== y.first) return x.first - y.first;
    if (x.bottom !== y.bottom) return x.bottom - y.bottom;
    if (x.time !== y.time) return x.time === null ? 1 : y.time === null ? -1 : x.time - y.time;
    if (x.order !== y.order) return x.order - y.order;
    return x.mine - y.mine;
  }).map(({ item }) => item);
}

// ═══ 5. Engine rules (buildDay) ═══════════════════════════════════════════════════════════════════════════════════════

interface StationView {
  readonly ok: boolean;
  readonly stations: readonly NormalStation[];
  readonly closes: ReadonlyMap<string, EffectiveClose | null>;
  readonly floor: readonly NormalStation[];
  readonly trigger: NormalStation | null;
  readonly triggerClose: EffectiveClose | null;
}

function stationView(facts: ShopFacts, planDate: string, nowMin: number): StationView {
  const f = facts.stations;
  if (f.kind !== "ok" || f.value.stationDate !== planDate) {
    return { ok: false, stations: [], closes: new Map(), floor: [], trigger: null, triggerClose: null };
  }
  const stations = normalizeStations(f.value.stations);
  const closes = new Map(stations.map((s) => [s.id, effectiveClose(s, nowMin, planDate)] as const));
  const floor = stations.filter((s) => s.floor).sort((a, b) => a.sort - b.sort);
  // The trigger (rulings B8): the marked station; else the earliest usual time (rank ties by sort); else the first floor
  // station to close by event.
  const marked = floor.find((s) => s.startsMidDay) ?? null;
  const ranked = floor.filter((s) => s.usualRank !== null).sort((a, b) => a.usualRank! - b.usualRank!)[0] ?? null;
  const firstEvent = floor.filter((s) => closes.get(s.id)?.by === "event")
    .sort((a, b) => closes.get(a.id)!.min - closes.get(b.id)!.min || a.sort - b.sort)[0] ?? null;
  const trigger = marked ?? ranked ?? firstEvent;
  return { ok: true, stations, closes, floor, trigger, triggerClose: trigger ? closes.get(trigger.id) ?? null : null };
}

/** The reason line that names a station's close: the event's instant, or its usual time. */
const closeTimeParam = (s: NormalStation, c: EffectiveClose): ReasonParam =>
  c.by === "event" && c.iso !== null ? instantParam(c.iso) : s.usual !== null ? usualParam(s.usual) : wallParam(c.min);

/** The waiting line that names the trigger (Mid-day prep before the trigger, and the compact closing pin). */
function waitingReason(sv: StationView): Reason {
  const t = sv.ok ? sv.trigger : null;
  if (t === null) return reason("day.reason.midday.waiting_first", {});
  return t.usual !== null
    ? reason("day.reason.midday.waiting", { station: nameOf(t), time: usualParam(t.usual) })
    : reason("day.reason.midday.waiting_no_time", { station: nameOf(t) });
}

function phaseOf(args: {
  facts: ShopFacts; planDate: string; nowMin: number; sv: StationView; clockKind: "clock" | "default";
  dayStart: number; serviceStart: number; heavy: boolean;
}): DayPhase {
  const { facts, planDate, nowMin, sv, clockKind, dayStart, serviceStart, heavy } = args;
  const closing = dayValue(facts.closing, planDate);
  const opening = dayValue(facts.opening, planDate);
  const p = (id: PhaseId, decidedBy: DayPhase["decidedBy"], since: Reason | null): DayPhase => ({ id, decidedBy, since, heavy });

  if (closing !== null && isFinished(closing.status)) {
    return p("closed", "event", closing.finishedAt ? reason("day.phase.since.closing_done", { time: instantParam(closing.finishedAt) }) : null);
  }
  if (sv.ok && sv.floor.length > 0 && sv.floor.every((s) => sv.closes.get(s.id))) {
    const closed = sv.floor.map((s) => ({ s, c: sv.closes.get(s.id)! }));
    const byClock = closed.filter((x) => x.c.by === "clock").length;
    const last = [...closed].sort((a, b) => a.c.min - b.c.min || a.s.sort - b.s.sort).at(-1)!;
    let since: Reason;
    if (byClock === 0) since = reason("day.phase.since.last_station", { time: closeTimeParam(last.s, last.c) });
    else if (byClock === closed.length) since = reason("day.phase.since.last_station_usual", { station: nameOf(last.s), time: closeTimeParam(last.s, last.c) });
    else if (byClock === 1) since = reason("day.phase.since.last_station_mixed_one", { time: closeTimeParam(last.s, last.c) });
    else since = reason("day.phase.since.last_station_mixed_other", { n: countParam(byClock), time: closeTimeParam(last.s, last.c) });
    return p("night", byClock > 0 ? "clock" : "event", since);
  }
  if (sv.ok && sv.trigger !== null && sv.triggerClose !== null) {
    const c = sv.triggerClose;
    return c.by === "event"
      ? p("midday", "event", reason("day.phase.since.station_closed", { station: nameOf(sv.trigger), time: closeTimeParam(sv.trigger, c) }))
      : p("midday", "clock", reason("day.phase.since.station_usual", { station: nameOf(sv.trigger), time: closeTimeParam(sv.trigger, c) }));
  }
  if (opening !== null && isFinished(opening.status)) {
    return p("service", "event", opening.finishedAt ? reason("day.phase.since.opening_done", { time: instantParam(opening.finishedAt) }) : null);
  }
  if (nowMin >= serviceStart) return p("service", clockKind, reason("day.phase.since.service_start", { time: wallParam(serviceStart) }));
  if (opening !== null && opening.status === "phase1_complete") {
    return p("morning_prep", "event", opening.phase1At ? reason("day.phase.since.check_done", { time: instantParam(opening.phase1At) }) : null);
  }
  if (nowMin >= dayStart) return p("opening_check", clockKind, reason("day.phase.since.day_start", { time: wallParam(dayStart) }));
  return p("before_opening", clockKind, null);
}

function flaggedReason(n: number): Reason {
  return n === 1 ? reason("day.reason.heavy.flagged_one", {}) : reason("day.reason.heavy.flagged_other", { n: countParam(n) });
}

/** The day engine: viewer-independent phase, items, order, notes. Pure. */
export function buildDay(planDate: string, nowMin: number, facts: ShopFacts): DayModel {
  const yesterday = addDaysEt(planDate, -1);
  const tomorrow = addDaysEt(planDate, 1);
  const hours = okValue(facts.hours);
  const shopDay = hours?.shopDay ?? SCHEDULE_STRUCTURE_DEFAULTS.shopDay;
  const cateringSetting = hours?.catering ?? SCHEDULE_STRUCTURE_DEFAULTS.catering;
  const clockKind: "clock" | "default" = hours !== null && hours.source === "saved" ? "clock" : "default";
  const serviceStart = shopDay.serviceStartQ * 15;

  // ── Catering today / tomorrow and the heavy day (5.5) ──
  const cateringToday = dayValue(facts.cateringToday, planDate);
  const todayOrders = cateringToday?.orders.filter((o) => o.state !== "cancelled") ?? [];
  const todayLoad = cateringToday ? cateringDayLoad(todayOrders, cateringSetting) : null;
  const heavy = todayLoad?.heavy ?? false;
  const windowStart = (orders: readonly CateringOrder[]) =>
    Math.min(shopDay.prepStartQ, ...orders.map((o) => cateringPrepWindowQ(o.eventQ, cateringSetting)[0])) * 15;
  const dayStart = heavy ? windowStart(todayOrders) : shopDay.prepStartQ * 15;
  const timedToday = todayOrders.filter((o) => o.eventQ !== null);
  const firstOrderMin = heavy && timedToday.length > 0 ? Math.min(...timedToday.map((o) => o.eventQ!)) * 15 : null;
  const morningDeadline = firstOrderMin !== null ? Math.min(serviceStart, firstOrderMin) : serviceStart;
  const heavyDeadline = firstOrderMin !== null && firstOrderMin < serviceStart;
  const cateringTomorrow = dayValue(facts.cateringTomorrow, tomorrow);
  const tomorrowOrders = cateringTomorrow?.orders.filter((o) => o.state !== "cancelled") ?? [];
  const tomorrowLoad = cateringTomorrow ? cateringDayLoad(tomorrowOrders, cateringSetting) : null;
  const flagged = okValue(facts.flaggedLines);

  // ── Stations and the phase ──
  const sv = stationView(facts, planDate, nowMin);
  const phase = phaseOf({ facts, planDate, nowMin, sv, clockKind, dayStart, serviceStart, heavy });
  const atNight = phase.id === "night" || phase.id === "closed";
  const triggered = phase.id === "midday" || phase.id === "night";

  const stationStates: StationState[] = sv.stations.map((s) => {
    const close = sv.closes.get(s.id) ?? null;
    return { id: s.id, name: s.name, nameEs: s.nameEs, floor: s.floor, close, pastDue: s.floor && close?.by === "clock" };
  });
  const pastDue = sv.floor.filter((s) => sv.closes.get(s.id)?.by === "clock");

  const items: DayItem[] = [];

  // ── Opening ──
  {
    const o = dayValue(facts.opening, planDate);
    const state = checklistState(o);
    const extras: Reason[] = [];
    if (heavy && todayLoad) {
      extras.push(firstOrderMin !== null
        ? reason("day.reason.heavy.today", { guests: countParam(todayLoad.guests), time: wallParam(firstOrderMin), start: wallParam(dayStart) })
        : reason("day.reason.heavy.today_no_time", { guests: countParam(todayLoad.guests), start: wallParam(dayStart) }));
      if (flagged !== null) extras.push(flaggedReason(flagged.today));
    }
    if (state === "done") {
      items.push(makeItem("opening", { band: "done", state, at: morningDeadline, reasons: [],
        done: { at: o!.finishedAt, byName: o!.finishedByName, autoFinalized: o!.status === "auto_finalized" }, heavy }));
    } else if (nowMin < dayStart) {
      items.push(makeItem("opening", { band: "upcoming", state, at: dayStart, reasons: [reason("day.reason.opening.upcoming", { time: wallParam(dayStart) }), ...extras], heavy }));
    } else {
      const band = deadlineBand(morningDeadline, nowMin) === "urgent" ? "urgent" : "now";
      const late = nowMin >= morningDeadline;
      const primary = band === "now"
        ? (o?.status === "phase1_complete" ? reason("day.reason.opening.step2", {}) : reason("day.reason.opening.start", {}))
        : heavyDeadline
          ? reason(late ? "day.reason.opening.late_heavy" : "day.reason.opening.urgent_heavy", { time: wallParam(morningDeadline) })
          : reason(late ? "day.reason.opening.late" : "day.reason.opening.urgent", { time: wallParam(serviceStart) });
      items.push(makeItem("opening", { band, state, at: morningDeadline, reasons: [primary, ...extras], heavy }));
    }
  }

  // ── Mid-day prep ──
  {
    const m = dayValue(facts.midDay, planDate);
    const finished = m?.instances.find((i) => isFinished(i.status)) ?? null;
    const state: ItemState = m === null ? "unknown" : finished ? "done" : m.instances.length > 0 ? "in_progress" : "not_started";
    const c = sv.ok ? sv.triggerClose : null;
    if (finished) {
      items.push(makeItem("mid_day_prep", { band: "done", state, at: null, reasons: [],
        done: { at: finished.finishedAt, byName: finished.finishedByName, autoFinalized: finished.status === "auto_finalized" } }));
    } else if (c === null || sv.trigger === null) {
      items.push(makeItem("mid_day_prep", { band: "upcoming", state, at: null, reasons: [waitingReason(sv)] }));
    } else {
      const deadline = c.min + MIDDAY_WINDOW_MIN;
      const params = { station: nameOf(sv.trigger), time: closeTimeParam(sv.trigger, c) };
      const r = nowMin >= deadline
        ? reason(c.by === "event" ? "day.reason.midday.late" : "day.reason.midday.late_usual", params)
        : reason(c.by === "event" ? "day.reason.midday.event" : "day.reason.midday.clock", params);
      items.push(makeItem("mid_day_prep", { band: nowMin >= deadline ? "urgent" : "now", state, at: deadline, reasons: [r] }));
    }
  }

  // ── Closing checklist (held out of the sort; pinned by the lens) ──
  const closingItem = ((): DayItem => {
    const c = dayValue(facts.closing, planDate);
    const state = checklistState(c);
    if (state === "done") {
      return makeItem("closing", { band: "done", state, at: null, reasons: [],
        done: { at: c!.finishedAt, byName: c!.finishedByName, autoFinalized: c!.status === "auto_finalized" } });
    }
    const reasons: Reason[] = [];
    if (phase.id === "night") {
      const left = c?.sectionsLeft ?? null;
      if (left !== null) {
        reasons.push(left === 0 ? reason("day.reason.closing.wrap_up", {})
          : left === 1 ? reason("day.reason.closing.sections_one", {}) : reason("day.reason.closing.sections_other", { n: countParam(left) }));
      }
    } else if (phase.id === "midday") {
      const next = sv.floor.filter((s) => !sv.closes.get(s.id))
        .sort((a, b) => (a.usualRank ?? Infinity) - (b.usualRank ?? Infinity) || a.sort - b.sort)[0];
      if (next) {
        reasons.push(next.usual !== null
          ? reason("day.reason.closing.next", { station: nameOf(next), time: usualParam(next.usual) })
          : reason("day.reason.closing.next_no_time", { station: nameOf(next) }));
      }
    } else {
      reasons.push(waitingReason(sv));
    }
    if (pastDue.length > 0) {
      const names: ReasonParam = { t: "names", v: pastDue.map((s) => ({ en: s.name, es: s.nameEs })) };
      reasons.push(pastDue.length === 1
        ? reason("day.reason.closing.past_due_one", { names })
        : reason("day.reason.closing.past_due_other", { n: countParam(pastDue.length), names }));
    }
    return makeItem("closing", { band: "upcoming", state, at: null, reasons });
  })();

  // ── AM prep list, cash deposit, PM report: upcoming until Night, now in Night, never urgent ──
  {
    const a = dayValue(facts.amPrep, planDate);
    const state = checklistState(a);
    const heavyTomorrow = atNight && (tomorrowLoad?.heavy ?? false);
    if (state === "done") {
      items.push(makeItem("am_prep", { band: "done", state, at: null, reasons: [],
        done: { at: a!.finishedAt, byName: a!.finishedByName, autoFinalized: a!.status === "auto_finalized" } }));
    } else {
      const extras: Reason[] = [];
      if (heavyTomorrow && tomorrowLoad) {
        extras.push(tomorrowReason(tomorrowLoad, windowStart(tomorrowOrders)));
        if (flagged !== null) extras.push(flaggedReason(flagged.tomorrow));
      }
      items.push(makeItem("am_prep", { band: atNight ? "now" : "upcoming", state, at: null,
        reasons: [atNight ? reason("day.reason.amprep.now", {}) : reason("day.reason.night.waiting", {}), ...extras], heavy: heavyTomorrow }));
    }
    for (const [id, fact, nowKey] of [["cash", facts.cash, "day.reason.cash.now"], ["pm_report", facts.pm, "day.reason.pm.now"]] as const) {
      const r = dayValue(fact, planDate);
      const st = reportState(r);
      items.push(st === "done"
        ? makeItem(id, { band: "done", state: st, at: null, reasons: [], done: { at: r!.at, byName: r!.byName, autoFinalized: r!.autoFinalized ?? false } })
        : makeItem(id, { band: atNight ? "now" : "upcoming", state: st, at: null, reasons: [atNight ? reason(nowKey, {}) : reason("day.reason.night.waiting", {})] }));
    }
  }

  items.push(orderingItem(facts, planDate, nowMin, shopDay.prepStartQ, atNight));
  items.push(receivingItem(facts, planDate));
  items.push(cateringItem(cateringToday, todayOrders, todayLoad, cateringSetting, nowMin));

  // ── Inventory count: an audit tool; now only while a count is in progress ──
  {
    const c = okValue(facts.counts);
    items.push(c === null
      ? makeItem("counts", { band: "tool", state: "unknown", at: null, reasons: [reason("day.reason.count.tool", {})] })
      : c.inProgress
        ? makeItem("counts", { band: "now", state: "in_progress", at: null, reasons: [reason("day.reason.count.in_progress", {})] })
        : makeItem("counts", { band: "tool", state: "not_started", at: null, reasons: [reason("day.reason.count.tool", {})] }));
  }

  // ── Station cards (one per floor station; the lens picks the viewer's) ──
  const stationCards: Record<string, DayItem> = {};
  for (const s of sv.floor) {
    const c = sv.closes.get(s.id) ?? null;
    stationCards[s.id] = c?.by === "event" && c.iso !== null
      ? makeItem("station", { band: "done", state: "done", at: null, section: s.name,
        reasons: [reason("day.reason.station.closed", { station: nameOf(s), time: instantParam(c.iso) })],
        done: { at: c.iso, byName: null, autoFinalized: false } })
      : makeItem("station", { band: "now", state: "not_started", at: null, section: s.name,
        reasons: [c?.by === "clock" ? reason("day.reason.station.past_due", { station: nameOf(s), time: closeTimeParam(s, c) }) : reason("day.reason.station.open", {})] });
  }

  // ── Every fact failed: every item listed, unknown, in DAY_ORDER (7) ──
  // `counts` is not in the list (nav PR 6, ruling B5): it is a constant with no read, so it can never fail, and it must not
  // keep "everything failed" from firing on a real outage.
  const allFailed = [facts.hours, facts.opening, facts.closing, facts.amPrep, facts.midDay, facts.cash, facts.pm, facts.ordering,
    facts.rhythm, facts.receiving, facts.cateringToday, facts.cateringTomorrow, facts.flaggedLines, facts.yesterdayClosing]
    .every((f) => f.kind === "failed") && facts.stations.kind === "failed";
  const finalItems = allFailed
    ? items.map((i): DayItem => ({ ...i, band: i.id === "counts" ? "tool" : "upcoming", state: "unknown", at: null }))
    : items;

  // ── Notes (7) ──
  const notes: DayNote[] = [];
  if (allFailed) notes.push({ reason: reason("day.fail.all", {}) });
  else {
    if (hours === null) notes.push({ reason: reason("day.fail.shop_day", {}) });
    else if (hours.source === "defaults") notes.push({ reason: reason("day.note.default_hours", {}), minLevel: 7 });
    if (facts.stations.kind === "failed") notes.push({ reason: reason("day.fail.stations", {}) });
    else if (facts.stations.kind === "not_shown") notes.push({ reason: reason("day.note.stations_not_shown", {}) });
    else if (sv.ok && sv.floor.length === 0) notes.push({ reason: reason("day.note.no_floor_stations", {}) });
  }

  // ── The late-close alert (8.2) ──
  const y = dayValue(facts.yesterdayClosing, yesterday);
  const alerts: LateCloseAlert[] = y !== null && y.status === "open" ? [{ kind: "late_close", date: yesterday, shopCode: facts.shop.code }] : [];

  // ── The night-before heads-up (3.3.11): a fact about tomorrow, from service start ──
  const headsUp = tomorrowLoad?.heavy && nowMin >= serviceStart ? tomorrowReason(tomorrowLoad, windowStart(tomorrowOrders)) : null;

  return {
    planDate, phase, items: sortItems(finalItems, heavy, planDate), headsUp, notes, alerts,
    heavy: { today: todayLoad, tomorrow: tomorrowLoad }, stations: stationStates, stationCards,
    stationsUnknown: !sv.ok, closing: allFailed ? { ...closingItem, state: "unknown" } : closingItem, triggered,
  };
}

function tomorrowReason(load: CateringDayLoad, start: number): Reason {
  return load.orders === 1
    ? reason("day.reason.heavy.tomorrow_one", { guests: countParam(load.guests), start: wallParam(start) })
    : reason("day.reason.heavy.tomorrow_other", { orders: countParam(load.orders), guests: countParam(load.guests), start: wallParam(start) });
}

/** Ordering (5.3): the digest's one rule for today's and tomorrow's cutoffs (`cutoffsTomorrow`). */
function orderingItem(facts: ShopFacts, planDate: string, nowMin: number, prepStartQ: number, atNight: boolean): DayItem {
  const o = dayValue(facts.ordering, planDate);
  if (o === null) return makeItem("ordering", { band: "upcoming", state: "unknown", at: null, reasons: [] });
  const base = { locationId: facts.shop.id, pos: o.pos, vendors: o.vendors, cutoffs: o.cutoffs };
  const today = cutoffsTomorrow({ ...base, day: addDaysEt(planDate, -1) })
    .map((c) => ({ ...c, min: cutoffMinutes(c.cutoffTime) }))
    .filter((c): c is typeof c & { min: number } => c.min !== null);
  const earlyAll = cutoffsTomorrow({ ...base, day: planDate })
    .map((c) => ({ ...c, min: cutoffMinutes(c.cutoffTime) }))
    .filter((c): c is typeof c & { min: number } => c.min !== null && c.min < prepStartQ * 15 + EARLY_CUTOFF_GRACE_MIN);
  const early = earlyAll.filter((c) => !c.ordered);
  const open = today.filter((c) => !c.ordered).sort((a, b) => a.min - b.min);
  const missed = open.filter((c) => nowMin > c.min);
  const pending = open.filter((c) => nowMin <= c.min);
  const tonight: Reason | null = early.length === 0 ? null : early.length === 1
    ? reason("day.reason.ordering.tonight_one", { vendor: vendorParam(early[0]!.vendorName), time: wallParam(early[0]!.min) })
    : reason("day.reason.ordering.tonight_other", { n: countParam(early.length), vendor: vendorParam(early[0]!.vendorName), time: wallParam(early[0]!.min) });
  const tonightBand: Band = atNight ? "now" : "upcoming";

  if (today.length === 0 && earlyAll.length === 0) {
    return makeItem("ordering", { band: "upcoming", state: "not_started", at: null, reasons: [reason("day.reason.ordering.none", {})] });
  }
  const withTonight = (primary: Reason[]) => (tonight ? [...primary, tonight] : primary);
  const rank = (b: Band) => BAND_ORDER.indexOf(b);
  const higher = (a: Band, b: Band): Band => (rank(a) <= rank(b) ? a : b);
  if (missed.length > 0) {
    const m = missed[0]!;
    return makeItem("ordering", { band: "urgent", state: "not_started", at: m.min,
      reasons: withTonight([reason("day.reason.ordering.missed", { vendor: vendorParam(m.vendorName), time: wallParam(m.min) })]) });
  }
  if (pending.length > 0) {
    const first = pending[0]!;
    const band = deadlineBand(first.min, nowMin);
    const vendor = vendorParam(first.vendorName);
    const time = wallParam(first.min);
    let primary: Reason;
    if (band === "urgent") {
      const left = first.min - nowMin;
      primary = left === 1 ? reason("day.reason.ordering.urgent_one", { vendor, time })
        : reason("day.reason.ordering.urgent_other", { vendor, time, minutes: countParam(left) });
    } else if (band === "now") {
      const truck = truckDay(facts, planDate, first.vendorId);
      primary = truck !== null ? reason("day.reason.ordering.soon", { vendor, time, day: dayParam(truck) })
        : reason("day.reason.ordering.soon_no_day", { vendor, time });
    } else {
      const left = today.length > pending.length;
      const n = pending.length;
      primary = left
        ? (n === 1 ? reason("day.reason.ordering.left_one", { vendor, time }) : reason("day.reason.ordering.left_other", { n: countParam(n), vendor, time }))
        : (n === 1 ? reason("day.reason.ordering.upcoming_one", { vendor, time }) : reason("day.reason.ordering.upcoming_other", { n: countParam(n), vendor, time }));
    }
    return makeItem("ordering", { band: tonight ? higher(band, tonightBand) : band, state: "not_started", at: first.min, reasons: withTonight([primary]) });
  }
  if (tonight) return makeItem("ordering", { band: tonightBand, state: "not_started", at: null, reasons: [tonight] });
  return makeItem("ordering", { band: "done", state: "done", at: null, reasons: [reason("day.reason.ordering.done", {})] });
}

/** `{day}'s truck`: the plan date + the lead of the vendor's pair for today's dow; null without a pair or inside a skip. */
function truckDay(facts: ShopFacts, planDate: string, vendorId: string): string | null {
  const rhythm = okValue(facts.rhythm);
  if (rhythm === null) return null;
  const dow = etDayFromDate(planDate).dow;
  const pair = rhythm.rows.find((r) => r.vendorId === vendorId && r.locationId === facts.shop.id && r.orderDow === dow);
  if (!pair) return null;
  const day = addDaysEt(planDate, pair.leadDays);
  return rhythm.skips.some((s) => s.vendorId === vendorId && day >= s.skipFrom && day <= s.skipThrough) ? null : day;
}

/** Receiving (5.3): the engine's own selection over the three complete reads. */
function receivingItem(facts: ShopFacts, planDate: string): DayItem {
  const r = dayValue(facts.receiving, planDate);
  const rhythm = okValue(facts.rhythm);
  if (r === null || rhythm === null) return makeItem("receiving", { band: "upcoming", state: "unknown", at: null, reasons: [] });
  const vendorName = (id: string) => r.vendors.find((v) => v.id === id)?.name ?? "—";
  const due: PoFact[] = [];
  const overdue: { po: PoFact; day: string }[] = [];
  const undated: PoFact[] = [];
  for (const po of r.openOrders) {
    const orderDay = etDayOf(po.placedAt ?? po.confirmedAt ?? po.createdAt);
    const pair = rhythm.rows.find((x) => x.vendorId === po.vendorId && x.locationId === facts.shop.id && x.orderDow === etDayFromDate(orderDay).dow);
    if (!pair) { undated.push(po); continue; }
    const deliveryDay = addDaysEt(orderDay, pair.leadDays);
    if (rhythm.skips.some((s) => s.vendorId === po.vendorId && deliveryDay >= s.skipFrom && deliveryDay <= s.skipThrough)) continue;
    if (deliveryDay === planDate) due.push(po);
    else if (deliveryDay < planDate) overdue.push({ po, day: deliveryDay });
  }
  overdue.sort((a, b) => a.day.localeCompare(b.day) || vendorName(a.po.vendorId).localeCompare(vendorName(b.po.vendorId)));
  due.sort((a, b) => vendorName(a.vendorId).localeCompare(vendorName(b.vendorId)));
  const reasons: Reason[] = [];
  if (overdue.length > 0) reasons.push(reason("day.reason.receiving.overdue", { vendor: vendorParam(vendorName(overdue[0]!.po.vendorId)), day: dayParam(overdue[0]!.day) }));
  if (due.length > 0) {
    const vendors: ReasonParam = { t: "names", v: due.map((po) => ({ en: vendorName(po.vendorId), es: null })) };
    reasons.push(due.length === 1 ? reason("day.reason.receiving.expected_one", { vendors })
      : reason("day.reason.receiving.expected_other", { n: countParam(due.length), vendors }));
  }
  if (r.halfLogged.length > 0) {
    const oldest = [...r.halfLogged].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0]!;
    reasons.push(reason("day.reason.receiving.half_logged", { vendor: vendorParam(vendorName(oldest.vendorId)) }));
  }
  if (undated.length > 0) reasons.push(reason("day.reason.receiving.undated", { vendor: vendorParam(vendorName(undated[0]!.vendorId)) }));
  if (overdue.length > 0) return makeItem("receiving", { band: "urgent", state: "not_started", at: null, reasons });
  if (due.length > 0 || r.halfLogged.length > 0) return makeItem("receiving", { band: "now", state: "not_started", at: null, reasons });
  if (undated.length > 0) return makeItem("receiving", { band: "upcoming", state: "not_started", at: null, reasons });
  const n = r.completedToday.length;
  if (n > 0) {
    const last = [...r.completedToday].sort((a, b) => a.at.localeCompare(b.at)).at(-1)!;
    return makeItem("receiving", { band: "done", state: "done", at: null,
      reasons: [n === 1 ? reason("day.reason.receiving.done_one", {}) : reason("day.reason.receiving.done_other", { n: countParam(n) })],
      done: { at: last.at, byName: null, autoFinalized: false } });
  }
  return makeItem("receiving", { band: "upcoming", state: "not_started", at: null, reasons: [reason("day.reason.receiving.none", {})] });
}

/** Catering today (5.3, 3.3.4): windows from the schedule's rule; an untracked order is never urgent and never "out". */
function cateringItem(
  day: CateringDay | null, orders: readonly CateringOrder[], load: CateringDayLoad | null,
  setting: Pick<ScheduleStructure["catering"], "leadMinutes" | "defaultStartQ" | "defaultEndQ">, nowMin: number,
): DayItem {
  if (day === null || load === null) {
    return makeItem("catering_today", { band: "upcoming", state: "unknown", at: null, reasons: [reason("day.reason.catering.unavailable", {})] });
  }
  if (orders.length === 0) {
    return makeItem("catering_today", { band: "upcoming", state: "not_started", at: null, reasons: [reason("day.reason.catering.none", {})] });
  }
  const rows = orders.map((o) => {
    const [fromQ, toQ] = cateringPrepWindowQ(o.eventQ, setting);
    const time = o.eventQ !== null ? o.eventQ * 15 : toQ * 15;
    const tracked = o.state !== "not_tracked";
    const out = o.state === "out" || o.state === "completed";
    const open = tracked ? !out : nowMin < time;
    return { o, from: fromQ * 15, time, tracked, out, open };
  }).sort((a, b) => a.time - b.time || a.from - b.from);
  const untracked = rows.filter((r) => !r.tracked).length;
  const guests = (r: (typeof rows)[number]) => countParam(r.o.headcount ?? 0);
  const extras: Reason[] = [];
  if (load.missingCounts > 0) {
    extras.push(load.missingCounts === 1 ? reason("day.reason.catering.no_count_one", { guests: countParam(load.guests) })
      : reason("day.reason.catering.no_count_other", { guests: countParam(load.guests), n: countParam(load.missingCounts) }));
  }
  const untimed = orders.filter((o) => o.eventQ === null).length;
  if (untimed > 0) extras.push(untimed === 1 ? reason("day.reason.catering.no_time_one", {}) : reason("day.reason.catering.no_time_other", { n: countParam(untimed) }));
  const untrackedLine = untracked === 0 ? [] : [untracked === 1 ? reason("day.reason.catering.untracked_one", {}) : reason("day.reason.catering.untracked_other", { n: countParam(untracked) })];

  const urgent = rows.find((r) => r.tracked && !r.out && r.o.eventQ !== null && deadlineBand(r.time, nowMin) === "urgent");
  if (urgent) {
    return makeItem("catering_today", { band: "urgent", state: "not_started", at: urgent.time, heavy: load.heavy,
      reasons: [reason(nowMin >= urgent.time ? "day.reason.catering.late" : "day.reason.catering.urgent", { time: wallParam(urgent.time), guests: guests(urgent) }), ...untrackedLine, ...extras] });
  }
  const inside = rows.find((r) => r.open && r.from <= nowMin && nowMin < r.time);
  if (inside) {
    return makeItem("catering_today", { band: "now", state: "in_progress", at: inside.time, heavy: load.heavy,
      reasons: [reason("day.reason.catering.prep_now", { time: wallParam(inside.time), guests: guests(inside) }), ...untrackedLine, ...extras] });
  }
  // A tracked order with no time that is still not out stays active after its default window ends: untimed, never urgent
  // (there is no deadline to invent), and never back to upcoming (no band moves backward without an event).
  const stillOpen = rows.find((r) => r.open && r.tracked && r.o.eventQ === null && nowMin >= r.from);
  if (stillOpen) {
    return makeItem("catering_today", { band: "now", state: "in_progress", at: null, heavy: load.heavy,
      reasons: [reason("day.reason.catering.prep_now", { time: wallParam(stillOpen.time), guests: guests(stillOpen) }), ...untrackedLine, ...extras] });
  }
  const open = rows.filter((r) => r.open);
  if (open.length === 0) {
    const tracked = rows.length - untracked;
    const primary = untracked === 0 ? reason("day.reason.catering.done", {})
      : tracked > 0
        ? (untracked === 1 ? reason("day.reason.catering.done_mixed_one", {}) : reason("day.reason.catering.done_mixed_other", { n: countParam(untracked) }))
        : (untracked === 1 ? reason("day.reason.catering.done_untracked_one", {}) : reason("day.reason.catering.done_untracked_other", { n: countParam(untracked) }));
    const outAts = rows.map((r) => r.o.outAt).filter((x): x is string => x !== null).sort();
    return makeItem("catering_today", { band: "done", state: "done", at: null, heavy: load.heavy, reasons: [primary, ...extras],
      done: { at: outAts.at(-1) ?? null, byName: null, autoFinalized: false } });
  }
  const next = [...open].sort((a, b) => a.from - b.from || a.time - b.time)[0]!;
  const first = open[0]!;
  const primary = open.length === 1
    ? reason("day.reason.catering.upcoming_one", { guests: countParam(load.guests), time: wallParam(first.time), start: wallParam(next.from) })
    : reason("day.reason.catering.upcoming_other", { n: countParam(open.length), guests: countParam(load.guests), time: wallParam(first.time), start: wallParam(next.from) });
  return makeItem("catering_today", { band: "upcoming", state: "not_started", at: next.from, heavy: load.heavy, reasons: [primary, ...untrackedLine, ...extras] });
}

// ═══ 6. The role lens ═════════════════════════════════════════════════════════════════════════════════════════════════

const TASK_ITEMS: ReadonlySet<ItemId> = new Set<ItemId>(["opening", "mid_day_prep", "am_prep", "cash", "pm_report", "ordering", "receiving", "counts"]);
const HOLDER_ITEMS: ReadonlySet<ItemId> = new Set<ItemId>(["opening", "mid_day_prep", "am_prep", "cash", "pm_report", "ordering", "receiving"]);
const isHeavyReason = (r: Reason) => r.key.startsWith("day.reason.heavy.");
const isPastDueReason = (r: Reason) => r.key === "day.reason.closing.past_due_one" || r.key === "day.reason.closing.past_due_other";

/**
 * The role lens (3.3.6): filters by surface + level floor + assignment, sets mine / holder / actions, places the pin,
 * picks Next up. The clock is not an input to which items show (a test sweeps it). It reads the real role, never "works as".
 */
export function applyLens(
  day: DayModel, viewer: DayViewer,
  facts: Pick<ShopFacts, "assignments" | "myStation" | "holdsStationOnStationDay">,
): DayPlan {
  const kh = viewer.level >= 4;
  const holds = (s: Surface) => viewer.surfaces.has(s);
  const a = facts.assignments.kind === "not_shown" ? "not_shown" as const : dayValue(facts.assignments, day.planDate);
  const rows = a !== null && a !== "not_shown" ? a.rows.filter((r) => r.available) : [];
  const own = rows.filter((r) => r.assigneeId === viewer.userId);
  const ownAsBoard: TaskAssignment[] = own.map((r) => ({ id: r.id, task: r.task, assigneeId: r.assigneeId, assignerId: "", assignerName: null, note: null,
    ...(r.source ? { source: r.source } : {}), available: true }));
  const assignedTasks = new Set(tasksOf(own).filter((t) => taskVisible(viewer.level, t, ownAsBoard)));
  const navViewer = { role: viewer.role, level: viewer.level, switches: viewer.switches };

  const decorate = (item: DayItem): DayItem | null => {
    if (!holds(item.surface)) return null;
    if (item.id === "catering_today") {
      if (!kh) return null;
      const pipeline = viewer.level >= 5;
      return { ...item, destId: pipeline ? "catering-workspace" : "mid-shift", ...(pipeline ? {} : { section: "catering" }),
        placement: viewer.role === "catering_mgr" ? "block" : "list", actions: ["do"] };
    }
    if (TASK_ITEMS.has(item.id) && item.task) {
      if (!canSee(byId(item.destId), navViewer, { assignedTasks })) return null;
      const mine = own.some((r) => r.task === item.task);
      const reasons = holds("catering") ? item.reasons : item.reasons.filter((r) => !isHeavyReason(r));
      if (!HOLDER_ITEMS.has(item.id)) return { ...item, reasons, mine, holder: mine ? { kind: "mine" } : { kind: "none" }, actions: ["do"] };
      let holder: Holder;
      let actions: DayItem["actions"];
      if (a === "not_shown") { holder = { kind: "not_shown" }; actions = ["do"]; }
      else if (a === null) { holder = { kind: "unknown" }; actions = kh ? ["do"] : []; }
      else if (mine) { holder = { kind: "mine" }; actions = ["do"]; }
      else {
        const other = rows.find((r) => r.task === item.task);
        const inScope = a.scope === "all_tasks" || (CHECKLIST_TASKS as readonly TaskType[]).includes(item.task);
        if (other) { holder = { kind: "named", firstName: other.firstName ?? "" }; actions = []; }
        else if (inScope) { holder = { kind: "nobody" }; actions = holds("ops") ? ["do", "assign"] : ["do"]; }
        else { holder = { kind: "not_shown" }; actions = ["do"]; }
      }
      return { ...item, reasons, mine, holder, actions };
    }
    return { ...item, actions: ["do"] };
  };

  const listed: DayItem[] = [];
  for (const item of day.items) {
    const d = decorate(item);
    if (d) listed.push(d);
  }
  // The station card: the viewer's own floor station.
  const my = okValue(facts.myStation);
  if (my && holds("tasks")) {
    const card = day.stationCards[my.stationId]
      ?? (day.stationsUnknown ? makeItem("station", { band: "now", state: "unknown", at: null, reasons: [reason("day.reason.station.open", {})] }) : null);
    if (card) listed.push({ ...card, actions: ["do"] });
  }
  const sorted = sortItems(listed, day.heavy.today?.heavy ?? false, day.planDate);

  // The closing checklist pin (5.4).
  let items: DayItem[] = sorted;
  if (holds("tasks")) {
    const reasons = kh ? day.closing.reasons : day.closing.reasons.filter((r) => !isPastDueReason(r));
    const closing: DayItem = { ...day.closing, reasons, actions: ["do"] };
    if (closing.band === "done") items = sortItems([...sorted, closing], day.heavy.today?.heavy ?? false, day.planDate);
    else if (day.triggered) items = [{ ...closing, pin: "full" }, ...sorted];
    else items = sorted.length === 0 ? [{ ...closing, pin: "compact" }] : [sorted[0]!, { ...closing, pin: "compact" }, ...sorted.slice(1)];
  }

  // Next up: the first item that is not the full-size pin.
  const isOpen = (i: DayItem) => i.band === "urgent" || i.band === "now" || i.band === "upcoming";
  const firstIdx = items.findIndex((i) => i.pin !== "full");
  const first = firstIdx >= 0 ? items[firstIdx]! : null;
  let nextUp: DayPlan["nextUp"];
  if (day.phase.id === "closed" && !items.some(isOpen)) nextUp = { kind: "closed" };
  else if (first && (first.band === "urgent" || first.band === "now")) nextUp = { kind: "item", index: firstIdx };
  else {
    const up = items.findIndex((i) => i.pin !== "full" && i.band === "upcoming");
    nextUp = { kind: "nothing_due", nextIndex: up >= 0 ? up : null };
  }

  const notes: DayNote[] = day.notes.filter((n) => (n.minLevel ?? 0) <= viewer.level);
  const allFailed = notes.some((n) => n.reason.key === "day.fail.all");
  if (!kh && a === null && !allFailed) notes.push({ reason: reason("day.fail.assignments", {}) });
  // A failed own-station read cannot name the viewer's station, so the card cannot be drawn: say so, never silently.
  if (facts.myStation.kind === "failed" && holds("tasks") && !allFailed) notes.push({ reason: reason("day.fail.own_station", {}) });
  const onlyClosing = items.every((i) => i.id === "closing");
  const empty = !kh && a !== null && a !== "not_shown" && my === null && facts.myStation.kind === "ok" && onlyClosing ? reason("day.empty.crew", {}) : null;

  return {
    kind: "shop", planDate: day.planDate, phase: day.phase, stations: day.stations, items, nextUp,
    headsUp: kh && holds("catering") ? day.headsUp : null, notes,
    alerts: kh || facts.holdsStationOnStationDay ? day.alerts : [], empty,
  };
}

function tasksOf(rows: readonly DayAssignment[]): TaskType[] {
  return [...new Set(rows.map((r) => r.task))];
}

// ═══ 6.4 The social media manager ═════════════════════════════════════════════════════════════════════════════════════

const SMM_DEST: Record<(typeof CHECKLIST_TASKS)[number], { readonly destId: string; readonly order: number }> = {
  opening_report: { destId: "opening", order: DAY_ORDER.indexOf("opening") },
  mid_day_prep: { destId: "mid-day", order: DAY_ORDER.indexOf("mid_day_prep") },
  am_prep: { destId: "am-prep", order: DAY_ORDER.indexOf("am_prep") },
};
const isChecklistTask = (t: TaskType): t is (typeof CHECKLIST_TASKS)[number] => (CHECKLIST_TASKS as readonly TaskType[]).includes(t);

/** The social media manager's page. Reads ONLY SmmFacts: own checklist tasks, own station, the closing link. */
export function smmPlan(planDate: string, viewer: DayViewer, facts: SmmFacts): SmmPlan {
  void viewer;
  const notes: SmmPlan["notes"][number][] = [];
  let tasks: SmmPlan["tasks"];
  if (facts.ownTasks.kind === "failed") { tasks = "unavailable"; notes.push("day.fail.assignments"); }
  else {
    const seen = new Set<TaskType>();
    tasks = facts.ownTasks.value
      .filter((t): t is typeof t & { task: (typeof CHECKLIST_TASKS)[number] } => isChecklistTask(t.task))
      .filter((t) => (seen.has(t.task) ? false : (seen.add(t.task), true)))
      .sort((a, b) => SMM_DEST[a.task].order - SMM_DEST[b.task].order)
      .map((t) => ({ task: t.task, destId: SMM_DEST[t.task].destId, state: t.status, reason: reason("day.reason.own.assigned", {}) }));
  }
  let station: SmmPlan["station"];
  if (facts.ownStation.kind === "failed") { station = "unavailable"; notes.push("day.fail.own_station"); }
  else station = facts.ownStation.value === null ? null : { name: facts.ownStation.value.name, nameEs: facts.ownStation.value.nameEs };
  return { kind: "smm", planDate, tasks, station, closingDestId: "closing", notes };
}

const SMM_WRONG_FACTS: SmmFacts = { kind: "smm", ownTasks: { kind: "failed" }, ownStation: { kind: "failed" } };
const ALL_FAILED_SHOP: ShopFacts = {
  kind: "shop", shop: { id: "", code: "" }, hours: { kind: "failed" }, stations: { kind: "failed" }, opening: { kind: "failed" },
  closing: { kind: "failed" }, amPrep: { kind: "failed" }, midDay: { kind: "failed" }, cash: { kind: "failed" }, pm: { kind: "failed" },
  ordering: { kind: "failed" }, rhythm: { kind: "failed" }, receiving: { kind: "failed" }, cateringToday: { kind: "failed" },
  cateringTomorrow: { kind: "failed" }, flaggedLines: { kind: "failed" }, assignments: { kind: "failed" }, myStation: { kind: "failed" },
  counts: { kind: "failed" }, yesterdayClosing: { kind: "failed" }, holdsStationOnStationDay: false,
};

/**
 * The one entry PR 7 calls. The social media manager → smmPlan, whatever facts arrive (only `facts.kind` is read; shop
 * facts are never read). Any other role given SmmFacts → a plan with every item unknown (a loader bug fails safe).
 */
export function planDay(input: DayPlanInput): DayPlan | SmmPlan {
  const { planDate, nowMin, viewer } = input;
  if (lensFor(viewer.role) === "smm") {
    const facts = input.facts;
    return smmPlan(planDate, viewer, facts.kind === "smm" ? facts : SMM_WRONG_FACTS);
  }
  const facts = input.facts.kind === "shop" ? input.facts : ALL_FAILED_SHOP;
  return applyLens(buildDay(planDate, nowMin, facts), viewer, facts);
}
