import { createElement } from "react";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { ShiftBoardClient } from "@/components/assignments/ShiftBoardClient";
import { TASK_TYPES, type ShiftBoard } from "@/lib/assignments-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function board(targetLevel: number, available = true, self = false): ShiftBoard {
  return {
    locationId: "shop", date: "2026-10-07", viewerId: "kh", viewerLevel: 4,
    people: [{ id: self ? "kh" : "target", name: "Target", level: targetLevel, hasWork: true, available }],
    tasks: [{ id: "assignment", task: "am_prep", assigneeId: self ? "kh" : "target", assignerId: "manager", assignerName: "Manager", note: null, available }],
    stations: [], events: [],
  };
}
function render(value: ShiftBoard, compact = false) {
  return renderToStaticMarkup(createElement(TranslationProvider, {
    initialLanguage: "en", children: createElement(ShiftBoardClient, { board: value, compact }),
  }));
}
describe("assignment board retract and assign controls", () => {
  it("shows named positions, duties, and partial staffing without warning", () => {
    const value = board(3);
    value.stations = [{ id: "walk", name: "Walk Ins Station", nameEs: null, sort: 1, active: true, staffed: true,
      positions: [
        { id: "primary", stationId: "walk", name: "Walk-ins", nameEs: null, duty: "Walk-in orders", dutyEs: null, sort: 1, active: true },
        { id: "secondary", stationId: "walk", name: "Walk-ins / Online", nameEs: null, duty: "Online orders", dutyEs: null, sort: 2, active: true },
      ] }];
    value.events = [{ id: "claim", sequence: "1", locationId: "shop", businessDate: value.date,
      userId: "target", stationId: "walk", positionId: "primary", kind: "claim", actorId: "target", actorName: null,
      at: "2026-10-07T12:00:00Z", source: "claimed" }];
    const html = render(value);
    expect(html).toContain("1 of 2");
    expect(html).toContain("Walk-ins / Online");
    expect(html).toContain("Online orders");
    expect(html).not.toContain("warning");
    value.stations[0]!.staffed = false;
    expect(render(value)).not.toContain("Online orders");
  });
  it.each([4, 5, 6, 7, 8, 9, 10])("locks an assigned station for its level %s holder in both board views", (level) => {
    const value = board(level, true, true);
    value.viewerLevel = level;
    value.events = [{ id: "station-event", sequence: "1", locationId: "shop", businessDate: value.date,
      userId: "kh", stationId: "station", kind: "assign", actorId: "other-kh", actorName: "Other KH",
      at: "2026-10-07T12:00:00Z", source: "assigned" }];
    for (const compact of [false, true]) expect(render(value, compact)).not.toContain('name="positionId"');
    value.events[0]!.source = "claimed";
    value.events[0]!.kind = "claim";
    for (const compact of [false, true]) expect(render(value, compact)).toContain('name="positionId"');
  });
  it("lets a different KH move an assigned peer and lets an unassigned KH claim", () => {
    const value = board(4);
    value.events = [{ id: "station-event", sequence: "1", locationId: "shop", businessDate: value.date,
      userId: "target", stationId: "station", kind: "assign", actorId: "manager", actorName: "Manager",
      at: "2026-10-07T12:00:00Z", source: "assigned" }];
    expect(render(value)).toContain('name="positionId"');
    expect(render(board(4, true, true))).toContain('name="positionId"');
  });
  it.each([3, 4, 5, 8])("lets KH retract level %s assignments regardless of assign-up permission", (level) => {
    const html = render(board(level));
    expect(html).toContain(">Retract<");
    expect(html.includes('name="task"')).toBe(level <= 4);
    expect(html.includes('name="positionId"')).toBe(level <= 4);
  });
  it("allows retracting the viewer's own assignment", () => {
    expect(render(board(4, true, true))).toContain(">Retract<");
    expect(render(board(4, true, true), true)).toContain(">Retract<");
  });
  it("keeps an unavailable assignee retractable without assigning new work", () => {
    const html = render(board(2, false));
    expect(html).toContain(">Retract<");
    expect(html).toContain("No longer available at this shop");
    expect(html).toContain("Needs reassignment");
    expect(html).not.toContain('name="task"');
    expect(html).not.toContain('name="positionId"');
  });
  it("does not count unavailable assignments as coverage in the safety line", () => {
    const value = board(3, false);
    value.tasks = TASK_TYPES.map((task) => ({ ...value.tasks[0]!, task, id: task, available: task !== "am_prep" }));
    const html = render(value, true);
    expect(html).toContain("Unassigned: AM prep");
    expect(html).not.toContain("Unassigned: Mid-day prep");
  });
  it("does not give employees links or retract controls for unavailable tasks", () => {
    const value = board(3, false);
    value.viewerId = "target";
    value.viewerLevel = 3;
    const html = render(value);
    expect(html).not.toContain('href="/operations/am-prep');
    expect(html).not.toContain(">Retract<");
    expect(html).not.toContain('name="task"');
  });
  it("shows held positions to staff, disables them, and cues the first position", () => {
    const value = board(3, true, true);
    value.viewerLevel = 3;
    value.stations = [{ id: "walk", name: "Walk Ins", nameEs: null, sort: 1, active: true, staffed: true,
      positions: [
        { id: "second", stationId: "walk", name: "Online", nameEs: null, duty: null, dutyEs: null, sort: 2, active: true },
        { id: "first", stationId: "walk", name: "Walk-ins", nameEs: null, duty: null, dutyEs: null, sort: 1, active: true },
      ] }];
    value.occupiedPositions = [{ positionId: "second", firstName: "Maya" }];
    const html = render(value, true);
    expect(html.indexOf('value="first"')).toBeLessThan(html.indexOf('value="second"'));
    expect(html).toContain('Walk-ins · fill first');
    expect(html).toMatch(/<option[^>]*value="second"[^>]*disabled[^>]*>[^<]*taken by Maya/);
  });
});

describe("assignment board conflict feedback", () => {
  it("turns a duplicate-assignment 409 into specific feedback and unlocks controls", async () => {
    const source = readFileSync("components/assignments/ShiftBoardClient.tsx", "utf8");
    const ast = ts.createSourceFile("board.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let mutation: ts.FunctionDeclaration | undefined;
    function find(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "mutate") mutation = node;
      ts.forEachChild(node, find);
    }
    find(ast);
    expect(mutation).toBeDefined();
    const setError = vi.fn();
    const setBusy = vi.fn();
    const refresh = vi.fn();
    const deps = {
      board: board(3), setError, setBusy,
      fetch: vi.fn(async () => Response.json({ error: "assignment_already_active", code: "assignment_already_active" }, { status: 409 })),
      startTransition: (fn: () => void) => fn(), router: { refresh },
    };
    // Execute the actual event handler without a browser; React rendering is covered above.
    const js = ts.transpile(mutation!.getText(ast), { target: ts.ScriptTarget.ES2022 });
    const mutate = new Function(...Object.keys(deps), `${js}; return mutate;`)(...Object.values(deps));
    await mutate({ action: "task_assign", task: "am_prep", userId: "target" });
    expect(setError).toHaveBeenLastCalledWith("assignments.errorAlreadyActive");
    expect(setBusy).toHaveBeenLastCalledWith(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
