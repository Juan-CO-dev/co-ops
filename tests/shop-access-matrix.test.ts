/**
 * All-shops access plan r15, PR 1: the differential gate matrix against the FROZEN ORACLE (plan section 6, row "1":
 * no allowed change, total equality).
 *
 * The oracle (tests/fixtures/shop-access-frozen-oracle.ts) is a verbatim copy of every gate PR 1 re-points, taken at
 * origin/main e4932411 before any change. This test runs the LIVE gates and the frozen ones over
 *
 *   every role (all 15) x every shop state x every surface (x the verified checklist actor's `active` flag)
 *
 * and asserts the same answer in every cell. A difference is a bug in the change, never in the oracle.
 *
 * Shop states, as the real sources deliver them to these pure gates:
 *   - member:              an active membership at the shop;
 *   - non-member:          a membership elsewhere only;
 *   - inactive membership: the person's row at the shop is `active = false`. Both sources of `locations` (the session's
 *                          live read, lib/session.ts, and resolveChecklistWriteActor) select `user_locations.active`, so
 *                          the shop is absent from the list, and the gate must answer as for a non-member;
 *   - inactive shop:       an active membership at a shop whose `locations.active` is false. These gates do not read shop
 *                          activity (the callers resolve "all" against active shops and re-check the instance's shop);
 *                          pinned so that stays true through the access PRs;
 *   - null shop:           no location (unassigned leads, global rows): the target id is null at runtime;
 *   - no memberships:      the person holds no shop at all.
 *
 * Later access PRs (3, 4, 5, 8) extend this file with their allowed cells (plan section 6); anything else must stay equal.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROLES, getRoleLevel, type RoleCode } from "@/lib/roles";
import {
  accessibleLocations,
  canReadReportLocation,
  canWorkShopTasks,
  isAllLocationsAccess,
  lockLocationContext,
  shopTaskLocations,
} from "@/lib/locations";
import { worksShopTasks } from "@/lib/checklist-write-guard-shared";
import { SHOP_SURFACES, actingShops, canActAtShop, type ShopSurface } from "@/lib/shop-access-shared";
import * as frozen from "./fixtures/shop-access-frozen-oracle";

const SHOP = "10000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const CLOSED = "30000000-0000-4000-8000-000000000003";

const ROLE_CODES = Object.keys(ROLES) as RoleCode[];

const STATES = [
  { name: "member", locations: [SHOP], target: SHOP },
  { name: "non-member", locations: [OTHER], target: SHOP },
  { name: "inactive membership", locations: [OTHER], target: SHOP },
  { name: "inactive shop", locations: [CLOSED], target: CLOSED },
  { name: "null shop", locations: [SHOP], target: null as unknown as string },
  { name: "no memberships", locations: [] as string[], target: SHOP },
] as const;
type StateName = (typeof STATES)[number]["name"];

const ACTIVE_FLAGS = [true, false] as const;

/** The verified checklist actor as resolveChecklistWriteActor builds it: level := getRoleLevel(role). */
function writeActor(role: RoleCode, active: boolean, locations: readonly string[]) {
  const actor = { userId: "actor", role, level: getRoleLevel(role), active, locations: Object.freeze([...locations]) };
  return actor;
}

function frozenRole(role: RoleCode): frozen.FrozenRoleCode {
  return role as frozen.FrozenRoleCode;
}

describe("the oracle's inputs are today's", () => {
  it("the role registry is the frozen one: same 15 roles, same levels (PR 1 changes no role)", () => {
    expect(ROLE_CODES).toHaveLength(15);
    expect(Object.fromEntries(ROLE_CODES.map((role) => [role, getRoleLevel(role)]))).toEqual(frozen.FROZEN_ROLE_LEVELS);
  });

  it("a verified checklist actor's level is derived from its role, so a role test and a level test see the same person", () => {
    const src = readFileSync("lib/checklist-write-actor.ts", "utf8");
    expect(src).toContain("role: user.role,");
    expect(src).toContain("level: getRoleLevel(user.role),");
    expect(src).toMatch(/\.from\("user_locations"\)\.select\("location_id"\)\.eq\("user_id", auth\.user\.id\)\.eq\("active", true\)/);
  });
});

