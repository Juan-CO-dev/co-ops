/**
 * Nav PR 3, guard (d) (plan r5, 4.4.5 and 4.4.8): each destination's "who may see it" matches the page's own guard,
 * as the page-gate reader reads it (tests/helpers/page-gate.ts), over 15 roles at their own level, all 64 combinations
 * of the six switches, and the facts that matter for the destination (an assignment for the eight tasks, the
 * business-report offer for the business report).
 *
 *  (d1) SAFETY, no exceptions: the menu (destinationsFor) never holds a page the person cannot open. Every role,
 *       the social media manager included.
 *  (d2) FIDELITY: canSee ⇔ the page admits, for every role but the social media manager (its menu is the closed
 *       list of guard (f), deliberately narrower than what pages admit until S2 lands). Mismatches only from the
 *       named list below, each "the menu is stricter than the page".
 *  Mutations (must fail): a list whose switches are swapped, a reader whose switch table is swapped, Shop pulse's
 *  floor switch pointed elsewhere.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";
import { canMarkSource, canViewDemandSignals } from "@/lib/demand-signals/access-shared";
import { TASK_MIN_LEVEL, TASK_TYPES } from "@/lib/assignments-shared";
import { businessReportRefusal } from "@/lib/business-report-shared";
import { MAINTENANCE_BASE_LEVEL } from "@/lib/maintenance";
import { MIDSHIFT_BASE_LEVEL } from "@/lib/midshift-shared";
import { DESTINATIONS, byId } from "@/lib/nav/destinations";
import { canSee, ROLE_MENUS } from "@/lib/nav/resolve";
import type { Destination, Facts, SwitchName, Switches, TaskType } from "@/lib/nav/types";
import { canOpenPeopleViews, peopleActorFromAuth } from "@/lib/people/access-shared";
import { PRODUCE_MIN } from "@/lib/production";
import { PULSE_V2_BASE_LEVEL } from "@/lib/pulse/scope-shared";
import { ROLES, type RoleCode } from "@/lib/roles";
import { SALES_READ_MIN } from "@/lib/sales-reports-shared";
import { SWITCH_CALLS, SWITCH_COMBOS, admitMatrix, type Reader } from "./helpers/page-gate";
import { newReader } from "./helpers/page-gate-census";

const ALL_ROLES = Object.keys(ROLES) as RoleCode[];
const below = (n: number) => ALL_ROLES.filter((r) => ROLES[r].level < n && r !== "social_media_mgr");

/** The named exceptions: the recorded rule (card, chip or tile) is stricter than the page. Each is matched on
 *  destination, role set and switch condition, so it cannot hide a different mismatch on the same page. */
const EXCEPTIONS: { id: string; destination: string; roles: readonly RoleCode[]; when: (s: Switches) => boolean; why: string; settledBy: string }[] = [
  { id: "E1", destination: "checklist-templates", roles: ["agm", "catering_mgr", "prep_mgr"], when: () => true, why: "card 7, page 6", settledBy: "the access work (spec 5.2)" },
  { id: "E2", destination: "categories", roles: ["agm", "catering_mgr", "prep_mgr", "gm"], when: () => true, why: "card 8, page 6", settledBy: "the access work (spec 5.2)" },
  { id: "E3", destination: "stations", roles: ["agm", "catering_mgr", "prep_mgr"], when: () => true, why: "card 7, page 6 through the admin shell only", settledBy: "the access work (spec 5.2)" },
  { id: "E4", destination: "lto", roles: below(6), when: () => true, why: "chip 6, the page has no gate (its reads are gated inside at SURPLUS_READ_MIN 6)", settledBy: "lead decision 4" },
  { id: "SW1", destination: "marketing", roles: ["moo", "owner", "cgs"], when: (s) => !s.marketingScorecard, why: "the tile needs MARKETING_SCORECARD; the page reads no switch", settledBy: "the Back office PR (4), or the marketing owner" },
];

interface Mismatch { destination: string; role: RoleCode; switches: Switches; facts: string; menu: boolean; page: boolean; exception?: string }

