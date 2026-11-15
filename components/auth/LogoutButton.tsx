"use client";

/**
 * LogoutButton — Phase 2 Session 4.
 *
 * Small client component. POSTs /api/auth/logout (idempotent, public path —
 * the server revokes the session the request carried; a confirmed end sets no
 * cookie, so a slow response cannot clear a later sign-in), then router.push('/')
 * for a fresh login surface. An end the server cannot confirm (round 6: 503,
 * or a network failure) is retried briefly by lib/logout-client.ts behind an
 * opaque cover; the page goes to the login surface either way. Once the request
 * has settled the other tabs of this session are told too (round 9, the shared
 * signOutAndBroadcast), so none keeps the signed-out page open.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { actionButtonClass } from "@/components/ActionButton";
import { SigningOutOverlay } from "@/components/auth/SigningOutOverlay";
import { useTranslation } from "@/lib/i18n/provider";
import { signOutAndBroadcast } from "@/lib/logout-client";

export interface LogoutButtonProps {
  /** The session this page was served for (required, round 7) — every attempt names it, so it can never end a newer one. */
  sessionId: string;
}

export function LogoutButton({ sessionId }: LogoutButtonProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const onClick = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    // Intent-honoring: an unconfirmed end is retried briefly (round 6), the other tabs are told once it settles
    // (round 9), then navigate regardless.
    await signOutAndBroadcast(sessionId, "logout");
    router.push("/");
  }, [router, submitting, sessionId]);

  return (
    <>
      {submitting ? <SigningOutOverlay /> : null}
      <button
        type="button"
        onClick={onClick}
        disabled={submitting}
        className={actionButtonClass("secondary")}
      >
        {submitting ? t("auth.logout.submitting") : t("auth.logout.label")}
      </button>
    </>
  );
}
