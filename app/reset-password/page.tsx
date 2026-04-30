"use client";

/**
 * /reset-password — Password reset (level 5+). Phase 2 Session 4.
 *
 * Entry: link from the Resend password-reset email containing ?token=<64-hex>.
 *
 * Flow differs from /verify in one key way: NO auto-sign-in on success.
 * Reset implies "I forgot my password" — different threat model than email
 * verification (locked Phase 2 Session 3). Show success card with link to /
 * for fresh sign-in. The API also revokes ALL active sessions on success
 * (defense-in-depth: assume compromise).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AuthShell } from "@/components/auth/AuthShell";
import { SetPasswordForm, type SetPasswordResult } from "@/components/auth/SetPasswordForm";

const HEX_TOKEN_RE = /^[0-9a-f]{64}$/i;

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const tokenParam = searchParams?.get("token") ?? "";
  const tokenValid = HEX_TOKEN_RE.test(tokenParam);

  const [phase, setPhase] = useState<"form" | "success" | "missing" | "invalid">(
    !tokenParam ? "missing" : !tokenValid ? "invalid" : "form",
  );
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const handleSubmit = useCallback(
    async (password: string): Promise<SetPasswordResult> => {
      try {
        const res = await fetch("/api/auth/password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: tokenParam, password }),
          redirect: "manual",
        });
        if (res.ok) {
          setPhase("success");
          return { ok: true };
        }
        const body = (await res.json().catch(() => ({}))) as { code?: string; field?: string; message?: string };
        if (res.status === 400 && body.code === "invalid_token") {
          return { ok: false, kind: "invalid_token" };
        }
        if (res.status === 400 && body.code === "invalid_payload" && body.field === "password") {
          return { ok: false, kind: "validation", message: body.message ?? "Password too short." };
        }
        return { ok: false, kind: "transient", message: "Something went wrong. Try again." };
      } catch {
        return { ok: false, kind: "transient", message: "Network error. Check your connection." };
      }
    },
    [tokenParam],
  );

  return (
    <AuthShell>
      {toast && (
        <div role="alert" className="mb-4">
          <div className="rounded-xl border-2 border-co-cta bg-co-cta/10 px-4 py-3 text-center text-sm font-semibold text-co-text">
            {toast}
          </div>
        </div>
      )}

      {phase === "form" && (
        <div className="mt-2">
          <h2 className="mb-1 mt-2 text-center text-2xl font-extrabold leading-tight text-co-text">
            Reset password
          </h2>
          <p className="mb-5 text-center text-sm text-co-text-muted">
            Choose a new password. You'll sign in with it next.
          </p>
          <div className="rounded-2xl border-2 border-co-border bg-co-surface p-5 shadow-sm sm:p-6">
            <SetPasswordForm
              submitLabel="Update password"
              onSubmit={handleSubmit}
              onInvalidToken={() => setPhase("invalid")}
              onTransientError={showToast}
            />
          </div>
        </div>
      )}

      {phase === "success" && (
        <div className="mt-4 rounded-2xl border-2 border-co-border bg-co-surface p-6 shadow-sm">
          <h2 className="text-xl font-extrabold leading-tight text-co-text">Password updated</h2>
          <p className="mt-3 text-sm text-co-text-muted">
            Your password has been updated. Any active sessions have been signed out for security.
          </p>
          <a
            href="/"
            className="
              mt-5 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl
              bg-co-text px-4 py-3 text-base font-bold uppercase tracking-[0.12em]
              text-co-cta shadow-sm transition
              hover:bg-co-text/90 hover:shadow-md
            "
          >
            Sign in
          </a>
        </div>
      )}

      {(phase === "missing" || phase === "invalid") && (
        <DeadEndCard
          title="Link not valid"
          message={
            phase === "missing"
              ? "This page expects a reset link from your password-reset email. Open the link from the email."
              : "This reset link is invalid or has expired. Request a new one from the sign-in page."
          }
        />
      )}
    </AuthShell>
  );
}

function DeadEndCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="mt-4 rounded-2xl border-2 border-co-border bg-co-surface p-6 shadow-sm">
      <h2 className="text-xl font-extrabold leading-tight text-co-text">{title}</h2>
      <p className="mt-3 text-sm text-co-text-muted">{message}</p>
      <a
        href="/"
        className="
          mt-5 inline-flex items-center gap-1 text-sm font-semibold text-co-text
          underline-offset-2 hover:underline
        "
      >
        <span aria-hidden>←</span> Back to sign in
      </a>
    </div>
  );
}
