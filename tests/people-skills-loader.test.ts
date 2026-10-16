/**
 * Scheduling Phase 1, Task 16 — the skills loader and the writers, over the in-memory PostgREST fake.
 *
 * - every entry decides its rule before any I/O (SMM, another shop's GM, an AGM writing: refused, nothing read);
 * - THIS shop's positions only, in display order (station sort, then position sort), never another shop's
 *   even for a two-shop person;
 * - the matrix: every active member (managers included) × every active position, ONE batch load whose query
 *   count does not grow with the roster;
 * - the self view carries no trace of an adjustment;
 * - adjust / rate / tunables / shop settings: refusals by name, the RPC payload in cents, audited without
 *   the note; a rejected tunables set never reaches the database;
 * - before 0270 is applied every surface answers "not available", never a 500.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { audit } = await import("@/lib/audit");
const { adjustSkill, loadMySkills, loadSkillMatrix, loadSkills, PeopleSkillError, rateNewHire } = await import("@/lib/people/skills");
const { saveSkillTunables } = await import("@/lib/people/tunables");
const { savePeopleShopSettings } = await import("@/lib/people/settings");
import type { PeopleActor } from "@/lib/people/access-shared";
import { SKILL_TUNABLE_DEFAULTS } from "@/lib/people/tunables-shared";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GM_A = id(1), AGM_A = id(2), SMM_A = id(3), EMP = id(4), MOO = id(5), GM_B = id(6), EMP2 = id(7);
const ST_A_PREP = id(11), ST_A_WALK = id(12), ST_B = id(13);
const P_PREP = id(21), P_DISH = id(22), P_WALK = id(23), P_OLD = id(24), P_B = id(25);
const NOW = new Date("2026-10-15T20:00:00Z");

const actor = (userId: string, role: PeopleActor["role"], level: number, locations: string[]): PeopleActor => ({ userId, role, level, locations });
const gmA = actor(GM_A, "gm", 7, [A]);
const agmA = actor(AGM_A, "agm", 6, [A]);
const smmA = actor(SMM_A, "social_media_mgr", 6, [A]);
const gmB = actor(GM_B, "gm", 7, [B]);
const moo = actor(MOO, "moo", 8, []);
const emp = actor(EMP, "employee", 3, [A, B]);

function tables(): Tables {
  return {
    users: [
      { id: GM_A, name: "Alex", role: "gm", active: true }, { id: AGM_A, name: "Ana", role: "agm", active: true },
      { id: SMM_A, name: "Sam", role: "social_media_mgr", active: true }, { id: EMP, name: "Eli", role: "employee", active: true },
      { id: MOO, name: "Cris", role: "moo", active: true }, { id: GM_B, name: "John", role: "gm", active: true },
      { id: EMP2, name: "Zoe", role: "employee", active: true },
    ],
    user_locations: [
      { user_id: GM_A, location_id: A, active: true }, { user_id: AGM_A, location_id: A, active: true }, { user_id: SMM_A, location_id: A, active: true },
      { user_id: EMP, location_id: A, active: true }, { user_id: EMP, location_id: B, active: true }, { user_id: GM_B, location_id: B, active: true },
      { user_id: EMP2, location_id: A, active: true },
    ],
    stations: [
      { id: ST_A_WALK, location_id: A, name: "Walk-ins", name_es: "Tienda", sort: 2, active: true, usually_closes_at: "22:00:00" },
      { id: ST_A_PREP, location_id: A, name: "Prep", name_es: "Prep", sort: 1, active: true, usually_closes_at: null },
      { id: ST_B, location_id: B, name: "Expo", name_es: "Expo", sort: 0, active: true, usually_closes_at: null },
    ],
    station_positions: [
      { id: P_WALK, station_id: ST_A_WALK, location_id: A, name: "Walk-ins", name_es: "Tienda", sort: 1, active: true },
      { id: P_PREP, station_id: ST_A_PREP, location_id: A, name: "Prep", name_es: "Prep", sort: 2, active: true },
      { id: P_DISH, station_id: ST_A_PREP, location_id: A, name: "Prep/Dishwasher", name_es: "Prep/Lavaplatos", sort: 1, active: true },
      { id: P_OLD, station_id: ST_A_PREP, location_id: A, name: "Old", name_es: null, sort: 3, active: false },
      { id: P_B, station_id: ST_B, location_id: B, name: "Expeditor", name_es: null, sort: 1, active: true },
    ],
    station_events: [
      { id: "e1", sequence: 1, location_id: A, business_date: "2026-10-14", user_id: EMP, station_id: ST_A_WALK, position_id: P_WALK, kind: "claim", at: "2026-10-14T20:00:00Z", source: "claimed", effective_at: null },
      { id: "e2", sequence: 2, location_id: A, business_date: "2026-10-14", user_id: EMP, station_id: null, position_id: null, kind: "release", at: "2026-10-15T02:30:00Z", source: null, effective_at: null },
      { id: "e3", sequence: 3, location_id: B, business_date: "2026-10-14", user_id: EMP, station_id: ST_B, position_id: P_B, kind: "claim", at: "2026-10-14T12:00:00Z", source: "claimed", effective_at: null },
    ],
    checklist_templates: [{ id: "tA", location_id: A, type: "closing" }, { id: "tB", location_id: B, type: "closing" }],
    checklist_instances: [{ id: "iA", location_id: A, template_id: "tA", date: "2026-10-14", dropped_at: null, shift_start_at: null, triggered_at: null }],
    checklist_template_items: [{ id: "li1", template_id: "tA", station: "Walk-ins", active: true }],
    checklist_completions: [{ id: "cc1", instance_id: "iA", template_item_id: "li1", completed_by: EMP, completed_at: "2026-10-15T02:10:00Z", superseded_at: null, revoked_at: null }],
    // ONE maker, TWO sessions, TWO productions → exactly TWO observations (r1 P2-6: no session join).
    prep_batch_sessions: [{ instance_id: "s1", template_item_id: "x", made_by: EMP }, { instance_id: "s2", template_item_id: "x", made_by: EMP }],
    productions: [
      { id: "pr1", location_id: A, output_item_id: "ham", produced_at: "2026-10-14T21:00:00Z", made_by: EMP, batches_made: 1, came_out_to: 10, yield_at_time: 10, superseded_at: null, revoked_at: null },
      { id: "pr2", location_id: A, output_item_id: "ham", produced_at: "2026-10-14T15:00:00Z", made_by: EMP, batches_made: 1, came_out_to: 10, yield_at_time: 10, superseded_at: null, revoked_at: null },
      { id: "pr3", location_id: A, output_item_id: "ham", produced_at: "2026-10-14T15:30:00Z", made_by: null, batches_made: 1, came_out_to: 10, yield_at_time: 10, superseded_at: null, revoked_at: null },
    ],
    people_skill_adjustments: [
      { id: "ad1", user_id: EMP, location_id: A, position_id: P_WALK, delta: "0.10", reason_code: "observed_on_floor", reason_note: "covered the rush", actor_id: GM_A, created_at: "2026-10-12T15:00:00Z" },
    ],
    people_skill_ratings: [
      { id: "ra1", user_id: EMP, location_id: A, position_id: P_PREP, rating: "0.80", reason_code: "training_completed", reason_note: null, actor_id: GM_A, created_at: "2026-10-01T15:00:00Z" },
    ],
    people_skill_tunables: [],
    people_shop_settings: [{ location_id: A, pm_v2: false, prep_position_id: P_PREP }],
  };
}

let db: ReturnType<typeof createFakeDb>;
let rpc: ReturnType<typeof vi.fn>;
function service() {
  return Object.assign(db.client, { rpc }) as unknown as Parameters<typeof loadSkills>[0];
}
beforeEach(() => {
  db = createFakeDb(tables());
  rpc = vi.fn(async () => ({ data: { id: "new-row", before: null, after: { pm_v2: false, prep_position_id: null } }, error: null }));
  vi.mocked(audit).mockClear();
});

describe("the reads decide before any I/O", () => {
  it("the SMM, another shop's GM and a level below 6 are refused with nothing read", async () => {
    for (const a of [smmA, gmB, actor(EMP2, "employee", 3, [A])]) {
      await expect(loadSkills(service(), { actor: a, locationId: A, personId: EMP, now: NOW })).rejects.toMatchObject({ status: 403, code: "forbidden" });
      await expect(loadSkillMatrix(service(), { actor: a, locationId: A, now: NOW })).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(db.log).toHaveLength(0);
  });
  it("own skills: only at a shop the person belongs to", async () => {
    await expect(loadMySkills(service(), { actor: actor(EMP2, "employee", 3, [A]), locationId: B, now: NOW })).rejects.toBeInstanceOf(PeopleSkillError);
    expect(db.log).toHaveLength(0);
  });
});

describe("loadSkills — the manager's person view", () => {
  it("THIS shop's active positions only, in station-sort then position-sort order; never shop B's for a two-shop person", async () => {
    const r = await loadSkills(service(), { actor: gmA, locationId: A, personId: EMP, now: NOW });
    if (!r.available) throw new Error("unavailable");
    expect(r.view.rows.map((row) => row.position.positionId)).toEqual([P_DISH, P_PREP, P_WALK]);
    expect(JSON.stringify(r.view)).not.toContain(P_B);
    expect(JSON.stringify(r.view)).not.toContain(P_OLD);
  });

  it("the skills from the facts: closing on time + a batch on one day = ONE quality day; the rating is the prior; the adjustment applies", async () => {
    const r = await loadSkills(service(), { actor: gmA, locationId: A, personId: EMP, now: NOW });
    if (!r.available) throw new Error("unavailable");
    const walk = r.view.rows.find((x) => x.position.positionId === P_WALK)!;
    expect(walk.skill).toMatchObject({ qualityDays: 1, workedDays: 1, minutesWorked: 390, adjustment: 0.1 });
    expect(walk.skill.perKind.closeOnTime).toMatchObject({ count: 1, mean: 1 });
    expect(walk.skill.perKind.prepYield).toMatchObject({ count: 1 }); // pr1: made while holding Walk-ins
    const prep = r.view.rows.find((x) => x.position.positionId === P_PREP)!;
    expect(prep.skill).toMatchObject({ prior: 0.8, priorSource: "manager_rating", qualityDays: 1 }); // pr2 → the shop's prep position
    expect(prep.skill.evidence.map((e) => e.key)).toContain("people.skills.evidence.noMaker"); // pr3
    expect(walk.history).toEqual([{ id: "ad1", kind: "adjustment", value: 0.1, reasonCode: "observed_on_floor", reasonNote: "covered the rush", actorName: "Alex", at: "2026-10-12T15:00:00Z" }]);
    expect(r.view).toMatchObject({ canAdjust: true, adjustedCount: 1 });
    expect(r.view.rows.find((x) => x.position.positionId === P_DISH)!.hasEvidence).toBe(false);
  });

  it("ONE maker × TWO sessions × TWO productions → exactly TWO prep observations (no session join)", async () => {
    const r = await loadSkills(service(), { actor: gmA, locationId: A, personId: EMP, now: NOW });
    if (!r.available) throw new Error("unavailable");
    const prepCount = r.view.rows.reduce((n, row) => n + (row.skill.perKind.prepYield?.count ?? 0), 0);
    expect(prepCount).toBe(2);
    expect(db.log.some((q) => q.table === "prep_batch_sessions")).toBe(false);
  });

  it("an AGM sees the view but cannot adjust; a GM cannot adjust another GM", async () => {
    const r = await loadSkills(service(), { actor: agmA, locationId: A, personId: EMP, now: NOW });
    expect(r.available && r.view.canAdjust).toBe(false);
    const g = await loadSkills(service(), { actor: gmA, locationId: A, personId: GM_A, now: NOW });
    expect(g.available && g.view.canAdjust).toBe(false);
  });
});

describe("loadSkillMatrix — the Phase 2 read", () => {
  it("every active member (managers included) × every active position, with confidence and evidence", async () => {
    const m = await loadSkillMatrix(service(), { actor: gmA, locationId: A, now: NOW });
    expect(m.positions.map((p) => p.positionId)).toEqual([P_DISH, P_PREP, P_WALK]);
    expect(m.people.map((p) => p.userId).sort()).toEqual([GM_A, AGM_A, SMM_A, EMP, EMP2].sort());
    for (const p of m.people) {
      expect(p.skills).toHaveLength(3);
      for (const s of p.skills) expect(s).toHaveProperty("confidence");
    }
    expect(m.asOf).toBe("2026-10-15");
    expect(m.tunablesVersion).toMatch(/^[0-9a-f]{8}$/);
  });

  it("ONE batch load: the query count does not grow with the roster", async () => {
    await loadSkillMatrix(service(), { actor: moo, locationId: A, now: NOW });
    const withFive = db.log.length;
    const t = tables();
    for (let i = 0; i < 20; i++) {
      t.users!.push({ id: id(100 + i), name: `P${i}`, role: "employee", active: true });
      t.user_locations!.push({ user_id: id(100 + i), location_id: A, active: true });
    }
    db = createFakeDb(t);
    await loadSkillMatrix(service(), { actor: moo, locationId: A, now: NOW });
    expect(db.log.length).toBe(withFive);
  });
});

describe("loadMySkills — the self view (R8)", () => {
  it("bands and positive lines for positions worked or observed; no number, no adjustment, no rating trace", async () => {
    const r = await loadMySkills(service(), { actor: emp, locationId: A, now: NOW });
    if (!r.available) throw new Error("unavailable");
    expect(r.view.map((x) => x.positionId)).toEqual([P_PREP, P_WALK]);
    const text = JSON.stringify(r.view);
    for (const forbidden of ["adjust", "rating", "0.1", "0.8", "covered the rush", "Alex", "confidence", "value"]) expect(text).not.toContain(forbidden);
    for (const row of r.view) expect(["building", "solid", "strong"]).toContain(row.band);
  });
});

describe("before 0270 is applied", () => {
  it("the person and self views answer not-available; the matrix answers 503 skills_unavailable", async () => {
    const t = tables();
    delete t.people_skill_tunables; delete t.people_skill_adjustments; delete t.people_skill_ratings; delete t.people_shop_settings;
    db = createFakeDb(t);
    expect(await loadSkills(service(), { actor: gmA, locationId: A, personId: EMP, now: NOW })).toEqual({ available: false });
    expect(await loadMySkills(service(), { actor: emp, locationId: A, now: NOW })).toEqual({ available: false });
    await expect(loadSkillMatrix(service(), { actor: gmA, locationId: A, now: NOW })).rejects.toMatchObject({ status: 503, code: "skills_unavailable" });
  });
});

const write = { locationId: A, userId: EMP, positionId: P_WALK, reasonCode: "observed_on_floor", reasonNote: null };
describe("adjustSkill / rateNewHire", () => {
  it("refused BEFORE any I/O: an AGM, the SMM, another shop's GM; a bad step; a bad reason", async () => {
    for (const a of [agmA, smmA, gmB]) await expect(adjustSkill(service(), { ...write, actor: a, delta: 0.1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(adjustSkill(service(), { ...write, actor: gmA, delta: 0.12 })).rejects.toMatchObject({ code: "invalid_adjustment" });
    await expect(adjustSkill(service(), { ...write, actor: gmA, delta: 0.35 })).rejects.toMatchObject({ code: "invalid_adjustment" });
    await expect(adjustSkill(service(), { ...write, actor: gmA, delta: "0.1" })).rejects.toMatchObject({ code: "invalid_adjustment" });
    await expect(adjustSkill(service(), { ...write, actor: gmA, delta: 0.1, reasonCode: "other", reasonNote: "  " })).rejects.toMatchObject({ code: "invalid_reason" });
    await expect(rateNewHire(service(), { ...write, actor: gmA, rating: 1.05 })).rejects.toMatchObject({ code: "invalid_rating" });
    expect(db.log).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a GM cannot adjust another GM (strictly outrank), read from the subject's trusted role", async () => {
    await expect(adjustSkill(service(), { ...write, actor: gmA, userId: GM_A, delta: 0.1 })).rejects.toMatchObject({ code: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("GM adjusts: the RPC gets the delta in cents; audited people.skill_adjust WITHOUT the note", async () => {
    await adjustSkill(service(), { ...write, actor: gmA, delta: 0.1 + 0.2 - 0.2, reasonCode: "other", reasonNote: " covered " });
    expect(rpc).toHaveBeenCalledWith("record_skill_adjustment", {
      p_actor: GM_A, p_location: A, p_user: EMP, p_position: P_WALK, p_delta: 0.1, p_reason: "other", p_note: "covered",
    });
    const call = vi.mocked(audit).mock.calls[0]![0];
    expect(call).toMatchObject({ action: "people.skill_adjust", actorId: GM_A, metadata: { location_id: A, user_id: EMP, position_id: P_WALK, delta: 0.1, reason_code: "other" } });
    expect(JSON.stringify(call)).not.toContain("covered");
  });

  it("MoO rates a new hire at any shop: audited people.skill_rating", async () => {
    await rateNewHire(service(), { ...write, actor: moo, rating: 0.65 });
    expect(rpc).toHaveBeenCalledWith("record_skill_rating", expect.objectContaining({ p_rating: 0.65, p_actor: MOO }));
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "people.skill_rating", metadata: { rating: 0.65 } });
  });

  it("an RPC refusal maps by name; an unknown error is write_failed", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "position_retired" } });
    await expect(adjustSkill(service(), { ...write, actor: gmA, delta: 0.1 })).rejects.toMatchObject({ status: 409, code: "position_retired" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(adjustSkill(service(), { ...write, actor: gmA, delta: 0.1 })).rejects.toMatchObject({ status: 500, code: "write_failed" });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("Astra chunk E #2 — a write names a position on an ACTIVE station (refused before the RPC)", () => {
  it("adjust, rate and the shop's prep position: a position whose station was deactivated → 409 position_retired, no RPC", async () => {
    const t = tables();
    for (const s of t.stations!) if (s.id === ST_A_WALK || s.id === ST_A_PREP) s.active = false;
    db = createFakeDb(t);
    await expect(adjustSkill(service(), { ...write, actor: gmA, delta: 0.1 })).rejects.toMatchObject({ status: 409, code: "position_retired" });
    await expect(rateNewHire(service(), { ...write, actor: gmA, rating: 0.5 })).rejects.toMatchObject({ status: 409, code: "position_retired" });
    await expect(savePeopleShopSettings(service(), { actor: gmA, locationId: A, pmV2: false, prepPositionId: P_PREP })).rejects.toMatchObject({ status: 409, code: "position_retired" });
    await expect(adjustSkill(service(), { ...write, actor: gmA, positionId: P_B, delta: 0.1 })).rejects.toMatchObject({ status: 404, code: "position_not_at_shop" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("saveSkillTunables / savePeopleShopSettings", () => {
  it("tunables: MoO+ only (a GM is refused before I/O); an invalid set is refused naming the key and never reaches the database", async () => {
    await expect(saveSkillTunables(service(), { actor: gmA, locationId: null, tunables: SKILL_TUNABLE_DEFAULTS })).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveSkillTunables(service(), { actor: moo, locationId: null, tunables: { ...SKILL_TUNABLE_DEFAULTS, priorStrength: 0 } }))
      .rejects.toMatchObject({ status: 400, code: "invalid_tunables", key: "priorStrength" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: { id: "t1", before: null, after: SKILL_TUNABLE_DEFAULTS }, error: null });
    await saveSkillTunables(service(), { actor: moo, locationId: null, tunables: { ...SKILL_TUNABLE_DEFAULTS, weights: { pm: 3, closeOnTime: 1, prepYield: 1 } } });
    expect(rpc).toHaveBeenCalledWith("save_skill_tunables", expect.objectContaining({ p_actor: MOO, p_location: null }));
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "people.skill_tunables_update", metadata: { location_id: null, before: null } });
  });

  it("shop settings: GM own shop; PM v2 ON is refused until the shop's criteria are seeded (pm_v2_not_ready); an AGM is refused; audited before/after", async () => {
    await expect(savePeopleShopSettings(service(), { actor: agmA, locationId: A, pmV2: false, prepPositionId: P_PREP })).rejects.toMatchObject({ code: "forbidden" });
    // CC gate ruling: a GM can no longer flip the switch at all (MoO+ only); a MoO still meets the readiness gate.
    await expect(savePeopleShopSettings(service(), { actor: gmA, locationId: A, pmV2: true, prepPositionId: P_PREP })).rejects.toMatchObject({ status: 403, code: "pm_v2_moo_only" });
    await expect(savePeopleShopSettings(service(), { actor: moo, locationId: A, pmV2: true, prepPositionId: P_PREP })).rejects.toMatchObject({ status: 409, code: "pm_v2_not_ready" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: { before: null, after: { pm_v2: false, prep_position_id: P_PREP } }, error: null });
    expect(await savePeopleShopSettings(service(), { actor: gmA, locationId: A, pmV2: false, prepPositionId: P_PREP })).toEqual({ pmV2: false, prepPositionId: P_PREP });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "people.shop_settings_update", metadata: { location_id: A, before: null } });
  });
});
