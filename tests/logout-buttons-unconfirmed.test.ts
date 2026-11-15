// @vitest-environment jsdom
/**
 * Audit W06/B012 fix round 6 — the Log out buttons (components/auth/LogoutButton.tsx, components/UserMenu.tsx) treat a
 * 503 logout_unconfirmed as NOT YET ENDED: an opaque "Signing out…" cover goes up at once (nothing authenticated is
 * shown again), the request is retried with short bounded backoff naming the page's session, and the page still goes
 * to the login surface — after a confirmed end, and after the last retry when none came.
 */
import { act } from "react";
import { jsx } from "react/jsx-runtime";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { UserMenu } from "@/components/UserMenu";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";

const h = vi.hoisted(() => ({ push: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: () => {} }),
  usePathname: () => "/operations/counts",
}));

const T = en as Record<string, string>;
const OVERLAY = "signing-out-overlay";
const ok = () => ({ ok: true, status: 200, type: "basic", json: async () => ({ ok: true }) }) as unknown as Response;
const unconfirmed = () =>
  ({ ok: false, status: 503, type: "basic", json: async () => ({ code: "logout_unconfirmed", sessionId: "session-1" }) }) as unknown as Response;
const logoutCalls = () => h.fetch.mock.calls.filter((c) => c[0] === "/api/auth/logout");
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const wrap = (child: unknown) => render(jsx(TranslationProvider, { initialLanguage: "en", children: child }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const surfaces = [
  {
    name: "LogoutButton",
    mount: () => wrap(jsx(LogoutButton, { sessionId: "session-1" })),
    click: () => fireEvent.click(screen.getByRole("button", { name: T["auth.logout.label"]! })),
  },
  {
    name: "UserMenu → Sign out",
    mount: () =>
      wrap(jsx(UserMenu, { userName: "GM", userEmail: null, actorLevel: 7, initialBlurb: null, sessionId: "session-1" })),
    click: () => {
      fireEvent.click(screen.getByRole("button", { name: T["user_menu.aria_label"]! }));
      fireEvent.click(screen.getByRole("menuitem", { name: T["user_menu.sign_out"]! }));
    },
  },
];

describe.each(surfaces)("round 6 — $name", ({ mount, click }) => {
  it("503 then 200: covered at once, retried with the session named, then the login page", async () => {
    let n = 0;
    h.fetch.mockImplementation(async () => (n++ === 0 ? unconfirmed() : ok()));
    mount();
    click();
    await advance(10);
    expect(screen.getByTestId(OVERLAY)).toBeTruthy();
    expect(logoutCalls()).toHaveLength(1);
    expect(h.push).not.toHaveBeenCalled(); // not yet ended → not yet away, but covered
    await advance(600);
    expect(logoutCalls()).toHaveLength(2);
    for (const c of logoutCalls()) expect((c[1] as RequestInit).body).toBe(JSON.stringify({ sessionId: "session-1" }));
    expect(h.push).toHaveBeenCalledWith("/");
  });

  it("503 every time: bounded retries, then the login page anyway", async () => {
    h.fetch.mockImplementation(async () => unconfirmed());
    mount();
    click();
    await advance(10_000);
    expect(logoutCalls()).toHaveLength(4);
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith("/");
  });

  it("a confirmed 200: one request, straight to the login page", async () => {
    h.fetch.mockImplementation(async () => ok());
    mount();
    click();
    await advance(10);
    expect(logoutCalls()).toHaveLength(1);
    expect(h.push).toHaveBeenCalledWith("/");
  });
});
