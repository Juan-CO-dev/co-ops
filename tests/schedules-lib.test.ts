/**
 * Scheduling Phase 2, Task 17 — the schedules lib and the settings writers over an in-memory shop (the PostgREST fake +
 * fake definer RPCs that mirror the 0274 / 0275 contract; tests/fixtures/schedule/lib-store.ts).
 *
 *  - every act decides its rule BEFORE any I/O (a client that throws on any read proves zero queries on a refusal);
 *  - generate → buildWeek (validator-clean) → commit_schedule_revision(generated, expected null) with the exact args;
 *  - ROUND-TRIP PARITY: what was committed reloads complete and replays to exactly the recorded problems; after
 *    membership, availability and budget change the original validation is unchanged and the advisory names each change;
 *  - REPLAY WITHOUT LIVE READS: a client that throws on every non-revision table; (a) equal-total curves swapped live,
 *    (b) a day-type override added, (c) catering added and cancelled → identical replay, the advisory names them;
 *  - demand `unavailable` refuses generate / preview / apply and writes nothing;
 *  - the horizon: preview + token; preview_stale on drift; an edited week skipped unless confirmed; a mid-range failure
 *    answers {landed, skipped, failed};
 *  - history end to end; edits record their problems; structural refusals by name; approve (new errors only; never a
 *    revision); r4 P1: an inherited unresolved_search gap refuses approve BEFORE the RPC;
 *  - the settings writers; every refusal has an HTTP status.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { audit } = await import("@/lib/audit");
const lib = await import("@/lib/scheduling/schedules");
const settings = await import("@/lib/scheduling/settings");
const { loadSchedulingInputs } = await import("@/lib/scheduling/inputs");
const { SCHEDULE_ERROR_CODES, SCHEDULE_ERROR_STATUS, ScheduleError } = await import("@/lib/scheduling/errors-shared");
const { checkCertificate } = await import("@/lib/scheduling/rules-shared");
import type { PeopleActor } from "@/lib/people/access-shared";
import type { SchedulingInputs } from "@/lib/scheduling/inputs-shared";
import type { DayForecast } from "@/lib/scheduling/demand-shared";
import type { RuleProblem } from "@/lib/scheduling/rules-shared";
import { A, AGM, B, GM, GM_B, MOO, P_REG, P_WALK, SMM, STAFF, noIoClient, scheduleStore, shopTables, uid } from "./fixtures/schedule/lib-store";

const NOW = new Date("2026-10-21T16:00:00Z"); // Wed Oct 21, noon ET
const WEEK = "2026-10-26";
const DAYS = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
const actor = (userId: string, role: PeopleActor["role"], level: number, locations: string[]): PeopleActor => ({ userId, role, level, locations });
const gm = actor(GM, "gm", 7, [A]);
const agm = actor(AGM, "agm", 6, [A]);
const smm = actor(SMM, "social_media_mgr", 6, [A]);
const moo = actor(MOO, "moo", 8, []);
const gmB = actor(GM_B, "gm", 7, [B]);

const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof ScheduleError ? e.code : `throw:${(e as Error).message}`; } };
const curve = (peakHour: number, total = 400000) => { const h = new Array<number>(24).fill(0); for (const x of [11, 12, 13, 14]) h[x] = 50000; h[peakHour] = h[peakHour]! + 100000; h[11] = h[11]! + (total - 300000); return h; };
const okDay = (date: string, hourlyCents: number[]): DayForecast => ({ kind: "ok", date, hourlyCents, dayCents: hourlyCents.reduce((a, b) => a + b, 0), weeks: 4,
  basis: "trailing_same_weekday", weeksAhead: 1, confidence: "normal", unknownCents: 0, catering: [] });
const withMut = (mut: (i: SchedulingInputs) => void) => async (svc: Parameters<typeof loadSchedulingInputs>[0], a: Parameters<typeof loadSchedulingInputs>[1]) => {
  const i = await loadSchedulingInputs(svc, a); mut(i); return i;
};
function shop(opts: Parameters<typeof scheduleStore>[1] = {}, tablesMut: (t: ReturnType<typeof shopTables>) => void = () => {}) {
  const t = shopTables();
  tablesMut(t);
  const s = scheduleStore(t, opts);
  return { ...s, deps: { service: s.client, now: NOW, newId: s.newId } };
}
const commits = (calls: Array<{ fn: string; args: Record<string, unknown> }>) => calls.filter((c) => c.fn === "commit_schedule_revision");

describe("every act runs access-shared BEFORE any I/O", () => {
  it("SMM by role, a GM of another shop, an AGM approving, a non-MoO switching the shop: refused with ZERO queries", async () => {
    const deps = { service: noIoClient(), now: NOW };
    expect(await code(lib.generateWeek(deps, { actor: smm, locationId: A, weekStart: WEEK, expectedHead: null }))).toBe("schedule_role_refused");
    expect(await code(lib.generateWeek(deps, { actor: gmB, locationId: A, weekStart: WEEK, expectedHead: null }))).toBe("shop_not_allowed");
    expect(await code(lib.approveWeek(deps, { actor: agm, locationId: A, weekStart: WEEK, expectedHead: uid(1) }))).toBe("schedule_forbidden");
    expect(await code(settings.saveShopSettings(deps, { actor: gm, locationId: A, enabled: true, estimatedHourlyCents: null, estimatedSalariedWeeklyCents: null, agmAccess: "read" }))).toBe("schedule_forbidden");
    expect(await code(settings.saveStructure(deps, { actor: smm, locationId: A, expectedId: null, structure: {} }))).toBe("schedule_role_refused");
    expect(await code(lib.previewHorizon(deps, { actor: gmB, locationId: A, request: { mode: "next_week" } }))).toBe("shop_not_allowed");
  });
  it("an AGM building reads ONLY the shop's agm_access row first, and is refused while it is 'read'", async () => {
    const s = shop();
    expect(await code(lib.generateWeek(s.deps, { actor: agm, locationId: A, weekStart: WEEK, expectedHead: null }))).toBe("schedule_forbidden");
    expect(s.calls).toEqual([]);
    (s.tables.schedule_shop_settings![0] as Record<string, unknown>).agm_access = "edit";
    expect(await code(lib.generateWeek(s.deps, { actor: agm, locationId: A, weekStart: WEEK, expectedHead: null }))).toBe("ok");
  });
});

describe("generate → buildWeek → commit_schedule_revision; round-trip parity", () => {
  it("generates a week with no revision: one commit (generated, expected null, 7 days, the context + digest), audited; validator-clean", async () => {
    const s = shop();
    const r = await lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
    expect(r.kind).toBe("generated");
    expect(r.problems.newErrors).toBe(0);
    const c = commits(s.calls);
    expect(c).toHaveLength(1);
    expect(Object.keys(c[0]!.args).sort()).toEqual(["p_actor", "p_context", "p_days", "p_expected_head", "p_gaps", "p_kind", "p_location", "p_meta", "p_shifts", "p_structure_version", "p_week_start"]);
    expect(c[0]!.args).toMatchObject({ p_actor: GM, p_location: A, p_week_start: WEEK, p_expected_head: null, p_kind: "generated", p_structure_version: null });
    expect((c[0]!.args.p_days as unknown[]).length).toBe(7);
    expect((c[0]!.args.p_meta as Record<string, unknown>)).toMatchObject({ actor_context: "user", generator_version: "p2.5" });
    expect(vi.mocked(audit).mock.calls.some(([a]) => a.action === "schedule.generate")).toBe(true);
    expect(await code(lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null }))).toBe("head_moved");
  });

  it("reload → replay against the STORED context gives exactly the recorded problems; after membership / availability / budget change the verdict holds and the advisory names each change", async () => {
    const s = shop();
    await lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
    const first = await lib.replayWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK });
    expect(first.identical).toBe(true);
    // Live changes after the commit:
    (s.tables.users!.find((u) => u.id === STAFF[0]) as Record<string, unknown>).active = false; // a person deactivated
    s.tables.users!.push({ id: uid(77), name: "New", role: "employee", active: true });
    s.tables.user_locations!.push({ user_id: uid(77), location_id: A, active: true, assigned_at: "2026-10-01T12:00:00Z" }); // a qualified person added
    s.tables.toast_time_entries = [1, 2, 3, 4].map((n) => ({ location_id: A, time_entry_guid: `t${n}`, business_date: ["2026-09-24", "2026-10-01", "2026-10-08", "2026-10-15"][n - 1],
      user_id: STAFF[1], in_at: `${["2026-09-24", "2026-10-01", "2026-10-08", "2026-10-15"][n - 1]}T13:00:00Z`, out_at: `${["2026-09-24", "2026-10-01", "2026-10-08", "2026-10-15"][n - 1]}T17:00:00Z`, hours: 4, deleted: false }));
    s.tables.schedule_budget_entries!.push({ id: "e9", location_id: A, scope: "week", week_start: WEEK, month: null, hours: 70, source: "manager", suggestion_digest: null, apportioned_by: "even", created_at: "2026-10-21T13:00:00Z" });
    for (const d of DAYS) s.tables.schedule_budget_days!.push({ entry_id: "e9", location_id: A, business_date: d, hours: 10 });
    const again = await lib.replayWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK });
    expect(again.identical).toBe(true);
    expect(JSON.stringify(again.replayed)).toBe(JSON.stringify(first.replayed));
    const adv = await lib.currentInputsAdvisory(s.deps, { actor: gm, locationId: A, weekStart: WEEK });
    const codes = adv.map((a) => `${a.code}:${a.userId ?? a.date ?? ""}`);
    expect(codes).toContain(`member_removed:${STAFF[0]}`);
    expect(codes).toContain(`member_added:${uid(77)}`);
    expect(adv.some((a) => a.code === "availability_changed" && a.userId === STAFF[1] && a.date === "2026-10-29")).toBe(true);
    expect(adv.filter((a) => a.code === "budget_changed").map((a) => a.date)).toEqual(DAYS);
    // Every stored certificate still verifies against the stored context.
    const w = (await import("@/lib/scheduling/inputs")).loadWeekHeads;
    const head = (await w(s.client, A, [WEEK]))[WEEK]!.head!;
    for (const g of head.gaps) expect(checkCertificate(g, { locationId: A, weekStart: WEEK, shifts: head.shifts, gaps: head.gaps, days: head.days }, head.context)).toBe(true);
  });

  it("the display summary is truncated at 50 while the day rows are complete", () => {
    const ps: RuleProblem[] = Array.from({ length: 120 }, (_, i) => ({ code: "soft_range", severity: "warning", day: WEEK, userId: `u${i}`, params: {}, inherited: false }));
    const sum = lib.problemsSummary(ps);
    expect((sum.first as unknown[]).length).toBe(50);
    expect(sum.total).toBe(120);
    expect(sum.counts).toEqual({ soft_range: 120 });
  });
});

describe("replay makes NO live read (r4 P2): the snapshot alone", () => {
  /** A client over the same tables whose every read of a non-revision table, and every RPC, throws. */
  const revisionOnly = (client: ReturnType<typeof scheduleStore>["client"]) => ({
    from: (t: string) => {
      if (!["schedule_weeks", "schedule_revisions", "schedule_revision_shifts", "schedule_revision_days", "schedule_revision_gaps", "schedule_revision_contexts"].includes(t)) throw new Error(`live read: ${t}`);
      return client.from(t);
    },
    rpc: (f: string) => { throw new Error(`live rpc: ${f}`); },
  }) as unknown as typeof client;

  it("(a) equal-total shifted curves swapped live, (b) a day-type override added, (c) catering added and cancelled → identical replay; the advisory names each", async () => {
    const mon = curve(12), tue = curve(13);
    expect(mon.reduce((a, b) => a + b, 0)).toBe(tue.reduce((a, b) => a + b, 0));
    let swapped = false;
    let catering = [{ id: "cp-thu", date: "2026-10-29", name: "Thu", headcount: 80, valueCents: 1, eventQ: 50 }];
    const s = shop();
    const deps = {
      ...s.deps,
      loadInputs: withMut((i) => {
        i.demand = { kind: "ok", days: DAYS.map((d) => okDay(d, d === "2026-10-26" ? (swapped ? tue : mon) : d === "2026-10-27" ? (swapped ? mon : tue) : curve(12))) };
        i.catering = catering;
      }),
    };
    await lib.generateWeek(deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
    const before = await lib.replayWeek({ ...s.deps, service: revisionOnly(s.client) }, { actor: gm, locationId: A, weekStart: WEEK });
    expect(before.identical).toBe(true);
    swapped = true;
    s.tables.schedule_day_types!.push({ id: "dt1", location_id: A, business_date: "2026-10-28", day_type: "busy", created_at: "2026-10-21T13:00:00Z" });
    catering = [{ id: "cp-fri", date: "2026-10-30", name: "Fri", headcount: 60, valueCents: 1, eventQ: 48 }];
    const after = await lib.replayWeek({ ...s.deps, service: revisionOnly(s.client) }, { actor: gm, locationId: A, weekStart: WEEK });
    expect(after.identical).toBe(true);
    expect(JSON.stringify(after.replayed)).toBe(JSON.stringify(before.replayed));
    const adv = await lib.currentInputsAdvisory(deps, { actor: gm, locationId: A, weekStart: WEEK });
    const by = (c: string) => adv.filter((a) => a.code === c).map((a) => a.date);
    expect(by("demand_changed")).toEqual(["2026-10-26", "2026-10-27"]);
    expect(by("day_type_changed")).toContain("2026-10-28");
    expect(by("catering_changed")).toEqual(["2026-10-29", "2026-10-30"]);
  });
});

