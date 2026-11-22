// @vitest-environment jsdom
/* eslint-disable react/no-children-prop -- the harness builds the tree with createElement */
/**
 * Nav PR 9, B4: a REFUSAL on a mounted island (plan r2 4.3; lead rulings r1 F5, Q9).
 *
 * With notices showing and the panel open: a 403 `bell_refused` from the unread refresh, a 401, the mark-all route's
 * 403 and the mark action's `bell_refused` each clear the notices, close the panel, remove the bell and run
 * `router.refresh()` once; a 200 already in flight that arrives AFTER the refusal is dropped. Then the layouts re-render
 * (the refresh) with the narrower Go to model (the SMM's four) and no bell: the sheet lists exactly the four ids and
 * has no people section.
 */
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ router: { push: () => {}, refresh: vi.fn() }, mark: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => h.router, usePathname: () => "/admin/skus" }));
vi.mock("@/components/nav/notification-actions", () => ({ markNotificationReadAction: h.mark }));

import { BellIsland, BELL_REFRESH_MS } from "@/components/nav/BellIsland";
import { NavShell } from "@/components/nav/NavShell";
import { TranslationProvider } from "@/lib/i18n/provider";
import { goToEntries } from "@/lib/nav/go-to";
import type { NotificationWithRecipient } from "@/lib/notifications";

const ME = { userName: "Gina", userEmail: null, actorLevel: 7, initialBlurb: null, sessionId: "s1" };
const GM = goToEntries({ role: "gm", level: 7, language: "en" }, {});
const SMM = goToEntries({ role: "social_media_mgr", level: 6, language: "en" }, {});
const SENTINEL = "SENTINEL-BRISKET";

function notice(id: string): NotificationWithRecipient {
  return {
    notification: { id: `n-${id}`, type: "under_par_alert", priority: "urgent", title: "t", body: null, data: { bodyParams: { openerName: SENTINEL, prepped: 1, par: 3, closer: 2 } }, relatedTable: null, relatedId: null, locationId: null, createdAt: "2026-11-01T12:00:00Z" },
    recipient: { id, notificationId: `n-${id}`, userId: "me", deliveryMethod: "in_app", deliveryStatus: "sent", readAt: null, acknowledgedAt: null },
  } as unknown as NotificationWithRecipient;
}
const INITIAL = { notices: [notice("a"), notice("b")], locationCodes: {} };

type Pending = { url: string; resolve: (r: Response) => void; signal: AbortSignal };
let pending: Pending[] = [];
const fetchMock = vi.fn((url: string, init?: RequestInit) => new Promise<Response>((resolve) => {
  pending.push({ url, resolve, signal: init!.signal! });
}));
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const answer = async (p: Pending, status: number, body: unknown) => {
  await act(async () => { p.resolve(new Response(JSON.stringify(body), { status })); });
  await tick(0);
};

function tree(model = GM, withBell = true) {
  return createElement(TranslationProvider, {
    initialLanguage: "en",
    children: createElement(NavShell, { model, me: ME, bell: withBell ? createElement(BellIsland, { initial: INITIAL }) : null, children: null }),
  });
}
const bell = () => document.querySelector("[data-co-bell]") as HTMLButtonElement | null;
const sheet = () => document.querySelector("[data-co-nav-sheet]");
let rerender: (ui: ReturnType<typeof tree>) => void;
async function mountOpen() {
  ({ rerender } = render(tree()));
  act(() => { bell()!.click(); });
  expect(sheet()).not.toBeNull();
  expect(document.body.textContent).toContain(SENTINEL);
}
function expectCleared() {
  expect(bell()).toBeNull();
  expect(sheet()).toBeNull();
  expect(document.body.textContent).not.toContain(SENTINEL);
  expect(h.router.refresh).toHaveBeenCalledTimes(1);
}
const refresh = async () => {
  await tick(BELL_REFRESH_MS + 1);
  act(() => { window.dispatchEvent(new Event("focus")); });
  return pending.find((p) => p.url === "/api/notifications/unread" && !p.signal.aborted)!;
};

beforeEach(() => {
  pending = [];
  fetchMock.mockClear();
  h.router.refresh.mockClear();
  h.mark.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("B4: a refusal clears the mounted island", () => {
  it("the unread refresh answers 403 bell_refused", async () => {
    await mountOpen();
    await answer(await refresh(), 403, { code: "bell_refused" });
    expectCleared();
  });
  it("the unread refresh answers 401", async () => {
    await mountOpen();
    await answer(await refresh(), 401, { code: "unauthorized" });
    expectCleared();
  });
  it("mark all answers 403, and the 200 already in flight arrives after it: dropped", async () => {
    await mountOpen();
    const inflight = await refresh();
    act(() => { (document.querySelector('[aria-label="Mark all notifications as read"]') as HTMLButtonElement).click(); });
    await tick(0);
    const markAll = pending.find((p) => p.url === "/api/notifications/mark-all-read")!;
    await answer(markAll, 403, { code: "bell_refused" });
    expectCleared();
    expect(inflight.signal.aborted).toBe(true);
    await answer(inflight, 200, INITIAL);
    expect(bell()).toBeNull();
    expect(document.body.textContent).not.toContain(SENTINEL);
    expect(h.router.refresh).toHaveBeenCalledTimes(1);
  });
  it("the mark action answers bell_refused", async () => {
    h.mark.mockResolvedValue({ ok: false, errorCode: "bell_refused" });
    await mountOpen();
    await act(async () => { (document.querySelector("[data-co-nav-sheet] li button") as HTMLButtonElement).click(); await vi.advanceTimersByTimeAsync(0); });
    expectCleared();
  });
  it("then the refreshed layout: the SMM's four entries, no bell, no people section", async () => {
    await mountOpen();
    await answer(await refresh(), 403, { code: "bell_refused" });
    act(() => rerender(tree(SMM, false)));
    expect(bell()).toBeNull();
    act(() => { (document.querySelector("[data-co-goto-button]") as HTMLButtonElement).click(); });
    const listed = Array.from(document.querySelectorAll("[data-co-goto-entry]")).map((a) => a.getAttribute("data-co-goto-entry"));
    expect(listed).toEqual(["dashboard", "me", "my-feedback", "training"]);
    const input = document.querySelector("[data-co-goto-search]") as HTMLInputElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "Tessa" } });
    await tick(1_000);
    expect(document.querySelector("[data-co-people]")).toBeNull();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/nav/people"))).toHaveLength(0);
  });
});
