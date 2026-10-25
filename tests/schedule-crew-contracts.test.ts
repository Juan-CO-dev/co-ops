import { compareCodePoint } from "@/lib/scheduling/order-shared";
import { boardSource } from "./fixtures/schedule/board-source";
import { describe, expect, it } from "vitest";
import { CREW_MAX_MANUAL_OVERRIDES_PER_DAY, CREW_MAX_NOTES_PER_DAY, CREW_REJECTION_CODES, type CrewDaySnapshot, type OpenShiftItem } from "@/lib/scheduling/crew-contracts-shared";
import { assertContextFits, contextAdvisory, jsonbTextBytes, CONTEXT_SAFE_MAX_BYTES, ruleContextFromSnapshot, toContextSnapshot } from "@/lib/scheduling/context-shared";
import { validGapCertificateShape } from "@/lib/scheduling/shapes-shared";
import { commitRevisionCall } from "@/lib/scheduling/rpc-args-shared";
import { segmentLabel } from "@/lib/scheduling/board-format-shared";
import { modLane } from "@/lib/scheduling/board-shared";
import { boardView, modFromQOf } from "@/lib/scheduling/board-view-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { context, DATES, THU, U, WEEK, LOC, shift } from "./fixtures/schedule/rules-fixture";

const item = (): OpenShiftItem => ({ typeId: "mid", fromQ: 40, toQ: 80, required: 2, placed: 1, missing: 1,
  rejected: [{ userId: U.ben, codes: ["off"] }] });

describe("crew persisted contracts", () => {
  it("labels unassigned on-clock time in both languages and applies type MoD flags to the board", () => {
    for (const [language, strings] of [["en", en], ["es", es]] as const) {
      expect(segmentLabel({ language, positions: {}, t: (key) => strings[key] },
        { positionId: "mod", startQ: 40, endQ: 80, crewUnassigned: true })).toBe(strings["schedule.board.crew_unassigned"]);
    }
    const ctx = context({ built: [THU] });
    const day = ctx.days[THU]!;
    day.structure.engine = "crew";
    day.structure.shiftTypes = [{ id: "mid", name: "Mid", fromQ: 40, toQ: 80, startFlexQ: 0, minLengthQ: 16,
      stations: [], headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, countsTowardMod: false }];
    day.crew = { version: 1, shifts: [{ userId: U.dani, startQ: 40, typeId: "mid", source: "usual" }], manualOverrides: [], notes: [] };
    const sh = shift(U.dani, THU, 40, 80, "mod");
    expect(modFromQOf(ctx.people[U.dani], day, sh.segments[0]!, sh)).toBeNull();
    const lane = () => modLane({ date: THU, day, shifts: [sh], people: ctx.people,
      skills: { byUser: {}, closeScoreByUser: {}, bands: { building: 0.5, strong: 0.8 } }, wageCentsByUser: {} });
    expect(lane().find((h) => h.hour === 12)!.userIds).toEqual([]);
    day.structure.shiftTypes[0]!.countsTowardMod = true;
    expect(lane().find((h) => h.hour === 12)!.userIds).toEqual([U.dani]);
  });
  it("round-trips snapshots, deletion overrides, notes and shift metadata without changing station snapshots", () => {
    const ctx = context({ built: [THU] });
    expect(toContextSnapshot(ctx).context.days[THU]).not.toHaveProperty("crew");
    const crew: CrewDaySnapshot = { version: 1, shifts: [{ userId: U.ben, startQ: 40, typeId: "mid", source: "usual" }],
      manualOverrides: [{ original: { date: THU, userId: U.maya, startQ: 40 }, replacement: null },
        { original: { date: THU, userId: U.ben, startQ: 40 }, replacement: shift(U.ben, THU, 40, 80, "mod") }],
      notes: [{ code: "unbudgeted_date", date: THU, userId: null, positionId: null, params: {} }] };
    ctx.days[THU]!.crew = crew;
    const snap = toContextSnapshot(ctx);
    expect(ruleContextFromSnapshot(snap.json).days[THU]!.crew).toEqual(crew);
    expect(assertContextFits(ctx).bytes).toBeLessThan(232 * 1024);
    const call = commitRevisionCall({ actorId: U.alex, locationId: LOC, weekStart: WEEK, expectedHead: null,
      kind: "generated", structureVersionId: null, shifts: [], days: [], gaps: [], context: ctx,
      meta: { actorContext: "user", inputsDigest: "i", generatorVersion: "crew-1", problemsSummary: {}, contextDigest: snap.digest } });
    expect(call.args.p_context).toEqual(ctx);
  });

  it("accepts both certificate variants and all declared rejection codes", () => {
    expect(validGapCertificateShape("crew_shortfall", { kind: "station_short", required: 2, assigned: 1, onShiftUserIds: [U.ben] })).toBe(true);
    for (const code of CREW_REJECTION_CODES) {
      const i = item(); i.rejected[0]!.codes = [code];
      expect(validGapCertificateShape("crew_shortfall", { kind: "open_shifts", items: [i] }), code).toBe(true);
    }
  });

  it("requires grouped same-start openings, exact shapes, counts, and complete-looking unique evidence", () => {
    const valid = { kind: "open_shifts", items: [item(), { ...item(), typeId: "pm", toQ: 84 }] };
    expect(validGapCertificateShape("crew_shortfall", valid)).toBe(true);
    const invalid = [
      { ...valid, extra: true }, { kind: "open_shifts", items: [] },
      { kind: "open_shifts", items: [item(), item()] },
      { kind: "open_shifts", items: [item(), { ...item(), typeId: "pm", fromQ: 41 }] },
      ...[{ missing: 0 }, { missing: 2 }, { placed: -1 }, { fromQ: 40.5 }, { toQ: 40 }, { typeId: "" },
        { rejected: [{ userId: U.ben, codes: [] }] }, { rejected: [{ userId: U.ben, codes: ["off", "off"] }] },
        { rejected: [{ userId: U.ben, codes: ["fiction"] }] }, { rejected: [item().rejected[0], item().rejected[0]] },
      ].map((over) => ({ kind: "open_shifts", items: [{ ...item(), ...over }] })),
      { kind: "station_short", required: 1, assigned: 1, onShiftUserIds: [] },
      { kind: "station_short", required: 2, assigned: 1, onShiftUserIds: [U.ben, U.ben] },
    ];
    for (const c of invalid) expect(validGapCertificateShape("crew_shortfall", c), JSON.stringify(c)).toBe(false);
  });
});

