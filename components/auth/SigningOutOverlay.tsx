"use client";

/**
 * SigningOutOverlay — audit W06/B012 fix round 6.
 *
 * Covers the whole screen, opaque, while a sign-out is in flight (lib/logout-client.ts retries an unconfirmed one for
 * a few seconds). Once someone asked to sign out, nothing behind it can be read or tapped; the caller then goes to the
 * sign-in page, which unmounts it. Portaled to <body> so no parent stacking context (the UserMenu's z-30 row) can
 * leave page content above it. Rendered only after a click / the idle deadline, so `document` exists.
 */

import { createPortal } from "react-dom";

import { useTranslation } from "@/lib/i18n/provider";

export function SigningOutOverlay() {
  const { t } = useTranslation();
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-testid="signing-out-overlay"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-co-bg px-4"
    >
      <p className="text-center text-lg font-bold text-co-text">{t("auth.logout.submitting")}</p>
    </div>,
    document.body,
  );
}
