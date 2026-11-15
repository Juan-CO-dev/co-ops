"use client";

/**
 * PasswordModal — Phase 2 Session 4 scaffold; wired in Phase 5+ admin tools.
 *
 * Step-up password re-entry for destructive admin actions on level-5+ users.
 * Hosts the same modal shell pattern as IdleTimeoutWarning (centered overlay,
 * dark backdrop, focus trap, brand-consistent card).
 *
 * Props:
 *   open       — whether the modal is rendered
 *   onConfirm  — called after a successful step-up. Parent decides what to do
 *                next (proceed with the destructive action).
 *   onCancel   — user backed out without confirming.
 *
 * Network: POST /api/auth/step-up with { password }. Response handling:
 *   200                          → onConfirm()
 *   401 invalid_credentials      → inline error "Wrong password."
 *   403 step_up_not_available    → inline error "Step-up not available for your role."
 *   423 account_locked           → inline error with live retry-after countdown
 *                                  (defensive — step-up route itself doesn't
 *                                  lockout on failure per Session 3 lock, but
 *                                  the underlying session could be in a locked
 *                                  state from elsewhere)
 *   401 (any code but invalid_credentials), or an opaque redirect (the proxy's
 *   307 for an expired JWT under redirect: "manual")
 *                                → the SESSION is dead, not the password (audit
 *                                  W06/B154): onCancel() resets the parent, then
 *                                  the page goes to sign in, with a return link
 *                                  bound to this tab's user (W06-2 hybrid).
 *   network/server               → inline error
 *   no answer by STEP_UP_TIMEOUT_MS → the network error (audit W06 round 8): the
 *                                  request — and the body it reads — is under
 *                                  one deadline and aborted there, so a stalled
 *                                  request can no longer hold `submitting` (which
 *                                  disables Confirm, Cancel and Esc) for good.
 *                                  onConfirm runs after, outside the deadline.
 *
 * NO LOCKOUT on repeated step-up failures (locked Phase 2 Session 3 — actor is
 * already authenticated; locking them out of admin doesn't meaningfully raise
 * the bar). Audit captures every failure for forensic visibility.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { withDeadline } from "@/lib/bounded-fetch";
import { useTranslation } from "@/lib/i18n/provider";
import type { StepUpPurpose } from "@/lib/admin/step-up-shared";
import { signInHref, signedInUser } from "@/lib/nav-sign-in-return";

/** One step-up request (password check included) that has not answered by then is a network error (round 8). */
const STEP_UP_TIMEOUT_MS = 15_000;

type StepUpAnswer = {
  ok: boolean;
  status: number;
  type: ResponseType;
  body: { code?: string; message?: string; retry_after_seconds?: number };
};

/** POST /api/auth/step-up and read what the decision needs, all under one deadline. Throws on a network failure or timeout. */
function postStepUp(payload: Record<string, unknown>): Promise<StepUpAnswer> {
  return withDeadline(STEP_UP_TIMEOUT_MS, async (signal) => {
    const res = await fetch("/api/auth/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal,
    });
    // A success and an opaque redirect are decided by the status / type alone; only an error reads its body.
    const body = res.ok || res.type === "opaqueredirect" ? {} : ((await res.json().catch(() => ({}))) as StepUpAnswer["body"]);
    return { ok: res.ok, status: res.status, type: res.type, body };
  });
}

/** Audit W06/B154: a dead session sends the person to sign in instead of reading as "wrong password". */
function goSignIn(): void {
  const here = window.location.pathname + window.location.search;
  window.location.assign(signInHref({ next: here, forUser: signedInUser() }));
}

export interface PasswordModalProps {
  open: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
  /** Catalog Phase 1: mint a one-shot grant for exactly this destructive act with the password. */
  purpose?: StepUpPurpose | null;
  /** Catalog Phase 1: true on the admin surface — this password also opens the 15-minute catalog edit window. */
  catalogWindow?: boolean;
}

type ModalError =
  | { kind: "wrong_password" }
  | { kind: "not_available"; message: string }
  | { kind: "locked"; retryAfterSeconds: number }
  | { kind: "transient"; message: string };