describe("demand unavailable never builds (r2 P2-6)", () => {
  it("generate, preview and apply refuse demand_unavailable; nothing is committed; an existing head is untouched", async () => {
    const s = shop();
    await lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
    const head = s.tables.schedule_weeks![0]!.head_revision_id;
    const down = { ...s.deps, loadInputs: withMut((i) => { i.demand = { kind: "unavailable", cause: "timeout" }; }) };
    expect(await code(lib.generateWeek(down, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: head as string }))).toBe("demand_unavailable");
    expect(await code(lib.previewHorizon(down, { actor: gm, locationId: A, request: { mode: "next_week" } }))).toBe("demand_unavailable");
    expect(await code(lib.applyHorizon(down, { actor: gm, locationId: A, request: { mode: "next_week" }, token: "x", confirmedWeekStarts: [] }))).toBe("demand_unavailable");
    expect(commits(s.calls)).toHaveLength(1);
    expect(s.tables.schedule_weeks![0]!.head_revision_id).toBe(head);
  });
});

describe("the horizon: preview, token, apply", () => {
  it("preview returns per-week What changed + a token; apply with the token lands; any input drift → preview_stale", async () => {
    const s = shop();
    const p = await lib.previewHorizon(s.deps, { actor: gm, locationId: A, request: { mode: "next_weeks", n: 2 } });
    expect(p.weeks.map((w) => w.weekStart)).toEqual([WEEK, "2026-11-02"]);
    expect(p.weeks[1]!.confidence).toBe("further_out");
    expect(typeof p.token).toBe("string");
    s.tables.schedule_day_types!.push({ id: "dt", location_id: A, business_date: "2026-10-27", day_type: "busy", created_at: "2026-10-21T13:00:00Z" });
    expect(await code(lib.applyHorizon(s.deps, { actor: gm, locationId: A, request: { mode: "next_weeks", n: 2 }, token: p.token, confirmedWeekStarts: [] }))).toBe("preview_stale");
    const p2 = await lib.previewHorizon(s.deps, { actor: gm, locationId: A, request: { mode: "next_weeks", n: 2 } });
    const r = await lib.applyHorizon(s.deps, { actor: gm, locationId: A, request: { mode: "next_weeks", n: 2 }, token: p2.token, confirmedWeekStarts: [] });
    expect(r.landed.map((x) => x.weekStart)).toEqual([WEEK, "2026-11-02"]);
    expect(r.failed).toBeNull();
    expect(commits(s.calls).every((c) => (c.args.p_meta as Record<string, unknown>).horizon_run_id === r.horizonRunId)).toBe(true);
  });

  it("an EDITED week is rebuilt only when confirmed (the flag reaches SQL); unconfirmed it is skipped and named", async () => {
    const s = shop();
    const g = await lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
    const e = await lib.saveEdit(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: g.revisionId, op: { kind: "addShift", date: "2026-10-27", userId: STAFF[7]!, startQ: 44, endQ: 60, positionId: P_REG } });
    const p = await lib.previewHorizon(s.deps, { actor: gm, locationId: A, request: { mode: "next_week" } });
    expect(p.weeks[0]).toMatchObject({ edited: true, headRevisionId: e.revisionId });
    expect(lib.overwritesConfirmedEdits(p, [])).toBe(false);
    const skipped = await lib.applyHorizon(s.deps, { actor: gm, locationId: A, request: { mode: "next_week" }, token: p.token, confirmedWeekStarts: [] });
    expect(skipped).toMatchObject({ landed: [], skipped: [{ weekStart: WEEK, code: "edited_week_unconfirmed" }], failed: null });
    expect(lib.overwritesConfirmedEdits(p, [WEEK])).toBe(true);
    const done = await lib.applyHorizon(s.deps, { actor: gm, locationId: A, request: { mode: "next_week" }, token: p.token, confirmedWeekStarts: [WEEK] });
    expect(done.landed).toHaveLength(1);
    expect((commits(s.calls).at(-1)!.args.p_meta as Record<string, unknown>).confirmed_overwrite).toBe(true);
    expect(vi.mocked(audit).mock.calls.some(([a]) => a.action === "schedule.regenerate_overwrite")).toBe(true);
    // generateWeek over an edited head without the confirmation is refused before the RPC.
    const n = commits(s.calls).length;
    const head = s.tables.schedule_weeks![0]!.head_revision_id as string;
    await lib.saveEdit(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: head, op: { kind: "addShift", date: "2026-10-28", userId: STAFF[7]!, startQ: 44, endQ: 60, positionId: P_REG } });
    const h2 = s.tables.schedule_weeks![0]!.head_revision_id as string;
    expect(await code(lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: h2 }))).toBe("edited_week_unconfirmed");
    expect(commits(s.calls).length).toBe(n + 1);
  });

  it("a mid-range failure reports which weeks landed (a named partial result)", async () => {
    const s = shop({ failCommitOnWeek: "2026-11-02" });
    const p = await lib.previewHorizon(s.deps, { actor: gm, locationId: A, request: { mode: "next_weeks", n: 3 } });
    const r = await lib.applyHorizon(s.deps, { actor: gm, locationId: A, request: { mode: "next_weeks", n: 3 }, token: p.token, confirmedWeekStarts: [] });
    expect(r.landed.map((x) => x.weekStart)).toEqual([WEEK]);
    expect(r.failed).toEqual({ weekStart: "2026-11-02", code: "history_changed" });
  });
});

