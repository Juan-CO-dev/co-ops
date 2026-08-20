/**
 * CateringToday — confirmed catering events due out TODAY, time front and
 * center (council 2026-07-31, Fable I1 + Juan: "the catering due at what
 * time"). Renders nothing when the day has no events — a quiet strip, not a
 * permanent section. Names/covers only; no revenue at the pulse's KH+ floor.
 */

import type { Language } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import type { CateringDueItem } from "@/lib/midshift";

export function CateringToday({
  items,
  language,
}: {
  items: CateringDueItem[];
  language: Language;
}) {
  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-gold-text">
        {serverT(language, "midshift.catering.heading")}
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((ev) => (
          <li
            key={ev.id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border-2 border-co-gold/50 bg-co-surface px-3 py-2"
          >
            <span className="text-sm font-extrabold text-co-text">
              {ev.timeWindow ?? serverT(language, "midshift.catering.no_time")}
            </span>
            <span className="text-sm font-semibold text-co-text">{ev.name}</span>
            {ev.headcount != null && (
              <span className="text-xs text-co-text-muted">
                {ev.headcount === 1
                  ? serverT(language, "midshift.catering.covers_one")
                  : serverT(language, "midshift.catering.covers_other", { count: ev.headcount })}
              </span>
            )}
            <span className="text-xs font-semibold text-co-text-muted">
              {serverT(language, ev.isDelivery ? "midshift.catering.delivery" : "midshift.catering.pickup")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
