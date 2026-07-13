"use client";

/**
 * App-wide error boundary. Catches throws during render/data-loading in any
 * segment that doesn't define its own error.tsx (the whole app today).
 *
 * Locale-neutral by necessity: this renders *because* the subtree failed, so
 * there's no guarantee a TranslationProvider mounted — text is shown in both
 * EN + ES (the app's two languages) rather than defaulting to English only.
 * Branded chrome (Mayo bg / wordmark / Mustard CTA) matches loading.tsx.
 */

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-co-bg px-6 text-center text-co-text">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/co-wordmark.png" alt="Compliments Only" className="h-6 w-auto sm:h-7" />
      <div className="max-w-sm">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="text-lg font-semibold text-co-text-muted">Algo salió mal</p>
        <p className="mt-3 text-sm text-co-text-muted">
          An unexpected error occurred. Try again, or head back to your dashboard.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-co-gold px-5 py-2.5 text-sm font-bold text-co-text transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold-deep"
        >
          Try again · Reintentar
        </button>
        <a
          href="/dashboard"
          className="rounded-full border-2 border-co-border bg-co-surface px-5 py-2.5 text-sm font-semibold text-co-text transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold"
        >
          Dashboard · Panel
        </a>
      </div>
      {error.digest && (
        <p className="text-[11px] uppercase tracking-[0.14em] text-co-text-faint">
          ref {error.digest}
        </p>
      )}
    </main>
  );
}