it("uses Unicode code-point order for every certificate id sequence", () => {
  expect(["\u{1F600}", "", "\uE000", "\u{10000}", "\uFFFF"].sort(compareCodePoint)).toEqual(["", "\uE000", "\uFFFF", "\u{10000}", "\u{1F600}"]);
  for (const ids of [["", "\u{1F600}"], ["\uE000", "\u{1F600}"], ["\u{1F600}", "\uE000"], ["\uFFFF", "\u{10000}"], ["\u{10000}", "\uFFFF"]]) {
    const expected = ids.every((id, i) => id.length > 0 && (!i || compareCodePoint(ids[i - 1]!, id) < 0));
    for (const certificate of [
      { kind: "station_short", required: 2, assigned: 1, onShiftUserIds: ids },
      { kind: "open_shifts", items: ids.map((typeId) => ({ ...item(), typeId })) },
      { kind: "open_shifts", items: [{ ...item(), rejected: ids.map((userId) => ({ userId, codes: ["off"] })) }] },
    ]) expect(validGapCertificateShape("crew_shortfall", certificate)).toBe(expected);
  }
});

it("caps only manual overrides without dropping notes", () => {
  for (const [field, cap] of [["manualOverrides", CREW_MAX_MANUAL_OVERRIDES_PER_DAY]] as const) {
    const ctx = context({ built: [THU] });
    const crew: CrewDaySnapshot = { version: 1, shifts: [], manualOverrides: [], notes: [] };
    ctx.days[THU]!.crew = crew;
    const value = field === "manualOverrides" ? { original: { date: THU, userId: U.ben, startQ: 40 }, replacement: null }
      : { code: "unbudgeted_date", date: THU, userId: null, positionId: null, params: {} };
    Object.assign(crew, { [field]: Array.from({ length: cap }, () => structuredClone(value)) });
    expect(() => assertContextFits(ctx)).not.toThrow();
    Object.assign(crew, { [field]: Array.from({ length: cap + 1 }, () => structuredClone(value)) });
    for (const write of [assertContextFits, toContextSnapshot]) expect(() => write(ctx)).toThrowError(expect.objectContaining({ code: "crew_snapshot_limit" }));
    expect(crew[field]).toHaveLength(cap + 1);
  }
});

