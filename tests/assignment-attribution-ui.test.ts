import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { ShiftBoardClient } from "@/components/assignments/ShiftBoardClient";
import { TranslationProvider } from "@/lib/i18n/provider";
import { requiresOverrideReason, type ShiftBoard } from "@/lib/assignments-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function board(level: number): ShiftBoard {
  return {
    locationId: "shop", date: "2026-10-08", viewerId: "crew", viewerLevel: level,
    people: [
      { id: "crew", name: "Crew", level, hasWork: false },
      { id: "holder", name: "Holder", level: 3, hasWork: true },
    ],
    stations: [{ id: "station", name: "Sandwiches", nameEs: "Sándwiches", sort: 1, active: true, staffed: true,
      positions: [{ id: "position", stationId: "station", name: "Maker", nameEs: "Preparación", duty: null, dutyEs: null, sort: 1, active: true }] }],
    events: [{ id: "event", sequence: "1", locationId: "shop", businessDate: "2026-10-08", userId: "holder", stationId: "station", positionId: "position", kind: "assign", actorId: "lead", actorName: "Lead", actorLevel: 6, at: "2026-10-08T15:30:00Z", source: "assigned" }],
    tasks: [{ id: "task", task: "am_prep", assigneeId: "holder", assigneeName: "Holder", assignerId: "lead", assignerName: "Lead", assignerLevel: 6, at: "2026-10-08T15:30:00Z", source: "assigned", note: null }],
  };
}

function render(value: ShiftBoard, compact = false, language: "en" | "es" = "en") {
  return renderToStaticMarkup(createElement(TranslationProvider, {
    initialLanguage: language, children: createElement(ShiftBoardClient, { board: value, compact }),
  }));
}

