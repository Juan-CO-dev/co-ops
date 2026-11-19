// Business report access (plan r5, test 2): THE allowlist over the actual serialized payload.
//
// The REAL loader runs over one mathematically consistent report (tests/helpers/business-access-fixture.ts) for a GM
// under EVERY coherent setting with the report on (192), and for MoO / Owner / CGS. For each:
//   (the 193rd, the report off for GMs, is a refusal: tests/business-report-loader.test.ts)
//   (a) every leaf path of JSON.parse(JSON.stringify(dto)) is in the hand-written list (base + the groups that are
//       on): an unknown path fails BY NAME;
//   (b) every path of a group that is off is absent;
//   (c) every group that is on is PRESENT with the fixture's values: the GM's payload EQUALS the whole report with
//       exactly the off groups taken out (a switch that did nothing, or cut too much, fails here);
//   (d) no amount of a group that is off occurs anywhere in the payload, as a number or inside a string;
//   (e) MoO / Owner / CGS: the payload of the loader BEFORE this change (a golden written by origin/main's loader),
//       unchanged; and they never read the settings;
//   (f) a GM never holds cost per person or labor dollars per 15 minutes, under any setting.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no database in unit tests"); }) }));

import golden from "./fixtures/business/moo-payload-golden.json";
import { BASE, GROUPS, LIST_KEYS } from "./fixtures/business/gm-payload-paths";
import { BUSINESS_ACCESS_GROUPS, businessAccessFor, businessDtoPaths, gmVisibilityCombinations, type GmVisibility } from "@/lib/business-access-shared";
import { loadBusinessReport } from "@/lib/business-report";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { A, GM_ALL_ON, VISIBILITY_TABLE } from "./helpers/business-report-fake";
import { DAY, ON, RANGE, TODAY, cgs, figuresOf, gm, json, leaves, moo, owner, pricedFake } from "./helpers/business-access-fixture";

type Json = Record<string, unknown>;
const pathsOf = (v: unknown) => [...new Set(leaves(v).map((l) => l.path))];
const loadGm = async (s: GmVisibility | null) => json(await loadBusinessReport(gm, { locationId: A, range: RANGE }, { client: pricedFake({ visibility: [s] }).client, env: ON })) as unknown as Json;
const loadWhole = async (viewer: typeof moo | typeof owner | typeof cgs = moo) => {
  const f = pricedFake({ visibility: ["throw"] });
  return { dto: json(await loadBusinessReport(viewer, { locationId: A, range: RANGE }, { client: f.client, env: ON })) as unknown as Json, fake: f };
};
/** The groups (hand-written names) a GM holds under `s`. */
const heldBy = (s: GmVisibility) => Object.entries(GROUPS).filter(([, g]) => g.switch !== null && (s as unknown as Record<string, boolean>)[g.switch]).map(([name]) => name);
/** The whole report with every path outside `allowed` taken out, BY HAND (no lib code): what a GM must receive. */
function cutByHand(whole: Json, held: readonly string[], access: unknown): Json {
  const allowed = new Set([...BASE, ...held.flatMap((g) => GROUPS[g]!.paths)]);
  const prune = (v: unknown, prefix: string): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => prune(x, `${prefix}[]`));
    const out: Json = {};
    for (const [k, x] of Object.entries(v)) {
      const p = prefix ? `${prefix}.${k}` : k;
      const keep = x !== null && typeof x === "object" ? [...allowed].some((a) => a === p || a.startsWith(`${p}.`) || a.startsWith(`${p}[]`)) : allowed.has(p);
      if (keep) out[k] = prune(x, p);
    }
    return out;
  };
  const out = prune(whole, "") as Json;
  for (const [group, keys] of Object.entries(LIST_KEYS)) {
    if (held.includes(group)) continue;
    if (group === "quarters") { out.quarters = null; out.quartersUnassigned = null; out.quartersReason = "not_shared"; } else for (const k of keys) delete out[k];
  }
  out.access = access;
  return out;
}
/** `n` as a JSON number token, or anywhere inside a string. */
const occurs = (text: string, n: number) => new RegExp(`(?<![\\d.])${String(n).replace(".", "\\.")}(?![\\d.])`).test(text);

