/**
 * Nav PR 9: the Go to model (plan r2 3.2, 4.4, 4.5; lead rulings r1 Q2, Q4 and the testing gate).
 *
 * N1: the model's shape (rooms in ROOMS order, Back office grouped by GROUPS, names in both languages, bare hrefs, the
 * people flag). Q2: for every role and all 64 switch combinations the model lists EXACTLY `destinationsFor(viewer)`, and
 * for every destination the viewer cannot see, searching its names and aliases returns results whose ids never include
 * it (other, allowed pages may match the same words: the assertion is on the forbidden ID, never on zero results).
 * Q4: the social media manager's model is exactly its four entries, with no people search.
 */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { DESTINATIONS, GROUPS, ROOMS } from "@/lib/nav/destinations";
import { goToEntries, peopleSearchAllowed, ROOM_NAME_KEYS } from "@/lib/nav/go-to";
import { allEntries, searchEntries } from "@/lib/nav/go-to-shared";
import { canSee, destinationsFor } from "@/lib/nav/resolve";
import type { SwitchName, Switches } from "@/lib/nav/types";
import { ROLES, type RoleCode } from "@/lib/roles";

const DICT = { en: en as Record<string, string>, es: es as Record<string, string> };
const SWITCHES: readonly SwitchName[] = ["pulseV2", "vault", "businessReport", "demandSignals", "marketingScorecard", "customerProfiles"];
const COMBOS: Switches[] = Array.from({ length: 1 << SWITCHES.length }, (_, m) =>
  Object.fromEntries(SWITCHES.map((s, i) => [s, (m & (1 << i)) !== 0])) as Switches);
const ROLE_CODES = Object.keys(ROLES) as RoleCode[];
const ALL_ON: Switches = Object.fromEntries(SWITCHES.map((s) => [s, true]));
const ids = (role: RoleCode, switches: Switches, language: "en" | "es" = "en") =>
  allEntries(goToEntries({ role, level: ROLES[role].level, language }, switches)).map((e) => e.id);

describe("N1: the model", () => {
  const model = goToEntries({ role: "cgs", level: 10, language: "en" }, ALL_ON);
  it("rooms in ROOMS order, each named by its key", () => {
    expect(model.rooms.map((r) => r.room)).toEqual(ROOMS.filter((r) => model.rooms.some((m) => m.room === r)));
    expect(model.rooms.map((r) => r.room)).toEqual([...ROOMS]);
    for (const r of model.rooms) expect(r.name).toBe(DICT.en[ROOM_NAME_KEYS[r.room]]);
  });
  it("Back office is grouped by GROUPS (the hub ungrouped, first); other rooms have no groups", () => {
    const bo = model.rooms.find((r) => r.room === "back-office")!;
    expect(bo.entries.map((e) => e.id)).toEqual(["admin"]);
    expect(bo.groups.map((g) => g.id)).toEqual(GROUPS.filter((g) => bo.groups.some((x) => x.id === g)));
    for (const g of bo.groups) {
      expect(g.entries.length).toBeGreaterThan(0);
      for (const e of g.entries) expect(e.group).toBe(g.id);
    }
    for (const r of model.rooms.filter((x) => x.room !== "back-office")) {
      expect(r.groups).toEqual([]);
      for (const e of r.entries) expect(e.group).toBeUndefined(); // Vendor mail is a Today entry here, not a group row
    }
  });
  it("the display order is the destination list's order", () => {
    for (const role of ROLE_CODES) {
      expect(ids(role, ALL_ON), role).toEqual(destinationsFor({ role, level: ROLES[role].level, switches: ALL_ON }).map((d) => d.id));
    }
  });
  it("names in the viewer's language and the other one; descriptions in the viewer's; every href bare", () => {
    const esModel = goToEntries({ role: "cgs", level: 10, language: "es" }, ALL_ON);
    for (const [m, lang, other] of [[model, "en", "es"], [esModel, "es", "en"]] as const) {
      for (const e of allEntries(m)) {
        const d = DESTINATIONS.find((x) => x.id === e.id)!;
        expect(e.name).toBe(DICT[lang][d.nameKey]);
        expect(e.otherName).toBe(DICT[other][d.nameKey]);
        if (d.descriptionKey) expect(e.description).toBe(DICT[lang][d.descriptionKey]);
        else expect(e.description).toBeUndefined();
        expect(e.href).toBe(d.route);
        expect(e.href).not.toContain("?");
        expect(e.kind).toBe(d.kind);
      }
    }
  });
  it("the people flag is exactly 'the list holds profile'", () => {
    for (const role of ROLE_CODES) for (const s of [{}, ALL_ON]) {
      const m = goToEntries({ role, level: ROLES[role].level, language: "en" }, s);
      expect(m.people, role).toBe(allEntries(m).some((e) => e.id === "profile"));
      expect(peopleSearchAllowed({ role, level: ROLES[role].level }, s), role).toBe(m.people);
    }
  });
});

