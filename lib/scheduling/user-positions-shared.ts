/**
 * THE USER SCREEN'S POSITION PICKERS — pure, client-safe (Juan 2026-10-20). On the admin user screen (add AND edit), per
 * shop the person belongs to: their work type, PRIMARY and SECONDARY position, written as the SAME schedule person
 * settings the staff settings card writes (`personBody` → POST /api/schedule {action: "person"}: GM own / MoO+ — every
 * actor of the user screen, level 8+, holds that tier). Everyone below shift lead; a manager's ordered list is their cover
 * order and stays on the schedule settings card.
 *
 * The rest of the person's settings row (also allowed, leader setting, soft range, full-timer, the "can flex to" tail) is
 * carried over untouched: the write is the person's latest row with only the work type and the first two positions changed.
 */
import type { RoleCode } from "@/lib/roles";
import type { WorkType } from "./context-shared";
import { defaultWorkType, type PersonSettingsRow } from "./people-input-shared";
import { positionListProblems, withPrimarySecondary, type PositionListProblem, type ToastPrimarySuggestion } from "./position-rank-shared";
import type { PositionRole } from "./structure-shared";

export interface PickerPosition { id: string; name: string; nameEs: string | null; role: PositionRole | null }

/** One shop's picker data: its live positions, whether their roles are known, every member's latest settings, suggestions. */
export interface ShopPositionPicker {
  locationId: string;
  positions: PickerPosition[];
  /** The structure is saved, so the positions' roles (and the work-type check) are known. */
  rolesKnown: boolean;
  /** userId → the latest person settings row at this shop (absent = role defaults). */
  settings: Record<string, PersonSettingsRow>;
  /** userId → the Toast suggestion (a Toast link, no primary yet, a confident match). */
  suggestions: Record<string, ToastPrimarySuggestion>;
}

/** What one shop's pickers hold. `workType` null = the role default. */
export interface PositionPick { workType: WorkType | null; primary: string | null; secondary: string | null }

export function emptySettingsRow(userId: string): PersonSettingsRow {
  return { userId, workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null };
}

/** The picks a stored row shows. */
export function pickOf(row: PersonSettingsRow | null | undefined): PositionPick {
  return { workType: row?.workType ?? null, primary: row?.coverPositions[0] ?? null, secondary: row?.coverPositions[1] ?? null };
}

/** The row to write: the latest row (or an empty one) with the work type and the first two positions replaced. */
export function nextSettingsRow(current: PersonSettingsRow | null | undefined, userId: string, pick: PositionPick): PersonSettingsRow {
  const base = current ? { ...current, alsoAllowed: [...current.alsoAllowed], coverPositions: [...current.coverPositions] } : emptySettingsRow(userId);
  return { ...base, userId, workType: pick.workType, coverPositions: withPrimarySecondary(base.coverPositions, pick.primary, pick.secondary) };
}

/** Did the picks change anything worth a write? */
export function pickChanged(current: PersonSettingsRow | null | undefined, pick: PositionPick): boolean {
  const was = pickOf(current);
  return was.workType !== pick.workType || was.primary !== pick.primary || (pick.primary !== null && was.secondary !== pick.secondary);
}

/** The work-type problems of the picks (the save path's own rule; roles only when the shop's structure is saved). */
export function pickProblems(role: RoleCode, current: PersonSettingsRow | null | undefined, pick: PositionPick, shop: Pick<ShopPositionPicker, "positions" | "rolesKnown">): PositionListProblem[] {
  const roles: Record<string, PositionRole> = {};
  if (shop.rolesKnown) for (const p of shop.positions) if (p.role) roles[p.id] = p.role;
  const list = withPrimarySecondary(current?.coverPositions ?? [], pick.primary, pick.secondary);
  return positionListProblems({ role, workType: pick.workType ?? defaultWorkType(role), alsoAllowed: current?.alsoAllowed ?? [] }, list, roles);
}

/** How many "can flex to" entries clearing the primary would drop. */
export function flexDropped(current: PersonSettingsRow | null | undefined, pick: PositionPick): number {
  return pick.primary === null ? Math.max(0, (current?.coverPositions.length ?? 0) - 2) : 0;
}
