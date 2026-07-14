/**
 * Authed route-group loading UI.
 *
 * Shown by the App Router during server-component navigation across ALL
 * authenticated routes (dashboard, operations, reports, etc.) — instant
 * branded feedback instead of a blank pause while the next segment streams.
 *
 * Intentionally dependency-free: no session read, no i18n, no client hooks.
 * A loading fallback must render instantly and identically regardless of
 * locale or auth state, so it uses the brand wordmark + a gold spinner on
 * the app's Mayo background. Chrome matches the rest of the app
 * (co-bg / co-text / co-gold).
 */

export default function AuthedLoading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-co-bg px-6 text-co-text"
    >
      {/* Brand rule: wordmark is customized art — render the asset, don't typeset it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/co-wordmark.png" alt="Compliments Only" className="h-6 w-auto sm:h-7" />
      <span
        aria-hidden
        className="h-9 w-9 animate-spin rounded-full border-4 border-co-border border-t-co-gold"
      />
      <span className="sr-only">Loading…</span>
    </main>
  );
}
