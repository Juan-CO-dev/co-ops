/**
 * W15/B089: what the prep par grid sends for one row. CLIENT-SAFE (pure, no I/O).
 *
 * Number("1,5") and Number("abc") are NaN, and JSON.stringify sends NaN as null, so a
 * typo used to save as "no par". The box is now read with the shared decimal rule
 * (a comma reads as a decimal point, as on Spanish keypads); anything that is not a
 * number 0 or more is refused, never sent. A Manual par needs a number (a blank Manual
 * used to erase that day's par). Inherit always sends null (take the recommendation);
 * Auto with a blank box sends null as before.
 */
import { parseDecimalDraft } from "@/lib/prep-display-shared";
import type { ParMode } from "@/lib/types";

export type ParGridSave =
  | { ok: true; parValue: number | null }
  | { ok: false; code: "invalid_par" };

export function parGridSaveValue(state: { parMode: ParMode; parValue: string }): ParGridSave {
  if (state.parMode === "inherit") return { ok: true, parValue: null };
  const draft = parseDecimalDraft(state.parValue);
  if (draft.kind === "empty") {
    return state.parMode === "manual" ? { ok: false, code: "invalid_par" } : { ok: true, parValue: null };
  }
  if (draft.kind === "invalid") return { ok: false, code: "invalid_par" };
  if (draft.value === null) return { ok: false, code: "invalid_par" };
  return { ok: true, parValue: draft.value };
}
