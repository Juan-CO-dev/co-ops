"use client";

/**
 * The top bar's bell on the client (nav PR 9, plan r2 3.1, 4.3; lead rulings r1 F5, F7, Q3, Q9 and r2 G3).
 *
 * States: `ok` (the badge = unread count, none at 0) · `stale` (a transient failure AFTER a good list: the last good
 * badge and list, labelled "couldn't refresh") · `unavailable` (no good list yet: no badge, never a 0) · `refused`
 * (NOTHING: no button, no panel, no list in memory).
 *
 * - REFUSAL (F5): a 401, a 403 (`bell_refused`), the proxy's redirect, or the mark action's `bell_refused` clears the
 *   list, closes the panel, aborts the request in flight, bumps the epoch and runs `router.refresh()` once, so the
 *   layouts re-render with the server's current view (no bell, the narrower Go to model). Nothing leaves `refused` in
 *   this instance (TopBarBell keys the island by role and session).
 * - ORDER (F7): one request in flight; a trigger meanwhile sets `again` (and `forced` if a mark asked); one follow-up
 *   runs when it settles. A response is applied only when it is the latest request of the current epoch.
 * - THE THROTTLE COUNTS ATTEMPTS (G3): an unforced trigger (a pathname change, `focus`, `visibilitychange` to visible)
 *   runs only when 60 s have passed since the last ATTEMPT, whatever it answered, so a run of fast 503s never becomes a
 *   request per event. A forced refresh (after a mark) bypasses it. An ok stream counts as the mount's attempt: no fetch
 *   on mount; after a failed stream, one attempt on mount.
 * - Every request is bounded by `withDeadline(10_000)`; a timeout is a transient failure.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { withDeadline } from "@/lib/bounded-fetch";
import { useTranslation } from "@/lib/i18n/provider";
import type { NotificationWithRecipient } from "@/lib/notifications";

import { BellIcon } from "./BellSlot";
import { useGoTo } from "./NavShell";
import { NotificationPanel, type BellView } from "./NotificationPanel";

export const BELL_REFRESH_MS = 60_000;
export const BELL_REQUEST_TIMEOUT_MS = 10_000;
export const BELL_PANEL_ID = "co-nav-bell-panel";

export interface BellInitial {
  readonly notices: NotificationWithRecipient[];
  readonly locationCodes: Record<string, string>;
}

type Answer = { kind: "ok"; notices: NotificationWithRecipient[]; codes: Record<string, string> } | { kind: "refused" } | { kind: "transient" };

export function BellIsland({ initial }: { initial: BellInitial | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { panel, openBell, close, returnTo } = useGoTo();
  const [view, setView] = useState<BellView>(initial ? { kind: "ok", notices: initial.notices, codes: initial.locationCodes } : { kind: "unavailable" });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const routerRef = useRef(router);
  const closeRef = useRef(close);
  const panelRef = useRef(panel);
  useEffect(() => { routerRef.current = router; closeRef.current = close; panelRef.current = panel; }, [router, close, panel]);

  const m = useRef({
    epoch: 0, seq: 0, inflight: null as AbortController | null, again: false, forced: false,
    lastAttempt: Number.NEGATIVE_INFINITY, refused: false,
  });

  const refuse = useCallback(() => {
    const s = m.current;
    if (s.refused) return;
    s.refused = true;
    s.epoch += 1;
    s.inflight?.abort();
    s.inflight = null;
    s.again = false;
    setView({ kind: "refused" });
    if (panelRef.current === "bell") closeRef.current();
    routerRef.current.refresh();
  }, []);

  // The follow-up after a request settles goes through a ref (a callback cannot name itself before it exists).
  const followUp = useRef<(forced: boolean) => void>(() => {});
  const run = useCallback((forced: boolean) => {
    const s = m.current;
    if (s.refused) return;
    if (s.inflight) {
      s.again = true;
      s.forced = s.forced || forced;
      return;
    }
    const now = Date.now();
    if (!forced && now - s.lastAttempt < BELL_REFRESH_MS) return;
    s.lastAttempt = now;
    const seq = ++s.seq;
    const epoch = s.epoch;
    const ctrl = new AbortController();
    s.inflight = ctrl;
    void (async () => {
      let answer: Answer;
      try {
        answer = await withDeadline(BELL_REQUEST_TIMEOUT_MS, async (signal): Promise<Answer> => {
          signal.addEventListener("abort", () => ctrl.abort(), { once: true });
          const res = await fetch("/api/notifications/unread", { redirect: "manual", cache: "no-store", signal: ctrl.signal });
          if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) return { kind: "refused" };
          if (!res.ok) return { kind: "transient" };
          const body = (await res.json()) as { notices: NotificationWithRecipient[]; locationCodes: Record<string, string> };
          return { kind: "ok", notices: body.notices, codes: body.locationCodes };
        });
      } catch {
        answer = { kind: "transient" };
      }
      if (s.inflight === ctrl) s.inflight = null;
      if (epoch !== s.epoch || seq !== s.seq) return; // from an earlier authorization state, or superseded: dropped
      if (answer.kind === "refused") {
        refuse();
        return;
      }
      if (answer.kind === "ok") {
        // Notices and codes are REPLACED together, never merged across responses.
        setView({ kind: "ok", notices: answer.notices, codes: answer.codes });
      } else {
        setView((prev) => (prev.kind === "ok" || prev.kind === "stale" ? { ...prev, kind: "stale" } : prev.kind === "refused" ? prev : { kind: "unavailable" }));
      }
      if (s.again) {
        const f = s.forced;
        s.again = false;
        s.forced = false;
        followUp.current(f);
      }
    })();
  }, [refuse]);

  useEffect(() => { followUp.current = run; }, [run]);

  // Mount: an ok stream counts as the attempt (no fetch); a failed stream gets one attempt now.
  const hadInitial = useRef(initial !== null);
  useEffect(() => {
    if (hadInitial.current) m.current.lastAttempt = Date.now();
    else run(false);
    const s = m.current;
    return () => {
      s.epoch += 1;
      // A request cut short by an unmount (or a development re-mount) does not count as an attempt.
      if (s.inflight) { s.inflight.abort(); s.inflight = null; s.lastAttempt = Number.NEGATIVE_INFINITY; }
    };
  }, [run]);

  // A pathname change (not the mount's own), focus and becoming visible: unforced, throttled by the last attempt.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    run(false);
  }, [pathname, run]);
  useEffect(() => {
    const onFocus = () => run(false);
    const onVisible = () => { if (document.visibilityState === "visible") run(false); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [run]);

  if (view.kind === "refused") return null;

  const count = view.kind === "ok" || view.kind === "stale" ? view.notices.length : 0;
  const isOpen = panel === "bell";
  const stateLabel = view.kind === "unavailable"
    ? t("notifications.bell.unavailable_aria")
    : view.kind === "stale"
      ? t("notifications.bell.stale_aria", { count })
      : count > 0 ? t("notifications.bell.aria_with_count", { count }) : t("notifications.bell.aria_zero");
  const toggleLabel = isOpen ? t("notifications.bell.toggle_close_aria") : t("notifications.bell.toggle_open_aria");

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-co-bell=""
        data-co-bell-state={view.kind}
        onClick={() => (isOpen ? close() : openBell(buttonRef.current))}
        aria-label={`${stateLabel}. ${toggleLabel}`}
        aria-expanded={isOpen}
        aria-controls={BELL_PANEL_ID}
        aria-haspopup="dialog"
        className="
          relative inline-flex h-11 w-11 items-center justify-center rounded-full
          border-2 border-co-border-2 bg-co-surface text-co-text
          transition hover:border-co-text
          focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        "
      >
        <BellIcon />
        {count > 0 ? (
          <span
            aria-hidden
            data-co-bell-badge=""
            className="
              absolute -top-1 -right-1 inline-flex h-5 min-w-[20px] items-center justify-center
              rounded-full border-2 border-co-surface bg-co-cta px-1
              text-[10px] font-extrabold leading-none text-co-bg
            "
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
      <NotificationPanel
        id={BELL_PANEL_ID}
        open={isOpen}
        onClose={close}
        returnFocus={returnTo}
        view={view}
        onMarked={() => run(true)}
        onRefused={refuse}
      />
    </>
  );
}
