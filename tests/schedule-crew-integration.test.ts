import { describe, expect, it, vi } from "vitest";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { buildWeek } from "@/lib/scheduling/generator/build-shared";
import { applyEdit } from "@/lib/scheduling/edit-shared";
import { minCrewHours, structureDeltaHours } from "@/lib/scheduling/budget-shared";
import { historicalCrewDates, type StoredWeek } from "@/lib/scheduling/inputs-shared";
import { toContextSnapshot, ruleContextFromSnapshot } from "@/lib/scheduling/context-shared";
import { DATES, fixture, I, onePosition, SMALL_SPECS, small } from "./fixtures/schedule/fixtures";
import type { WeekSchedule } from "@/lib/scheduling/rules-shared";

function crewInput() {
  const s = onePosition((s) => {
    s.engine = "crew"; s.leadership.modRequired = false;
    s.shiftTypes = [{ id: "day", name: "Day", fromQ: 44, toQ: 64, minLengthQ: 16, startFlexQ: 0, headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [I.$REG], countsTowardMod: true }];
  });
  const i = fixture({ structure: s, specs: [{ id: "worker", role: "employee", cover: [I.$REG] }] });
  i.days = i.days.slice(0, 1);
  i.people[0]!.usualShift = { value: { typeId: "day" }, source: "manager", deletedTypeId: null };
  i.people[0]!.workModes = Object.fromEntries(DATES.map((d) => [d, "works" as const]));
  return i;
}
function schedule(out: ReturnType<typeof generateWeek>, i: ReturnType<typeof crewInput>): WeekSchedule {
  return { locationId: i.locationId, weekStart: i.weekStart, shifts: out.shifts, days: out.days, gaps: out.gaps };
}

