/**
 * The Go to model, built on the server (nav PR 9, plan r2 3.2, 4.4; spec 4.2). Server-only.
 *
 * `goToEntries` lists exactly `destinationsFor(viewer)` (lib/nav/resolve.ts), computed from the session's REAL role and
 * level and the request's switches (never "works as"; the client never sends a role, a level or a switch). It passes
 * NO facts: absent facts mean "no", so a page opened only by a fact (a crew member's task assigned today, a GM's offered
 * Business report) is not listed. That is a recorded under-listing (lead ruling Q4), not a claim of completeness; the
 * Dashboard day list and Shortcuts still reach both. It reads nothing: the destination list is pure and the switches
 * come from the caller.
 */
import "server-only";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { GROUP_LABELS } from "@/lib/nav/back-office";
import { GROUPS, ROOMS } from "@/lib/nav/destinations";
import { normalize, type GoToEntry, type GoToModel, type GoToRoom } from "@/lib/nav/go-to-shared";
import { destinationsFor } from "@/lib/nav/resolve";
import type { Destination, RoomId, Switches } from "@/lib/nav/types";
import type { RoleCode } from "@/lib/roles";

/** Spec section 1's room names. */
export const ROOM_NAME_KEYS: Readonly<Record<RoomId, TranslationKey>> = {
  today: "nav.room.today",
  catering: "nav.room.catering",
  reports: "nav.room.reports",
  "back-office": "nav.room.back_office",
  me: "nav.room.me",
};

/** What Go to reads about the person: the session's real role and level, and the language to name things in. */
export interface GoToViewer {
  readonly role: RoleCode;
  readonly level: number;
  readonly language: Language;
}

function entryOf(d: Destination, language: Language): GoToEntry {
  const other: Language = language === "en" ? "es" : "en";
  const name = serverT(language, d.nameKey);
  const otherName = serverT(other, d.nameKey);
  const description = d.descriptionKey ? serverT(language, d.descriptionKey) : undefined;
  const haystack = normalize([name, otherName, description ?? "", ...(d.aliases?.en ?? []), ...(d.aliases?.es ?? [])].join(" "));
  return {
    id: d.id, href: d.route, room: d.room, kind: d.kind, name, otherName, haystack,
    ...(d.room === "back-office" && d.group ? { group: d.group } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

/** The people search is offered exactly when the viewer's list holds `profile` (today false only for the SMM). */
export function peopleSearchAllowed(viewer: { readonly role: RoleCode; readonly level: number }, switches: Switches): boolean {
  return destinationsFor({ role: viewer.role, level: viewer.level, switches }).some((d) => d.id === "profile");
}

export function goToEntries(viewer: GoToViewer, switches: Switches): GoToModel {
  const list = destinationsFor({ role: viewer.role, level: viewer.level, switches });
  const rooms: GoToRoom[] = [];
  for (const room of ROOMS) {
    const inRoom = list.filter((d) => d.room === room).map((d) => entryOf(d, viewer.language));
    if (inRoom.length === 0) continue;
    const entries = inRoom.filter((e) => e.group === undefined);
    const groups = room === "back-office"
      ? GROUPS.map((g) => ({ id: g, name: serverT(viewer.language, GROUP_LABELS[g].nameKey), entries: inRoom.filter((e) => e.group === g) }))
        .filter((g) => g.entries.length > 0)
      : [];
    rooms.push({ room, name: serverT(viewer.language, ROOM_NAME_KEYS[room]), entries, groups });
  }
  return { rooms, people: list.some((d) => d.id === "profile") };
}
