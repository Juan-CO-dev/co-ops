/**
 * THE SCHEDULING PERMISSIONS — every rule, pure, called before any I/O (Scheduling Phase 2, plan
 * "Permissions"). Loaders, the lib and the routes ask THIS module first and never re-derive a rule.
 *
 * The actor is Phase 1's `PeopleActor` (trusted ROLE + level + memberships, built from the session by
 * `peopleActorFromAuth`). Level 6 is not one thing: the AGM reads the board at their own shop (and,
 * with the per-shop setting `agm_access = 'edit'` (R1), builds and edits it), the catering and prep
 * managers are refused (`schedule_forbidden`), and the social media manager is refused by ROLE
 * (`schedule_role_refused`) whatever level it claims. Money is `canSeeShopLaborTotals` (GM own,
 * MoO+ any) and never the AGM's, because labor % × forecast reveals the dollars (J1). Below MoO an
 * actor acts only at shops in its own memberships; MoO (8)+ acts at any shop.
 */
import { MOO_LEVEL, GM_LEVEL, OPERATIONAL_LEVEL6_ROLES, canSeeShopLaborTotals, type PeopleActor } from "@/lib/people/access-shared";
import { getRoleLevel, type RoleCode } from "@/lib/roles";
import type { ScheduleErrorCode } from "./errors-shared";

/** Every act the scheduling surfaces perform. `budget` covers set / accept / keep the suggestion. */
export const SCHEDULE_ACTS = [
  "view", "reconciliation", "generate", "edit", "regenerate", "budget", "presence", "day_type", "person_settings",
  "approve", "structure", "shop_switch", "wage_estimates", "tunables",
] as const;
export type ScheduleAct = (typeof SCHEDULE_ACTS)[number];

/** The per-shop setting `schedule_shop_settings.agm_access` (R1, default 'read'). */
export interface ScheduleShopAccess { agmAccess: "read" | "edit" }

/** The acts an AGM may perform at their own shop when `agm_access = 'edit'`: build and edit, nothing else. */
const AGM_EDIT_ACTS: readonly ScheduleAct[] = ["generate", "edit", "regenerate", "budget", "presence", "day_type", "person_settings"];
/** The acts that are MoO+ only (Tier E): the per-shop switch, the wage estimates, the skill tunables. */
const MOO_ONLY_ACTS: readonly ScheduleAct[] = ["shop_switch", "wage_estimates", "tunables"];

const isSmm = (a: PeopleActor) => a.role === "social_media_mgr";
const isMooPlus = (a: PeopleActor) => !isSmm(a) && a.level >= MOO_LEVEL;
const isGm = (a: PeopleActor) => a.role === "gm" && a.level >= GM_LEVEL;
const isAgm = (a: PeopleActor) => a.role === "agm" && a.level >= 6 && OPERATIONAL_LEVEL6_ROLES.includes(a.role);
const concreteShop = (locationId: string) => locationId !== "" && locationId !== "all";
const holdsShop = (a: PeopleActor, locationId: string) => concreteShop(locationId) && a.locations.includes(locationId);

/**
 * The named refusal for `act` at `locationId`, or null when allowed. Order: the ROLE (SMM by role;
 * anyone who is not a GM, an AGM or MoO+ — catering / prep managers and everyone below 6 — forbidden),
 * then the SHOP (below MoO, own shops only), then the ACT.
 */
export function scheduleActRefusal(actor: PeopleActor, locationId: string, act: ScheduleAct, access: ScheduleShopAccess): ScheduleErrorCode | null {
  if (isSmm(actor)) return "schedule_role_refused";
  const mooPlus = isMooPlus(actor);
  if (!mooPlus && !isGm(actor) && !isAgm(actor)) return "schedule_forbidden";
  if (!concreteShop(locationId)) return "shop_not_allowed";
  if (!mooPlus && !holdsShop(actor, locationId)) return "shop_not_allowed";
  if (mooPlus) return null;
  if (MOO_ONLY_ACTS.includes(act)) return "schedule_forbidden";
  if (isGm(actor)) return null;
  // The AGM at their own shop.
  if (act === "view") return null;
  if (access.agmAccess === "edit" && AGM_EDIT_ACTS.includes(act)) return null;
  return "schedule_forbidden";
}

