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

import { actionButtonClass } from "@/components/ActionButton";
import { useTranslation } from "@/lib/i18n/provider";

export function LogoutButton() {
  const { t } = useTranslation();
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
      className={actionButtonClass("secondary")}
    >
      {submitting ? t("auth.logout.submitting") : t("auth.logout.label")}
    </button>
  );
}
