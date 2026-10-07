import { describe, expect, it } from "vitest";
import {
  canManageAssignee, canSelfClaim, currentStation, stationTimeline,
  TASK_TYPES, TASK_MIN_LEVEL, taskHref, taskVisible,
  type StationEvent, type TaskAssignment,
} from "@/lib/assignments-shared";

function event(overrides: Partial<StationEvent> = {}): StationEvent {
  return {
    id: "event-1", sequence: "1", locationId: "shop-a", businessDate: "2026-10-07",
    userId: "employee", stationId: "station-a", kind: "claim", actorId: "employee",
    actorName: "Employee", at: "2026-10-07T12:00:00Z", source: "claimed", ...overrides,
  };
}

describe("station authority", () => {
  it("allows KH+ to manage peers and lower levels, never higher levels", () => {
    for (const actor of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const target of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        expect(canManageAssignee(actor, target)).toBe(actor >= 4 && target <= actor);
      }
    }
  });
  it("lets an employee change or release a claim, but locks an assignment", () => {
    expect(canSelfClaim(null)).toBe(true);
    expect(canSelfClaim(event())).toBe(true);
    expect(canSelfClaim(event({ kind: "move", source: "claimed" }))).toBe(true);
    expect(canSelfClaim(event({ kind: "assign", source: "assigned" }))).toBe(false);
    expect(canSelfClaim(event({ kind: "move", source: "assigned" }))).toBe(false);
    expect(canSelfClaim(event({ kind: "release", stationId: null, source: null }))).toBe(true);
  });
});

describe("append-only station history", () => {
  it("chooses the serialized head even with tied timestamps and bigint sequences", () => {
    const old = event({ sequence: "9007199254740992" });
    const head = event({ id: "head", sequence: "9007199254740993", stationId: null, kind: "release", source: null });
    const other = event({ id: "other", sequence: "9007199254740994", userId: "someone-else" });
    const history = [head, other, old];
    expect(currentStation(history, "employee")).toEqual(head);
    expect(currentStation(history, "missing")).toBeNull();
    expect(history).toEqual([head, other, old]);
  });
  it("ends each station interval on a move or release and preserves the assignment source", () => {
    const first = event();
    const move = event({ id: "move", sequence: "2", at: "2026-10-07T13:00:00Z", stationId: "station-b", kind: "move", source: "assigned", actorId: "kh" });
    const release = event({ id: "release", sequence: "3", at: "2026-10-07T14:00:00Z", stationId: null, source: null, kind: "release" });
    expect(stationTimeline([release, first, move])).toEqual([
      { locationId: first.locationId, businessDate: first.businessDate, userId: first.userId, stationId: "station-a", source: "claimed", start: first.at, end: move.at, eventId: first.id },
      { locationId: first.locationId, businessDate: first.businessDate, userId: first.userId, stationId: "station-b", source: "assigned", start: move.at, end: release.at, eventId: move.id },
    ]);
    expect(first.stationId).toBe("station-a");
  });
  it("does not close another person's, shop's, or day's interval", () => {
    const initial = event();
    const others = [
      event({ id: "shop", sequence: "2", locationId: "shop-b" }),
      event({ id: "day", sequence: "3", businessDate: "2026-10-08" }),
      event({ id: "person", sequence: "4", userId: "someone-else" }),
    ];
    const release = event({ id: "release", sequence: "5", at: "2026-10-07T14:00:00Z", stationId: null, source: null, kind: "release" });
    const timeline = stationTimeline([initial, ...others, release]);
    expect(timeline).toHaveLength(4);
    expect(timeline.find((row) => row.eventId === initial.id)?.end).toBe(release.at);
    for (const other of others) expect(timeline.find((row) => row.eventId === other.id)?.end).toBeNull();
  });
});

describe("assignment dashboard visibility", () => {
  it.each(TASK_TYPES)("shows %s below KH only when that task is assigned", (task) => {
    const assignment: TaskAssignment = { id: "assignment", task, assigneeId: "employee", assignerId: "kh", assignerName: "Lead", note: null };
    expect(taskVisible(3, task, [])).toBe(false);
    expect(taskVisible(3, task, [assignment])).toBe(TASK_MIN_LEVEL[task] <= 3);
    for (const other of TASK_TYPES.filter((candidate) => candidate !== task)) {
      expect(taskVisible(3, other, [assignment])).toBe(false);
    }
    for (const level of [4, 5, 6, 7, 8, 9, 10]) {
      expect(taskVisible(level, task, [])).toBe(false);
      expect(taskVisible(level, task, [assignment])).toBe(true);
    }
  });
  it("keeps the selected shop in every task link", () => {
    for (const task of TASK_TYPES) expect(taskHref(task, "shop & one")).toContain("?location=shop%20%26%20one");
  });
});
