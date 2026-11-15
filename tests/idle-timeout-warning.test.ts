// @vitest-environment jsdom
/**
 * Audit W06 — the idle sign-out (components/auth/IdleTimeoutWarning.tsx).
 *  B012: the idle expiry REVOKES the session (POST /api/auth/logout) before going to the login page, exactly once.
 *  B013: steady typing keeps the server session alive (throttled heartbeat); a dead session on the heartbeat, or on
 *        "Stay signed in", signs out instead of pretending; the idle limit is the server's.
 *  B153: one idle clock across tabs (localStorage + the storage event); blocked storage keeps the per-tab clock.
 *  Round 4: other tabs are told of a sign-out only after its logout request settles.
 *  W06-2: the idle sign-in link carries a return link bound to this user.
 */
import { act } from "react";
import { jsx } from "react/jsx-runtime";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";

const h = vi.hoisted(() => ({ push: vi.fn(), fetch: vi.fn(), tab: "A", pushes: [] as Array<[string, string]> }));
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
  render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(IdleTimeoutWarning, { userId: "user-1", ...props }) }));
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
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:idle$/);
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
    await advance(605);
    expect(logout.pending()).toBeGreaterThanOrEqual(1);
    expect(h.push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toBeNull(); // not published yet
    await logout.settle();
    expect(pushedTabs()).toEqual(["A", "B"]);
    expect(h.pushes.every(([, url]) => url === IDLE_TARGET)).toBe(true);
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:idle$/);
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
    await advance(5);
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
    await advance(1);
    expect(pushedTabs()).toEqual(["A", "B"]);
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:logout$/);
  });
});
