// @vitest-environment jsdom
/**
 * Review DEMAND4-r1 P2, closed as a class: A ONE-LINE FORECAST CARRIES ITS QUALIFICATIONS ON EVERY SURFACE.
 * The order walk's line once said "rain up to 0%" when one hour of sixteen had given a chance of rain, while the
 * signals page's drawer said for how many hours. Now the decision is one pure rule (weather-line-shared.ts) and
 * one component (WeatherSummary.tsx) that both surfaces render:
 *   · the rule, as a table;
 *   · the walk's panel and the page's day row, RENDERED, with 16 hours of which 15 gave no chance of rain;
 *   · a census: no other file spells the line's keys, so a new surface cannot build its own line.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));

import { DemandSignalsClient } from "@/components/admin/demand-signals/DemandSignalsClient";
import { OrderSignalsPanel } from "@/components/ordering/OrderSignalsPanel";
import type { SignalsPageData } from "@/lib/demand-signals/signals-page";
import type { WeatherDay } from "@/lib/demand-signals/signals-view-shared";
import { rainLineOf, weatherIsOld } from "@/lib/demand-signals/weather-line-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { TranslationProvider } from "@/lib/i18n/provider";

const weather = (over: Partial<WeatherDay> = {}): WeatherDay => ({ hours: 16, partial: false, highF: 61.4, lowF: 47.6, precipMaxPct: 0, precipHours: 1, condition: "Sunny",
  latestAvailableAt: "2026-11-19T21:50:00Z", sourceIds: ["nws"], ...over });
const fill = (template: string, params: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k]));
const wrap = (lang: "en" | "es", child: ReturnType<typeof createElement>) => createElement(TranslationProvider, { initialLanguage: lang } as Parameters<typeof TranslationProvider>[0], child);
afterEach(cleanup);

describe("the rule (one place decides)", () => {
  it("rain is 'whole' only when every held hour gave a chance; a given 0% is a value, a missing one is never 0", () => {
    const cases: Array<[Parameters<typeof rainLineOf>[0], ReturnType<typeof rainLineOf>]> = [
      [{ precipMaxPct: 40, precipHours: 16, hours: 16 }, { kind: "whole", pct: 40 }],
      [{ precipMaxPct: 0, precipHours: 16, hours: 16 }, { kind: "whole", pct: 0 }],
      [{ precipMaxPct: 0, precipHours: 1, hours: 16 }, { kind: "partial", pct: 0, known: 1, hours: 16 }],     // the reviewer's case
      [{ precipMaxPct: 70, precipHours: 15, hours: 16 }, { kind: "partial", pct: 70, known: 15, hours: 16 }],
      [{ precipMaxPct: 70, precipHours: 3, hours: 3 }, { kind: "whole", pct: 70 }],                           // part of a DAY is the day's own flag
      [{ precipMaxPct: null, precipHours: 0, hours: 16 }, { kind: "not_given" }],
      [{ precipMaxPct: 10, precipHours: 0, hours: 16 }, { kind: "not_given" }],                               // a figure with no hour behind it is not shown
    ];
    for (const [input, expected] of cases) expect(rainLineOf(input), JSON.stringify(input)).toEqual(expected);
  });
  it("a forecast is old unless EVERY feed behind it ran freshly; an unknown feed cannot prove freshness", () => {
    expect(weatherIsOld(["nws"], { nws: "fresh" })).toBe(false);
    for (const state of ["stale", "failed", "never", "unreadable"]) expect(weatherIsOld(["nws"], { nws: state }), state).toBe(true);
    expect(weatherIsOld(["nws", "other"], { nws: "fresh" })).toBe(true);
    expect(weatherIsOld([], {})).toBe(false);
  });
});

const EVENT = { id: "game", origin: "manual" as const, sourceId: null, locationId: "shop", category: "sports_game", validFrom: "2026-11-20", validTo: "2026-11-20",
  startLocal: null, endLocal: null, title: "Home game", expectedImpact: "up", severity: null };
const NUDGE = { kind: "named_only" as const, reason: "no_approved_signal" as const };
const panel = (w: WeatherDay, feeds: Record<string, string>, lang: "en" | "es" = "en") => wrap(lang, createElement(OrderSignalsPanel, { locationId: "shop",
  data: { state: "ok", today: "2026-11-19", horizonDays: 14, weatherFeeds: feeds as never, canOpenPage: false,
    view: { events: [EVENT], days: [{ date: "2026-11-20", eventIds: ["game"], weather: w, nudge: NUDGE }] } } }));
const openPanel = () => fireEvent.click(screen.getByRole("button"));

describe("the order walk's panel, rendered", () => {
  it("16 hours of which 15 gave no chance of rain: the line says for how many hours the figure stands (en and es)", () => {
    for (const [lang, dict] of [["en", en], ["es", es]] as const) {
      render(panel(weather(), { nws: "fresh" }, lang));
      openPanel();
      const expected = fill(dict["signals.weather.line_rain_partial"], { temps: fill(dict["signals.weather.temps"], { high: 61, low: 48 }), rain: 0, known: 1, hours: 16 });
      expect(screen.getByText(expected)).toBeTruthy();
      // The unqualified line is NOT what is shown.
      expect(screen.queryByText(fill(dict["signals.weather.line"], { temps: fill(dict["signals.weather.temps"], { high: 61, low: 48 }), rain: 0 }))).toBeNull();
      cleanup();
    }
  });
  it("whole coverage shows the plain line; no chance given says 'not given'; a part day and a stopped feed are badged", () => {
    render(panel(weather({ precipHours: 16, precipMaxPct: 30 }), { nws: "fresh" }));
    openPanel();
    expect(screen.getByText(fill(en["signals.weather.line"], { temps: "61° / 48°", rain: 30 }))).toBeTruthy();
    expect(screen.queryByText(en["signals.weather.partial_badge"])).toBeNull();
    expect(screen.queryByText(en["signals.weather.old_badge"])).toBeNull();
    cleanup();
    render(panel(weather({ precipMaxPct: null, precipHours: 0, hours: 9, partial: true }), { nws: "failed" }));
    openPanel();
    expect(screen.getByText(fill(en["signals.weather.line_no_rain"], { temps: "61° / 48°" }))).toBeTruthy();
    expect(screen.getByText(en["signals.weather.partial_badge"])).toBeTruthy();
    expect(screen.getByText(en["signals.weather.old_badge"])).toBeTruthy();
  });
});

describe("the signals page's day row, rendered: the SAME line", () => {
  it("the collapsed row carries the same qualified rain line as the walk", () => {
    const data: Extract<SignalsPageData, { state: "ok" }> = { state: "ok", today: "2026-11-19", shop: { id: "shop", name: "Shop A" },
      days: [{ date: "2026-11-20", weather: weather(), weatherGap: null, eventIds: [] }], events: [], weatherStatus: "verified", weatherFeeds: { nws: "stale" },
      sources: { registered: 1, verified: 1, revoked: 0 }, adapters: [], can: { enter: false, enterAllShops: false, mark: false } };
    render(wrap("en", createElement(DemandSignalsClient, { data })));
    expect(screen.getByText(fill(en["signals.weather.line_rain_partial"], { temps: "61° / 48°", rain: 0, known: 1, hours: 16 }))).toBeTruthy();
    expect(screen.getByText(en["signals.weather.old_badge"])).toBeTruthy();
  });
});

describe("census: one component spells the line", () => {
  function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name).replace(/\\/g, "/");
      if (name === "node_modules" || name === ".next") continue;
      if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }
  it("the three line keys and the two badges are named in WeatherSummary.tsx and nowhere else", () => {
    const users = [...walk("components"), ...walk("app"), ...walk("lib")]
      .filter((p) => /"signals\.weather\.(line|line_no_rain|line_rain_partial|temps|partial_badge|old_badge)"/.test(readFileSync(p, "utf8")));
    expect(users).toEqual(["components/admin/demand-signals/WeatherSummary.tsx"]);
  }, 120_000);
  it("the component decides nothing itself: it asks the shared rule", () => {
    const src = readFileSync("components/admin/demand-signals/WeatherSummary.tsx", "utf8");
    expect(src).toContain("const rain = rainLineOf(w);");
    expect(src).toContain("weatherIsOld(weather.sourceIds, feeds)");
    expect(src).not.toMatch(/precipHours\s*[<>=]|precipMaxPct\s*===/);
  });
});
