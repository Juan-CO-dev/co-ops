"use client";

/**
 * SigningOutOverlay — audit W06/B012 fix rounds 6 and 10.
 *
 * Covers the whole screen, opaque, while a sign-out is in flight (lib/logout-client.ts retries an unconfirmed one for
 * a few seconds) or while this tab is leaving because another tab signed out. Once someone asked to sign out, nothing
 * behind it can be read or operated; the caller then goes to the sign-in page, which unmounts it.
 *
 * Round 10 (review W06-r10): "covered" has to hold against everything already on screen, not only the page.
 *   - It is portaled to the END of <body> with a z-index above every dialog (PasswordModal is z-[1100]), so no open
 *     dialog — and no parent stacking context (the UserMenu's z-30 row) — can stay above it.
 *   - Every other child of <body> is made `inert` while it shows (and any added later, e.g. a portal mounting during
 *     the retries), so nothing beneath can be focused, clicked or read by a screen reader. Only the `inert` it set
 *     itself is removed when it goes.
 *   - Focus moves into the cover and is kept there.
 *   - A capture-phase shield on window drops every key, pointer, click and submit aimed beneath it, so a keyboard
 *     Enter / space on a control that still held focus cannot submit (belt and braces for engines without `inert`).
 * Rendered only after a click / the idle deadline / a cross-tab signal, so `document` exists.
 */

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useTranslation } from "@/lib/i18n/provider";

/** Events that could operate the page beneath the cover; each one aimed outside it is cancelled before the app sees it. */
const SHIELDED_EVENTS = [
  "keydown",
  "keypress",
  "keyup",
  "beforeinput",
  "input",
  "paste",
  "submit",
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "touchstart",
  "touchend",
] as const;

/** Marks a cover's root. Two covers can show at once (an idle sign-out and a Sign out tap); each is "the cover". */
const COVER_ATTR = "data-signing-out-cover";

function isCover(n: Node | null): boolean {
  return n instanceof Element && n.closest(`[${COVER_ATTR}]`) !== null;
}

/**
 * The page beneath is inert while ANY cover shows: shared by every mounted cover (a count), so one cover going does not
 * hand the page back while another still shows. Only the `inert` set here is removed at the end.
 */
let coversShowing = 0;
let madeInert = new Set<Element>();
let bodyObserver: MutationObserver | null = null;

function makeInert(el: Element): void {
  if (isCover(el) || el.hasAttribute("inert")) return;
  el.setAttribute("inert", "");
  madeInert.add(el);
}

function holdPageInert(): () => void {
  coversShowing += 1;
  if (coversShowing === 1) {
    for (const el of Array.from(document.body.children)) makeInert(el);
    // A child added later (a portal mounting during the retries) is beneath the cover too.
    bodyObserver = new MutationObserver((records) => {
      for (const r of records) for (const n of Array.from(r.addedNodes)) if (n instanceof Element) makeInert(n);
    });
    bodyObserver.observe(document.body, { childList: true });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    coversShowing -= 1;
    if (coversShowing > 0) return;
    bodyObserver?.disconnect();
    bodyObserver = null;
    for (const el of madeInert) el.removeAttribute("inert");
    madeInert = new Set();
  };
}

export function SigningOutOverlay() {
  const { t } = useTranslation();
  const coverRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const cover = coverRef.current;
    if (!cover) return;
    const releasePage = holdPageInert();
    const beneath = (e: Event) => !isCover(e.target instanceof Node ? e.target : null);
    const shield = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key === "Tab") e.preventDefault(); // focus stays on the cover
      if (!beneath(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const keepFocus = (e: FocusEvent) => {
      if (beneath(e)) cover.focus();
    };
    for (const type of SHIELDED_EVENTS) window.addEventListener(type, shield, { capture: true, passive: false });
    window.addEventListener("focusin", keepFocus, true);
    cover.focus();

    return () => {
      for (const type of SHIELDED_EVENTS) window.removeEventListener(type, shield, { capture: true });
      window.removeEventListener("focusin", keepFocus, true);
      releasePage();
    };
  }, []);

  return createPortal(
    <div
      ref={coverRef}
      role="status"
      aria-live="polite"
      tabIndex={-1}
      {...{ [COVER_ATTR]: "" }}
      data-testid="signing-out-overlay"
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-co-bg px-4 outline-none"
    >
      <p className="text-center text-lg font-bold text-co-text">{t("auth.logout.submitting")}</p>
    </div>,
    document.body,
  );
}
