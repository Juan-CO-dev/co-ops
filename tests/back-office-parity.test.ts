/**
 * Nav PR 4 (plan r2, 7.2): the grouped Back office shows each role exactly the pages it saw as tiles.
 *
 * Exhaustive and pure. For every role at its own level and every combination of the two switches the hub reads,
 * the destinations of `backOfficeFor` (rows, the planned Audit log row, and the job targets that are jobs) equal
 * today's cards (`adminSectionsFor`, PR 3's derived adapter) plus the two hand tiles the old page drew outside the
 * registry, by their own rules (`marketingTileVisible`, `demandSignalsEnabled && canViewDemandSignals`). The 27 cards
 * are also compared for every level 0..10 x every role (mismatched pairs, as PR 3's 4.8 does). Jobs never add access,
 * and the structure of the module is closed.
 */
import { describe, expect, it } from "vitest";
import { adminSectionsFor } from "@/lib/admin/sections";
import { canViewDemandSignals } from "@/lib/demand-signals/access-shared";
import { demandSignalsEnabled } from "@/lib/demand-signals/config-shared";
import { marketingTileVisible } from "@/lib/marketing/access-shared";
import {
  BACK_OFFICE_JOBS, BACK_OFFICE_SWITCHES, BUYING_PATH, GROUP_LABELS, GROUP_ROWS, NOT_A_ROW, backOfficeFor,
} from "@/lib/nav/back-office";
import { DESTINATIONS, GROUPS, byId } from "@/lib/nav/destinations";
import { CARD_ORDER } from "@/lib/nav/legacy";
import { canSee } from "@/lib/nav/resolve";
import type { Viewer } from "@/lib/nav/types";
import { parWriteRoleAllowed } from "@/lib/par-permissions-shared";
import { ROLES, getRoleLevel, type RoleCode } from "@/lib/roles";

const ALL_ROLES = Object.keys(ROLES) as RoleCode[];
const COMBOS = [false, true].flatMap((demandSignals) => [false, true].map((marketingScorecard) => ({ demandSignals, marketingScorecard })));

/** Every destination id the viewer's Back office opens or shows: rows (any group, the System group included) and the
 *  targets of the jobs that are kind "job" (Add a sandwich, Add an item we buy: they were tiles). */
function shownIds(v: Viewer): Set<string> {
  const o = backOfficeFor(v);
  const rows = [...o.groups, o.system].flatMap((g) => g.rows.map((r) => r.id));
  const jobTargets = o.jobs.map((j) => j.target).filter((id) => byId(id).kind === "job");
  return new Set([...rows, ...jobTargets]);
}

describe("parity: each role sees exactly the pages it saw as tiles", () => {
  it.each(ALL_ROLES)("%s at its own level, every switch combination", (role) => {
    const level = getRoleLevel(role);
    for (const s of COMBOS) {
      const today = new Set(adminSectionsFor(level, role).map((c) => c.id));
      if (marketingTileVisible(role, s.marketingScorecard ? "1" : undefined)) today.add("marketing");
      if (demandSignalsEnabled(s.demandSignals ? "1" : undefined) && canViewDemandSignals(role)) today.add("demand-signals");
      expect([...shownIds({ role, level, switches: s })].sort(), `${role} ${JSON.stringify(s)}`).toEqual([...today].sort());
    }
  });

  it("the 27 cards, for every level 0..10 x every role (mismatched pairs too)", () => {
    for (let level = 0; level <= 10; level++) for (const role of ALL_ROLES) for (const s of COMBOS) {
      const today = new Set(adminSectionsFor(level, role).map((c) => c.id));
      const shown = shownIds({ role, level, switches: s });
      for (const id of CARD_ORDER) expect(shown.has(id), `${id} level ${level} ${role} ${JSON.stringify(s)}`).toBe(today.has(id));
    }
  });

  it("the planned Audit log is a muted row (no link is ever drawn for it), and only from level 9", () => {
    for (const role of ALL_ROLES) {
      const o = backOfficeFor({ role, level: getRoleLevel(role), switches: {} });
      const audit = o.system.rows.find((r) => r.id === "audit");
      expect(Boolean(audit), role).toBe(getRoleLevel(role) >= 9);
      if (audit) expect(audit.planned).toBe(true);
      for (const g of o.groups) for (const r of g.rows) expect(r.planned, r.id).toBe(false);
    }
  });
});

