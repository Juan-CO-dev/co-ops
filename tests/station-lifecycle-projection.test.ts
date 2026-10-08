import { describe, expect, it } from "vitest";
import { positionVacancies, takenSurvivesDeparture } from "@/lib/assignments-lifecycle-shared";
import type { StationEvent } from "@/lib/assignments-shared";

const base = { locationId: "shop", businessDate: "2026-10-08", actorId: null, actorName: null, source: null } as const;
const event = (over: Partial<StationEvent> & Pick<StationEvent, "id" | "sequence" | "userId" | "at" | "kind">): StationEvent => ({
  ...base, stationId: null, positionId: null, ...over,
});

describe("position lifecycle projection", () => {
  it("shows clock-out and active-break vacancies at their effective times", () => {
    const events = [
      event({ id: "1", sequence: "1", userId: "ana", kind: "assign", stationId: "line", positionId: "p1", source: "assigned", at: "2026-10-08T12:00:00Z" }),
      event({ id: "2", sequence: "2", userId: "ana", kind: "release", priorPositionId: "p1", releaseReason: "clocked_out", effectiveAt: "2026-10-08T15:12:00Z", at: "2026-10-08T15:13:00Z" }),
      event({ id: "3", sequence: "3", userId: "bo", kind: "claim", stationId: "expo", positionId: "p2", source: "claimed", at: "2026-10-08T13:00:00Z" }),
      event({ id: "4", sequence: "4", userId: "bo", kind: "release", priorPositionId: "p2", releaseReason: "on_break", at: "2026-10-08T15:20:00Z" }),
    ];
    expect(positionVacancies(events, new Map([["bo", true]]), new Map([["ana", "Ana"], ["bo", "Bo"]])))
      .toEqual([
        { positionId: "p1", userId: "ana", name: "Ana", reason: "clocked_out", at: "2026-10-08T15:12:00Z" },
        { positionId: "p2", userId: "bo", name: "Bo", reason: "on_break", at: "2026-10-08T15:20:00Z" },
      ]);
  });

  it("clears a vacancy when covered and suppresses a break vacancy after back-from-break", () => {
    const released = event({ id: "1", sequence: "1", userId: "ana", kind: "release", priorPositionId: "p1", releaseReason: "clocked_out", at: "2026-10-08T15:00:00Z" });
    const cover = event({ id: "2", sequence: "2", userId: "bo", kind: "claim", stationId: "line", positionId: "p1", source: "claimed", at: "2026-10-08T15:05:00Z" });
    expect(positionVacancies([released, cover], new Map(), new Map())).toEqual([]);
    const breakRelease = event({ id: "3", sequence: "3", userId: "cy", kind: "release", priorPositionId: "p2", releaseReason: "on_break", at: "2026-10-08T15:10:00Z" });
    expect(positionVacancies([breakRelease], new Map([["cy", false]]), new Map())).toEqual([]);
  });

  it("clears the prior vacancy when the departed person later takes that position again", () => {
    const released = event({ id: "1", sequence: "1", userId: "ana", kind: "release", priorPositionId: "p1", releaseReason: "clocked_out", at: "2026-10-08T15:00:00Z" });
    const reclaimed = event({ id: "2", sequence: "2", userId: "ana", kind: "claim", stationId: "line", positionId: "p1", source: "claimed", at: "2026-10-08T16:00:00Z" });
    expect(positionVacancies([released, reclaimed], new Map(), new Map())).toEqual([]);
  });
});

describe("taken task departure suppression", () => {
  it("keeps pre-departure tasks suppressed and permits a strictly later retake", () => {
    expect(takenSurvivesDeparture("2026-10-08T15:11:59Z", "2026-10-08T15:12:00Z")).toBe(false);
    expect(takenSurvivesDeparture("2026-10-08T15:12:00Z", "2026-10-08T15:12:00Z")).toBe(false);
    expect(takenSurvivesDeparture("2026-10-08T15:12:01Z", "2026-10-08T15:12:00Z")).toBe(true);
    expect(takenSurvivesDeparture("2026-10-08T12:00:00Z", undefined)).toBe(true);
  });
});
