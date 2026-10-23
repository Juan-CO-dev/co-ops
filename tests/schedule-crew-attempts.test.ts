import { expect, it, vi } from "vitest";
import { crewBlockAttempts } from "@/lib/scheduling/crew-block-attempts-shared";
import { crewLegalityCache } from "@/lib/scheduling/crew-legality-cache-shared";
import * as peopleRules from "@/lib/scheduling/people-rules-shared";
import type { ShiftType } from "@/lib/scheduling/structure-shared";
import { context, P, U, WED } from "./fixtures/schedule/rules-fixture";

function fixture() {
  const ctx = context({ built: [WED] });
  const day = ctx.days[WED]!;
  const p = ctx.people[U.ben]!;
  p.availability[WED] = { fromQ: 28, toQ: 84, source: "manager_set" };
  const type: ShiftType = { id: "mid", name: "Mid", fromQ: 44, toQ: 64, startFlexQ: 1, minLengthQ: 16,
    headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [P.REG], countsTowardMod: true };
  return { day, p, type };
}

it("accepts the base block without even reading the flex search radius", () => {
  const { day, p, type } = fixture();
  Object.defineProperty(type, "startFlexQ", { get() { throw new Error("eager flex search"); } });
  const reject = vi.fn(() => null);
  expect(crewBlockAttempts(p, type, WED, day, "fill", reject).match).toEqual([44, 64]);
  expect(reject).toHaveBeenCalledExactlyOnceWith(44, 64);
});

it("keeps first-occurrence dedupe and numeric two-end order when all blocks fail", () => {
  const { day, p, type } = fixture();
  const replay = crewBlockAttempts(p, type, WED, day, "fill", () => "soft_max");
  expect(replay.tried.map((t) => t.block)).toEqual([
    [44, 64], [45, 64], [43, 64], [44, 65], [44, 63],
    [43, 63], [43, 65], [45, 63], [45, 65],
  ]);
  expect(replay.match).toBeUndefined();
});

it("takes the longest affordable trim, keeping the end before keeping the start", () => {
  const { day, p, type } = fixture(); type.startFlexQ = 0;
  const reject = vi.fn((a: number, z: number) => z - a > 19 ? "soft_max" as const : null);
  const replay = crewBlockAttempts(p, type, WED, day, "fill", reject, { shorten: true });
  expect(replay.match).toEqual([45, 64]);
  expect(reject.mock.calls).toEqual([[44, 64], [45, 64]]);
});

it("prioritizes required coverage then holes, checking each MoD quarter once", () => {
  const { day, p, type } = fixture(); p.role = "shift_lead"; p.leaderSetting = "mix";
  const mod = vi.spyOn(peopleRules, "modCountsOn");
  try {
    const replay = crewBlockAttempts(p, type, WED, day, "fill", () => null, { holes: [43, 64], required: [64] });
    expect(replay.match).toEqual([43, 65]);
    expect(mod.mock.calls.map((args) => args[2])).toEqual([64, 43]);
  } finally { mod.mockRestore(); }
});

it("shares immutable quarter checks within a build, isolates dates and starts fresh next build", () => {
  const { day, p, type } = fixture();
  const cache = crewLegalityCache();
  const hold = vi.spyOn(peopleRules, "legalHoldPath");
  try {
    for (let n = 0; n < 2; n++) crewBlockAttempts(p, type, WED, day, "fill", () => null, { legality: cache });
    expect(hold).toHaveBeenCalledTimes(1);
    p.untouchableDates.push("2026-10-24");
    expect(cache.legalHoldPath(p, P.REG, day, "2026-10-24", 44)).toBeNull();
    expect(hold).toHaveBeenCalledTimes(2);
    p.activeMember = false;
    expect(crewLegalityCache().legalHoldPath(p, P.REG, day, WED, 44)).toBeNull();
    expect(hold).toHaveBeenCalledTimes(3);
  } finally { hold.mockRestore(); }
});
