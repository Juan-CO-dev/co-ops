"use client";

/**
 * OpeningVerificationStation — per-station card with the "✓ Verified"
 * tick affordance.
 *
 * Per Surface 3 + Q-B refinement:
 *   - Single tap on the station tick button propagates `ticked=true` to
 *     ALL items in the station (in form state). NEVER touches photoId,
 *     notes, or countValue.
 *   - Untick affordance: tap the same button when ticked → propagates
 *     `ticked=false` to all items. Still doesn't touch other fields.
 *   - Photo/comment/count entered before/after ticking persist through
 *     all tick state changes.
 *
 * Station name resolution: per C.38 system-key discipline, the system key
 * for the station is the English `item.station` column. Translation for
 * the header display is the `translations.es.station` field on each item
 * (we read from the first item; all items in a station share the same
 * translated station header).
 */

import type { ChecklistTemplateItem } from "@/lib/types";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import type { Language } from "@/lib/i18n/types";
import { useTranslation } from "@/lib/i18n/provider";

import {
  OpeningChecklistItem,
  type OpeningItemFormValue,
} from "./OpeningChecklistItem";

interface OpeningVerificationStationProps {
  /** System-key match value (English `station` from checklist_template_items). */
  station: string;
  items: ChecklistTemplateItem[];
  /** Form values keyed by templateItemId. Items not in the map are treated as default. */
  values: Map<string, OpeningItemFormValue>;
  onChange: (templateItemId: string, next: OpeningItemFormValue) => void;
  /** Per-station tick: writes ticked=true|false to all items in the station; does NOT touch other fields. */
  onStationTickChange: (stationItems: ChecklistTemplateItem[], next: boolean) => void;
  language: Language;
  /** True when the station should highlight missing-count errors (after submit attempt). */
  showMissingCountErrors: boolean;
}

export function OpeningVerificationStation({
  station,
  items,
  values,
  onChange,
  onStationTickChange,
  language,
  showMissingCountErrors,
}: OpeningVerificationStationProps) {
  const { t } = useTranslation();

  // Tick state derived from items: station is "ticked" iff every item ticked.
  const allTicked = items.every((it) => values.get(it.id)?.ticked === true);

  // Header display from first item's translation (all items in a station
  // share the same station header translation).
  const firstItem = items[0];
  const stationDisplay = firstItem
    ? resolveTemplateItemContent(firstItem, language).station ?? station
    : station;

  return (
    <section
      aria-label={t("opening.station.aria", { station: stationDisplay })}
      className="rounded-2xl border-2 border-co-border bg-co-surface p-4 shadow-sm sm:p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="text-base font-extrabold uppercase tracking-[0.14em] text-co-text">
          {stationDisplay}
        </h3>
        <button
          type="button"
          onClick={() => onStationTickChange(items, !allTicked)}
          aria-pressed={allTicked}
          aria-label={
            allTicked
              ? t("opening.station.untick_aria", { station: stationDisplay })
              : t("opening.station.tick_aria", { station: stationDisplay })
          }
          className={[
            "inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3",
            "text-xs font-bold uppercase tracking-[0.12em]",
            "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
            allTicked
              ? "border-2 border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep"
              : "border-2 border-co-border-2 bg-co-surface text-co-text hover:border-co-text",
          ].join(" ")}
        >
          <span aria-hidden>{allTicked ? "✓" : "○"}</span>
          {allTicked ? t("opening.station.ticked_button") : t("opening.station.tick_button")}
        </button>
      </header>

      <ul className="mt-3 flex flex-col">
        {items.map((item) => {
          const value = values.get(item.id) ?? {
            countValue: null,
            photoId: null,
            notes: null,
            ticked: false,
          };
          const hasMissingCountError =
            showMissingCountErrors &&
            item.expectsCount &&
            value.ticked &&
            value.countValue === null;
          return (
            <OpeningChecklistItem
              key={item.id}
              item={item}
              value={value}
              onChange={(next) => onChange(item.id, next)}
              language={language}
              hasMissingCountError={hasMissingCountError}
            />
          );
        })}
      </ul>
    </section>
  );
}