describe("crew entry-point persistence", () => {
  it("station generate, regenerate and draft payloads stay byte-identical through dispatch", () => {
    const i = small({ specs: SMALL_SPECS });
    const direct = buildWeek(i);
    expect(JSON.stringify(generateWeek(i))).toBe(JSON.stringify(direct));
    const regeneration = { ...i, head: { revisionId: "head", shifts: direct.shifts, days: direct.days, gaps: direct.gaps, reasons: direct.reasons, closingWindowByDate: direct.context.closingWindowByDate } };
    expect(JSON.stringify(generateWeek(regeneration))).toBe(JSON.stringify(buildWeek(regeneration)));
    expect(JSON.stringify(generateWeek({ ...i, head: null }))).toBe(JSON.stringify(direct));
  });
  it("keeps a changed start and then a deletion attached to the original shift across reload/regenerate", () => {
    const i = crewInput(); const first = generateWeek(i); const before = schedule(first, i);
    const sh = first.shifts[0]!;
    expect(sh).toBeDefined();
    const move = { kind: "start" as const, shift: { date: sh.date, userId: sh.userId, startQ: sh.startQ }, toQ: sh.startQ + 2 };
    const moved = applyEdit(before, move, first.context, { today: i.today, newRevisionId: "edited" });
    const changed = moved.schedule.shifts.find((x) => x.userId === sh.userId)!;
    const remove = { kind: "removeShift" as const, shift: { date: changed.date, userId: changed.userId, startQ: changed.startQ } };
    const deleted = applyEdit(moved.schedule, remove, first.context, { today: i.today, newRevisionId: "deleted" });
    const snap = ruleContextFromSnapshot(toContextSnapshot(first.context).context);
    expect(snap.days[sh.date]!.crew!.manualOverrides).toEqual([{ original: move.shift, replacement: null }]);
    const regenerated = generateWeek({ ...i, head: { revisionId: "deleted", ...deleted.schedule, closingWindowByDate: snap.closingWindowByDate }, crew: { headContext: snap } });
    expect(regenerated.shifts.some((x) => x.date === sh.date && x.userId === sh.userId)).toBe(false);
    expect(regenerated.gaps.some((g) => g.code === "open_shift")).toBe(true);
  });
  it("retains dates lacking historical provenance without guessing the edited person", () => {
    const i = crewInput(); const out = generateWeek(i);
    const head = { context: out.context, days: out.days } as StoredWeek["head"];
    const w = { edited: true, head } as StoredWeek;
    expect(historicalCrewDates(w)).not.toContain(DATES[0]);
    delete out.context.days[DATES[0]!]!.crew;
    expect(historicalCrewDates(w)).toContain(DATES[0]);
    w.edited = false; w.historicalEditedDates = [DATES[0]!];
    expect(historicalCrewDates(w)).toEqual([DATES[0]]);
  });
  it("uses whole type hours for the crew budget minimum and structure delta", () => {
    const i = crewInput(); const s = i.structure;
    expect(minCrewHours(s, "normal", 84)).toBe(5);
    const next = structuredClone(s); next.shiftTypes![0]!.headcount.normal = 3;
    expect(structureDeltaHours({ live: next, ref: s, day: i.days[0]! })).toBe(10);
  });
});

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
it("loads earlier edited-day tombstones from origin contexts after a later day edit", async () => {
  const { loadWeekHeads } = await import("@/lib/scheduling/inputs");
  const { createFakeDb } = await import("./fixtures/counts-fake-db");
  const i = crewInput(); const out = generateWeek(i); const date = DATES[0]!; const second = DATES[1]!;
  const old = structuredClone(out.context);
  old.days[date]!.crew!.manualOverrides = [{ original: { date, userId: "worker", startQ: 44 }, replacement: null }];
  const latest = structuredClone(old);
  latest.days = { [second]: { ...structuredClone(old.days[date]!), crew: { version: 1, shifts: [], notes: [], manualOverrides: [{ original: { date: second, userId: "worker", startQ: 44 }, replacement: null }] } } };
  const revision = (id: string, kind: string, time: string) => ({ id, kind, week_id: "week", location_id: i.locationId, based_on_revision_id: null, structure_version_id: "sv", inputs_digest: "digest", generator_version: "crew.1", created_by: "manager", actor_context: "user", created_at: time });
  const db = createFakeDb({
    schedule_weeks: [{ id: "week", location_id: i.locationId, week_start: i.weekStart, head_revision_id: "edit2", approved_revision_id: null }],
    schedule_revisions: [revision("built", "generated", "2026-10-26T01:00:00Z"), revision("edit1", "edited", "2026-10-26T02:00:00Z"), revision("edit2", "edited", "2026-10-26T03:00:00Z")],
    schedule_revision_shifts: [], schedule_revision_gaps: [],
    schedule_revision_days: [date, second].map((d) => ({ revision_id: "edit2", business_date: d, origin_revision_id: d === date ? "edit1" : "edit2", structure_version_id: "sv", inherited: d === date, problems: [] })),
    schedule_revision_contexts: [{ revision_id: "edit1", context: toContextSnapshot(old).context }, { revision_id: "edit2", context: toContextSnapshot(latest).context }],
  });
  const loaded = (await loadWeekHeads(db.client, i.locationId, [i.weekStart]))[i.weekStart]!;
  expect(loaded.head!.context.days[date]!.crew!.manualOverrides).toEqual(old.days[date]!.crew!.manualOverrides);
  expect(loaded.head!.context.days[second]!.crew!.manualOverrides).toEqual(latest.days[second]!.crew!.manualOverrides);
  expect(loaded.historicalEditedDates).toEqual([]);
});

