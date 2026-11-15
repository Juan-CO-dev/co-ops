// @vitest-environment jsdom
/**
 * Audit W06 — the idle sign-out (components/auth/IdleTimeoutWarning.tsx).
 *  B012: the idle expiry REVOKES the session (POST /api/auth/logout) before going to the login page, exactly once.
 *  B013: steady typing keeps the server session alive (throttled heartbeat); a dead session on the heartbeat, or on
 *        "Stay signed in", signs out instead of pretending; the idle limit is the server's.
 *  B153: one idle clock across tabs (localStorage + the storage event); blocked storage keeps the per-tab clock.
 *  Round 4: other tabs are told of a sign-out only after its logout request settles.
 *  Round 5: the sign-out names the session it ends (the logout body and the cross-tab signal), so a late logout can
 *           neither end nor sign out a NEW session (the server half: tests/logout-revoke-only.test.ts).
 *  W06-2: the idle sign-in link carries a return link bound to this user.
 */
import { act, useEffect, useRef } from "react";
import { jsx } from "react/jsx-runtime";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";

const h = vi.hoisted(() => ({
  push: vi.fn(), fetch: vi.fn(), tab: "A", pushes: [] as Array<[string, string]>, session: "session-1",
}));
// One stable router per mounted component (like Next's), tagged with the tab it was mounted as.
vi.mock("next/navigation", async () => {
  const { useRef } = await import("react");
  return {
    useRouter: () => {
      const tab = useRef(h.tab);
      const router = useRef<{ push: (url: string) => void; refresh: () => void } | null>(null);
      if (router.current === null) {
        router.current = {
          push: (url: string) => {
            h.push(url);
            h.pushes.push([tab.current, url]);
          },
          refresh: () => {},
        };
      }
      return router.current;
    },
  };
});

const STAY = (en as Record<string, string>)["auth.idle.stay"]!;
const ACTIVITY_KEY = "co_ops_last_activity";
const SIGNED_OUT_KEY = "co_ops_signed_out";
const IDLE_TARGET = "/?reason=idle&next=%2Foperations%2Fcounts%3Floc%3Da&for=user-1";

const ok = () => ({ ok: true, status: 200, type: "basic", json: async () => ({ ok: true }) }) as unknown as Response;
const dead = () => ({ ok: false, status: 401, type: "basic", json: async () => ({ code: "unauthorized" }) }) as unknown as Response;
const unavailable = () => ({ ok: false, status: 503, type: "basic", json: async () => ({ code: "unavailable" }) }) as unknown as Response;
const HEARTBEAT_KEY = "co_ops_last_heartbeat";
const calls = (url: string) => h.fetch.mock.calls.filter((c) => c[0] === url);
const mount = (props: { idleMinutes?: number } = {}) =>
  render(jsx(TranslationProvider, {
    initialLanguage: "en",
    children: jsx(IdleTimeoutWarning, { userId: "user-1", sessionId: h.session, ...props }),
  }));
