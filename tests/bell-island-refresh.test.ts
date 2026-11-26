// @vitest-environment jsdom
/* eslint-disable react/no-children-prop -- the harness builds the tree with createElement */
/**
 * Nav PR 9, B2 and G3: the bell island's freshness and order (plan r2 4.3; lead rulings r1 F7, Q3, Q9 and r2 G3).
 *
 * No fetch on mount after an ok stream; one after a failed stream. Pathname changes, `focus` and becoming visible are
 * UNFORCED and throttled by the last ATTEMPT (G3): at most one per 60 s whatever the answers were. One request in
 * flight; forced triggers (after a mark) bypass the throttle and collapse into one follow-up. A late answer from a
 * request already decided (timed out) never overwrites a newer one. A 503, a network error and a 10 s timeout move
 * ok → stale (the last list and badge kept, the stale label) and unavailable → unavailable (no badge, never a 0).
 */
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ path: "/dashboard", router: { push: () => {}, refresh: () => {} } }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router, usePathname: () => nav.path }));
vi.mock("@/components/nav/notification-actions", () => ({ markNotificationReadAction: vi.fn(async () => ({ ok: true, newlyMarked: true })) }));

import { BellIsland, BELL_REFRESH_MS } from "@/components/nav/BellIsland";
import { NavShell } from "@/components/nav/NavShell";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { NotificationWithRecipient } from "@/lib/notifications";
import en from "@/lib/i18n/en.json";

const T = en as Record<string, string>;
const ME = { userName: "Kim", userEmail: null, actorLevel: 4, initialBlurb: null, sessionId: "s1" };
const MODEL = { rooms: [], people: false };

function notice(id: string): NotificationWithRecipient {
  return {
    notification: { id: `n-${id}`, type: "under_par_alert", priority: "urgent", title: "t", body: null, data: {}, relatedTable: null, relatedId: null, locationId: null, createdAt: "2026-11-01T12:00:00Z" },
    recipient: { id, notificationId: `n-${id}`, userId: "me", deliveryMethod: "in_app", deliveryStatus: "sent", readAt: null, acknowledgedAt: null },
  } as unknown as NotificationWithRecipient;
}
const okBody = (...ids: string[]) => ({ notices: ids.map(notice), locationCodes: {} });

