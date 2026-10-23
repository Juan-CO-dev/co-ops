/** Stateless people/quarter rules. No runtime or type dependency on the validator. */
import { getRoleLevel, type RoleCode } from "@/lib/roles";
import type { DayContext, RulePerson } from "./context-shared";
import type { LeaderSetting, ScheduleStructure, StructurePosition } from "./structure-shared";

type HoldProblem = { code: "role_not_allowed" | "catering_cover_in_catering_window" | "manager_on_boh" | "cover_outside_preferences" | "work_type_not_allowed";
  params?: Record<string, string | number | boolean | null> };

/** The reason key that marks the call-out last resort (rule d's exemption; Phase 2 never emits it). */
export const CALLOUT_LAST_RESORT = "schedule.reason.callout_last_resort";
/**
 * Juan 2026-10-16 (decision 8): the segment marker of a catering manager covering a station — ONLY as a last resort
 * (`lastResort: true`), never on Prep/Dishwasher, and never inside a booked catering window (`cateringWindows`).
 */
export const CATERING_MANAGER_COVER = "schedule.reason.catering_manager_cover";

export interface Segment { positionId: string; startQ: number; endQ: number; lastResort?: boolean; coverFor?: string; reasonKey?: string }
export const LEADER_ROLES: readonly RoleCode[] = ["key_holder", "shift_lead", "agm", "gm", "moo", "owner"];

/** Managers (MoD-eligible, rule d / i) = shift lead and up (§5.7). */
export function isManagerRole(role: RoleCode): boolean {
  return getRoleLevel(role) >= 5;
}

/**
 * Does this person COUNT as the manager on duty at quarter q? Shift lead and up always; a key holder only
 * when the shop's setting "KH may be manager on duty after <time>" is ON and q is at or after that time
 * (CC 2026-10-16; default OFF). Pinned MoO / Owner presence counts like any manager.
 */
export function modCountsAt(p: Pick<RulePerson, "role">, s: ScheduleStructure, q: number): boolean {
  if (isManagerRole(p.role)) return true;
  const after = s.leadership.keyHolderModAfterQ;
  return p.role === "key_holder" && after !== null && q >= after;
}

/**
 * CC addendum B3 (2026-10-16): the manager on duty on a built DATE — `modCountsAt`, except that a (pinned) catering manager
 * counts only OUTSIDE that date's booked catering windows (`cateringWindows`): inside one they are doing catering.
 */
export function modCountsOn(p: Pick<RulePerson, "role">, day: Pick<DayContext, "structure" | "inputs">, q: number): boolean {
  if (!modCountsAt(p, day.structure, q)) return false;
  return p.role !== "catering_mgr" || !cateringWindows(day).some(([a, z]) => q >= a && q < z);
}

export function leaderSettingOf(p: RulePerson, s: ScheduleStructure): LeaderSetting {
  return p.leaderSetting ?? s.leadership.leaderDefaults[p.role] ?? "mix";
}

/** The mockup's work-type rule: Management anything; Prep/Dishwasher BOH; Prep BOH or FOH; the line FOH. */
export function workTypeAllows(p: Pick<RulePerson, "workType" | "alsoAllowed">, pos: Pick<StructurePosition, "role">): boolean {
  if (p.workType === "management") return true;
  if (pos.role === "prep_dish") return p.workType === "boh" || p.alsoAllowed.includes("boh");
  if (pos.role === "prep") return p.workType === "boh" || p.workType === "foh" || p.alsoAllowed.includes("boh");
  return p.workType === "foh" || p.alsoAllowed.includes("foh");
}

/**
 * Juan 2026-10-16 (decision 8): the catering manager is ON the roster but the generator never plans them: their own shifts
 * come only from a manager pin or the presence settings, and a station sees them only as the last-resort cover outside the
 * booked catering windows (`CATERING_MANAGER_COVER`). So they are never "eligible" for a placement, a fill or a proof.
 */
export function neverGenerated(p: Pick<RulePerson, "role" | "presenceOnly">): boolean {
  // CC addendum B2 (2026-10-16): a prep manager's MoD shifts are NEVER generated either (CO has no prep manager) — pins /
  // presence only.
  return p.presenceOnly || p.role === "catering_mgr" || p.role === "prep_mgr";
}

/** May this person be placed on this position at all (role, Prep/Dishwasher never for a manager, work type)? */
export function eligibleForPosition(p: RulePerson, pos: StructurePosition | undefined): boolean {
  if (!pos || !p.activeMember || neverGenerated(p)) return false;
  if (!pos.allowedRoles.includes(p.role)) return false;
  if (pos.role === "prep_dish" && isManagerRole(p.role)) return false;
  return workTypeAllows(p, pos);
}

