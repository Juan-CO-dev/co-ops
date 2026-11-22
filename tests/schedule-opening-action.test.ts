/**
 * PR SCH (plan r5 4.5, 20.1, 20.2 flow, 20.4, 22.1; rulings C7, C8, D1, D2, D4, F1): `setDayOpening`, the per-date earlier
 * opening, over the in-memory shop (tests/fixtures/schedule/lib-store.ts — the 0275 writer mirror):
 *  - who: GM own and MoO+ any are allowed; a GM elsewhere, an AGM even with edit access, the catering manager and the
 *    social media manager are refused — before any I/O;
 *  - the data refusals, each by name, nothing written: an accept with no proposal, a decline with nothing to decline, a date
 *    outside the week, a past date, a stale head, a bad manual start, a clear with nothing to clear;
 *  - what it writes: ONE edited revision (the shifts unchanged) and ONE `schedule.opening_set` audit row;
 *  - D1 / F1: a decision survives an edit of ANOTHER date, a reload and a regenerate, on both engines; an INHERITED proposal is
 *    accepted (and an inherited automatic opening declined) after another date's edit; a stale head is refused.
 * (The D2 open → edit → Approve flow runs on the P Street fixtures: tests/schedule-opening-crew.test.ts.)
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { audit } = await import("@/lib/audit");
const lib = await import("@/lib/scheduling/schedules");
const { loadSchedulingInputs } = await import("@/lib/scheduling/inputs");
const { ScheduleError } = await import("@/lib/scheduling/errors-shared");
import type { PeopleActor } from "@/lib/people/access-shared";
import type { SchedulingInputs } from "@/lib/scheduling/inputs-shared";
import type { DayOpening, OpeningDecisionInput } from "@/lib/scheduling/opening-shared";
import { A, AGM, B, GM, GM_B, MOO, P_REG, SMM, STAFF, noIoClient, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";

const NOW = new Date("2026-10-21T16:00:00Z"); // Wed Oct 21, noon ET
const WEEK = "2026-10-26";
const MON = "2026-10-26", TUE = "2026-10-27";
const actor = (userId: string, role: PeopleActor["role"], level: number, locations: string[]): PeopleActor => ({ userId, role, level, locations });
const gm = actor(GM, "gm", 7, [A]);
const moo = actor(MOO, "moo", 8, []);
const agm = actor(AGM, "agm", 6, [A]);
const smm = actor(SMM, "social_media_mgr", 6, [A]);
const cateringMgr = actor("cm-1", "catering_mgr", 6, [A]);
const gmB = actor(GM_B, "gm", 7, [B]);
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof ScheduleError ? e.code : `throw:${(e as Error).message}`; } };

type Engine = "stations" | "crew";
const crewIt = (i: SchedulingInputs) => {
  i.structure.structure.engine = "crew";
  i.structure.structure.shiftTypes = [{ id: "day", name: "Day", fromQ: 28, toQ: 60, minLengthQ: 16, startFlexQ: 4,
    headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [P_REG], countsTowardMod: true }];
};
function shop(engine: Engine = "stations", tablesMut: (t: ReturnType<typeof shopTables>) => void = () => {}) {
  const t = shopTables();
  tablesMut(t);
  const s = scheduleStore(t);
  const loadInputs = async (svc: Parameters<typeof loadSchedulingInputs>[0], a: Parameters<typeof loadSchedulingInputs>[1]) => {
    const i = await loadSchedulingInputs(svc, a);
    if (engine === "crew") crewIt(i);
    return i;
  };
  return { ...s, deps: { service: s.client, now: NOW, newId: s.newId, loadInputs } };
}
const commits = (calls: Array<{ fn: string; args: Record<string, unknown> }>) => calls.filter((c) => c.fn === "commit_schedule_revision");
const headOf = (s: ReturnType<typeof shop>) => String(s.tables.schedule_weeks!.find((w) => w.week_start === WEEK)!.head_revision_id);
const set = (s: ReturnType<typeof shop>, who: PeopleActor, date: string, decision: OpeningDecisionInput, head = headOf(s)) =>
  lib.setDayOpening(s.deps, { actor: who, locationId: A, weekStart: WEEK, expectedHead: head, date, decision });
const editTue = (s: ReturnType<typeof shop>, startQ = 44) => lib.saveEdit(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: headOf(s),
  op: { kind: "addShift", date: TUE, userId: STAFF[7]!, startQ, endQ: startQ + 16, positionId: P_REG } });
const reload = async (s: ReturnType<typeof shop>) => (await s.deps.loadInputs(s.client, { locationId: A, weekStarts: [WEEK], now: NOW })).weeks[WEEK]!.head!;
const storedOpening = async (s: ReturnType<typeof shop>, date: string) => {
  const h = await reload(s);
  return h.context.days[date]?.opening ?? h.inheritedOpenings?.[date];
};
/** Write a PROPOSED / AUTOMATIC opening into the head's stored context (SCH-1 never produces one; SCH-2's modes will). */
function storeOpening(s: ReturnType<typeof shop>, date: string, status: DayOpening["status"], startQ = 24) {
  const row = s.tables.schedule_revision_contexts!.find((r) => r.revision_id === headOf(s))!;
  const ctx = row.context as { days: Record<string, Record<string, unknown>> };
  ctx.days[date] = { ...ctx.days[date], opening: { status, startQ, normalStartQ: 28, triggers: ["prep_fit"], guests: 120, orders: 1 } };
}
const generate = async (s: ReturnType<typeof shop>, confirm = false) => {
  const w = s.tables.schedule_weeks?.find((x) => x.week_start === WEEK);
  return lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: (w?.head_revision_id as string | undefined) ?? null, confirmEdited: confirm });
};

