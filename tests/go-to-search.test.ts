/**
 * Nav PR 9: page search over the Go to model (plan r2 3.2, 4.4, 8.2 N2 and Q1; spec 4.2 "Pages", "Jobs").
 *
 * N2: `normalize` and `searchEntries` (accent- and case-insensitive, every term must match, ordering, empty query).
 * Q1: an old name finds the page (each alias in the destination list, for a viewer who can see that destination, in
 * both languages), and the three jobs are findable in both languages.
 */
import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "@/lib/nav/destinations";
import { goToEntries } from "@/lib/nav/go-to";
import { normalize, searchEntries, type GoToEntry, type GoToModel } from "@/lib/nav/go-to-shared";
import { canSee } from "@/lib/nav/resolve";
import type { SwitchName, Switches } from "@/lib/nav/types";
import { ROLES, type RoleCode } from "@/lib/roles";

const SWITCHES: readonly SwitchName[] = ["pulseV2", "vault", "businessReport", "demandSignals", "marketingScorecard", "customerProfiles"];
const ALL_ON: Switches = Object.fromEntries(SWITCHES.map((s) => [s, true]));
const ROLE_CODES = Object.keys(ROLES) as RoleCode[];

function entry(id: string, name: string, haystack: string): GoToEntry {
  return { id, href: `/${id}`, room: "today", kind: "place", name, otherName: name, haystack: normalize(haystack) };
}
const fixture: GoToModel = {
  people: true,
  rooms: [{ room: "today", name: "Today", groups: [], entries: [
    entry("a", "Opening report", "Opening report Reporte de apertura"),
    entry("b", "Reports", "Reports Reportes"),
    entry("c", "Shift reports", "Shift reports Reportes de turno"),
    entry("d", "Inventory count", "Inventory count Conteo Auditoría de inventario"),
  ] }],
};

describe("N2: normalize", () => {
  it("strips accents, lower-cases and collapses whitespace", () => {
    expect(normalize("  Auditoría   de\tInventario ")).toBe("auditoria de inventario");
    expect(normalize("ÑANDÚ")).toBe("nandu");
    expect(normalize("")).toBe("");
  });
});

describe("N2: searchEntries", () => {
  it("an empty or blank query has no results", () => {
    expect(searchEntries(fixture, "")).toEqual([]);
    expect(searchEntries(fixture, "   ")).toEqual([]);
  });
  it("case- and accent-insensitive", () => {
    expect(searchEntries(fixture, "AUDITORIA").map((e) => e.id)).toEqual(["d"]);
    expect(searchEntries(fixture, "auditoría").map((e) => e.id)).toEqual(["d"]);
  });
  it("every term must match (AND)", () => {
    expect(searchEntries(fixture, "shift report").map((e) => e.id)).toEqual(["c"]);
    expect(searchEntries(fixture, "shift opening")).toEqual([]);
  });
  it("orders a name prefix first, then a name that contains it, then the rest; ties keep list order", () => {
    // "report": b starts with it, a and c contain it in the name.
    expect(searchEntries(fixture, "report").map((e) => e.id)).toEqual(["b", "a", "c"]);
    // "reportes": only in the other-language names (the rest), list order.
    expect(searchEntries(fixture, "reportes").map((e) => e.id)).toEqual(["b", "c"]);
  });
});

/** A viewer (role + all switches) who can see the destination, or undefined if none can. */
function viewerFor(id: string): RoleCode | undefined {
  const d = DESTINATIONS.find((x) => x.id === id)!;
  return ROLE_CODES.find((role) => canSee(d, { role, level: ROLES[role].level, switches: ALL_ON }));
}
const ids = (role: RoleCode, lang: "en" | "es", q: string) =>
  searchEntries(goToEntries({ role, level: ROLES[role].level, language: lang }, ALL_ON), q).map((e) => e.id);

describe("Q1: an old name finds the page", () => {
  it("every alias of every listable destination finds it, for a viewer who can see it, in both languages", () => {
    let checked = 0;
    for (const d of DESTINATIONS) {
      if (d.planned || !d.aliases) continue;
      const role = viewerFor(d.id);
      if (!role) continue;
      for (const lang of ["en", "es"] as const) for (const alias of [...d.aliases.en, ...d.aliases.es]) {
        expect(ids(role, lang, alias), `${d.id} ${lang} "${alias}"`).toContain(d.id);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
  it.each([
    ["Inventory Audit", "counts"], ["Counts", "counts"], ["Mid-Shift Pulse", "mid-shift"], ["User Management", "users"],
    ["Reports Hub", "reports"], ["Fulfillment Zones", "catering-fulfillment"], ["Auditoría de inventario", "counts"],
    ["auditoria", "counts"], ["inventory audit", "counts"],
  ])("'%s' finds %s for the CGS", (q, id) => {
    expect(ids("cgs", "en", q)).toContain(id);
    expect(ids("cgs", "es", q)).toContain(id);
  });
});

describe("Q1: the jobs (spec 4.2 'Jobs')", () => {
  it.each([
    ["add a sandwich", "new-sandwich", "gm"], ["agregar un sandwich", "new-sandwich", "gm"], ["Agregar un sándwich", "new-sandwich", "gm"],
    ["log a delivery", "receiving", "key_holder"], ["registrar una entrega", "receiving", "key_holder"],
    ["change a par", "pars", "gm"], ["cambiar un par", "pars", "gm"],
  ] as const)("'%s' finds %s (%s), in both languages", (q, id, role) => {
    expect(ids(role, "en", q)).toContain(id);
    expect(ids(role, "es", q)).toContain(id);
  });
});
