"use client";
/**
 * /order/review — Catering ORDER REVIEW (server-authoritative pass).
 *
 * The "complete the order" surface — the ONE place the customer actually clicks to finish.
 * Everything else (event details, order lines, the full charge stack, the deposit + pay-in-full
 * terms) surfaces plainly and stays visible; no click-through accordions in the order flow.
 *
 * Draft handle comes from ?draft=<quoteId> in the URL (read in useEffect via
 * window.location.search — NOT useSearchParams(), per Next 16 App Router).
 *
 * Charge stack is SERVER-AUTHORITATIVE: computed via POST /api/portal/order/draft/preview on
 * load and whenever the tip or napkins toggle changes. No client-side rate constants.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Reveal } from "@/components/portal/Reveal";
import { GoodToKnow, FaqOpen } from "@/components/portal/GoodToKnow";
import { FAQ, GTK } from "@/components/portal/portal-content";
import type { DraftLoad } from "@/lib/portal/draft";
import type { ChargeStack } from "@/lib/catering/quotes";
import { TranslationProvider, useTranslation } from "@/lib/i18n/provider";
import { reviewFailure, type PortalDeliveryInfo } from "@/lib/portal/draft-shared";

// ── Tip presets ──────────────────────────────────────────────────────────────────────
const TIP_PRESETS = [0, 0.15, 0.18, 0.2] as const;
type TipRate = (typeof TIP_PRESETS)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────────────
const centsToMoney = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function formatDate(iso: string | null): string {
  if (!iso) return "Date TBD";
  const d = new Date(`${iso}T00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** Deposit percent label from the deposit amount + total (avoids knowing the bps constant). */
function depositLabel(depositCents: number, totalCents: number): string {
  if (totalCents === 0) return "25%";
  const pct = Math.round((depositCents / totalCents) * 100);
  return `${pct}%`;
}

/**
 * For a package line, returns a human-readable composition string like "Teamster ×2, Crunchy Boi"
 * (the ×N is shown only when >1). Returns "" for non-package lines.
 */
function packageComposition(
  line: DraftLoad["items"][number],
  packages: DraftLoad["packages"],
): string {
  if (!line.packageId || line.options.length === 0) return "";
  const pkg = packages.find((p) => p.id === line.packageId);
  const parts = line.options.map((opt) => {
    let name: string | undefined;
    if (pkg) {
      for (const slot of pkg.slots) {
        const match = slot.options.find(
          (o) =>
            (opt.itemId != null && o.kind === "item" && o.refId === opt.itemId) ||
            (opt.menuItemId != null && o.kind === "menu_item" && o.refId === opt.menuItemId),
        );
        if (match) { name = match.name; break; }
      }
    }
    if (name) return opt.quantity > 1 ? `${name} ×${opt.quantity}` : name;
    return opt.quantity === 1 ? "1 sub" : `${opt.quantity} subs`; // name unresolved — count fallback
  });
  return parts.join(", ");
}

// ── Main component ────────────────────────────────────────────────────────────────────

export default function OrderReviewPage() {
  // Same language default as the existing order/build storefront surface.
  return <TranslationProvider initialLanguage="en"><OrderReview /></TranslationProvider>;
}

