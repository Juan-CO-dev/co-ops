/**
 * Floor-station predicate (CC ruling 2026-10-10, from Juan's live use): a station is a FLOOR station
 * only if it is active, `staffed`, and has at least one active position. Everything else is a closing
 * SECTION — it stays on the closing checklist (station_closures / release_closed_stations, 0230) and
 * is shown NOWHERE else: not the 3D/2D floor, Needs attention, Stations & tasks, People counts, the
 * close/trim nudges, the assignments board or the dashboard's station list. ONE predicate, every reader.
 * And nothing is ever painted "covered" with nobody at it (floor-shared.ts:24 used to).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { isFloorStation, type ShiftBoard, type Station, type StationEvent } from "@/lib/assignments-shared";
import { floorStations, stationStatus } from "@/lib/pulse/floor-shared";
import { stationNudges } from "@/lib/station-schedule-shared";
import { assignmentSectionDefaults, dashboardWorkVisibility } from "@/lib/assignment-sections";
import { loadPulseSection, type PulseCtx, type PulseDeps } from "@/lib/pulse/sections";
import type { AttentionData, FloorData, PeopleData, StationsData } from "@/lib/pulse/types";
import { ShiftBoardClient } from "@/components/assignments/ShiftBoardClient";
import { TranslationProvider } from "@/lib/i18n/provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));

const LOC = "11111111-1111-4111-8111-111111111111";
const pos = (stationId: string, n: number, active = true) => ({ id: `${stationId}-p${n}`, stationId, name: `P${n}`, nameEs: null, duty: null, dutyEs: null, sort: n, active });
const station = (id: string, sort: number, over: Partial<Station> = {}): Station => ({
  id, name: `Station ${id}`, nameEs: `Estación ${id}`, sort, active: true, staffed: true, positions: [pos(id, 1)], closedAt: null, usuallyClosesAt: null, trims: [], ...over,
});
const ev = (userId: string, stationId: string, seq: number): StationEvent => ({
  id: `e${seq}`, sequence: String(seq), locationId: LOC, businessDate: "2026-10-10", userId, stationId, positionId: `${stationId}-p1`,
  kind: "assign", actorId: "mgr", actorName: "Mgr", at: `2026-10-10T15:0${seq}:00Z`, source: "assigned",
});

/**
 * The mixed shop (Juan's Capitol Hill screenshots, by SHAPE not by name): two real floor stations
 * (one covered, one with nobody), one unstaffed section, one staffed station with no positions, one
 * staffed station whose only position is inactive. The last three are closing sections, not floor.
 */
function mixedBoard(viewerLevel = 5): ShiftBoard {
  return {
    locationId: LOC, date: "2026-10-10", stationDate: "2026-10-10", viewerId: "me", viewerLevel, whosHere: true,
    stations: [
      station("line", 1, { positions: [pos("line", 1), pos("line", 2)] }),
      station("expo", 2, { usuallyClosesAt: "16:00:00" }),
      station("foh", 3, { staffed: false, usuallyClosesAt: "16:00:00" }),
      station("fridge", 4, { positions: [], usuallyClosesAt: "16:00:00" }),
      station("backline", 5, { positions: [pos("backline", 1, false)], usuallyClosesAt: "16:00:00" }),
    ],
    people: [
      { id: "me", name: "Val Viewer", level: 3, hasWork: true, presence: { onShift: true, source: "toast_clock", since: "2026-10-10T14:00:00Z" } },
      { id: "ana", name: "Ana Perez", level: 3, hasWork: true, presence: { onShift: true, source: "toast_clock", since: "2026-10-10T14:00:00Z" } },
    ],
    events: [ev("me", "line", 1), ev("ana", "line", 2)],
    tasks: [],
  };
}

describe("isFloorStation — the one predicate", () => {
  it("staffed with >= 1 active position is a floor station; unstaffed, no positions, all-inactive positions or an inactive station are not", () => {
    expect(isFloorStation(station("a", 1))).toBe(true);
    expect(isFloorStation(station("a", 1, { staffed: false }))).toBe(false);
    expect(isFloorStation(station("a", 1, { positions: [] }))).toBe(false);
    expect(isFloorStation(station("a", 1, { positions: [pos("a", 1, false), pos("a", 2, false)] }))).toBe(false);
    expect(isFloorStation(station("a", 1, { positions: [pos("a", 1, false), pos("a", 2, true)] }))).toBe(true);
    expect(isFloorStation(station("a", 1, { active: false }))).toBe(false);
  });
  it("a closed-for-the-day floor station is still a floor station (closure is lifecycle, not kind)", () => {
    expect(isFloorStation(station("a", 1, { closedAt: "2026-10-10T18:00:00Z" }))).toBe(true);
  });
});

