import type { TranslationKey } from "@/lib/i18n/types";
import { adminCards } from "@/lib/nav/legacy";
import type { RoleCode } from "@/lib/roles";

/**
 * Admin section registry — single source of truth for the /admin hub.
 *
 * minLevel derives from the canonical permission key in lib/permissions.ts
 * where one models the section (admin.users 8, checklist.template.write 7,
 * vendor.items.write 6, par_levels.write 7, admin.locations 9). `audit` has
 * no permission key — it is read-only forensic, Owner+ (explicit 9).
 *
 * The outer /admin reachability gate (level >= 6, enforced in
 * app/admin/layout.tsx) is separate; this registry decides which cards a
 * reachable viewer sees. Order here is display order.
 */
export interface AdminSection {
  id: string;
  i18nKey: TranslationKey;
  href: string;
  minLevel: number;
  /**
   * When true, the section is planned and not built (its route holds a one-sentence
   * planned page). The hub renders it HONESTLY — muted, no link, "Planned" — instead of a
   * normal card that dead-ends (council convergence 4; mirrors the
   * checklist-templates deep_cleaning idiom). The planned page stays reachable by
   * direct URL, behind its own gate.
   */
  comingSoon?: boolean;
  /**
   * Roles BELOW minLevel that also see the card, by trusted role (never by level alone). Used where
   * level 6 is not one thing: the operational level-6 managers may open the 7shifts status, the
   * social media manager (also level 6) may not (chunk C review, Astra P3).
   */
  alsoRoles?: readonly RoleCode[];
  /**
   * When set, ONLY these trusted roles see the card (checked on top of the level rule). Used where a level
   * alone must not open a card: the PM criteria editor is GM own shop / MoO+, never the social media manager,
   * whatever level a session claims (CC's chunk F ruling (a), 2026-10-16).
   */
  onlyRoles?: readonly RoleCode[];
}

/**
 * The cards, in display order. Derived from the one destination list (lib/nav/destinations.ts: each card's id, name,
 * route, floor and trusted-role rule, with the reason for each beside its row; lib/nav/legacy.ts: the order, which
 * walks the derivation pipeline: vendors → SKUs → recipes → items → checklists / reports).
 */
export const ADMIN_SECTIONS: AdminSection[] = adminCards();

/**
 * Sections the viewer may reach, in display order: by level, plus a card's `alsoRoles` by trusted role, and never
 * a card whose `onlyRoles` leaves the viewer's role out.
 */
export function adminSectionsFor(level: number, role: RoleCode): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => (level >= s.minLevel || (s.alsoRoles?.includes(role) ?? false))
    && (s.onlyRoles === undefined || s.onlyRoles.includes(role)));
}
