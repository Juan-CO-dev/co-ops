import { ScheduleError } from "./errors-shared";
/** Persisted crew-engine evidence. Historical station revisions omit these fields. */
import type { ShiftRef } from "./edit-shared";
import type { BoardNote } from "./reasons-shared";
import type { Shift } from "./rules-shared";

export interface CrewShiftMeta {
  userId: string;
  startQ: number;
  typeId: string | null;
  source: "usual" | "fill" | "salaried" | "pin" | "manual" | "backup_cover";
}

export interface CrewManualOverride {
  /** Present only when the manager added the shift; absent keeps legacy deletion semantics. */
  added?: true;
  original: ShiftRef;
  /** null preserves an intentional deletion across regeneration. */
  replacement: Shift | null;
}

export interface CrewDaySnapshot {
  version: 1;
  shifts: CrewShiftMeta[];
  manualOverrides: CrewManualOverride[];
  notes: BoardNote[];
}

export const CREW_REJECTION_CODES = [
  "off", "time_off", "unavailable", "already_scheduled", "position", "leader_setting",
  "minimum_length", "maximum_length", "day_limit", "soft_max", "overtime", "budget", "manager_limit", "backup_cover_cap",
] as const;
export type CrewRejectionCode = (typeof CREW_REJECTION_CODES)[number];

export interface OpenShiftItem {
  typeId: string;
  fromQ: number;
  toQ: number;
  required: number;
  placed: number;
  missing: number;
  rejected: Array<{ userId: string; codes: CrewRejectionCode[] }>;
}

/** Evidence under the fixed crew, never a claim of global scheduling impossibility. */
export type CrewGapCertificate =
  | { kind: "open_shifts"; items: OpenShiftItem[] }
  | { kind: "station_short"; required: number; assigned: number; onShiftUserIds: string[] };

/** Evidence is bounded per day; never discard edits or notes to make a revision fit. */
export const CREW_MAX_MANUAL_OVERRIDES_PER_DAY = 60;
/** Fixture sizing reference only: generator notes are aggregated, never capped. */
export const CREW_MAX_NOTES_PER_DAY = 32;
export function assertCrewDayFits(day: CrewDaySnapshot): void {
  for (const [field, max] of [["manualOverrides", CREW_MAX_MANUAL_OVERRIDES_PER_DAY]] as const) {
    if (day[field].length > max) throw new ScheduleError("crew_snapshot_limit", { params: { field, count: day[field].length, max } });
  }
}
