// Business report access (item 9, plan r6): the pure rules. What a GM may see is twelve switches a MoO+ saves.
// Juan 2026-11-19: each hourly person's cost and labor dollars per 15 minutes are switches (ON by default); a
// salary per person is its own switch (OFF by default).
import { describe, expect, it } from "vitest";
import { ROLES, type RoleCode } from "@/lib/roles";
import {
  BUSINESS_ACCESS_GROUPS, BUSINESS_VISIBILITY_ERROR_CODES, BUSINESS_VISIBILITY_ROLES, GM_VISIBILITY_DEFAULTS, GM_VISIBILITY_KEYS, GM_VISIBILITY_NEEDS,
  PERSON_NON_MONEY_KEYS, redactBusinessDto, businessAccessFor, businessAllShopsAllowed, businessShopAllowed, businessTabAllowed, businessTabsFor, canManageBusinessVisibility, coherentGmVisibility,
  gmVisibilityCombinations, parseGmVisibility, parseGmVisibilitySave, sameBusinessAccess, type GmVisibility,
} from "@/lib/business-access-shared";

const ALL_ON = Object.fromEntries(GM_VISIBILITY_KEYS.map((k) => [k, true])) as GmVisibility;
const ALL_OFF = Object.fromEntries(GM_VISIBILITY_KEYS.map((k) => [k, false])) as GmVisibility;
const FULL: RoleCode[] = ["moo", "owner", "cgs"];
const OTHERS = (Object.keys(ROLES) as RoleCode[]).filter((r) => r !== "gm" && !FULL.includes(r));

describe("the twelve switches and their defaults (plan r6 section 2: Juan's ruling of 2026-11-19)", () => {
  it("exactly these keys, in this order", () => {
    expect(GM_VISIBILITY_KEYS).toEqual(["report", "hourly_cost", "loaded", "quarters", "quarter_cost", "channels", "people", "person_cost", "person_salary",
      "servers", "compare", "export"]);
  });
  it("defaults: everything ON, cost per hourly person and dollars per 15 minutes included, except the salaried side", () => {
    expect(GM_VISIBILITY_DEFAULTS).toEqual({ report: true, hourly_cost: true, loaded: false, quarters: true, quarter_cost: true, channels: true, people: true,
      person_cost: true, person_salary: false, servers: true, compare: true, export: true });
    expect(Object.entries(GM_VISIBILITY_DEFAULTS).filter(([, v]) => !v).map(([k]) => k)).toEqual(["loaded", "person_salary"]);
  });
  it("needs: a per-person or per-15-minute money switch needs its list AND the shop-level money it is a part of", () => {
    expect(GM_VISIBILITY_NEEDS).toEqual({ report: [], hourly_cost: ["report"], loaded: ["hourly_cost"], quarters: ["report"], quarter_cost: ["quarters", "hourly_cost"],
      channels: ["report"], people: ["report"], person_cost: ["people", "hourly_cost"], person_salary: ["people", "loaded"], servers: ["report"], compare: ["report"],
      export: ["report"] });
  });
  it("there is no switch for the overtime premium (it is shown and hidden with hourly cost)", () => {
    expect(GM_VISIBILITY_KEYS as readonly string[]).not.toContain("ot_premium");
  });
  it("coherent = no child on under a parent that is off; the defaults are coherent", () => {
    expect(coherentGmVisibility(GM_VISIBILITY_DEFAULTS)).toBe(true);
    expect(coherentGmVisibility(ALL_ON)).toBe(true);
    expect(coherentGmVisibility(ALL_OFF)).toBe(true);
    expect(coherentGmVisibility({ ...ALL_ON, hourly_cost: false })).toBe(false); // loaded on under hourly off
    expect(coherentGmVisibility({ ...ALL_OFF, export: true })).toBe(false);
  });
  it("every coherent combination is enumerated from the needs graph: 1 (report off) + 2^4 free tabs x 28 states of the money and its two lists", () => {
    const all = gmVisibilityCombinations();
    // hourly off: 4 (hours section x people list). hourly on, loaded off: 3 x 3. hourly on, loaded on: 3 x 5.
    expect(all).toHaveLength(1 + 16 * (4 + 9 + 15));
    expect(all.every(coherentGmVisibility)).toBe(true);
    expect(new Set(all.map((c) => JSON.stringify(c))).size).toBe(all.length);
  });
});

