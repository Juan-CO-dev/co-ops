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

import type { ChecklistTemplateItem, OpeningPhase2Meta } from "@/lib/types";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import type { Language } from "@/lib/i18n/types";
import { useTranslation } from "@/lib/i18n/provider";
import type { OpeningCloserCountSnapshotRow } from "@/lib/opening";

import {
  OpeningChecklistItem,
  type OpeningItemFormValue,
} from "./OpeningChecklistItem";
import { OpeningSectionVerify } from "./OpeningSectionVerify";

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
  /**
   * C.53 closer-count snapshots — keyed on templateItemId. Threaded from the
   * parent's `closerSnapshotsMap` (derived from `closerSnapshots` prop on
   * OpeningClient via useMemo at opening-client.tsx). Per-item lookup
   * (`get(item.id)?.closerCount`) drives the tri-state `closerCount` prop on
   * OpeningChecklistItem — undefined means "not a spot-check item", null
   * means "NULL-source", number means "captured closer count."
   */
  closerSnapshotsMap: Map<string, OpeningCloserCountSnapshotRow>;
  /**
   * C.53 §10 Lane B — section-verify state for spot-check stations. Spot-check
   * stations (dedicated cards where every item is in the closer-count-snapshot
   * universe) render OpeningSectionVerify in place of the per-station tick
   * button. Keyed on prep_meta.section — the system key that T0.4's
   * spotCheckResolved gate and submit_phase1_atomic both read.
   */
  sectionVerifications: Map<string, boolean>;
  onSectionVerifyToggle: (sectionKey: string) => void;
  /**
   * C.53 Commit B Finding A — server-truth verify lock. True once Phase 1 has
   * landed (instance.status !== 'open'). The verify beat is once-per-instance:
   * when locked, every tick + section-verify renders DONE and is read-only, so
   * a second opener (whose local form is empty) can't re-tick or re-verify.
   */
  verificationLocked: boolean;
}

