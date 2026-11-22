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

// ─── Step 7: the composed cases, with the REAL NavShell and the real dialogs ────────────────────────────────────────
import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { NavShell } from "@/components/nav/NavShell";
import { PinConfirmModal } from "@/components/auth/PinConfirmModal";
import { PasswordModal } from "@/components/auth/PasswordModal";
import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";
import { TranslationProvider } from "@/lib/i18n/provider";
import { goToEntries } from "@/lib/nav/go-to";

const router = vi.hoisted(() => ({ push: () => {}, refresh: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/operations/closing",
}));

const ME = { userName: "Kim", userEmail: null, actorLevel: 4, initialBlurb: null, sessionId: "session-1" };
const MODEL = goToEntries({ role: "key_holder", level: 4, language: "en" }, {});
const navSheet = () => document.querySelector("[data-co-nav-sheet]") as HTMLElement | null;
const search = () => document.querySelector("[data-co-goto-search]") as HTMLInputElement | null;
const ctrlK = () => {
  const ev = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
  act(() => { window.dispatchEvent(ev); });
  return ev;
};
const key = (k: string) => {
  const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  act(() => { (document.activeElement ?? document.body).dispatchEvent(ev); });
  return ev;
};
function shell(page: ReturnType<typeof createElement> | null) {
  return createElement(TranslationProvider, { initialLanguage: "en", children: createElement(NavShell, { model: MODEL, me: ME, bell: null, children: page }) });
}
function pin(open: boolean, onCancel = vi.fn()) {
  return createElement(PinConfirmModal, { open, instanceId: "i1", incompleteReasons: [], onConfirmed: vi.fn(), onError: vi.fn(), onCancel });
}
const pinDots = () => document.querySelector('[aria-label^="PIN entry"]')?.getAttribute("aria-label");

describe("F2-T: the PIN dialog", () => {
  it("open first: Ctrl+K does nothing (not defaultPrevented), digits reach only the PIN, Escape cancels the PIN", () => {
    const onCancel = vi.fn();
    render(shell(pin(true, onCancel)));
    const ev = ctrlK();
    expect(ev.defaultPrevented).toBe(false);
    expect(navSheet()).toBeNull();
    expect(search()).toBeNull();
    key("1");
    key("2");
    expect(pinDots()).toBe("PIN entry: 2 of 4 digits entered");
    key("Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(navSheet()).toBeNull();
  });
  it("the bar's Go to button is refused while it is open", () => {
    render(shell(pin(true)));
    fireEvent.click(document.querySelector("[data-co-goto-button]")!);
    expect(navSheet()).toBeNull();
  });
  it("opened over an open sheet: the sheet suspends (hidden, inert, no Tab trap); digits reach the PIN; the search keeps its value; closing the PIN resumes with focus on the search", async () => {
    const { rerender } = render(shell(pin(false)));
    ctrlK();
    expect(navSheet()).not.toBeNull();
    fireEvent.change(search()!, { target: { value: "cou" } });
    expect(document.activeElement).toBe(search());
    rerender(shell(pin(true)));
    await act(async () => { await Promise.resolve(); });
    expect(navSheet()!.hidden).toBe(true);
    expect(navSheet()!.hasAttribute("inert")).toBe(true);
    const tab = key("Tab");
    expect(tab.defaultPrevented).toBe(false);
    key("3");
    key("4");
    expect(pinDots()).toMatch(/PIN entry: [12] of 4/); // the PIN dialog consumed them (it may start submitting at 4)
    expect(search()!.value).toBe("cou");
    rerender(shell(pin(false)));
    await act(async () => { await Promise.resolve(); });
    expect(navSheet()!.hidden).toBe(false);
    expect(document.activeElement).toBe(search());
  });
});

describe("F2-T: the password modal, the idle warning and the sign-out cover", () => {
  const password = (open: boolean) => createElement(PasswordModal, { open, onConfirm: vi.fn(), onCancel: vi.fn() });
  const cover = (open: boolean) => (open ? createElement("dialog", { open: true, "data-testid": "cover" }) : null);
  it.each([["the password modal", password], ["a <dialog open> (the sign-out cover's shape)", cover]] as const)("%s: refused to open, and suspends an open sheet", async (_l, make) => {
    const { rerender } = render(shell(make(true)));
    expect(ctrlK().defaultPrevented).toBe(false);
    expect(navSheet()).toBeNull();
    rerender(shell(make(false)));
    await act(async () => { await Promise.resolve(); });
    ctrlK();
    expect(navSheet()).not.toBeNull();
    rerender(shell(make(true)));
    await act(async () => { await Promise.resolve(); });
    expect(navSheet()!.hidden).toBe(true);
    rerender(shell(make(false)));
    await act(async () => { await Promise.resolve(); });
    expect(navSheet()!.hidden).toBe(false);
  });
  it("the idle warning (forced open by a short idle limit): refused, and suspends an open sheet", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
      render(shell(createElement(IdleTimeoutWarning, { idleMinutes: 1, userId: "u1", sessionId: "session-1" })));
      ctrlK();
      expect(navSheet()).not.toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
      expect(document.querySelector('[aria-labelledby="idle-warning-title"]')).not.toBeNull();
      expect(navSheet()!.hidden).toBe(true);
      // Closed and refused while the warning shows.
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(navSheet()!.hidden).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
