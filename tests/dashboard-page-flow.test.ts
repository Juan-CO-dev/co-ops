/**
 * Nav PR 7: the Dashboard page's flow (plan r2 T11, T12, T18, T7 page half; Astra F1, F2; lead ruling r2 G1).
 *
 * - T11: one instant; the ONE board promise started before the loader resolves, on an abortable client, shared by the
 *   loader and My shift (identity); the board only with `ops`; `locations: auth.locations`; planDay once; the bell,
 *   retrain and loader calls all started before anything is awaited.
 * - T12: no template-first read and no tile loader left on the page.
 * - T18: ONE absolute page deadline. A board / bell / retrain that never settles, all three together, a board that
 *   rejects fast, and (G1) a board that succeeds at 5,900 ms followed by hanging rich reads: the page resolves by 6,000 ms,
 *   the board's queries are aborted, no read that depends on a failed board starts, and no timer is left.
 * - T7 page half (F2): the loader throws, or never settles (the 7 s belt): every fact failed, no phase line, no Next up.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShiftBoard, TaskAssignment } from "@/lib/assignments-shared";
import type { DayFactDeps, DayFactsArgs } from "@/lib/day-plan";
import { TranslationProvider } from "@/lib/i18n/provider";

const SHOP = "11111111-1111-4111-8111-111111111111";
const ME = "33333333-3333-4333-8333-333333333333";
type Mode = "real" | "throw" | "hang" | "deferred";
const state = vi.hoisted(() => ({
  role: "key_holder", level: 4, sessionLocations: ["11111111-1111-4111-8111-111111111111"] as string[],
  mode: "real" as Mode, depsOver: {} as Record<string, unknown>,
  board: null as null | ((client: unknown, args: unknown) => Promise<unknown>),
  unread: null as null | (() => Promise<unknown>),
  retrain: null as null | (() => Promise<unknown>),
  deliveries: vi.fn(async () => [] as unknown[]), counts: vi.fn(async () => null as unknown),
  calls: [] as string[], loaderArgs: [] as unknown[], loaderBoards: [] as unknown[], myShiftBoards: [] as unknown[],
  signals: [] as AbortSignal[], deferred: null as null | { resolve: (v: unknown) => void },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({
  user: { id: "33333333-3333-4333-8333-333333333333", name: "Ana Ruiz", language: "en" }, session: { id: "s" },
  level: state.level, role: state.role, locations: state.sessionLocations,
}) }));
/** The service client: answers the locations read; every builder records the abort signal it is handed. */
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from: (table: string) => {
    const result = { data: table === "locations" ? [{ id: "11111111-1111-4111-8111-111111111111", name: "Shop P", code: "P" }] : [], error: null };
    const query: Record<string, unknown> = {
      select: () => query, eq: () => query, in: () => query, order: () => query,
      abortSignal: (s: AbortSignal) => { state.signals.push(s); return query; },
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  },
}) }));
vi.mock("@/lib/assignments", () => ({
  loadShiftBoard: (client: unknown, args: unknown) => { state.calls.push("board"); return state.board!(client, args); },
  loadOwnTaskAssignments: async () => [],
  loadStationDayFlags: async () => ({ installed: false }),
}));
vi.mock("@/lib/day-plan", async (orig) => {
  const m = await orig<typeof import("@/lib/day-plan")>();
  const { okDeps } = await import("./fixtures/day-plan/loader-deps");
  return {
    ...m,
    loadDayFacts: (sb: Parameters<typeof m.loadDayFacts>[0], a: DayFactsArgs) => {
      state.calls.push("loader");
      state.loaderArgs.push(a);
      const watched: DayFactsArgs = a.board ? { ...a, board: () => a.board!().then((b) => { state.loaderBoards.push(b); return b; }) } : a;
      if (state.mode === "throw") return Promise.reject(new Error("loader bug"));
      if (state.mode === "hang") return new Promise(() => undefined);
      const run = () => m.loadDayFacts(sb, watched, { ...okDeps(), ...state.depsOver } as DayFactDeps);
      if (state.mode === "deferred") return new Promise((resolve) => { state.deferred = { resolve: () => resolve(run()) }; });
      return run();
    },
  };
});
vi.mock("@/lib/day-plan-shared", async (orig) => {
  const m = await orig<typeof import("@/lib/day-plan-shared")>();
  return { ...m, planDay: vi.fn(m.planDay) };
});
vi.mock("@/lib/checklists", () => ({ evaluateAutoReleaseForUserLocations: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  loadUnreadForUser: () => { state.calls.push("unread"); return state.unread!(); },
  notificationLocationContext: () => undefined,
}));
vi.mock("@/lib/yield-stats", () => ({ loadMyRetrainTasks: () => { state.calls.push("retrain"); return state.retrain!(); } }));
vi.mock("@/lib/receiving", () => ({ loadRecentDeliveries: state.deliveries }));
vi.mock("@/lib/counts", () => ({ loadCountsTileState: state.counts }));
vi.mock("@/components/auth/AuthShell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/BrandMark", () => ({ BrandMark: () => null }));
vi.mock("@/components/auth/LogoutButton", () => ({ LogoutButton: () => null }));
vi.mock("@/components/dashboard/NotificationBell", () => ({ NotificationBell: () => createElement("i", { "data-bell": "1" }) }));
vi.mock("@/components/assignments/ShiftBoardClient", () => ({
  ShiftBoardClient: (p: { board: unknown }) => { state.myShiftBoards.push(p.board); return createElement("i", { "data-my-shift": "1" }); },
}));
vi.mock("@/components/receiving/ReceivingTile", () => ({ ReceivingTile: (p: { deliveries: unknown }) => createElement("i", { "data-task-tile": "receiving", "data-loaded": String(p.deliveries !== null) }) }));
vi.mock("@/components/counts/CountsTile", () => ({ CountsTile: (p: { state: unknown }) => createElement("i", { "data-task-tile": "counts", "data-loaded": String(p.state !== null) }) }));

