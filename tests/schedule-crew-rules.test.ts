import { describe, expect, it } from "vitest";
import { approvalRefusal, checkCertificate, checkScheduleRules, MOD, REPAIR_LIMITS, shiftCountsAsMod, type DeclaredGap } from "@/lib/scheduling/rules-shared";
import { crewOpenGroups, crewStationShorts, verifyCrewGap } from "@/lib/scheduling/crew-gap-verifier-shared";
import type { ShiftType } from "@/lib/scheduling/structure-shared";
import { context, P, setNeed, shift, structure, U, WED, week } from "./fixtures/schedule/rules-fixture";

const type = (id = "mid", overrides: Partial<ShiftType> = {}): ShiftType => ({ id, name: "Mid", fromQ: 44, toQ: 64, startFlexQ: 4, minLengthQ: 16,
  headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [P.REG], countsTowardMod: true, ...overrides });
function fixture(types: ShiftType[] = [type()]) {
  const ctx = context({ built: [WED], s: structure((st) => { st.engine = "crew"; st.shiftTypes = types; }) });
  const day = ctx.days[WED]!;
  day.crew = { version: 1, shifts: [], manualOverrides: [], notes: [] };
  ctx.people = { [U.ben]: ctx.people[U.ben]! };
  return { ctx, day, s: week([]) };
}
function opening(f: ReturnType<typeof fixture>): DeclaredGap {
  const group = crewOpenGroups(WED, f.s, f.ctx)[0]!;
  return { code: "open_shift", cause: "crew_shortfall", date: WED, positionId: null, fromQ: group.fromQ, toQ: group.toQ,
    certificate: { kind: "open_shifts", items: group.items } };
}
function short(f: ReturnType<typeof fixture>): DeclaredGap {
  const run = crewStationShorts(WED, P.REG, f.s, f.ctx)[0]!;
  return { code: "coverage_gap", cause: "crew_shortfall", date: WED, positionId: P.REG, ...run };
}

