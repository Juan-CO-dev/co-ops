/** The 2D floor (and 3D fallback): every station with its STATUS WORD, no names for crew, and the pulse shell rendering mixed section states side by side. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Floor2D } from "@/components/pulse/floor/Floor2D";
import { PulseClient } from "@/components/pulse/PulseClient";
import { TranslationProvider } from "@/lib/i18n/provider";
import { autoArrange } from "@/lib/pulse/floor-shared";
import type { FloorStation, SectionStates } from "@/lib/pulse/types";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/mid-shift" }));

const st = (id: string, status: FloorStation["status"], people: string[]): FloorStation => ({
  id, name: `Station ${id}`, nameEs: `Estación ${id}`, sort: 1, status, people, positions: 2, filled: people.length, closesAt: null, trimAt: null, trimTo: null, closedAt: null, closeDue: false, trimDue: false, tasksLeft: 0,
});
const render = (node: ReturnType<typeof createElement>, language: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: node }));

describe("Floor2D", () => {
  const stations = [st("a", "covered", ["Ana"]), st("b", "uncovered", []), st("c", "closed", [])];
  const layout = autoArrange(stations.map((s) => s.id));
  it("renders every station as a button with the status word, in English and Spanish", () => {
    const en = render(createElement(Floor2D, { stations, layout, selectedId: null, onSelect: () => {}, arranging: false, onMove: () => {}, showNames: true }));
    expect(en).toContain('aria-label="Station a: Covered"');
    expect(en).toContain('aria-label="Station b: Uncovered"');
    expect(en).toContain('aria-label="Station c: Closed"');
    expect(en).toContain("Ana");
    expect((en.match(/role="button"/g) ?? []).length).toBe(3);
    const es = render(createElement(Floor2D, { stations, layout, selectedId: null, onSelect: () => {}, arranging: false, onMove: () => {}, showNames: true }), "es");
    expect(es).toContain("Estación b: Sin cubrir");
  });
  it("the crew payload has no names and the map shows dots for filled positions instead", () => {
    const crewStations = [st("a", "covered", []), st("b", "uncovered", [])];
    crewStations[0]!.filled = 2;
    const html = render(createElement(Floor2D, { stations: crewStations, layout, selectedId: null, onSelect: () => {}, arranging: false, onMove: () => {}, showNames: false }));
    expect(html).not.toContain("Ana");
    expect(html).toContain("••");
  });
});

describe("PulseClient (server-rendered first paint)", () => {
  it("renders an ok card, an error card and a not-installed card side by side — one failure never blanks the others", () => {
    const initial: SectionStates = {
      attention: { state: "ok", asOf: "2026-10-09T19:30:00Z", data: { items: [], score: "green", partial: [] } },
      food_safety: { state: "error", asOf: "2026-10-09T19:30:00Z", code: "timeout" },
      handoff: { state: "not_installed", asOf: "2026-10-09T19:30:00Z" },
    };
    const html = render(createElement(PulseClient, { panels: [{ locationId: "loc", locationName: "Shop", sections: ["attention", "food_safety", "handoff"], initial }], date: "2026-10-09", viewerLevel: 5 }));
    expect(html).toContain("All clear");
    expect(html).toContain("took too long");
    expect(html).toContain("Not switched on yet");
    expect((html.match(/See more/g) ?? []).length).toBe(3);
    expect(html).toContain('href="/mid-shift/food_safety?location=loc"');
  });
  it("8+ both-shops mode renders one panel per shop with its name", () => {
    const html = render(createElement(PulseClient, { panels: [
      { locationId: "a", locationName: "Capitol Hill", sections: ["attention"], initial: {} },
      { locationId: "b", locationName: "P Street", sections: ["attention"], initial: {} },
    ], date: "2026-10-09", viewerLevel: 9 }));
    expect(html).toContain("Capitol Hill");
    expect(html).toContain("P Street");
    expect((html.match(/aria-label="Loading…"/g) ?? []).length).toBe(2);
  });
});