describe("history (r2 P1-3) end to end; edits; approve", () => {
  const MON = "2026-10-19";
  const thisWeek = "2026-10-19";
  it("a Monday edit with a rule break → Tuesday the week regenerates; Monday's problem is carried, inherited; a deactivated person's past shift does not block", async () => {
    const s = shop();
    const mon = { ...s.deps, now: new Date("2026-10-19T14:00:00Z") };
    const g = await lib.generateWeek(mon, { actor: gm, locationId: A, weekStart: thisWeek, expectedHead: null });
    const e = await lib.saveEdit(mon, { actor: gm, locationId: A, weekStart: thisWeek, expectedHead: g.revisionId, op: { kind: "addShift", date: MON, userId: STAFF[6]!, startQ: 40, endQ: 44, positionId: P_REG } });
    expect(e.problems.some((p) => p.code === "shift_below_minimum" && !p.inherited)).toBe(true);
    (s.tables.users!.find((u) => u.id === STAFF[6]) as Record<string, unknown>).active = false;
    const tue = { ...s.deps, now: new Date("2026-10-20T14:00:00Z") };
    const r = await lib.generateWeek(tue, { actor: gm, locationId: A, weekStart: thisWeek, expectedHead: e.revisionId, confirmEdited: true });
    expect(r.kind).toBe("regenerated");
    const last = commits(s.calls).at(-1)!;
    const monDay = (last.args.p_days as Array<Record<string, unknown>>).find((d) => d.date === MON)!;
    expect(monDay).toMatchObject({ inherited: true, originRevisionId: e.revisionId });
    expect((monDay.problems as RuleProblem[]).some((p) => p.code === "shift_below_minimum" && p.inherited)).toBe(true);
    expect((last.args.p_shifts as Array<Record<string, unknown>>).some((x) => x.userId === STAFF[6] && x.date === MON)).toBe(true);
  });

  it("Astra chunk E P3-5: a malformed op ({}, []) is refused invalid_payload by the lib itself, before any read", async () => {
    for (const op of [{}, [], { kind: "move", shift: { date: WEEK, userId: "u", startQ: 44 } }]) {
      await expect(lib.saveEdit({ service: noIoClient() }, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: "h", op: op as never })).rejects.toMatchObject({ code: "invalid_payload" });
    }
  });

  it("saveEdit records the edit's problems; a structural failure is refused by name; a stale head is head_moved; a past day is day_locked", async () => {
    const s = shop();
    const g = await lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
    const add = (startQ: number, endQ: number, head = g.revisionId) => lib.saveEdit(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: head, op: { kind: "addShift", date: "2026-10-27", userId: STAFF[7]!, startQ, endQ, positionId: P_WALK } });
    const ok = await add(44, 60);
    expect(commits(s.calls).at(-1)!.args).toMatchObject({ p_kind: "edited", p_expected_head: g.revisionId });
    expect((commits(s.calls).at(-1)!.args.p_meta as Record<string, unknown>).revision_id).toBe(ok.revisionId);
    expect(await code(add(50, 70, ok.revisionId))).toBe("edit_overlap");
    expect(await code(add(70, 80, g.revisionId))).toBe("head_moved");
    expect(await code(lib.saveEdit(s.deps, { actor: gm, locationId: A, weekStart: "2026-10-19", expectedHead: ok.revisionId, op: { kind: "addShift", date: "2026-10-19", userId: STAFF[7]!, startQ: 44, endQ: 60, positionId: P_WALK } })))
      .toMatch(/day_locked|week_not_found/);
  });

  it("approve: a NEW error refuses rules_failing before the RPC; an INHERITED error does not; an approval is a fact, never a revision; again is a no-op", async () => {
    const s = shop();
    const { commitRevisionCall } = await import("@/lib/scheduling/rpc-args-shared");
    const err: RuleProblem = { code: "shift_below_minimum", severity: "error", day: "2026-10-27", userId: STAFF[7]!, q: 44, params: {}, inherited: false };
    const put = async (head: string | null, problemsFor: (d: string) => { problems: RuleProblem[]; inherited: boolean; origin: string | null }) => {
      const call = commitRevisionCall({ actorId: GM, locationId: A, weekStart: WEEK, expectedHead: head, kind: head ? "regenerated" : "generated", structureVersionId: null,
        shifts: [], days: DAYS.map((d) => { const x = problemsFor(d); return { date: d, originRevisionId: x.origin, structureVersionId: "defaults", inherited: x.inherited, problems: x.problems }; }),
        gaps: [], context: { version: 1, locationId: A, weekStart: WEEK, today: "2026-10-21", dates: DAYS, days: {}, budgetByDate: {}, closingWindowByDate: {}, people: {} },
        meta: { actorContext: "user", inputsDigest: "d", generatorVersion: "p2.4", problemsSummary: {}, contextDigest: "c" } });
      return String(((await s.client.rpc(call.fn, call.args)).data as Record<string, unknown>).revision_id);
    };
    const r1 = await put(null, (d) => ({ problems: d === "2026-10-27" ? [err] : [], inherited: false, origin: null }));
    const before = s.calls.length;
    expect(await code(lib.approveWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: r1 }))).toBe("rules_failing");
    expect(s.calls.slice(before).filter((c) => c.fn === "approve_schedule_week")).toEqual([]);
    expect(await code(lib.approveWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: uid(999) }))).toBe("head_moved");
    // The same error carried on an INHERITED day does not block (J18).
    const r2 = await put(r1, (d) => ({ problems: d === "2026-10-27" ? [{ ...err, inherited: true }] : [], inherited: d === "2026-10-27", origin: d === "2026-10-27" ? r1 : null }));
    const revisions = s.tables.schedule_revisions!.length;
    const a = await lib.approveWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: r2 });
    expect(a).toMatchObject({ alreadyApproved: false, revisionId: r2 });
    expect(s.tables.schedule_revisions!.length).toBe(revisions); // approval is a fact, not a revision
    expect(s.tables.schedule_week_approvals).toHaveLength(1);
    expect((await lib.approveWeek(s.deps, { actor: moo, locationId: A, weekStart: WEEK, expectedHead: r2 })).alreadyApproved).toBe(true);
    expect(vi.mocked(audit).mock.calls.filter(([x]) => x.action === "schedule.week_approve").length).toBeGreaterThanOrEqual(1);
  });

  it("r4 P1: an unresolved_search gap on Sunday → a partial rebuild carries it (inherited) → approve refuses unresolved_gaps BEFORE the RPC; the mirror refuses too", async () => {
    const s = shop();
    const g = await lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
    // Plant an unresolved_search gap on Sunday in the head (as the generator would declare one).
    const unresolved = { revision_id: g.revisionId, location_id: A, business_date: "2026-11-01", code: "coverage_gap", position_id: P_WALK, from_q: 60, to_q: 64, cause: "unresolved_search",
      certificate: { searched: { steps: 200, donorsTried: 8, chainDepth: 3 }, limits: { REPAIR_MAX_STEPS: 200, maxDonors: 8, maxChainDepth: 3 }, candidateIds: [] } };
    s.tables.schedule_revision_gaps!.push(unresolved);
    const p = await lib.previewHorizon({ ...s.deps, now: new Date("2026-10-27T14:00:00Z") }, { actor: gm, locationId: A, request: { mode: "rest_of_month" } });
    const r = await lib.applyHorizon({ ...s.deps, now: new Date("2026-10-27T14:00:00Z") }, { actor: gm, locationId: A, request: { mode: "rest_of_month" }, token: p.token, confirmedWeekStarts: [] });
    expect(r.landed.map((x) => x.weekStart)).toEqual([WEEK]);
    const sunday = (commits(s.calls).at(-1)!.args.p_gaps as Array<Record<string, unknown>>).filter((x) => x.date === "2026-11-01");
    expect(sunday.some((x) => x.cause === "unresolved_search")).toBe(true);
    const before = s.calls.length;
    const head = s.tables.schedule_weeks![0]!.head_revision_id as string;
    expect(await code(lib.approveWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: head }))).toBe("unresolved_gaps");
    expect(s.calls.slice(before).filter((c) => c.fn === "approve_schedule_week")).toEqual([]);
    const { approveWeekCall } = await import("@/lib/scheduling/rpc-args-shared");
    const call = approveWeekCall({ actorId: GM, locationId: A, weekStart: WEEK, expectedHead: head });
    expect((await s.client.rpc(call.fn, call.args)).error?.message).toBe("unresolved_gaps");
  });
});

