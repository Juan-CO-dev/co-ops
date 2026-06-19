import type { TranslationKey } from "@/lib/i18n/types";
import { navDestinationsFor } from "@/lib/nav-links";
import type { ProfileDirectoryResult } from "@/lib/profiles";
import type { RoleCode } from "@/lib/roles";

export interface PersonResult {
  userId: string;
  name: string;
  role: RoleCode;
}
export interface PageResult {
  label: string;
  href: string;
  scoped: boolean;
}

export const PEOPLE_CAP = 10;

/**
 * Filter an ALREADY-AUTHORIZED profile directory by name / role-label substring.
 * Pure: the caller loads the directory (which enforces visibility) and passes a
 * role-label translator. The matcher never widens the authorized set.
 */
export function matchPeople(
  directory: ProfileDirectoryResult,
  query: string,
  translateRole: (role: RoleCode) => string,
): { people: PersonResult[]; hasMore: boolean } {
  const q = query.trim().toLowerCase();
  if (!q) return { people: [], hasMore: false };
  const all: Array<{ userId: string; name: string; role: RoleCode }> = [
    ...directory.leadership,
    ...directory.staff,
  ];
  const seen = new Set<string>();
  const matched: PersonResult[] = [];
  for (const p of all) {
    if (seen.has(p.userId)) continue;
    if (p.name.toLowerCase().includes(q) || translateRole(p.role).toLowerCase().includes(q)) {
      seen.add(p.userId);
      matched.push({ userId: p.userId, name: p.name, role: p.role });
    }
  }
  return { people: matched.slice(0, PEOPLE_CAP), hasMore: matched.length > PEOPLE_CAP };
}

/**
 * Filter the LEVEL-GATED nav destinations by localized-label substring.
 * Pure: navDestinationsFor(level) already excludes destinations above the
 * viewer's level, so a match can never surface an inaccessible page.
 */
export function matchPages(
  level: number,
  query: string,
  translateLabel: (key: TranslationKey) => string,
): PageResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: PageResult[] = [];
  for (const d of navDestinationsFor(level)) {
    const label = translateLabel(d.key);
    if (label.toLowerCase().includes(q)) out.push({ label, href: d.href, scoped: d.scoped });
  }
  return out;
}