function OrderReview() {
  const { t } = useTranslation();
  const router = useRouter();

  const [draft, setDraft] = useState<DraftLoad | null>(null);
  const [stack, setStack] = useState<ChargeStack | null>(null);
  // Delivery as the server priced it (Juan 2026-11-15): the fee, the zone's minimum, and whether the
  // order can be placed as it stands. Null until the first preview (or on a pre-change server).
  const [delivery, setDelivery] = useState<PortalDeliveryInfo | null>(null);
  const [tipRate, setTipRate] = useState<TipRate>(0);
  const [napkins, setNapkins] = useState(false);
  // The order's allergy / special-instructions note — the lead's dietary_notes, saved with the submit
  // and shown to staff on the lead (audit W01/B002).
  const [dietaryNotes, setDietaryNotes] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  // A failure that needs the customer somewhere else (audit W01/B034): the cart changed under them, or
  // the portal session expired. Never an endless "Loading your order…".
  const [blocked, setBlocked] = useState<"cart_changed" | "session_expired" | null>(null);
  const hasStack = useRef(false);
  // Does THIS shop take a card online? A server fact (lib/stripe/client.ts, resolved per
  // location), delivered beside the draft. It changes what the copy PROMISES and nothing
  // else — LRA-210's lesson is that a page must never describe a provider the deployment
  // has not actually wired. Starts false, which is the dormant/honest reading.
  const [paymentsOnline, setPaymentsOnline] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Track whether a preview fetch is in-flight so we don't stack them.
  const previewAbort = useRef<AbortController | null>(null);

  // ── Step 1: read quoteId from URL, load draft ──────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const quoteId = params.get("draft");
    if (!quoteId) {
      router.push("/order/start");
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/portal/order/draft/${encodeURIComponent(quoteId)}`);
        if (res.status === 404) { router.push("/order/start"); return; }
        if (res.status === 401) { setBlocked("session_expired"); return; }
        if (!res.ok) { setLoadError(t("order.review.error_load")); return; }
        const json = (await res.json()) as { ok: boolean; draft: DraftLoad; paymentsOnline?: boolean };
        // Already submitted or superseded (e.g. Back after placing it): the order lives on its quote page now.
        if (json.draft.status !== "draft" || json.draft.editable === false) { router.replace(`/order/quote/${encodeURIComponent(json.draft.quoteId)}`); return; }
        setDraft(json.draft);
        setDietaryNotes(json.draft.lead?.dietaryNotes ?? "");
        setPaymentsOnline(json.paymentsOnline === true);
      } catch {
        setLoadError(t("order.review.error_load"));
      }
    })();
  }, [router, t]);

  // ── Step 2: fetch server-authoritative preview whenever tip or napkins changes ──────
  useEffect(() => {
    if (!draft) return;

    // Cancel any prior in-flight preview request.
    previewAbort.current?.abort();
    const ac = new AbortController();
    previewAbort.current = ac;

    const tipBps = Math.round(tipRate * 10000);
    const fail = (status: number | null, code: string | null) => {
      const action = reviewFailure(status, code, hasStack.current);
      if (action === "go_to_quote") router.replace(`/order/quote/${encodeURIComponent(draft.quoteId)}`);
      else if (action === "cart_changed" || action === "session_expired") setBlocked(action);
      else if (action === "error") setLoadError(t("order.review.error_load"));
      // "keep": a recompute failed while a breakdown is shown — keep the last one.
    };

    void (async () => {
      try {
        const res = await fetch("/api/portal/order/draft/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteId: draft.quoteId,
            tipBps,
            napkins,
          }),
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        if (!res.ok) {
          const code = await res.json().then((j: { error?: unknown }) => (typeof j?.error === "string" ? j.error : null)).catch(() => null);
          if (!ac.signal.aborted) fail(res.status, code);
          return;
        }
        const json = (await res.json()) as { ok: boolean; stack: ChargeStack; delivery?: PortalDeliveryInfo };
        if (!ac.signal.aborted) { hasStack.current = true; setStack(json.stack); setDelivery(json.delivery ?? null); }
      } catch (e) {
        // AbortError is expected on rapid tip/napkins changes — silently ignore.
        if (e instanceof DOMException && e.name === "AbortError") return;
        fail(null, null); // network: an error screen when nothing is shown yet, else keep the breakdown
      }
    })();
  }, [draft, tipRate, napkins, router, t]);

  // ── Submit handler ─────────────────────────────────────────────────────────────────
  async function handleComplete() {
    if (!draft || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const tipBps = Math.round(tipRate * 10000);
      const res = await fetch("/api/portal/order/draft/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: draft.quoteId,
          tipBps,
          napkins,
          dietaryNotes,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; quoteId?: string; error?: string };
      if (json.ok && json.quoteId) {
        router.push(`/order/quote/${json.quoteId}`);
        return;
      }
      const action = reviewFailure(res.status, json.error ?? null, true);
      if (action === "go_to_quote") { router.replace(`/order/quote/${encodeURIComponent(draft.quoteId)}`); return; }
      if (action === "cart_changed" || action === "session_expired") { setBlocked(action); setSubmitting(false); return; }
      if (action === "delivery_unavailable") { setSubmitError(t("order.review.delivery_unavailable")); setSubmitting(false); return; }
      if (action === "below_delivery_minimum") {
        setSubmitError(delivery?.minOrderCents != null
          ? t("order.review.delivery_minimum_short", { min: centsToMoney(delivery.minOrderCents), short: centsToMoney(Math.max(delivery.shortByCents, 1)) })
          : t("order.review.delivery_minimum_generic"));
        setSubmitting(false);
        return;
      }
      setSubmitError(t("order.review.submit_failed"));
      setSubmitting(false);
    } catch {
      setSubmitError(t("order.review.submit_failed"));
      setSubmitting(false);
    }
  }

  // ── Render: loading / error states ────────────────────────────────────────────────
  if (blocked) {
    const quoteId = draft?.quoteId ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("draft") : null);
    return (
      <div className="grid min-h-screen place-items-center bg-co-bg px-6 text-center text-co-text">
        <div className="max-w-md">
          <p role="alert" className="text-sm font-semibold text-co-text">
            {t(blocked === "cart_changed" ? "order.review.cart_changed" : "order.review.session_expired")}
          </p>
          {blocked === "cart_changed" && quoteId ? (
            <Link href={`/order/build?draft=${encodeURIComponent(quoteId)}`} className="mt-4 inline-flex min-h-[44px] items-center text-sm font-bold underline">{t("order.review.edit_order")}</Link>
          ) : (
            <Link href="/order/start" className="mt-4 inline-flex min-h-[44px] items-center text-sm font-bold underline">{t("order.review.sign_in")}</Link>
          )}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="grid min-h-screen place-items-center bg-co-bg px-6 text-center text-co-text">
        <div>
          <p role="alert" className="text-sm font-semibold text-co-text">{loadError}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
            <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-[44px] items-center text-sm font-bold underline">{t("order.review.retry")}</button>
            <Link href="/order/start" className="inline-flex min-h-[44px] items-center text-sm font-bold underline">{t("order.review.start_over")}</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!draft || !stack) {
    return (
      <div className="grid min-h-screen place-items-center bg-co-bg text-co-text-dim">
        <p className="text-sm">Loading your order…</p>
      </div>
    );
  }

  // ── Render: main review surface ────────────────────────────────────────────────────
  const lead = draft.lead;
  const isDelivery = draft.isDelivery;
  const isCompany = !!(lead?.company?.trim());
  // A delivery order the server would refuse (no zone, under the minimum): say why, and hold Submit.
  const deliveryBlock: string | null = delivery?.refusal === "delivery_unavailable"
    ? t("order.review.delivery_unavailable")
    : delivery?.refusal === "below_delivery_minimum" && delivery.minOrderCents != null
      ? t("order.review.delivery_minimum_short", { min: centsToMoney(delivery.minOrderCents), short: centsToMoney(delivery.shortByCents) })
      : null;

  return (
    <div className="min-h-screen bg-co-bg pb-32 text-co-text">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-co-text/90 text-co-bg backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
          <Link href={`/order/build?draft=${draft.quoteId}`} className="text-sm font-semibold text-co-bg/70 transition hover:text-co-bg">‹ Order</Link>
          <span className="text-sm font-extrabold uppercase tracking-[0.22em]">Review &amp; reserve</span>
          <span className="w-12" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-8">
        <Reveal>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">Last step</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">Review, then lock in your date.</h1>
          <p className="mt-2 text-co-text-muted">{t("order.review.deposit_explanation")}</p>
        </Reveal>

        {/* Event details */}
        <Reveal className="mt-7">
          <section className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
            <div className="flex items-center justify-between border-b border-co-border/60 px-6 py-4">
              <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text-dim">Event details</h2>
              <Link href="/order/start" className="text-xs font-bold uppercase tracking-wide text-co-text underline decoration-co-gold decoration-2 underline-offset-4">Edit</Link>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-6 sm:grid-cols-2">
              <Detail label="Date" value={formatDate(lead?.eventDate ?? null)} />
              <Detail label="Guests" value={lead?.headcount != null ? `${lead.headcount} people` : "Headcount TBD"} />
              <Detail
                label={isDelivery ? "Delivery to" : "Pickup"}
                value={isDelivery ? (lead?.deliveryAddress ?? "Address on file") : "In-store pickup"}
              />
              {lead && (
                <Detail
                  label="Contact"
                  value={lead.contactName}
                  sub={isCompany ? (lead.company ?? undefined) : undefined}
                />
              )}
            </dl>
          </section>
        </Reveal>

        {/* Your order */}
        <Reveal className="mt-5">
          <section className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
            <div className="flex items-center justify-between border-b border-co-border/60 px-6 py-4">
              <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text-dim">Your order</h2>
              <Link href={`/order/build?draft=${draft.quoteId}`} className="text-xs font-bold uppercase tracking-wide text-co-text underline decoration-co-gold decoration-2 underline-offset-4">Edit order</Link>
            </div>
            <ul className="divide-y divide-co-border/50">
              {draft.items.map((line) => {
                const composition = line.packageId
                  ? line.options.length > 0
                    ? packageComposition(line, draft.packages)
                    : null // signals "unconfigured package"
                  : undefined; // non-package line — no sub-text
                return (
                  <li key={line.id} className="flex items-start justify-between gap-4 px-6 py-4">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-co-text">
                        <span className="tabular-nums text-co-text-muted">{line.quantity}×</span>{" "}
                        {line.description ?? "Item"}
                      </p>
                      {composition !== undefined && (
                        <p className="mt-0.5 text-xs text-co-text-muted">
                          {composition !== null ? composition : "Subs not chosen yet"}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-co-text">
                      {centsToMoney(line.lineTotalCents)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </Reveal>

        {/* Allergies & special instructions — saved with the order, seen by the kitchen team */}
        <Reveal className="mt-5">
          <section className="rounded-3xl border border-co-border/70 bg-co-surface p-6 shadow-sm">
            <label htmlFor="order-dietary-notes" className="text-sm font-extrabold text-co-text">{t("order.review.notes_heading")}</label>
            <p className="mt-0.5 text-xs text-co-text-dim">{t("order.review.notes_help")}</p>
            <textarea
              id="order-dietary-notes"
              aria-label={t("order.review.notes_heading")}
              value={dietaryNotes}
              onChange={(e) => setDietaryNotes(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={t("order.review.notes_placeholder")}
              className="mt-3 w-full rounded-xl border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm text-co-text"
            />
          </section>
        </Reveal>

        {/* Reassurance — surfaces before you commit, no click needed */}
        <Reveal className="mt-5 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FaqOpen q={FAQ.count.q} a={FAQ.count.a} />
            <FaqOpen q={FAQ.changeOrder.q} a={FAQ.changeOrder.a} />
          </div>
          <GoodToKnow items={GTK.review} tone="gold" />
        </Reveal>

        {/* Tip (optional) */}
        <Reveal className="mt-5">
          <section className="rounded-3xl border border-co-border/70 bg-co-surface p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-co-text">Add a tip for the crew</h2>
                <p className="mt-0.5 text-xs text-co-text-dim">Optional — 100% goes to the team who builds &amp; delivers.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {TIP_PRESETS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTipRate(r)}
                    aria-pressed={tipRate === r}
                    className={`min-w-14 rounded-full border-2 px-3.5 py-1.5 text-sm font-bold transition ${
                      tipRate === r
                        ? "border-co-text bg-co-text text-co-bg"
                        : "border-co-border-2 bg-co-surface text-co-text-muted hover:text-co-text"
                    }`}
                  >
                    {r === 0 ? "None" : `${Math.round(r * 100)}%`}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </Reveal>

        {/* Napkins & utensils toggle (only when the add-on exists for this location) */}
        {draft.addonNapkins && (
          <Reveal className="mt-3">
            <section className="rounded-3xl border border-co-border/70 bg-co-surface p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-extrabold text-co-text">Napkins &amp; utensils</h2>
                  <p className="mt-0.5 text-xs text-co-text-dim">
                    {centsToMoney(draft.addonNapkins.unitPriceCents)} · added to your order
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={napkins}
                  onClick={() => setNapkins((v) => !v)}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none ${
                    napkins ? "border-co-text bg-co-text" : "border-co-border bg-co-surface"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 translate-y-0 rounded-full transition-transform duration-200 ${
                      napkins ? "translate-x-5 bg-co-bg" : "translate-x-0.5 bg-co-text-dim"
                    }`}
                  />
                </button>
              </div>
            </section>
          </Reveal>
        )}

        {/* Charge stack — server-authoritative, updates on tip/napkins change */}
        <Reveal className="mt-5">
          <section className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
            <div className="border-b border-co-border/60 px-6 py-4">
              <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text-dim">Price breakdown</h2>
            </div>
            <div className="flex flex-col gap-2.5 px-6 py-5 text-sm">
              <Row label="Subtotal" value={centsToMoney(stack.subtotalCents)} />
              <Row label="Service charge (kitchen & packing)" value={centsToMoney(stack.serviceChargeCents)} muted />
              <Row
                label={isDelivery ? "Delivery" : "Pickup"}
                value={stack.deliveryFeeCents > 0 ? centsToMoney(stack.deliveryFeeCents) : isDelivery && delivery?.refusal === "delivery_unavailable" ? "—" : "Free"}
                muted
              />
              {isDelivery && delivery?.minOrderCents != null && (
                <p className="-mt-1 text-xs text-co-text-dim">{t("order.review.delivery_minimum", { min: centsToMoney(delivery.minOrderCents) })}</p>
              )}
              {stack.gratuityCents > 0 && <Row label="Tip for the crew" value={centsToMoney(stack.gratuityCents)} muted />}
              <Row label="Estimated DC tax" value={centsToMoney(stack.taxCents)} muted />
              <div className="mt-1.5 flex items-center justify-between border-t border-co-border pt-3">
                <span className="text-base font-extrabold text-co-text">Total</span>
                <span className="text-lg font-extrabold tabular-nums text-co-text">{centsToMoney(stack.totalCents)}</span>
              </div>
            </div>
            {/* Deposit split */}
            <div className="border-t border-co-border/60 bg-co-text px-6 py-5 text-co-bg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-extrabold text-co-gold">
                    {t(paymentsOnline ? "order.review.deposit_due" : "order.review.deposit_label")}
                  </p>
                  <p className="mt-0.5 text-xs text-co-bg/60">
                    {t(paymentsOnline ? "order.review.deposit_pay" : "order.review.deposit_record", {
                      percent: depositLabel(stack.depositCents, stack.totalCents),
                    })}
                  </p>
                </div>
                <span className="text-2xl font-extrabold tabular-nums text-co-bg">{centsToMoney(stack.depositCents)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                <p className="text-xs font-semibold text-co-bg/70">{t("order.review.balance_confirm")}</p>
                <span className="text-sm font-bold tabular-nums text-co-bg/90">
                  {centsToMoney(stack.totalCents - stack.depositCents)}
                </span>
              </div>
            </div>
          </section>
        </Reveal>

        {/* How payment works — surfaced plainly, not hidden behind a click */}
        <Reveal className="mt-5">
          <section className="rounded-3xl border border-co-gold/50 bg-co-gold/10 p-6">
            <h2 className="text-sm font-extrabold text-co-text">{t("order.review.payment_heading")}</h2>
            <ol className="mt-3 flex flex-col gap-3 text-sm text-co-text">
              {/* THE LRA-210 SENTENCE. It describes what actually happens next, and what
                  happens next depends on whether this shop has a payment provider wired:
                  with Stripe configured the customer really does pay by card on the quote
                  page; without it, no money is taken online and the team follows up. Two
                  branches, both true, neither a promise the deployment cannot keep. */}
              <PayStep
                n="1"
                title={t(
                  paymentsOnline ? "order.review.deposit_pay" : "order.review.deposit_record",
                  { percent: depositLabel(stack.depositCents, stack.totalCents) },
                )}
              >
                {t(paymentsOnline ? "order.review.pay_online" : "order.review.no_online_payment")}
              </PayStep>
              <PayStep n="2" title={t("order.review.confirm_heading")}>
                {t("order.review.deposit_explanation")}
              </PayStep>
            </ol>
          </section>
        </Reveal>

        <p className="mt-6 text-center text-xs text-co-text-dim">
          Prices shown are estimates and are re-confirmed by our team when they confirm your order.
        </p>
      </main>

      {/* Sticky place-order bar — the one click that completes the order */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-co-border bg-co-bg/95 px-5 py-3.5 backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {deliveryBlock && !submitError && (
            <p role="alert" className="text-center text-xs font-semibold text-co-cta-text">
              {deliveryBlock}{" "}
              {delivery?.refusal === "below_delivery_minimum" && (
                <Link href={`/order/build?draft=${encodeURIComponent(draft.quoteId)}`} className="inline-flex min-h-[44px] items-center underline">{t("order.review.edit_order")}</Link>
              )}
            </p>
          )}
          {submitError && (
            <p className="text-center text-xs font-semibold text-red-600">{submitError}</p>
          )}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-co-text-dim">
                {t(paymentsOnline ? "order.review.deposit_due" : "order.review.deposit_label")}
              </p>
              <p className="text-lg font-extrabold tabular-nums text-co-text">
                {centsToMoney(stack.depositCents)}
                <span className="ml-1.5 text-xs font-semibold text-co-text-dim">of {centsToMoney(stack.totalCents)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void handleComplete(); }}
              disabled={submitting || deliveryBlock != null}
              className="inline-flex min-h-[54px] flex-1 items-center justify-center rounded-full bg-co-text px-6 text-sm font-bold uppercase tracking-[0.08em] text-co-cta shadow-xl shadow-black/20 transition hover:bg-co-text/90 disabled:opacity-50 sm:flex-none sm:px-10"
            >
              {submitting
                ? t("order.review.submitting")
                : t(paymentsOnline ? "order.review.submit_pay" : "order.review.submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────────────

function Detail({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-co-text">{value}</dd>
      {sub && <dd className="text-xs text-co-text-muted">{sub}</dd>}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-co-text-muted" : "font-semibold text-co-text"}>{label}</span>
      <span className={`tabular-nums ${muted ? "text-co-text-muted" : "font-bold text-co-text"}`}>{value}</span>
    </div>
  );
}

function PayStep({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-co-text text-xs font-extrabold text-co-gold">{n}</span>
      <span>
        <span className="font-bold text-co-text">{title}</span>{" "}
        <span className="text-co-text-muted">{children}</span>
      </span>
    </li>
  );
}
