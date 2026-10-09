import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ShiftBoardClient } from "@/components/assignments/ShiftBoardClient";
import { StationsAdmin } from "@/components/assignments/StationsAdmin";
import { TranslationProvider } from "@/lib/i18n/provider";
import { formatClockTime } from "@/lib/i18n/format";
import type { ShiftBoard } from "@/lib/assignments-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));
function board(): ShiftBoard {
  return { locationId: "shop", date: "2026-10-08", viewerId: "self", viewerLevel: 3,
    people: [{ id: "self", name: "Alex", level: 3, hasWork: false }], tasks: [], events: [],
    stations: [{ id: "station", name: "Station", nameEs: null, active: true, staffed: true, sort: 1, usuallyClosesAt: "14:00:00", positions: [
      { id: "position", stationId: "station", name: "Position", nameEs: null, duty: null, dutyEs: null, sort: 2, active: true, usuallyTrimsAt: "16:00:00" },
    ] }],
    positionVacancies: [{ positionId: "position", userId: "past", name: "Pat", reason: "clocked_out", at: "2026-10-08T19:12:00Z" }],
    taskVacancies: [{ task: "am_prep", userId: "past", name: "Pat", at: "2026-10-08T19:12:00Z" }],
  };
}
function render(value: ShiftBoard, compact = false, language: "en" | "es" = "en") {
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: createElement(ShiftBoardClient, { board: value, compact }) }));
}
describe("station lifecycle board", () => {
  it.each([false, true])("shows trim labels only to KH+ (compact=%s)", (compact) => {
    const value = board();
    value.stations[0]!.trims = [{ at: "15:00", to_count: 1 }];
    for (const level of [3, 4]) {
      value.viewerLevel = level;
      const html = render(value, compact);
      expect(html).toContain("Closes ~2:00 PM");
      expect(html.includes("Goes to 1 at 3:00 PM")).toBe(level >= 4);
      expect(html.includes("Usually trims ~4:00 PM")).toBe(level >= 4);
    }
  });
  it.each([false, true])("shows closures, time hints and task clock-outs to crew (compact=%s)", (compact) => {
    const value = board(); value.stations[0]!.closedAt = "2026-10-08T18:07:00Z";
    const html = render(value, compact);
    expect(html).toContain("Closed · 2:07 PM");
    expect(html).toContain("Closes ~2:00 PM");
    expect(html).not.toContain("Usually trims ~4:00 PM");
    expect(html).toContain("Left open · Pat clocked out 3:12 PM");
    expect(html).not.toContain('<option value="position"');
    expect(html).not.toContain('name="userId"');
  });
  it.each([false, true])("shows cover vacancy and on-break status without restoring a spot (compact=%s)", (compact) => {
    const value = board(); value.people[0]!.onBreak = true; value.positionVacancies![0]!.reason = "on_break";
    const html = render(value, compact);
    expect(html).toContain("Open for cover · Pat on break");
    expect(html).toContain("Back from break");
    expect(html).not.toContain('name="positionId"');
    value.people[0]!.onBreak = false;
    if (compact) expect(render(value, true)).toContain('value="position"');
  });
  it("hides stale vacancy descriptions when work has a new holder", () => {
    const value = board();
    value.events = [{ id: "e", sequence: "1", userId: "self", locationId: "shop", businessDate: value.date, stationId: "station", positionId: "position", kind: "claim", source: "claimed", actorId: "self", actorName: "Alex", at: "2026-10-08T20:00:00Z" }];
    value.tasks = [{ id: "task", task: "am_prep", assigneeId: "self", assignerId: "self", assignerName: "Alex", note: null }];
    expect(render(value)).not.toContain("Left open · Pat");
  });
  it("offers break controls to self or eligible KH only, and retains task assignment on break", () => {
    const value = board(); value.people[0]!.id = "other";
    expect(render(value)).not.toContain("Start break");
    value.viewerLevel = 4;
    expect(render(value)).toContain("Start break");
    value.people[0]!.onBreak = true;
    expect(render(value)).toContain('name="task"');
    value.people[0]!.level = 5;
    expect(render(value)).not.toContain("Back from break");
  });
  it("localizes the lifecycle messages", () => {
    const value = board(); value.stations[0]!.closedAt = "2026-10-08T18:07:00Z";
    const html = render(value, true, "es");
    expect(html).toContain("Cerrada ·"); expect(html).toContain("Cierra ~"); expect(html).toContain("marcó su salida");
  });
  it("triggers GM schedule editing, with no primary-position legacy trim control", () => {
    const value = board(); value.stations[0]!.positions.push({ ...value.stations[0]!.positions[0]!, id: "first", sort: 1 });
    const html = renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: createElement(StationsAdmin, { locationId: "shop", stations: value.stations, translatedNames: [], canEdit: false, canEditTiming: true }) }));
    expect(html.match(/type="time"/g)).toHaveLength(1);
    expect(html).toContain("Edit daily schedule");
    expect(html).not.toContain('name="sort"'); expect(html).not.toContain('name="name"');
    expect(html).toContain("Hints only.");
  });
  it("has matching lifecycle keys and substitution variables in both languages", () => {
    const keys = Object.keys(en).filter(key => key.startsWith("assignments.lifecycle."));
    expect(Object.keys(es).filter(key => key.startsWith("assignments.lifecycle.")).sort()).toEqual(keys.sort());
    for (const key of keys) expect(es[key as keyof typeof es].match(/\{\w+\}/g)).toEqual(en[key as keyof typeof en].match(/\{\w+\}/g));
  });
  it("formats database times without timezone drift and rejects malformed times", () => {
    expect(formatClockTime("14:00:00", "en")).toBe("2:00 PM");
    expect(formatClockTime("00:00", "en")).toBe("12:00 AM");
    expect(formatClockTime("25:00", "en")).toBe("");
    expect(formatClockTime("14:00", "es")).not.toBe("");
  });
});
