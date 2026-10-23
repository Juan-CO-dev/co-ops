import { describe, expect, it } from "vitest";
import { validUsualShift } from "@/lib/scheduling/usual-shift-shared";
import { recordPersonSettingsCall, savePersonSettingsCall } from "@/lib/scheduling/rpc-args-shared";

describe("usual shift shape", () => {
  it.each([null, { typeId: "opener" }, { typeId: "" }, { typeId: "deleted" },
    { typeId: "mid", fromQ: 0, toQ: 96 }, { typeId: "mid", fromQ: 30, toQ: 64 }])("accepts %j", (value) => {
    expect(validUsualShift(value)).toBe(true);
  });
  it.each([undefined, [], "opener", 42, {}, { typeId: null }, { typeId: 1 },
    { typeId: "x", extra: true }, { typeId: "x", fromQ: 1 }, { typeId: "x", toQ: 96 },
    ...[[-1, 96], [0, 97], [64, 64], [96, 0], [1.5, 64], [1, 64.5], [null, 64], [1, null],
      ["1", 64], [1, "64"], [NaN, 64], [1, Infinity], [undefined, undefined]]
      .map(([fromQ, toQ]) => ({ typeId: "x", fromQ, toQ }))])("rejects %j", (value) => {
    expect(validUsualShift(value)).toBe(false);
  });
  it("carries the same optional value through both RPC builders", () => {
    const fields = { actorId: "a", locationId: "l", userId: "u", expectedId: null, workType: null,
      alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null,
      fullTime: false, fullTimeMinH: null, rosterInclude: null };
    for (const builder of [recordPersonSettingsCall, savePersonSettingsCall]) {
      expect(builder(fields).args.p_usual_shift).toBeNull();
      expect(builder({ ...fields, usualShift: null }).args.p_usual_shift).toBeNull();
      const usualShift = { typeId: "opener", fromQ: 30, toQ: 64 };
      expect(builder({ ...fields, usualShift }).args.p_usual_shift).toEqual(usualShift);
    }
  });
});
