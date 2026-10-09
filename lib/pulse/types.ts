/**
 * Mid-shift Pulse v2 — section payload DTOs (client-safe, zero I/O). Every section's card, its own
 * page and /api/pulse/section speak these shapes. Money fields are OPTIONAL and absent below GM;
 * people's names are absent in crew payloads — the stripping happens in lib/pulse/sections.ts, not
 * in the client.
 */
import type { PulseSection } from "@/lib/pulse/scope-shared";
import type { PulseScore } from "@/lib/midshift-shared";
import type { ReportKey, ReportProgress } from "@/lib/midshift-shared";

export type { PulseSection };

/** A section's refresh result. `not_installed` = the migration behind it is not applied yet. */
export type SectionState<T> =
  | { state: "ok"; asOf: string; data: T }
  | { state: "error"; asOf: string; code: string }
  | { state: "not_installed"; asOf: string };

export type SectionStates = Partial<Record<PulseSection, SectionState<unknown>>>;

// ── Attention ───────────────────────────────────────────────────────────────────────────────

export type AttentionKind =
  | "station_uncovered"
  | "station_closing_soon"
  | "station_trim_due"
  | "task_late"
  | "checklist_missed"
  | "fridge_out_of_range"
  | "fridge_unchecked"
  | "item_low"
  | "catering_not_rung"
  | "catering_unprepped"
  | "clockin_unlinked";

export type AttentionSeverity = "red" | "yellow";

export interface AttentionRow {
  /** Stable identity (kind + subject) — dedupe + React key. */
  key: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  /** i18n key suffix under `pulse.attention.`; params are display strings already formatted. */
  params: Record<string, string | number>;
  /** The one-tap action: where it goes. */
  href: string;
  /** i18n key suffix under `pulse.attention.action.` */
  action: string;
  /** Who this is about (user ids) — the crew filter keeps only rows naming them. */
  subjectUserIds?: string[];
  /** Shop-wide rows crew may see (food-safety reminders). */
  shopWide?: boolean;
}

export interface AttentionData {
  items: AttentionRow[];
  score: PulseScore;
  /** Sources that failed and were omitted (honest partial list). */
  partial: string[];
}

// ── Floor ───────────────────────────────────────────────────────────────────────────────────

export type FloorStatus = "covered" | "short" | "closing_soon" | "uncovered" | "closed" | "inactive";

export interface FloorStation {
  id: string;
  name: string;
  nameEs: string | null;
  sort: number;
  status: FloorStatus;
  /** First names at the station (empty for crew payloads, except the viewer's own). */
  people: string[];
  /** Active positions vs. people on them. */
  positions: number;
  filled: number;
  closesAt: string | null;
  trimAt: string | null;
  trimTo: number | null;
  closedAt: string | null;
  /** Past the close / trim time and still open or over the trim count. */
  closeDue: boolean;
  trimDue: boolean;
  /** Open (not done) tasks tied to this station's people — count only. */
  tasksLeft: number;
}

export interface FloorLayoutPoint { x: number; y: number }
export type FloorLayout = Record<string, FloorLayoutPoint>;

export interface FloorData {
  stations: FloorStation[];
  /** Saved per-shop layout (null = auto-arrange). */
  layout: FloorLayout | null;
  canArrange: boolean;
  showNames: boolean;
  viewerStationId: string | null;
  locationId: string;
}

// ── People ──────────────────────────────────────────────────────────────────────────────────

export interface PersonRow {
  id: string;
  name: string;
  onShift: boolean;
  source: "toast_clock" | "coops_activity" | null;
  since: string | null;
  onBreak: boolean;
  stationName: string | null;
  positionName: string | null;
  tasks: string[];
  off: { reason: "clocked_out" | "ended_shift" | "shop_closed"; at: string } | null;
}

export interface PeopleData {
  whosHere: boolean;
  here: PersonRow[];
  seenToday: PersonRow[];
  onBreak: number;
  stationsCovered: number;
  stationsOpen: number;
  freed: Array<{ name: string; stationName: string | null; at: string; reason: string }>;
  unlinked: { count: number; names: string[] };
  /** Clock-ins/outs/breaks/covers as one timeline (detail page). */
  timeline: Array<{ at: string; kind: "clock_in" | "clock_out" | "break_start" | "break_end" | "station" | "release" | "end_shift"; name: string; detail: string | null }>;
}

// ── Stations & tasks ────────────────────────────────────────────────────────────────────────

