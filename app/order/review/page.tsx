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

export default function OrderReview() {
  const router = useRouter();

  const [draft, setDraft] = useState<DraftLoad | null>(null);
  const [stack, setStack] = useState<ChargeStack | null>(null);
  const [tipRate, setTipRate] = useState<TipRate>(0);
  const [napkins, setNapkins] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
        if (!res.ok) { setLoadError("Couldn't load your order. Please refresh or start over."); return; }
        const json = (await res.json()) as { ok: boolean; draft: DraftLoad };
        setDraft(json.draft);
      } catch {
        setLoadError("Couldn't load your order. Please refresh or start over.");
      }
    })();
  }, [router]);

  // ── Step 2: fetch server-authoritative preview whenever tip or napkins changes ──────
  useEffect(() => {
    if (!draft) return;

    // Cancel any prior in-flight preview request.
    previewAbort.current?.abort();
    const ac = new AbortController();
    previewAbort.current = ac;

    const tipBps = Math.round(tipRate * 10000);

    void (async () => {
      try {
        const res = await fetch("/api/portal/order/draft/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteId: draft.quoteId,
            isDelivery: draft.isDelivery,
            deliveryZoneId: draft.deliveryZoneId ?? null,
            tipBps,
            napkins,
          }),
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        if (!res.ok) return; // keep showing prior stack
        const json = (await res.json()) as { ok: boolean; stack: ChargeStack };
        if (!ac.signal.aborted) setStack(json.stack);
      } catch (e) {
        // AbortError is expected on rapid tip/napkins changes — silently ignore.
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Other errors: leave prior stack in place; don't surface to the user.
      }
    })();
  }, [draft, tipRate, napkins]);

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
          isDelivery: draft.isDelivery,
          deliveryZoneId: draft.deliveryZoneId ?? null,
          tipBps,
          napkins,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; quoteId?: string; error?: string };
      if (json.ok && json.quoteId) {
        router.push(`/order/quote/${json.quoteId}`);
      } else {
        setSubmitError("Something went wrong. Please try again.");
        setSubmitting(false);
      }
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  // ── Render: loading / error states ────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="grid min-h-screen place-items-center bg-co-bg px-6 text-center text-co-text">
        <div>
          <p className="text-sm font-semibold text-co-text">{loadError}</p>
          <Link href="/order/start" className="mt-4 inline-block text-sm font-bold underline">Start over</Link>
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
          <p className="mt-2 text-co-text-muted">Here&apos;s everything in one place. Your deposit locks your date &amp; requirements while a team member confirms your order — usually within 24 hours — then we email you to pay the balance before the event.</p>
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
                value={stack.deliveryFeeCents > 0 ? centsToMoney(stack.deliveryFeeCents) : "Free"}
                muted
              />
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
                  <p className="text-sm font-extrabold text-co-gold">Deposit to lock in your date</p>
                  <p className="mt-0.5 text-xs text-co-bg/60">
                    {depositLabel(stack.depositCents, stack.totalCents)} now · locks your date &amp; requirements
                  </p>
                </div>
                <span className="text-2xl font-extrabold tabular-nums text-co-bg">{centsToMoney(stack.depositCents)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                <p className="text-xs font-semibold text-co-bg/70">Balance — pay by 48h before, or forfeit</p>
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
            <h2 className="text-sm font-extrabold text-co-text">How payment works</h2>
            <ol className="mt-3 flex flex-col gap-3 text-sm text-co-text">
              <PayStep n="1" title={`Pay your ${depositLabel(stack.depositCents, stack.totalCents)} deposit — securely via Stripe.`}>
                It locks in your date and requirements while a team member reviews your order. We never see or store your card.
              </PayStep>
              <PayStep n="2" title="We confirm your order — usually within 24 hours.">
                If we can&apos;t accommodate your date, your deposit is refunded in full.
              </PayStep>
              <PayStep n="3" title="We email you to pay the balance.">
                {isCompany
                  ? <>Pay anytime up to 48h before — or use {lead?.company}&apos;s Net-30 / Net-60 terms. We&apos;ll remind you daily.</>
                  : <>Pay the balance anytime up to 48 hours before your event. We&apos;ll remind you daily so it&apos;s easy.</>}
              </PayStep>
              <PayStep n="4" title="Miss the 48h deadline and the deposit is forfeited.">
                So we nudge you daily until it&apos;s paid — then we build &amp; deliver.
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
          {submitError && (
            <p className="text-center text-xs font-semibold text-red-600">{submitError}</p>
          )}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-co-text-dim">Deposit to lock in</p>
              <p className="text-lg font-extrabold tabular-nums text-co-text">
                {centsToMoney(stack.depositCents)}
                <span className="ml-1.5 text-xs font-semibold text-co-text-dim">of {centsToMoney(stack.totalCents)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void handleComplete(); }}
              disabled={submitting}
              className="inline-flex min-h-[54px] flex-1 items-center justify-center rounded-full bg-co-text px-6 text-sm font-bold uppercase tracking-[0.08em] text-co-cta shadow-xl shadow-black/20 transition hover:bg-co-text/90 disabled:opacity-50 sm:flex-none sm:px-10"
            >
              {submitting ? "Placing order…" : "Pay deposit & lock my date →"}
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
