/**
 * Dashboard aggregated vendor ordering calendar (Item/Inventory Spine — vendor
 * mini-arc, Slice B2). Server Component, presentational, read-only.
 *
 * Renders the week's vendor ordering/delivery schedule at a glance — what to
 * order when — across every active scheduled vendor's B1 weekday sets. Lives on
 * the dashboard (landing page), gated SL+ (≥5) by the loader
 * (loadVendorOrderingWeek) + the page-level level check.
 *
 * 7 weekday rows (0=Sun..6=Sat, matching the data convention). Each row lists:
 *   - Order chips: vendors whose orderDays include that day — SOLID color chip.
 *   - Delivery chips: vendors whose deliveryDays include that day — a LIGHTER
 *     tint of the same color (color at ~18% bg + a solid color dot).
 * Today's row is highlighted. A vendor with no color falls back to neutral gray.
 * No links (SL/<6 can't reach /admin/vendors; at-a-glance read).
 */

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { VendorWeekEntry } from "@/lib/admin/vendors";

// Weekday index (0=Sun..6=Sat) → people.weekday.* i18n key suffix.
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const NEUTRAL = "#6B7280"; // gray-500 — fallback when a vendor has no color.

/**
 * Append an alpha byte to a 6-digit hex color for the lighter delivery tint.
 * "#2563EB" + "2E" → "#2563EB2E" (~18% opacity). Falls back to the raw color
 * for non-#RRGGBB inputs (the palette is always #RRGGBB, so this is defensive).
 */
function tint(hex: string): string {
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? `${hex}2E` : hex;
}

function OrderChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {name}
    </span>
  );
}

function DeliveryChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-co-text"
      style={{ backgroundColor: tint(color), border: `1px solid ${color}` }}
    >
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
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
      aria-label={serverT(language, "dashboard.ordering_calendar.title")}
      className="flex flex-col gap-3 rounded-2xl border-2 border-co-border bg-co-surface p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="inline-block self-start border-b-2 border-co-gold-deep pb-0.5 text-lg font-bold uppercase tracking-[0.14em] text-co-text">
          {serverT(language, "dashboard.ordering_calendar.title")}
        </h3>
        {/* Legend — order (solid) vs delivery (shade). */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-co-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: NEUTRAL }} />
            {serverT(language, "dashboard.ordering_calendar.legend_order")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: tint(NEUTRAL), border: `1px solid ${NEUTRAL}` }}
            />
            {serverT(language, "dashboard.ordering_calendar.legend_delivery")}
          </span>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm italic text-co-text-muted">
          {serverT(language, "dashboard.ordering_calendar.empty")}
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
                      {serverT(language, "dashboard.ordering_calendar.today")}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-1 flex-wrap items-center gap-1.5">
                  {isEmpty ? (
                    <span className="text-sm text-co-text-faint">—</span>
                  ) : (
                    <>
                      {orderVendors.map((v) => (
                        <OrderChip key={`o-${v.id}`} name={v.name} color={v.color ?? NEUTRAL} />
                      ))}
                      {deliveryVendors.map((v) => (
                        <DeliveryChip key={`d-${v.id}`} name={v.name} color={v.color ?? NEUTRAL} />
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
