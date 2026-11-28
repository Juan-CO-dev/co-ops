/**
 * The per-day roster of one 7shifts location (digest PR 2, plan §2.2 / §2.3). Published-only is the raw check's
 * job; here: the ET day of a shift's start, open shifts counted and never named, names and roles, order.
 * Synthetic people only ("Person A" …), made-up ids.
 */
import { describe, expect, it } from "vitest";
import {
  ROLE_NAME_MAX,
  publishedRoster,
  structuredFirstName,
  type PublishedShift,
  type ScheduleNames,
} from "@/lib/report-digests-schedule-shared";

const LOC = "501";
const OTHER = "502";
let seq = 0;
function shift(p: Partial<PublishedShift> & { startAt: string; endAt: string }): PublishedShift {
  seq += 1;
  const open = p.open ?? false;
  return { id: String(1000 + seq), locationId: LOC, userId: open ? null : "11", open, roleId: null, ...p };
}
const NO_NAMES: ScheduleNames = { firstNames: new Map(), roleNames: new Map() };
const names = (first: Record<string, string | null>, roles: Record<string, string | null> = {}): ScheduleNames => ({
  firstNames: new Map(Object.entries(first)),
  roleNames: new Map(Object.entries(roles)),
});

describe("structuredFirstName", () => {
  it("prefers the preferred first name, trimmed", () => {
    expect(structuredFirstName({ first_name: "Person", preferred_first_name: "  Pat " })).toBe("Pat");
  });
  it("falls back to the first name when there is no preferred one (null or whitespace)", () => {
    expect(structuredFirstName({ first_name: " Person A ", preferred_first_name: null })).toBe("Person A");
    expect(structuredFirstName({ first_name: "Person A", preferred_first_name: "   " })).toBe("Person A");
  });
  it("whitespace-only or missing everywhere is null", () => {
    expect(structuredFirstName({ first_name: "  ", preferred_first_name: "\t" })).toBeNull();
    expect(structuredFirstName({ first_name: null, preferred_first_name: null })).toBeNull();
  });
});

