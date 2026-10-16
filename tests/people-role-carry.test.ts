/**
 * Scheduling Phase 1, Task 13 Step 1 (r1 P2-8) — THE TRUSTED ROLE IS CARRIED, AND IT DECIDES.
 *
 * Two viewers with IDENTICAL level 6 and the same shop: an AGM and a social media manager. Through
 * every people entry point the AGM gets exactly what the golden recorded for it, and the SMM is
 * refused by ROLE (R7). The prep and catering managers follow the AGM path. My Performance is
 * self-only and stays open to an SMM for their OWN numbers (it is not people data about others).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildPeopleLayerFixture, LOC_A, LOC_B, TODAY, U } from "./fixtures/people-layer-fixture";
import type { RoleCode } from "@/lib/roles";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

const { loadMyPerformance, loadPersonDetail, loadPersonReportLocations, loadTeamOperatingHealth } = await import("@/lib/team-metrics");

const golden = JSON.parse(readFileSync("tests/fixtures/people-layer-golden.json", "utf8")) as Record<string, unknown>;
const plain = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

const level6 = (role: RoleCode, userId: string = U.agm) => ({ userId, role, level: 6, locations: [LOC_A] });
const AGM_PATH: RoleCode[] = ["agm", "prep_mgr", "catering_mgr"];
const SMM = level6("social_media_mgr", U.smm);

beforeEach(() => { current = createFakeDb(buildPeopleLayerFixture()); });

describe("same level 6, same shop: the AGM path gets the golden, the SMM is refused", () => {
  it("loadTeamOperatingHealth", async () => {
    const svc = current!.client;
    for (const role of AGM_PATH) {
      for (const compare of [false, true]) {
        const got = await loadTeamOperatingHealth(svc, { viewer: level6(role), locationId: LOC_A, granularity: "week", compare, today: TODAY });
        expect(plain(got), role).toEqual(golden[`team|agm|${LOC_A}|week|cmp=${compare}`]);
      }
    }
    expect(await loadTeamOperatingHealth(svc, { viewer: SMM, locationId: LOC_A, granularity: "week", compare: true, today: TODAY })).toBeNull();
  });

  it("loadPersonDetail", async () => {
    const svc = current!.client;
    for (const personId of [U.emp, U.slBoth, U.kh]) {
      for (const role of AGM_PATH) {
        const got = await loadPersonDetail(svc, { viewer: level6(role), personId, locationId: LOC_A, granularity: "week", compare: true, today: TODAY });
        expect(plain(got), `${role} ${personId}`).toEqual(golden[`detail|agm|${personId}|${LOC_A}|week|cmp=true`]);
        expect(got, personId).not.toBeNull();
      }
      expect(await loadPersonDetail(svc, { viewer: SMM, personId, locationId: LOC_A, granularity: "week", compare: true, today: TODAY })).toBeNull();
    }
  });

  it("loadPersonReportLocations", async () => {
    const svc = current!.client;
    for (const personId of [U.emp, U.slBoth]) {
      for (const role of AGM_PATH) {
        const got = await loadPersonReportLocations(svc, level6(role), personId);
        expect(got, role).toEqual(golden[`reportLocations|agm|${personId}`]);
        expect(got).toEqual([LOC_A]);
      }
      expect(await loadPersonReportLocations(svc, SMM, personId)).toEqual([]);
    }
  });

  it("a level-forged SMM (level 9) is still refused: the ROLE decides, not the level", async () => {
    const svc = current!.client;
    const forged = { userId: U.smm, role: "social_media_mgr" as const, level: 9, locations: [LOC_A, LOC_B] };
    expect(await loadTeamOperatingHealth(svc, { viewer: forged, locationId: LOC_A, granularity: "day", compare: false, today: TODAY })).toBeNull();
    expect(await loadPersonDetail(svc, { viewer: forged, personId: U.emp, locationId: LOC_A, granularity: "day", compare: false, today: TODAY })).toBeNull();
    expect(await loadPersonReportLocations(svc, forged, U.emp)).toEqual([]);
  });

  it("the refusal reads nothing", async () => {
    const svc = current!.client;
    const before = current!.log.length;
    await loadTeamOperatingHealth(svc, { viewer: SMM, locationId: LOC_A, granularity: "week", compare: false, today: TODAY });
    await loadPersonDetail(svc, { viewer: SMM, personId: U.emp, locationId: LOC_A, granularity: "week", compare: false, today: TODAY });
    await loadPersonReportLocations(svc, SMM, U.emp);
    expect(current!.log.length).toBe(before);
  });

  it("My Performance stays self-only and open to an SMM for their own numbers", async () => {
    const svc = current!.client;
    const self = { userId: U.smm, role: "social_media_mgr" as const, level: 6, locations: [LOC_A, LOC_B] };
    const got = await loadMyPerformance(svc, { viewer: self, locationId: LOC_A, granularity: "week", compare: true, today: TODAY });
    expect(plain(got)).toEqual(golden[`mine|${U.smm}|${LOC_A}|week|cmp=true`]);
  });
});
