import { describe, expect, it } from "vitest";
import { checklistTakenOwner, dedupeTakenTasks, takenDayRange } from "../lib/assignment-taken-shared";

describe("taken task metadata", () => {
  it("does not resurrect a dropped opener or timestamp a different assignee with the original start", () => {
    const row = { triggered_by_user_id: "original", triggered_at: "2026-10-08T14:00:00Z", assigned_to: null, dropped_at: null };
    expect(checklistTakenOwner(row)).toEqual({ userId: "original", at: row.triggered_at });
    expect(checklistTakenOwner({ ...row, dropped_at: "2026-10-08T15:00:00Z" })).toBeNull();
    expect(checklistTakenOwner({ ...row, assigned_to: "new-owner" })).toBeNull();
    expect(checklistTakenOwner({ ...row, assigned_to: "original", dropped_at: "2026-10-08T15:00:00Z" })).toBeNull();
  });
  it("keeps the earliest start per person/task without hiding another worker", () => {
    expect(dedupeTakenTasks([
      { id: "later", task: "receiving", userId: "a", at: "2026-10-08T15:00:00Z" },
      { id: "first", task: "receiving", userId: "a", at: "2026-10-08T14:00:00Z" },
      { id: "other", task: "receiving", userId: "b", at: "2026-10-08T16:00:00Z" },
      { id: "invalid", task: "counts", userId: "a", at: "bad" },
    ]).map((row) => row.id)).toEqual(["first", "other"]);
  });
  it.each([["2026-03-08", 23], ["2026-11-01", 25], ["2026-10-08", 24]])(
    "bounds %s by Eastern local midnights (%s hours)", (date, hours) => {
      const range = takenDayRange(date as string);
      expect((Date.parse(range.end) - Date.parse(range.start)) / 3_600_000).toBe(hours);
    });
});
