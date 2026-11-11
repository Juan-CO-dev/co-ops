"use client";

export default function OrderError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-co-bg px-6 text-center text-co-text">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/co-wordmark.svg" alt="Compliments Only" className="h-6 w-auto sm:h-7" />
      <div className="max-w-sm">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="text-lg font-semibold text-co-text-muted">Algo salió mal</p>
        <p className="mt-3 text-sm text-co-text-muted">
          Try again, or return to catering. / Reintenta o vuelve a catering.
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
          href="/order"
          className="rounded-full border-2 border-co-border bg-co-surface px-5 py-2.5 text-sm font-semibold text-co-text transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold"
        >
          Catering · Catering
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
