import type { TranslationKey } from "@/lib/i18n/types";

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
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { id: "users",               i18nKey: "admin.section.users",               href: "/admin/users",               minLevel: 8 },
  { id: "checklist-templates", i18nKey: "admin.section.checklist-templates", href: "/admin/checklist-templates", minLevel: 7 },
  { id: "vendors",             i18nKey: "admin.section.vendors",             href: "/admin/vendors",             minLevel: 6 },
  { id: "skus",                i18nKey: "admin.section.skus",                href: "/admin/skus",                minLevel: 6 },
  { id: "categories",          i18nKey: "admin.section.categories",          href: "/admin/categories",          minLevel: 8 },
  { id: "pars",                i18nKey: "admin.section.pars",                href: "/admin/pars",                minLevel: 7 },
  { id: "locations",           i18nKey: "admin.section.locations",           href: "/admin/locations",           minLevel: 9 },
  { id: "audit",               i18nKey: "admin.section.audit",               href: "/admin/audit",               minLevel: 9 },
];

/** Sections the given role level may reach, in display order. */
export function adminSectionsFor(level: number): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => level >= s.minLevel);
}