/**
 * WHOSE schedule settings an actor may change (Juan 2026-10-20: "GMs own their shop"), on top of the act rule
 * (`person_settings`: GM own shop, MoO+ any, an AGM only with `agm_access = 'edit'`). Below MoO: never their own settings,
 * never anyone at or above GM level, and never anyone at or above their own level (an AGM with edit access sets people
 * below AGM). MoO+ is unchanged. Enforced in the save path (lib, before the RPC) and mirrored by the settings card.
 */
export function personSettingsSubjectRefusal(actor: PeopleActor, subject: { userId: string; role: RoleCode }): ScheduleErrorCode | null {
  if (isMooPlus(actor)) return null;
  const level = getRoleLevel(subject.role);
  // Astra BC-022/042: ids compared in canonical lowercase (an uppercase spelling of oneself is still oneself).
  if (subject.userId.toLowerCase() === actor.userId.toLowerCase() || level >= GM_LEVEL || level >= actor.level) return "schedule_forbidden";
  return null;
}

/** The board, read (an AGM sees hours, coverage and reasons; money is a separate rule). */
export function canViewSchedule(actor: PeopleActor, locationId: string): boolean {
  return scheduleActRefusal(actor, locationId, "view", { agmAccess: "read" }) === null;
}

/** The money strip's $ and %, the labor-target $ lines, labor % per hour: GM own, MoO+ any (J1, J9: never per person). */
export function canSeeScheduleMoney(actor: PeopleActor, locationId: string): boolean {
  return canSeeShopLaborTotals(actor, locationId);
}

/** Generate a new week, edit, set a budget, presence, day type, person settings, regenerate (Tier B separately). */
export function canEditSchedule(actor: PeopleActor, locationId: string, access: ScheduleShopAccess): boolean {
  return scheduleActRefusal(actor, locationId, "edit", access) === null;
}

/** Approve the week ("Ready for 7shifts"): GM own, MoO+ any — never the AGM (Tier B at the route). */
export function canApproveSchedule(actor: PeopleActor, locationId: string): boolean {
  return scheduleActRefusal(actor, locationId, "approve", { agmAccess: "read" }) === null;
}

/** The schedule structure: GM own, MoO+ any (Tier E at the route). */
export function canEditStructure(actor: PeopleActor, locationId: string): boolean {
  return scheduleActRefusal(actor, locationId, "structure", { agmAccess: "read" }) === null;
}

/** The per-shop switch and the wage estimates: MoO+ only, any shop (Tier E at the route). */
export function canManageShopSwitch(actor: PeopleActor): boolean {
  return isMooPlus(actor);
}

/** The three-way reconciliation view (CO-OPS user ↔ Toast link ↔ 7shifts link): GM own, MoO+ any. */
export function canViewReconciliation(actor: PeopleActor, locationId: string): boolean {
  return scheduleActRefusal(actor, locationId, "reconciliation", { agmAccess: "read" }) === null;
}

/**
 * The step-up tier an act takes at its route. B (120 s, always prompted) for approving and for a
 * regenerate that overwrites a confirmed edited week; E (the 15-minute edit window) for settings;
 * nothing for the operational acts (every write is audited). SQL never sees the password: it checks
 * only `confirmed_overwrite` (J12).
 */
export function stepUpFor(act: ScheduleAct, ctx: { confirmedEditedWeeks: number }): null | "B" | "E" {
  if (act === "approve") return "B";
  if (act === "regenerate") return ctx.confirmedEditedWeeks > 0 ? "B" : null;
  if (act === "structure" || MOO_ONLY_ACTS.includes(act)) return "E";
  return null;
}
