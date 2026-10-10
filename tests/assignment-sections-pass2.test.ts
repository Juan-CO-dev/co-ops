import { describe, expect, it } from "vitest";
import { assignmentSectionDefaults, closingStationAnchor, dashboardWorkVisibility } from "@/lib/assignment-sections";
import type { ShiftBoard } from "@/lib/assignments-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const board = (): ShiftBoard => ({ locationId: "shop", date: "2026-10-08", viewerId: "me", viewerLevel: 4,
  stations: [], people: [{ id: "me", name: "Me", level: 4, hasWork: false }], events: [], tasks: [] });

describe("assignment disclosure defaults", () => {
  it("opens both dashboard rows without held work and collapses both after a claim", () => {
    const b = board();
    expect(assignmentSectionDefaults(b, true)).toEqual({ tasks: true, stations: true, team: false });
    b.tasks.push({ id: "a", task: "receiving", assigneeId: "me", assignerId: "lead", assignerName: null, note: null });
    expect(assignmentSectionDefaults(b, true)).toEqual({ tasks: false, stations: false, team: false });
  });
  it("collapses both dashboard rows for a station without a task", () => {
    const b = board();
    b.stations.push({ id: "station", name: "Station", nameEs: null, sort: 1, active: true, staffed: true,
      positions: [{ id: "position", stationId: "station", name: "Position", nameEs: null, duty: null, dutyEs: null, sort: 1, active: true }] });
    b.events.push({ id: "e", sequence: "1", locationId: "shop", businessDate: b.date, userId: "me",
      stationId: "station", positionId: "position", kind: "assign", actorId: "lead", actorName: "Lead", at: "2026-10-08T12:00:00Z", source: "assigned" });
    expect(assignmentSectionDefaults(b, true)).toEqual({ tasks: false, stations: false, team: false });
  });
  it("opens the first incomplete assignments section only", () => {
    const b = board();
    expect(assignmentSectionDefaults(b, false)).toEqual({ tasks: true, stations: false, people: false, unassigned: false });
    b.stations.push({ id: "station", name: "Station", nameEs: null, sort: 1, active: true, staffed: true,
      positions: [{ id: "position", stationId: "station", name: "Position", nameEs: null, duty: null, dutyEs: null, sort: 1, active: true }] });
    expect(assignmentSectionDefaults(b, false)).toEqual({ stations: true, tasks: false, people: false, unassigned: false });
  });
});

describe("dashboard work after assignment", () => {
  it("shows a held task tile at its role floor and keeps unrelated tasks hidden", () => {
    const b = board();
    b.tasks.push({ id: "a", task: "receiving", assigneeId: "me", assignerId: "lead", assignerName: null, note: null });
    expect(dashboardWorkVisibility(b, "receiving")).toEqual({ taskTile: true, stationCard: false });
    expect(dashboardWorkVisibility(b, "ordering").taskTile).toBe(false);
    b.viewerLevel = 3;
    expect(dashboardWorkVisibility(b, "receiving").taskTile).toBe(false);
  });
  it("gives a held station a card without granting unrelated task tiles", () => {
    const b = board();
    b.stations.push({ id: "station", name: "Station", nameEs: null, sort: 1, active: true, staffed: true,
      positions: [{ id: "position", stationId: "station", name: "Position", nameEs: null, duty: null, dutyEs: null, sort: 1, active: true }] });
    b.events.push({ id: "e", sequence: "1", locationId: "shop", businessDate: b.date, userId: "me",
      stationId: "station", positionId: "position", kind: "claim", actorId: "me", actorName: null, at: "2026-10-08T12:00:00Z", source: "claimed" });
    expect(dashboardWorkVisibility(b, "receiving")).toEqual({ taskTile: false, stationCard: true });
    expect(closingStationAnchor("Walk-Out Verification")).toBe("closing-station-Walk-Out%20Verification");
  });
});

it("has English and Spanish parity for assignment section labels", () => {
  for (const key of ["assignments.takeAssignTasks", "assignments.takeAssignStations", "assignments.people", "assignments.person", "assignments.stationCard", "assignments.assignedCount", "assignments.unassignedCount"] as const) {
    expect(en[key]).toBeTruthy();
    expect(es[key]).toBeTruthy();
  }
});
