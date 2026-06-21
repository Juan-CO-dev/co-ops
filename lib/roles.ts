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
  | "prep_mgr"
  | "social_media_mgr"
  | "shift_lead"
  | "key_holder"
  | "trainer"
  | "employee"
  | "trainee"
  | "hired_not_yet_worked"
  | "prospect";

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
  /**
   * Legacy coarse flag. NOT read anywhere as of C.44 Module 1 (the admin
   * gates are the per-permission-key levels in lib/permissions.ts). Post-C.41
   * integer scale: admin.users 8, admin.locations 9, checklist.template.write
   * 7, par_levels.write 7, vendor.* 6–7. Outer /admin reachability gate is
   * level >= 6 (app/admin/layout.tsx). Values left as-is for documentation.
   */
  canAdmin: boolean;
}

export const ROLES: Record<RoleCode, RoleDefinition> = {
  cgs:                  { code: "cgs",                  label: "Chief Growth Strategist", shortLabel: "CGS", level: 10, color: "#D4A843", hasEmailAuth: true,  canAdmin: true  },
  owner:                { code: "owner",                label: "Owner",                   shortLabel: "OWN", level: 9,  color: "#6B7280", hasEmailAuth: true,  canAdmin: true  },
  moo:                  { code: "moo",                  label: "Manager of Operations",   shortLabel: "MOO", level: 8,  color: "#1F4E79", hasEmailAuth: true,  canAdmin: true  },
  gm:                   { code: "gm",                   label: "General Manager",         shortLabel: "GM",  level: 7,  color: "#2E75B6", hasEmailAuth: true,  canAdmin: false },
  agm:                  { code: "agm",                  label: "Asst. General Manager",   shortLabel: "AGM", level: 6,  color: "#2D7D46", hasEmailAuth: true,  canAdmin: false },
  catering_mgr:         { code: "catering_mgr",         label: "Catering Manager",        shortLabel: "CTR", level: 6,  color: "#E67E22", hasEmailAuth: true,  canAdmin: false },
  prep_mgr:             { code: "prep_mgr",             label: "Prep Manager",            shortLabel: "PREP",level: 6,  color: "#0D9488", hasEmailAuth: true,  canAdmin: false },
  social_media_mgr:     { code: "social_media_mgr",     label: "Social Media Manager",    shortLabel: "SMM", level: 6,  color: "#A855F7", hasEmailAuth: true,  canAdmin: false },
  shift_lead:           { code: "shift_lead",           label: "Shift Lead",              shortLabel: "SL",  level: 5,  color: "#8B5CF6", hasEmailAuth: false, canAdmin: false },
  key_holder:           { code: "key_holder",           label: "Key Holder",              shortLabel: "KH",  level: 4,  color: "#F59E0B", hasEmailAuth: false, canAdmin: false },
  trainer:              { code: "trainer",              label: "Trainer",                 shortLabel: "TR",  level: 4,  color: "#EC4899", hasEmailAuth: false, canAdmin: false },
  // Color picks for employee/trainee/onboarding tiers are tactical neutrals; revisit alongside brand-book role-color system formalization in Module #2 work.
  employee:             { code: "employee",             label: "Employee",                shortLabel: "EMP", level: 3,  color: "#0EA5E9", hasEmailAuth: false, canAdmin: false },
  trainee:              { code: "trainee",              label: "Trainee",                 shortLabel: "TRN", level: 2,  color: "#94A3B8", hasEmailAuth: false, canAdmin: false },
  hired_not_yet_worked: { code: "hired_not_yet_worked", label: "Hired (Not Yet Worked)",  shortLabel: "NEW", level: 1,  color: "#CBD5E1", hasEmailAuth: false, canAdmin: false },
  prospect:             { code: "prospect",             label: "Prospect",                shortLabel: "PROS",level: 0,  color: "#E2E8F0", hasEmailAuth: false, canAdmin: false },
};

export function isRoleCode(v: string): v is RoleCode {
  return v in ROLES;
}

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
