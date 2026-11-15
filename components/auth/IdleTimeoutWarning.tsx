"use client";

/**
 * IdleTimeoutWarning — Phase 2 Session 4; audit W06 (B012, B013, B153).
 *
 * Tracks user activity client-side. 30 seconds before the idle limit it opens a
 * modal with a live countdown:
 *   - "Stay signed in" → POST /api/auth/heartbeat (touches last_activity_at
 *                        server-side via requireSession side-effect) and
 *                        resets the idle clock in every tab. A dead session
 *                        (401, or the proxy's 307 seen as an opaque redirect)
 *                        signs out instead of pretending it worked.
 *   - "Log out now"    → POST /api/auth/logout, redirect to /.
 * If nobody does anything for the full idle limit, the session is REVOKED
 * (POST /api/auth/logout, best-effort) before the page goes to the login
 * surface with ?reason=idle (B012 — redirecting alone left the session alive,
 * and the dashboard's background refresh kept it alive server-side, so the
 * next person on a shared tablet was inside the previous person's account).
 * The sign-in link carries a return link bound to this user (owner decision
 * W06-2): the same person signing back in returns here, anyone else lands on
 * the dashboard.
 *
 * ONE idle clock across tabs (B153): the last-activity instant is shared via
 * localStorage (`co_ops_last_activity`) and the `storage` event, so an
 * untouched background tab never signs out a person working in another tab
 * (writes are throttled to one per 5 s, with one trailing write for the latest
 * suppressed activity, so every tab works to the same deadline), and activity elsewhere closes this tab's warning. A sign-out in one tab
 * (`co_ops_signed_out`) sends the other tabs to the login page without a
 * second logout — published only once that tab's logout request has settled.
 * The logout route is REVOKE-ONLY (round 5): it never sets a cookie, so no
 * logout response — however late — can clear a sign-in made meanwhile. Both
 * the logout request and the signal NAME the session this page was served for
 * (`sessionId`): a late logout from another tab cannot end a NEW session (the
 * server finds a different session on the cookie and leaves it), and its late
 * signal cannot send a NEW session's tab to the login page.
 * An end the server cannot confirm (round 6: 503 `logout_unconfirmed`, which
 * also clears the cookie, or a network failure) is NOT treated as done: the
 * request is retried with short bounded backoff (lib/logout-client.ts) behind
 * an opaque "Signing out…" cover, and the page still goes to the login page
 * once it settles; the other tabs are told only then.
 * Storage blocked (private mode) = the per-tab clock, as before.
 *
 * The SERVER clock only sees requests (B013): typing for ten minutes with no
 * request used to end in a 401 and lost input. While activity continues, a
 * throttled heartbeat (at most every 2 minutes, shared across tabs via
 * `co_ops_last_heartbeat`) keeps the server session alive. Activity the
 * throttle suppresses is not dropped: one trailing heartbeat goes out when the
 * window opens (unless any tab already reached the server since), so typing,
 * a pause shorter than the limit, then typing again never meets a server
 * session older than the client's clock. Nothing more is sent once that
 * activity is flushed. A heartbeat only counts once the server ACKNOWLEDGES it
 * (2xx): a network failure or a 503 keeps the activity pending and retries
 * with bounded backoff (5 s doubling to 60 s) while that activity is still
 * inside the idle window, and only an acknowledged beat is published to the
 * other tabs as "server reached". A 401 signs out. The idle limit is the
 * server's own SESSION_IDLE_MINUTES, passed in by the layouts.
 *
 * Activity-tracking events: mousedown, keydown, touchstart, scroll. This tab's
 * listeners are detached while the warning modal is open — the user must make
 * an explicit choice (locked Phase 2 Session 4 design); another tab's activity
 * still counts.
 *
 * Focus trap: on open, the "Stay signed in" button is focused; Tab cycles
 * within the two buttons; Esc is ignored (explicit-action-required); no
 * dismiss by backdrop click.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { SigningOutOverlay } from "@/components/auth/SigningOutOverlay";
import { useTranslation } from "@/lib/i18n/provider";
import { requestSignOut } from "@/lib/logout-client";
import { rememberSignedInUser, signInHref } from "@/lib/nav-sign-in-return";

const DEFAULT_IDLE_MINUTES = 10; // matches lib/session.ts DEFAULT_IDLE_MINUTES
const WARNING_BEFORE_SECONDS = 30; // show modal 30s before forced logout
const TICK_MS = 1000;
/** Shared-clock writes are throttled: `scroll` fires many times a second. */
const ACTIVITY_WRITE_EVERY_MS = 5_000;
/** The activity heartbeat, well under half the idle window (clamped for small SESSION_IDLE_MINUTES). */
const HEARTBEAT_EVERY_MS = 2 * 60 * 1000;
/** An unacknowledged heartbeat (network failure / 503) is retried after 5 s, doubling, capped at 60 s. */
const HEARTBEAT_RETRY_BASE_MS = 5_000;
const HEARTBEAT_RETRY_MAX_MS = 60_000;

