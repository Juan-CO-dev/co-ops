/**
 * Nav PR 3, guards (b), (c) and (e) (plan r5, 4.2, 4.3, 4.5).
 *  (b) one route, one name key: ids, routes and name keys unique; every label key a surface uses reads the SAME name
 *      as the destination's name, in en and es; no two destinations share a name.
 *  (c) no destination in two rooms: rooms, groups and tab families are closed and consistent.
 *  (e) every key exists in both languages, non-empty; a name carries no {param}; aliases never steal a live name.
 */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { DESTINATIONS, GROUPS, ROOMS, TAB_FAMILIES, byId, byRoute } from "@/lib/nav/destinations";
import type { TabFamilyId } from "@/lib/nav/types";
import { NAMED_PAGES } from "./helpers/nav-pages";

const DICT = { en: en as Record<string, string>, es: es as Record<string, string> };
const LANGS = ["en", "es"] as const;

const labelKeys = (d: (typeof DESTINATIONS)[number]) => Object.values(d.labels ?? {}).filter((k): k is NonNullable<typeof k> => !!k);

describe("guard (b): one route, one name key", () => {
  it("ids, routes and name keys are unique", () => {
    for (const field of ["id", "route", "nameKey"] as const) {
      const values = DESTINATIONS.map((d) => d[field]);
      expect(values.filter((v, i) => values.indexOf(v) !== i), field).toEqual([]);
    }
  });

  it("byId and byRoute find every destination; an unknown id throws", () => {
    for (const d of DESTINATIONS) {
      expect(byId(d.id)).toBe(d);
      expect(byRoute(d.route)).toBe(d);
    }
    expect(() => byId("no-such-page")).toThrow();
    expect(byRoute("/no-such-page")).toBeUndefined();
  });

  it.each(DESTINATIONS.filter((d) => labelKeys(d).length > 0).map((d) => [d.id, d] as const))(
    "%s: every surface label reads exactly its one name, in en and es", (_id, d) => {
      for (const lang of LANGS) for (const key of labelKeys(d)) expect(DICT[lang][key], `${lang} ${key}`).toBe(DICT[lang][d.nameKey]);
    },
  );

  it("no two destinations share a name in either language", () => {
    for (const lang of LANGS) {
      const names = DESTINATIONS.map((d) => DICT[lang][d.nameKey]);
      expect(names.filter((n, i) => names.indexOf(n) !== i), lang).toEqual([]);
    }
  });
});

describe("guard (c): no destination in two rooms", () => {
  it("each route appears once across destination routes, children and the named list", () => {
    const all = [...DESTINATIONS.map((d) => d.route), ...DESTINATIONS.flatMap((d) => d.children ?? []), ...Object.keys(NAMED_PAGES)];
    expect(all.filter((r, i) => all.indexOf(r) !== i)).toEqual([]);
  });

  it("rooms and groups are closed; a group off the Back office only for the two cross-listed rows", () => {
    for (const d of DESTINATIONS) {
      expect(ROOMS, d.id).toContain(d.room);
      if (d.group !== undefined) expect(GROUPS, d.id).toContain(d.group);
      if (d.group !== undefined && d.room !== "back-office") expect(["vendor-mail", "catering"], d.id).toContain(d.id);
      if (d.room === "back-office" && d.id !== "admin") expect(d.group, d.id).toBeDefined();
    }
    expect(byId("admin").group).toBeUndefined();
  });

  it("each tab family lists exactly the destinations that carry it, once", () => {
    for (const [family, ids] of Object.entries(TAB_FAMILIES) as [TabFamilyId, readonly string[]][]) {
      const carrying = DESTINATIONS.filter((d) => d.tabFamily === family).map((d) => d.id);
      expect([...ids].sort(), family).toEqual([...carrying].sort());
      expect(new Set(ids).size, family).toBe(ids.length);
    }
    for (const d of DESTINATIONS) if (d.tabFamily) expect(Object.keys(TAB_FAMILIES)).toContain(d.tabFamily);
  });

  it("every parent and child names a real destination; only /admin/audit is planned; jobs are the two catalog jobs", () => {
    for (const d of DESTINATIONS) if (d.parent !== undefined) expect(() => byId(d.parent!), d.id).not.toThrow();
    expect(DESTINATIONS.filter((d) => d.planned).map((d) => d.id)).toEqual(["audit"]);
    expect(DESTINATIONS.filter((d) => d.kind === "job").map((d) => d.id).sort()).toEqual(["new-item", "new-sandwich"]);
  });

  it("the list is in room order", () => {
    const order = DESTINATIONS.map((d) => ROOMS.indexOf(d.room));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("guard (e): every key exists in both languages", () => {
  it.each(DESTINATIONS.map((d) => [d.id, d] as const))("%s", (_id, d) => {
    for (const lang of LANGS) {
      const name = DICT[lang][d.nameKey];
      expect(name, `${lang} ${d.nameKey}`).toBeTruthy();
      expect(name, `${lang} ${d.nameKey} is a name, not a template`).not.toMatch(/\{\w+\}/);
      for (const key of [d.descriptionKey, ...labelKeys(d)]) if (key) expect(DICT[lang][key], `${lang} ${key}`).toBeTruthy();
    }
  });

  it("aliases are non-empty and never equal a current name (theirs or another destination's), case-insensitively", () => {
    for (const lang of LANGS) {
      const names = new Map(DESTINATIONS.map((d) => [DICT[lang][d.nameKey]!.toLowerCase(), d.id]));
      for (const d of DESTINATIONS) for (const alias of d.aliases?.[lang] ?? []) {
        expect(alias.trim(), `${d.id} ${lang}`).not.toBe("");
        expect(names.get(alias.toLowerCase()), `${d.id} ${lang} alias "${alias}"`).toBeUndefined();
      }
    }
  });

  it("the AM prep list deliberately carries no 'Preparación de la mañana' alias (spec 2.2: the morning-prep trap)", () => {
    expect(byId("am-prep").aliases).toBeUndefined();
    for (const d of DESTINATIONS) expect(d.aliases?.es ?? [], d.id).not.toContain("Preparación de la mañana");
  });
});
