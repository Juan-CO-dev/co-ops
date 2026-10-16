/**
 * Scheduling Phase 1, Task 23 — the per-shop PM v2 switch is WIRED (CC's chunk F ruling (c), Astra's chunk E
 * acceptance: "activation prerequisites must remain enforced when enabled").
 *
 * The switch is per shop and OFF by default (no row = off). It may be turned ON for a shop only when that
 * shop's data is ready — checked in the lib before the RPC, by name:
 *   · the BOH positions "Prep" and "Prep/Dishwasher" exist exactly once each, active, on an active station
 *     (Task 14b's report, `bohPositionsReport`);
 *   · the confirmed criteria are seeded there: at least one ACTIVE shared criterion (Task 22's seed always
 *     writes the two shared ones). Before 0271 is applied there is no criteria table: not ready.
 * Otherwise it refuses 409 `pm_v2_not_ready` and nothing is written. Turning it OFF is never gated.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { savePeopleShopSettings, pmV2Readiness, PM_V2_SWITCH_AVAILABLE } = await import("@/lib/people/settings");
import type { PeopleActor } from "@/lib/people/access-shared";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GM = id(1), ST = id(11), ST_OFF = id(12), P_PREP = id(21), P_DISH = id(22);
const gm: PeopleActor = { userId: GM, role: "gm", level: 7, locations: [A] };
const moo: PeopleActor = { userId: id(2), role: "moo", level: 8, locations: [A] };

function tables(over: Partial<Tables> = {}): Tables {
  return {
    locations: [{ id: A, name: "Shop A", active: true }],
    stations: [{ id: ST, location_id: A, name: "Prep", active: true }, { id: ST_OFF, location_id: A, name: "Old prep", active: false }],
    station_positions: [
      { id: P_PREP, station_id: ST, location_id: A, name: "Prep", name_es: "Prep", active: true },
      { id: P_DISH, station_id: ST, location_id: A, name: "Prep/Dishwasher", name_es: "Prep/Lavaplatos", active: true },
    ],
    pm_criteria: [{ id: "k1", location_id: A, position_id: null, label: "Arrived ready", label_es: "Llegó listo", sort: 10, active: true }],
    people_shop_settings: [],
    ...over,
  };
}
let db: ReturnType<typeof createFakeDb>;
let rpc: ReturnType<typeof vi.fn>;
const svc = () => Object.assign(db.client, { rpc }) as unknown as Parameters<typeof savePeopleShopSettings>[0];
beforeEach(() => {
  rpc = vi.fn(async () => ({ data: { before: null, after: { pm_v2: true, prep_position_id: null } }, error: null }));
});

describe("the PM v2 switch: wired, per shop, off by default, gated by data readiness", () => {
  it("is available in code (Task 23 wired it); every shop still starts OFF (no row)", () => {
    expect(PM_V2_SWITCH_AVAILABLE).toBe(true);
    const src = readFileSync("lib/people/settings.ts", "utf8");
    expect(src).toContain("DEFAULT_PEOPLE_SHOP_SETTINGS: PeopleShopSettings = Object.freeze({ pmV2: false");
  });

  it("ready shop: both BOH positions + an active shared criterion → ON is saved", async () => {
    db = createFakeDb(tables());
    expect(await pmV2Readiness(svc(), A)).toMatchObject({ ready: true, boh: true, criteria: 1 });
    expect(await savePeopleShopSettings(svc(), { actor: moo, locationId: A, pmV2: true, prepPositionId: null })).toEqual({ pmV2: true, prepPositionId: null });
    expect(rpc).toHaveBeenCalledWith("save_people_shop_settings", expect.objectContaining({ p_pm_v2: true }));
  });

  it("refuses pm_v2_not_ready, writing nothing: a BOH position missing, retired, or on an inactive station", async () => {
    for (const positions of [
      [{ id: P_PREP, station_id: ST, location_id: A, name: "Prep", name_es: null, active: true }],
      [{ id: P_PREP, station_id: ST, location_id: A, name: "Prep", name_es: null, active: true }, { id: P_DISH, station_id: ST, location_id: A, name: "Prep/Dishwasher", name_es: null, active: false }],
      [{ id: P_PREP, station_id: ST, location_id: A, name: "Prep", name_es: null, active: true }, { id: P_DISH, station_id: ST_OFF, location_id: A, name: "Prep/Dishwasher", name_es: null, active: true }],
    ]) {
      db = createFakeDb(tables({ station_positions: positions }));
      await expect(savePeopleShopSettings(svc(), { actor: moo, locationId: A, pmV2: true, prepPositionId: null })).rejects.toMatchObject({ status: 409, code: "pm_v2_not_ready" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses pm_v2_not_ready when the criteria are not seeded (none, only inactive, only position-specific, or no 0271 table)", async () => {
    for (const criteria of [[], [{ id: "k", location_id: A, position_id: null, label: "x", label_es: null, sort: 1, active: false }],
      [{ id: "k", location_id: A, position_id: P_PREP, label: "x", label_es: null, sort: 1, active: true }]]) {
      db = createFakeDb(tables({ pm_criteria: criteria }));
      await expect(savePeopleShopSettings(svc(), { actor: moo, locationId: A, pmV2: true, prepPositionId: null })).rejects.toMatchObject({ code: "pm_v2_not_ready" });
    }
    const t = tables();
    delete t.pm_criteria;
    db = createFakeDb(t);
    expect(await pmV2Readiness(svc(), A)).toMatchObject({ ready: false, criteria: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turning it OFF is never gated (no readiness read)", async () => {
    db = createFakeDb(tables({ station_positions: [], pm_criteria: [] }));
    rpc.mockResolvedValueOnce({ data: { before: { pm_v2: true, prep_position_id: null }, after: { pm_v2: false, prep_position_id: null } }, error: null });
    expect(await savePeopleShopSettings(svc(), { actor: moo, locationId: A, pmV2: false, prepPositionId: null })).toEqual({ pmV2: false, prepPositionId: null });
    expect(db.log.some((q) => q.table === "pm_criteria")).toBe(false);
  });

  it("the refusal has its en + es message", () => {
    expect(en["people.skills.error.pm_v2_not_ready"]).toBeTruthy();
    expect(es["people.skills.error.pm_v2_not_ready"]).toBeTruthy();
    expect(es["people.skills.error.pm_v2_not_ready"]).not.toBe(en["people.skills.error.pm_v2_not_ready"]);
  });
});

describe("CC gate ruling: flipping the switch is MoO+ only (the same rule as the admin card)", () => {
  it("a GM cannot turn it ON at their own shop, even when the shop is ready: pm_v2_moo_only, nothing written", async () => {
    db = createFakeDb(tables());
    await expect(savePeopleShopSettings(svc(), { actor: gm, locationId: A, pmV2: true, prepPositionId: null })).rejects.toMatchObject({ status: 403, code: "pm_v2_moo_only" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a GM cannot turn it OFF once a MoO turned it on", async () => {
    db = createFakeDb(tables({ people_shop_settings: [{ location_id: A, pm_v2: true, prep_position_id: null }] }));
    await expect(savePeopleShopSettings(svc(), { actor: gm, locationId: A, pmV2: false, prepPositionId: null })).rejects.toMatchObject({ status: 403, code: "pm_v2_moo_only" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a GM may still save the shop's prep position when the switch value travels unchanged", async () => {
    db = createFakeDb(tables());
    rpc.mockResolvedValueOnce({ data: { before: null, after: { pm_v2: false, prep_position_id: P_PREP } }, error: null });
    expect(await savePeopleShopSettings(svc(), { actor: gm, locationId: A, pmV2: false, prepPositionId: P_PREP })).toEqual({ pmV2: false, prepPositionId: P_PREP });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("the refusal has its en + es message", () => {
    expect(en["people.skills.error.pm_v2_moo_only"]).toBeTruthy();
    expect(es["people.skills.error.pm_v2_moo_only"]).toBeTruthy();
    expect(es["people.skills.error.pm_v2_moo_only"]).not.toBe(en["people.skills.error.pm_v2_moo_only"]);
  });
});
