/**
 * Mid-Shift Pulse — the CLIENT-SAFE pure core (types, the overdue model,
 * operational-clock helpers). Zero I/O, no server imports — split out per the
 * *-shared pattern so the overdue decision table is vitest-covered
 * (lib/midshift.ts re-exports everything, so server consumers keep their
 * import paths).
 */

export const MIDSHIFT_BASE_LEVEL = 4; // KH+ (key_holder = 4 in lib/roles.ts)

/** Operational timezone — CO is DC-only; hardcoded per the dashboard's convention. */
const OPERATIONAL_TZ = "America/New_York";

export type ReportKey = "opening" | "am_prep" | "mid_day" | "cash" | "closing";

/**
 * Instance statuses that count as "submitted/done" for pulse purposes.
 *
 * ONE OF THREE STATUS SETS THAT MUST MOVE TOGETHER when a checklist status is
 * added or renamed — the other two are `CLOSED_STATUSES` (lib/dashboard-status-shared.ts,
 * feeding the 4-state `deriveCloseState`) and `REPORT_STATUS_LABEL_KEYS`
 * (components/reports-hub/shared.ts, the full raw-status label vocabulary).
 * A new status that lands in only one of the three is exactly how the dashboard
 * came to render `auto_finalized` days as "In progress" (design §2).
 */
const SUBMITTED_STATUSES = new Set([
  "phase2_complete",
  "confirmed",
  "incomplete_confirmed",
  "auto_finalized",
]);
export function isSubmitted(status: string | null | undefined): boolean {
  return status != null && SUBMITTED_STATUSES.has(status);
}

export type ReportProgress = "done" | "in_progress" | "not_started";

/**
 * Overdue states (council 2026-07-31 additions):
 *   due_now            — mid-day prep inside its 14:00–15:30 due window with
 *                        nothing done yet (was a silent "ok" — a manager at
 *                        14:45 wants the nudge, not silence).
 *   waiting_on_closing — am_prep/cash before closing is done. The overdue
 *                        MODEL is unchanged (Juan's law: expected once closing
 *                        is done) — this only names the neutral state so it
 *                        doesn't read as "all good".
 */
export type OverdueState = "ok" | "overdue" | "not_due_yet" | "due_now" | "waiting_on_closing";

export interface ReportStatusRow {
  key: ReportKey;
  progress: ReportProgress;
  doneAt: string | null; // ISO timestamp when finalized, if done
  doneByName: string | null;
  overdue: OverdueState;
  /** mid_day only: how many instances done today (for "#1 done · #2 none"). */
  count?: number;
}

export interface ActiveStaff {
  userId: string;
  name: string;
  reports: ReportKey[]; // which report types they touched today
}

export interface PulseFridge {
  /** Equipment-registry id — the stable React key (names can collide). */
  equipId: string;
  name: string;
  /**
   * The latest reading value SINCE the overview's window start — NOT necessarily
   * today's (lib/maintenance.ts loadMaintenanceOverview computes `latest` over
   * `sinceDate` while `status` is today-scoped). Only claim this as a current
   * temperature when `hasReadingToday` is true.
   */
  latestF: number | null;
  outOfRange: boolean; // any reading today > safe max
  /**
   * SIM-25: did anyone actually temp this fridge TODAY? Derived from the
   * today-scoped FridgeStatus, never from `latestF != null` — a fridge unread
   * today can still carry yesterday's value, and treating that as "read" is
   * exactly the false all-clear this field exists to prevent.
   */
  hasReadingToday: boolean;
}

export interface AttentionItem {
  kind: "overdue" | "fridge" | "fridge_unchecked" | "maintenance_note" | "shrinkage" | "ordering_cutoff";
  /** i18n key + params resolved at render; we pass a stable shape. */
  reportKey?: ReportKey; // for overdue
  fridgeName?: string; // for fridge (display)
  equipId?: string; // for fridge — the stable React key (names can collide)
  count?: number; // for maintenance_note / fridge_unchecked / shrinkage / ordering_cutoff
  /** ordering_cutoff only: the vendors whose cutoff is today with no placed PO yet,
   *  earliest cutoff first. `count` mirrors this array's length; the banner names the
   *  EARLIEST vendor + its formatted cutoff time and pluralizes on `count`. hasDraft
   *  distinguishes "draft ready" from "no draft yet" per the earliest vendor. */
  cutoffVendors?: Array<{ name: string; time: string; hasDraft: boolean }>;
}

/**
 * The Pulse Score (council 2026-07-31, aggie seat): one glanceable 3-state
 * summary derived from the attention items — "see green and move on; see red
 * and scroll". RED = an overdue report or a temp excursion (act now).
 * YELLOW = softer signals (unchecked fridges, maintenance notes, shrinkage —
 * an advisory par-pass-vs-computed divergence, same weight as a maintenance
 * note; NOT red-tier). GREEN = nothing needs attention. Pure; severity classes
 * are fixed here so the banner and any future badge agree.
 */
