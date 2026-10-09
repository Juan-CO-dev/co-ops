import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StationNudges } from "@/components/assignments/StationNudges";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { ShiftBoard } from "@/lib/assignments-shared";
import ClosingPage from "@/app/(authed)/operations/closing/page";
import { getOrCreateInstance } from "@/lib/checklists";

// Render the post-clock-tick state; SSR otherwise intentionally hides notices.
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => react.useState(initial === null ? "2026-10-09T21:00:00Z" : initial) };
});
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({
  user: { id: "kh", language: "en" }, role: "key_holder", level: 4, locations: ["shop"],
}) }));
vi.mock("@/lib/checklists", () => ({ getOrCreateInstance: vi.fn() }));
vi.mock("@/lib/prep", () => ({ reconcileClosingReportRefs: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from: (table: string) => {
    const data = table === "locations" ? { id: "shop", name: "Shop", code: "S" }
      : table === "checklist_templates" ? { id: "closing-template" } : [];
    const result = { data, error: null };
    const query = { select: () => query, eq: () => query, is: () => query,
      or: () => query, order: () => query, limit: () => query, returns: async () => ({ data: [], error: null }),
      maybeSingle: async () => result, then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  },
}) }));

function board(): ShiftBoard {
  return { locationId: "shop", date: "2026-10-09", viewerId: "kh", viewerLevel: 4,
    people: [], tasks: [], events: [], stations: [{ id: "station-id", name: "Crunchy Boi", nameEs: "Crujiente",
      active: true, staffed: true, sort: 1, positions: [], usuallyClosesAt: "16:00" }] };
}
function render(value = board(), language: "en" | "es" = "en") {
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language,
    children: createElement(StationNudges, { board: value, disabled: false, release: vi.fn() }) }));
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("close nudge checklist navigation", () => {
  it.each([false, true])("opens today's closing via the existing start flow (instance exists=%s)", async exists => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T21:00:00Z"));
    const html = render();
    const href = html.match(/href="([^"]+)"/)?.[1];
    expect(href).toBe("/operations/closing?location=shop#closing-station-Crunchy%20Boi");
    expect(html).toContain("Close Crunchy Boi station");
    const url = new URL(href!, "https://example.test");
    const instance = { id: exists ? "existing" : "created", templateId: "closing-template", locationId: "shop",
      date: "2026-10-09", status: "open", confirmedAt: null, confirmedBy: null };
    vi.mocked(getOrCreateInstance).mockResolvedValue({ instance, created: !exists } as Awaited<ReturnType<typeof getOrCreateInstance>>);
    const page = await ClosingPage({ searchParams: Promise.resolve(Object.fromEntries(url.searchParams)) });
    expect(getOrCreateInstance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      templateId: "closing-template", locationId: "shop", date: "2026-10-09",
    }));
    expect(page.props.initialState.instance.id).toBe(instance.id);
    expect(page.props.initialState.readOnly).toBe(false);
  });
  it("keeps the English anchor with translated button copy", () => {
    const html = render(board(), "es");
    expect(html).toContain("Cerrar la estación Crujiente");
    expect(html).toContain("#closing-station-Crunchy%20Boi");
  });
  it.each([1, 2, 3])("never shows the close nudge to crew level %s", level => {
    const value = board(); value.viewerLevel = level;
    expect(render(value)).toBe("");
  });
});
