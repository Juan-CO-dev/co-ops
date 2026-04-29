/**
 * Role registry — Foundation Spec v1.2 Section 7.1.
 *
 * Locked at foundation. Adding a role requires a coordinated change to the
 * `users.role` CHECK constraint, every RLS policy that references role names,
 * and `current_user_role_level()` in the database.
 */

export type RoleCode =
  | "cgs"
  | "owner"
  | "moo"
  | "gm"
  | "agm"
  | "catering_mgr"
  | "shift_lead"
  | "key_holder"
  | "trainer";

export interface RoleDefinition {
  code: RoleCode;
  label: string;
  shortLabel: string;
  /** MoO sits at 6.5 — decimal levels are intentional. */
  level: number;
  /** CSS color (CO design tokens, Section 14). */
  color: string;
  /** Level 5+ uses email+password as a secondary auth path. */
  hasEmailAuth: boolean;
  /** Whether this role can land in `/admin/*`. Note: `admin.users` is 6.5+, `admin.locations` is 7+ — see permissions.ts for fine-grained gates. */
  canAdmin: boolean;
}

export const ROLES: Record<RoleCode, RoleDefinition> = {
  cgs:          { code: "cgs",          label: "Chief Growth Strategist", shortLabel: "CGS", level: 8,   color: "#D4A843", hasEmailAuth: true,  canAdmin: true  },
  owner:        { code: "owner",        label: "Owner",                   shortLabel: "OWN", level: 7,   color: "#6B7280", hasEmailAuth: true,  canAdmin: true  },
  moo:          { code: "moo",          label: "Manager of Operations",   shortLabel: "MOO", level: 6.5, color: "#1F4E79", hasEmailAuth: true,  canAdmin: true  },
  gm:           { code: "gm",           label: "General Manager",         shortLabel: "GM",  level: 6,   color: "#2E75B6", hasEmailAuth: true,  canAdmin: false },
  agm:          { code: "agm",          label: "Asst. General Manager",   shortLabel: "AGM", level: 5,   color: "#2D7D46", hasEmailAuth: true,  canAdmin: false },
  catering_mgr: { code: "catering_mgr", label: "Catering Manager",        shortLabel: "CTR", level: 5,   color: "#E67E22", hasEmailAuth: true,  canAdmin: false },
  shift_lead:   { code: "shift_lead",   label: "Shift Lead",              shortLabel: "SL",  level: 4,   color: "#8B5CF6", hasEmailAuth: false, canAdmin: false },
  key_holder:   { code: "key_holder",   label: "Key Holder",              shortLabel: "KH",  level: 3,   color: "#F59E0B", hasEmailAuth: false, canAdmin: false },
  trainer:      { code: "trainer",      label: "Trainer",                 shortLabel: "TR",  level: 3,   color: "#EC4899", hasEmailAuth: false, canAdmin: false },
};

export function getRoleLevel(code: RoleCode): number {
  return ROLES[code].level;
}

export function isRoleAtOrAbove(actor: RoleCode, threshold: number): boolean {
  return getRoleLevel(actor) >= threshold;
}

/** Strict inequality — admins cannot act on peers or seniors. */
export function canActOn(actor: RoleCode, target: RoleCode): boolean {
  return getRoleLevel(actor) > getRoleLevel(target);
}

/** PIN length: 4 digits for all roles (Phase 2 Session 1 — matches Toast/7shifts punch-in convention). */
export function minPinLength(_role: RoleCode): 4 {
  return 4;
}
