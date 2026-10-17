import type { TranslationKey } from "@/lib/i18n/types";
import { OPERATIONAL_LEVEL6_ROLES, PM_CRITERIA_EDITOR_ROLES } from "@/lib/people/access-shared";
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
   * When true, the section is a live PlaceholderCard stub (no real surface yet).
   * The hub renders it HONESTLY — muted, no link, "arrives" copy — instead of a
   * normal card that dead-ends (council convergence 4; mirrors the
   * checklist-templates deep_cleaning idiom). The stub page stays reachable by
   * direct URL for anyone who bookmarks it.
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

// Order = display order, and it walks the derivation pipeline (Juan's model):
// vendors → SKUs (source of truth) → recipes → items → checklists/reports.
export const ADMIN_SECTIONS: AdminSection[] = [
  { id: "new-item", i18nKey: "catalog.jobs.new_item.title", href: "/admin/catalog/new/item", minLevel: 7, onlyRoles: ["gm", "moo", "owner", "cgs"] },
  { id: "new-sandwich", i18nKey: "catalog.jobs.sandwich.title", href: "/admin/catalog/new/sandwich", minLevel: 7, onlyRoles: ["gm", "moo", "owner", "cgs"] },
  { id: "stations", i18nKey: "assignments.stations", href: "/admin/stations", minLevel: 7 },
  // 0233: Toast employee -> CO-OPS user links (GM own shop, level 8+ every shop).
  { id: "toast-employees", i18nKey: "toastLinks.title", href: "/admin/toast-employees", minLevel: 7 },
  // Scheduling Phase 1 (0268–0269): the 7shifts connection, shop links (8+) and person links (GM own shop,
  // 8+ every shop). The card shows from GM up AND to the operational level-6 managers, who may view the
  // status (canViewSevenShiftsStatus); the social media manager never sees it (role-aware, not level).
  { id: "sevenshifts", i18nKey: "sevenshifts.title", href: "/admin/sevenshifts", minLevel: 7, alsoRoles: OPERATIONAL_LEVEL6_ROLES },
  // Scheduling Phase 1 (0271, Task 22): the PM v2 criteria editor — GM own shop, 8+ every shop; Tier E. Role-aware
  // (chunk F ruling (a)): the GM and MoO+ roles only; the page binds a GM to their own shops (canEditPmCriteria).
  { id: "pm-criteria", i18nKey: "pmCriteria.title", href: "/admin/pm-criteria", minLevel: 7, onlyRoles: PM_CRITERIA_EDITOR_ROLES },
  // Scheduling Phase 2 (chunk F): the schedule board — GM own shop, MoO+ any, and the AGM at their own shop (read; edit
  // when the shop grants it). Role-aware like canViewSchedule: never the social media, catering or prep managers.
  { id: "schedule", i18nKey: "schedule.page.title", href: "/schedule", minLevel: 7, alsoRoles: ["agm"] },
  // Scheduling Phase 2 (Task 25): the three-way reconciliation (CO-OPS ↔ Toast ↔ 7shifts) — GM own shop, MoO+ any;
  // never the AGM or a level-6 role (canViewReconciliation). Role-aware like the PM criteria card.
  { id: "people-reconcile", i18nKey: "schedule.reconcile.title", href: "/admin/people-reconcile", minLevel: 7, onlyRoles: PM_CRITERIA_EDITOR_ROLES },
  // 0234: customer profiles (stats GM+ own shop / 8+ every shop; contact + consent desk 9+).
  { id: "customers", i18nKey: "customers.title", href: "/admin/customers", minLevel: 7 },
  { id: "users",               i18nKey: "admin.section.users",               href: "/admin/users",               minLevel: 8 },
  { id: "vendors",             i18nKey: "admin.section.vendors",             href: "/admin/vendors",             minLevel: 6 },
  { id: "skus",                i18nKey: "admin.section.skus",                href: "/admin/skus",                minLevel: 6 },
  // A product sits ABOVE SKUs in the derivation order (vendors → SKUs →
  // products → recipes → items): it is the raw thing a recipe means, and the
  // member SKUs beneath it are the vendors' versions of it (migration 0179).
  { id: "products",            i18nKey: "admin.section.products",            href: "/admin/products",            minLevel: 6 },
  { id: "recipes",             i18nKey: "admin.section.recipes" as TranslationKey,             href: "/admin/recipes",             minLevel: 6 },
  { id: "items",               i18nKey: "admin.section.items" as TranslationKey,               href: "/admin/items",               minLevel: 6 },
  // The payoff of the derivation chain above: what the menu actually COSTS.
  // Sits here (not under catering) because it reads the whole regular menu, and
  // at 6 because it is a cost READ (lib/admin/cost.ts COST_READ_MIN).
  { id: "menu-costing",        i18nKey: "admin.section.menu-costing",                          href: "/admin/menu-costing",        minLevel: 6 },
  // Catalog Phase 3b: every shop's own recipes and menu settings, with Promote / Leave (the Director of Operations).
  { id: "shop-changes",        i18nKey: "admin.section.shop-changes",                          href: "/admin/catalog/shop-changes", minLevel: 8 },
  // Catalog Phase 3b: a GM's read-time notices — another shop changed a recipe this shop copied; a new default.
  { id: "recipe-notices",      i18nKey: "admin.section.recipe-notices",                        href: "/admin/catalog/notices",      minLevel: 7 },
  // BESIDE the costing board, by the spec's own placement — the weight audit is
  // what makes the costing board's numbers mean anything. It is an ON-DEMAND TOOL
  // (Juan, 2026-08-20: "triggered on demand, behaves just like the regular audit"),
  // so it deliberately carries NO AlertPill on the hub card: the hub's pills are
  // readiness signals, and a count here would turn a tool into a nag.
  { id: "weights",             i18nKey: "admin.section.weights",             href: "/admin/weights",             minLevel: 6 },
  { id: "catering",            i18nKey: "admin.section.catering" as TranslationKey,            href: "/admin/catering",            minLevel: 6 },
  { id: "checklist-templates", i18nKey: "admin.section.checklist-templates", href: "/admin/checklist-templates", minLevel: 7 },
  { id: "categories",          i18nKey: "admin.section.categories",          href: "/admin/categories",          minLevel: 8 },
  // TODO(i18n-type-safety, builder finding 12): the `as TranslationKey` casts on
  // recipes/items/catering above bypass compile-time key checking — an orphaned
  // es key (or a typo'd English key) won't fail the build. These keys DO exist in
  // en/es; the cast is legacy from before they were added. Prefer registering the
  // key in TranslationKey (lib/i18n/types) and dropping the cast so the compiler
  // enforces en/es parity. Same pattern flagged in RecipesClient.tsx rk().
  // 0220 — who gets the closing / all-shops / catering digests (and, later, the accountant
  // package). GM views (7); level 9+ manages (lib/report-recipients.ts).
  { id: "report-recipients",   i18nKey: "admin.section.report-recipients",   href: "/admin/report-recipients",   minLevel: 7 },
  { id: "pars",                i18nKey: "admin.section.pars",               href: "/admin/pars",                minLevel: 7, comingSoon: true },
  { id: "locations",           i18nKey: "admin.section.locations",           href: "/admin/locations",           minLevel: 9, comingSoon: true },
  { id: "audit",               i18nKey: "admin.section.audit",               href: "/admin/audit",               minLevel: 9, comingSoon: true },
];

/**
 * Sections the viewer may reach, in display order: by level, plus a card's `alsoRoles` by trusted role, and never
 * a card whose `onlyRoles` leaves the viewer's role out.
 */
export function adminSectionsFor(level: number, role: RoleCode): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => (level >= s.minLevel || (s.alsoRoles?.includes(role) ?? false))
    && (s.onlyRoles === undefined || s.onlyRoles.includes(role)));
}
