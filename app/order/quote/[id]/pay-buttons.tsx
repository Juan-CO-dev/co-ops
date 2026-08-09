"use client";
/**
 * Pay panel buttons for the shared quote view+pay surface (/order/quote/[id]).
 *
 * Each button POSTs { kind } to /api/portal/quote/[id]/pay. PAYMENT PROVIDER IS DEFERRED, so a
 * success surfaces the stub message rather than redirecting to a checkout — the intent is
 * recorded server-side. Options + amounts come from the server's paymentPlan (passed as props),
 * so the client never derives money.
 */

import { useState } from "react";

interface PayOption {
  kind: "deposit" | "full";
  amountCents: number;
  label: string;
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function PayButtons({ quoteId, options }: { quoteId: string; options: PayOption[] }) {
  const [pending, setPending] = useState<"deposit" | "full" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay(kind: "deposit" | "full") {
    setPending(kind);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/portal/quote/${quoteId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (res.ok) {
        setMessage(data.message ?? "Your order is recorded.");
      } else {
        setError(
          res.status === 404
            ? "We couldn't find that order."
            : data.error ?? "Something went wrong — please try again.",
        );
      }
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {options.map((opt) => (
        <button
          key={opt.kind}
          type="button"
          disabled={pending !== null || message !== null}
          onClick={() => pay(opt.kind)}
          className={`inline-flex min-h-[54px] items-center justify-between gap-4 rounded-full px-6 text-sm font-bold uppercase tracking-[0.08em] transition ${
            message !== null || pending !== null
              ? "cursor-not-allowed bg-co-border text-co-text-dim"
              : "bg-co-text text-co-cta shadow-xl shadow-black/20 hover:bg-co-text/90"
          }`}
        >
          <span>{pending === opt.kind ? "Working…" : opt.label}</span>
          <span className="tabular-nums">{money(opt.amountCents)}</span>
        </button>
      ))}

      {message && (
        <div className="rounded-2xl border border-co-gold/50 bg-co-gold/10 px-5 py-4 text-sm font-semibold text-co-text">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-co-cta/40 bg-co-cta/5 px-5 py-4 text-sm font-semibold text-co-cta">
          {error}
        </div>
      )}
    </div>
  );
}
