"use client";

/**
 * ManagerLoginForm — Phase 2 Session 4.
 *
 * Email + password sign-in for level 5+ users. Calls POST /api/auth/password.
 *
 * Response handling (Session 3 locked shapes):
 *   200 → onSuccess() (parent navigates to /dashboard)
 *   401 invalid_credentials      → inline error under password field
 *   403 account_inactive         → inline error under password field
 *   403 email_not_verified       → inline error under email field
 *   423 account_locked           → full-width banner with live countdown
 *   network/server               → top toast via onTransientError
 *
 * Forgot password: POSTs the current email value to
 * /api/auth/password-reset-request. The route returns constant-shape 200 on
 * any state (Session 3 lock — no enumeration). Form shows the same
 * "If an account exists for this email, a reset link has been sent." message
 * either way.
 */

import { useCallback, useEffect, useState } from "react";

const MIN_PASSWORD_LENGTH = 8;

export interface ManagerLoginFormProps {
  onSuccess: () => void;
  onTransientError: (message: string) => void;
}

type FieldError = { field: "email" | "password"; message: string };

type LockState = { until: number; remaining: number };

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function ManagerLoginForm({ onSuccess, onTransientError }: ManagerLoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [lock, setLock] = useState<LockState | null>(null);

  const [resetRequesting, setResetRequesting] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Live lockout countdown
  useEffect(() => {
    if (!lock) return;
    if (lock.remaining <= 0) {
      setLock(null);
      return;
    }
    const t = window.setTimeout(() => {
      setLock((prev) => (prev ? { ...prev, remaining: prev.remaining - 1 } : null));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [lock]);

  const submit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting || lock) return;
      setFieldError(null);
      setResetSent(false);

      if (!email.trim()) {
        setFieldError({ field: "email", message: "Email required." });
        return;
      }
      if (!isValidEmail(email)) {
        setFieldError({ field: "email", message: "Enter a valid email address." });
        return;
      }
      if (!password) {
        setFieldError({ field: "password", message: "Password required." });
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setFieldError({
          field: "password",
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        });
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch("/api/auth/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
          redirect: "manual",
        });
        if (res.ok) {
          onSuccess();
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          retry_after_seconds?: number;
        };
        if (res.status === 423 && body.code === "account_locked") {
          const seconds = body.retry_after_seconds ?? 60;
          setLock({ until: Date.now() + seconds * 1000, remaining: seconds });
          return;
        }
        if (res.status === 403 && body.code === "email_not_verified") {
          setFieldError({
            field: "email",
            message: "Email not verified yet. Check your inbox for the verification link.",
          });
          return;
        }
        if (res.status === 403 && body.code === "account_inactive") {
          setFieldError({
            field: "password",
            message: "This account is inactive. Ask an admin.",
          });
          return;
        }
        if (res.status === 401) {
          setFieldError({
            field: "password",
            message: "Wrong email or password.",
          });
          return;
        }
        onTransientError("Something went wrong. Try again.");
      } catch {
        onTransientError("Network error. Check your connection and try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, submitting, lock, onSuccess, onTransientError],
  );

  const requestReset = useCallback(async () => {
    if (resetRequesting || lock) return;
    setFieldError(null);
    if (!email.trim() || !isValidEmail(email)) {
      setFieldError({ field: "email", message: "Enter your email above first." });
      return;
    }
    setResetRequesting(true);
    try {
      const res = await fetch("/api/auth/password-reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
        redirect: "manual",
      });
      if (res.ok) {
        setResetSent(true);
      } else {
        onTransientError("Couldn't send reset link. Try again.");
      }
    } catch {
      onTransientError("Network error. Check your connection and try again.");
    } finally {
      setResetRequesting(false);
    }
  }, [email, resetRequesting, lock, onTransientError]);

  const isLocked = lock !== null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="manager-email" className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
          Email
        </label>
        <input
          id="manager-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          required
          disabled={submitting || isLocked}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldError?.field === "email") setFieldError(null);
            if (resetSent) setResetSent(false);
          }}
          aria-invalid={fieldError?.field === "email"}
          aria-describedby={fieldError?.field === "email" ? "manager-email-error" : undefined}
          className={`
            min-h-[52px] w-full rounded-xl border-2 bg-co-surface px-4 py-3
            text-base text-co-text placeholder:text-co-text-faint
            focus:outline-none focus:ring-4 focus:ring-co-gold/60
            disabled:opacity-50
            ${fieldError?.field === "email" ? "border-co-cta" : "border-co-border-2"}
          `}
          placeholder="you@complimentsonlysubs.com"
        />
        {fieldError?.field === "email" && (
          <p id="manager-email-error" role="alert" className="text-sm font-semibold text-co-cta">
            {fieldError.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="manager-password" className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
          Password
        </label>
        <input
          id="manager-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={submitting || isLocked}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldError?.field === "password") setFieldError(null);
          }}
          aria-invalid={fieldError?.field === "password"}
          aria-describedby={fieldError?.field === "password" ? "manager-password-error" : undefined}
          className={`
            min-h-[52px] w-full rounded-xl border-2 bg-co-surface px-4 py-3
            text-base text-co-text placeholder:text-co-text-faint
            focus:outline-none focus:ring-4 focus:ring-co-gold/60
            disabled:opacity-50
            ${fieldError?.field === "password" ? "border-co-cta co-shake" : "border-co-border-2"}
          `}
        />
        {fieldError?.field === "password" && (
          <p id="manager-password-error" role="alert" className="text-sm font-semibold text-co-cta">
            {fieldError.message}
          </p>
        )}
      </div>

      {isLocked && lock && (
        <div
          role="alert"
          className="rounded-xl border-2 border-co-cta bg-co-cta/10 px-4 py-3 text-center"
        >
          <p className="text-sm font-bold uppercase tracking-wide text-co-cta">
            Account locked
          </p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-co-text">
            {formatRemaining(lock.remaining)}
          </p>
          <p className="mt-1 text-xs text-co-text-muted">
            Too many failed attempts. Try again in {formatRemaining(lock.remaining)}.
          </p>
        </div>
      )}

      {resetSent && (
        <div
          role="status"
          className="rounded-xl border-2 border-co-border-2 bg-co-surface-2 px-4 py-3 text-sm text-co-text"
        >
          If an account exists for this email, a reset link has been sent.
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || isLocked}
        className="
          mt-1 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl
          bg-co-text px-4 py-3 text-base font-bold uppercase tracking-[0.12em]
          text-co-cta shadow-sm transition
          hover:bg-co-text/90 hover:shadow-md
          active:translate-y-px
          focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          disabled:cursor-not-allowed disabled:opacity-50
        "
      >
        {submitting ? <Spinner /> : "Sign in"}
      </button>

      <button
        type="button"
        onClick={requestReset}
        disabled={resetRequesting || submitting || isLocked}
        className="
          self-center px-2 py-2 text-sm font-semibold text-co-text-dim
          underline-offset-2 hover:text-co-text hover:underline
          focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold
          disabled:opacity-50
        "
      >
        {resetRequesting ? "Sending…" : "Forgot password?"}
      </button>
    </form>
  );
}

function Spinner() {
  return (
    <span
      aria-label="Loading"
      className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-co-cta/40 border-t-co-cta"
    />
  );
}
