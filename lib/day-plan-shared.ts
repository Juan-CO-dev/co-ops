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
import { closedStationFor, currentFloorStation, type ShiftBoard, type TaskType } from "@/lib/assignments-shared";
import type { TranslationKey } from "@/lib/i18n/types";
import { operationalNow } from "@/lib/midshift-shared";
import type { Destination, Switches } from "@/lib/nav/types";
import type { PoFact, VendorCutoff, VendorFact } from "@/lib/report-digests-v2-shared";
import type { RoleCode } from "@/lib/roles";
import type { CateringDayLoad } from "@/lib/scheduling/catering-day-shared";
import type { ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { cutoffMinutes, type RhythmRow, type RhythmSkip } from "@/lib/vendor-rhythm-shared";

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