describe("PR 1: every live gate equals its frozen copy (total equality)", () => {
  describe.each(ROLE_CODES)("%s", (role) => {
    it.each(STATES)("$name", ({ locations, target }) => {
      const actor = { role, locations: [...locations] };
      const old = { role: frozenRole(role), locations: [...locations] };

      // ops (unchanged in PR 1; the controls that prove the task and report widening did not leak into ops)
      expect(isAllLocationsAccess(actor), "ops: isAllLocationsAccess").toBe(frozen.isAllLocationsAccess(old));
      expect(accessibleLocations(actor), "ops: accessibleLocations").toEqual(frozen.accessibleLocations(old));
      expect(lockLocationContext(actor, target), "ops: lockLocationContext").toBe(frozen.lockLocationContext(old, target));
      // catering: today every catering write binds through assertCanWrite = a level floor + lockLocationContext
      // (plan 1.2); PR 4 moves it to the catering surface. Its shop half is the ops gate, unchanged here.
      expect(lockLocationContext(actor, target), "catering: assertCanWrite's shop half").toBe(frozen.lockLocationContext(old, target));

      // tasks
      expect(canWorkShopTasks(actor, target), "tasks: canWorkShopTasks").toBe(frozen.canWorkShopTasks(old, target));
      expect(shopTaskLocations(actor), "tasks: shopTaskLocations").toEqual(frozen.shopTaskLocations(old));
      for (const active of ACTIVE_FLAGS) {
        const live = writeActor(role, active, locations);
        const was = { userId: live.userId, level: live.level, active, locations: live.locations };
        const cell = `active=${active}`;
        expect(worksShopTasks(live, target), `tasks: worksShopTasks ${cell}`).toBe(frozen.worksShopTasks(was, target));
        // lib/checklists.ts requireCorrectionShop and tagActualCompleter bind through worksShopTasks (pinned below).
        expect(worksShopTasks(live, target), `tasks: requireCorrectionShop ${cell}`)
          .toBe(frozen.requireCorrectionShopAdmits(was, { location_id: target }));
        expect(!worksShopTasks(live, target), `tasks: tagActualCompleter ${cell}`)
          .toBe(frozen.tagActualCompleterRefuses(was, { location_id: target }));
      }

      // report_read
      expect(canReadReportLocation(actor, target), "report_read: canReadReportLocation").toBe(frozen.canReadReportLocation(old, target));
    });
  });
});

describe("PR 1 re-points: every task / report-read gate reads the role set, none a literal level", () => {
  const bodyOf = (src: string, decl: string) => {
    const start = src.indexOf(decl);
    expect(start, decl).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf("\n}\n", start) + 2);
  };
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("lib/locations.ts: canWorkShopTasks / shopTaskLocations / canReadReportLocation go through the module", () => {
    const src = code(readFileSync("lib/locations.ts", "utf8"));
    expect(bodyOf(src, "export function canWorkShopTasks(")).toContain('canActAtShop(actor, locationId, "tasks")');
    expect(bodyOf(src, "export function shopTaskLocations(")).toContain('actingShops(actor, "tasks")');
    expect(bodyOf(src, "export function canReadReportLocation(")).toContain('canActAtShop(actor, locationId, "report_read")');
    expect(src).not.toContain("SHOP_TASK_ALL_LOCATIONS_LEVEL");
    for (const fn of ["canWorkShopTasks", "shopTaskLocations", "canReadReportLocation"]) {
      expect(bodyOf(src, `export function ${fn}(`), fn).not.toMatch(/isRoleAtOrAbove|LEVEL|>=\s*\d/);
    }
  });

  it("lib/checklist-write-guard-shared.ts: worksShopTasks reads holdsAllShops(role, \"tasks\"), not the level", () => {
    const body = bodyOf(code(readFileSync("lib/checklist-write-guard-shared.ts", "utf8")), "export function worksShopTasks(");
    expect(body).toContain('holdsAllShops(actor.role, "tasks")');
    expect(body).not.toMatch(/actor\.level|LEVEL/);
  });

  it("lib/checklists.ts: requireCorrectionShop and tagActualCompleter bind through worksShopTasks; no literal 8 is left", () => {
    const src = code(readFileSync("lib/checklists.ts", "utf8"));
    expect(bodyOf(src, "async function requireCorrectionShop(")).toContain("if (worksShopTasks(actor, instance.location_id)) return bindShopTask(instance);");
    const tag = bodyOf(src, "export async function tagActualCompleter(");
    expect(tag).toContain("if (!worksShopTasks(actor, instance.location_id)) {");
    expect(src).not.toMatch(/actor\.level\s*(>=|<)\s*8\b/);
  });
});

