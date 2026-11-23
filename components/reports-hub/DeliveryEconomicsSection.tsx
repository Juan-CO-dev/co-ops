/**
 * Catering delivery D4 — the fifth section of /reports/sales/catering: delivery economics. Server component; every
 * number arrives as the result of lib/delivery/economics.ts (no read here, no client state of its own).
 *
 *  - OFF RENDERS NOTHING: the switch, the shop's switch, 0356 not installed, or a viewer who may not read delivery money.
 *  - A FAILED READ is this section's own "couldn't load" line. Never zeros, and the four sales sections are untouched.
 *  - COVERAGE FIRST: "N of M delivery orders have both a fee and a full cost", then the totals over those N only, then
 *    the orders left out per reason, then (collapsed) the per-order list where every missing side is named.
 *  - The gratuity block is RECORDED ONLY and carries the "not verified" sentence, word for word.
 *  - Nothing here is a sales figure: no number of this section is added to, or shown as part of, the blocks above it.
 *  - EVERY ORDER ROW IS IDENTIFIED AND LINKED (review DELIV4-r1): a short reference from the lead id (no customer
 *    field is read) that opens that order's card on the pipeline board, so two orders on one date with one courier are
 *    told apart, and the gratuity detail names every order whose split needs recalculating.
 * Disclosure doctrine: the summary is always visible; the per-order detail is default-collapsed (CollapsibleSection).
 * Rows are stacked and wrap for a 375 px phone; dates are ET labels through lib/i18n/format.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { salesCard, salesLink, tFor } from "@/components/reports-hub/SalesParts";
import type { DeliveryEconomicsResult } from "@/lib/delivery/economics";
import { deliveryOrderHref, deliveryOrderRef, type OrderEconomics } from "@/lib/delivery/economics-shared";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";

const k = (key: string) => `reports.sales.delivery.${key}` as TranslationKey;
const WARN = "text-co-warning-text";
/** Basis points as a percentage: 1000 → "10", 1250 → "12.5". */
const percent = (bps: number) => String(bps / 100);

/** The order's reference, linking to its card on the pipeline board (the board's own `#lead-<id>` hash). */
function OrderLink({ leadId, language }: { leadId: string; language: Language }) {
  const t = tFor(language);
  const ref = deliveryOrderRef(leadId);
  return <Link className={`${salesLink} font-semibold`} href={deliveryOrderHref(leadId)} aria-label={t(k("order.open"), { ref })}>{t(k("order.ref"), { ref })}</Link>;
}
/** Does this order's recorded split need a person? (It no longer matches the quote, or none is recorded for it yet.) */
const needsRecalc = (o: OrderEconomics) => o.gratuity.kind === "not_recorded" || ((o.gratuity.kind === "allocated" || o.gratuity.kind === "zero_head") && o.gratuity.needsRecalc);