const advance = (seconds: number) => act(async () => { await vi.advanceTimersByTimeAsync(seconds * 1000); });
const otherTab = (key: string, value: string) => act(() => {
  window.localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.tab = "A";
  h.pushes = [];
  h.session = "session-1";
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/operations/counts?loc=a");
  h.fetch.mockImplementation(async () => ok());
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("B012 — the idle expiry revokes the session", () => {
  it("idle expiry revokes the session before sending to the login page, once", async () => {
    mount();
    await advance(600);
    await advance(5);
    const logout = calls("/api/auth/logout");
    expect(logout).toHaveLength(1);
    expect(logout[0]![1]).toMatchObject({ method: "POST" });
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET);
    const logoutOrder = h.fetch.mock.invocationCallOrder[h.fetch.mock.calls.findIndex((c) => c[0] === "/api/auth/logout")]!;
    expect(logoutOrder).toBeLessThan(h.push.mock.invocationCallOrder[0]!);
  });

  it("the warning opens 30 s before the limit", async () => {
    mount();
    await advance(569);
    expect(screen.queryByRole("dialog")).toBeNull();
    await advance(2);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("B013 — client and server idle clocks agree", () => {
  it("steady typing keeps the server session alive", async () => {
    mount();
    for (let s = 0; s < 660; s += 20) {
      await advance(20);
      fireEvent.keyDown(window, { key: "a" });
    }
    const beats = calls("/api/auth/heartbeat").length;
    expect(beats).toBeGreaterThanOrEqual(5);
    expect(beats).toBeLessThanOrEqual(7);
    expect(h.push).not.toHaveBeenCalled();
    expect(calls("/api/auth/logout")).toHaveLength(0);
  });

  it("typing, a pause shorter than the limit, then typing again does not hit an expired server session", async () => {
    // An expiring server clock: every request that reaches the server while the session is alive touches it;
    // once the server's last activity is a full idle window old, the heartbeat is a 401.
    const IDLE_MS = 600_000;
    let serverLastActivity = Date.now(); // the page load reached the server
    h.fetch.mockImplementation(async (url: string) => {
      if (url !== "/api/auth/heartbeat") return ok();
      if (Date.now() - serverLastActivity >= IDLE_MS) return dead();
      serverLastActivity = Date.now();
      return ok();
    });
    mount();
    await advance(120); // 2:00 — typing; this heartbeat goes out
    fireEvent.keyDown(window, { key: "a" });
    expect(calls("/api/auth/heartbeat")).toHaveLength(1);
    await advance(119); // 3:59 — more typing, inside the throttle window
    fireEvent.keyDown(window, { key: "b" });
    await advance(30); // the trailing heartbeat goes out once the window opens (4:00)
    expect(calls("/api/auth/heartbeat")).toHaveLength(2);
    await advance(480); // 12:29 — a pause shorter than the limit, no new activity: nothing more is sent
    expect(calls("/api/auth/heartbeat")).toHaveLength(2);
    fireEvent.keyDown(window, { key: "c" }); // typing again
    await advance(1);
    expect(calls("/api/auth/heartbeat")).toHaveLength(3);
    expect(calls("/api/auth/logout")).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
  });

  it("a trailing heartbeat that fails (503) is retried, so resumed typing does not hit an expired server session", async () => {
    // The round-2 review sequence: type 2:00 (ok), type 3:59, the 4:00 trailing beat gets a transient 503,
    // connectivity recovers, type again at 12:29. The client is only 8:30 idle, so nobody may be signed out.
    const IDLE_MS = 600_000;
    let serverLastActivity = Date.now();
    let failNext = false;
    h.fetch.mockImplementation(async (url: string) => {
      if (url !== "/api/auth/heartbeat") return ok();
      if (failNext) {
        failNext = false;
        return unavailable(); // the session lookup failed; last_activity_at was NOT touched
      }
      if (Date.now() - serverLastActivity >= IDLE_MS) return dead();
      serverLastActivity = Date.now();
      return ok();
    });
    mount();
    await advance(120); // 2:00
    fireEvent.keyDown(window, { key: "a" });
    expect(calls("/api/auth/heartbeat")).toHaveLength(1);
    await advance(119); // 3:59
    fireEvent.keyDown(window, { key: "b" });
    failNext = true;
    await advance(1); // 4:00 — the trailing beat goes out and gets a 503
    expect(calls("/api/auth/heartbeat")).toHaveLength(2);
    await advance(60); // 5:00 — recovered; the unacknowledged activity is retried
    expect(calls("/api/auth/heartbeat")).toHaveLength(3);
    await advance(449); // 12:29 — nothing more is sent once the retry was acknowledged
    expect(calls("/api/auth/heartbeat")).toHaveLength(3);
    fireEvent.keyDown(window, { key: "c" });
    await advance(1);
    expect(calls("/api/auth/heartbeat")).toHaveLength(4);
    expect(calls("/api/auth/logout")).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
  });

  it("a heartbeat lost to the network is retried with bounded backoff while the operator is active", async () => {
    let failing = true;
    h.fetch.mockImplementation(async (url: string) => {
      if (url === "/api/auth/heartbeat" && failing) throw new TypeError("Failed to fetch");
      return ok();
    });
    mount();
    await advance(120);
    fireEvent.keyDown(window, { key: "a" });
    expect(calls("/api/auth/heartbeat")).toHaveLength(1);
    await advance(240); // backoff: several retries in 4 minutes, but bounded (no hammering)
    const retried = calls("/api/auth/heartbeat").length;
    expect(retried).toBeGreaterThan(2);
    expect(retried).toBeLessThan(12);
    failing = false;
    await advance(61); // the next retry is acknowledged ...
    const settled = calls("/api/auth/heartbeat").length;
    await advance(200); // ... and then nothing more is sent
    expect(calls("/api/auth/heartbeat")).toHaveLength(settled);
    expect(h.push).not.toHaveBeenCalled();
  });

  it("retries stop once the unacknowledged activity is older than the idle limit", async () => {
    h.fetch.mockImplementation(async (url: string) => (url === "/api/auth/heartbeat" ? unavailable() : ok()));
    mount({ idleMinutes: 5 });
    await advance(100);
    fireEvent.keyDown(window, { key: "a" });
    await advance(299); // just short of the client's own idle sign-out
    const beforeLimit = calls("/api/auth/heartbeat").length;
    expect(beforeLimit).toBeGreaterThan(1);
    await advance(120);
    expect(calls("/api/auth/heartbeat")).toHaveLength(beforeLimit);
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET); // the ordinary client idle sign-out
  });

  it("only an acknowledged heartbeat is published to the other tabs", async () => {
    let status = 503;
    h.fetch.mockImplementation(async (url: string) =>
      url === "/api/auth/heartbeat" ? (status === 503 ? unavailable() : ok()) : ok(),
    );
    mount();
    await advance(120);
    fireEvent.keyDown(window, { key: "a" });
    const activityAt = Date.now();
    await advance(1);
    expect(calls("/api/auth/heartbeat")).toHaveLength(1);
    expect(window.localStorage.getItem(HEARTBEAT_KEY)).toBeNull(); // attempted, not acknowledged
    status = 200;
    await advance(60);
    expect(Number(window.localStorage.getItem(HEARTBEAT_KEY))).toBeGreaterThanOrEqual(activityAt);
  });

  it("another tab's failed heartbeat does not suppress this tab's; its acknowledged one does", async () => {
    // Two tabs sharing one localStorage: tab A's beat gets a 503; tab B must still send its own (A's attempt
    // is not "server reached"); B's acknowledged beat then makes A's retry unnecessary.
    let n = 0;
    h.fetch.mockImplementation(async (url: string) => {
      if (url !== "/api/auth/heartbeat") return ok();
      n += 1;
      return n === 1 ? unavailable() : ok();
    });
    mount();
    mount();
    await advance(120);
    fireEvent.keyDown(window, { key: "a" }); // both tabs see activity
    await advance(1);
    expect(calls("/api/auth/heartbeat")).toHaveLength(2);
    await advance(120);
    expect(calls("/api/auth/heartbeat")).toHaveLength(2);
    expect(h.push).not.toHaveBeenCalled();
  });

  it("a trailing heartbeat is skipped when another tab already reached the server after the activity", async () => {
    mount();
    await advance(120);
    fireEvent.keyDown(window, { key: "a" }); // sent
    await advance(60);
    fireEvent.keyDown(window, { key: "b" }); // suppressed, trailing send pending
    await advance(10);
    act(() => window.localStorage.setItem("co_ops_last_heartbeat", String(Date.now()))); // another tab's heartbeat
    await advance(300);
    expect(calls("/api/auth/heartbeat")).toHaveLength(1);
  });

  it("a dead session on the heartbeat sends the operator to sign in", async () => {
    h.fetch.mockImplementation(async (url: string) => (url === "/api/auth/heartbeat" ? dead() : ok()));
    mount();
    await advance(121);
    fireEvent.keyDown(window, { key: "a" });
    await advance(1);
    expect(calls("/api/auth/heartbeat")).toHaveLength(1);
    expect(calls("/api/auth/logout")).toHaveLength(1);
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET);
  });

  it("Stay signed in on a dead session does not pretend to work", async () => {
    mount();
    await advance(571);
    expect(screen.getByRole("dialog")).toBeTruthy();
    h.fetch.mockImplementation(async (url: string) => (url === "/api/auth/heartbeat" ? dead() : ok()));
    fireEvent.click(screen.getByRole("button", { name: STAY }));
    await advance(1);
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET);
  });

  it("Stay signed in on a live session closes the warning and resets the clock", async () => {
    mount();
    await advance(571);
    fireEvent.click(screen.getByRole("button", { name: STAY }));
    await advance(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    await advance(500);
    expect(h.push).not.toHaveBeenCalled();
  });

  it("Stay signed in that only reaches a 503 closes the warning but keeps retrying until acknowledged", async () => {
    mount();
    await advance(571);
    h.fetch.mockImplementation(async (url: string) => (url === "/api/auth/heartbeat" ? unavailable() : ok()));
    fireEvent.click(screen.getByRole("button", { name: STAY }));
    await advance(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(HEARTBEAT_KEY)).toBeNull(); // not "server reached"
    const afterClick = calls("/api/auth/heartbeat").length;
    h.fetch.mockImplementation(async () => ok());
    await advance(10);
    expect(calls("/api/auth/heartbeat").length).toBeGreaterThan(afterClick);
    expect(window.localStorage.getItem(HEARTBEAT_KEY)).not.toBeNull();
    expect(h.push).not.toHaveBeenCalled();
  });

  it("uses the server's idle minutes", async () => {
    mount({ idleMinutes: 5 });
    await advance(269);
    expect(screen.queryByRole("dialog")).toBeNull();
    await advance(2);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await advance(30);
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET);
  });
});

describe("B153 — one idle clock across tabs", () => {
  it("activity in another tab keeps this tab signed in", async () => {
    mount();
    await advance(540);
    await otherTab(ACTIVITY_KEY, String(Date.now()));
    await advance(70);
    expect(h.push).not.toHaveBeenCalled();
    expect(calls("/api/auth/logout")).toHaveLength(0);
  });

  it("another tab's activity closes an open warning", async () => {
    mount();
    await advance(575);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await otherTab(ACTIVITY_KEY, String(Date.now()));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("another tab's activity counts even without the storage event (read at the tick)", async () => {
    mount();
    await advance(590);
    act(() => window.localStorage.setItem(ACTIVITY_KEY, String(Date.now())));
    await advance(20);
    expect(h.push).not.toHaveBeenCalled();
  });

  it("another tab signing out sends this tab to the login page without a second logout", async () => {
    mount();
    await advance(30);
    await otherTab(SIGNED_OUT_KEY, `${Date.now()}:idle`);
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET);
    expect(calls("/api/auth/logout")).toHaveLength(0);
  });

  it("another tab's manual log out goes to the plain login page", async () => {
    mount();
    await otherTab(SIGNED_OUT_KEY, `${Date.now()}:logout`);
    expect(h.push).toHaveBeenCalledWith("/");
  });

  it("this tab's idle sign-out tells the other tabs", async () => {
    mount();
    await advance(600);
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:idle:session-1$/);
  });

  it("blocked storage falls back to the per-tab clock", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    mount();
    await advance(600);
    expect(calls("/api/auth/logout")).toHaveLength(1);
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET);
  });
});

