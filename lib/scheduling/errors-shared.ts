/**
 * THE SCHEDULING REFUSAL VOCABULARY — closed, compiler-enforced (Scheduling Phase 2, plan "Permissions").
 *
 * Every refusal anywhere in scheduling (the pure modules, the lib, the routes, the SQL writers' P0001
 * messages) is one of these codes, and each has its own en + es message `schedule.error.<code>`
 * (operational tú). A bare string is never a refusal code. Step-up refusals reuse the shipped
 * `step_up_required` / `step_up_stale` and are deliberately not in this list.
 */

export const SCHEDULE_ERROR_CODES = [
  "schedule_forbidden",
  "schedule_role_refused",
  "shop_not_enabled",
  "shop_not_allowed",
  "week_not_found",
  "past_week",
  "day_locked",
  "head_moved",
  "edited_week_unconfirmed",
  "preview_stale",
  "rules_failing",
  "generator_invalid_output",
  "structure_invalid",
  "structure_moved",
  "budget_invalid",
  "person_not_at_shop",
  "position_not_at_shop",
  "position_retired",
  "horizon_invalid",
  "horizon_too_long",
  "edit_off_grid",
  "edit_overlap",
  "edit_segments_malformed",
  "edit_below_segment_min",
  "pin_invalid",
  "inputs_unavailable",
  "wage_estimate_invalid",
  // r2
  "demand_unavailable",
  "history_changed",
  "suggestion_unavailable",
  // r3 (r4: every unresolved_search gap, inherited or not)
  "unresolved_gaps",
  // CC chunk B ruling 3: a shift longer than the shop's daily maximum (limits.maxShiftH) — a HARD rule
  "shift_over_maximum",
  // chunk D (0274): a malformed writer payload, and roster_include for a role that is never on the floor (R6)
  "invalid_payload",
  "roster_include_refused",
  // chunk D (0275): a declared gap whose certificate is not even the shape of its cause
  "gap_certificate_invalid",
] as const;

export type ScheduleErrorCode = (typeof SCHEDULE_ERROR_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(SCHEDULE_ERROR_CODES);

export function isScheduleErrorCode(v: string): v is ScheduleErrorCode {
  return CODE_SET.has(v);
}

/**
 * A named refusal. `key` names the failing setting for `structure_invalid` (a dotted structure path);
 * `params` carry i18n parameters. The message IS the code, so a log line never carries prose.
 */
export class ScheduleError extends Error {
  readonly code: ScheduleErrorCode;
  readonly key: string | null;
  readonly params: Readonly<Record<string, string | number>>;

  constructor(code: ScheduleErrorCode, opts: { key?: string; params?: Record<string, string | number> } = {}) {
    super(code);
    this.name = "ScheduleError";
    this.code = code;
    this.key = opts.key ?? null;
    this.params = { ...(opts.params ?? {}) };
  }
}
