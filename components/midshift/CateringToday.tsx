/**
 * CateringToday — confirmed catering events due out TODAY, time front and
 * center (council 2026-07-31, Fable I1 + Juan: "the catering due at what
 * time"). Names/covers only; no revenue at the pulse's KH+ floor.
 *
 * v2 (catering-truth arc 2026-09-05): each row carries its STAGE chip (confirmed = the
 * kitchen still owes it · out = it left) and its SOURCE, and a one-line look-ahead names
 * tomorrow's booked count + earliest time. The section now renders whenever there is
 * anything to say about today OR tomorrow — a quiet 3pm strip that goes silent only when
 * both days are genuinely empty.
 *
 * The raw `time_window` column holds three shapes in prod (Toast "13:15" · ezCater raw ISO
 * instant · portal "11:30 AM–12:00 PM"), so every render goes through `timeWindowLabel`.
 */

import type { Language } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import { leadSourceLabelKey } from "@/lib/catering/intake-shared";
import { stageChip, timeWindowLabel, type CateringDueItem, type CateringTomorrow } from "@/lib/midshift";

export function CateringToday({
  items,
  tomorrow,
  language,
}: {
  items: CateringDueItem[];
  tomorrow: CateringTomorrow;
  language: Language;
}) {
  if (items.length === 0 && tomorrow.count === 0) return null;

  const tomorrowLine = (() => {
    if (tomorrow.count === 0) return serverT(language, "midshift.catering.tomorrow_none");
    const when = timeWindowLabel(tomorrow.firstWindow, language);
    return when == null
      ? serverT(language, "midshift.catering.tomorrow_some_no_time", { count: tomorrow.count })
      : serverT(language, "midshift.catering.tomorrow_some", { count: tomorrow.count, time: when });
  })();

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-gold-text">
        {serverT(language, "midshift.catering.heading")}
      </h2>
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((ev) => {
            const chip = stageChip(ev.stage);
            const src = leadSourceLabelKey(ev.source);
            return (
              <li
                key={ev.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border-2 border-co-gold/50 bg-co-surface px-3 py-2"
              >
                <span className="text-sm font-extrabold text-co-text">
                  {timeWindowLabel(ev.timeWindow, language) ?? serverT(language, "midshift.catering.no_time")}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${chip.className}`}>
                  {serverT(language, chip.labelKey)}
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
                <span className="text-xs text-co-text-dim">{"key" in src ? serverT(language, src.key) : src.verbatim}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className={`text-xs text-co-text-muted ${items.length > 0 ? "mt-2" : ""}`}>{tomorrowLine}</p>
    </section>
  );
}