export interface StationTaskRow { task: string; href: string; done: boolean | null; assigneeName?: string | null }

export interface StationRow {
  id: string;
  name: string;
  nameEs: string | null;
  status: FloorStatus;
  people: string[];
  positions: Array<{ id: string; name: string; nameEs: string | null; filledBy: string | null }>;
  closesAt: string | null;
  trimAt: string | null;
  closedAt: string | null;
}

export interface StationsData {
  counts: { covered: number; short: number; closingSoon: number; uncovered: number; closed: number };
  stations: StationRow[];
  tasks: StationTaskRow[];
  tasksDone: number;
  tasksLeft: number;
  /** Crew: their own station + tasks; null for KH+ (they see everything above). */
  mine: { stationName: string | null; positionName: string | null; tasks: StationTaskRow[] } | null;
}

// ── Sales (GM+) ─────────────────────────────────────────────────────────────────────────────

export interface SalesData {
  capturedAt: string | null;
  coverage: "complete" | "partial" | "missing";
  net: { cents: number; checks: number; avgCheckCents: number | null } | null;
  discounts: { cents: number; count: number };
  refunds: { cents: number; count: number };
  /** Cumulative cents by hour 0..23 for today; null entries after "now". */
  pace: {
    todayCumulative: Array<number | null>;
    baselineCumulative: Array<number | null> | null;
    /** How many trailing same weekdays had data (the basis stated on the chart). */
    baselineWeeks: number;
    weekday: number;
    /** Today so far vs the baseline at the same hour, whole %, null when no basis. */
    pctOfNormal: number | null;
    currentHour: number;
  };
  topItems: Array<{ name: string; units: number }>;
  channels: Array<{ channel: string; cents: number; checks: number }>;
  discountsByName: Array<{ name: string; cents: number; count: number }>;
  servers: Array<{ name: string; cents: number; checks: number }>;
  /** Hour × weekday cents over the trailing 4 weeks (detail heatmap). */
  heat: Array<{ dow: number; hour: number; cents: number }>;
}

// ── Catering ────────────────────────────────────────────────────────────────────────────────

export interface CateringEventRow {
  id: string;
  name: string;
  timeWindow: string | null;
  headcount: number | null;
  isDelivery: boolean;
  stage: "confirmed" | "out";
  source: string | null;
}

export interface CateringData {
  today: CateringEventRow[];
  tomorrow: { count: number; firstWindow: string | null };
  notRung: Array<{ orderId: string; orderNumber: string | null; readyAt: string | null; headcount: number | null; timing: string; totalCents?: number | null }>;
  prep: { amPrep: ReportProgress; midDay: ReportProgress };
}

// ── Inventory ───────────────────────────────────────────────────────────────────────────────

export interface InventoryLowRow {
  skuName: string;
  parQty: number | null;
  orderQty: number;
  unitLabel: string | null;
  /** Implied on-hand as a share of par (0..1), null when par or on-hand is unknown. */
  pctOfPar: number | null;
  risk86: boolean;
}

export interface InventoryData {
  lastWalk: { at: string; byName: string | null; lineCount: number } | null;
  low: InventoryLowRow[];
  risk86: number;
  receiving: Array<{ id: string; vendorName: string; at: string; matchState: string; status: string }>;
  cutoffs: Array<{ vendorName: string; time: string; hasDraft: boolean }>;
}

// ── Food safety ─────────────────────────────────────────────────────────────────────────────

export interface FoodSafetyData {
  counts: { ok: number; outOfRange: number; unchecked: number; total: number };
  /** Per fridge (empty for crew). */
  fridges: Array<{ id: string; name: string; latestF: number | null; status: "ok" | "out_of_range" | "no_reading_today"; spark: number[] }>;
  /** After the opening-overdue hour with unchecked fridges → the reminder is live. */
  reminder: boolean;
}

// ── Handoff ─────────────────────────────────────────────────────────────────────────────────

export type HandoffAudience = "crew" | "managers" | "all";

export interface HandoffNote {
  id: string;
  body: string;
  audience: HandoffAudience;
  authorName: string | null;
  at: string;
  acks: Array<{ name: string; at: string }>;
  ackedByMe: boolean;
}

export interface HandoffData {
  notes: HandoffNote[];
  canAuthor: boolean;
  reports: Array<{ key: ReportKey; progress: ReportProgress }>;
  done: number;
  left: number;
}