describe("jobs never add access", () => {
  it("every visible job's target is a visible row, or a kind-\"job\" destination that was a tile", () => {
    for (let level = 0; level <= 10; level++) for (const role of ALL_ROLES) for (const s of COMBOS) {
      const v = { role, level, switches: s };
      const o = backOfficeFor(v);
      const rows = new Set([...o.groups, o.system].flatMap((g) => g.rows.map((r) => r.id)));
      const cards = new Set(adminSectionsFor(level, role).map((c) => c.id));
      for (const j of o.jobs) {
        const ok = rows.has(j.target) || (byId(j.target).kind === "job" && cards.has(j.target));
        expect(ok, `${j.id} for ${role} at ${level}`).toBe(true);
        expect(canSee(byId(j.target), v), `${j.id} for ${role} at ${level}`).toBe(true);
      }
    }
  });

  it("lead decision 7: Change a par follows the Par levels page AND parWriteRoleAllowed (the level-6 operational roles see it, the social media manager never)", () => {
    for (const role of ALL_ROLES) {
      const v = { role, level: getRoleLevel(role), switches: {} };
      const has = backOfficeFor(v).jobs.some((j) => j.id === "change-par");
      expect(has, role).toBe(canSee(byId("pars"), v) && parWriteRoleAllowed(role));
    }
    const sees = (role: RoleCode) => backOfficeFor({ role, level: getRoleLevel(role), switches: {} }).jobs.some((j) => j.id === "change-par");
    for (const role of ["agm", "prep_mgr", "catering_mgr", "gm", "moo", "owner", "cgs"] as const) expect(sees(role), role).toBe(true);
    expect(sees("social_media_mgr")).toBe(false);
  });

  it("the other four jobs show exactly when their target does", () => {
    for (let level = 0; level <= 10; level++) for (const role of ALL_ROLES) {
      const v = { role, level, switches: {} };
      const jobs = new Set(backOfficeFor(v).jobs.map((j) => j.id));
      for (const j of BACK_OFFICE_JOBS.filter((x) => x.alsoNeeds === undefined)) expect(jobs.has(j.id), `${j.id} ${role} ${level}`).toBe(canSee(byId(j.target), v));
    }
  });
});

describe("structure", () => {
  it("every GROUP_ROWS id exists and carries that group; no id twice", () => {
    const all = Object.values(GROUP_ROWS).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const [g, ids] of Object.entries(GROUP_ROWS)) for (const id of ids) expect(byId(id).group, id).toBe(g);
  });

  it("every destination with a group is a row or in NOT_A_ROW, never both, and NOT_A_ROW names only grouped destinations", () => {
    const rows = new Set(Object.values(GROUP_ROWS).flat());
    for (const d of DESTINATIONS.filter((x) => x.group !== undefined)) {
      expect(rows.has(d.id) !== (d.id in NOT_A_ROW), d.id).toBe(true);
    }
    for (const id of Object.keys(NOT_A_ROW)) expect(byId(id).group, id).toBeDefined();
    for (const why of Object.values(NOT_A_ROW)) expect(why.length).toBeGreaterThan(10);
  });

  it("the buying path is steps 1..6 on vendors, SKUs, products, recipes, prep items, sandwiches, each a row", () => {
    expect(Object.entries(BUYING_PATH).map(([id, p]) => [p.step, id]).sort()).toEqual([
      [1, "vendors"], [2, "skus"], [3, "products"], [4, "recipes"], [5, "items"], [6, "sandwiches"],
    ]);
    const rows = new Set(Object.values(GROUP_ROWS).flat());
    for (const id of Object.keys(BUYING_PATH)) expect(rows.has(id), id).toBe(true);
  });

  it("BACK_OFFICE_SWITCHES is exactly the switches the rows and the job targets need", () => {
    const ids = [...Object.values(GROUP_ROWS).flat(), ...BACK_OFFICE_JOBS.map((j) => j.target)];
    const needed = new Set(ids.map((id) => byId(id).access.requires).filter((x) => x !== undefined));
    expect([...needed].sort()).toEqual([...BACK_OFFICE_SWITCHES].sort());
  });

  it("GROUP_LABELS and GROUP_ROWS cover the seven groups in GROUPS order", () => {
    expect(Object.keys(GROUP_LABELS)).toEqual([...GROUPS]);
    expect(Object.keys(GROUP_ROWS)).toEqual([...GROUPS]);
  });

  it("a group with no visible row is dropped, the System group is always returned, and groups keep GROUPS order", () => {
    const smm = backOfficeFor({ role: "social_media_mgr", level: 6, switches: {} });
    expect(smm.groups.map((g) => g.id)).toEqual(["menu-and-recipes", "ordering-and-stock", "catering-setup"]);
    expect(smm.system.rows).toEqual([]);
    expect(smm.jobs).toEqual([]);
    const owner = backOfficeFor({ role: "owner", level: 9, switches: { demandSignals: true, marketingScorecard: true } });
    expect(owner.groups.map((g) => g.id)).toEqual(GROUPS.filter((g) => g !== "system"));
  });

  it("the row line: the step line on the buying path, else the destination's own description, and every row has one", () => {
    const o = backOfficeFor({ role: "cgs", level: 10, switches: { demandSignals: true, marketingScorecard: true } });
    for (const r of [...o.groups, o.system].flatMap((g) => g.rows)) {
      expect(r.lineKey, r.id).toBe(BUYING_PATH[r.id]?.lineKey ?? byId(r.id).descriptionKey);
      expect(r.lineKey, r.id).toBeDefined();
      expect(r.step, r.id).toBe(BUYING_PATH[r.id]?.step);
    }
  });
});
