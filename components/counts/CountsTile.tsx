import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { AlertPill } from "@/components/ui/AlertPill";
import { composeCountsTile } from "@/lib/dashboard-status-shared";

/**
 * Inventory-audit status tile — a days-since-last-count gauge (design §1).
 *
 * Staleness is the lead and the number CLIMBS (Juan: "the pressure is good for
 * us"). The never-counted state is the launch-day rendering: an em-dash, a
 * start-your-first-count pill, and a sub-line that is honest that on-hand runs
 * on estimates until then. We never invent a count that has not happened.
 *
 * `state === null` means the loader FAILED — distinct from never-counted.
 */
export function CountsTile({
  language,
  locationId,
  state,
  today,
}: {
  language: Language;
  locationId: string;
  /** Counts-tile facts, or null when the read failed. */
  state: { lastCountDate: string | null; anchoredSkuCount: number } | null;
  /** Today in the operational TZ (YYYY-MM-DD). */
  today: string;
}) {
  const href = `/operations/counts?location=${locationId}`;

  if (state === null) {
    return (
      <section className="co-card p-4 sm:p-5">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, "dashboard.counts.tile_label")}
        </p>
        <p className="mt-2 text-sm text-co-text-muted italic">
          {serverT(language, "dashboard.tile.unavailable")}
        </p>
      </section>
    );
  }

  const vm = composeCountsTile({
    lastCountDate: state.lastCountDate,
    today,
    anchoredSkuCount: state.anchoredSkuCount,
    // Variance is not persisted and only exists inside loadOnHand's live drift
    // math — too expensive (and write-bearing) for the dashboard. The term
    // renders as its honest absence rather than a fabricated number.
    varianceCount: null,
  });

  const caption = serverT(language, vm.headline.key);
  const neverCounted = state.lastCountDate === null;

  return (
    <Link
      href={href}
      className="co-card block p-4 transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 sm:p-5"
      aria-label={serverT(language, "dashboard.counts.aria", {
        summary: `${vm.headline.value ?? ""} ${caption}`.trim(),
      })}
    >
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {serverT(language, "dashboard.counts.tile_label")}
      </p>

      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={`text-[28px] font-extrabold leading-none ${
            vm.headline.tone === "danger"
              ? "text-co-cta-text"
              : vm.headline.tone === "warn"
                ? "text-co-gold-text"
                : "text-co-text"
          }`}
        >
          {vm.headline.value}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {caption}
        </span>
      </div>

      {vm.pills.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {vm.pills.map((p) => (
            <AlertPill key={p.id} tone={p.tone} uppercase={false}>
              {serverT(language, p.key, p.params)}
            </AlertPill>
          ))}
        </div>
      ) : null}

      {neverCounted ? (
        <p className="mt-2 text-[11px] italic text-co-text-muted">
          {serverT(language, "dashboard.counts.never_sub")}
        </p>
      ) : null}
    </Link>
  );
}
