/**
 * Aggregated vendor ordering calendar (Item/Inventory Spine — vendor mini-arc,
 * Slice B2). Server Component, presentational, read-only.
 *
 * Lives on the Admin → Vendors page (above the vendor card grid), NOT the
 * dashboard (per Juan). Renders the week's ordering/delivery schedule across
 * every active scheduled vendor's B1 weekday sets — what to order when.
 *
 * 7 weekday rows (0=Sun..6=Sat). Each vendor chip is the vendor's distinct COLOR
 * (so colors read per-vendor); order vs delivery is denoted by a SYMBOL on the
 * chip: ● = order, ★ = delivery (Juan's ask). Today's row is highlighted. A
 * vendor with no color falls back to neutral gray. No links (at-a-glance read).
 */

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { VendorWeekEntry } from "@/lib/admin/vendors";

// Weekday index (0=Sun..6=Sat) → people.weekday.* i18n key suffix.
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const NEUTRAL = "#6B7280"; // gray-500 — fallback when a vendor has no color.
const ORDER_SYMBOL = "●";
const DELIVERY_SYMBOL = "★";

/** A vendor chip: solid vendor color + a leading symbol (● order / ★ delivery). */
function VendorChip({ name, color, kind }: { name: string; color: string; kind: "order" | "delivery" }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      <span aria-hidden className="text-[11px] leading-none">
        {kind === "order" ? ORDER_SYMBOL : DELIVERY_SYMBOL}
      </span>
      {name}
    </span>
  );
}

export function OrderingCalendar({
  entries,
  todayWeekday,
  language,
}: {
  entries: VendorWeekEntry[];
  todayWeekday: number;
  language: Language;
}) {
  return (
    <section
      aria-label={serverT(language, "admin.vendors.ordering_calendar.title")}
      className="mb-4 flex flex-col gap-3 rounded-2xl border-2 border-co-border bg-co-surface p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="inline-block self-start border-b-2 border-co-gold-deep pb-0.5 text-sm font-extrabold uppercase tracking-[0.12em] text-co-text">
          {serverT(language, "admin.vendors.ordering_calendar.title")}
        </h2>
        {/* Legend — ● order vs ★ delivery (symbols denote; color denotes vendor). */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-co-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="text-co-text">{ORDER_SYMBOL}</span>
            {serverT(language, "admin.vendors.ordering_calendar.legend_order")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="text-co-text">{DELIVERY_SYMBOL}</span>
            {serverT(language, "admin.vendors.ordering_calendar.legend_delivery")}
          </span>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm italic text-co-text-muted">
          {serverT(language, "admin.vendors.ordering_calendar.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {WEEKDAY_KEYS.map((suffix, weekday) => {
            const isToday = weekday === todayWeekday;
            const orderVendors = entries.filter((v) => v.orderDays.includes(weekday));
            const deliveryVendors = entries.filter((v) => v.deliveryDays.includes(weekday));
            const isEmpty = orderVendors.length === 0 && deliveryVendors.length === 0;
            return (
              <li
                key={suffix}
                className={[
                  "flex flex-col gap-1.5 rounded-xl px-3 py-2 sm:flex-row sm:items-start sm:gap-3",
                  isToday ? "border-2 border-co-gold-deep bg-co-warning-surface" : "border-2 border-transparent",
                ].join(" ")}
              >
                <div className="flex w-16 shrink-0 items-center gap-2 pt-1">
                  <span className="text-xs font-bold uppercase tracking-[0.12em] text-co-text">
                    {serverT(language, `people.weekday.${suffix}` as "people.weekday.sun")}
                  </span>
                  {isToday ? (
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-co-gold-deep">
                      {serverT(language, "admin.vendors.ordering_calendar.today")}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-1 flex-wrap items-center gap-1.5">
                  {isEmpty ? (
                    <span className="text-sm text-co-text-faint">—</span>
                  ) : (
                    <>
                      {orderVendors.map((v) => (
                        <VendorChip key={`o-${v.id}`} name={v.name} color={v.color ?? NEUTRAL} kind="order" />
                      ))}
                      {deliveryVendors.map((v) => (
                        <VendorChip key={`d-${v.id}`} name={v.name} color={v.color ?? NEUTRAL} kind="delivery" />
                      ))}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
