// @vitest-environment jsdom
/* eslint-disable react-hooks/refs, react/no-children-prop -- a test harness builds the sheet with createElement and refs */
/**
 * Nav PR 9, F2-T: modal arbitration (plan r2 5.6; lead ruling r1 F2).
 *
 * Step 6 part: the `foreignModalOpen` unit table and the sheet shell's suspension (hidden + inert while a foreign modal
 * is open; back, with focus restored, when it goes). The composed cases with the real NavShell and the real PIN,
 * password and idle dialogs land with NavShell (step 7; lead ruling r2 G2).
 */
import { createElement, useRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { foreignModalOpen, FOREIGN_MODAL_SELECTOR } from "@/components/nav/modal-arbiter";
import { Sheet } from "@/components/nav/Sheet";

afterEach(() => { cleanup(); document.body.innerHTML = ""; });

describe("foreignModalOpen", () => {
  const add = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; document.body.appendChild(d); return d; };
  it.each([
    ['<div role="dialog" aria-modal="true"></div>', true],
    ['<div role="dialog" aria-modal="false"></div>', false],
    ["<dialog open></dialog>", true],
    ["<dialog></dialog>", false],
    ['<div role="dialog" aria-modal="true" data-co-nav-sheet=""></div>', false],
    ['<dialog open data-co-nav-sheet=""></dialog>', false],
    ["<div></div>", false],
  ] as const)("%s → %s", (html, expected) => {
    add(html);
    expect(foreignModalOpen(document)).toBe(expected);
  });
  it("the selector reads exactly the house pattern", () => {
    expect(FOREIGN_MODAL_SELECTOR).toBe('[aria-modal="true"]:not([data-co-nav-sheet]), dialog[open]:not([data-co-nav-sheet])');
  });
});

function OpenSheet() {
  const search = useRef<HTMLInputElement | null>(null);
  return createElement(Sheet, {
    id: "s", open: true, labelledBy: "h", onClose: () => {}, initialFocus: search,
    children: [createElement("h2", { key: "h", id: "h" }, "Go to"), createElement("input", { key: "i", ref: search, "data-testid": "search" })],
  });
}

describe("the shell suspends under a foreign modal and resumes after it", () => {
  it.each([
    ["an aria-modal dialog", () => { const d = document.createElement("div"); d.setAttribute("aria-modal", "true"); return d; }],
    ["an open native dialog (the sign-out cover's shape)", () => { const d = document.createElement("dialog"); d.setAttribute("open", ""); return d; }],
  ])("%s", async (_l, make) => {
    render(createElement(OpenSheet));
    const sheet = document.querySelector("[data-co-nav-sheet]") as HTMLElement;
    expect(document.activeElement).toBe(screen.getByTestId("search"));
    const foreign = make();
    await act(async () => { document.body.appendChild(foreign); await Promise.resolve(); });
    expect(sheet.hidden).toBe(true);
    expect(sheet.hasAttribute("inert")).toBe(true);
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => { foreign.remove(); await Promise.resolve(); });
    expect(sheet.hidden).toBe(false);
    expect(sheet.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(screen.getByTestId("search"));
  });
  it("an aria-modal attribute flipped on an existing node is seen too", async () => {
    const d = document.createElement("div");
    document.body.appendChild(d);
    render(createElement(OpenSheet));
    const sheet = document.querySelector("[data-co-nav-sheet]") as HTMLElement;
    await act(async () => { d.setAttribute("aria-modal", "true"); await Promise.resolve(); });
    expect(sheet.hidden).toBe(true);
    await act(async () => { d.setAttribute("aria-modal", "false"); await Promise.resolve(); });
    expect(sheet.hidden).toBe(false);
  });
});
