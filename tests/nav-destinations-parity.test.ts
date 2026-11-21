/**
 * Nav PR 3 (plan r5, 4.8 and 4.9): the list mirrors the two registries it does not own yet.
 *  - Parent: every destination's `parent` is today's back link (lib/nav-parents.ts). No exceptions; the known
 *    back-link bugs (spec section 9: Marketing consent and Demand signals' Sources point at the hub) are mirrored as
 *    they are, and PR 4 fixes the registry and the list together.
 *  - Shop: every route in the shop-parameter contract (lib/shop-context-shared.ts) is a destination that takes a
 *    shop; a destination that takes a shop is in the contract or its page reads `location` itself. The chips'
 *    `legacy.chipScoped` is not compared: /catering, /lto and /reports/trends carry ?location= today without
 *    declaring it, which PR 12 (one ?location=) settles.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESTINATIONS, byId, byRoute } from "@/lib/nav/destinations";
import { parentFor } from "@/lib/nav-parents";
import { declaredShopRoutes } from "@/lib/shop-context-shared";
import { pageFiles } from "./helpers/nav-pages";

const pages = pageFiles();

describe("4.9 parity with the back-link registry", () => {
  it.each(DESTINATIONS.filter((d) => d.parent !== undefined).map((d) => [d.id, d] as const))("%s: parent is today's back link", (_id, d) => {
    expect(parentFor(d.route).href).toBe(byId(d.parent!).route);
  });

  it("only the Dashboard has no parent (it is the root)", () => {
    expect(DESTINATIONS.filter((d) => d.parent === undefined).map((d) => d.id)).toEqual(["dashboard"]);
  });

  it("the spec section 9 back-link bugs are mirrored, not fixed (PR 4)", () => {
    expect(byId("customers-consent").parent).toBe("admin");
    expect(byId("demand-signals-sources").parent).toBe("admin");
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