type Pending = { resolve: (r: Response) => void; reject: (e: unknown) => void; signal: AbortSignal };
let pending: Pending[] = [];
const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
  pending.push({ resolve, reject, signal: init!.signal! });
}));
const unreadCalls = () => fetchMock.mock.calls.filter(([u]) => u === "/api/notifications/unread").length;
const respond = async (i: number, status: number, body?: unknown) => {
  await act(async () => { pending[i]!.resolve(new Response(JSON.stringify(body ?? {}), { status })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
};
const fail = async (i: number) => {
  await act(async () => { pending[i]!.reject(new TypeError("network")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
};
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function tree(initial: ReturnType<typeof okBody> | null) {
  return createElement(TranslationProvider, {
    initialLanguage: "en",
    children: createElement(NavShell, { model: MODEL, me: ME, bell: createElement(BellIsland, { initial }), children: null }),
  });
}
let rerender: (ui: ReturnType<typeof tree>) => void;
function mount(initial: ReturnType<typeof okBody> | null) {
  ({ rerender } = render(tree(initial)));
  return initial;
}
const bell = () => document.querySelector("[data-co-bell]") as HTMLButtonElement | null;
const badge = () => document.querySelector("[data-co-bell-badge]")?.textContent ?? null;
const navigate = (path: string, initial: ReturnType<typeof okBody> | null) => { nav.path = path; act(() => rerender(tree(initial))); };
const focus = () => act(() => { window.dispatchEvent(new Event("focus")); });
const visible = () => act(() => { document.dispatchEvent(new Event("visibilitychange")); });

beforeEach(() => {
  pending = [];
  fetchMock.mockClear();
  nav.path = "/dashboard";
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("B2: mount", () => {
  it("an ok stream: no fetch on mount (and the pathname effect skips the mount's own path)", async () => {
    mount(okBody("a", "b"));
    await tick(1_000);
    expect(unreadCalls()).toBe(0);
    expect(badge()).toBe("2");
  });
  it("a failed stream: one fetch on mount, 'unavailable' meanwhile (no badge)", async () => {
    mount(null);
    await tick(0);
    expect(unreadCalls()).toBe(1);
    expect(badge()).toBeNull();
    expect(bell()!.getAttribute("aria-label")).toContain(T["notifications.bell.unavailable_aria"]);
    await respond(0, 200, okBody("x"));
    expect(badge()).toBe("1");
  });
});

describe("B2: the 60 s throttle on unforced triggers", () => {
  it("pathname change, focus and visible each fetch at most once per 60 s from the last attempt", async () => {
    const init = mount(okBody("a"));
    await tick(10_000);
    navigate("/operations/closing", init);
    focus();
    visible();
    expect(unreadCalls()).toBe(0); // the stream at mount is the last attempt
    await tick(BELL_REFRESH_MS);
    navigate("/ordering", init);
    expect(unreadCalls()).toBe(1);
    await respond(0, 200, okBody("a", "b"));
    focus();
    visible();
    navigate("/dashboard", init);
    expect(unreadCalls()).toBe(1);
    await tick(BELL_REFRESH_MS);
    focus();
    expect(unreadCalls()).toBe(2);
  });
  it("a visibilitychange to hidden does not fetch", async () => {
    mount(okBody("a"));
    await tick(BELL_REFRESH_MS + 1);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    visible();
    expect(unreadCalls()).toBe(0);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    visible();
    expect(unreadCalls()).toBe(1);
  });
});

describe("B2: one in flight, forced follow-ups", () => {
  it("three forced triggers during one request → exactly one follow-up, bypassing the throttle", async () => {
    mount(null);
    await tick(0);
    expect(unreadCalls()).toBe(1);
    act(() => { bell()!.click(); });
    expect(document.querySelector("[data-co-nav-sheet]")).not.toBeNull();
    await respond(0, 200, okBody("a", "b"));
    // A mark (a card tap → the panel's onMarked = a FORCED refetch), three times while the forced refetch is in flight.
    const cards = () => Array.from(document.querySelectorAll("[data-co-nav-sheet] li button")) as HTMLButtonElement[];
    expect(cards()).toHaveLength(2);
    await act(async () => { cards()[0]!.click(); await vi.advanceTimersByTimeAsync(0); });
    expect(unreadCalls()).toBe(2); // forced: no 60 s wait
    await act(async () => { cards()[0]!.click(); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { (cards()[0] ?? cards()[1])?.click(); await vi.advanceTimersByTimeAsync(0); });
    expect(unreadCalls()).toBe(2); // one in flight; the rest are queued as ONE follow-up
    await respond(1, 200, okBody("b"));
    expect(unreadCalls()).toBe(3);
    await respond(2, 200, okBody());
    expect(unreadCalls()).toBe(3);
  });
  it("unforced triggers during a request do not produce a follow-up inside 60 s", async () => {
    mount(null);
    await tick(0);
    focus();
    visible();
    navigate("/ordering", null);
    await respond(0, 503, {});
    await tick(1_000);
    expect(unreadCalls()).toBe(1);
  });
});

describe("B2: order", () => {
  it("a late answer from a timed-out request never overwrites the newer one", async () => {
    mount(null);
    await tick(0);
    await tick(10_000); // request 0 times out: transient
    expect(badge()).toBeNull();
    await tick(BELL_REFRESH_MS);
    focus();
    expect(unreadCalls()).toBe(2);
    await respond(1, 200, okBody("new1", "new2", "new3"));
    expect(badge()).toBe("3");
    await act(async () => { pending[0]!.resolve(new Response(JSON.stringify(okBody("old")), { status: 200 })); });
    await tick(0);
    expect(badge()).toBe("3");
  });
});

describe("B2: transient failures", () => {
  it.each([
    ["a 503", (i: number) => respond(i, 503, { code: "notifications_unavailable" })],
    ["a network error", (i: number) => fail(i)],
    ["a 10 s timeout", async () => { await tick(10_000); }],
  ] as const)("%s: ok → stale (list and badge kept, stale label)", async (_l, failWith) => {
    mount(okBody("a", "b"));
    await tick(BELL_REFRESH_MS + 1);
    focus();
    await failWith(0);
    expect(badge()).toBe("2");
    expect(bell()!.getAttribute("data-co-bell-state")).toBe("stale");
    expect(bell()!.getAttribute("aria-label")).toContain("Couldn't refresh");
    act(() => { bell()!.click(); });
    expect(document.querySelector("[data-co-bell-stale]")!.textContent).toBe(T["notifications.sheet.stale"]);
    expect(document.querySelectorAll("[data-co-nav-sheet] li")).toHaveLength(2);
  });
  it.each([
    ["a 503", (i: number) => respond(i, 503, {})],
    ["a network error", (i: number) => fail(i)],
    ["a 10 s timeout", async () => { await tick(10_000); }],
  ] as const)("%s: unavailable → unavailable (no badge, never 0)", async (_l, failWith) => {
    mount(null);
    await tick(0);
    await failWith(0);
    expect(badge()).toBeNull();
    expect(bell()!.getAttribute("data-co-bell-state")).toBe("unavailable");
    act(() => { bell()!.click(); });
    expect(document.querySelector("[data-co-bell-unavailable]")!.textContent).toBe(T["notifications.sheet.unavailable"]);
    expect(document.body.textContent).not.toContain(T["notifications.empty_state"]);
  });
});

describe("G3: the throttle counts ATTEMPTS, not successes", () => {
  it("repeated fast 503s with navigation, focus and visibility events: at most one non-forced attempt per 60 s", async () => {
    mount(null);
    await tick(0);
    const starts: number[] = [Date.now()];
    let seen = 1;
    const paths = ["/a", "/b", "/c", "/d"];
    for (let step = 0; step < 300; step++) {
      // every second, one of the triggers; every answer is an immediate 503
      const kind = step % 3;
      if (kind === 0) navigate(paths[step % paths.length]!, null);
      else if (kind === 1) focus();
      else visible();
      if (unreadCalls() > seen) {
        starts.push(Date.now());
        seen = unreadCalls();
      }
      while (pending.length < unreadCalls()) await tick(0);
      for (let i = 0; i < pending.length; i++) if (!pending[i]!.signal.aborted) await respond(i, 503, {});
      pending = pending.map((p) => ({ ...p, resolve: () => {}, reject: () => {} }));
      await tick(1_000);
    }
    // 300 s of events → the mount attempt plus at most one per 60 s.
    expect(starts.length).toBeLessThanOrEqual(1 + Math.ceil(300_000 / BELL_REFRESH_MS));
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(BELL_REFRESH_MS);
    expect(starts.length).toBeGreaterThanOrEqual(4); // and it does keep trying, once a minute
  });
});
