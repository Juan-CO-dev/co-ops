import type { Language } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import { ActionLink } from "@/components/ActionButton";
import { composeFridgeAggregate } from "@/lib/dashboard-status-shared";
import type { PulseFridge } from "@/lib/midshift";

/**
 * Fridge temps — a thin rendering of composeFridgeAggregate (SIM-25, design §2).
 *
 * The summary line used to read `flagCount === 0 ? "All fridges in range"`, which
 * rendered a green all-clear over eight fridges nobody had temped. The aggregate
 * now owns the claim: any unread fridge is the alert state, "in range" speaks only
 * for fridges actually read, and an unread chip never prints a stale number.
 *
 * `flagCount` stays in the props for the caller's existing wiring; the aggregate
 * recomputes it from the fridge facts so the strip has ONE source for its claim.
 */
export function FridgeStrip({
  fridges,
  locationId,
  language,
}: {
  fridges: PulseFridge[];
  locationId: string;
  language: Language;
}) {
  const agg = composeFridgeAggregate(fridges);
  const alert = agg.state === "alert";
  const summary = serverT(language, agg.headline.key, agg.headline.params);

  return (
    <section aria-label={serverT(language, "midshift.fridges.aria", { summary })}>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-gold-text">
        {serverT(language, "midshift.fridges.heading")}
      </h2>

      {/* Summary line — the aggregate's claim, loud when anything is unread or hot. */}
      <p
        {...(alert ? { role: "alert" as const } : {})}
        className={`mb-2 text-sm font-bold ${alert ? "text-co-cta-text" : "text-co-text"}`}
      >
        {summary}
      </p>

      {agg.pills.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {agg.pills.map((p) => (
            <span
              key={p.id}
              className={`rounded-md px-2 py-1 text-[11px] font-bold ${
                p.tone === "danger"
                  ? "bg-co-danger-surface text-co-cta-text"
                  : "bg-co-success-surface text-co-success"
              }`}
            >
              {serverT(language, p.key, p.params)}
            </span>
          ))}
        </div>
      )}

      {/* Fridge chips. An UNREAD fridge renders in the alert treatment and makes NO
          temperature claim — its `latestF` may be a stale reading from a prior day
          (lib/maintenance.ts computes `latest` over the window, `status` over today). */}
      {fridges.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {fridges.map((fridge) => {
            const bad = fridge.outOfRange || !fridge.hasReadingToday;
            return (
              <span
                key={fridge.equipId}
                className={[
                  "rounded-md border px-2 py-1 text-xs font-semibold",
                  bad ? "border-co-cta-text text-co-cta-text" : "border-co-border text-co-text-muted",
                ].join(" ")}
              >
                {fridge.name}{" "}
                {fridge.hasReadingToday && fridge.latestF !== null
                  ? serverT(language, "midshift.degrees", { value: fridge.latestF })
                  : serverT(language, "midshift.fridges.chip_unread")}
              </span>
            );
          })}
        </div>
      )}

      <ActionLink
        href={`/maintenance?location=${locationId}`}
        variant="secondary"
        className="w-full"
      >
        {serverT(language, "midshift.fridges.view")}
      </ActionLink>
    </section>
  );
}