const IDLE_ACTIVITY_KEY = "co_ops_last_activity";
const IDLE_HEARTBEAT_KEY = "co_ops_last_heartbeat";
const IDLE_SIGNED_OUT_KEY = "co_ops_signed_out";

const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll"] as const;

function readStoredMs(key: string): number {
  try {
    const n = Number(window.localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked — this tab keeps its own clock (the pre-B153 behaviour).
  }
}

/** A heartbeat / step-up style response that means the session is gone. */
function sessionIsDead(res: Response): boolean {
  return res.status === 401 || res.type === "opaqueredirect";
}

/** The server reached and touched the session (anything else, e.g. a network failure or a 503, is only an attempt). */
function heartbeatAcknowledged(res: Response | null): boolean {
  return res !== null && res.status >= 200 && res.status < 300;
}

export interface IdleTimeoutWarningProps {
  /** The server's idle limit (lib/session.ts sessionIdleMinutes()). */
  idleMinutes?: number;
  /** The signed-in user — binds the idle sign-out's return link to them (W06-2). */
  userId?: string;
  /** The session this page was served for — a sign-out names it (round 5); not a credential (dual verification). */
  sessionId?: string;
}

/** The cross-tab sign-out signal: `<ms>:<idle|logout>[:<session id>]`. */
function signedOutSignal(kind: "idle" | "logout", sessionId: string | undefined): string {
  return `${Date.now()}:${kind}${sessionId ? `:${sessionId}` : ""}`;
}

/** Parse a signal; one written before round 5 names no session and applies to every tab. */
function parseSignedOutSignal(value: string): { kind: string; sessionId: string | null } {
  const [, kind = "", sessionId = ""] = value.split(":");
  return { kind, sessionId: sessionId || null };
}

export function IdleTimeoutWarning({ idleMinutes = DEFAULT_IDLE_MINUTES, userId, sessionId }: IdleTimeoutWarningProps = {}) {
  const { t } = useTranslation();
  const router = useRouter();
  const totalIdleMs = (Number.isFinite(idleMinutes) && idleMinutes > 0 ? idleMinutes : DEFAULT_IDLE_MINUTES) * 60 * 1000;
  const warningSeconds = Math.min(WARNING_BEFORE_SECONDS, Math.floor(totalIdleMs / 2000));
  const heartbeatEveryMs = Math.min(HEARTBEAT_EVERY_MS, Math.floor(totalIdleMs / 3));

  // Seed to 0 at render — Date.now() during render is impure (react-hooks/purity).
  // The mount effect below stamps the real timestamp before the idle interval's
  // first tick (+1000ms), so the timer still measures from first paint.
  const lastActivityRef = useRef<number>(0);
  /** When this tab last wrote the shared clock (the throttle anchor) and the activity instant it wrote. */
  const lastActivityWriteRef = useRef<number>(0);
  const lastActivityWrittenRef = useRef<number>(0);
  /** Latest activity the 5 s storage throttle suppressed (0 = none) and its one trailing-write timer. */
  const pendingActivityWriteRef = useRef<number>(0);
  const activityWriteTimerRef = useRef<number | null>(null);
  /** Send time of this tab's last ACKNOWLEDGED heartbeat (or the page load): the server saw activity up to here. */
  const lastHeartbeatRef = useRef<number>(0);
  const heartbeatInFlightRef = useRef(false);
  /** Consecutive unacknowledged heartbeats, and the earliest instant the next retry may go. */
  const beatFailuresRef = useRef(0);
  const retryNotBeforeRef = useRef(0);
  const unmountedRef = useRef(false);
  /** Latest activity the heartbeat throttle suppressed (0 = none pending) and its trailing-send timer. */
  const pendingBeatActivityRef = useRef<number>(0);
  const trailingBeatTimerRef = useRef<number | null>(null);
  /** The latest beatForActivity, for the trailing timer (a callback cannot name itself). */
  const beatForActivityRef = useRef<(activityAt: number) => void>(() => {});
  const expiredRef = useRef(false);
  const [warningOpen, setWarningOpen] = useState(false);
  /** A sign-out is in flight (round 6: an unconfirmed one is retried) — nothing authenticated shows meanwhile. */
  const [signingOut, setSigningOut] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(warningSeconds);
  const stayBtnRef = useRef<HTMLButtonElement | null>(null);
  const logoutBtnRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Stamp activity in this tab and (throttled) in the shared clock. Activity the throttle suppresses is not
   * dropped (round 4): one trailing write publishes the latest of it when the window opens — otherwise a
   * keystroke at 0:04 after a write at 0:00 left the other tabs on 0:00, and they signed the session out at
   * 10:00 while this tab still showed four seconds left. Nothing new since the last write = no trailing write.
   */
  const markActivity = useCallback((now: number, forceShared = false) => {
    lastActivityRef.current = now;
    if (forceShared || now - lastActivityWriteRef.current >= ACTIVITY_WRITE_EVERY_MS) {
      lastActivityWriteRef.current = now;
      lastActivityWrittenRef.current = now;
      pendingActivityWriteRef.current = 0;
      writeStored(IDLE_ACTIVITY_KEY, String(now));
      return;
    }
    if (now <= lastActivityWrittenRef.current) return; // nothing new
    if (now > pendingActivityWriteRef.current) pendingActivityWriteRef.current = now;
    if (activityWriteTimerRef.current !== null || unmountedRef.current) return;
    activityWriteTimerRef.current = window.setTimeout(() => {
      activityWriteTimerRef.current = null;
      const latest = pendingActivityWriteRef.current;
      pendingActivityWriteRef.current = 0;
      if (latest === 0 || expiredRef.current || unmountedRef.current) return;
      if (latest <= Math.max(lastActivityWrittenRef.current, readStoredMs(IDLE_ACTIVITY_KEY))) return; // already published
      lastActivityWriteRef.current = Date.now();
      lastActivityWrittenRef.current = latest;
      writeStored(IDLE_ACTIVITY_KEY, String(latest));
    }, lastActivityWriteRef.current + ACTIVITY_WRITE_EVERY_MS - now);
  }, []);

  /**
   * The idle sign-out: revoke for real (B012), then tell the other tabs and go to the login page. Runs once.
   * The other tabs hear about it only once the logout request has SETTLED (round 4): told earlier, another tab
   * reached the login page while the logout was still in flight, someone signed in there, and the slow logout
   * response then cleared the NEW session's cookie. Since round 5 the route never sets a cookie at all, and the
   * request and the signal name this page's session, so a late one cannot end or sign out a newer session.
   */
  const expire = useCallback(async () => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    const here = window.location.pathname + window.location.search;
    setSigningOut(true);
    // Round 6: an unconfirmed end (503, network) is retried briefly; settled either way, the page still leaves (the
    // 503 cleared the cookie, and an orphaned session meets the server's own idle limit).
    await requestSignOut(sessionId);
    writeStored(IDLE_SIGNED_OUT_KEY, signedOutSignal("idle", sessionId));
    router.push(signInHref({ reason: "idle", next: here, forUser: userId }));
  }, [router, userId, sessionId]);

  const heartbeat = useCallback(async (): Promise<Response | null> => {
    try {
      return await fetch("/api/auth/heartbeat", { method: "POST", redirect: "manual" });
    } catch {
      return null; // a network blip never signs anyone out
    }
  }, []);

  /** The server acknowledged a heartbeat sent at sentAt: record it here and publish it to the other tabs. */
  const noteBeatAcknowledged = useCallback((sentAt: number) => {
    beatFailuresRef.current = 0;
    retryNotBeforeRef.current = 0;
    if (sentAt > lastHeartbeatRef.current) lastHeartbeatRef.current = sentAt;
    if (sentAt > readStoredMs(IDLE_HEARTBEAT_KEY)) writeStored(IDLE_HEARTBEAT_KEY, String(sentAt));
  }, []);

  /** A heartbeat was only attempted (network failure / 503): keep its activity pending and back off. */
  const noteBeatUnacknowledged = useCallback((activityAt: number) => {
    if (activityAt > pendingBeatActivityRef.current) pendingBeatActivityRef.current = activityAt;
    beatFailuresRef.current += 1;
    const backoff = Math.min(HEARTBEAT_RETRY_BASE_MS * 2 ** (beatFailuresRef.current - 1), HEARTBEAT_RETRY_MAX_MS);
    retryNotBeforeRef.current = Date.now() + backoff;
  }, []);

  /**
   * Send the activity heartbeat now, or — inside the throttle window — remember the activity and send one
   * trailing heartbeat when the window opens (B013 round 1). An ACKNOWLEDGED heartbeat from any tab after the
   * activity already told the server, so the trailing send is dropped. A failed attempt does not count: the
   * activity stays pending and is retried with bounded backoff while it is inside the idle window (round 2).
   */
  const beatForActivity = useCallback(
    (activityAt: number) => {
      if (expiredRef.current || unmountedRef.current) return;
      if (activityAt > pendingBeatActivityRef.current) pendingBeatActivityRef.current = activityAt;
      const pendingAt = pendingBeatActivityRef.current;
      if (pendingAt === 0) return;
      const lastAck = Math.max(lastHeartbeatRef.current, readStoredMs(IDLE_HEARTBEAT_KEY));
      if (lastAck >= pendingAt) {
        pendingBeatActivityRef.current = 0; // already acknowledged (here or in another tab)
        return;
      }
      if (heartbeatInFlightRef.current) return; // its response reschedules whatever is still pending
      const now = Date.now();
      if (now - pendingAt >= totalIdleMs) {
        pendingBeatActivityRef.current = 0; // no longer "still active": the client's own idle sign-out takes over
        return;
      }
      const sendAt = beatFailuresRef.current > 0 ? retryNotBeforeRef.current : lastAck + heartbeatEveryMs;
      const wait = sendAt - now;
      if (wait > 0) {
        if (trailingBeatTimerRef.current === null) {
          trailingBeatTimerRef.current = window.setTimeout(() => {
            trailingBeatTimerRef.current = null;
            beatForActivityRef.current(0);
          }, wait);
        }
        return;
      }
      pendingBeatActivityRef.current = 0;
      heartbeatInFlightRef.current = true;
      void heartbeat().then((res) => {
        heartbeatInFlightRef.current = false;
        if (expiredRef.current) return;
        if (res && sessionIsDead(res)) {
          void expire();
          return;
        }
        if (heartbeatAcknowledged(res)) noteBeatAcknowledged(now);
        else noteBeatUnacknowledged(pendingAt);
        beatForActivityRef.current(0); // activity during the flight, or the retry
      });
    },
    [heartbeatEveryMs, totalIdleMs, heartbeat, expire, noteBeatAcknowledged, noteBeatUnacknowledged],
  );

  useEffect(() => {
    beatForActivityRef.current = beatForActivity;
  }, [beatForActivity]);

  // The trailing-heartbeat / retry timer and the trailing activity write die with the component
  // (and a response landing after unmount schedules none).
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (trailingBeatTimerRef.current !== null) window.clearTimeout(trailingBeatTimerRef.current);
      trailingBeatTimerRef.current = null;
      if (activityWriteTimerRef.current !== null) window.clearTimeout(activityWriteTimerRef.current);
      activityWriteTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const now = Date.now();
    markActivity(now, true);
    lastHeartbeatRef.current = now; // the page load itself reached the server
    if (userId) rememberSignedInUser(userId);
  }, [markActivity, userId]);

  // Activity listeners: only when the warning modal is closed.
  useEffect(() => {
    if (warningOpen) return;
    const onActivity = () => {
      const now = Date.now();
      markActivity(now);
      // Throttled heartbeat with a trailing send (B013): the server only sees requests, so keep it alive while someone types.
      beatForActivity(now);
    };
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
    };
  }, [warningOpen, markActivity, beatForActivity]);

  // Other tabs (B153): their activity counts here; their sign-out signs this tab out too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === IDLE_ACTIVITY_KEY && e.newValue) {
        const n = Number(e.newValue);
        if (Number.isFinite(n) && n > lastActivityRef.current) {
          lastActivityRef.current = n;
          setWarningOpen(false);
          setSecondsLeft(warningSeconds);
        }
        return;
      }
      if (e.key === IDLE_SIGNED_OUT_KEY && e.newValue && !expiredRef.current) {
        const signal = parseSignedOutSignal(e.newValue);
        // A sign-out of ANOTHER session (a late signal from before a new sign-in) is not this tab's (round 5).
        if (signal.sessionId && sessionId && signal.sessionId !== sessionId) return;
        expiredRef.current = true;
        const here = window.location.pathname + window.location.search;
        router.push(signal.kind === "logout" ? "/" : signInHref({ reason: "idle", next: here, forUser: userId }));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router, userId, sessionId, warningSeconds]);

  // Tick loop: decide whether to show modal / sign out.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (expiredRef.current) return;
      const stored = readStoredMs(IDLE_ACTIVITY_KEY);
      if (stored > lastActivityRef.current) {
        // Someone is active in another tab: adopt their clock and stand down.
        lastActivityRef.current = stored;
        if (warningOpen) {
          setWarningOpen(false);
          setSecondsLeft(warningSeconds);
        }
      }
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= totalIdleMs) {
        void expire();
        return;
      }
      const remaining = (totalIdleMs - idleMs) / 1000;
      if (remaining <= warningSeconds) {
        if (!warningOpen) setWarningOpen(true);
        setSecondsLeft(Math.max(0, Math.ceil(remaining)));
      }
    }, TICK_MS);
    return () => window.clearInterval(interval);
  }, [warningOpen, totalIdleMs, warningSeconds, expire]);

  // Focus the primary button on open.
  useEffect(() => {
    if (warningOpen) stayBtnRef.current?.focus();
  }, [warningOpen]);

  const onStay = useCallback(async () => {
    const sentAt = Date.now();
    const res = await heartbeat();
    if (res && sessionIsDead(res)) {
      // B013: "Stay signed in" on a dead session must not pretend it worked.
      void expire();
      return;
    }
    // A network failure / 503 is non-fatal, but it is not "server reached": the click stays pending and is retried.
    const now = Date.now();
    markActivity(now, true);
    if (heartbeatAcknowledged(res)) {
      noteBeatAcknowledged(sentAt);
    } else {
      noteBeatUnacknowledged(sentAt);
      beatForActivity(sentAt);
    }
    setSecondsLeft(warningSeconds);
    setWarningOpen(false);
  }, [heartbeat, expire, markActivity, noteBeatAcknowledged, noteBeatUnacknowledged, beatForActivity, warningSeconds]);

  const onLogout = useCallback(async () => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    setSigningOut(true);
    // Intent-honoring: an unconfirmed end is retried briefly (round 6), then the page leaves regardless.
    await requestSignOut(sessionId);
    // Only now tell the other tabs (round 4, as in expire), naming the session that ended (round 5).
    writeStored(IDLE_SIGNED_OUT_KEY, signedOutSignal("logout", sessionId));
    router.push("/");
  }, [router, sessionId]);

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

  if (signingOut) return <SigningOutOverlay />;
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
          {t("auth.idle.title")}
        </h2>
        <p id="idle-warning-body" className="mt-2 text-center text-sm text-co-text-muted">
          {t("auth.idle.body")}
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
            {t("auth.idle.stay")}
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
            {t("auth.idle.logout_now")}
          </button>
        </div>
      </div>
    </div>
  );
}