describe("the hand-written list and the group table agree (the list is not a copy: it is checked against it)", () => {
  it("the base and every group hold the same paths", () => {
    expect([...BUSINESS_ACCESS_GROUPS.base.paths].sort()).toEqual([...BASE].sort());
    for (const [name, g] of Object.entries(GROUPS)) expect([...BUSINESS_ACCESS_GROUPS[name as keyof typeof BUSINESS_ACCESS_GROUPS].paths].sort(), name).toEqual([...g.paths].sort());
    expect(Object.keys(BUSINESS_ACCESS_GROUPS).sort()).toEqual(["base", ...Object.keys(GROUPS)].sort());
  });
  it("partition: every path of the whole report is in the base or in exactly one group", async () => {
    const { dto } = await loadWhole();
    const all = [...BASE, ...Object.values(GROUPS).flatMap((g) => g.paths)];
    expect(all.length).toBe(new Set(all).size);
    expect(pathsOf(dto).filter((p) => !all.includes(p))).toEqual([]);
    // ... and the fixture exercises every group (a group with no path in the report would prove nothing).
    for (const [name, g] of Object.entries(GROUPS)) expect(pathsOf(dto).some((p) => g.paths.includes(p)), name).toBe(true);
  });
});

describe("MoO / Owner / CGS: everything, unchanged, and no settings read", () => {
  it("the payload is the one origin/main's loader returned (golden), plus the access it now carries", async () => {
    for (const viewer of [moo, owner, cgs]) {
      const { dto, fake } = await loadWhole(viewer);
      const { access, ...rest } = dto;
      expect(rest, viewer.role).toEqual(golden.oneDay);
      expect(Object.values(access as object).every((v) => v === true), viewer.role).toBe(true);
      expect(fake.visibilityReads(), viewer.role).toBe(0);
      expect(fake.tables, viewer.role).not.toContain(VISIBILITY_TABLE);
      expect(pathsOf(dto).sort()).toEqual([...new Set(businessDtoPaths(businessAccessFor(viewer.role, null)).filter((p) => pathsOf(dto).includes(p)))].sort());
    }
  });
  it("a longer range with a second priced day and days with no sales: the same golden", async () => {
    const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, TODAY);
    const dto = json(await loadBusinessReport(moo, { locationId: A, range }, { client: pricedFake({}, { [DAY]: 1, "2026-10-02": 2 }).client, env: ON })) as unknown as Json;
    const { access: _a, ...rest } = dto;
    expect(rest).toEqual(golden.week);
  });
  it("the fixture is the model's F1: the labor figures are the stated ones", async () => {
    const { dto } = await loadWhole();
    const f = figuresOf();
    expect((dto.total as Json).labor).toMatchObject({ state: "ok", pureHourlyCents: f.hourly, otPremiumCents: f.premium, salariedCents: f.salaried, burdenCents: f.burden,
      fullyLoadedCents: f.loaded, pct: 18.6, loadedPct: 32, denominator: { cents: f.net, state: "ok" } });
    expect([f.hourly, f.premium, f.salaried, f.burden, f.loaded]).toEqual([186_000, 6_000, 100_000, 34_320, 320_320]);
    expect(f.people.reduce((a, b) => a + b, 0)).toBe(f.straight);
    expect(f.quarters.reduce((a, b) => a + b, 0)).toBe(f.straight);
  });
});

