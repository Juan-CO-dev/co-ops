/**
 * /order/account — the customer account home (Portal-4).
 *
 * Server component. Requires a customer session (getCustomerFromHeaders → else redirect to
 * /order/start). loadCustomerAccount enforces the `customer_id` authorization boundary — only
 * the caller's own profile + orders are ever loaded. Renders the customer's live, non-draft
 * orders with a customer-facing status badge (+ a review-&-pay / view affordance and an
 * "order again" link per card), or a friendly empty state. Visual style mirrors /order/review
 * and /order/quote/[id] (co-* tokens, sticky header, rounded cards, phone-first max-w-2xl).
 *
 * Dynamic route (per-customer) — never statically prerendered.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCustomerFromHeaders } from "@/lib/portal/session";
import { loadCustomerAccount } from "@/lib/portal/account";
import type { CustomerOrder, CustomerStatus } from "@/lib/portal/account";

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function formatDate(iso: string | null): string {
  if (!iso) return "Date to be confirmed";
  const d = new Date(`${iso}T00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-co-bg pb-16 text-co-text">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-co-text/90 text-co-bg backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
          <Link href="/order" className="text-sm font-semibold text-co-bg/70 transition hover:text-co-bg">‹ Compliments Only</Link>
          <span className="text-sm font-extrabold uppercase tracking-[0.22em]">Your orders</span>
          <span className="w-24" />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-8">{children}</main>
    </div>
  );
}

/** Badge color driven by the customer-facing status tone. */
function StatusBadge({ status }: { status: CustomerStatus }) {
  const toneClass =
    status.tone === "action"
      ? "bg-co-cta/10 text-co-cta-text"
      : status.tone === "pending"
        ? "bg-co-gold/50 text-co-text"
        : status.tone === "success"
          ? "bg-co-success-surface text-co-confirm-text"
          : "bg-co-border/50 text-co-text-dim";
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${toneClass}`}>
      {status.label}
    </span>
  );
}

function OrderCard({ order }: { order: CustomerOrder }) {
  const { quote, status } = order;
  return (
    <li className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-5">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-co-text-dim">Event</p>
          <p className="mt-1 text-lg font-extrabold text-co-text">{formatDate(quote.eventDate)}</p>
          <p className="mt-1 text-sm text-co-text-muted">
            {quote.headcount ? `${quote.headcount} guests · ` : ""}
            <span className="font-bold tabular-nums text-co-text">{money(quote.totalCents)}</span>
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-co-border/60 bg-co-bg/50 px-6 py-4">
        {status.payable ? (
          <Link
            href={`/order/quote/${quote.id}`}
            className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-co-text px-7 text-sm font-bold uppercase tracking-[0.08em] text-co-cta transition hover:bg-co-text/90"
          >
            Review &amp; pay →
          </Link>
        ) : (
          <Link
            href={`/order/quote/${quote.id}`}
            className="inline-flex min-h-[48px] items-center justify-center rounded-full border-2 border-co-text px-7 text-sm font-bold uppercase tracking-[0.08em] text-co-text transition hover:bg-co-text hover:text-co-bg"
          >
            View
          </Link>
        )}
        {/* Reorder: real pre-fill is deferred — route to the builder for now. */}
        <Link
          href="/order"
          className="text-xs font-bold uppercase tracking-wide text-co-text underline decoration-co-gold decoration-2 underline-offset-4"
        >
          Order again
        </Link>
      </div>
    </li>
  );
}

export default async function AccountPage() {
  const ctx = await getCustomerFromHeaders();
  if (!ctx) redirect("/order/start"); // sign in first

  const { customer, orders } = await loadCustomerAccount(ctx.customerId);
  const displayName = customer?.name ?? customer?.email ?? ctx.email;

  return (
    <Shell>
      <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">Your account</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">Your orders</h1>
      <p className="mt-2 text-co-text-muted">
        Signed in as <span className="font-semibold text-co-text">{displayName}</span>.
      </p>

      {orders.length === 0 ? (
        <section className="mt-7 rounded-3xl border border-co-border/70 bg-co-surface p-8 text-center shadow-sm sm:p-10">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-co-gold/40 text-3xl">🥪</div>
          <h2 className="mt-5 text-2xl font-extrabold text-co-text">No orders yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-co-text-muted">
            Start your first order and it&apos;ll show up here — with everything you need to review and pay.
          </p>
          <Link
            href="/order"
            className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-full bg-co-text px-8 text-sm font-bold uppercase tracking-[0.08em] text-co-cta transition hover:bg-co-text/90"
          >
            Start an order →
          </Link>
        </section>
      ) : (
        <ul className="mt-7 flex flex-col gap-4">
          {orders.map((order) => (
            <OrderCard key={order.quote.id} order={order} />
          ))}
        </ul>
      )}

      {/* Saved details */}
      <section className="mt-7 rounded-3xl border border-co-border/70 bg-co-surface p-6 shadow-sm">
        <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text-dim">Saved details</h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Detail label="Name" value={customer?.name ?? "—"} />
          <Detail label="Email" value={customer?.email ?? ctx.email} />
          <Detail label="Company" value={customer?.company ?? "—"} />
        </dl>
      </section>

      {/* Footer CTA */}
      <div className="mt-8 text-center">
        <Link
          href="/order"
          className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-co-text px-8 text-sm font-bold uppercase tracking-[0.08em] text-co-cta transition hover:bg-co-text/90"
        >
          Start a new order →
        </Link>
      </div>
    </Shell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-co-text">{value}</dd>
    </div>
  );
}
