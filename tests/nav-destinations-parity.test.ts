/**
 * Nav PR 3 (plan r5, 4.8 and 4.9).
 *  - 4.8: the legacy adapters reproduce today (the field-by-field proof is tests/nav-legacy-snapshot.test.ts); here,
 *    their order lists name real destinations, and the resolver agrees with each legacy filter where both apply.
 *
 * 4.9: the list mirrors the two registries it does not own yet.
 *  - Parent: every destination's `parent` is today's back link (lib/nav-parents.ts). No exceptions. (Nav PR 4 fixed
 *    the spec section 9 back links in the registry and the list together: Marketing consent, Catering accounts and
 *    Demand signals' Sources now go back to their own parent.)
 *  - Shop: every route in the shop-parameter contract (lib/shop-context-shared.ts) is a destination that takes a
 *    shop; a destination that takes a shop is in the contract or its page reads `location` itself. The chips'
 *    `legacy.chipScoped` is not compared: /catering, /lto and /reports/trends carry ?location= today without
 *    declaring it, which PR 12 (one ?location=) settles.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESTINATIONS, byId, byRoute } from "@/lib/nav/destinations";
import { navDestinationsFor } from "@/lib/nav-links";
import { parentFor } from "@/lib/nav-parents";
import { CARD_ORDER, CATERING_EDITORS, CHIP_ORDER, EDITOR_ORDER, adminSectionOf, editorOf, navLinkOf } from "@/lib/nav/legacy";
import { adminSectionsFor } from "@/lib/admin/sections";
import { canSee } from "@/lib/nav/resolve";
import { ROLES, type RoleCode } from "@/lib/roles";
import { declaredShopRoutes } from "@/lib/shop-context-shared";
import { pageFiles } from "./helpers/nav-pages";

const pages = pageFiles();
/** One role per level, 0..10 (navDestinationsFor reads the level only). */
const ROLE_AT: Record<number, RoleCode> = { 0: "prospect", 1: "hired_not_yet_worked", 2: "trainee", 3: "employee", 4: "key_holder", 5: "shift_lead", 6: "agm", 7: "gm", 8: "moo", 9: "owner", 10: "cgs" };

describe("4.8 the adapters' order lists and the resolver's agreement with the legacy filters", () => {
  it("CHIP_ORDER names only existing destinations, each a chip, once", () => {
    for (const id of CHIP_ORDER) expect(() => byId(id), id).not.toThrow();
    expect(new Set(CHIP_ORDER).size).toBe(CHIP_ORDER.length);
    expect(DESTINATIONS.filter((d) => d.legacy?.chipScoped !== undefined).map((d) => d.id).sort()).toEqual([...CHIP_ORDER].sort());
  });

  it("EDITOR_ORDER names the ten catering editors, each once, and CATERING_EDITORS ends with the workspace cross-link", () => {
    for (const id of EDITOR_ORDER) expect(byId(id).legacy?.editorId, id).toBeDefined();
    expect(DESTINATIONS.filter((d) => d.legacy?.editorId !== undefined).map((d) => d.id).sort()).toEqual([...EDITOR_ORDER].sort());
    expect(CATERING_EDITORS.map((e) => e.id)).toEqual(["packages", "menu", "pricing", "rate-rules", "capacity", "zones", "faq", "prep-demand", "lto", "fulfillment", "workspace"]);
  });

  it("the three mappers refuse a destination that is not on their surface, or a card with two role rules", () => {
    expect(() => navLinkOf(byId("dashboard"))).toThrow(/not a chip/);
    expect(() => editorOf(byId("catering"))).toThrow(/not a catering editor/);
    const two = { ...byId("schedule"), access: { ...byId("schedule").access, onlyRoles: ["gm" as const] } };
    expect(() => adminSectionOf(two)).toThrow(/at most one/);
    expect(navLinkOf(byId("assignments"))).toEqual({ key: "nav.assignments", href: "/assignments", scoped: true });
    expect("minLevel" in navLinkOf(byId("assignments"))).toBe(false); // omitted, not undefined
  });

  it("CARD_ORDER names the 27 Back office cards, each once", () => {
    for (const id of CARD_ORDER) expect(() => byId(id), id).not.toThrow();
    expect(new Set(CARD_ORDER).size).toBe(27);
    expect(CARD_ORDER.length).toBe(27);
  });

  it("canSee (no facts) agrees with adminSectionsFor on the 27 cards for every level 0..10 x every role (the planned audit card compared as built)", () => {
    for (let level = 0; level <= 10; level++) for (const role of Object.keys(ROLES) as RoleCode[]) {
      const shown = new Set(adminSectionsFor(level, role).map((s) => s.id));
      for (const id of CARD_ORDER) {
        const d = byId(id);
        expect(canSee(d.planned ? { ...d, planned: undefined } : d, { role, level, switches: {} }), `${id} level ${level} ${role}`).toBe(shown.has(id));
      }
    }
    expect(canSee(byId("audit"), { role: "cgs", level: 10, switches: {} })).toBe(false); // never through the resolver
  });

  it("canSee (no facts) agrees with navDestinationsFor on every chip, at every level, for the four vault / pulseV2 combinations", () => {
    const chips = [...CHIP_ORDER, "mid-shift", "vault", "admin"];
    for (let level = 0; level <= 10; level++) for (const vault of [false, true]) for (const pulseV2 of [false, true]) {
      const shown = new Set(navDestinationsFor(level, { vault, pulseV2 }).map((l) => l.href));
      for (const id of chips) {
        const d = byId(id);
        expect(canSee(d, { role: ROLE_AT[level]!, level, switches: { vault, pulseV2 } }), `${id} level ${level} vault ${vault} pulseV2 ${pulseV2}`).toBe(shown.has(d.route));
      }
    }
  });
});

describe("4.9 parity with the back-link registry", () => {
  it.each(DESTINATIONS.filter((d) => d.parent !== undefined).map((d) => [d.id, d] as const))("%s: parent is today's back link", (_id, d) => {
    expect(parentFor(d.route).href).toBe(byId(d.parent!).route);
  });

  it("only the Dashboard has no parent (it is the root)", () => {
    expect(DESTINATIONS.filter((d) => d.parent === undefined).map((d) => d.id)).toEqual(["dashboard"]);
  });

  it("nav PR 4: the spec section 9 sub-pages point at their own parent (the bugs are fixed, not mirrored)", () => {
    expect(byId("customers-consent").parent).toBe("customers");
    expect(byId("customers-catering").parent).toBe("customers");
    expect(byId("demand-signals-sources").parent).toBe("demand-signals");
  });
});

describe("4.9 parity with the shop-parameter contract", () => {
  it.each(declaredShopRoutes())("%s (declared) is a destination that takes a shop", (route) => {
    expect(byRoute(route)?.takesShop, route).toBe(true);
  });

  it.each(DESTINATIONS.filter((d) => d.takesShop && !declaredShopRoutes().includes(d.route)).map((d) => [d.route] as const))(
    "%s takes a shop and is not declared: its page reads `location` itself", (route) => {
      const source = readFileSync(pages.get(route)!, "utf8");
      // A destructuring of `location` (from the awaited searchParams or the range parsed from them) or a `.location` read.
      expect(source, route).toMatch(/\{[^}]*\blocation\b[^}]*\}\s*=|\.location\b/);
    },
  );
});