describe("who may decide a date's opening (ruling C8; access before any I/O)", () => {
  it("a GM elsewhere, an AGM even with edit access, the catering manager and the social media manager are refused before any read", async () => {
    const deps = { service: noIoClient(), now: NOW };
    const at = (who: PeopleActor) => lib.setDayOpening(deps, { actor: who, locationId: A, weekStart: WEEK, expectedHead: "h", date: MON, decision: { kind: "manual", startQ: 24 } });
    expect(await code(at(gmB))).toBe("shop_not_allowed");
    expect(await code(at(smm))).toBe("schedule_role_refused");
    expect(await code(at(cateringMgr))).toBe("schedule_forbidden");
    const s = shop("stations", (t) => { t.schedule_shop_settings![0]!.agm_access = "edit"; });
    await generate(s);
    expect(await code(set(s, agm, MON, { kind: "manual", startQ: 24 }))).toBe("schedule_forbidden");
  });
  it("GM at their own shop and MoO+ at any shop are allowed", async () => {
    const s = shop();
    await generate(s);
    expect(await code(set(s, gm, MON, { kind: "manual", startQ: 24 }))).toBe("ok");
    expect(await code(set(s, moo, TUE, { kind: "manual", startQ: 26 }))).toBe("ok");
  });
});

describe("the data refusals, by name, and nothing is written (D4)", () => {
  it("accept with no proposal; decline with nothing to decline; clear with nothing to clear; a bad start; outside the week; a past date; a stale head", async () => {
    const s = shop();
    await generate(s);
    const before = commits(s.calls).length;
    expect(await code(set(s, gm, MON, { kind: "accept" }))).toBe("opening_no_proposal");
    expect(await code(set(s, gm, MON, { kind: "decline" }))).toBe("opening_nothing_to_decline");
    expect(await code(set(s, gm, MON, { kind: "clear" }))).toBe("opening_nothing_to_clear");
    for (const startQ of [24.5, -1, 28, 40, Number.NaN]) expect(await code(set(s, gm, MON, { kind: "manual", startQ })), String(startQ)).toBe("opening_start_invalid");
    expect(await code(set(s, gm, "2026-11-02", { kind: "manual", startQ: 24 }))).toBe("opening_date_not_in_week");
    expect(await code(set(s, gm, "not-a-date", { kind: "manual", startQ: 24 }))).toBe("opening_date_not_in_week");
    // A week that is not a Monday has no head, so it is not found (the head check runs first, as the contract orders).
    expect(await code(lib.setDayOpening(s.deps, { actor: gm, locationId: A, weekStart: "2026-10-27", expectedHead: headOf(s), date: TUE, decision: { kind: "manual", startQ: 24 } }))).toBe("week_not_found");
    expect(await code(set(s, gm, MON, { kind: "manual", startQ: 24 }, "stale-head"))).toBe("head_moved");
    const late = { ...s.deps, now: new Date("2026-10-27T16:00:00Z") };
    expect(await code(lib.setDayOpening(late, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: headOf(s), date: MON, decision: { kind: "manual", startQ: 24 } }))).toBe("day_locked");
    // A forged accept (with a start) and an unknown kind never reach the store.
    expect(await code(lib.setDayOpening(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: headOf(s), date: MON, decision: { kind: "accept", startQ: 2 } as never }))).toBe("invalid_payload");
    expect(commits(s.calls).length).toBe(before);
  });
  it("no week yet → week_not_found; the shop switched off → shop_not_enabled", async () => {
    expect(await code(lib.setDayOpening(shop().deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: "h", date: MON, decision: { kind: "manual", startQ: 24 } }))).toBe("week_not_found");
    const off = shop("stations", (t) => { t.schedule_shop_settings![0]!.enabled = false; });
    expect(await code(lib.setDayOpening(off.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: "h", date: MON, decision: { kind: "manual", startQ: 24 } }))).toBe("shop_not_enabled");
  });
});

