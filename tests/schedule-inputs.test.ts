/**
 * Scheduling Phase 2, Task 16 — THE ONE LOADER and its extractions, over the in-memory PostgREST fake.
 *
 *  - demand is DISCRIMINATED: a timeout, a missing RPC and an RPC error are `unavailable` with their cause; a
 *    successful empty history is `no_history` — never conflated; the pulse keeps mapping every non-ok to null;
 *  - `computeSkillMatrixForShop` IS `loadSkillMatrix`'s matrix (the gate is the only difference);
 *  - the opt-in `closingFinalization` family leaves `closingLines` byte-identical and adds the finalization facts;
 *  - `loadSchedulingInputs` gathers every fact once; before 0274 / 0275 it answers `inputs_unavailable`;
 *  - the pure assembly (`generatorInputFor`): demand unavailable refuses; the override wins the day type; per-date
 *    budgets; the head's stored reasons are carried; the defaults structure maps to NULL for SQL;
 *  - no wage leaves the server as a per-person field (a key scan of the assembled week's people view).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { fetchSalesBaseline, BASELINE_DEADLINE_MS } = await import("@/lib/pulse/sales");
const { computeSkillMatrixForShop, loadSkillMatrix } = await import("@/lib/people/skills");
const { loadPeopleFacts } = await import("@/lib/people/facts");
const { loadSchedulingInputs, loadSchedulingDemand } = await import("@/lib/scheduling/inputs");
const {
  STRUCTURE_DEFAULTS_ID, closingFacts, eventQFromWindow, firstSeenFor, generatorInputFor, memberSinceDate, overrideFor, sqlStructureVersion, toCateringEvents, tsStructureVersion,
} = await import("@/lib/scheduling/inputs-shared");
const { ScheduleError } = await import("@/lib/scheduling/errors-shared");
const { forecastWeek } = await import("@/lib/scheduling/demand-shared");
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchedulingInputs } from "@/lib/scheduling/inputs-shared";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GM = id(1), EMP = id(4), EMP2 = id(7), KH = id(8);
const ST = id(11), P_REG = id(21), P_WALK = id(22);
const NOW = new Date("2026-10-21T16:00:00Z"); // Wed Oct 21, noon ET
const WEEK = "2026-10-26";

function baseTables(): Tables {
  return {
    users: [
      { id: GM, name: "Alex", role: "gm", active: true }, { id: EMP, name: "Eli", role: "employee", active: true },
      { id: EMP2, name: "Zoe", role: "employee", active: true }, { id: KH, name: "Kai", role: "key_holder", active: true },
    ],
    user_locations: [GM, EMP, EMP2, KH].map((u, i) => ({ user_id: u, location_id: A, active: true, assigned_at: `2026-0${i + 1}-01T12:00:00Z` })),
    stations: [{ id: ST, location_id: A, name: "Line", name_es: "Línea", sort: 1, active: true, usually_closes_at: "21:00:00", trims: null }],
    station_positions: [
      { id: P_REG, station_id: ST, location_id: A, name: "Register", name_es: null, sort: 1, active: true, usually_trims_at: null },
      { id: P_WALK, station_id: ST, location_id: A, name: "Walk-ins", name_es: null, sort: 2, active: true, usually_trims_at: null },
    ],
    station_events: [], checklist_templates: [{ id: "tA", location_id: A, type: "closing" }],
    checklist_instances: [
      { id: "iA", location_id: A, template_id: "tA", date: "2026-10-14", dropped_at: null, shift_start_at: null, triggered_at: null, status: "confirmed", confirmed_at: "2026-10-15T01:40:00Z" },
      { id: "iB", location_id: A, template_id: "tA", date: "2026-10-15", dropped_at: null, shift_start_at: null, triggered_at: null, status: "open", confirmed_at: null },
    ],
    checklist_submissions: [{ id: "s1", instance_id: "iA", is_final_confirmation: true }],
    checklist_template_items: [{ id: "li1", template_id: "tA", station: "Line", active: true }],
    checklist_completions: [{ id: "cc1", instance_id: "iA", template_item_id: "li1", completed_by: EMP, completed_at: "2026-10-15T01:30:00Z", superseded_at: null, revoked_at: null }],
    productions: [], people_skill_adjustments: [], people_skill_ratings: [], people_skill_tunables: [], people_shop_settings: [],
    schedule_shop_settings: [{ location_id: A, enabled: true, estimated_hourly_cents: 1800, estimated_salaried_weekly_cents: 120000, agm_access: "read" }],
    schedule_structures: [], schedule_person_settings: [], schedule_budget_entries: [], schedule_budget_days: [], schedule_day_types: [], schedule_pins: [],
    schedule_weeks: [], schedule_revisions: [], schedule_revision_shifts: [], schedule_revision_days: [], schedule_revision_gaps: [], schedule_revision_contexts: [],
    catering_pipeline: [{ id: "cp1", location_id: A, contact_name: "Pat", company: "Acme", event_date: "2026-10-29", time_window: "11:30 AM - 1 PM", headcount: 80, stage: "confirmed", delivery_address: null, estimated_revenue_cents: 90000 }],
    catering_quotes: [], ezcater_orders: [],
    toast_time_entries: [
      { location_id: A, time_entry_guid: "t1", business_date: "2026-10-12", user_id: EMP, in_at: "2026-10-12T14:00:00Z", out_at: "2026-10-12T20:00:00Z", hours: 6, deleted: false },
      { location_id: A, time_entry_guid: "t2", business_date: "2026-10-12", user_id: null, in_at: "2026-10-12T14:00:00Z", out_at: "2026-10-12T20:00:00Z", hours: 6, deleted: false },
    ],
    audit_log: [{ id: 1, action: "schedule.budget_kept", resource_id: A, metadata: { digest: "abc123" } }],
  };
}

type RpcHandler = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
function client(tables: Tables, rpc: RpcHandler): SupabaseClient {
  const fake = createFakeDb(tables);
  return { from: fake.client.from, rpc: (name: string, args: Record<string, unknown>) => {
    const p = rpc(name, args);
    return Object.assign(p, { abortSignal: () => p });
  } } as unknown as SupabaseClient;
}
const emptyHistory: RpcHandler = async () => ({ data: { hours: [], captured_days: [] }, error: null });

afterEach(() => { vi.useRealTimers(); });

describe("demand is discriminated (r2 P2-6): the three failures are named, the empty success is no_history", () => {
  it("a timeout → unavailable/timeout (the request is aborted at the deadline)", async () => {
    vi.useFakeTimers();
    const p = fetchSalesBaseline(client({}, () => new Promise(() => {})), { locationId: A, asOf: "2026-10-21" });
    await vi.advanceTimersByTimeAsync(BASELINE_DEADLINE_MS);
    expect(await p).toEqual({ kind: "unavailable", cause: "timeout" });
  });
  it("a missing RPC (PGRST202 / 42883) → unavailable/rpc_missing; any other error → rpc_error", async () => {
    for (const code of ["PGRST202", "42883"]) {
      expect(await fetchSalesBaseline(client({}, async () => ({ data: null, error: { code, message: "missing" } })), { locationId: A, asOf: "2026-10-21" }))
        .toEqual({ kind: "unavailable", cause: "rpc_missing" });
    }
    expect(await fetchSalesBaseline(client({}, async () => ({ data: null, error: { code: "57014", message: "canceling statement" } })), { locationId: A, asOf: "2026-10-21" }))
      .toEqual({ kind: "unavailable", cause: "rpc_error" });
  });
  it("a successful EMPTY history → no_history (never unavailable); the RPC window is the 28 days before as-of", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const c = client({}, async (_n, args) => { calls.push(args); return { data: { hours: [], captured_days: [] }, error: null }; });
    const { baseline } = await loadSchedulingDemand(c, A, ["2026-10-26"], "2026-10-21");
    expect(baseline.kind).toBe("ok");
    expect(forecastWeek(baseline, ["2026-10-26"], "2026-10-21").kind).toBe("no_history");
    expect(calls[0]).toEqual({ p_location_id: A, p_from: "2026-09-23", p_to: "2026-10-20" });
  });
});

describe("the extractions keep their callers identical", () => {
  it("computeSkillMatrixForShop IS loadSkillMatrix's matrix (byte for byte)", async () => {
    const c = client(baseTables(), emptyHistory);
    const gated = await loadSkillMatrix(c, { actor: { userId: GM, role: "gm", level: 7, locations: [A] }, locationId: A, now: NOW });
    const raw = await computeSkillMatrixForShop(c, A, NOW);
    expect(JSON.stringify(raw)).toBe(JSON.stringify(gated));
    expect(raw.people.length).toBeGreaterThan(0);
  });
  it("closingFinalization is opt-in: closingLines rows are identical with and without it; it adds status + final confirmation", async () => {
    const c = client(baseTables(), emptyHistory);
    const window = { bounds: { start: "2026-10-01T04:00:00Z", end: "2026-10-21T04:00:00Z" }, dates: { from: "2026-10-01", to: "2026-10-20" } };
    const subject = { kind: "team" as const, memberIds: [EMP] };
    const plain = await loadPeopleFacts(c, { locationId: A, subject, window, families: ["closingLines"] });
    const fin = await loadPeopleFacts(c, { locationId: A, subject, window, families: ["closingLines", "closingFinalization"] });
    for (const k of ["closingInstances", "closingItems", "closingCompletions"] as const) expect(fin.skills[k]).toEqual(plain.skills[k]);
    expect(plain.skills.closingStatus).toEqual([]);
    expect(fin.skills.closingStatus).toEqual([
      { id: "iA", status: "confirmed", confirmed_at: "2026-10-15T01:40:00Z", final_confirmation: true },
      { id: "iB", status: "open", confirmed_at: null, final_confirmation: false },
    ]);
    expect(closingFacts(fin.skills)).toMatchObject([{ instanceId: "iA", hasFinalConfirmation: true, lastLiveCompletionAt: "2026-10-15T01:30:00Z" }, { instanceId: "iB", status: "open" }]);
    await expect(loadPeopleFacts(c, { locationId: A, subject, window, families: ["closingFinalization"] })).rejects.toThrow();
  });
});

describe("Astra chunk E P2-4: the membership date is the OPERATIONAL (America/New_York) date of assigned_at", () => {
  it("a Sunday-night ET assignment stays Sunday (UTC would say Monday); EST and EDT both; null and junk stay null", () => {
    expect(memberSinceDate("2026-10-26T02:30:00Z")).toBe("2026-10-25"); // Sun Oct 25, 10:30 PM EDT
    expect(memberSinceDate("2026-11-09T04:30:00Z")).toBe("2026-11-08"); // Sun Nov 8, 11:30 PM EST
    expect(memberSinceDate("2026-10-26T12:00:00Z")).toBe("2026-10-26");
    expect(memberSinceDate(null)).toBeNull();
    expect(memberSinceDate("not a date")).toBeNull();
  });
  it("the loader applies it: a member assigned Sunday night ET has memberSince = that Sunday", async () => {
    const t = baseTables();
    t.user_locations = t.user_locations!.map((r) => (r.user_id === EMP ? { ...r, assigned_at: "2026-10-19T03:15:00Z" } : r)); // Sun Oct 18, 11:15 PM EDT
    const inputs = await loadSchedulingInputs(client(t, emptyHistory), { locationId: A, weekStarts: [WEEK], now: NOW });
    expect(inputs.members.find((m) => m.userId === EMP)!.memberSince).toBe("2026-10-18");
  });
});

describe("loadSchedulingInputs — the one batch loader", () => {
  it.each([{}, [], { 1: { mode: "works" } }])("falls back to Toast when stored availability has a bad shape: %j", async (availability) => {
    const tables = baseTables();
    tables.schedule_person_settings!.push({ id: "bad-availability", location_id: A, user_id: EMP,
      work_type: null, created_at: NOW.toISOString(), availability });
    const inputs = await loadSchedulingInputs(client(tables, emptyHistory), { locationId: A, weekStarts: [WEEK], now: NOW });
    expect(inputs.personSettings.find((p) => p.userId === EMP)?.availability).toBeNull();
  });

  it("gathers every fact for the weeks: settings, the seeded structure, members with their since date, demand, catering, punches, closing, kept digests", async () => {
    const inputs = await loadSchedulingInputs(client(baseTables(), emptyHistory), { locationId: A, weekStarts: [WEEK], now: NOW });
    expect(inputs.asOf).toBe("2026-10-21");
    expect(inputs.shopSettings).toEqual({ enabled: true, estimatedHourlyCents: 1800, estimatedSalariedWeeklyCents: 120000, agmAccess: "read" });
    expect(inputs.structure.source).toBe("defaults");
    expect(inputs.structure.id).toBe(STRUCTURE_DEFAULTS_ID);
    expect(Object.keys(inputs.structure.structure.positions).sort()).toEqual([P_REG, P_WALK].sort());
    expect(inputs.members.map((m) => [m.userId, m.memberSince])).toEqual([[GM, "2026-01-01"], [EMP, "2026-02-01"], [EMP2, "2026-03-01"], [KH, "2026-04-01"]]);
    expect(inputs.demand.kind).toBe("no_history");
    expect(inputs.catering).toEqual([{ id: "cp1", date: "2026-10-29", name: "Pat (Acme)", headcount: 80, valueCents: 90000, eventQ: 46 }]);
    expect(inputs.punches.map((p) => p.userId)).toEqual([EMP]); // linked rows only
    expect(inputs.closing.samples).toBe(1);
    expect(inputs.keptBudgetDigests).toEqual(["abc123"]);
    expect(inputs.weeks[WEEK]).toMatchObject({ headRevisionId: null, head: null, edited: false });
    expect(inputs.wages).toEqual({ byUserCents: {}, source: "none" }); // 7shifts not ready: no wage read at all
  });
  it("demand that does not load is `unavailable` with its cause (never a flat curve)", async () => {
    const inputs = await loadSchedulingInputs(client(baseTables(), async () => ({ data: null, error: { code: "PGRST202", message: "missing" } })), { locationId: A, weekStarts: [WEEK], now: NOW });
    expect(inputs.demand).toEqual({ kind: "unavailable", cause: "rpc_missing" });
    expect(() => generatorInputFor(inputs, WEEK, { today: inputs.asOf })).toThrow(ScheduleError);
    try { generatorInputFor(inputs, WEEK, { today: inputs.asOf }); } catch (e) { expect((e as InstanceType<typeof ScheduleError>).code).toBe("demand_unavailable"); }
  });
  it("before 0274 / 0275 are applied → inputs_unavailable (503), never a 500", async () => {
    const t = baseTables();
    const fake = createFakeDb(t);
    const c = { from: (table: string) => (table.startsWith("schedule_")
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } }) }) }) }
      : fake.client.from(table)), rpc: emptyHistory } as unknown as SupabaseClient;
    await expect(loadSchedulingInputs(c, { locationId: A, weekStarts: [WEEK], now: NOW })).rejects.toMatchObject({ code: "inputs_unavailable" });
  });
  it("a saved structure wins; a week's head is loaded complete with its STORED reasons and its own context; edited = an edit after the last build", async () => {
    const t = baseTables();
    const inputs0 = await loadSchedulingInputs(client(t, emptyHistory), { locationId: A, weekStarts: [WEEK], now: NOW });
    const saved = structuredClone(inputs0.structure.structure);
    t.schedule_structures = [{ id: id(90), location_id: A, structure: saved, created_at: "2026-10-01T00:00:00Z" }];
    const rev1 = id(100), rev2 = id(101);
    t.schedule_weeks = [{ id: id(99), location_id: A, week_start: WEEK, head_revision_id: rev2, approved_revision_id: null }];
    t.schedule_revisions = [
      { id: rev1, week_id: id(99), location_id: A, kind: "generated", based_on_revision_id: null, structure_version_id: null, inputs_digest: "d", generator_version: "p2.4", created_by: GM, actor_context: "user", created_at: "2026-10-20T10:00:00Z" },
      { id: rev2, week_id: id(99), location_id: A, kind: "edited", based_on_revision_id: rev1, structure_version_id: id(90), inputs_digest: "d", generator_version: "p2.4", created_by: GM, actor_context: "user", created_at: "2026-10-20T11:00:00Z" },
    ];
    const seg = [{ positionId: P_REG, startQ: 44, endQ: 60 }];
    t.schedule_revision_shifts = [{ revision_id: rev2, location_id: A, user_id: EMP, business_date: "2026-10-27", start_q: 44, end_q: 60, segments: seg, closing_manager: false, flex: false, pinned: false, reasons: { shift: [{ key: "catering_prep", params: { hours: 4 } }], segments: [[]], alternates: [] } }];
    t.schedule_revision_days = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"].map((d) => ({ revision_id: rev2, location_id: A, business_date: d, origin_revision_id: d === "2026-10-27" ? rev2 : rev1, structure_version_id: d === "2026-10-27" ? id(90) : null, inherited: d !== "2026-10-27", problems: [] }));
    t.schedule_revision_contexts = [{ revision_id: rev2, location_id: A, context: { version: 1, locationId: A, weekStart: WEEK, today: "2026-10-21", dates: [], days: {}, budgetByDate: {}, closingWindowByDate: { "2026-10-26": { fromQ: 80, toQ: 83 } }, people: {} }, context_digest: "x" }];
    const inputs = await loadSchedulingInputs(client(t, emptyHistory), { locationId: A, weekStarts: [WEEK], now: NOW });
    expect(inputs.structure).toMatchObject({ id: id(90), source: "saved" });
    const w = inputs.weeks[WEEK]!;
    expect(w).toMatchObject({ headRevisionId: rev2, edited: true });
    expect(w.head!.reasons).toEqual({ [`2026-10-27|${EMP}|44`]: { shift: [{ key: "catering_prep", params: { hours: 4 } }], segments: [[]], alternates: [] } });
    expect(w.head!.days.find((d) => d.date === "2026-10-26")!.structureVersionId).toBe(STRUCTURE_DEFAULTS_ID); // NULL → the defaults sentinel
    expect(w.head!.context.closingWindowByDate["2026-10-26"]).toEqual({ fromQ: 80, toQ: 83 });
  });
});

describe("the pure assembly (generatorInputFor and its readers)", () => {
  const inputsWith = async (mut: (t: Tables) => void = () => {}): Promise<SchedulingInputs> => {
    const t = baseTables();
    mut(t);
    return loadSchedulingInputs(client(t, emptyHistory), { locationId: A, weekStarts: [WEEK], now: NOW });
  };
  it("confirmed crew rebuilds release historical dates; unconfirmed builds preserve them", async () => {
    const inputs = await inputsWith();
    inputs.structure.structure.engine = "crew";
    const prior = generatorInputFor(inputs, WEEK, { today: inputs.asOf });
    const { generateWeek } = await import("@/lib/scheduling/generator/dispatch-shared");
    const out = generateWeek(prior);
    inputs.weeks[WEEK] = { weekStart: WEEK, weekId: "week", headRevisionId: "head", approvedRevisionId: null, edited: false, historicalEditedDates: [WEEK], head: { revision: { id: "head" } as never, shifts: out.shifts, days: out.days, gaps: out.gaps, reasons: out.reasons, context: out.context } };
    expect(generatorInputFor(inputs, WEEK, { today: inputs.asOf }).days.map((d) => d.date)).not.toContain(WEEK);
    expect(generatorInputFor(inputs, WEEK, { today: inputs.asOf, confirmEdited: true }).days.map((d) => d.date)).toContain(WEEK);
  });
  it("the manager's override wins the day type; budgets are per DATE (newest entry); kept days come from the head", async () => {
    const inputs = await inputsWith((t) => {
      t.schedule_day_types = [
        { id: "d1", location_id: A, business_date: "2026-10-28", day_type: "slow", created_at: "2026-10-01T00:00:00Z" },
        { id: "d2", location_id: A, business_date: "2026-10-28", day_type: "busy", created_at: "2026-10-02T00:00:00Z" },
      ];
      t.schedule_budget_entries = [{ id: "e1", location_id: A, scope: "week", week_start: WEEK, month: null, hours: 70, source: "manager", suggestion_digest: null, apportioned_by: "even", created_at: "2026-10-01T00:00:00Z" }];
      t.schedule_budget_days = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"].map((d) => ({ entry_id: "e1", location_id: A, business_date: d, hours: 10 }));
    });
    expect(overrideFor(inputs.dayTypes, "2026-10-28")).toEqual({ id: "d2", dayType: "busy" });
    const g = generatorInputFor(inputs, WEEK, { today: inputs.asOf });
    expect(g.days.find((d) => d.date === "2026-10-28")).toMatchObject({ dayType: "busy", dayTypeSource: "override", overrideId: "d2", demandKind: "no_history" });
    expect(g.days.find((d) => d.date === "2026-10-31")).toMatchObject({ dayType: "weekend", dayTypeSource: "weekend" });
    expect(Object.values(g.budgetByDate)).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect(g.days.find((d) => d.date === "2026-10-29")!.catering).toEqual([{ id: "cp1", headcount: 80, eventQ: 46 }]);
    expect(g.structureVersionId).toBe(STRUCTURE_DEFAULTS_ID);
    expect(sqlStructureVersion(g.structureVersionId)).toBeNull();
    expect(tsStructureVersion(null)).toBe(STRUCTURE_DEFAULTS_ID);
    expect(g.structure.limits.overtimeH).toBe(40);
    expect(generatorInputFor({ ...inputs, overtimeH: 35 }, WEEK, { today: inputs.asOf }).structure.limits.overtimeH).toBe(35); // 7shifts' line once synced
  });
  it("no wage is ever a per-person field of anything the board receives: wages are server-side cents only (key scan)", async () => {
    const inputs = await inputsWith();
    const g = generatorInputFor(inputs, WEEK, { today: inputs.asOf });
    // The generator input is server-side; the RuleContext it produces (stored, replayed, and the board's source) carries no wage.
    const { buildWeek } = await import("@/lib/scheduling/generator/build-shared");
    const ctx = buildWeek(g).context;
    const keys = new Set<string>();
    const walk = (v: unknown) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
    walk(ctx);
    expect([...keys].filter((k) => /wage|cents_per|rate/i.test(k))).toEqual([]);
  });
  it("readers: the catering window's first clock time; ezCater orders not in the pipeline; the person-specific first day", () => {
    expect(eventQFromWindow("11:30 AM - 1 PM")).toBe(46);
    expect(eventQFromWindow("12pm")).toBe(48);
    expect(eventQFromWindow("13:00")).toBe(52);
    expect(eventQFromWindow("lunch")).toBeNull();
    const ev = toCateringEvents([], [{ id: "ez1", event_date: "2026-10-29", event_timestamp: null, handoff_time: "11:00 AM", headcount: 40, total_cents: 50000, status: "confirmed" },
      { id: "ez2", event_date: "2026-10-29", event_timestamp: null, handoff_time: null, headcount: 10, total_cents: 1, status: "cancelled" }], () => 0);
    expect(ev).toEqual([{ id: "ez1", date: "2026-10-29", name: "ezCater", headcount: 40, valueCents: 50000, eventQ: 44 }]);
    const since = firstSeenFor([{ userId: EMP, name: "E", role: "employee", memberSince: "2026-01-01" }, { userId: EMP2, name: "Z", role: "employee", memberSince: "2026-01-01" }],
      [{ userId: EMP, businessDate: "2026-08-25", inAt: "", outAt: null, hours: 4, deleted: false }, { userId: EMP2, businessDate: "2026-10-05", inAt: "", outAt: null, hours: 4, deleted: false }], "2026-08-24");
    expect(since).toEqual({ [EMP2]: "2026-10-05" }); // a first-week punch = present from before the window; a later first punch floors it
  });
});

describe("staff separations (0279): on leave and separated people never reach the roster; history is untouched", () => {
  const ev = (userId: string, kind: string, at: string, extra: Record<string, unknown> = {}) => ({ id: `ev-${userId}-${kind}`, user_id: userId, kind, corrects_id: null,
    leave_reason: kind === "leave_start" ? "school" : null, expected_back: null, separation_type: kind === "separated" ? "fired" : null,
    last_day_worked: kind === "separated" ? "2026-10-15" : null, reason: kind === "separated" ? "r" : null, rehire: kind === "separated" ? "no" : null,
    rehire_note: kind === "separated" ? "n" : null, note: null, actor_id: GM, created_at: at, ...extra });
  const load = async (rows: Record<string, unknown>[] | undefined) => {
    const t = baseTables();
    if (rows) t.user_employment_events = rows;
    // EMP's account is ACTIVE (reactivated by mistake) yet separated; EMP2 is active and on leave; KH came back from leave.
    t.schedule_pins = [
      { id: "pin-emp", location_id: A, business_date: "2026-10-27", user_id: EMP, start_q: 40, end_q: 60, positions: [], kind: "added", active: true, retires_id: null },
      { id: "pin-kh", location_id: A, business_date: "2026-10-27", user_id: KH, start_q: 40, end_q: 60, positions: [], kind: "added", active: true, retires_id: null },
    ];
    return loadSchedulingInputs(client(t, emptyHistory), { locationId: A, weekStarts: [WEEK], now: NOW });
  };
  it("the loader names them; the generator input drops them and their open future pins; the members (history names) stay", async () => {
    const inputs = await load([ev(EMP, "separated", "2026-10-16T12:00:00Z"), ev(EMP2, "leave_start", "2026-10-16T12:00:00Z"),
      ev(KH, "leave_start", "2026-10-01T12:00:00Z"), ev(KH, "leave_end", "2026-10-10T12:00:00Z")]);
    expect([...(inputs.employmentExcluded ?? [])].sort()).toEqual([EMP, EMP2].sort());
    expect(inputs.members.map((m) => m.userId)).toEqual(expect.arrayContaining([EMP, EMP2, KH]));
    const g = generatorInputFor(inputs, WEEK, { today: inputs.asOf });
    const roster = g.people.map((p) => p.userId);
    expect(roster).not.toContain(EMP);
    expect(roster).not.toContain(EMP2);
    expect(roster).toContain(KH);
    expect(g.pins.map((p) => p.id)).toEqual(["pin-kh"]);
  });
  it("no record (or 0279 not applied) excludes nobody: the generator input is unchanged", async () => {
    const none = await load(undefined);
    const empty = await load([]);
    expect(none.employmentExcluded).toEqual([]);
    expect(JSON.stringify(generatorInputFor(empty, WEEK, { today: empty.asOf }))).toBe(JSON.stringify(generatorInputFor(none, WEEK, { today: none.asOf })));
    expect(generatorInputFor(none, WEEK, { today: none.asOf }).people.map((p) => p.userId)).toEqual(expect.arrayContaining([EMP, EMP2, KH]));
  });
});
