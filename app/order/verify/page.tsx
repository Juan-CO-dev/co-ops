"use client";
/**
 * /order/verify — Magic-link landing page (Portal-2).
 *
 * The emailed link points here: /order/verify?token=<raw>.
 *
 * HARD RULES (enforced for Next 16 static prerender compatibility):
 *  1. Read the token from window.location.search inside useEffect — do NOT
 *     use useSearchParams(), which requires a <Suspense> boundary at build.
 *  2. POST the token from the effect on mount (client JS). Email scanners
 *     prefetch links but don't run JS, so a client-side POST-on-mount avoids
 *     burning the single-use token on prefetch.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function OrderVerify() {
  const router = useRouter();
  const [state, setState] = useState<"verifying" | "error">("verifying");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("error");
      return;
    }
    // A-WA-L3: scrub the single-use token from the URL immediately so it can't leak via browser
    // history or the Referer header of any subsequent request / asset load within the 30-min TTL.
    window.history.replaceState(null, "", window.location.pathname);
    (async () => {
      try {
        const res = await fetch("/api/portal/magic-link/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          next?: string;
        };
        if (res.ok && data.ok) {
          router.push(typeof data.next === "string" ? data.next : "/order/build");
          return;
        }
        setState("error");
      } catch {
        setState("error");
      }
    })();
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col bg-co-bg text-co-text">
      <header className="border-b border-co-border/50 bg-co-text text-co-bg">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3.5">
          <Link href="/order" className="text-sm font-semibold text-co-bg/70 transition hover:text-co-bg">‹ Back</Link>
          <span className="text-sm font-extrabold uppercase tracking-[0.22em]">Compliments Only</span>
          <span className="w-10" />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-lg">
          <div className="rounded-3xl border border-co-border/70 bg-co-surface p-8 text-center shadow-sm sm:p-10">
            {state === "verifying" ? (
              <>
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-co-gold/40 text-3xl">✉️</div>
                <h1 className="mt-5 text-2xl font-extrabold text-co-text">Signing you in…</h1>
                <p className="mx-auto mt-2 max-w-sm text-co-text-muted">
                  Verifying your link — this only takes a moment.
                </p>
                <div className="mt-7 flex justify-center">
                  <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-co-gold border-t-transparent" />
                </div>
              </>
            ) : (
              <>
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-co-border/40 text-3xl">🔗</div>
                <h1 className="mt-5 text-2xl font-extrabold text-co-text">Link expired</h1>
                <p className="mx-auto mt-2 max-w-sm text-co-text-muted">
                  This link has expired or was already used. Magic links work once and expire in 30 minutes.
                </p>
                <Link
                  href="/order/start"
                  className="mt-7 inline-flex min-h-[52px] w-full items-center justify-center rounded-full bg-co-text px-8 text-base font-bold uppercase tracking-[0.08em] text-co-cta transition hover:bg-co-text/90"
                >
                  Request a new link →
                </Link>
              </>
            )}
          </div>
          <p className="mt-4 text-center text-xs text-co-text-dim">No passwords to remember — your email is your account.</p>
        </div>
      </main>
    </div>
  );
}