export function OpeningVerificationStation({
  station,
  items,
  values,
  onChange,
  onStationTickChange,
  language,
  showMissingCountErrors,
  closerSnapshotsMap,
  sectionVerifications,
  onSectionVerifyToggle,
  verificationLocked,
}: OpeningVerificationStationProps) {
  const { t } = useTranslation();

  // Tick state derived from items: station is "ticked" iff every item ticked.
  const allTicked = items.every((it) => values.get(it.id)?.ticked === true);
  // Finding A — when the verify beat is locked (Phase 1 already landed), render
  // ticked + read-only regardless of this browser's (possibly empty) local form.
  const displayTicked = verificationLocked || allTicked;

  // Header display from first item's translation (all items in a station
  // share the same station header translation).
  const firstItem = items[0];
  const stationDisplay = firstItem
    ? resolveTemplateItemContent(firstItem, language).station ?? station
    : station;

  // C.53 §10 Lane B — branch the header by what the card actually contains.
  // Seed reality: cards are homogeneous (all-tick OR all-spot-check; zero
  // station/section overlap). Render-by-content rather than assuming
  // homogeneity, so a future mixed card degrades correctly instead of dropping
  // an affordance.
  const hasSpotCheckItems = items.some((it) => closerSnapshotsMap.has(it.id));
  const hasTickItems = items.some((it) => !closerSnapshotsMap.has(it.id));

  // Section key for verify state — keyed on prep_meta.section (C.38 system-key
  // discipline), NOT the station string. station === section for spot-check
  // items today, but keying on the system field keeps the toggle aligned with
  // T0.4's spotCheckResolved + the RPC if that ever drifts. All spot-check items
  // in a card share one section (cards group by station, station === section).
  const firstSpotCheck = items.find((it) => closerSnapshotsMap.has(it.id));
  const sectionKey =
    (firstSpotCheck?.prepMeta as OpeningPhase2Meta | null)?.section ?? station;
  const sectionVerified = sectionVerifications.get(sectionKey) ?? false;

  // Flag B port (mandatory Triad A condition) — mirror of OpeningPrepEntry's
  // sectionDisabledMap: section-verify is disabled when any spot-check item has
  // NULL closer_count AND no opener_recount. Forces recount as the only path for
  // NULL-source items, matching the RPC's null_source_requires_recount so the
  // disjunctive T0.4 gate (section-verified OR recount) stays RPC-consistent.
  const sectionHasUnrecountedNull = items.some((it) => {
    if (!closerSnapshotsMap.has(it.id)) return false;
    const snap = closerSnapshotsMap.get(it.id);
    const v = values.get(it.id);
    return (
      (snap?.closerCount ?? null) === null &&
      (v?.openerRecount ?? null) === null
    );
  });

  return (
    <section
      aria-label={t("opening.station.aria", { station: stationDisplay })}
      className="rounded-2xl border-2 border-co-border bg-co-surface p-4 shadow-sm sm:p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="text-base font-extrabold uppercase tracking-[0.14em] text-co-text">
          {stationDisplay}
        </h3>
        {hasTickItems ? (
          <button
            type="button"
            onClick={
              verificationLocked
                ? undefined
                : () => onStationTickChange(items, !allTicked)
            }
            disabled={verificationLocked}
            aria-pressed={displayTicked}
            aria-disabled={verificationLocked || undefined}
            aria-label={
              displayTicked
                ? t("opening.station.untick_aria", { station: stationDisplay })
                : t("opening.station.tick_aria", { station: stationDisplay })
            }
            className={[
              "inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3",
              "text-xs font-bold uppercase tracking-[0.12em]",
              "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
              verificationLocked
                ? "cursor-not-allowed border-2 border-co-text bg-co-gold text-co-text opacity-70"
                : displayTicked
                  ? "border-2 border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep"
                  : "border-2 border-co-border-2 bg-co-surface text-co-text hover:border-co-text",
            ].join(" ")}
          >
            <span aria-hidden>{displayTicked ? "✓" : "○"}</span>
            {displayTicked ? t("opening.station.ticked_button") : t("opening.station.tick_button")}
          </button>
        ) : null}
        {hasSpotCheckItems ? (
          <OpeningSectionVerify
            sectionKey={sectionKey}
            sectionDisplay={stationDisplay}
            verified={sectionVerified}
            disabled={sectionHasUnrecountedNull || verificationLocked}
            disabledReason={sectionHasUnrecountedNull ? "null_items_unrecounted" : null}
            onToggleVerified={() => onSectionVerifyToggle(sectionKey)}
            language={language}
          />
        ) : null}
      </header>

      <ul className="mt-3 flex flex-col">
        {items.map((item) => {
          // Fix-pass 2026-05-26: default-value fallback now includes
          // `openerRecount: null` to satisfy OpeningItemFormValue contract
          // (Aggie's WIP added the slot but missed this fallback site).
          const value = values.get(item.id) ?? {
            countValue: null,
            photoId: null,
            notes: null,
            ticked: false,
            openerRecount: null,
          };
          const hasMissingCountError =
            showMissingCountErrors &&
            item.expectsCount &&
            value.ticked &&
            value.countValue === null;
          // Tri-state per OpeningChecklistItemProps.closerCount JSDoc:
          //   undefined → not a spot-check item (no snapshot row)
          //   null      → NULL-source (snapshot row, closer_count IS NULL)
          //   number    → captured closer count
          const closerCount = closerSnapshotsMap.get(item.id)?.closerCount;
          return (
            <OpeningChecklistItem
              key={item.id}
              item={item}
              value={value}
              onChange={(next) => onChange(item.id, next)}
              language={language}
              hasMissingCountError={hasMissingCountError}
              closerCount={closerCount}
              verificationLocked={verificationLocked}
            />
          );
        })}
      </ul>
    </section>
  );
}