// ── Fix round 4 (review W06-r4) ────────────────────────────────────────────────────────────────────────────
const LOGOUT_NOW = (en as Record<string, string>)["auth.idle.logout_now"]!;
const ACTIVITY_EVENT_TYPES = ["mousedown", "keydown", "touchstart", "scroll"];
/** Two tabs in one jsdom window: every localStorage write also fires the `storage` event the other tab would see. */
const linkTabs = () => {
  const realSet = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
    realSet.call(this, key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  });
};
/** Mount a tab. `input: false` = a background tab: this window's keyboard / mouse / scroll input never reaches it. */
const mountTab = (tab: string, opts: { input?: boolean } = {}) => {
  h.tab = tab;
  if (opts.input !== false) return mount();
  const realAdd = window.addEventListener.bind(window);
  const spy = vi.spyOn(window, "addEventListener").mockImplementation(((type: string, fn: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => {
    if (ACTIVITY_EVENT_TYPES.includes(type)) return;
    realAdd(type, fn, o);
  }) as typeof window.addEventListener);
  try {
    return mount();
  } finally {
    spy.mockRestore();
  }
};
/** POST /api/auth/logout hangs until settle(); every other request answers 200 (or `other`). */
const deferLogout = (other: (url: string) => Response = () => ok()) => {
  const pending: Array<() => void> = [];
  h.fetch.mockImplementation((url: string) =>
    url === "/api/auth/logout"
      ? new Promise<Response>((resolve) => pending.push(() => resolve(ok())))
      : Promise.resolve(other(url)),
  );
  return {
    pending: () => pending.length,
    settle: () =>
      act(async () => {
        for (const resolve of pending.splice(0)) resolve();
        await vi.advanceTimersByTimeAsync(0);
      }),
  };
};
const pushedTabs = () => h.pushes.map(([tab]) => tab).sort();

describe("B012 / B153 round 4 — other tabs leave only after the logout request settles", () => {
  it("an idle sign-out: neither tab navigates while logout is pending; both navigate after", async () => {
    linkTabs();
    const logout = deferLogout();
    mountTab("A");
    mountTab("B");
    // Round 8: the deferred logout settles INSIDE its 5 s attempt deadline (a real fetch is aborted there; the deadline
    // now holds even for this mock, which ignores its signal).
    await advance(603);
    expect(logout.pending()).toBeGreaterThanOrEqual(1);
    expect(h.push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toBeNull(); // not published yet
    await logout.settle();
    expect(pushedTabs()).toEqual(["A", "B"]);
    expect(h.pushes.every(([, url]) => url === IDLE_TARGET)).toBe(true);
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:idle:session-1$/);
  });

  it("a dead-session sign-out in one tab: the other tab waits for the logout, then follows without a second logout", async () => {
    linkTabs();
    let beats = 0;
    const logout = deferLogout((url) => {
      if (url !== "/api/auth/heartbeat") return ok();
      beats += 1;
      return beats === 1 ? dead() : ok(); // only the first tab's heartbeat meets the dead session
    });
    mountTab("A");
    mountTab("B");
    await advance(121);
    fireEvent.keyDown(window, { key: "a" });
    // Round 8: the deferred logout settles INSIDE its 5 s attempt deadline (a real fetch is aborted there; the deadline
    // now holds even for this mock, which ignores its signal).
    await advance(3);
    expect(calls("/api/auth/logout")).toHaveLength(1);
    expect(h.push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toBeNull();
    await logout.settle();
    expect(pushedTabs()).toEqual(["A", "B"]);
    expect(calls("/api/auth/logout")).toHaveLength(1);
  });

  it("Log out now: the other tab goes to the login page only after the logout request settles", async () => {
    linkTabs();
    const logout = deferLogout();
    mountTab("A");
    mountTab("B");
    await advance(575);
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: LOGOUT_NOW })[0]!);
    await advance(3);
    expect(calls("/api/auth/logout")).toHaveLength(1);
    expect(h.push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toBeNull();
    await logout.settle();
    expect(pushedTabs()).toEqual(["A", "B"]);
    expect(h.pushes.every(([, url]) => url === "/")).toBe(true);
    expect(calls("/api/auth/logout")).toHaveLength(1);
  });

  it("Log out now still navigates when the logout request fails, and tells the other tabs then", async () => {
    linkTabs();
    mountTab("A");
    mountTab("B");
    await advance(575);
    h.fetch.mockImplementation(async (url: string) => {
      if (url === "/api/auth/logout") throw new TypeError("Failed to fetch");
      return ok();
    });
    fireEvent.click(screen.getAllByRole("button", { name: LOGOUT_NOW })[0]!);
    // Round 6: a failed end is retried briefly first (bounded), then the tabs leave anyway.
    await advance(4);
    expect(pushedTabs()).toEqual(["A", "B"]);
    expect(calls("/api/auth/logout")).toHaveLength(4);
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:logout:session-1$/);
  });
});

