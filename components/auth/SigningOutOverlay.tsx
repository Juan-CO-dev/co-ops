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
 *
 * Round 11 (review W06-r11): a native <dialog> opened with showModal() (the dashboard's assignment-change dialog) sits
 * in the browser's TOP LAYER, above every z-index, and escapes ancestor `inert`. So:
 *   - every open <dialog> in the document is closed when the cover shows, and any opened while it shows is closed again;
 *   - the cover is itself a <dialog> opened with showModal(), so it is the topmost thing in the top layer. Escape / a
 *     cancel request cannot close it, and if something closes it anyway it is shown again at once.
 *   Where showModal() is missing (jsdom; very old engines) it is shown with the `open` attribute, and the round-10
 *   containment above (last child of <body>, z-index, inert, focus, capture shield) does the work.
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

/** Closes a native dialog that is not a cover (close() where the engine has it, else drops the `open` attribute). */
function closeDialog(el: Node): void {
  if (!(el instanceof HTMLDialogElement) || isCover(el) || !el.hasAttribute("open")) return;
  if (typeof el.close === "function") el.close();
  else el.removeAttribute("open");
}

/** Shows the cover in the top layer (showModal) or, where that is missing, as an open <dialog> under the fallback. */
function present(cover: HTMLDialogElement): void {
  if (!cover.isConnected || cover.hasAttribute("open")) return;
  if (typeof cover.showModal === "function") {
    try {
      cover.showModal();
      return;
    } catch {
      // fall through to the fallback
    }
  }
  cover.setAttribute("open", "");
}

function makeInert(el: Element): void {
  if (isCover(el) || el.hasAttribute("inert")) return;
  el.setAttribute("inert", "");
  madeInert.add(el);
}

function holdPageInert(): () => void {
  coversShowing += 1;
  // A native modal dialog would stay above the cover in the top layer: close every one that is open.
  for (const d of Array.from(document.querySelectorAll("dialog[open]"))) closeDialog(d);
  if (coversShowing === 1) {
    for (const el of Array.from(document.body.children)) makeInert(el);
    // A child added later (a portal mounting during the retries) is beneath the cover too, and a dialog opened while
    // the cover shows (an effect calling showModal() again) is closed again.
    bodyObserver = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes") closeDialog(r.target);
        else if (r.target === document.body) {
          for (const n of Array.from(r.addedNodes)) if (n instanceof Element) makeInert(n);
        }
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
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
  const coverRef = useRef<HTMLDialogElement | null>(null);

  useLayoutEffect(() => {
    const cover = coverRef.current;
    if (!cover) return;
    let showing = true;
    const releasePage = holdPageInert();
    present(cover);
    const beneath = (e: Event) => !isCover(e.target instanceof Node ? e.target : null);
    const shield = (e: Event) => {
      if (e.type === "keydown") {
        const key = (e as KeyboardEvent).key;
        if (key === "Tab") e.preventDefault(); // focus stays on the cover
        if (key === "Escape") e.preventDefault(); // no close request for the cover
      }
      if (!beneath(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const keepFocus = (e: FocusEvent) => {
      if (beneath(e)) cover.focus();
    };
    const refuseCancel = (e: Event) => e.preventDefault();
    const reopen = () => {
      if (!showing) return;
      present(cover);
      cover.focus();
    };
    for (const type of SHIELDED_EVENTS) window.addEventListener(type, shield, { capture: true, passive: false });
    window.addEventListener("focusin", keepFocus, true);
    cover.addEventListener("cancel", refuseCancel);
    cover.addEventListener("close", reopen);
    cover.focus();

    return () => {
      showing = false;
      for (const type of SHIELDED_EVENTS) window.removeEventListener(type, shield, { capture: true });
      window.removeEventListener("focusin", keepFocus, true);
      cover.removeEventListener("cancel", refuseCancel);
      cover.removeEventListener("close", reopen);
      releasePage();
    };
  }, []);

  // A <dialog> so that showModal() puts it in the top layer; the UA dialog box styles are reset to a full-screen cover.
  return createPortal(
    <dialog
      ref={coverRef}
      aria-label={t("auth.logout.submitting")}
      tabIndex={-1}
      {...{ [COVER_ATTR]: "" }}
      data-testid="signing-out-overlay"
      className="fixed inset-0 z-[2000] m-0 h-full max-h-none w-full max-w-none border-0 bg-co-bg p-0 text-co-text outline-none backdrop:bg-co-bg"
    >
      <div role="status" aria-live="polite" className="flex h-full w-full items-center justify-center px-4">
        <p className="text-center text-lg font-bold text-co-text">{t("auth.logout.submitting")}</p>
      </div>
    </dialog>,
    document.body,
  );
}
