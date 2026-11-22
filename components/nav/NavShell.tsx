"use client";

/**
 * The top bar's client shell (nav PR 9, plan r2 3.1; spec 4.1, 4.2; lead ruling r1 F1).
 *
 * ONE client component per mount that holds the Go to context AND wraps the page: the bar row, then `{children}` (the
 * page, still server-rendered children), then the Go to sheet. So the Dashboard's "All pages" button (a descendant of
 * the children) and the bar's Go to button call the same `open()` and open the same sheet.
 *
 * - The bar row is in the page flow: no `fixed`, no `sticky`, no z-index, no transform, no filter (it creates no
 *   stacking context, so the sheets' and dialogs' z-indexes compare in the root context). `[Dashboard] [Bell] [Go to]`.
 * - `model` is read from props on EVERY render, never copied into state: a `router.refresh()` that brings a narrower
 *   model (a demoted viewer, F5) takes effect at once.
 * - Ctrl+K / Cmd+K opens Go to, checked against modal arbitration FIRST: with a foreign modal open (the PIN dialog, the
 *   password modal, the idle warning, the sign-out cover) the handler returns without `preventDefault`, so the key is
 *   untouched for whoever owns it. Never while composing (IME).
 * - Go to and the bell panel are never open together: opening one closes the other.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { GoToModel } from "@/lib/nav/go-to-shared";
import { useTranslation } from "@/lib/i18n/provider";

import { GoToButton } from "./GoToButton";
import { GoToSheet } from "./GoToSheet";
import type { MeProps } from "./MeControls";
import { foreignModalOpen } from "./modal-arbiter";
import { TopBarDashboardLink } from "./TopBarDashboardLink";

export type NavPanel = "goto" | "bell" | null;

export interface GoToApi {
  /** Opens Go to (closing the bell panel). A no-op while a foreign modal is open. `returnTo` gets focus back on close. */
  open: (returnTo?: HTMLElement | null) => void;
  close: () => void;
  isOpen: boolean;
  /** Which of the two sheets is open. */
  panel: NavPanel;
  /** Opens the bell panel (closing Go to); a no-op under a foreign modal. */
  openBell: (returnTo?: HTMLElement | null) => void;
  model: GoToModel;
  /** Where focus goes back when the open sheet closes (the trigger, or what had focus before Ctrl+K). */
  returnTo: HTMLElement | null;
  /** False outside a NavShell (a component rendered without the bar): `open()` does nothing there. */
  available: boolean;
}

const EMPTY_MODEL: GoToModel = { rooms: [], people: false };
const NOOP: GoToApi = { open: () => {}, close: () => {}, isOpen: false, panel: null, openBell: () => {}, model: EMPTY_MODEL, returnTo: null, available: false };
const GoToContext = createContext<GoToApi>(NOOP);

/** The bar's Go to, from anywhere inside the page (the Dashboard's "All pages"). */
export function useGoTo(): GoToApi {
  return useContext(GoToContext);
}

export interface NavShellProps {
  model: GoToModel;
  me: MeProps;
  /** The streamed bell (server-rendered), or null: then no bell exists in the tree and no read can start. */
  bell: ReactNode | null;
  children?: ReactNode;
}

export function NavShell({ model, me, bell, children }: NavShellProps) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<NavPanel>(null);
  const [returnTo, setReturnTo] = useState<HTMLElement | null>(null);

  const open = useCallback((to?: HTMLElement | null) => {
    if (foreignModalOpen()) return;
    const active = typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReturnTo(to ?? active);
    setPanel("goto");
  }, []);
  const openBell = useCallback((to?: HTMLElement | null) => {
    if (foreignModalOpen()) return;
    setReturnTo(to ?? null);
    setPanel("bell");
  }, []);
  const close = useCallback(() => setPanel(null), []);

  // Ctrl+K / Cmd+K: arbitration first, then preventDefault (a foreign modal's key events stay untouched).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key !== "k" && e.key !== "K") return;
      if (foreignModalOpen()) return;
      e.preventDefault();
      open(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const api = useMemo<GoToApi>(() => ({ open, close, isOpen: panel === "goto", panel, openBell, model, returnTo, available: true }),
    [open, close, panel, openBell, model, returnTo]);

  return (
    <GoToContext.Provider value={api}>
      <nav aria-label={t("nav.topbar.aria")} data-co-top-bar="" className="flex min-h-[44px] items-center gap-2 px-4 pt-3 sm:px-6">
        <TopBarDashboardLink />
        <div className="flex-1" />
        {bell}
        <GoToButton />
      </nav>
      {children}
      <GoToSheet model={model} me={me} open={panel === "goto"} onClose={close} returnFocus={returnTo} />
    </GoToContext.Provider>
  );
}
