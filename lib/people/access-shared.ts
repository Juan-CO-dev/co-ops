/**
 * THE PEOPLE-LAYER PERMISSIONS — every rule, pure, called before any I/O.
 *
 * Scheduling Phase 1 (plan 2026-10-15, "Permissions"). One place decides who may read or write
 * people data: team scoring, skills, the 7shifts links and status, wages, and the PM v2 copies.
 * Loaders and routes call these functions FIRST and never re-derive a rule of their own.
 *
 * THE ACTOR CARRIES ITS TRUSTED ROLE (r1 P2-8). Level 6 is not one thing: AGM, prep manager and
 * catering manager are operational managers, and the social media manager (also level 6) is
 * refused people data by ROLE — the catalog's `catalogWriteRoleAllowed` precedent. So no rule
 * here accepts a level without a role. `PeopleActor` is built ONCE per request from the verified
 * session by `peopleActorFromAuth`, never from a request body.
 *
 * LOCATION BIND. Below MoO an actor acts only at shops in its own `user_locations`. MoO (8)+
 * reads every shop (the `canReadReportLocation` semantics), and the writes that the matrix opens
 * to "MoO+ any shop" say so explicitly per function — never inherited by accident.
 */
import { canActOn, type RoleCode } from "@/lib/roles";

/** The trusted actor every rule takes. Built from the session, never from a body. */
export interface PeopleActor {
  userId: string;
  role: RoleCode;
  level: number;
  locations: readonly string[];
}

/** The verified-session fields the actor is built from (structurally `AuthContext`). */
export interface PeopleAuthSource {
  user: { id: string };
  role: RoleCode;
  level: number;
  locations: readonly string[];
}

/** role ← auth.role, level ← auth.level, locations ← a COPY of auth.locations. Nothing else is read. */
export function peopleActorFromAuth(auth: PeopleAuthSource): PeopleActor {
  return { userId: auth.user.id, role: auth.role, level: auth.level, locations: [...auth.locations] };
}

export const MOO_LEVEL = 8;
export const GM_LEVEL = 7;
export const KH_LEVEL = 4;

/** The level-6 OPERATIONAL managers ("Op-6"): level 6 minus the social media manager. */
export const OPERATIONAL_LEVEL6_ROLES: readonly RoleCode[] = ["agm", "catering_mgr", "prep_mgr"];

function isSmm(actor: PeopleActor): boolean {
  return actor.role === "social_media_mgr";
}
function isMooPlus(actor: PeopleActor): boolean {
  return !isSmm(actor) && actor.level >= MOO_LEVEL;
}
function isGm(actor: PeopleActor): boolean {
  return actor.role === "gm" && actor.level >= GM_LEVEL;
}
function isOp6(actor: PeopleActor): boolean {
  return OPERATIONAL_LEVEL6_ROLES.includes(actor.role) && actor.level >= 6;
}
function holdsShop(actor: PeopleActor, locationId: string): boolean {
  return locationId !== "" && locationId !== "all" && actor.locations.includes(locationId);
}
function concreteShop(locationId: string): boolean {
  return locationId !== "" && locationId !== "all";
}

/** GM own shop, MoO+ any shop. The shape of most people-data WRITES. */
function gmOwnOrMooAny(actor: PeopleActor, locationId: string): boolean {
  if (!concreteShop(locationId)) return false;
  return isMooPlus(actor) || (isGm(actor) && holdsShop(actor, locationId));
}

