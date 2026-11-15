// @vitest-environment jsdom
/**
 * Audit W06 — the idle sign-out (components/auth/IdleTimeoutWarning.tsx).
 *  B012: the idle expiry REVOKES the session (POST /api/auth/logout) before going to the login page, exactly once.
 *  B013: steady typing keeps the server session alive (throttled heartbeat); a dead session on the heartbeat, or on
 *        "Stay signed in", signs out instead of pretending; the idle limit is the server's.
 *  B153: one idle clock across tabs (localStorage + the storage event); blocked storage keeps the per-tab clock.
 *  W06-2: the idle sign-in link carries a return link bound to this user.
 */
import { act } from "react";
import { jsx } from "react/jsx-runtime";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";

const h = vi.hoisted(() => ({ push: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }));

const STAY = (en as Record<string, string>)["auth.idle.stay"]!;
const ACTIVITY_KEY = "co_ops_last_activity";
const SIGNED_OUT_KEY = "co_ops_signed_out";
const IDLE_TARGET = "/?reason=idle&next=%2Foperations%2Fcounts%3Floc%3Da&for=user-1";

const ok = () => ({ ok: true, status: 200, type: "basic", json: async () => ({ ok: true }) }) as unknown as Response;
const dead = () => ({ ok: false, status: 401, type: "basic", json: async () => ({ code: "unauthorized" }) }) as unknown as Response;
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
