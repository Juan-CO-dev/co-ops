import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES } from "../lib/roles";
import { SIM_PERSONAS, SIM_LOCATIONS, personaByEmail, personaFor, expectedMemberships, assertPersonaRow } from "../scripts/sim/personas-shared";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), loadSimEnv: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("../scripts/sim/launch-readiness/env.ts", () => ({ loadSimEnv: mocks.loadSimEnv }));

const rosa = personaByEmail("rosa@sim.co-ops");
const rowFor = (p = rosa) => ({ ...p, id: `fixture-${p.email}`, active: true });
const membershipsFor = (p = rosa) => p.locations.map(code => ({ location_id: SIM_LOCATIONS[code].id, active: true }));
const selector = { locationCode: "EM", role: "key_holder", name: "Rosa Delgado" } as const;

beforeEach(() => {
  vi.resetModules();
  mocks.createClient.mockReset();
  mocks.loadSimEnv.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network attempt"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("authoritative roster", () => {
  it("pins all nine baseline identities and ten memberships", () => {
    expect(SIM_PERSONAS.map(p => [p.email, p.name, p.role, p.language, p.locations])).toEqual([
      ["maya@sim.co-ops", "Maya Torres", "employee", "en", ["EM"]],
      ["deshawn@sim.co-ops", "Deshawn Carter", "employee", "en", ["EM"]],
      ["luis@sim.co-ops", "Luis Herrera", "employee", "es", ["MEP"]],
      ["rosa@sim.co-ops", "Rosa Delgado", "key_holder", "es", ["EM"]],
      ["angel@sim.co-ops", "Angel Reyes", "key_holder", "en", ["MEP"]],
      ["tommy@sim.co-ops", "Tommy Nguyen", "shift_lead", "en", ["EM"]],
      ["priya@sim.co-ops", "Priya Shah", "agm", "en", ["EM"]],
      ["nicole@sim.co-ops", "Nicole Boyd", "agm", "en", ["MEP"]],
      ["marcus@sim.co-ops", "Marcus Webb", "gm", "en", ["EM", "MEP"]],
    ]);
    expect(new Set(SIM_PERSONAS.map(p => p.email)).size).toBe(9);
    expect(expectedMemberships()).toHaveLength(10);
    expect(new Set(expectedMemberships().map(m => `${m.email}/${m.location_id}`)).size).toBe(10);
    for (const p of SIM_PERSONAS) expect(p.level).toBe(ROLES[p.role].level);
  });
  it("rejects missing, duplicate, wrong-role and wrong-location identities", () => {
    expect(personaFor(selector)).toBe(rosa);
    expect(() => personaFor({ ...selector, name: "Rosa" })).toThrow();
    expect(() => personaFor(selector, [rosa, rosa])).toThrow();
    expect(() => personaFor({ ...selector, role: "gm" })).toThrow();
    expect(() => personaFor({ ...selector, locationCode: "MEP" })).toThrow();
    expect(() => personaByEmail("ROSA@sim.co-ops")).toThrow();
    expect(() => personaByEmail(rosa.email, [rosa, rosa])).toThrow();
  });
  it("reversed prose cannot move Angel or Rosa; Marcus covers both shops", () => {
    expect(expectedMemberships().filter(m => m.email === "angel@sim.co-ops").map(m => m.location_id)).toEqual(["54ce1029-400e-4a92-9c2b-0ccb3b031f0a"]);
    expect(expectedMemberships().filter(m => m.email === rosa.email).map(m => m.location_id)).toEqual(["d2cced11-b167-49fa-bab6-86ec9bf4ff09"]);
    for (const locationCode of ["EM", "MEP"] as const) expect(personaFor({ locationCode, role: "gm", name: "Marcus Webb" }).email).toBe("marcus@sim.co-ops");
    expect(personaFor({ locationCode: "MEP", role: "key_holder", name: "Angel Reyes" }).locations).toEqual(["MEP"]);
  });
  it.each(["email", "name", "role", "language", "active", "id"] as const)("refuses stale %s", field => {
    expect(() => assertPersonaRow(rosa, { ...rowFor(), [field]: field === "active" ? false : "" }, membershipsFor())).toThrow(field);
  });
  it("requires the exact active membership multiset", () => {
    expect(() => assertPersonaRow(rosa, rowFor(), membershipsFor())).not.toThrow();
    for (const memberships of [[], [{ location_id: SIM_LOCATIONS.EM.id, active: false }], [...membershipsFor(), ...membershipsFor()], [...membershipsFor(), { location_id: SIM_LOCATIONS.MEP.id, active: true }]]) {
      expect(() => assertPersonaRow(rosa, rowFor(), memberships)).toThrow("user_locations");
    }
  });
  it("imports roster, seed, driver and skeleton without I/O or main", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    await import("../scripts/sim/personas-shared");
    await import("../scripts/sim/seed-staff");
    await import("../scripts/sim/concurrency/driver.mjs");
    await import("../scripts/sim/launch-readiness/contracts/personas.spec");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.loadSimEnv).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });
});

