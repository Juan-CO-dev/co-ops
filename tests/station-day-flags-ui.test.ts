// @vitest-environment jsdom
/**
 * Nav PR 6 (plan r3, 4.4 and 8.9): the two Station setup toggles. GM and up see both on FLOOR stations only, each
 * checked where set; the mid-day toggle is hidden on a "not a phase station"; read-only viewers see the "marked" lines;
 * a click asks for the password (requestStepUp "B") BEFORE the fetch, then posts exactly the route's payload; a 409
 * shows the conflict line; not installed → no toggle and one unavailable line; en and es render.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StationsAdmin } from "@/components/assignments/StationsAdmin";
import type { Station, StationDayFlagsView } from "@/lib/assignments-shared";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const order: string[] = [];
const stepUp = vi.fn(async () => { order.push("step-up"); return "ok"; });
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: stepUp }) }));

const position = (stationId: string, active = true) => ({ id: `${stationId}-p`, stationId, name: "Spot", nameEs: null, duty: null, dutyEs: null, sort: 1, active });
const st = (id: string, name: string, sort: number, p: Partial<Station> = {}): Station =>
  ({ id, name, nameEs: `${name} (es)`, sort, active: true, staffed: true, positions: [position(id)], usuallyClosesAt: null, ...p });
const STATIONS: Station[] = [
  st("crunchy", "Crunchy Boi Station", 1),
  st("expo", "Expo Station", 2),
  st("fridge", "Prep Fridge", 3, { staffed: false }),
  st("dish", "Dish", 4, { positions: [position("dish", false)] }),
  st("cm", "Closing Manager", 5),
];
const INSTALLED: StationDayFlagsView = { installed: true, midDayStationId: "expo", notPhaseIds: ["cm"] };

// eslint-disable-next-line react/no-children-prop -- the provider's props type requires `children`
const el = (p: { canEdit: boolean; flags?: StationDayFlagsView; language?: "en" | "es" }) => createElement(TranslationProvider, {
  initialLanguage: p.language ?? "en",
  children: createElement(StationsAdmin, { locationId: "shop", stations: STATIONS, translatedNames: [], canEdit: p.canEdit, canEditTiming: p.canEdit, flags: p.flags }),
});
const card = (name: string) => screen.getByRole("heading", { name }).closest("div.co-card") as HTMLElement;
const box = (name: string, label: string) => card(name).querySelector(`input[data-flag="${label}"]`) as HTMLInputElement | null;

let posted: unknown[];
let status = 200;
let answer: Record<string, unknown> = { changed: true };
beforeEach(() => {
  posted = []; order.length = 0; status = 200; answer = { changed: true };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    order.push("fetch");
    posted.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(answer), { status });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("the station day flag toggles", () => {
  it("GM: both checkboxes on floor stations only, each checked where set; no mid-day toggle on a not-phase station", () => {
    render(el({ canEdit: true, flags: INSTALLED }));
    expect(box("Crunchy Boi Station", "mid_day_trigger")?.checked).toBe(false);
    expect(box("Crunchy Boi Station", "not_phase_station")?.checked).toBe(false);
    expect(box("Expo Station", "mid_day_trigger")?.checked).toBe(true);
    expect(box("Closing Manager", "mid_day_trigger")).toBeNull();
    expect(box("Closing Manager", "not_phase_station")?.checked).toBe(true);
    for (const name of ["Prep Fridge", "Dish"]) {
      expect(box(name, "mid_day_trigger")).toBeNull();
      expect(box(name, "not_phase_station")).toBeNull();
    }
    // One mid-day hint, under the first floor station that can carry the toggle.
    expect(screen.getAllByText(en["assignments.midDayTrigger.hint"])).toHaveLength(1);
    expect(card("Crunchy Boi Station").textContent).toContain(en["assignments.midDayTrigger.hint"]);
    expect(screen.queryByText(en["assignments.stationFlags.unavailable"])).toBeNull();
  });

  it("a click asks for the password BEFORE the fetch, then posts exactly { operation, locationId, stationId, on }", async () => {
    render(el({ canEdit: true, flags: INSTALLED }));
    await act(async () => { fireEvent.click(box("Crunchy Boi Station", "mid_day_trigger")!); });
    expect(stepUp).toHaveBeenCalledWith("B");
    expect(order).toEqual(["step-up", "fetch"]);
    expect(posted).toEqual([{ locationId: "shop", operation: "mid_day_trigger", stationId: "crunchy", on: true }]);
    await act(async () => { fireEvent.click(box("Closing Manager", "not_phase_station")!); });
    expect(posted.at(-1)).toEqual({ locationId: "shop", operation: "not_phase_station", stationId: "cm", on: false });
    expect(order.slice(2)).toEqual(["step-up", "fetch"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("a declined password sends nothing; a 409 shows the conflict line and refreshes", async () => {
    stepUp.mockImplementationOnce(async () => { order.push("step-up"); return "cancelled"; });
    render(el({ canEdit: true, flags: INSTALLED }));
    await act(async () => { fireEvent.click(box("Expo Station", "mid_day_trigger")!); });
    expect(posted).toEqual([]);
    status = 409; answer = { code: "mid_day_trigger_conflict" };
    await act(async () => { fireEvent.click(box("Expo Station", "mid_day_trigger")!); });
    expect(screen.getByRole("alert").textContent).toBe(en["assignments.midDayTrigger.conflict"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("an AGM (canEdit false): no checkbox, the two marked lines where they apply", () => {
    render(el({ canEdit: false, flags: INSTALLED }));
    expect(document.querySelectorAll("input[data-flag]")).toHaveLength(0);
    expect(card("Expo Station").textContent).toContain(en["assignments.midDayTrigger.marked"]);
    expect(card("Closing Manager").textContent).toContain(en["assignments.notPhaseStation.marked"]);
    expect(card("Crunchy Boi Station").textContent).not.toContain(en["assignments.midDayTrigger.marked"]);
  });

  it("not installed: no checkbox, one unavailable line for GM and up, nothing for the read-only viewer", () => {
    render(el({ canEdit: true, flags: { installed: false } }));
    expect(document.querySelectorAll("input[data-flag]")).toHaveLength(0);
    expect(screen.getAllByText(en["assignments.stationFlags.unavailable"])).toHaveLength(1);
    cleanup();
    render(el({ canEdit: false, flags: { installed: false } }));
    expect(screen.queryByText(en["assignments.stationFlags.unavailable"])).toBeNull();
  });

  it("en and es render (static)", () => {
    for (const [language, dict] of [["en", en], ["es", es]] as const) {
      const html = renderToStaticMarkup(el({ canEdit: true, flags: INSTALLED, language }));
      for (const key of ["assignments.midDayTrigger.label", "assignments.notPhaseStation.label", "assignments.notPhaseStation.hint"] as const) {
        expect(html, `${language} ${key}`).toContain(dict[key].replace(/'/g, "&#x27;"));
      }
    }
  });
});
