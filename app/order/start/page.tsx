"use client";
/**
 * /order/start — Catering ENTRY FLOW (mockup pass v1).
 *
 * MOCKUP: interactive client prototype (no backend/auth). The gate before the builder:
 *  - New client → intake form (name, email, company, event date, headcount, delivery/pickup)
 *    → email-verify → account created → into the builder (headcount carried via ?guests).
 *  - Returning → sign in (email → magic-link) → into the builder.
 * Email = the account identity; every order is tied to a verified email. Email delivery isn't
 * wired in the mockup, so the verify screen has a "continue (preview)" that simulates the
 * confirmed link. Same style + feel as the storefront.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function OrderStart() {
  const router = useRouter();
  const [mode, setMode] = useState<"new" | "returning">("new");
  const [sent, setSent] = useState(false);
  const [f, setF] = useState({ name: "", email: "", company: "", date: "", guests: "20", fulfillment: "delivery" as "delivery" | "pickup", location: "Capitol Hill", address: "" });
  const set = (patch: Partial<typeof f>) => setF((cur) => ({ ...cur, ...patch }));

  const go = () => router.push(`/order/build?guests=${encodeURIComponent(f.guests || "20")}`);
  const canSubmit = mode === "returning" ? f.email.includes("@") : f.name.trim() && f.email.includes("@") && f.date;

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
          {sent ? (
            <div className="rounded-3xl border border-co-border/70 bg-co-surface p-8 text-center shadow-sm sm:p-10">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-co-gold/40 text-3xl">✉️</div>
              <h1 className="mt-5 text-2xl font-extrabold text-co-text">Check your email</h1>
              <p className="mx-auto mt-2 max-w-sm text-co-text-muted">We sent a link to <span className="font-bold text-co-text">{f.email || "your inbox"}</span> to {mode === "new" ? "confirm your order and set up your account" : "sign you in"}. Click it and you'll pick up right where you left off.</p>
              <button type="button" onClick={go} className="mt-7 inline-flex min-h-[52px] w-full items-center justify-center rounded-full bg-co-text px-8 text-base font-bold uppercase tracking-[0.08em] text-co-cta transition hover:bg-co-text/90">Continue to your order →</button>
              <p className="mt-3 text-xs text-co-text-dim">(Preview — email isn't live yet, so this button stands in for the verified link.)</p>
            </div>
          ) : (
            <div className="rounded-3xl border border-co-border/70 bg-co-surface p-8 shadow-sm sm:p-10">
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">{mode === "new" ? "Start your order" : "Welcome back"}</p>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text">{mode === "new" ? "Let's cater your event." : "Sign in to keep ordering."}</h1>

              <div className="mt-6 flex flex-col gap-4">
                {mode === "new" && (
                  <Field label="Your name">
                    <input value={f.name} onChange={(e) => set({ name: e.target.value })} className="inp" placeholder="Jane Rivera" />
                  </Field>
                )}
                <Field label="Email" hint="This is your login — we'll email a link to confirm.">
                  <input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} className="inp" placeholder="jane@company.com" />
                </Field>

                {mode === "new" && (
                  <>
                    <Field label="Company (optional)">
                      <input value={f.company} onChange={(e) => set({ company: e.target.value })} className="inp" placeholder="Acme Co." />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Event date"><input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} className="inp" /></Field>
                      <Field label="Guests"><input type="number" min={1} value={f.guests} onChange={(e) => set({ guests: e.target.value })} className="inp" /></Field>
                    </div>
                    <Field label="Delivery or pickup?">
                      <div className="flex gap-2">
                        {(["delivery", "pickup"] as const).map((opt) => (
                          <button key={opt} type="button" onClick={() => set({ fulfillment: opt })} className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-bold capitalize transition ${f.fulfillment === opt ? "border-co-text bg-co-text text-co-bg" : "border-co-border-2 bg-co-surface text-co-text-muted hover:text-co-text"}`}>{opt}</button>
                        ))}
                      </div>
                    </Field>
                    {f.fulfillment === "pickup" ? (
                      <Field label="Pickup location">
                        <div className="flex gap-2">
                          {["Capitol Hill", "Dupont Circle"].map((loc) => (
                            <button key={loc} type="button" onClick={() => set({ location: loc })} className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-bold transition ${f.location === loc ? "border-co-text bg-co-text/10 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-muted hover:text-co-text"}`}>{loc}</button>
                          ))}
                        </div>
                      </Field>
                    ) : (
                      <Field label="Delivery address"><input value={f.address} onChange={(e) => set({ address: e.target.value })} className="inp" placeholder="Street, city, ZIP" /></Field>
                    )}
                  </>
                )}
              </div>

              <button type="button" disabled={!canSubmit} onClick={() => setSent(true)} className={`mt-7 flex min-h-[52px] w-full items-center justify-center rounded-full text-base font-bold uppercase tracking-[0.08em] transition ${canSubmit ? "bg-co-text text-co-cta hover:bg-co-text/90" : "cursor-not-allowed bg-co-border text-co-text-dim"}`}>
                {mode === "new" ? "Continue →" : "Send me a sign-in link →"}
              </button>

              <p className="mt-5 text-center text-sm text-co-text-muted">
                {mode === "new" ? (
                  <>Ordered with us before? <button type="button" onClick={() => setMode("returning")} className="font-bold text-co-text underline decoration-co-gold decoration-2 underline-offset-4">Sign in</button></>
                ) : (
                  <>New here? <button type="button" onClick={() => setMode("new")} className="font-bold text-co-text underline decoration-co-gold decoration-2 underline-offset-4">Start an order</button></>
                )}
              </p>
            </div>
          )}
          <p className="mt-6 text-center text-xs text-co-text-dim">Your email is your account — one order history, no passwords to remember.</p>
        </div>
      </main>

      <style>{`.inp{min-height:48px;width:100%;border-radius:0.75rem;border:2px solid var(--co-border-2,#e6ddc0);background:var(--co-surface,#fffdf5);padding:0 0.85rem;font-size:0.95rem;color:var(--co-text,#141414)}`}</style>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-co-text-dim">{hint}</span>}
    </label>
  );
}