describe("a GM, under every coherent setting", () => {
  it("192 settings (every coherent one with the report on): only allowed paths (a), off groups absent (b), on groups present with their values (c), no hidden amount (d), never person / 15-minute cost (f)", async () => {
    const { dto: whole } = await loadWhole();
    const wholeLeaves = leaves(whole);
    const combos = gmVisibilityCombinations().filter((s) => s.report);
    expect(combos).toHaveLength(192);
    for (const s of combos) {
      const label = JSON.stringify(s);
      const dto = await loadGm(s);
      const held = heldBy(s);
      const allowed = new Set([...BASE, ...held.flatMap((g) => GROUPS[g]!.paths)]);
      const got = pathsOf(dto);
      // (a)
      expect(got.filter((p) => !allowed.has(p)), `unknown paths under ${label}`).toEqual([]);
      // (b)
      for (const [name, g] of Object.entries(GROUPS)) if (!held.includes(name)) expect(got.filter((p) => g.paths.includes(p)), `${name} must be absent under ${label}`).toEqual([]);
      for (const [group, keys] of Object.entries(LIST_KEYS)) if (!held.includes(group)) for (const k of keys) {
        if (group === "quarters") expect(dto[k], `${k} under ${label}`).toBeNull(); else expect(dto, `${k} under ${label}`).not.toHaveProperty(k);
      }
      // (c) the GM's payload IS the whole report minus exactly the off groups
      expect(dto, label).toEqual(cutByHand(whole, held, businessAccessFor("gm", s)));
      for (const name of held) for (const p of GROUPS[name]!.paths.filter((x) => wholeLeaves.some((l) => l.path === x))) expect(got, `${p} must be present under ${label}`).toContain(p);
      // (d) an amount only an off group holds is nowhere in the payload
      const text = JSON.stringify(dto);
      const visible = new Set(leaves(dto).filter((l) => typeof l.value === "number").map((l) => l.value as number));
      for (const [name, g] of Object.entries(GROUPS)) {
        if (held.includes(name)) continue;
        const secret = [...new Set(wholeLeaves.filter((l) => g.paths.includes(l.path) && typeof l.value === "number" && !visible.has(l.value as number)).map((l) => l.value as number))];
        for (const n of secret) expect(occurs(text, n), `${n} of ${name} in the payload under ${label}`).toBe(false);
      }
      // (f)
      expect((dto.access as Json).personCost).toBe(false);
      expect((dto.access as Json).quarterCost).toBe(false);
      expect(text).not.toMatch(/straightCostCents|straightCents|straight_cents|rate/i);
    }
  }, 120_000);
  it("the value scan has teeth: every money group's amounts are distinct from everything a GM keeps", async () => {
    const { dto: whole } = await loadWhole();
    const dto = await loadGm({ ...GM_ALL_ON, hourly_cost: false, loaded: false, quarters: false, channels: false, people: false, servers: false });
    const visible = new Set(leaves(dto).filter((l) => typeof l.value === "number").map((l) => l.value));
    const f = figuresOf();
    for (const n of [f.hourly, f.premium, 18.6, f.salaried, f.burden, f.loaded, ...f.people, ...f.quarters, 23.3]) {
      expect(visible.has(n), String(n)).toBe(false);
      expect(occurs(JSON.stringify(whole), n), String(n)).toBe(true);
      expect(occurs(JSON.stringify(dto), n), String(n)).toBe(false);
    }
  });
  it("no settings row yet: the defaults (everything but fully loaded labor)", async () => {
    const { dto: whole } = await loadWhole();
    const dto = await loadGm(null);
    expect(dto).toEqual(cutByHand(whole, ["hourlyCost", "quarters", "channels", "people", "servers"], businessAccessFor("gm", null)));
    const text = JSON.stringify(dto);
    const f = figuresOf();
    for (const n of [f.salaried, f.burden, f.loaded]) expect(occurs(text, n), String(n)).toBe(false);
    for (const n of [f.hourly, f.premium, 18.6]) expect(occurs(text, n), String(n)).toBe(true);
  });
  it("hours and sales only (hourly cost off): no labor dollar or % of any kind, at any grain", async () => {
    const dto = await loadGm({ ...GM_ALL_ON, hourly_cost: false, loaded: false });
    for (const scope of [(dto.total as Json).labor, ((dto.days as Json[])[0] as Json).labor, ((dto.weeks as Json[])[0] as Json).labor]) {
      expect(Object.keys(scope as object).sort()).toEqual(["denominator", "hoursUnverified", "minutes", "otMinutes", "state"]);
    }
    expect((dto.total as Json).labor).toMatchObject({ minutes: 7_500, otMinutes: 300, denominator: { cents: 1_000_000 } });
    expect((dto.people as Json[]).map((p) => Object.keys(p).sort().join())).toEqual(Array(3).fill("label,minutes,otMinutes,payClass,personKey,source,weeksSuppressed"));
  });
  it("a forged row cannot open cost per person or labor dollars per 15 minutes: it is not the exact nine, so the report is unavailable", async () => {
    for (const raw of [{ ...GM_ALL_ON, person_cost: true }, { ...GM_ALL_ON, quarter_cost: true }, { ...GM_ALL_ON, personCost: true, quarterCost: true }]) {
      await expect(loadBusinessReport(gm, { locationId: A, range: RANGE }, { client: pricedFake({ visibility: [{ raw }] }).client, env: ON }))
        .rejects.toMatchObject({ status: 503, code: "business_access_unavailable" });
    }
  });
});
