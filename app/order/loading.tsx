/**
 * /order route-group loading UI (public customer funnel — /order, /order/start,
 * /order/build, /order/review, /order/quote/[id], /order/account, /order/verify).
 *
 * Shown by the App Router during server-component navigation across the public
 * ordering funnel — instant branded feedback instead of a blank pause while the
 * next segment streams. Mirrors the authed group's shell exactly (council C2
 * adoption sweep — this route group had no loading.tsx at all).
 *
 * Intentionally dependency-free: no session read, no i18n, no client hooks. A
 * loading fallback must render instantly and identically regardless of locale
 * or auth state, so it uses the brand wordmark + a gold spinner. TRANSPARENT
 * background: the body already paints the app's Mayo gradient (see
 * globals.css) — a flat bg-co-bg here would flash against it on every
 * navigation.
 */

import { BrandMark } from "@/components/BrandMark";

export default function OrderLoading() {
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
