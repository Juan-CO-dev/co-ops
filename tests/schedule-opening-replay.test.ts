/**
 * PR SCH (plan r5, 12.8; rulings D9, C6): replay, the snapshot, the current-inputs advisory and the budget reference.
 *  - a pre-SCH snapshot (no `cateringRule`, no `opening`, no `base`) replays identically;
 *  - an `opening` / `base` snapshot round-trips (both engines, through the crew codec) and keeps its digest on rebuild;
 *  - a heaviness or opening change reads as catering / need / opening — never as a settings change;
 *  - `referenceStructureOf` returns the shop's base structure behind a heavy or opened day;
 *  - every new context carries `cateringRule: "day_total_v1"` (both generators; saveEdit / setDayOpening build through them).
 */
import { describe, expect, it } from "vitest";
import { referenceStructureOf } from "@/lib/scheduling/budget-shared";
import { canonicalJson, contextAdvisory, ruleContextFromSnapshot, toContextSnapshot, type RuleContext } from "@/lib/scheduling/context-shared";
import { buildWeek } from "@/lib/scheduling/generator/build-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { generatorInputFor } from "@/lib/scheduling/inputs-shared";
import { baseStructureOf } from "@/lib/scheduling/opening-shared";
import { checkScheduleRules } from "@/lib/scheduling/rules-shared";
import { crewPStreetEarly, DATES as CREW_DATES, WEEK as CREW_WEEK } from "./fixtures/schedule/crew-p-street-2026-10-19";
import { DATES, FIXTURES } from "./fixtures/schedule/fixtures";
import { schStationsWeek } from "./fixtures/schedule/sch-fixtures";

const WED = DATES[2]!;
const stationsOpened = () => {
  const input = schStationsWeek();
  input.days.find((d) => d.date === WED)!.decision = { kind: "accepted", startQ: 22 };
  return buildWeek(input);
};
const replay = (out: { shifts: never[] | unknown[]; gaps: unknown[]; days: unknown[] }, ctx: RuleContext) =>
  checkScheduleRules({ locationId: ctx.locationId, weekStart: ctx.weekStart, shifts: out.shifts, gaps: out.gaps, days: out.days } as never, ctx);

describe("the version marker (D9)", () => {
  it("every new context carries cateringRule day_total_v1, on both engines", () => {
    expect(buildWeek(FIXTURES["F1-mockup-v17"]!()).context.cateringRule).toBe("day_total_v1");
    expect(generateWeek(generatorInputFor(crewPStreetEarly(), CREW_WEEK, { today: CREW_WEEK })).context.cateringRule).toBe("day_total_v1");
  });
  it("a pre-SCH snapshot (no marker, no opening, no base) replays identically", () => {
    const out = buildWeek(FIXTURES["F1-mockup-v17"]!());
    const pre = structuredClone(out.context);
    delete pre.cateringRule;
    for (const d of Object.values(pre.days)) { expect(d.opening).toBeUndefined(); expect(d.base).toBeUndefined(); }
    const back = ruleContextFromSnapshot(JSON.parse(toContextSnapshot(pre).json));
    expect(back.cateringRule).toBeUndefined();
    expect(canonicalJson(replay(out, back))).toBe(canonicalJson(out.problems));
  });
});

describe("the opening / base snapshot", () => {
  it("stations: round-trips through the snapshot with opening, base and the marker intact, and replays identically; the digest is stable on rebuild", () => {
    const out = stationsOpened();
    const snap = toContextSnapshot(out.context);
    const back = ruleContextFromSnapshot(snap.json);
    expect(back.days[WED]!.opening).toMatchObject({ status: "accepted", startQ: 22 });
    expect(back.days[WED]!.base).toEqual(out.context.days[WED]!.base);
    expect(back.cateringRule).toBe("day_total_v1");
    expect(canonicalJson(back)).toBe(canonicalJson(out.context));
    expect(canonicalJson(replay(out, back))).toBe(canonicalJson(out.problems));
    expect(toContextSnapshot(stationsOpened().context).digest).toBe(snap.digest);
  });
  it("crew: the opening survives the crew codec", () => {
    const tue = CREW_DATES[1]!;
    const out = generateWeek(generatorInputFor(crewPStreetEarly(), CREW_WEEK, { today: CREW_WEEK, openingOverride: { date: tue, decision: { kind: "manual", startQ: 24 } } }));
    const back = ruleContextFromSnapshot(toContextSnapshot(out.context).json);
    expect(back.days[tue]!.opening).toMatchObject({ status: "manual", startQ: 24 });
    expect(back.days[tue]!.structure.shopDay.prepStartQ).toBe(24);
    expect(baseStructureOf(back.days[tue]!).shopDay.prepStartQ).toBe(28);
    expect(canonicalJson(replay(out, back))).toBe(canonicalJson(out.problems));
  });
});

describe("the current-inputs advisory compares the shop's OWN structures", () => {
  it("a day that became heavy reads catering_changed + need_changed, never structure_changed", () => {
    const input = schStationsWeek();
    const quiet = structuredClone(input);
    quiet.days.find((d) => d.date === WED)!.catering = [];
    const codes = contextAdvisory(buildWeek(quiet).context, buildWeek(input).context).filter((a) => a.date === WED).map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(["catering_changed", "need_changed"]));
    expect(codes).not.toContain("structure_changed");
  });
  it("an opening change reads opening_changed, never structure_changed; a real settings change still reads structure_changed", () => {
    const live = buildWeek(schStationsWeek()).context;
    const opened = stationsOpened().context;
    const codes = contextAdvisory(opened, live).filter((a) => a.date === WED);
    expect(codes.map((a) => a.code)).toContain("opening_changed");
    expect(codes.find((a) => a.code === "opening_changed")!.params).toEqual({ from: "accepted", to: null });
    expect(codes.map((a) => a.code)).not.toContain("structure_changed");
    const moved = structuredClone(live);
    moved.days[WED]!.structureVersionId = "another-version";
    expect(contextAdvisory(opened, moved).filter((a) => a.date === WED).map((a) => a.code)).toContain("structure_changed");
  });
});

describe("the budget reference reads the setting, never a day's derived structure", () => {
  it("referenceStructureOf returns the base behind a heavy, opened first day", () => {
    const out = stationsOpened();
    const days = Object.fromEntries(Object.entries(out.context.days).filter(([d]) => d >= WED));
    const ref = referenceStructureOf({ revision: { structureVersionId: out.context.days[WED]!.structureVersionId }, context: { days } }, {});
    expect(ref!.shopDay.prepStartQ).toBe(28);
    expect(canonicalJson(ref)).toBe(canonicalJson(schStationsWeek().structure));
  });
});