describe("crew certificates under the fixed crew", () => {
  it("does not certify a rejection when the type's start flex permits a full shift", () => {
    const f = fixture();
    f.ctx.people[U.ben]!.availability[WED] = { fromQ: 40, toQ: 56, source: "manager_set" };
    // Standard 44 start leaves 12 quarters, but 40 start fits the 16-quarter minimum.
    expect(verifyCrewGap(opening(f), f.s, f.ctx)).toBe(false);
  });
  it("requires every candidate's recomputed rejection, then permits approval", () => {
    const f = fixture();
    f.ctx.people[U.ben]!.workModes = { [WED]: "off" };
    const gap = opening(f);
    expect(checkCertificate(gap, f.s, f.ctx)).toBe(true);
    f.s.gaps = [gap];
    const problems = checkScheduleRules(f.s, f.ctx);
    expect(problems).toMatchObject([{ code: "open_shift", severity: "gap" }]);
    expect(approvalRefusal(f.s, problems)).toBeNull();
    f.ctx.people[U.ben]!.workModes![WED] = "works";
    expect(verifyCrewGap(gap, f.s, f.ctx)).toBe(false);
  });
  it("refuses omitted, duplicate, forged and empty candidate evidence", () => {
    const f = fixture();
    f.ctx.people[U.ben]!.workModes = { [WED]: "off" };
    const gap = opening(f);
    if (gap.cause !== "crew_shortfall" || gap.certificate.kind !== "open_shifts") throw Error("fixture");
    const original = structuredClone(gap.certificate.items[0]!.rejected);
    for (const rejected of [[], [...original, ...original], [{ userId: U.ben, codes: ["budget" as const] }]]) {
      gap.certificate.items[0]!.rejected = rejected;
      expect(verifyCrewGap(gap, f.s, f.ctx)).toBe(false);
    }
    f.ctx.people[U.ben]!.workModes = {};
    expect(verifyCrewGap(opening(f), f.s, f.ctx)).toBe(false);
  });
  it("leaves incomplete search unresolved and approval-blocking", () => {
    const f = fixture();
    const gap: DeclaredGap = { ...opening(f), cause: "unresolved_search", certificate: {
      searched: { steps: 0, donorsTried: 0, chainDepth: 0 }, limits: { ...REPAIR_LIMITS }, candidateIds: [U.ben],
    } };
    f.s.gaps = [gap];
    expect(checkCertificate(gap, f.s, f.ctx)).toBe(true);
    expect(approvalRefusal(f.s, checkScheduleRules(f.s, f.ctx))).toBe("unresolved_gaps");
  });
  it("groups types at the same start, includes every opening, and binds the maximum end", () => {
    const f = fixture([type("b"), type("a", { toQ: 68 })]);
    f.ctx.people[U.ben]!.availability[WED] = null;
    const gap = opening(f);
    expect(crewOpenGroups(WED, f.s, f.ctx)).toHaveLength(1);
    expect(gap.toQ).toBe(68);
    expect(verifyCrewGap(gap, f.s, f.ctx)).toBe(true);
    if (gap.cause !== "crew_shortfall" || gap.certificate.kind !== "open_shifts") throw Error("fixture");
    expect(gap.certificate.items.map((x) => x.typeId)).toEqual(["a", "b"]);
    gap.certificate.items.pop();
    expect(verifyCrewGap(gap, f.s, f.ctx)).toBe(false);
  });
  it("counts the catering extra once per qualifying date", () => {
    const f = fixture();
    f.day.structure.catering.crewShift = { enabled: true, typeId: "mid", extraHeads: 1 };
    f.day.inputs.cateringEvents = [{ id: "a", headcount: 100, eventQ: 48 }, { id: "b", headcount: 100, eventQ: 52 }];
    expect(crewOpenGroups(WED, f.s, f.ctx)[0]!.items[0]!.required).toBe(2);
  });
  it("verifies maximal station runs with exact counts and on-clock evidence", () => {
    const f = fixture([]);
    setNeed(f.ctx, WED, P.REG, 44, 64);
    const gap = short(f);
    expect(verifyCrewGap(gap, f.s, f.ctx)).toBe(true);
    f.s.gaps = [gap];
    expect(approvalRefusal(f.s, checkScheduleRules(f.s, f.ctx))).toBeNull();
    expect(verifyCrewGap({ ...gap, toQ: 60 }, f.s, f.ctx)).toBe(false);
    f.s.shifts.push(shift(U.ben, WED, 44, 64, P.REG));
    f.day.crew!.shifts.push({ userId: U.ben, startQ: 44, typeId: null, source: "manual" });
    expect(verifyCrewGap(gap, f.s, f.ctx)).toBe(false);
  });
  it("splits runs whenever on-clock evidence or counts change", () => {
    const f = fixture([]);
    setNeed(f.ctx, WED, P.REG, 44, 64);
    f.s.shifts.push(shift(U.ben, WED, 48, 64, MOD));
    f.day.crew!.shifts.push({ userId: U.ben, startQ: 48, typeId: null, source: "manual" });
    expect(crewStationShorts(WED, P.REG, f.s, f.ctx).map((r) => [r.fromQ, r.toQ, r.certificate.onShiftUserIds])).toEqual([[44, 48, []], [48, 64, [U.ben]]]);
  });
  it("refuses stale, absent and station-engine crew declarations", () => {
    const f = fixture();
    expect(checkScheduleRules(f.s, f.ctx).some((p) => p.code === "undeclared_gap")).toBe(true);
    f.ctx.people[U.ben]!.availability[WED] = null;
    const gap = opening(f);
    f.day.structure.engine = "stations";
    expect(checkCertificate(gap, f.s, f.ctx)).toBe(false);
    f.s.gaps = [gap];
    expect(approvalRefusal(f.s, checkScheduleRules(f.s, f.ctx))).toBe("rules_failing");
  });
  it("never accepts duplicate shift metadata as extra placed heads", () => {
    const f = fixture([type("mid", { headcount: { slow: 3, normal: 3, busy: 3, weekend: 3 } })]);
    f.s.shifts.push(shift(U.ben, WED, 44, 64, MOD));
    f.day.crew!.shifts = [{ userId: U.ben, startQ: 44, typeId: "mid", source: "fill" }, { userId: U.ben, startQ: 44, typeId: "mid", source: "fill" }];
    expect(verifyCrewGap(opening(f), f.s, f.ctx)).toBe(false);
  });
});