export type PulseScore = "green" | "yellow" | "red";
const RED_KINDS: ReadonlySet<AttentionItem["kind"]> = new Set(["overdue", "fridge"]);
export function pulseScore(items: AttentionItem[]): PulseScore {
  if (items.length === 0) return "green";
  return items.some((i) => RED_KINDS.has(i.kind)) ? "red" : "yellow";
}

/**
 * Parse a delivery/pickup window's LEADING clock time to minutes-of-day for
 * chronological sorting. Handles the fixed-dropdown shapes ("10:00–10:30 AM",
 * "1:00–1:30 PM" — the first time inherits the range's trailing meridiem) and
 * 24-hour free text ("13:00-14:00"). `time_window` is free text (ezCater
 * handoff strings etc.), so anything unparseable — and null — sorts LAST
 * (Infinity), never interleaved by lexicographic accident.
 */
export function timeWindowMinutes(window: string | null): number {
  if (window == null) return Infinity;
  const m = /(\d{1,2}):(\d{2})/.exec(window);
  if (!m) return Infinity;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return Infinity;
  // The meridiem governing the FIRST time is the first AM/PM at-or-after it
  // ("11:30 AM–1:00 PM" → AM; "1:00–1:30 PM" → the range's PM).
  const meridiem = /\b([AP])\.?M\.?\b/i.exec(window.slice((m.index ?? 0) + m[0].length));
  if (meridiem && hour >= 1 && hour <= 12) {
    const isPm = meridiem[1]?.toUpperCase() === "P";
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  }
  return hour * 60 + minute;
}

/** A confirmed catering event due out today (the mid-shift "what's coming"
 *  strip — time front and center). No revenue on this surface. */
export interface CateringDueItem {
  id: string;
  timeWindow: string | null;
  name: string;
  headcount: number | null;
  isDelivery: boolean;
}

export interface MidShiftPulse {
  locationId: string;
  today: string;
  reports: ReportStatusRow[];
  fridges: PulseFridge[];
  fridgeFlagCount: number; // fridges out of range today
  maintenanceNotesToday: number;
  activeToday: ActiveStaff[];
  /** Confirmed catering events due out today, soonest window first. */
  cateringToday: CateringDueItem[];
  /** Derived attention items, highest priority first, for the banner. */
  attention: AttentionItem[];
}

/**
 * Expected-by clock times (minutes-of-day, operational TZ) per Juan:
 *   - opening overdue after 10:30 (store opens 10:30a)
 *   - mid_day due window 14:00–15:30; overdue after 15:30
 *   - closing overdue after 21:00 (store closes 20:00)
 * am_prep + cash are NOT clock-based — they're "expected when closing is done"
 * (computed in computeOverdue against closing's done-ness).
 */
export const EXPECTED_BY = {
  openingOverdueAfter: 10 * 60 + 30, // 630
  midDayDueFrom: 14 * 60, // 840
  midDayOverdueAfter: 15 * 60 + 30, // 930
  closingOverdueAfter: 21 * 60, // 1260
} as const;

/** Operational-TZ "now": the date string + minutes-of-day. Pure, takes a Date. */
export function operationalNow(now: Date): { date: string; minutesOfDay: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = parseInt(get("hour"), 10);
  if (Number.isNaN(hour) || hour === 24) hour = 0;
  const minute = parseInt(get("minute"), 10) || 0;
  return { date, minutesOfDay: hour * 60 + minute };
}

/** Overdue for one report given its done-ness, the clock, and closing's done-ness. */
export function computeOverdue(args: {
  key: ReportKey;
  done: boolean;
  minutesOfDay: number;
  closingDone: boolean;
  midDayDoneCount: number;
}): OverdueState {
  const { key, done, minutesOfDay, closingDone, midDayDoneCount } = args;
  if (done) return "ok";
  switch (key) {
    case "opening":
      return minutesOfDay > EXPECTED_BY.openingOverdueAfter ? "overdue" : "ok";
    case "mid_day":
      if (midDayDoneCount > 0) return "ok";
      if (minutesOfDay < EXPECTED_BY.midDayDueFrom) return "not_due_yet";
      return minutesOfDay > EXPECTED_BY.midDayOverdueAfter ? "overdue" : "due_now";
    case "closing":
      return minutesOfDay > EXPECTED_BY.closingOverdueAfter ? "overdue" : "ok";
    case "am_prep":
    case "cash":
      // Closing-dependent (Juan's law): expected once closing is done. Before
      // that the state is NAMED (waiting_on_closing) rather than a silent ok.
      return closingDone ? "overdue" : "waiting_on_closing";
    default:
      return "ok";
  }
}