describe("B153 round 4 — the throttled shared activity clock keeps the latest activity", () => {
  it("activity at 0:00 and 0:04: a background tab does not sign out before 10:04", async () => {
    linkTabs();
    mountTab("B", { input: false }); // its own clock only learns of activity through storage
    mountTab("A");
    fireEvent.keyDown(window, { key: "a" }); // 0:00
    await advance(4);
    fireEvent.keyDown(window, { key: "b" }); // 0:04 — inside the 5 s storage throttle
    await advance(599); // 10:03
    expect(calls("/api/auth/logout")).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
    expect(screen.getAllByRole("dialog")).toHaveLength(2); // both tabs show the same countdown
    await advance(2); // 10:05
    expect(calls("/api/auth/logout").length).toBeGreaterThanOrEqual(1);
    expect(pushedTabs()).toEqual(["A", "B"]);
  });

  it("one trailing write carries the latest suppressed activity; nothing new = no write", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    const activityWrites = () => set.mock.calls.filter((c) => c[0] === ACTIVITY_KEY).map((c) => Number(c[1]));
    mount();
    const t0 = Date.now();
    expect(activityWrites()).toEqual([t0]); // the mount stamp
    fireEvent.keyDown(window, { key: "a" }); // same instant as the stamp: nothing new
    await advance(30);
    expect(activityWrites()).toEqual([t0]);
    fireEvent.keyDown(window, { key: "b" }); // 0:30 — throttle open: written at once
    await advance(1);
    fireEvent.keyDown(window, { key: "c" }); // 0:31 — suppressed
    await advance(1);
    fireEvent.keyDown(window, { key: "d" }); // 0:32 — suppressed; the latest
    expect(activityWrites()).toEqual([t0, t0 + 30_000]);
    await advance(3); // 0:35 — the trailing write
    expect(activityWrites()).toEqual([t0, t0 + 30_000, t0 + 32_000]);
    await advance(60);
    expect(activityWrites()).toHaveLength(3); // one write, no repeats
  });

  it("the trailing activity write is cancelled on unmount", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    const activityWrites = () => set.mock.calls.filter((c) => c[0] === ACTIVITY_KEY);
    const view = mount();
    await advance(30);
    fireEvent.keyDown(window, { key: "a" }); // written
    await advance(1);
    fireEvent.keyDown(window, { key: "b" }); // suppressed
    expect(activityWrites()).toHaveLength(2);
    view.unmount();
    await advance(10);
    expect(activityWrites()).toHaveLength(2);
  });
});

// ── Fix round 5 (review W06-r5) ────────────────────────────────────────────────────────────────────────────
/** POST /api/auth/logout hangs; each pending response is settled ON ITS OWN (the r4 helper settled all at once). */
const deferLogoutEach = () => {
  const pending: Array<() => void> = [];
  h.fetch.mockImplementation((url: string) =>
    url === "/api/auth/logout" ? new Promise<Response>((resolve) => pending.push(() => resolve(ok()))) : Promise.resolve(ok()),
  );
  return {
    pending: () => pending.length,
    settleNext: () =>
      act(async () => {
        pending.shift()?.();
        await vi.advanceTimersByTimeAsync(0);
      }),
  };
};
const logoutBody = (i = 0) => {
  const init = calls("/api/auth/logout")[i]?.[1] as RequestInit | undefined;
  return init?.body ? JSON.parse(String(init.body)) : null;
};

