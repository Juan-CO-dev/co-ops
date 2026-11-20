// @vitest-environment jsdom
/**
 * The signals page, RENDERED (the real client component; no network: fetch is a recording fake).
 *   · an event's time is shown in every shape a person can enter it: none, a start, an end only (review
 *     DEMAND4-r2 P3: "until 3 PM" used to disappear), or both;
 *   · AI insights (PR 7): the section does not exist when the feature is off; WITHOUT A KEY it says "not
 *     configured" and offers NO button; ready, it offers one request; a stored answer is rendered from OUR
 *     template over the cited facts, and nothing else.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));

import { DemandSignalsClient } from "@/components/admin/demand-signals/DemandSignalsClient";
import type { InsightsView } from "@/lib/demand-signals/insights";
import type { SignalsEvent, SignalsPageData } from "@/lib/demand-signals/signals-page";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { TranslationProvider } from "@/lib/i18n/provider";

type Ok = Extract<SignalsPageData, { state: "ok" }>;
const event = (id: string, over: Partial<SignalsEvent> = {}): SignalsEvent => ({ id, origin: "manual", sourceId: null, locationId: "shop", category: "street_closure", validFrom: "2026-11-20",
  validTo: "2026-11-20", startLocal: null, endLocal: null, title: id, expectedImpact: "down", severity: null, canEdit: false, ...over });
const data = (events: SignalsEvent[] = []): Ok => ({ state: "ok", today: "2026-11-19", shop: { id: "shop", name: "Shop A" }, days: [{ date: "2026-11-19", weather: null, weatherGap: "not_collected", eventIds: [] }],
  events, weatherStatus: "verified", weatherFeeds: {}, sources: { registered: 1, verified: 1, revoked: 0 }, adapters: [], can: { enter: false, enterAllShops: false, mark: false } });
const mount = (d: Ok, insights: InsightsView | null = null, lang: "en" | "es" = "en") =>
  render(createElement(TranslationProvider, { initialLanguage: lang } as Parameters<typeof TranslationProvider>[0], createElement(DemandSignalsClient, { data: d, insights })));
const fill = (template: string, params: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k]));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); h.refresh.mockClear(); });

describe("an event's time, in every shape it can be entered", () => {
  it("none, a start, an END ONLY, and both are each shown (en and es)", () => {
    for (const [lang, dict] of [["en", en], ["es", es]] as const) {
      mount(data([event("no-time"), event("starts", { startLocal: "09:00:00" }), event("ends", { endLocal: "15:00:00" }), event("both", { startLocal: "09:00:00", endLocal: "15:00:00" })]), null, lang);
      const row = (title: string) => screen.getByRole("button", { name: fill(dict["signals.event.aria.row"], { title }) }).textContent ?? "";
      const until = dict["signals.event.when_until"].split("{to}")[0]!.split("{day}")[1]!;     // ", until " / ", hasta "
      const from = dict["signals.event.when_from"].split("{from}")[0]!.split("{day}")[1]!;
      expect(row("ends"), lang).toContain(until.trim());
      expect(row("ends"), lang).toMatch(/3/);                       // the end time itself is on the row
      expect(row("starts"), lang).toContain(from.trim());
      expect(row("starts"), lang).toMatch(/9/);
      expect(row("both"), lang).toMatch(/9[\s\S]*3/);
      expect(row("no-time"), lang).not.toContain(until.trim());
      expect(row("no-time"), lang).not.toContain(from.trim());
      cleanup();
    }
  });
});

const FACT = { id: "e1", kind: "named_event" as const, date: "2026-11-21", endDate: "2026-11-21", category: "sports_game" as const, impact: "up" as const, origin: "manual" as const, scope: "shop" as const };
const GAP = { id: "g1", kind: "coverage_gap" as const, date: "2026-11-19", endDate: "2026-11-20", reason: "not_collected" as const };
const ready = (over: Partial<Extract<InsightsView, { status: "ready" }>> = {}): InsightsView => ({ status: "ready", blocked: null, attempt: null, monthSpentMicro: 0, capMicro: 5_000_000, ...over });
const openAi = () => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${en["signals.ai.title"]}`) }));

describe("AI insights on the page", () => {
  it("OFF: the section does not exist", () => {
    mount(data(), null);
    expect(screen.queryByText(en["signals.ai.title"])).toBeNull();
  });
  it("WITHOUT A KEY: it says 'not configured' and offers no way to ask", () => {
    for (const [lang, dict] of [["en", en], ["es", es]] as const) {
      mount(data(), { status: "not_configured" }, lang);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${dict["signals.ai.title"]}`) }));
      expect(screen.getByText(dict["signals.ai.status.not_configured"])).toBeTruthy();
      expect(screen.queryByRole("button", { name: dict["signals.ai.ask"] })).toBeNull();
      expect(screen.queryByText(new RegExp(dict["signals.ai.spend"].split("{")[0]!))).toBeNull();
      cleanup();
    }
    for (const status of ["unavailable", "unreadable"] as const) {
      mount(data(), { status });
      openAi();
      expect(screen.getByText(en[`signals.ai.status.${status}`])).toBeTruthy();
      expect(screen.queryByRole("button", { name: en["signals.ai.ask"] })).toBeNull();
      cleanup();
    }
    mount(data(), { status: "model_unpriced" });
    openAi();
    expect(screen.getByText(en["signals.ai.status.model_unpriced"])).toBeTruthy();
    expect(screen.queryByRole("button", { name: en["signals.ai.ask"] })).toBeNull();
  });
  it("ready with nothing asked: ONE button; pressing it posts the shop and nothing else, then shows the stored row", async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => { posts.push({ url, body: JSON.parse(String(options?.body)) }); return { ok: true, status: 200, json: async () => ({ claims: 1, rejected: 0 }) }; }));
    mount(data(), ready());
    openAi();
    fireEvent.click(screen.getByRole("button", { name: en["signals.ai.ask"] }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/admin/demand-signals/insights", body: { locationId: "shop" } });
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });
  it("a blocked request shows why and offers no button", () => {
    for (const blocked of ["asked_today", "cap_reached", "facts_incomplete", "nothing_to_say", "input_too_large"] as const) {
      mount(data(), ready({ blocked }));
      openAi();
      expect(screen.getByText(en[`signals.ai.blocked.${blocked}`])).toBeTruthy();
      expect(screen.queryByRole("button", { name: en["signals.ai.ask"] })).toBeNull();
      cleanup();
    }
  });
  it("a stored answer is OUR sentence over the cited facts (en and es); a failed attempt shows no claim", () => {
    const attempt = { state: "ok" as const, claims: [{ type: "event_on_date" as const, facts: [FACT] }, { type: "data_missing" as const, facts: [GAP] }], rejected: 2, askedAt: "2026-11-19T15:00:00Z", factsChanged: true };
    for (const [lang, dict] of [["en", en], ["es", es]] as const) {
      mount(data(), ready({ blocked: "asked_today", attempt }), lang);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${dict["signals.ai.title"]}`) }));
      const items = within(document.getElementById("signals-ai")!).getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items).toHaveLength(2);
      expect(items[0]).toContain(dict["signals.category.sports_game"]);
      expect(items[0]).toContain(dict["signals.impact.up"]);
      expect(items[1]).toContain(dict["signals.weather.gap.not_collected"]);
      expect(screen.getByText(fill(dict["signals.ai.rejected"], { n: 2 }))).toBeTruthy();
      expect(screen.getByText(new RegExp(dict["signals.ai.facts_changed"]))).toBeTruthy();
      cleanup();
    }
    mount(data(), ready({ blocked: "asked_today", attempt: { ...attempt, state: "failed", claims: [] } }));
    openAi();
    expect(screen.getByText(en["signals.ai.attempt.failed"])).toBeTruthy();
    expect(screen.queryByText(new RegExp(en["signals.category.sports_game"]))).toBeNull();
  });
  it("the month's spend is shown in whole cents, rounded up, with the cap", () => {
    mount(data(), ready({ monthSpentMicro: 12_001, capMicro: 5_000_000 }));
    openAi();
    expect(screen.getByText(/\$0\.02/)).toBeTruthy();   // 1.2001 cents is shown as 2, never as 1
    expect(screen.getByText(/\$5\.00/)).toBeTruthy();
  });
});