it("fits a seven-day crew snapshot with a full 40-person roster and every daily evidence cap hit", () => {
  const ctx = context({ built: DATES });
  const base = ctx.people[U.ben]!;
  ctx.people = Object.fromEntries(Array.from({ length: 40 }, (_, i) => {
    const userId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    return [userId, { ...structuredClone(base), userId, availability: Object.fromEntries(DATES.map((date) => [date, { fromQ: 28, toQ: 84, source: "manager_set" }])),
      workModes: Object.fromEntries(DATES.map((date) => [date, "works"])), usualShift: { source: "manager", deletedTypeId: null, value: { typeId: "mid", fromQ: 40, toQ: 80 } } }];
  })) as typeof ctx.people;
  for (const date of DATES) {
    const ids = Object.keys(ctx.people);
    ctx.days[date]!.structure.engine = "crew";
    ctx.days[date]!.structure.shiftTypes = [{ id: "mid", name: "Mid", fromQ: 40, toQ: 80, startFlexQ: 0, minLengthQ: 16,
      stations: [], headcount: { slow: 20, normal: 20, busy: 20, weekend: 20 }, countsTowardMod: false }];
    ctx.days[date]!.crew = { version: 1, shifts: ids.map((userId) => ({ userId, startQ: 40, typeId: "mid", source: "usual" })),
      manualOverrides: Array.from({ length: CREW_MAX_MANUAL_OVERRIDES_PER_DAY }, (_, edit) => { const userId = ids[edit % ids.length]!; return ({ original: { date, userId, startQ: 40 + Math.floor(edit / ids.length) },
        replacement: shift(userId, date, 40, 80, "mod", { segments: Array.from({ length: 10 }, (_, i) => ({ positionId: "mod", startQ: 40 + i * 4, endQ: 44 + i * 4, reasonKey: "schedule.reason.crew_unassigned" })) }) }); }),
      notes: Array.from({ length: CREW_MAX_NOTES_PER_DAY }, (_, i) => ({ code: "budget_stopped", date, userId: ids[i]!, positionId: null, params: { hours: 40, limit: 40 } })) };
  }
  const stored = toContextSnapshot(ctx);
  const bytes = jsonbTextBytes(stored.context);
  console.log(`Crew 60 overrides/day ? 7 days snapshot: ${bytes} jsonb bytes`);
  expect(bytes).toBeLessThan(CONTEXT_SAFE_MAX_BYTES);
  expect(ruleContextFromSnapshot(stored.context)).toEqual(ctx);
  expect(ruleContextFromSnapshot(stored.json)).toEqual(ctx);
  for (const day of Object.values(ctx.days)) expect(day.crew!.manualOverrides).toHaveLength(60);
  expect(() => assertContextFits(ctx)).not.toThrow();
});

it("does not cap generator notes and preserves compact override tombstones and optional segment fields", () => {
  const ctx = context({ built: [THU] });
  const replacements = Array.from({ length: 60 }, (_, i) => ({
    original: { date: THU, userId: U.ben, startQ: i },
    replacement: i % 3 === 0 ? null : shift(U.ben, THU, 40, 80, "mod", {}, {
      ...(i % 2 ? { lastResort: false } : { lastResort: true, coverFor: U.maya }),
      reasonKey: "schedule.reason.crew_unassigned",
    }),
  }));
  ctx.days[THU]!.crew = { version: 1, shifts: [], manualOverrides: replacements,
    notes: Array.from({ length: 100 }, () => ({ code: "usual_type_deleted", date: THU, userId: null, positionId: null,
      params: { count: 40, userIds: [U.ben, U.maya], typeId: "retired" } })) };
  expect(() => assertContextFits(ctx)).not.toThrow();
  const snapshot = toContextSnapshot(ctx);
  expect(ruleContextFromSnapshot(snapshot.json)).toEqual(ctx);
  expect(snapshot.context.days[THU]!.crew!.manualOverrides).toEqual([]);
  expect(ctx.days[THU]!.crew!.manualOverrides).toHaveLength(60);
});

it("a work-mode edit raises only availability_changed, including when the window is unchanged", () => {
  const was = context(), now = structuredClone(was);
  now.people[U.ben]!.workModes = { [THU]: "if_needed" };
  expect(contextAdvisory(was, now)).toEqual([{ code: "availability_changed", date: THU, userId: U.ben, params: {} }]);
});

it("the board never labels unassigned crew time as MoD without type permission and selects proven copy", () => {
  const src = structuredClone(boardSource());
  const date = src.week!.days[0]!.date, day = src.week!.dayContexts[date]!;
  const userId = Object.keys(src.week!.people).find((id) => src.week!.people[id]!.role === "gm")!;
  day.structure.engine = "crew";
  day.structure.shiftTypes = [{ id: "mid", name: "Mid", fromQ: 40, toQ: 80, startFlexQ: 0, minLengthQ: 16,
    stations: [], headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, countsTowardMod: false }];
  day.crew = { version: 1, shifts: [{ userId, startQ: 40, typeId: "mid", source: "usual" }], manualOverrides: [], notes: [] };
  src.week!.shifts = [shift(userId, date, 40, 80, "mod", {}, { reasonKey: "schedule.reason.crew_unassigned" })];
  src.week!.days[0]!.problems = [false, true].map((proven) => ({ code: "open_shift", severity: "gap", day: date, inherited: false, params: { proven } }));
  const view = boardView(src);
  expect(view.days.find((d) => d.date === date)!.rows[0]!.shifts[0]!.segments[0]!.mod).toBe(false);
  expect(view.rules.fresh.filter((p) => p.code === "open_shift").map((p) => p.line.key)).toEqual(["schedule.rule.open_shift_unresolved", "schedule.rule.open_shift"]);
  day.structure.shiftTypes[0]!.countsTowardMod = true;
  expect(boardView(src).days.find((d) => d.date === date)!.rows[0]!.shifts[0]!.segments[0]!.mod).toBe(true);
});
