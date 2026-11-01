import { describe, expect, it } from "vitest";
import { buildCrewWeek } from "@/lib/scheduling/generator/crew-shared";
import { type GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import { crewOpenItems, crewBackupCoverWeekAtCap, verifyCrewGap } from "@/lib/scheduling/crew-gap-verifier-shared";
import { approvalRefusal, checkCertificate, checkScheduleRules, generatorRefuses, type WeekSchedule } from "@/lib/scheduling/rules-shared";
import { DATES, I, day, fixture, structure, type PersonSpec } from "./fixtures/schedule/fixtures";

const MON = DATES[0]!;
function input(specs: PersonSpec[] = [{ id: "a", role: "moo", cover: [I.$REG] }, { id: "b", role: "owner", cover: [I.$REG] }], cap = 1, heads = 2, dates = [MON]) {
  const s = structure((s) => {
    s.engine = "crew"; s.roster.backupCoverPerDay = cap;
    s.shopDay = { prepStartQ: 40, prepDishArrivalQ: 40, serviceStartQ: 44, serviceCloseQ: 64, outEarliestQ: 64, outLatestQ: 68 };
    s.positions = { [I.$REG]: { role: "register", openQ: 44, trimQ: 64, closeQ: 64, headsBefore: 1, headsAfter: 1, allowedRoles: ["employee", "gm", "moo", "owner"] } };
    s.priority = []; s.leadership.modRequired = false;
    s.shiftTypes = [{ id: "mid", name: "Mid", fromQ: 44, toQ: 64, startFlexQ: 0, minLengthQ: 16,
      headcount: { slow: heads, normal: heads, busy: heads, weekend: heads }, stations: [I.$REG], countsTowardMod: true }];
    for (const dt of ["slow", "normal", "busy", "weekend"] as const) s.crews[dt] = {
      prepHeads: 0, prepUntilQ: 44, prepDishHeads: 0, waves: { setup: { heads: 1, atQ: 44 }, service: { heads: 0 }, rush: { heads: 0, atQ: 48 } },
      close: { registerHeads: 0, walkHeads: 0, prepDishHeads: 0 }, lineMinHeads: { [I.$REG]: 1 },
    };
  });
  const i = fixture({ structure: s, specs, days: dates.map((date) => day(date, { scheduledOutQ: 64, closingMinutes: 0, demandKind: "no_history", hourlyCents: null, dayCents: null }, s)) });
  for (const p of i.people) {
    p.backupCover = p.presenceOnly;
    p.workModes = Object.fromEntries(DATES.map((d) => [d, p.availability[d] === null ? "off" : "works"]));
  }
  return i;
}
const week = (out: GeneratorOutput): WeekSchedule => ({ locationId: out.context.locationId, weekStart: out.context.weekStart, shifts: out.shifts, days: out.days, gaps: out.gaps });
function clean(out: GeneratorOutput) {
  expect(approvalRefusal(week(out), checkScheduleRules(week(out), out.context))).toBeNull();
  expect(checkScheduleRules(week(out), out.context).filter((p) => !p.inherited && generatorRefuses(p))).toEqual([]);
  expect(out.gaps.filter((g) => g.cause === "unresolved_search")).toEqual([]);
  for (const g of out.gaps) {
    expect(checkCertificate(g, week(out), out.context)).toBe(true);
    if (g.cause === "crew_shortfall") expect(verifyCrewGap(g, week(out), out.context)).toBe(true);
  }
}


describe("crew Backup cover weekly cap", () => {
  const one = [{ id: "a", role: "moo" as const, cover: [I.$REG] }];
  it.each([undefined, 2, 0])("caps four open dates with weekly setting %s and complete evidence", (cap) => {
    const i = input(one, 1, 1, DATES.slice(0, 4));
    if (cap !== undefined) i.structure.roster.backupCoverPerPersonWeek = cap;
    const out = buildCrewWeek(i);
    expect(new Set(out.shifts.map((s) => s.date)).size).toBe(cap ?? 2);
    const open = i.days.flatMap((d) => crewOpenItems(d.date, week(out), out.context));
    expect(open).toHaveLength(4 - (cap ?? 2));
    for (const item of open) expect(item.rejected).toEqual([{ userId: "a", codes: ["backup_cover_week_cap"] }]);
    clean(out);
    expect(JSON.stringify(buildCrewWeek(i))).toBe(JSON.stringify(out));
    i.days.reverse(); i.people.reverse();
    expect(JSON.stringify(buildCrewWeek(i))).toBe(JSON.stringify(out));
  });
  it("caps each of two opt-ins at one day independent of candidate order", () => {
    const i = input(undefined, 1, 1, DATES.slice(0, 4));
    i.structure.roster.backupCoverPerPersonWeek = 1;
    const out = buildCrewWeek(i);
    expect(out.shifts.map((s) => s.userId).sort()).toEqual(["a", "b"]);
    for (const d of i.days) for (const item of crewOpenItems(d.date, week(out), out.context))
      for (const rejection of item.rejected) expect(rejection.codes).toContain("backup_cover_week_cap");
    clean(out);
    i.people.reverse(); i.days.reverse();
    expect(JSON.stringify(buildCrewWeek(i))).toBe(JSON.stringify(out));
  });
  it.each(["pin", "manual"] as const)("counts a %s toward the weekly cap", (source) => {
    const i = input(one, 1, 1, DATES.slice(0, 4));
    i.structure.roster.backupCoverPerPersonWeek = 1;
    if (source === "pin") i.pins = [{ id: "pin-a", userId: "a", date: MON, startQ: 44, endQ: 64, positions: [I.$REG], kind: "added" }];
    else i.crew = { manualOverridesByDate: { [MON]: [{
      original: { userId: "a", date: MON, startQ: 44 },
      replacement: { userId: "a", date: MON, startQ: 44, endQ: 64, segments: [{ positionId: I.$REG, startQ: 44, endQ: 64 }], closingManager: false, flex: false, pinned: false },
    }] } };
    const out = buildCrewWeek(i);
    expect(out.shifts.map((s) => [s.date, s.userId])).toEqual([[MON, "a"]]);
    expect(out.context.days[MON]!.crew!.shifts[0]!.source).toBe(source);
    for (const date of DATES.slice(1, 4))
      expect(crewOpenItems(date, week(out), out.context)[0]!.rejected[0]!.codes).toContain("backup_cover_week_cap");
    clean(out);
  });
  it("counts dates once even with multiple blocks, independently of source metadata", () => {
    const out = buildCrewWeek(input(one, 1, 1));
    const sh = out.shifts[0]!;
    const p = out.context.people.a!;
    expect(crewBackupCoverWeekAtCap(p, MON, { shifts: [sh, { ...sh, startQ: 65, endQ: 68 }] }, out.context)).toBe(false);
    expect(crewBackupCoverWeekAtCap(p, MON, { shifts: [sh, { ...sh, date: DATES[1]! }] }, out.context)).toBe(true);
  });
});
