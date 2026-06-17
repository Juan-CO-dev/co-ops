import type { Language } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import { ActionLink } from "@/components/ActionButton";
import type { PulseFridge } from "@/lib/midshift";

export function FridgeStrip({
  fridges,
  flagCount,
  locationId,
  language,
}: {
  fridges: PulseFridge[];
  flagCount: number;
  locationId: string;
  language: Language;
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
        {serverT(language, "midshift.fridges.heading")}
      </h2>

      {/* Summary line */}
      <p className="mb-2 text-sm text-co-text">
        {flagCount === 0
          ? serverT(language, "midshift.fridges.ok")
          : serverT(language, "midshift.fridges.flagged", { count: flagCount })}
      </p>

      {/* Fridge chips */}
      {fridges.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {fridges.map((fridge) => (
            <span
              key={fridge.name}
              className={[
                "rounded-md border px-2 py-1 text-xs font-semibold",
                fridge.outOfRange
                  ? "border-co-cta text-co-cta"
                  : "border-co-border text-co-text-muted",
              ].join(" ")}
            >
              {fridge.name}
              {fridge.latestF !== null && (
                <>
                  {" "}
                  {serverT(language, "midshift.degrees", {
                    value: fridge.latestF,
                  })}
                </>
              )}
            </span>
          ))}
        </div>
      )}

      {/* View maintenance log link */}
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
