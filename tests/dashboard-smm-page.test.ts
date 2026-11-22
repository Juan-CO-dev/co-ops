/**
 * Nav PR 7 (plan r2 T3; spec 3.3.6, 8.1; PR 5 group 13): the social media manager's Dashboard page.
 *
 * Its page is built from SmmPlan alone: own checklist tasks ("Assigned to you."), own station, the closing link, two
 * shortcuts and "All pages" (nav PR 9: a button opening the top bar's Go to, whose list for this role is exactly its four
 * entries: tests/go-to-entries.test.ts Q4, tests/nav-top-bar-payload.test.ts G13). It never calls the board, the bell's read, retrain, the rich
 * bodies or the auto-release trigger, and the real loader reads only the SMM allowlist (+ locations). Even handed the
 * busiest day's SHOP facts (a loader bug), nothing of the shop reaches the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DayFactsArgs } from "@/lib/day-plan";
import type { DayPlanInput, SmmFacts } from "@/lib/day-plan-shared";
import { TranslationProvider } from "@/lib/i18n/provider";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

const SHOP = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({
  language: "en" as "en" | "es",
  mode: "fake" as "fake" | "real",
  facts: null as unknown,
  client: null as unknown,
  loadDayFactsCalls: [] as unknown[],
  board: vi.fn(), unread: vi.fn(), retrain: vi.fn(), deliveries: vi.fn(), counts: vi.fn(), release: vi.fn(), after: vi.fn(),
}));
vi.mock("next/server", () => ({ after: state.after }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({
  user: { id: "22222222-2222-4222-8222-222222222222", name: "Sam Media", language: state.language }, session: { id: "s" },
  level: 6, role: "social_media_mgr", locations: ["11111111-1111-4111-8111-111111111111"],
}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => state.client }));
vi.mock("@/lib/assignments", async (orig) => ({ ...(await orig<typeof import("@/lib/assignments")>()), loadShiftBoard: state.board }));
vi.mock("@/lib/notifications", () => ({ loadUnreadForUser: state.unread, notificationLocationContext: () => undefined }));
vi.mock("@/lib/yield-stats", () => ({ loadMyRetrainTasks: state.retrain }));
vi.mock("@/lib/receiving", () => ({ loadRecentDeliveries: state.deliveries }));
vi.mock("@/lib/counts", () => ({ loadCountsTileState: state.counts }));
vi.mock("@/lib/checklists", () => ({ evaluateAutoReleaseForUserLocations: state.release }));
vi.mock("@/lib/day-plan", async (orig) => {
  const m = await orig<typeof import("@/lib/day-plan")>();
  const { operationalNow } = await import("@/lib/midshift-shared");
  return {
    ...m,
    loadDayFacts: async (sb: Parameters<typeof m.loadDayFacts>[0], a: DayFactsArgs) => {
      state.loadDayFactsCalls.push(a);
      if (state.mode === "real") return m.loadDayFacts(sb, a);
      const { date, minutesOfDay } = operationalNow(a.now);
      return { planDate: date, nowMin: minutesOfDay, viewer: a.viewer, facts: state.facts } as DayPlanInput;
    },
  };
});
vi.mock("@/components/auth/AuthShell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/BrandMark", () => ({ BrandMark: () => null }));
vi.mock("@/components/auth/LogoutButton", () => ({ LogoutButton: () => null }));

import DashboardPage from "@/app/(authed)/dashboard/page";
import { hm } from "./fixtures/day-plan/build";
import { busiestFacts, FORBIDDEN_STRINGS, SMM_FAILED_STATION, SMM_FAILED_TASKS, SMM_OK } from "./fixtures/day-plan/busiest";

const NOW = new Date("2026-11-18T18:45:00.000Z"); // 13:45 ET on the fixture day
const locationsOnly = () => fakeSupabase((c: FakeCall) => (c.table === "locations" ? { data: [{ id: SHOP, name: "Shop P", code: "P" }] } : { data: [] }));

async function render(facts: unknown, language: "en" | "es" = "en") {
  state.facts = facts;
  state.language = language;
  const page = await DashboardPage({ searchParams: Promise.resolve({ loc: SHOP }) });
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: page }));
}
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** Every attribute value except class (R8: CSS classes carry digits). */
const attrs = (h: string) => [...h.matchAll(/\s([a-zA-Z-:]+)="([^"]*)"/g)].filter((m) => m[1] !== "class").map((m) => m[2]!).join(" ");
const hrefs = (h: string) => [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.mode = "fake";
  state.client = locationsOnly().client;
  state.loadDayFactsCalls = [];
});
afterEach(() => { vi.useRealTimers(); });

describe("(a) handed the busiest day's SHOP facts, nothing of the shop reaches the page", () => {
  it.each(["en", "es"] as const)("%s: no guest count, vendor, time string, other person or other station", async (lang) => {
    const h = await render(busiestFacts(hm("13:45")), lang);
    const visible = text(h);
    const values = attrs(h);
    for (const s of FORBIDDEN_STRINGS) {
      expect(visible, s).not.toContain(s);
      expect(values, s).not.toContain(s);
    }
    // planDay routes the social media manager given shop facts to its own plan with both notes.
    expect(visible).toContain(lang === "en" ? "Couldn't load your tasks." : "No se pudieron cargar tus tareas.");
  });
});

