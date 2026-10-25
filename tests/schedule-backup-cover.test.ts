import { describe, expect, it } from "vitest";
import { buildCrewWeek } from "@/lib/scheduling/generator/crew-shared";
import { buildWeek, type GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { crewOpenItems, verifyCrewGap } from "@/lib/scheduling/crew-gap-verifier-shared";
import { checkCertificate, checkScheduleRules, generatorRefuses, MOD, type WeekSchedule } from "@/lib/scheduling/rules-shared";
import { applyEdit } from "@/lib/scheduling/edit-shared";
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
  expect(checkScheduleRules(week(out), out.context).filter((p) => !p.inherited && generatorRefuses(p))).toEqual([]);
  expect(out.gaps.filter((g) => g.cause === "unresolved_search")).toEqual([]);
  for (const g of out.gaps) {
    expect(checkCertificate(g, week(out), out.context)).toBe(true);
    if (g.cause === "crew_shortfall") expect(verifyCrewGap(g, week(out), out.context)).toBe(true);
  }
}

describe("crew Backup cover", () => {
  it("fills only after ordinary candidates and marks source and reason", () => {
    const i = input([{ id: "a", role: "moo", cover: [I.$REG] }, { id: "z", role: "employee", cover: [I.$REG] }], 1, 1);
    i.people[0]!.usualShift = { value: { typeId: "mid" }, source: "manager", deletedTypeId: null };
    const filled = buildCrewWeek(i);
    expect(filled.shifts.map((s) => s.userId)).toEqual(["z"]); clean(filled);
    i.people[1]!.workModes![MON] = "off";
    const backup = buildCrewWeek(i);
    expect(backup.shifts.map((s) => s.userId)).toEqual(["a"]);
    expect(backup.context.days[MON]!.crew!.shifts).toContainEqual(expect.objectContaining({ userId: "a", typeId: "mid", source: "backup_cover" }));
    expect(Object.values(backup.reasons).flatMap((r) => r.shift)).toContainEqual(expect.objectContaining({ key: "backup_cover", params: expect.objectContaining({ typeId: "mid" }) }));
    clean(backup);
  });
  it("caps DISTINCT people per day and balances their weekly hours deterministically", () => {
    const i = input(undefined, 1, 2, DATES.slice(0, 3));
    const out = buildCrewWeek(i);
    expect(out.shifts.map((s) => [s.date, s.userId])).toEqual([[DATES[0], "a"], [DATES[1], "b"], [DATES[2], "a"]]);
    for (const date of DATES.slice(0, 3)) expect(new Set(out.shifts.filter((s) => s.date === date).map((s) => s.userId)).size).toBe(1);
    i.people.reverse(); i.days.reverse();
    expect(JSON.stringify(buildCrewWeek(i))).toBe(JSON.stringify(out)); clean(out);
  });
  it("respects busiest day order before balancing hours", () => {
    const i = input(undefined, 1, 1, DATES.slice(0, 2)); i.days[1]!.dayType = "busy";
    const out = buildCrewWeek(i);
    expect(out.shifts.find((s) => s.date === DATES[1])?.userId).toBe("a");
    expect(out.shifts.find((s) => s.date === DATES[0])?.userId).toBe("b"); clean(out);
  });
  it("cap zero disables fills and proves every opted-in candidate with backup_cover_cap", () => {
    const i = input(undefined, 0);
    i.people[0]!.usualShift = { value: { typeId: "mid" }, source: "manager", deletedTypeId: null };
    const out = buildCrewWeek(i); expect(out.shifts).toEqual([]);
    const open = crewOpenItems(MON, week(out), out.context);
    expect(open).toHaveLength(1);
    for (const r of open[0]!.rejected) expect(r.codes).toContain("backup_cover_cap");
    expect(open[0]!.rejected.map((r) => r.userId)).toEqual(["a", "b"]); clean(out);
  });
  it("leaves non-opted-in presence-only people outside generated shifts and evidence", () => {
    const i = input(); i.people.forEach((p) => { p.backupCover = false; });
    const out = buildCrewWeek(i); expect(out.shifts).toEqual([]);
    expect(crewOpenItems(MON, week(out), out.context)[0]!.rejected).toEqual([]); clean(out);
  });
  it("excludes backup hours from budget, costs and soft/overtime notes", () => {
    const i = input(undefined, 1, 1, DATES);
    i.structure.limits.overtimeH = 1;
    for (const p of i.people) { p.softMaxH = 1; p.softMinH = 40; p.wageCents = 9999; }
    for (const date of DATES) i.budgetByDate[date] = 0;
    const out = buildCrewWeek(i);
    expect(out.shifts).toHaveLength(7);
    expect(out.stats.hourlyHours).toBe(0); expect(out.stats.hourlyCostCents).toBe(0);
    expect(out.notes.filter((n) => ["over_soft_max", "overtime_used", "budget_stopped"].includes(n.code))).toEqual([]);
    expect(out.problems.filter((p) => p.code === "overtime" || p.code === "soft_range")).toEqual([]);
    expect(out.context.people.a!.presenceOnly).toBe(true); clean(out);
  });
  it("assigns real station coverage only from cover positions, without selecting a closing manager", () => {
    const out = buildCrewWeek(input(undefined, 1, 1));
    expect(out.shifts).toHaveLength(1);
    expect(out.shifts[0]!.segments.some((s) => s.positionId === I.$REG)).toBe(true);
    expect(out.shifts[0]!.segments.every((s) => s.positionId === I.$REG || s.positionId === MOD)).toBe(true);
    expect(out.shifts[0]!.closingManager).toBe(false); clean(out);
    const i = input([{ id: "a", role: "moo", cover: [I.$EXPO] }], 1, 1);
    const refused = buildCrewWeek(i); expect(refused.shifts).toEqual([]);
    expect(crewOpenItems(MON, week(refused), refused.context)[0]!.rejected[0]!.codes).toContain("position"); clean(refused);
  });
  it.each(["manual", "pin"] as const)("counts a %s backup person toward the cap", (source) => {
    const i = input();
    if (source === "manual") i.crew = { manualOverridesByDate: { [MON]: [{
      original: { userId: "b", date: MON, startQ: 44 },
      replacement: { userId: "b", date: MON, startQ: 44, endQ: 64, segments: [{ positionId: I.$REG, startQ: 44, endQ: 64 }], closingManager: false, flex: false, pinned: false },
    }] } };
    else i.pins = [{ id: "pin-b", userId: "b", date: MON, startQ: 44, endQ: 64, positions: [I.$REG], kind: "added" }];
    const out = buildCrewWeek(i);
    expect(out.shifts.map((s) => s.userId)).toEqual(["b"]);
    expect(out.context.days[MON]!.crew!.shifts[0]!.source).toBe(source);
    expect(crewOpenItems(MON, week(out), out.context)[0]!.rejected.find((r) => r.userId === "a")!.codes).toContain("backup_cover_cap"); clean(out);
  });
  it("retains overtime and soft-max notes for presence pins without opt-in", () => {
    const i = input([{ id: "moo", role: "moo", cover: [I.$REG] }]);
    i.people[0]!.backupCover = false; i.people[0]!.softMaxH = 3;
    i.structure.limits.overtimeH = 4;
    i.pins = [{ id: "presence", userId: "moo", date: MON, startQ: 44, endQ: 64, positions: [], kind: "presence" }];
    const out = buildCrewWeek(i);
    expect(out.problems).toContainEqual(expect.objectContaining({ code: "overtime" }));
    for (const code of ["overtime_used", "over_soft_max"]) expect(out.notes).toContainEqual(expect.objectContaining({ code, userId: "moo" }));
  });
  it("balances generated backup hours only, ignoring Pete's 20 presence hours", () => {
    const i = input([{ id: "cristian", role: "moo", cover: [I.$REG] }, { id: "pete", role: "owner", cover: [I.$REG] }], 1, 1, DATES.slice(0, 6));
    // Reserve 20 presence hours first. Cristian gets the first generated block;
    // Pete must get the next despite having more total on-clock hours.
    i.pins = DATES.slice(0, 4).map((date) => ({ id: `presence-${date}`, userId: "pete", date, startQ: 44, endQ: 64, positions: [], kind: "presence" as const }));
    const out = buildCrewWeek(i);
    expect(out.shifts.filter((s) => DATES.slice(4, 6).includes(s.date)).map((s) => s.userId)).toEqual(["cristian", "pete"]);
    clean(out);
  });
  it.each(["employee", "gm"] as const)("tries %s tier before backup", (role) => {
    const i = input([{ id: "a", role: "moo", cover: [I.$REG] }, { id: "z", role, cover: [I.$REG] }], 1, 1);
    const p = i.people[1]!;
    p.workModes![MON] = "if_needed"; p.leaderSetting = "mix"; i.structure.limits.gmMinimumH = 4;
    if (role === "employee") {
      p.workModes![MON] = "if_needed";
      p.usualShift = { value: { typeId: "mid" }, source: "manager", deletedTypeId: null };
    }
    const out = buildCrewWeek(i);
    expect(out.shifts.map((s) => s.userId)).toEqual(["z"]); clean(out);
  });
  it("cap two places two of three opt-ins and certifies the third's cap refusal", () => {
    const i = input(["a", "b", "c"].map((id) => ({ id, role: "moo", cover: [I.$REG] })), 2, 3);
    const out = buildCrewWeek(i);
    expect(out.shifts.map((s) => s.userId)).toEqual(["a", "b"]);
    expect(crewOpenItems(MON, week(out), out.context)[0]!.rejected.find((r) => r.userId === "c")!.codes).toContain("backup_cover_cap"); clean(out);
  });
  it("includes available backup candidates in an edit's unresolved search", () => {
    const i = input(undefined, 2, 2);
    const out = buildCrewWeek(i);
    const sh = out.shifts[0]!;
    const edited = applyEdit(week(out), { kind: "removeShift", shift: sh }, out.context, { today: MON, newRevisionId: "edited" });
    const gap = edited.schedule.gaps.find((g) => g.code === "open_shift");
    expect(gap?.cause).toBe("unresolved_search");
    if (gap?.cause !== "unresolved_search") throw new Error("expected unresolved search");
    expect(gap.certificate.candidateIds).toEqual(["a", "b"]);
  });
  it("records a below-cap refusal using existing evidence and rejects missing evidence", () => {
    const i = input([{ id: "a", role: "moo", cover: [I.$REG], off: [1] }]);
    const out = buildCrewWeek(i); expect(out.shifts).toEqual([]);
    expect(crewOpenItems(MON, week(out), out.context)[0]!.rejected[0]!.codes).toContain("off"); clean(out);
    const gap = structuredClone(out.gaps.find((g) => g.code === "open_shift")!);
    if (gap.cause !== "crew_shortfall" || gap.certificate.kind !== "open_shifts") throw new Error("expected open-shift certificate");
    gap.certificate.items[0]!.rejected = [];
    expect(verifyCrewGap(gap, week(out), out.context)).toBe(false);
  });
  it("uses fill end flex and fix-F shortening with the same legality checks", () => {
    const i = input([{ id: "a", role: "moo", cover: [I.$REG], leader: "opens" }], 1, 1);
    i.structure.shiftTypes![0]!.startFlexQ = 2;
    const opens = buildCrewWeek(i);
    expect(opens.shifts).toMatchObject([{ startQ: 44, endQ: 63 }]); clean(opens);
    i.people[0]!.leaderSetting = "mix";
    i.structure.limits.maxShiftH = 4.5;
    const shortened = buildCrewWeek(i);
    expect(shortened.shifts).toMatchObject([{ startQ: 46, endQ: 64 }]); clean(shortened);
    i.structure.limits.maxShiftH = 3.75;
    const refused = buildCrewWeek(i);
    expect(refused.shifts).toEqual([]);
    expect(crewOpenItems(MON, week(refused), refused.context)[0]!.rejected[0]!.codes).toContain("maximum_length"); clean(refused);
  });
  it("retains the station dispatch byte-for-byte with backup opt-in present", () => {
    const i = input(); i.structure.engine = "stations";
    expect(JSON.stringify(generateWeek(i))).toBe(JSON.stringify(buildWeek(i)));
    expect(generateWeek(i).shifts).toEqual([]);
  });
});



