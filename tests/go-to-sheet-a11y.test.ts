// @vitest-environment jsdom
/* eslint-disable react-hooks/refs, react/no-children-prop -- a test harness builds the sheet with createElement and refs */
/**
 * Nav PR 9, U1-U2: the sheet shell's keyboard contract (plan r2 5.2, 5.3; spec 4.2 a11y).
 *
 * U1: Tab / Shift+Tab cycle inside the sheet, recomputed on each keypress, so a result list that grows mid-trap is
 * included. U2: Escape closes and focus returns to the trigger; an Escape already `defaultPrevented`, or aimed outside
 * the sheet, is ignored; no handler is attached while the sheet is suspended under a foreign modal. (U3, the labels, lands
 * with Go to in step 7; U4, the stacking pins, with the idle warning's raise in step 12: lead ruling r2 G2.)
 */
import { createElement, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/nav/Sheet";

afterEach(() => cleanup());

function Harness({ onCloseSpy }: { onCloseSpy?: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(["one", "two"]);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const first = useRef<HTMLInputElement | null>(null);
  return createElement("div", null,
    createElement("button", { ref: trigger, "data-testid": "trigger", onClick: () => setOpen(true) }, "open"),
    createElement("button", { "data-testid": "outside" }, "outside"),
    createElement(Sheet, {
      id: "s", open, labelledBy: "s-h", initialFocus: first, returnFocus: trigger.current,
      onClose: () => { onCloseSpy?.(); setOpen(false); },
      children: [
        createElement("h2", { key: "h", id: "s-h" }, "Go to"),
        createElement("input", { key: "i", ref: first, "data-testid": "search", type: "search" }),
        ...items.map((x) => createElement("a", { key: x, href: `/${x}`, "data-testid": `item-${x}` }, x)),
        createElement("button", { key: "grow", "data-testid": "grow", onClick: () => setItems((p) => [...p, `n${p.length}`]) }, "grow"),
      ],
    }),
  );
}
const openSheet = () => {
  render(createElement(Harness));
  fireEvent.click(screen.getByTestId("trigger"));
};
const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey: shift });

describe("U1: the Tab trap", () => {
  it("focus starts on the search box; Tab from the last wraps to the first; Shift+Tab from the first wraps to the last", () => {
    openSheet();
    expect(document.activeElement).toBe(screen.getByTestId("search"));
    tab(true);
    expect(document.activeElement).toBe(screen.getByTestId("grow"));
    tab();
    expect(document.activeElement).toBe(screen.getByTestId("search"));
  });
  it("a list that grows mid-trap is included (recomputed on each keypress)", () => {
    openSheet();
    fireEvent.click(screen.getByTestId("grow"));
    fireEvent.click(screen.getByTestId("grow"));
    screen.getByTestId("item-n3").focus();
    tab(true);
    // item-n3 is not the first: no wrap. The last is still the grow button, now after four items.
    expect(document.activeElement).toBe(screen.getByTestId("item-n3"));
    screen.getByTestId("grow").focus();
    tab();
    expect(document.activeElement).toBe(screen.getByTestId("search"));
    tab(true);
    expect(document.activeElement).toBe(screen.getByTestId("grow"));
  });
  it("focus outside the sheet is pulled back in on Tab", () => {
    openSheet();
    screen.getByTestId("outside").focus();
    tab();
    expect(document.activeElement).toBe(screen.getByTestId("search"));
  });
});

describe("U2: Escape", () => {
  it("closes, and focus returns to the trigger", () => {
    render(createElement(Harness));
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);
    // Re-render so returnFocus (read from the ref) is the trigger, as NavShell passes it on open.
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("search"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("ignores an Escape already defaultPrevented", () => {
    const spy = vi.fn();
    render(createElement(Harness, { onCloseSpy: spy }));
    fireEvent.click(screen.getByTestId("trigger"));
    const search = screen.getByTestId("search");
    search.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("ignores an Escape aimed outside the sheet", () => {
    const spy = vi.fn();
    render(createElement(Harness, { onCloseSpy: spy }));
    fireEvent.click(screen.getByTestId("trigger"));
    fireEvent.keyDown(screen.getByTestId("outside"), { key: "Escape" });
    expect(spy).not.toHaveBeenCalled();
  });
  it("is not attached while suspended under a foreign modal (and Tab is not intercepted)", async () => {
    const spy = vi.fn();
    render(createElement(Harness, { onCloseSpy: spy }));
    fireEvent.click(screen.getByTestId("trigger"));
    const foreign = document.createElement("div");
    foreign.setAttribute("role", "dialog");
    foreign.setAttribute("aria-modal", "true");
    await act(async () => { document.body.appendChild(foreign); await Promise.resolve(); });
    const sheet = document.querySelector("[data-co-nav-sheet]") as HTMLElement;
    expect(sheet.hidden).toBe(true);
    expect(sheet.hasAttribute("inert")).toBe(true);
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    screen.getByTestId("search").dispatchEvent(esc);
    expect(spy).not.toHaveBeenCalled();
    expect(esc.defaultPrevented).toBe(false);
    const tabEv = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    screen.getByTestId("grow").dispatchEvent(tabEv);
    expect(tabEv.defaultPrevented).toBe(false);
    await act(async () => { foreign.remove(); await Promise.resolve(); });
    expect(sheet.hidden).toBe(false);
  });
  it("backdrop click closes", () => {
    openSheet();
    fireEvent.click(document.querySelector("[data-co-nav-backdrop]")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("locks body scroll while open and restores it on close", () => {
    document.body.style.overflow = "auto";
    openSheet();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(screen.getByTestId("search"), { key: "Escape" });
    expect(document.body.style.overflow).toBe("auto");
  });
});