it("station actions persist the unchanged engine payload through generate, regenerate, reload and Wednesday draft", async () => {
  const actions = await import("@/lib/scheduling/schedules");
  const { runWednesdayDraft } = await import("@/lib/scheduling/draft");
  const { loadSchedulingInputs, loadWeekHeads } = await import("@/lib/scheduling/inputs");
  const { generatorInputFor } = await import("@/lib/scheduling/inputs-shared");
  const { commitRevisionCall } = await import("@/lib/scheduling/rpc-args-shared");
  const { A, GM, scheduleStore, shopTables } = await import("./fixtures/schedule/lib-store");
  const actor = { userId: GM, role: "gm" as const, level: 7, locations: [A] };
  const now = new Date("2026-10-21T16:00:00Z"), weekStart = "2026-10-26";
  const store = scheduleStore(shopTables()); const deps = { service: store.client, now, newId: store.newId };
  async function expected() {
    const inputs = await loadSchedulingInputs(store.client, { locationId: A, weekStarts: [weekStart], now });
    return buildWeek(generatorInputFor(inputs, weekStart, { today: "2026-10-21" }));
  }
  function check(out: ReturnType<typeof buildWeek>, args: Record<string, unknown>) {
    const encoded = commitRevisionCall({ actorId: GM, locationId: A, weekStart, expectedHead: null, kind: "generated", structureVersionId: null,
      shifts: out.shifts, days: out.days, gaps: out.gaps, context: toContextSnapshot(out.context).context, reasons: out.reasons,
      meta: { actorContext: "user", inputsDigest: "unused", generatorVersion: out.version, problemsSummary: {}, contextDigest: "unused" } }).args;
    expect(JSON.stringify(args.p_shifts)).toBe(JSON.stringify(encoded.p_shifts));
    expect(JSON.stringify(args.p_gaps)).toBe(JSON.stringify(encoded.p_gaps));
    expect(args.p_context).toEqual(encoded.p_context);
    expect(args.p_meta).toMatchObject({ generator_version: out.version });
  }
  const first = await expected();
  const created = await actions.generateWeek(deps, { actor, locationId: A, weekStart, expectedHead: null });
  check(first, store.calls.filter((c) => c.fn === "commit_schedule_revision").at(-1)!.args);
  const reloaded = (await loadWeekHeads(store.client, A, [weekStart]))[weekStart]!.head!;
  expect(reloaded.shifts).toEqual(first.shifts);
  expect(reloaded.reasons).toEqual(first.reasons);
  const second = await expected();
  await actions.generateWeek(deps, { actor, locationId: A, weekStart, expectedHead: created.revisionId });
  check(second, store.calls.filter((c) => c.fn === "commit_schedule_revision").at(-1)!.args);
  const draft = scheduleStore(shopTables());
  await runWednesdayDraft({ service: draft.client, now });
  check(first, draft.calls.find((c) => c.fn === "commit_schedule_revision")!.args);
});

it("crew actions, Wednesday draft and budget suggestions all invoke crew dispatch and persist its version", async () => {
  const actions = await import("@/lib/scheduling/schedules");
  const { runWednesdayDraft } = await import("@/lib/scheduling/draft");
  const { budgetSuggestion } = await import("@/lib/scheduling/settings");
  const { loadSchedulingInputs } = await import("@/lib/scheduling/inputs");
  const dispatch = await import("@/lib/scheduling/generator/dispatch-shared");
  const { A, GM, P_REG, scheduleStore, shopTables } = await import("./fixtures/schedule/lib-store");
  const actor = { userId: GM, role: "gm" as const, level: 7, locations: [A] };
  const now = new Date("2026-10-21T16:00:00Z"), weekStart = "2026-10-26";
  const loadInputs: typeof loadSchedulingInputs = async (service, args) => {
    const i = await loadSchedulingInputs(service, args);
    i.structure.structure.engine = "crew";
    i.structure.structure.shiftTypes = [{ id: "day", name: "Day", fromQ: 44, toQ: 64, minLengthQ: 16, startFlexQ: 0,
      headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [P_REG], countsTowardMod: true }];
    i.structure.structure.leadership.modRequired = false;
    return i;
  };
  const store = scheduleStore(shopTables()); const deps = { service: store.client, now, loadInputs };
  const generated = await actions.generateWeek(deps, { actor, locationId: A, weekStart, expectedHead: null });
  expect(generated.revisionId).toBeTruthy();
  expect(store.calls.find((c) => c.fn === "commit_schedule_revision")!.args.p_meta).toMatchObject({ generator_version: "crew.1" });
  const draft = scheduleStore(shopTables());
  expect(await runWednesdayDraft({ service: draft.client, now, loadInputs })).toMatchObject({ ran: true, shops: [{ outcome: "built" }] });
  expect(draft.calls.find((c) => c.fn === "commit_schedule_revision")!.args.p_meta).toMatchObject({ generator_version: "crew.1" });
  const spy = vi.spyOn(dispatch, "generateWeek");
  try {
    await budgetSuggestion(deps, { actor, locationId: A, weekStart });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.results[0]!.value.version).toBe("crew.1");
  } finally { spy.mockRestore(); }
});