describe("crew safety and MoD", () => {
  it("ANDs the type flag with role rules and the key-holder threshold", () => {
    const f = fixture();
    const person = f.ctx.people[U.ben]!;
    person.role = "key_holder";
    const sh = shift(U.ben, WED, 64, 83, MOD);
    f.day.crew!.shifts = [{ userId: U.ben, startQ: 64, typeId: "mid", source: "fill" }];
    expect(shiftCountsAsMod(sh, person, f.day, 75)).toBe(false);
    expect(shiftCountsAsMod(sh, person, f.day, 76)).toBe(true);
    f.day.structure.shiftTypes![0]!.countsTowardMod = false;
    expect(shiftCountsAsMod(sh, person, f.day, 76)).toBe(false);
    f.day.structure.engine = "stations";
    expect(shiftCountsAsMod(sh, person, f.day, 76)).toBe(true);
  });
  it("does not promote employees and does not count unassigned paid time as MoD", () => {
    const f = fixture();
    const sh = shift(U.ben, WED, 44, 64, MOD);
    f.day.crew!.shifts = [{ userId: U.ben, startQ: 44, typeId: "mid", source: "fill" }];
    expect(shiftCountsAsMod(sh, f.ctx.people[U.ben]!, f.day, 50)).toBe(false);
    f.ctx.people[U.ben]!.role = "shift_lead";
    f.day.crew!.shifts[0] = { userId: U.ben, startQ: 44, typeId: null, source: "pin" };
    expect(shiftCountsAsMod(sh, f.ctx.people[U.ben]!, f.day, 50)).toBe(false);
  });
  it("preserves hard safety errors despite a certified shortage", () => {
    const f = fixture([]);
    f.ctx.people[U.ben]!.workModes = { [WED]: "off" };
    f.s.shifts = [shift(U.ben, WED, 44, 64, MOD)];
    f.day.crew!.shifts = [{ userId: U.ben, startQ: 44, typeId: null, source: "manual" }];
    setNeed(f.ctx, WED, P.REG, 44, 64);
    f.s.gaps = [short(f)];
    expect(checkCertificate(f.s.gaps[0]!, f.s, f.ctx)).toBe(true);
    expect(approvalRefusal(f.s, checkScheduleRules(f.s, f.ctx))).toBe("rules_failing");
  });
  it("enforces type minimum, explicit unavailability and daily maximum", () => {
    const f = fixture([type("mid", { minLengthQ: 24 })]);
    f.s.shifts = [shift(U.ben, WED, 44, 64, MOD)];
    f.day.crew!.shifts = [{ userId: U.ben, startQ: 44, typeId: "mid", source: "fill" }];
    f.ctx.people[U.ben]!.availability[WED] = null;
    expect(checkScheduleRules(f.s, f.ctx)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "shift_below_minimum", severity: "error" }),
      expect.objectContaining({ code: "outside_assumed_availability", severity: "error" }),
    ]));
    f.s.shifts[0]!.endQ = 90;
    f.s.shifts[0]!.segments[0]!.endQ = 90;
    expect(checkScheduleRules(f.s, f.ctx).some((p) => p.code === "shift_over_maximum")).toBe(true);
  });
});