describe("B012 round 5 — a sign-out names the session it ends", () => {
  it("the idle sign-out sends the session it observed, and signals it to the other tabs", async () => {
    h.session = "session-1";
    mount();
    await advance(605);
    expect(logoutBody()).toEqual({ sessionId: "session-1" });
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:idle:session-1$/);
  });

  it("Log out now sends it too", async () => {
    h.session = "session-1";
    mount();
    await advance(575);
    fireEvent.click(screen.getByRole("button", { name: LOGOUT_NOW }));
    await advance(1);
    expect(logoutBody()).toEqual({ sessionId: "session-1" });
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:logout:session-1$/);
  });

  it("two tabs at the deadline, logouts settled SEPARATELY around a new sign-in: the new session's tab stays", async () => {
    linkTabs();
    h.session = "session-1";
    const logout = deferLogoutEach();
    mountTab("A");
    mountTab("B");
    // Round 8: the deferred logout settles INSIDE its 5 s attempt deadline (a real fetch is aborted there; the deadline
    // now holds even for this mock, which ignores its signal).
    await advance(603);
    expect(logout.pending()).toBe(2); // both tabs reached the deadline together
    expect([logoutBody(0), logoutBody(1)]).toEqual([{ sessionId: "session-1" }, { sessionId: "session-1" }]);
    await logout.settleNext(); // the first settles; that tab goes to the login page
    expect(h.pushes).toHaveLength(1);
    h.session = "session-2"; // someone signs in there: a new page with the NEW session
    mountTab("C");
    await logout.settleNext(); // the other tab's late logout lands only now
    expect(pushedTabs()).toEqual(["A", "B"]);
    expect(h.pushes.some(([tab]) => tab === "C")).toBe(false); // its signal was for session-1, not this one
    await advance(5);
    expect(h.pushes.some(([tab]) => tab === "C")).toBe(false);
    expect(calls("/api/auth/logout")).toHaveLength(2); // and C sent no logout of its own
  });

  it("a signal for this tab's own session (or an older signal naming none) still signs it out", async () => {
    h.session = "session-1";
    mount();
    await otherTab(SIGNED_OUT_KEY, `${Date.now()}:idle:session-1`);
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET);
    cleanup();
    h.push.mockClear();
    mount();
    await otherTab(SIGNED_OUT_KEY, `${Date.now() + 1}:logout`);
    expect(h.push).toHaveBeenCalledWith("/");
  });

  it("round 7: there is no unnamed sign-out — the request and the signal always carry the served session", async () => {
    h.session = "session-7";
    mount();
    await advance(605);
    expect(logoutBody()).toEqual({ sessionId: "session-7" });
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:idle:session-7$/);
  });
});

// ── Fix round 6 (review W06-r6 P1) ─────────────────────────────────────────────────────────────────────────────────
// A 503 logout_unconfirmed (or a network failure) is not a finished sign-out: the tab retries it briefly behind an
// opaque cover, never shows the authenticated screen again, still goes to the login page, and tells the other tabs
// only once the sign-out has settled.
const OVERLAY = "signing-out-overlay";
const unconfirmed = () =>
  ({ ok: false, status: 503, type: "basic", json: async () => ({ code: "logout_unconfirmed", sessionId: "session-1" }) }) as unknown as Response;

describe("B012 round 6 — an unconfirmed idle sign-out is retried, covered, and still leaves", () => {
  it("503 then 200: retried; covered meanwhile; no navigation or signal until it settles", async () => {
    linkTabs();
    h.session = "session-1";
    let n = 0;
    h.fetch.mockImplementation(async (url: string) => (url === "/api/auth/logout" && n++ === 0 ? unconfirmed() : ok()));
    mountTab("A");
    await advance(600);
    await advance(0.1); // the first logout answered 503
    expect(calls("/api/auth/logout")).toHaveLength(1);
    expect(screen.getByTestId(OVERLAY)).toBeTruthy(); // nothing authenticated is shown
    // The warning is gone; the only dialog left is the cover itself (a <dialog> since round 11).
    expect(screen.queryAllByRole("dialog").filter((d) => d.getAttribute("data-testid") !== OVERLAY)).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toBeNull();
    await advance(1); // the retry (named) is acknowledged
    expect(calls("/api/auth/logout")).toHaveLength(2);
    for (const c of calls("/api/auth/logout")) expect((c[1] as RequestInit).body).toBe(JSON.stringify({ sessionId: "session-1" }));
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET);
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:idle:session-1$/);
  });

  it("503 every time: bounded retries, then the login page anyway, and the other tabs follow", async () => {
    linkTabs();
    h.fetch.mockImplementation(async (url: string) => (url === "/api/auth/logout" ? unconfirmed() : ok()));
    mountTab("A");
    mountTab("B");
    await advance(601);
    expect(h.push).not.toHaveBeenCalled();
    await advance(5);
    expect(calls("/api/auth/logout").length).toBeLessThanOrEqual(8); // two tabs reached the deadline, 4 tries each at most
    expect(pushedTabs()).toEqual(["A", "B"]);
    expect(h.pushes.every(([, url]) => url === IDLE_TARGET)).toBe(true);
  });

  it("Log out now with a 503: covered, retried, then the login page", async () => {
    let n = 0;
    h.fetch.mockImplementation(async (url: string) => (url === "/api/auth/logout" && n++ === 0 ? unconfirmed() : ok()));
    mount();
    await advance(575);
    fireEvent.click(screen.getByRole("button", { name: LOGOUT_NOW }));
    await advance(0.1);
    expect(screen.getByTestId(OVERLAY)).toBeTruthy();
    expect(h.push).not.toHaveBeenCalled();
    await advance(1);
    expect(calls("/api/auth/logout")).toHaveLength(2);
    expect(h.push).toHaveBeenCalledWith("/");
  });
});

// ── Fix round 8 (review W06-r8 P2) — a stalled heartbeat can never hold the keep-alive ──────────────────────────────
// The heartbeat fetch had no deadline, and heartbeatInFlightRef blocked every later attempt until it settled. A request
// that stalled before reaching the server left the operator typing against a server clock nobody refreshed: after the
// server's idle limit the next save was a 401 and the draft was lost. Each heartbeat now has its own deadline
// (HEARTBEAT_TIMEOUT_MS, well below the idle window); a timeout aborts it, releases the guard, keeps the activity
// pending and goes to the existing backoff. The decision reads the status alone, and the request is aborted once
// decided.
const HEARTBEAT_TIMEOUT_S = 10;

/** A request that never gets headers; it rejects only when its signal aborts (what a real fetch does). */
const pendingUntilAbort = (init: RequestInit | undefined) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });

