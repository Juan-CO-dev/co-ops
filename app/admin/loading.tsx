/**
 * Admin route-group loading UI.
 *
 * Shown by the App Router during server-component navigation across ALL admin
 * routes (hub, sections, drill-ins) — instant branded feedback instead of a
 * blank pause while the next segment streams. The admin subtree previously had
 * no loading.tsx (the operator group has one); on a cold cache the hub rendered
 * a blank div while auth ran.
 *
 * Intentionally dependency-free: no session read, no i18n, no client hooks. A
 * loading fallback must render instantly and identically regardless of locale
 * or auth state, so it mirrors the authed group's shell (brand wordmark +
 * breathing mark on the Mayo background).
 */

import { BrandMark } from "@/components/BrandMark";

export default function AdminLoading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-co-bg px-6 text-co-text"
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
