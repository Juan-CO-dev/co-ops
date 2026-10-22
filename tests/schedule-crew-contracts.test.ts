import { describe, expect, it } from "vitest";
import { CREW_REJECTION_CODES, type CrewDaySnapshot, type OpenShiftItem } from "@/lib/scheduling/crew-contracts-shared";
import { assertContextFits, ruleContextFromSnapshot, toContextSnapshot } from "@/lib/scheduling/context-shared";
import { validGapCertificateShape } from "@/lib/scheduling/shapes-shared";
import { commitRevisionCall } from "@/lib/scheduling/rpc-args-shared";
import { segmentLabel } from "@/lib/scheduling/board-format-shared";
import { modLane } from "@/lib/scheduling/board-shared";
import { modFromQOf } from "@/lib/scheduling/board-view-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { context, THU, U, WEEK, LOC, shift } from "./fixtures/schedule/rules-fixture";

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
