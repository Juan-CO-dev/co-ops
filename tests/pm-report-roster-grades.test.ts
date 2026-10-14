/**
 * D-28 (Juan 2026-10-13): the PM report has NO default grade (each must be picked) and its starting
 * roster is today's presence at the shop, not "anyone who touched the app".
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { evalGradesComplete, pmPresenceRoster } from "@/lib/pm-report-shared";
import type { ShiftBoard, ShiftPerson, StationEvent } from "@/lib/assignments-shared";
import type { PmReportForEdit } from "@/lib/pm-report";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { PmReportClient } = await import("@/app/(authed)/pm-report/pm-report-client");

const person = (id: string, over: Partial<ShiftPerson> = {}): ShiftPerson => ({ id, name: id.toUpperCase(), level: 3, hasWork: false, available: true, ...over });
const claim = (userId: string, stationId: string | null): StationEvent => ({
  id: `${userId}-${stationId}`, sequence: "1", locationId: "shop", businessDate: "2026-10-13", userId, stationId,
  kind: stationId ? "claim" : "release", actorId: userId, actorName: null, at: "2026-10-13T15:00:00Z", source: stationId ? "claimed" : null,
});

describe("evalGradesComplete", () => {
  it("is false until all four grades are picked", () => {
    expect(evalGradesComplete({ arrivedReady: null, attitude: null, production: null, teamPlayer: null })).toBe(false);
    expect(evalGradesComplete({ arrivedReady: "good", attitude: "great", production: "needs_work", teamPlayer: null })).toBe(false);
    expect(evalGradesComplete({ arrivedReady: "good", attitude: "great", production: "needs_work", teamPlayer: "good" })).toBe(true);
  });
});

describe("pmPresenceRoster", () => {
  it("with Who's Here on: on shift now, or seen today and since gone off; never someone with no evidence", () => {
    const board: Pick<ShiftBoard, "people" | "events"> = {
      events: [],
      people: [
        person("onshift", { presence: { onShift: true, source: "toast_clock", since: "2026-10-13T14:00:00Z" } }),
        person("clockedout", { presence: { onShift: false, source: "toast_clock", since: null, off: { reason: "clocked_out", at: "2026-10-13T20:00:00Z" } } }),
        person("ended", { presence: { onShift: false, source: "coops_activity", since: null, off: { reason: "ended_shift", at: "2026-10-13T21:00:00Z" } } }),
        person("member-only", { presence: { onShift: false, source: null, since: null } }),
      ],
    };
    expect(pmPresenceRoster(board).map((p) => p.id)).toEqual(["onshift", "clockedout", "ended"]);
  });
  it("with presence off: holding a station or task, or held a station earlier today (released at close)", () => {
    const board: Pick<ShiftBoard, "people" | "events"> = {
      events: [claim("released", "grill"), claim("released", null)],
      people: [person("tasked", { hasWork: true }), person("released"), person("idle-member")],
    };
    expect(pmPresenceRoster(board).map((p) => p.id)).toEqual(["tasked", "released"]);
  });
  it("never seeds someone no longer available at the shop", () => {
    const board: Pick<ShiftBoard, "people" | "events"> = { events: [], people: [person("gone", { hasWork: true, available: false })] };
    expect(pmPresenceRoster(board)).toEqual([]);
  });
});

function render(report: PmReportForEdit, presenceRoster: { id: string; name: string }[] | null, submitted = false) {
  // eslint-disable-next-line react/no-children-prop -- house test pattern: TranslationProvider's children prop is required
  return renderToStaticMarkup(createElement(TranslationProvider, {
    initialLanguage: "en",
    children: createElement(PmReportClient, {
      locationId: "shop", report, timeliness: [], locationUsers: [], presenceRoster, language: "en", submitted,
    }),
  }));
}
const report = (over: Partial<PmReportForEdit> = {}): PmReportForEdit => ({
  id: "pm", status: "open", mvpUserId: null, mvpNote: null, submittedAt: null, submittedByName: null, evals: [],
  wrapUp: [{ userId: "toucher", name: "App Toucher", itemsCompleted: 3, reportsSubmitted: 0 }], ...over,
});

describe("PM report client", () => {
  it("seeds cards from today's presence, not the app-activity wrap-up", () => {
    const html = render(report(), [{ id: "line", name: "Line Cook" }]);
    expect(html).toContain("Line Cook");
    // The toucher still shows in the Shift activity list, but gets no eval card / MVP option.
    expect(html).not.toContain('value="toucher"');
    expect(html).toContain('value="line"');
  });
  it("falls back to the activity roster only when the presence read failed", () => {
    expect(render(report(), null)).toContain('value="toucher"');
  });
  it("starts with no grade picked and Save disabled, with a hint", () => {
    const html = render(report(), [{ id: "line", name: "Line Cook" }]);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).toContain("Pick a grade on every line to save.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/);
  });
  it("an existing eval shows its saved grades and can be saved again", () => {
    const html = render(report({ evals: [{ id: "e", employeeId: "line", employeeName: "Line Cook", arrivedReady: "great", attitude: "good", production: "good", teamPlayer: "needs_work", areaToImprove: null, note: null }] }), []);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(4);
    expect(html).not.toContain("Pick a grade on every line to save.");
  });
  it("a submitted report shows only the people who were graded", () => {
    const html = render(report({ status: "submitted", evals: [{ id: "e", employeeId: "line", employeeName: "Line Cook", arrivedReady: "great", attitude: "good", production: "good", teamPlayer: "good", areaToImprove: null, note: null }] }),
      [{ id: "line", name: "Line Cook" }, { id: "other", name: "Not Graded" }], true);
    expect(html).toContain("Line Cook");
    expect(html).not.toContain("Not Graded");
  });
});