describe("parseGmVisibility: the stored row's reader and the route's settings", () => {
  it("accepts exactly the twelve booleans, coherent", () => {
    expect(parseGmVisibility(GM_VISIBILITY_DEFAULTS)).toEqual(GM_VISIBILITY_DEFAULTS);
    expect(parseGmVisibility(ALL_OFF)).toEqual(ALL_OFF);
  });
  it("anything else is null", () => {
    const { export: _drop, ...missing } = ALL_ON;
    for (const bad of [null, undefined, 1, "x", [], [ALL_ON], missing, { ...ALL_ON, extra: true }, { ...ALL_ON, ot_premium: false }, { ...ALL_ON, report: 1 }, { ...ALL_ON, loaded: false },
      { ...ALL_ON, people: false }, { ...ALL_ON, quarters: false },
      { ...ALL_ON, loaded: "true" }, { ...ALL_ON, people: null }, { ...ALL_ON, hourly_cost: false }, { ...ALL_OFF, compare: true }]) {
      expect(parseGmVisibility(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it("the save body is exactly { settings, expectedId }; the head comes back lowercase", () => {
    const ID = "AAAAAAAA-0000-4000-8000-00000000000A";
    expect(parseGmVisibilitySave({ settings: ALL_ON, expectedId: null })).toEqual({ settings: ALL_ON, expectedId: null });
    expect(parseGmVisibilitySave({ settings: ALL_ON, expectedId: ID })).toEqual({ settings: ALL_ON, expectedId: ID.toLowerCase() });
    for (const bad of [null, [], { settings: ALL_ON }, { settings: ALL_ON, expectedId: "x" }, { settings: ALL_ON, expectedId: null, note: "" },
      { settings: { ...ALL_ON, hourly_cost: false }, expectedId: null }, { settings: null, expectedId: null }, { settings: ALL_ON, expectedId: 1 }]) {
      expect(parseGmVisibilitySave(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("businessAccessFor(role, settings)", () => {
  it("MoO / Owner / CGS: everything, whatever the settings say (they never apply)", () => {
    for (const role of FULL) for (const s of [null, ALL_OFF, GM_VISIBILITY_DEFAULTS, "junk"]) {
      const a = businessAccessFor(role, s);
      expect(Object.values(a).every((v) => v === true), `${role} ${JSON.stringify(s)}`).toBe(true);
    }
  });
  it("every other role but the GM: nothing at all", () => {
    for (const role of OTHERS) expect(Object.values(businessAccessFor(role, ALL_ON)).some(Boolean), role).toBe(false);
  });
  it("GM: no row yet = the defaults", () => {
    expect(businessAccessFor("gm", null)).toEqual({ report: true, hourlyCost: true, loaded: false, quarters: true, channels: true, people: true, servers: true,
      compare: true, export: true, personCost: true, quarterCost: true, personSalary: false });
  });
  it("GM: the settings, key by key", () => {
    for (const s of gmVisibilityCombinations()) {
      const a = businessAccessFor("gm", s);
      expect([a.report, a.hourlyCost, a.loaded, a.quarters, a.channels, a.people, a.servers, a.compare, a.export, a.personCost, a.quarterCost, a.personSalary], JSON.stringify(s))
        .toEqual([s.report, s.hourly_cost, s.loaded, s.quarters, s.channels, s.people, s.servers, s.compare, s.export, s.person_cost, s.quarter_cost, s.person_salary]);
    }
  });
  it("GM: cost per person, dollars per 15 minutes and a salary per person are never on without everything they need (a row the validator would refuse included)", () => {
    const acc = (s: Partial<GmVisibility>) => businessAccessFor("gm", { ...ALL_ON, ...s });
    expect(acc({ people: false }).personCost).toBe(false);
    expect(acc({ hourly_cost: false }).personCost).toBe(false);
    expect(acc({ quarters: false }).quarterCost).toBe(false);
    expect(acc({ hourly_cost: false }).quarterCost).toBe(false);
    expect(acc({ people: false }).personSalary).toBe(false);
    expect(acc({ loaded: false }).personSalary).toBe(false);
    expect(acc({ hourly_cost: false }).personSalary).toBe(false); // through fully loaded
    // camelCase is the access, not a setting: it opens nothing.
    const forged = businessAccessFor("gm", { ...ALL_OFF, report: true, personCost: true, quarterCost: true, personSalary: true });
    expect([forged.personCost, forged.quarterCost, forged.personSalary]).toEqual([false, false, false]);
  });
  it("GM: fails closed on a row the validator would refuse (a missing or non-boolean key is off; a child under an off parent is off)", () => {
    const { people: _drop, ...missing } = ALL_ON;
    expect(businessAccessFor("gm", missing).people).toBe(false);
    expect(businessAccessFor("gm", { ...ALL_ON, channels: "true" }).channels).toBe(false);
    const incoherent = businessAccessFor("gm", { ...ALL_ON, hourly_cost: false });
    expect([incoherent.hourlyCost, incoherent.loaded]).toEqual([false, false]);
    const off = businessAccessFor("gm", { ...ALL_ON, report: false });
    expect(Object.values(off).some(Boolean)).toBe(false);
    for (const junk of [undefined, 1, "x", [], true]) expect(Object.values(businessAccessFor("gm", junk)).some(Boolean), String(junk)).toBe(false);
  });
});

describe("shops, tabs and the people who may change the settings", () => {
  const A = "aaaaaaaa-0000-4000-8000-00000000000a", B = "bbbbbbbb-0000-4000-8000-00000000000b";
  it("a GM reads only the shops they belong to; MoO / Owner / CGS any shop; 'all' is never a shop; nobody else any", () => {
    expect(businessShopAllowed({ role: "gm", locations: [A] }, A)).toBe(true);
    expect(businessShopAllowed({ role: "gm", locations: [A] }, B)).toBe(false);
    expect(businessShopAllowed({ role: "gm" }, A)).toBe(false);
    for (const role of FULL) {
      expect(businessShopAllowed({ role, locations: [] }, B)).toBe(true);
      expect(businessShopAllowed({ role, locations: [] }, "all")).toBe(false);
    }
    expect(businessShopAllowed({ role: "gm", locations: ["all"] }, "all")).toBe(false);
    for (const role of OTHERS) expect(businessShopAllowed({ role, locations: [A] }, A), role).toBe(false);
  });
  it("All shops is MoO / Owner / CGS by ROLE", () => {
    for (const role of FULL) expect(businessAllShopsAllowed(role)).toBe(true);
    for (const role of ["gm", ...OTHERS] as RoleCode[]) expect(businessAllShopsAllowed(role), role).toBe(false);
  });
  it("tabs: Overview always; Hours, Channels, Compare by their switch; People when people or servers is on", () => {
    const acc = (s: Partial<GmVisibility>) => businessAccessFor("gm", { ...ALL_OFF, report: true, ...s });
    expect(businessTabsFor(acc({}))).toEqual(["overview"]);
    expect(businessTabsFor(acc({ quarters: true }))).toEqual(["overview", "hours"]);
    expect(businessTabsFor(acc({ channels: true, compare: true }))).toEqual(["overview", "channels", "compare"]);
    expect(businessTabsFor(acc({ servers: true }))).toEqual(["overview", "people"]);
    expect(businessTabsFor(acc({ people: true }))).toEqual(["overview", "people"]);
    expect(businessTabsFor(businessAccessFor("moo", null))).toEqual(["overview", "hours", "channels", "people", "compare"]);
    expect(businessTabAllowed(acc({}), "hours")).toBe(false);
    expect(businessTabAllowed(acc({}), "overview")).toBe(true);
    expect(businessTabsFor(businessAccessFor("gm", ALL_OFF))).toEqual([]); // report off: no tab at all
  });
  it("sameBusinessAccess compares every key", () => {
    const a = businessAccessFor("gm", null);
    expect(sameBusinessAccess(a, { ...a })).toBe(true);
    expect(sameBusinessAccess(a, { ...a, export: false })).toBe(false);
    expect(sameBusinessAccess(a, businessAccessFor("moo", null))).toBe(false);
  });
  it("the settings are MoO / Owner / CGS by trusted role", () => {
    expect(BUSINESS_VISIBILITY_ROLES).toEqual(["owner", "cgs", "moo"]);
    for (const role of FULL) expect(canManageBusinessVisibility(role)).toBe(true);
    for (const role of ["gm", ...OTHERS] as RoleCode[]) expect(canManageBusinessVisibility(role), role).toBe(false);
    expect(BUSINESS_VISIBILITY_ERROR_CODES).toEqual(["forbidden", "invalid", "moved", "unchanged", "unavailable", "generic"]);
  });
});

describe("the group table: every DTO leaf path is in the base or in exactly one group", () => {
  it("no path appears twice, and every group path sits under one of its group's roots", () => {
    const seen = new Map<string, string>();
    for (const [name, g] of Object.entries(BUSINESS_ACCESS_GROUPS)) {
      for (const p of g.paths) {
        expect(seen.has(p), `${p} in ${name} and ${seen.get(p)}`).toBe(false);
        seen.set(p, name);
        if (name !== "base") expect(g.roots.some((r) => p === r || p.startsWith(`${r}.`) || p.startsWith(`${r}[]`)), `${name}: ${p}`).toBe(true);
      }
    }
  });
  it("the money groups hold exactly the keys the plan names", () => {
    const leaf = (g: keyof typeof BUSINESS_ACCESS_GROUPS) => [...new Set(BUSINESS_ACCESS_GROUPS[g].paths.map((p) => p.slice(p.lastIndexOf(".") + 1)))].sort();
    expect(leaf("hourlyCost")).toEqual(["otPremiumCents", "pct", "pureHourlyCents", "tone", "wageEstimated"]);
    expect(leaf("loaded")).toEqual(["burdenCents", "burdenEstimated", "fullyLoadedCents", "loadedPct", "loadedState", "loadedTone", "salariedCents", "salaryEstimated", "salaryGaps"]);
    expect(BUSINESS_ACCESS_GROUPS.personCost.paths).toEqual(["people[].straightCostCents"]);
    expect(BUSINESS_ACCESS_GROUPS.quarterCost.paths).toEqual(["quarters[].straightCents", "quarters[].pct"]);
  });
});

describe("a salaried person's row carries no amount without `personSalary` (the redactor, whatever the loader sent)", () => {
  // The loader prices hourly people only. These rows are what a LATER read could send: a salaried row that is priced.
  const report = () => ({ quarters: [], quartersUnassigned: [], quartersReason: null, people: [
    { personKey: "u:1", label: "Ana", source: "7shifts", payClass: "hourly", minutes: 600, otMinutes: 0, weeksSuppressed: 0, straightCostCents: 18_000 },
    { personKey: "u:2", label: "Pat", source: "7shifts", payClass: "salaried", minutes: 2_400, otMinutes: 0, weeksSuppressed: 0, straightCostCents: 250_000, salaryCents: 250_000,
      weeklyPay: "2500.00" },
    { personKey: "u:3", label: "Sam", source: "toast", payClass: "exempt", minutes: 60, otMinutes: 0, weeksSuppressed: 0, straightCostCents: 99_000 },
  ] });
  const amounts = (dto: ReturnType<typeof report>) => dto.people.map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !PERSON_NON_MONEY_KEYS.includes(k))));
  it("a GM with everything on EXCEPT the salary per person: the hourly cost stays, every amount on a non-hourly row is null", () => {
    const access = businessAccessFor("gm", { ...ALL_ON, person_salary: false });
    expect([access.personCost, access.loaded, access.personSalary]).toEqual([true, true, false]);
    const dto = redactBusinessDto(report(), access);
    expect(amounts(dto)).toEqual([{ straightCostCents: 18_000 }, { straightCostCents: null, salaryCents: null, weeklyPay: null }, { straightCostCents: null }]);
    expect(JSON.stringify(dto)).not.toMatch(/250000|250_000|2500\.00|99000/);
    // ... and what is not money is untouched.
    expect(dto.people.map((p) => [p.label, p.payClass, p.minutes])).toEqual([["Ana", "hourly", 600], ["Pat", "salaried", 2_400], ["Sam", "exempt", 60]]);
  });
  it("the GM defaults (salary per person off): the same", () => {
    const dto = redactBusinessDto(report(), businessAccessFor("gm", null));
    expect(amounts(dto)[1]).toEqual({ straightCostCents: null, salaryCents: null, weeklyPay: null });
  });
  it("under EVERY coherent setting without the salary per person, no amount of a non-hourly row survives", () => {
    for (const s of gmVisibilityCombinations().filter((x) => x.report && !x.person_salary)) {
      const dto = redactBusinessDto(report(), businessAccessFor("gm", s)) as unknown as { people?: Array<Record<string, unknown>> };
      for (const p of dto.people ?? []) if (p.payClass !== "hourly") for (const [k, v] of Object.entries(p)) if (!PERSON_NON_MONEY_KEYS.includes(k)) expect(v, `${k} under ${JSON.stringify(s)}`).toBeNull();
    }
  });
  it("with the salary per person on (a GM by the setting, MoO / Owner / CGS always) the row is left as the loader sent it", () => {
    for (const access of [businessAccessFor("gm", ALL_ON), businessAccessFor("moo", null), businessAccessFor("owner", null), businessAccessFor("cgs", null)]) {
      expect(access.personSalary).toBe(true);
      expect(amounts(redactBusinessDto(report(), access))[1]).toEqual({ straightCostCents: 250_000, salaryCents: 250_000, weeklyPay: "2500.00" });
    }
  });
  it("the non-money keys are exactly the people group's paths (a new key on a people row is money until it is listed)", () => {
    expect(BUSINESS_ACCESS_GROUPS.people.paths.map((p) => p.replace("people[].", "")).sort()).toEqual([...PERSON_NON_MONEY_KEYS].sort());
  });
});
