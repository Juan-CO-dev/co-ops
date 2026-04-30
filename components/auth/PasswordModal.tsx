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
 *   401 unauthorized             → onCancel (parent's protected-route
 *                                  enforcement bounces user to login)
 *   network/server               → inline error
 *
 * NO LOCKOUT on repeated step-up failures (locked Phase 2 Session 3 — actor is
 * already authenticated; locking them out of admin doesn't meaningfully raise
 * the bar). Audit captures every failure for forensic visibility.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface PasswordModalProps {
  open: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
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

export function PasswordModal({ open, onConfirm, onCancel }: PasswordModalProps) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ModalError | null>(null);
  const [retryRemaining, setRetryRemaining] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state on open + focus the input.
  useEffect(() => {
    if (open) {
      setPassword("");
      setError(null);
      setSubmitting(false);
      setRetryRemaining(null);
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // Live lockout countdown.
  useEffect(() => {
    if (retryRemaining === null) return;
    if (retryRemaining <= 0) {
      setError(null);
      setRetryRemaining(null);
      return;
    }
    const t = window.setTimeout(() => {
      setRetryRemaining((s) => (s === null ? null : s - 1));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [retryRemaining]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting || retryRemaining !== null) return;
      if (!password) {
        setError({ kind: "transient", message: "Password required." });
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/step-up", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
          redirect: "manual",
        });
        if (res.ok) {
          await onConfirm();
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
          retry_after_seconds?: number;
        };
        if (res.status === 401 && body.code === "unauthorized") {
          // Session itself is dead — let parent's enforcement handle re-auth.
          onCancel();
          return;
        }
        if (res.status === 401) {
          setError({ kind: "wrong_password" });
          return;
        }
        if (res.status === 403 && body.code === "step_up_not_available") {
          setError({
            kind: "not_available",
            message: body.message ?? "Step-up not available for your role.",
          });
          return;
        }
        if (res.status === 423 && body.code === "account_locked") {
          const seconds = body.retry_after_seconds ?? 60;
          setError({ kind: "locked", retryAfterSeconds: seconds });
          setRetryRemaining(seconds);
          return;
        }
        setError({ kind: "transient", message: "Something went wrong. Try again." });
      } catch {
        setError({ kind: "transient", message: "Network error. Try again." });
      } finally {
        setSubmitting(false);
      }
    },
    [password, submitting, retryRemaining, onConfirm, onCancel],
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-co-text/60 backdrop-blur-sm px-4 py-6"
    >
      <div className="w-full max-w-sm rounded-2xl border-2 border-co-border bg-co-surface p-6 shadow-2xl">
        <h2 id="step-up-title" className="text-xl font-extrabold leading-tight text-co-text">
          Confirm your password
        </h2>
        <p className="mt-2 text-sm text-co-text-muted">
          Re-enter your password to confirm this action.
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="step-up-password"
              className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim"
            >
              Password
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
                ${error ? "border-co-cta" : "border-co-border-2"}
              `}
            />
            {error && error.kind === "wrong_password" && (
              <p role="alert" className="text-sm font-semibold text-co-cta">
                Wrong password.
              </p>
            )}
            {error && error.kind === "not_available" && (
              <p role="alert" className="text-sm font-semibold text-co-cta">
                {error.message}
              </p>
            )}
            {error && error.kind === "transient" && (
              <p role="alert" className="text-sm font-semibold text-co-cta">
                {error.message}
              </p>
            )}
          </div>

          {isLocked && retryRemaining !== null && (
            <div
              role="alert"
              className="rounded-xl border-2 border-co-cta bg-co-cta/10 px-4 py-3 text-center"
            >
              <p className="text-sm font-bold uppercase tracking-wide text-co-cta">
                Account locked
              </p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-co-text">
                {formatRemaining(retryRemaining)}
              </p>
              <p className="mt-1 text-xs text-co-text-muted">
                Try again in {formatRemaining(retryRemaining)}.
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
              {submitting ? "Confirming…" : "Confirm"}
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
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
