/**
 * Scheduling Phase 2, chunk F — `loadBoard`, the board's ONE loader, over the in-memory PostgREST fake and the real
 * generator / commit mirror (tests/fixtures/schedule/lib-store):
 *  - permissions first (the social media manager refused by ROLE before any read);
 *  - not installed (0275 missing) and OFF (no settings row / switch off; MoO+ may turn it on);
 *  - a GM's ready view: the head, 7 day contexts, names and position labels from the shop's own rows;
 *  - an edited head stores only the edited date's context: the other days read their ORIGIN revision's context;
 *  - an AGM's view carries no money key;
 *  - demand unavailable → the banner and the existing draft unchanged.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const lib = await import("@/lib/scheduling/schedules");
const { loadBoard } = await import("@/lib/scheduling/board");
const { ScheduleError } = await import("@/lib/scheduling/errors-shared");
import type { PeopleActor } from "@/lib/people/access-shared";
import { A, AGM, GM, MOO, P_REG, P_WALK, SMM, STAFF, noIoClient, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";

const NOW = new Date("2026-10-21T16:00:00Z"); // Wed Oct 21, noon ET
const WEEK = "2026-10-26";
const actor = (userId: string, role: PeopleActor["role"], level: number, locations: string[]): PeopleActor => ({ userId, role, level, locations });
const gm = actor(GM, "gm", 7, [A]);
const agm = actor(AGM, "agm", 6, [A]);
const smm = actor(SMM, "social_media_mgr", 6, [A]);
const moo = actor(MOO, "moo", 8, []);
function shop(mut: (t: ReturnType<typeof shopTables>) => void = () => {}, opts: Parameters<typeof scheduleStore>[1] = {}) {
  const t = shopTables();
  mut(t);
  const s = scheduleStore(t, opts);
  return { ...s, deps: { service: s.client, now: NOW, newId: s.newId } };
}
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof ScheduleError ? e.code : `throw:${(e as Error).message}`; } };

describe("loadBoard — states and permissions", () => {
  it("the social media manager is refused by ROLE before any read", async () => {
    expect(await code(loadBoard({ service: noIoClient(), now: NOW }, { actor: smm, locationId: A, weekStart: WEEK }))).toBe("schedule_role_refused");
  });
  it("0275 not applied → not_installed; switch off / no row → off (only MoO+ may turn it on)", async () => {
    expect(await loadBoard(shop((t) => { delete t.schedule_weeks; }).deps, { actor: gm, locationId: A, weekStart: WEEK })).toEqual({ state: "not_installed" });
    expect(await loadBoard(shop((t) => { t.schedule_shop_settings = []; }).deps, { actor: gm, locationId: A, weekStart: WEEK })).toEqual({ state: "off", canTurnOn: false, locationId: A });
    expect(await loadBoard(shop((t) => { t.schedule_shop_settings![0]!.enabled = false; }).deps, { actor: moo, locationId: A, weekStart: WEEK })).toEqual({ state: "off", canTurnOn: true, locationId: A });
  });
});

describe("loadBoard — the ready view", () => {
  it("a GM: the head, 7 day contexts, names and position labels from the shop's rows; no week yet → Generate", async () => {
    const s = shop();
    const empty = await loadBoard(s.deps, { actor: gm, locationId: A, weekStart: WEEK });
    expect(empty.state).toBe("ready");
    if (empty.state !== "ready") return;
    expect(empty.week).toBeNull();
    expect(empty.generate.disabled).toBe(false);
    const g = await lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
    const v = await loadBoard(s.deps, { actor: gm, locationId: A, weekStart: WEEK });
    if (v.state !== "ready") throw new Error("not ready");
    expect(v.week).toMatchObject({ headRevisionId: g.revisionId, approved: false, edited: false });
    expect(v.days).toHaveLength(7);
    expect(v.days.every((d) => d.bounds !== null)).toBe(true);
    expect(v.positions[P_REG]).toMatchObject({ name: "Register" });
    expect(v.positions[P_WALK]).toMatchObject({ name: "Walk-ins" });
    expect(v.names[STAFF[0]!]).toBe("Staff 0");
    expect(v.perms).toMatchObject({ canSeeMoney: true, canEdit: true, canApprove: true, canEditStructure: true, canManageSwitch: false });
  });

  it("an edited head stores only the edited date's context; every other day reads its ORIGIN revision's context", async () => {
    const s = shop();
    const g = await lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
    await lib.saveEdit(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: g.revisionId, op: { kind: "addShift", date: "2026-10-27", userId: STAFF[7]!, startQ: 44, endQ: 60, positionId: P_REG } });
    const v = await loadBoard(s.deps, { actor: gm, locationId: A, weekStart: WEEK });
    if (v.state !== "ready") throw new Error("not ready");
    expect(v.week!.edited).toBe(true);
    expect(v.days.map((d) => d.bounds !== null)).toEqual([true, true, true, true, true, true, true]);
    expect(v.days.find((d) => d.date === "2026-10-27")!.rows.some((r) => r.userId === STAFF[7])).toBe(true);
  });

  it("an AGM reads the board with NO money key anywhere; edit is off unless the shop grants it", async () => {
    const s = shop();
    await lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
    const v = await loadBoard(s.deps, { actor: agm, locationId: A, weekStart: WEEK });
    if (v.state !== "ready") throw new Error("not ready");
    expect(v.perms).toMatchObject({ canSeeMoney: false, canEdit: false, canApprove: false, canBudget: false });
    expect(JSON.stringify(v)).not.toMatch(/"(money|hourlyCostCents|totalPct|maxLaborCents|blendedWageCents|centsByHour)"/);
  });

  it("demand unavailable → the banner, Generate disabled, the existing draft shown unchanged", async () => {
    const ok = shop();
    await lib.generateWeek(ok.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
    const before = await loadBoard(ok.deps, { actor: gm, locationId: A, weekStart: WEEK });
    const down = scheduleStore(ok.tables, { baseline: () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }) });
    const v = await loadBoard({ service: down.client, now: NOW }, { actor: gm, locationId: A, weekStart: WEEK });
    if (v.state !== "ready" || before.state !== "ready") throw new Error("not ready");
    expect(v.banners.map((b) => b.id)).toContain("demand_unavailable");
    expect(v.generate.disabled).toBe(true);
    expect(v.days.map((d) => d.rows.length)).toEqual(before.days.map((d) => d.rows.length));
    expect(down.calls.filter((c) => c.fn === "commit_schedule_revision")).toEqual([]);
  });
});
