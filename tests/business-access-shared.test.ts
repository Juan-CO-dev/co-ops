// Business report access (item 9, plan r5): the pure rules. What a GM may see is nine switches a MoO+ saves; cost
// per person and labor dollars per 15 minutes are NOT switches (the two labor constants decide, MoO+).
import { describe, expect, it } from "vitest";
import { ROLES, type RoleCode } from "@/lib/roles";
import {
  BUSINESS_ACCESS_GROUPS, BUSINESS_VISIBILITY_ERROR_CODES, BUSINESS_VISIBILITY_ROLES, GM_VISIBILITY_DEFAULTS, GM_VISIBILITY_KEYS, GM_VISIBILITY_NEEDS,
  businessAccessFor, businessAllShopsAllowed, businessShopAllowed, businessTabAllowed, businessTabsFor, canManageBusinessVisibility, coherentGmVisibility,
  gmVisibilityCombinations, parseGmVisibility, parseGmVisibilitySave, sameBusinessAccess, type GmVisibility,
} from "@/lib/business-access-shared";

const ALL_ON = Object.fromEntries(GM_VISIBILITY_KEYS.map((k) => [k, true])) as GmVisibility;
const ALL_OFF = Object.fromEntries(GM_VISIBILITY_KEYS.map((k) => [k, false])) as GmVisibility;
const FULL: RoleCode[] = ["moo", "owner", "cgs"];
const OTHERS = (Object.keys(ROLES) as RoleCode[]).filter((r) => r !== "gm" && !FULL.includes(r));

describe("the nine switches and their defaults (plan r5 section 2: for Juan)", () => {
  it("exactly these keys, in this order", () => {
    expect(GM_VISIBILITY_KEYS).toEqual(["report", "hourly_cost", "loaded", "quarters", "channels", "people", "servers", "compare", "export"]);
  });
  it("defaults: everything a GM has today except fully loaded labor (salaries, burden)", () => {
    expect(GM_VISIBILITY_DEFAULTS).toEqual({ report: true, hourly_cost: true, loaded: false, quarters: true, channels: true, people: true, servers: true,
      compare: true, export: true });
  });
  it("needs: hourly cost and every tab need the report; fully loaded needs hourly cost", () => {
    expect(GM_VISIBILITY_NEEDS).toEqual({ report: [], hourly_cost: ["report"], loaded: ["hourly_cost"], quarters: ["report"], channels: ["report"],
      people: ["report"], servers: ["report"], compare: ["report"], export: ["report"] });
  });
  it("there is no switch for cost per person, labor dollars per 15 minutes or the overtime premium", () => {
    for (const k of ["person_cost", "quarter_cost", "ot_premium"]) expect(GM_VISIBILITY_KEYS as readonly string[]).not.toContain(k);
  });
  it("coherent = no child on under a parent that is off; the defaults are coherent", () => {
    expect(coherentGmVisibility(GM_VISIBILITY_DEFAULTS)).toBe(true);
    expect(coherentGmVisibility(ALL_ON)).toBe(true);
    expect(coherentGmVisibility(ALL_OFF)).toBe(true);
    expect(coherentGmVisibility({ ...ALL_ON, hourly_cost: false })).toBe(false); // loaded on under hourly off
    expect(coherentGmVisibility({ ...ALL_OFF, export: true })).toBe(false);
  });
  it("every coherent combination is enumerated from the needs graph: 1 (report off) + 2^6 tabs x 3 labor states", () => {
    const all = gmVisibilityCombinations();
    expect(all).toHaveLength(1 + 64 * 3);
    expect(all.every(coherentGmVisibility)).toBe(true);
    expect(new Set(all.map((c) => JSON.stringify(c))).size).toBe(all.length);
  });
});

describe("parseGmVisibility: the stored row's reader and the route's settings", () => {
  it("accepts exactly the nine booleans, coherent", () => {
    expect(parseGmVisibility(GM_VISIBILITY_DEFAULTS)).toEqual(GM_VISIBILITY_DEFAULTS);
    expect(parseGmVisibility(ALL_OFF)).toEqual(ALL_OFF);
  });
  it("anything else is null", () => {
    const { export: _drop, ...missing } = ALL_ON;
    for (const bad of [null, undefined, 1, "x", [], [ALL_ON], missing, { ...ALL_ON, extra: true }, { ...ALL_ON, person_cost: false }, { ...ALL_ON, report: 1 },
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
      compare: true, export: true, personCost: false, quarterCost: false });
  });
  it("GM: the settings, key by key", () => {
    for (const s of gmVisibilityCombinations()) {
      const a = businessAccessFor("gm", s);
      expect([a.report, a.hourlyCost, a.loaded, a.quarters, a.channels, a.people, a.servers, a.compare, a.export], JSON.stringify(s))
        .toEqual([s.report, s.hourly_cost, s.loaded, s.quarters, s.channels, s.people, s.servers, s.compare, s.export]);
    }
  });
  it("GM: cost per person and labor dollars per 15 minutes are false under EVERY combination, and a forged key cannot open them", () => {
    for (const s of gmVisibilityCombinations()) {
      const a = businessAccessFor("gm", s);
      expect([a.personCost, a.quarterCost]).toEqual([false, false]);
    }
    const forged = businessAccessFor("gm", { ...ALL_ON, person_cost: true, quarter_cost: true, personCost: true, quarterCost: true });
    expect([forged.personCost, forged.quarterCost]).toEqual([false, false]);
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