describe("floor-shared: status never says covered with nobody there; non-floor stations are not on the floor", () => {
  it("stationStatus has no unstaffed branch: nobody covering is uncovered, whatever the positions count", () => {
    expect(stationStatus({ active: true, closed: false, filled: 0, positions: 0, closingSoon: false, closeDue: false, onBreak: 0 })).toBe("uncovered");
    expect(stationStatus({ active: true, closed: false, filled: 0, positions: 2, closingSoon: false, closeDue: false, onBreak: 0 })).toBe("uncovered");
    expect(stationStatus({ active: true, closed: false, filled: 1, positions: 1, closingSoon: false, closeDue: false, onBreak: 1 })).toBe("uncovered");
    expect(stationStatus({ active: true, closed: false, filled: 1, positions: 1, closingSoon: false, closeDue: false, onBreak: 0 })).toBe("covered");
  });
  it("floorStations drops the unstaffed section, the no-position station and the all-inactive-position station", () => {
    const out = floorStations(mixedBoard(), { nowMinutes: 15 * 60 + 30, viewerId: "me", showNames: true });
    expect(out.map((s) => s.id)).toEqual(["line", "expo"]);
    // expo closes at 16:00 and it is 15:30, but NOBODY is there: uncovered outranks closing soon.
    expect(out.map((s) => s.status)).toEqual(["covered", "uncovered"]);
    expect(out.some((s) => s.status === "covered" && s.filled === 0)).toBe(false);
  });
});

describe("every pulse reader uses the predicate", () => {
  const auth = (level: number): AuthContext => ({
    user: { id: "me", role: level >= 7 ? "gm" : "key_holder", language: "en" } as AuthContext["user"],
    session: {} as AuthContext["session"], role: level >= 7 ? "gm" : "key_holder", level, locations: [LOC],
  });
  // 2026-10-10 15:30 ET = 19:30Z
  const ctx = (level = 5): PulseCtx => ({ auth: auth(level), locationId: LOC, date: "2026-10-10", now: new Date("2026-10-10T19:30:00Z") });
  const reports = { rows: [], closingDone: false, midDayDoneCount: 0 };
  function deps(b: ShiftBoard = mixedBoard()): PulseDeps {
    const never = async () => { throw new Error("not read"); };
    return {
      board: async () => b, reports: async () => reports, fridges: async () => [], cateringToday: async () => [], cateringTomorrow: async () => ({ count: 0, firstWindow: null }),
      notRung: async () => [], unlinkedClockIns: async () => ({ count: 0, names: [] }), lastParPass: async () => null, deliveries: async () => [], cutoffs: async () => ({ count: 0, vendors: [] }),
      sales: never as never, handoff: async () => ({ notes: [], acks: [], names: {} }), layout: async () => ({ foh: { x: 0, y: 0 }, line: { x: 2, y: 2 } }),
    };
  }
  const data = async <T,>(section: "floor" | "attention" | "stations" | "people", b?: ShiftBoard): Promise<T> => {
    const r = await loadPulseSection(deps(b), ctx(), section);
    if (r.state !== "ok") throw new Error(`${section}: ${r.state}`);
    return r.data as T;
  };

  it("unticking an occupied station hides current projections but preserves its event", async () => {
    const b = mixedBoard(4);
    const before = structuredClone(b.events);
    expect((await data<PeopleData>("people", b)).here[0]?.stationName).toBe("Station line");
    b.stations[0]!.staffed = false;
    const people = await data<PeopleData>("people", b);
    expect(people.here.every((p) => p.stationName === null && p.positionName === null)).toBe(true);
    expect(people.timeline.some((e) => e.detail === "Station line")).toBe(true);
    for (const section of ["floor", "stations", "attention"] as const) {
      expect(JSON.stringify(await data(section, b))).not.toContain("Station line");
    }
    const crew = await loadPulseSection(deps(b), ctx(3), "stations");
    expect(crew).toMatchObject({ state: "ok", data: { mine: { stationName: null, positionName: null } } });
    expect(assignmentSectionDefaults(b, true)).toEqual({ tasks: true, stations: true, team: false });
    expect(dashboardWorkVisibility(b, "receiving").stationCard).toBe(false);
    expect(b.events).toEqual(before);
  });
  it("3D/2D floor: only floor stations, and the saved layout keeps only their points", async () => {
    const floor = await data<FloorData>("floor");
    expect(floor.stations.map((s) => s.id)).toEqual(["line", "expo"]);
    expect(Object.keys(floor.layout ?? {}).sort()).toEqual(["expo", "line"]);
  });
  it("Needs attention: an unstaffed / position-less section with a close time due raises NO station row; the real floor stations do", async () => {
    const b = mixedBoard();
    for (const s of b.stations) s.usuallyClosesAt = "15:00:00"; // every station is past close at 15:30
    const attention = await data<AttentionData>("attention", b);
    const stationRows = attention.items.filter((r) => r.kind.startsWith("station_"));
    expect(stationRows.map((r) => r.key).sort()).toEqual(["station_closing_soon:expo", "station_closing_soon:line", "station_uncovered:expo"]);
    expect(JSON.stringify(attention.items)).not.toMatch(/foh|fridge|backline/);
  });
  it("Stations & tasks: the list and the counts carry floor stations only", async () => {
    const stations = await data<StationsData>("stations");
    expect(stations.stations.map((s) => s.id)).toEqual(["line", "expo"]);
    expect(stations.counts).toEqual({ covered: 1, short: 0, closingSoon: 0, closeDue: 0, uncovered: 1, closed: 0 });
  });
  it("People and Stations agree: covered + open = floor stations open today; open = uncovered", async () => {
    const [people, stations] = await Promise.all([data<PeopleData>("people"), data<StationsData>("stations")]);
    const c = stations.counts;
    expect(people.stationsCovered).toBe(c.covered + c.short + c.closingSoon + c.closeDue);
    expect(people.stationsOpen).toBe(c.uncovered);
    expect(people.stationsCovered + people.stationsOpen).toBe(stations.stations.filter((s) => s.closedAt === null).length);
    expect(people.stationsCovered).toBe(1);
    expect(people.stationsOpen).toBe(1);
  });
  it("People: a person standing at a non-floor station is counted at no station; a closed floor station is neither covered nor open", async () => {
    const b = mixedBoard();
    b.events.push(ev("ana", "foh", 3)); // Ana moved to the unstaffed section
    b.stations[1]!.closedAt = "2026-10-10T18:00:00Z"; // expo closed for the day
    const people = await data<PeopleData>("people", b);
    expect(people.stationsCovered).toBe(1); // line (Val)
    expect(people.stationsOpen).toBe(0);
  });
  it("the hard case Juan saw: every station unstaffed → 0 covered everywhere, never '4 covered'", async () => {
    const b = mixedBoard();
    for (const s of b.stations) s.staffed = false;
    const [floor, stations, people] = await Promise.all([data<FloorData>("floor", b), data<StationsData>("stations", b), data<PeopleData>("people", b)]);
    expect(floor.stations).toEqual([]);
    expect(stations.counts.covered).toBe(0);
    expect(stations.stations).toEqual([]);
    expect(people.stationsCovered).toBe(0);
    expect(people.stationsOpen).toBe(0);
  });
});

