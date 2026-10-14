/**
 * D-13 (Juan, 2026-10-13, option b) — who may EDIT the "Uses: …" consumption panel on a prep
 * row. CLIENT-SAFE: no I/O, no server imports (type-only import below erases).
 *
 * Crew (level < 4: Trainee, Employee, …) see the panel READ-ONLY and collapsed — the summary
 * line only, no expand-to-edit, no Case ⇄ Each toggle. Key Holder (4) and up keep the editor.
 * The UI hiding is NOT the gate: the prep saves (opening Phase 2 `savePhase2Item`, mid-day
 * Phase 2 `saveMidDayPhase2Item`) pass the client's confirmed set through
 * `consumptionOverrideFor`, so a crew save records the DERIVED consumption whatever the body
 * carried.
 */
import type { ConfirmedInput } from "@/lib/prep-consumption";

/** Key Holder — the lowest level that may edit a prep row's SKU consumption. */
export const CONSUMPTION_EDIT_MIN = 4;

export function canEditConsumption(level: number): boolean {
  return Number.isFinite(level) && level >= CONSUMPTION_EDIT_MIN;
}

/**
 * The consumption override a save may honour: the client's confirmed set for KH+, and null
 * (= record the derived default) for crew, whatever the request body carried.
 */
export function consumptionOverrideFor(
  level: number,
  confirmed: ConfirmedInput[] | null | undefined,
): ConfirmedInput[] | null {
  return canEditConsumption(level) ? (confirmed ?? null) : null;
}