describe("what it writes", () => {
  it("one EDITED revision with the shifts unchanged and the opened structure, and one schedule.opening_set audit row", async () => {
    const s = shop();
    const g = await generate(s);
    vi.mocked(audit).mockClear();
    const r = await set(s, gm, MON, { kind: "manual", startQ: 24 });
    const all = commits(s.calls);
    const last = all.at(-1)!;
    expect(last.args).toMatchObject({ p_kind: "edited", p_expected_head: g.revisionId });
    expect(JSON.stringify(last.args.p_shifts)).toBe(JSON.stringify(commits(s.calls)[0]!.args.p_shifts));
    const ctx = last.args.p_context as { days: Record<string, { opening?: DayOpening; structure: { shopDay: { prepStartQ: number } } }>; cateringRule?: string };
    expect(Object.keys(ctx.days)).toEqual([MON]);
    expect(ctx.days[MON]!.opening).toMatchObject({ status: "manual", startQ: 24, normalStartQ: 28 });
    expect(ctx.days[MON]!.structure.shopDay.prepStartQ).toBe(24);
    expect(ctx.cateringRule).toBe("day_total_v1");
    expect(r.opening).toMatchObject({ status: "manual", startQ: 24 });
    const rows = vi.mocked(audit).mock.calls.map((c) => c[0]).filter((a) => a.action === "schedule.opening_set");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ week_start: WEEK, date: MON, decision: "manual", start_q: 24, status_before: null, revision_id: r.revisionId, based_on: g.revisionId });
    expect(vi.mocked(audit).mock.calls.map((c) => c[0].action)).toEqual(["schedule.opening_set"]);
  });
});

describe("D1 / F1: a decision survives another date's edit, a reload and a regenerate — both engines", () => {
  for (const engine of ["stations", "crew"] as const) {
    for (const kind of ["accepted", "manual", "declined"] as const) {
      it(`${engine}: ${kind}`, async () => {
        const s = shop(engine);
        await generate(s);
        if (kind === "manual") await set(s, gm, MON, { kind: "manual", startQ: 24 });
        else { storeOpening(s, MON, "proposed"); await set(s, gm, MON, { kind: kind === "accepted" ? "accept" : "decline" }); }
        const want = kind === "declined" ? { status: "declined", startQ: 28 } : { status: kind, startQ: 24 };
        expect(await storedOpening(s, MON)).toMatchObject(want);
        await editTue(s);
        expect(await storedOpening(s, MON), "after Tuesday's edit").toMatchObject(want);
        await editTue(s, 60);
        expect(await storedOpening(s, MON), "after a second Tuesday edit").toMatchObject(want);
        await generate(s, true);
        const h = await reload(s);
        expect(h.context.days[MON]!.opening, "after the regenerate").toMatchObject(want);
        expect(h.context.days[MON]!.structure.shopDay.prepStartQ).toBe(kind === "declined" ? 28 : 24);
        expect(h.context.days[TUE]!.opening).toBeUndefined();
        expect(h.context.days[TUE]!.structure.shopDay.prepStartQ).toBe(28);
      }, 60000);
    }
  }
});

