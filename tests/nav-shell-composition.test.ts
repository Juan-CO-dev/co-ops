// @vitest-environment jsdom
/* eslint-disable react/no-children-prop -- the harness builds the tree with createElement */
/**
 * Nav PR 9, F1-T: the real provider composition (plan r2 3.1; lead ruling r1 F1 and the testing gate).
 *
 * The REAL NavShell (no stand-in) wraps the page children, so a control inside the page that calls `useGoTo().open()`
 * (the Dashboard's "All pages", wired to it in step 11) and the bar's Go to button open THE SAME sheet: one
 * `data-co-nav-sheet` node with the same id, the search box focused. `model` is read from props on every render.
 */
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: () => {}, refresh: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/operations/closing",
}));

import { NavShell, useGoTo } from "@/components/nav/NavShell";
import { TranslationProvider } from "@/lib/i18n/provider";
import { goToEntries } from "@/lib/nav/go-to";
import en from "@/lib/i18n/en.json";

const ME = { userName: "Kim Holder", userEmail: null, actorLevel: 4, initialBlurb: null, sessionId: "session-1" };
const KH = goToEntries({ role: "key_holder", level: 4, language: "en" }, {});
const SMM = goToEntries({ role: "social_media_mgr", level: 6, language: "en" }, {});

/** A control inside the page that opens Go to through the hook (what "All pages" does). */
function AllPagesStandIn() {
  const { open } = useGoTo();
  return createElement("button", { type: "button", "data-testid": "all-pages", onClick: (e: { currentTarget: HTMLElement }) => open(e.currentTarget) }, "All pages");
}
function mount(model = KH) {
  return render(createElement(TranslationProvider, {
    initialLanguage: "en",
    children: createElement(NavShell, { model, me: ME, bell: null, children: createElement("main", null, createElement(AllPagesStandIn)) }),
  }));
}
const sheets = () => document.querySelectorAll("[data-co-nav-sheet]");
const GOTO = (en as Record<string, string>)["nav.goto.open_aria"]!;

beforeEach(() => { document.body.style.overflow = ""; });
afterEach(() => cleanup());

describe("F1-T: one provider around the bar and the page", () => {
  it("the page's control and the bar's button open the same sheet", () => {
    mount();
    expect(sheets()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("all-pages"));
    expect(sheets()).toHaveLength(1);
    const first = sheets()[0] as HTMLElement;
    expect(first.getAttribute("role")).toBe("dialog");
    expect(document.activeElement).toBe(document.querySelector("[data-co-goto-search]"));
    expect(screen.getByRole("heading", { level: 2, name: "Go to" })).toBeTruthy();
    const id = first.id;
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(sheets()).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByTestId("all-pages"));
    fireEvent.click(screen.getByRole("button", { name: GOTO }));
    expect(sheets()).toHaveLength(1);
    expect((sheets()[0] as HTMLElement).id).toBe(id);
    expect(document.activeElement).toBe(document.querySelector("[data-co-goto-search]"));
  });
  it("the bar row precedes the page, and the sheet follows it", () => {
    const { container } = mount();
    const nav = container.querySelector("[data-co-top-bar]")!;
    const main = container.querySelector("main")!;
    expect(nav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.contains(main)).toBe(false);
  });
  it("lists exactly the model's entries in the rooms view", () => {
    mount();
    fireEvent.click(screen.getByTestId("all-pages"));
    const listed = Array.from(document.querySelectorAll("[data-co-goto-entry]")).map((a) => a.getAttribute("data-co-goto-entry"));
    expect(listed).toEqual(KH.rooms.flatMap((r) => [...r.entries, ...r.groups.flatMap((g) => g.entries)]).map((e) => e.id));
  });
  it("Ctrl+K and Cmd+K open it from the page (preventDefault taken only then)", () => {
    mount();
    const ev = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(sheets()).toHaveLength(1);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true })); });
    expect(sheets()).toHaveLength(1);
  });
  it("the model is read from props on every render (a refresh with a narrower model takes effect at once)", () => {
    const { rerender } = mount();
    fireEvent.click(screen.getByTestId("all-pages"));
    expect(document.querySelectorAll("[data-co-goto-entry]").length).toBeGreaterThan(4);
    rerender(createElement(TranslationProvider, {
      initialLanguage: "en",
      children: createElement(NavShell, { model: SMM, me: ME, bell: null, children: createElement("main", null, createElement(AllPagesStandIn)) }),
    }));
    const listed = Array.from(document.querySelectorAll("[data-co-goto-entry]")).map((a) => a.getAttribute("data-co-goto-entry"));
    expect(listed).toEqual(["dashboard", "me", "my-feedback", "training"]);
  });
  it("outside a NavShell, useGoTo().open() is a no-op (no sheet)", () => {
    render(createElement(TranslationProvider, { initialLanguage: "en", children: createElement(AllPagesStandIn) }));
    fireEvent.click(screen.getByTestId("all-pages"));
    expect(sheets()).toHaveLength(0);
  });
});
