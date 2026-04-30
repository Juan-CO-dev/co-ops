"use client";

/**
 * LogoutButton — Phase 2 Session 4.
 *
 * Small client component. POSTs /api/auth/logout (idempotent, public path —
 * server clears the cookie regardless of session state), then router.push('/')
 * for a fresh login surface.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const onClick = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", redirect: "manual" });
    } catch {
      // Logout is intent-honoring; navigate regardless.
    }
    router.push("/");
  }, [router, submitting]);

  return (
    <button
      type="button"
      onClick={onClick}
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
      {submitting ? "Signing out…" : "Log out"}
    </button>
  );
}