/** Today's gate for each surface, from the frozen oracle: what the module's surface must reproduce once it is wired. */
const TODAY: Record<ShopSurface, { can: (a: frozen.LocationActor, id: string) => boolean; list: (a: frozen.LocationActor) => string[] | "all" }> = {
  ops: { can: frozen.lockLocationContext, list: frozen.accessibleLocations },
  tasks: { can: frozen.canWorkShopTasks, list: frozen.shopTaskLocations },
  catering: { can: frozen.lockLocationContext, list: frozen.accessibleLocations },
  report_read: { can: frozen.canReadReportLocation, list: (a) => (frozen.FROZEN_ROLE_LEVELS[a.role] >= frozen.REPORT_ALL_LOCATIONS_LEVEL ? "all" : [...a.locations]) },
};

/**
 * The module's surfaces against today's gate for that surface. PR 1 WIRES `tasks` and `report_read` (no difference
 * allowed). `ops` and `catering` are defined but consumed by no gate until PR 3 / PR 4; the cells where they already
 * differ from today are listed here exactly, so the module cannot drift before those PRs make them live.
 */
const NOT_A_MEMBER: readonly StateName[] = ["non-member", "inactive membership", "null shop", "no memberships"];
const UNWIRED_DIFFERENCES: Record<ShopSurface, readonly RoleCode[]> = {
  tasks: [],
  report_read: [],
  ops: ["moo"], // PR 3: + {moo} x non-member on every ops gate that tested level 9
  catering: ["moo", "catering_mgr"], // PR 3 (moo via the ruling) and PR 4: + {catering_mgr} x non-member
};

describe("the module's surfaces against today's gates", () => {
  it.each(SHOP_SURFACES)("%s: differs from today exactly in its listed cells", (surface) => {
    const shopDiffs: string[] = [];
    const listDiffs: string[] = [];
    const expectedShop: string[] = [];
    const expectedList: string[] = [];
    for (const role of ROLE_CODES) {
      const listed = UNWIRED_DIFFERENCES[surface].includes(role);
      for (const { name, locations, target } of STATES) {
        const old = { role: frozenRole(role), locations: [...locations] };
        const now = canActAtShop({ role, locations }, target, surface);
        const was = TODAY[surface].can(old, target);
        if (now !== was) shopDiffs.push(`${role} x ${name}`);
        if (listed && NOT_A_MEMBER.includes(name)) expectedShop.push(`${role} x ${name}`);
        // A listed difference is always a widening: refused today, allowed by the module.
        if (now !== was) expect(was, `${surface}: ${role} x ${name} narrowed`).toBe(false);
        // The shop list does not depend on the shop: a listed role goes from its memberships to "all" in every state.
        const nowList = actingShops({ role, locations }, surface);
        const wasList = TODAY[surface].list(old);
        if (JSON.stringify(nowList) !== JSON.stringify(wasList)) {
          listDiffs.push(`${role} x ${name}`);
          expect([wasList, nowList], `${surface}: ${role} x ${name} list`).toEqual([[...locations], "all"]);
        }
        if (listed) expectedList.push(`${role} x ${name}`);
      }
    }
    expect(shopDiffs.sort()).toEqual(expectedShop.sort());
    expect(listDiffs.sort()).toEqual(expectedList.sort());
  });

  it("an inactive actor acts nowhere on any surface, whatever its role", () => {
    for (const role of ROLE_CODES) for (const surface of SHOP_SURFACES) {
      expect(canActAtShop({ role, locations: [SHOP], active: false }, SHOP, surface), `${role} x ${surface}`).toBe(false);
      expect(actingShops({ role, locations: [SHOP], active: false }, surface), `${role} x ${surface}`).toEqual([]);
    }
  });

  it("returns a copy of the memberships, never the caller's array", () => {
    const locations = [SHOP];
    const list = actingShops({ role: "gm", locations }, "ops");
    expect(list).toEqual([SHOP]);
    expect(list).not.toBe(locations);
  });
});
