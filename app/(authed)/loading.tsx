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
      <span className="text-xl font-bold uppercase tracking-[0.18em] text-co-text">
        Compliments Only
      </span>
      <span
        aria-hidden
        className="h-9 w-9 animate-spin rounded-full border-4 border-co-border border-t-co-gold"
      />
      <span className="sr-only">Loading…</span>
    </main>
  );
}