describe("close / trim nudges use the predicate", () => {
  it("stationNudges is silent for an unstaffed section and for a staffed station with no (active) positions", () => {
    const b = mixedBoard(4);
    const at = "2026-10-10T21:00:00Z"; // 17:00 ET, past every 16:00 close
    const byId = (id: string) => b.stations.find((s) => s.id === id)!;
    expect(stationNudges(b, byId("expo"), at, []).map((n) => n.kind)).toEqual(["close"]);
    expect(stationNudges(b, byId("foh"), at, [])).toEqual([]);
    expect(stationNudges(b, byId("fridge"), at, [])).toEqual([]);
    expect(stationNudges(b, byId("backline"), at, [])).toEqual([]);
  });
  // The rendered <StationNudges> check lives in tests/station-close-nudge.test.ts (it needs the post-tick React mock).
});

describe("assignments board + dashboard station lists use the predicate", () => {
  const render = (b: ShiftBoard, compact: boolean) =>
    // eslint-disable-next-line react/no-children-prop -- TranslationProvider types `children` as a required prop
    renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: createElement(ShiftBoardClient, { board: b, compact }) }));
  it.each([false, true])("compact=%s: non-floor stations are not listed and offer no position to pick", (compact) => {
    const html = render(mixedBoard(4), compact);
    expect(html).toContain("Station line");
    expect(html).toContain("Station expo");
    expect(html).not.toMatch(/Station foh|Station fridge|Station backline/);
    expect(html).not.toMatch(/foh-p1|fridge-p1|backline-p1/);
  });
  it.each([false, true])("occupied then unticked: compact=%s hides cards and picker entries", (compact) => {
    const b = mixedBoard(4);
    b.events[0]!.source = "claimed"; // The compact self-picker must be visible too.
    const before = structuredClone(b.events);
    expect(render(b, compact)).toContain("Station line");
    b.stations[0]!.staffed = false;
    const html = render(b, compact);
    expect(html).not.toContain("Station line");
    expect(html).not.toContain("line-p1");
    expect(b.events).toEqual(before);
  });
  it("section defaults: a shop whose only stations are closing sections has NO station positions to fill, so the stations section does not open first", () => {
    const b = mixedBoard(4);
    b.events = [];
    b.stations = b.stations.filter((s) => !isFloorStation(s)); // foh (unstaffed, 1 position), fridge, backline
    expect(b.stations).toHaveLength(3);
    // Old reader: the unstaffed section's position counted (0 of 1 → stations opens). New: 0 of 0 → tasks opens.
    expect(assignmentSectionDefaults(b, false)).toMatchObject({ stations: false, tasks: true });
    const floor = mixedBoard(4);
    floor.events = [];
    expect(assignmentSectionDefaults(floor, false)).toMatchObject({ stations: true, tasks: false });
  });
});
