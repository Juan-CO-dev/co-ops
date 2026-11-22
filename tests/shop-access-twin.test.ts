/**
 * All-shops access plan r15, PR 1: the TS role set as DATA, ready for its SQL twin.
 *
 * `holdsAllShops` (lib/shop-access-shared.ts) is pinned cell by cell to tests/fixtures/shop-access-twin-table.ts over
 * every role x every surface. PR 2 pins `public.all_shops_role(role, surface)` to the same table (PGlite), so the app
 * and SQL answers can only move together. The module's other exports are pinned as data too, and the module is held
 * pure (client-safe, no I/O) because both the server gates and client pages read it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { MEMBER_SURFACES } from "@/lib/dashboard-day-shared";
import type { Surface } from "@/lib/day-plan-shared";
import { ROLES, getRoleLevel, type RoleCode } from "@/lib/roles";
import {
  ALL_SHOP_ROLES,
  CATERING_ALL_SHOP_SURFACES,
  SHOP_SURFACES,
  holdsAllShops,
  orderActingShops,
  type ShopSurface,
} from "@/lib/shop-access-shared";
import { reportShopCandidates } from "@/lib/shop-context-shared";
import { ALL_SHOPS_TWIN_TABLE } from "./fixtures/shop-access-twin-table";

const ROLE_CODES = Object.keys(ROLES) as RoleCode[];

describe("the role set as data", () => {
  it("names the four surfaces, the three all-shop roles and the catering manager's one surface", () => {
    expect([...SHOP_SURFACES]).toEqual(["ops", "tasks", "catering", "report_read"]);
    expect([...ALL_SHOP_ROLES]).toEqual(["moo", "owner", "cgs"]);
    expect([...CATERING_ALL_SHOP_SURFACES]).toEqual(["catering"]);
  });

  it("the table covers exactly the 15 roles and the four surfaces", () => {
    expect(ROLE_CODES).toHaveLength(15);
    expect(Object.keys(ALL_SHOPS_TWIN_TABLE).sort()).toEqual([...ROLE_CODES].sort());
    for (const role of ROLE_CODES) expect(Object.keys(ALL_SHOPS_TWIN_TABLE[role]).sort(), role).toEqual([...SHOP_SURFACES].sort());
  });

  it.each(ROLE_CODES)("%s: holdsAllShops equals the table on every surface", (role) => {
    for (const surface of SHOP_SURFACES) {
      expect(holdsAllShops(role, surface), `${role} x ${surface}`).toBe(ALL_SHOPS_TWIN_TABLE[role][surface]);
    }
  });

  it("a role code outside the registry holds nothing (the SQL twin answers false for an unknown role too)", () => {
    for (const surface of SHOP_SURFACES) {
      expect(holdsAllShops("constructor" as RoleCode, surface)).toBe(false);
      expect(holdsAllShops("" as RoleCode, surface)).toBe(false);
    }
  });
});

describe("why PR 1 is a no-op: by ROLE equals level 8+ today", () => {
  it("the roles that hold `tasks` and `report_read` are exactly the level-8+ roles", () => {
    const levelEightPlus = ROLE_CODES.filter((role) => getRoleLevel(role) >= 8).sort();
    expect(levelEightPlus).toEqual(["cgs", "moo", "owner"]);
    for (const surface of ["tasks", "report_read"] as const) {
      expect(ROLE_CODES.filter((role) => holdsAllShops(role, surface)).sort(), surface).toEqual(levelEightPlus);
    }
  });

  it("no level-6 role but the catering manager holds anything, and it holds catering only", () => {
    const levelSix = ROLE_CODES.filter((role) => getRoleLevel(role) === 6);
    expect(levelSix.sort()).toEqual(["agm", "catering_mgr", "prep_mgr", "social_media_mgr"]);
    for (const role of levelSix) {
      const held = SHOP_SURFACES.filter((surface) => holdsAllShops(role, surface));
      expect(held, role).toEqual(role === "catering_mgr" ? ["catering"] : []);
    }
  });
});

describe("the navigation's surfaces derive from this module (nav PR 7's interim type, replaced here)", () => {
  it("nav Surface = ShopSurface + `schedule` (PR 8 moves `schedule` into ShopSurface)", () => {
    expectTypeOf<Surface>().toEqualTypeOf<ShopSurface | "schedule">();
    expect([...MEMBER_SURFACES].sort()).toEqual([...SHOP_SURFACES, "schedule"].sort());
  });
});

describe("orderActingShops", () => {
  const MEMBERSHIPS = ["b", "d"];
  const ACTIVE = ["a", "b", "c", "d"];

  it("memberships first, then every other active shop, when the role holds the surface; else the memberships", () => {
    expect(orderActingShops(MEMBERSHIPS, ACTIVE, true)).toEqual(["b", "d", "a", "c"]);
    expect(orderActingShops(MEMBERSHIPS, ACTIVE, false)).toEqual(["b", "d"]);
    expect(orderActingShops([], ACTIVE, true)).toEqual(ACTIVE);
    expect(orderActingShops([], ACTIVE, false)).toEqual([]);
  });

  it("is the ordering reportShopCandidates already gives level 8+ (one ordering for every all-shops picker)", () => {
    for (const allShops of [true, false]) {
      for (const memberships of [[], ["a"], ["c", "a"], ["z"]]) {
        expect(orderActingShops(memberships, ACTIVE, allShops)).toEqual(
          reportShopCandidates({ level: allShops ? 8 : 7, memberships, activeShopIds: ACTIVE, reportAllLevel: 8 }),
        );
      }
    }
  });

  it("returns copies, never the caller's arrays", () => {
    const memberships = ["a"];
    expect(orderActingShops(memberships, ACTIVE, false)).not.toBe(memberships);
  });
});

describe("the module stays pure", () => {
  it("imports nothing but the role type: no I/O, no server-only, no clock, no env", () => {
    const src = readFileSync("lib/shop-access-shared.ts", "utf8");
    const imports = [...src.matchAll(/^import .*$/gm)].map((m) => m[0]);
    expect(imports).toEqual(['import type { RoleCode } from "./roles";']);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const banned of ["process.env", "Date.now", "new Date", "fetch(", "server-only", "supabase"]) {
      expect(code, banned).not.toContain(banned);
    }
  });
});