describe("B013 round 8 — a stalled heartbeat is bounded", () => {
  for (const variant of ["honours its abort signal", "ignores its abort signal entirely"] as const) {
    it(`first heartbeat stays pending (${variant}), connectivity recovers, a retry refreshes the server before expiry`, async () => {
      const IDLE_MS = 600_000;
      let serverLastActivity = Date.now(); // the page load reached the server
      let stalled = true;
      const signals: AbortSignal[] = [];
      h.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url !== "/api/auth/heartbeat") return ok();
        if (init?.signal) signals.push(init.signal);
        if (stalled) {
          stalled = false; // only the first request is lost; connectivity is back for the next one
          return variant === "honours its abort signal" ? pendingUntilAbort(init) : new Promise<Response>(() => {});
        }
        if (Date.now() - serverLastActivity >= IDLE_MS) return dead();
        serverLastActivity = Date.now();
        return ok();
      });
      mount();
      await advance(120); // 2:00 — the first heartbeat goes out and stalls
      fireEvent.keyDown(window, { key: "a" });
      expect(calls("/api/auth/heartbeat")).toHaveLength(1);
      // Steady typing through 12:00 — past the server's idle limit measured from the page load.
      for (let s = 120; s < 720; s += 20) {
        await advance(20);
        fireEvent.keyDown(window, { key: "b" });
      }
      expect(calls("/api/auth/heartbeat").length).toBeGreaterThan(1); // the stalled one no longer blocks the next
      expect(serverLastActivity).toBeGreaterThan(0);
      expect(Date.now() - serverLastActivity).toBeLessThan(IDLE_MS); // the server clock is current
      expect(signals[0]!.aborted).toBe(true); // the stalled request was abandoned at its deadline
      expect(calls("/api/auth/logout")).toHaveLength(0);
      expect(h.push).not.toHaveBeenCalled();
    });
  }

  it("the stalled heartbeat is released at its deadline and retried on the backoff, not before", async () => {
    let n = 0;
    h.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url !== "/api/auth/heartbeat") return ok();
      n += 1;
      return n === 1 ? pendingUntilAbort(init) : ok();
    });
    mount();
    await advance(120);
    fireEvent.keyDown(window, { key: "a" });
    await advance(HEARTBEAT_TIMEOUT_S - 1);
    fireEvent.keyDown(window, { key: "b" }); // still in flight: no second request
    expect(calls("/api/auth/heartbeat")).toHaveLength(1);
    expect(window.localStorage.getItem(HEARTBEAT_KEY)).toBeNull();
    await advance(1); // the deadline: aborted, unacknowledged, first backoff (5 s) starts
    expect(calls("/api/auth/heartbeat")).toHaveLength(1);
    await advance(5);
    expect(calls("/api/auth/heartbeat")).toHaveLength(2); // the retry carries the pending activity
    expect(window.localStorage.getItem(HEARTBEAT_KEY)).not.toBeNull(); // acknowledged
    expect(h.push).not.toHaveBeenCalled();
  });

  it("Stay signed in whose heartbeat stalls: released at the deadline, the warning closes, the retry is acknowledged", async () => {
    mount();
    await advance(571);
    let n = 0;
    h.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url !== "/api/auth/heartbeat") return ok();
      n += 1;
      return n === 1 ? pendingUntilAbort(init) : ok();
    });
    fireEvent.click(screen.getByRole("button", { name: STAY }));
    await advance(HEARTBEAT_TIMEOUT_S);
    expect(screen.queryByRole("dialog")).toBeNull();
    await advance(10);
    expect(calls("/api/auth/heartbeat").length).toBeGreaterThanOrEqual(2);
    expect(window.localStorage.getItem(HEARTBEAT_KEY)).not.toBeNull();
    await advance(400);
    expect(h.push).not.toHaveBeenCalled();
    expect(calls("/api/auth/logout")).toHaveLength(0);
  });

  it("a heartbeat whose body stalls is decided by its status at once, and its request is aborted", async () => {
    const signals: AbortSignal[] = [];
    const json = vi.fn(() => new Promise<never>(() => {}));
    h.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url !== "/api/auth/heartbeat") return ok();
      signals.push(init!.signal!);
      return { ok: true, status: 200, type: "basic", json } as unknown as Response;
    });
    mount();
    await advance(120);
    fireEvent.keyDown(window, { key: "a" });
    await advance(0.1);
    expect(window.localStorage.getItem(HEARTBEAT_KEY)).not.toBeNull();
    expect(json).not.toHaveBeenCalled();
    expect(signals[0]!.aborted).toBe(true);
  });

  it("a Stay signed in heartbeat that settles after the idle sign-out started changes nothing", async () => {
    mount();
    await advance(595);
    let release: (r: Response) => void = () => {};
    h.fetch.mockImplementation(async (url: string) =>
      url === "/api/auth/heartbeat" ? new Promise<Response>((r) => (release = r)) : ok(),
    );
    fireEvent.click(screen.getByRole("button", { name: STAY }));
    await advance(6); // 10:01 — the client's idle limit passed while the click's heartbeat was in flight
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET);
    const activityBefore = window.localStorage.getItem(ACTIVITY_KEY);
    await act(async () => release(ok()));
    await advance(1);
    expect(window.localStorage.getItem(ACTIVITY_KEY)).toBe(activityBefore); // no activity published after the end
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET);
  });
});

