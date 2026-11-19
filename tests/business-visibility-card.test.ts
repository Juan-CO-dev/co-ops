// @vitest-environment jsdom
/**
 * Business report access: the "what GMs can see" card, DRIVEN (review BRACCESS-r1 P2: source pins do not exercise the
 * race). The real component in jsdom; the page's refresh is a spy, and "the refresh arrived" is a rerender with the
 * new head, so the gap between a save and its refresh can be held open.
 *
 *   - an edit is never lost silently: after a save the switches cannot be touched until the new saved row arrives;
 *     the card is not remounted by it; a head that moves under an UNSAVED draft is announced;
 *   - one save of the whole set, bound to the head the card showed, behind the password every time;
 *   - a cancelled password posts nothing and keeps the draft; the section cannot close over a draft;
 *   - a switch that needs another one is disabled while that one is off; turning a parent off turns its children off.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import { TranslationProvider } from "@/lib/i18n/provider";
import { BusinessVisibilityCard, type BusinessVisibilityCardData } from "@/components/admin/sevenshifts/BusinessVisibilityCard";
import { GM_VISIBILITY_DEFAULTS, GM_VISIBILITY_KEYS, type GmVisibility, type GmVisibilityKey } from "@/lib/business-access-shared";

const h = vi.hoisted(() => ({ refresh: vi.fn(), stepUp: vi.fn(async (tier: string) => (tier ? "ok" : "ok") as string) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: h.refresh }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: h.stepUp }) }));
vi.mock("next/link", async () => {
  const { createElement: e } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children: unknown }) => e("a", { href, ...rest }, children as never) };
});

const EN = en as Record<string, string>;
const T = (k: string) => EN[`business.visibility.${k}`]!;
const HEAD_1 = "11111111-1111-4111-8111-111111111111", HEAD_2 = "22222222-2222-4222-8222-222222222222";
const ALL_ON = Object.fromEntries(GM_VISIBILITY_KEYS.map((k) => [k, true])) as GmVisibility;
const data = (settings: GmVisibility, headId: string | null): BusinessVisibilityCardData => ({ settings, headId, savedBy: headId ? "Pete" : null, savedAt: headId ? "2026-11-19T15:00:00Z" : null });
const el = (d: BusinessVisibilityCardData | null) => createElement(TranslationProvider, { initialLanguage: "en" } as never, createElement(BusinessVisibilityCard, { data: d }));

let calls: Array<{ url: string; body: { settings: GmVisibility; expectedId: string | null } }>;
let answer: () => Response;
beforeEach(() => {
  calls = []; h.refresh.mockClear(); h.stepUp.mockReset(); h.stepUp.mockResolvedValue("ok");
  answer = () => new Response(JSON.stringify({ ok: true, id: HEAD_2 }), { status: 200 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, body: JSON.parse(String(init?.body)) }); return answer(); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const header = () => screen.getByRole("button", { name: new RegExp(`^${T("title")}`) });
const sw = (k: GmVisibilityKey) => screen.getByRole("switch", { name: new RegExp(`^${T(`switch.${k}`).replace(/[()]/g, "\\$&")}: `) }) as HTMLButtonElement;
const isOn = (k: GmVisibilityKey) => sw(k).getAttribute("aria-checked") === "true";
const saveButton = () => screen.getByRole("button", { name: T("save") }) as HTMLButtonElement;
const flip = (k: GmVisibilityKey) => fireEvent.click(sw(k));
const save = async () => { await act(async () => { fireEvent.click(saveButton()); }); };
const openCard = () => fireEvent.click(header());

describe("disclosure and the draft", () => {
  it("collapsed by default with the count on its header; opening shows nine switches in the saved state", () => {
    render(el(data(GM_VISIBILITY_DEFAULTS, null)));
    expect(header().getAttribute("aria-expanded")).toBe("false");
    expect(header().textContent).toContain(T("count").replace("{on}", "8").replace("{total}", "9"));
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    openCard();
    expect(screen.getAllByRole("switch")).toHaveLength(9);
    expect(GM_VISIBILITY_KEYS.filter(isOn)).toEqual(GM_VISIBILITY_KEYS.filter((k) => GM_VISIBILITY_DEFAULTS[k]));
    expect(screen.getByText(T("never_saved"))).toBeTruthy();
    expect(saveButton().disabled).toBe(true); // nothing changed yet
  });
  it("0349 not applied: one sentence, no switch, no save", () => {
    render(el(null));
    expect(screen.getByText(T("unavailable"))).toBeTruthy();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: T("save") })).toBeNull();
  });
  it("a switch that needs another is disabled, with the reason, while that one is off; turning a parent off turns its children off", () => {
    render(el(data(ALL_ON, HEAD_1)));
    openCard();
    expect(sw("loaded").disabled).toBe(false);
    flip("hourly_cost");
    expect([isOn("hourly_cost"), isOn("loaded")]).toEqual([false, false]);
    expect(sw("loaded").disabled).toBe(true);
    expect(sw("loaded").textContent).toContain(T("needs").replace("{parent}", T("switch.hourly_cost")));
    flip("loaded"); // disabled: nothing happens
    expect(isOn("loaded")).toBe(false);
    flip("report");
    expect(GM_VISIBILITY_KEYS.filter(isOn)).toEqual([]);
    for (const k of GM_VISIBILITY_KEYS.filter((x) => x !== "report")) expect(sw(k).disabled, k).toBe(true);
    // turning the parent back on does not turn the children back on by itself
    flip("report");
    expect(GM_VISIBILITY_KEYS.filter(isOn)).toEqual(["report"]);
  });
  it("the section cannot be closed over an unsaved draft", () => {
    render(el(data(ALL_ON, HEAD_1)));
    openCard();
    flip("export");
    openCard(); // tap the header to close
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(isOn("export")).toBe(false);
    flip("export"); // back to the saved state: now it may close
    openCard();
    expect(header().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("saving", () => {
  it("one POST of the WHOLE set, bound to the head the card showed, after the password (Tier B)", async () => {
    render(el(data(ALL_ON, HEAD_1)));
    openCard();
    flip("loaded"); flip("compare");
    await save();
    expect(h.stepUp).toHaveBeenCalledWith("B");
    expect(calls).toEqual([{ url: "/api/admin/reports/business-visibility", body: { settings: { ...ALL_ON, loaded: false, compare: false }, expectedId: HEAD_1 } }]);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(T("success"))).toBeTruthy();
  });
  it("a first save sends expectedId null", async () => {
    render(el(data(GM_VISIBILITY_DEFAULTS, null)));
    openCard();
    flip("loaded");
    await save();
    expect(calls[0]!.body).toEqual({ settings: ALL_ON, expectedId: null });
  });
  it("a cancelled password posts nothing, keeps the draft and keeps the section open", async () => {
    h.stepUp.mockResolvedValue("cancelled");
    render(el(data(ALL_ON, HEAD_1)));
    openCard();
    flip("export");
    await save();
    expect(calls).toEqual([]);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(isOn("export")).toBe(false);
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(saveButton().disabled).toBe(false);
  });
  it("a refusal is said by name and the draft stays; a stale password is asked for again once", async () => {
    render(el(data(ALL_ON, HEAD_1)));
    openCard();
    flip("export");
    answer = () => new Response(JSON.stringify({ code: "moved" }), { status: 409 });
    await save();
    expect(screen.getByRole("alert").textContent).toBe(T("error.moved"));
    expect(isOn("export")).toBe(false);
    expect(h.refresh).not.toHaveBeenCalled();
    let n = 0;
    answer = () => (n++ === 0 ? new Response(JSON.stringify({ code: "step_up_stale" }), { status: 403 }) : new Response(JSON.stringify({ ok: true, id: HEAD_2 }), { status: 200 }));
    h.stepUp.mockClear();
    await save();
    expect(h.stepUp).toHaveBeenCalledTimes(2);
    expect(screen.getByText(T("success"))).toBeTruthy();
  });
});

describe("an edit is never lost silently (BRACCESS-r1 P2)", () => {
  it("after a save, until the refresh delivers the new saved row: no switch can be touched and Save is off", async () => {
    const view = render(el(data(ALL_ON, HEAD_1)));
    openCard();
    flip("loaded");
    await save();
    // The save succeeded; the refresh is IN FLIGHT (the page has not delivered the new head yet).
    expect(h.refresh).toHaveBeenCalledTimes(1);
    for (const k of GM_VISIBILITY_KEYS) expect(sw(k).disabled, k).toBe(true);
    expect(saveButton().disabled).toBe(true);
    flip("export"); flip("compare"); // taps during the gap: nothing happens, so nothing can be discarded later
    expect([isOn("export"), isOn("compare"), isOn("loaded")]).toEqual([true, true, false]);
    expect(calls).toHaveLength(1);
    // The refresh arrives: the saved row, a new head.
    view.rerender(el(data({ ...ALL_ON, loaded: false }, HEAD_2)));
    expect([isOn("export"), isOn("compare"), isOn("loaded")]).toEqual([true, true, false]);
    for (const k of GM_VISIBILITY_KEYS.filter((x) => x !== "loaded")) expect(sw(k).disabled, k).toBe(false);
    expect(screen.getByText(T("success"))).toBeTruthy(); // not remounted: the confirmation is still there
    // ... and the next edit is bound to the NEW head.
    flip("export");
    await save();
    expect(calls[1]!.body).toEqual({ settings: { ...ALL_ON, loaded: false, export: false }, expectedId: HEAD_2 });
  });
  it("a refresh that brings the SAME head (another card on the page refreshed) keeps the wait, and keeps an unsaved draft", async () => {
    const view = render(el(data(ALL_ON, HEAD_1)));
    openCard();
    flip("compare");
    view.rerender(el(data(ALL_ON, HEAD_1))); // the Burden card saved: same head for this card
    expect(isOn("compare")).toBe(false); // the draft survives
    await save();
    view.rerender(el(data(ALL_ON, HEAD_1))); // an unrelated refresh lands before ours
    for (const k of GM_VISIBILITY_KEYS) expect(sw(k).disabled, k).toBe(true); // still waiting for OUR row
    view.rerender(el(data({ ...ALL_ON, compare: false }, HEAD_2)));
    expect(sw("export").disabled).toBe(false);
  });
  it("the head moves under an UNSAVED draft (someone else saved): the draft restarts from their row AND the card says so", () => {
    const view = render(el(data(ALL_ON, HEAD_1)));
    openCard();
    flip("export");
    view.rerender(el(data({ ...ALL_ON, loaded: false }, HEAD_2)));
    expect(screen.getByRole("alert").textContent).toBe(T("error.moved"));
    expect([isOn("export"), isOn("loaded")]).toEqual([true, false]); // their saved row, shown
    expect(saveButton().disabled).toBe(true);
    // A save from here is bound to the head now shown (what the person now sees).
    flip("export");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("the head moves with NO draft: the card just shows the new row (no warning)", () => {
    const view = render(el(data(ALL_ON, HEAD_1)));
    openCard();
    view.rerender(el(data({ ...ALL_ON, loaded: false }, HEAD_2)));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(isOn("loaded")).toBe(false);
  });
});
