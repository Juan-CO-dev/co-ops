"use client";

/**
 * /verify — Email verification + password setup. Phase 2 Session 4.
 *
 * Entry: link from the Resend onboarding email containing ?token=<64-hex>.
 *
 * Flow:
 *   1. Read token from URL on mount.
 *   2. Render set-password form (no back button — user came from email).
 *   3. POST /api/auth/verify with { token, password }.
 *   4. 200 → API set the session cookie; navigate to /dashboard.
 *   5. 400 invalid_token → dead-end card "This verification link is invalid
 *      or has already been used. Contact your manager." External response is
 *      constant-shape on any token failure (Session 3 lock).
 *   6. Network/server error → top toast.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthShell } from "@/components/auth/AuthShell";
import { SetPasswordForm, type SetPasswordResult } from "@/components/auth/SetPasswordForm";

const HEX_TOKEN_RE = /^[0-9a-f]{64}$/i;

export default function VerifyPage() {
  // Suspense required by Next 16 — VerifyPageContent reads useSearchParams().
  return (
    <Suspense fallback={null}>
      <VerifyPageContent />
    </Suspense>
  );
}

function VerifyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenParam = searchParams?.get("token") ?? "";
  const tokenValid = HEX_TOKEN_RE.test(tokenParam);

  const [deadEnd, setDeadEnd] = useState<null | "missing" | "invalid">(
    !tokenParam ? "missing" : !tokenValid ? "invalid" : null,
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
        const res = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: tokenParam, password }),
          redirect: "manual",
        });
        if (res.ok) {
          router.push("/dashboard");
          return { ok: true };
        }
        const body = (await res.json().catch(() => ({}))) as { code?: string; field?: string; message?: string };
        if (res.status === 400 && body.code === "invalid_token") {
          return { ok: false, kind: "invalid_token" };
        }
        if (res.status === 400 && body.code === "invalid_payload" && body.field === "password") {
          return { ok: false, kind: "validation", message: body.message ?? "Password too short." };
        }
        if (res.status === 403 && body.code === "account_inactive") {
          return {
            ok: false,
            kind: "validation",
            message: "This account is inactive. Contact your manager.",
          };
        }
        return { ok: false, kind: "transient", message: "Something went wrong. Try again." };
      } catch {
        return { ok: false, kind: "transient", message: "Network error. Check your connection." };
      }
    },
    [tokenParam, router],
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

      {deadEnd ? (
        <DeadEndCard
          title="Link not valid"
          message={
            deadEnd === "missing"
              ? "This page expects a verification link from your invitation email. Open the link from the email."
              : "This verification link is invalid or has already been used. Contact your manager."
          }
        />
      ) : (
        <div className="mt-2">
          <h2 className="mb-1 mt-2 text-center text-2xl font-extrabold leading-tight text-co-text">
            Set your password
          </h2>
          <p className="mb-5 text-center text-sm text-co-text-muted">
            Once your password is set, you'll be signed in automatically.
          </p>
          <div className="rounded-2xl border-2 border-co-border bg-co-surface p-5 shadow-sm sm:p-6">
            <SetPasswordForm
              submitLabel="Set password & sign in"
              onSubmit={handleSubmit}
              onInvalidToken={() => setDeadEnd("invalid")}
              onTransientError={showToast}
            />
          </div>
        </div>
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