function factSets(d: Destination): Facts[] {
  const out: Facts[] = [{}];
  if (d.task) out.push({ assignedTasks: new Set<TaskType>([d.task]) });
  if (d.access.needsFact) out.push({ businessReportOffered: true });
  return out;
}
const factsLabel = (f: Facts) => JSON.stringify({ ...f, assignedTasks: f.assignedTasks && [...f.assignedTasks] });

/** Compare a list with a reader over the whole space. Returns d1 violations and d2 mismatches (with the exception that covers each, if any). */
function compare(list: readonly Destination[], reader: Reader): { d1: Mismatch[]; d2: Mismatch[]; exercised: Set<string> } {
  const d1: Mismatch[] = [];
  const d2: Mismatch[] = [];
  const exercised = new Set<string>();
  for (const d of list) {
    for (const facts of factSets(d)) for (const role of ALL_ROLES) {
      const page = admitMatrix(reader, d.route, role, facts);
      SWITCH_COMBOS.forEach((switches, i) => {
        const viewer = { role, level: ROLES[role].level, switches };
        const menuIds = ROLE_MENUS[role];
        const inMenu = (menuIds === undefined || (menuIds.includes(d.id) && !d.numbers)) && canSee(d, viewer, facts);
        // A planned page (only /admin/audit) is never visible through the resolver; its recorded rule is compared
        // separately, as if it were built (the card adapter emits it muted, as today).
        const seen = canSee(d.planned ? { ...d, planned: undefined } : d, viewer, facts);
        const admitted = page[i]!;
        const m: Mismatch = { destination: d.id, role, switches, facts: factsLabel(facts), menu: seen, page: admitted };
        if (inMenu && !admitted) d1.push(m);
        if (role === "social_media_mgr" || seen === admitted) return;
        const ex = EXCEPTIONS.find((e) => e.destination === d.id && e.roles.includes(role) && e.when(switches) && !seen && admitted);
        if (ex) exercised.add(ex.id);
        d2.push({ ...m, exception: ex?.id });
      });
    }
  }
  return { d1, d2, exercised };
}

const reader = newReader();
const base = compare(DESTINATIONS, reader);
const unexplained = (r: { d2: Mismatch[] }) => r.d2.filter((m) => !m.exception);
const show = (ms: Mismatch[]) => ms.slice(0, 12).map((m) => `${m.destination} ${m.role} ${JSON.stringify(m.switches)} ${m.facts}: list ${m.menu}, page ${m.page}`);

describe("guard (d): the list's access matches the pages, over every role, switch combination and fact", () => {
  it("(d1) safety, no exceptions: the menu never holds a page the person cannot open (the social media manager included)", () => {
    expect(show(base.d1)).toEqual([]);
  });

  it("(d2) fidelity: canSee ⇔ the page admits, except the named exceptions", () => {
    expect(show(unexplained(base))).toEqual([]);
  });

  it("every named exception is the menu being stricter, and every one is exercised (none is stale)", () => {
    for (const m of base.d2) expect(m.menu === false && m.page === true, JSON.stringify(m)).toBe(true);
    expect([...base.exercised].sort()).toEqual(EXCEPTIONS.map((e) => e.id).sort());
  });

  it("the space is the plan's: 84 destinations, 15 roles, 64 switch combinations", () => {
    expect(DESTINATIONS).toHaveLength(84);
    expect(ALL_ROLES).toHaveLength(15);
    expect(SWITCH_COMBOS).toHaveLength(64);
    expect(new Set(SWITCH_COMBOS.map((s) => JSON.stringify(s))).size).toBe(64);
  });
});

