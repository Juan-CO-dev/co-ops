/**
 * App-wide 404. Renders for notFound() calls (recipe/vendor detail pages) and
 * unmatched routes. Locale-neutral bilingual text; branded chrome matches
 * loading.tsx / error.tsx. Server component — no client hooks needed.
 */

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-co-bg px-6 text-center text-co-text">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/co-wordmark.png" alt="Compliments Only" className="h-6 w-auto sm:h-7" />
      <div className="max-w-sm">
        <p className="text-4xl font-extrabold tracking-tight text-co-gold-deep">404</p>
        <h1 className="mt-2 text-xl font-bold">Page not found</h1>
        <p className="text-lg font-semibold text-co-text-muted">Página no encontrada</p>
        <p className="mt-3 text-sm text-co-text-muted">
          That page doesn&apos;t exist or may have moved.
        </p>
      </div>
      <a
        href="/dashboard"
        className="rounded-full bg-co-gold px-5 py-2.5 text-sm font-bold text-co-text transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold-deep"
      >
        Dashboard · Panel
      </a>
    </main>
  );
}
