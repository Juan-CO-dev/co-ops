import { describe, expect, it, vi } from "vitest";
import { CASE_POSITION_IDS as I, shopBase } from "../scripts/schedule-structure-cases.mjs";
import { toSchedPeople, type PersonSettingsRow } from "@/lib/scheduling/people-input-shared";
import type { ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { eligibleFor, eligibleForPosition, leaderSettingOf, modCountsAt, neverGenerated } from "@/lib/scheduling/rules-shared";
import { positionRankOf } from "@/lib/scheduling/position-rank-shared";
import { mergePositionChanges } from "@/lib/scheduling/user-positions-shared";
import { effectiveScheduleRole, worksAsRefusal } from "@/lib/scheduling/works-as-shared";
import { A, GM, MOO, P_REG, P_WALK, STAFF, scheduleStore, shopTables, uid } from "./fixtures/schedule/lib-store";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { recordPersonSettings, recordPersonPositions } = await import("@/lib/scheduling/settings");
const { loadReconciliation } = await import("@/lib/scheduling/reconcile");

const CGS = uid(70);
const row = (over: Partial<PersonSettingsRow> = {}): PersonSettingsRow => ({
  userId: CGS, workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [],
  softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null, ...over,
});
const S = shopBase() as ScheduleStructure;
function roster(settings: PersonSettingsRow[], wages: Record<string, number> = {}) {
  return toSchedPeople({
    members: [{ userId: CGS, role: "cgs", active: true }], settings, patterns: {}, dates: ["2026-10-26"],
    structure: { ...S, roster: { excludedRoles: ["cgs", "social_media_mgr", "catering_mgr", "prep_mgr"] } },
    shopDay: { fromQ: 28, toQ: 84 }, skills: null, wages: { byUserCents: wages, estimateHourlyCents: 1900 },
  }).people;
}

describe("Works shifts as: effective scheduling role, unchanged account permissions", () => {
  it("CGS without an override stays off the roster, including explicit null and rosterInclude", () => {
    expect(roster([])).toEqual([]);
    expect(roster([row({ worksAs: null, rosterInclude: true })])).toEqual([]);
  });

  it.each(["cgs", "social_media_mgr", "catering_mgr", "prep_mgr"] as const)("%s may work as a floor role; a floor account may not override", (role) => {
    expect(worksAsRefusal(role, "key_holder")).toBeNull();
    expect(effectiveScheduleRole(role, "key_holder")).toBe("key_holder");
    expect(worksAsRefusal(role, "gm")).toBe("invalid_payload");
    expect(worksAsRefusal("employee", "key_holder")).toBe("works_as_refused");
    expect(effectiveScheduleRole("employee", "key_holder")).toBe("employee");
  });

  it("CGS as key holder uses hourly wages, FOH and closing defaults, register eligibility and station rank", () => {
    const settings = [row({ worksAs: "key_holder", coverPositions: [I.$REG, I.$WALK] })];
    const p = roster(settings)[0]!;
    expect(p).toMatchObject({ role: "key_holder", workType: "foh", salaried: false, presenceOnly: false, wageCents: 1900, wageSource: "estimate" });
    expect(neverGenerated(p)).toBe(false);
    expect(leaderSettingOf(p, S)).toBe("closes");
    expect(eligibleForPosition(p, S.positions[I.$REG])).toBe(true);
    expect(eligibleForPosition(p, S.positions[I.$DISH])).toBe(false);
    expect(eligibleFor(p, "closing_manager_missing", null, S, 80)).toBe(true);
    expect(positionRankOf(p, I.$REG)).toBe(0);
    expect(positionRankOf(p, I.$WALK)).toBe(1);
    expect(roster(settings, { [CGS]: 2350 })[0]).toMatchObject({ wageCents: 2350, wageSource: "sevenshifts" });
  });

  it("the effective key holder only counts as MoD at or after the configured quarter", () => {
    const p = roster([row({ worksAs: "key_holder" })])[0]!;
    const enabled = { ...S, leadership: { ...S.leadership, keyHolderModAfterQ: 64 } };
    expect(modCountsAt(p, { ...S, leadership: { ...S.leadership, keyHolderModAfterQ: null } }, 80)).toBe(false);
    expect(modCountsAt(p, enabled, 63)).toBe(false);
    expect(modCountsAt(p, enabled, 64)).toBe(true);
  });

  it("a partial position edit preserves worksAs alongside the rest of the saved settings", () => {
    const before = row({ worksAs: "key_holder", coverPositions: [P_REG], fullTime: true, softMinH: 25 });
    expect(mergePositionChanges(before, CGS, { secondary: P_WALK })).toEqual({ ...before, coverPositions: [P_REG, P_WALK] });
  });

  it("the route's writer refuses an employee override before any write RPC", async () => {
    const store = scheduleStore(shopTables());
    await expect(recordPersonSettings({ service: store.client }, {
      actor: { userId: GM, role: "gm", level: 7, locations: [A] }, locationId: A,
      settings: row({ userId: STAFF[1]!, worksAs: "key_holder" }), expectedId: null,
    })).rejects.toMatchObject({ code: "works_as_refused" });
    expect(store.calls).toEqual([]);
  });

  it("a carried override is cleared after a floor-role change, but a different new override refuses", async () => {
    const tables = shopTables();
    const userId = STAFF[1]!;
    tables.schedule_person_settings!.push({ id: "ps-stale", location_id: A, user_id: userId, works_as: "key_holder",
      cover_positions: [], also_allowed: [], created_at: "2026-10-21T00:00:00Z" });
    const store = scheduleStore(tables);
    const args = { actor: { userId: GM, role: "gm" as const, level: 7, locations: [A] }, locationId: A, expectedId: "ps-stale" };
    await recordPersonSettings({ service: store.client }, { ...args, settings: row({ userId, worksAs: "key_holder" }) });
    expect(store.calls.find((c) => c.fn === "save_schedule_person_settings")?.args.p_works_as).toBeNull();
    await expect(recordPersonSettings({ service: store.client }, { ...args, settings: row({ userId, worksAs: "trainer" }) }))
      .rejects.toMatchObject({ code: "works_as_refused" });
  });

  it("the partial-save writer retains works_as from the locked head while changing a station", async () => {
    const tables = shopTables();
    tables.users!.push({ id: CGS, name: "Office", role: "cgs", active: true });
    tables.user_locations!.push({ user_id: CGS, location_id: A, active: true });
    tables.schedule_person_settings!.push({ id: "ps-current", location_id: A, user_id: CGS, works_as: "key_holder",
      work_type: null, also_allowed: [], leader_setting: null, cover_positions: [P_REG], soft_min_h: null, soft_max_h: null,
      full_time: false, full_time_min_h: null, roster_include: null, created_at: "2026-10-21T00:00:00Z" });
    const store = scheduleStore(tables);
    await recordPersonPositions({ service: store.client }, {
      actor: { userId: MOO, role: "moo", level: 8, locations: [] }, locationId: A, userId: CGS,
      changes: { secondary: P_WALK }, expectedId: "ps-current",
    });
    expect(store.calls.find((c) => c.fn === "record_schedule_person_settings")?.args).toMatchObject({
      p_works_as: "key_holder", p_cover_positions: [P_REG, P_WALK],
    });
  });

  it("the writer carries the override to the guarded save without changing subject authorization", async () => {
    const tables = shopTables();
    tables.users!.push({ id: CGS, name: "Office", role: "cgs", active: true });
    tables.user_locations!.push({ user_id: CGS, location_id: A, active: true });
    const store = scheduleStore(tables);
    const args = { locationId: A, settings: row({ worksAs: "key_holder" }), expectedId: null };
    await expect(recordPersonSettings({ service: store.client }, {
      ...args, actor: { userId: GM, role: "gm", level: 7, locations: [A] },
    })).rejects.toMatchObject({ code: "schedule_forbidden" });
    await recordPersonSettings({ service: store.client }, {
      ...args, actor: { userId: MOO, role: "moo", level: 8, locations: [] },
    });
    expect(store.calls.find((c) => c.fn === "save_schedule_person_settings")?.args).toMatchObject({ p_works_as: "key_holder" });
  });

  it("reconciliation includes the CGS only at the shop with a saved floor override", async () => {
    const tables = shopTables();
    tables.users!.push({ id: CGS, name: "Office", role: "cgs", active: true });
    tables.user_locations!.push({ user_id: CGS, location_id: A, active: true });
    const store = scheduleStore(tables);
    const args = { actor: { userId: GM, role: "gm" as const, level: 7, locations: [A] }, locationId: A };
    const deps = { service: store.client, now: new Date("2026-10-28T16:00:00Z") };
    expect((await loadReconciliation(deps, args, {})).view.rows.map((r) => r.userId)).not.toContain(CGS);
    tables.schedule_person_settings!.push({ id: uid(71), location_id: A, user_id: CGS, works_as: "key_holder", created_at: "2026-10-21T00:00:00Z" });
    expect((await loadReconciliation(deps, args, {})).view.rows.map((r) => r.userId)).toContain(CGS);
  });
});
