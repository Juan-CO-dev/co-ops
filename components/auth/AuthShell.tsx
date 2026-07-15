/**
 * AuthShell — Phase 2 Session 4.
 *
 * Shared brand layout for unauthenticated pages (verify, reset). Mustard band
 * + max-w-md centered body wrapper. Mirrors app/page.tsx so surfaces feel
 * consistent. Server Component — no interactivity, just layout chrome.
 */

import type { ReactNode } from "react";

/**
 * Content width. "focused" is the mobile-first centered column (auth pages,
 * forms). "wide" ramps up on larger screens so content-rich surfaces (the
 * dashboard) use desktop space instead of sitting in a narrow ribbon. Phone
 * width is identical for both (max-w-md fills a phone) — the ramp starts at md/lg.
 */
const WIDTH_CLASS = {
  focused: "max-w-md",
  wide: "max-w-md md:max-w-2xl lg:max-w-5xl xl:max-w-6xl",
} as const;

export function AuthShell({
  children,
  width = "focused",
}: {
  children: ReactNode;
  width?: keyof typeof WIDTH_CLASS;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-co-bg">
      <header className="flex flex-col items-center justify-center bg-co-gold px-6 py-5 sm:py-6">
        <h1
          className="
            text-center font-extrabold uppercase leading-none tracking-[-0.02em]
            text-co-text text-[28px] sm:text-[32px]
          "
          style={{ fontFamily: "var(--font-display)" }}
        >
          Compliments Only
        </h1>
        <p className="mt-1 text-center text-[10px] font-bold uppercase tracking-[0.32em] text-co-text/70">
          Operations
        </p>
      </header>
      <section className={`mx-auto flex w-full flex-1 flex-col px-4 py-8 sm:px-6 ${WIDTH_CLASS[width]}`}>
        {children}
      </section>
    </main>
  );
}