describe("the settings writers", () => {
  it("structure: an invalid structure is refused by key, nothing written; a valid one saves (structure_moved on a stale expected id), audited before/after", async () => {
    const s = shop();
    expect(await code(settings.saveStructure(s.deps, { actor: gm, locationId: A, expectedId: null, structure: { version: 2 } }))).toBe("structure_invalid");
    expect(s.calls).toEqual([]);
    const inputs = await loadSchedulingInputs(s.client, { locationId: A, weekStarts: [WEEK], now: NOW });
    const r = await settings.saveStructure(s.deps, { actor: gm, locationId: A, expectedId: inputs.structure.id, structure: inputs.structure.structure });
    expect(r.beforeId).toBeNull();
    expect(await code(settings.saveStructure(s.deps, { actor: gm, locationId: A, expectedId: null, structure: inputs.structure.structure }))).toBe("structure_moved");
    expect(vi.mocked(audit).mock.calls.some(([a]) => a.action === "schedule.structure_update" && (a.metadata as Record<string, unknown>).after_id === r.afterId)).toBe(true);
  });
  it("shop settings: MoO+ only; wage estimates validated; audited", async () => {
    const s = shop();
    expect(await code(settings.saveShopSettings(s.deps, { actor: moo, locationId: A, enabled: true, estimatedHourlyCents: 0, estimatedSalariedWeeklyCents: null, agmAccess: "read" }))).toBe("wage_estimate_invalid");
    await settings.saveShopSettings(s.deps, { actor: moo, locationId: A, enabled: true, estimatedHourlyCents: 1900, estimatedSalariedWeeklyCents: null, agmAccess: "edit" });
    expect(vi.mocked(audit).mock.calls.some(([a]) => a.action === "schedule.shop_settings_update")).toBe(true);
  });
  it("budget: a week entry apportioned evenly without a forecast (7 rows, exactly the hours); a bad quarter-hour is budget_invalid; keep needs the current digest", async () => {
    const s = shop();
    const r = await settings.setBudget(s.deps, { actor: gm, locationId: A, scope: "week", weekStart: WEEK, month: null, hours: 70 });
    expect(r.days).toBe(7);
    const call = s.calls.find((c) => c.fn === "record_schedule_budget_entry")!;
    expect(call.args).toMatchObject({ p_scope: "week", p_week_start: WEEK, p_hours: 70, p_source: "manager", p_apportioned_by: "even" });
    expect((call.args.p_days as Array<{ hours: number }>).reduce((n, d) => n + d.hours, 0)).toBe(70);
    expect(await code(settings.setBudget(s.deps, { actor: gm, locationId: A, scope: "week", weekStart: WEEK, month: null, hours: 70.1 }))).toBe("budget_invalid");
    expect(await code(settings.keepBudget(s.deps, { actor: gm, locationId: A, weekStart: WEEK, digest: "not-it" }))).toBe("preview_stale");
    expect(await code(settings.acceptBudgetSuggestion(s.deps, { actor: gm, locationId: A, weekStart: WEEK, digest: "x" }))).toBe("suggestion_unavailable"); // no reference week yet
  });
  it("day types and pins: GM own shop; a past date is day_locked; audited", async () => {
    const s = shop();
    await settings.setDayType(s.deps, { actor: gm, locationId: A, date: "2026-10-28", dayType: "busy" });
    expect(await code(settings.setDayType(s.deps, { actor: gm, locationId: A, date: "2026-10-20", dayType: "busy" }))).toBe("day_locked");
    expect(await code(settings.setPin(s.deps, { actor: gm, locationId: A, pin: { date: "2026-10-28", userId: MOO, startQ: 60, endQ: 50, positions: [], kind: "presence" } }))).toBe("pin_invalid");
    await settings.setPin(s.deps, { actor: gm, locationId: A, pin: { date: "2026-10-28", userId: MOO, startQ: 44, endQ: 60, positions: [], kind: "presence" } });
    expect(vi.mocked(audit).mock.calls.filter(([a]) => a.action === "schedule.day_type_set" || a.action === "schedule.pin_set").length).toBeGreaterThanOrEqual(2);
  });
});

describe("refusals: every code has its HTTP status", () => {
  it("SCHEDULE_ERROR_STATUS covers the closed list with a 4xx / 5xx", () => {
    for (const c of SCHEDULE_ERROR_CODES) expect([400, 403, 404, 409, 422, 500, 503]).toContain(SCHEDULE_ERROR_STATUS[c]);
    expect(SCHEDULE_ERROR_STATUS.demand_unavailable).toBe(503);
    expect(SCHEDULE_ERROR_STATUS.preview_stale).toBe(409);
    expect(lib.rpcRefusal).toBeTypeOf("function");
    expect(() => lib.rpcRefusal({ message: "head_moved" })).toThrow(ScheduleError);
    expect(() => lib.rpcRefusal({ code: "PGRST202", message: "x" })).toThrow(expect.objectContaining({ code: "inputs_unavailable" }));
    expect(() => lib.rpcRefusal({ message: "something else" })).toThrow(/schedule rpc/);
  });
});
