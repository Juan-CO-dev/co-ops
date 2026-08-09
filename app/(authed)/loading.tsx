/**
 * Authed route-group loading UI.
 *
 * Shown by the App Router during server-component navigation across ALL
 * authenticated routes (dashboard, operations, reports, etc.) — instant
 * branded feedback instead of a blank pause while the next segment streams.
 *
 * Intentionally dependency-free: no session read, no i18n, no client hooks.
 * A loading fallback must render instantly and identically regardless of
 * locale or auth state, so it uses the brand wordmark + a gold spinner.
 * TRANSPARENT background (council C2 fix): the body already paints the app's
 * Mayo gradient (see globals.css), so painting a flat bg-co-bg here caused a
 * visible flash against it on every navigation. Text stays co-text — it's
 * readable over the gradient without its own background.
 */

import { BrandMark } from "@/components/BrandMark";

export default function AuthedLoading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-co-text"
    >
      {/* The mark IS the loading indicator — it breathes (reduced-motion → static).
          Decorative: the wordmark below + the sr-only "Loading…" carry the meaning. */}
      <BrandMark size={72} decorative className="co-breathe" />
      {/* Brand rule: wordmark is customized art — render the asset, don't typeset it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/co-wordmark.png" alt="Compliments Only" className="h-8 w-auto sm:h-10" />
      <span className="sr-only">Loading…</span>
    </main>
  );
}