// In-memory query double: no database client or transport is constructed.
function oracleDouble() {
  return { from(table: string) {
    let value = "";
    const query = {
      select: () => query,
      eq: (_field: string, input: string) => { value = input; return query; },
      ilike: (_field: string, input: string) => { value = input; return query; },
      single: async () => ({ error: null, data: table === "locations" ? Object.values(SIM_LOCATIONS).find(loc => loc.id === value) : rowFor(personaByEmail(value)) }),
      then: (resolve: (value: unknown) => unknown) => resolve({ error: null, data: membershipsFor(personaByEmail(value.replace("fixture-", ""))) }),
    };
    return query;
  } };
}
async function initializedDriver() {
  mocks.loadSimEnv.mockReturnValue({ ok: true, env: { NEXT_PUBLIC_SUPABASE_URL: "https://jepgzucrvklhqpthowsc.supabase.co" }, target: { dbOrigin: "https://jepgzucrvklhqpthowsc.supabase.co" } });
  mocks.createClient.mockReturnValue(oracleDouble());
  const driver = await import("../scripts/sim/concurrency/driver.mjs");
  await driver.init({ assertLease() {}, async verifyServer() {} });
  return driver;
}
describe("strict driver", () => {
  it("groups completion heads by phase kind and requires every intended id", async () => {
    const { completionHeadKey, allIntendedItemsLanded } = await import("../scripts/sim/concurrency/fullday.mjs");
    const row = { instance_id: "instance", template_item_id: "item", prep_data: null };
    expect(completionHeadKey(row)).toBe(completionHeadKey({ ...row, prep_data: { phase1: {} } }));
    expect(completionHeadKey(row)).not.toBe(completionHeadKey({ ...row, prep_data: { phase2: false } }));
    expect(completionHeadKey({ ...row, prep_data: { phase2: null } })).toBe(completionHeadKey({ ...row, prep_data: { phase2: {} } }));
    const intended = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    expect(allIntendedItemsLanded(intended, intended)).toBe(true);
    expect(allIntendedItemsLanded(intended, [...intended.slice(1), "unrelated"])).toBe(false);
    expect(allIntendedItemsLanded([], [])).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("blocks oracle writes and RPCs before transport", async () => {
    const d = await initializedDriver();
    const options = mocks.createClient.mock.calls[0]?.[2] as { global: { fetch: typeof fetch } };
    for (const method of ["POST", "PATCH", "DELETE"]) {
      await expect(options.global.fetch("https://jepgzucrvklhqpthowsc.supabase.co/rest/v1/users", { method })).rejects.toThrow("read-only");
    }
    await expect(options.global.fetch("https://jepgzucrvklhqpthowsc.supabase.co/rest/v1/rpc/mutate")).rejects.toThrow("target refused");
    expect(fetch).not.toHaveBeenCalled();
    expect(d.db.from("users")).not.toHaveProperty("insert");
  });
  it("requires init and a named persona before any network", async () => {
    const d = await import("../scripts/sim/concurrency/driver.mjs");
    await expect(d.init()).rejects.toThrow("F4 runner required");
    await expect(d.findUser(SIM_LOCATIONS.EM.id, "key_holder", undefined)).rejects.toThrow("name required");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [500, { users: [] }, "status 500"],
    [200, null, "malformed"],
    [200, { users: [null] }, "malformed"],
    [200, { users: {} }, "malformed"],
    [200, { users: [] }, "exactly one"],
    [200, { users: [{ ...rowFor(), role: "gm" }] }, "exactly one"],
    [200, { users: [rowFor(), rowFor()] }, "exactly one"],
    [200, { users: [{ ...rowFor(), id: "foreign-id" }] }, "id mismatch"],
  ])("refuses login-options case %#", async (status, payload, error) => {
    const d = await initializedDriver();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(payload), { status: status as number }));
    await expect(d.findUser(SIM_LOCATIONS.EM.id, rosa.role, rosa.name)).rejects.toThrow(error as string);
  });
  it("selects only the readback identity and rejects session role/id/location drift", async () => {
    const d = await initializedDriver();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ users: [rowFor()] })));
    await expect(d.findUser(SIM_LOCATIONS.EM.id, rosa.role, rosa.name)).resolves.toEqual(rowFor());
    const session = { user: rowFor(), locationId: SIM_LOCATIONS.EM.id, claims: { user_id: rowFor().id, app_role: rosa.role, role_level: rosa.level, locations: [SIM_LOCATIONS.EM.id] } };
    expect(() => d.assertPersona(session, rosa)).not.toThrow();
    expect(() => d.assertPersona({ ...session, user: { ...session.user, id: "other" } }, rosa)).toThrow();
    expect(() => d.assertPersona({ ...session, claims: { ...session.claims, app_role: "gm" } }, rosa)).toThrow();
    expect(() => d.assertPersona({ ...session, locationId: SIM_LOCATIONS.MEP.id }, rosa)).toThrow();
  });
});

describe("seed preflight without a database", () => {
  it.each(["role", "language", "active", "user_locations", "pin credential scheme"])("refuses %s drift before inserting earlier missing personas", async field => {
    const insert = vi.fn(() => { throw new Error("Unexpected mutation"); });
    const stored = { ...rowFor(), pin_hash: null, password_hash: null,
      ...(field === "role" ? { role: "gm" } : {}),
      ...(field === "language" ? { language: "en" } : {}),
      ...(field === "active" ? { active: false } : {}),
    };
    mocks.createClient.mockReturnValue({ from(table: string) {
      let email = "";
      const query = {
        select: () => query,
        ilike: (_key: string, value: string) => { email = value; return query; },
        eq: () => query,
        insert,
        maybeSingle: async () => ({ error: null, data: email === rosa.email ? stored : null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ error: null, data: table === "user_locations" ? membershipsFor().map(m => ({ ...m, active: field !== "user_locations" })) : null }),
      };
      return query;
    } });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://jepgzucrvklhqpthowsc.supabase.co");
    // Only a truthy argument for the mocked constructor; never a real credential.
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unused-by-mock");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const { main } = await import("../scripts/sim/seed-staff");
    await expect(main()).rejects.toThrow(`${rosa.email}: ${field}`);
    expect(insert).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });
});