export function DeliveryEconomicsSection({ result, language, idBase }: { result: DeliveryEconomicsResult; language: Language; idBase: string }): ReactNode {
  if (result.kind === "off") return null;
  const t = tFor(language);
  const title = t(k("title"));
  if (result.kind === "failed") {
    return <section className={salesCard} aria-label={title}>
      <h2 className="mb-2 font-bold">{title}</h2>
      <p role="status" className={`text-sm ${WARN}`}>{t(k("failed"))}</p>
    </section>;
  }
  const { report } = result;
  const money = (cents: number) => formatCents(cents, language);
  const g = report.gratuity;
  // The detail names every order with a recorded split AND every order whose split needs recalculating.
  const splitOrders = report.orders.filter((o) => o.gratuity.kind === "allocated" || needsRecalc(o));
  const gratuityLines = [
    g.deliveredNoGratuity > 0 ? t(k("gratuity.no_gratuity"), { n: g.deliveredNoGratuity }) : null,
    g.zeroHead > 0 ? t(k("gratuity.zero_head"), { n: g.zeroHead }) : null,
    g.voided > 0 ? t(k("gratuity.voided"), { n: g.voided }) : null,
    g.expected > 0 ? t(k("gratuity.expected"), { n: g.expected }) : null,
  ].filter((line): line is string => line !== null);

  return <section className={salesCard} aria-label={title}>
    <h2 className="mb-2 font-bold">{title}</h2>
    {/* Coverage precedes numbers. */}
    <p className="text-sm font-semibold">{report.coverage.orders === 0 ? t(k("none")) : t(k("coverage"), { n: report.coverage.withNet, m: report.coverage.orders })}</p>

    {report.coverage.withNet > 0 && <>
      <p className="mt-2 text-xs text-co-text-muted">{t(k("totals_basis"), { n: report.coverage.withNet })}</p>
      <ul className="text-sm">
        <li className="flex flex-wrap items-center justify-between gap-x-3 border-t border-co-border py-1"><span>{t(k("total.fee"))}</span><span>{money(report.totals.feeCents)}</span></li>
        <li className="flex flex-wrap items-center justify-between gap-x-3 border-t border-co-border py-1"><span>{t(k("total.cost"))}</span><span>{money(report.totals.costCents)}</span></li>
        <li className="flex flex-wrap items-center justify-between gap-x-3 border-t border-co-border py-1 font-bold"><span>{t(k("total.net"))}</span><span>{money(report.totals.netCents)}</span></li>
      </ul>
    </>}

    {report.excluded.length > 0 && <div className="mt-3">
      <h3 className="text-xs font-bold tracking-wide text-co-text-muted">{t(k("excluded.heading"))}</h3>
      <ul className={`mt-1 flex flex-wrap gap-2 text-sm ${WARN}`}>
        {report.excluded.map((e) => <li key={e.reason} className="min-w-0 max-w-full break-words rounded-full border border-co-warning bg-co-warning-surface px-3 py-1">
          {t(k(`excluded.${e.reason}`), { n: e.orders })}</li>)}
      </ul>
      <p className="mt-1 text-xs text-co-text-muted">{t(k("excluded.note"))}</p>
    </div>}

    <p className="mt-3 text-xs text-co-text-muted">{t(k("rule"))}</p>

    {report.orders.length > 0 && <div className="mt-3">
      <CollapsibleSection title={t(k("orders.title"))} count={t(k("orders.count"), { n: report.orders.length })} idBase={`${idBase}-orders`}>
        <ul className="text-sm">
          {report.orders.map((o) => <OrderRow key={o.leadId} order={o} language={language} />)}
        </ul>
      </CollapsibleSection>
    </div>}

    {/* The gratuity split: recorded only. */}
    {(g.orders > 0 || g.needsRecalc > 0 || g.sourceUnknown > 0 || gratuityLines.length > 0) && <div className="mt-4 border-t border-co-border pt-3">
      <h3 className="mb-1 font-bold">{t(k("gratuity.title"))}</h3>
      <p className="text-sm">{t(k("gratuity.orders"), { n: g.orders })}</p>
      {g.orders > 0 && <ul className="text-sm">
        <li className="flex flex-wrap items-center justify-between gap-x-3 border-t border-co-border py-1"><span>{t(k("gratuity.total"))}</span><span>{money(g.gratuityCents)}</span></li>
        <li className="flex flex-wrap items-center justify-between gap-x-3 border-t border-co-border py-1"><span>{t(k("gratuity.driver"))}</span><span>{money(g.driverCents)}</span></li>
        <li className="flex flex-wrap items-center justify-between gap-x-3 border-t border-co-border py-1"><span>{t(k("gratuity.crew"))}</span><span>{money(g.crewCents)}</span></li>
      </ul>}
      {g.needsRecalc > 0 && <p className={`mt-1 text-sm ${WARN}`}>{t(k("gratuity.needs_recalc"), { n: g.needsRecalc })}</p>}
      {g.sourceUnknown > 0 && <p className={`mt-1 text-sm ${WARN}`}>{t(k("gratuity.source_unknown"), { n: g.sourceUnknown })}</p>}
      {gratuityLines.map((line) => <p key={line} className="mt-1 text-sm text-co-text-muted">{line}</p>)}
      <p className="mt-2 text-xs text-co-text-muted">{t("admin.catering.delivery.share.unverified")}</p>
      {splitOrders.length > 0 && <div className="mt-2">
        <CollapsibleSection title={t(k("gratuity.detail"))} count={t(k("orders.count"), { n: splitOrders.length })} idBase={`${idBase}-gratuity`}>
          <ul className="text-sm">
            {splitOrders.map((o) => <li key={o.leadId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-co-border py-1">
              <OrderLink leadId={o.leadId} language={language} />
              <span>{o.eventDate ? formatDateLabel(o.eventDate, language) : t(k("order.no_date"))}</span>
              {o.gratuity.kind === "allocated" && <span className="min-w-0 break-words">{t(k("gratuity.row"), { gratuity: money(o.gratuity.gratuityCents), driver: money(o.gratuity.driverCents),
                crew: money(o.gratuity.crewCents), percent: percent(o.gratuity.driverBps) })}</span>}
              {o.gratuity.kind === "allocated" && o.gratuity.attemptNo !== null && <span className="text-co-text-muted">{t(k("gratuity.row_job"), { n: o.gratuity.attemptNo })}</span>}
              {o.gratuity.kind === "zero_head" && <span className="min-w-0 break-words">{t(k("gratuity.row_zero"))}</span>}
              {o.gratuity.kind === "not_recorded" ? <span className={WARN}>{t(k("gratuity.row_not_recorded"))}</span>
                : needsRecalc(o) && <span className={WARN}>{t(k("gratuity.row_recalc"))}</span>}
            </li>)}
          </ul>
        </CollapsibleSection>
      </div>}
    </div>}
  </section>;
}

/** One order: its date, its couriers, then fee / cost / net — each missing side NAMED in its place, never a 0. */
function OrderRow({ order, language }: { order: OrderEconomics; language: Language }) {
  const t = tFor(language);
  const money = (cents: number) => formatCents(cents, language);
  const fee = order.fee.kind === "known" ? <span>{t(k("order.fee"), { amount: money(order.fee.cents) })}</span>
    : <span className={WARN}>{t(k(`gap.${order.fee.reason}`))}</span>;
  const cost = order.cost.kind === "complete" ? <span>{t(k("order.cost"), { amount: money(order.cost.cents) })}</span>
    : order.cost.kind === "partial" ? <span className={WARN}>{t(k("order.cost_at_least"), { amount: money(order.cost.knownCents) })} · {t(k("gap.cost_partial"), { n: order.cost.unknownJobs })}</span>
    : <span className={WARN}>{t(k("gap.cost_not_recorded"))}</span>;
  return <li className="border-t border-co-border py-2">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <OrderLink leadId={order.leadId} language={language} />
      <span>{order.eventDate ? formatDateLabel(order.eventDate, language) : t(k("order.no_date"))}</span>
      {order.isEzcater && <span className="text-co-text-muted">{t(k("order.ezcater"))}</span>}
      <span className="min-w-0 break-words text-co-text-muted">
        {order.jobs === 0 ? t(k("order.no_delivery")) : [...order.providers, t(k("order.deliveries"), { n: order.jobs })].join(" · ")}
      </span>
    </div>
    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {fee}{cost}
      {order.netCents !== null ? <span className="font-bold">{t(k("order.net"), { amount: money(order.netCents) })}</span> : <span className="text-co-text-muted">{t(k("order.no_net"))}</span>}
    </div>
  </li>;
}
