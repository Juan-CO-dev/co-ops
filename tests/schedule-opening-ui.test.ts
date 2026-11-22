/**
 * PR SCH (plan r5 4.5, 8, 16.2): the board's opening panel, rendered with react-dom/server — the stored opening's line in
 * en and es (tú), Accept / Decline on a proposal, "Open earlier on this date…" for whoever may decide (the Approve rule) on a
 * date that is not past, "Use the normal opening" on a stored decision, the regenerate and crew hints; nothing for a viewer
 * who may not decide on a date with no opening. Every new key exists in en and es and they differ.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import type { DayView, OpeningView } from "@/lib/scheduling/board-view-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/schedule", useSearchParams: () => new URLSearchParams() }));
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { StepUpProvider } = await import("@/components/admin/StepUpProvider");
const { OpeningPanel } = await import("@/components/schedule/OpeningPanel");

const day = (opening?: OpeningView, locked = false): DayView => ({
  ...(opening ? { opening } : {}), date: "2026-10-26", locked, inherited: false, dayType: "normal", demandKind: "ok", hours: [], curve: null, laborByHour: null,
  coverage: [], positionOrder: [], mod: [], closing: [], strength: [], labor: null, rows: [], notes: [], gaps: [], bounds: { fromQ: 28, toQ: 84, segmentMinQ: 2 },
});
const o = (status: OpeningView["status"], engine: OpeningView["engine"] = "stations"): OpeningView =>
  ({ status, startQ: status === "declined" ? 28 : 22, normalStartQ: 28, triggers: status === "manual" ? [] : ["prep_fit", "huge_day"], guests: 145, engine });
const render = (d: DayView, canDecide = true, language: "en" | "es" = "en") => {
  const panel: ReactNode = createElement(OpeningPanel, { day: d, locationId: "shop", weekStart: "2026-10-26", expectedHead: "head", canDecide });
  const stepUp: ReactNode = createElement(StepUpProvider, { unlocked: false, unlockedAt: null } as unknown as Parameters<typeof StepUpProvider>[0], panel);
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language } as unknown as Parameters<typeof TranslationProvider>[0], stepUp));
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const acts = (html: string) => [...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);

describe("the opening panel", () => {
  it("a proposal: its line (start, usual start, the trigger reasons, the guests) with Accept and Decline, en and es", () => {
    const html = render(day(o("proposed")));
    expect(text(html)).toContain("Suggested: open at 5:30 AM instead of 7:00 AM (Prep can't fit before the usual opening; A very large catering day with a morning order). 145 catering guests that day.");
    expect(acts(html)).toEqual(["opening-accept", "opening-decline", "opening-open-earlier"]);
    expect(text(render(day(o("proposed")), true, "es"))).toContain("Sugerencia: abrir a las");
  });
  it("an accepted or manual opening: its line, the regenerate hint, Use the normal opening; on the crew engine the hand-fill hint too", () => {
    const html = render(day(o("manual", "crew")));
    expect(text(html)).toContain("Opening earlier at 5:30 AM (set by hand). The usual opening is 7:00 AM.");
    expect(text(html)).toContain(en["schedule.opening.regenerate_hint"]);
    expect(text(html)).toContain(en["schedule.opening.crew_hint"]);
    expect(acts(html)).toEqual(["opening-clear", "opening-open-earlier"]);
    expect(text(render(day(o("accepted"))))).not.toContain(en["schedule.opening.crew_hint"]);
  });
  it("declined: the usual opening stays; automatic: Decline", () => {
    expect(text(render(day(o("declined"))))).toContain("Earlier opening declined: the usual opening at 7:00 AM stays.");
    expect(acts(render(day(o("auto"))))).toEqual(["opening-decline", "opening-open-earlier"]);
  });
  it("no opening: only the 'Open earlier on this date…' action, and only for whoever may decide, on a date that is not past", () => {
    expect(acts(render(day()))).toEqual(["opening-open-earlier"]);
    expect(render(day(), false)).toBe("");
    expect(render(day(undefined, true))).toBe("");
    expect(acts(render(day(o("proposed")), false))).toEqual([]);
  });
  it("every opening key exists in en and es, and they differ", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("schedule.opening.") || k.startsWith("schedule.error.opening_") || k === "schedule.board.advisory.opening_changed");
    expect(keys.length).toBe(23);
    for (const k of keys) {
      const e = (en as Record<string, string>)[k]!, s = (es as Record<string, string>)[k];
      expect(s, k).toBeTruthy();
      expect(s, k).not.toBe(e);
      expect(s!, k).not.toMatch(/\busted\b/i);
    }
  });
});