/** GM or Op-6 own shop, MoO+ any shop, SMM never. The shape of people-data READS (R7). */
function managerOwnOrMooAny(actor: PeopleActor, locationId: string): boolean {
  if (!concreteShop(locationId) || isSmm(actor)) return false;
  return isMooPlus(actor) || ((isGm(actor) || isOp6(actor)) && holdsShop(actor, locationId));
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Team scoring, person detail, person report locations, skills of others. One shop at a time. */
export function canViewPeople(actor: PeopleActor, locationId: string): boolean {
  return managerOwnOrMooAny(actor, locationId);
}

/**
 * May this actor open the people views at all (the team pages, before a shop is chosen)? GM, Op-6 and
 * MoO+; the social media manager never (R7, by ROLE). The per-shop rule is `canViewPeople`.
 */
export function canOpenPeopleViews(actor: PeopleActor): boolean {
  return !isSmm(actor) && (isMooPlus(actor) || isGm(actor) || isOp6(actor));
}

/** The 7shifts status line for a shop. */
export function canViewSevenShiftsStatus(actor: PeopleActor, locationId: string): boolean {
  return managerOwnOrMooAny(actor, locationId);
}

/** R5: individual wage rates — MoO+ only. No Phase 1 caller. */
export function canSeeWageRates(actor: PeopleActor): boolean {
  return isMooPlus(actor);
}

/** R5: a shop's labor totals — GM own shop, MoO+ any. Not SMM, not Op-6. No Phase 1 caller. */
export function canSeeShopLaborTotals(actor: PeopleActor, locationId: string): boolean {
  return !isSmm(actor) && gmOwnOrMooAny(actor, locationId);
}

// ─── Writes: skills and settings ─────────────────────────────────────────────

/** A manager skill adjustment: GM own shop, MoO+ any, and the actor strictly outranks the subject. */
export function canAdjustSkill(actor: PeopleActor, subject: { role: RoleCode }, locationId: string): boolean {
  return gmOwnOrMooAny(actor, locationId) && canActOn(actor.role, subject.role);
}

/** The new-hire starting rating: the same rule as an adjustment. */
export function canRateNewHire(actor: PeopleActor, subject: { role: RoleCode }, locationId: string): boolean {
  return canAdjustSkill(actor, subject, locationId);
}

/** People shop settings (the PM v2 switch, the prep evidence position). */
export function canEditPeopleSettings(actor: PeopleActor, locationId: string): boolean {
  return gmOwnOrMooAny(actor, locationId);
}

/** The PM criteria editor (the route ALSO requires the Tier E window; that is not decided here). */
export function canEditPmCriteria(actor: PeopleActor, locationId: string): boolean {
  return gmOwnOrMooAny(actor, locationId);
}

/** R11: the skill tunables shape every shop's read — MoO+ only (Tier E checked by the route). */
export function canEditSkillTunables(actor: PeopleActor): boolean {
  return isMooPlus(actor);
}

// ─── Writes: 7shifts ─────────────────────────────────────────────────────────

/** 7shifts shop links are company-level config. */
export function canManageSevenShiftsShops(actor: PeopleActor): boolean {
  return isMooPlus(actor);
}

/**
 * A 7shifts person link at a shop. GM: own shop, and the CO-OPS user must hold an active
 * membership there. MoO+: any shop. Either way the actor's level is ≥ the subject's.
 */
export function canLinkSevenShiftsUser(
  actor: PeopleActor,
  subjectLevel: number,
  subjectLocations: readonly string[],
  locationId: string,
): boolean {
  if (!gmOwnOrMooAny(actor, locationId) || actor.level < subjectLevel) return false;
  if (isMooPlus(actor)) return true;
  return subjectLocations.includes(locationId);
}

/**
 * Ruling (a), `remote_not_at_shop`: below MoO, the 7shifts person must hold a LIVE assignment at the
 * 7shifts location LIVE-linked to the shop. MoO+ links anywhere. The 0269 RPC enforces the same rule.
 */
export function linkNeedsRemoteAtShop(actor: PeopleActor): boolean {
  return !isMooPlus(actor);
}

/**
 * May this actor link or unlink 7shifts PEOPLE at this shop at all (Task 10)? GM own shop, MoO+ any.
 * The front-door check, decided before any I/O; `canLinkSevenShiftsUser` then judges the subject.
 */
export function canManageSevenShiftsPeople(actor: PeopleActor, locationId: string): boolean {
  return gmOwnOrMooAny(actor, locationId);
}

/** Sync now spends the shared rate budget: MoO+ only. */
export function canSyncNow(actor: PeopleActor): boolean {
  return isMooPlus(actor);
}

// ─── PM reports v2: the ONE copy lifecycle (r1 P2-9) ─────────────────────────

export type PmCopyStatus = "open" | "done" | "sealed";
/** `pm_reports.status` (0072). Anything but `open` is a submitted (finalized) day. */
export type PmDayStatus = "open" | "submitted" | "incomplete_confirmed" | "auto_finalized";

export interface PmCopyRef {
  authorId: string;
  locationId: string;
  status: PmCopyStatus;
}
export interface PmDayRef {
  locationId: string;
  status: PmDayStatus;
  /** Every author with a copy on that day. */
  authorIds: readonly string[];
}

/**
 * THE lifecycle, as data. The pure rules below, the 0271 RPC guards and the copy form's states
 * all read this table (pinned by tests/fixtures/pm-copy-lifecycle-cases.json).
 */
export const PM_COPY_TRANSITIONS = {
  write: { from: ["open"], to: "open" }, // grade, note, add position, window
  markDone: { from: ["open"], to: "done" },
  reopen: { from: ["done"], to: "open" }, // author only, day open
  seal: { from: ["open", "done"], to: "sealed" }, // submit only
} as const satisfies Record<string, { from: readonly PmCopyStatus[]; to: PmCopyStatus }>;

export type PmCopyAct = keyof typeof PM_COPY_TRANSITIONS;
export type PmCopyRefusal = "forbidden" | "not_author" | "copy_sealed" | "copy_done" | "copy_not_done" | "day_closed";

export function pmDaySubmitted(status: PmDayStatus): boolean {
  return status !== "open";
}

/**
 * The refusal for one act on one copy, or null when allowed. Order: who (role floor, shop pairing,
 * authorship), then the copy's state against the transition table, then the day. `seal` is the
 * submit's act, so it is not the author's: the submitter's own gate is `canSubmitPmDay`.
 */
export function pmCopyActRefusal(act: PmCopyAct, actor: PeopleActor, copy: PmCopyRef, day: PmDayRef): PmCopyRefusal | null {
  if (copy.locationId !== day.locationId) return "forbidden";
  if (act === "seal") {
    if (!canSubmitPmDay(actor)) return "forbidden";
  } else {
    if (isSmm(actor) || actor.level < KH_LEVEL) return "forbidden";
    if (copy.authorId !== actor.userId) return "not_author";
  }
  const from: readonly PmCopyStatus[] = PM_COPY_TRANSITIONS[act].from;
  if (!from.includes(copy.status)) {
    if (copy.status === "sealed") return "copy_sealed";
    if (copy.status === "done") return "copy_done";
    return "copy_not_done"; // only reopen refuses an open copy
  }
  if (pmDaySubmitted(day.status)) return "day_closed";
  return null;
}

/** Grade, note, add a position, set the window: the author, an OPEN copy, an open day. */
export function canWritePmCopy(actor: PeopleActor, copy: PmCopyRef, day: PmDayRef): boolean {
  return pmCopyActRefusal("write", actor, copy, day) === null;
}
/** Mark done: the author, open → done, an open day. */
export function canMarkDone(actor: PeopleActor, copy: PmCopyRef, day: PmDayRef): boolean {
  return pmCopyActRefusal("markDone", actor, copy, day) === null;
}
/** Reopen: the author, done → open, an open day. */
export function canReopenPmCopy(actor: PeopleActor, copy: PmCopyRef, day: PmDayRef): boolean {
  return pmCopyActRefusal("reopen", actor, copy, day) === null;
}

/** Submit the day (= the closing manager): KH+, not SMM. Task access is the I/O half's check. */
export function canSubmitPmDay(actor: PeopleActor): boolean {
  return !isSmm(actor) && actor.level >= KH_LEVEL;
}

/**
 * Who reads a PM v2 copy. The author always. Before submit, NOBODY else (MoO and Owner included:
 * blind by design, so the average is independent). After submit: that day's authors, GM / Op-6 of
 * the shop, MoO+ any shop. Never the SMM; never other KH/SL of the shop (J9).
 */
export function canReadPmCopy(actor: PeopleActor, copy: PmCopyRef, day: PmDayRef): boolean {
  if (copy.locationId !== day.locationId) return false;
  if (copy.authorId === actor.userId) return true;
  if (!pmDaySubmitted(day.status) || isSmm(actor)) return false;
  if (day.authorIds.includes(actor.userId)) return true;
  return managerOwnOrMooAny(actor, day.locationId);
}
