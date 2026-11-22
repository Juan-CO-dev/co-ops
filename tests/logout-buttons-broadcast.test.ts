// @vitest-environment jsdom
/**
 * Audit W06/B012 fix round 9 (review W06-r9 P2) — EVERY sign-out surface tells the other tabs.
 *
 * The idle sign-out and the warning's "Log out now" published the session-qualified `co_ops_signed_out` signal once
 * their logout request settled; the ordinary Log out buttons (components/auth/LogoutButton.tsx and Go to's Me controls'
 * Sign out) did not. A second tab of the same session kept the signed-out person's page on screen, and once someone
 * else signed in its heartbeat ran on THEIR cookie. Now every surface signs out through the one shared
 * signOutAndBroadcast (lib/logout-client.ts): the signal goes out only after the request settles, names the session
 * the page was served for, and keeps the idle / logout kind — so a tab of a NEWER session ignores it.
 */
import { act } from "react";
import { jsx } from "react/jsx-runtime";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { MeControls } from "@/components/nav/MeControls";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";

const h = vi.hoisted(() => ({ fetch: vi.fn(), tab: "A", pushes: [] as Array<[string, string]> }));
// One stable router per mounted component (like Next's), tagged with the tab it was mounted as.
vi.mock("next/navigation", async () => {
  const { useRef } = await import("react");
  return {
    useRouter: () => {
      const tab = useRef(h.tab);
      const router = useRef<{ push: (url: string) => void; refresh: () => void } | null>(null);
      if (router.current === null) {
        router.current = { push: (url: string) => void h.pushes.push([tab.current, url]), refresh: () => {} };
      }
      return router.current;
    },
    usePathname: () => "/operations/counts",
  };
});

const T = en as Record<string, string>;
const SIGNED_OUT_KEY = "co_ops_signed_out";
const ok = () => ({ ok: true, status: 200, type: "basic", json: async () => ({ ok: true }) }) as unknown as Response;
const logoutCalls = () => h.fetch.mock.calls.filter((c) => c[0] === "/api/auth/logout");
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const wrap = (child: unknown) => render(jsx(TranslationProvider, { initialLanguage: "en", children: child }));

/** Several tabs in one jsdom window: every localStorage write also fires the `storage` event the other tabs would see. */
const linkTabs = () => {
  const realSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
    realSet.call(this, key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  });
};
/** A second tab: its idle watcher is what hears the cross-tab sign-out signal. */
const mountWatcherTab = (tab: string, sessionId: string) => {
  h.tab = tab;
  return wrap(jsx(IdleTimeoutWarning, { userId: "user-1", sessionId }));
};
/** POST /api/auth/logout hangs until settle(); every other request answers 200. */
const deferLogout = () => {
  const pending: Array<() => void> = [];
  h.fetch.mockImplementation((url: string) =>
    url === "/api/auth/logout" ? new Promise<Response>((resolve) => pending.push(() => resolve(ok()))) : Promise.resolve(ok()),
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
const pushesFor = (tab: string) => h.pushes.filter(([t]) => t === tab).map(([, url]) => url);

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

const surfaces = [
  {
    name: "LogoutButton",
    mount: (sessionId: string) => {
      h.tab = "A";
      return wrap(jsx(LogoutButton, { sessionId }));
    },
    click: () => fireEvent.click(screen.getByRole("button", { name: T["auth.logout.label"]! })),
  },
  {
    name: "Go to's Me (MeControls) → Sign out",
    mount: (sessionId: string) => {
      h.tab = "A";
      return wrap(jsx(MeControls, { userName: "GM", userEmail: null, actorLevel: 7, initialBlurb: null, sessionId }));
    },
    click: () => {
      fireEvent.click(screen.getByRole("button", { name: T["user_menu.sign_out"]! }));
    },
  },
];

describe.each(surfaces)("round 9 — $name tells the other tabs", ({ mount, click }) => {
  it("a second tab of the same session goes to the login page — only once the logout request has settled", async () => {
    linkTabs();
    const logout = deferLogout();
    mountWatcherTab("B", "session-1");
    mount("session-1");
    click();
    await advance(10);
    expect(logoutCalls()).toHaveLength(1);
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toBeNull(); // not published while the request is in flight
    expect(h.pushes).toEqual([]);
    await logout.settle();
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/^\d+:logout:session-1$/);
    expect(pushesFor("A")).toEqual(["/"]);
    expect(pushesFor("B")).toEqual(["/"]); // a manual sign-out: the plain login page, not the idle one
    expect(logoutCalls()).toHaveLength(1); // the second tab sent no logout of its own
  });

  it("a tab of a NEWER session ignores the old session's signal", async () => {
    linkTabs();
    const logout = deferLogout();
    mountWatcherTab("B", "session-1"); // the old session's other tab
    mountWatcherTab("C", "session-2"); // someone signed in since: a page served for the new session
    mount("session-1");
    click();
    await advance(10);
    await logout.settle();
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:logout:session-1$/);
    expect(pushesFor("B")).toEqual(["/"]);
    expect(pushesFor("C")).toEqual([]);
    await advance(5_000);
    expect(pushesFor("C")).toEqual([]);
    expect(logoutCalls()).toHaveLength(1); // and the new session's tab sent no logout
  });

  it("an unconfirmed end (every attempt fails) still tells the other tabs once the retries settle", async () => {
    linkTabs();
    h.fetch.mockImplementation(async (url: string) => {
      if (url === "/api/auth/logout") throw new TypeError("Failed to fetch");
      return ok();
    });
    mountWatcherTab("B", "session-1");
    mount("session-1");
    click();
    await advance(1_000);
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toBeNull(); // still retrying: nobody is told yet
    expect(h.pushes).toEqual([]);
    await advance(4_000);
    expect(logoutCalls()).toHaveLength(4);
    expect(window.localStorage.getItem(SIGNED_OUT_KEY)).toMatch(/:logout:session-1$/);
    expect(pushesFor("A")).toEqual(["/"]);
    expect(pushesFor("B")).toEqual(["/"]);
  });
});