describe("mutation cases: a wrong wiring must fail the comparison", () => {
  const failing = (r: { d1: Mismatch[]; d2: Mismatch[] }) => new Set([...r.d1, ...unexplained(r)].map((m) => m.destination));

  it("M1: the business report and Vault with their switches swapped", () => {
    const list = DESTINATIONS.map((d) => (d.id === "business" ? { ...d, access: { ...d.access, requires: "vault" as SwitchName } }
      : d.id === "vault" ? { ...d, access: { ...d.access, requires: "businessReport" as SwitchName } } : d));
    const got = failing(compare(list, reader));
    expect(got).toContain("business");
    expect(got).toContain("vault");
  });

  it("M2: the reader's switch table with vaultEnabled and customerProfilesEnabled swapped", () => {
    const swapped = { ...SWITCH_CALLS, vaultEnabled: { ...SWITCH_CALLS.vaultEnabled!, value: "customerProfiles" as SwitchName }, customerProfilesEnabled: { ...SWITCH_CALLS.customerProfilesEnabled!, value: "vault" as SwitchName } };
    const got = failing(compare(DESTINATIONS, newReader({ switchCalls: swapped })));
    expect(got).toContain("vault");
    expect(got).toContain("customers-catering");
  });

  it("M3: Shop pulse's lower floor pointed at the vault switch", () => {
    const list = DESTINATIONS.map((d) => (d.id === "mid-shift" ? { ...d, access: { ...d.access, floorWhenOn: { switch: "vault" as SwitchName, minLevel: 2 } } } : d));
    expect(failing(compare(list, reader))).toContain("mid-shift");
  });

  it("an unmutated run fails nothing", () => {
    expect([...failing(base)]).toEqual([]);
  });
});

describe("4.4.8: the list's literal floors and role lists equal their owning constants and predicates", () => {
  const rolesWhere = (pred: (r: RoleCode) => boolean) => ALL_ROLES.filter(pred).sort();
  const listRoles = (id: string) => [...(byId(id).access.onlyRoles ?? [])].sort();

  it("floors", () => {
    expect(byId("mid-shift").access.minLevel).toBe(MIDSHIFT_BASE_LEVEL);
    expect(byId("mid-shift").access.floorWhenOn).toEqual({ switch: "pulseV2", minLevel: PULSE_V2_BASE_LEVEL });
    expect(byId("production").access.minLevel).toBe(PRODUCE_MIN);
    expect(byId("maintenance").access.minLevel).toBe(MAINTENANCE_BASE_LEVEL);
    expect(byId("sales").access.minLevel).toBe(SALES_READ_MIN);
    // The catering workspace's floor is the page's file-local CATERING_HUB_MIN, read from its declaration.
    const src = readFileSync("app/(authed)/catering/page.tsx", "utf8");
    const sf = ts.createSourceFile("page.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let hubMin: number | undefined;
    for (const st of sf.statements) if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === "CATERING_HUB_MIN" && d.initializer && ts.isNumericLiteral(d.initializer)) hubMin = Number(d.initializer.text);
    }
    expect(byId("catering-workspace").access.minLevel).toBe(hubMin);
  });

  it("role lists", () => {
    expect(listRoles("demand-signals")).toEqual(rolesWhere((r) => canViewDemandSignals(r)));
    expect(listRoles("demand-signals-sources")).toEqual(rolesWhere((r) => canMarkSource(r)));
    expect(listRoles("business")).toEqual(rolesWhere((r) => businessReportRefusal(r) === null));
    expect(listRoles("trends-team")).toEqual(rolesWhere((r) => ROLES[r].level >= 6
      && canOpenPeopleViews(peopleActorFromAuth({ user: { id: "x" }, role: r, level: ROLES[r].level, locations: [] }))));
  });

  it("each task destination opens from TASK_MIN_LEVEL[task] with an assignment, and the local TaskType is TASK_TYPES", () => {
    const tasks = DESTINATIONS.filter((d) => d.task);
    expect(tasks.map((d) => d.task).sort()).toEqual([...TASK_TYPES].sort());
    for (const d of tasks) {
      expect(d.access.assignedFrom, d.id).toBe(TASK_MIN_LEVEL[d.task!]);
      expect(d.access.minLevel, d.id).toBe(4);
    }
    expectTypeOf<TaskType>().toEqualTypeOf<(typeof TASK_TYPES)[number]>();
  });
});