function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function PasswordModal({ open, onConfirm, onCancel, purpose = null, catalogWindow = false }: PasswordModalProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ModalError | null>(null);
  const [retryRemaining, setRetryRemaining] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state on open via render-phase compare — a synchronous reset inside an
  // effect would trip react-hooks/set-state-in-effect. Focus stays in an effect
  // because it's a DOM side effect, not a render-phase state update.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPassword("");
      setError(null);
      setSubmitting(false);
      setRetryRemaining(null);
    }
  }
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Live lockout countdown. Expiry (clearing error + retryRemaining) runs inside
  // the timer callback — a synchronous reset in the effect body would trip
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    if (retryRemaining === null || retryRemaining <= 0) return;
    const t = window.setTimeout(() => {
      if (retryRemaining <= 1) {
        setRetryRemaining(null);
        setError(null);
      } else {
        setRetryRemaining(retryRemaining - 1);
      }
    }, 1000);
    return () => window.clearTimeout(t);
  }, [retryRemaining]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting || retryRemaining !== null) return;
      if (!password) {
        setError({ kind: "transient", message: t("auth.step_up.error_password_required") });
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        let res: StepUpAnswer;
        try {
          res = await postStepUp({ password, ...(catalogWindow ? { catalogWindow: true } : {}), ...(purpose ? { purpose } : {}) });
        } catch {
          setError({ kind: "transient", message: t("auth.step_up.error_network") });
          return;
        }
        if (res.ok) {
          await onConfirm();
          return;
        }
        if (res.type === "opaqueredirect") {
          // The proxy 307'd (expired JWT) — the session is gone, the password was never checked.
          onCancel();
          goSignIn();
          return;
        }
        const body = res.body;
        if (res.status === 401 && body.code !== "invalid_credentials") {
          // Session itself is dead (requireSession's 401) — sign in again rather than "wrong password".
          onCancel();
          goSignIn();
          return;
        }
        if (res.status === 401) {
          setError({ kind: "wrong_password" });
          return;
        }
        if (res.status === 403 && body.code === "step_up_not_available") {
          setError({
            kind: "not_available",
            message: body.message ?? t("auth.step_up.error_not_available"),
          });
          return;
        }
        if (res.status === 423 && body.code === "account_locked") {
          const seconds = body.retry_after_seconds ?? 60;
          setError({ kind: "locked", retryAfterSeconds: seconds });
          setRetryRemaining(seconds);
          return;
        }
        setError({ kind: "transient", message: t("auth.step_up.error_generic") });
      } catch {
        setError({ kind: "transient", message: t("auth.step_up.error_network") });
      } finally {
        setSubmitting(false);
      }
    },
    [password, submitting, retryRemaining, onConfirm, onCancel, t, purpose, catalogWindow],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!submitting) onCancel();
      }
    },
    [submitting, onCancel],
  );

  if (!open) return null;

  const isLocked = retryRemaining !== null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-up-title"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-co-text/60 backdrop-blur-sm px-4 py-6"
    >
      <div className="w-full max-w-sm rounded-2xl border-2 border-co-border bg-co-surface p-6 shadow-2xl">
        <h2 id="step-up-title" className="text-xl font-extrabold leading-tight text-co-text">
          {t("auth.step_up.title")}
        </h2>
        <p className="mt-2 text-sm text-co-text-muted">
          {t("auth.step_up.subtitle")}
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="step-up-password"
              className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim"
            >
              {t("auth.step_up.password_label")}
            </label>
            <input
              ref={inputRef}
              id="step-up-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={submitting || isLocked}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error && error.kind !== "locked") setError(null);
              }}
              aria-invalid={!!error}
              className={`
                min-h-[52px] w-full rounded-xl border-2 bg-co-surface px-4 py-3
                text-base text-co-text placeholder:text-co-text-faint
                focus:outline-none focus:ring-4 focus:ring-co-gold/60
                disabled:opacity-50
                ${error ? "border-co-cta-text" : "border-co-border-2"}
              `}
            />
            {error && error.kind === "wrong_password" && (
              <p role="alert" className="text-sm font-semibold text-co-cta-text">
                {t("auth.step_up.error_wrong_password")}
              </p>
            )}
            {error && error.kind === "not_available" && (
              <p role="alert" className="text-sm font-semibold text-co-cta-text">
                {error.message}
              </p>
            )}
            {error && error.kind === "transient" && (
              <p role="alert" className="text-sm font-semibold text-co-cta-text">
                {error.message}
              </p>
            )}
          </div>

          {isLocked && retryRemaining !== null && (
            <div
              role="alert"
              className="rounded-xl border-2 border-co-cta-text bg-co-cta/10 px-4 py-3 text-center"
            >
              <p className="text-sm font-bold uppercase tracking-wide text-co-cta-text">
                {t("auth.step_up.locked_title")}
              </p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-co-text">
                {formatRemaining(retryRemaining)}
              </p>
              <p className="mt-1 text-xs text-co-text-muted">
                {t("auth.step_up.locked_body", { time: formatRemaining(retryRemaining) })}
              </p>
            </div>
          )}

          <div className="mt-2 flex flex-col gap-3">
            <button
              type="submit"
              disabled={submitting || isLocked}
              className="
                inline-flex min-h-[52px] items-center justify-center rounded-xl
                bg-co-text px-4 py-3 text-base font-bold uppercase tracking-[0.12em]
                text-co-cta shadow-sm transition
                hover:bg-co-text/90 hover:shadow-md
                active:translate-y-px
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                disabled:cursor-not-allowed disabled:opacity-50
              "
            >
              {submitting ? t("auth.step_up.confirming") : t("auth.step_up.confirm")}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="
                inline-flex min-h-[52px] items-center justify-center rounded-xl
                border-2 border-co-border-2 bg-co-surface px-4 py-3 text-sm
                font-semibold text-co-text-muted transition
                hover:border-co-text hover:text-co-text
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                disabled:cursor-not-allowed disabled:opacity-50
              "
            >
              {t("auth.step_up.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
