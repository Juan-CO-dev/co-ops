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
  /** userId → that row's id (sent back as the picks' expected head, Astra BC-007/042; absent = no row yet). */
  settingsIds?: Record<string, string>;
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

/**
 * What the pickers CHANGED against the row they were loaded with — the only fields the user screen sends (Astra BC-007):
 * the server merges them onto the person's LATEST row, so a save never overwrites full-time, the soft range, also-allowed,
 * the leader setting, roster_include or the "can flex to" tail that someone else changed after the page loaded.
 */
export interface PositionChanges { workType?: WorkType | null; primary?: string | null; secondary?: string | null }
export function positionChangesOf(loaded: PersonSettingsRow | null | undefined, pick: PositionPick): PositionChanges {
  const was = pickOf(loaded);
  const out: PositionChanges = {};
  if (was.workType !== pick.workType) out.workType = pick.workType;
  if (was.primary !== pick.primary) out.primary = pick.primary;
  if (was.secondary !== pick.secondary) out.secondary = pick.secondary;
  return out;
}

const WORK_TYPES_OK: ReadonlyArray<WorkType | null> = [null, "boh", "foh", "management"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A posted `changes` object, validated (only the three keys, each the right type); null = malformed. */
export function parsePositionChanges(v: Record<string, unknown>): PositionChanges | null {
  const keys = Object.keys(v);
  if (keys.length === 0 || keys.some((k) => k !== "workType" && k !== "primary" && k !== "secondary")) return null;
  const out: PositionChanges = {};
  if ("workType" in v) { if (!WORK_TYPES_OK.includes(v.workType as WorkType | null)) return null; out.workType = v.workType as WorkType | null; }
  for (const k of ["primary", "secondary"] as const) {
    if (!(k in v)) continue;
    const x = v[k];
    if (x !== null && (typeof x !== "string" || !UUID.test(x))) return null;
    out[k] = x as string | null;
  }
  return out;
}

/**
 * The row to write: the person's LATEST row (or an empty one) with ONLY the changed fields replaced — the work type, and the
 * list re-derived from the latest list when the primary or the secondary changed (an unchanged one is the latest's).
 */
export function mergePositionChanges(latest: PersonSettingsRow | null | undefined, userId: string, changes: PositionChanges): PersonSettingsRow {
  const base = latest ? { ...latest, alsoAllowed: [...latest.alsoAllowed], coverPositions: [...latest.coverPositions] } : emptySettingsRow(userId);
  const out: PersonSettingsRow = { ...base, userId };
  if ("workType" in changes) out.workType = changes.workType ?? null;
  if ("primary" in changes || "secondary" in changes) {
    const now = pickOf(base);
    out.coverPositions = withPrimarySecondary(base.coverPositions, "primary" in changes ? changes.primary ?? null : now.primary, "secondary" in changes ? changes.secondary ?? null : now.secondary);
  }
  return out;
}

/** The row the picks would write against `current` (the merge of their changes). */
export function nextSettingsRow(current: PersonSettingsRow | null | undefined, userId: string, pick: PositionPick): PersonSettingsRow {
  return mergePositionChanges(current, userId, positionChangesOf(current, pick));
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

/**
 * How many "can flex to" entries (beyond the two pickers) the picks would CLEAR: all of them with no primary, and with no
 * secondary too (Astra BC-013: never a silent promotion — the pickers name the count before a save).
 */
export function flexDropped(current: PersonSettingsRow | null | undefined, pick: PositionPick): number {
  const tail = (current?.coverPositions ?? []).slice(2);
  if (pick.primary === null) return tail.length;
  if (pick.secondary === null) return tail.filter((x) => x !== pick.primary).length;
  return 0;
}