import DashboardPage from "@/app/(authed)/dashboard/page";
import { planDay } from "@/lib/day-plan-shared";
import { settleBy, settleWithin } from "@/lib/dashboard-day";

const NOW = new Date("2026-11-18T18:45:00.000Z"); // 13:45 ET
const never = <T,>() => new Promise<T>(() => undefined);
const theBoard = (tasks: TaskAssignment[] = []): ShiftBoard => ({
  stationDate: "2026-11-18", locationId: SHOP, date: "2026-11-18", viewerId: ME, viewerLevel: 4,
  people: [{ id: ME, name: "Ana Ruiz", level: 4, hasWork: true }], stations: [], events: [], tasks,
});
const own = (task: TaskAssignment["task"]): TaskAssignment => ({ id: `own-${task}`, task, assigneeId: ME, assignerId: "lead", assignerName: null, note: null, available: true });
/** A board read that touches the abortable client first (recording the signal), then answers `answer()`. */
const boardThat = (answer: () => Promise<unknown>) => (client: unknown) => {
  (client as { from: (t: string) => { select: (c: string) => { eq: (a: string, b: string) => unknown } } }).from("stations").select("id").eq("location_id", SHOP);
  return answer();
};

function render(page: unknown): string {
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: page as ReactNode })).replace(/&#x27;/g, "'");
}
/** Start the page; report whether it is done at each checkpoint. */
async function timed(checkpoints: number[]) {
  let done = false;
  const p = DashboardPage({ searchParams: Promise.resolve({ loc: SHOP }) }).then((r) => { done = true; return r; });
  const seen: boolean[] = [];
  let at = 0;
  for (const t of checkpoints) { await vi.advanceTimersByTimeAsync(t - at); at = t; seen.push(done); }
  return { seen, page: await p };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "key_holder"; state.level = 4; state.sessionLocations = [SHOP];
  state.mode = "real"; state.depsOver = {}; state.calls = []; state.loaderArgs = []; state.loaderBoards = []; state.myShiftBoards = []; state.signals = [];
  state.board = boardThat(async () => theBoard());
  state.unread = async () => [];
  state.retrain = async () => [];
});

