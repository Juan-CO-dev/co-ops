/* eslint-disable */
/**
 * FROZEN ORACLE (all-shops access plan r15, PR 1, 2026-11-22): every shop gate access PR 1 re-points, exactly as it was
 * on origin/main e4932411, BEFORE any change.
 *
 *   - lib/locations.ts: isAllLocationsAccess, accessibleLocations, lockLocationContext, canWorkShopTasks,
 *     shopTaskLocations, canReadReportLocation (the whole file's logic; the doc comments are trimmed);
 *   - lib/checklist-write-guard-shared.ts: worksShopTasks;
 *   - lib/checklists.ts: the two inline literal-8 shop binds, requireCorrectionShop (line 1896) and
 *     tagActualCompleter (line 2183), lifted into named predicates with their conditions copied character for character.
 *
 * The only edit is the import: `isRoleAtOrAbove` / `getRoleLevel` read FROZEN_ROLE_LEVELS below (lib/roles.ts at
 * e4932411) instead of the live registry, so a later role change cannot move the oracle.
 *
 * tests/shop-access-matrix.test.ts runs THIS and the live gates over every role x shop state x surface and asserts
 * total equality: PR 1 changes no answer. NEVER edit the code below to make a test pass. A difference is a finding about
 * the new code, not about this file. Later access PRs (3, 4, 5, 8) diff against this same oracle with their allowed
 * cells listed in the test (plan section 6).
 */

/** lib/roles.ts ROLES[*].level at e4932411 (15 roles). */
export const FROZEN_ROLE_LEVELS = {
  cgs: 10,
  owner: 9,
  moo: 8,
  gm: 7,
  agm: 6,
  catering_mgr: 6,
  prep_mgr: 6,
  social_media_mgr: 6,
  shift_lead: 5,
  key_holder: 4,
  trainer: 4,
  employee: 3,
  trainee: 2,
  hired_not_yet_worked: 1,
  prospect: 0,
} as const;

export type FrozenRoleCode = keyof typeof FROZEN_ROLE_LEVELS;

function getRoleLevel(code: FrozenRoleCode): number {
  return FROZEN_ROLE_LEVELS[code];
}

function isRoleAtOrAbove(actor: FrozenRoleCode, threshold: number): boolean {
  return getRoleLevel(actor) >= threshold;
}

// ── lib/locations.ts @ e4932411 ──────────────────────────────────────────────────────────────────────────────────────

const ALL_LOCATIONS_THRESHOLD = 9;
export const REPORT_ALL_LOCATIONS_LEVEL = 8;

export interface LocationActor {
  role: FrozenRoleCode;
  locations: string[];
}

export function isAllLocationsAccess(actor: LocationActor): boolean {
  return isRoleAtOrAbove(actor.role, ALL_LOCATIONS_THRESHOLD);
}

export function accessibleLocations(actor: LocationActor): string[] | "all" {
  return isAllLocationsAccess(actor) ? "all" : [...actor.locations];
}

export function lockLocationContext(actor: LocationActor, locationId: string): boolean {
  if (isAllLocationsAccess(actor)) return true;
  return actor.locations.includes(locationId);
}

export const SHOP_TASK_ALL_LOCATIONS_LEVEL = 8;

export function canWorkShopTasks(actor: LocationActor, locationId: string): boolean {
  return isRoleAtOrAbove(actor.role, SHOP_TASK_ALL_LOCATIONS_LEVEL) || actor.locations.includes(locationId);
}

export function shopTaskLocations(actor: LocationActor): string[] | "all" {
  return isRoleAtOrAbove(actor.role, SHOP_TASK_ALL_LOCATIONS_LEVEL) ? "all" : [...actor.locations];
}

export function canReadReportLocation(actor: LocationActor, locationId: string): boolean {
  return isRoleAtOrAbove(actor.role, REPORT_ALL_LOCATIONS_LEVEL) || lockLocationContext(actor, locationId);
}

// ── lib/checklist-write-guard-shared.ts @ e4932411 ───────────────────────────────────────────────────────────────────

export interface ChecklistWriteAuthority {
  readonly userId: string;
  readonly level: number;
  readonly active: boolean;
  readonly locations: readonly string[];
}

export function worksShopTasks(actor: ChecklistWriteAuthority, locationId: string): boolean {
  return actor.active && (actor.locations.includes(locationId) || actor.level >= SHOP_TASK_ALL_LOCATIONS_LEVEL);
}

// ── lib/checklists.ts @ e4932411: the two inline literal-8 shop binds ────────────────────────────────────────────────

/** requireCorrectionShop (line 1896): `if (<this>) return bindShopTask(instance);` — true = the actor is bound. */
export function requireCorrectionShopAdmits(actor: ChecklistWriteAuthority, instance: { location_id: string }): boolean {
  return actor.active && (actor.locations.includes(instance.location_id) || actor.level >= 8);
}

/** tagActualCompleter (line 2183): `if (<this>) throw new ChecklistRoleViolationError(...)` — true = REFUSED. */
export function tagActualCompleterRefuses(actor: ChecklistWriteAuthority, instance: { location_id: string }): boolean {
  return !actor.active || (!actor.locations.includes(instance.location_id) && actor.level < 8);
}
