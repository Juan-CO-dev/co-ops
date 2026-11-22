/**
 * The Dashboard's visibility by role, on the day engine (nav PR 7, plan r2 T5; Astra F3). The page runs the REAL loader
 * (PR 6) on fake reads built for the mocked viewer, the real engine (PR 5) and the real renderer; only the shift board,
 * the session, the service client and the tiles are stand-ins. Server time is frozen (13:45 ET on 2026-11-18) so the
 * board's day is the plan date.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TASK_TYPES, type TaskAssignment } from "@/lib/assignments-shared";
import type { DayFactDeps } from "@/lib/day-plan";
import { ROLES } from "@/lib/roles";
import { TranslationProvider } from "@/lib/i18n/provider";

const state = vi.hoisted(() => ({
  level: 4, role: "key_holder", tasks: [] as TaskAssignment[], failure: "", logoutProps: [] as unknown[],
  depsOver: {} as Record<string, unknown>, deliveries: vi.fn(async () => []), counts: vi.fn(async () => ({ lastCountDate: null, anchoredSkuCount: 0 })),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) })); // B2: no remembered shop
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({ user: { id: "viewer", name: "Viewer Person", language: "en" }, session: { id: "session-dash" }, level: state.level, role: state.role, locations: ["shop-a"] }) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: (table: string) => {
  const result = { data: table === "locations" ? [{ id: "shop-a", name: "Shop A", code: "A" }] : [], error: null };
  const query = {
    select: () => query, eq: () => query, in: () => query, order: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
} }) }));
vi.mock("@/lib/assignments", () => ({
  loadShiftBoard: async () => {
    if (state.failure === "board" || state.failure === "both") throw new Error("offline");
    return {
      stationDate: "2026-11-18", locationId: "shop-a", date: "2026-11-18", viewerId: "viewer", viewerLevel: state.level,
      people: [{ id: "viewer", name: "Viewer", level: state.level, hasWork: true }], stations: [], events: [], tasks: state.tasks,
    };
  },
  loadOwnTaskAssignments: async () => [],
  loadStationDayFlags: async () => ({ installed: false }),
}));
// The real loader on PR 6's fake reads (tests/fixtures/day-plan/loader-deps.ts), with per-test overrides.
vi.mock("@/lib/day-plan", async (orig) => {
  const m = await orig<typeof import("@/lib/day-plan")>();
  const { okDeps } = await import("./fixtures/day-plan/loader-deps");
  return { ...m, loadDayFacts: (sb: Parameters<typeof m.loadDayFacts>[0], a: Parameters<typeof m.loadDayFacts>[1]) => m.loadDayFacts(sb, a, { ...okDeps(), ...state.depsOver } as DayFactDeps) };
});
vi.mock("@/lib/checklists", () => ({ evaluateAutoReleaseForUserLocations: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  loadUnreadForUser: async () => { if (state.failure === "notifications") throw new Error("offline"); return []; },
  notificationLocationContext: (a: { level: number; locations: string[] }) => (a.level >= 9 && a.locations.length === 0 ? undefined : a.locations),
}));
vi.mock("@/lib/yield-stats", () => ({ loadMyRetrainTasks: async () => [] }));
vi.mock("@/lib/receiving", () => ({ loadRecentDeliveries: state.deliveries }));
vi.mock("@/lib/counts", () => ({ loadCountsTileState: state.counts }));
vi.mock("@/components/auth/AuthShell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/BrandMark", () => ({ BrandMark: () => null }));
vi.mock("@/components/auth/LogoutButton", () => ({ LogoutButton: (props: unknown) => { state.logoutProps.push(props); return null; } }));
vi.mock("@/components/dashboard/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/DashboardNav", () => ({ DashboardNav: () => null }));
vi.mock("@/components/receiving/ReceivingTile", () => ({ ReceivingTile: () => createElement("i", { "data-task-tile": "receiving" }) }));
vi.mock("@/components/counts/CountsTile", () => ({ CountsTile: () => createElement("i", { "data-task-tile": "counts" }) }));

import DashboardPage from "@/app/(authed)/dashboard/page";

const NOW = new Date("2026-11-18T18:45:00.000Z"); // 13:45 ET
const own = (task: TaskAssignment["task"]): TaskAssignment => ({ id: `own-${task}`, task, assigneeId: "viewer", assignerId: "lead", assignerName: null, note: null, available: true });

async function html(level: number, assigned: boolean, assigneeId = "viewer") {
  state.level = level;
  state.role = Object.values(ROLES).find((role) => role.level === level)!.code;
  state.tasks = assigned ? TASK_TYPES.map((task) => ({ id: task, task, assigneeId, assigneeName: assigneeId === "viewer" ? "Viewer Person" : "Other Person",
    assignerId: "lead", assignerName: "Lead", note: null })) : [];
  const page = await DashboardPage({ searchParams: Promise.resolve({ loc: "shop-a" }) });
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: page }));
}
function shape(h: string) {
  const rows = [...h.matchAll(/data-day-item="([^"]+)"/g)].map((m) => m[1]!);
  const holders = Object.fromEntries([...h.matchAll(/data-day-item="([^"]+)"[\s\S]*?(?:data-holder="([^"]+)"|<\/article>)/g)].filter((m) => m[2]).map((m) => [m[1]!, m[2]!]));
  return { myShift: h.includes("My shift"), rows, holders, tiles: [...h.matchAll(/data-task-tile="([^"]+)"/g)].map((m) => m[1]) };
}
const decoded = (h: string) => h.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.failure = ""; state.logoutProps = []; state.depsOver = {};
});
afterEach(() => { vi.useRealTimers(); });

describe("dashboard rendered visibility by role", () => {
  it.each([2, 3, 4, 5, 6, 7, 9])("snapshots assigned and unassigned dashboards at level %s", async (level) => {
    expect({ unassigned: shape(await html(level, false)), assigned: shape(await html(level, true)) }).toMatchSnapshot();
  });

  it("crew never see another person's row or name in the day list", async () => {
    for (const level of [2, 3]) {
      const h = await html(level, true, "other");
      expect(shape(h).rows).toEqual(["closing"]);
      const day = h.slice(h.indexOf('aria-label="Today&#x27;s tasks"'), h.indexOf("My shift"));
      expect(day.length).toBeGreaterThan(0);
      expect(day).not.toContain("Other");
    }
  });

  it("level 9 with every task held by someone else: each holder row reads \"Other has it.\", no tile, no Do it on them", async () => {
    const h = await html(9, true, "other");
    const s = shape(h);
    expect(s.tiles).toEqual([]);
    expect(s.myShift).toBe(true);
    for (const id of ["opening", "mid_day_prep", "am_prep", "cash", "pm_report", "ordering", "receiving"]) expect(s.holders[id], id).toBe("named");
    expect((decoded(h).match(/Other has it\./g) ?? []).length).toBe(7);
  });

  it("own Receiving and Counts get their tile, and only then are their reads made", async () => {
    await html(4, false);
    expect(state.deliveries).not.toHaveBeenCalled();
    expect(state.counts).not.toHaveBeenCalled();
    const s = shape(await html(4, true));
    expect(s.tiles.sort()).toEqual(["counts", "receiving"]);
    expect(state.deliveries).toHaveBeenCalledTimes(1);
    expect(state.counts).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    state.tasks = [];
    expect(shape(await html(9, true, "other")).tiles).toEqual([]);
    expect(state.deliveries).not.toHaveBeenCalled();
  });
});

describe("F3: the board fails, the viewer's own assignments keep their work visible (never a roster)", () => {
  it("(i) crew: the own Opening is listed and opens; another person's Mid-day prep is absent; the notes; Team today couldn't load", async () => {
    state.failure = "board";
    state.depsOver = { ownTasks: async () => [own("opening_report")] };
    const h = decoded(await html(3, true, "other"));
    const s = shape(h);
    expect(s.rows).toContain("opening");
    expect(s.rows).not.toContain("mid_day_prep");
    expect(h).toContain('href="/operations/opening?location=shop-a"');
    expect(h).toContain("Couldn't load the stations.");
    expect(h).toContain("Couldn't load your station.");
    expect(h).toContain("Team today: Couldn't load right now");
    expect(s.myShift).toBe(false);
    expect(h).not.toContain("Other");
  });

  it("(ii) KH: own Opening \"Yours\"; every other holder \"Couldn't load who has it.\" with Do it only; no Nobody yet, no Assign", async () => {
    state.failure = "board";
    state.depsOver = { ownTasks: async () => [own("opening_report")] };
    const h = decoded(await html(4, false));
    const s = shape(h);
    expect(s.holders.opening).toBe("mine");
    for (const id of ["mid_day_prep", "am_prep", "cash", "pm_report", "ordering", "receiving"]) expect(s.holders[id], id).toBe("unknown");
    expect(h).toContain("Couldn't load who has it.");
    expect(h).not.toContain("Nobody yet");
    expect(h).not.toContain('data-action="assign"');
    expect(h).not.toMatch(/>Assign</);
  });

  it("(iii) the board and the own read both fail: crew get the closing pin and \"Couldn't load your tasks.\", no task rows", async () => {
    state.failure = "both";
    state.depsOver = { ownTasks: async () => { throw new Error("offline"); } };
    const h = decoded(await html(3, true));
    expect(shape(h).rows).toEqual(["closing"]);
    expect(h).toContain("Couldn't load your tasks.");
  });
});

describe("dashboard loader resilience and the closing alert", () => {
  it("a failed bell read is its own line; the rest renders", async () => {
    state.failure = "notifications";
    const h = decoded(await html(4, true));
    expect(h).toContain("Viewer");
    expect(h).toMatch(/: Couldn't load right now/);
    expect(shape(h).rows.length).toBeGreaterThan(1);
  });

  it("yesterday's unfinished closing: KH+ get the alert (independent of assignment); level 3 without a station none", async () => {
    const yesterdayOpen = { dayInstance: async (_sb: unknown, a: { type: string; date: string }) => (a.date === "2026-11-17" && a.type === "closing"
      ? { id: "close-0", template_id: "tpl", status: "open", created_at: null, confirmed_at: null, confirmed_by: null } : null) };
    state.depsOver = yesterdayOpen;
    expect(decoded(await html(4, true, "other"))).toContain("/operations/closing?location=shop-a&date=2026-11-17");
    state.depsOver = yesterdayOpen;
    expect(decoded(await html(3, true, "viewer"))).not.toContain("/operations/closing?location=shop-a&date=2026-11-17");
  });
});

// Audit W06/B012 fix round 7: the dashboard's Log out button names the session the page was served for, so a retried
// sign-out (after a network failure, while someone signs in in another tab) can never end the newer session.
describe("the dashboard Log out button", () => {
  it("is given the served session id", async () => {
    await html(4, false);
    expect(state.logoutProps).toEqual([{ sessionId: "session-dash" }]);
  });
});