// ── Fix round 10 (review W06-r10, two P2s) ────────────────────────────────────────────────────────────────────────────
// (1) A tab told by another tab that the session ended went to the login page but never covered itself: while that
//     navigation was slow (or offline) the authenticated screen stayed readable and operable. It now raises the opaque
//     cover BEFORE navigating, and still sends no logout of its own.
// (2) The cover sat at z-[60], under PasswordModal's z-[1100], and left everything beneath it focusable. It is now the
//     last child of <body>, above every dialog, the rest of the page is inert while it shows, focus moves into it, and
//     no click / submit / key beneath reaches the app.
describe("B012 round 10 — the sign-out cover covers every tab and every dialog", () => {
  it("a receiving tab whose navigation never completes is covered at once and sends no logout", async () => {
    h.session = "session-1";
    mount();
    expect(screen.queryByTestId(OVERLAY)).toBeNull();
    await otherTab(SIGNED_OUT_KEY, `${Date.now()}:idle:session-1`);
    expect(h.push).toHaveBeenCalledWith(IDLE_TARGET); // the (mock) navigation never completes
    expect(screen.getByTestId(OVERLAY)).toBeTruthy(); // covered meanwhile
    await advance(700); // long past the idle limit: the cover stays, nothing else happens
    expect(screen.getByTestId(OVERLAY)).toBeTruthy();
    expect(calls("/api/auth/logout")).toHaveLength(0);
    expect(h.push).toHaveBeenCalledTimes(1);
  });

  it("an explicit Log out signal from another tab covers this tab as well", async () => {
    mount();
    await otherTab(SIGNED_OUT_KEY, `${Date.now()}:logout:session-1`);
    expect(h.push).toHaveBeenCalledWith("/");
    expect(screen.getByTestId(OVERLAY)).toBeTruthy();
    expect(calls("/api/auth/logout")).toHaveLength(0);
  });

  it("a signal for another session raises no cover", async () => {
    mount();
    await otherTab(SIGNED_OUT_KEY, `${Date.now()}:idle:session-other`);
    expect(screen.queryByTestId(OVERLAY)).toBeNull();
    expect(h.push).not.toHaveBeenCalled();
  });

  it("with the password dialog open during a deferred logout: the cover is above it, the app is inert, focus is in the cover, nothing beneath submits", async () => {
    const { PasswordModal } = await import("@/components/auth/PasswordModal");
    h.fetch.mockImplementation(async (url: string) =>
      url === "/api/auth/logout" ? new Promise<Response>(() => {}) : ok(),
    );
    const onConfirm = vi.fn();
    const { container } = render(jsx(TranslationProvider, {
      initialLanguage: "en",
      children: [
        jsx(PasswordModal, { key: "pw", open: true, onConfirm, onCancel: () => {} }),
        jsx(IdleTimeoutWarning, { key: "idle", userId: "user-1", sessionId: h.session }),
      ],
    }));
    const input = container.querySelector<HTMLInputElement>("#step-up-password")!;
    await advance(0.1);
    fireEvent.change(input, { target: { value: "hunter22" } });
    input.focus();
    await advance(600); // the idle limit: the logout is sent and never answers
    await advance(0.1);
    expect(calls("/api/auth/logout")).toHaveLength(1);
    const overlay = screen.getByTestId(OVERLAY);
    // Above every dialog: the last child of <body>, with a z-index over PasswordModal's 1100.
    expect(overlay.parentElement).toBe(document.body);
    expect(document.body.lastElementChild).toBe(overlay);
    const z = (cls: string) => Number(/z-\[(\d+)\]/.exec(cls)?.[1] ?? "0");
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(z(dialog.className)).toBe(1100);
    expect(z(overlay.className)).toBeGreaterThan(1100);
    // The app underneath is inert; the cover is not; focus moved into the cover.
    expect(container.hasAttribute("inert")).toBe(true);
    expect(overlay.hasAttribute("inert")).toBe(false);
    expect(overlay.contains(document.activeElement)).toBe(true);
    // Focus cannot go back beneath it.
    input.focus();
    expect(overlay.contains(document.activeElement)).toBe(true);
    // Enter (implicit submission = a submit event) and space (= a click on the button) beneath reach nothing.
    const confirmBtn = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false); // default prevented
    expect(fireEvent.keyDown(confirmBtn, { key: " " })).toBe(false);
    fireEvent.keyUp(confirmBtn, { key: " " });
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.click(confirmBtn);
    await advance(1);
    expect(calls("/api/auth/step-up")).toHaveLength(0);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("the cover gives the page back when it goes (nothing it did not set stays inert)", async () => {
    const { SigningOutOverlay } = await import("@/components/auth/SigningOutOverlay");
    const already = document.createElement("div");
    already.setAttribute("inert", "");
    document.body.appendChild(already);
    const { container, unmount } = render(jsx(TranslationProvider, {
      initialLanguage: "en",
      children: jsx(SigningOutOverlay, {}),
    }));
    expect(document.body.lastElementChild?.getAttribute("data-testid")).toBe(OVERLAY);
    const late = document.createElement("div");
    document.body.appendChild(late); // a portal mounted after the cover is inert too
    await act(async () => {});
    expect(container.hasAttribute("inert")).toBe(true);
    expect(late.hasAttribute("inert")).toBe(true);
    unmount();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(late.hasAttribute("inert")).toBe(false);
    expect(already.hasAttribute("inert")).toBe(true); // set by someone else: left alone
    already.remove();
    late.remove();
  });

  it("two covers at once: the page stays inert until the last one goes", async () => {
    const { SigningOutOverlay } = await import("@/components/auth/SigningOutOverlay");
    const app = document.createElement("div");
    document.body.appendChild(app);
    const one = render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(SigningOutOverlay, {}) }));
    const two = render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(SigningOutOverlay, {}) }));
    await act(async () => {});
    expect(app.hasAttribute("inert")).toBe(true);
    for (const cover of screen.getAllByTestId(OVERLAY)) expect(cover.hasAttribute("inert")).toBe(false);
    one.unmount();
    expect(app.hasAttribute("inert")).toBe(true);
    two.unmount();
    expect(app.hasAttribute("inert")).toBe(false);
    app.remove();
  });
});

