/**
 * EVERY SCHEDULING I18N KEY, enumerated from the closed unions (Scheduling Phase 2, Task 15). The pure modules speak
 * only in keys + params (`NarrativeLine`); this module lists every key they can emit plus the board's own labels, so
 * tests/schedule-i18n.test.ts can prove each has an en AND an es (tú) string. A new code in any union lands here by
 * construction (the families are derived, never copied); a new board label is added to BOARD_LABEL_KEYS.
 */
import { SCHEDULE_ERROR_CODES } from "./errors-shared";
import { RULE_CODES, type StructureRule } from "./rules-shared";
import { NOTE_CODES, REASON_KEYS } from "./reasons-shared";
import { GAP_CAUSES } from "./shapes-shared";
import { LABOR_LINE_KEYS } from "./labor-target-shared";
import { BUDGET_LINE_KEYS } from "./budget-shared";
import { DAY_CHANGE_ORDER } from "./diff-shared";

/** The `structure` certificate's rules (rules-shared StructureRule), each with its own line. */
export const STRUCTURE_RULE_KEYS: readonly StructureRule[] = ["primary_window_closed", "no_mod_member", "no_closing_role", "max_shift"];

/** The board's own labels (coverage tones, labor tones, the MoD lane, the Closing Manager row, strength, windows, day types, the money strip, flags). */
export const BOARD_LABEL_KEYS = [
  "schedule.board.coverage.gap", "schedule.board.coverage.over", "schedule.board.coverage.good", "schedule.board.coverage.closed",
  "schedule.board.labor.good", "schedule.board.labor.watch", "schedule.board.labor.high", "schedule.board.labor.none",
  "schedule.board.mod.good", "schedule.board.mod.gap", "schedule.board.mod.none",
  "schedule.board.closing.closed", "schedule.board.closing.covered", "schedule.board.closing.gap",
  "schedule.board.strength.strong", "schedule.board.strength.watch", "schedule.board.strength.thin", "schedule.board.strength.unknown", "schedule.board.strength.empty",
  "schedule.board.window.boh_open", "schedule.board.window.setup", "schedule.board.window.lunch_rush", "schedule.board.window.afternoon", "schedule.board.window.close",
  "schedule.board.day_type.auto", "schedule.board.day_type.slow", "schedule.board.day_type.normal", "schedule.board.day_type.busy", "schedule.board.day_type.weekend",
  "schedule.board.money.hours_vs_budget", "schedule.board.money.hourly_cost", "schedule.board.money.salaried", "schedule.board.money.total_pct",
  "schedule.board.money.ot_risk", "schedule.board.money.flex_used", "schedule.board.money.manager_floor", "schedule.board.money.manager_mod", "schedule.board.money.blank",
  "schedule.board.money.errand_set_wage", "schedule.board.money.hidden",
  "schedule.board.day_tab.done",
  "schedule.board.flag.assumed_availability", "schedule.board.flag.starting_point", "schedule.board.flag.not_linked", "schedule.board.flag.flex_later",
  "schedule.board.gap.unresolved_try", "schedule.board.problem.earlier", "schedule.board.demand.basis", "schedule.board.ready_for_7shifts",
  "schedule.diff.cost_partial",
] as const;

/** Every key, by family, in a fixed order. */
export function scheduleI18nKeys(): Record<string, readonly string[]> {
  return {
    error: SCHEDULE_ERROR_CODES.map((c) => `schedule.error.${c}`),
    rule: Object.keys(RULE_CODES).map((c) => `schedule.rule.${c}`),
    reason: [...REASON_KEYS.map((k) => `schedule.reason.${k}`), "schedule.reason.callout_last_resort"],
    note: NOTE_CODES.map((c) => `schedule.note.${c}`),
    cause: GAP_CAUSES.map((c) => `schedule.gap.cause.${c}`),
    certificate: GAP_CAUSES.map((c) => `schedule.gap.certificate.${c}`),
    structure: STRUCTURE_RULE_KEYS.map((r) => `schedule.gap.structure.${r}`),
    labor: [...LABOR_LINE_KEYS],
    budget: [...BUDGET_LINE_KEYS],
    diff: ["schedule.diff.no_change", "schedule.diff.summary", ...DAY_CHANGE_ORDER.map((k) => `schedule.diff.kind.${k}`)],
    board: [...BOARD_LABEL_KEYS],
  };
}
