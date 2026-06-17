import type { SupabaseClient } from "@supabase/supabase-js";

export const MIDSHIFT_BASE_LEVEL = 4; // KH+ (key_holder = 4 in lib/roles.ts)

/** Operational timezone — CO is DC-only; hardcoded per the dashboard's convention. */
const OPERATIONAL_TZ = "America/New_York";

export type ReportKey = "opening" | "am_prep" | "mid_day" | "cash" | "closing";

/** Instance statuses that count as "submitted/done" for pulse purposes. */
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
export type OverdueState = "ok" | "overdue" | "not_due_yet";

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
  name: string;
  latestF: number | null;
  outOfRange: boolean; // any reading today > safe max
}

export interface MidShiftPulse {
  locationId: string;
  today: string;
  reports: ReportStatusRow[];
  fridges: PulseFridge[];
  fridgeFlagCount: number; // fridges out of range today
  maintenanceNotesToday: number;
  activeToday: ActiveStaff[];
  /** Derived attention items, highest priority first, for the banner. */
  attention: AttentionItem[];
}

export interface AttentionItem {
  kind: "overdue" | "fridge" | "maintenance_note";
  /** i18n key + params resolved at render; we pass a stable shape. */
  reportKey?: ReportKey; // for overdue
  fridgeName?: string; // for fridge
  count?: number; // for maintenance_note
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
      return minutesOfDay > EXPECTED_BY.midDayOverdueAfter ? "overdue" : "ok";
    case "closing":
      return minutesOfDay > EXPECTED_BY.closingOverdueAfter ? "overdue" : "ok";
    case "am_prep":
    case "cash":
      // Closing-dependent: only overdue once closing is done but this isn't.
      return closingDone ? "overdue" : "ok";
    default:
      return "ok";
  }
}
