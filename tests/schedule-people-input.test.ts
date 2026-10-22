/**
 * Scheduling Phase 2, Task 5 — people input, pure: punch patterns with a person-specific denominator
 * (r2 P2-10), assumed availability with the new-hire transition, the roster the generator sees (J16, R6)
 * and the skill lookup where unproven is its own band (r2 P1-2).
 */
import { describe, expect, it } from "vitest";
import { CASE_POSITION_IDS as I, shopBase } from "../scripts/schedule-structure-cases.mjs";
import {
  assumedAvailability, makeSkillLookup, punchPatterns, skillOf, toSchedPeople, type MemberInput, type PersonSettingsRow, type PunchEntry,
} from "@/lib/scheduling/people-input-shared";
import type { ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { addDays } from "@/lib/scheduling/time-shared";
import { etWallClockToUtcIso } from "@/lib/operational-day";

const ASOF = "2026-10-21"; // Wednesday; the window is the 8 ISO weeks 2026-08-24 .. 2026-10-18
const S = shopBase() as ScheduleStructure;
const SHOP = { fromQ: 28, toQ: 84 };
const at = (date: string, hhmm: string) => etWallClockToUtcIso(date, hhmm)!;
const punch = (userId: string, date: string, inAt: string, outAt: string | null, hours = 8): PunchEntry =>
  ({ userId, businessDate: date, inAt: at(date, inAt), outAt: outAt ? at(date, outAt) : null, hours, deleted: false });
/** The Mondays of the 8 window weeks, oldest first. */
const MONDAYS = Array.from({ length: 8 }, (_, i) => addDays("2026-08-24", 7 * i));

/** The shop punches every day of every window week (the "shop was open" denominator). */
function shopOpen(): PunchEntry[] {
  const out: PunchEntry[] = [];
  for (const mon of MONDAYS) for (let d = 0; d < 7; d++) out.push(punch("u-shop", addDays(mon, d), "07:00", "15:00"));
  return out;
}

describe("punchPatterns (r2 P2-10): a person-specific denominator", () => {
  it("per user x ISO weekday: weeksWorked, weeksObserved, share, p10 in, p90 out; deleted and unlinked rows skipped; an open entry counts its day only", () => {
    const entries = [
      ...shopOpen(),
      ...MONDAYS.map((mon, i) => punch("u-a", addDays(mon, 1), ["10:30", "10:35", "10:00", "10:45", "10:30", "11:00", "10:30", "10:20"][i]!, i === 7 ? null : "17:10")),
      { ...punch("u-a", addDays(MONDAYS[0]!, 2), "09:00", "13:00"), deleted: true },
      { ...punch("u-a", addDays(MONDAYS[1]!, 2), "09:00", "13:00"), userId: null },
    ];
    const p = punchPatterns(entries, { asOf: ASOF });
    const tue = p["u-a"]!.byDow[2]!;
    expect(tue).toMatchObject({ weeksWorked: 8, weeksObserved: 8, share: 1 });
    expect(tue.p10InQ).toBe(40); // 10:00 floored to the quarter at p10
    expect(tue.p90OutQ).toBe(69); // 17:10 ceiled to 17:15 (the open entry has no out time)
    expect(p["u-a"]!.byDow[3]).toMatchObject({ weeksWorked: 0, weeksObserved: 8, share: 0, p10InQ: null, p90OutQ: null });
    expect(p["u-shop"]!.byDow[1]!.share).toBe(1);
    expect(Object.keys(p)).toEqual(["u-a", "u-shop"]);
  });

  it("weeksObserved starts at the person's first shop punch (or an explicit shop-history floor) and counts only weeks the SHOP punched that weekday", () => {
    const shop = shopOpen().filter((e) => !(e.businessDate >= MONDAYS[3]! && e.businessDate < addDays(MONDAYS[3]!, 7))); // the shop closed week 4
    const entries = [...shop, ...MONDAYS.slice(5).map((mon) => punch("u-new", addDays(mon, 4), "10:00", "16:00"))];
    const p = punchPatterns(entries, { asOf: ASOF });
    expect(p["u-new"]!.byDow[5]).toMatchObject({ weeksWorked: 3, weeksObserved: 3, share: 1 });
    expect(p["u-new"]!.byDow[1]).toMatchObject({ weeksWorked: 0, weeksObserved: 3 });
    const later = punchPatterns(entries, { asOf: ASOF, firstSeen: { "u-new": addDays(MONDAYS[6]!, 0) } });
    expect(later["u-new"]!.byDow[5]).toMatchObject({ weeksWorked: 2, weeksObserved: 2 });
    // The shop's closed week never counts against anyone.
    expect(p["u-shop"]!.byDow[2]!.weeksObserved).toBe(7);
  });

  it("DST-week entries convert by the ET wall clock; mean weekly hours is over the last 4 observed weeks", () => {
    const entries = [...shopOpen(), ...MONDAYS.map((mon) => punch("u-b", addDays(mon, 0), "06:30", "14:45", 8.25))];
    const dst = punchPatterns([...entries, punch("u-b", "2026-10-26", "06:30", "14:45")], { asOf: "2026-11-04" });
    expect(dst["u-b"]!.byDow[1]!.p10InQ).toBe(26);
    expect(dst["u-b"]!.byDow[1]!.p90OutQ).toBe(59);
    expect(punchPatterns(entries, { asOf: ASOF })["u-b"]!.meanWeeklyHours).toBe(8.25);
  });
});

describe("assumedAvailability and the new-hire transition", () => {
  const dow = (weeksObserved: number, share: number, p10 = 40, p90 = 68) => ({ weeksWorked: Math.round(share * weeksObserved), weeksObserved, share, p10InQ: p10, p90OutQ: p90 });
  it(">= 3 weeks and share >= 25% -> [p10 - 30 min, p90 + 30 min] clamped to the shop day; share < 25% -> not that weekday", () => {
    expect(assumedAvailability(dow(3, 0.34), SHOP)).toEqual({ fromQ: 38, toQ: 70, source: "toast_pattern" });
    expect(assumedAvailability(dow(8, 1, 28, 84), SHOP)).toEqual({ fromQ: 28, toQ: 84, source: "toast_pattern" });
    expect(assumedAvailability(dow(4, 0.25), SHOP)?.source).toBe("toast_pattern");
    expect(assumedAvailability(dow(4, 0.2), SHOP)).toBeNull();
    expect(assumedAvailability(dow(4, 1, 40, null as unknown as number), SHOP)).toEqual({ fromQ: 38, toQ: 84, source: "toast_pattern" });
  });

  it("the new hire at 0, 1 and 2 weeks is available within the shop's normal hours on every weekday; at 3 the pattern takes over; the set never shrinks before that", () => {
    const steps = [undefined, dow(1, 1), dow(2, 1)].map((d) => assumedAvailability(d, SHOP));
    for (const a of steps) expect(a).toEqual({ fromQ: 28, toQ: 84, source: "insufficient_history" });
    expect(assumedAvailability(dow(3, 1), SHOP)).toEqual({ fromQ: 38, toQ: 70, source: "toast_pattern" });
    expect(assumedAvailability(dow(3, 0), SHOP)).toBeNull();
  });
});

describe("toSchedPeople: the roster the generator sees", () => {
  const members: MemberInput[] = [
    { userId: "u-alex", role: "gm", active: true }, { userId: "u-ben", role: "employee", active: true }, { userId: "u-cat", role: "catering_mgr", active: true },
    { userId: "u-cgs", role: "cgs", active: true }, { userId: "u-dani", role: "shift_lead", active: true }, { userId: "u-new", role: "hired_not_yet_worked", active: true },
    { userId: "u-pete", role: "owner", active: true }, { userId: "u-prep", role: "prep_mgr", active: true }, { userId: "u-smm", role: "social_media_mgr", active: true },
    { userId: "u-tess", role: "employee", active: false },
  ];
  const settings: PersonSettingsRow[] = [
    { userId: "u-prep", workType: "boh", alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: true },
    { userId: "u-cgs", workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: true },
    { userId: "u-dani", workType: null, alsoAllowed: [], leaderSetting: "mix", coverPositions: [I.$REG, "retired-position", I.$REG], softMinH: 30, softMaxH: null, fullTime: true, fullTimeMinH: 32, rosterInclude: null },
    { userId: "u-ben", workType: "foh", alsoAllowed: ["boh"], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null },
  ];
  const dates = ["2026-10-26", "2026-10-27"];
  const base = () => toSchedPeople({
    members, settings, dates, structure: S, shopDay: SHOP, skills: null,
    patterns: { "u-ben": { firstWeek: "2026-08-24", meanWeeklyHours: 31.5, byDow: { 1: { weeksWorked: 4, weeksObserved: 4, share: 1, p10InQ: 44, p90OutQ: 64 }, 2: { weeksWorked: 0, weeksObserved: 4, share: 0, p10InQ: null, p90OutQ: null } } } },
    wages: { byUserCents: { "u-ben": 2100 }, estimateHourlyCents: 1900 },
  });

  it("Juan 2026-10-16 (decision 8): the prep and catering managers are ON the roster by default; levels < 2 dropped (never cgs / SMM); MoO / Owner presence-only; canonical order", () => {
    const { people, notes } = base();
    expect(people.map((p) => p.userId)).toEqual(["u-alex", "u-ben", "u-cat", "u-dani", "u-pete", "u-prep", "u-tess"]);
    expect(people.find((p) => p.userId === "u-pete")).toMatchObject({ presenceOnly: true, salaried: false, wageCents: null });
    // The catering manager: on the roster, neither salaried nor presence-only (their own shifts come from pins only — the generator's rule).
    expect(people.find((p) => p.userId === "u-cat")).toMatchObject({ rosterIncluded: false, salaried: false, presenceOnly: false });
    expect(people.find((p) => p.userId === "u-prep")).toMatchObject({ rosterIncluded: false, workType: "boh" });
    expect(people.find((p) => p.userId === "u-tess")?.activeMember).toBe(false);
    expect(notes).toEqual([{ code: "cover_position_retired", userId: "u-dani", positionId: "retired-position" }]);
  });

  it("a shop that excludes a role again drops it unless rosterInclude (the setting still works)", () => {
    const x = { ...S, roster: { excludedRoles: ["cgs", "social_media_mgr", "catering_mgr", "prep_mgr"] } } as ScheduleStructure;
    const { people, notes } = toSchedPeople({ members, settings, dates, structure: x, shopDay: SHOP, skills: null, patterns: {}, wages: { byUserCents: {}, estimateHourlyCents: 1900 } });
    expect(people.map((p) => p.userId)).toEqual(["u-alex", "u-ben", "u-dani", "u-pete", "u-prep", "u-tess"]);
    expect(people.find((p) => p.userId === "u-prep")).toMatchObject({ rosterIncluded: true, workType: "boh" });
    expect(notes).toContainEqual({ code: "excluded_role_included", userId: "u-prep", positionId: null });
  });

  it("role defaults apply and person settings override; retired cover positions are dropped (de-duplicated); salaried = gm / agm; wage source", () => {
    const { people } = base();
    const alex = people.find((p) => p.userId === "u-alex")!;
    expect(alex).toMatchObject({ salaried: true, workType: "management", leaderSetting: null, coverPositions: [], wageCents: null, wageSource: null, softMinH: null, softMaxH: null });
    const dani = people.find((p) => p.userId === "u-dani")!;
    expect(dani).toMatchObject({ workType: "management", leaderSetting: "mix", coverPositions: [I.$REG], softMinH: 30, softMaxH: 40, fullTime: true, fullTimeMinH: 32, wageCents: 1900, wageSource: "estimate" });
    const ben = people.find((p) => p.userId === "u-ben")!;
    expect(ben).toMatchObject({ workType: "foh", alsoAllowed: ["boh"], wageCents: 2100, wageSource: "sevenshifts", softMinH: 27.5, softMaxH: 35.5 });
    // Availability per date from the pattern: Monday worked (window), Tuesday never worked (not available), no pattern → insufficient history.
    expect(ben.availability).toEqual({ "2026-10-26": { fromQ: 42, toQ: 66, source: "toast_pattern" }, "2026-10-27": null });
    expect(alex.availability["2026-10-26"]).toEqual({ fromQ: 28, toQ: 84, source: "insufficient_history" });
  });

  it("with no wage anywhere the wage is null and so is its source", () => {
    const r = toSchedPeople({ members: [members[1]!], settings: [], patterns: {}, dates, structure: S, shopDay: SHOP, skills: null, wages: { byUserCents: {}, estimateHourlyCents: null } });
    expect(r.people[0]).toMatchObject({ wageCents: null, wageSource: null, softMinH: 0, softMaxH: 40 });
  });
});

describe("SkillLookup (r2 P1-2): unproven is its own band", () => {
  const cell = (positionId: string, value: number, confidence: number, startingPoint: boolean, close: number | null = null) => ({
    positionId, learned: value, prior: 0.5, priorSource: "neutral" as const, adjustment: 0, value, band: "solid" as const, qualityDays: 3, workedDays: 3, minutesWorked: 600,
    confidence, startingPoint, perKind: { pm: null, closeOnTime: close === null ? null : { mean: close, count: 2, days: 2, counted: true, equalWeightFallback: false }, prepYield: null }, evidence: [],
  });
  const lookup = makeSkillLookup({ people: [
    { userId: "u-eli", role: "trainee", skills: [cell(I.$REG, 0.3, 0.6, false), cell(I.$WALK, 0.3, 0.1, false), cell(I.$BOI, 0.5, 0, true)] },
    { userId: "u-maya", role: "trainer", skills: [cell(I.$REG, 0.9, 0.7, false, 0.95), cell(I.$BOI, 0.8, 0.2, false, 0.6)] },
  ] }, { building: 0.45, strong: 0.75 });
  const person = (userId: string, role: "trainee" | "trainer" | "employee", workType: "foh" | "boh" | "management" = "foh") => ({
    userId, role, activeMember: true, workType, alsoAllowed: [] as Array<"boh" | "foh">, leaderSetting: null, coverPositions: [], salaried: false, presenceOnly: false,
    softMinH: null, softMaxH: null, availability: {}, flexDates: [], untouchableDates: [], newerPositions: [], strongPositions: [],
  });

  it("newer needs real evidence (confidence >= 0.3, value < building, not a starting point); strong needs value >= strong with confidence >= 0.3", () => {
    const eli = person("u-eli", "trainee");
    expect(skillOf(lookup, eli, I.$REG, S.positions[I.$REG])).toMatchObject({ value: 0.3, band: "building", isNewer: true, isStrong: false });
    expect(skillOf(lookup, eli, I.$WALK, S.positions[I.$WALK])).toMatchObject({ band: "building", isNewer: false }); // thin confidence
    expect(skillOf(lookup, eli, I.$BOI, S.positions[I.$BOI])).toMatchObject({ value: 0.5, band: "unproven", isNewer: false, isStrong: false });
    const maya = person("u-maya", "trainer");
    expect(skillOf(lookup, maya, I.$REG, S.positions[I.$REG])).toMatchObject({ value: 0.9, band: "strong", isStrong: true, isNewer: false });
    expect(skillOf(lookup, maya, I.$BOI, S.positions[I.$BOI])).toMatchObject({ band: "strong", isStrong: false }); // thin confidence
  });

  it("a missing cell is the unproven neutral prior; the value is 0 where the work type forbids the position; closeScore is the max closeOnTime mean", () => {
    const maya = person("u-maya", "trainer");
    expect(skillOf(lookup, maya, I.$THIRD, S.positions[I.$THIRD])).toMatchObject({ value: 0.5, band: "unproven" });
    expect(skillOf(lookup, maya, I.$DISH, S.positions[I.$DISH]).value).toBe(0); // FOH on Prep/Dishwasher
    expect(skillOf(lookup, person("u-maya", "trainer", "boh"), I.$REG, S.positions[I.$REG]).value).toBe(0); // BOH on the line
    expect(lookup.closeScoreByUser).toEqual({ "u-eli": null, "u-maya": 0.95 });
  });

  it("toSchedPeople fills newerPositions / strongPositions from the lookup", () => {
    const { people } = toSchedPeople({
      members: [{ userId: "u-eli", role: "trainee", active: true }, { userId: "u-maya", role: "trainer", active: true }], settings: [], patterns: {}, dates: [],
      structure: S, shopDay: SHOP, skills: lookup, wages: { byUserCents: {}, estimateHourlyCents: null },
    });
    expect(people.map((p) => [p.userId, p.newerPositions, p.strongPositions])).toEqual([["u-eli", [I.$REG], []], ["u-maya", [], [I.$REG]]]);
  });
});

describe("Astra chunk B review — people input (failing first)", () => {
  it("P2-3 firstSeen: the supplied historical start WINS; the truncated window's first punch never overrides it (January start, one recent 4 h Monday)", () => {
    const entries = [...shopOpen(), punch("u-jan", MONDAYS[7]!, "10:00", "14:00", 4)];
    const p = punchPatterns(entries, { asOf: ASOF, firstSeen: { "u-jan": "2026-01-12" } });
    expect(p["u-jan"]!.byDow[1]).toMatchObject({ weeksWorked: 1, weeksObserved: 8, share: 0.125 });
    expect(p["u-jan"]!.meanWeeklyHours).toBe(1); // 4 h over the last 4 observed weeks, not 4 h over 1
    expect(p["u-jan"]!.firstWeek).toBe("2026-01-12");
    // With 8 observed weeks and a 12.5% share the person is NOT assumed available on Mondays (never insufficient history).
    expect(assumedAvailability(p["u-jan"]!.byDow[1], SHOP)).toBeNull();
  });

  it("P2-4 overnight punches: the clock-out is computed against the business date before clamping (18:00 → 00:30 is not 17:30–17:45)", () => {
    const night = (mon: string) => ({ ...punch("u-night", mon, "18:00", null, 6.5), outAt: at(addDays(mon, 1), "00:30") });
    const p = punchPatterns([...shopOpen(), ...MONDAYS.slice(5).map(night)], { asOf: ASOF });
    expect(p["u-night"]!.byDow[1]).toMatchObject({ weeksWorked: 3, weeksObserved: 3, p10InQ: 72, p90OutQ: 96 });
    expect(assumedAvailability(p["u-night"]!.byDow[1], SHOP)).toEqual({ fromQ: 70, toQ: 84, source: "toast_pattern" });
  });

  it("P2-5 cgs and the social media manager are NEVER on the roster — before the configurable exclusions, even with excludedRoles = [] and rosterInclude", () => {
    const open = { ...S, roster: { excludedRoles: [] } } as ScheduleStructure;
    const members: MemberInput[] = [{ userId: "u-cgs", role: "cgs", active: true }, { userId: "u-smm", role: "social_media_mgr", active: true }, { userId: "u-ben", role: "employee", active: true }];
    const include = (userId: string): PersonSettingsRow => ({ userId, workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: true });
    const r = toSchedPeople({ members, settings: [include("u-cgs"), include("u-smm")], patterns: {}, dates: ["2026-10-26"], structure: open, shopDay: SHOP, skills: null, wages: { byUserCents: {}, estimateHourlyCents: null } });
    expect(r.people.map((p) => p.userId)).toEqual(["u-ben"]);
    expect(r.notes).toEqual([]);
  });
});