describe("T11: the page's call shape (real timers)", () => {
  it("one instant; the board starts before the loader resolves, on an abortable client; the SAME board for the loader and My shift", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
    try {
      state.mode = "deferred";
      let callsAtLoader: string[] = [];
      const p = DashboardPage({ searchParams: Promise.resolve({ loc: SHOP }) });
      for (let i = 0; i < 50 && !state.deferred; i++) await Promise.resolve();
      expect(state.deferred).not.toBeNull();
      callsAtLoader = [...state.calls];
      // The bell, retrain, board and loader calls all started before the first await of any of them.
      expect(callsAtLoader.sort()).toEqual(["board", "loader", "retrain", "unread"]);
      expect(state.signals.length).toBeGreaterThan(0); // the board's client carries the page's abort signal
      state.deferred!.resolve(undefined);
      const html = render(await p);
      const args = state.loaderArgs[0] as DayFactsArgs;
      expect(args.now.getTime()).toBe(NOW.getTime());
      // Lead ruling r3, H3: the loader shares the page's ONE absolute deadline (no time passed: the instant + 6 s).
      expect(args.deadlineAt).toBe(NOW.getTime() + 6_000);
      expect(args.locations).toEqual([SHOP]);
      expect(args.board).not.toBeNull();
      expect(state.loaderBoards).toHaveLength(1);
      expect(state.myShiftBoards).toHaveLength(1);
      expect(state.loaderBoards[0]).toBe(state.myShiftBoards[0]); // identity: ONE board
      expect(vi.mocked(planDay)).toHaveBeenCalledTimes(1);
      expect(html).toContain("data-my-shift");
    } finally { vi.useRealTimers(); state.deferred = null; }
  });

  it("the board's date is the plan date of the one instant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
    try {
      let seen: unknown = null;
      state.board = (client, args) => { seen = args; return boardThat(async () => theBoard())(client); };
      await DashboardPage({ searchParams: Promise.resolve({ loc: SHOP }) });
      expect(seen).toMatchObject({ locationId: SHOP, date: "2026-11-18", actor: { userId: ME, role: "key_holder", level: 4, locations: [SHOP] } });
    } finally { vi.useRealTimers(); }
  });

  it("no ops surface at the shop: no board read and the loader gets board null", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
    try {
      // A MoO who belongs to another shop: the (fake) locations read still returns this shop; the viewer holds no surface here.
      state.role = "moo"; state.level = 8; state.sessionLocations = ["99999999-9999-4999-8999-999999999999"];
      await DashboardPage({ searchParams: Promise.resolve({ loc: SHOP }) });
      expect(state.calls).not.toContain("board");
      expect((state.loaderArgs[0] as DayFactsArgs).board).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});

describe("T12: no template-first read and no tile loader on the page", () => {
  it("imports none of them and reads no checklist table itself", () => {
    const src = readFileSync("app/(authed)/dashboard/page.tsx", "utf8");
    for (const name of ["applyEffectiveResolution", "loadAmPrepDashboardState", "loadMidDayPrepDashboardState", "loadCashDashboardState",
      "loadPmDashboardState", "loadOrderingAttention", "loadTodaysOrders", "loadOwnTaskAssignments", "canEditReport"]) {
      expect(src, name).not.toContain(name);
    }
    expect(src).not.toMatch(/\.from\(\s*"checklist_templates"\s*\)/);
    expect(src).not.toMatch(/\.from\(\s*"checklist_instances"\s*\)/);
    expect(src).not.toContain("checklist_");
    expect(src).not.toContain("Date.now()");
  });
});

