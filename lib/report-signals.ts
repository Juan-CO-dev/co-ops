/**
 * Pure signal-derivation helpers shared by the Reports Hub list/detail loader
 * (lib/reports-hub.ts computeReportSignals) and the trends loader
 * (lib/reports-trends.ts). Extracted so the bug-prone par math lives in ONE
 * place. Final-check deviations use persisted opening/mid-day outcomes;
 * numeric detail values still distinguish a mid-day DELTA from an AM-prep FINAL
 * amount (see AGENTS.md "Same field name, different meaning across types").
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

/** Final-check deviations only; AM prep is an evening stock count. */
export function reportParDeviation(type: string, prepData: unknown): "under" | "over" | null {
  if (!prepData || typeof prepData !== "object") return null;
  const data = prepData as Record<string, unknown>;
  if (type === "opening" && data.phase2 && typeof data.phase2 === "object") {
    const status = (data.phase2 as Record<string, unknown>).over_under_status;
    return status === "under_prep" ? "under" : status === "over_prep" ? "over" : null;
  }
  if (type === "mid_day" && data.overUnder && typeof data.overUnder === "object") {
    const kind = (data.overUnder as Record<string, unknown>).kind;
    return kind === "under" || kind === "over" ? kind : null;
  }
  return null;
}

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
