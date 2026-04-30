"use client";

/**
 * SetPasswordForm — Phase 2 Session 4.
 *
 * Shared form for /verify and /reset-password. Two fields (new password +
 * confirm) with client-side validation, submits to a parent-supplied async
 * handler that returns the API result.
 *
 * Min length is 8 client-side, matching server MIN_PASSWORD_LENGTH in
 * /api/auth/verify and /api/auth/password-reset (NIST 800-63B current
 * guidance allows min-8 with strong hashing — bcrypt cost 12 here).
 */

import { useCallback, useState } from "react";

const CLIENT_MIN_PASSWORD_LENGTH = 8;

export type SetPasswordResult =
  | { ok: true }
  | { ok: false; kind: "invalid_token" }
  | { ok: false; kind: "validation"; message: string }
  | { ok: false; kind: "transient"; message: string };

export interface SetPasswordFormProps {
  submitLabel: string;
  onSubmit: (password: string) => Promise<SetPasswordResult>;
  onInvalidToken: () => void;
  onTransientError: (message: string) => void;
}

type FieldError = { field: "password" | "confirm"; message: string };

export function SetPasswordForm({
  submitLabel,
  onSubmit,
  onInvalidToken,
  onTransientError,
}: SetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting) return;
      setFieldError(null);

      if (!password) {
        setFieldError({ field: "password", message: "Password required." });
        return;
      }
      if (password.length < CLIENT_MIN_PASSWORD_LENGTH) {
        setFieldError({
          field: "password",
          message: `Password must be at least ${CLIENT_MIN_PASSWORD_LENGTH} characters.`,
        });
        return;
      }
      if (password !== confirm) {
        setFieldError({ field: "confirm", message: "Passwords don't match." });
        return;
      }

      setSubmitting(true);
      try {
        const result = await onSubmit(password);
        if (result.ok) return;
        if (result.kind === "invalid_token") {
          onInvalidToken();
          return;
        }
        if (result.kind === "validation") {
          setFieldError({ field: "password", message: result.message });
          return;
        }
        onTransientError(result.message);
      } catch {
        onTransientError("Network error. Check your connection and try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [password, confirm, submitting, onSubmit, onInvalidToken, onTransientError],
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-password" className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
          New password
        </label>
        <input
          id="new-password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          disabled={submitting}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldError?.field === "password") setFieldError(null);
          }}
          aria-invalid={fieldError?.field === "password"}
          aria-describedby={fieldError?.field === "password" ? "new-password-error" : "new-password-hint"}
          className={`
            min-h-[52px] w-full rounded-xl border-2 bg-co-surface px-4 py-3
            text-base text-co-text placeholder:text-co-text-faint
            focus:outline-none focus:ring-4 focus:ring-co-gold/60
            disabled:opacity-50
            ${fieldError?.field === "password" ? "border-co-cta" : "border-co-border-2"}
          `}
        />
        {fieldError?.field === "password" ? (
          <p id="new-password-error" role="alert" className="text-sm font-semibold text-co-cta">
            {fieldError.message}
          </p>
        ) : (
          <p id="new-password-hint" className="text-xs text-co-text-dim">
            At least {CLIENT_MIN_PASSWORD_LENGTH} characters.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm-password" className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
          Confirm password
        </label>
        <input
          id="confirm-password"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          disabled={submitting}
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            if (fieldError?.field === "confirm") setFieldError(null);
          }}
          aria-invalid={fieldError?.field === "confirm"}
          aria-describedby={fieldError?.field === "confirm" ? "confirm-password-error" : undefined}
          className={`
            min-h-[52px] w-full rounded-xl border-2 bg-co-surface px-4 py-3
            text-base text-co-text placeholder:text-co-text-faint
            focus:outline-none focus:ring-4 focus:ring-co-gold/60
            disabled:opacity-50
            ${fieldError?.field === "confirm" ? "border-co-cta" : "border-co-border-2"}
          `}
        />
        {fieldError?.field === "confirm" && (
          <p id="confirm-password-error" role="alert" className="text-sm font-semibold text-co-cta">
            {fieldError.message}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
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
        {submitting ? <Spinner /> : submitLabel}
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