describe("team attribution for every role", () => {
  it.each([2, 3])("shows other people's tasks and positions, with no mutation controls, to level %s", (level) => {
    const html = render(board(level));
    expect(html).toContain("Assigned to Holder by Lead · 11:30 AM");
    expect(html).toContain("Sandwiches");
    expect(html).toContain("Maker");
    expect(html).toContain("Who has what");
    expect(html).not.toContain("<form");
    expect(html).not.toContain(">Retract<");
    expect(html).not.toContain('href="/operations/am-prep');
  });

  it("renders taken work without a retract control and claimed stations without an assigner", () => {
    const value = board(4);
    value.tasks[0]!.source = "taken";
    value.events[0]!.source = "claimed";
    value.events[0]!.kind = "claim";
    const html = render(value);
    expect(html).toContain("Taken by Holder · 11:30 AM");
    expect(html).toContain("Claimed by Holder · 11:30 AM");
    expect(html).not.toContain(">Retract<");
  });

  it.each([false, true])("a crew opener does not regain task access from taken history (compact=%s)", (compact) => {
    const value = board(3);
    value.tasks[0]!.assigneeId = "crew";
    value.tasks[0]!.assigneeName = "Crew";
    value.tasks[0]!.source = "taken";
    const html = render(value, compact);
    expect(html).toContain("Taken by Crew");
    expect(html).not.toContain('href="/operations/am-prep');
    expect(html).not.toContain(">Retract<");
  });

  it("shows the override reason and note beside the new holder and a retracted task", () => {
    const value = board(3);
    const change = { actorName: "Key holder", at: "2026-10-08T16:00:00Z", reasonCode: "other" as const, reasonNote: "Requested swap", overriddenAssignerId: "lead" };
    value.tasks[0]!.change = change;
    value.events[0]!.change = change;
    value.taskChanges = [{ task: "cash_report", change }];
    const html = render(value);
    expect(html.match(/Changed by Key holder \(Other\) · 12:00 PM/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("Requested swap");
  });

  it("does not invent a correction reason for an ordinary release", () => {
    const value = board(3);
    value.events[0]!.stationId = null;
    value.events[0]!.positionId = null;
    value.events[0]!.kind = "release";
    value.events[0]!.change = { actorName: "Lead", at: "2026-10-08T16:00:00Z", reasonCode: null, reasonNote: null, overriddenAssignerId: null };
    const html = render(value);
    expect(html).toContain("Changed by Lead · 12:00 PM");
    expect(html).not.toContain("(Correction)");
  });

  it("keeps Team today collapsed and read-only on the dashboard, with Spanish attribution", () => {
    const html = render(board(2), true, "es");
    const team = html.slice(html.indexOf('data-collapsible-section="assignment-board:team"'));
    expect(html).toContain("Equipo de hoy");
    expect(html).toContain("Asignado a Holder por Lead");
    // The full board still exposes no controls for someone else's assignment.
    expect(html).not.toContain(">Retract<");
    expect(html).not.toContain('name="task"');
    expect(team).toContain('aria-expanded="false"');
  });
});

function functionFromComponent(name: string, deps: Record<string, unknown>) {
  const source = readFileSync("components/assignments/ShiftBoardClient.tsx", "utf8");
  const ast = ts.createSourceFile("board.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  expect(found).toBeDefined();
  const js = ts.transpile(found!.getText(ast), { target: ts.ScriptTarget.ES2022 });
  return new Function(...Object.keys(deps), `${js}; return ${name};`)(...Object.values(deps));
}

describe("override confirmation", () => {
  it.each([3, 4, 6])("requires the picker only for a higher current assigner (%s)", (assignerLevel) => {
    const setPending = vi.fn();
    const request = functionFromComponent("requestMutation", {
      board: board(4), requiresOverrideReason, setPending, setReasonCode: vi.fn(), setReasonNote: vi.fn(), setError: vi.fn(),
    });
    const payload = { action: "task_retract", assignmentId: "task" };
    request(payload, assignerLevel);
    expect(setPending).toHaveBeenCalledWith({ payload, required: assignerLevel > 4 });
  });

  it("reopens a required reason after a stale board receives the server refusal", async () => {
    const setPending = vi.fn(), setError = vi.fn(), setBusy = vi.fn(), refresh = vi.fn();
    const mutate = functionFromComponent("mutate", {
      board: board(4), setPending, setError, setBusy,
      fetch: vi.fn(async () => Response.json({ error: "override_reason_required" }, { status: 409 })),
      startTransition: (callback: () => void) => callback(), router: { refresh },
    });
    const payload = { action: "station", userId: "holder", stationId: null };
    await mutate(payload);
    expect(setPending).toHaveBeenCalledWith({ payload, required: true });
    expect(setError).toHaveBeenCalledWith("assignments.reasonRequired");
    expect(setBusy).toHaveBeenLastCalledWith(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("visible board refresh", () => {
  it("refreshes on visible focus, visibility changes and the minute timer, then cleans up", () => {
    const source = readFileSync("components/assignments/ShiftBoardClient.tsx", "utf8");
    const ast = ts.createSourceFile("board.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let effect: ts.Node | undefined;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes('addEventListener("focus"')) effect = node.arguments[0];
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect(effect).toBeDefined();
    const refresh = vi.fn();
    const window = { addEventListener: vi.fn(), removeEventListener: vi.fn(), setInterval: vi.fn(() => 17), clearInterval: vi.fn() };
    const document = { visibilityState: "hidden", addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const js = ts.transpile(`const effect = ${effect!.getText(ast)};`, { target: ts.ScriptTarget.ES2022 });
    const cleanup = new Function("window", "document", "router", "startTransition", `${js}; return effect();`)(window, document, { refresh }, (fn: () => void) => fn());
    const onFocus = window.addEventListener.mock.calls[0]?.[1] as () => void;
    onFocus(); expect(refresh).not.toHaveBeenCalled();
    document.visibilityState = "visible";
    onFocus(); expect(refresh).toHaveBeenCalledTimes(1);
    expect(window.setInterval).toHaveBeenCalledWith(onFocus, 60_000);
    expect(document.addEventListener).toHaveBeenCalledWith("visibilitychange", onFocus);
    cleanup();
    expect(window.removeEventListener).toHaveBeenCalledWith("focus", onFocus);
    expect(document.removeEventListener).toHaveBeenCalledWith("visibilitychange", onFocus);
    expect(window.clearInterval).toHaveBeenCalledWith(17);
  });
});
