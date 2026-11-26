// @vitest-environment jsdom
/* eslint-disable react/no-children-prop -- the harness builds the tree with createElement */
/**
 * Nav PR 9, Q3 and Q4 (client half): people load ONLY on a query (plan r2 3.1 PeopleResults, 4.1, 4.4).
 *
 * The real NavShell for a key holder: no fetch at render or on open; 1 character → nothing; 2 characters → exactly one
 * request after 250 ms of quiet; a newer keystroke aborts the older request; an older query's answer is dropped; a 503
 * is "Couldn't load people right now." (never "No one matches."); a 403 people_search_refused removes the section and
 * reloads the model. The social media manager's model offers no people: no section, no request, ever.
 */
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: () => {}, refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/dashboard" }));

import { NavShell } from "@/components/nav/NavShell";
import { TranslationProvider } from "@/lib/i18n/provider";
import { goToEntries } from "@/lib/nav/go-to";
import en from "@/lib/i18n/en.json";

const T = en as Record<string, string>;
const ME = { userName: "Kim", userEmail: null, actorLevel: 4, initialBlurb: null, sessionId: "session-1" };
const KH = goToEntries({ role: "key_holder", level: 4, language: "en" }, {});
const SMM = goToEntries({ role: "social_media_mgr", level: 6, language: "en" }, {});

type Pending = { url: string; signal: AbortSignal; resolve: (r: Response) => void };
let pending: Pending[] = [];
const fetchMock = vi.fn((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
  const signal = init!.signal!;
  signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  pending.push({ url, signal, resolve });
}));
const peopleCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/nav/people"));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function mount(model = KH) {
  render(createElement(TranslationProvider, { initialLanguage: "en", children: createElement(NavShell, { model, me: ME, bell: null, children: null }) }));
  fireEvent.click(screen.getByRole("button", { name: T["nav.goto.open_aria"] }));
}
const type = (v: string) => fireEvent.change(document.querySelector("[data-co-goto-search]")!, { target: { value: v } });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  pending = [];
  fetchMock.mockClear();
  router.refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Q3: people only on a query", () => {
  it("no fetch at render or on open; 1 character → nothing; 2 → one request after 250 ms", async () => {
    mount();
    await tick(1_000);
    expect(fetchMock).not.toHaveBeenCalled();
    type("T");
    await tick(1_000);
    expect(fetchMock).not.toHaveBeenCalled();
    type("Te");
    await tick(249);
    expect(fetchMock).not.toHaveBeenCalled();
    await tick(1);
    expect(peopleCalls()).toEqual([["/api/nav/people?q=Te", expect.objectContaining({ redirect: "manual" })]]);
  });
  it("typing during the debounce sends only the last query", async () => {
    mount();
    type("Te");
    await tick(100);
    type("Tes");
    await tick(100);
    type("Tess");
    await tick(250);
    expect(peopleCalls().map(([u]) => u)).toEqual(["/api/nav/people?q=Tess"]);
  });
  it("a newer keystroke aborts the older request, and the older answer is dropped", async () => {
    mount();
    type("Te");
    await tick(250);
    const first = pending[0]!;
    type("Tes");
    expect(first.signal.aborted).toBe(true);
    await tick(250);
    const second = pending[1]!;
    await act(async () => { first.resolve(json(200, { people: [{ userId: "x", name: "Old Answer", role: "employee" }], hasMore: false })); });
    await act(async () => { second.resolve(json(200, { people: [{ userId: "u1", name: "Tessa Teammate", role: "employee" }], hasMore: false })); });
    await tick(0);
    expect(screen.queryByText("Old Answer")).toBeNull();
    expect(screen.getByText("Tessa Teammate")).toBeTruthy();
    expect(screen.getByText("Tessa Teammate").closest("a")!.getAttribute("href")).toBe("/profile/u1");
  });
  it("loading, then results with 'more match', in the viewer's language", async () => {
    mount();
    type("Te");
    await tick(250);
    expect(screen.getByText(T["nav.goto.people_loading"]!)).toBeTruthy();
    await act(async () => { pending[0]!.resolve(json(200, { people: [{ userId: "u1", name: "Tessa", role: "employee" }], hasMore: true })); });
    await tick(0);
    expect(screen.getByText(T["nav.goto.people_more"]!)).toBeTruthy();
    expect(screen.getByText(T["role.employee"]!)).toBeTruthy();
  });
  it("none: 'No one matches.'; a 503: the error line, never 'No one matches.'", async () => {
    mount();
    type("Zz");
    await tick(250);
    await act(async () => { pending[0]!.resolve(json(200, { people: [], hasMore: false })); });
    await tick(0);
    expect(screen.getByText(T["nav.goto.people_none"]!)).toBeTruthy();
    type("Zzz");
    await tick(250);
    await act(async () => { pending[1]!.resolve(json(503, { code: "people_unavailable" })); });
    await tick(0);
    expect(screen.getByText(T["nav.goto.people_error"]!)).toBeTruthy();
    expect(screen.queryByText(T["nav.goto.people_none"]!)).toBeNull();
  });
  it("a timeout (10 s) is the error line", async () => {
    mount();
    type("Te");
    await tick(250);
    await tick(10_000);
    expect(screen.getByText(T["nav.goto.people_error"]!)).toBeTruthy();
  });
  it("403 people_search_refused: the section goes, the model is reloaded, no further request", async () => {
    mount();
    type("Te");
    await tick(250);
    await act(async () => { pending[0]!.resolve(json(403, { code: "people_search_refused" })); });
    await tick(0);
    expect(document.querySelector("[data-co-people]")).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    type("Tes");
    await tick(1_000);
    expect(peopleCalls()).toHaveLength(1);
  });
});

describe("Q4 (client): the social media manager", () => {
  it("no people section and no request, whatever is typed", async () => {
    mount(SMM);
    type("Tessa");
    await tick(2_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("[data-co-people]")).toBeNull();
    const listed = Array.from(document.querySelectorAll("[data-co-goto-entry]")).map((a) => a.getAttribute("data-co-goto-entry"));
    expect(listed).toEqual([]); // "Tessa" matches none of its four pages
    type("");
    expect(Array.from(document.querySelectorAll("[data-co-goto-entry]")).map((a) => a.getAttribute("data-co-goto-entry")))
      .toEqual(["dashboard", "me", "my-feedback", "training"]);
  });
});