/**
 * CC chunk H8 — THE ONE position-holding rule set, shared by the validator and the floor certificate. The problems a segment of
 * `p` on `positionId` over [startQ, endQ) with these flags raises (the validator's rules d / i and decision 8), each with the
 * validator's own params: `role_not_allowed` (the call-out exemption for a manager on Prep / Dishwasher and the catering manager's
 * marked cover excepted), `catering_cover_in_catering_window`, `manager_on_boh` (call-out excepted), `cover_outside_preferences`
 * (a manager outside their cover list unless marked last resort), `work_type_not_allowed`. Window, membership and the untouchable
 * day are the shift-level rules beside it.
 */
export function segmentHoldProblems(
  p: RulePerson, positionId: string, g: Pick<Segment, "startQ" | "endQ" | "lastResort" | "coverFor" | "reasonKey">,
  day: Pick<DayContext, "structure" | "inputs">,
): HoldProblem[] {
  const pos = day.structure.positions[positionId];
  const manager = isManagerRole(p.role);
  const out: HoldProblem[] = [];
  const callout = !!g.coverFor && g.reasonKey === CALLOUT_LAST_RESORT;
  // Decision 8: a catering manager may cover a station (never Prep/Dishwasher) as a marked last resort.
  const cateringCover = p.role === "catering_mgr" && !!g.lastResort && g.reasonKey === CATERING_MANAGER_COVER && !!pos && pos.role !== "prep_dish";
  if (!pos?.allowedRoles.includes(p.role) && !(pos?.role === "prep_dish" && manager && callout) && !cateringCover) out.push({ code: "role_not_allowed", params: { role: p.role } });
  if (cateringCover && cateringWindows(day).some(([a, z]) => g.startQ < z && g.endQ > a)) out.push({ code: "catering_cover_in_catering_window" });
  if (pos?.role === "prep_dish" && manager && !callout) out.push({ code: "manager_on_boh" });
  if (manager && !p.coverPositions.includes(positionId) && !g.lastResort) out.push({ code: "cover_outside_preferences" });
  if (pos && !workTypeAllows(p, pos)) out.push({ code: "work_type_not_allowed", params: { workType: p.workType } });
  return out;
}

/** The ways a person may hold a station: plainly, as a manager's marked last-resort cover, or as the catering manager's marked cover. */
export type HoldPath = "eligible" | "last_resort" | "catering_cover";
const HOLD_FLAGS: ReadonlyArray<[HoldPath, Pick<Segment, "lastResort" | "reasonKey">]> = [
  ["eligible", {}], ["last_resort", { lastResort: true }], ["catering_cover", { lastResort: true, reasonKey: CATERING_MANAGER_COVER }],
];

/**
 * CC chunk H8: may `p` LEGALLY hold `positionId` at quarter q on `date` by ANY path the validator accepts — an active member,
 * not on an untouchable day, inside the position's window, and a segment [q, q+1) with one of the flag sets (plain · last resort ·
 * the catering manager's cover) raising none of `segmentHoldProblems`? The path, or null. (A call-out — `coverFor` + the call-out
 * reason — is a Phase 3 event about a real absent person, not a way to staff a gap, so it is not a path here.)
 */
export function legalHoldPath(p: RulePerson, positionId: string, day: Pick<DayContext, "structure" | "inputs">, date: string, q: number): HoldPath | null {
  const pos = day.structure.positions[positionId];
  if (!pos || !p.activeMember || p.untouchableDates.includes(date) || q < pos.openQ || q >= pos.closeQ) return null;
  for (const [path, flags] of HOLD_FLAGS) if (segmentHoldProblems(p, positionId, { startQ: q, endQ: q + 1, ...flags }, day).length === 0) return path;
  return null;
}

/**
 * The BOOKED catering windows of a built date (decision 8), from the booked-catering input: [event − lead, event) for an
 * event with a time, else the structure's default catering window — every booked event, whatever its headcount.
 */
export function cateringWindows(day: Pick<DayContext, "structure" | "inputs">): Array<[number, number]> {
  const c = day.structure.catering;
  return [...day.inputs.cateringEvents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((ev): [number, number] =>
    ev.eventQ === null ? [c.defaultStartQ, c.defaultEndQ] : [Math.max(0, ev.eventQ - c.leadMinutes / 15), ev.eventQ]);
}

/** The leader open / close setting allows a shift spanning [fromQ, toQ)? (opens: ends before service close; closes: starts at or after service start) */
export function leaderSettingAllows(p: RulePerson, s: ScheduleStructure, fromQ: number, toQ: number): boolean {
  if (!LEADER_ROLES.includes(p.role)) return true;
  const setting = leaderSettingOf(p, s);
  if (setting === "opens") return toQ < s.shopDay.serviceCloseQ;
  if (setting === "closes") return fromQ >= s.shopDay.serviceStartQ;
  return true;
}