describe("F1: the full stored opening resolves Accept and Decline; only persistent decisions reach the generator", () => {
  for (const engine of ["stations", "crew"] as const) {
    it(`${engine}: an INHERITED proposal is accepted after another date's edit, with the proposal's start`, async () => {
      const s = shop(engine);
      await generate(s);
      storeOpening(s, MON, "proposed", 23);
      await editTue(s);
      expect(await storedOpening(s, MON)).toMatchObject({ status: "proposed", startQ: 23 });
      const r = await set(s, gm, MON, { kind: "accept" });
      expect(r.opening).toMatchObject({ status: "accepted", startQ: 23 });
    }, 60000);
    it(`${engine}: an INHERITED automatic opening is declined after another date's edit; the next regenerate keeps the normal start`, async () => {
      const s = shop(engine);
      await generate(s);
      storeOpening(s, MON, "auto", 23);
      await editTue(s);
      expect((await set(s, gm, MON, { kind: "decline" })).opening).toMatchObject({ status: "declined", startQ: 28 });
      await generate(s, true);
      const h = await reload(s);
      expect(h.context.days[MON]!.opening).toMatchObject({ status: "declined" });
      expect(h.context.days[MON]!.structure.shopDay.prepStartQ).toBe(28);
    }, 60000);
    it(`${engine}: accept or decline against the head from BEFORE another date's edit → head_moved, nothing written`, async () => {
      const s = shop(engine);
      await generate(s);
      storeOpening(s, MON, "proposed", 23);
      const stale = headOf(s);
      await editTue(s);
      const n = commits(s.calls).length;
      expect(await code(set(s, gm, MON, { kind: "accept" }, stale))).toBe("head_moved");
      expect(await code(set(s, gm, MON, { kind: "decline" }, stale))).toBe("head_moved");
      expect(commits(s.calls).length).toBe(n);
    }, 60000);
  }
});

describe("the board shows the date's opening (plan r5 4.5)", () => {
  it("the opened date carries its opening for a GM and inside the AGM allowlist; the deciding control follows the Approve rule", async () => {
    const { loadBoard } = await import("@/lib/scheduling/board");
    const { AGM_BOARD_PATHS } = await import("./fixtures/schedule/agm-board-paths");
    const s = shop();
    await generate(s);
    await set(s, gm, MON, { kind: "manual", startQ: 24 });
    const gmBoard = await loadBoard(s.deps, { actor: gm, locationId: A, weekStart: WEEK });
    if (gmBoard.state !== "ready") throw new Error(gmBoard.state);
    expect(gmBoard.days.find((d) => d.date === MON)!.opening).toEqual({ status: "manual", startQ: 24, normalStartQ: 28, triggers: [], guests: 0, engine: "stations" });
    expect(gmBoard.days.find((d) => d.date === TUE)!.opening).toBeUndefined();
    expect(gmBoard.perms.canApprove).toBe(true);
    const agmBoard = JSON.parse(JSON.stringify(await loadBoard(s.deps, { actor: agm, locationId: A, weekStart: WEEK }))) as { state: string; perms: { canApprove: boolean } };
    expect(agmBoard.perms.canApprove).toBe(false);
    const paths = new Set<string>();
    const walk = (v: unknown, p: string) => {
      if (Array.isArray(v)) { for (const x of v) walk(x, `${p}[]`); return; }
      if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) walk(x, `${p}.${p === ".names" || p === ".positions" || p.endsWith(".byDate") ? "*" : k}`); return; }
      paths.add(p);
    };
    walk(agmBoard, "");
    const allowed = new Set(AGM_BOARD_PATHS);
    expect([...paths].filter((p) => !allowed.has(p))).toEqual([]);
    expect([...paths].filter((p) => p.startsWith(".days[].opening")).sort()).toEqual([".days[].opening.engine", ".days[].opening.guests", ".days[].opening.normalStartQ", ".days[].opening.startQ", ".days[].opening.status"]);
  }, 60000);
});