describe("Q2: every role, every switch combination: exactly destinationsFor, nothing forbidden findable", () => {
  it.each(ROLE_CODES)("%s", (role) => {
    const level = ROLES[role].level;
    for (const switches of COMBOS) {
      const viewer = { role, level, switches };
      const allowed = destinationsFor(viewer);
      const model = goToEntries({ role, level, language: "en" }, switches);
      const got = allEntries(model);
      expect(got.map((e) => e.id)).toEqual(allowed.map((d) => d.id));
      for (const e of got) expect(canSee(DESTINATIONS.find((d) => d.id === e.id)!, viewer), e.id).toBe(true);
      const allowedIds = new Set(allowed.map((d) => d.id));
      for (const d of DESTINATIONS) {
        if (allowedIds.has(d.id)) continue;
        const words = [DICT.en[d.nameKey]!, DICT.es[d.nameKey]!, ...(d.aliases?.en ?? []), ...(d.aliases?.es ?? [])];
        for (const w of words) {
          const found = searchEntries(model, w).map((e) => e.id);
          expect(found, `${role} ${JSON.stringify(switches)} "${w}" must not find ${d.id}`).not.toContain(d.id);
        }
      }
    }
  });
  it("a key holder searching 'User Management': the users page is absent", () => {
    const model = goToEntries({ role: "key_holder", level: 4, language: "en" }, ALL_ON);
    expect(searchEntries(model, "User Management").map((e) => e.id)).not.toContain("users");
    expect(searchEntries(model, "user management").map((e) => e.id)).not.toContain("users");
  });
  it("planned pages never appear (the Audit log), whatever the role", () => {
    for (const role of ROLE_CODES) expect(ids(role, ALL_ON), role).not.toContain("audit");
  });
});

describe("Q4: the social media manager", () => {
  it("exactly its four entries, Today then Me, under every switch combination; no numbers entry; no people", () => {
    for (const switches of COMBOS) {
      const model = goToEntries({ role: "social_media_mgr", level: 6, language: "en" }, switches);
      expect(allEntries(model).map((e) => e.id)).toEqual(["dashboard", "me", "my-feedback", "training"]);
      expect(model.rooms.map((r) => r.room)).toEqual(["today", "me"]);
      expect(model.people).toBe(false);
      for (const e of allEntries(model)) expect(DESTINATIONS.find((d) => d.id === e.id)!.numbers, e.id).toBe(false);
    }
  });
  it("for every other destination, its names and aliases return results without its id (en and es)", () => {
    for (const lang of ["en", "es"] as const) {
      const model = goToEntries({ role: "social_media_mgr", level: 6, language: lang }, ALL_ON);
      for (const d of DESTINATIONS) {
        if (["dashboard", "me", "my-feedback", "training"].includes(d.id)) continue;
        for (const w of [DICT.en[d.nameKey]!, DICT.es[d.nameKey]!, ...(d.aliases?.en ?? []), ...(d.aliases?.es ?? [])]) {
          expect(searchEntries(model, w).map((e) => e.id), `${lang} "${w}"`).not.toContain(d.id);
        }
      }
    }
  });
  it("an AGM (the same level) is not narrowed: the closed menu is by role", () => {
    expect(ids("agm", ALL_ON).length).toBeGreaterThan(4);
    expect(peopleSearchAllowed({ role: "agm", level: 6 }, ALL_ON)).toBe(true);
  });
});