describe("publishedRoster", () => {
  it("a day with nothing gets an empty DayRoster; days come back in the order asked", () => {
    const out = publishedRoster([], LOC, ["2026-03-02", "2026-03-01"], NO_NAMES);
    expect(out.days).toEqual([
      { day: "2026-03-02", people: [], assignedShifts: 0, openShifts: 0, firstStart: null, lastEnd: null, scheduledMinutes: 0 },
      { day: "2026-03-01", people: [], assignedShifts: 0, openShifts: 0, firstStart: null, lastEnd: null, scheduledMinutes: 0 },
    ]);
  });

  it("open shifts are counted, never named, and never in hours or first/last", () => {
    const shifts = [
      shift({ userId: "11", startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T18:00:00.000Z" }),
      shift({ open: true, startAt: "2026-03-01T12:00:00.000Z", endAt: "2026-03-01T23:00:00.000Z" }),
    ];
    const [d] = publishedRoster(shifts, LOC, ["2026-03-01"], names({ "11": "Person A" })).days;
    expect(d!.openShifts).toBe(1);
    expect(d!.people.map((p) => p.userId)).toEqual(["11"]);
    expect(d!.firstStart).toBe("2026-03-01T14:00:00.000Z");
    expect(d!.lastEnd).toBe("2026-03-01T18:00:00.000Z");
    expect(d!.scheduledMinutes).toBe(240);
    expect(d!.assignedShifts).toBe(1);
  });

  it("an open-only day: people [], openShifts 1, firstStart null", () => {
    const [d] = publishedRoster([shift({ open: true, startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T18:00:00.000Z" })], LOC, ["2026-03-01"], NO_NAMES).days;
    expect(d).toEqual({ day: "2026-03-01", people: [], assignedShifts: 0, openShifts: 1, firstStart: null, lastEnd: null, scheduledMinutes: 0 });
  });

  it("ET day edges on 2026-03-08 (spring forward): 04:59:59Z is the 7th, 05:00Z the 8th, 03:59:59Z on the 9th is still the 8th", () => {
    const shifts = [
      shift({ userId: "11", startAt: "2026-03-08T04:59:59.000Z", endAt: "2026-03-08T06:00:00.000Z" }),
      shift({ userId: "12", startAt: "2026-03-08T05:00:00.000Z", endAt: "2026-03-08T06:00:00.000Z" }),
      shift({ userId: "13", startAt: "2026-03-09T03:59:59.000Z", endAt: "2026-03-09T05:00:00.000Z" }),
      shift({ userId: "14", startAt: "2026-03-09T04:00:00.000Z", endAt: "2026-03-09T05:00:00.000Z" }),
    ];
    const days = publishedRoster(shifts, LOC, ["2026-03-07", "2026-03-08", "2026-03-09"], NO_NAMES).days;
    expect(days.map((d) => d.people.map((p) => p.userId))).toEqual([["11"], ["12", "13"], ["14"]]);
  });

  it("ET day edges on 2026-11-01 (fall back): 03:59:59Z is Oct 31, 04:00Z Nov 1, 04:59:59Z on Nov 2 still Nov 1", () => {
    const shifts = [
      shift({ userId: "11", startAt: "2026-11-01T03:59:59.000Z", endAt: "2026-11-01T05:00:00.000Z" }),
      shift({ userId: "12", startAt: "2026-11-01T04:00:00.000Z", endAt: "2026-11-01T05:00:00.000Z" }),
      shift({ userId: "13", startAt: "2026-11-02T04:59:59.000Z", endAt: "2026-11-02T06:00:00.000Z" }),
      shift({ userId: "14", startAt: "2026-11-02T05:00:00.000Z", endAt: "2026-11-02T06:00:00.000Z" }),
    ];
    const days = publishedRoster(shifts, LOC, ["2026-10-31", "2026-11-01", "2026-11-02"], NO_NAMES).days;
    expect(days.map((d) => d.people.map((p) => p.userId))).toEqual([["11"], ["12", "13"], ["14"]]);
  });

  it("an overnight shift is on its start day only (and its whole length counts there)", () => {
    const s = shift({ userId: "11", startAt: "2026-03-02T03:00:00.000Z", endAt: "2026-03-02T09:00:00.000Z" }); // 10 PM ET Mar 1 → 4 AM Mar 2
    const [d1, d2] = publishedRoster([s], LOC, ["2026-03-01", "2026-03-02"], NO_NAMES).days;
    expect(d1!.people).toHaveLength(1);
    expect(d1!.scheduledMinutes).toBe(360);
    expect(d1!.lastEnd).toBe("2026-03-02T09:00:00.000Z");
    expect(d2!.people).toEqual([]);
    expect(d2!.assignedShifts).toBe(0);
  });

  it("names: a person with a name, whitespace-only → null, no name row → null", () => {
    const shifts = [
      shift({ userId: "11", startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T15:00:00.000Z" }),
      shift({ userId: "12", startAt: "2026-03-01T15:00:00.000Z", endAt: "2026-03-01T16:00:00.000Z" }),
      shift({ userId: "13", startAt: "2026-03-01T16:00:00.000Z", endAt: "2026-03-01T17:00:00.000Z" }),
    ];
    const [d] = publishedRoster(shifts, LOC, ["2026-03-01"], names({ "11": " Person A ", "12": "   " })).days;
    expect(d!.people.map((p) => p.firstName)).toEqual(["Person A", null, null]);
  });

  it("roles: trimmed, cut at 40, whitespace or no role row or no role id → null", () => {
    const long = "R".repeat(ROLE_NAME_MAX + 5);
    const shifts = [
      shift({ userId: "11", roleId: "21", startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T15:00:00.000Z" }),
      shift({ userId: "12", roleId: "22", startAt: "2026-03-01T15:00:00.000Z", endAt: "2026-03-01T16:00:00.000Z" }),
      shift({ userId: "13", roleId: "23", startAt: "2026-03-01T16:00:00.000Z", endAt: "2026-03-01T17:00:00.000Z" }),
      shift({ userId: "14", roleId: "99", startAt: "2026-03-01T17:00:00.000Z", endAt: "2026-03-01T18:00:00.000Z" }),
      shift({ userId: "15", roleId: null, startAt: "2026-03-01T18:00:00.000Z", endAt: "2026-03-01T19:00:00.000Z" }),
    ];
    const [d] = publishedRoster(shifts, LOC, ["2026-03-01"], names({}, { "21": "  Line ", "22": long, "23": "  " })).days;
    expect(ROLE_NAME_MAX).toBe(40);
    expect(d!.people.map((p) => p.roleName)).toEqual(["Line", "R".repeat(40), null, null, null]);
  });

  it("the role cut never splits a character made of two UTF-16 units", () => {
    const role = "a".repeat(39) + "😀" + "b";
    const [d] = publishedRoster([shift({ userId: "11", roleId: "21", startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T15:00:00.000Z" })], LOC, ["2026-03-01"], names({}, { "21": role })).days;
    expect(d!.people[0]!.roleName).toBe("a".repeat(39) + "😀");
  });

  it("two shifts for one person: extraShifts 1, the first shift and its role shown, both counted", () => {
    const shifts = [
      shift({ userId: "11", roleId: "22", startAt: "2026-03-01T21:00:00.000Z", endAt: "2026-03-02T01:00:00.000Z" }),
      shift({ userId: "11", roleId: "21", startAt: "2026-03-01T12:00:00.000Z", endAt: "2026-03-01T16:00:00.000Z" }),
    ];
    const [d] = publishedRoster(shifts, LOC, ["2026-03-01"], names({ "11": "Person A" }, { "21": "Line", "22": "Close" })).days;
    expect(d!.people).toEqual([
      { userId: "11", firstName: "Person A", roleName: "Line", startAt: "2026-03-01T12:00:00.000Z", endAt: "2026-03-01T16:00:00.000Z", extraShifts: 1 },
    ]);
    expect(d!.assignedShifts).toBe(2);
    expect(d!.scheduledMinutes).toBe(480);
    expect(d!.firstStart).toBe("2026-03-01T12:00:00.000Z");
    expect(d!.lastEnd).toBe("2026-03-02T01:00:00.000Z");
  });

  it("a person's first shift breaks a start tie by shift id", () => {
    const shifts = [
      shift({ id: "20", userId: "11", roleId: "22", startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T15:00:00.000Z" }),
      shift({ id: "9", userId: "11", roleId: "21", startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T18:00:00.000Z" }),
    ];
    const [d] = publishedRoster(shifts, LOC, ["2026-03-01"], names({}, { "21": "Line", "22": "Close" })).days;
    expect(d!.people[0]).toMatchObject({ roleName: "Line", endAt: "2026-03-01T18:00:00.000Z", extraShifts: 1 });
  });

  it("stable order: first start, then first name (nulls last, locale-free), then user id", () => {
    const at = "2026-03-01T14:00:00.000Z";
    const end = "2026-03-01T18:00:00.000Z";
    const shifts = [
      shift({ userId: "100", startAt: at, endAt: end }),
      shift({ userId: "30", startAt: at, endAt: end }),
      shift({ userId: "4", startAt: at, endAt: end }),
      shift({ userId: "5", startAt: at, endAt: end }),
      shift({ userId: "6", startAt: at, endAt: end }),
      shift({ userId: "7", startAt: "2026-03-01T13:00:00.000Z", endAt: end }),
    ];
    const nm = names({ "100": "Person B", "30": null, "4": null, "5": "Person A", "6": "person a" });
    const order = (list: PublishedShift[]) => publishedRoster(list, LOC, ["2026-03-01"], nm).days[0]!.people.map((p) => p.userId);
    const want = ["7", "5", "100", "6", "4", "30"];
    expect(order(shifts)).toEqual(want);
    expect(order([...shifts].reverse())).toEqual(want);
  });

  it("shifts of the other location and of days not asked for are ignored", () => {
    const shifts = [
      shift({ userId: "11", startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T18:00:00.000Z" }),
      shift({ userId: "12", locationId: OTHER, startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T18:00:00.000Z" }),
      shift({ open: true, locationId: OTHER, startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T18:00:00.000Z" }),
      shift({ userId: "13", startAt: "2026-03-05T14:00:00.000Z", endAt: "2026-03-05T18:00:00.000Z" }),
    ];
    const out = publishedRoster(shifts, LOC, ["2026-03-01"], NO_NAMES);
    expect(out.days).toHaveLength(1);
    expect(out.days[0]!.people.map((p) => p.userId)).toEqual(["11"]);
    expect(out.days[0]!.openShifts).toBe(0);
    expect(out.days[0]!.assignedShifts).toBe(1);
  });
});
