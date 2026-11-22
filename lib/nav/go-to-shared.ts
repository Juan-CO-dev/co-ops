/**
 * Go to: the model the sheet renders and the page search over it (nav PR 9, plan r2 3.2, 4.4; spec 4.2). Pure and
 * client-safe: no I/O, no clock, no import of the destination list.
 *
 * The model is built on the SERVER (lib/nav/go-to.ts) from `destinationsFor(viewer)`, by the session's real role and
 * level. The client receives only the entries this person may open, and search runs over exactly that list: there is
 * nothing a client can ask for that widens it. Every href is a bare route (no query: PR 12 owns the shop in links).
 */
import type { GroupId, RoomId } from "@/lib/nav/types";

export interface GoToEntry {
  /** The destination id (lib/nav/destinations.ts). */
  readonly id: string;
  /** The destination's bare route. */
  readonly href: string;
  readonly room: RoomId;
  /** The Back office group, for an entry listed under one (back-office room only). */
  readonly group?: GroupId;
  readonly kind: "place" | "job";
  /** The one name in the viewer's language. */
  readonly name: string;
  /** The same name in the other language (search finds either). */
  readonly otherName: string;
  /** One muted line, when the destination has one. */
  readonly description?: string;
  /** normalize(name, otherName, description, every alias in both languages): what search matches. Never rendered. */
  readonly haystack: string;
}

export interface GoToGroup {
  readonly id: GroupId;
  readonly name: string;
  readonly entries: readonly GoToEntry[];
}

export interface GoToRoom {
  readonly room: RoomId;
  readonly name: string;
  /** Entries listed under the room itself (every entry outside Back office; the Back office hub). */
  readonly entries: readonly GoToEntry[];
  /** Back office only: its headed groups, in GROUPS order; empty groups are dropped. */
  readonly groups: readonly GoToGroup[];
}

export interface GoToModel {
  /** In ROOMS order; a room with no entry is dropped. */
  readonly rooms: readonly GoToRoom[];
  /** The viewer's list holds `profile`, so the people search is offered (false only for a closed menu without it: the
   *  social media manager). The server route enforces the same rule before any read. */
  readonly people: boolean;
}

/** NFD, combining marks stripped, lower-case, whitespace collapsed: "Auditoría" and "auditoria" are one word. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Every entry of the model, in display order (rooms in order; a room's own entries, then its groups'). */
export function allEntries(model: GoToModel): GoToEntry[] {
  const out: GoToEntry[] = [];
  for (const r of model.rooms) {
    out.push(...r.entries);
    for (const g of r.groups) out.push(...g.entries);
  }
  return out;
}

/**
 * The page search. Every term of the query must occur in the entry's haystack (case- and accent-insensitive). Order:
 * the viewer-language name starts with the query, then the name contains it, then the rest; ties keep display order
 * (which is the destination list's order). An empty query has no results.
 */
export function searchEntries(model: GoToModel, query: string): GoToEntry[] {
  const q = normalize(query);
  if (!q) return [];
  const terms = q.split(" ");
  const ranked: Array<{ e: GoToEntry; rank: number; i: number }> = [];
  allEntries(model).forEach((e, i) => {
    if (!terms.every((t) => e.haystack.includes(t))) return;
    const n = normalize(e.name);
    const rank = n.startsWith(q) ? 0 : n.includes(q) ? 1 : 2;
    ranked.push({ e, rank, i });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.i - b.i).map((r) => r.e);
}
