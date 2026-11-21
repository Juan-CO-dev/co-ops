/**
 * The legacy adapters (nav spec r5, PR 3; plan r5, 2.4): today's registries rebuilt from the one destination list,
 * byte for byte. Each surface keeps its own filter (navDestinationsFor, adminSectionsFor, the catering hub's level
 * filter); nothing here calls the resolver or passes facts. tests/nav-legacy-snapshot.test.ts proves the output is
 * unchanged from the PR's base. Each part is deleted by the PR that retires its surface.
 *
 * Type-only imports of the legacy shapes: lib/nav never imports lib/nav-links.ts or lib/admin/sections.ts at runtime.
 */
import { byId } from "@/lib/nav/destinations";
import type { AdminSection } from "@/lib/admin/sections";
import type { NavLink } from "@/lib/nav-links";
import type { Destination } from "@/lib/nav/types";

/** The Dashboard "Explore" chips, in today's display order (mid-shift, vault and admin are added by navDestinationsFor). */
export const CHIP_ORDER: readonly string[] = [
  "reports", "assignments", "trends", "lto", "written-reports", "catering-workspace", "maintenance", "production",
  "training", "recipes", "profile", "me", "my-feedback",
];

/** A chip, in today's property order { key, href, scoped, minLevel }; minLevel omitted (not undefined) at floor 0. */
export function navLinkOf(d: Destination): NavLink {
  const scoped = d.legacy?.chipScoped;
  if (scoped === undefined) throw new Error(`${d.id} is not a chip (no legacy.chipScoped)`);
  const link: NavLink = { key: d.labels?.chip ?? d.nameKey, href: d.route, scoped };
  if (d.access.minLevel !== 0) link.minLevel = d.access.minLevel;
  return link;
}

/** NAV_LINKS, derived. */
export function chipLinks(): NavLink[] {
  return CHIP_ORDER.map((id) => navLinkOf(byId(id)));
}

/** The Back office cards, in today's display order (it walks the derivation pipeline: vendors → SKUs → recipes → items
 *  → checklists / reports). */
export const CARD_ORDER: readonly string[] = [
  "vendor-mail", "new-item", "new-sandwich", "stations", "toast-employees", "sevenshifts", "pm-criteria", "schedule",
  "people-reconcile", "customers", "users", "vendors", "skus", "products", "recipes", "items", "sandwiches", "shop-changes",
  "recipe-notices", "weights", "catering", "checklist-templates", "categories", "report-recipients", "pars", "locations", "audit",
];

/** A Back office card, in today's property order: { id, i18nKey, href, minLevel } then the one of alsoRoles, onlyRoles
 *  or comingSoon the card carries (no card carries two, so the order matches today's literals). */
export function adminSectionOf(d: Destination): AdminSection {
  const { alsoRoles, onlyRoles } = d.access;
  if ([alsoRoles, onlyRoles, d.planned].filter((x) => x !== undefined).length > 1) throw new Error(`${d.id}: a card carries at most one of alsoRoles, onlyRoles, planned`);
  const card: AdminSection = { id: d.id, i18nKey: d.labels?.card ?? d.nameKey, href: d.route, minLevel: d.access.minLevel };
  if (alsoRoles !== undefined) card.alsoRoles = alsoRoles;
  if (onlyRoles !== undefined) card.onlyRoles = onlyRoles;
  if (d.planned) card.comingSoon = true;
  return card;
}

/** ADMIN_SECTIONS, derived. */
export function adminCards(): AdminSection[] {
  return CARD_ORDER.map((id) => adminSectionOf(byId(id)));
}
