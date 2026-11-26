/**
 * Go to's people search (nav PR 9, plan r2 3.2, 4.4; lead ruling r1 F4). Server-only.
 *
 * ONE rule, then its OWN narrow reads, then `matchPeople`:
 *   - the rule: the viewer's Go to list holds `profile` (`peopleSearchAllowed`, derived from the one destination list,
 *     never a second role list; today false only for the social media manager). Refused → `PeopleSearchRefused`, thrown
 *     BEFORE any read.
 *   - the scope is `/profile`'s: `accessibleLocations({ role, locations })` (lib/locations.ts). Active members of the
 *     viewer's shops below level 8 (every active user at level 9+) plus company-wide active leadership (level 8+).
 *     Nothing widens it (the access plan's PR 3 is not built).
 *   - the reads THROW on any error (a 503 at the route, never an empty list) and every users read is paged
 *     (`selectAllRows`) and, for a membership scope, chunked by 100 ids. No `pm_reports` read, no contact column.
 *     lib/profiles.ts (which drops several read errors) is deliberately NOT reused and NOT changed.
 *
 * Reads per search (pinned by tests/nav-people-route.test.ts and tests/people-search-reads.test.ts), one page each:
 * a membership scope = 3 (the membership page, one users chunk per 100 members, the leadership read); all = 1; no
 * memberships = 1 (leadership only). The session check before it costs its own 4.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { accessibleLocations } from "@/lib/locations";
import { peopleSearchAllowed } from "@/lib/nav/go-to";
import type { Switches } from "@/lib/nav/types";
import { ROLES, type RoleCode } from "@/lib/roles";
import { selectAllRows } from "@/lib/supabase-paginate";
import { matchPeople, type PersonResult } from "@/lib/unified-search";

/** The viewer's Go to list holds no `profile`: no people search, and no read. */
export class PeopleSearchRefused extends Error {
  constructor() {
    super("people_search_refused");
    this.name = "PeopleSearchRefused";
  }
}

/** Member ids per users read (the request line: 100 uuids is ~3.7 KB). */
export const PEOPLE_ID_CHUNK = 100;
/** The query length the route accepts, trimmed. */
export const PEOPLE_QUERY_MIN = 2;
export const PEOPLE_QUERY_MAX = 64;

const LEADERSHIP_LEVEL = 8;
export const LEADERSHIP_ROLES: readonly RoleCode[] = (Object.keys(ROLES) as RoleCode[]).filter((r) => ROLES[r].level >= LEADERSHIP_LEVEL);

type Person = { userId: string; name: string; role: RoleCode };
type UserRow = { id: string; name: string; role: RoleCode };

export interface PeopleSearchViewer {
  readonly role: RoleCode;
  readonly level: number;
  readonly locations: readonly string[];
  readonly language: Language;
}

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
const toPerson = (u: UserRow): Person => ({ userId: u.id, name: u.name, role: u.role });
const levelOf = (role: RoleCode) => ROLES[role]?.level ?? 0;

async function leadershipRead(sb: SupabaseClient): Promise<Person[]> {
  const rows = await selectAllRows<UserRow>((from, to) => sb.from("users").select("id, name, role")
    .eq("active", true).in("role", [...LEADERSHIP_ROLES]).order("id", { ascending: true }).range(from, to));
  return rows.map(toPerson).sort(byName);
}

/** The directory the search runs over: `{ staff, leadership }`, every read error thrown. */
export async function loadPeopleDirectory(sb: SupabaseClient, viewer: Pick<PeopleSearchViewer, "role" | "locations">): Promise<{ staff: Person[]; leadership: Person[] }> {
  const scope = accessibleLocations({ role: viewer.role, locations: [...viewer.locations] });
  if (scope === "all") {
    const rows = await selectAllRows<UserRow>((from, to) => sb.from("users").select("id, name, role")
      .eq("active", true).order("id", { ascending: true }).range(from, to));
    const people = rows.map(toPerson);
    return {
      staff: people.filter((p) => levelOf(p.role) < LEADERSHIP_LEVEL).sort(byName),
      leadership: people.filter((p) => levelOf(p.role) >= LEADERSHIP_LEVEL).sort(byName),
    };
  }
  if (scope.length === 0) return { staff: [], leadership: await leadershipRead(sb) };
  const memberships = await selectAllRows<{ user_id: string }>((from, to) => sb.from("user_locations").select("user_id")
    .in("location_id", scope).eq("active", true).order("user_id", { ascending: true }).range(from, to));
  const ids = [...new Set(memberships.map((r) => r.user_id))];
  const staff: Person[] = [];
  for (let i = 0; i < ids.length; i += PEOPLE_ID_CHUNK) {
    const chunk = ids.slice(i, i + PEOPLE_ID_CHUNK);
    const rows = await selectAllRows<UserRow>((from, to) => sb.from("users").select("id, name, role")
      .in("id", chunk).eq("active", true).order("id", { ascending: true }).range(from, to));
    for (const u of rows) if (levelOf(u.role) < LEADERSHIP_LEVEL) staff.push(toPerson(u));
  }
  return { staff: staff.sort(byName), leadership: await leadershipRead(sb) };
}

/**
 * The rule first (no read when refused), then the reads, then `matchPeople` (at most PEOPLE_CAP people plus `hasMore`).
 * Each person is exactly `{ userId, name, role }`.
 */
export async function searchPeopleFor(
  sb: SupabaseClient,
  viewer: PeopleSearchViewer,
  switches: Switches,
  q: string,
): Promise<{ people: PersonResult[]; hasMore: boolean }> {
  if (!peopleSearchAllowed(viewer, switches)) throw new PeopleSearchRefused();
  const directory = await loadPeopleDirectory(sb, viewer);
  const r = matchPeople(directory, q, (role) => serverT(viewer.language, `role.${role}` as TranslationKey));
  return { people: r.people.map((p) => ({ userId: p.userId, name: p.name, role: p.role })), hasMore: r.hasMore };
}
