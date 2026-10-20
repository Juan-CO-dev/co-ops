/**
 * Juan 2026-10-20 + Astra BC-007 — WHO may change WHOSE schedule settings, and a save never clobbers.
 *  - The actor matrix (employee, shift lead, key holder, AGM, GM own shop, GM other shop, MoO, owner, CGS) on the save path.
 *  - "GMs own their shop": a GM sets people at their shop — never themselves, never anyone at or above GM; an AGM with edit
 *    access only people below AGM; MoO+ unchanged. Enforced in the lib before the RPC (both writes), mirrored by the card.
 *  - Astra BC-007: the full-row write carries `expectedId` (a stale base is `person_settings_moved`, nothing written); the
 *    user screen's pickers send ONLY what changed and the server merges onto the LATEST row (full-time, soft range,
 *    also-allowed, leader setting, roster_include and the flex tail survive).
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { recordPersonSettings, recordPersonPositions } = await import("@/lib/scheduling/settings");
const { ScheduleError } = await import("@/lib/scheduling/errors-shared");
const { personSettingsSubjectRefusal } = await import("@/lib/scheduling/access-shared");
const { loadScheduleSettings } = await import("@/lib/scheduling/settings-view");
const { ScheduleSettings } = await import("@/components/schedule/ScheduleSettings");
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { StepUpProvider } = await import("@/components/admin/StepUpProvider");
const { savePicks } = await import("@/components/admin/users/UserPositions");
import type { PeopleActor } from "@/lib/people/access-shared";
import type { RoleCode } from "@/lib/roles";
import type { PersonSettingsRow } from "@/lib/scheduling/people-input-shared";
import { positionChangesOf, type ShopPositionPicker } from "@/lib/scheduling/user-positions-shared";
import { editorBaseOnProps } from "@/lib/scheduling/settings-view-shared";
import { A, AGM, B, GM, GM_B, KH, MOO, P_REG, P_WALK, SL, STAFF, scheduleStore, shopTables, uid } from "./fixtures/schedule/lib-store";

const EMP = STAFF[1]!;
const GM2 = uid(40); // a second GM who is a member at shop A
const P_EXPO = "00000000-0000-4000-8000-000000000033";
const NOW = new Date("2026-10-21T16:00:00Z");
const actor = (userId: string, role: RoleCode, level: number, locations: string[]): PeopleActor => ({ userId, role, level, locations });
const row = (userId: string, over: Partial<PersonSettingsRow> = {}): PersonSettingsRow => ({
  userId, workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null, ...over,
});
const dbRow = (id: string, userId: string, created: string, over: Record<string, unknown> = {}) => ({
  id, location_id: A, user_id: userId, work_type: null, also_allowed: [], leader_setting: null, cover_positions: [], soft_min_h: null, soft_max_h: null,
  full_time: false, full_time_min_h: null, roster_include: null, created_at: created, ...over,
});
function shop(mut: (t: ReturnType<typeof shopTables>) => void = () => {}, agmAccess: "read" | "edit" = "read") {
  const t = shopTables();
  t.users!.push({ id: GM2, name: "Gil", role: "gm", active: true });
  t.user_locations!.push({ user_id: GM2, location_id: A, active: true, assigned_at: "2026-01-01T12:00:00Z" });
  t.schedule_shop_settings![0]!.agm_access = agmAccess;
  mut(t);
  const s = scheduleStore(t);
  return { ...s, deps: { service: s.client, now: NOW } };
}
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof ScheduleError ? e.code : `throw:${(e as Error).message}`; } };
const rpcArgs = (s: ReturnType<typeof shop>) => s.calls.filter((c) => c.fn === "record_schedule_person_settings").map((c) => c.args);

describe("the actor matrix: setting an employee's schedule settings at shop A (both writes)", () => {
  const cases: Array<[string, PeopleActor, "read" | "edit", string]> = [
    ["employee", actor(STAFF[0]!, "employee", 3, [A]), "read", "schedule_forbidden"],
    ["shift lead", actor(SL, "shift_lead", 5, [A]), "read", "schedule_forbidden"],
    ["key holder", actor(KH, "key_holder", 4, [A]), "read", "schedule_forbidden"],
    ["AGM (read, the default — Juan 10-16)", actor(AGM, "agm", 6, [A]), "read", "schedule_forbidden"],
    ["AGM with edit access", actor(AGM, "agm", 6, [A]), "edit", "ok"],
    ["GM, own shop", actor(GM, "gm", 7, [A]), "read", "ok"],
    ["GM, other shop", actor(GM_B, "gm", 7, [B]), "read", "shop_not_allowed"],
    ["MoO", actor(MOO, "moo", 8, []), "read", "ok"],
    ["owner", actor(uid(41), "owner", 9, []), "read", "ok"],
    ["CGS", actor(uid(42), "cgs", 10, []), "read", "ok"],
  ];
  it.each(cases)("%s", async (_name, a, access, expected) => {
    const s = shop(() => {}, access);
    expect(await code(recordPersonSettings(s.deps, { actor: a, locationId: A, settings: row(EMP, { coverPositions: [P_REG] }), expectedId: null }))).toBe(expected);
    expect(await code(recordPersonPositions(s.deps, { actor: a, locationId: A, userId: EMP, changes: { primary: P_REG } }))).toBe(expected);
    expect(rpcArgs(s)).toHaveLength(expected === "ok" ? 2 : 0);
  });
});

describe("GMs own their shop: whose settings a GM (and an AGM with edit) may change", () => {
  const gm = actor(GM, "gm", 7, [A]);
  const agmEdit = actor(AGM, "agm", 6, [A]);
  const subjects: Array<[string, string, string, string]> = [
    // name, userId, GM's result, AGM-with-edit's result
    ["employee", EMP, "ok", "ok"],
    ["key holder", KH, "ok", "ok"],
    ["shift lead", SL, "ok", "ok"],
    ["AGM", AGM, "ok", "schedule_forbidden"],
    ["the GM themselves", GM, "schedule_forbidden", "schedule_forbidden"],
    ["another GM at the shop", GM2, "schedule_forbidden", "schedule_forbidden"],
    ["the MoO", MOO, "schedule_forbidden", "schedule_forbidden"],
  ];
  it.each(subjects)("%s", async (_n, userId, gmResult, agmResult) => {
    const s = shop(() => {}, "edit");
    expect(await code(recordPersonSettings(s.deps, { actor: gm, locationId: A, settings: row(userId), expectedId: null }))).toBe(gmResult);
    expect(await code(recordPersonPositions(s.deps, { actor: gm, locationId: A, userId, changes: { workType: "foh" } }))).toBe(gmResult);
    expect(await code(recordPersonSettings(s.deps, { actor: agmEdit, locationId: A, settings: row(userId), expectedId: null }))).toBe(agmResult);
  });
  it("MoO+ is unchanged (any subject); the pure rule matches", () => {
    const moo = actor(MOO, "moo", 8, []);
    for (const role of ["gm", "agm", "moo", "owner", "employee"] as const) expect(personSettingsSubjectRefusal(moo, { userId: "x", role })).toBeNull();
    expect(personSettingsSubjectRefusal(gm, { userId: GM, role: "employee" })).toBe("schedule_forbidden"); // oneself, whatever the role
    expect(personSettingsSubjectRefusal(gm, { userId: "x", role: "owner" })).toBe("schedule_forbidden");
    expect(personSettingsSubjectRefusal(gm, { userId: "x", role: "agm" })).toBeNull();
  });
  it("the card mirrors it: a GM's own row and another GM's are read-only (note + every control disabled); an employee's is editable", async () => {
    const s = shop();
    const v = await loadScheduleSettings(s.deps, { actor: gm, locationId: A });
    if (v.state !== "ready") throw new Error(v.state);
    const m = (id: string) => v.members.find((x) => x.userId === id)!;
    expect([m(GM).editable, m(GM2).editable, m(AGM).editable, m(EMP).editable]).toEqual([false, false, true, true]);
    const html = (who: string) => renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en" } as Parameters<typeof TranslationProvider>[0],
      createElement(StepUpProvider, { unlocked: false, unlockedAt: null, catalogWindow: true } as Parameters<typeof StepUpProvider>[0],
        createElement(ScheduleSettings, { view: v, initialPerson: who }) as ReactNode)));
    const own = html(GM);
    expect(own).toContain("data-person-read-only");
    expect(own).toContain(en["schedule.settings.staff.read_only"].replace(/'/g, "&#x27;"));
    expect(own).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html(EMP)).not.toContain("data-person-read-only");
  });
});

describe("Astra BC-007: a stale write never clobbers", () => {
  const gm = actor(GM, "gm", 7, [A]);
  const latest = (t: ReturnType<typeof shopTables>) => {
    t.schedule_person_settings = [
      dbRow("ps-old", EMP, "2026-10-01T00:00:00Z", { cover_positions: [P_WALK] }),
      // Saved by someone else AFTER the page loaded: full-time, soft range, also-allowed, leader setting, roster_include, a flex tail.
      dbRow("ps-new", EMP, "2026-10-02T00:00:00Z", { work_type: "foh", also_allowed: ["boh"], leader_setting: "closes", cover_positions: [P_WALK, P_REG, P_EXPO],
        soft_min_h: 20, soft_max_h: 32, full_time: true, full_time_min_h: 30, roster_include: null }),
    ];
  };
  it("the full-row write based on the old row is person_settings_moved and writes nothing; on the latest id it saves", async () => {
    const s = shop(latest);
    expect(await code(recordPersonSettings(s.deps, { actor: gm, locationId: A, settings: row(EMP, { coverPositions: [P_REG] }), expectedId: "ps-old" }))).toBe("person_settings_moved");
    expect(await code(recordPersonSettings(s.deps, { actor: gm, locationId: A, settings: row(EMP, { coverPositions: [P_REG] }), expectedId: null }))).toBe("person_settings_moved");
    expect(rpcArgs(s)).toHaveLength(0);
    expect(await code(recordPersonSettings(s.deps, { actor: gm, locationId: A, settings: row(EMP, { coverPositions: [P_REG] }), expectedId: "ps-new" }))).toBe("ok");
    expect(await code(recordPersonSettings(shop().deps, { actor: gm, locationId: A, settings: row(EMP), expectedId: null }))).toBe("ok"); // no row yet
  });
  it("the pickers' save (changes only, from a page loaded with the OLD row) merges onto the LATEST row: nothing else is lost", async () => {
    const s = shop(latest);
    const loaded = row(EMP, { coverPositions: [P_WALK] }); // what the page showed
    const P_NEW = uid(50);
    const changes = positionChangesOf(loaded, { workType: null, primary: P_WALK, secondary: P_NEW });
    expect(changes).toEqual({ secondary: P_NEW });
    expect(await code(recordPersonPositions(s.deps, { actor: gm, locationId: A, userId: EMP, changes: { ...changes } }))).toBe("ok");
    expect(rpcArgs(s)).toEqual([expect.objectContaining({
      p_user: EMP, p_work_type: "foh", p_also_allowed: ["boh"], p_leader_setting: "closes", p_soft_min_h: 20, p_soft_max_h: 32, p_full_time: true,
      p_full_time_min_h: 30, p_roster_include: null,
      // The latest primary (Walk-ins), the picked secondary (it replaces the latest secondary, Register — the one field
      // the user did change), and the latest row's flex tail (Expeditor) kept behind them.
      p_cover_positions: [P_WALK, P_NEW, P_EXPO],
    })]);
  });
  it("a work-type-only change keeps the latest list untouched; malformed changes are invalid_payload", async () => {
    const s = shop(latest);
    expect(await code(recordPersonPositions(s.deps, { actor: gm, locationId: A, userId: EMP, changes: { workType: "boh" } }))).toBe("ok");
    expect(rpcArgs(s)[0]).toMatchObject({ p_work_type: "boh", p_cover_positions: [P_WALK, P_REG, P_EXPO], p_full_time: true });
    for (const bad of [{}, { softMinH: 4 }, { workType: "chef" }, { primary: "not-a-uuid" }]) {
      expect(await code(recordPersonPositions(s.deps, { actor: gm, locationId: A, userId: EMP, changes: bad }))).toBe("invalid_payload");
    }
  });
  it("the client sends ONLY what changed (person_positions), one POST per changed shop", async () => {
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const shopA: ShopPositionPicker = { locationId: A, positions: [], rolesKnown: false, suggestions: {}, settings: { [EMP]: row(EMP, { fullTime: true, coverPositions: [P_WALK, P_REG] }) } };
      const shopB: ShopPositionPicker = { locationId: B, positions: [], rolesKnown: false, suggestions: {}, settings: {} };
      const res = await savePicks(EMP, { [A]: { workType: null, primary: P_WALK, secondary: P_EXPO }, [B]: { workType: null, primary: null, secondary: null } }, { [A]: shopA, [B]: shopB });
      expect(res).toBeNull();
      expect(bodies).toEqual([{ action: "person_positions", locationId: A, userId: EMP, changes: { secondary: P_EXPO } }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Astra BC-007 r3 (blocker): the card's values and its expected id are ONE revision", () => {
  const gm = actor(GM, "gm", 7, [A]);
  it("a save landing between the loader's reads never pairs revision A's values with revision B's id", async () => {
    const s = shop((t) => { t.schedule_person_settings = [dbRow("ps-a", EMP, "2026-10-01T00:00:00Z", { cover_positions: [P_WALK] })]; });
    let reads = 0;
    const from = s.client.from.bind(s.client);
    (s.client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "schedule_person_settings" && ++reads === 2) {
        // Another manager saves revision B right before the card's read.
        s.tables.schedule_person_settings!.push(dbRow("ps-b", EMP, "2026-10-02T00:00:00Z", { cover_positions: [P_REG] }));
      }
      return from(table);
    };
    const v = await loadScheduleSettings(s.deps, { actor: gm, locationId: A });
    if (v.state !== "ready") throw new Error(v.state);
    const m = v.members.find((x) => x.userId === EMP)!;
    expect([m.settingsId, m.settings?.coverPositions]).toEqual(["ps-b", [P_REG]]);
  });
  it("the editor's base id moves with its draft: a clean editor adopts a refreshed row; a dirty one keeps the id its draft is based on", () => {
    expect(editorBaseOnProps({ dirty: false, baseId: "a", seenId: "a" }, "a")).toEqual({ baseId: "a", seenId: "a", reset: false });
    expect(editorBaseOnProps({ dirty: false, baseId: "a", seenId: "a" }, "b")).toEqual({ baseId: "b", seenId: "b", reset: true });
    expect(editorBaseOnProps({ dirty: true, baseId: "a", seenId: "a" }, "b")).toEqual({ baseId: "a", seenId: "b", reset: false });
    expect(editorBaseOnProps({ dirty: false, baseId: null, seenId: null }, "c")).toEqual({ baseId: "c", seenId: "c", reset: true });
  });
});

describe("0278: the writes go through the lock-held writers; before 0278 is applied, 0274's writer behind the lib's checks", () => {
  const gm = actor(GM, "gm", 7, [A]);
  const one = (t: ReturnType<typeof shopTables>) => { t.schedule_person_settings = [dbRow("ps-1", EMP, "2026-10-01T00:00:00Z", { cover_positions: [P_WALK], full_time: true })]; };
  it("the full-row write calls save_schedule_person_settings with p_expected; the pickers call merge_schedule_person_positions with ONLY the changes", async () => {
    const s = shop(one);
    expect(await code(recordPersonSettings(s.deps, { actor: gm, locationId: A, settings: row(EMP, { coverPositions: [P_REG] }), expectedId: "ps-1" }))).toBe("ok");
    expect(await code(recordPersonPositions(s.deps, { actor: gm, locationId: A, userId: EMP, changes: { primary: P_REG } }))).toBe("ok");
    const calls = s.calls.filter((c) => c.fn.includes("person"));
    expect(calls.map((c) => c.fn)).toEqual(["save_schedule_person_settings", "record_schedule_person_settings", "merge_schedule_person_positions", "record_schedule_person_settings"]);
    expect(calls[0]!.args.p_expected).toBe("ps-1");
    expect(calls[2]!.args.p_changes).toEqual({ primary: P_REG });
  });
  it("0278 not applied (PGRST202): both writes fall back to record_schedule_person_settings, the lib's stale check and merge still hold", async () => {
    const t = shopTables();
    one(t);
    const st = scheduleStore(t, { no0278: true });
    const deps = { service: st.client, now: NOW };
    expect(await code(recordPersonSettings(deps, { actor: gm, locationId: A, settings: row(EMP), expectedId: "stale" }))).toBe("person_settings_moved");
    expect(await code(recordPersonSettings(deps, { actor: gm, locationId: A, settings: row(EMP), expectedId: "ps-1" }))).toBe("ok");
    expect(await code(recordPersonPositions(deps, { actor: gm, locationId: A, userId: EMP, changes: { primary: P_REG } }))).toBe("ok");
    const rec = st.calls.filter((c) => c.fn === "record_schedule_person_settings");
    expect(rec).toHaveLength(2);
    expect(rec[1]!.args).toMatchObject({ p_cover_positions: [P_REG], p_full_time: true });
  });
});