describe("T18: one absolute page deadline (fake timers)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it("(a) a board that never settles: pending at 5,999 ms, resolved at 6,000; Team today couldn't load; board reads aborted; no dependent read; no timer left", async () => {
    state.board = boardThat(() => never());
    state.depsOver = { ownTasks: async () => [own("receiving"), own("counts")] };
    const { seen, page } = await timed([5_999, 6_000]);
    expect(seen).toEqual([false, true]);
    const html = render(page);
    expect(html).toContain("Team today: Couldn't load right now");
    expect(html).toContain("Couldn't load the stations.");
    expect(html).toContain("Couldn't load your station.");
    expect(html).not.toContain("data-my-shift");
    expect(html).toContain('data-day-item="receiving"');
    expect(state.deliveries).not.toHaveBeenCalled();
    expect(state.counts).not.toHaveBeenCalled();
    expect(html).not.toContain("data-task-tile");
    expect(state.signals.length).toBeGreaterThan(0);
    expect(state.signals.every((s) => s.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("(b) the bell read never settles: resolved at 6 s with its line and no bell", async () => {
    state.unread = () => never();
    const { seen, page } = await timed([5_999, 6_000]);
    expect(seen).toEqual([false, true]);
    const html = render(page);
    expect(html).toContain("Notifications: Couldn't load right now");
    expect(html).not.toContain("data-bell");
    expect(html).toContain("data-my-shift");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("(c) retrain never settles: resolved at 6 s with its line", async () => {
    state.retrain = () => never();
    const { seen, page } = await timed([5_999, 6_000]);
    expect(seen).toEqual([false, true]);
    expect(render(page)).toMatch(/: Couldn't load right now/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("(d) all three never settle together: still 6 s (parallel, not 18 s)", async () => {
    state.board = boardThat(() => never());
    state.unread = () => never();
    state.retrain = () => never();
    const { seen } = await timed([5_999, 6_000]);
    expect(seen).toEqual([false, true]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("(e) a board that rejects at 100 ms: the page does not wait for 6 s", async () => {
    state.board = boardThat(() => new Promise((_, reject) => setTimeout(() => reject(new Error("offline")), 100)));
    const { seen, page } = await timed([99, 150]);
    expect(seen).toEqual([false, true]);
    expect(render(page)).toContain("Team today: Couldn't load right now");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("(G1) the board succeeds at 5,900 ms with own Receiving and Counts; both rich reads hang: resolved by 6,000 with both bodies unavailable", async () => {
    state.board = boardThat(() => new Promise((resolve) => setTimeout(() => resolve(theBoard([own("receiving"), own("counts")])), 5_900)));
    state.deliveries.mockImplementation(() => never());
    state.counts.mockImplementation(() => never());
    const { seen, page } = await timed([5_899, 5_999, 6_000]);
    expect(seen).toEqual([false, false, true]);
    const html = render(page);
    expect(state.deliveries).toHaveBeenCalledTimes(1);
    expect(state.counts).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-task-tile="receiving" data-loaded="false"');
    expect(html).toContain('data-task-tile="counts" data-loaded="false"');
    expect(html).toContain("Receiving: Couldn't load right now");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("settleBy: the absolute deadline helper (G1 timer cleanup)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
  const at = (ms: number) => Date.now() + ms;

  it("success clears its timer", async () => {
    const r = await settleBy(async () => 7, at(6_000), "t");
    expect(r).toEqual({ kind: "ok", value: 7 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejection (and a synchronous throw) clears its timer; never rejects", async () => {
    expect(await settleBy(async () => { throw new Error("x"); }, at(6_000), "t")).toEqual({ kind: "failed" });
    expect(await settleBy(() => { throw new Error("sync"); }, at(6_000), "t")).toEqual({ kind: "failed" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("timeout: aborts the signal, resolves timed_out, leaves no timer; a late settlement changes nothing", async () => {
    let signal: AbortSignal | null = null;
    let late: (v: number) => void = () => undefined;
    const p = settleBy((s) => { signal = s; return new Promise<number>((r) => { late = r; }); }, at(6_000), "t");
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await p).toEqual({ kind: "timed_out" });
    expect(signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    late(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toEqual({ kind: "timed_out" });
    expect(vi.getTimerCount()).toBe(0);
    // A late REJECTION after a timeout is swallowed too (no unhandled rejection, no timer).
    let lateReject: (e: unknown) => void = () => undefined;
    const q = settleBy(() => new Promise<number>((_, reject) => { lateReject = reject; }), at(100), "t");
    await vi.advanceTimersByTimeAsync(100);
    expect(await q).toEqual({ kind: "timed_out" });
    lateReject(new Error("late"));
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("no time left: the read is never started", async () => {
    const run = vi.fn(async () => 1);
    expect(await settleBy(run, Date.now(), "t")).toEqual({ kind: "timed_out" });
    expect(await settleBy(run, Date.now() - 1, "t")).toEqual({ kind: "timed_out" });
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("settleWithin is settleBy from now", async () => {
    const p = settleWithin(() => never(), 7_000, "t");
    await vi.advanceTimersByTimeAsync(6_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ kind: "timed_out" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("T7 page half (F2): the loader throws or never settles", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it("throws, or hangs past the 7 s belt: every fact failed, no phase line, no Next up, no empty claim; the same render", async () => {
    state.mode = "throw";
    const thrown = render((await timed([0])).page);
    state.mode = "hang";
    const { seen, page } = await timed([6_999, 7_000]);
    expect(seen).toEqual([false, true]);
    const hung = render(page);
    for (const html of [thrown, hung]) {
      expect(html).toContain("Couldn't load today's status.");
      expect(html).not.toContain("data-phase");
      expect(html).not.toContain("data-next-up");
      expect(html).not.toContain("Nothing is due right now");
      expect(html).not.toContain("Closed for the day");
      expect([...html.matchAll(/data-day-item="([^"]+)"/g)].length).toBeGreaterThan(0);
    }
    expect(hung).toBe(thrown);
    expect(vi.getTimerCount()).toBe(0);
  });
});
