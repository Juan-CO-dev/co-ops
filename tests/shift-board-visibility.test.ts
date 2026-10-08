import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShiftBoardClient } from "@/components/assignments/ShiftBoardClient";
import { TranslationProvider } from "@/lib/i18n/provider";
import { TASK_TYPES, taskHref, type ShiftBoard } from "@/lib/assignments-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function board(level: number, assigned = false): ShiftBoard {
  return {
    locationId: "shop-a", date: "2026-10-07", viewerId: "viewer", viewerLevel: level,
    stations: [], events: [], people: [{ id: "viewer", name: "Viewer", level, hasWork: true }],
    tasks: assigned ? TASK_TYPES.map((task) => ({ id: task, task, assigneeId: "viewer", assignerId: "lead", assignerName: "Lead", note: null })) : [],
  };
}
function render(value: ShiftBoard, compact = true) {
  // Required children prop preserves the provider's strict React.createElement type.
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: createElement(ShiftBoardClient, { board: value, compact }) }));
}

describe("My shift and assignments board", () => {
  it.each([2, 3, 4, 5, 6, 7, 9])("shows the unassigned safety line only to KH+ at level %s", (level) => {
    const html = render(board(level));
    expect(html).toContain("My shift");
    expect(html.includes("Unassigned:")).toBe(level >= 4);
    expect(html).toContain("/assignments?location=shop-a");
    for (const task of TASK_TYPES) expect(html).not.toContain(`href="${taskHref(task, "shop-a")}"`);
  });
  it("does not mistake another person's assignment for an unassigned task", () => {
    const value = board(4, true);
    value.tasks = value.tasks.map((task) => ({ ...task, assigneeId: "other" }));
    const html = render(value);
    expect(html).not.toContain("Unassigned:");
    expect(html).toContain("No assigned tasks today.");
  });
  it("shows all tasks, closing and assignee names on the full board", () => {
    const value = board(4, true);
    const html = render(value, false);
    for (const task of TASK_TYPES) expect(html).toContain(`href="${taskHref(task, "shop-a")}"`);
    expect(html).toContain("Closing checklist");
    expect(html).toContain("Viewer");
    expect(html).not.toContain('name="task"'); // no self assignment
  });
  it("offers employee prep assignments but never cash, counts, receiving, ordering or PM", () => {
    const value = board(4);
    value.people.push({ id: "employee", name: "Employee", level: 3, hasWork: true });
    const html = render(value, false);
    for (const task of ["am_prep", "mid_day_prep", "opening_report"]) expect(html).toContain(`value="${task}"`);
    for (const task of ["cash_report", "receiving", "counts", "ordering", "pm_report"]) expect(html).not.toContain(`value="${task}"`);
  });
  it("hides stale below-floor task links even when an assignment exists", () => {
    const html = render(board(3, true));
    expect(html).toContain('href="/operations/am-prep?location=shop-a"');
    expect(html).not.toContain('href="/cash?location=shop-a"');
  });
});
