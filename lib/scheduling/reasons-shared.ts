/**
 * REASONS AND BOARD NOTES — the closed vocabulary the generator speaks (Scheduling Phase 2, Task 7).
 *
 * Every shift and every segment carries ≥ 1 reason: an i18n KEY (`schedule.reason.<key>`, en + es in
 * Task 15) plus numeric / id params, citing the rule followed — never prose built in English. Board
 * notes are the per-day / per-person flags the board shows beside the schedule (`schedule.note.<code>`).
 * The unions are closed so Task 15's i18n test can enumerate them.
 */

export const REASON_KEYS = [
  "closing_crew", "boh_crew", "catering_prep", "wave_arrival", "shape_rush",
  "strongest_on_position", "under_soft_min", "full_timer_minimum", "beside_strong",
  "extended_to_minimum", "next_position", "manager_cover", "manager_cover_last_resort", "priority_cover",
  "salaried_minimum", "presence_pin", "added_pin", "repair_moved", "repair_replaced", "repair_relabelled",
  "overtime_last_resort", "closing_manager", "mod_cover", "inherited",
  // Astra chunk B ruling (hoursNeeded): an essential closer extended over a hole costs no non-essential hour.
  "essential_extension",
  // CC chunk C ruling 2: a shift extended up to the shop's daily maximum toward a need run longer than one shift.
  "extended_to_cap",
  // CC chunk D rulings 1 + 2: a salaried manager stayed longer (up to the daily maximum) — a zero-hourly-cost fill.
  "salaried_extension",
] as const;
export type ReasonKey = (typeof REASON_KEYS)[number];

export type ReasonParam = string | number | boolean | null;
export interface Reason { key: ReasonKey; params: Record<string, ReasonParam> }

export function reason(key: ReasonKey, params: Record<string, ReasonParam> = {}): Reason {
  return { key, params };
}

/** The per-shift reasons: the shift's own, one list per segment (same order), and who else could cover. */
export interface ShiftReasons { shift: Reason[]; segments: Reason[][]; alternates: Array<{ userId: string; skill: number }> }
export type ReasonIndex = Record<string, ShiftReasons>;

/** The index key of a shift: date | user | start quarter (unique per (revision, user, date, start)). */
export function shiftKey(date: string, userId: string, startQ: number): string {
  return `${date}|${userId}|${startQ}`;
}

export const NOTE_CODES = [
  "pairing_unmet", "unbudgeted_date", "no_history", "zero_demand", "zero_profile", "rush_moved",
  "cover_position_retired", "excluded_role_included", "salaried_block_skipped", "overtime_used", "budget_stopped", "waves_capped",
  // CC chunk C ruling 3: essential closer hours are exempt from the budget CAP but counted — named when they pass it.
  "essential_past_budget",
] as const;
export type NoteCode = (typeof NOTE_CODES)[number];
export interface BoardNote { code: NoteCode; date: string | null; userId: string | null; positionId: string | null; params: Record<string, ReasonParam> }

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function noteOrder(a: BoardNote, b: BoardNote): number {
  return cmp(a.date ?? "", b.date ?? "") || cmp(a.code, b.code) || cmp(a.userId ?? "", b.userId ?? "") || cmp(a.positionId ?? "", b.positionId ?? "");
}
