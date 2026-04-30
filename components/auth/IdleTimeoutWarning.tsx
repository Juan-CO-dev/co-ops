"use client";

/**
 * IdleTimeoutWarning — Phase 2 Session 4.
 *
 * Tracks user activity client-side. After 9:30 of inactivity, opens a modal
 * with a live 30-second countdown:
 *   - "Stay signed in" → POST /api/auth/heartbeat (touches last_activity_at
 *                        server-side via requireSession side-effect) and
 *                        resets the local idle clock.
 *   - "Log out now"    → POST /api/auth/logout, redirect to /.
 * If the user does nothing for the full 10:00, silently redirects to
 * /?reason=idle so the login surface can show the "you were signed out" banner.
 *
 * Activity-tracking events: mousedown, keydown, touchstart, scroll. Listeners
 * are detached while the warning modal is open — the user must make an
 * explicit choice (locked Phase 2 Session 4 design).
 *
 * Server-side idle timeout (lib/session.ts SESSION_IDLE_MINUTES, default 10)
 * is the source of truth — this component mirrors that value. If they fall
 * out of sync, the server is authoritative: the next protected request will
 * 401 and the proxy will redirect the user to / regardless of what the local
 * countdown shows.
 *
 * Focus trap: on open, the "Stay signed in" button is focused; Tab cycles
 * within the two buttons; Esc is ignored (explicit-action-required); no
 * dismiss by backdrop click.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const TOTAL_IDLE_SECONDS = 10 * 60; // matches default SESSION_IDLE_MINUTES = 10
const WARNING_BEFORE_SECONDS = 30; // show modal 30s before forced logout
const TICK_MS = 1000;

const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll"] as const;

export function IdleTimeoutWarning() {
  const router = useRouter();
  const lastActivityRef = useRef<number>(Date.now());
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARNING_BEFORE_SECONDS);
  const stayBtnRef = useRef<HTMLButtonElement | null>(null);
  const logoutBtnRef = useRef<HTMLButtonElement | null>(null);

  // Activity listeners: only when the warning modal is closed.
  useEffect(() => {
    if (warningOpen) return;
    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
    };
  }, [warningOpen]);

  // Tick loop: decide whether to show modal / redirect.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const idleSec = (Date.now() - lastActivityRef.current) / 1000;
      if (idleSec >= TOTAL_IDLE_SECONDS) {
        router.push("/?reason=idle");
        return;
      }
      const remaining = TOTAL_IDLE_SECONDS - idleSec;
      if (remaining <= WARNING_BEFORE_SECONDS) {
        if (!warningOpen) setWarningOpen(true);
        setSecondsLeft(Math.max(0, Math.ceil(remaining)));
      }
    }, TICK_MS);
    return () => window.clearInterval(interval);
  }, [warningOpen, router]);

  // Focus the primary button on open.
  useEffect(() => {
    if (warningOpen) stayBtnRef.current?.focus();
  }, [warningOpen]);

  const onStay = useCallback(async () => {
    try {
      await fetch("/api/auth/heartbeat", { method: "POST", redirect: "manual" });
    } catch {
      // Network failure on heartbeat is non-fatal — the next protected request
      // surfaces the real session state. Reset locally; if the session is dead
      // the next navigation will 401 → proxy redirects to /.
    }
    lastActivityRef.current = Date.now();
    setSecondsLeft(WARNING_BEFORE_SECONDS);
    setWarningOpen(false);
  }, []);

  const onLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", redirect: "manual" });
    } catch {
      // Logout is intent-honoring; navigate regardless.
    }
    router.push("/");
  }, [router]);

  // Tab-trap inside the two buttons. Esc is intentionally ignored.
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      return;
    }
    if (e.key !== "Tab") return;
    const stay = stayBtnRef.current;
    const logout = logoutBtnRef.current;
    if (!stay || !logout) return;
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === stay) {
        e.preventDefault();
        logout.focus();
      }
    } else if (active === logout) {
      e.preventDefault();
      stay.focus();
    }
  }, []);

  if (!warningOpen) return null;

  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;
  const formatted = `${mm}:${ss.toString().padStart(2, "0")}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
      aria-describedby="idle-warning-body"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-co-text/60 backdrop-blur-sm px-4 py-6"
    >
      <div className="w-full max-w-sm rounded-2xl border-2 border-co-border bg-co-surface p-6 shadow-2xl">
        <h2 id="idle-warning-title" className="text-center text-xl font-extrabold leading-tight text-co-text">
          Still there?
        </h2>
        <p id="idle-warning-body" className="mt-2 text-center text-sm text-co-text-muted">
          You'll be signed out for inactivity in
        </p>
        <p
          aria-live="polite"
          className="mt-2 text-center text-4xl font-extrabold tabular-nums text-co-text"
        >
          {formatted}
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <button
            ref={stayBtnRef}
            type="button"
            onClick={onStay}
            className="
              inline-flex min-h-[52px] items-center justify-center rounded-xl
              bg-co-text px-4 py-3 text-base font-bold uppercase tracking-[0.12em]
              text-co-cta shadow-sm transition
              hover:bg-co-text/90 hover:shadow-md
              active:translate-y-px
              focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            "
          >
            Stay signed in
          </button>
          <button
            ref={logoutBtnRef}
            type="button"
            onClick={onLogout}
            className="
              inline-flex min-h-[52px] items-center justify-center rounded-xl
              border-2 border-co-border-2 bg-co-surface px-4 py-3 text-sm
              font-semibold text-co-text-muted transition
              hover:border-co-text hover:text-co-text
              focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            "
          >
            Log out now
          </button>
        </div>
      </div>
    </div>
  );
}
