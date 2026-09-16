"use client";
/**
 * Pay panel buttons for the shared quote view+pay surface (/order/quote/[id]).
 *
 * Each button POSTs { kind } to /api/portal/quote/[id]/pay and then obeys the SERVER'S
 * answer, which comes in exactly two shapes:
 *   { ok, stub: false, url } → hosted checkout exists; leave for it.
 *   { ok, stub: true, message } → no provider for this shop; the intent is recorded and
 *                                 the stub message is shown, which is what this component
 *                                 has always done.
 * The client never decides which shape it gets and never learns why — dormancy is a
 * server fact (lib/stripe/client.ts `stripeConfigured`), resolved per shop.
 *
 * Options + amounts come from the server's paymentPlan (passed as props), so the client
 * never derives money. The button label is an i18n key chosen by the server from the
 * option's KIND — the plan's own `label` stays where it is, as the money-rule copy shared
 * with the staff side, rather than being forked into the portal dictionary.
 *
 * ON REDIRECT WE DO NOT RE-ENABLE. `window.location.assign` starts a navigation that can
 * take a moment on a phone; a button that becomes tappable again in that window is a
 * second checkout session for the same money.
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";

interface PayOption {
  kind: "deposit" | "full";
  amountCents: number;
  /** i18n key for the button face, chosen server-side from `kind`. */
  labelKey: TranslationKey;
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function PayButtons({ quoteId, options }: { quoteId: string; options: PayOption[] }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<"deposit" | "full" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay(kind: "deposit" | "full") {
    setPending(kind);
    setMessage(null);
    setError(null);
    // A LOCAL flag, not the `leaving` state: `finally` closes over the render's value of
    // state, which is still false at this point, so reading state there would clear the
    // spinner mid-navigation and re-arm the button.
    let redirecting = false;
    try {
      const res = await fetch(`/api/portal/quote/${quoteId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        message?: string;
        error?: string;
      };
      if (res.ok && typeof data.url === "string" && data.url.length > 0) {
        // Hosted checkout. Stay disabled through the navigation (see the header).
        redirecting = true;
        setLeaving(true);
        setMessage(t("order.quote.redirecting"));
        window.location.assign(data.url);
        return;
      }
      if (res.ok) {
        setMessage(data.message ?? t("order.quote.recorded"));
      } else {
        setError(
          res.status === 404
            ? t("order.quote.error_not_found")
            : data.error ?? t("order.quote.error_generic"),
        );
      }
    } catch {
      setError(t("order.quote.error_generic"));
    } finally {
      if (!redirecting) setPending(null);
    }
  }

  const locked = pending !== null || message !== null || leaving;

  return (
    <div className="flex flex-col gap-3">
      {options.map((opt) => (
        <button
          key={opt.kind}
          type="button"
          disabled={locked}
          onClick={() => pay(opt.kind)}
          className={`inline-flex min-h-[54px] items-center justify-between gap-4 rounded-full px-6 text-sm font-bold uppercase tracking-[0.08em] transition ${
            locked
              ? "cursor-not-allowed bg-co-border text-co-text-dim"
              : "bg-co-text text-co-cta shadow-xl shadow-black/20 hover:bg-co-text/90"
          }`}
        >
          <span>{pending === opt.kind ? t("order.quote.working") : t(opt.labelKey)}</span>
          <span className="tabular-nums">{money(opt.amountCents)}</span>
        </button>
      ))}

      {message && (
        <div className="rounded-2xl border border-co-gold/50 bg-co-gold/10 px-5 py-4 text-sm font-semibold text-co-text">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-co-cta/40 bg-co-cta/5 px-5 py-4 text-sm font-semibold text-co-cta-text">
          {error}
        </div>
      )}
    </div>
  );
}