describe("(b) own tasks, in both languages", () => {
  it("Opening and Mid-day prep, each \"Assigned to you.\"; no cash or ordering; the station; the closing link; no Edit", async () => {
    const en = await render(SMM_OK, "en");
    expect([...en.matchAll(/data-smm-task="([^"]+)"/g)].map((m) => m[1])).toEqual(["opening_report", "mid_day_prep"]);
    expect((text(en).match(/Assigned to you\./g) ?? []).length).toBe(2);
    expect(hrefs(en)).toEqual(expect.arrayContaining([`/operations/opening?location=${SHOP}`, `/operations/mid-day?location=${SHOP}`, `/operations/closing?location=${SHOP}`]));
    expect(hrefs(en).some((x) => x.startsWith("/cash") || x.startsWith("/ordering"))).toBe(false);
    expect(text(en)).toContain("My station: Expo Station");
    expect(en).not.toContain('data-action="edit"');
    const es = await render(SMM_OK, "es");
    expect((text(es).match(/Asignada a ti\./g) ?? []).length).toBe(2);
    expect(text(es)).toContain("Estación Expo");
  });
  it("no tasks today: the empty line; the greeting uses the first name", async () => {
    const h = await render({ ...SMM_OK, ownTasks: { kind: "ok", value: [] } } satisfies SmmFacts);
    expect(text(h)).toContain("Nothing is assigned to you today.");
    expect(text(h)).toContain("Good afternoon, Sam.");
  });
});

describe("(c) the notes", () => {
  it("own tasks failed: the note and nothing under the heading; own station failed: its note", async () => {
    const t = text(await render(SMM_FAILED_TASKS));
    expect(t).toContain("Couldn't load your tasks.");
    expect(t).not.toContain("Assigned to you.");
    expect(t).not.toContain("Nothing is assigned to you today.");
    expect(text(await render(SMM_FAILED_STATION))).toContain("Couldn't load your station.");
  });
});

describe("(d) the reads it never makes", () => {
  it("no board, bell read, retrain, rich body or auto-release; the loader once, with board null", async () => {
    await render(SMM_OK);
    for (const spy of [state.board, state.unread, state.retrain, state.deliveries, state.counts, state.release, state.after]) expect(spy).not.toHaveBeenCalled();
    expect(state.loadDayFactsCalls).toHaveLength(1);
    expect((state.loadDayFactsCalls[0] as DayFactsArgs).board).toBeNull();
  });
});

describe("(e) the real loader on the recording client: only the SMM allowlist and locations", () => {
  it("tables ⊆ allowlist; none of the shop's tables", async () => {
    state.mode = "real";
    const f = fakeSupabase((c: FakeCall) => {
      switch (c.table) {
        case "locations": return { data: [{ id: SHOP, name: "Shop P", code: "P" }] };
        case "users": return { data: { role: "social_media_mgr" } };
        case "user_locations": return { data: { user_id: ME } };
        case "report_assignments": return { data: [{ id: "r1", report_type: "opening_report", assignee_id: ME, assigner_id: "lead", note: null }] };
        default: return { data: [] };
      }
    }, () => ({ data: "2026-11-18" }));
    state.client = f.client;
    const h = await render(null);
    const ALLOW = new Set(["users", "user_locations", "report_assignments", "checklist_templates", "checklist_instances", "station_events", "stations", "station_positions", "locations"]);
    for (const c of f.calls) expect(ALLOW.has(c.table), c.table).toBe(true);
    for (const t of f.calls.map((c) => c.table)) {
      expect(t).not.toMatch(/^(schedule_|station_closures|checklist_template_items|checklist_completions|cash_reports|pm_reports|vendor|purchase_orders|catering_|ezcater_orders|notification)/);
    }
    expect(f.calls.some((c) => c.table === "report_assignments")).toBe(true);
    expect(text(h)).toContain("Assigned to you.");
  });
});

describe("(f) what the page never shows the social media manager", () => {
  it("no phase line, no Nobody yet, no link to the pulse, Team today, admin, catering or reports; two shortcuts; All pages opens Go to; no bell", async () => {
    const h = await render(SMM_OK);
    expect(h).not.toContain("data-phase");
    expect(text(h)).not.toContain("Nobody yet");
    for (const prefix of ["/mid-shift", "/assignments", "/admin", "/catering", "/reports"]) expect(hrefs(h).some((x) => x.startsWith(prefix)), prefix).toBe(false);
    expect([...h.matchAll(/data-shortcut="([^"]+)"/g)].map((m) => m[1])).toEqual(["training", "my-feedback"]);
    // Nav PR 9: "All pages" is one button that opens the top bar's Go to sheet; the page itself lists no chips.
    expect(h).not.toContain("<details");
    expect(h.match(/<button[^>]*data-dashboard-all-pages=""[^>]*>([^<]*)<\/button>/)?.[1]).toBe("All pages");
    expect(h).not.toContain("data-bell");
  });
});
