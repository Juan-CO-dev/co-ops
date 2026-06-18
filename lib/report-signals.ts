/**
 * Pure signal-derivation helpers shared by the Reports Hub list/detail loader
 * (lib/reports-hub.ts computeReportSignals) and the trends loader
 * (lib/reports-trends.ts). Extracted so the bug-prone par math lives in ONE
 * place — a mid-day prepped DELTA vs an am-prep FINAL amount diverge here and
 * nowhere else (see AGENTS.md "Same field name, different meaning across types").
 */

import { FRIDGE_DEFAULT_SAFE_MAX_F } from "@/lib/maintenance";

export interface PrepHaveInput {
  /** True for mid-day prep (inputs.total is a prepped delta), false for am-prep/other (inputs.total is final). */
  isMidDay: boolean;
  onHand: number | null;
  total: number | null;
}

/**
 * The true on-hand amount to compare against par.
 *   - mid_day: inputs.total is a prepped DELTA → have = onHand + total
 *   - am_prep / other: inputs.total is the FINAL amount → have = total ?? onHand
 * Returns null when neither value is present.
 */
export function derivePrepHave({ isMidDay, onHand, total }: PrepHaveInput): number | null {
  if (isMidDay) {
    return onHand === null && total === null ? null : (onHand ?? 0) + (total ?? 0);
  }
  return total ?? onHand ?? null;
}

export type ParStatus = "under" | "over" | "at" | "na";

export function parStatusFromHave(par: number | null, have: number | null): ParStatus {
  if (par === null || have === null) return "na";
  if (have < par) return "under";
  if (have > par) return "over";
  return "at";
}

/**
 * True when a fridge-temp reading is out of safe range (> 41°F). The CALLER
 * must already know the completion's template_item_id is in the location's
 * temp-item registry — this only checks the count, never "any count > 41".
 */
export function isOutOfRangeTemp(countValue: number | null): boolean {
  return countValue !== null && countValue > FRIDGE_DEFAULT_SAFE_MAX_F;
}