// ── Fix round 11 (review W06-r11, P2) ─────────────────────────────────────────────────────────────────────────────────
// A native <dialog> opened with showModal() (the dashboard's assignment-change dialog, ShiftBoardClient) sits in the
// browser's TOP LAYER, above any z-index, and escapes ancestor `inert`, so it stayed readable and typeable above the
// cover. Now, when the cover shows, every open native dialog is closed (and any opened while it shows), and the cover
// is itself a <dialog> opened with showModal(), so it is the topmost thing in the top layer. Where showModal() is
// missing (jsdom; very old engines) the round-10 fallback (last child of <body>, z-index, inert, focus, capture shield)
// still holds.
//
// jsdom has no top layer, so these tests give HTMLDialogElement a minimal one (showModal / close / an ordered list, the
// way browsers stack it: the most recent showModal() is on top).
describe("B012 round 11 — native modal dialogs cannot stay above the sign-out cover", () => {
  let topLayer: HTMLDialogElement[] = [];
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  const installTopLayer = () => {
    topLayer = [];
    proto.showModal = function (this: HTMLDialogElement) {
      if (this.hasAttribute("open")) throw new DOMException("already open", "InvalidStateError");
      this.setAttribute("open", "");
      topLayer.push(this);
    };
    proto.close = function (this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      topLayer = topLayer.filter((d) => d !== this);
      this.dispatchEvent(new Event("close"));
    };
  };
  afterEach(() => {
    delete proto.showModal;
    delete proto.close;
    topLayer = [];
  });

  // The assignment-change dialog's shape: a <dialog> shown with showModal() from an effect, a note field, a submit.
  function ReasonDialog(props: { onInput: () => void; onSubmit: () => void }) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
      ref.current?.showModal();
    }, []);
    return jsx("dialog", {
      ref,
      "data-testid": "reason-dialog",
      "aria-label": "Confirm change",
      children: jsx("form", {
        onSubmit: (e: Event) => { e.preventDefault(); props.onSubmit(); },
        children: [
          jsx("textarea", { key: "note", name: "reasonNote", onInput: props.onInput, onKeyDown: props.onInput }),
          jsx("button", { key: "go", type: "submit", children: "Confirm change" }),
        ],
      }),
    });
  }

  it("a showModal() dialog open during a deferred idle logout is closed, the cover is the top modal, and the dialog takes no input", async () => {
    installTopLayer();
    h.fetch.mockImplementation(async (url: string) =>
      url === "/api/auth/logout" ? new Promise<Response>(() => {}) : ok(),
    );
    const onInput = vi.fn();
    const onSubmit = vi.fn();
    render(jsx(TranslationProvider, {
      initialLanguage: "en",
      children: [
        jsx(ReasonDialog, { key: "reason", onInput, onSubmit }),
        jsx(IdleTimeoutWarning, { key: "idle", userId: "user-1", sessionId: h.session }),
      ],
    }));
    const reason = screen.getByTestId("reason-dialog") as HTMLDialogElement;
    expect(topLayer).toEqual([reason]);
    await advance(600); // the idle limit: the logout is sent and never answers
    await advance(0.1);
    expect(calls("/api/auth/logout")).toHaveLength(1);
    const overlay = screen.getByTestId(OVERLAY);
    // The native dialog is closed and gone from the top layer; the cover is a modal <dialog> and the only one there.
    expect(reason.hasAttribute("open")).toBe(false);
    expect(overlay.tagName).toBe("DIALOG");
    expect(overlay.hasAttribute("open")).toBe(true);
    expect(topLayer).toEqual([overlay]);
    expect(overlay.contains(document.activeElement)).toBe(true);
    // The dialog's controls take nothing: typing, Enter, a click on its submit, a submit event.
    const note = reason.querySelector("textarea")!;
    const submit = reason.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    note.focus();
    expect(overlay.contains(document.activeElement)).toBe(true);
    expect(fireEvent.keyDown(note, { key: "a" })).toBe(false);
    fireEvent.input(note, { target: { value: "a" } });
    expect(fireEvent.keyDown(note, { key: "Enter" })).toBe(false);
    fireEvent.click(submit);
    fireEvent.submit(reason.querySelector("form")!);
    await advance(1);
    expect(onInput).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a dialog opened with showModal() WHILE the cover shows is closed again, and the cover stays on top", async () => {
    installTopLayer();
    const { SigningOutOverlay } = await import("@/components/auth/SigningOutOverlay");
    const late = document.createElement("dialog");
    document.body.appendChild(late);
    render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(SigningOutOverlay, {}) }));
    const overlay = screen.getByTestId(OVERLAY);
    expect(topLayer).toEqual([overlay]);
    late.showModal(); // e.g. a component's effect re-opening its dialog during the logout retries
    await act(async () => {});
    expect(late.hasAttribute("open")).toBe(false);
    expect(topLayer).toEqual([overlay]);
    late.remove();
  });

  it("Escape / a cancel request does not close the cover; if it is closed anyway it comes straight back", async () => {
    installTopLayer();
    const { SigningOutOverlay } = await import("@/components/auth/SigningOutOverlay");
    render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(SigningOutOverlay, {}) }));
    const overlay = screen.getByTestId(OVERLAY) as HTMLDialogElement;
    expect(fireEvent.keyDown(overlay, { key: "Escape" })).toBe(false); // no close request
    expect(overlay.dispatchEvent(new Event("cancel", { cancelable: true }))).toBe(false);
    act(() => overlay.close());
    expect(overlay.hasAttribute("open")).toBe(true);
    expect(topLayer).toEqual([overlay]);
  });

  it("two covers at once do not close each other", async () => {
    installTopLayer();
    const { SigningOutOverlay } = await import("@/components/auth/SigningOutOverlay");
    render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(SigningOutOverlay, {}) }));
    render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(SigningOutOverlay, {}) }));
    await act(async () => {});
    const covers = screen.getAllByTestId(OVERLAY);
    expect(covers).toHaveLength(2);
    for (const cover of covers) expect(cover.hasAttribute("open")).toBe(true);
  });

  it("jsdom fallback (no showModal): open dialogs are still closed, and the cover is open, last in <body>, focused, the page inert", async () => {
    expect(typeof (HTMLDialogElement.prototype as { showModal?: unknown }).showModal).toBe("undefined");
    const { SigningOutOverlay } = await import("@/components/auth/SigningOutOverlay");
    const app = document.createElement("div");
    const open = document.createElement("dialog");
    open.setAttribute("open", "");
    app.appendChild(open);
    document.body.appendChild(app);
    const { unmount } = render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(SigningOutOverlay, {}) }));
    const overlay = screen.getByTestId(OVERLAY);
    expect(open.hasAttribute("open")).toBe(false);
    expect(overlay.hasAttribute("open")).toBe(true);
    expect(document.body.lastElementChild).toBe(overlay);
    expect(overlay.contains(document.activeElement)).toBe(true);
    expect(app.hasAttribute("inert")).toBe(true);
    unmount();
    expect(app.hasAttribute("inert")).toBe(false);
    app.remove();
  });
});
